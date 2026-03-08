-- ============================================================
-- Steve's Wear History — Bulk Import
-- Decoded from screen recording of another watch tracking app
-- User ID: 7337041a-710f-40a3-a02e-98021bd0a230
-- 80 wear logs from Nov 18, 2025 → Mar 7, 2026
-- ============================================================

-- First, look up Steve's watch IDs by matching brand + name
-- This ensures we link to the correct watches in his collection
-- Helper: generate short IDs like the app does (base36 timestamp + random)
CREATE OR REPLACE FUNCTION _tmp_short_id() RETURNS TEXT AS $fn$
  SELECT lower(
    lpad(to_hex((extract(epoch FROM clock_timestamp()) * 1000)::bigint), 11, '0')
    || substr(md5(random()::text), 1, 10)
  );
$fn$ LANGUAGE sql VOLATILE;

DO $$
DECLARE
  _uid UUID := '7337041a-710f-40a3-a02e-98021bd0a230';
  _ap  TEXT; -- Audemars Piguet Royal Oak Offshore Chronograph
  _exp TEXT; -- Rolex Explorer
  _ym  TEXT; -- Rolex Yacht-Master 40
  _op  TEXT; -- Rolex Oyster Perpetual 36
  _om  TEXT; -- Omega Seamaster Diver 300 M
  _vcf TEXT; -- Vacheron Constantin Fiftysix
  _vco TEXT; -- Vacheron Constantin Overseas
  _hub TEXT; -- Hublot Classic Fusion Chronograph
