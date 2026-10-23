-- 2026-10-22 completeness repairs (BW01, BW09, BW02).
--
-- BW09: the fan-out of one event creates at most one ORIGINAL delivery per endpoint, even when the fan-out job is
-- retried after it stored some deliveries. `is_original` is 1 for a fan-out (or test ping) delivery and NULL for a
-- deliberate redelivery from the admin: NULLs never collide in a unique key, so redeliveries stay possible while a
-- second original for the same (endpoint, event) is refused by uq_original. The key starts with tenant_id, so every
-- match belongs to one tenant (L-11).
ALTER TABLE webhook_deliveries ADD COLUMN is_original TINYINT(1) NULL DEFAULT 1 AFTER event_type;

-- Existing duplicates (replayed fan-outs or earlier redeliveries of one event to one endpoint): the oldest row stays
-- the original, every later one becomes a redelivery. No row is deleted or abandoned: rows already attempted keep
-- their history and pending ones still deliver (receivers deduplicate on X-Pager-Event-Id), because a legacy
-- fan-out duplicate cannot be told apart from a deliberate redelivery.
UPDATE webhook_deliveries d
  JOIN webhook_deliveries e
    ON e.tenant_id = d.tenant_id AND e.endpoint_id = d.endpoint_id AND e.event_id = d.event_id AND e.id < d.id
  SET d.is_original = NULL;

ALTER TABLE webhook_deliveries ADD UNIQUE KEY uq_original (tenant_id, endpoint_id, event_id, is_original);

-- BW01: TR-WH-03 counts the deliveries of the last 24 h, but re-enabling an endpoint resets its health ("Re-enabling
-- resets the streak"): failures from before the re-enable no longer count towards disabling it again.
ALTER TABLE webhook_endpoints ADD COLUMN health_since DATETIME(3) NULL AFTER failure_streak;

-- BW02: a recorded payment may carry the console's request id, so a double-submitted or retried "record payment"
-- request is stored and applied once. NULLs (requests without an id) never collide.
ALTER TABLE tenant_payments
  ADD COLUMN request_id CHAR(36) NULL AFTER recorded_by,
  ADD UNIQUE KEY uq_request (tenant_id, request_id);
