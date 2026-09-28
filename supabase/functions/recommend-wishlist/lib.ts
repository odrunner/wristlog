// recommend-wishlist — pure logic (no Deno/IO/network). index.ts imports these;
// lib.test.ts tests them.

import { clampText } from "../_shared/ai-guard.ts";

export type RecCollectionItem = {
  brand: string;
  name: string;
  ref: string;
  tags: string[];
  movement: string;
  size: string;
  price: number | null;
  wears90: number;
  wearsTotal: number;
  useCases: Record<string, number>;
};

export type RecWishItem = {
  id: string;
  brand: string;
  name: string;
  ref: string;
  price: number | null;
  tags: string[];
};

export type RecPayload = { collection: RecCollectionItem[]; wishlist: RecWishItem[] };

// The client computes wears from the four real use-case chips; anything else in
// the payload is untrusted and dropped.
const USE_CASES = ["work", "leisure", "dinner", "travel"];

function clampTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((t) => typeof t === "string" && t).slice(0, 6).map((t) => clampText(t, 30));
}

function clampCount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 100000) : 0;
}

export function sanitizeRecommendPayload(body: unknown): RecPayload {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const collection = (Array.isArray(b.collection) ? b.collection : []).slice(0, 300).map((w) => {
    const uc: Record<string, number> = {};
    const rawUc = w?.useCases;
    if (rawUc && typeof rawUc === "object") {
      for (const k of USE_CASES) {
        const n = clampCount((rawUc as Record<string, unknown>)[k]);
        if (n > 0) uc[k] = n;
      }
    }
    const price = Number(w?.price);
    return {
      brand: clampText(w?.brand), name: clampText(w?.name), ref: clampText(w?.ref, 60),
      tags: clampTags(w?.tags), movement: clampText(w?.movement, 30), size: clampText(w?.size, 10),
      price: Number.isFinite(price) && price > 0 ? price : null,
      wears90: clampCount(w?.wears90), wearsTotal: clampCount(w?.wearsTotal), useCases: uc,
    };
  });
  const wishlist = (Array.isArray(b.wishlist) ? b.wishlist : []).slice(0, 100).map((w) => {
    const price = Number(w?.price);
    return {
      id: clampText(w?.id, 64), brand: clampText(w?.brand), name: clampText(w?.name),
      ref: clampText(w?.ref, 60), price: Number.isFinite(price) && price > 0 ? price : null,
      tags: clampTags(w?.tags),
    };
  }).filter((w) => w.id && (w.brand || w.name));
  return { collection, wishlist };
}

function watchTitle(w: { brand: string; name: string; ref: string }): string {
  return [`${w.brand} ${w.name}`.trim(), w.ref ? `ref. ${w.ref}` : ""].filter(Boolean).join(" ");
}

function collectionLine(w: RecCollectionItem): string {
  const details = [
    w.tags.length ? `styles: ${w.tags.join("/")}` : "",
    w.movement, w.size ? `${w.size}mm` : "",
    w.price != null ? `worth $${w.price}` : "",
  ].filter(Boolean).join("; ");
  const uses = Object.entries(w.useCases).map(([k, n]) => `${k}×${n}`).join(", ");
  const wear = `worn ${w.wears90} of the last 90 days (${w.wearsTotal} all-time${uses ? `; ${uses}` : ""})`;
  return `- ${watchTitle(w)}${details ? ` — ${details}` : ""} — ${wear}`;
}

function wishLine(w: RecWishItem): string {
  const details = [
    w.tags.length ? `styles: ${w.tags.join("/")}` : "",
    w.price != null ? `approx $${w.price}` : "",
  ].filter(Boolean).join("; ");
  return `- [${w.id}] ${watchTitle(w)}${details ? ` — ${details}` : ""}`;
}

export function buildRecommendPrompt(p: RecPayload): string {
  const coll = p.collection.length
    ? `THEIR COLLECTION (${p.collection.length} watches):\n${p.collection.map(collectionLine).join("\n")}`
    : "THEIR COLLECTION: empty — this would be their first watch.";
  return `You are the recommendation engine inside WRotate, a watch collection app. Rank the user's wishlist watches by how well each would complement what they own and actually wear.

${coll}

THEIR WISHLIST:
${p.wishlist.map(wishLine).join("\n")}

Respond with ONLY a JSON object, no other text:
{"picks":[{"id":"<wishlist id>","reason":"<one specific sentence, max 140 chars>"}],"summary":"<one sentence on what the collection is missing overall>"}

Rules:
- 1 to 3 picks, best first. "id" must be copied exactly from the wishlist above.
- Judge by the gaps in their collection (style, type, brand, size variety) and what they actually wear — favour picks they would wear often, not trophies.
- Price is a real factor: use the prices given. A pick pitched for daily, beater or worry-free duty must be genuinely inexpensive next to their collection — never call a luxury piece a beater.
- Every reason must point at their own collection or wear habits, never generic praise.
- Address the user directly in every reason and the summary: write "you" and "your", never "they" or "their".
- Plain language a non-expert understands.`;
}

export function parseRecommendResponse(
  text: string,
  wishIds: string[],
): { picks: { id: string; reason: string }[]; summary: string } | null {
  let obj: Record<string, unknown> | null = null;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    obj = m ? JSON.parse(m[0]) : null;
  } catch (_e) {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const known = new Set(wishIds);
  const seen = new Set<string>();
  const picks: { id: string; reason: string }[] = [];
  for (const p of Array.isArray(obj.picks) ? obj.picks : []) {
    const id = typeof p?.id === "string" ? p.id : "";
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    picks.push({ id, reason: clampText(p?.reason, 200) });
    if (picks.length === 3) break;
  }
  if (!picks.length) return null;
  return { picks, summary: clampText(obj.summary, 300) };
}
