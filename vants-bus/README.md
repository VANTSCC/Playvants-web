# VANTS-BUS · Cliente para Playvants-web (Cloudflare Worker)

Bus de eventos central: `https://vants-bus.vants.workers.dev`

La web puede hacer **dos cosas** en el bus:

1. **Publicar** cosas interesantes (p. ej. `clip.published`, `post.generated`,
   `tournament.inscriptions_opened`) para que el launcher y los agentes
   reaccionen en vivo.
2. **Consumir** eventos de los demás (p. ej. `match.finished` de FACEIT para
   refrescar ranking/agenda sin polling lento, `alert.detected` de los agentes).

## Uso (dentro de `vants-server/`)

```js
import { VantsBus, EVENTS } from '../vants-bus/vants-bus-client.js';

let bus;
export default {
  async fetch(request, env, ctx) {
    if (!bus) bus = new VantsBus({
      busUrl: env.VANTS_BUS_URL,            // secret del Worker
      projectId: 'playvants-web',
      secret: env.VANTS_BUS_SECRET,         // secret del Worker
    });

    // Publicar (disparo):
    ctx.waitUntil(bus.publish(EVENTS.CLIP_PUBLISHED, { clipId: '…', autor: '…' }));

    // Consumir (cron o en cada request, con cursor en KV):
    const cursor = await env.VANTS_KV.get('vants_cursor') || '';
    const { events, cursor: next } = await bus.fetchEvents({ since: cursor, limit: 100 });
    for (const e of events) {
      if (e.type === EVENTS.MATCH_FINISHED) await refrescaRanking(e.data);
    }
    await env.VANTS_KV.put('vants_cursor', next);
  }
}
```

## Secrets necesarios (ya creados en la cuenta Cloudflare VANTS)

```
VANTS_BUS_URL     = https://vants-bus.vants.workers.dev
VANTS_BUS_SECRET  = (secreto HMAC de playvants-web — pedirlo, no está en el repo)
```

Crear con: `npx wrangler secret put VANTS_BUS_URL` y `VANTS_BUS_SECRET`.

`snippet-worker.js` tiene un cron consumidor completo con cursor en KV y
backoff, listo para copiar a `vants-server/`.
