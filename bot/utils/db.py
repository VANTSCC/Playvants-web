"""Acceso a la base de datos para el bot de VANTS — EDICIÓN CLOUDFLARE D1.

Antes: psycopg 3 contra Postgres (Neon, luego Supabase). Ahora: TODO en
Cloudflare — la base es D1 (vants-db) y este módulo habla con ella por la
API REST de Cloudflare (HTTPS), que funciona desde Railway/Render/VPS sin
drivers de Postgres. La interfaz para el resto del bot NO cambia:

    await fetch_all(sql, params)  → list[dict]
    await fetch_one(sql, params)  → dict | None
    await fetch_val(sql, params)  → primer valor escalar | None
    await execute(sql, params)    → None

Variables de entorno (ver .env.example):
    CLOUDFLARE_ACCOUNT_ID   id de la cuenta
    CLOUDFLARE_API_TOKEN    token con permiso D1 (Accounts → D1 → Edit)
    CLOUDFLARE_D1_ID        id de la base vants-db
                          (11e5d82c-307b-44ba-9682-501d8df593d3)

El traductor `pg_a_d1` convierte al vuelo el dialecto Postgres que el bot
escribía en sus consultas al dialecto SQLite de D1, así que el SQL del bot
no se toca: $1..$n → ?, NOW() → datetime('now'), ::casts → nada,
ILIKE → LIKE, GREATEST → MAX, jsonb_build_object → json_object,
booleanos true/false → 1/0.
"""

import asyncio
import json
import os
import re
import time
from typing import Any, Sequence

import aiohttp

D1_URL = "https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{db}/query"

_account = os.getenv("CLOUDFLARE_ACCOUNT_ID", "")
_token = os.getenv("CLOUDFLARE_API_TOKEN", "")
_d1_id = os.getenv("CLOUDFLARE_D1_ID", "")

_session: aiohttp.ClientSession | None = None
_lock = asyncio.Lock()

# Límite de robustez: reintentos con backoff ante 429/5xx (la API de D1
# tiene rate limit por minuto).
_REINTENTOS = 3


def _configurar() -> None:
    global _account, _token, _d1_id
    _account = _account or os.getenv("CLOUDFLARE_ACCOUNT_ID", "")
    _token = _token or os.getenv("CLOUDFLARE_API_TOKEN", "")
    _d1_id = _d1_id or os.getenv("CLOUDFLARE_D1_ID", "")
    if not (_account and _token and _d1_id):
        raise RuntimeError(
            "Faltan variables de entorno de D1: CLOUDFLARE_ACCOUNT_ID, "
            "CLOUDFLARE_API_TOKEN y CLOUDFLARE_D1_ID (ver .env.example)"
        )


# ── traductor Postgres → SQLite/D1 (mismas reglas que functions/_d1.js) ─────
_RE_PARAM = re.compile(r"\$(\d+)")
_RE_CAST = re.compile(r"::[a-zA-Z_][a-zA-Z0-9_]*(\[\])?")
_RE_ANY = re.compile(r"=\s*ANY\(ARRAY\[((?:\$\d+(?:\s*,\s*\$\d+)*)?)\]\)", re.I)


def pg_a_d1(sql: str, params: Sequence[Any]) -> tuple[str, list[Any]]:
    texto = str(sql)
    texto = _RE_CAST.sub("", texto)
    texto = _RE_ANY.sub(lambda m: "IN (" + (",".join(["?"] * len(m.group(1).split(","))) if m.group(1) else "NULL") + ")", texto)
    texto = re.sub(r"\bGREATEST\b", "MAX", texto, flags=re.I)
    texto = re.sub(r"\bILIKE\b", "LIKE", texto, flags=re.I)
    texto = re.sub(r"\bNOW\(\)", "datetime('now')", texto, flags=re.I)
    # booleanos de Postgres en literales
    texto = re.sub(r"(?<![\w'])\bTRUE\b(?![\w'])", "1", texto)
    texto = re.sub(r"(?<![\w'])\bFALSE\b(?![\w'])", "0", texto)
    texto = texto.replace("jsonb_build_object(", "json_object(")
    texto = texto.replace("to_jsonb(", "json(")
    texto = re.sub(r"\bjsonb_agg\b", "json_group_array", texto, flags=re.I)

    # $n → ? reordenando por primera aparición
    orden: list[int] = []

    def _param(m: re.Match) -> str:
        idx = int(m.group(1)) - 1
        if idx not in orden:
            orden.append(idx)
        return "?"

    texto = _RE_PARAM.sub(_param, texto)
    if orden:
        valores = [params[i] if i < len(params) else None for i in orden]
    else:
        valores = list(params)
    return texto, valores


async def _sesion() -> aiohttp.ClientSession:
    global _session
    if _session is not None and not _session.closed:
        return _session
    async with _lock:
        if _session is None or _session.closed:
            _session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=30),
                headers={"Authorization": f"Bearer {_token}", "Content-Type": "application/json"},
            )
    return _session


async def _d1_query(sql: str, params: list[Any]) -> list[dict]:
    """Ejecuta una consulta contra D1 y devuelve filas como dicts."""
    _configurar()
    url = D1_URL.format(account=_account, db=_d1_id)
    cuerpo = {"sql": sql, "params": params}
    s = await _sesion()
    ultimo_error: Exception | None = None
    for intento in range(1, _REINTENTOS + 1):
        try:
            async with s.post(url, json=cuerpo) as r:
                d = await r.json(content_type=None)
                if r.status in (429, 500, 502, 503) and intento < _REINTENTOS:
                    await asyncio.sleep(0.5 * 2 ** (intento - 1))
                    continue
                if not d.get("success"):
                    raise RuntimeError(f"D1 error: {d.get('errors')}")
                resultado = d["result"][0]
                return list(resultado.get("results") or [])
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            ultimo_error = e
            if intento < _REINTENTOS:
                await asyncio.sleep(0.5 * 2 ** (intento - 1))
                continue
            raise
    raise ultimo_error or RuntimeError("D1 sin respuesta")


async def fetch_all(sql: str, params: Sequence[Any] | None = None) -> list[dict]:
    texto, valores = pg_a_d1(sql, params or [])
    return await _d1_query(texto, valores)


async def fetch_one(sql: str, params: Sequence[Any] | None = None) -> dict | None:
    filas = await fetch_all(sql, params)
    return filas[0] if filas else None


async def fetch_val(sql: str, params: Sequence[Any] | None = None) -> Any:
    fila = await fetch_one(sql, params)
    return next(iter(fila.values())) if fila else None


async def execute(sql: str, params: Sequence[Any] | None = None) -> None:
    await fetch_all(sql, params)


async def execute_batch(sentencias: Sequence[tuple[str, Sequence[Any]]]) -> None:
    """Varias escrituras en una sola llamada (transaccional en D1)."""
    if not sentencias:
        return
    cuerpo = [{"sql": pg_a_d1(s, list(p or []))[0], "params": pg_a_d1(s, list(p or []))[1]} for s, p in sentencias]
    _configurar()
    url = D1_URL.format(account=_account, db=_d1_id)
    s = await _sesion()
    async with s.post(url, json=cuerpo) as r:
        d = await r.json(content_type=None)
        if not d.get("success"):
            raise RuntimeError(f"D1 batch error: {d.get('errors')}")


async def close_pool() -> None:
    global _session
    if _session is not None and not _session.closed:
        await _session.close()
    _session = None


# Compatibilidad de nombres con el código viejo del bot (psycopg pool)
get_pool = close_pool  # nada que abrir: la sesión HTTP se crea sola
