-- ══════════════════════════════════════════════════════════════════════════════
--  WRISTLOG — DEMO ACCOUNT SEED SCRIPT
-- ══════════════════════════════════════════════════════════════════════════════
--
--  INSTRUCTIONS:
--  1. Sign up for a new account in the app (e.g. username "watchdemo")
--  2. Copy the user UUID from Supabase → Authentication → Users
--  3. Find-and-replace EVERY occurrence of '73e4e48e-dbca-4b2e-82d2-35d5b39716d2' below with that UUID
--     (keep the single quotes — it must be a valid UUID string)
--  4. Run this entire script in the Supabase SQL Editor
--
--  This script is idempotent: it deletes all existing data for 73e4e48e-dbca-4b2e-82d2-35d5b39716d2
--  before inserting fresh seed data.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Clean slate ─────────────────────────────────────────────────────────────
DELETE FROM logs     WHERE user_id = '73e4e48e-dbca-4b2e-82d2-35d5b39716d2';
DELETE FROM wishlist WHERE user_id = '73e4e48e-dbca-4b2e-82d2-35d5b39716d2';
DELETE FROM watches  WHERE user_id = '73e4e48e-dbca-4b2e-82d2-35d5b39716d2';

-- ─── Profile (upsert — the auth trigger may have already created the row) ───
INSERT INTO profiles (id, username, display_name, bio, avatar_url,
                      collection_visibility, profile_privacy, wishlist_visibility)
VALUES (
  '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
  'alexrivera',
  'Alex Rivera',
  'Horology enthusiast. Collecting since 2018. GMT complications and vintage chronographs.',
  NULL,
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
--  WATCHES  (12 pieces)
-- ═════════════════════════════════════════════════════════════════════════════
INSERT INTO watches (id, user_id, brand, name, ref, price, purchase_date, color,
                     image, url, tags, straps, owner, market_price, market_price_date,
                     has_box, has_papers, elo_rating, watch_privacy)
VALUES
-- 1. Rolex Submariner Date
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Rolex', 'Submariner Date', '126610LN', 9500, '2021-03-15', '#006039',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/submariner.webp',
 'https://www.rolex.com/watches/submariner/m126610ln-0001',
 ARRAY['Daily Beater','Dive','Sport'], '[]'::jsonb, NULL, 13200, '2025-12-01',
 TRUE, TRUE, 1180, NULL),

-- 2. Omega Speedmaster Professional
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Omega', 'Speedmaster Professional Moonwatch', '310.30.42.50.01.002', 6300, '2020-06-20', '#1a1a2e',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/speedmaster.webp',
 'https://www.omegawatches.com/watch-omega-speedmaster-moonwatch-professional-co-axial-master-chronometer-chronograph-42-mm-31030425001002',
 ARRAY['Chronograph'], '[]'::jsonb, NULL, 6800, '2025-11-15',
 TRUE, TRUE, 1120, NULL),

-- 3. Tudor Black Bay 58
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Tudor', 'Black Bay Fifty-Eight', 'M79030N', 3800, '2022-01-10', '#8B0000',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/blackbay58.webp',
 'https://www.tudorwatch.com/en/watches/black-bay-fifty-eight/m79030n-0001',
 ARRAY['Vintage','Dive'], '[]'::jsonb, NULL, 4100, '2025-10-20',
 TRUE, TRUE, 1060, NULL),

-- 4. Grand Seiko Spring Drive Snowflake
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Grand Seiko', 'Spring Drive Snowflake', 'SBGA211', 5800, '2021-09-05', '#e8e8e8',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/snowflake.webp',
 'https://www.grand-seiko.com/us-en/collections/sbga211',
 ARRAY['Dress'], '[]'::jsonb, NULL, 5400, '2025-11-01',
 TRUE, TRUE, 1040, NULL),

