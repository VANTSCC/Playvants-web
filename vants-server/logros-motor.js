/* ============================================================
   VANTS · logros-motor.js — VANTS ACHIEVEMENTS & BADGE ENGINE
   ------------------------------------------------------------
   Capa de ejecución del motor sobre Cloudflare D1:
   · Endpoints API (públicos, autenticados y admin) con las mismas
     convenciones de seguridad del worker (rate-limit, origen,
     sesión Auth0, rol owner).
   · Pump del Transactional Outbox: cron (scheduled) + endpoint
     firmado HMAC. El motor NUNCA confía en el payload: relee el
     hecho real del espejo D1 (binding DB) antes de conceder.
   · Degradación honesta: si falta el binding ACH_DB (p. ej. el
     worker de producción), toda la API responde 503 logros_no_config
     y el resto del worker sigue funcionando igual.
   Importa SOLO lógica pura de ./logros-core.js (testeable).
   ============================================================ */

import LOG from './logros-core.js';

/* ==================== ESTADO ==================== */

export function configurado(env) {
  return !!(env && env.ACH_DB);
}

function noConfig(H, origen) {
  return H.json({ ok: false, error: 'logros_no_config' }, 503, { 'Access-Control-Allow-Origin': origen || '*' });
}

function rid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function ahoraISO() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/* ==================== CATÁLOGO ==================== */

async function catalogo(db, { soloActivos = true } = {}) {
  const q = soloActivos
    ? 'SELECT * FROM badge_definitions WHERE is_active = 1 ORDER BY display_order, code'
    : 'SELECT * FROM badge_definitions ORDER BY display_order, code';
  const r = await db.prepare(q).all();
  return (r && r.results) || [];
}

async function badgePorCodigo(db, code) {
  const r = await db.prepare('SELECT * FROM badge_definitions WHERE code = ?1 LIMIT 1').bind(code).first();
  return r || null;
}

/* ==================== CONCESIÓN / REVOCACIÓN ==================== */

/**
 * Concede una insignia de forma idempotente. Devuelve
 * { concedida: boolean, award, motivo }.
 * · concedida=false + motivo='duplicada' cuando la clave de idempotencia ya existe.
 */
export async function conceder(db, { userId, badge, eventId, evidence, ruleVersion, seasonId, period = '', actor = 'engine', justification = null }) {
  const clave = await LOG.claveIdempotencia(userId, badge.code, eventId, period);
  const id = rid();
  const evidencia = JSON.stringify(evidence || { tipo: 'sin_detalle' });
  await db.prepare(
    'INSERT INTO user_badge_awards (id, user_id, badge_id, season_id, status, evidence_json, source_event_id, rule_version, idempotency_key) ' +
    'VALUES (?1, ?2, ?3, ?4, \'active\', ?5, ?6, ?7, ?8) ON CONFLICT(idempotency_key) DO NOTHING',
  ).bind(id, userId, badge.id, seasonId || null, evidencia, eventId || null, ruleVersion || null, clave).run();
  const fila = await db.prepare('SELECT * FROM user_badge_awards WHERE idempotency_key = ?1').bind(clave).first();
  if (!fila) return { concedida: false, award: null, motivo: 'error_insert' };
  if (fila.id !== id) return { concedida: false, award: fila, motivo: 'duplicada' };
  await db.prepare(
    'INSERT INTO achievement_progress (id, user_id, badge_id, current_value, target_value, progress_percent, status, last_evaluated_at, updated_at) ' +
    'VALUES (?1, ?2, ?3, 1, 1, 100, \'completed\', ?4, ?4) ON CONFLICT(user_id, badge_id) DO UPDATE SET current_value = 1, progress_percent = 100, status = \'completed\', last_evaluated_at = ?4, updated_at = ?4',
  ).bind(rid(), userId, badge.id, ahoraISO()).run();
  await auditar(db, { actor, action: 'grant', targetId: fila.id, justification, detail: { code: badge.code, eventId, ruleVersion } });
  await encolar(db, {
    type: LOG.EVENTOS.LOGRO_CONCEDIDO,
    eventId: 'grant-' + fila.id,
    payload: { userId, code: badge.code, awardedAt: fila.awarded_at, evidence: evidencia.slice(0, 400) },
  });
  return { concedida: true, award: fila, motivo: 'nueva' };
}

/** Revoca conservando historial (nunca DELETE) + auditoría + evento al bus. */
export async function revocar(db, { award, reason, actor }) {
  await db.prepare(
    'UPDATE user_badge_awards SET status = \'revoked\', revoked_at = ?1, revoked_reason = ?2 WHERE id = ?3 AND status <> \'revoked\'',
  ).bind(ahoraISO(), String(reason).slice(0, 500), award.id).run();
  const badge = await db.prepare('SELECT * FROM badge_definitions WHERE id = ?1').bind(award.badge_id).first();
  await auditar(db, { actor, action: 'revoke', targetId: award.id, justification: reason, detail: { code: badge && badge.code } });
  await encolar(db, {
    type: LOG.EVENTOS.LOGRO_REVOCADO,
    eventId: 'revoke-' + award.id + '-' + Date.now().toString(36),
    payload: { userId: award.user_id, code: badge ? badge.code : null, reason: String(reason).slice(0, 200) },
  });
  return true;
}

