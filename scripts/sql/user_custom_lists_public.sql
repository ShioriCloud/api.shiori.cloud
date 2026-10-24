-- Public custom lists on social profiles. Safe to re-run.
ALTER TABLE user_custom_lists
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_user_custom_lists_public
  ON user_custom_lists (telegram_user_id, is_public)
  WHERE is_public = true;
