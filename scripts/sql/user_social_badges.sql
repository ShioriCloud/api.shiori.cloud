-- Earned social profile badges (unlock timestamps). Safe to re-run.
CREATE TABLE IF NOT EXISTS user_social_badges (
  telegram_user_id bigint NOT NULL REFERENCES telegram_users (telegram_user_id) ON DELETE CASCADE,
  badge_id text NOT NULL,
  earned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (telegram_user_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_user_social_badges_user
  ON user_social_badges (telegram_user_id, earned_at DESC);
