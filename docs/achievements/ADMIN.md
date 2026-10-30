# ADMIN — Manual de ADMINISTRATION → ACHIEVEMENTS

URL: **`/admin-logros`** (solo preview). Acceso: sesión Auth0 con
`players.role = 'owner'` (verificado en el servidor en **cada** llamada; el
panel sin permisos muestra el aviso y la API responde 403). Toda operación
queda en `ach_audit_log`.

## Procesamiento de eventos
- **KPIs**: pendientes outbox · procesados · en error (DLQ) · eventos inbox.
- **RECONCILIAR Y REPROCESAR**: re-encola los eventos en `error` (DLQ
  funcional) con intentos a 0, **redescubre finales oficiales cuyo evento no
  llegó a encolarse** (auto-sanado) y ejecuta el pump. Idempotente: reejecutar
  no duplica nada.
- **EJECUTAR PUMP AHORA**: procesa el outbox pendiente inmediatamente (también
  corre solo cada minuto por cron).
- Tablas: DLQ (eventos agotados con intentos y fecha) y **auditoría reciente**
  (actor, acción, objetivo, fecha).

## Catálogo
- Las 12 insignias con su PNG real, categoría, rareza, tipo de concesión,
  versión gráfica y orden.
- **PAUSAR/ACTIVAR**: pausa la insignia (deja de concederse y de mostrarse en
  catálogos públicos; las concesiones históricas se conservan).
- **GUARDAR**: edita la descripción (máx. 300). El requisito y el orden se
  editan con la misma llamada (`PATCH /api/admin/achievements/badges/:code`).

## Reglas de desbloqueo
- Tabla de todas las reglas versionadas (insignia, tipo, versión, condiciones
  JSON, evento fuente, estado).
- **PAUSAR/ACTIVAR** cada regla — así se "congela" TOP 10 cuando exista el
  congelador de temporada, o se apaga VETERAN sin desplegar código.
- **CREAR REGLA (NUEVA VERSIÓN)**: badge + tipo + evento fuente + condiciones
  JSON (validadas: JSON válido ≤ 4000 bytes, `source_event` con formato de
  evento). Cambiar condiciones **crea versión nueva** para preservar qué
  condiciones estaban vigentes en cada concesión histórica.
- Vista previa/simulación: el JSON y el estado del último procesamiento se
  ven en la tabla; la simulación con concesión real exige pasar por
  `grant` (auditado) — el motor jamás concede en una "vista".

## Jugadores
- **CONSULTAR JUGADOR**: sub de Auth0 → colección completa con estado, fecha y
  evidencia de cada insignia.
- **CONCEDER**: sub + insignia + justificación (8–500, obligatoria). Si la
  clave de idempotencia ya existe responde `motivo: duplicada` — nunca
  duplica.
- **REVOCAR**: sub+insignia o award_id + motivo obligatorio. Conserva el
  historial (`status='revoked'`) y notifica al bus.

## Recursos gráficos
- Lista completa del manifiesto: vista previa, archivo, tamaño (1024→32),
  **checksum sha256** y WebP asociado.
- **Detección de imágenes ausentes** en vivo: cada PNG se comprueba al cargar
  el panel; las ausentes se marcan en rojo (`AUSENTE`).
- Publicar versión nueva: subir a R2 con clave `badges/v<next>/…`, registrar
  en `badge_asset_variants` y actualizar `image_version` — nunca se
  sobrescriben archivos referenciados.

## Seguridad operativa
- El panel nunca manda `userId` propio: el sub sale de la sesión.
- Conceder a un jugador ES una operación dirigida (sub objetivo + justificación
  + auditoría).
- No se exponen secretos, DATABASE_URL ni credenciales; los fallos de la API
  devuelven códigos (`solo_owner`, `sin_sesion`, `logros_no_config`).