-- 5. IWC Portugieser Chronograph
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'IWC', 'Portugieser Chronograph', 'IW371605', 8200, '2023-04-18', '#1e3a5f',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/portugieser.webp',
 'https://www.iwc.com/en/watch-collections/portugieser/iw371605-portugieser-chronograph.html',
 ARRAY['Dress','Chronograph'], '[]'::jsonb, NULL, 7900, '2025-12-10',
 TRUE, TRUE, 1020, NULL),

-- 6. Cartier Santos Medium
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Cartier', 'Santos de Cartier Medium', 'WSSA0029', 7200, '2022-08-22', '#c9a84c',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/santos.webp',
 'https://www.cartier.com/en-us/watches/santos-de-cartier/santos-de-cartier-watch-WSSA0029.html',
 ARRAY['Dress','Daily Beater'], '[]'::jsonb, NULL, 7800, '2025-11-20',
 TRUE, TRUE, 1080, NULL),

-- 7. Rolex GMT-Master II "Batman"
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Rolex', 'GMT-Master II', '126710BLNR', 10800, '2023-11-03', '#003366',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/gmtmaster.webp',
 'https://www.rolex.com/watches/gmt-master-ii/m126710blnr-0003',
 ARRAY['GMT'], '[]'::jsonb, NULL, 17500, '2025-12-15',
 TRUE, TRUE, 1150, NULL),

-- 8. Jaeger-LeCoultre Reverso Classic
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Jaeger-LeCoultre', 'Reverso Classic Large', 'Q3858520', 7500, '2020-11-28', '#8B4513',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/reverso.webp',
 'https://www.jaeger-lecoultre.com/us-en/watches/reverso/reverso-classic-large/q3858520',
 ARRAY['Dress'], '[]'::jsonb, NULL, 8200, '2025-10-15',
 TRUE, TRUE, 1010, NULL),

-- 9. Seiko Presage Cocktail Time
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Seiko', 'Presage Cocktail Time', 'SRPB43', 350, '2019-03-12', '#4169E1',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/presage.webp',
 'https://www.seikowatches.com/us-en/products/presage/srpb43',
 ARRAY['Dress'], '[]'::jsonb, NULL, 380, '2025-09-01',
 TRUE, FALSE, 950, NULL),

-- 10. Casio G-Shock GA-2100 "CasiOak"
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Casio', 'G-Shock GA-2100', 'GA-2100-1A1', 100, '2022-05-01', '#2d2d2d',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/gshock.webp',
 'https://www.casio.com/us/watches/gshock/product.GA-2100-1A1/',
 ARRAY['Daily Beater','Sport'], '[]'::jsonb, NULL, 99, '2025-08-01',
 FALSE, FALSE, 970, NULL),

-- 11. Zenith Chronomaster Sport
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Zenith', 'Chronomaster Sport', '03.3100.3600', 8900, '2024-02-14', '#1a1a2e',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/chronomaster.webp',
 'https://www.zenith-watches.com/en_us/chronomaster-sport.html',
 ARRAY['Chronograph','Sport'], '[]'::jsonb, NULL, 9200, '2025-12-05',
 TRUE, TRUE, 1030, NULL),

-- 12. Panerai Luminor Marina
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Panerai', 'Luminor Marina', 'PAM01312', 7800, '2023-07-09', '#3d3d2e',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/luminor.webp',
 'https://www.panerai.com/us/en/collections/watch-collection/luminor/pam01312.html',
 ARRAY['Dive'], '[]'::jsonb, NULL, 7400, '2025-11-10',
 TRUE, TRUE, 1000, NULL);


