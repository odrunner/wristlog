-- ══════════════════════════════════════════════════════════════════════════════
--  WRISTLOG — TEST ACCOUNT 2 SEED SCRIPT
-- ══════════════════════════════════════════════════════════════════════════════
--  For test2@wrotate.com (UUID: 86ea0f82-044d-4730-82af-b942e3b09380)
--  Run this in Supabase SQL Editor to populate the second test account.
--  Smaller collection than testuser — 5 watches, ~90 wear logs, 3 posts,
--  3 wishlist items. Used for two-user UAT (follows, comments, mentions, etc.)
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Clean slate ─────────────────────────────────────────────────────────────
DELETE FROM logs     WHERE user_id = '86ea0f82-044d-4730-82af-b942e3b09380';
DELETE FROM wishlist WHERE user_id = '86ea0f82-044d-4730-82af-b942e3b09380';
DELETE FROM watches  WHERE user_id = '86ea0f82-044d-4730-82af-b942e3b09380';

-- ─── Profile (overwrite) ───
INSERT INTO profiles (id, username, display_name, bio,
                      collection_visibility, profile_privacy, wishlist_visibility)
VALUES (
  '86ea0f82-044d-4730-82af-b942e3b09380',
  'testuser2',
  'Test User 2',
  'Casual collector. Love field watches and anything with a NATO strap.',
  'public',
  'public',
  'public'
)
ON CONFLICT (id) DO UPDATE SET
  username               = EXCLUDED.username,
  display_name           = EXCLUDED.display_name,
  bio                    = EXCLUDED.bio,
  collection_visibility  = EXCLUDED.collection_visibility,
  profile_privacy        = EXCLUDED.profile_privacy,
  wishlist_visibility    = EXCLUDED.wishlist_visibility;


-- ═════════════════════════════════════════════════════════════════════════════
--  WATCHES  (5 pieces)
-- ═════════════════════════════════════════════════════════════════════════════
INSERT INTO watches (id, user_id, brand, name, ref, price, purchase_date, color,
                     image, url, tags, straps, owner, market_price, market_price_date,
                     has_box, has_papers, elo_rating, watch_privacy)
VALUES
-- 1. Hamilton Khaki Field Mechanical
(gen_random_uuid()::text, '86ea0f82-044d-4730-82af-b942e3b09380',
 'Hamilton', 'Khaki Field Mechanical', 'H69439931', 475, '2023-01-15', '#3d4a2e',
 NULL,
 'https://www.hamiltonwatch.com/en-us/h69439931-khaki-field-mechanical.html',
 ARRAY['Field','Daily Beater'], '[]'::jsonb, NULL, 495, '2025-12-01',
 TRUE, TRUE, 1050, NULL),

-- 2. Tissot PRX Powermatic 80
(gen_random_uuid()::text, '86ea0f82-044d-4730-82af-b942e3b09380',
 'Tissot', 'PRX Powermatic 80', 'T137.407.11.041.00', 650, '2023-06-10', '#1a3a5f',
 NULL,
 'https://www.tissotwatches.com/en-us/t1374071104100.html',
 ARRAY['Dress','Daily Beater'], '[]'::jsonb, NULL, 625, '2025-11-15',
 TRUE, TRUE, 1020, NULL),

-- 3. Sinn 556 I
(gen_random_uuid()::text, '86ea0f82-044d-4730-82af-b942e3b09380',
 'Sinn', '556 I', '556.010', 1490, '2022-09-20', '#1a1a2e',
 NULL,
 'https://www.sinn.de/en/Modell/556_I.htm',
 ARRAY['Field','Daily Beater'], '[]'::jsonb, NULL, 1550, '2025-10-20',
 TRUE, TRUE, 1080, NULL),

