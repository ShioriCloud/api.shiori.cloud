-- Shiori automation foundation (run via docker exec against shiori-cloud)

CREATE TABLE IF NOT EXISTS anime_automation_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anime_id uuid NOT NULL UNIQUE REFERENCES anime(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'disabled',
  trigger_mode text NOT NULL DEFAULT 'subtitle',
  new_episode_trigger_enabled boolean NOT NULL DEFAULT false,
  start_episode numeric(8,2) NULL,
  end_episode numeric(8,2) NULL,
  excluded_episodes jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled_seasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  processing_method text NOT NULL DEFAULT 'remux',
  last_error text NULL,
  last_processed_episode numeric(8,2) NULL,
  last_job_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS anime_source_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anime_id uuid NOT NULL UNIQUE REFERENCES anime(id) ON DELETE CASCADE,
  canonical_title text NULL,
  alt_titles jsonb NOT NULL DEFAULT '[]'::jsonb,
  streaming_platform text NULL,
  preferred_groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  fallback_groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  preferred_resolution text NOT NULL DEFAULT '1080p',
  preferred_codec text NOT NULL DEFAULT 'hevc',
  preferred_bit_depth int NULL,
  max_file_size_bytes bigint NULL,
  allowed_providers jsonb NOT NULL DEFAULT '[]'::jsonb,
  search_patterns jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  selection_mode text NOT NULL DEFAULT 'auto',
  custom_encoding_enabled boolean NOT NULL DEFAULT false,
  handbrake_preset text NULL,
  subtitle_default boolean NOT NULL DEFAULT true,
  subtitle_forced boolean NOT NULL DEFAULT false,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subtitle_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anime_id uuid NULL REFERENCES anime(id) ON DELETE SET NULL,
  episode_number numeric(8,2) NULL,
  filename_title text NULL,
  original_file_name text NOT NULL,
  telegram_file_id text NULL,
  telegram_message_id bigint NOT NULL,
  telegram_chat_id text NOT NULL,
  content_hash text NULL,
  revision int NOT NULL DEFAULT 1,
  stored_path text NULL,
  extracted_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'received',
  match_note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telegram_message_id, telegram_chat_id)
);

CREATE TABLE IF NOT EXISTS automation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  anime_id uuid NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  episode_number numeric(8,2) NOT NULL,
  season_number int NULL,
  state text NOT NULL DEFAULT 'SUBTITLE_RECEIVED',
  trigger_source text NOT NULL DEFAULT 'subtitle',
  subtitle_submission_id uuid NULL REFERENCES subtitle_submissions(id) ON DELETE SET NULL,
  selected_release_name text NULL,
  selected_magnet text NULL,
  torrent_hash text NULL,
  download_path text NULL,
  output_path text NULL,
  output_file_name text NULL,
  archive_file_key text NULL,
  download_link text NULL,
  draft_id uuid NULL,
  release_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text NULL,
  error_code text NULL,
  attempt_count int NOT NULL DEFAULT 0,
  claimed_at timestamptz NULL,
  claimed_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_jobs_anime_ep_state
  ON automation_jobs (anime_id, episode_number, state);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_state_updated
  ON automation_jobs (state, updated_at DESC);

CREATE TABLE IF NOT EXISTS automation_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES automation_jobs(id) ON DELETE CASCADE,
  from_state text NULL,
  to_state text NULL,
  message text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_job_events_job
  ON automation_job_events (job_id, created_at DESC);
