// ============================================
// mm — Cloudflare Worker Function: MATCHMAKING serverless
// Espejo HTTP del matchmaking-service SIN hosting de pago:
// mismo contrato de respuestas {ok, data} / {ok:false, error:{message}}.
//
// EDICIÓN D1 (todo en Cloudflare): la base es D1 (vants-db, binding DB).
// Los procedimientos almacenados PL/pgSQL de las migraciones 21/22/23/24/27
// viven ahora aquí como funciones JS con SQL SQLite (misma semántica):
//   mm_encolar · mm_ticket_estado · mm_salir · mm_intentar_emparejar ·
//   mm_reportar (+ mm_aplicar_resultado + faceit_stats_delta) ·
//   mm_historial (vista D1) · mm_invitar · mm_invites_pendientes ·
//   mm_responder_invite · rr_historial_jugador (vista D1)
//
//   POST /encolar    {game, mode, region?, ttl_min?}
//   GET  /estado?ticket=MM-…
//   POST /salir      {ticket}
//   POST /reportar   {match_id, score_a, score_b}   (participante; aplica RR)
//   GET  /historial?limite=
//   GET  /rr?limite=
//   POST /invitar    {to_email, game, mode, region?}
//   GET  /invites?limite=
//   POST /invites/responder {id, aceptar}
//   GET  /salud
//
// Autenticación: JWT RS256 de Auth0 verificado SIN dependencias (JWKS+cache).
// La identidad del sub viaja como argumento de cada operación JS (el Worker
// es el límite de confianza; en Postgres lo hacía el GUC + RLS).
// ============================================

import { crearSql, type Sql } from '../_d1.js';
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

const JWKS_TTL_MS = 10 * 60 * 1000;
const LEEWAY_SEG = 30;
const TICKET_TTL_MS = 10 * 60 * 1000; // igual que el service
const MODOS: Record<string, number> = { duo: 2, team: 10 }; // 1v1 / 5v5

