-- Apply on prod when social API errors (missing columns/tables).
-- Safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

ALTER TABLE telegram_users
  ADD COLUMN IF NOT EXISTS social_display_name text;

ALTER TABLE telegram_users
  ADD COLUMN IF NOT EXISTS notify_social_follow boolean NOT NULL DEFAULT true;

ALTER TABLE telegram_users
  ADD COLUMN IF NOT EXISTS hide_watch_activity boolean NOT NULL DEFAULT false;

ALTER TABLE user_custom_lists
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS anime_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anime_id uuid NOT NULL REFERENCES anime (id) ON DELETE CASCADE,
  parent_id uuid NULL REFERENCES anime_comments (id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL REFERENCES telegram_users (telegram_user_id) ON DELETE CASCADE,
  body text NOT NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE anime_comments
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

ALTER TABLE anime_comments
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_anime_comments_thread
  ON anime_comments (anime_id, parent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_anime_comments_author
  ON anime_comments (telegram_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS anime_comment_likes (
  comment_id uuid NOT NULL REFERENCES anime_comments (id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL REFERENCES telegram_users (telegram_user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, telegram_user_id)
);

CREATE TABLE IF NOT EXISTS anime_comment_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES anime_comments (id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL REFERENCES telegram_users (telegram_user_id) ON DELETE CASCADE,
  reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT anime_comment_reports_unique UNIQUE (comment_id, telegram_user_id)
);

CREATE TABLE IF NOT EXISTS user_social_badges (
  telegram_user_id bigint NOT NULL REFERENCES telegram_users (telegram_user_id) ON DELETE CASCADE,
  badge_id text NOT NULL,
  earned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (telegram_user_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_user_social_badges_user
  ON user_social_badges (telegram_user_id, earned_at DESC);

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
