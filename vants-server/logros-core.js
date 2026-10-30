/* ============================================================
   VANTS · logros-core.js — VANTS ACHIEVEMENTS & BADGE ENGINE
   ------------------------------------------------------------
   Lógica PURA del motor de logros (sin D1, sin fetch, sin DOM):
   idempotencia, reglas, evidencia, progreso, backoff del outbox
   y validación de cuerpos (equivalente Zod, sin dependencias).
   · La importa el worker (vants-server/worker.js vía logros-motor.js)
     y la suite de pruebas (scripts/test_logros.js) → UNA sola fuente
     de verdad.
   · Identidad canónica: sub de Auth0 (DECISIONS.md §D1).
   · PRINCIPIO FUNDAMENTAL: los logros se conceden por hechos
     verificables, nunca por datos enviados desde el navegador.
   ============================================================ */

/* ---------------- CATÁLOGO (espejo de la migración 0001) ---------------- */

export const INSIGNIAS = [
  { code: 'MEMBER',      nombre: 'MEMBER',      categoria: 'membership',  rareza: 'common',    color: '#8b93a7', tipo: 'auto_registry' },
  { code: 'PLUS',        nombre: 'PLUS',        categoria: 'membership',  rareza: 'rare',      color: '#2f7bff', tipo: 'subscription' },
  { code: 'PRO',         nombre: 'PRO',         categoria: 'membership',  rareza: 'epic',      color: '#ff0d2e', tipo: 'subscription' },
  { code: 'ELITE',       nombre: 'ELITE',       categoria: 'membership',  rareza: 'legendary', color: '#f5c044', tipo: 'subscription' },
  { code: 'CREATOR',     nombre: 'CREATOR',     categoria: 'membership',  rareza: 'epic',      color: '#b44cff', tipo: 'admin' },
  { code: 'PARTNER',     nombre: 'PARTNER',     categoria: 'membership',  rareza: 'legendary', color: '#c9d6e8', tipo: 'admin' },
  { code: 'CHAMPION',    nombre: 'CHAMPION',    categoria: 'competitive', rareza: 'legendary', color: '#f5c044', tipo: 'automatic_rule' },
  { code: 'TOP 10',      nombre: 'TOP 10',      categoria: 'competitive', rareza: 'epic',      color: '#ff0d2e', tipo: 'automatic_rule' },
  { code: 'RISING STAR', nombre: 'RISING STAR', categoria: 'competitive', rareza: 'rare',      color: '#2f7bff', tipo: 'automatic_rule' },
  { code: 'VETERAN',     nombre: 'VETERAN',     categoria: 'competitive', rareza: 'rare',      color: '#b4794a', tipo: 'automatic_rule' },
  { code: 'FOUNDER',     nombre: 'FOUNDER',     categoria: 'identity',    rareza: 'mythic',    color: '#f5c044', tipo: 'founder_list' },
  { code: 'VERIFIED',    nombre: 'VERIFIED',    categoria: 'identity',    rareza: 'rare',      color: '#2f7bff', tipo: 'admin' },
];

export const EVENTOS = {
  TORNEO_COMPLETADO: 'tournament.completed',
  PARTIDO_FINAL:     'match.finished',
  TEMPORADA_CERRADA: 'ranking.season.finalized',
  MEMBRESIA_ACTIVA:  'membership.activated',
  MEMBRESIA_VENCIDA: 'membership.expired',
  LOGRO_CONCEDIDO:   'achievement.granted',
  LOGRO_REVOCADO:    'achievement.revoked',
  CUENTA_REGISTRADA: 'identity.verified',
};

/* ---------------- IDEMPOTENCIA Y HASHES (crypto.subtle) ---------------- */

