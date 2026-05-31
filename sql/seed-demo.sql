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
--  WATCHES  (12 pieces — fully enhanced with specs, stories, and valuations)
-- ═════════════════════════════════════════════════════════════════════════════
INSERT INTO watches (id, user_id, brand, name, ref, price, purchase_date, color,
                     image, url, tags, straps, owner, market_price, market_price_date,
                     has_box, has_papers, elo_rating, watch_privacy,
                     movement_type, caliber, case_material, case_diameter, case_length,
                     case_thickness, weight, water_resistance, crystal_type, year_range,
                     gender, origin, functions, description, background)
VALUES
-- 1. Rolex Submariner Date
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Rolex', 'Submariner Date', '126610LN', 9500, '2021-03-15', '#006039',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/submariner.webp',
 'https://www.rolex.com/watches/submariner/m126610ln-0001',
 ARRAY['Daily Beater','Dive','Sport'], '[]'::jsonb, NULL, 12800, '2026-04-15',
 TRUE, TRUE, 1180, NULL,
 'Automatic', 'Rolex 3235', 'Oystersteel (904L stainless steel)', '41mm', '47.5mm',
 '12.4mm', '155g', '300m', 'Sapphire', '2020-present',
 'men''s', 'Switzerland',
 ARRAY['Date','Unidirectional rotating bezel','Chronometer','Luminescent display','300m water resistance'],
 'The 126610LN features a 41mm Oystersteel case with a black Cerachrom ceramic bezel insert and a black sunray dial. The Oyster bracelet includes Rolex''s Glidelock extension system for fine adjustment.',
 'The Submariner was introduced in 1953 as Rolex''s first purpose-built dive watch. The 126610LN, released in 2020, brought the case size to 41mm and introduced the caliber 3235 with a 70-hour power reserve. It remains the most recognized luxury dive watch in the world and a cornerstone of any serious collection.'),

-- 2. Omega Speedmaster Professional
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Omega', 'Speedmaster Professional Moonwatch', '310.30.42.50.01.002', 5200, '2020-06-20', '#1a1a2e',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/speedmaster.webp',
 'https://www.omegawatches.com/watch-omega-speedmaster-moonwatch-professional-co-axial-master-chronometer-chronograph-42-mm-31030425001002',
 ARRAY['Chronograph'], '[]'::jsonb, NULL, 6400, '2026-04-15',
 TRUE, TRUE, 1120, NULL,
 'Manual-wind', 'Omega 3861', 'Stainless steel', '42mm', '47mm',
 '13.2mm', '142g', '50m', 'Sapphire', '2021-present',
 'men''s', 'Switzerland',
 ARRAY['Chronograph','Tachymeter','Small seconds','30-minute counter','12-hour counter'],
 'The modern Moonwatch features a 42mm stainless steel case with a step dial in black and applied logo. The sapphire caseback reveals the decorated Co-Axial Master Chronometer 3861 movement.',
 'The Speedmaster Professional earned its ''Moonwatch'' moniker after being worn by Buzz Aldrin during the Apollo 11 moon landing in 1969. This reference updated the legendary chronograph with the Co-Axial Master Chronometer caliber 3861, bringing METAS certification while preserving the iconic design that has remained largely unchanged for over 60 years.'),

-- 3. Tudor Black Bay 58
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Tudor', 'Black Bay Fifty-Eight', 'M79030N', 3900, '2022-01-10', '#8B0000',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/blackbay58.webp',
 'https://www.tudorwatch.com/en/watches/black-bay-fifty-eight/m79030n-0001',
 ARRAY['Vintage','Dive'], '[]'::jsonb, NULL, 3600, '2026-04-15',
 TRUE, TRUE, 1060, NULL,
 'Automatic', 'Tudor MT5402', 'Stainless steel', '39mm', '48mm',
 '11.9mm', '140g', '200m', 'Sapphire', '2020-present',
 'men''s', 'Switzerland',
 ARRAY['Unidirectional rotating bezel','Luminescent display','200m water resistance','COSC chronometer'],
 'The Black Bay Fifty-Eight in black features a 39mm stainless steel case inspired by Tudor''s 1958 reference 7924 ''Big Crown''. The gilt details on the black dial and matching black anodized aluminum bezel insert give it a distinctly vintage aesthetic.',
 'Tudor introduced the Black Bay Fifty-Eight in 2018 as a more wearable alternative to the 41mm Black Bay. The 39mm case and slim profile drew from Tudor''s original 1958 dive watch. The black dial M79030N, released in 2020, became an instant hit for its versatility and vintage-inspired proportions at a fraction of Rolex pricing.'),

