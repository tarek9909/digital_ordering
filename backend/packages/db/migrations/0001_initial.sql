-- 0001 initial schema: generated from TRD §7.3–7.8, ordered by foreign-key dependencies (TR-DB-09).
-- Engine InnoDB, utf8mb4, utf8mb4_0900_ai_ci (TR-DB-01). Do not edit once released; add new migrations instead (TR-DB-07).
-- Deviation from the TRD text: tenant_memberships.tenant_id FK has no ON DELETE CASCADE (see Implementation Plan §16 #5).

CREATE TABLE platform_users (
  id               CHAR(36)     NOT NULL PRIMARY KEY,
  email            VARCHAR(254) NOT NULL UNIQUE,
  name             VARCHAR(120) NOT NULL,
  password_hash    VARCHAR(255) NULL,                    -- argon2id; NULL until the invitation is accepted
  role             ENUM('super_admin','support','finance') NOT NULL,
  status           ENUM('invited','active','disabled') NOT NULL DEFAULT 'invited',
  totp_secret_enc  VARBINARY(512) NULL,
  mfa_enrolled_at  DATETIME(3)  NULL,
  last_sign_in_at  DATETIME(3)  NULL,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE platform_webauthn_credentials (
  id               CHAR(36)       NOT NULL PRIMARY KEY,
  platform_user_id CHAR(36)       NOT NULL,
  credential_id    VARBINARY(1023) NOT NULL,
  public_key       BLOB           NOT NULL,
  sign_count       INT UNSIGNED   NOT NULL DEFAULT 0,
  transports       JSON           NULL,
  name             VARCHAR(60)    NOT NULL,
  created_at       DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at     DATETIME(3)    NULL,
  UNIQUE KEY uq_cred (credential_id(255)),
  FOREIGN KEY (platform_user_id) REFERENCES platform_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE platform_sessions (
  id               CHAR(36)    NOT NULL PRIMARY KEY,
  platform_user_id CHAR(36)    NOT NULL,
  token_hash       CHAR(64)    NOT NULL UNIQUE,            -- SHA-256 of session token
  mfa_verified_at  DATETIME(3) NULL,
  ip               VARCHAR(45) NOT NULL,
  user_agent       VARCHAR(300) NOT NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at       DATETIME(3) NOT NULL,
  revoked_at       DATETIME(3) NULL,
  FOREIGN KEY (platform_user_id) REFERENCES platform_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE plans (
  id           CHAR(36)    NOT NULL PRIMARY KEY,
  code         VARCHAR(40) NOT NULL UNIQUE,                -- trial, standard, pro, multisite
  name         VARCHAR(80) NOT NULL,
  is_public    BOOLEAN     NOT NULL DEFAULT TRUE,
  limits       JSON        NOT NULL,                       -- appendix 30.3
  features     JSON        NOT NULL,                       -- list of feature flag keys
  sort_order   SMALLINT    NOT NULL DEFAULT 0,
  archived_at  DATETIME(3) NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE plan_prices (
  id               CHAR(36)    NOT NULL PRIMARY KEY,
  plan_id          CHAR(36)    NOT NULL,
  period           ENUM('month','quarter','year') NOT NULL,
  currency         CHAR(3)     NOT NULL,
  amount_minor     INT UNSIGNED NOT NULL,                  -- per venue per period
  stripe_price_id  VARCHAR(64) NOT NULL UNIQUE,
  active           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  active_key       VARCHAR(80) AS (IF(active, CONCAT(plan_id, ':', period, ':', currency), NULL)) STORED,
  UNIQUE KEY uq_active_price (active_key),                -- one active price per plan, period and currency
  FOREIGN KEY (plan_id) REFERENCES plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE feature_flags (
  flag_key     VARCHAR(60)  NOT NULL PRIMARY KEY,          -- e.g. api_access, pos_connectors
  description  VARCHAR(255) NOT NULL,
  default_on   BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tenants (
  id                     CHAR(36)     NOT NULL PRIMARY KEY,
  name                   VARCHAR(120) NOT NULL,
  slug                   VARCHAR(40)  NOT NULL UNIQUE,
  previous_slug          VARCHAR(40)  NULL UNIQUE,
  slug_changed_at        DATETIME(3)  NULL,
  status                 ENUM('trial','active','past_due','suspended','trial_expired','cancelled','deleted') NOT NULL DEFAULT 'trial',
  status_reason          VARCHAR(500) NULL,
  suspended_by           ENUM('billing','platform') NULL,
  plan_id                CHAR(36)     NOT NULL,
  complimentary          BOOLEAN      NOT NULL DEFAULT FALSE,
  trial_ends_at          DATETIME(3)  NULL,
  past_due_since         DATETIME(3)  NULL,
  grace_ends_at          DATETIME(3)  NULL,
  suspended_at           DATETIME(3)  NULL,
  cancelled_at           DATETIME(3)  NULL,
  deletion_requested_at  DATETIME(3)  NULL,                -- owner request; 7-day cancel window (TR-PRV-08)
  purge_after            DATETIME(3)  NULL,                -- 90 days after trial_expired/cancelled
  deleted_at             DATETIME(3)  NULL,
  country                CHAR(2)      NOT NULL,
  default_locale         VARCHAR(10)  NOT NULL,
  billing_email          VARCHAR(254) NULL,
  tax_id                 VARCHAR(40)  NULL,
  stripe_customer_id     VARCHAR(64)  NULL UNIQUE,
  created_via            ENUM('self_signup','platform') NOT NULL,
  status_before_suspension ENUM('trial','active','past_due') NULL,
  last_activity_at       DATETIME(3)  NULL,                -- updated at most every 10 min (FR-SA-04)
  created_at             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_status (status),
  FOREIGN KEY (plan_id) REFERENCES plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tenant_feature_overrides (
  tenant_id   CHAR(36)    NOT NULL,
  flag_key    VARCHAR(60) NOT NULL,
  enabled     BOOLEAN     NOT NULL,
  set_by      CHAR(36)    NOT NULL,                        -- platform user
  set_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, flag_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (flag_key)  REFERENCES feature_flags(flag_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE platform_settings (
  setting_key  VARCHAR(80) NOT NULL PRIMARY KEY,           -- appendix 30.4
  value        JSON        NOT NULL,
  updated_by   CHAR(36)    NULL,
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE chimes (
  id           CHAR(36)    NOT NULL PRIMARY KEY,
  code         VARCHAR(40) NOT NULL UNIQUE,
  name         VARCHAR(80) NOT NULL,
  file_key     VARCHAR(255) NOT NULL,                      -- S3 key, MP3 + OGG
  duration_ms  INT UNSIGNED NOT NULL,                      -- max 3000
  loudness_lufs DECIMAL(4,1) NOT NULL,                     -- normalised to -14 LUFS
  active       BOOLEAN     NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE languages (
  code              VARCHAR(10) NOT NULL PRIMARY KEY,      -- BCP 47, e.g. en, ar, fr-CA
  name              VARCHAR(60) NOT NULL,
  direction         ENUM('ltr','rtl') NOT NULL DEFAULT 'ltr',
  customer_enabled  BOOLEAN     NOT NULL DEFAULT FALSE,
  tts_lang          VARCHAR(10) NULL                       -- BCP 47 voice tag for speech
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE legal_documents (
  id            CHAR(36)    NOT NULL PRIMARY KEY,
  kind          ENUM('terms','privacy','dpa','customer_privacy') NOT NULL,
  version       VARCHAR(20) NOT NULL,
  locale        VARCHAR(10) NOT NULL,
  content_key   VARCHAR(255) NOT NULL,                     -- S3 key of rendered HTML
  published_at  DATETIME(3) NULL,
  UNIQUE KEY uq_doc (kind, version, locale)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE legal_acceptances (
  id            CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id     CHAR(36)    NOT NULL,
  user_id       CHAR(36)    NOT NULL,
  document_id   CHAR(36)    NOT NULL,
  accepted_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ip            VARCHAR(45) NOT NULL,
  KEY ix_tenant (tenant_id),
  FOREIGN KEY (tenant_id)   REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES legal_documents(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE announcements (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  message     JSON         NOT NULL,                       -- {locale: text}
  severity    ENUM('info','warning','critical') NOT NULL,
  target      JSON         NOT NULL,                       -- {"all":true} | {"tenantIds":[...]} | {"plans":[...]}
  starts_at   DATETIME(3)  NOT NULL,
  ends_at     DATETIME(3)  NOT NULL,
  created_by  CHAR(36)     NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_log (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  occurred_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actor_type          ENUM('platform_user','user','staff_device','staff_member','api_key','system','support') NOT NULL,
  actor_id            CHAR(36)     NULL,
  tenant_id           CHAR(36)     NULL,                   -- NULL = platform-level action
  support_session_id  CHAR(36)     NULL,
  purpose             ENUM('support','security','billing','legal','operations') NULL,  -- FR-SUP-07, platform actors
  action              VARCHAR(80)  NOT NULL,               -- appendix 30.2
  entity_type         VARCHAR(40)  NOT NULL,
  entity_id           VARCHAR(64)  NULL,
  before_data         JSON         NULL,
  after_data          JSON         NULL,
  visible_to_tenant   BOOLEAN      NOT NULL,
  ip                  VARCHAR(45)  NULL,
  request_id          CHAR(36)     NULL,
  KEY ix_tenant_time (tenant_id, occurred_at),
  KEY ix_actor (actor_type, actor_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;  -- app_rw has INSERT, SELECT only; no FK so entries outlive deleted entities (tenant rows anonymised, section 21)

CREATE TABLE tenant_notes (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36)     NOT NULL,
  author_id   CHAR(36)     NOT NULL,
  body        TEXT         NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_tenant (tenant_id, created_at),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES platform_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE support_sessions (
  id                  CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id           CHAR(36)     NOT NULL,
  platform_user_id    CHAR(36)     NOT NULL,
  reason              VARCHAR(500) NOT NULL,
  kind                ENUM('approved','emergency') NOT NULL DEFAULT 'approved',
  status              ENUM('requested','active','refused','ended','expired','cancelled') NOT NULL,
  approval_code_hash  CHAR(64)     NULL,                   -- one-time phone code
  decided_by_user_id  CHAR(36)     NULL,
  duration_minutes    SMALLINT     NOT NULL DEFAULT 120,
  requested_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  decided_at          DATETIME(3)  NULL,
  expires_at          DATETIME(3)  NULL,
  ended_at            DATETIME(3)  NULL,
  ended_by            ENUM('platform','tenant','system') NULL,
  KEY ix_tenant_status (tenant_id, status),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (platform_user_id) REFERENCES platform_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE users (
  id                 CHAR(36)     NOT NULL PRIMARY KEY,
  email              VARCHAR(254) NOT NULL UNIQUE,          -- stored lower-case
  email_verified_at  DATETIME(3)  NULL,
  name               VARCHAR(120) NOT NULL,
  password_hash      VARCHAR(255) NULL,                     -- NULL when only Google/Apple sign-in
  locale             VARCHAR(10)  NOT NULL DEFAULT 'en',
  totp_secret_enc    VARBINARY(512) NULL,                   -- optional MFA for tenant users
  mfa_enrolled_at    DATETIME(3)  NULL,
  disabled_at        DATETIME(3)  NULL,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE user_identities (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  user_id     CHAR(36)     NOT NULL,
  provider    ENUM('google','apple') NOT NULL,
  subject     VARCHAR(255) NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_provider_subject (provider, subject),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tenant_memberships (
  id          CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36)    NOT NULL,
  user_id     CHAR(36)    NOT NULL,
  role        ENUM('owner','manager') NOT NULL,
  status      ENUM('active','removed') NOT NULL DEFAULT 'active',
  weekly_summary BOOLEAN NOT NULL DEFAULT TRUE,             -- FR-RPT-05 opt-out
  owner_key   CHAR(36) AS (IF(role = 'owner' AND status = 'active', tenant_id, NULL)) STORED,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_member (tenant_id, user_id),
  UNIQUE KEY uq_one_owner (owner_key),                      -- BR-20: at most one active owner
  KEY ix_user (user_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),  -- RESTRICT: MySQL forbids CASCADE on a base column of a stored generated column (owner_key); purge deletes memberships first (TR-PRV-12)
  FOREIGN KEY (user_id)   REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE invitations (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id    CHAR(36)     NOT NULL,
  email        VARCHAR(254) NOT NULL,
  role         ENUM('owner','manager') NOT NULL,           -- owner only for platform-created tenants and transfers
  token_hash   CHAR(64)     NOT NULL UNIQUE,
  invited_by_type ENUM('user','platform_user') NOT NULL,
  invited_by   CHAR(36)     NOT NULL,
  expires_at   DATETIME(3)  NOT NULL,                       -- 7 days
  accepted_at  DATETIME(3)  NULL,
  revoked_at   DATETIME(3)  NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_tenant (tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE user_sessions (
  id             CHAR(36)     NOT NULL PRIMARY KEY,
  user_id        CHAR(36)     NOT NULL,
  tenant_id      CHAR(36)     NULL,                        -- NULL on www chooser session
  host           VARCHAR(100) NOT NULL,
  token_hash     CHAR(64)     NOT NULL UNIQUE,
  mfa_verified_at DATETIME(3) NULL,
  ip             VARCHAR(45)  NOT NULL,
  user_agent     VARCHAR(300) NOT NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at     DATETIME(3)  NOT NULL,
  revoked_at     DATETIME(3)  NULL,
  KEY ix_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE email_tokens (
  id          CHAR(36)    NOT NULL PRIMARY KEY,
  user_id     CHAR(36)    NOT NULL,
  purpose     ENUM('verify_email','reset_password','change_email') NOT NULL,
  token_hash  CHAR(64)    NOT NULL UNIQUE,
  new_email   VARCHAR(254) NULL,
  expires_at  DATETIME(3) NOT NULL,                        -- verify 24 h, reset 1 h
  used_at     DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE venues (
  id                  CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id           CHAR(36)     NOT NULL,
  name                VARCHAR(120) NOT NULL,
  venue_code          CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,  -- TR-URL-02 (stored upper-case)
  address             JSON         NULL,
  time_zone           VARCHAR(64)  NOT NULL,                 -- IANA, e.g. Europe/Berlin
  locales             JSON         NOT NULL,                 -- ["en","ar"], first = primary
  logo_key            VARCHAR(255) NULL,
  brand_color         CHAR(7)      NOT NULL DEFAULT '#1F6FEB',
  messages            JSON         NOT NULL,                 -- per locale, appendix 30.5
  settings            JSON         NOT NULL,                 -- validated by Zod, appendix 30.5
  reset_time          TIME         NOT NULL DEFAULT '04:00:00',
  pending_reset_time  TIME         NULL,                    -- BR-27: applies from pending_from_date
  pending_auto_close_time TIME     NULL,
  pending_from_date   DATE         NULL,
  auto_close_time     TIME         NOT NULL DEFAULT '04:00:00',
  next_auto_close_at  DATETIME(3)  NOT NULL,                 -- UTC, recomputed on change and after each run
  status              ENUM('active','archived') NOT NULL DEFAULT 'active',
  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY ix_autoclose (status, next_auto_close_at),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE counters (
  id          CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36)    NOT NULL,
  venue_id    CHAR(36)    NOT NULL,
  name        VARCHAR(60) NOT NULL,
  prefix      VARCHAR(3)  NULL,                            -- A, B, D1 ...; NULL = no prefix
  sort_order  SMALLINT    NOT NULL DEFAULT 0,
  archived_at DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_prefix (venue_id, prefix),
  FOREIGN KEY (tenant_id, venue_id) REFERENCES venues(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE number_sequences (
  tenant_id      CHAR(36)    NOT NULL,
  venue_id       CHAR(36)    NOT NULL,
  sequence_key   VARCHAR(36) NOT NULL,                     -- counter_id when prefixes are used, else ''
  business_date  DATE        NOT NULL,
  last_number    INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (venue_id, sequence_key, business_date),
  FOREIGN KEY (tenant_id, venue_id) REFERENCES venues(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE staff_access (
  venue_id          CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id         CHAR(36)     NOT NULL,
  staff_key_enc     VARBINARY(256) NOT NULL,               -- shown to admins to copy the link
  staff_key_hash    CHAR(64)     NOT NULL UNIQUE,           -- lookup on board open
  pin_hash          VARCHAR(255) NOT NULL,                  -- argon2id
  key_rotated_at    DATETIME(3)  NOT NULL,
  pin_changed_at    DATETIME(3)  NOT NULL,
  FOREIGN KEY (tenant_id, venue_id) REFERENCES venues(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE staff_devices (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id       CHAR(36)     NOT NULL,
  venue_id        CHAR(36)     NOT NULL,
  name            VARCHAR(60)  NOT NULL,                    -- "Counter iPad"
  mode            ENUM('board','kitchen') NOT NULL DEFAULT 'board',
  session_hash    CHAR(64)     NOT NULL UNIQUE,
  user_agent      VARCHAR(300) NOT NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  active_until    DATETIME(3)  NOT NULL,                    -- sliding: 30 days of use (FR-ACC-05)
  revoked_at      DATETIME(3)  NULL,
  revoked_reason  ENUM('removed','link_reset','pin_changed','expired','platform') NULL,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY ix_venue (tenant_id, venue_id, revoked_at),
  FOREIGN KEY (tenant_id, venue_id) REFERENCES venues(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE staff_members (                                 -- [R2] named staff (FR-ACC-07)
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id       CHAR(36)     NOT NULL,
  venue_id        CHAR(36)     NOT NULL,
  name            VARCHAR(60)  NOT NULL,
  pin_hash        VARCHAR(255) NOT NULL,                    -- personal PIN, argon2id, unique per venue (checked in code)
  active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  FOREIGN KEY (tenant_id, venue_id) REFERENCES venues(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE email_template_texts (                          -- [R1.1] console-edited texts (FR-SA-12)
  template_key    VARCHAR(60)  NOT NULL,
  locale          VARCHAR(10)  NOT NULL,
  subject         VARCHAR(200) NOT NULL,
  blocks          JSON         NOT NULL,                    -- text blocks inserted into the coded MJML layout
  updated_by      CHAR(36)     NOT NULL,
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (template_key, locale)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE displays (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id       CHAR(36)     NOT NULL,
  venue_id        CHAR(36)     NOT NULL,
  name            VARCHAR(60)  NOT NULL,
  counter_ids     JSON         NULL,                        -- NULL = all counters
  sound_enabled   BOOLEAN      NULL,                        -- last reported by the display (FR-DSP-10)
  settings        JSON         NOT NULL,                    -- appendix 30.5 (display)
  session_hash    CHAR(64)     NULL UNIQUE,
  paired_at       DATETIME(3)  NULL,
  last_seen_at    DATETIME(3)  NULL,
  revoked_at      DATETIME(3)  NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  FOREIGN KEY (tenant_id, venue_id) REFERENCES venues(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tickets (
  id                   CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id            CHAR(36)     NOT NULL,
  venue_id             CHAR(36)     NOT NULL,
  counter_id           CHAR(36)     NULL,
  business_date        DATE         NOT NULL,               -- venue-local date at creation
  number               INT UNSIGNED NOT NULL,
  display_number       VARCHAR(8)   NOT NULL,               -- prefix + number, e.g. A27
  token                CHAR(22) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,  -- TR-URL-01, TR-DB-12
  check_code           CHAR(4)      NOT NULL,
  claim_code           CHAR(4)      NOT NULL,
  status               ENUM('received','preparing','ready','collected','cancelled','expired') NOT NULL,
  version              INT UNSIGNED NOT NULL DEFAULT 1,      -- optimistic concurrency for staff/API/system changes (TR-TKT-01)
  seq                  INT UNSIGNED NOT NULL DEFAULT 1,      -- bumps on every broadcast change; clients order and resync by it (TR-RT-04)
  ready_round          SMALLINT UNSIGNED NOT NULL DEFAULT 0, -- increments on each entry into ready
  source               ENUM('staff','api','connector') NOT NULL,
  note                 VARCHAR(280) NULL,
  external_ref         VARCHAR(100) NULL,
  wait_minutes         SMALLINT UNSIGNED NULL,
  wait_base_at         DATETIME(3)  NULL,                   -- estimate counted from here
  alert_level          ENUM('push','live','closed','none') NOT NULL DEFAULT 'none',
  alert_level_at_ready ENUM('push','live','closed','none') NULL,
  acknowledged_at      DATETIME(3)  NULL,
  auto_alerts_sent     TINYINT UNSIGNED NOT NULL DEFAULT 0,  -- in current ready round
  manual_alerts_sent   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  cancel_reason        ENUM('customer_left','refunded','out_of_stock','duplicate','mistake','other') NULL,
  cancel_note          VARCHAR(200) NULL,
  created_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  received_at          DATETIME(3)  NULL,
  preparing_at         DATETIME(3)  NULL,
  ready_at             DATETIME(3)  NULL,                   -- latest entry into ready
  first_ready_at       DATETIME(3)  NULL,                   -- for preparation-time metric
  collected_at         DATETIME(3)  NULL,
  cancelled_at         DATETIME(3)  NULL,
  expired_at           DATETIME(3)  NULL,
  updated_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  open_number_key      VARCHAR(8) AS (IF(status IN ('received','preparing','ready'), display_number, NULL)) STORED,
  open_external_ref    VARCHAR(100) AS (IF(status IN ('received','preparing','ready'), external_ref, NULL)) STORED,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_open_number (venue_id, open_number_key),   -- BR-03: no duplicate open numbers
  UNIQUE KEY uq_open_ext_ref (venue_id, open_external_ref),-- FR-INT-05
  KEY ix_board (tenant_id, venue_id, status, created_at),
  KEY ix_day (tenant_id, venue_id, business_date),
  KEY ix_ext_ref (tenant_id, venue_id, external_ref),
  KEY ix_retention (created_at),
  FOREIGN KEY (tenant_id, venue_id)   REFERENCES venues(tenant_id, id)   ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, counter_id) REFERENCES counters(tenant_id, id)   -- RESTRICT: counters are archived, never deleted while tickets exist (TR-DB-13)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE ticket_events (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id    CHAR(36)    NOT NULL,
  ticket_id    CHAR(36)    NOT NULL,
  type         ENUM('created','transition','acknowledged','alert_auto','alert_manual','wait_changed',
                    'note_changed','follower_joined','claim_requested','claim_decided','alert_level_changed','rated') NOT NULL,
  from_status  ENUM('received','preparing','ready','collected','cancelled','expired') NULL,
  to_status    ENUM('received','preparing','ready','collected','cancelled','expired') NULL,
  actor_type   ENUM('staff_device','staff_member','user','api_key','system','support','customer') NOT NULL,
  actor_id     CHAR(36)    NULL,
  data         JSON        NULL,
  occurred_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_ticket (tenant_id, ticket_id, id),
  KEY ix_time (tenant_id, occurred_at),
  FOREIGN KEY (tenant_id, ticket_id) REFERENCES tickets(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE push_subscriptions (           -- per browser, may serve tickets of several tenants
  id               CHAR(36)     NOT NULL PRIMARY KEY,
  client_id        CHAR(22) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,  -- browser token
  endpoint         VARCHAR(1024) NOT NULL,
  endpoint_hash    CHAR(64)     NOT NULL UNIQUE,
  p256dh           VARCHAR(255) NOT NULL,
  auth             VARCHAR(64)  NOT NULL,
  push_service     ENUM('fcm','apns','mozilla','wns','other') NOT NULL,
  ua_family        VARCHAR(40)  NOT NULL,                   -- e.g. ios-webapp, android-chrome
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_success_at  DATETIME(3)  NULL,
  failure_count    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  revoked_at       DATETIME(3)  NULL,
  KEY ix_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;  -- deleted when no open ticket follows it (TR-PRV-03)

CREATE TABLE ticket_followers (
  id                    CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id             CHAR(36)    NOT NULL,
  ticket_id             CHAR(36)    NOT NULL,
  client_id             CHAR(22) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  push_subscription_id  CHAR(36)    NULL,
  joined_via            ENUM('ticket_qr','link','claim_code','staff_approval','home_screen') NOT NULL,
  locale                VARCHAR(10) NOT NULL,                 -- push text language for this phone
  ua_family             VARCHAR(40) NOT NULL,
  alerts_enabled_at     DATETIME(3) NULL,
  created_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_follower (ticket_id, client_id),
  KEY ix_ticket (tenant_id, ticket_id),
  FOREIGN KEY (tenant_id, ticket_id) REFERENCES tickets(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (push_subscription_id) REFERENCES push_subscriptions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;  -- live presence is kept in Redis, not here (TR-ALR-08)

CREATE TABLE claim_requests (
  id           CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id    CHAR(36)    NOT NULL,
  ticket_id    CHAR(36)    NOT NULL,
  client_id    CHAR(22) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status       ENUM('pending','approved','refused','expired') NOT NULL DEFAULT 'pending',
  decided_by   CHAR(36)    NULL,                            -- staff device
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  decided_at   DATETIME(3) NULL,
  KEY ix_pending (tenant_id, ticket_id, status),
  FOREIGN KEY (tenant_id, ticket_id) REFERENCES tickets(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE ratings (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36)     NOT NULL,
  venue_id    CHAR(36)     NOT NULL,
  ticket_id   CHAR(36)     NOT NULL UNIQUE,
  stars       TINYINT UNSIGNED NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     VARCHAR(1000) NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at  DATETIME(3)  NULL,
  KEY ix_venue_time (tenant_id, venue_id, created_at),
  FOREIGN KEY (tenant_id, ticket_id) REFERENCES tickets(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE api_keys (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id     CHAR(36)     NOT NULL,
  venue_id      CHAR(36)     NOT NULL,
  name          VARCHAR(60)  NOT NULL,
  key_prefix    CHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,  -- "pk_live_XXXX", shown in admin
  secret_hash   CHAR(64)     NOT NULL,                     -- SHA-256 (key has 190 bits of entropy)
  created_by    CHAR(36)     NOT NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at  DATETIME(3)  NULL,
  revoked_at    DATETIME(3)  NULL,
  KEY ix_tenant (tenant_id, venue_id),
  FOREIGN KEY (tenant_id, venue_id) REFERENCES venues(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE idempotency_keys (
  tenant_id      CHAR(36)     NOT NULL,
  api_key_id     CHAR(36)     NOT NULL,
  idem_key       VARCHAR(255) NOT NULL,
  request_hash   CHAR(64)     NOT NULL,
  status_code    SMALLINT     NULL,                        -- NULL while in progress
  response_body  JSON         NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (api_key_id, idem_key),
  KEY ix_purge (created_at),
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE webhook_endpoints (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  tenant_id       CHAR(36)      NOT NULL,
  venue_id        CHAR(36)      NULL,                      -- NULL = all venues of the tenant
  url             VARCHAR(2048) NOT NULL,                  -- https only
  events          JSON          NOT NULL,
  secret_enc      VARBINARY(256) NOT NULL,
  secret_next_enc VARBINARY(256) NULL,                     -- during rotation both secrets sign (TR-WH-01)
  secret_rotated_at DATETIME(3) NULL,
  status          ENUM('active','disabled') NOT NULL DEFAULT 'active',
  disabled_reason ENUM('manual','failing') NULL,
  failure_streak  INT UNSIGNED  NOT NULL DEFAULT 0,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE webhook_deliveries (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id       CHAR(36)    NOT NULL,
  endpoint_id     CHAR(36)    NOT NULL,
  event_id        CHAR(36)    NOT NULL,                    -- stable across retries
  event_type      VARCHAR(40) NOT NULL,
  payload         JSON        NOT NULL,
  attempt         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  status          ENUM('pending','succeeded','failed','abandoned') NOT NULL DEFAULT 'pending',
  response_code   SMALLINT    NULL,
  response_ms     INT UNSIGNED NULL,
  error           VARCHAR(300) NULL,
  next_attempt_at DATETIME(3) NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_endpoint (tenant_id, endpoint_id, created_at),
  FOREIGN KEY (tenant_id, endpoint_id) REFERENCES webhook_endpoints(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE pos_connections (                              -- [R2]
  id                   CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id            CHAR(36)    NOT NULL,
  venue_id             CHAR(36)    NOT NULL,
  provider             VARCHAR(40) NOT NULL,
  external_location_id VARCHAR(120) NOT NULL,
  credentials_enc      VARBINARY(4096) NOT NULL,           -- OAuth tokens
  status               ENUM('connected','error','disconnected') NOT NULL,
  settings             JSON        NOT NULL,               -- status mapping
  last_sync_at         DATETIME(3) NULL,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_provider_location (provider, external_location_id),
  FOREIGN KEY (tenant_id, venue_id) REFERENCES venues(tenant_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE subscriptions (
  id                      CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id               CHAR(36)    NOT NULL UNIQUE,
  stripe_subscription_id  VARCHAR(64) NOT NULL UNIQUE,
  plan_id                 CHAR(36)    NOT NULL,
  period                  ENUM('month','quarter','year') NOT NULL,
  venue_quantity          SMALLINT UNSIGNED NOT NULL,
  stripe_status           VARCHAR(30) NOT NULL,            -- mirror of Stripe status
  current_period_start    DATETIME(3) NOT NULL,
  current_period_end      DATETIME(3) NOT NULL,
  cancel_at_period_end    BOOLEAN     NOT NULL DEFAULT FALSE,
  pending_plan_id         CHAR(36)    NULL,                -- scheduled downgrade
  updated_at              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id)   REFERENCES plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE invoices (
  id                 CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id          CHAR(36)    NOT NULL,
  stripe_invoice_id  VARCHAR(64) NOT NULL UNIQUE,
  number             VARCHAR(40) NULL,
  currency           CHAR(3)     NOT NULL,
  subtotal_minor     INT         NOT NULL,
  tax_minor          INT         NOT NULL,
  total_minor        INT         NOT NULL,
  amount_paid_minor  INT         NOT NULL,
  status             ENUM('draft','open','paid','uncollectible','void') NOT NULL,
  hosted_url         VARCHAR(1024) NULL,
  pdf_url            VARCHAR(1024) NULL,
  period_start       DATETIME(3) NOT NULL,
  period_end         DATETIME(3) NOT NULL,
  issued_at          DATETIME(3) NOT NULL,
  KEY ix_tenant (tenant_id, issued_at),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;  -- invoice copies for tax law are retained in Stripe, not here (section 21)

CREATE TABLE stripe_events (
  id            VARCHAR(64) NOT NULL PRIMARY KEY,           -- Stripe event id, dedupe
  type          VARCHAR(80) NOT NULL,
  received_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at  DATETIME(3) NULL,
  error         VARCHAR(500) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE outbox (                                         -- transactional outbox (TR-EVT-01)
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id     CHAR(36)    NULL,
  topic         VARCHAR(60) NOT NULL,                       -- ticket.updated, ticket.created ...
  payload       JSON        NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  published_at  DATETIME(3) NULL,
  KEY ix_unpublished (published_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE data_exports (
  id            CHAR(36)    NOT NULL PRIMARY KEY,
  tenant_id     CHAR(36)    NOT NULL,
  requested_by  CHAR(36)    NOT NULL,
  status        ENUM('queued','running','ready','failed','expired') NOT NULL,
  file_key      VARCHAR(255) NULL,
  size_bytes    BIGINT UNSIGNED NULL,
  expires_at    DATETIME(3) NULL,                           -- 7 days after ready
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_tenant (tenant_id, created_at),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE report_daily (                                    -- nightly roll-up, kept after ticket anonymisation
  tenant_id               CHAR(36)    NOT NULL,
  venue_id                CHAR(36)    NOT NULL,
  counter_key             VARCHAR(36) NOT NULL,              -- '' = no counter
  business_date           DATE        NOT NULL,
  hour_local              TINYINT     NOT NULL,              -- 0-23, 24 = whole day
  tickets_created         INT UNSIGNED NOT NULL,
  tickets_collected       INT UNSIGNED NOT NULL,
  tickets_cancelled       INT UNSIGNED NOT NULL,
  tickets_expired         INT UNSIGNED NOT NULL,
  tickets_expired_uncollected_ready INT UNSIGNED NOT NULL,
  prep_seconds_p50        INT UNSIGNED NULL,
  prep_seconds_p90        INT UNSIGNED NULL,
  pickup_seconds_p50      INT UNSIGNED NULL,
  pickup_seconds_p90      INT UNSIGNED NULL,
  total_seconds_p50       INT UNSIGNED NULL,
  reach_push              INT UNSIGNED NOT NULL,
  reach_live              INT UNSIGNED NOT NULL,
  reach_closed            INT UNSIGNED NOT NULL,
  reach_none              INT UNSIGNED NOT NULL,
  acknowledged            INT UNSIGNED NOT NULL,
  needed_repeat           INT UNSIGNED NOT NULL,
  ready_undone            INT UNSIGNED NOT NULL,
  ratings_count           INT UNSIGNED NOT NULL,
  ratings_sum             INT UNSIGNED NOT NULL,
  rating_dist             JSON        NOT NULL,              -- counts per star 1-5
  prep_hist               JSON        NOT NULL,              -- histogram buckets (TR-RPT-07)
  pickup_hist             JSON        NOT NULL,
  total_hist              JSON        NOT NULL,
  cancel_reasons          JSON        NOT NULL,
  ua_reach                JSON        NOT NULL,              -- alert level by ua_family (platform report)
  PRIMARY KEY (tenant_id, venue_id, counter_key, business_date, hour_local),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE platform_metrics_daily (                         -- console reports, no tenant data
  metric_date        DATE        NOT NULL PRIMARY KEY,
  tenants_by_status  JSON        NOT NULL,
  tenants_by_plan    JSON        NOT NULL,
  signups            INT UNSIGNED NOT NULL,
  conversions        INT UNSIGNED NOT NULL,
  cancellations      INT UNSIGNED NOT NULL,
  mrr_minor          JSON        NOT NULL,                  -- per currency
  tickets            INT UNSIGNED NOT NULL,
  alerts_sent        INT UNSIGNED NOT NULL,
  push_failures      INT UNSIGNED NOT NULL,
  webhook_failures   INT UNSIGNED NOT NULL,
  reach_by_ua        JSON        NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
