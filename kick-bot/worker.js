// vants-kick — Bot de chat para los directos de VANTS GAMES en Kick.
// Flujo: /kick/authorize -> dueño aprueba -> /kick/callback guarda tokens y
// crea la suscripción del webhook -> Kick entrega chat.message.sent en
// /kick/webhook -> el bot responde comandos (!) en el chat.

const BUILTIN = {
  hola: '¡Holaaa {user}! 👋 Bienvenid@ al directo de VANTS GAMES 🎮',
  redes: '🌐 Web VANTS: https://vants.vants.workers.dev · 💜 Membresías PRO/CREATOR: https://vants.vants.workers.dev/membresias · 🎮 ¡Y únete a nuestro Discord!',
  vants: '💜 VANTS GAMES: ranked, torneos con premios y comunidad gamer. Entra en https://vants.vants.workers.dev · membresías PRO/CREATOR con ventajas exclusivas 🚀',
  precio: 'PRO 4,99€/mes · CREATOR 9,99€/mes · PASE único 7,99€ — mira todas las membresías en https://vants.vants.workers.dev/membresias 💜',
  soporte: '¿Problemas con tu compra o cuenta? Escríbenos a vants@agentmail.to y te respondemos rápido 📮',
  reglas: 'Respeto ante todo, nada de spam y a jugar con deportividad 🎮💖',
  bot: 'Soy Bot VANTS 🤖 el asistente del canal. Pregúntame lo que quieras con !ia + tu pregunta, o mira !comandos',
};

const HELP = 'Comandos: !hola !redes !clip !vants !precio !puntos !diario !top !canje !uptime !soporte !reglas · IA: !ia + tu pregunta 🤖';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (req.method === 'GET' && (p === '/' || p === '')) return j({ service: 'vants-kick', ok: true, rutas: ['/kick/authorize', '/kick/callback', '/kick/webhook', '/kick/health', '/kick/subscribe'] });
      if (req.method === 'GET' && p === '/kick/authorize') return await autorizar(env, url);
      if (req.method === 'GET' && p === '/kick/callback') return await callback(req, env, url);
      if (req.method === 'POST' && p === '/kick/webhook') return await webhook(req, env, ctx);
      if (req.method === 'GET' && p === '/kick/health') return await health(env);
      if (p === '/kick/subscribe') return await suscribir(req, env);
      if (req.method === 'GET' && p === '/clipper/queue') return await colaClipper(req, env, url);
      return j({ error: 'no_encontrado' }, 404);
    } catch (e) {
      console.error('ERR', p, e && e.stack || e);
      return j({ error: 'interno', detalle: String(e && e.message || e) }, 500);
    }
  },
};

/* ---------- utilidades ---------- */

function j(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra } });
}

async function kvget(env, k) { const v = await env.KICK.get(k); return v ? JSON.parse(v) : null; }
async function kvput(env, k, v, ttl) { const o = { value: JSON.stringify(v) }; if (ttl) o.expirationTtl = ttl; await env.KICK.put(k, o.value); }

async function tokens(env) { return kvget(env, 'tokens'); }

async function refrescar(env) {
  const t = await tokens(env);
  if (!t || !t.refresh_token) return null;
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: env.KICK_CLIENT_ID, client_secret: env.KICK_CLIENT_SECRET, refresh_token: t.refresh_token });
  const r = await fetch(env.KICK_ID + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) { console.error('refresh fallo', r.status, await r.text()); return null; }
  const d = await r.json();
  const nuevo = { ...t, access_token: d.access_token, refresh_token: d.refresh_token || t.refresh_token, expires_at: Date.now() + (d.expires_in || 9000) * 1000 - 30000 };
  await kvput(env, 'tokens', nuevo);
  return nuevo;
}

async function tokenValido(env) {
  const t = await tokens(env);
  if (!t) return null;
  if (t.expires_at && t.expires_at < Date.now()) return await refrescar(env);
  return t;
}

