# BADGE-RULES — Las 12 insignias oficiales y sus requisitos

Catálogo sembrado en `badge_definitions` (migración 0001) y espejado en
`logros-core.js` (única fuente de lógica). El texto lo renderiza HTML;
los PNG no llevan letras.

## Membresías (6)

| Código | Rareza | Color | Concesión | Estado |
|---|---|---|---|---|
| `MEMBER` | common | acero `#8b93a7` | Automática al completar el registro (primera interacción autenticada con el motor). | **Activa** |
| `PLUS` | rare | azul/cromo `#2f7bff` | Suscripción PLUS confirmada y vigente por el proveedor de pagos. | **Dormida** — no hay pagos; no se finge |
| `PRO` | epic | rojo/negro `#ff0d2e` | Suscripción PRO confirmada y vigente. | **Dormida** |
| `ELITE` | legendary | dorado/negro `#f5c044` | Suscripción ELITE confirmada y vigente. | **Dormida** |
| `CREATOR` | epic | violeta `#b44cff` | Administración aprueba la solicitud del creador (con justificación + auditoría). | Activa vía admin |
| `PARTNER` | legendary | platino `#c9d6e8` | Administración confirma colaboración oficial. | Activa vía admin |

Regla de expiración: cuando `membership_entitlements` marca
`expired/cancelled/refunded` (o `provider='none'`), el motor **revoca** la
insignia de tier correspondiente conservando el historial.

## Logros competitivos (4)

### CHAMPION (legendary · trofeo dorado)
Se concede **automáticamente** cuando el motor procesa `match.finished` y verifica
en el espejo que:
- el torneo es **oficial** (`is_demo = 0`),
- el estado del torneo es `finished` (un torneo cancelado NUNCA concede),
- la final (`ronda='f'`) está `final` con `ganador` identificado,
- los candidatos son **los subs de Auth0 de la plantilla ganadora** — no cualquier
  inscrito, no el perdedor, no cuentas sin sub.
Evidencia guardada: `match_id`, `tournament_id`, `tournament_nombre`, marcador,
fecha y plantilla de concesión.

### TOP 10 (epic · escudo rojo)
Requiere una **clasificación final congelada** de una temporada oficial
(`ranking.season.finalized`). La regla está creada pero **inactiva**: no se
concede por aparecer temporalmente en el Top 10. Se activará cuando exista
el congelador de temporada; los umbrales (`positions: [1,10]`) son editables
por administración.

### RISING STAR (rare · estrella azul)
**Dormida deliberadamente**: no existe aún una fuente de estadísticas
verificadas de progresión. No se inventan métricas (instrucción explícita del
proyecto). Cuando haya fuente, se crea la versión 2 de la regla con umbrales
configurables sin tocar código.

### VETERAN (rare · escudo bronce)
Umbral inicial: **5 participaciones** en torneos oficiales **completados**
(`estado='finished'`, `is_demo=0`, inscripción `confirmado`). Cuenta
participaciones distintas (`COUNT DISTINCT torneo`); las anuladas no cuentan.
El umbral vive en `conditions_json` (`{"threshold":5}`) editable por
administración sin desplegar código. El progreso (x/5, %) se muestra en el
perfil y se actualiza con cada evento.

## Identidad (2)

| Código | Rareza | Concesión | Nota |
|---|---|---|---|
| `FOUNDER` | mythic | Lista de cuentas fundadoras autorizadas o fecha de corte definida por el propietario (modo `authorized_list`). | No se otorga indiscriminadamente; concesión admin justificada. |
| `VERIFIED` | rare | Verificación administrativa válida con justificación. | **Vincular Discord/Riot/FACEIT NO equivale a verificación** (la regla lo documenta en sus condiciones). |

## Invariantes transversales
1. Ninguna insignia se concede por datos enviados desde el navegador: el
   `userId` siempre sale de la sesión Auth0 verificada (o del hecho re-leído
   del espejo en reglas automáticas).
2. Toda concesión lleva `evidence_json` verificable + `rule_version`.
3. Toda revocación conserva historial (`status='revoked'` + motivo) y se audita.
4. Reglas versionadas: cambiar condiciones crea versión nueva, nunca pisa la
   anterior.
