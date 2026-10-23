-- 2026-10-23 security repair: a session records when its user last proved who they are.
--
-- A tenant session opened by a www→tenant handoff is a new row, so its created_at is the handoff time, not a sign-in.
-- Google-only accounts (no password to re-enter) prove a recent sign-in before changing two-factor settings (H-5);
-- that check now reads authenticated_at, which a handoff copies from the www session it came from. NULL on rows from
-- before this migration: they fall back to created_at.
ALTER TABLE user_sessions ADD COLUMN authenticated_at DATETIME(3) NULL AFTER mfa_verified_at;
