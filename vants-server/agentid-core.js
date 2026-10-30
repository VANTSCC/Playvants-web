/**
 * VANTS GAMES — AgentID (AgentMail) · inicio de sesión para agentes de IA.
 *
 * Permite que un agente con bandeja de AgentMail cree cuenta en VANTS con
 * "ENTRAR CON AGENTID". Proveedor OIDC estándar:
 *   issuer      https://auth.agentid.com
 *   authorize   /v0/authorize  (response_type=code, PKCE S256)
 *   token       /v0/token      (client_secret_post + code_verifier)
 *   jwks        /v0/jwks.json  (ES256 · P-256)
 *   userinfo    /v0/userinfo
 *
 * Claims relevantes: sub, email (inbox), email_verified, actor_type,
 * owner_human_verified / owner_human_id (dueño humano verificado, con los
 * scopes owner_profile/owner_email).
 *
 * Sesión propia de VANTS: tras el canje guardamos una cookie HttpOnly
 * `vants_agente` con un token firmado (HMAC-SHA256 con VANTS_SESION_SEC).
 * verifySesionJwt() del worker acepta esa cookie como sesión alternativa,
 * así el agente hereda el MISMO acceso que una cuenta con sesión Auth0.
 *
 * Sin AGENTID_CLIENT_ID o sin VANTS_SESION_SEC todo el módulo se apaga y la
 * web sigue funcionando igual (degradación honesta, patrón del worker).
 */

