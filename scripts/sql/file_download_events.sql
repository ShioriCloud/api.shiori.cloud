-- Per-download event log for bot files (run once on production Postgres).

CREATE TABLE IF NOT EXISTS file_download_events (
  id BIGSERIAL PRIMARY KEY,
  file_key TEXT NOT NULL,
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_file_download_events_downloaded_at
  ON file_download_events (downloaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_file_download_events_file_key_downloaded_at
  ON file_download_events (file_key, downloaded_at DESC);
