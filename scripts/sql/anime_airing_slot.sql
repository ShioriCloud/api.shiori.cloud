-- Shiori-only weekly schedule slots (safe to re-run).
ALTER TABLE anime ADD COLUMN IF NOT EXISTS airing_weekday text;
ALTER TABLE anime ADD COLUMN IF NOT EXISTS airing_time text;

CREATE INDEX IF NOT EXISTS idx_anime_airing_slot
  ON anime (airing_status, airing_weekday)
  WHERE airing_weekday IS NOT NULL;
