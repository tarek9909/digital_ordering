-- 2026-10-22: Stripe and public self-signup are removed. Venues are onboarded from the console and pay offline;
-- the platform team records each payment, which extends the tenant's paid_until date. After paid_until the
-- tenant goes past_due, then the usual grace period and billing suspension apply (TR-BIL-07).

ALTER TABLE tenants ADD COLUMN paid_until DATETIME(3) NULL AFTER trial_ends_at;

-- A tenant paying through Stripe keeps the period it already paid for.
UPDATE tenants t
  JOIN subscriptions s ON s.tenant_id = t.id
  SET t.paid_until = s.current_period_end
  WHERE s.stripe_status IN ('active', 'past_due', 'trialing');

CREATE TABLE tenant_payments (                                -- offline payments recorded in the console
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  tenant_id     CHAR(36)     NOT NULL,
  amount_minor  INT UNSIGNED NOT NULL,
  currency      CHAR(3)      NOT NULL,
  months        TINYINT UNSIGNED NOT NULL,
  method        ENUM('cash','bank_transfer','wallet','other') NOT NULL,
  reference     VARCHAR(120) NULL,                           -- receipt or transfer number
  note          VARCHAR(500) NULL,
  covers_from   DATETIME(3)  NOT NULL,
  covers_until  DATETIME(3)  NOT NULL,
  recorded_by   CHAR(36)     NULL,                           -- platform user
  recorded_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_tenant (tenant_id, recorded_at),
  KEY ix_covers (covers_until, covers_from),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE stripe_events;
DROP TABLE invoices;
DROP TABLE subscriptions;

ALTER TABLE plan_prices DROP COLUMN stripe_price_id;
ALTER TABLE tenants
  DROP COLUMN stripe_customer_id,
  DROP COLUMN created_via;
