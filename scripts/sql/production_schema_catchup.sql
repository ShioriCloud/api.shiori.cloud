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
-- Admin-only "last edit" for dash list sort (not bumped by mini-app views / score sync).
ALTER TABLE anime ADD COLUMN IF NOT EXISTS last_edited_at timestamptz;
UPDATE anime
SET last_edited_at = COALESCE(last_edited_at, updated_at, created_at, now())
WHERE last_edited_at IS NULL;
ALTER TABLE anime ADD COLUMN IF NOT EXISTS prev_anime_id uuid;
ALTER TABLE anime ADD COLUMN IF NOT EXISTS next_anime_id uuid;
ALTER TABLE anime ADD COLUMN IF NOT EXISTS shiori_score numeric(4, 1);
ALTER TABLE anime ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0;

-- Catalog search / Home rails / Explore seasonal
CREATE INDEX IF NOT EXISTS idx_anime_year_season ON anime (year, season);
CREATE INDEX IF NOT EXISTS idx_anime_created_at ON anime (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_anime_view_count ON anime (view_count DESC);

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

-- Shiori catalog weekly schedule (day + Tehran time)
ALTER TABLE anime ADD COLUMN IF NOT EXISTS airing_weekday text;
ALTER TABLE anime ADD COLUMN IF NOT EXISTS airing_time text;
CREATE INDEX IF NOT EXISTS idx_anime_airing_slot
  ON anime (airing_status, airing_weekday)
  WHERE airing_weekday IS NOT NULL;

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

-- Genre cover for explore grid
ALTER TABLE genres ADD COLUMN IF NOT EXISTS image_url text;

-- Home builder: custom blocks after fixed mini-app sections
CREATE TABLE IF NOT EXISTS home_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('curated_slider', 'cta_banner', 'cta_card')),
  title text,
  subtitle text,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_home_blocks_sort_order ON home_blocks (sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_home_blocks_active_sort ON home_blocks (is_active, sort_order ASC);

-- Sponsor channel campaigns (tel-bot membership gate)
CREATE TABLE IF NOT EXISTS sponsor_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id text NOT NULL,
  channel_username text,
  title text NOT NULL,
  target_count integer NOT NULL CHECK (target_count > 0),
  joined_count integer NOT NULL DEFAULT 0 CHECK (joined_count >= 0),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sponsor_campaigns_active_sort
  ON sponsor_campaigns (is_active, sort_order ASC);

CREATE TABLE IF NOT EXISTS sponsor_join_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES sponsor_campaigns (id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, telegram_user_id)
);

CREATE INDEX IF NOT EXISTS idx_sponsor_join_events_campaign_verified
  ON sponsor_join_events (campaign_id, verified_at DESC);

-- Channel post templates (admin draft → channel publish)
ALTER TABLE anime ADD COLUMN IF NOT EXISTS channel_cover_file_id text;
ALTER TABLE anime ADD COLUMN IF NOT EXISTS channel_caption_html text;
ALTER TABLE anime ADD COLUMN IF NOT EXISTS channel_latest_message_id bigint;
ALTER TABLE anime ADD COLUMN IF NOT EXISTS channel_id text;

