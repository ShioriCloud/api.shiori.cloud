-- Staff audit trail for admin panel actions on telegram users.
CREATE TABLE IF NOT EXISTS admin_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_telegram_user_id bigint NOT NULL,
  action text NOT NULL,
  target_telegram_user_id bigint NOT NULL,
  meta jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_target_created
  ON admin_audit_events (target_telegram_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_actor_created
  ON admin_audit_events (actor_telegram_user_id, created_at DESC);
