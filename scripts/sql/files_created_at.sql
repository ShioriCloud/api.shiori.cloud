-- Backfill + default for files.created_at (picker search sorts by this).
-- Run once on production Postgres (shiori-cloud).

ALTER TABLE files
  ALTER COLUMN created_at SET DEFAULT now();

UPDATE files
SET created_at = COALESCE(last_accessed, now())
WHERE created_at IS NULL;