const ISSUER = 'https://auth.agentid.com';
const COOKIE_PKCE = 'agid_pkce';
const COOKIE_SESION = 'vants_agente';
const TTL_PKCE = 600;        // 10 min (el código de autorización dura 60 s)
const TTL_SESION = 604800;   // 7 días (no hay refresh token en AgentID)
const JWKS_TTL_MS = 3600000;

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ---- base64url ---- */
function b64uDe(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function b64uDeTxt(s) { return dec.decode(b64uDe(s)); }
function b64uDeBytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function b64uEnTxt(s) { return b64uDeBytes(enc.encode(s)); }
function aleatorio(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b64uDeBytes(b);
}

/* ---- cookies ---- */
function cookieDe(request, nombre) {
  const cruda = request.headers.get('cookie') || '';
  for (const parte of cruda.split(';')) {
    const i = parte.indexOf('=');
    if (i === -1) continue;
    if (parte.slice(0, i).trim() === nombre) return parte.slice(i + 1).trim();
  }
  return null;
}
function atributosCookie(maxAge) {
  return 'HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + maxAge;
}

/* ---- HMAC del token de sesión y del cookie PKCE ---- */
async function hmacFirmar(secret, mensaje) {
  const k = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const f = await crypto.subtle.sign('HMAC', k, enc.encode(mensaje));
  return b64uDeBytes(new Uint8Array(f));
}
async function paqueteFirmado(secret, objeto) {
  const cuerpo = b64uEnTxt(JSON.stringify(objeto));
  const sig = await hmacFirmar(secret, cuerpo);
  return cuerpo + '.' + sig;
}
async function paqueteVerificado(secret, valor) {
  if (!valor || valor.indexOf('.') === -1) return null;
  const i = valor.lastIndexOf('.');
  const cuerpo = valor.slice(0, i);
  const sig = valor.slice(i + 1);
  let esperada;
  try { esperada = await hmacFirmar(secret, cuerpo); } catch (e) { return null; }
  if (esperada !== sig) return null;
  try {
    const p = JSON.parse(b64uDeTxt(cuerpo));
    if (p.exp && Date.now() / 1000 > p.exp) return null;
    return p;
  } catch (e) { return null; }
}

/* ---- JWKS + verificación ES256 del id_token ---- */
let _jwks = { at: 0, keys: [] };
async function claveDeJwks(kid) {
  const ahora = Date.now();
  if (!_jwks.keys.length || ahora - _jwks.at > JWKS_TTL_MS) {
    const r = await fetch(ISSUER + '/v0/jwks.json', {
      headers: { 'User-Agent': 'vants-worker' }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error('jwks_no_disponible');
    const j = await r.json();
    if (!j || !Array.isArray(j.keys)) throw new Error('jwks_malformado');
    _jwks = { at: ahora, keys: j.keys };
  }
  return _jwks.keys.find((k) => k.kid === kid) || null;
}
async function verificarIdToken(idToken, clientId) {
  const partes = String(idToken || '').split('.');
  if (partes.length !== 3) throw new Error('id_token_malformado');
  const head = JSON.parse(b64uDeTxt(partes[0]));
  const carga = JSON.parse(b64uDeTxt(partes[1]));
  if (head.alg !== 'ES256' || !head.kid) throw new Error('id_token_alg_inesperado');
  if (carga.iss !== ISSUER) throw new Error('id_token_iss_incorrecto');
  const auds = Array.isArray(carga.aud) ? carga.aud : [carga.aud];
  if (!auds.includes(clientId)) throw new Error('id_token_aud_incorrecto');
  if (carga.exp && Date.now() / 1000 > carga.exp + 30) throw new Error('id_token_expirado');
  const jk = await claveDeJwks(head.kid);
  if (!jk || jk.kty !== 'EC' || jk.crv !== 'P-256') throw new Error('id_token_clave_no_encontrada');
  const key = await crypto.subtle.importKey(
    'jwk', { kty: 'EC', crv: 'P-256', x: jk.x, y: jk.y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
  );
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, key, b64uDe(partes[2]),
    enc.encode(partes[0] + '.' + partes[1])
  );
  if (!ok) throw new Error('id_token_firma_invalida');
  return carga;
}

/* ---- sesiones de agente (cookie) ---- */
function configOk(env) {
  return !!(env && env.AGENTID_CLIENT_ID && env.VANTS_SESION_SEC);
}
async function sesionDeCookie(request, env) {
  if (!configOk(env)) return null;
  const cruda = cookieDe(request, COOKIE_SESION);
  if (!cruda) return null;
  const p = await paqueteVerificado(env.VANTS_SESION_SEC, cruda);
  if (!p || !p.sub || !p.inbox) return null;
  return {
    sub: 'agentid|' + String(p.sub),
    agente: true,
    inbox: String(p.inbox),
    nick: String(p.nick || String(p.inbox).split('@')[0] || 'AGENTE'),
    dueno: p.dueno === true,
  };
}

/* ---- respuestas ---- */
function paginaError(titulo, detalle) {
  return new Response(
    '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>VANTS · ' + titulo + '</title>' +
    '<body style="margin:0;background:#070708;color:#fff;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh">' +
    '<div style="max-width:520px;padding:32px;text-align:center">' +
    '<div style="width:56px;height:56px;margin:0 auto 18px;background:#ff0d2e;border-radius:14px;display:grid;place-items:center;font-weight:900;font-size:26px">V</div>' +
    '<h1 style="font-size:22px;letter-spacing:.02em;text-transform:uppercase;margin:0 0 10px">' + titulo + '</h1>' +
    '<p style="color:#a1a1aa;font-size:14px;line-height:1.6;margin:0 0 22px">' + detalle + '</p>' +
    '<a href="/perfil" style="display:inline-block;padding:12px 22px;background:#ff0d2e;color:#fff;border-radius:9px;text-decoration:none;font-weight:800;text-transform:uppercase;font-size:13px">Volver al perfil</a>' +
    '</div></body></html>',
    { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
function cabeceraMultiple(cookies) {
  // Response.headers.append permite varias Set-Cookie de forma fiable
  const r = new Response(null, { status: 302, headers: { Location: '/' } });
  (cookies || []).forEach((c) => r.headers.append('Set-Cookie', c));
  return r;
}
void cabeceraMultiple;

export default {
  ISSUER,

  /* ¿es una ruta /api/agentid/*? la maneja y devuelve Response; si no, null */
  async manejar(request, env, url) {
    if (!url.pathname.startsWith('/api/agentid/')) return null;
    const metodo = request.method.toUpperCase();
    const clientId = env.AGENTID_CLIENT_ID;
    const secreto = env.VANTS_SESION_SEC;
    if (!clientId || !secreto) {
      /* Entorno sin AgentID configurado: la entrada redirige de vuelta con
         un aviso (la web no debe mostrar un 503 crudo al jugador/agente). */
      if (url.pathname === '/api/agentid/login') {
        return new Response(null, {
          status: 302,
          headers: { Location: '/perfil?agentid=no_config', 'Cache-Control': 'no-store' },
        });
      }
      return new Response(JSON.stringify({ ok: false, error: 'agentid_no_config' }), {
        status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    const estricto = env.AGENTID_SOLO_VERIFICADOS !== '0';
    const origen = url.origin;
    const callbackUri = origen + '/api/agentid/callback';

    /* ── 1) ENTRAR: manda al authorize de AgentID con PKCE ── */
    if (url.pathname === '/api/agentid/login' && metodo === 'GET') {
      let volver = url.searchParams.get('volver') || '/perfil';
      if (!volver.startsWith('/') || volver.startsWith('//')) volver = '/perfil';
      const state = aleatorio(24);
      const verifier = aleatorio(48);
      const digest = await crypto.subtle.digest('SHA-256', enc.encode(verifier));
      const challenge = b64uDeBytes(new Uint8Array(digest));
      const paquete = await paqueteFirmado(secreto, {
        state, verifier, volver, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + TTL_PKCE,
      });
      const autorizacion = ISSUER + '/v0/authorize?response_type=code' +
        '&client_id=' + encodeURIComponent(clientId) +
        '&redirect_uri=' + encodeURIComponent(callbackUri) +
        '&scope=' + encodeURIComponent('openid email profile owner_profile owner_email') +
        '&state=' + encodeURIComponent(state) +
        '&code_challenge=' + encodeURIComponent(challenge) +
        '&code_challenge_method=S256';
      const r = new Response(null, { status: 302, headers: { Location: autorizacion, 'Cache-Control': 'no-store' } });
      r.headers.append('Set-Cookie', COOKIE_PKCE + '=' + paquete + '; ' + atributosCookie(TTL_PKCE));
      return r;
    }

    /* ── 2) CALLBACK: canjea el código, valida el id_token y crea la sesión ── */
    if (url.pathname === '/api/agentid/callback' && metodo === 'GET') {
      const error = url.searchParams.get('error');
      if (error) {
        const r = new Response(null, { status: 302, headers: { Location: '/perfil?agentid=cancelado', 'Cache-Control': 'no-store' } });
        r.headers.append('Set-Cookie', COOKIE_PKCE + '=; ' + atributosCookie(0));
        return r;
      }
      const code = url.searchParams.get('code') || '';
      const state = url.searchParams.get('state') || '';
      const pkce = await paqueteVerificado(secreto, cookieDe(request, COOKIE_PKCE));
      if (!pkce || !pkce.state || pkce.state !== state || !pkce.verifier) {
        return paginaError('Sesión de entrada inválida', 'El intento de entrada con AgentID expiró o ya se usó. Volvé a intentar desde el perfil.');
      }
      const cuerpo = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUri,
        client_id: clientId,
        code_verifier: pkce.verifier,
      });
      if (env.AGENTID_CLIENT_SECRET) cuerpo.set('client_secret', env.AGENTID_CLIENT_SECRET);
      const rt = await fetch(ISSUER + '/v0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'vants-worker' },
        body: cuerpo.toString(),
        signal: AbortSignal.timeout(9000),
      });
      if (!rt.ok) return paginaError('AgentID no entregó el token', 'El canje del código falló (código de ' + rt.status + '). Volvé a intentar en un minuto.');
      const tj = await rt.json().catch(() => null);
      if (!tj || !tj.id_token) return paginaError('AgentID no entregó el token', 'La respuesta del proveedor no traía id_token.');
      let carga;
      try { carga = await verificarIdToken(tj.id_token, clientId); } catch (e) {
        return paginaError('Token de AgentID inválido', 'La firma o los datos del token no verificaron (' + String(e.message || e) + ').');
      }
      let info = carga;
      if (tj.access_token) {
        const ru = await fetch(ISSUER + '/v0/userinfo', {
          headers: { Authorization: 'Bearer ' + tj.access_token, 'User-Agent': 'vants-worker' },
          signal: AbortSignal.timeout(8000),
        }).catch(() => null);
        if (ru && ru.ok) {
          const ju = await ru.json().catch(() => null);
          if (ju && ju.sub) info = Object.assign({}, carga, ju);
        }
      }
      /* Filtro de confianza: el dueño del inbox debe estar identificado.
         owner_human_verified = World ID (el más fuerte); owner_email_verified
         = email del dueño confirmado en la consola de AgentMail. Con uno de
         los dos alcanza: bloquea inboxes anónimos/sin dueño identificado. */
      const dueno = info.owner_human_verified === true || info.owner_email_verified === true;
      if (estricto && !dueno) {
        return paginaError('Agente sin dueño verificado',
          'VANTS solo acepta agentes con dueño humano verificado en AgentID. Verificá tu identidad en la consola de AgentMail (owner_verified) y volvé a entrar.');
      }
      const inbox = String(info.email || '');
      if (!inbox || !info.sub) return paginaError('Perfil incompleto', 'AgentID no devolvió la identidad del inbox.');
      const nick = String(info.preferred_username || info.name || inbox.split('@')[0] || 'AGENTE').slice(0, 24);
      const ahora = Math.floor(Date.now() / 1000);
      const sesion = await paqueteFirmado(secreto, {
        v: 1, sub: String(info.sub), inbox, nick, dueno, iat: ahora, exp: ahora + TTL_SESION,
      });
      const destino = pkce.volver || '/perfil';
      const r = new Response(null, { status: 302, headers: { Location: destino, 'Cache-Control': 'no-store' } });
      r.headers.append('Set-Cookie', COOKIE_SESION + '=' + sesion + '; ' + atributosCookie(TTL_SESION));
      r.headers.append('Set-Cookie', COOKIE_PKCE + '=; ' + atributosCookie(0));
      return r;
    }

    /* ── 3) SESIÓN actual del agente (para el frontend) ── */
    if (url.pathname === '/api/agentid/sesion' && metodo === 'GET') {
      const s = await sesionDeCookie(request, env);
      if (!s) return new Response(JSON.stringify({ ok: false, error: 'sin_sesion_agente' }), {
        status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
      return new Response(JSON.stringify({
        ok: true, tipo: 'agente', sub: s.sub, inbox: s.inbox, nick: s.nick,
        dueno: s.dueno, estricto,
      }), {
        status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    /* ── 4) SALIR: borra la cookie del agente ── */
    if (url.pathname === '/api/agentid/salir' && metodo === 'GET') {
      let volver = url.searchParams.get('volver') || '/';
      if (!volver.startsWith('/') || volver.startsWith('//')) volver = '/';
      const r = new Response(null, { status: 302, headers: { Location: volver, 'Cache-Control': 'no-store' } });
      r.headers.append('Set-Cookie', COOKIE_SESION + '=; ' + atributosCookie(0));
      return r;
    }

    return null;
  },

  /* sesión de agente para verifySesionJwt / logros */
  sesionDeCookie,
};