async function auditar(db, { actor, action, targetType = 'award', targetId, justification, detail }) {
  await db.prepare(
    'INSERT INTO ach_audit_log (id, actor, action, target_type, target_id, justification, detail_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
  ).bind(rid(), String(actor || 'engine').slice(0, 80), String(action).slice(0, 60), targetType, targetId || null,
    justification ? String(justification).slice(0, 500) : null, JSON.stringify(detail || {})).run();
}

/* ==================== OUTBOX / INBOX ==================== */

/** Escribe un evento en el outbox (idempotente por event_id). */
export async function encolar(db, { type, eventId, payload }) {
  await db.prepare(
    'INSERT INTO achievement_outbox (id, event_id, event_type, payload_json, status, next_retry_at) ' +
    'VALUES (?1, ?2, ?3, ?4, \'pending\', ?5) ON CONFLICT(event_id) DO NOTHING',
  ).bind(rid(), eventId, type, JSON.stringify(payload || {}), ahoraISO()).run();
}

async function aInbox(db, evento, payloadHash) {
  await db.prepare(
    'INSERT INTO achievement_event_inbox (id, external_event_id, source, event_type, payload_hash) ' +
    'VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(external_event_id) DO NOTHING',
  ).bind(rid(), evento.event_id, 'vants-web', evento.event_type, payloadHash).run();
  const fila = await db.prepare('SELECT * FROM achievement_event_inbox WHERE external_event_id = ?1').bind(evento.event_id).first();
  return { yaConocido: fila && fila.processing_status === 'processed', inboxId: fila ? fila.id : null };
}

/**
 * Pump: mueve outbox → inbox → reglas → concesiones.
 * notify(type, data) publica achievement.granted/revoked al VANTS-BUS si está
 * configurado (opcional; la concesión NO depende del bus).
 * Devuelve { procesados, concedidos, errores }.
 */
export async function pumpOutbox(env, ctx, notify) {
  if (!configurado(env)) return { saltado: 'logros_no_config' };
  const db = env.ACH_DB;
  const ahora = Date.now();
  const pend = await db.prepare(
    'SELECT * FROM achievement_outbox WHERE status = \'pending\' AND (next_retry_at IS NULL OR next_retry_at <= ?1) ORDER BY created_at LIMIT 10',
  ).bind(ahoraISO()).all();
  const filas = (pend && pend.results) || [];
  const resumen = { procesados: 0, concedidos: 0, errores: 0 };
  for (const ev of filas) {
    let payload = {};
    try { payload = JSON.parse(ev.payload_json || '{}'); } catch (e) { payload = {}; }
    const hash = await LOG.hashPayload(ev.payload_json);
    const { yaConocido, inboxId } = await aInbox(db, ev, hash);
    try {
      if (!yaConocido) {
        await db.prepare('UPDATE achievement_event_inbox SET processing_status = \'processing\', attempts = ?1 WHERE id = ?2').bind(Number(ev.attempts) || 0, inboxId).run();
        const r = await procesarEvento(env, ev, payload, notify);
        resumen.concedidos += r.concedidos || 0;
        await db.prepare(
          'UPDATE achievement_event_inbox SET processing_status = \'processed\', processed_at = ?1, error_message = ?2 WHERE id = ?3',
        ).bind(ahoraISO(), r.nota ? String(r.nota).slice(0, 300) : null, inboxId).run();
      }
      await db.prepare('UPDATE achievement_outbox SET status = \'done\', published_at = ?1 WHERE id = ?2').bind(ahoraISO(), ev.id).run();
      resumen.procesados++;
    } catch (err) {
      const intentos = (Number(ev.attempts) || 0) + 1;
      const prox = LOG.proximoReintento(intentos, Date.now());
      if (prox) {
        await db.prepare('UPDATE achievement_outbox SET attempts = ?1, next_retry_at = ?2, status = \'pending\' WHERE id = ?3').bind(intentos, prox, ev.id).run();
        if (inboxId) await db.prepare('UPDATE achievement_event_inbox SET attempts = ?1, processing_status = \'pending\', error_message = ?2 WHERE id = ?3')
          .bind(intentos, String((err && err.message) || err).slice(0, 300), inboxId).run();
      } else {
        // DLQ funcional: agotado → 'error', visible y reprocesable desde admin
        await db.prepare('UPDATE achievement_outbox SET status = \'error\', attempts = ?1 WHERE id = ?2').bind(intentos, ev.id).run();
        if (inboxId) await db.prepare('UPDATE achievement_event_inbox SET processing_status = \'failed\', attempts = ?1, error_message = ?2 WHERE id = ?3')
          .bind(intentos, String((err && err.message) || err).slice(0, 300), inboxId).run();
      }
      resumen.errores++;
    }
  }
  return resumen;
}