-- 4. Grand Seiko Spring Drive Snowflake
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Grand Seiko', 'Spring Drive Snowflake', 'SBGA211', 5600, '2021-09-05', '#e8e8e8',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/snowflake.webp',
 'https://www.grand-seiko.com/us-en/collections/sbga211',
 ARRAY['Dress'], '[]'::jsonb, NULL, 5200, '2026-04-15',
 TRUE, TRUE, 1040, NULL,
 'Spring Drive', '9R65', 'High-intensity titanium', '41mm', '48mm',
 '12.5mm', '99g', '100m', 'Sapphire (dual-curved)', '2016-present',
 'men''s', 'Japan',
 ARRAY['Date','Power reserve indicator','Spring Drive glide motion seconds','Anti-magnetic'],
 'The Snowflake features a 41mm high-intensity titanium case with the iconic textured white dial inspired by the snow-covered landscape of the Shinshu region. The blue-steel second hand sweeps in the uniquely smooth Spring Drive motion.',
 'The SBGA211, successor to the beloved SBGA011, refined the ''Snowflake'' dial texture that has become Grand Seiko''s most recognizable design. The dial is made using a special pressing technique that creates a pattern resembling freshly fallen snow. Its Spring Drive movement, exclusive to Seiko, combines mechanical craftsmanship with electronic precision for accuracy of ±1 second per day.'),

-- 5. IWC Portugieser Chronograph
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'IWC', 'Portugieser Chronograph', 'IW371605', 7500, '2023-04-18', '#1e3a5f',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/portugieser.webp',
 'https://www.iwc.com/en/watch-collections/portugieser/iw371605-portugieser-chronograph.html',
 ARRAY['Dress','Chronograph'], '[]'::jsonb, NULL, 6400, '2026-04-15',
 TRUE, TRUE, 1020, NULL,
 'Automatic', 'IWC 69355', 'Stainless steel', '41mm', '47.6mm',
 '13.1mm', '120g', '30m', 'Sapphire', '2020-present',
 'men''s', 'Switzerland',
 ARRAY['Chronograph','Small seconds','30-minute counter','12-hour counter','Date'],
 'The Portugieser Chronograph features a 41mm stainless steel case with a sunburst blue dial, applied Arabic numerals, and leaf-shaped hands. The clean layout with recessed subdials is a hallmark of the Portugieser design language.',
 'The IWC Portugieser originated in 1939 when two Portuguese importers requested a wristwatch with the precision of a marine chronometer. The Chronograph version has been in the collection since 1998 and remains one of IWC''s best-selling models. The IW371605 brought the case down to 41mm from the previous 42mm, with an updated in-house caliber offering 46 hours of power reserve.'),

