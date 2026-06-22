-- Tel-bot file columns on the shared `files` table (idempotent).
-- Run once on production Postgres if not already applied during bot-data merge.

ALTER TABLE files ADD COLUMN IF NOT EXISTS message_id BIGINT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS file_id TEXT;

CREATE INDEX IF NOT EXISTS idx_files_message_id
  ON files (message_id) WHERE is_active = true;

CREATE OR REPLACE FUNCTION increment_file_downloads(p_key TEXT)
RETURNS SETOF files
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  UPDATE files
  SET downloads = downloads + 1,
      last_accessed = now()
  WHERE key = p_key AND is_active = true
  RETURNING *;
END;
$$;