type Fila = Record<string, unknown>;
type Dependencias = {
  env: Record<string, string | undefined>;
  sql: Sql | null;
  fetch: typeof fetch;
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
const err = (message: string, status: number): Response => json({ ok: false, error: { message } }, status);

// ── utilidades sobre D1 ──────────────────────────────────────────────────────
const AHORA = "datetime('now')";

function nuevoTicket(): string {
  const hex = crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  return `MM-${hex}`;
}

function vencidoISO(ttlSeg: number): string {
  const seg = Math.max(60, Math.min(Number.isFinite(ttlSeg) ? ttlSeg : 600, 3600));
  return new Date(Date.now() + seg * 1000).toISOString();
}

function redondeo100(x: number): number {
  return Math.round(x * 100);
}

// error SQL (jsonb res.error) → status HTTP
function statusDeError(code: string): number {
  if (code === 'ya_reportado') return 409;
  if (code === 'no_encontrado' || code === 'destino_no_encontrado') return 404;
  if (code === 'sub_ajeno' || code === 'ticket_ajeno' || code === 'no_participante'
    || code === 'no_elegible' || code === 'destino_es_tu_email' || code === 'ya_no_vigente') return 403;
  if (code === 'sin_sesion') return 500;
  return 400; // game_requerido, mode_invalido, score_invalido, email_invalido…
}

function respuestaSql(res: Fila | undefined, exito: (r: Fila) => Response): Response {
  if (!res || res.ok !== true) {
    const code = String((res && res.error) || 'error_sql');
    return err(code, statusDeError(code));
  }
  return exito(res);
}

// ── Procedimientos portados (migraciones 21/22/23/24/27) ────────────────────

// seasons activa (rr_temporada_actual)
async function temporadaActual(sql: Sql): Promise<string | null> {
  try {
    const r = await sql.query(`SELECT id FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1`, []);
    return (r.rows[0]?.id as string) ?? null;
  } catch { return null; }
}

// faceit_stats_delta (migra 10/27): wins/losses de temporada + espejo rank/mmr
async function statsDelta(sql: Sql, playerId: string, resultado: string, nuevoRating: number): Promise<void> {
  const temporada = await temporadaActual(sql);
  const hay = await sql.query(`SELECT 1 AS x FROM season_player_stats WHERE player_id = $1 LIMIT 1`, [playerId]);
  if (!hay.rows.length) {
    await sql.query(
      `INSERT INTO season_player_stats (id, player_id, season_id, wins, losses) VALUES ($1, $2, $3, 0, 0)`,
      [crypto.randomUUID(), playerId, temporada]
    ).catch(() => {});
  }
  if (resultado === 'win') {
    await sql.query(`UPDATE season_player_stats SET wins = COALESCE(wins, 0) + 1 WHERE player_id = $1`, [playerId]);
  } else if (resultado === 'loss') {
    await sql.query(`UPDATE season_player_stats SET losses = COALESCE(losses, 0) + 1 WHERE player_id = $1`, [playerId]);
  }
  // rank y mmr espejo del rating: la web los lee de acá
  await sql.query(
    `UPDATE season_player_stats SET rank = $2, mmr = $3 WHERE player_id = $1`,
    [playerId, String(nuevoRating), redondeo100(nuevoRating)]
  );
}

// mm_encolar (migra 23)
async function mmEncolar(sql: Sql, sub: string, game: string, mode: string, region: string, ttlSeg: number): Promise<Fila> {
  if (!game || !game.trim()) return { ok: false, error: 'game_requerido' };
  if (!(mode in MODOS)) return { ok: false, error: 'mode_invalido' };

  const j = await sql.query(`SELECT id FROM players WHERE auth0_sub = $1 LIMIT 1`, [sub]);
  if (!j.rows.length) return { ok: false, error: 'no_elegible' };

  // vencidos propios fuera
  await sql.query(
    `UPDATE mm_tickets SET status = 'expired', updated_at = ${AHORA} WHERE sub = $1 AND status = 'queued' AND expires_at < ${AHORA}`,
    [sub]
  );

  // ticket vivo para el mismo juego → reutilizar
  const vivo = await sql.query(
    `SELECT ticket, expires_at FROM mm_tickets WHERE sub = $1 AND game = $2 AND status = 'queued' AND expires_at >= ${AHORA} LIMIT 1`,
    [sub, game.trim()]
  );
  if (vivo.rows.length) {
    return { ok: true, ticket: vivo.rows[0].ticket, reutilizado: true, expires_at: vivo.rows[0].expires_at };
  }

  const ticket = nuevoTicket();
  const expira = vencidoISO(ttlSeg);
  const regionFinal = (region || '').trim() || 'EU';
  const ins = await sql.query(
    `INSERT INTO mm_tickets (ticket, sub, game, mode, region, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'queued', $6)
     ON CONFLICT (sub, game) WHERE status = 'queued' DO NOTHING`,
    [ticket, sub, game.trim(), mode, regionFinal, expira]
  );
  if (!ins.rowCount) {
    // carrera con otro INSERT: reutilizar el que ganó
    const g = await sql.query(
      `SELECT ticket, expires_at FROM mm_tickets WHERE sub = $1 AND game = $2 AND status = 'queued' LIMIT 1`,
      [sub, game.trim()]
    );
    if (!g.rows.length) return { ok: false, error: 'error_sql' };
    return { ok: true, ticket: g.rows[0].ticket, reutilizado: true, expires_at: g.rows[0].expires_at };
  }
  return { ok: true, ticket, reutilizado: false, expires_at: expira };
}

// mm_ticket_estado (migra 23)
async function mmTicketEstado(sql: Sql, ticket: string, sub: string): Promise<Fila> {
  const r = await sql.query(`SELECT * FROM mm_tickets WHERE ticket = $1`, [ticket]);
  if (!r.rows.length) return { ok: false, error: 'no_encontrado' };
  const t = r.rows[0];
  if (String(t.sub) !== sub) return { ok: false, error: 'ticket_ajeno' };

  if (t.status === 'queued') {
    const expirado = new Date(String(t.expires_at)).getTime() < Date.now();
    if (expirado) return { ok: true, status: 'expired', match_id: null, position: 0 };
    const pos = await sql.query(
      `SELECT COUNT(*) AS n FROM mm_tickets o WHERE o.status = 'queued' AND o.game = $1 AND o.mode = $2
       AND o.region = $3 AND o.enqueued_at < $4`,
      [t.game, t.mode, t.region, t.enqueued_at]
    );
    return { ok: true, status: 'queued', position: Number(pos.rows[0]?.n ?? 0) + 1, match_id: null, expires_at: t.expires_at };
  }
  return { ok: true, status: t.status, match_id: t.match_id ?? null, position: 0 };
}

// mm_salir (migra 23)
async function mmSalir(sql: Sql, ticket: string, sub: string): Promise<Fila> {
  const r = await sql.query(`SELECT status, sub FROM mm_tickets WHERE ticket = $1`, [ticket]);
  if (!r.rows.length) return { ok: false, error: 'no_encontrado' };
  if (String(r.rows[0].sub) !== sub) return { ok: false, error: 'ticket_ajeno' };
  if (r.rows[0].status !== 'queued') return { ok: true, removed: false };
  await sql.query(`UPDATE mm_tickets SET status = 'cancelled', updated_at = ${AHORA} WHERE ticket = $1 AND status = 'queued'`, [ticket]);
  return { ok: true, removed: true };
}

// mm_intentar_emparejar (migra 21) — D1: sin FOR UPDATE SKIP LOCKED, el
// Worker es single-flight por isla y la cola es pequeña (uso interno).
async function mmIntentarEmparejar(sql: Sql, game: string, mode: string, region: string): Promise<string | null> {
  const n = MODOS[mode] ?? 2;
  await sql.query(`UPDATE mm_tickets SET status = 'expired', updated_at = ${AHORA} WHERE status = 'queued' AND expires_at < ${AHORA}`, []);
  const cand = await sql.query(
    `SELECT ticket, sub, enqueued_at FROM mm_tickets
     WHERE status = 'queued' AND game = $1 AND mode = $2 AND region = $3 AND expires_at >= ${AHORA}
     ORDER BY enqueued_at LIMIT $4`,
    [game, mode, region, n]
  );
  if (cand.rows.length < n) return null;

  const matchId = crypto.randomUUID();
  const porEquipo = mode === 'team' ? 5 : 1;
  const sentencias: { sql: string; params: unknown[] }[] = [
    { sql: `INSERT INTO mm_matches (id, game, mode, region, status) VALUES ($1, $2, $3, $4, 'propuesto')`,
      params: [matchId, game, mode, region] },
  ];
  cand.rows.forEach((c, i) => {
    const equipo = i < porEquipo ? 1 : 2;
    sentencias.push({ sql: `UPDATE mm_tickets SET status = 'matched', match_id = $3, updated_at = ${AHORA} WHERE ticket = $1 AND sub = $2`,
      params: [c.ticket, c.sub, matchId] });
    sentencias.push({ sql: `INSERT INTO mm_match_players (match_id, sub, team) VALUES ($1, $2, $3)`,
      params: [matchId, c.sub, equipo] });
  });
  await sql.batch(sentencias);
  return matchId;
}

// mm_aplicar_resultado (migra 22) + rr_historial (migra 27)
async function mmAplicarResultado(sql: Sql, matchId: string): Promise<Fila> {
  const m = await sql.query(`SELECT * FROM mm_matches WHERE id = $1`, [matchId]);
  if (!m.rows.length) return { ok: false, error: 'no_encontrado' };
  const match = m.rows[0];
  if (match.status === 'verificado') return { ok: true, ya: true };
  if (match.status !== 'reportado' || match.score_a == null || match.score_b == null) {
    return { ok: false, error: 'estado_invalido' };
  }
  const scoreA = Number(match.score_a);
  const scoreB = Number(match.score_b);

  const jugadores = await sql.query(
    `SELECT mp.sub, mp.team, p.id AS player_id, p.rating
     FROM mm_match_players mp LEFT JOIN players p ON p.auth0_sub = mp.sub
     WHERE mp.match_id = $1 ORDER BY mp.team, mp.sub`,
    [matchId]
  );

  const temporada = await temporadaActual(sql);
  let aplicados = 0;
  let omitidos = 0;

  for (const reg of jugadores.rows) {
    const playerId = reg.player_id as string | null;
    if (!playerId) { omitidos++; continue; }

    const equipo = Number(reg.team);
    const resultado = equipo === 1
      ? (scoreA > scoreB ? 'win' : scoreA < scoreB ? 'loss' : 'draw')
      : (scoreB > scoreA ? 'win' : scoreB < scoreA ? 'loss' : 'draw');

    const rAntes = Number(reg.rating ?? 0.95);
    const delta = resultado === 'win' ? 0.015 : resultado === 'draw' ? 0.002 : -0.012;
    const rDesp = Math.max(0.50, Math.min(1.60, rAntes + delta));

    await sql.query(`UPDATE players SET rating = $2, updated_at = ${AHORA} WHERE id = $1`, [playerId, rDesp]);
    await sql.query(
      `UPDATE mm_match_players SET rr_before = $3, rr_after = $4 WHERE match_id = $1 AND sub = $2`,
      [matchId, reg.sub, redondeo100(rAntes), redondeo100(rDesp)]
    );
    await statsDelta(sql, playerId, resultado, rDesp);
    await sql.query(
      `INSERT INTO rr_historial (player_id, motivo, fuente, partida_id, temporada, game, mode, region, rr_before, rr_after)
       VALUES ($1, 'mm_match', 'mm', $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (player_id, fuente, partida_id) DO NOTHING`,
      [playerId, matchId, temporada, match.game, match.mode, match.region, redondeo100(rAntes), redondeo100(rDesp)]
    ).catch(() => {});
    aplicados++;
  }

  await sql.query(
    `UPDATE mm_matches SET status = 'verificado', verify_source = 'auto', verify_payload = $2, updated_at = ${AHORA} WHERE id = $1`,
    [matchId, JSON.stringify({
      aplicados, omitidos,
      regla: 'win +0.015 / draw +0.002 / loss -0.012, clamp [0.50,1.60]',
      at: new Date().toISOString(),
    })]
  );
  return { ok: true, aplicados, omitidos };
}

// mm_reportar (migra 23)
async function mmReportar(sql: Sql, matchId: string, sub: string, a: number, b: number): Promise<Fila> {
  const m = await sql.query(`SELECT status FROM mm_matches WHERE id = $1`, [matchId]);
  if (!m.rows.length) return { ok: false, error: 'no_encontrado' };
  if (m.rows[0].status !== 'propuesto') return { ok: false, error: 'ya_reportado' };

  const participa = await sql.query(
    `SELECT 1 AS x FROM mm_match_players WHERE match_id = $1 AND sub = $2 LIMIT 1`,
    [matchId, sub]
  );
  if (!participa.rows.length) return { ok: false, error: 'no_participante' };

  await sql.query(
    `UPDATE mm_matches SET status = 'reportado', score_a = $2, score_b = $3, report_sub = $4,
     report_at = ${AHORA}, updated_at = ${AHORA} WHERE id = $1 AND status = 'propuesto'`,
    [matchId, a, b, sub]
  );
  const res = await mmAplicarResultado(sql, matchId);
  return { ok: true, verificado: res.ok === true ? 'true' : 'false', rr: res };
}

// mm_invitar (migra 24)
async function mmInvitar(sql: Sql, fromSub: string, toEmail: string, game: string, mode: string, region: string): Promise<Fila> {
  if (!game || !game.trim()) return { ok: false, error: 'game_requerido' };
  if (!(mode in MODOS)) return { ok: false, error: 'mode_invalido' };
  const email = (toEmail || '').trim();
  if (!email || email.indexOf('@') < 1) return { ok: false, error: 'email_invalido' };

  const yo = await sql.query(`SELECT id, display_name, username FROM players WHERE auth0_sub = $1 LIMIT 1`, [fromSub]);
  if (!yo.rows.length) return { ok: false, error: 'no_elegible' };

  const destino = await sql.query(
    `SELECT auth0_sub FROM players WHERE lower(email) = lower($1) AND auth0_sub IS NOT NULL LIMIT 1`,
    [email]
  );
  if (!destino.rows.length) return { ok: false, error: 'destino_no_encontrado' };
  const toSub = String(destino.rows[0].auth0_sub);
  if (toSub === fromSub) return { ok: false, error: 'destino_es_tu_email' };

  await sql.query(`UPDATE mm_invites SET status = 'expirada', updated_at = ${AHORA} WHERE status = 'pendiente' AND expires_at < ${AHORA}`, []);

  const ya = await sql.query(
    `SELECT id FROM mm_invites WHERE from_sub = $1 AND to_sub = $2 AND game = $3 AND status = 'pendiente' LIMIT 1`,
    [fromSub, toSub, game.trim()]
  );
  if (ya.rows.length) return { ok: true, reutilizada: true, id: ya.rows[0].id };

  const p = yo.rows[0];
  const nombre = String(p.display_name || p.username || 'jugador');
  const id = crypto.randomUUID();
  await sql.query(
    `INSERT INTO mm_invites (id, from_sub, from_name, to_sub, game, mode, region, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente')`,
    [id, fromSub, nombre, toSub, game.trim(), mode, (region || '').trim() || 'EU']
  );
  const fila = await sql.query(`SELECT expires_at FROM mm_invites WHERE id = $1`, [id]);
  return { ok: true, reutilizada: false, id, to_sub: toSub, expires_at: fila.rows[0]?.expires_at ?? null };
}

// mm_invites_pendientes (migra 24)
async function mmInvitesPendientes(sql: Sql, sub: string, limite: number): Promise<Fila> {
  await sql.query(`UPDATE mm_invites SET status = 'expirada', updated_at = ${AHORA} WHERE status = 'pendiente' AND expires_at < ${AHORA}`, []);
  const lim = Math.max(1, Math.min(limite || 20, 50));
  const recibidas = await sql.query(
    `SELECT id, from_name AS from_nombre, game, mode, region, created_at, expires_at
     FROM mm_invites WHERE to_sub = $1 AND status = 'pendiente' AND expires_at >= ${AHORA}
     ORDER BY created_at DESC LIMIT $2`,
    [sub, lim]
  );
  const enviadas = await sql.query(
    `SELECT id, to_sub, game, mode, region, status, created_at, expires_at
     FROM mm_invites WHERE from_sub = $1 AND status IN ('pendiente','aceptada')
     AND created_at > datetime('now', '-1 hour')
     ORDER BY created_at DESC LIMIT $2`,
    [sub, lim]
  );
  return { ok: true, recibidas: recibidas.rows, enviadas: enviadas.rows };
}

// mm_responder_invite (migra 24); aceptar = encolarme con sus parámetros
async function mmResponderInvite(sql: Sql, id: string, aceptar: boolean, sub: string): Promise<Fila> {
  const inv = await sql.query(`SELECT * FROM mm_invites WHERE id = $1`, [id]);
  if (!inv.rows.length) return { ok: false, error: 'no_encontrado' };
  const i = inv.rows[0];

  if (String(i.to_sub) === sub) {
    if (i.status !== 'pendiente' || new Date(String(i.expires_at)).getTime() < Date.now()) {
      await sql.query(`UPDATE mm_invites SET status = 'expirada', updated_at = ${AHORA} WHERE id = $1 AND status = 'pendiente'`, [id]);
      return { ok: false, error: 'ya_no_vigente' };
    }
    if (!aceptar) {
      await sql.query(`UPDATE mm_invites SET status = 'rechazada', updated_at = ${AHORA} WHERE id = $1`, [id]);
      return { ok: true, status: 'rechazada' };
    }
    await sql.query(`UPDATE mm_invites SET status = 'aceptada', updated_at = ${AHORA} WHERE id = $1`, [id]);
    const cola = await mmEncolar(sql, sub, String(i.game), String(i.mode), String(i.region), 600);
    return { ok: true, status: 'aceptada', game: i.game, mode: i.mode, region: i.region, cola };
  }
  if (String(i.from_sub) === sub) {
    if (aceptar) return { ok: false, error: 'solo_el_destino_acepta' };
    if (i.status !== 'pendiente') return { ok: false, error: 'ya_no_pendiente' };
    await sql.query(`UPDATE mm_invites SET status = 'cancelada', updated_at = ${AHORA} WHERE id = $1`, [id]);
    return { ok: true, status: 'cancelada' };
  }
  return { ok: false, error: 'no_te_concierna' };
}

// ── Auth0 RS256 sin dependencias ────────────────────────────────────────────
let jwksCache: { at: number; claves: Fila[] } | null = null;

function b64urlJson(part: string): Fila | null {
  try { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Fila; } catch { return null; }
}

async function jwks(f: typeof fetch, dominio: string): Promise<Fila[]> {
  if (jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.claves;
  const r = await f(`https://${dominio}/.well-known/jwks.json`, { signal: AbortSignal.timeout(8000) });
  const j = (await r.json().catch(() => null)) as { keys?: Fila[] } | null;
  if (!j || !Array.isArray(j.keys)) throw new Error('jwks_invalido');
  jwksCache = { at: Date.now(), claves: j.keys };
  return j.keys;
}

async function validarJwt(authHeader: string | null, dep: Dependencias): Promise<{ sub: string } | null> {
  const dominio = String(dep.env.AUTH0_DOMAIN || 'vants.eu.auth0.com').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const audience = String(dep.env.AUTH0_AUDIENCE || 'https://api.vants.app');
  if (!authHeader || !/^bearer /i.test(authHeader)) return null;
  const token = authHeader.replace(/^bearer /i, '').trim();
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const cab = b64urlJson(partes[0]);
  const cuerpo = b64urlJson(partes[1]);
  if (!cab || !cuerpo || cab.alg !== 'RS256') return null;
  const ahora = Math.floor(Date.now() / 1000);
  if (typeof cuerpo.exp !== 'number' || cuerpo.exp + LEEWAY_SEG < ahora) return null;
  if (cuerpo.iss !== `https://${dominio}/`) return null;
  const aud = cuerpo.aud;
  const audOk = typeof aud === 'string' ? aud === audience : Array.isArray(aud) ? (aud as string[]).includes(audience) : false;
  if (!audOk) return null;
  if (typeof cuerpo.sub !== 'string' || !cuerpo.sub) return null;
  try {
    const claves = await jwks(dep.fetch, dominio);
    const jwk = claves.find((k) => k.kid === cab.kid) || (claves.length === 1 ? claves[0] : null);
    if (!jwk || jwk.kty !== 'RSA') return null;
    const key = createPublicKey({ key: jwk as never, format: 'jwk' });
    const ok = cryptoVerify('RSA-SHA256', Buffer.from(`${partes[0]}.${partes[1]}`), key, Buffer.from(partes[2], 'base64url'));
    if (!ok) return null;
  } catch {
    return null;
  }
  return { sub: cuerpo.sub };
}

// ── Handler ─────────────────────────────────────────────────────────────────
export function construir(sobre: Partial<Dependencias> = {}) {
  const env = sobre.env ?? (process.env as Record<string, string | undefined>);
  const f: typeof fetch = sobre.fetch ?? fetch;

  return async function handler(req: Request, envReq?: Record<string, unknown>): Promise<Response> {
    const db = (envReq && envReq.DB) || env.DB;
    const sql: Sql | null = db ? (sobre.sql ?? crearSql(db as unknown as D1Database)) : (sobre.sql ?? null);
    const dep: Dependencias = { env, sql, fetch: f };

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let url: URL;
    try { url = new URL(req.url); } catch { return err('url_invalida', 400); }
    const ruta = url.pathname.replace(/\/+$/, '') || '/';
    const q = url.searchParams;

    if (req.method === 'GET' && (ruta === '/' || ruta === '/salud')) {
      return json({
        ok: true,
        fn: 'mm',
        config: {
          auth0: String(env.AUTH0_DOMAIN || 'vants.eu.auth0.com'),
          audience: String(env.AUTH0_AUDIENCE || 'https://api.vants.app'),
          jwt: 'RS256 + JWKS (verificación en el Worker, sin GUC)',
          base_datos: 'D1 vants-db · procedimientos 21/22/23/24/27 portados a JS (mm_encolar, mm_ticket_estado, mm_salir, mm_reportar, mm_aplicar_resultado, mm_invitar, mm_responder_invite; vistas mm_historial y rr_historial_jugador)',
        },
        endpoints: ['POST /encolar', 'GET /estado?ticket=', 'POST /salir', 'POST /reportar', 'GET /historial', 'GET /rr', 'POST /invitar', 'GET /invites', 'POST /invites/responder', 'GET /salud'],
      });
    }

    if (!sql) return err('d1_no_configurado: falta el binding DB', 500);

    // ── Autenticación (todos los endpoints de juego) ──
    const sesion = await validarJwt(req.headers.get('authorization'), dep);
    if (!sesion) return err('unauthorized: Bearer JWT de Auth0 requerido', 401);
    const sub = sesion.sub;

    // ── Cola ──
    if (ruta === '/encolar' && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as Fila;
      const game = String(body.game ?? '').trim();
      const mode = String(body.mode ?? 'duo').trim();
      const region = String(body.region ?? 'EU').trim() || 'EU';
      const ttlMin = Number(body.ttl_min ?? 10);
      if (!game) return err('game_requerido', 400);
      if (!(mode in MODOS)) return err('mode_invalido (duo | team)', 400);
      const ttlSeg = Math.round(Number.isFinite(ttlMin) ? ttlMin * 60 : TICKET_TTL_MS / 1000);

      const enc = await mmEncolar(sql, sub, game, mode, region, ttlSeg);
      if (enc.ok !== true) return respuestaSql(enc, () => json({ ok: true }));

      // emparejamiento inmediato (si falta gente queda en cola)
      let matchId: string | null = null;
      try { matchId = await mmIntentarEmparejar(sql, game, mode, region); } catch { /* el ticket sigue en cola */ }

      const e = await mmTicketEstado(sql, String(enc.ticket), sub);
      return json({
        ok: true,
        data: {
          ticket: enc.ticket,
          reutilizado: !!enc.reutilizado,
          game, mode, region,
          position: Number(e?.position) || 0,
          ttl_ms: TICKET_TTL_MS,
          expires_at: enc.expires_at ?? null,
          match_id: matchId || (e && e.status === 'matched' ? e.match_id : null) || null,
        },
      }, enc.reutilizado ? 200 : 201);
    }

    if (ruta === '/estado' && req.method === 'GET') {
      const ticket = String(q.get('ticket') ?? '');
      if (!ticket) return err('ticket requerido (?ticket=MM-…)', 400);
      const res = await mmTicketEstado(sql, ticket, sub);
      return respuestaSql(res, (x) => json({
        ok: true,
        data: { ticket, status: x.status, position: Number(x.position) || 0, match_id: x.match_id ?? null, expires_at: x.expires_at ?? null },
      }));
    }

    if (ruta === '/salir' && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as Fila;
      const ticket = String(body.ticket ?? '');
      if (!ticket) return err('ticket requerido', 400);
      const res = await mmSalir(sql, ticket, sub);
      return respuestaSql(res, (x) => json({ ok: true, data: { removed: x.removed ? ticket : null } }));
    }

    // ── Partidas ──
    if (ruta === '/reportar' && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as Fila;
      const matchId = String(body.match_id ?? '');
      const a = Number(body.score_a); const b = Number(body.score_b);
      if (!matchId) return err('match_id requerido', 400);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a + b === 0) {
        return err('score_invalido: enteros >= 0 y no 0-0', 400);
      }
      const res = await mmReportar(sql, matchId, sub, a, b);
      return respuestaSql(res, (x) => json({
        ok: true,
        data: { match_id: matchId, status: x.verificado === 'true' ? 'verificado' : 'reportado', score_a: a, score_b: b, rr: x.rr ?? null },
      }));
    }

    // ── Historiales ──
    if (ruta === '/historial' && req.method === 'GET') {
      const limite = Math.max(1, Math.min(parseInt(q.get('limite') || '50', 10) || 50, 100));
      const r = await sql.query(`SELECT * FROM mm_historial WHERE sub = $1 ORDER BY played_at DESC LIMIT $2`, [sub, limite]);
      return json({ ok: true, data: r.rows });
    }

    if (ruta === '/rr' && req.method === 'GET') {
      const limite = Math.max(1, Math.min(parseInt(q.get('limite') || '50', 10) || 50, 100));
      const r = await sql.query(
        `SELECT h.* FROM rr_historial_jugador h JOIN players p ON p.id = h.player_id WHERE p.auth0_sub = $1 ORDER BY h.fecha DESC LIMIT $2`,
        [sub, limite]
      );
      return json({ ok: true, data: r.rows });
    }

    // ── Invitaciones ──
    if (ruta === '/invitar' && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as Fila;
      const res = await mmInvitar(sql, sub, String(body.to_email ?? ''), String(body.game ?? ''), String(body.mode ?? 'duo'), String(body.region ?? 'EU'));
      return respuestaSql(res, (x) => json({ ok: true, data: { id: x.id, reutilizada: !!x.reutilizada, status: x.status ?? 'pendiente', expires_at: x.expires_at ?? null } }));
    }

    if (ruta === '/invites' && req.method === 'GET') {
      const limite = Math.max(1, Math.min(parseInt(q.get('limite') || '20', 10) || 20, 50));
      const res = await mmInvitesPendientes(sql, sub, limite);
      return respuestaSql(res, (x) => json({ ok: true, data: { recibidas: x.recibidas ?? [], enviadas: x.enviadas ?? [] } }));
    }

    if (ruta === '/invites/responder' && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as Fila;
      const id = String(body.id ?? '');
      const aceptar = body.aceptar === true || body.aceptar === 'true';
      if (!id) return err('id requerido', 400);
      const res = await mmResponderInvite(sql, id, aceptar, sub);
      return respuestaSql(res, (x) => json({ ok: true, data: x }));
    }

    return err('ruta_no_encontrada', 404);
  };
}

export default construir();
