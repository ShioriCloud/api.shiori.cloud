-- Add unique slug column for anime (run once against local/prod DB)
ALTER TABLE anime ADD COLUMN IF NOT EXISTS slug text;

CREATE UNIQUE INDEX IF NOT EXISTS anime_slug_unique_idx ON anime (slug) WHERE slug IS NOT NULL;
