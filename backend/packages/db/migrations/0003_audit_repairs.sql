-- Repairs from the 2026-10-22 application audit (docs/audits/2026-10-22/REPORT.md).

-- A01, A09: the outbox also carries queue jobs (durable enqueue). The bus event and the jobs are two stages, so a
-- queue outage neither blocks the realtime event nor republishes it on every relay pass.
ALTER TABLE outbox
  ADD COLUMN event_published_at DATETIME(3) NULL AFTER created_at,
  ADD COLUMN attempts INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at DATETIME(3) NULL,
  ADD COLUMN last_error VARCHAR(500) NULL;

-- A08, A31: one row per alert attempt (round + attempt key). The live/display alert is published once per attempt
-- even when the push job is retried.
CREATE TABLE alert_attempts (
  tenant_id          CHAR(36)    NOT NULL,
  ticket_id          CHAR(36)    NOT NULL,
  round              SMALLINT UNSIGNED NOT NULL,
  attempt            VARCHAR(8)  NOT NULL,                  -- '1', '2' … automatic; 'm1' … manual
  live_published_at  DATETIME(3) NULL,
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (ticket_id, round, attempt),
  KEY ix_tenant_time (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- A08, A31: per-recipient outcome of an alert attempt. A retried job sends only to recipients still marked retry.
CREATE TABLE alert_deliveries (
  tenant_id        CHAR(36)    NOT NULL,
  ticket_id        CHAR(36)    NOT NULL,
  round            SMALLINT UNSIGNED NOT NULL,
  attempt          VARCHAR(8)  NOT NULL,
  subscription_id  CHAR(36)    NOT NULL,
  outcome          ENUM('sent','retry','gone') NOT NULL,
  tries            TINYINT UNSIGNED NOT NULL DEFAULT 1,
  status_code      SMALLINT    NULL,
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (ticket_id, round, attempt, subscription_id),
  KEY ix_tenant_time (tenant_id, updated_at),
  KEY ix_outcome_time (outcome, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- A16: every old slug keeps redirecting and stays reserved for 180 days (TR-URL-03), not only the latest one.
CREATE TABLE tenant_slug_aliases (
  slug        VARCHAR(40) NOT NULL PRIMARY KEY,
  tenant_id   CHAR(36)    NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at  DATETIME(3) NOT NULL,
  KEY ix_tenant (tenant_id),
  KEY ix_expiry (expires_at),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO tenant_slug_aliases (slug, tenant_id, created_at, expires_at)
  SELECT previous_slug, id, COALESCE(slug_changed_at, CURRENT_TIMESTAMP(3)), COALESCE(slug_changed_at, CURRENT_TIMESTAMP(3)) + INTERVAL 180 DAY
  FROM tenants WHERE previous_slug IS NOT NULL;

-- A13: a time zone change applies from the next business day, like reset and auto-close changes (TR-ALG-16).
ALTER TABLE venues ADD COLUMN pending_time_zone VARCHAR(64) NULL AFTER pending_auto_close_time;

-- A17: MRR uses the price each subscription was sold at, not the current catalogue price (FR-RPT-07).
ALTER TABLE subscriptions
  ADD COLUMN amount_minor INT UNSIGNED NULL AFTER venue_quantity,
  ADD COLUMN currency CHAR(3) NULL AFTER amount_minor;

UPDATE subscriptions s
  JOIN plan_prices pp ON pp.plan_id = s.plan_id AND pp.period = s.period AND pp.active = TRUE
  SET s.amount_minor = pp.amount_minor, s.currency = pp.currency
  WHERE s.amount_minor IS NULL;

-- A11: removing a rating comment keeps the stars in reports (FR-RPT-08).
ALTER TABLE ratings ADD COLUMN comment_deleted_at DATETIME(3) NULL AFTER comment;
UPDATE ratings SET comment = NULL, comment_deleted_at = deleted_at, deleted_at = NULL WHERE deleted_at IS NOT NULL;
