#!/usr/bin/env node
/* VANTS · monitor portable — objetivo rsc-harness: detectar errores y avisar.
   Checks críticos definidos por repo; exit 1 si alguno falla (el workflow abre/actualiza incidente). */
const CHECKS = [
  {
    "id": "web",
    "label": "Web VANTS",
    "url": "https://vants.vants.workers.dev/",
    "markers": [
      "VANTS GAMES"
    ]
  },
  {
    "id": "health",
    "label": "API health",
    "url": "https://vants.vants.workers.dev/api/health",
    "markers": [
      "\"ok\":true"
    ]
  }
];
const TIMEOUT = 15000;

async function httpCheck(c) {
  const t0 = Date.now();
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT);
    const r = await fetch(c.url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VANTS-Monitor/1.0; +https://vants.vants.workers.dev)' },
    });
    clearTimeout(t);
    const ms = Date.now() - t0;
    const body = (await r.text().catch(() => '')).slice(0, 20000);
    const statusOk = c.expect === 'any' ? r.status < 500 : (r.status >= 200 && r.status < 400);
    const faltan = (c.markers || []).filter((m) => !body.includes(m));
    const ok = statusOk && faltan.length === 0;
    return { ok, status: r.status, ms, detalle: ok ? '' : faltan.length ? 'faltan marcadores: ' + faltan.join(', ') : 'HTTP ' + r.status };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, detalle: String((e && e.message) || e).slice(0, 120) };
  }
}

(async () => {
  const fallos = [];
  for (const c of CHECKS) {
    const r = await httpCheck(c);
    console.log((r.ok ? 'OK  ' : 'FALLA ') + (c.label || c.id) + '  ' + c.url + '  ->  ' + r.status + '  ' + r.ms + 'ms' + (r.ok ? '' : '  :: ' + r.detalle));
    if (!r.ok) fallos.push(c.label || c.id);
  }
  if (fallos.length) {
    console.error('[ALERT] DOWN — falla: ' + fallos.join('; '));
    process.exit(1);
  }
  console.log('[OK] todos los checks críticos pasan (' + CHECKS.length + ')');
})();