-- 4. Seiko SKX009
(gen_random_uuid()::text, '86ea0f82-044d-4730-82af-b942e3b09380',
 'Seiko', 'SKX009', 'SKX009K2', 280, '2019-11-05', '#003366',
 NULL,
 NULL,
 ARRAY['Dive','Vintage','Daily Beater'], '[]'::jsonb, NULL, 420, '2025-08-01',
 FALSE, FALSE, 1000, NULL),

-- 5. Longines Spirit Zulu Time
(gen_random_uuid()::text, '86ea0f82-044d-4730-82af-b942e3b09380',
 'Longines', 'Spirit Zulu Time', 'L3.812.4.63.6', 2725, '2024-03-01', '#2d2d2d',
 NULL,
 'https://www.longines.com/en-us/watch-longines-spirit-zulu-time-l3-812-4-63-6',
 ARRAY['GMT','Sport'], '[]'::jsonb, NULL, 2800, '2025-12-10',
 TRUE, TRUE, 1100, NULL);


-- ═════════════════════════════════════════════════════════════════════════════
--  WEAR LOGS  (~90 days of entries across Sep 2025 – Feb 2026)
--  Plus 3 posts (watch_id IS NULL)
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_ham_id     text;
  v_prx_id     text;
  v_sinn_id    text;
  v_skx_id     text;
  v_long_id    text;

  v_watch_ids    text[];
  v_watch_names  text[];
  v_weights      int[];
  v_total_weight int;

  v_day          date;
  v_rand         double precision;
  v_cum_weight   int;
  v_pick         int;
  v_use_case     text;
  v_note         text;
  v_note_rand    double precision;
  v_skip_rand    double precision;
BEGIN
  -- Look up watch IDs
  SELECT id INTO v_ham_id  FROM watches WHERE user_id = '86ea0f82-044d-4730-82af-b942e3b09380' AND ref = 'H69439931';
  SELECT id INTO v_prx_id  FROM watches WHERE user_id = '86ea0f82-044d-4730-82af-b942e3b09380' AND ref = 'T137.407.11.041.00';
  SELECT id INTO v_sinn_id FROM watches WHERE user_id = '86ea0f82-044d-4730-82af-b942e3b09380' AND ref = '556.010';
  SELECT id INTO v_skx_id  FROM watches WHERE user_id = '86ea0f82-044d-4730-82af-b942e3b09380' AND ref = 'SKX009K2';
  SELECT id INTO v_long_id FROM watches WHERE user_id = '86ea0f82-044d-4730-82af-b942e3b09380' AND ref = 'L3.812.4.63.6';

  v_watch_ids   := ARRAY[v_ham_id, v_prx_id, v_sinn_id, v_skx_id, v_long_id];
  v_watch_names := ARRAY['Hamilton Khaki', 'Tissot PRX', 'Sinn 556', 'Seiko SKX', 'Longines Zulu'];
  v_weights     := ARRAY[30, 20, 25, 15, 10];
  v_total_weight := 100;

  -- Generate wear logs from Sep 2025 to Feb 2026 (~180 days, skip ~50%)
  v_day := '2025-09-01'::date;
  WHILE v_day <= '2026-02-28' LOOP
    v_skip_rand := random();

    -- Skip ~50% of days (casual collector)
    IF v_skip_rand < 0.50 THEN
      -- Weighted random watch pick
      v_rand := random() * v_total_weight;
      v_cum_weight := 0;
      v_pick := 1;
      FOR i IN 1..5 LOOP
        v_cum_weight := v_cum_weight + v_weights[i];
        IF v_rand <= v_cum_weight THEN
          v_pick := i;
          EXIT;
        END IF;
      END LOOP;

      -- Use case
      CASE v_pick
        WHEN 1 THEN v_use_case := (ARRAY['Hiking','Casual','Office'])[floor(random()*3+1)::int];
        WHEN 2 THEN v_use_case := (ARRAY['Office','Date night','Casual'])[floor(random()*3+1)::int];
        WHEN 3 THEN v_use_case := (ARRAY['Office','Daily','Travel'])[floor(random()*3+1)::int];
        WHEN 4 THEN v_use_case := (ARRAY['Beach','Weekend','Casual'])[floor(random()*3+1)::int];
        WHEN 5 THEN v_use_case := (ARRAY['Travel','Office','Special occasion'])[floor(random()*3+1)::int];
      END CASE;

      -- Note (~30% of days)
      v_note_rand := random();
      IF v_note_rand < 0.30 THEN
        v_note := (ARRAY[
          'NATO strap today',
          'Perfect for this weather',
          'Love the lume on this one',
          'Running about +3s/day',
          'Switched to leather strap',
          'Great wrist presence',
          'Desk diving as usual',
          'Got a compliment at lunch',
          'This dial catches the light perfectly',
          'Thinking about getting it serviced soon'
        ])[floor(random()*10+1)::int];
      ELSE
        v_note := NULL;
      END IF;

      INSERT INTO logs (id, user_id, watch_id, date, use_case, notes, visibility, created_at)
      VALUES (
        gen_random_uuid()::text,
        '86ea0f82-044d-4730-82af-b942e3b09380',
        v_watch_ids[v_pick],
        v_day,
        v_use_case,
        v_note,
        'public',
        v_day + interval '8 hours' + (random() * interval '4 hours')
      );
    END IF;

    v_day := v_day + 1;
  END LOOP;

  -- ─── Posts (3 standalone posts, no watch_id) ─────────────────────────────
  INSERT INTO logs (id, user_id, watch_id, date, use_case, notes, visibility, created_at)
  VALUES
  (gen_random_uuid()::text, '86ea0f82-044d-4730-82af-b942e3b09380', NULL,
   '2025-10-15', NULL, 'Just picked up a new NATO strap from Crown & Buckle. Game changer for the SKX.',
   'public', '2025-10-15 12:30:00+00'),
  (gen_random_uuid()::text, '86ea0f82-044d-4730-82af-b942e3b09380', NULL,
   '2025-12-25', NULL, 'Merry Christmas! Wearing the Sinn today — it handles the cold like a champ.',
   'public', '2025-12-25 09:00:00+00'),
  (gen_random_uuid()::text, '86ea0f82-044d-4730-82af-b942e3b09380', NULL,
   '2026-02-10', NULL, 'Thinking about adding a pilot watch to the collection. Any recommendations?',
   'public', '2026-02-10 18:15:00+00');

