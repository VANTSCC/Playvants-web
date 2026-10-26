# vants-functions

Las 8 funciones que corrían en el runtime propietario de **Neon Functions**, ahora en **un solo Worker de Cloudflare**. Parte de la migración de la base de datos de Neon a Supabase: al salir de Neon, el runtime de sus funciones desaparece, así que las funciones se reubican aquí.

## Qué contiene

| Ruta | Función (carpeta en `functions/`) | Rol |
| --- | --- | --- |
| `/fn/linker/` | `linker` | Conectores OAuth de cuentas (Twitch, Kick, YouTube, TikTok, X, Riot, Steam, FACEIT) |
| `/fn/vantsdata/` | `vantsdata` | Proxy público de lectura (whitelist de tablas para la web) |
| `/fn/vantsbot/` | `vantsbot` | Mando del Agente por Discord (interacciones, puente de DMs, /setup) |
| `/fn/mm/` | `mm` | Matchmaking serverless (cola, partidas, RR, historiales, invites) |
| `/fn/stripe-checkout/` | `stripe-checkout` | Pagos: planes PRO/CREATOR, pase y fees |
| `/fn/stripe-webhook/` | `stripe-webhook` | Webhook de pagos y planes |
| `/fn/discord-notify/` | `discord-notify` | Notificaciones a Discord |
| `/fn/supervisor/` | `supervisor` | Automatización del supervisor |
| `/salud` | (propio del router) | Diagnóstico: lista de funciones montadas |

## Garantía de copia fiel

El código de `functions/` es una **copia literal** de `neon-functions/` (sin tocar). Las funciones solo usaban `pg` y `node:crypto`, nada del SDK de Neon, así que el único cambio real es el envoltorio: este router (`worker.js`) que quita el prefijo `/fn/<nombre>` antes de llamar a cada función, para que cada una siga viendo las rutas que ya conocía.

## Variables y secretos

Con `nodejs_compat`, Cloudflare llena `process.env` con las variables y secretos del Worker: el código portado lee `process.env` igual que en Neon. Configurar (una vez):

```bash
cd vants-functions
npx wrangler secret put DATABASE_URL      # cadena de sesión del pooler de Supabase (5432)
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APP_ID    # o DISCORD_ID_APP, como estaba
npx wrangler secret put VANTS_BOT_SECRET
npx wrangler secret put FACEIT_CLIENT_ID
npx wrangler secret put FACEIT_API_KEY
npx wrangler secret put SUPERVISOR_DM_ID  # opcional
# AGENT_DISCORD_IDS: opcional (allowlist de /agente)
```

Las de OAuth del linker (TWITCH_*, KICK_*, YOUTUBE_*, TIKTOK_*, X_*, RIOT_*, STEAM_*) y las de Stripe se añaden con el mismo nombre que tenían en los workflows de Neon.

## Deploy

Automático con `.github/workflows/cloudflare-deploy-functions.yml` (push a `main` que toque `vants-functions/**`, o manual). Usa el mismo `CLOUDFLARE_API_TOKEN` que el resto de deploys.

## Qué cambia hacia fuera

| Consumidor | Antes (Neon) | Ahora |
| --- | --- | --- |
| Worker web (`vants-server`) | `PLAT_PROXY` → `...-vantsdata.compute...neon.tech/` | `https://vants-functions.vants.workers.dev/fn/vantsdata/` |
| Worker web (`vants-server`) | `VANTS_BOT_URL` → `...-vantsbot.compute...neon.tech` | `https://vants-functions.vants.workers.dev/fn/vantsbot` |
| Discord Developer Portal | Interactions URL → dominio de Neon | `https://vants-functions.vants.workers.dev/fn/vantsbot/` |
| Stripe | Webhook endpoint → dominio de Neon | `https://vants-functions.vants.workers.dev/fn/stripe-webhook/` |
| Apps OAuth del linker | Redirect URIs → dominio de Neon | `https://vants-functions.vants.workers.dev/fn/linker/...` |
| `monitor/` | Chequea dominios de Neon | URLs `/fn/...` del Worker nuevo |
