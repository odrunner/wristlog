# Authenticated share links for non-public posts

**Date:** 2026-06-03
**Status:** Approved (design)

## Problem

The "Share post" option only appears on **public** posts. The feed card gates the
share button/menu item behind `vis === 'public'` ([index.html](../../../index.html)
lines ~9612, ~9618, ~9634), and the `share-post` edge function hard-gates on
`.eq("visibility", "public")` server-side
([supabase/functions/share-post/index.ts](../../../supabase/functions/share-post/index.ts) line 63).

A user wanted to share a **close-friends** post with a close friend who is allowed
to see it, and found no share option. The current share link is an **anonymous
public URL** with no per-viewer check, which is why it can only safely serve public
posts.

## Goal

Let a user share a post of any visibility. The link respects visibility via the
`logs` table RLS — a public post is viewable by anyone; a `followers`/`friends`/
`private` post is viewable only by a signed-in viewer the existing RLS policy
already allows (e.g. an accepted close friend). No content leaks to anonymous
viewers or chat link-preview crawlers.

## Key fact: RLS already enforces visibility

The `logs` table SELECT policy **"Others can read shared logs"** already returns a
row to an authenticated reader only when:
- `visibility = 'public'`, or
- `visibility = 'followers'` and the reader follows the author, or
- `visibility = 'friends'` (close friends) and there is an accepted `friend_requests`
  row between reader and author, or
- legacy `visibility IS NULL` and the reader follows the author, or
- club post and the reader is a club member.

So "authenticated share link" is plumbing: route the link to a same-origin,
logged-in viewer and let RLS decide. No new access logic.

## Design

### 1. Client — share button visibility & URL routing ([index.html](../../../index.html))

Feed card share UI (menu items + action-bar button):
- **Public posts:** share button shows for everyone (own + others') — unchanged.
- **Non-public posts:** share button shows **only on the viewer's own posts**
  (`isMe`). Re-sharing others' non-public posts is out of scope.

`sharePost(logId, visibility)` chooses the URL by visibility:
- **public** → `https://api.wrotate.com/functions/v1/share-post?id=<id>`
  (unchanged — rich server-rendered chat preview).
- **non-public** → `https://wrotate.com/p/?id=<id>` (in-app authenticated viewer).

Visibility is already present on the feed `item`; pass it into `sharePost`.

### 2. Viewer — `p/index.html` becomes session-aware ([p/index.html](../../../p/index.html))

- Initialize the Supabase client to inherit the logged-in session (match the main
  app's auth options; today it forces `persistSession: false`, which blocks session
  reuse). Same origin (`wrotate.com`) + same default storage key → session shared
  automatically.
- Drop the hard `.eq('visibility','public')` filter. Query the post by id and let
  RLS decide:
  - **Row returned** → render (covers public-anonymous and authorized-authenticated).
  - **No row + no session** → "Sign in to view this post" screen with a sign-in
    button that returns here after login (`detectSessionInUrl`), then re-runs the query.
  - **No row + has session** → "This post is private" (logged in, not authorized).
- OG meta tags stay the **generic static defaults**. Real photo/caption are injected
  client-side only after an authorized read, so a non-public link pasted into chat
  never leaks content.

### 3. Edge function — unchanged ([share-post/index.ts](../../../supabase/functions/share-post/index.ts))

Stays public-only and anonymous; only ever linked for public posts. No privacy
regression.

## Privacy guarantees

| Scenario | Outcome |
|----------|---------|
| Anonymous chat crawler on non-public link | RLS returns nothing → generic card. No leak. |
| Stranger opens link, signed in | RLS denies → "This post is private." |
| Close friend opens link, signed in | RLS allows → post renders. |
| Close friend opens link, signed out | "Sign in to view" → after login, renders. |

## Testing

- **Unit:** `sharePost` URL selection by visibility (public → edge fn,
  non-public → `/p/`).
- **E2E (mocked):** share button renders on own non-public feed card (not on others'
  non-public); viewer renders post when RLS returns a row, shows sign-in prompt when
  no session + no row, shows "private" when session + no row.
- **Manual UAT** (test accounts, mutual close friends): testuser posts a
  close-friends post → share → open `/p/?id=` as testuser2 (sees it), signed-out
  (sign-in prompt), and as a non-friend (private).
- Bump SW cache version. Run `npm test` + `npm run test:e2e` before commit.

## Out of scope

- Re-sharing others' non-public posts.
- In-app "send to a specific user" (DM-style) sharing.
- Tokenized one-time links.
