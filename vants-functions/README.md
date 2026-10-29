# vants-functions

Las 8 funciones que corrían en el runtime propietario de **Neon Functions**, ahora en **un solo Worker de Cloudflare** — y con **base de datos Cloudflare D1** (todo en Cloudflare, sin Neon ni Supabase).

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

## Base de datos: D1 (binding `DB`)

La base es **`vants-db`**, la MISMA D1 que usa la web (`vants`) y el bot
(`vantsbot`). El esquema SQLite completo ya vive ahí (players, mm_*, pt_*,
torneos, pagos, agent_*, vistas `v_en_vivo`, `v_torneo_equipos`,
`v_torneo_bracket`, `rr_historial_jugador`, `mm_historial`).

El puente pg → D1 está en `functions/_d1.js`: expone la interfaz
`pool.query(sql, params) → {rows}` y traduce el dialecto al vuelo
(`$n` → `?`, `NOW()` → `datetime('now')`, `::casts` fuera, `ILIKE` → `LIKE`,
`GREATEST` → `MAX`). Los procedimientos almacenados PL/pgSQL de matchmaking
(migraciones 21/22/23/24/27) viven ahora como funciones JS dentro de
`functions/mm/index.ts` con la misma semántica.

## Secretos (los que cada función necesita)

```bash
cd vants-functions
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APP_ID
npx wrangler secret put VANTS_BOT_SECRET
npx wrangler secret put FACEIT_CLIENT_ID
npx wrangler secret put FACEIT_API_KEY
npx wrangler secret put SUPERVISOR_DM_ID   # opcional
```

Las de OAuth del linker (TWITCH_*, KICK_*, YOUTUBE_*, TIKTOK_*, X_*, RIOT_*,
STEAM_*) y las de Stripe (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
DISCORD_NOTIFY_SECRET) se añaden con el mismo nombre que tenían.
Ya NO hace falta DATABASE_URL: la base llega por el binding D1 `DB`.

## Despliegue

```bash
cd vants-functions
npx wrangler deploy
```

URL pública: `https://vants-functions.vants.workers.dev`