END $$;


-- ═════════════════════════════════════════════════════════════════════════════
--  WISHLIST  (3 items)
-- ═════════════════════════════════════════════════════════════════════════════
INSERT INTO wishlist (id, user_id, brand, name, ref, price, url, image, notes,
                      color, tags, market_price, added_date)
VALUES
(gen_random_uuid()::text, '86ea0f82-044d-4730-82af-b942e3b09380',
 'IWC', 'Pilot''s Watch Mark XX', 'IW328203', 5150,
 'https://www.iwc.com/en/watch-collections/pilot-watches/iw328203-pilot-s-watch-mark-xx.html',
 NULL, 'Waiting for the right deal on Chrono24',
 '#1a1a2e', NULL, 5200, NOW() - interval '60 days'),

(gen_random_uuid()::text, '86ea0f82-044d-4730-82af-b942e3b09380',
 'Nomos', 'Club Campus 38', '736', 1780,
 'https://nomos-glashuette.com/en/club/club-campus-38-736',
 NULL, 'Love the Bauhaus aesthetic',
 '#e8e8e8', NULL, 1780, NOW() - interval '30 days'),

(gen_random_uuid()::text, '86ea0f82-044d-4730-82af-b942e3b09380',
 'Marathon', 'GSAR', 'WW194006', 1100,
 'https://www.marathonwatch.com/products/search-rescue-divers-automatic',
 NULL, 'Real tool watch vibes',
 '#3d4a2e', NULL, 1150, NOW() - interval '10 days');


COMMIT;
