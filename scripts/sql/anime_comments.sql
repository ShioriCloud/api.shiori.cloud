-- Public display name (optional; falls back to Telegram first_name)
ALTER TABLE telegram_users
  ADD COLUMN IF NOT EXISTS social_display_name text;

-- Anime comments + likes + reports. Safe to re-run.

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
