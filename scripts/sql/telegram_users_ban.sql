-- Mini-app ban flag for telegram_users (admin user detail)
ALTER TABLE telegram_users
  ADD COLUMN IF NOT EXISTS is_banned boolean NOT NULL DEFAULT false;

ALTER TABLE telegram_users
  ADD COLUMN IF NOT EXISTS banned_at timestamptz;

ALTER TABLE telegram_users
  ADD COLUMN IF NOT EXISTS banned_reason text;

CREATE INDEX IF NOT EXISTS idx_telegram_users_is_banned
  ON telegram_users (is_banned)
  WHERE is_banned = true;
