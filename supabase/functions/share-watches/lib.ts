// share-watches — pure logic for the token-addressed COLLECTION share page.
//
// This is the wishlist share (share-wishlist) pointed at `watches`: same token
// model, same page shell, same cards, same OG image. Everything that does not
// depend on the source table is imported from share-wishlist/lib.ts so the two
// pages cannot drift; only the select list and the copy live here.

export {
  avatarInnerHtml,
  esc,
  generateWishlistOgSvg,
  htmlPage,
  isShareUsable,
  renderSharePage,
  type SharePageData,
  shareStatePage,
  type ShareWatch,
  wishlistCardsHtml,
} from "../share-wishlist/lib.ts";
import type { ShareWatch } from "../share-wishlist/lib.ts";
import { count, fill } from "../_shared/lang.ts";
import type { Lang } from "../_shared/lang.ts";
import { SHARE_STRINGS } from "../_shared/share-strings.ts";

// The decisive privacy boundary of this feature: the columns the public page is
// allowed to read out of `watches`. lib.test.ts asserts on it.
//
// created_at and purchase_date are fetched only to ORDER the grid
// (sortSharedWatches) and are stripped before render — neither reaches the
// page. `url` is the owner's saved link, scheme-checked by safeLinkUrl before
// it becomes an href.
// NEVER add: price, market_price*, price_history, notes, tags, straps, owner,
// has_box, has_papers, insurance*, receipts, warranty_expiry, watch_privacy,
// elo_rating.
export const WATCHES_SHARE_SELECT = "id, brand, name, ref, image, url, created_at, purchase_date";

// The Collection tab's default order: purchase date, newest first; undated
// watches after dated ones; ties (and the undated) by when they were added,
// newest first. A share link that ignored this read as a random shuffle.
export function sortSharedWatches<T extends { purchase_date?: string | null; created_at?: string | null }>(rows: T[]): T[] {
  return [...(rows || [])].sort((a, b) => {
    const pa = a.purchase_date || "", pb = b.purchase_date || "";
    if (pa && pb && pa !== pb) return pa < pb ? 1 : -1;
    if (pa && !pb) return -1;
    if (!pa && pb) return 1;
    const ca = a.created_at || "", cb = b.created_at || "";
    return ca === cb ? 0 : (ca < cb ? 1 : -1);
  });
}

// English by default: the og:image SVG passes this function as its title line
// and stays English; the page passes the reader's language.
export function watchesHeading(displayName: string, lang: Lang = "en"): string {
  return fill(SHARE_STRINGS[lang].watchesPage.heading, { n: displayName });
}

export function buildWatchesOg(
  displayName: string,
  label: string | null | undefined,
  items: ShareWatch[],
  lang: Lang = "en",
): { ogTitle: string; ogDescription: string } {
  const n = (items || []).length;
  const ogTitle = `${watchesHeading(displayName, lang)} — WRotate`;
  const names = (items || []).slice(0, 3)
    .map((w) => `${w.brand || ""} ${w.name || ""}`.trim())
    .filter(Boolean)
    .join(", ");
  const parts = [count(lang, n, SHARE_STRINGS[lang].watches)];
  const trimmedLabel = (label || "").trim();
  if (trimmedLabel) parts.push(trimmedLabel);
  if (names) parts.push(names);
  return { ogTitle, ogDescription: parts.join(" · ") };
}