BEGIN
  SELECT id INTO _ap  FROM watches WHERE user_id = _uid AND name ILIKE '%Offshore%' LIMIT 1;
  SELECT id INTO _exp FROM watches WHERE user_id = _uid AND name ILIKE '%Explorer%' LIMIT 1;
  SELECT id INTO _ym  FROM watches WHERE user_id = _uid AND name ILIKE '%Yacht%Master%' LIMIT 1;
  SELECT id INTO _op  FROM watches WHERE user_id = _uid AND name ILIKE '%Oyster Perpetual%' LIMIT 1;
  SELECT id INTO _om  FROM watches WHERE user_id = _uid AND name ILIKE '%Seamaster%' LIMIT 1;
  SELECT id INTO _vcf FROM watches WHERE user_id = _uid AND (name ILIKE '%Fiftysix%' OR name ILIKE '%Fifty%Six%') LIMIT 1;
  SELECT id INTO _vco FROM watches WHERE user_id = _uid AND name ILIKE '%Overseas%' LIMIT 1;
  SELECT id INTO _hub FROM watches WHERE user_id = _uid AND name ILIKE '%Classic Fusion%' LIMIT 1;

  -- Validate all watches found
  IF _ap IS NULL OR _exp IS NULL OR _ym IS NULL OR _op IS NULL
     OR _om IS NULL OR _vcf IS NULL OR _vco IS NULL OR _hub IS NULL THEN
    RAISE EXCEPTION 'Missing watches! ap=% exp=% ym=% op=% om=% vcf=% vco=% hub=%',
      _ap, _exp, _ym, _op, _om, _vcf, _vco, _hub;
  END IF;

  RAISE NOTICE 'Found all 8 watches. Inserting 80 wear logs...';

  INSERT INTO logs (id, user_id, watch_id, date, use_case, visibility)
  VALUES
    -- ═══════════════ March 2026 ═══════════════
    (_tmp_short_id(), _uid, _op,  '2026-03-07', 'leisure',     'public'),
    (_tmp_short_id(), _uid, _vco, '2026-03-06', 'work',        'public'),
    (_tmp_short_id(), _uid, _vco, '2026-03-05', 'work',        'public'),
    (_tmp_short_id(), _uid, _vcf, '2026-03-03', 'work',        'public'),

    -- ═══════════════ February 2026 ═══════════════
    (_tmp_short_id(), _uid, _vco, '2026-02-28', 'leisure',     'public'),
    (_tmp_short_id(), _uid, _vco, '2026-02-26', 'work',        'public'),
    (_tmp_short_id(), _uid, _vco, '2026-02-25', 'work',        'public'),
    (_tmp_short_id(), _uid, _hub, '2026-02-24', 'work',        'public'),
    (_tmp_short_id(), _uid, _vco, '2026-02-24', 'dinner',      'public'),
    (_tmp_short_id(), _uid, _vcf, '2026-02-23', 'work',        'public'),
    (_tmp_short_id(), _uid, _om,  '2026-02-21', 'dinner',      'public'),
    (_tmp_short_id(), _uid, _om,  '2026-02-18', 'dinner',      'public'),
    (_tmp_short_id(), _uid, _om,  '2026-02-17', 'dinner',      'public'),
    (_tmp_short_id(), _uid, _om,  '2026-02-16', 'leisure',     'public'),
    (_tmp_short_id(), _uid, _om,  '2026-02-15', 'dinner',      'public'),
    (_tmp_short_id(), _uid, _exp, '2026-02-12', 'work',        'public'),
    (_tmp_short_id(), _uid, _ym,  '2026-02-10', 'work',        'public'),
    (_tmp_short_id(), _uid, _exp, '2026-02-08', 'dinner',      'public'),  -- was "Party"
    (_tmp_short_id(), _uid, _exp, '2026-02-04', 'work',        'public'),
    (_tmp_short_id(), _uid, _ap,  '2026-02-03', 'work',        'public'),
    (_tmp_short_id(), _uid, _vcf, '2026-02-02', 'work',        'public'),

    -- ═══════════════ January 2026 ═══════════════
    (_tmp_short_id(), _uid, _vcf, '2026-01-30', 'work',        'public'),
    (_tmp_short_id(), _uid, _exp, '2026-01-29', 'work',        'public'),
    (_tmp_short_id(), _uid, _exp, '2026-01-28', 'work',        'public'),
    (_tmp_short_id(), _uid, _vcf, '2026-01-27', 'work',        'public'),
    (_tmp_short_id(), _uid, _exp, '2026-01-23', 'work',        'public'),
    (_tmp_short_id(), _uid, _vcf, '2026-01-22', 'work',        'public'),
    (_tmp_short_id(), _uid, _ym,  '2026-01-22', 'dinner',      'public'),
    (_tmp_short_id(), _uid, _vcf, '2026-01-21', 'dinner',      'public'),
    (_tmp_short_id(), _uid, _ym,  '2026-01-20', 'work',        'public'),
    (_tmp_short_id(), _uid, _ym,  '2026-01-19', 'dinner',      'public'),
    (_tmp_short_id(), _uid, _exp, '2026-01-16', 'work',        'public'),
    (_tmp_short_id(), _uid, _vcf, '2026-01-15', 'work',        'public'),
    (_tmp_short_id(), _uid, _exp, '2026-01-14', 'work',        'public'),
    (_tmp_short_id(), _uid, _exp, '2026-01-13', 'work',        'public'),
    (_tmp_short_id(), _uid, _ym,  '2026-01-12', 'work',        'public'),
    (_tmp_short_id(), _uid, _ym,  '2026-01-11', 'travel',      'public'),  -- was "Vacation"
    (_tmp_short_id(), _uid, _ym,  '2026-01-10', 'dinner',      'public'),
    (_tmp_short_id(), _uid, _ym,  '2026-01-09', 'travel',      'public'),  -- was "Vacation"
    (_tmp_short_id(), _uid, _vcf, '2026-01-08', 'work',        'public'),
    (_tmp_short_id(), _uid, _hub, '2026-01-07', 'work',        'public'),
    (_tmp_short_id(), _uid, _vcf, '2026-01-06', 'work',        'public'),
    (_tmp_short_id(), _uid, _exp, '2026-01-02', 'unspecified', 'public'),  -- was "Not specified"
    (_tmp_short_id(), _uid, _exp, '2026-01-01', 'dinner',      'public'),

    -- ═══════════════ December 2025 ═══════════════
    (_tmp_short_id(), _uid, _om,  '2025-12-31', 'travel',      'public'),  -- was "Vacation"
    (_tmp_short_id(), _uid, _om,  '2025-12-30', 'travel',      'public'),  -- was "Vacation"
    (_tmp_short_id(), _uid, _ap,  '2025-12-29', 'leisure',     'public'),
    (_tmp_short_id(), _uid, _om,  '2025-12-29', 'leisure',     'public'),
    (_tmp_short_id(), _uid, _om,  '2025-12-28', 'leisure',     'public'),
    (_tmp_short_id(), _uid, _ap,  '2025-12-28', 'dinner',      'public'),
    (_tmp_short_id(), _uid, _ap,  '2025-12-27', 'dinner',      'public'),
    (_tmp_short_id(), _uid, _om,  '2025-12-26', 'leisure',     'public'),
    (_tmp_short_id(), _uid, _ap,  '2025-12-25', 'dinner',      'public'),
    (_tmp_short_id(), _uid, _ym,  '2025-12-24', 'unspecified', 'public'),  -- was "Not specified"
    (_tmp_short_id(), _uid, _vcf, '2025-12-22', 'unspecified', 'public'),  -- was "Not specified"
    (_tmp_short_id(), _uid, _om,  '2025-12-19', 'work',        'public'),
    (_tmp_short_id(), _uid, _hub, '2025-12-18', 'work',        'public'),
    (_tmp_short_id(), _uid, _hub, '2025-12-17', 'dinner',      'public'),  -- was "Party"
    (_tmp_short_id(), _uid, _vcf, '2025-12-16', 'work',        'public'),
    (_tmp_short_id(), _uid, _ap,  '2025-12-14', 'leisure',     'public'),
    (_tmp_short_id(), _uid, _ap,  '2025-12-12', 'work',        'public'),
    (_tmp_short_id(), _uid, _om,  '2025-12-11', 'work',        'public'),
    (_tmp_short_id(), _uid, _om,  '2025-12-10', 'work',        'public'),
    (_tmp_short_id(), _uid, _vcf, '2025-12-08', 'work',        'public'),
    (_tmp_short_id(), _uid, _ap,  '2025-12-05', 'leisure',     'public'),
    (_tmp_short_id(), _uid, _ym,  '2025-12-05', 'dinner',      'public'),  -- was "Party"
    (_tmp_short_id(), _uid, _ym,  '2025-12-04', 'work',        'public'),
    (_tmp_short_id(), _uid, _exp, '2025-12-03', 'work',        'public'),
    (_tmp_short_id(), _uid, _ym,  '2025-12-03', 'dinner',      'public'),
    (_tmp_short_id(), _uid, _exp, '2025-12-02', 'work',        'public'),
    (_tmp_short_id(), _uid, _exp, '2025-12-01', 'work',        'public'),

    -- ═══════════════ November 2025 ═══════════════
    (_tmp_short_id(), _uid, _ap,  '2025-11-30', 'leisure',     'public'),
    (_tmp_short_id(), _uid, _ap,  '2025-11-28', 'leisure',     'public'),
    (_tmp_short_id(), _uid, _ap,  '2025-11-27', 'leisure',     'public'),
    (_tmp_short_id(), _uid, _ap,  '2025-11-26', 'leisure',     'public'),
    (_tmp_short_id(), _uid, _om,  '2025-11-25', 'work',        'public'),
    (_tmp_short_id(), _uid, _vcf, '2025-11-24', 'work',        'public'),
    (_tmp_short_id(), _uid, _om,  '2025-11-23', 'dinner',      'public'),  -- was "Party"
    (_tmp_short_id(), _uid, _vcf, '2025-11-19', 'unspecified', 'public'),  -- was "Not specified"
    (_tmp_short_id(), _uid, _hub, '2025-11-18', 'unspecified', 'public');  -- was "Not specified"

  RAISE NOTICE 'Done! Inserted 80 wear logs for Steve.';
END $$;

-- Clean up temp function
DROP FUNCTION IF EXISTS _tmp_short_id();