-- ═════════════════════════════════════════════════════════════════════════════
--  WEAR LOGS  (~330 days of entries across Mar 2025 – Feb 2026)
--  Plus ~10 posts (watch_id IS NULL)
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  -- Watch IDs (we need to look them up since we used gen_random_uuid)
  v_sub_id     text;
  v_speedy_id  text;
  v_bb58_id    text;
  v_gs_id      text;
  v_iwc_id     text;
  v_santos_id  text;
  v_gmt_id     text;
  v_jlc_id     text;
  v_seiko_id   text;
  v_gshock_id  text;
  v_zenith_id  text;
  v_panerai_id text;

  -- Arrays for structured generation
  v_watch_ids    text[];
  v_watch_names  text[];
  v_weights      int[];       -- relative frequency weights
  v_use_cases    text[][];     -- per-watch typical use cases
  v_all_notes    text[];
  v_total_weight int;

  v_day          date;
  v_day_text     text;
  v_rand         double precision;
  v_cum_weight   int;
  v_pick         int;
  v_use_case     text;
  v_note         text;
  v_note_rand    double precision;
  v_uc_idx       int;
  v_skip_rand    double precision;
  v_cases_for_w  text[];
BEGIN
  -- ── Fetch the watch IDs we just inserted ──
  SELECT id INTO v_sub_id     FROM watches WHERE user_id = '73e4e48e-dbca-4b2e-82d2-35d5b39716d2' AND ref = '126610LN';
  SELECT id INTO v_speedy_id  FROM watches WHERE user_id = '73e4e48e-dbca-4b2e-82d2-35d5b39716d2' AND ref = '310.30.42.50.01.002';
  SELECT id INTO v_bb58_id    FROM watches WHERE user_id = '73e4e48e-dbca-4b2e-82d2-35d5b39716d2' AND ref = 'M79030N';
  SELECT id INTO v_gs_id      FROM watches WHERE user_id = '73e4e48e-dbca-4b2e-82d2-35d5b39716d2' AND ref = 'SBGA211';
  SELECT id INTO v_iwc_id     FROM watches WHERE user_id = '73e4e48e-dbca-4b2e-82d2-35d5b39716d2' AND ref = 'IW371605';
  SELECT id INTO v_santos_id  FROM watches WHERE user_id = '73e4e48e-dbca-4b2e-82d2-35d5b39716d2' AND ref = 'WSSA0029';
  SELECT id INTO v_gmt_id     FROM watches WHERE user_id = '73e4e48e-dbca-4b2e-82d2-35d5b39716d2' AND ref = '126710BLNR';
  SELECT id INTO v_jlc_id     FROM watches WHERE user_id = '73e4e48e-dbca-4b2e-82d2-35d5b39716d2' AND ref = 'Q3858520';
  SELECT id INTO v_seiko_id   FROM watches WHERE user_id = '73e4e48e-dbca-4b2e-82d2-35d5b39716d2' AND ref = 'SRPB43';
  SELECT id INTO v_gshock_id  FROM watches WHERE user_id = '73e4e48e-dbca-4b2e-82d2-35d5b39716d2' AND ref = 'GA-2100-1A1';
  SELECT id INTO v_zenith_id  FROM watches WHERE user_id = '73e4e48e-dbca-4b2e-82d2-35d5b39716d2' AND ref = '03.3100.3600';
  SELECT id INTO v_panerai_id FROM watches WHERE user_id = '73e4e48e-dbca-4b2e-82d2-35d5b39716d2' AND ref = 'PAM01312';

  -- ── Build parallel arrays (index 1-12) ──
  -- Order: Sub, Speedy, BB58, GS, IWC, Santos, GMT, JLC, Seiko, G-Shock, Zenith, Panerai
  v_watch_ids := ARRAY[
    v_sub_id, v_speedy_id, v_bb58_id, v_gs_id,
    v_iwc_id, v_santos_id, v_gmt_id, v_jlc_id,
    v_seiko_id, v_gshock_id, v_zenith_id, v_panerai_id
  ];

  v_watch_names := ARRAY[
    'Submariner', 'Speedmaster', 'Black Bay 58', 'Snowflake',
    'Portugieser', 'Santos', 'GMT-Master', 'Reverso',
    'Presage', 'G-Shock', 'Chronomaster', 'Luminor'
  ];

  -- Weights roughly proportional to target wear counts
  -- Sub:70 Speedy:50 BB58:30 GS:25 IWC:20 Santos:35 GMT:40 JLC:15 Seiko:10 GShock:25 Zenith:15 Panerai:15
  v_weights := ARRAY[70, 50, 30, 25, 20, 35, 40, 15, 10, 25, 15, 15];
  v_total_weight := 70+50+30+25+20+35+40+15+10+25+15+15;  -- 350

  -- Pool of realistic notes
  v_all_notes := ARRAY[
    'Perfect for the beach trip',
    'Board meeting today',
    'Date night',
    'Running errands',
    'Weekend brunch',
    'Hiking in the mountains',
    'Airport and flight to London',
    'Pool party — kept this one safe on the towel',
    'Wedding anniversary dinner',
    'Coffee run and morning walk',
    'Working from home today',
    'Client presentation — needed something sharp',
    'Road trip up the coast',
    'Lazy Sunday',
    'Caught the light beautifully at golden hour',
    'First day wearing this on the new strap',
    'Museum visit',
    'Barbecue with friends',
    'Office day — got a few compliments',
    'Rainy day — perfect beater weather',
    'Tennis match this morning',
    'Quick gym session before work',
    'Exploring the city on foot',
    'Dinner at the new Italian place',
    'Thanksgiving with the family',
    'Christmas morning',
    'New Year celebrations',
    'Skiing trip — G-Shock only!',
    'Long weekend getaway',
    'Just love how this catches the light',
    'Garden party',
    'Late night out downtown',
    'Conference day one',
    'Conference day two — switched it up',
    'Train ride to the countryside',
    'Farmers market morning',
    'Picked this for the blue dial to match the outfit',
    'Finally broke it in properly',
    'Spring cleaning the collection, wore this while doing it',
    'Celebrated getting the call from the AD',
    'Beach sunset walk',
    'Kids birthday party',
    'Quiet reading afternoon',
    'Festival weekend',
    'Game night with friends',
    'Sushi dinner — the Reverso felt right',
    'Marathon training run',
    'Morning surf session',
    'Photo shoot for the collection',
    'Back-to-back meetings all day'
  ];

  -- ── Generate wear logs day by day: Mar 1 2025 → Feb 28 2026 ──
  v_day := '2025-03-01'::date;

  WHILE v_day <= '2026-02-28'::date LOOP
    v_day_text := to_char(v_day, 'YYYY-MM-DD');

    -- ~90% chance of wearing a watch on any given day
    v_skip_rand := random();
    IF v_skip_rand < 0.10 THEN
      -- Skip this day (no watch worn)
      v_day := v_day + 1;
      CONTINUE;
    END IF;

    -- Weighted random pick of which watch to wear
    v_rand := random() * v_total_weight;
    v_cum_weight := 0;
    v_pick := 1;
    FOR i IN 1..12 LOOP
      v_cum_weight := v_cum_weight + v_weights[i];
      IF v_rand <= v_cum_weight THEN
        v_pick := i;
        EXIT;
      END IF;
    END LOOP;

    -- Assign a use_case based on which watch and some randomness
    -- Day of week: 1=Mon..7=Sun
    CASE v_pick
      WHEN 1 THEN  -- Submariner: work, leisure, sport
        CASE (EXTRACT(DOW FROM v_day)::int)
          WHEN 0, 6 THEN  -- weekend
            IF random() < 0.4 THEN v_use_case := 'leisure';
            ELSIF random() < 0.5 THEN v_use_case := 'sport';
            ELSE v_use_case := 'casual';
            END IF;
          ELSE  -- weekday
            IF random() < 0.6 THEN v_use_case := 'work';
            ELSE v_use_case := 'leisure';
            END IF;
        END CASE;
      WHEN 2 THEN  -- Speedmaster: work, leisure
        IF EXTRACT(DOW FROM v_day)::int IN (0, 6) THEN
          v_use_case := 'leisure';
        ELSE
          IF random() < 0.7 THEN v_use_case := 'work';
          ELSE v_use_case := 'leisure';
          END IF;
        END IF;
      WHEN 3 THEN  -- Black Bay 58: leisure, casual
        IF random() < 0.5 THEN v_use_case := 'leisure';
        ELSE v_use_case := 'casual';
        END IF;
      WHEN 4 THEN  -- Grand Seiko: work, dinner
        IF random() < 0.6 THEN v_use_case := 'work';
        ELSE v_use_case := 'dinner';
        END IF;
      WHEN 5 THEN  -- IWC Portugieser: work, dinner
        IF random() < 0.65 THEN v_use_case := 'work';
        ELSE v_use_case := 'dinner';
        END IF;
      WHEN 6 THEN  -- Santos: work, dinner
        IF EXTRACT(DOW FROM v_day)::int IN (0, 6) THEN
          IF random() < 0.4 THEN v_use_case := 'dinner';
          ELSE v_use_case := 'leisure';
          END IF;
        ELSE
          IF random() < 0.7 THEN v_use_case := 'work';
          ELSE v_use_case := 'dinner';
          END IF;
        END IF;
      WHEN 7 THEN  -- GMT-Master: work, travel
        IF random() < 0.55 THEN v_use_case := 'work';
        ELSIF random() < 0.5 THEN v_use_case := 'travel';
        ELSE v_use_case := 'leisure';
        END IF;
      WHEN 8 THEN  -- JLC Reverso: dinner, leisure
        IF random() < 0.55 THEN v_use_case := 'dinner';
        ELSE v_use_case := 'leisure';
        END IF;
      WHEN 9 THEN  -- Seiko Presage: casual, leisure
        IF random() < 0.5 THEN v_use_case := 'casual';
        ELSE v_use_case := 'leisure';
        END IF;
      WHEN 10 THEN -- G-Shock: sport, casual
        IF random() < 0.55 THEN v_use_case := 'sport';
        ELSE v_use_case := 'casual';
        END IF;
      WHEN 11 THEN -- Zenith Chronomaster: leisure, sport
        IF random() < 0.55 THEN v_use_case := 'leisure';
        ELSE v_use_case := 'sport';
        END IF;
      WHEN 12 THEN -- Panerai Luminor: leisure, casual
        IF random() < 0.5 THEN v_use_case := 'leisure';
        ELSE v_use_case := 'casual';
        END IF;
      ELSE
        v_use_case := 'unspecified';
    END CASE;

    -- ~20% chance of adding a note
    v_note := NULL;
    v_note_rand := random();
    IF v_note_rand < 0.20 THEN
      v_note := v_all_notes[1 + floor(random() * array_length(v_all_notes, 1))::int];
    END IF;

    -- Insert the wear log
    INSERT INTO logs (id, user_id, watch_id, date, use_case, notes, photo_url, visibility, club_id)
    VALUES (
      gen_random_uuid()::text,
      '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
      v_watch_ids[v_pick],
      v_day_text,
      v_use_case,
      v_note,
      NULL,
      'public',
      NULL
    );

    v_day := v_day + 1;
  END LOOP;

  -- ── Posts (logs with no watch_id) — general musings ──
  INSERT INTO logs (id, user_id, watch_id, date, use_case, notes, photo_url, visibility, club_id)
  VALUES
    (gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2', NULL, '2025-03-20', 'unspecified',
     'Just reorganized my watch box. The collection is really coming together.',
     NULL, 'public', NULL),

    (gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2', NULL, '2025-04-15', 'unspecified',
     'Visited the Omega boutique today. The new Moonshine Gold Speedmaster in person is something else.',
     NULL, 'public', NULL),

    (gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2', NULL, '2025-05-28', 'unspecified',
     'Hot take: the best watch in any collection is the one you actually wear.',
     NULL, 'public', NULL),

    (gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2', NULL, '2025-07-04', 'unspecified',
     'Happy Fourth! Rocking the red, white and blue — Pepsi GMT would have been perfect but Batman will do.',
     NULL, 'public', NULL),

    (gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2', NULL, '2025-08-12', 'unspecified',
     'Thinking about adding a proper field watch to the rotation. Maybe a Hamilton Khaki?',
     NULL, 'public', NULL),

    (gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2', NULL, '2025-09-30', 'unspecified',
     'Three months of tracking wear data and the Submariner is the clear daily champion. No surprise there.',
     NULL, 'public', NULL),

    (gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2', NULL, '2025-11-15', 'unspecified',
     'The Snowflake dial in autumn light is unreal. Spring Drive sweep never gets old.',
     NULL, 'public', NULL),

    (gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2', NULL, '2025-12-25', 'unspecified',
     'Christmas gift to myself: a custom leather strap for the Reverso. Burgundy alligator.',
     NULL, 'public', NULL),

    (gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2', NULL, '2026-01-10', 'unspecified',
     'New year resolution: wear the JLC and Seiko more. They deserve more wrist time.',
     NULL, 'public', NULL),

    (gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2', NULL, '2026-02-14', 'unspecified',
     'Valentine dinner with the Santos. Cartier just has that effortless elegance for date night.',
     NULL, 'public', NULL);

