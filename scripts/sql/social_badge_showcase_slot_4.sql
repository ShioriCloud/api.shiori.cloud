-- Allow 4 profile showcase badge slots (was CHECK slot <= 3).
-- Safe to re-run.

ALTER TABLE user_social_badge_showcase
  DROP CONSTRAINT IF EXISTS user_social_badge_showcase_slot_check;

ALTER TABLE user_social_badge_showcase
  ADD CONSTRAINT user_social_badge_showcase_slot_check
  CHECK (slot >= 1 AND slot <= 4);
