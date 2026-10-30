# OPERATIONS — Reintentos, fallos, reconciliación, auditoría y recuperación

## Pump: tres disparadores equivalentes
| Disparador | Origen | Nota |
|---|---|---|
| Cron `* * * * *` | `scheduled()` del worker (config preview) | continuo, sin intervención |
| `POST /api/achievements/pump` | HMAC (bus) u owner | forzado desde admin |
| `POST /api/admin/achievements/reconcile` | owner | re-encola DLQ + redescubre + pump |

`ctx.waitUntil` **no es** el mecanismo de concesión: solo dispara/optimiza; la
concesión siempre es idempotente y reanudable desde el outbox.

## Reintentos (backoff exponencial)
- `next_retry_at`: 1 min → 5 min → 30 min → 2 h → 6 h → 24 h (se mantiene en
  24 h hasta el intento 10).
- `attempts` se sincroniza en outbox e inbox (trazabilidad).
- Causas típicas de reintento: espejo D1 aún sin sincronizar el hecho
  (`espejo_sin_partido_reintenta`), Neon caído para owner, D1 sobrecargada.

## DLQ funcional
`achievement_outbox.status='error'` (agotados 10 intentos) + inbox
`failed`. Visible en el panel (Procesamiento → DLQ). Recuperación:
`RECONCILIAR` los re-encola con `attempts=0`. Nada se borra jamás.

## Reconciliación (auto-sanado)
Cada `reconcile` además **redescubre** finales oficiales (`ronda='f'`,
`estado='final'`, `ganador` no nulo, torneo `finished`, `is_demo=0`) cuyo
evento no llegó a encolarse (p. ej. `ACH_DB` caída en el momento del
resultado): recalcula `event_id` determinista y encola — si ya existía, no
duplica. Un torneo anulado después del hecho: el hecho ya concedido no se
borra automáticamente; la política es **revocación documentada** por
administración (conserva evidencia y motivo) — decisión registrada en
DECISIONS §D6.

## Tareas programadas recomendadas (futuras, documentadas)
- Revisar `membership_entitlements` vencidos → revocar tier (el motor ya lo
  aplica al procesar `membership.expired`; falta productor de pagos).
- Recalcular progresos VETERAN nocturnos (idempotente).
- Revisar roles Discord pendientes (cuando exista bot — ver DECISIONS §D7).

## Auditoría
`ach_audit_log` registra: `grant` (con eventId/ruleVersion), `revoke`,
`rule_create`, `rule_update`, `badge_update`, `featured`, `reconcile`.
Consultable en el panel y con:
```
bunx wrangler d1 execute vants-preview-db --remote -c wrangler.preview.toml \
  --command "SELECT * FROM ach_audit_log ORDER BY created_at DESC LIMIT 50"
```

## Salud y verificación rápida
```
# Catálogo vivo (12 insignias esperadas)
curl -H "User-Agent: Mozilla/5.0" https://vantsnet-preview.vants.workers.dev/api/badges | grep -o '"code"' | wc -l

# Estados del procesamiento (con sesión owner)
GET /api/admin/achievements/events

# Pruebas del motor (lógica pura + migración)
node --test vants-server/scripts/test_logros.js   # 27 pruebas
```

## Recuperación ante desastres
- La D1 de logros (`vants-preview-db`) es recreable: migración idempotente +
  el `reconcile` redescubre los hechos desde el espejo y regenera las
  concesiones (las claves de idempotencia son deterministas, así que las
  concesiones recalculadas son las mismas).
- El catálogo/reglas viven en el SQL versionado del repo.
- Los PNG viven en el repo (Assets) y en R2 versionado.
- Producción (`vants`) no participa del motor: no puede contaminarse.
