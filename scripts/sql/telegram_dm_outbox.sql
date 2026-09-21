-- Outbox for Telegram DMs delivered by tel-bot (API host often cannot reach api.telegram.org).
CREATE TABLE IF NOT EXISTS telegram_dm_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NULL REFERENCES notification_campaigns(id) ON DELETE SET NULL,
  chat_id bigint NOT NULL,
  text text NOT NULL,
  web_app_url text NULL,
  status text NOT NULL DEFAULT 'pending',
  error text NULL,
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz NULL,
  sent_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_dm_outbox_pending
  ON telegram_dm_outbox (status, created_at ASC);
