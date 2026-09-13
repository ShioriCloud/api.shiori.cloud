-- Latest episode publish time for Home/Explore season rails (safe to re-run).
ALTER TABLE anime ADD COLUMN IF NOT EXISTS last_episode_at timestamptz;

-- Backfill from existing episodes.
UPDATE anime a
SET last_episode_at = sub.max_created
FROM (
  SELECT anime_id, MAX(created_at) AS max_created
  FROM episodes
  GROUP BY anime_id
) AS sub
WHERE a.id = sub.anime_id
  AND (a.last_episode_at IS NULL OR a.last_episode_at < sub.max_created);

CREATE INDEX IF NOT EXISTS idx_anime_last_episode_at
  ON anime (last_episode_at DESC NULLS LAST);
