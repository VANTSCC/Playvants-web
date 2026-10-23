/* ============================================================
 * INTEGRACIÓN · playvants-web (Cloudflare Worker de la web)
 *
 * 1) Copia clients/js/vants-bus-client.js a tu repo, p.ej. en
 *    functions/lib/vants-bus-client.js
 *
 * 2) Crea los secretos:
 *      wrangler secret put VANTS_BUS_URL      → https://vants-bus.<sub>.workers.dev
 *      wrangler secret put VANTS_BUS_SECRET   → el secreto de playvants-web
 *
 * 3) Publicar: desde el endpoint donde se crea una inscripción o
 *    se abre un torneo, llama a publishVantsEvent(...) como aquí abajo.
 *
 * 4) Consumir: añade un cron trigger en tu wrangler.toml y procesa
 *    los eventos de los otros proyectos (launcher, agents, faceit).
 * ============================================================ */

import { VantsBus, EVENTS } from './vants-bus-client.js';

/* --- helper singleton (crea el cliente una vez por isolate) --- */
let _bus = null;
function bus(env) {
  if (!_bus) {
    _bus = new VantsBus({
      busUrl: env.VANTS_BUS_URL,
      projectId: 'playvants-web',
      secret: env.VANTS_BUS_SECRET,
    });
  }
  return _bus;
}

/* Ejemplo: dentro del handler que crea una inscripción de torneo.
 * Llama a esto DESPUÉS de guardar en tu base de datos (el evento
 * comunica algo que ya pasó). */
export async function onInscriptionCreated(env, { tournamentId, teamId, game }) {
  await bus(env).publish(EVENTS.INSCRIPTION_CREATED, {
    tournamentId,
    teamId,
    game,
  });
  // → flask-agents puede postear en Discord
  // → vants-launcher muestra el banner "Inscripciones abiertas"
}

/* Ejemplo de consumidor: cron del Worker (en wrangler.toml):
 *   [triggers]
 *   crons = ["*\/5 * * * *"]     # cada 5 minutos
 * Y en tu export default:
 *   async scheduled(event, env, ctx) {
 *     ctx.waitUntil(processVantsEvents(env));
 *   }
 */
export async function processVantsEvents(env) {
  const c = bus(env);

  // Consume solo eventos de interés y guarda el cursor en KV para reanudar.
  const since = (await env.VANTS_KV.get('bus_cursor')) || '';
  const res = await c.fetchEvents({
    since,
    types: [EVENTS.GAME_SESSION_STARTED, EVENTS.HIGHLIGHTS_READY, EVENTS.MATCH_FINISHED],
    limit: 100,
  });

  for (const ev of res.events) {
    switch (ev.type) {
      case EVENTS.GAME_SESSION_STARTED:
        // Marca "EN DIRECTO" del jugador en la web
        console.log('marcar en vivo', ev.data);
        break;
      case EVENTS.HIGHLIGHTS_READY:
        // Publica el clip del agente en la sección CLIPS
        console.log('publicar clip', ev.data);
        break;
      case EVENTS.MATCH_FINISHED:
        // El faceit-webhook confirmó un resultado → refresca ranking
        console.log('refrescar ranking', ev.data);
        break;
    }
  }

  if (res.cursor) await env.VANTS_KV.put('bus_cursor', res.cursor);
}
