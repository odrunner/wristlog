-- 2026-09-26: Google Search grounding left citation markers ("… King Seiko. [3, 8]")
-- in 5 enriched models' write-ups. identify-watch now strips them before storing
-- (stripCitations); this cleans the rows already written.
update watch_models set
  description     = nullif(trim(regexp_replace(description, '\s*\[\d+(\s*,\s*\d+)*\]', '', 'g')), ''),
  history         = nullif(trim(regexp_replace(history, '\s*\[\d+(\s*,\s*\d+)*\]', '', 'g')), ''),
  refs_by_era     = regexp_replace(refs_by_era::text, '\s*\[\d+(\s*,\s*\d+)*\]', '', 'g')::jsonb,
  calibers_by_era = regexp_replace(calibers_by_era::text, '\s*\[\d+(\s*,\s*\d+)*\]', '', 'g')::jsonb,
  specs           = regexp_replace(specs::text, '\s*\[\d+(\s*,\s*\d+)*\]', '', 'g')::jsonb
where enriched_at is not null
  and (description ~ '\[\d+(\s*,\s*\d+)*\]' or history ~ '\[\d+(\s*,\s*\d+)*\]'
       or refs_by_era::text ~ '\[\d+(\s*,\s*\d+)*\]' or calibers_by_era::text ~ '\[\d+(\s*,\s*\d+)*\]'
       or specs::text ~ '\[\d+(\s*,\s*\d+)*\]')
returning slug;
