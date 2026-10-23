# vants-consumer-playvants · Consumidor del bus para la web

Worker **independiente** — NO forma parte del despliegue de la web.
Su código no toca `vants-server/` ni el entry del worker principal:
la web queda exactamente igual que estaba.

## Qué hace

Cada minuto (cron `* * * * *`):

1. Lee eventos nuevos del bus (`GET /events` firmado con la identidad
   `playvants-web`). El cursor se deriva de `max(id)` de la propia
   tabla `vants_feed` → si un INSERT falla, la siguiente vuelta relee
   (idempotente con `ON CONFLICT DO NOTHING`): cero pérdida.
2. Copia los eventos a **`vants_feed`** en Neon (migración 34).
3. Aplica retención (borra del feed lo anterior a 7 días).

La web puede leer el feed con su conexión Neon existente:

```sql
SELECT type, source, ts, data
  FROM vants_feed
 ORDER BY ts DESC
 LIMIT 20;
```

## Verificación

- Health: `https://vants-consumer-playvants.vants.workers.dev/health`
  → `{"ok":true,"ultimo":{...}}` (último evento copiado al feed).
- Logs: `npx wrangler tail vants-consumer-playvants`

## Despliegue (ya hecho; referencia)

```bash
cd vants-bus/consumer-worker
npm i
CLOUDFLARE_API_TOKEN=... npx wrangler deploy
npx wrangler secret put DATABASE_URL       # cadena Neon (rol authenticator)
npx wrangler secret put VANTS_BUS_SECRET   # secreto HMAC de playvants-web
```

Requiere la migración `db/migrations/34-vants-feed.sql` aplicada
(ya aplicada en la rama production vía CI de neon-migrate).
