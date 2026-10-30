# VANTS ACHIEVEMENTS & BADGE ENGINE — Documento de decisión técnica

**Proyecto:** VANTS GAMES / VANTSNET · **Entorno:** Cloudflare PREVIEW (`vantsnet-preview`)
**Rama:** `preview/vants-cf` · **Producción (`vants` / `vants-db`): INTOCABLE**

Este documento es la decisión de arquitectura obligatoria previa a la implementación.
Parte de una **auditoría real del repositorio** (no de suposiciones): el prompt maestro
asumía Next.js + Prisma + PostgreSQL propio; el repo real es otra cosa, y la decisión
es respetar lo que existe (así lo exige la instrucción "respetando su arquitectura
actual" y "no crear una tercera base de datos").

---

## 1. Arquitectura real encontrada (auditoría)

| Pieza | Archivo/evidencia | Rol real |
|---|---|---|
| Cloudflare Worker | `vants-server/worker.js` (2.718 líneas) | Web estática (`public/`) + API interna (`/api/*`) + seguridad (CSP, rate-limit, bloqueo bots) |
| Identidad | `public/static/js/vants-auth.js`, `verifySesionJwt()` en worker | **Auth0** tenant `vants.eu.auth0.com`, SPA + JWT verificado server-side (JWKS / `/userinfo`) |
| Identidad canónica en datos | `tournament_teams.auth0_sub` (espejo D1), `neonGet('/players?auth0_sub=eq…')` | El **`sub` de Auth0** es la clave que ya une identidad ↔ datos competitivos |
| PostgreSQL competitivo | `NEON_API` (Data API / PostgREST) + RLS | Escrituras de torneos (`tournament_teams`, `tournament_matches`, `players.role='owner'`). El Worker **no guarda credenciales**: reenvía el JWT del usuario |
| D1 `vants-db` | binding `DB` en `wrangler.preview.toml` | **Espejo de LECTURA** de datos públicos (pt_torneos, tournament_matches…). Lo rellena `scripts/sincronizar-d1.mjs`. No se escribe desde la web |
| D1 `vants-preview-db` | existe en la cuenta (vacía) | Base del PREVIEW: hogar del dominio de logros |
| VANTS-BUS | `../vants-bus/vants-bus-client.js`, `busCliente()`, `publicarBus()` | Bus de eventos con firma HMAC (`X-VANTS-Signature`). Ya publica `match.finished` al confirmar un resultado |
| Discord | `/api/discord/notify`, `/api/discord/events` | Notificaciones REST + puente Ed25519 de eventos del bot. **No existe bot con permisos de gestión de roles** |
| No existe | Next.js, Prisma, `src/`, `contract.prisma`, Firestore | El prompt los mencionaba: no aplican, se documenta y se omite |

## 2. Decisiones

### D1 · Identidad canónica
**El `sub` de Auth0 es la identidad canónica** de `user_badge_awards.user_id`.
Justificación: es la única clave que ya relaciona sesión ↔ datos competitivos en el
sistema real (las inscripciones la guardan y las RLS de Neon filtran por ella). No se
duplican usuarios: el motor no crea cuentas, solo cuelga concesiones del `sub` ya
verificado en cada request (`No confiar en userId enviados desde el cliente`).

### D2 · Propiedad de cada dato (una sola fuente de verdad)
| Dato | Propietario |
|---|---|
| Sesión / identidad / perfil público (nick, redes) | Auth0 (Management API), como hoy |
| Hechos competitivos (partidos, torneos, inscripciones, `role='owner'`) | Neon PostgreSQL (Data API + RLS) — sin cambios |
| Espejo público de lectura de esos hechos | D1 `vants-db` (binding `DB`) — **solo lectura, INTOCABLE** |
| **Dominio de logros** (catálogo, reglas, concesiones, progreso, outbox/inbox, entitlements, auditoría) | **D1 `vants-preview-db`** (binding nuevo `ACH_DB`) |
| PNG/WebP de insignias y sus versiones | `public/assets/badges/` (CDN de Assets) + R2 `vants-badge-assets-preview` cuando el bucket exista (binding opcional `BADGE_ASSETS`) |
| Manifiesto visual | `public/assets/badges/badge-manifest.json` sincronizado con `badge_definitions` |

**No se crea ninguna tercera base de datos.** El dominio de logros vive en la D1 de
preview que ya existía vacía; `DB` no se toca (el motor solo hace `SELECT` sobre el
espejo para verificar evidencia).

### D3 · Dónde se guardan las concesiones
`user_badge_awards` en `ACH_DB`. Historial **inmutable**: revocación = `status='revoked'`
+ `revoked_at` + `revoked_reason`; nunca `DELETE`. Clave única `idempotency_key`
(derivación en §D6) garantiza una sola concesión por (usuario, insignia, evento, período).

### D4 · Cómo se reciben los eventos competitivos
1. Un hecho ocurre (p. ej. `resultado` confirmado en `/api/torneos/gestionar`).
2. El hecho ya se persistió en Neon (fuente) y el espejo D1 lo reproduce por sync.
3. El Worker escribe en `achievement_outbox` (misma request, tras confirmar el hecho)
   el evento — patrón **Transactional Outbox**: si la escritura del logro falla, el
   hecho sigue siendo verdad y el evento se reintenta.
4. El **pump** (cron `scheduled()` cada minuto + endpoint `POST /api/achievements/pump`
   firmado HMAC) mueve outbox → `achievement_event_inbox` → evaluación de reglas.
5. **El motor nunca confía en el payload**: relee el hecho real del espejo D1
   (`pt_torneos`, `tournament_matches`, `tournament_teams`). Si el espejo aún no
   reproduce el hecho, el evento queda `pending` con `attempts+1` (sin duplicar).

Compatibilidad: el contrato VANTS-BUS actual no se rompe; `match.finished` ya existe y
se consume tal cual. El motor además emite `achievement.granted` / `achievement.revoked`
hacia el bus (nuevos tipos, adición compatible y versionada).

### D5 · Cómo se gestionan los reintentos
Cloudflare **Queues requiere plan de pago**; no está disponible en esta cuenta, así que
se implementa el mismo patrón con primitivas gratuitas y equivalentes en garantías:
- `achievement_outbox` con `attempts`, `next_retry_at` y backoff exponencial
  (1 min → 5 min → 30 min → 2 h → 6 h → 24 h, máximo 10 intentos).
- Los eventos que agotan intentos quedan `status='error'` (**equivalente funcional de la
  DLQ**), visibles y reprocesables desde el panel admin (`POST /api/admin/achievements/reconcile`).
- `ctx.waitUntil` **no se usa como único mecanismo** de concesión: solo como disparador
  adicional del pump; la concesión siempre es idempotente y reanudable.

### D6 · Cómo se garantiza la consistencia
- **Idempotencia**: `idempotency_key = sha256(user_id | badge_code | source_event_id | period)`
  con `UNIQUE`. Un evento entregado 10 veces produce 1 concesión.
- **Inbox** con `external_event_id UNIQUE` + `payload_hash`: procesado único por evento.
- **Evidencia verificada**: la regla relee el hecho desde el espejo (D4). Payload solo
  sugiere *dónde* mirar.
- **Reglas versionadas**: `achievement_rules.version` + `rule_version` copiada en la
  concesión para auditoría ("qué condiciones estaban vigentes cuando se concedió").
- **Auditoría**: `ach_audit_log` registra TODA operación de escritura (motor, admin,
  reconciliación) con actor, justificación y detalle JSON.
- **Membership**: la base es la autoridad (`membership_entitlements`). Como no hay
  proveedor de pagos configurado, los tiers de suscripción quedan **dormiles** (regla
  activa pero sin fuente): no se conceden y no se fingen (instrucción explícita).

### D7 · Qué queda deliberadamente apagado (honestidad)
| Pieza | Estado | Por qué |
|---|---|---|
| PLUS / PRO / ELITE | Regla definida, **dormida** | Sin proveedor de pagos; concederlas sería fingir |
| RISING STAR | **Dormida** | Sin fuente de estadísticas verificadas; prohibido inventar métricas |
| TOP 10 | Infraestructura lista, se activa al congelar una temporada | Requiere clasificación final congelada (`ranking.season.finalized`, aún no producido) |
| Roles de Discord | **No implementado** | OAuth de identidad ≠ bot con permisos de roles; se documenta el requisito |
| Bucket R2 de producción | No se crea | Solo preview; producción cuando haya autorización |

## 3. Despliegue (solo preview)
- Worker `vantsnet-preview` + config `wrangler.preview.toml` (binding nuevo `ACH_DB`
  → `vants-preview-db`, cron de pump, R2 opcional).
- Migraciones: `vants-server/db/logros/0001_logros_inicial.sql` aplicadas SOLO a
  `vants-preview-db` con `wrangler d1 execute --remote -c wrangler.preview.toml`.
- `worker.js` es compartido con producción: toda ruta nueva degrada a `503
  logros_no_config` si falta el binding (producción queda intacta y funcional).
