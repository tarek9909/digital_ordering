-- 2026-10-22 completeness repair CSD07 (FR-STF-08, TR-ALR-21).
--
-- The "Not collected — call out" state used to exist only as the ephemeral `ticket.overdue` socket event, so a
-- board opened or reloaded after the event could not show it. The `alert.overdue-flag` job now records the ready
-- round it flagged; the staff projection exposes it, and the state is current only while the ticket is still in
-- that round (every entry into ready increments `ready_round`, so a later round is never flagged by an old one).
ALTER TABLE tickets
  ADD COLUMN overdue_round SMALLINT UNSIGNED NULL AFTER manual_alerts_sent;
