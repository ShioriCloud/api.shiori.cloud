-- Allow system_rail blocks + seed built-in Home rails (safe to re-run).

ALTER TABLE home_blocks DROP CONSTRAINT IF EXISTS home_blocks_type_check;
ALTER TABLE home_blocks
  ADD CONSTRAINT home_blocks_type_check
  CHECK (type IN ('curated_slider', 'cta_banner', 'cta_card', 'system_rail'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_home_blocks_system_rail_id
  ON home_blocks ((config->>'rail_id'))
  WHERE type = 'system_rail';

-- Make room before seeded rails if customs already exist and no system rails yet.
UPDATE home_blocks
SET sort_order = sort_order + 6
WHERE type <> 'system_rail'
  AND NOT EXISTS (SELECT 1 FROM home_blocks WHERE type = 'system_rail');

INSERT INTO home_blocks (id, type, title, sort_order, is_active, config)
SELECT 'a1111111-1111-4111-8111-111111111101', 'system_rail', 'تازه‌اضافه‌شده', 1, true,
       '{"rail_id":"recent"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM home_blocks WHERE type = 'system_rail' AND config->>'rail_id' = 'recent'
);

INSERT INTO home_blocks (id, type, title, sort_order, is_active, config)
SELECT 'a1111111-1111-4111-8111-111111111106', 'system_rail', 'قسمت‌های تازه', 2, true,
       '{"rail_id":"new_episodes"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM home_blocks WHERE type = 'system_rail' AND config->>'rail_id' = 'new_episodes'
);

INSERT INTO home_blocks (id, type, title, sort_order, is_active, config)
SELECT 'a1111111-1111-4111-8111-111111111102', 'system_rail', 'فصل جاری', 3, true,
       '{"rail_id":"latest"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM home_blocks WHERE type = 'system_rail' AND config->>'rail_id' = 'latest'
);

INSERT INTO home_blocks (id, type, title, sort_order, is_active, config)
SELECT 'a1111111-1111-4111-8111-111111111103', 'system_rail', 'محبوب‌ترین‌ها', 4, true,
       '{"rail_id":"popular"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM home_blocks WHERE type = 'system_rail' AND config->>'rail_id' = 'popular'
);

INSERT INTO home_blocks (id, type, title, sort_order, is_active, config)
SELECT 'a1111111-1111-4111-8111-111111111104', 'system_rail', 'دونگهوا', 5, true,
       '{"rail_id":"donghua"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM home_blocks WHERE type = 'system_rail' AND config->>'rail_id' = 'donghua'
);

INSERT INTO home_blocks (id, type, title, sort_order, is_active, config)
SELECT 'a1111111-1111-4111-8111-111111111105', 'system_rail', 'انیمه سینمایی', 6, true,
       '{"rail_id":"movies"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM home_blocks WHERE type = 'system_rail' AND config->>'rail_id' = 'movies'
);
