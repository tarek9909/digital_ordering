-- 2026-10-22 completeness repairs (API02, BW07).
--
-- API02: a legal document version is reserved in the database before its content is written. The row starts as
-- 'uploading', its content goes to a new storage key that includes the document id (never an existing object), and
-- it becomes 'ready' only after the write succeeded. A rejected duplicate version therefore never touches the bytes
-- of a published document. Every existing row already has its content stored, so they are all 'ready'; their
-- existing content keys stay as they are.
ALTER TABLE legal_documents
  ADD COLUMN status ENUM('uploading','ready') NOT NULL DEFAULT 'ready' AFTER content_key,
  ADD COLUMN created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER status;

-- BW07: the hourly roll-up also rebuilds the business dates of tickets rated recently, so a late rating reaches
-- its ticket's historical report. This index finds those ratings without scanning the table.
ALTER TABLE ratings ADD KEY ix_created (created_at);
