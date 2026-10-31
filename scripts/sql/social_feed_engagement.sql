-- Feed activity likes + private notes (safe to re-run).

CREATE TABLE IF NOT EXISTS user_social_feed_likes (
  telegram_user_id bigint NOT NULL REFERENCES telegram_users (telegram_user_id) ON DELETE CASCADE,
  activity_key text NOT NULL,
  activity_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (telegram_user_id, activity_key)
);

CREATE INDEX IF NOT EXISTS idx_user_social_feed_likes_activity
  ON user_social_feed_likes (activity_key, created_at DESC);

CREATE TABLE IF NOT EXISTS user_social_feed_notes (
  telegram_user_id bigint NOT NULL REFERENCES telegram_users (telegram_user_id) ON DELETE CASCADE,
  activity_key text NOT NULL,
  body text NOT NULL,
  is_private boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (telegram_user_id, activity_key)
);

ALTER TABLE user_social_feed_notes
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT true;
