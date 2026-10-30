# ARCHITECTURE — VANTS ACHIEVEMENTS & BADGE ENGINE

> Decisión completa de arquitectura en [`DECISIONS.md`](./DECISIONS.md).
> Este documento describe los componentes implementados y cómo interactúan.

## Diagrama de componentes

```mermaid
flowchart TD
    subgraph Cliente["Navegador del jugador"]
        P["perfil.html + perfil_logros.js<br/>VANTS BADGE COLLECTION"]
        A["admin-logros.html + admin_logros.js<br/>ADMINISTRATION → ACHIEVEMENTS"]
        AU["vants-auth.js<br/>Auth0 SPA (JWT)"]
    end

    subgraph Worker["Cloudflare Worker vantsnet-preview (worker.js)"]
        R["Rutas API del motor<br/>logros-motor.js"]
        CORE["Lógica pura<br/>logros-core.js"]
        SEC["Seguridad<br/>rate-limit · origen · JWT"]
        CRON["scheduled() cron * * * * *<br/>pump del outbox"]
    end

    subgraph Datos
        D1A[("D1 vants-preview-db<br/>binding ACH_DB<br/>catálogo · reglas · concesiones<br/>progreso · outbox · inbox<br/>entitlements · auditoría")]
        D1B[("D1 vants-db<br/>binding DB · espejo LECTURA<br/>pt_torneos · tournament_matches<br/>tournament_teams")]
        R2[("R2 vants-badge-assets-preview<br/>claves versionadas badges/v1/...")]
        ASSETS["Assets CDN<br/>public/assets/badges/*"]
        NEON[("Neon PostgreSQL<br/>torneos/inscripciones (fuente)<br/>players.role = owner")]
        AUTH0[("Auth0<br/>identidad · sesión · perfil")]
    end

    BUS["VANTS-BUS<br/>(vants-bus worker)"]
    DISCORD["Discord<br/>(notificaciones / futuros roles)"]

    P --> AU --> SEC
    P -->|"GET /api/me/badges<br/>POST /api/me/badges/featured"| R
    A -->|"/api/admin/achievements/*"| R
    R --> CORE
    R --> D1A
    R -->|"evidencia: SELECT solo lectura"| D1B
    R -->|"owner: players?auth0_sub=…"| NEON
    SEC --> AUTH0
    R -->|"achievement.granted / revoked"| BUS
    BUS -.-> DISCORD
    CRON --> R
    GESTIONAR["worker: /api/torneos/gestionar<br/>resultado confirmado"] -->|"encola match.finished<br/>(Transactional Outbox)"| D1A
    ASSETS --> P
    R2 -.->|"store canónico versionado"| ASSETS
```

## Flujo de una concesión automática (caso CHAMPION)

```mermaid
sequenceDiagram
    participant OW as Owner (gestionar)
    participant W as Worker
    participant OB as Outbox (ACH_DB)
    participant CR as Pump (cron/HMAC)
    participant IB as Inbox (ACH_DB)
    participant M as Espejo D1 (vants-db)
    participant BD as user_badge_awards
    participant BUS as VANTS-BUS

    OW->>W: POST /api/torneos/gestionar {accion:"resultado", estado:"final"}
    W->>W: hecho confirmado en Neon (fuente)
    W->>OB: INSERT match.finished (event_id = idEvento(matchId))
    Note over CR: cada minuto (o HMAC pump / reconcile)
    CR->>OB: SELECT pendientes vencidas
    CR->>IB: INSERT inbox (external_event_id UNIQUE) — dedupe
    CR->>M: relee el hecho REAL (nunca confía en payload)
    M-->>CR: match final + torneo finished + plantilla ganadora
    CR->>CR: logros-core.evaluarChampion() → elegibles con sub
    CR->>BD: INSERT … ON CONFLICT(idempotency_key) DO NOTHING
    CR->>BD: progress VETERAN (x/5) para ambas plantillas
    CR->>OB: encola achievement.granted
    CR->>BUS: publish achievement.granted (si el bus está configurado)
    Note over CR: si el espejo aún no reproduce el hecho → pending + backoff (1m→5m→30m→2h→6h→24h) → DLQ funcional
```

## Módulos

| Archivo | Responsabilidad | Dependencias |
|---|---|---|
| `vants-server/logros-core.js` | Lógica PURA: catálogo, idempotencia, reglas (CHAMPION/VETERAN), backoff, validaciones, HMAC, proyecciones públicas sin PII | ninguna (testeable con `node --test`) |
| `vants-server/logros-motor.js` | Ejecución sobre D1: API, outbox/inbox, pump, concesión/revocación, auditoría | logros-core |
| `vants-server/worker.js` (integración) | Dispatch de rutas + encolado en `gestionar` + `scheduled()` cron | logros-motor |
| `vants-server/db/logros/0001_logros_inicial.sql` | Esquema + catálogo semilla de 12 insignias + 12 reglas | — |
| `public/static/js/perfil_logros.js` | Colección del jugador: grid, destacadas (3), progreso, animación de desbloqueo | API del motor + Auth0 |
| `public/static/js/admin_logros.js` | Panel admin: catálogo, reglas, jugadores, procesamiento, recursos | API admin + Auth0 |
| `public/assets/badges/*` + `badge-manifest.json` | 12 insignias PNG/WebP en 6 tamaños + manifiesto con checksums | — |

## Rutas API (todas con rate-limit y validación)

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/badges` | público | Catálogo de insignias (60 s de caché) |
| GET | `/api/players/:id/badges` | público | Colección pública de un jugador (`id` = sub Auth0 URL-encoded) |
| GET | `/api/me/badges` | sesión | Colección propia + progreso + bloqueadas (+ asegura MEMBER) |
| GET | `/api/me/achievements` | sesión | Historial de concesiones/revocaciones |
| POST | `/api/me/badges/featured` | sesión | Hasta 3 insignias destacadas |
| POST | `/api/achievements/ingest` | HMAC | Ingesta de eventos al outbox |
| POST | `/api/achievements/pump` | HMAC u owner | Procesa el outbox ahora |
| GET | `/api/admin/achievements` | owner | Panel: catálogo+reglas+conteos+procesamiento |
| POST | `/api/admin/achievements/rules` | owner | Crear regla (nueva versión) |
| PATCH | `/api/admin/achievements/rules/:id` | owner | Editar regla (condiciones, pausa, vigencia) |
| PATCH | `/api/admin/achievements/badges/:code` | owner | Activar/pausar, descripción, orden |
| POST | `/api/admin/achievements/grant` | owner | Concesión manual justificada |
| POST | `/api/admin/achievements/revoke` | owner | Revocación justificada (historial intacto) |
| POST | `/api/admin/achievements/reconcile` | owner | Re-encola DLQ + redescubre finales sin evento + pump |
| GET | `/api/admin/achievements/events` | owner | Estado de outbox/inbox/DLQ/auditoría |

Degradación: si el worker no tiene `ACH_DB` (producción `vants`), todo responde
`503 logros_no_config` y el resto del sitio funciona igual.
