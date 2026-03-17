# Official Wrotate Account — Implementation Plan

## Decisions Made
- **Account:** Separate Supabase auth user ("wrotate")
- **Scope:** Full — auto-scraping with manual fallback
- **Badge:** Checkmark icon next to username

---

## Implementation Steps

### Step 1: Database Migration
New file: `supabase/migrations/YYYYMMDD_official_account.sql`

```sql
-- Add is_official flag to profiles
ALTER TABLE profiles ADD COLUMN is_official BOOLEAN DEFAULT false;

-- Official drafts table
CREATE TABLE official_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url TEXT,
  image_url TEXT,              -- extracted external image URL
  photo_stored_url TEXT,       -- after upload to Supabase Storage
  caption TEXT,
  celebrity_name TEXT,
  watch_info TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','approved','published','rejected')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  published_at TIMESTAMPTZ,
  published_log_id UUID REFERENCES logs(id),
  created_by UUID REFERENCES profiles(id)
);

ALTER TABLE official_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access" ON official_drafts
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
```

### Step 2: Create Official Account
- Create auth user in Supabase dashboard (email: official@wrotate.com)
- Set profile: username=`wrotate`, display_name="WRotate", is_official=true
- Upload WRotate logo as avatar
- Store the official user ID as a constant in the app (`OFFICIAL_USER_ID`)

### Step 3: Edge Function — `extract-url-meta`
New file: `supabase/functions/extract-url-meta/index.ts`

- Accepts POST with `{ url: string }`
- Fetches the URL server-side
- Parses HTML for OpenGraph tags: `og:image`, `og:title`, `og:description`
- Falls back to first large `<img>` tag and `<title>` if no OG tags
- Returns `{ image_url, title, description, site_name }`
- Admin-only: verify caller is admin via JWT
- Handle Instagram, blog sites, general web pages

### Step 4: Official Badge (UI)
In feed rendering, profile pages, and comments:

- When rendering a username, check `is_official` flag
- If true, append a small SVG checkmark badge
- CSS class: `.official-badge` — blue checkmark icon (similar to verified badges)
- Apply in: `renderFeedPost()`, `renderProfileHeader()`, `renderComment()`

### Step 5: Admin Panel — "Official Posts" Tab
New section in the existing admin panel (`showAdminPage()`):

**A) URL Input Form**
- Text input for URL (Instagram/blog link)
- "Extract" button → calls `extract-url-meta` Edge Function
- Shows preview: extracted image thumbnail + title/description
- Editable fields: caption, celebrity name, watch info
- If extraction fails: manual image URL input + caption fields
- "Save as Draft" button → inserts into `official_drafts`

**B) Drafts Queue**
- List all drafts with status='draft'
- Each row: thumbnail, caption preview, source URL, created date
- Actions: Edit | Approve | Delete
- Edit: opens inline form to modify caption/image/info
- Approve: triggers publish flow (Step 6)
- Delete: removes draft from table

**C) Published History**
- List published official posts
- Shows engagement (likes, comments count)
- Link to view post in feed

### Step 6: Publish Flow (on Approve)
When admin clicks "Approve" on a draft:

1. Fetch the image from `image_url` (external URL)
2. Convert to blob, resize via existing `blobToResizedBlob()`
3. Upload to Supabase Storage: `media/logs/{official_user_id}/{new_log_id}.jpg`
4. Create `logs` row:
   - `user_id`: OFFICIAL_USER_ID
   - `notes`: draft caption + source attribution
   - `photo_url`: stored URL from step 3
   - `visibility`: 'public'
   - `use_case`: 'unspecified'
   - `watch_id`: null (no watch from collection)
   - `date`: today
5. Update `official_drafts`: status='published', published_at=now(), published_log_id=new log id
6. Show success toast

### Step 7: Service Worker Cache Bump
- Increment SW cache version in `sw.js`

### Step 8: Tests
- Add Vitest tests for:
  - Draft CRUD operations
  - Publish flow
  - Badge rendering
  - URL extraction response handling

---

## Files to Create/Modify

| File | Action | What |
|------|--------|------|
| `supabase/migrations/20260317_official_account.sql` | Create | DB migration |
| `supabase/functions/extract-url-meta/index.ts` | Create | URL scraping Edge Function |
| `index.html` | Modify | Admin panel UI, badge rendering, publish flow |
| `wristlog.js` | Modify | Official post functions if logic lives here |
| `sw.js` | Modify | Cache version bump |
| `tests/official-account.test.js` | Create | Tests |

---

## Security Considerations
- All `official_drafts` access gated by RLS (admin-only)
- Edge Function verifies admin JWT
- External image URLs fetched server-side (no CORS issues)
- Source attribution included in published posts
- Official account cannot be followed/unfollowed differently — behaves like a normal account
