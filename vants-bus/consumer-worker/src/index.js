/* ============================================================
 * vants-consumer-playvants · Consumidor del VANTS-BUS para la web
 *
 * Worker INDEPENDIENTE: no toca el código de playvants-web ni su
 * despliegue. Corre por cron (cada minuto), consume el bus con la
 * identidad playvants-web (cursor persistente EN el bus, tabla
 * vants_consumers) y copia los eventos a vants_feed en Neon, donde
 * la web ya puede leerlos con su conexión existente.
 *
 * Secrets:
 *   DATABASE_URL        cadena Neon (rol authenticator)
 *   VANTS_BUS_SECRET    secreto HMAC de playvants-web
 * Vars:
 *   VANTS_BUS_URL       https://vants-bus.vants.workers.dev
 *   FEED_RETENTION_DAYS retención del feed (7 por defecto)
 * ============================================================ */

import { neon } from '@neondatabase/serverless';

let _busUrl = '';
const MAX_PAGINAS = 10;

async function cabeceras(secret, body) {
  // firma idéntica al bus: hex(hmac_sha256(SECRET, `${ts}.${body}`))
  const ts = Math.floor(Date.now() / 1000).toString();
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'vants-consumer-playvants/1.0',
    'X-VANTS-Project': 'playvants-web',
    'X-VANTS-Timestamp': ts,
    'X-VANTS-Signature': await firmar(secret, ts + '.' + body),
  };
}

async function firmar(secret, mensaje) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(mensaje));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function leerBus(secret, query) {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(_busUrl + '/events?' + qs, { headers: await cabeceras(secret, '') });
  const text = await res.text();
  if (!res.ok) throw new Error(`bus ${res.status}: ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

async function consumirUnaVuelta(env) {
  const sql = neon(env.DATABASE_URL);
  let total = 0;
  let paginas = 0;

  // El cursor se DERIVA del propio feed (max(id)): si un INSERT falla,
  // la próxima vuelta relee los mismos eventos (INSERT ... ON CONFLICT
  // DO NOTHING lo hace idempotente). Cero pérdida aunque Neon falle.
  // Primera vuelta: feed vacío → histórico completo (llenar el feed).
  let since = '';
  try {
    const filas = await sql.query(`SELECT max(id) AS maxid FROM vants_feed`);
    since = (filas && filas[0] && filas[0].maxid) || '';
  } catch (e) { /* tabla aún no creada → histórico */ }

  while (paginas < MAX_PAGINAS) {
    paginas++;
    const res = await leerBus(env.VANTS_BUS_SECRET, { since, limit: 200 });

    const eventos = res.events || [];
    for (const ev of eventos) {
      await sql.query(
        `INSERT INTO vants_feed (id, type, source, ts, data)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [ev.id, ev.type, ev.source, ev.ts, JSON.stringify(ev.data ?? {})]
      );
    }
    total += eventos.length;

    if (!res.hasMore || eventos.length === 0) break;
    since = res.cursor || since;
  }

  // Retención del feed
  const dias = Number(env.FEED_RETENTION_DAYS || 7);
  await sql.query(`DELETE FROM vants_feed WHERE consumed_at < now() - make_interval(days => $1)`, [dias]);

  return total;
}

export default {
  async scheduled(event, env, ctx) {
    if (!env.DATABASE_URL || !env.VANTS_BUS_SECRET) {
      console.error('vants-consumer: faltan secrets (DATABASE_URL / VANTS_BUS_SECRET)');
      return;
    }
    _busUrl = (env.VANTS_BUS_URL || '').replace(/\/+$/, '');
    if (!_busUrl) { console.error('vants-consumer: falta VANTS_BUS_URL'); return; }
    console.log('vants-consumer: vuelta de cron iniciada');
    try {
      const total = await consumirUnaVuelta(env);
      console.log(`vants-consumer: ${total} eventos al feed`);
    } catch (e) {
      console.error('vants-consumer:', e && e.message);
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      const ok = Boolean(env.DATABASE_URL && env.VANTS_BUS_SECRET);
      let ultimo = null;
      if (ok) {
        try {
          const filas = await neon(env.DATABASE_URL).query(
            `SELECT id, type, source, ts FROM vants_feed ORDER BY consumed_at DESC LIMIT 1`
          );
          ultimo = filas && filas[0] ? filas[0] : null;
        } catch (e) { ultimo = { error: e.message }; }
      }
      return new Response(JSON.stringify({ ok, service: 'vants-consumer-playvants', ultimo }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  },
};