async function sha256Hex(texto) {
  const datos = new TextEncoder().encode(String(texto));
  const digesto = await crypto.subtle.digest('SHA-256', datos);
  return [...new Uint8Array(digesto)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Clave de idempotencia de una concesión: un mismo evento entregado
 * diez veces produce UNA sola concesión por (usuario, insignia, evento, período).
 * period='' para logros permanentes; 'T2026S1' p. ej. para insignias de temporada.
 */
export function claveIdempotencia(userId, badgeCode, eventId, period = '') {
  return sha256Hex([userId || '', badgeCode || '', eventId || '', period || ''].join('|'));
}

/** Hash canónico del payload (detección de cambios entre reintentos). */
export function hashPayload(payload) {
  return sha256Hex(JSON.stringify(payload ?? null));
}

/** ID estable de evento de outbox (dedupe antes de tocar el inbox). */
export function idEvento(tipo, partes) {
  return sha256Hex(tipo + '::' + (Array.isArray(partes) ? partes.join('::') : String(partes || ''))).slice(0, 40);
}

/* ---------------- REGLA CHAMPION (evidencia verificada) ---------------- */

/**
 * Evalúa CHAMPION con el hecho REAL (leído del espejo, nunca del payload).
 * match      = fila de tournament_matches (ronda 'f', estado 'final', ganador)
 * torneo     = fila de pt_torneos (estado 'finished', oficial: is_demo=0)
 * plantilla  = filas de tournament_teams del equipo ganador CON auth0_sub
 * Devuelve { concede, candidatos, evidencia, motivo } — la concesión real la
 * aplica el motor con su idempotencia; aquí solo se decide y se documenta.
 */
export function evaluarChampion(match, torneo, plantilla) {
  const evidencia = {
    match_id: match && match.id ? String(match.id) : null,
    tournament_id: torneo && torneo.id ? String(torneo.id) : null,
    tournament_nombre: torneo && torneo.nombre ? String(torneo.nombre) : null,
    ganador: match && match.ganador ? String(match.ganador) : null,
    score: match && match.score_a != null && match.score_b != null
      ? [Number(match.score_a), Number(match.score_b)] : null,
    finalizado_en: match && match.updated_at ? String(match.updated_at) : null,
  };
  if (!match || !torneo) return { concede: false, motivo: 'hecho_incompleto', candidatos: [], evidencia };
  if (match.ronda !== 'f' || match.estado !== 'final' || !match.ganador) {
    return { concede: false, motivo: 'sin_ganador_confirmado', candidatos: [], evidencia };
  }
  // Torneo OFICIAL: no demo. Un torneo anulado/cancelado NUNCA concede.
  if (Number(torneo.is_demo) === 1) return { concede: false, motivo: 'torneo_demo', candidatos: [], evidencia };
  if (torneo.estado !== 'finished') return { concede: false, motivo: 'torneo_no_finalizado', candidatos: [], evidencia };
  // El ganador del hecho debe ser el equipo identificado de la final.
  const ganaA = match.ganador === match.team_a;
  const ganaB = match.ganador === match.team_b;
  if (!ganaA && !ganaB) return { concede: false, motivo: 'ganador_ajeno', candidatos: [], evidencia };
  const idEquipoGanador = ganaA ? match.team_a : match.team_b;
  // Solo jugadores elegibles de la plantilla ganadora CON cuenta verificada (sub):
  // no cualquier inscrito, no espectadores, no el equipo perdedor.
  const subSet = new Set();
  const filas = Array.isArray(plantilla) ? plantilla : [];
  for (const f of filas) {
    if (!f) continue;
    if (f.id !== idEquipoGanador && f.id) continue; // plantilla del ganador únicamente
    const sub = f.auth0_sub && String(f.auth0_sub).trim();
    if (sub) subSet.add(sub);
  }
  if (!subSet.size) return { concede: false, motivo: 'plantilla_sin_cuentas', candidatos: [], evidencia };
  evidencia.equipo_ganador = idEquipoGanador;
  evidencia.plantilla_concesion = [...subSet].sort();
  return { concede: true, motivo: 'final_oficial_ganada', candidatos: [...subSet].sort(), evidencia };
}

/* ---------------- REGLA VETERAN (umbral configurable) ---------------- */

export const VETERAN_UMBRAL_DEFECTO = 5;

/** Progreso de VETERAN: participaciones verificadas ≠ anuladas. */
export function evaluarVeteran(torneosCompletados, umbral) {
  const u = Number.isFinite(Number(umbral)) && Number(umbral) > 0 ? Math.floor(Number(umbral)) : VETERAN_UMBRAL_DEFECTO;
  const n = Math.max(0, Math.floor(Number(torneosCompletados) || 0));
  return {
    actual: n,
    objetivo: u,
    porcentaje: Math.min(100, Math.round((n / u) * 100)),
    concede: n >= u,
  };
}

/* ---------------- PROGRESO GENÉRICO ---------------- */

export function avanceProgreso(actual, objetivo) {
  const a = Math.max(0, Number(actual) || 0);
  const o = Math.max(1, Number(objetivo) || 1);
  return Math.min(100, Math.round((a / o) * 100));
}

/* ---------------- OUTBOX: backoff y ciclo de vida ---------------- */

export const OUTBOX_MAX_INTENTOS = 10;
const BACKOFF_SEG = [60, 300, 1800, 7200, 21600, 86400]; // 1m 5m 30m 2h 6h 24h

/** Próximo reintento con backoff exponencial; null = agotado (va a 'error'/DLQ). */
export function proximoReintento(intentos, ahoraMs) {
  const i = Math.max(0, Number(intentos) || 0);
  if (i >= OUTBOX_MAX_INTENTOS) return null;
  const seg = BACKOFF_SEG[Math.min(i, BACKOFF_SEG.length - 1)];
  return new Date((Number(ahoraMs) || Date.now()) + seg * 1000).toISOString();
}

/** ¿Toca procesar una fila del outbox? */
export function listaParaProcesar(fila, ahoraMs) {
  if (!fila) return false;
  if (fila.status !== 'pending') return false;
  const prox = fila.next_retry_at ? Date.parse(fila.next_retry_at) : 0;
  return !Number.isFinite(prox) || prox <= (Number(ahoraMs) || Date.now());
}

/* ---------------- INSIGNIAS DESTACADAS (máximo 3) ---------------- */

export const MAX_DESTACADAS = 3;

/** Valida la selección de destacadas: códigos del catálogo, sin repetir, ≤ 3. */
export function validarDestacadas(codigos, catalogo) {
  const activos = new Set((catalogo || []).map((b) => b.code));
  const lista = Array.isArray(codigos) ? codigos.map((c) => String(c || '').trim()).filter(Boolean) : [];
  if (lista.length > MAX_DESTACADAS) {
    return { ok: false, error: 'maximo_3', detalle: 'Máximo ' + MAX_DESTACADAS + ' insignias destacadas' };
  }
  const vistos = new Set();
  for (const c of lista) {
    if (vistos.has(c)) return { ok: false, error: 'repetida', detalle: c };
    vistos.add(c);
    if (!activos.has(c)) return { ok: false, error: 'codigo_desconocido', detalle: c };
  }
  return { ok: true, codes: lista };
}

/* ---------------- VALIDACIÓN DE CUERPOS (equivalente Zod) ---------------- */

const SUB_RE = /^[a-zA-Z0-9_|-]{6,64}$/; // sub de Auth0: auth0|…, google-oauth2|…, discord|…

export function validarSub(v) {
  const s = String(v == null ? '' : v).trim();
  return SUB_RE.test(s) ? s : null;
}

export function validarCodigoInsignia(v, catalogo) {
  const c = String(v == null ? '' : v).trim();
  if (!c) return null;
  const activos = new Set((catalogo || []).map((b) => b.code));
  return activos.has(c) ? c : null;
}

/** POST admin/grant → { ok, user_id, code, justification } | { ok:false, error } */
export function validarGrant(cuerpo, catalogo) {
  const b = cuerpo || {};
  const user_id = validarSub(b.user_id);
  if (!user_id) return { ok: false, error: 'user_id_invalido' };
  const code = validarCodigoInsignia(b.code, catalogo);
  if (!code) return { ok: false, error: 'code_invalido' };
  const justification = String(b.justification || '').trim();
  if (justification.length < 8 || justification.length > 500) {
    return { ok: false, error: 'justification_requerida', detalle: '8 a 500 caracteres' };
  }
  return { ok: true, user_id, code, justification };
}

/** POST admin/revoke → { ok, award_id| (user_id+code), reason } | { ok:false } */
export function validarRevoke(cuerpo) {
  const b = cuerpo || {};
  const reason = String(b.reason || '').trim();
  if (reason.length < 8 || reason.length > 500) {
    return { ok: false, error: 'reason_requerida', detalle: '8 a 500 caracteres' };
  }
  const awardId = String(b.award_id || '').trim();
  if (/^[0-9a-f-]{8,64}$/i.test(awardId)) return { ok: true, award_id: awardId, reason };
  const user_id = validarSub(b.user_id);
  const code = String(b.code || '').trim();
  if (user_id && code) return { ok: true, user_id, code, reason };
  return { ok: false, error: 'objetivo_requerido', detalle: 'award_id o (user_id+code)' };
}

/** POST admin/rules → regla nueva | PATCH rules/:id → parche */
export function validarRegla(cuerpo, catalogo, parche) {
  const b = cuerpo || {};
  const tipos = ['event', 'threshold', 'admin', 'subscription', 'founder_list', 'dormant'];
  const fuera = {};
  if (!parche) {
    const code = validarCodigoInsignia(b.badge_code, catalogo);
    if (!code) return { ok: false, error: 'badge_code_invalido' };
    fuera.badge_code = code;
    if (!tipos.includes(String(b.rule_type || ''))) return { ok: false, error: 'rule_type_invalido' };
    fuera.rule_type = b.rule_type;
  } else if (b.rule_type !== undefined && !tipos.includes(String(b.rule_type || ''))) {
    return { ok: false, error: 'rule_type_invalido' };
  }
  if (b.conditions_json !== undefined) {
    const texto = typeof b.conditions_json === 'string' ? b.conditions_json : JSON.stringify(b.conditions_json);
    if (texto.length > 4000) return { ok: false, error: 'conditions_demasiado_largo' };
    try { JSON.parse(texto || '{}'); } catch (e) { return { ok: false, error: 'conditions_json_invalido' }; }
    fuera.conditions_json = texto || '{}';
  }
  if (b.is_active !== undefined) fuera.is_active = b.is_active ? 1 : 0;
  if (b.source_event !== undefined) {
    const se = String(b.source_event || '').trim();
    if (se && !/^[a-z][a-z0-9_.]{2,64}$/.test(se)) return { ok: false, error: 'source_event_invalido' };
    fuera.source_event = se || null;
  }
  if (b.valid_until !== undefined) {
    const vu = String(b.valid_until || '').trim();
    if (vu && !/^\d{4}-\d{2}-\d{2}T/.test(vu)) return { ok: false, error: 'valid_until_invalido' };
    fuera.valid_until = vu || null;
  }
  return { ok: true, campos: fuera };
}

/** POST ingest → { ok, event_id, type, payload } | { ok:false, error } */
export function validarIngest(cuerpo) {
  const b = cuerpo || {};
  const type = String(b.type || '').trim();
  if (!/^[a-z][a-z0-9_.]{2,64}$/.test(type)) return { ok: false, error: 'type_invalido' };
  const eventId = String(b.event_id || '').trim();
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(eventId)) return { ok: false, error: 'event_id_invalido' };
  if (b.payload !== undefined && b.payload !== null && typeof b.payload !== 'object') {
    return { ok: false, error: 'payload_invalido' };
  }
  if (JSON.stringify(b.payload || {}).length > 8192) return { ok: false, error: 'payload_demasiado_grande' };
  return { ok: true, type, event_id: eventId, payload: b.payload || {} };
}

/* ---------------- FIRMA HMAC (mismo contrato que VANTS-BUS) ---------------- */

/**
 * Verifica X-VANTS-Signature = hex(hmac_sha256(SECRET, `${ts}.${rawBody}`))
 * con ventana anti-replay de ±5 minutos. Devuelve true | false.
 */
export async function verificarFirma(secret, rawBody, ts, firmaRecibida) {
  if (!secret || !ts || !firmaRecibida) return false;
  const t = Number(ts);
  if (!Number.isFinite(t)) return false;
  const ahora = Date.now() / 1000;
  if (Math.abs(ahora - t) > 300) return false; // anti-replay
  const clave = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(ts + '.' + String(rawBody)));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const a = new Uint8Array(hex.length / 2);
  const b2 = new Uint8Array(String(firmaRecibida).length / 2);
  if (a.length !== b2.length) return false;
  for (let i = 0; i < a.length; i++) {
    a[i] = parseInt(hex.substr(i * 2, 2), 16);
    b2[i] = parseInt(String(firmaRecibida).substr(i * 2, 2), 16);
  }
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a[i] ^ b2[i];
  return dif === 0; // comparación en tiempo constante
}

