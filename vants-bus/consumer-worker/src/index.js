/* ============================================================
 * vants-consumer-playvants · Consumidor del VANTS-BUS para la web
 *
 * Worker INDEPENDIENTE: no toca el código de playvants-web ni su
 * despliegue. Corre por cron (cada minuto), consume el bus con la
 * identidad playvants-web (cursor persistente EN el bus, tabla
 * vants_consumers) y copia los eventos a vants_feed en la base de
 * datos, donde la web ya puede leerlos con su conexión existente.
 *
 * Todo en Cloudflare: la base es la D1 vants-db por binding `DB`
 * (la MISMA base de la web, el bot, el bus y el cuartel del agente).
 * Fuera el driver postgres.js por TCP y el secret DATABASE_URL: D1
 * no necesita conexión (binding interno, cero latencia de red).
 *
 * Binding:
 *   DB                  D1 vants-db (binding interno)
 * Secrets:
 *   VANTS_BUS_SECRET    secreto HMAC de playvants-web
 * Vars:
 *   VANTS_BUS_URL       https://vants-bus.vants.workers.dev
 *   FEED_RETENTION_DAYS retención del feed (7 por defecto)
 * ============================================================ */

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

async function copiarEventos(env) {
  const db = env.DB;
  if (!db) throw new Error('falta el binding D1 (env.DB)');
  let total = 0;
  let paginas = 0;

  // El cursor se DERIVA del propio feed (max(id)): si un INSERT falla,
  // la próxima vuelta relee los mismos eventos (INSERT ... ON CONFLICT
  // DO NOTHING lo hace idempotente). Cero pérdida aunque algo falle.
  // Primera vuelta: feed vacío → histórico completo (llenar el feed).
  let since = '';
  try {
    const fila = await db.prepare(`SELECT max(id) AS maxid FROM vants_feed`).first();
    since = (fila && fila.maxid) || '';
  } catch (e) { /* tabla aún no creada → histórico */ }

  while (paginas < MAX_PAGINAS) {
    paginas++;
    const res = await leerBus(env.VANTS_BUS_SECRET, { since, limit: 200 });

    const eventos = res.events || [];
    if (eventos.length) {
      // batch D1: toda la página en una sola llamada, atómica
      await db.batch(eventos.map((ev) =>
        db.prepare(
          `INSERT INTO vants_feed (id, type, source, ts, data)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (id) DO NOTHING`
        ).bind(ev.id, ev.type, ev.source, ev.ts, JSON.stringify(ev.data ?? {}))
      ));
    }
    total += eventos.length;

    if (!res.hasMore || eventos.length === 0) break;
    since = res.cursor || since;
  }

  // Retención del feed (7 días por defecto); el corte lo calcula SQLite
  // con datetime('now') para comparar SIEMPRE en el formato de la columna.
  const dias = Number(env.FEED_RETENTION_DAYS || 7);
  await db.prepare(`DELETE FROM vants_feed WHERE consumed_at < datetime('now', '-' || ? || ' days')`).bind(String(dias)).run();

  return total;
}

export default {
  async scheduled(event, env, ctx) {
    if (!env.DB || !env.VANTS_BUS_SECRET) {
      console.error('vants-consumer: falta el binding DB (D1) o el secret VANTS_BUS_SECRET');
      return;
    }
    _busUrl = (env.VANTS_BUS_URL || '').replace(/\/+$/, '');
    if (!_busUrl) { console.error('vants-consumer: falta VANTS_BUS_URL'); return; }
    console.log('vants-consumer: vuelta de cron iniciada');
    try {
      const total = await copiarEventos(env);
      console.log(`vants-consumer: ${total} eventos al feed`);
    } catch (e) {
      console.error('vants-consumer:', e && e.message);
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      const ok = Boolean(env.DB && env.VANTS_BUS_SECRET);
      let ultimo = null;
      if (ok) {
        try {
          ultimo = await env.DB.prepare(
            `SELECT id, type, source, ts FROM vants_feed ORDER BY consumed_at DESC LIMIT 1`
          ).first() || null;
        } catch (e) { ultimo = { error: e.message }; }
      }
      return new Response(JSON.stringify({ ok, service: 'vants-consumer-playvants', db: 'Cloudflare D1', ultimo }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  },
};
