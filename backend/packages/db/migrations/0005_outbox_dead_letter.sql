-- 2026-10-22 security audit L-18: an outbox row that keeps failing is parked (dead-lettered) after a bounded number
-- of attempts, so poison rows stop occupying the relay batch. Parked rows keep their payload and last error for
-- inspection and can be released by clearing parked_at (and attempts).
ALTER TABLE outbox
  ADD COLUMN parked_at DATETIME(3) NULL AFTER published_at;