-- 6. Cartier Santos Medium
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Cartier', 'Santos de Cartier Medium', 'WSSA0029', 6800, '2022-08-22', '#c9a84c',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/santos.webp',
 'https://www.cartier.com/en-us/watches/santos-de-cartier/santos-de-cartier-watch-WSSA0029.html',
 ARRAY['Dress','Daily Beater'], '[]'::jsonb, NULL, 8100, '2026-04-15',
 TRUE, TRUE, 1080, NULL,
 'Automatic', 'Cartier 1847 MC', 'Stainless steel', '35.1mm', '41.9mm',
 '8.83mm', '120g', '100m', 'Sapphire', '2018-present',
 'unisex', 'Switzerland',
 ARRAY['Date','QuickSwitch interchangeable strap system','SmartLink bracelet adjustment'],
 'The Santos Medium features a 35.1mm stainless steel case with the iconic square bezel, eight exposed screws, and a silvered opaline dial with Roman numerals. Comes with both steel bracelet and leather strap via Cartier''s QuickSwitch system.',
 'The Santos was originally designed by Louis Cartier in 1904 for Brazilian aviator Alberto Santos-Dumont, making it one of the first purpose-built wristwatches in history. The 2018 redesign introduced the QuickSwitch strap system and SmartLink bracelet, modernizing the legend while preserving its distinctive DNA. The medium size has become the most popular variant, equally at home in the boardroom and on the weekend.'),

-- 7. Rolex GMT-Master II "Batman"
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Rolex', 'GMT-Master II', '126710BLNR', 14200, '2023-11-03', '#003366',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/gmtmaster.webp',
 'https://www.rolex.com/watches/gmt-master-ii/m126710blnr-0003',
 ARRAY['GMT'], '[]'::jsonb, NULL, 16800, '2026-04-15',
 TRUE, TRUE, 1150, NULL,
 'Automatic', 'Rolex 3285', 'Oystersteel (904L stainless steel)', '40mm', '47.5mm',
 '12.1mm', '155g', '100m', 'Sapphire', '2019-present',
 'men''s', 'Switzerland',
 ARRAY['GMT/Dual timezone','Date','24-hour bidirectional rotating bezel','Chronometer','Luminescent display'],
 'The GMT-Master II ''Batman'' features a 40mm Oystersteel case with a blue and black Cerachrom ceramic bidirectional rotating bezel. The black dial with luminescent hour markers pairs with the Jubilee bracelet for a distinctive look.',
 'The GMT-Master was originally developed in 1955 for Pan Am pilots who needed to track multiple time zones. The 126710BLNR, nicknamed ''Batman'' for its blue and black bezel, was introduced on the Jubilee bracelet in 2019 with the caliber 3285 offering a 70-hour power reserve. It consistently trades well above retail on the secondary market, making it one of the most sought-after steel sports watches in production.'),

-- 8. Jaeger-LeCoultre Reverso Classic
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Jaeger-LeCoultre', 'Reverso Classic Large', 'Q3858520', 7000, '2020-11-28', '#8B4513',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/reverso.webp',
 'https://www.jaeger-lecoultre.com/us-en/watches/reverso/reverso-classic-large/q3858520',
 ARRAY['Dress'], '[]'::jsonb, NULL, 8400, '2026-04-15',
 TRUE, TRUE, 1010, NULL,
 'Manual-wind', 'JLC 822/2', 'Stainless steel', '45.6 x 27.4mm', '45.6mm',
 '8.5mm', '75g', '30m', 'Sapphire', '2019-present',
 'men''s', 'Switzerland',
 ARRAY['Reversible case','Small seconds'],
 'The Reverso Classic Large features a rectangular stainless steel case with the signature reversible mechanism, a silvered dial with blue Arabic hour markers, and Dauphine-style hands. The case back can be flipped to protect the crystal or display an engraving.',
 'The Reverso was created in 1931 for British polo players in India who needed a watch that could survive the rigors of the sport. Its swiveling case, originally designed for protection, has become one of the most iconic designs in watchmaking. The Classic Large preserves the original Art Deco proportions while offering a manual-wind movement that connects the wearer to traditional horology.'),

