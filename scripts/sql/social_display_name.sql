-- Optional public display name. Falls back to Telegram first_name when null.
ALTER TABLE telegram_users
  ADD COLUMN IF NOT EXISTS social_display_name text;