CREATE TABLE IF NOT EXISTS channel_post_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anime_id uuid NOT NULL REFERENCES anime (id) ON DELETE CASCADE,
  episode_number numeric(8,2) NOT NULL,
  proposed_caption text NOT NULL,
  cover_file_id text,
  status text NOT NULL DEFAULT 'pending',
  admin_preview_message_id bigint,
  admin_preview_chat_id bigint,
  published_message_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT channel_post_drafts_status_check
    CHECK (status IN ('pending', 'published', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_channel_post_drafts_anime_created
  ON channel_post_drafts (anime_id, created_at DESC);

-- Support tickets (mini-app ↔ admin portal)
CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id bigint NOT NULL,
  category text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_tickets_category_check
    CHECK (category IN (
      'bug_report',
      'app_improvement',
      'feature_request',
      'account_issue',
      'other'
    )),
  CONSTRAINT support_tickets_status_check
    CHECK (status IN ('open', 'answered', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_telegram_user
  ON support_tickets (telegram_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status_updated
  ON support_tickets (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets (id) ON DELETE CASCADE,
  author_telegram_user_id bigint NOT NULL,
  author_role text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_ticket_messages_author_role_check
    CHECK (author_role IN ('user', 'staff'))
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket
  ON support_ticket_messages (ticket_id, created_at ASC);

-- Allow half-episodes (2.5, 5.5, …) on episode / subtitle numbers
ALTER TABLE episodes
  ALTER COLUMN episode_number TYPE numeric(8,2)
  USING episode_number::numeric(8,2);

ALTER TABLE subtitles
  ALTER COLUMN episode_number TYPE numeric(8,2)
  USING episode_number::numeric(8,2);

ALTER TABLE channel_post_drafts
  ALTER COLUMN episode_number TYPE numeric(8,2)
  USING episode_number::numeric(8,2);

ALTER TABLE user_notifications
  ALTER COLUMN episode_number TYPE numeric(8,2)
  USING episode_number::numeric(8,2);

ALTER TABLE notification_campaigns
  ALTER COLUMN episode_number TYPE numeric(8,2)
  USING episode_number::numeric(8,2);

-- Per-anime airing reminders (fanout audience for new episodes)
CREATE TABLE IF NOT EXISTS user_anime_airing_reminders (
  id bigserial PRIMARY KEY,
  telegram_user_id bigint NOT NULL REFERENCES telegram_users (telegram_user_id) ON DELETE CASCADE,
  anime_id uuid NOT NULL REFERENCES anime (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_anime_airing_reminders_user_anime_unique
    UNIQUE (telegram_user_id, anime_id)
);

CREATE INDEX IF NOT EXISTS idx_user_anime_airing_reminders_anime
  ON user_anime_airing_reminders (anime_id);

CREATE INDEX IF NOT EXISTS idx_notification_campaigns_anime_episode
  ON notification_campaigns (anime_id, episode_number)
  WHERE kind = 'new_episode';

-- Mini-app boot splash dialogues (IGN-style quote panel)
CREATE TABLE IF NOT EXISTS boot_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL,
  attribution text NOT NULL,
  image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE boot_quotes ADD COLUMN IF NOT EXISTS image_url text;
UPDATE boot_quotes SET image_url = NULL WHERE image_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_boot_quotes_sort_order ON boot_quotes (sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_boot_quotes_active_sort ON boot_quotes (is_active, sort_order ASC);

INSERT INTO boot_quotes (text, attribution, sort_order, is_active)
SELECT v.text, v.attribution, v.sort_order, true
FROM (
  VALUES
    ('من نمی‌تونم شنا کنم، ولی شنا می‌کنم!', 'سورو · وان پیس', 1),
    ('وقتی تسلیم شی، همون‌جاست که داستان تموم می‌شه.', 'ناروتو اوزوماکی · ناروتو', 2),
    ('قدرتِ واقعی یعنی محافظت از چیزی که برات مهمه.', 'هیشوکا · هانتر × هانتر', 3),
    ('دنیای بیرون ممکنه بی‌رحم باشه، ولی تو تنها نیستی.', 'ادوارد الریک · فول‌متال آلکیمیست', 4),
    ('اسمت رو می‌نویسم… و تموم.', 'لایت یاگامی · دث‌نوت', 5),
    ('ترسیدن اشکالی نداره؛ جا زدن اشکال داره.', 'ارن یگر · اتک آن تایتان', 6),
    ('من هنوز زنده‌ام، پس هنوز شانس دارم.', 'گوتس · برزرک', 7),
    ('عشق یعنی وقتی برای یکی دیگه، خودت رو فراموش می‌کنی.', 'ویولت · ویولت اورگاردن', 8),
    ('هیچ‌کس قهرمان به دنیا نمیاد؛ قهرمان ساخته می‌شه.', 'آل‌مایت · مای هیرو آکادمیا', 9),
    ('حتی اگه دنیا تموم بشه، من دست از تلاش برنمی‌دارم.', 'گکو مورا · وان پانچ من', 10),
    ('تو همون کسی هستی که تصمیم می‌گیری چی باشی.', 'لوفی · وان پیس', 11),
    ('اشک‌ها نشونه‌ی ضعفن نیستن؛ نشونه‌ی اینن که هنوز قلب داری.', 'هیناتا · ناروتو', 12),
    ('منتظر معجزه نباش؛ خودت معجزه شو.', 'کی‌یومارو · بلیچ', 13),
    ('گاهی سخت‌ترین مبارزه‌ها، با خودته.', 'تانجیرو · شیطان‌کش', 14),
    ('اگر جلو نری، همون‌جایی که هستی می‌مونی.', 'آسونا · سورد آرت آنلاین', 15),
    ('دنیا جای بی‌رحمیه، ولی هنوز زیبایی توش هست.', 'ماکیما · چینسامن', 16),
    ('من نمی‌خوام قوی‌ترین باشم؛ می‌خوام کسی باشم که بتونه نجات بده.', 'ایزکو میدورییا · مای هیرو آکادمیا', 17),
    ('هر پایان، یه شروع جدیده.', 'سنکوکو · وان پیس', 18),
    ('باشه که مسیر تاریک باشه؛ من چراغ خودمم.', 'یوجی ایتادوری · جوجوتسو کایسن', 19),
    ('آرزو داشتن کافی نیست؛ باید براش بجنگی.', 'گون فریکس · هانتر × هانتر', 20),
    ('من از مرگ نمی‌ترسم؛ از یه زندگی بی‌معنی می‌ترسم.', 'لایت یاگامی · دث‌نوت', 21),
    ('گاهی سکوت، بلندترین فریاده.', 'لوی · اتک آن تایتان', 22),
    ('اگر بتونی بخندی، هنوز نشکستی.', 'سایتاما · وان پانچ من', 23),
    ('دوست یعنی کسی که تو تاریکی هم پیدات می‌کنه.', 'ساکورا · ناروتو', 24)
) AS v(text, attribution, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM boot_quotes LIMIT 1);
