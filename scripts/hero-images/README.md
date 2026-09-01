# Hero image backfill (curated watch models)

Populates `watch_models.hero_image` with **official manufacturer product
photography, self-hosted** in Supabase Storage (never hot-linked; never
Wikimedia/CC — owner's rule, 2026-08-30).

- `sources.json` — per model: official `page_url`, direct `image_url`, `ambiguous_note`
  (what was chosen when the line has several metals/sizes/dials).
- `wrotate_hero_images.py` — download → JPEG (1500px long edge, q90, white-flattened,
  rejects sources < 600px) → upload `media/watches/<uploader>/model-<id>.jpg` → PATCH row.
  `--dry-run --save-local` writes previews to `preview/` for eyeballing first.
- `resolve_with_browser.cjs <url>` — headless resolver (og:image / ld+json / largest
  rendered <img>) for client-rendered product pages. Rolex and Tudor return 403 to
  headless browsers; their CDNs need direct image URLs instead.
- `hero_run_report.csv` — written by every run: source, dimensions, ambiguity flag.

Env: `source ~/.config/wrotate/supabase.env` (SUPABASE_URL + service role key).
Verify after a run:

```sql
select count(*) filter (where hero_image like 'https://api.wrotate.com/%') self_hosted,
       count(*) filter (where hero_image is not null and hero_image not like 'https://api.wrotate.com/%') external,
       count(*) filter (where hero_image is null or hero_image = '') still_missing
from watch_models where not is_auto and merged_into is null;
```

The temporary `backfill-hero-image` Edge Function is deleted once this completes.