-- 9. Seiko Presage Cocktail Time
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Seiko', 'Presage Cocktail Time', 'SRPB43', 310, '2019-03-12', '#4169E1',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/presage.webp',
 'https://www.seikowatches.com/us-en/products/presage/srpb43',
 ARRAY['Dress'], '[]'::jsonb, NULL, 280, '2026-04-15',
 TRUE, FALSE, 950, NULL,
 'Automatic', 'Seiko 4R35', 'Stainless steel', '40.5mm', '46mm',
 '11.8mm', '145g', '50m', 'Hardlex', '2017-2022',
 'men''s', 'Japan',
 ARRAY['Date','Hacking seconds','Hand-winding capable'],
 'The Presage Cocktail Time SRPB43 features a 40.5mm stainless steel case with a radiant blue sunburst dial inspired by the ''Starlight'' cocktail. The textured dial catches light beautifully and creates a visual depth unusual at this price point.',
 'The Presage Cocktail Time series, inspired by classic cocktails, put Seiko''s dress watch line on the map for enthusiasts. The SRPB43 ''Starlight'' with its mesmerizing blue dial became one of the most recommended entry-level mechanical watches in the hobby. Now discontinued, it introduced countless collectors to the world of automatic watches and remains a benchmark for value in watchmaking.'),

-- 10. Casio G-Shock GA-2100 "CasiOak"
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Casio', 'G-Shock GA-2100', 'GA-2100-1A1', 99, '2022-05-01', '#2d2d2d',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/gshock.webp',
 'https://www.casio.com/us/watches/gshock/product.GA-2100-1A1/',
 ARRAY['Daily Beater','Sport'], '[]'::jsonb, NULL, 85, '2026-04-15',
 FALSE, FALSE, 970, NULL,
 'Quartz', 'Casio 5611', 'Carbon Core Guard resin', '45.4mm', '48.5mm',
 '11.8mm', '51g', '200m', 'Mineral', '2019-present',
 'unisex', 'Japan',
 ARRAY['World time','Stopwatch','Countdown timer','5 daily alarms','LED light','Shock resistance','200m water resistance'],
 'The GA-2100-1A1 ''CasiOak'' features an octagonal bezel design in stealth all-black with a Carbon Core Guard structure. At just 11.8mm thick and 51g, it''s one of the thinnest and lightest G-Shock models ever made.',
 'Nicknamed ''CasiOak'' by the watch community for its resemblance to the Audemars Piguet Royal Oak, the GA-2100 became a viral sensation when released in 2019. Its slim profile broke from G-Shock''s traditionally bulky designs, and the all-black 1A1 variant was nearly impossible to find at retail for over a year. It demonstrated that hype-driven demand could extend well beyond luxury watches.'),

-- 11. Zenith Chronomaster Sport
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Zenith', 'Chronomaster Sport', '03.3100.3600', 8500, '2024-02-14', '#1a1a2e',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/chronomaster.webp',
 'https://www.zenith-watches.com/en_us/chronomaster-sport.html',
 ARRAY['Chronograph','Sport'], '[]'::jsonb, NULL, 8200, '2026-04-15',
 TRUE, TRUE, 1030, NULL,
 'Automatic', 'Zenith El Primero 3600', 'Stainless steel', '41mm', '46mm',
 '13.6mm', '145g', '100m', 'Sapphire', '2021-present',
 'men''s', 'Switzerland',
 ARRAY['Chronograph','Date','Tachymeter','1/10th of a second precision','Column wheel','60-hour power reserve'],
 'The Chronomaster Sport features a 41mm stainless steel case with a tricolor dial layout — black and light gray subdials on a white base — and a ceramic tachymeter bezel. The El Primero 3600 movement beats at 36,000 vph for 1/10th of a second chronograph precision.',
 'The El Primero, introduced in 1969, was one of the first automatic chronograph movements ever created. The Chronomaster Sport, launched in 2021, reimagined the classic El Primero for a modern audience with a ceramic bezel and contemporary proportions. Often called the best alternative to a Rolex Daytona, it offers superior movement finishing and a unique 1/10th-second chronograph capability that no Daytona can match.'),

