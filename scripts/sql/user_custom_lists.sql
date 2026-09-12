-- Custom Shiori lists (لیست‌های شخصی) synced to the Telegram account.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS user_custom_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id bigint NOT NULL REFERENCES telegram_users (telegram_user_id) ON DELETE CASCADE,
  name text NOT NULL,
  icon text NOT NULL DEFAULT 'heart',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_custom_lists_user
  ON user_custom_lists (telegram_user_id, created_at ASC);

CREATE TABLE IF NOT EXISTS user_custom_list_items (
  id bigserial PRIMARY KEY,
  list_id uuid NOT NULL REFERENCES user_custom_lists (id) ON DELETE CASCADE,
  anime_id uuid NOT NULL REFERENCES anime (id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_custom_list_items_list_anime_unique UNIQUE (list_id, anime_id)
);

CREATE INDEX IF NOT EXISTS idx_user_custom_list_items_list
  ON user_custom_list_items (list_id, position ASC);

CREATE INDEX IF NOT EXISTS idx_user_custom_list_items_anime
  ON user_custom_list_items (anime_id);
