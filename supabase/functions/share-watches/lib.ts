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
  type ShareWatch,
  wishlistCardsHtml,
} from "../share-wishlist/lib.ts";
import type { ShareWatch } from "../share-wishlist/lib.ts";

// The decisive privacy boundary of this feature: the columns the public page is
// allowed to read out of `watches`. lib.test.ts asserts on it.
//
// created_at is fetched only to order the grid and is stripped before render.
// `url` is the owner's saved link, scheme-checked by safeLinkUrl before it
// becomes an href.
// NEVER add: price, purchase_date, market_price*, price_history, notes, tags,
// straps, owner, has_box, has_papers, insurance*, receipts, warranty_expiry,
// watch_privacy, elo_rating.
export const WATCHES_SHARE_SELECT = "id, brand, name, ref, image, url, created_at";

export function watchesHeading(displayName: string): string {
  return `${displayName}'s watches`;
}

export function buildWatchesOg(
  displayName: string,
  label: string | null | undefined,
  items: ShareWatch[],
): { ogTitle: string; ogDescription: string } {
  const n = (items || []).length;
  const ogTitle = `${watchesHeading(displayName)} — WRotate`;
  const names = (items || []).slice(0, 3)
    .map((w) => `${w.brand || ""} ${w.name || ""}`.trim())
    .filter(Boolean)
    .join(", ");
  const parts = [`${n} watch${n !== 1 ? "es" : ""}`];
  const trimmedLabel = (label || "").trim();
  if (trimmedLabel) parts.push(trimmedLabel);
  if (names) parts.push(names);
  return { ogTitle, ogDescription: parts.join(" · ") };
}
