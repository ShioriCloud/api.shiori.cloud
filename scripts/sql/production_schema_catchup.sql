-- Production catch-up for shiori-cloud Postgres (safe to re-run).
-- Run after Supabase → self-hosted merge when admin/catalog features 500.

-- Anime: slug + timestamps (anime list sorts by created_at)
ALTER TABLE anime ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS anime_slug_unique_idx ON anime (slug) WHERE slug IS NOT NULL;

ALTER TABLE anime ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE anime ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE anime SET created_at = COALESCE(created_at, now());
UPDATE anime SET updated_at = COALESCE(updated_at, now());

ALTER TABLE anime ADD COLUMN IF NOT EXISTS last_edited_by bigint;
ALTER TABLE anime ADD COLUMN IF NOT EXISTS prev_anime_id uuid;
ALTER TABLE anime ADD COLUMN IF NOT EXISTS next_anime_id uuid;
ALTER TABLE anime ADD COLUMN IF NOT EXISTS shiori_score numeric(4, 1);
ALTER TABLE anime ADD COLUMN IF NOT EXISTS episode_pack_title text;
ALTER TABLE anime ADD COLUMN IF NOT EXISTS episode_pack_link text;

-- Media library
CREATE TABLE IF NOT EXISTS media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  original_name text,
  mimetype text NOT NULL,
  url text NOT NULL,
  storage_path text NOT NULL,
  size bigint,
  alt_text text,
  caption text,
  uploaded_by bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_media_assets_created_at ON media_assets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_assets_mimetype ON media_assets (mimetype);

-- Files picker sort column
ALTER TABLE files ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
UPDATE files SET created_at = COALESCE(created_at, last_accessed, now()) WHERE created_at IS NULL;

-- Bot runtime settings (tel-bot /mirroring)
CREATE TABLE IF NOT EXISTS bot_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