/* ============ DESPACHO DE EVENTOS (evidencia desde el espejo) ============ */

async function procesarEvento(env, ev, payload, notify) {
  const db = env.ACH_DB;
  const espejo = env.DB; // espejo de LECTURA de datos competitivos (NUNCA se escribe)
  const nota = [];
  let concedidos = 0;

  if (ev.event_type === LOG.EVENTOS.PARTIDO_FINAL) {
    if (!espejo) return { concedidos: 0, nota: 'sin_espejo_pendiente' };
    const matchId = String(payload.matchId || '');
    if (!matchId) return { concedidos: 0, nota: 'evento_sin_match_id' };
    // 1) Relee el hecho REAL del espejo (el payload solo sugiere dónde mirar).
    const m = await espejo.prepare('SELECT * FROM tournament_matches WHERE id = ?1').bind(matchId).first();
    if (!m) return { concedidos: 0, nota: 'espejo_sin_partido_reintenta' }; // lanza → reintento con backoff
    const torneo = await espejo.prepare('SELECT * FROM pt_torneos WHERE id = ?1').bind(m.tournament_id).first();
    if (!torneo) return { concedidos: 0, nota: 'espejo_sin_torneo_reintenta' };
    // 2) CHAMPION: final oficial ganada.
    const plantilla = m.ganador
      ? await espejo.prepare('SELECT * FROM tournament_teams WHERE tournament_id = ?1').bind(m.tournament_id).all().then((r) => r.results || [])
      : [];
    const evalCh = LOG.evaluarChampion(m, torneo, plantilla);
    if (evalCh.concede) {
      const badge = await badgePorCodigo(db, 'CHAMPION');
      const regla = await db.prepare('SELECT * FROM achievement_rules WHERE badge_id = ?1 AND is_active = 1 ORDER BY version DESC LIMIT 1').bind(badge.id).first();
      for (const sub of evalCh.candidatos) {
        const r = await conceder(db, {
          userId: sub, badge, eventId: ev.event_id,
          evidence: evalCh.evidencia, ruleVersion: regla ? regla.version : null,
          seasonId: null, period: '',
        });
        if (r.concedida) concedidos++;
      }
    } else nota.push('champion:' + evalCh.motivo);
    // 3) VETERAN: progreso por participante elegible de AMBAS plantillas con sub.
    const reglaVet = await db.prepare(
      'SELECT r.* FROM achievement_rules r JOIN badge_definitions b ON b.id = r.badge_id WHERE b.code = \'VETERAN\' AND r.is_active = 1 ORDER BY r.version DESC LIMIT 1',
    ).first();
    if (reglaVet) {
      const conds = JSON.parse(reglaVet.conditions_json || '{}');
      const subs = new Set();
      for (const f of plantilla) if (f && f.auth0_sub) subs.add(String(f.auth0_sub));
      for (const sub of subs) {
        const n = await contarTorneosCompletados(espejo, sub);
        const v = LOG.evaluarVeteran(n, conds.threshold);
        await db.prepare(
          'INSERT INTO achievement_progress (id, user_id, badge_id, current_value, target_value, progress_percent, status, last_evaluated_at, updated_at) ' +
          'VALUES (?1, ?2, (SELECT id FROM badge_definitions WHERE code = \'VETERAN\'), ?3, ?4, ?5, ?6, ?7, ?7) ' +
          'ON CONFLICT(user_id, badge_id) DO UPDATE SET current_value = ?3, target_value = ?4, progress_percent = ?5, status = ?6, last_evaluated_at = ?7, updated_at = ?7',
        ).bind(rid(), sub, v.actual, v.objetivo, v.porcentaje, v.concede ? 'completed' : 'in_progress', ahoraISO()).run();
        if (v.concede) {
          const badgeV = await badgePorCodigo(db, 'VETERAN');
          const r = await conceder(db, {
            userId: sub, badge: badgeV, eventId: 'veteran-lifetime',
            evidence: { tipo: 'participaciones_verificadas', total: v.actual },
            ruleVersion: reglaVet.version, period: 'alltime',
          });
          if (r.concedida) concedidos++;
        }
      }
    }
    return { concedidos, nota: nota.join(';') || null };
  }

  if (ev.event_type === LOG.EVENTOS.CUENTA_REGISTRADA) {
    // MEMBER por registro completado (cuenta con sesión verificada).
    const sub = LOG.validarSub(payload.userId);
    if (!sub) return { concedidos: 0, nota: 'sub_invalido' };
    const badge = await badgePorCodigo(db, 'MEMBER');
    if (!badge) return { concedidos: 0, nota: 'sin_badge' };
    const r = await conceder(db, {
      userId: sub, badge, eventId: 'registro-v1',
      evidence: { tipo: 'registro_automatico' }, period: '',
    });
    return { concedidos: r.concedida ? 1 : 0, nota: r.concedida ? null : 'duplicada' };
  }

  if (ev.event_type === LOG.EVENTOS.MEMBRESIA_ACTIVA || ev.event_type === LOG.EVENTOS.MEMBRESIA_VENCIDA) {
    // Los derechos de suscripción SOLO existen si la base los registra con un
    // proveedor real (provider != 'none'). Sin pagos configurados no se finge nada.
    const sub = LOG.validarSub(payload.userId);
    if (!sub) return { concedidos: 0, nota: 'sub_invalido' };
    const ent = await db.prepare('SELECT * FROM membership_entitlements WHERE user_id = ?1 AND tier = ?2').bind(sub, String(payload.tier || '')).first();
    const badge = payload.tier ? await badgePorCodigo(db, String(payload.tier).toUpperCase()) : null;
    if (!badge) return { concedidos: 0, nota: 'tier_sin_badge' };
    if (!ent || ent.provider === 'none' || ent.status !== 'active') {
      const activa = await db.prepare(
        'SELECT * FROM user_badge_awards WHERE user_id = ?1 AND badge_id = ?2 AND status = \'active\'',
      ).bind(sub, badge.id).first();
      if (activa) { await revocar(db, { award: activa, reason: 'entitlement_inactivo', actor: 'engine' }); }
      return { concedidos: 0, nota: 'sin_entitlement_activo' };
    }
    const r = await conceder(db, {
      userId: sub, badge, eventId: 'membresia-' + ent.tier + '-' + (ent.provider_ref || ent.id),
      evidence: { tipo: 'suscripcion', provider: ent.provider, valid_until: ent.valid_until },
      period: ent.valid_until ? String(ent.valid_until).slice(0, 10) : '',
    });
    return { concedidos: r.concedida ? 1 : 0 };
  }

  if (ev.event_type === LOG.EVENTOS.TEMPORADA_CERRADA) {
    // TOP 10: regla dormida hasta que administración congele una temporada oficial.
    const regla = await db.prepare(
      'SELECT r.* FROM achievement_rules r JOIN badge_definitions b ON b.id = r.badge_id WHERE b.code = \'TOP 10\' AND r.is_active = 1 LIMIT 1',
    ).first();
    if (!regla) return { concedidos: 0, nota: 'regla_top10_inactiva' };
    return { concedidos: 0, nota: 'top10_requiere_clasificacion_congelada' };
  }

  // Otros eventos: registrados y cerrados sin efecto (compatibilidad de contrato).
  // achievement.granted / achievement.revoked: notificación → VANTS-BUS (Discord
  // u otros consumidores deciden qué hacer). Si el bus no está configurado,
  // publicarBus ya es un no-op y el evento queda procesado igual.
  if (ev.event_type === LOG.EVENTOS.LOGRO_CONCEDIDO || ev.event_type === LOG.EVENTOS.LOGRO_REVOCADO) {
    if (typeof notify === 'function') {
      try { notify(ev.event_type, payload); } catch (e) { /* el bus nunca rompe el motor */ }
    }
    return { concedidos: 0, nota: 'notificado_al_bus' };
  }
  return { concedidos: 0, nota: 'tipo_sin_regla' };
}

