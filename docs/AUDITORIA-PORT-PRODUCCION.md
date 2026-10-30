# AUDITORÍA + PORT: VantsgamesPrewiew → VANTSGAMES/Vantsgames (producción)

Fecha: 2026-10-30 · Rama del port: `feat/port-preview-produccion` · Base: `main` (9e95563)

## 1. Alcance

El repo oficial **VANTSGAMES/Vantsgames** (worker `vants` en producción, URL
https://vants.vants.workers.dev) evolucionó por su cuenta desde la base común
`1526e9c`: perfil S4.8/S4.9 (pestañas RESUMEN · DESTACADOS · REDES Y CUENTAS ·
MI FICHA · CUENTA), panel del agente, `sin-rango.svg`, migración a Cloudflare D1
en toda la plataforma y CI de deploy automático. El fork **feispla/VantsgamesPrewiew**
se quedó con la línea de trabajo nuestra: nav, marca, ficha de torneo, bracket y
el motor de logros.

Este port pasa **solo el delta nuestro** al oficial, sin regresar ninguna de sus
mejoras (regla del dueño: el perfil viejo de Prewiew —solo ▸CS2 y RESUMEN— NO se toca).

## 2. Qué tiene el oficial (auditoría relevante al port)

| Área | Estado en `main` oficial |
|---|---|
| `vants-server/worker.js` (2949 líneas) | Reescrito a D1 (`env.DB` = `vants-db`) + `neonGet` para players/tournament_matches; rutas `/api/torneos/bracket|inscribir|gestionar`, `/api/account/*`, `/api/valorant/rango`, VANTS-BUS (`publicarBus`), `infoDeSesion`, rate-limits, run_worker_first |
| `vants-server/wrangler.toml` | Worker `vants`, D1 `vants-db` (binding DB), vars VANTS_BOT_URL/VANTS_BUS_URL |
| `perfil.html` / `perfil_pagina.js` | S4.8/S4.9: pestañas + panel de agente (solo +2/+377 líneas desde la base común) |
| `index.html`, `llaves.html`, `torneos.html`, `llaves_pagina.js` | SIN CAMBIOS desde la base común → el trabajo nuestro entra directo |
| `paginas.css` | +4 líneas (sin-rango) desde la base común |
| CI | `.github/workflows/cloudflare-deploy.yml`: push a `main` → `wrangler deploy` a producción (account `8f2424e9…`, worker `vants`) |
| No tiene | `wrangler.preview.toml`, `requisitos-torneo.js`, assets de insignias, motor de logros, nav 3 categorías |

## 3. Qué se trajo (10 commits de la línea `preview/nav-3-categorias` + 1 de `preview/vants-cf`)

| Commit origen | Contenido | Resultado del port |
|---|---|---|
| `d5465b8` | Nav 3 categorías SALA · TORNEOS · CLIPS en 17 páginas + origen preview en `SITE_ORIGINS` + `wrangler.preview.toml` | ✔ limpio |
| `f1e6365` | Logo real VANTS en modales de registro (`v44-*`) + `vants-logo-circular.png` | ✔ limpio |
| `585f7e7` | Logos FACEIT/Discord/Google en botones de registro | ✔ limpio |
| `2af56bf` | Registro obligatorio + ficha con arte/restricciones/participantes + `requisitos-torneo.js` + `ficha-valorant.jpg` | ✔ reconstruido sin el ruido de ~264 cambios de modo (chmod) |
| `2f37b6c` | Barra de estado del torneo 0/16 (S4.10) | ✔ limpio |
| `ff47101` | Caras del arte visibles, aviso sin inscritos, bracket 16 con logos | ✔ limpio |
| `14ee65b` | Alineación exacta del árbol + chip BO anclado | ✔ limpio |
| `0fffa44` | Fuera el texto de revancha del divisor | ✔ limpio |
| `5a91ce8` | **Fuera TODO el cuadro inferior — eliminación directa** (llaves.html, llames_pagina.js, paginas.css, torneos.html) | ✔ limpio |
| `8541731` | **VANTS ACHIEVEMENTS & BADGE ENGINE completo**: `logros-core.js`, `logros-motor.js`, `db/logros/0001_logros_inicial.sql`, API `/api/badges` · `/api/me/badges*` · `/api/players/:id/badges` · `/api/achievements/ingest|pump` · `/api/admin/achievements/*`, hooks en `match.finished` (Outbox), pump `scheduled()` con cron, galería en perfil (VANTS BADGE COLLECTION + destacadas ≤3 + animación ACHIEVEMENT UNLOCKED), panel `/admin-logros`, 12 insignias con assets PNG/WebP (32→1024), 8 docs en `docs/achievements/`, `test_logros.js` (27 pruebas) y `firmar_e2e.mjs` | ✔ limpio; hooks verificados en las rutas reales del oficial |

### Descartado a propósito

- `468280a` «Lecturas públicas sobre D1 + fallback vantsdata»: el oficial ya tiene
  TODA la arquitectura D1 propia (commit `686da9e`) — traerlo duplicaría esquema
  (`vants-server/d1/schema.sql`, `test-d1.mjs`, `sincronizar-d1.mjs`) sobre una base
  que ya no existe. El espejo que lee el motor es el `env.DB` real de producción.
- Ruido de chmod de la era preview (≈264 archivos con solo cambio de modo).
- El perfil viejo de Prewiew (▸CS2 + RESUMEN): nunca se tocó — el oficial conserva
  su S4.8/S4.9 íntegro (verificado: pestañas, `sin-rango`, panel de agente).

## 4. Infraestructura nueva en producción (decisión documentada)

| Recurso | Valor | Nota |
|---|---|---|
| D1 exclusiva del engine | `vants-logros-db` (id `481584c7-bc47-434b-aa73-3aa066b440f7`) | Creada en la cuenta VANTS; migración `0001_logros_inicial.sql` aplicada |
| Binding | `ACH_DB` en `wrangler.toml` | `vants-db` (binding DB) sigue siendo SOLO lectura desde el engine |
| Cron | `* * * * *` → `scheduled()` | Pump del Outbox cada minuto; sin `ACH_DB` sería no-op |
| R2 | Comentado | La galería sirve `/assets/badges/**` estáticos; misma decisión que preview (docs/achievements/ASSETS.md) |
| `VANTS_BUS_SECRET` | Ya existía en el worker | Lo usan el bus y la firma HMAC de `/api/achievements/ingest` |

Degradación honesta: si `ACH_DB` no estuviera vinculada, el motor responde
`503 logros_no_config` y **todo lo demás de la web sigue funcionando igual**.

## 5. Verificación del port

- `node --check` OK en: `worker.js`, `logros-core.js`, `logros-motor.js`,
  `perfil_pagina.js`, `perfil_logros.js`, `admin_logros.js`, `llaves_pagina.js`,
  `requisitos-torneo.js`, `vants-bus-client.js`.
- `node vants-server/scripts/test_logros.js` → **27/27 PASS** (idempotencia,
  elegibilidad CHAMPION, umbral VETERAN, destacadas ≤3, backoff/DLQ del outbox,
  firma HMAC anti-replay, migración idempotente, catálogo de 12 insignias, sin PII).
- `llaves.html`/`torneos.html`: 0 coincidencias de «INFERIORES»/«DOBLE ELIMINACIÓN»;
  «ELIMINACIÓN DIRECTA» + barra 0/16 presentes.
- `perfil.html`/`perfil_pagina.js`: S4.8/S4.9 intacto (pestañas, agente, sin-rango)
  + bloque VANTS BADGE COLLECTION + `destacadas-fila` + modal ACHIEVEMENT UNLOCKED.
- Hook del motor dentro del `estado === 'final'` del worker oficial: el evento
  `match.finished` se encola al Outbox ANTES del `waitUntil` del bus, con
  `finalizadoEn` declarado una sola vez (sin duplicados).

## 6. Después del merge

1. El CI (`cloudflare-deploy.yml`) despliega el worker `vants` a producción.
2. Comprobaciones: `GET /api/health`, `GET /api/badges` (catálogo 200),
   `/llaves` sin cuadro inferior, `/torneos` con barra de cupos,
   `/perfil` con la colección.
3. Admin de logros en `/admin-logros` (X-Admin-Token).