-- 12. Panerai Luminor Marina
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Panerai', 'Luminor Marina', 'PAM01312', 7200, '2023-07-09', '#3d3d2e',
 'https://xnzweevzrojmouzhpwzv.supabase.co/storage/v1/object/public/watch-images/demo/luminor.webp',
 'https://www.panerai.com/us/en/collections/watch-collection/luminor/pam01312.html',
 ARRAY['Dive'], '[]'::jsonb, NULL, 5800, '2026-04-15',
 TRUE, TRUE, 1000, NULL,
 'Automatic', 'Panerai P.9010', 'Stainless steel', '44mm', '52mm',
 '15.6mm', '175g', '300m', 'Sapphire', '2020-present',
 'men''s', 'Switzerland',
 ARRAY['Date','Small seconds','Luminescent sandwich dial','Crown-protecting bridge device','300m water resistance'],
 'The Luminor Marina PAM01312 features a 44mm stainless steel cushion-shaped case with Panerai''s iconic crown-protecting bridge, a blue sunburst dial with sandwich construction for luminescence, and Arabic numeral hour markers at 6 and 12.',
 'Panerai''s history dates to 1860 as a supplier of precision instruments to the Italian Navy. The Luminor Marina''s distinctive crown bridge was originally designed to ensure water resistance for military divers. The PAM01312 carries forward this heritage with the in-house P.9010 caliber offering a 3-day power reserve. The 44mm size remains the brand''s signature, appealing to those who prefer a commanding wrist presence.');


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
 'A. Lange & Söhne', 'Saxonia', '380.032', 23500,
 'https://www.alange-soehne.com/en/timepieces/saxonia/saxonia/380032',
 NULL,
 'The ultimate dress watch. Someday.',
 '#c9a84c', ARRAY['Dress'], 19500, '2025-04-10'),

-- 2. Patek Philippe Calatrava
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Patek Philippe', 'Calatrava', '5227G', 37000,
 'https://www.patek.com/en/collection/calatrava/5227G-010',
 NULL,
 'White gold perfection',
 '#1a1a2e', ARRAY['Dress'], 33000, '2025-06-22'),

-- 3. Omega Seamaster 300M
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Omega', 'Seamaster Diver 300M', '210.30.42.20.03.001', 5400,
 'https://www.omegawatches.com/watch-omega-seamaster-diver-300m-co-axial-master-chronometer-42-mm-21030422003001',
 NULL,
 'Blue dial for summer',
 '#003366', ARRAY['Dive','Daily Beater'], 4600, '2025-08-05'),

-- 4. Nomos Tangente 38
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Nomos', 'Tangente 38', '164', 1960,
 'https://nomos-glashuette.com/en/tangente/tangente-164',
 NULL,
 'Clean minimalism',
 '#e8e8e8', ARRAY['Dress'], 1550, '2025-09-18'),

-- 5. Breitling Navitimer B01
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'Breitling', 'Navitimer B01 Chronograph 43', 'AB0137211B1A1', 9100,
 'https://www.breitling.com/us-en/watches/navitimer/b01-chronograph-43/AB0137211B1A1/',
 NULL,
 'Classic aviation chronograph',
 '#1a1a2e', ARRAY['Pilot','Chronograph'], 7200, '2025-11-02'),

-- 6. H. Moser & Cie Streamliner Flyback
(gen_random_uuid()::text, '73e4e48e-dbca-4b2e-82d2-35d5b39716d2',
 'H. Moser & Cie', 'Streamliner Flyback Chronograph', '6902-1200', 29900,
 'https://www.h-moser.com/product/streamliner-flyback-chronograph/',
 NULL,
 'Fumé dial is incredible',
 '#4a6741', ARRAY['Chronograph','Sport-Luxury'], 32500, '2026-01-15');


COMMIT;

-- ══════════════════════════════════════════════════════════════════════════════
--  Done! Your demo account now has:
--   • 1 profile (James Collins / @watchdemo)
--   • 12 watches across 9 brands
--   • ~330 wear log entries spanning Mar 2025 – Feb 2026
--   • 10 general posts (thoughts & observations)
--   • 6 wishlist items including 3 grail watches
--
--  Total collection value:  ~$75,810 (purchase)
--  Total market value:      ~$82,065
-- ══════════════════════════════════════════════════════════════════════════════