END $$;


-- ═════════════════════════════════════════════════════════════════════════════
--  WISHLIST  (6 items)
-- ═════════════════════════════════════════════════════════════════════════════
INSERT INTO wishlist (id, user_id, brand, name, ref, price, url, image, notes,
                      color, tags, market_price, added_date)
VALUES
-- 1. A. Lange & Söhne Saxonia
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'A. Lange & Söhne', 'Saxonia', '380.032', 23000,
 'https://www.alange-soehne.com/en/timepieces/saxonia/saxonia/380032',
 NULL,
 'The ultimate dress watch. Someday.',
 '#c9a84c', ARRAY['Dress'], 23500, '2025-04-10'),

-- 2. Patek Philippe Calatrava
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Patek Philippe', 'Calatrava', '5227G', 35000,
 'https://www.patek.com/en/collection/calatrava/5227G-010',
 NULL,
 'White gold perfection',
 '#1a1a2e', ARRAY['Dress'], 38000, '2025-06-22'),

-- 3. Omega Seamaster 300M
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Omega', 'Seamaster Diver 300M', '210.30.42.20.03.001', 5200,
 'https://www.omegawatches.com/watch-omega-seamaster-diver-300m-co-axial-master-chronometer-42-mm-21030422003001',
 NULL,
 'Blue dial for summer',
 '#003366', ARRAY['Dive','Daily Beater'], 5000, '2025-08-05'),

