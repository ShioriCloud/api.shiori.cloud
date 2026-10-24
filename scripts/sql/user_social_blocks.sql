-- Block / mute between social users. Safe to re-run.

CREATE TABLE IF NOT EXISTS user_social_blocks (
  id bigserial PRIMARY KEY,
  blocker_telegram_user_id bigint NOT NULL REFERENCES telegram_users (telegram_user_id) ON DELETE CASCADE,
  blocked_telegram_user_id bigint NOT NULL REFERENCES telegram_users (telegram_user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_social_blocks_unique UNIQUE (blocker_telegram_user_id, blocked_telegram_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_social_blocks_blocked
  ON user_social_blocks (blocked_telegram_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_social_mutes (
  id bigserial PRIMARY KEY,
  muter_telegram_user_id bigint NOT NULL REFERENCES telegram_users (telegram_user_id) ON DELETE CASCADE,
  muted_telegram_user_id bigint NOT NULL REFERENCES telegram_users (telegram_user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_social_mutes_unique UNIQUE (muter_telegram_user_id, muted_telegram_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_social_mutes_muter
  ON user_social_mutes (muter_telegram_user_id, created_at DESC);
