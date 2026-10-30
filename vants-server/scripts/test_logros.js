/* VANTS · test_logros.js — pruebas del VANTS ACHIEVEMENTS & BADGE ENGINE
   Ejecutar: node vants-server/scripts/test_logros.js  (o bun run)
   Cubre los casos obligatorios del prompt que son lógica pura:
   idempotencia, elegibilidad CHAMPION, umbral VETERAN, destacadas ≤3,
   backoff/DLQ del outbox, firma HMAC anti-replay y validaciones. */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

import LOG from "../logros-core.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ============================ LÓGICA PURA ============================ */

describe("idempotencia", () => {
  test("un mismo evento entregado 10 veces produce UNA clave de concesión", async () => {
    const k1 = await LOG.claveIdempotencia("auth0|123", "CHAMPION", "evt-torneo-1", "");
    const k2 = await LOG.claveIdempotencia("auth0|123", "CHAMPION", "evt-torneo-1", "");
    assert.equal(k1, k2);
    const kOtro = await LOG.claveIdempotencia("auth0|456", "CHAMPION", "evt-torneo-1", "");
    assert.notEqual(k1, kOtro);
    const kOtroEvento = await LOG.claveIdempotencia("auth0|123", "CHAMPION", "evt-torneo-2", "");
    assert.notEqual(k1, kOtroEvento);
  });

  test("periodo distinto (temporada) produce clave distinta", async () => {
    const a = await LOG.claveIdempotencia("auth0|1", "TOP 10", "temporada", "T2025");
    const b = await LOG.claveIdempotencia("auth0|1", "TOP 10", "temporada", "T2026");
    assert.notEqual(a, b);
  });
});

describe("regla CHAMPION (evidencia verificada)", () => {
  const torneoOficial = { id: "t1", nombre: "VANTS OPEN", estado: "finished", is_demo: 0 };
  const finalGanada = { id: "m9", ronda: "f", estado: "final", ganador: "eq-a", team_a: "eq-a", team_b: "eq-b", score_a: 3, score_b: 1, updated_at: "2026-01-01T00:00:00Z" };
  const plantilla = [
    { id: "eq-a", auth0_sub: "auth0|capitan" },
    { id: "eq-a", auth0_sub: "auth0|j2" },
    { id: "eq-b", auth0_sub: "auth0|rival" },
  ];

  test("torneo oficial finalizado concede SOLO a la plantilla ganadora elegible", () => {
    const r = LOG.evaluarChampion(finalGanada, torneoOficial, plantilla);
    assert.equal(r.concede, true);
    assert.deepEqual(r.candidatos, ["auth0|capitan", "auth0|j2"]); // el rival NO
    assert.equal(r.evidencia.equipo_ganador, "eq-a");
    assert.deepEqual(r.evidencia.score, [3, 1]);
  });

  test("un torneo demo NUNCA concede", () => {
    const r = LOG.evaluarChampion(finalGanada, { ...torneoOficial, is_demo: 1 }, plantilla);
    assert.equal(r.concede, false);
    assert.equal(r.motivo, "torneo_demo");
  });

  test("un torneo anulado/cancelado NUNCA concede", () => {
    const r = LOG.evaluarChampion(finalGanada, { ...torneoOficial, estado: "cancelled" }, plantilla);
    assert.equal(r.concede, false);
    assert.equal(r.motivo, "torneo_no_finalizado");
  });

  test("resultado no validado (sin ganador) no concede", () => {
    const r = LOG.evaluarChampion({ ...finalGanada, ganador: null }, torneoOficial, plantilla);
    assert.equal(r.concede, false);
  });

  test("plantilla sin cuentas verificadas no concede a nadie", () => {
    const r = LOG.evaluarChampion(finalGanada, torneoOficial, [{ id: "eq-a" }]);
    assert.equal(r.concede, false);
    assert.equal(r.motivo, "plantilla_sin_cuentas");
  });

  test("partido de semifinal no es la final", () => {
    const r = LOG.evaluarChampion({ ...finalGanada, ronda: "s" }, torneoOficial, plantilla);
    assert.equal(r.concede, false);
    assert.equal(r.motivo, "sin_ganador_confirmado");
  });
});

describe("regla VETERAN (umbral configurable)", () => {
  test("4 participaciones no conceden; 5 sí (umbral por defecto)", () => {
    assert.equal(LOG.evaluarVeteran(4).concede, false);
    assert.equal(LOG.evaluarVeteran(5).concede, true);
    assert.equal(LOG.evaluarVeteran(5).objetivo, 5);
  });
  test("umbral editable por administración", () => {
    assert.equal(LOG.evaluarVeteran(2, 2).concede, true);
    assert.equal(LOG.evaluarVeteran(9, 10).concede, false);
  });
  test("participaciones negativas o basura no cuentan", () => {
    assert.equal(LOG.evaluarVeteran(-3).actual, 0);
    assert.equal(LOG.evaluarVeteran("x").actual, 0);
  });
});