-- 4. Nomos Tangente 38
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Nomos', 'Tangente 38', '164', 1900,
 'https://nomos-glashuette.com/en/tangente/tangente-164',
 NULL,
 'Clean minimalism',
 '#e8e8e8', ARRAY['Dress'], 1850, '2025-09-18'),

-- 5. Breitling Navitimer B01
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Breitling', 'Navitimer B01 Chronograph 43', 'AB0137211B1A1', 8900,
 'https://www.breitling.com/us-en/watches/navitimer/b01-chronograph-43/AB0137211B1A1/',
 NULL,
 'Classic aviation chronograph',
 '#1a1a2e', ARRAY['Pilot','Chronograph'], 8500, '2025-11-02'),

-- 6. H. Moser & Cie Streamliner Flyback
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'H. Moser & Cie', 'Streamliner Flyback Chronograph', '6902-1200', 28500,
 'https://www.h-moser.com/product/streamliner-flyback-chronograph/',
 NULL,
 'Fumé dial is incredible',
 '#4a6741', ARRAY['Chronograph','Sport-Luxury'], 31000, '2026-01-15');


COMMIT;

-- ══════════════════════════════════════════════════════════════════════════════
--  Done! Your demo account now has:
--   • 1 profile (James Collins / @watchdemo)
--   • 12 watches across 9 brands
--   • ~330 wear log entries spanning Mar 2025 – Feb 2026
--   • 10 general posts (thoughts & observations)
--   • 6 wishlist items including 3 grail watches
--
--  Total collection value:  ~$76,250 (purchase)
--  Total market value:      ~$87,080
-- ══════════════════════════════════════════════════════════════════════════════
