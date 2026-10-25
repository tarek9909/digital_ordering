-- 2026-10-25: plans are priced packages with a short description.
ALTER TABLE plans ADD COLUMN description VARCHAR(500) NULL AFTER name;
