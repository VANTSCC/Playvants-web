/* ============================================================================
 * vants-functions · Worker de Cloudflare que aloja las 8 funciones que antes
 * corrían como Neon Functions (runtime propietario de Neon).
 *
 * Por qué existe: la migración de la base de datos de Neon a Supabase incluye
 * salir del runtime de Neon. Este Worker monta las MISMAS funciones, con el
 * MISMO código (copiado tal cual a functions/), detrás de rutas /fn/<nombre>.
 *
 * Rutas: cada función sigue viendo la ruta que ya conocía (el router quita el
 * prefijo), así que ninguna URL interna cambia de forma:
 *   /fn/linker/...            -> functions/linker (OAuth de cuentas)
 *   /fn/vantsdata/...         -> functions/vantsdata (proxy público de lectura)
 *   /fn/vantsbot/...          -> functions/vantsbot (mando del Agente por Discord)
 *   /fn/mm/...                -> functions/mm (matchmaking serverless)
 *   /fn/stripe-checkout/...   -> functions/stripe-checkout
 *   /fn/stripe-webhook/...    -> functions/stripe-webhook
 *   /fn/discord-notify/...    -> functions/discord-notify
 *   /fn/supervisor/...        -> functions/supervisor
 *
 * Variables (vars) y secretos: con nodejs_compat, Cloudflare pobla
 * process.env con las variables del Worker, y el código de las funciones lee
 * process.env exactamente igual que lo hacía en Neon (DATABASE_URL,
 * DISCORD_BOT_TOKEN, FACEIT_CLIENT_ID, etc.). DATABASE_URL apunta al pooler
 * de Supabase (sesión, puerto 5432):
 *   npx wrangler secret put DATABASE_URL
 * El resto de secretos se añaden igual que estaban en los workflows de Neon:
 *   DISCORD_BOT_TOKEN, DISCORD_PUBLIC_KEY, DISCORD_APP_ID, VANTS_BOT_SECRET,
 *   AGENT_DISCORD_IDS, SUPERVISOR_DM_ID, FACEIT_CLIENT_ID, FACEIT_API_KEY,
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET y los OAuth del linker.
 * ========================================================================== */

import linker from './functions/linker/index.ts';
import vantsdata from './functions/vantsdata/index.ts';
import vantsbot from './functions/vantsbot/index.ts';
import mm from './functions/mm/index.ts';
import stripeCheckout from './functions/stripe-checkout/index.ts';
import stripeWebhook from './functions/stripe-webhook/index.ts';
import discordNotify from './functions/discord-notify/index.ts';
import supervisor from './functions/supervisor/index.ts';

const FUNCIONES = {
  linker,
  vantsdata,
  vantsbot,
  mm,
  'stripe-checkout': stripeCheckout,
  'stripe-webhook': stripeWebhook,
  'discord-notify': discordNotify,
  supervisor,
};

function responder(objeto, estado) {
  return new Response(JSON.stringify(objeto), {
    status: estado,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // Salud del propio Worker (útil para el monitor de VANTS).
    if (url.pathname === '/salud') {
      return responder({
        ok: true,
        worker: 'vants-functions',
        funciones: Object.keys(FUNCIONES),
      }, 200);
    }

    // /fn/<nombre>/resto-de-la-ruta -> la función ve "/resto-de-la-ruta",
    // idéntico a cuando cada una tenía su dominio propio en Neon.
    const m = url.pathname.match(/^\/fn\/([a-z0-9-]+)(\/.*)?$/i);
    if (!m) {
      return responder({
        ok: false,
        error: 'ruta_no_encontrada',
        pista: 'Usa /fn/<funcion>/... o /salud para diagnóstico',
        funciones: Object.keys(FUNCIONES),
      }, 404);
    }

    const nombre = m[1].toLowerCase();
    const funcion = FUNCIONES[nombre];
    if (!funcion || typeof funcion !== 'function') {
      return responder({ ok: false, error: 'funcion_desconocida', nombre }, 404);
    }

    const interna = new URL(req.url);
    interna.pathname = m[2] || '/';
    const reqInterna = new Request(interna, req);
    try {
      return await funcion(reqInterna);
    } catch (e) {
      return responder({
        ok: false,
        error: 'excepcion_en_funcion',
        nombre,
        mensaje: String((e && e.message) || e).slice(0, 300),
      }, 500);
    }
  },
};
