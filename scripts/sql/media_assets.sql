-- Run when DATABASE_SYNC=false (npm run db:migrate-media)
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

-- Backfill columns when table was created from an older/partial script
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS original_name text;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS size bigint;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS alt_text text;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS caption text;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS uploaded_by bigint;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_media_assets_created_at ON media_assets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_assets_mimetype ON media_assets (mimetype);