// repara la identidad si falta (p.ej. si /users falló o cambió de forma durante el callback)
async function asegurarIdentidad(env, t) {
  if (!t || (t.broadcaster_user_id && t.username && t.username !== 'desconocido')) return t;
  try {
    const r = await fetch(env.KICK_API + '/users', { headers: { Authorization: `Bearer ${t.access_token}` } });
    if (!r.ok) return t;
    const u = ((await r.json()).data || [])[0] || {};
    const fijado = {
      ...t,
      broadcaster_user_id: t.broadcaster_user_id || u.user_id || u.id,
      username: (t.username && t.username !== 'desconocido') ? t.username : (u.username || u.name || t.username),
    };
    await kvput(env, 'tokens', fijado);
    return fijado;
  } catch (e) { return t; }
}

async function kick(env, path, opts = {}, intento = 0) {
  const t = await tokenValido(env);
  if (!t) throw new Error('sin_tokens');
  const r = await fetch(env.KICK_API + path, { ...opts, headers: { Authorization: `Bearer ${t.access_token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (r.status === 401 && intento === 0) {
    await refrescar(env);
    return kick(env, path, opts, 1);
  }
  return r;
}

/* ---------- OAuth ---------- */

async function autorizar(env, url) {
  const verifier = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(48)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const state = crypto.randomUUID();
  await kvput(env, 'pkce:' + state, { verifier }, 600);
  const q = new URLSearchParams({
    response_type: 'code', client_id: env.KICK_CLIENT_ID,
    redirect_uri: url.origin + '/kick/callback', scope: env.SCOPES,
    code_challenge: challenge, code_challenge_method: 'S256', state,
  });
  return Response.redirect('https://id.kick.com/oauth/authorize?' + q.toString(), 302);
}

async function callback(req, env, url) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error');
  if (err) return new Response('❌ Autorización rechazada: ' + err, { status: 400 });
  if (!code || !state) return j({ error: 'faltan_code_o_state' }, 400);
  const pk = await kvget(env, 'pkce:' + state);
  if (!pk) return j({ error: 'state_invalido_o_expirado' }, 400);
  await env.KICK.delete('pkce:' + state);

  const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: env.KICK_CLIENT_ID, client_secret: env.KICK_CLIENT_SECRET, redirect_uri: url.origin + '/kick/callback', code_verifier: pk.verifier, code });
  const tr = await fetch(env.KICK_ID + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const td = await tr.json();
  if (!tr.ok || !td.access_token) { console.error('token fallo', tr.status, td); return j({ error: 'exchange_fallido', detalle: td }, 400); }

  const t = { access_token: td.access_token, refresh_token: td.refresh_token, scope: td.scope, expires_at: Date.now() + (td.expires_in || 9000) * 1000 - 30000 };
  await kvput(env, 'tokens', t);

  // quién soy
  const ur = await fetch(env.KICK_API + '/users', { headers: { Authorization: `Bearer ${t.access_token}` } });
  const ud = await ur.json();
  const user = (ud.data && ud.data[0]) || {};
  const broadcaster_user_id = user.user_id || user.id;
  const username = user.username || user.name || 'desconocido';
  await kvput(env, 'tokens', { ...t, broadcaster_user_id, username });

  // suscripción al chat (escucha el canal objetivo: ?canal=, var CANAL_OBJETIVO o la propia cuenta)
  const objetivo = Number(url.searchParams.get('canal')) || Number(env.CANAL_OBJETIVO) || broadcaster_user_id;
  let subs = null;
  try {
    const sr = await fetch(env.KICK_API + '/events/subscriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${t.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ broadcaster_user_id: objetivo, events: [{ name: 'chat.message.sent', version: 1 }], method: 'webhook' }),
    });
    subs = { status: sr.status, body: await sr.json().catch(() => null) };
    await kvput(env, 'subs', subs);
  } catch (e) { subs = { error: String(e) }; await kvput(env, 'subs', subs); }

  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><title>Bot conectado</title>
<body style="font-family:sans-serif;background:#0b0e14;color:#e6e6e6;display:grid;place-items:center;height:100vh">
<div style="text-align:center">
<h1 style="color:#53fc18">✅ Bot de VANTS conectado</h1>
<p>Cuenta: <b>@${username}</b> (id ${broadcaster_user_id})</p>
<p>Suscripción webhook: <b>${subs && subs.status === 200 ? 'creada ✔' : 'revisar /kick/health'}</b></p>
<p>Ya puedes usar <code>!comandos</code> en tu chat. ¡A darle! 🎮</p>
</div></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/* ---------- suscripción manual ---------- */

async function suscribir(req, env) {
  const url = new URL(req.url);
  if (url.searchParams.get('key') !== env.ADMIN_KEY) return j({ error: 'sin_permiso' }, 403);
  let t = await tokenValido(env);
  t = await asegurarIdentidad(env, t);
  if (!t || !t.broadcaster_user_id) return j({ error: 'no_autorizado_aun' }, 400);
  const objetivo = Number(url.searchParams.get('canal')) || Number(env.CANAL_OBJETIVO) || t.broadcaster_user_id;
  const r = await fetch(env.KICK_API + '/events/subscriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${t.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ broadcaster_user_id: objetivo, events: [{ name: 'chat.message.sent', version: 1 }], method: 'webhook' }),
  });
  const d = await r.json().catch(() => null);
  await kvput(env, 'subs', { status: r.status, body: d });
  return j({ status: r.status, respuesta: d });
}

/* ---------- webhook ---------- */

async function webhook(req, env, ctx) {
  const raw = await req.text();
  let evt;
  try { evt = JSON.parse(raw); } catch { return j({ error: 'json_invalido' }, 400); }

  // verificación inicial del webhook (challenge)
  if (evt && evt.challenge) return j({ challenge: evt.challenge });

  const msgId = req.headers.get('Kick-Event-Message-Id') || '';
  const ts = req.headers.get('Kick-Event-Message-Timestamp') || '';
  const sig = req.headers.get('Kick-Event-Signature') || '';
  const tipo = req.headers.get('Kick-Event-Type') || evt.headers?.type || 'desconocido';

  if (sig) {
    const verdicto = await verificarFirma(env, msgId, ts, raw, sig);
    if (verdicto === 'firma_invalida') return j({ error: 'firma_invalida' }, 403);
    // 'infra' (crypto no disponible) -> procesar con aviso, 'ok' -> firma válida
  }

  const stats = (await kvget(env, 'stats')) || { eventos: 0 };
  stats.eventos++;
  stats.ultimo = { tipo, cuando: new Date().toISOString() };
  await kvput(env, 'stats', stats);

  if (tipo !== 'chat.message.sent') return j({ ok: true, ignorado: tipo });
  const m = evt.payload || evt;
  // normaliza v1 (plano) y v2 (anidado)
  const norm = {
    messageId: m.message_id || m.message?.id,
    senderId: m.sender?.user_id,
    senderName: m.sender?.username || '',
    broadcaster: m.broadcaster?.user_id,
    content: (m.content ?? m.message?.content ?? '').trim(),
  };
  return await comando(env, norm, ctx);
}

// Firma de eventos Kick: RSA PKCS1v15 + SHA-256 sobre "msgId.timestamp.body"
async function verificarFirma(env, msgId, ts, raw, sig) {
  try {
    let pk = await kvget(env, 'pubkey');
    if (!pk) {
      const r = await fetch(env.KICK_API + '/public-key');
      if (!r.ok) return 'infra';
      pk = await r.json();
      await kvput(env, 'pubkey', pk, 86400);
    }
    const pem = pk.data?.public_key || pk.public_key || pk.publicKey || '';
    const der = Uint8Array.from(atob(pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('spki', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, true, ['verify']);
    const data = new TextEncoder().encode(`${msgId}.${ts}.${raw}`);
    const firma = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, firma, data);
    return ok ? 'ok' : 'firma_invalida';
  } catch (e) {
    console.error('verificarFirma infra', e);
    return 'infra';
  }
}

/* ---------- comandos ---------- */

async function comando(env, m, ctx) {
  const identidad = await asegurarIdentidad(env, await tokens(env));
  const broadcaster = m.broadcaster || identidad?.broadcaster_user_id;
  const senderId = m.senderId;
  const senderName = m.senderName || '';
  const contenido = m.content || '';
  const messageId = m.messageId;

  // acepta "!" y "¡" (autocorrector español); también "bot, ..." en texto libre
  const esComando = contenido.startsWith('!') || contenido.startsWith('¡');
  const hablaAlBot = !esComando && /^bot[\s,¡!¿?]/i.test(contenido);
  if (!esComando && !hablaAlBot) return j({ ok: true });

  // 1) nunca procesamos nuestros propios mensajes (marcamos con la API el message_id al enviarlos)
  if (messageId && await env.KICK.get('mine:' + messageId)) return j({ ok: true, mio: true });

  // 2) si el día de mañana el bot usa una cuenta dedicada, ignora sus mensajes por remitente
  const botUserId = identidad?.broadcaster_user_id;
  if (botUserId && senderId === botUserId && broadcaster && senderId !== broadcaster) return j({ ok: true, propio: true });

  const esDueno = !!broadcaster && senderId === broadcaster;

  if (hablaAlBot) {
    if (esDueno) return j({ ok: true }); // el dueño usa !ia (el bot habla con su cuenta: evita bucles)
    const pregunta = contenido.replace(/^\s*bot[\s,¡!]+/i, '').trim();
    return await responderIA(env, pregunta, senderId, senderName, messageId, ctx);
  }

  const partes = contenido.slice(1).split(/\s+/);
  const cmd = (partes[0] || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  const args = partes.slice(1).join(' ');

  const stats = (await kvget(env, 'stats')) || { eventos: 0 };
  stats.comandos = (stats.comandos || 0) + 1;
  await kvput(env, 'stats', stats);

  // !setcmd / !delcmd solo para el dueño (silenciosos); sus demás comandos sí se responden
  if (esDueno && (cmd === 'setcmd' || cmd === 'delcmd')) return await admin(env, cmd, args, broadcaster);

  // idempotencia por mensaje
  if (messageId) {
    if (await env.KICK.get('seen:' + messageId)) return j({ ok: true, dup: true });
    await kvput(env, 'seen:' + messageId, 1, 300);
  }

  // +5 de actividad por participar (alimenta !top; los puntos reales son los oficiales de Kick)
  await darPuntosPorActividad(env, senderId, senderName);

  // cooldown por comando (evita spam/abusos)
  if (await env.KICK.get('cd:' + cmd)) return j({ ok: true, cooldown: cmd });
  await kvput(env, 'cd:' + cmd, 1, 8);

  let texto = null;
  if ((cmd === 'ia' || cmd === 'pregunta') && !args) {
    texto = 'Escribe !ia + tu pregunta y te respondo al instante 🤖✨';
  } else if (cmd === 'ia' || cmd === 'pregunta' || (cmd === 'bot' && args)) {
    return await responderIA(env, args, senderId, senderName, messageId, ctx);
  } else if (cmd === 'puntos') {
    texto = verPuntos(senderName);
  } else if (cmd === 'diario') {
    texto = reclamarDiario(senderName);
  } else if (cmd === 'top') {
    texto = await verTop(env);
  } else if (cmd === 'canje' || cmd === 'canjear') {
    texto = canje(senderName);
  } else if (cmd === 'clip' || cmd === 'clipar') {
    // registra el momento destacado: el agente local (VANTS Clipper) lo recorta del directo
    // y lo publica como Short/Reel/TikTok. TTL 1h: si nadie lo recoge, se limpia solo.
    await kvput(env, 'clipreq:' + String(Date.now()).padStart(15, '0'), { ts: Date.now(), user: senderName }, 3600);
    texto = `📌 ¡Momento destacado marcado, ${senderName}! Lo recorto del directo y se va para Shorts/TikTok/Reels 🔥`;
  } else {
    const custom = await kvget(env, 'cmd:' + cmd);
    if (custom) {
      texto = custom.replace(/\{user\}/g, senderName);
    } else if (BUILTIN[cmd]) {
      texto = BUILTIN[cmd].replace(/\{user\}/g, senderName);
    } else if (cmd === 'comandos') {
      const customs = (await kvget(env, 'cmds')) || [];
      texto = HELP + (customs.length ? ' · !' + customs.join(' !') : '');
    } else if (cmd === 'uptime') {
      texto = await uptime(env, broadcaster);
    }
  }
  if (!texto) return j({ ok: true, sin_comando: cmd });

  return await enviar(env, broadcaster, texto, messageId);
}

/* ---------- puntos OFICIALES de Kick ----------
   El canal usa los channel points oficiales de Kick: se ganan viendo el directo
   y reclamando bonus, y se canjean en la tienda de recompensas del canal. La API
   pública de Kick no permite leer saldos ni repartir puntos, así que el bot los
   MENCIONA y guía al espectador. El contador interno solo alimenta !top con los
   usuarios más activos del chat. */

async function puntosDe(env, id, nombre) {
  const p = (await kvget(env, 'pts:' + id)) || { n: nombre || 'anon', p: 0 };
  if (nombre && nombre !== p.n) p.n = nombre;
  return p;
}

async function actualizarTop(env, id, nombre, pts) {
  let top = (await kvget(env, 'top')) || [];
  top = top.filter(x => x.id !== id);
  top.push({ id, n: nombre, p: pts });
  top.sort((a, b) => b.p - a.p);
  await kvput(env, 'top', top.slice(0, 10));
}

async function darPuntosPorActividad(env, id, nombre) {
  if (!id) return;
  if (await env.KICK.get('cdu:' + id)) return; // máx. una cuenta cada 15s por usuario
  await kvput(env, 'cdu:' + id, 1, 15);
  const p = await puntosDe(env, id, nombre);
  p.p += 5;
  await kvput(env, 'pts:' + id, p);
  await actualizarTop(env, id, p.n, p.p);
}

function verPuntos(nombre) {
  return `⚡ ${nombre || 'Amigo'}, aquí los puntos son los OFICIALES de Kick: ganas viendo el directo y reclamando bonus 🎁 Tu saldo está en la moneda 💠 junto al chat y los gastas en la tienda de recompensas del canal`;
}

function reclamarDiario(nombre) {
  return `🎁 ${nombre || 'Amigo'}, el bonus diario lo da Kick: pulsa el botón de bonus cuando aparezca en el reproductor y sube tu saldo de puntos oficiales ⚡`;
}

async function verTop(env) {
  const top = (await kvget(env, 'top')) || [];
  if (!top.length) return '🏆 Aún no hay ranking de actividad. ¡Habla en el chat y usa comandos para aparecer!';
  const medallas = ['🥇', '🥈', '🥉'];
  return '🏆 Los más activos del chat: ' + top.slice(0, 5).map((x, i) => `${medallas[i] || (i + 1 + 'º')} ${x.n}`).join(' · ');
}

function canje(nombre) {
  return `💠 ${nombre || 'Amigo'}, los canjes se hacen con puntos oficiales de Kick: pulsa la moneda 💠 junto al chat y elige una recompensa de la tienda del canal 🎁`;
}

/* ---------- cerebro IA (Cloudflare Workers AI) ---------- */

const MODELOS_IA = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct-fast'];

const PROMPT_SISTEMA = `Eres "Bot VANTS", asistente oficial del canal de Feispla (VANTS GAMES) en Kick: comunidad gamer de Valorant, ranked, torneos y memes.\nReglas:\n- Responde SIEMPRE en español, en UNA sola línea, MÁXIMO 200 caracteres, tono cercano y divertido, máximo 1 emoji.\n- Cuando encaje de forma natural, recomienda la marca VANTS: web https://vants.vants.workers.dev, membresías PRO/CREATOR con ventajas en torneos y ranked, y el Discord de la comunidad.\n- Si la memoria relevante incluye datos de VANTS (precios, enlaces, soporte), úsalos con confianza: son oficiales.\n- No inventes datos del canal (horarios, resultados, precios). Si no lo sabes, sugiere preguntar a Feispla en el directo o usar !comandos.\n- Cero temas polémicos, apuestas, contenido adulto o groserías: responde con humor y redirige al chat.\n- Eres "Bot VANTS"; no menciones que eres un modelo de IA.`;

async function preguntarIA(env, pregunta, usuario, memoria = '') {
  if (!env.AI) return null;
  const sistema = PROMPT_SISTEMA + (memoria ? `\nMemoria relevante de la comunidad (úsala si ayuda, no la cites literal):\n${memoria}` : '');
  const mensajes = [
    { role: 'system', content: sistema },
    { role: 'user', content: `El espectador ${usuario} escribe en el chat: ${pregunta}` },
  ];
  for (const modelo of MODELOS_IA) {
    try {
      const r = await env.AI.run(modelo, { messages: mensajes, max_tokens: 220 });
      const t = String((r && (r.response ?? r.result?.response)) || '').replace(/\s+/g, ' ').replace(/\*/g, '').trim();
      if (t) return t.slice(0, 480);
    } catch (e) { console.error('IA fallo', modelo, String(e).slice(0, 140)); }
  }
  return null;
}

async function responderIA(env, pregunta, senderId, senderName, messageId, ctx) {
  const t = await tokens(env);
  const broadcaster = t?.broadcaster_user_id;
  if (!pregunta || !pregunta.trim()) return j({ ok: true });
  if (senderId && await env.KICK.get('cdia:' + senderId)) return j({ ok: true, cd_ia: true }); // silencioso
  await kvput(env, 'cdia:' + senderId, 1, 45);
  await sembrarMemoria(env, ctx);
  const memoria = await smBuscar(env, pregunta);
  const respuesta = await preguntarIA(env, pregunta.slice(0, 400), senderName || 'un espectador', memoria);
  const texto = respuesta || 'Mi cerebro se está actualizando 🤖⚠️ ¡Prueba otra vez en un rato o mira !comandos!';
  if (respuesta) smGuardar(env, `Pregunta de ${senderName || 'un espectador'} en el chat de Kick: ${pregunta} — Respuesta del bot: ${respuesta}`, ctx);
  return await enviar(env, broadcaster, texto, messageId);
}

/* ---------- memoria de largo plazo (Supermemory) ---------- */

const SM_BASE = 'https://api.supermemory.ai/v3';
const SM_TAG = 'vants-kick-bot';

async function smBuscar(env, q) {
  if (!env.SUPERMEMORY_KEY || !q) return '';
  try {
    const r = await Promise.race([
      fetch(SM_BASE + '/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.SUPERMEMORY_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: q.slice(0, 300), containerTags: [SM_TAG], limit: 3 }),
      }),
      new Promise(res => setTimeout(() => res(null), 4000)),
    ]);
    if (!r || !r.ok) return '';
    const d = await r.json();
    const trozos = (d.results || []).flatMap(x => (x.chunks || []).map(c => c.content)).filter(Boolean);
    return trozos.join(' · ').slice(0, 700);
  } catch (e) { return ''; } // fail-open: sin memoria el bot sigue funcionando
}

async function smGuardar(env, contenido, ctx, customId) {
  if (!env.SUPERMEMORY_KEY || !contenido) return;
  const cuerpo = { content: contenido.slice(0, 2000), containerTags: [SM_TAG], metadata: { tipo: customId ? 'marca' : 'chat' } };
  if (customId) cuerpo.customId = customId;
  try {
    const promesa = fetch(SM_BASE + '/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SUPERMEMORY_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    }).then(r => r.text().catch(() => ''));
    if (ctx && ctx.waitUntil) ctx.waitUntil(promesa.catch(() => null)); else await promesa;
  } catch (e) {}
}

// conocimiento oficial de la marca que el bot consulta al responder (idempotente)
const SEMILLA_MEMORIA = [
  ['vants-brand', 'VANTS GAMES es la plataforma de esports de Feispla (canal de Kick: kick.com/feispla). Web: https://vants.vants.workers.dev — membresías: https://vants.vants.workers.dev/membresias. Planes: PRO 4,99 EUR/mes, PRO anual 39,99 EUR, CREATOR 9,99 EUR/mes, PASE único 7,99 EUR. Ventajas: ranked, torneos con premios y badges exclusivos.'],
  ['vants-puntos', 'El canal usa los puntos OFICIALES de Kick (channel points): se ganan viendo el directo y reclamando bonus, el saldo se ve en la moneda junto al chat y se canjean en la tienda de recompensas del canal. !puntos lo explica, !diario recuerda el bonus diario y !top muestra a los más activos del chat.'],
  ['vants-soporte', 'Soporte de VANTS GAMES: escribir a vants@agentmail.to. Reglas de la comunidad: respeto ante todo, nada de spam, deportividad. El Discord es el punto de encuentro de la comunidad.'],
  ['vants-clip', 'Los mejores momentos del directo se marcan con !clip (o solos cuando el chat se emociona). El sistema VANTS los recorta, los convierte a vertical y los publica como Shorts en YouTube, TikTok e Instagram Reels.'],
];

/* ---------- cola de momentos destacados para el agente local (VANTS Clipper) ---------- */

async function colaClipper(req, env, url) {
  if (!env.CLIPPER_SECRET || url.searchParams.get('secret') !== env.CLIPPER_SECRET) return j({ error: 'sin_permiso' }, 403);
  const pedidos = [];
  const listado = await env.KICK.list({ prefix: 'clipreq:' });
  for (const k of listado.keys) {
    const v = await kvget(env, k.name);
    if (v) pedidos.push({ id: k.name, ts: v.ts, user: v.user });
    await env.KICK.delete(k.name); // entregar una sola vez
  }
  // chatroom_id del canal objetivo (para que el agente escuche el chat y detecte picos de hype)
  let chatroom_id = null, canal = null;
  try {
    const objetivo = Number(env.CANAL_OBJETIVO);
    const cr = await kick(env, '/channels?broadcaster_user_id=' + objetivo);
    if (cr.ok) {
      const ch = ((await cr.json()).data || [])[0] || {};
      chatroom_id = ch.chatroom?.id || ch.chatroom_id || null;
      canal = ch.slug || ch.username || null;
    }
  } catch (e) {}
  // respaldo: la API OAuth de Kick a veces no incluye el chatroom → API pública por slug
  if (!chatroom_id) {
    try {
      const pub = await fetch('https://kick.com/api/v2/channels/' + encodeURIComponent(canal || 'feispla'), { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VANTS-Clipper)' } });
      if (pub.ok) chatroom_id = ((await pub.json()) || {}).chatroom?.id || null;
    } catch (e) {}
  }
  return j({ ok: true, chatroom_id, canal, requests: pedidos, ahora: Date.now() });
}

async function sembrarMemoria(env, ctx) {
  if (await kvget(env, 'sm_seed')) return;
  await kvput(env, 'sm_seed', 1);
  for (const [id, contenido] of SEMILLA_MEMORIA) {
    await smGuardar(env, contenido, ctx, id);
  }
}

function corta(s, n) {
  if (!s || s.length <= n) return s;
  s = s.slice(0, n);
  const c = s.charCodeAt(s.length - 1);
  if (c >= 0xD800 && c <= 0xDBFF) s = s.slice(0, -1); // no partir emojis
  return s;
}

async function admin(env, cmd, args, broadcaster) {
  if (cmd === 'setcmd' && args) {
    const sp = args.indexOf(' ');
    if (sp < 1) return j({ ok: true, ayuda: '!setcmd nombre texto' });
    const nombre = args.slice(0, sp).toLowerCase().replace(/[^a-z0-9_]/g, '');
    await kvput(env, 'cmd:' + nombre, args.slice(sp + 1).slice(0, 480));
    const lista = (await kvget(env, 'cmds')) || [];
    if (!lista.includes(nombre)) { lista.push(nombre); await kvput(env, 'cmds', lista); }
  } else if (cmd === 'delcmd' && args) {
    const nombre = args.trim().toLowerCase();
    await env.KICK.delete('cmd:' + nombre);
    const lista = ((await kvget(env, 'cmds')) || []).filter(x => x !== nombre);
    await kvput(env, 'cmds', lista);
  }
  return j({ ok: true, admin: cmd });
}

async function uptime(env, broadcaster) {
  try {
    const r = await kick(env, `/channels?broadcaster_user_id=${broadcaster}`);
    const d = await r.json();
    const live = d.data?.[0]?.livestream;
    if (!live || !live.is_live) return 'El canal no está en vivo ahora mismo 😴 ¡Actívate las notificaciones!';
    const mins = Math.max(0, Math.round((Date.now() - new Date(live.started_at).getTime()) / 60000));
    const h = Math.floor(mins / 60), mm = mins % 60;
    const viewers = live.viewer_count != null ? ` · ${live.viewer_count} viendo 👀` : '';
    return `Llevamos en directo ${h ? h + 'h ' : ''}${mm}min${viewers} 🔥`;
  } catch (e) { return 'No pude consultar el estado del directo ahora mismo 😅'; }
}

async function enviar(env, broadcaster, texto, replyTo) {
  const body = { content: corta(texto, 500), type: 'user' };
  if (broadcaster) body.broadcaster_user_id = broadcaster;
  if (replyTo) body.reply_to_message_id = replyTo;
  let r = await kick(env, '/chat', { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok && replyTo) {
    // el mensaje original pudo borrarse/expirar: reintenta sin citarlo
    delete body.reply_to_message_id;
    r = await kick(env, '/chat', { method: 'POST', body: JSON.stringify(body) });
  }
  if (r.ok) {
    try {
      const d = await r.json();
      const mid = d?.data?.message_id || d?.message_id;
      if (mid) await kvput(env, 'mine:' + mid, 1, 600); // marca para no reaccionar a nuestros propios mensajes
    } catch (e) {}
  } else {
    console.error('chat fallo', r.status, (await r.text().catch(() => '')).slice(0, 200));
  }
  return j({ ok: r.ok, respuesta: corta(texto, 60) });
}

/* ---------- estado ---------- */

async function health(env) {
  let t = await tokens(env);
  if (t) t = await asegurarIdentidad(env, t);
  const subs = await kvget(env, 'subs');
  const stats = await kvget(env, 'stats');
  const customs = (await kvget(env, 'cmds')) || [];
  return j({
    ok: true,
    autorizado: !!t,
    canal: t ? { username: t.username, broadcaster_user_id: t.broadcaster_user_id, scope: t.scope, expira_en_min: t.expires_at ? Math.round((t.expires_at - Date.now()) / 60000) : null } : null,
    suscripcion: subs,
    stats,
    comandos_custom: customs,
  });
}
