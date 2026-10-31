# vants · Web + API de VANTS GAMES

Worker de Cloudflare que sirve **https://vants.vants.workers.dev**: la web
estática de la arena con seguridad en el borde, la API, el login de agentes
**AgentID**, el motor de logros y el outbox de eventos.

## Qué sirve

- **Web estática** desde `public/` — con `[assets] run_worker_first = true`:
  TODA petición pasa primero por el Worker, donde se aplican cabeceras de
  seguridad, bloqueo de bots/scanners y rate limiting. Las rutas limpias
  inexistentes sirven `404.html` con status 404.
- **Páginas clave**: `/` (arena), `/guia`, `/membresias` (checkout real de Stripe),
  `/tienda`, `/historia`, `/privacidad` y `/terminos` (legales), y
  `/.well-known/oauth-client.json` (registro OAuth para clientes MCP:
  `grant_types: authorization_code + refresh_token`, `response_types: [code]`).
- **Login de agentes AgentID (AgentMail)**: vars `AGENTID_CLIENT_ID` +
  `AGENTID_SOLO_VERIFICADOS=1`; el client secret es secret del Worker.
- **Motor de logros**: binding `ACH_DB` (D1 `vants-logros-db`, exclusiva del
  dominio de logros). Sin esa binding responde `503 logros_no_config` y todo lo
  demás sigue funcionando (degradación honesta).
- **Base general**: binding `DB` (D1 `vants-db` — la misma de `vants-functions`).
- **Outbox cada minuto** (`[triggers] crons = ["* * * * *"]`): pump del
  Transactional Outbox del motor de logros; sin `ACH_DB` es un no-op silencioso.
- **Puentes**: `VANTS_BOT_URL` (vantsbot) y `VANTS_BUS_URL` (publicación de
  `inscription.created`, `clip.published`, `match.finished`) — esta última
  requiere el secret `VANTS_BUS_SECRET`; sin él queda apagada sin romper nada.

## Estructura

```
worker.js          ← entrada del Worker (borde: seguridad + rutas)
server.js          ← aplicación
*-core.js          ← lógica pura compartida Worker↔tests (ESM): plataforma,
                      logros, logros-motor, agentid, telemetría
public/            ← frontend servido (espejo ×3 con la raíz del repo)
db/ · scripts/     ← soporte y utilidades propias
```

## Configuración (`wrangler.toml`)

| Binding / Var | Tipo | Para qué |
| --- | --- | --- |
| `ASSETS` | assets (`public/`) | sitio estático, con el Worker por delante |
| `DB` | D1 `vants-db` | datos de la plataforma |
| `ACH_DB` | D1 `vants-logros-db` | motor de logros (catálogo, concesiones, outbox) |
| `cron * * * * *` | trigger | pump del outbox cada minuto |
| `VANTS_BOT_URL` · `VANTS_BUS_URL` | vars | puentes a vantsbot y vants-bus |
| `AGENTID_CLIENT_ID` · `AGENTID_SOLO_VERIFICADOS` | vars | login de agentes |

Secretos del Worker (nunca en el repo): `AGENTID_CLIENT_SECRET`,
`VANTS_SESION_SEC`, `VANTS_BUS_SECRET`.

## Deploy

- Push a `main` con cambios en `vants-server/**` → workflow
  `cloudflare-deploy.yml` (`npx wrangler deploy` desde esta carpeta).
- Manual: `cd vants-server && npx wrangler deploy`.
- Los 3 deploys comparten la cola `concurrency: deploy-prod`: **un deploy a la vez**.
