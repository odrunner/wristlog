-- Audit 2026-09-23 SEC-23-8 (part B, logged-out only).
-- Logged-out callers could read every financial column of any watch they could
-- see: 377 purchase prices, insured values, insurance text and receipt links.
-- No logged-out page needs them (p/, profile/ and embedded feed selects read
-- display columns only), so anon gets display columns only.
-- NOT applied to authenticated: the client saves with upsert
-- (INSERT … ON CONFLICT DO UPDATE SET col = EXCLUDED.col), which needs SELECT
-- on every column it writes — revoking price columns breaks saving (verified
-- 2026-09-25 in a rolled-back transaction). Hiding them from signed-in users
-- needs a save-path change first.
REVOKE SELECT ON public.watches FROM anon;
GRANT SELECT (id, user_id, brand, name, ref, purchase_date, color, image, url, tags, straps, has_box, has_papers, elo_rating, created_at, watch_privacy, movement, year_range, movement_type, caliber, case_material, case_diameter, case_length, case_thickness, weight, water_resistance, crystal_type, gender, origin, description, background, functions, bph, model_id) ON public.watches TO anon;