async function contarTorneosCompletados(espejo, sub) {
  const r = await espejo.prepare(
    'SELECT COUNT(DISTINCT t.id) AS n FROM tournament_teams tt ' +
    'JOIN pt_torneos t ON t.id = tt.tournament_id ' +
    'WHERE tt.auth0_sub = ?1 AND tt.status = \'confirmado\' AND t.estado = \'finished\' AND COALESCE(t.is_demo, 0) = 0',
  ).bind(sub).first();
  return r ? Number(r.n) || 0 : 0;
}

/* ==================== API ==================== */

/**
 * Punto de entrada de las rutas /api/... del motor. Devuelve Response o null
 * (ruta no gestionada → el worker sigue con sus demás rutas).
 * H = { json, rateLimit, bucket, LIMIT, origenOk, sesionDe, esOwner, publicarBus, ip }
 */
export async function manejar(request, env, ctx, H) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const p = url.pathname;
  const esRuta = p === '/api/badges' ||
    /^\/api\/players\/[^/]+\/badges$/.test(p) ||
    p === '/api/me/badges' || p === '/api/me/achievements' || p === '/api/me/badges/featured' ||
    p === '/api/achievements/ingest' || p === '/api/achievements/pump' ||
    p === '/api/admin/achievements' || p === '/api/admin/achievements/rules' ||
    /^\/api\/admin\/achievements\/rules\/[^/]+$/.test(p) ||
    /^\/api\/admin\/achievements\/badges\/[^/]+$/.test(p) ||
    p === '/api/admin/achievements/grant' || p === '/api/admin/achievements/revoke' ||
    p === '/api/admin/achievements/reconcile' || p === '/api/admin/achievements/events';
  if (!esRuta) return null;

  const origin = request.headers.get('origin') || '';
  const ACAO = { 'Access-Control-Allow-Origin': H.origenOk(origin) ? origin : '*' };
  // ingest y pump son llamadas SERVIDOR-A-SERVIDOR (VANTS-BUS / cron): sin
  // Origin de navegador; su autenticación es la firma HMAC del contrato bus.
  const esMaquina = p === '/api/achievements/ingest' || p === '/api/achievements/pump';
  if (!esMaquina && !H.origenOk(origin) && method !== 'GET') {
    return H.json({ ok: false, error: 'Origen no permitido' }, 403, ACAO);
  }
  const rl = H.rateLimit(H.bucket, H.ip, H.LIMIT);
  if (!rl.ok) return H.json({ ok: false, error: 'Demasiadas peticiones' }, 429, { ...ACAO, 'Retry-After': String(rl.retry) });
  if (!configurado(env)) return noConfig(H, origin);

  try {
    /* ---------- PÚBLICO ---------- */
    if (p === '/api/badges' && method === 'GET') {
      const cat = await catalogo(env.ACH_DB);
      return H.json({ ok: true, badges: cat.map(LOG.insigniaPublica) }, 200, { ...ACAO, 'Cache-Control': 'public, max-age=60' });
    }

    if (/^\/api\/players\/[^/]+\/badges$/.test(p) && method === 'GET') {
      const sub = LOG.validarSub(decodeURIComponent(p.split('/')[3] || ''));
      if (!sub) return H.json({ ok: false, error: 'jugador_invalido' }, 400, ACAO);
      const filas = await env.ACH_DB.prepare(
        'SELECT a.*, b.code, b.name, b.description, b.requirement, b.category, b.rarity, b.color, b.image_version ' +
        'FROM user_badge_awards a JOIN badge_definitions b ON b.id = a.badge_id ' +
        'WHERE a.user_id = ?1 AND a.status = \'active\' AND b.is_active = 1 ORDER BY a.featured_order IS NULL, a.featured_order, a.awarded_at',
      ).bind(sub).all();
      const todas = (filas && filas.results) || [];
      return H.json({
        ok: true,
        featured: todas.filter((a) => a.featured_order).slice(0, 3).map((a) => LOG.concesionPublica(a, a)),
        badges: todas.map((a) => LOG.concesionPublica(a, a)),
      }, 200, { ...ACAO, 'Cache-Control': 'public, max-age=30' });
    }

    /* ---------- AUTENTICADO (/api/me/*) ---------- */
    if (p === '/api/me/badges' || p === '/api/me/achievements' || p === '/api/me/badges/featured') {
      const ses = await H.sesionDe(request);
      if (!ses || !ses.sub) return H.json({ ok: false, error: 'sin_sesion' }, 401, ACAO);
      const sub = LOG.validarSub(ses.sub);
      if (!sub) return H.json({ ok: false, error: 'sub_invalido' }, 401, ACAO);

      // MEMBER por registro: primera interacción autenticada con el motor.
      const badgeMember = await badgePorCodigo(env.ACH_DB, 'MEMBER');
      if (badgeMember) {
        await conceder(env.ACH_DB, {
          userId: sub, badge: badgeMember, eventId: 'registro-v1',
          evidence: { tipo: 'registro_automatico' }, period: '',
        }).catch(() => null);
      }

      if (method === 'GET' && p === '/api/me/badges') {
        const filas = await env.ACH_DB.prepare(
          'SELECT a.*, b.code, b.name, b.description, b.requirement, b.category, b.rarity, b.color, b.image_version, b.display_order ' +
          'FROM user_badge_awards a JOIN badge_definitions b ON b.id = a.badge_id ' +
          'WHERE a.user_id = ?1 ORDER BY b.display_order, a.awarded_at',
        ).bind(sub).all();
        const mis = (filas && filas.results) || [];
        const progreso = await env.ACH_DB.prepare(
          'SELECT p.*, b.code FROM achievement_progress p JOIN badge_definitions b ON b.id = p.badge_id WHERE p.user_id = ?1',
        ).bind(sub).all();
        const cat = await catalogo(env.ACH_DB);
        const conseguidos = new Set(mis.filter((a) => a.status === 'active').map((a) => a.code));
        return H.json({
          ok: true,
          badges: mis.map((a) => LOG.concesionPublica(a, a)),
          destacadas: mis.filter((a) => a.featured_order && a.status === 'active').slice(0, 3).map((a) => LOG.concesionPublica(a, a)),
          progreso: ((progreso && progreso.results) || []).map((x) => ({ code: x.code, current: x.current_value, target: x.target_value, percent: x.progress_percent, status: x.status })),
          bloqueadas: cat.filter((b) => !conseguidos.has(b.code)).map((b) => ({ ...LOG.insigniaPublica(b), locked: true })),
        }, 200, ACAO);
      }

      if (method === 'GET' && p === '/api/me/achievements') {
        const filas = await env.ACH_DB.prepare(
          'SELECT a.status, a.awarded_at, a.revoked_at, b.code FROM user_badge_awards a JOIN badge_definitions b ON b.id = a.badge_id WHERE a.user_id = ?1 ORDER BY a.awarded_at DESC LIMIT 100',
        ).bind(sub).all();
        return H.json({ ok: true, historial: (filas && filas.results) || [] }, 200, ACAO);
      }

      if (method === 'POST' && p === '/api/me/badges/featured') {
        const cuerpo = await request.json().catch(() => ({}));
        const cat = await catalogo(env.ACH_DB);
        const v = LOG.validarDestacadas(cuerpo.featured, cat);
        if (!v.ok) return H.json({ ok: false, error: v.error, detalle: v.detalle }, 400, ACAO);
        const db = env.ACH_DB;
        await db.prepare('UPDATE user_badge_awards SET featured_order = NULL WHERE user_id = ?1').bind(sub).run();
        let orden = 1;
        for (const code of v.codes) {
          const b = cat.find((x) => x.code === code);
          await db.prepare(
            'UPDATE user_badge_awards SET featured_order = ?1 WHERE user_id = ?2 AND badge_id = ?3 AND status = \'active\'',
          ).bind(orden, sub, b.id).run();
          orden++;
        }
        await auditar(db, { actor: sub, action: 'featured', targetId: sub, detail: { codes: v.codes } });
        return H.json({ ok: true, featured: v.codes }, 200, ACAO);
      }
    }

    /* ---------- INGEST (HMAC, mismo contrato que VANTS-BUS) ---------- */
    if (p === '/api/achievements/ingest' && method === 'POST') {
      const raw = await request.text();
      const ts = request.headers.get('x-vants-ts') || '';
      const sig = request.headers.get('x-vants-signature') || '';
      const ok = await LOG.verificarFirma(env.VANTS_BUS_SECRET, raw, ts, sig);
      if (!ok) return H.json({ ok: false, error: 'firma_invalida' }, 401, ACAO);
      const v = LOG.validarIngest(JSON.parse(raw || '{}'));
      if (!v.ok) return H.json({ ok: false, error: v.error }, 400, ACAO);
      await encolar(env.ACH_DB, { type: v.type, eventId: v.event_id, payload: v.payload });
      return H.json({ ok: true, encolado: v.event_id }, 202, ACAO);
    }

    /* ---------- PUMP (HMAC o owner) ---------- */
    if (p === '/api/achievements/pump' && method === 'POST') {
      const raw = await request.text();
      const ts = request.headers.get('x-vants-ts') || '';
      const sig = request.headers.get('x-vants-signature') || '';
      const firmaOk = await LOG.verificarFirma(env.VANTS_BUS_SECRET, raw, ts, sig);
      if (!firmaOk) {
        const ses = await H.sesionDe(request);
        if (!ses || !ses.sub || !(await H.esOwner(ses.sub, request))) return H.json({ ok: false, error: 'firma_invalida' }, 401, ACAO);
      }
      const resumen = await pumpOutbox(env, ctx, (type, data) => H.publicarBus && H.publicarBus(type, data));
      return H.json({ ok: true, resumen }, 200, ACAO);
    }

    /* ---------- ADMIN (owner) ---------- */
    if (p.startsWith('/api/admin/achievements')) {
      const ses = await H.sesionDe(request);
      if (!ses || !ses.sub) return H.json({ ok: false, error: 'sin_sesion' }, 401, ACAO);
      const esOwner = await H.esOwner(ses.sub, request);
      if (!esOwner) return H.json({ ok: false, error: 'solo_owner' }, 403, ACAO);
      const db = env.ACH_DB;

      if (method === 'GET' && p === '/api/admin/achievements') {
        const cat = await catalogo(db, { soloActivos: false });
        const reglas = await db.prepare(
          'SELECT r.*, b.code FROM achievement_rules r JOIN badge_definitions b ON b.id = r.badge_id ORDER BY b.display_order, r.version DESC',
        ).all();
        const conteos = await db.prepare(
          'SELECT b.code, COUNT(a.id) AS total, SUM(a.status = \'active\') AS activas FROM badge_definitions b LEFT JOIN user_badge_awards a ON a.badge_id = b.id GROUP BY b.id ORDER BY b.display_order',
        ).all();
        const st = await estadoProcesamiento(db);
        return H.json({ ok: true, catalogo: cat, reglas: (reglas && reglas.results) || [], conteos: (conteos && conteos.results) || [], procesamiento: st }, 200, ACAO);
      }

      if (method === 'POST' && p === '/api/admin/achievements/rules') {
        const cuerpo = await request.json().catch(() => ({}));
        const v = LOG.validarRegla(cuerpo, await catalogo(db, { soloActivos: false }), false);
        if (!v.ok) return H.json({ ok: false, error: v.error }, 400, ACAO);
        const badge = await badgePorCodigo(db, v.campos.badge_code);
        const id = rid();
        await db.prepare(
          'INSERT INTO achievement_rules (id, badge_id, version, rule_type, conditions_json, source_event, is_active) VALUES (?1, ?2, (SELECT COALESCE(MAX(version),0)+1 FROM achievement_rules WHERE badge_id = ?2), ?3, ?4, ?5, ?6)',
        ).bind(id, badge.id, cuerpo.rule_type, v.campos.conditions_json || '{}', v.campos.source_event || null, v.campos.is_active === 0 ? 0 : 1).run();
        await auditar(db, { actor: ses.sub, action: 'rule_create', targetType: 'rule', targetId: id, detail: { badge: badge.code } });
        return H.json({ ok: true, id }, 201, ACAO);
      }

      if (method === 'PATCH' && /^\/api\/admin\/achievements\/rules\/[^/]+$/.test(p)) {
        const idRegla = p.split('/').pop();
        const cuerpo = await request.json().catch(() => ({}));
        const v = LOG.validarRegla(cuerpo, null, true);
        if (!v.ok) return H.json({ ok: false, error: v.error }, 400, ACAO);
        const sets = Object.keys(v.campos).map((k, i) => k + ' = ?' + (i + 2)).join(', ');
        if (!sets) return H.json({ ok: false, error: 'nada_que_cambiar' }, 400, ACAO);
        await db.prepare('UPDATE achievement_rules SET ' + sets + ', updated_at = ?1 WHERE id = ?' + (Object.keys(v.campos).length + 2))
          .bind(ahoraISO(), ...Object.values(v.campos), idRegla).run();
        await auditar(db, { actor: ses.sub, action: 'rule_update', targetType: 'rule', targetId: idRegla, detail: v.campos });
        return H.json({ ok: true }, 200, ACAO);
      }

      if (method === 'PATCH' && /^\/api\/admin\/achievements\/badges\/[^/]+$/.test(p)) {
        // Catálogo: activar/desactivar, descripción y orden de presentación.
        const code = decodeURIComponent(p.split('/').pop() || '');
        const badge = await badgePorCodigo(db, code);
        if (!badge) return H.json({ ok: false, error: 'insignia_desconocida' }, 404, ACAO);
        const cuerpo = await request.json().catch(() => ({}));
        const campos = {};
        if (cuerpo.is_active !== undefined) campos.is_active = cuerpo.is_active ? 1 : 0;
        if (cuerpo.description !== undefined) campos.description = String(cuerpo.description).slice(0, 300);
        if (cuerpo.requirement !== undefined) campos.requirement = String(cuerpo.requirement).slice(0, 300);
        if (cuerpo.display_order !== undefined) campos.display_order = Math.max(1, Math.min(999, Math.floor(Number(cuerpo.display_order) || 100)));
        const claves = Object.keys(campos);
        if (!claves.length) return H.json({ ok: false, error: 'nada_que_cambiar' }, 400, ACAO);
        const sets = claves.map((k, i) => k + ' = ?' + (i + 2)).join(', ');
        await db.prepare('UPDATE badge_definitions SET ' + sets + ', updated_at = ?1 WHERE id = ?' + (claves.length + 2))
          .bind(ahoraISO(), ...claves.map((k) => campos[k]), badge.id).run();
        await auditar(db, { actor: ses.sub, action: 'badge_update', targetType: 'badge', targetId: badge.id, detail: campos });
        return H.json({ ok: true }, 200, ACAO);
      }

      if (method === 'POST' && p === '/api/admin/achievements/grant') {
        const cuerpo = await request.json().catch(() => ({}));
        const v = LOG.validarGrant(cuerpo, await catalogo(db));
        if (!v.ok) return H.json({ ok: false, error: v.error, detalle: v.detalle }, 400, ACAO);
        const badge = await badgePorCodigo(db, v.code);
        const r = await conceder(db, {
          userId: v.user_id, badge, eventId: 'manual-' + rid(),
          evidence: { tipo: 'admin_manual', justificacion: v.justification },
          actor: ses.sub, justification: v.justification,
        });
        return H.json({ ok: true, concedida: r.concedida, motivo: r.motivo }, 200, ACAO);
      }

      if (method === 'POST' && p === '/api/admin/achievements/revoke') {
        const cuerpo = await request.json().catch(() => ({}));
        const v = LOG.validarRevoke(cuerpo);
        if (!v.ok) return H.json({ ok: false, error: v.error, detalle: v.detalle }, 400, ACAO);
        let award = null;
        if (v.award_id) award = await db.prepare('SELECT * FROM user_badge_awards WHERE id = ?1').bind(v.award_id).first();
        else if (v.user_id && v.code) {
          const b = await badgePorCodigo(db, v.code);
          award = b ? await db.prepare('SELECT * FROM user_badge_awards WHERE user_id = ?1 AND badge_id = ?2 AND status = \'active\' ORDER BY awarded_at DESC LIMIT 1').bind(v.user_id, b.id).first() : null;
        }
        if (!award) return H.json({ ok: false, error: 'concesion_no_encontrada' }, 404, ACAO);
        await revocar(db, { award, reason: v.reason, actor: ses.sub });
        return H.json({ ok: true, revocada: award.id }, 200, ACAO);
      }

      if (method === 'POST' && p === '/api/admin/achievements/reconcile') {
        const cuerpo = await request.json().catch(() => ({}));
        const reintentarError = cuerpo.reintentar_error !== false;
        // 1) Re-encola eventos en error (DLQ funcional) para reprocesar.
        let reprocesados = 0;
        if (reintentarError) {
          const roto = await db.prepare('UPDATE achievement_outbox SET status = \'pending\', next_retry_at = NULL, attempts = 0 WHERE status = \'error\'').run();
          reprocesados = (roto && roto.meta && roto.meta.changes) || 0;
        }
        // 2) Auto-descubrimiento: finales oficiales sin su evento match.finished.
        let redescubiertos = 0;
        if (env.DB) {
          const finales = await env.DB.prepare(
            'SELECT m.id, m.updated_at FROM tournament_matches m JOIN pt_torneos t ON t.id = m.tournament_id ' +
            'WHERE m.ronda = \'f\' AND m.estado = \'final\' AND m.ganador IS NOT NULL AND t.estado = \'finished\' AND COALESCE(t.is_demo, 0) = 0',
          ).all();
          for (const m of (finales && finales.results) || []) {
            const evId = await LOG.idEvento('match.finished', [m.id]);
            const ya = await db.prepare('SELECT 1 AS x FROM achievement_outbox WHERE event_id = ?1').bind(evId).first();
            if (!ya) {
              await encolar(db, { type: LOG.EVENTOS.PARTIDO_FINAL, eventId: evId, payload: { matchId: m.id, finishedAt: m.updated_at } });
              redescubiertos++;
            }
          }
        }
        await auditar(db, { actor: ses.sub, action: 'reconcile', detail: { reprocesados, redescubiertos } });
        const resumen = await pumpOutbox(env, ctx, (type, data) => H.publicarBus && H.publicarBus(type, data));
        return H.json({ ok: true, reprocesados, redescubiertos, resumen }, 200, ACAO);
      }

      if (method === 'GET' && p === '/api/admin/achievements/events') {
        return H.json({ ok: true, ...(await estadoProcesamiento(db)) }, 200, ACAO);
      }
    }

    return H.json({ ok: false, error: 'metodo_no_permitido' }, 405, { ...ACAO, Allow: 'GET, POST, PATCH' });
  } catch (err) {
    try { console.error(JSON.stringify({ tipo: 'logros_error', ruta: p, message: String((err && err.message) || err).slice(0, 300) })); } catch (e) {}
    return H.json({ ok: false, error: 'motor_error' }, 500, ACAO);
  }
}

async function estadoProcesamiento(db) {
  const out = await db.prepare(
    'SELECT status, COUNT(*) AS n FROM achievement_outbox GROUP BY status',
  ).all();
  const inbox = await db.prepare(
    'SELECT processing_status, COUNT(*) AS n FROM achievement_event_inbox GROUP BY processing_status',
  ).all();
  const dlq = await db.prepare(
    'SELECT id, event_type, attempts, created_at FROM achievement_outbox WHERE status = \'error\' ORDER BY created_at DESC LIMIT 50',
  ).all();
  const ultimos = await db.prepare(
    'SELECT actor, action, target_id, justification, created_at FROM ach_audit_log ORDER BY created_at DESC LIMIT 30',
  ).all();
  return {
    outbox: ((out && out.results) || []),
    inbox: ((inbox && inbox.results) || []),
    dlq: (dlq && dlq.results) || [],
    auditoria: (ultimos && ultimos.results) || [],
  };
}

/* Export ESM (el worker lo importa como default; una sola fuente de verdad) */
export default { configurado, manejar, pumpOutbox, encolar, conceder, revocar };
