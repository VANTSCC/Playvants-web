-- ============================================================================
-- VANTS ACHIEVEMENTS & BADGE ENGINE · Migración 0001 (esquema inicial)
-- ============================================================================
-- Base: vants-preview-db (binding ACH_DB del worker vantsnet-preview).
-- PRODUCCIÓN NO SE TOCA: esta migración NUNCA se aplica a vants-db.
--
-- Aplicar (desde vants-server/, con el token de la cuenta de PREVIEW):
--   bunx wrangler d1 execute vants-preview-db --remote -c wrangler.preview.toml \
--        --file=./db/logros/0001_logros_inicial.sql
--
-- Idempotente: CREATE IF NOT EXISTS + INSERT con clave única → se puede
-- reejecutar sin duplicar catálogo ni perder concesiones.
--
-- Identidad canónica: user_id = sub de Auth0 (ver DECISIONS.md §D1).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A · badge_definitions — catálogo maestro de insignias
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS badge_definitions (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  requirement   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'competitive'
                CHECK (category IN ('membership','competitive','identity')),
  rarity        TEXT NOT NULL DEFAULT 'common'
                CHECK (rarity IN ('common','rare','epic','legendary','mythic')),
  color         TEXT NOT NULL DEFAULT '#0a0a0c',
  grant_type    TEXT NOT NULL DEFAULT 'admin'
                CHECK (grant_type IN ('auto_registry','subscription','admin','automatic_rule','founder_list')),
  image_key     TEXT,
  image_version INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 100,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_badge_def_activo ON badge_definitions (is_active, display_order);

-- ---------------------------------------------------------------------------
-- B · achievement_rules — reglas de desbloqueo versionadas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS achievement_rules (
  id              TEXT PRIMARY KEY,
  badge_id        TEXT NOT NULL REFERENCES badge_definitions(id),
  version         INTEGER NOT NULL DEFAULT 1,
  rule_type       TEXT NOT NULL
                  CHECK (rule_type IN ('event','threshold','admin','subscription','founder_list','dormant')),
  conditions_json TEXT NOT NULL DEFAULT '{}',
  source_event    TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  valid_from      TEXT,
  valid_until     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_rules_badge ON achievement_rules (badge_id, is_active, version);

-- ---------------------------------------------------------------------------
-- C · user_badge_awards — concesión definitiva (historial inmutable)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_badge_awards (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,              -- sub de Auth0
  badge_id        TEXT NOT NULL REFERENCES badge_definitions(id),
  season_id       TEXT,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','revoked','expired')),
  awarded_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at      TEXT,
  revoked_at      TEXT,
  revoked_reason  TEXT,
  evidence_json   TEXT NOT NULL DEFAULT '{}', -- evidencia verificada del hecho
  source_event_id TEXT,
  rule_version    INTEGER,
  idempotency_key TEXT NOT NULL UNIQUE,       -- sha256(user|badge|evento|periodo)
  featured_order  INTEGER,                    -- 1..3 = destacada en perfil público
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_awards_usuario ON user_badge_awards (user_id, status);
CREATE INDEX IF NOT EXISTS idx_awards_badge   ON user_badge_awards (badge_id, status);
-- Máximo 3 destacadas por usuario (índice único parcial):
CREATE UNIQUE INDEX IF NOT EXISTS uq_awards_destacada
  ON user_badge_awards (user_id, featured_order) WHERE featured_order IS NOT NULL;

-- ---------------------------------------------------------------------------
-- D · achievement_progress — progreso por jugador e insignia
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS achievement_progress (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  badge_id          TEXT NOT NULL REFERENCES badge_definitions(id),
  current_value     REAL NOT NULL DEFAULT 0,
  target_value      REAL NOT NULL DEFAULT 1,
  progress_percent  REAL NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress','completed','blocked')),
  last_evaluated_at TEXT,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (user_id, badge_id)
);

-- ---------------------------------------------------------------------------
-- E · achievement_event_inbox — eventos recibidos (procesado único)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS achievement_event_inbox (
  id                TEXT PRIMARY KEY,
  external_event_id TEXT NOT NULL UNIQUE,   -- id del evento de origen (bus/outbox)
  source            TEXT NOT NULL DEFAULT 'vants-web',
  event_type        TEXT NOT NULL,
  payload_hash      TEXT,
  received_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  processed_at      TEXT,
  processing_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (processing_status IN ('pending','processing','processed','failed')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  error_message     TEXT
);
CREATE INDEX IF NOT EXISTS idx_inbox_estado ON achievement_event_inbox (processing_status, received_at);

-- ---------------------------------------------------------------------------
-- F · achievement_outbox — mensajes pendientes de procesamiento
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS achievement_outbox (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL UNIQUE,         -- id estable del evento (idempotencia)
  event_type    TEXT NOT NULL,
  payload_json  TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  published_at  TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processing','done','error'))
);
CREATE INDEX IF NOT EXISTS idx_outbox_pend ON achievement_outbox (status, next_retry_at);

-- ---------------------------------------------------------------------------
-- G · badge_asset_variants — registro de archivos gráficos por versión
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS badge_asset_variants (
  id          TEXT PRIMARY KEY,
  badge_id    TEXT NOT NULL REFERENCES badge_definitions(id),
  version     INTEGER NOT NULL DEFAULT 1,
  format      TEXT NOT NULL CHECK (format IN ('png','webp')),
  size        INTEGER NOT NULL,               -- 1024/512/256/128/64/32
  storage_key TEXT NOT NULL,                  -- clave R2 o ruta pública
  checksum    TEXT NOT NULL,                  -- sha256 del archivo
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (badge_id, version, format, size)
);

-- ---------------------------------------------------------------------------
-- H · membership_entitlements — derechos de suscripción (la base es la autoridad)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS membership_entitlements (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  tier         TEXT NOT NULL CHECK (tier IN ('member','plus','pro','elite')),
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','expired','cancelled','refunded')),
  provider     TEXT NOT NULL DEFAULT 'none'   -- none hasta que haya pagos reales
               CHECK (provider IN ('none','stripe','paypal','manual')),
  provider_ref TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  valid_from   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  valid_until  TEXT,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (user_id, tier)
);
CREATE INDEX IF NOT EXISTS idx_entitlement_vigencia ON membership_entitlements (tier, status, valid_until);

-- ---------------------------------------------------------------------------
-- I · ach_audit_log — auditoría de TODA operación del motor/admin
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ach_audit_log (
  id            TEXT PRIMARY KEY,
  actor         TEXT NOT NULL DEFAULT 'engine',
  action        TEXT NOT NULL,                -- grant / revoke / rule_update / reconcile / featured …
  target_type   TEXT NOT NULL DEFAULT 'award',
  target_id     TEXT,
  justification TEXT,
  detail_json   TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_reciente ON ach_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_accion   ON ach_audit_log (action, created_at DESC);

-- ============================================================================
-- CATÁLOGO SEMILLA · LAS 12 INSIGNIAS OFICIALES VANTS
-- ============================================================================
INSERT INTO badge_definitions (id, code, name, description, requirement, category, rarity, color, grant_type, image_key, image_version, is_active, display_order)
VALUES
  ('bgd_member',  'MEMBER',      'MEMBER',      'Cuenta registrada en VANTS GAMES.',                        'Completar el registro de la cuenta.',                        'membership',  'common',    '#8b93a7', 'auto_registry',  'badges/member/1024.png',      1, 1, 10),
  ('bgd_plus',    'PLUS',        'PLUS',        'Suscripción PLUS activa y confirmada por el proveedor.',   'Suscripción PLUS vigente.',                                  'membership',  'rare',      '#2f7bff', 'subscription',   'badges/plus/1024.png',        1, 1, 20),
  ('bgd_pro',     'PRO',         'PRO',         'Suscripción PRO activa y confirmada por el proveedor.',    'Suscripción PRO vigente.',                                   'membership',  'epic',      '#ff0d2e', 'subscription',   'badges/pro/1024.png',         1, 1, 30),
  ('bgd_elite',   'ELITE',       'ELITE',       'Suscripción ELITE activa y confirmada por el proveedor.',  'Suscripción ELITE vigente.',                                 'membership',  'legendary', '#f5c044', 'subscription',   'badges/elite/1024.png',       1, 1, 40),
  ('bgd_creator', 'CREATOR',     'CREATOR',     'Programa de creadores aprobado por administración.',       'Aprobación de la solicitud de creador.',                     'membership',  'epic',      '#b44cff', 'admin',          'badges/creator/1024.png',     1, 1, 50),
  ('bgd_partner', 'PARTNER',     'PARTNER',     'Colaboración oficial confirmada por administración.',      'Confirmación de colaboración oficial.',                      'membership',  'legendary', '#c9d6e8', 'admin',          'badges/partner/1024.png',     1, 1, 60),
  ('bgd_champ',   'CHAMPION',    'CHAMPION',    'Campeón de un torneo oficial de VANTS GAMES.',             'Ganar la gran final de un torneo oficial completado.',       'competitive', 'legendary', '#f5c044', 'automatic_rule', 'badges/champion/1024.png',    1, 1, 110),
  ('bgd_top10',   'TOP 10',      'TOP 10',      'Top 10 de una temporada oficial congelada.',               'Terminar la temporada dentro de las 10 primeras posiciones.', 'competitive', 'epic',      '#ff0d2e', 'automatic_rule', 'badges/top-10/1024.png',      1, 1, 120),
  ('bgd_rising',  'RISING STAR', 'RISING STAR', 'Progresión competitiva destacada de la temporada.',        'Alcanzar los umbrales de progresión verificados.',           'competitive', 'rare',      '#2f7bff', 'automatic_rule', 'badges/rising-star/1024.png', 1, 1, 130),
  ('bgd_veteran', 'VETERAN',     'VETERAN',     'Participación constante en torneos oficiales.',            '5 participaciones en torneos oficiales completados.',        'competitive', 'rare',      '#b4794a', 'automatic_rule', 'badges/veteran/1024.png',     1, 1, 140),
  ('bgd_founder', 'FOUNDER',     'FOUNDER',     'Cuenta fundadora de VANTS GAMES.',                         'Pertenecer a la lista de cuentas fundadoras autorizadas.',   'identity',    'mythic',    '#f5c044', 'founder_list',   'badges/founder/1024.png',     1, 1, 150),
  ('bgd_verified','VERIFIED',    'VERIFIED',    'Identidad verificada por administración.',                 'Verificación administrativa válida.',                        'identity',    'rare',      '#2f7bff', 'admin',          'badges/verified/1024.png',    1, 1, 160)
ON CONFLICT(code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- REGLAS SEMILLA (versionadas; condiciones editables desde administración)
-- ---------------------------------------------------------------------------
INSERT INTO achievement_rules (id, badge_id, version, rule_type, conditions_json, source_event, is_active)
VALUES
  ('rul_member_1',   'bgd_member',  1, 'event',       '{"when":"account.registered"}',                                   'identity.verified',          1),
  ('rul_plus_1',     'bgd_plus',    1, 'subscription','{"tier":"plus","require":"entitlement_active"}',                   'membership.activated',       1),
  ('rul_pro_1',      'bgd_pro',     1, 'subscription','{"tier":"pro","require":"entitlement_active"}',                    'membership.activated',       1),
  ('rul_elite_1',    'bgd_elite',   1, 'subscription','{"tier":"elite","require":"entitlement_active"}',                  'membership.activated',       1),
  ('rul_creator_1',  'bgd_creator', 1, 'admin',       '{"action":"approve_creator","requires":"justification"}',          'creator.approved',           1),
  ('rul_partner_1',  'bgd_partner', 1, 'admin',       '{"action":"approve_partner","requires":"justification"}',          'partner.approved',           1),
  ('rul_champ_1',    'bgd_champ',   1, 'event',       '{"tournament":"official","state":"finished","winner":"identified","roster":"eligible_at_date"}', 'match.finished', 1),
  ('rul_top10_1',    'bgd_top10',   1, 'event',       '{"season":"frozen","positions":[1,10],"require":"official_ranking"}', 'ranking.season.finalized', 0),
  ('rul_rising_1',   'bgd_rising',  1, 'dormant',     '{"note":"sin fuente de estadisticas verificadas; no conceder"}',   null,                         0),
  ('rul_veteran_1',  'bgd_veteran', 1, 'threshold',   '{"metric":"official_tournaments_completed","threshold":5,"count":"distinct","only":"verified_participations"}', 'match.finished', 1),
  ('rul_founder_1',  'bgd_founder', 1, 'founder_list','{"mode":"authorized_list","list_source":"admin"}',                 null,                         1),
  ('rul_verified_1', 'bgd_verified',1, 'admin',       '{"action":"verify_identity","requires":"justification","note":"vincular discord/riot/faceit NO equivale a verificacion"}', 'identity.verified', 1)
ON CONFLICT(id) DO NOTHING;