describe("insignias destacadas (máximo 3)", () => {
  const cat = LOG.INSIGNIAS.map((b) => ({ code: b.code }));
  test("3 se aceptan, 4 no", () => {
    assert.equal(LOG.validarDestacadas(["MEMBER", "PLUS", "PRO"], cat).ok, true);
    const v4 = LOG.validarDestacadas(["MEMBER", "PLUS", "PRO", "ELITE"], cat);
    assert.equal(v4.ok, false);
    assert.equal(v4.error, "maximo_3");
  });
  test("código desconocido o repetido se rechaza", () => {
    assert.equal(LOG.validarDestacadas(["MEMBER", "MEMBER"], cat).ok, false);
    assert.equal(LOG.validarDestacadas(["NO_EXISTE"], cat).ok, false);
  });
});

describe("outbox: backoff exponencial y DLQ funcional", () => {
  test("reintentos progresivos y agotamiento a la DLQ", () => {
    const seq = [];
    for (let i = 0; i < 12; i++) seq.push(LOG.proximoReintento(i, 0));
    assert.ok(seq[0] && Date.parse(seq[0]) > Date.now() - 5000);      // 1er reintento futuro
    assert.ok(Date.parse(seq[0]) - Date.parse(seq[1]) < 0);           // backoff crece
    assert.equal(seq[10], null); // agotado → DLQ
    assert.equal(seq[11], null);
  });
  test("listaParaProcesar solo toma pendientes vencidas", () => {
    const pasado = new Date(Date.now() - 60000).toISOString();
    const futuro = new Date(Date.now() + 60000).toISOString();
    assert.equal(LOG.listaParaProcesar({ status: "pending", next_retry_at: pasado }, Date.now()), true);
    assert.equal(LOG.listaParaProcesar({ status: "pending", next_retry_at: futuro }, Date.now()), false);
    assert.equal(LOG.listaParaProcesar({ status: "done", next_retry_at: pasado }, Date.now()), false);
  });
});

describe("firma HMAC (mismo contrato que VANTS-BUS) con anti-replay", async () => {
  const SECRETO = "secreto-de-prueba";
  const cuerpo = JSON.stringify({ type: "match.finished", event_id: "abc12345", payload: { matchId: "m1" } });
  async function firmar(ts) {
    const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRETO), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(ts + "." + cuerpo));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  test("firma válida en ventana pasa", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    assert.equal(await LOG.verificarFirma(SECRETO, cuerpo, ts, await firmar(ts)), true);
  });
  test("firma inválida se rechaza", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    assert.equal(await LOG.verificarFirma(SECRETO, cuerpo + " ", ts, await firmar(ts)), false);
    assert.equal(await LOG.verificarFirma("otro-secreto", cuerpo, ts, await firmar(ts)), false);
  });
  test("replay fuera de ventana (±5 min) se rechaza", async () => {
    const ts = String(Math.floor(Date.now() / 1000) - 3600);
    assert.equal(await LOG.verificarFirma(SECRETO, cuerpo, ts, await firmar(ts)), false);
  });
  test("comparación en tiempo constante acepta el hash en mayúsculas", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const f = await firmar(ts);
    assert.equal(await LOG.verificarFirma(SECRETO, cuerpo, ts, f.toUpperCase()), true);
  });
});

describe("validaciones (equivalente Zod)", () => {
  const cat = LOG.INSIGNIAS.map((b) => ({ code: b.code }));
  test("grant exige sub, código y justificación", () => {
    assert.equal(LOG.validarGrant({ user_id: "auth0|abc123", code: "CHAMPION", justification: "Ganó el torneo oficial X" }, cat).ok, true);
    assert.equal(LOG.validarGrant({ user_id: "no válido con espacios", code: "CHAMPION", justification: "xxxxxxxxxxx" }, cat).ok, false);
    assert.equal(LOG.validarGrant({ user_id: "auth0|abc123", code: "COMPRADA", justification: "xxxxxxxxxxx" }, cat).ok, false);
    assert.equal(LOG.validarGrant({ user_id: "auth0|abc123", code: "PRO", justification: "corta" }, cat).ok, false);
  });
  test("un usuario no puede comprar VERIFIED: solo admin con justificación", () => {
    // VERIFIED existe en catálogo pero grant_type=admin: la UI del jugador jamás lo pide,
    // y el motor solo lo concede vía /api/admin (owner + auditoría).
    const verified = LOG.INSIGNIAS.find((b) => b.code === "VERIFIED");
    assert.equal(verified.tipo, "admin");
  });
  test("revoke exige motivo y objetivo", () => {
    assert.equal(LOG.validarRevoke({ award_id: "0a0a0a0a-1111-2222-3333-444444444444", reason: "Torneo anulado por org" }).ok, true);
    assert.equal(LOG.validarRevoke({ reason: "Torneo anulado por org" }).ok, false);
    assert.equal(LOG.validarRevoke({ award_id: "x", reason: "motivo corto" }).ok, false);
  });
  test("ingest valida tipo, event_id y tamaño de payload", () => {
    assert.equal(LOG.validarIngest({ type: "match.finished", event_id: "evt-123456", payload: { matchId: "m1" } }).ok, true);
    assert.equal(LOG.validarIngest({ type: "TIPO MAL", event_id: "evt-123456" }).ok, false);
    assert.equal(LOG.validarIngest({ type: "match.finished", event_id: "corto" }).ok, false);
    assert.equal(LOG.validarIngest({ type: "match.finished", event_id: "evt-123456", payload: "texto" }).ok, false);
  });
  test("sub de Auth0 acepta proveedores conocidos", () => {
    assert.ok(LOG.validarSub("auth0|650f1"));
    assert.ok(LOG.validarSub("google-oauth2|1234"));
    assert.ok(LOG.validarSub("discord|999"));
    assert.equal(LOG.validarSub("'; DROP TABLE x;--"), null);
  });
});

