# EVENTS — Contrato de eventos del motor

## Principio (Transactional Outbox + Inbox)
1. Un hecho se confirma en su fuente (Neon para torneos, Auth0 para identidad).
2. El Worker encola el evento en `achievement_outbox` (idempotente por
   `event_id` = `sha256(tipo::partes)`, estable ante reintentos).
3. El **pump** (cron `* * * * *`, `POST /api/achievements/pump` firmado, o
   `reconcile` del admin) mueve outbox → inbox → reglas → concesiones.
4. **El payload nunca es la verdad**: el motor relee el hecho del espejo D1
   (`vants-db`, solo lectura). Si el espejo aún no lo reproduce, el evento
   queda `pending` y reintenta con backoff (no se pierde, no duplica).

## Compatibilidad con VANTS-BUS
El contrato existente (`vants-bus/vants-bus-client.js`) no se rompe: el motor
**consume** `match.finished` tal cual existe y **emite** dos tipos nuevos como
adición compatible y versionada.

## Catálogo de eventos

| Evento | Productor | Consumidor (motor) | Efecto |
|---|---|---|---|
| `match.finished` | worker al confirmar `resultado` en `/api/torneos/gestionar` (+ `reconcile` lo redescubre) | regla CHAMPION + progreso VETERAN | CHAMPION a la plantilla ganadora elegible (subs verificados); progreso VETERAN x/5 a participantes confirmados |
| `identity.verified` | primera interacción autenticada con `/api/me/badges` | regla MEMBER | MEMBER automático por registro completado |
| `membership.activated` / `membership.expired` | futuros proveedores de pago (hoy: nada lo produce) | reglas PLUS/PRO/ELITE | concede/retira según `membership_entitlements` con `provider != 'none'` — **dormido hasta que haya pagos reales** |
| `ranking.season.finalized` | futuro congelador de temporadas | regla TOP 10 (inactiva) | dormido: requiere clasificación congelada y verificable |
| `tournament.completed` | reservado | — | reconocido, sin regla activa |
| `creator.approved` / `partner.approved` | acciones admin | reglas CREATOR/PARTNER | concesión por aprobación (hoy vía `grant` justificado) |
| `achievement.granted` | el motor al conceder | VANTS-BUS → notificaciones/Discord | publicación al bus; sin bus configurado es no-op |
| `achievement.revoked` | el motor al revocar | VANTS-BUS | ídem |

## Ingesta externa (HMAC, mismo contrato que VANTS-BUS)

```
POST /api/achievements/ingest
X-VANTS-TS: <unix-seconds>
X-VANTS-Signature: hex(hmac_sha256(SECRET, `${ts}.${rawBody}`))
{ "type": "match.finished", "event_id": "evt-…", "payload": { "matchId": "…" } }
```

- Ventana anti-replay ±5 min; comparación en tiempo constante.
- Requiere secret `VANTS_BUS_SECRET` del worker (el mismo del bus).
- El `payload` solo sugiere **dónde verificar**; la evidencia se relee del espejo.

## Idempotencia — garantías
- Encolado: `outbox.event_id` UNIQUE (`ON CONFLICT DO NOTHING`).
- Procesado: `inbox.external_event_id` UNIQUE + `payload_hash`.
- Concesión: `awards.idempotency_key` UNIQUE
  (`sha256(user_id|badge_code|source_event_id|periodo)`).
- Comprobado end-to-end (entorno local D1): evento duplicado y doble pump
  producen **0 concesiones extra**.
