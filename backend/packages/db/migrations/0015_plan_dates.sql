-- 2026-10-25: a tenant's plan runs from plan_starts_at to paid_until. Trials are retired: running trials become
-- active tenants paid until their old trial end, expired trials become cancelled.
ALTER TABLE tenants ADD COLUMN plan_starts_at DATETIME(3) NULL AFTER trial_ends_at;
UPDATE tenants SET plan_starts_at = created_at WHERE plan_starts_at IS NULL;

UPDATE tenants SET paid_until = COALESCE(paid_until, trial_ends_at), status = 'active' WHERE status = 'trial';
UPDATE tenants SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, CURRENT_TIMESTAMP(3)) WHERE status = 'trial_expired';
