-- Production catch-up for shiori-cloud Postgres (safe to re-run).
-- Run when admin/catalog features need schema columns on self-hosted Postgres.

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

-- Keep anime.shiori_score in sync with user_anime_list.user_rating
CREATE OR REPLACE FUNCTION public.refresh_anime_shiori_score()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_anime_id UUID;
BEGIN
  target_anime_id := COALESCE(NEW.anime_id, OLD.anime_id);

  UPDATE anime
  SET shiori_score = (
    SELECT ROUND(AVG(user_rating)::numeric, 1)
    FROM user_anime_list
    WHERE anime_id = target_anime_id
      AND user_rating IS NOT NULL
  )
  WHERE id = target_anime_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_user_anime_list_shiori_score ON user_anime_list;
CREATE TRIGGER trg_user_anime_list_shiori_score
  AFTER INSERT OR UPDATE OF user_rating OR DELETE
  ON user_anime_list
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_anime_shiori_score();

ALTER TABLE anime ADD COLUMN IF NOT EXISTS episode_pack_title text;
ALTER TABLE anime ADD COLUMN IF NOT EXISTS episode_pack_link text;
ALTER TABLE anime ADD COLUMN IF NOT EXISTS hardsub_language text DEFAULT 'fa';
ALTER TABLE anime ADD COLUMN IF NOT EXISTS video_file_type text DEFAULT 'softsub';
ALTER TABLE anime ADD COLUMN IF NOT EXISTS video_resolution text DEFAULT '1080p';
ALTER TABLE anime ADD COLUMN IF NOT EXISTS video_encode text DEFAULT 'x265_10bit';

UPDATE anime SET hardsub_language = 'fa' WHERE hardsub_language IS NULL OR hardsub_language = '';
UPDATE anime SET video_file_type = 'softsub' WHERE video_file_type IS NULL OR video_file_type = '';
UPDATE anime SET video_resolution = '1080p' WHERE video_resolution IS NULL OR video_resolution = '';
UPDATE anime SET video_encode = 'x265_10bit' WHERE video_encode IS NULL OR video_encode = '';

-- Existing anime with soft-subs → Persian hardsub badge
UPDATE anime a
SET hardsub_language = 'fa'
WHERE COALESCE(a.hardsub_language, 'fa') <> 'fa'
  AND (
    EXISTS (
      SELECT 1 FROM subtitles s
      WHERE s.anime_id = a.id AND NULLIF(TRIM(s.subtitle_link), '') IS NOT NULL
    )
    OR EXISTS (
      SELECT 1 FROM subtitle_packs p
      WHERE p.anime_id = a.id AND NULLIF(TRIM(p.subtitle_link), '') IS NOT NULL
    )
  );

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

-- Per-download event log (admin download trends)
CREATE TABLE IF NOT EXISTS file_download_events (
  id BIGSERIAL PRIMARY KEY,
  file_key TEXT NOT NULL,
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_file_download_events_downloaded_at
  ON file_download_events (downloaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_file_download_events_file_key_downloaded_at
  ON file_download_events (file_key, downloaded_at DESC);

-- Episode download category for mini-app tabs (softsub | hardsub | free)
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS video_file_type text DEFAULT 'softsub';
UPDATE episodes e
SET video_file_type = CASE
  WHEN a.video_file_type = 'hardsub' THEN 'hardsub'
  ELSE 'softsub'
END
FROM anime a
WHERE e.anime_id = a.id
  AND (e.video_file_type IS NULL OR e.video_file_type = '');
UPDATE episodes SET video_file_type = 'softsub' WHERE video_file_type IS NULL OR video_file_type = '';

-- Same episode number may exist once per type (softsub / hardsub / free)
DROP INDEX IF EXISTS episodes_unique_per_anime_episode;
CREATE UNIQUE INDEX episodes_unique_per_anime_episode
  ON episodes (anime_id, episode_number, COALESCE(video_file_type, 'softsub'));

-- Free-download token wallet (mini-app «رایگان» tab)
ALTER TABLE telegram_users
  ADD COLUMN IF NOT EXISTS download_token_balance integer NOT NULL DEFAULT 10;

CREATE TABLE IF NOT EXISTS download_token_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id bigint NOT NULL,
  delta integer NOT NULL,
  balance_after integer NOT NULL,
  reason text NOT NULL,
  ref_type text,
  ref_id text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_download_token_ledger_user_created
  ON download_token_ledger (telegram_user_id, created_at DESC);

-- Monthly subscription (softsub/hardsub access)
ALTER TABLE telegram_users
  ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz;
