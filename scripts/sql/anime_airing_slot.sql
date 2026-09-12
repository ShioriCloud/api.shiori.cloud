-- Shiori-only weekly schedule slots (safe to re-run).
ALTER TABLE anime ADD COLUMN IF NOT EXISTS airing_weekday text;
ALTER TABLE anime ADD COLUMN IF NOT EXISTS airing_time text;

CREATE INDEX IF NOT EXISTS idx_anime_airing_slot
  ON anime (airing_status, airing_weekday)
  WHERE airing_weekday IS NOT NULL;

-- One-off delay date (YYYY-MM-DD, Tehran). NULL = weekly slot.
ALTER TABLE anime ADD COLUMN IF NOT EXISTS next_airing_date date;

-- Needed to detect a missed weekly slot (no new episode after last air time).
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
UPDATE episodes SET created_at = COALESCE(created_at, now()) WHERE created_at IS NULL;