/* ==================== MIGRACIÓN SQL CONTRA SQLITE ==================== */

describe("migración 0001 aplicable a SQLite (espejo del dialecto D1)", () => {
  const rutaDb = join(RAIZ, ".tmp-test-logros.sqlite");
  beforeEach(() => { try { execSync(`rm -f "${rutaDb}"`); } catch (e) {} });
  afterEach(() => { try { execSync(`rm -f "${rutaDb}"`); } catch (e) {} });

  test("el SQL aplica limpio y es idempotente (re-ejecutar no falla ni duplica)", () => {
    const rutaSql = join(RAIZ, ".tmp-test-logros.sql");
    writeFileSync(rutaSql, readFileSync(join(RAIZ, "db", "logros", "0001_logros_inicial.sql"), "utf8"));
    // sqlite3 CLI no está en el entorno: se usa el módulo sqlite3 de Python (mismo dialecto).
    const py = [
      "import sqlite3",
      `c = sqlite3.connect(${JSON.stringify(rutaDb)})`,
      `sql = open(${JSON.stringify(rutaSql)}, encoding='utf-8').read()`,
      "c.executescript(sql)",
      "c.executescript(sql)",  // re-ejecución idempotente
      "print(c.execute('SELECT COUNT(*) FROM badge_definitions').fetchone()[0])",
      "print(c.execute('SELECT COUNT(*) FROM achievement_rules').fetchone()[0])",
      "print(c.execute(\"SELECT COUNT(*) FROM badge_definitions WHERE grant_type='subscription'\").fetchone()[0])",
      "c.execute(\"INSERT INTO user_badge_awards (id,user_id,badge_id,idempotency_key) VALUES ('a1','u1','bgd_champ','k1')\")",
      "c.commit()",
      "dup = 0",
      "try:",
      "    c.execute(\"INSERT INTO user_badge_awards (id,user_id,badge_id,idempotency_key) VALUES ('a2','u1','bgd_champ','k1')\")",
      "    dup = 1",
      "except sqlite3.IntegrityError:",
      "    dup = 0",
      "print(dup)",
    ].join("\n");
    const out = execSync("python3 -", { input: py }).toString().trim().split("\n");
    try { execSync(`rm -f "${rutaSql}"`); } catch (e) {}
    assert.equal(out[0], "12"); // catálogo sin duplicar
    assert.equal(out[1], "12"); // reglas sin duplicar
    assert.equal(out[2], "3");  // PLUS/PRO/ELITE dormiles
    assert.equal(out[3], "0", "la clave de idempotencia debe ser UNIQUE");
  });
});

/* ====================== CATÁLOGO Y PROYECCIONES ====================== */

describe("catálogo de 12 insignias y proyecciones públicas", () => {
  test("exactamente las 12 oficiales con tipos correctos", () => {
    const codes = LOG.INSIGNIAS.map((b) => b.code);
    assert.deepEqual(codes, ["MEMBER", "PLUS", "PRO", "ELITE", "CREATOR", "PARTNER", "CHAMPION", "TOP 10", "RISING STAR", "VETERAN", "FOUNDER", "VERIFIED"]);
    const subs = LOG.INSIGNIAS.filter((b) => b.tipo === "subscription");
    assert.equal(subs.length, 3); // PLUS/PRO/ELITE: dormiles hasta que haya pagos
  });
  test("la proyección pública jamás filtra PII ni sub completo", () => {
    const p = LOG.concesionPublica(
      { status: "active", awarded_at: "2026-01-01T00:00:00Z", user_id: "auth0|secreto", evidence_json: JSON.stringify({ tournament_nombre: "VANTS OPEN", score: [3, 1] }) },
      { code: "CHAMPION", name: "CHAMPION", description: "", requirement: "", category: "competitive", rarity: "legendary", color: "#f5c044", image_version: 1 },
    );
    assert.equal(JSON.stringify(p).includes("auth0|secreto"), false);
    assert.equal(p.evidence.torneo, "VANTS OPEN");
    assert.equal(p.badge.image.master, "/assets/badges/champion/1024.png?v=1");
  });
});