/* ---------------- PROYECCIONES PÚBLICAS (sin PII) ---------------- */

export function insigniaPublica(b) {
  if (!b) return null;
  const base = String(b.code || '').toLowerCase().replace(/\s+/g, '-');
  const v = Number(b.image_version) || 1;
  return {
    code: b.code,
    name: b.name,
    description: b.description || '',
    requirement: b.requirement || '',
    category: b.category || 'competitive',
    rarity: b.rarity || 'common',
    color: b.color || '#0a0a0c',
    image: { master: '/assets/badges/' + base + '/1024.png?v=' + v, webp: '/assets/badges/' + base + '/256.webp?v=' + v, version: v },
  };
}

/** Concesión pública: jamás filtra sub completo, solo el shape necesario. */
export function concesionPublica(a, badge) {
  if (!a || !badge) return null;
  return {
    badge: insigniaPublica(badge),
    status: a.status || 'active',
    awarded_at: a.awarded_at || null,
    featured_order: a.featured_order || null,
    evidence: resumenEvidencia(a.evidence_json),
  };
}

/** Resumen de evidencia apto para público (sin ids internos sensibles). */
export function resumenEvidencia(evidenceJson) {
  let e = evidenceJson;
  try { e = typeof evidenceJson === 'string' ? JSON.parse(evidenceJson || '{}') : (evidenceJson || {}); } catch (err) { e = {}; }
  const r = {};
  if (e.tournament_nombre) r.torneo = String(e.tournament_nombre).slice(0, 80);
  if (e.score) r.marcador = e.score;
  if (e.finalizado_en) r.fecha = String(e.finalizado_en).slice(0, 10);
  if (e.tipo) r.tipo = String(e.tipo).slice(0, 40);
  return r;
}

export default {
  INSIGNIAS, EVENTOS,
  claveIdempotencia, hashPayload, idEvento,
  evaluarChampion, evaluarVeteran, avanceProgreso,
  OUTBOX_MAX_INTENTOS, proximoReintento, listaParaProcesar,
  MAX_DESTACADAS, validarDestacadas,
  validarSub, validarCodigoInsignia, validarGrant, validarRevoke, validarRegla, validarIngest,
  verificarFirma,
  insigniaPublica, concesionPublica, resumenEvidencia,
};
