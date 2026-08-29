// identify-watch — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.

// Single shared JSON extractor — index.ts previously defined this inline twice.
export function extractJson(text: string) {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

// Normalize the request `mode` to one of the supported modes for logging.
export function normalizeMode(mode: unknown): "detect" | "enhance" | "identify" | "facts" | "model" {
  return mode === "detect" ? "detect"
    : mode === "enhance" ? "enhance"
    : mode === "facts" ? "facts"
    : mode === "model" ? "model"
    : "identify";
}

// True when a non-empty collection array was supplied.
export function hasCollection(collection: unknown): boolean {
  return Array.isArray(collection) && collection.length > 0;
}

// Strip a data-URI prefix to get the raw base64 payload.
export function stripDataUriPrefix(image: string): string {
  return image.replace(/^data:image\/[a-z]+;base64,/, "");
}

// Determine the media type from a data URI (png vs jpeg).
export function detectMediaType(image: string): "image/png" | "image/jpeg" {
  return image.startsWith("data:image/png") ? "image/png" : "image/jpeg";
}

// Normalize a parsed detect-mode response's `count`.
export function normalizeDetectCount(
  parsed: { count?: number; watches?: unknown[] },
): number {
  return parsed.count ?? parsed.watches?.length ?? 0;
}

interface WatchInfo {
  brand?: string;
  model?: string;
  reference?: string;
}

// Build the enhance-mode prompt (specs/history enrichment).
export function buildEnhancePrompt(info: WatchInfo): string {
  const { brand, model, reference } = info;
  return `Search for detailed specifications of this watch:
Brand: ${brand}
Model: ${model}
${reference ? `Reference: ${reference}` : ""}

Search thoroughly for this watch's full specifications. Check these sources in order:
1. The official manufacturer website (e.g. rolex.com/watches, audemarspiguet.com/en/watch-collection, omegawatches.com, patek.com) — these ALWAYS have case dimensions, movement info, and water resistance
2. Watch databases: watchbase.com, chrono24.com, watchuseek forums
3. Review sites and spec sheets

IMPORTANT: Major watch brands (Rolex, Omega, AP, Patek, Tudor, IWC, Breitling, Cartier, etc.) publish complete specs on their official websites including diameter, thickness, lug-to-lug, weight, water resistance, and crystal type. Search the manufacturer site directly — these specs ARE available, do not leave them empty.

Return a JSON object. Fill every field you can find — only use empty string "" if the information truly does not exist anywhere:
{
  "movementType": "automatic/manual-wind/quartz/digital/solar/spring-drive or empty",
  "caliber": "movement caliber name/number or empty",
  "caseMaterial": "e.g. stainless steel, 18k yellow gold, titanium or empty",
  "caseDiameter": "e.g. 41mm or empty",
  "caseLength": "lug-to-lug e.g. 48mm or empty",
  "caseThickness": "e.g. 12.5mm or empty",
  "weight": "e.g. 155g or empty",
  "waterResistance": "e.g. 300m or empty",
  "crystalType": "sapphire/mineral/plexiglas/hardlex or empty",
  "yearRange": "production years e.g. 2018-present or empty",
  "gender": "men's/women's/unisex or empty",
  "origin": "country of manufacture e.g. Switzerland, Japan or empty",
  "functions": ["list", "of", "key", "features/complications"],
  "description": "Short 1-2 sentence physical description of the watch",
  "background": "2-4 sentences about the model's history, significance, or notable facts. Include any interesting stories (e.g. NASA certification, celebrity associations, design heritage).",
  "productUrl": "official manufacturer product page URL or empty",
  "retailPrice": "current retail price USD or empty"
}

Rules:
- Search the official manufacturer website FIRST — it has the most accurate and complete specs.
- For description: describe what makes this watch visually distinctive.
- For background: focus on what makes this model interesting or significant — history, heritage, notable wearers, records, etc.
- For functions: list complications and key features (e.g. "date", "chronograph", "GMT", "200m water resistance", "power reserve indicator")
- If a field like caseDiameter or caseThickness is commonly published for this brand, search harder before returning empty.`;
}

// ── Model mode: one era-spanning write-up per watch FAMILY (Submariner across
// 1953–today), for the watch-database model page. Grounded on what members
// actually own so the references/calibers listed are the ones on the page.
export interface ModelInfo {
  brand?: string;
  name?: string;
  aliases?: string[];
  refs?: string[];
  grounding?: { calibers?: string[]; years?: string[]; diameters?: string[]; water_resistance?: string[] };
}

export function buildModelPrompt(info: ModelInfo): string {
  const { brand, name } = info;
  const aliases = (info.aliases ?? []).filter(Boolean);
  const refs = (info.refs ?? []).filter(Boolean);
  const g = info.grounding ?? {};
  const gLines = [
    g.calibers?.length ? `- Calibers members recorded: ${g.calibers.join(", ")}` : "",
    g.years?.length ? `- Production years members recorded: ${g.years.join(", ")}` : "",
    g.diameters?.length ? `- Case diameters members recorded: ${g.diameters.join(", ")}` : "",
    g.water_resistance?.length ? `- Water resistance members recorded: ${g.water_resistance.join(", ")}` : "",
  ].filter(Boolean);
  return `Write the reference page for a watch MODEL FAMILY — every generation and reference of this line across its whole production history, not one specific reference.
Brand: ${brand}
Model family: ${name}
${aliases.length ? `Also written as: ${aliases.join("; ")}\n` : ""}${refs.length ? `References owned by our members: ${refs.join(", ")}\n` : ""}${gLines.length ? `What our members' examples say about it:\n${gLines.join("\n")}\n` : ""}
Search the official manufacturer website first, then watch databases and reputable histories (Hodinkee, Fratello, WatchTime, Monochrome, forum reference guides). Cover the family from its first reference to today.

Return a JSON object:
{
  "description": "1-2 sentences: what this family is and what defines it (type, purpose, signature design cues)",
  "history": "3-5 sentences on the family's story across eras — origin, key turning points, what changed between generations, why it matters. Plain language, no marketing tone.",
  "refs_by_era": [{"reference": "5513", "years": "1962–1989", "note": "no-date; matte dial from the late 1960s"}],
  "calibers_by_era": [{"caliber": "1520", "years": "1962–1989"}],
  "specs": {"type": "e.g. Dive watch", "size": "range across eras e.g. 40–41mm", "water_resistance": "e.g. 300m", "movement": "e.g. In-house automatic, various calibers", "materials": "e.g. Oystersteel, two-tone, gold"}
}

Rules:
- refs_by_era: 4-10 entries, oldest first, chronologically continuous; prefer references our members own where they fit, and include the current production reference. Use en dashes in year ranges.
- calibers_by_era: 2-8 entries, oldest first.
- Only state facts you can verify; if a year or caliber is uncertain, say "c." or omit the entry rather than guess.
- Do not repeat the brand name at the start of every sentence. Do not mention prices.`;
}

// Build the facts-mode prompt: one distinct, interesting, verifiable trivia fact.
export function buildFactsPrompt(info: WatchInfo, existingFacts: string[]): string {
  const { brand, model, reference } = info;
  const usedBlock = existingFacts.length
    ? `\nThese facts have already been used — do NOT repeat, rephrase, or overlap with any of them:\n${existingFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n`
    : "";
  return `You are writing a single "fun fact" for a watch enthusiast about this watch model:
Brand: ${brand}
Model: ${model}
${reference ? `Reference: ${reference}` : ""}
${usedBlock}
Use search to find the single most interesting, genuinely surprising, and VERIFIABLE fact about this model that a knowledgeable collector would enjoy — history, design heritage, records, notable wearers, engineering quirks, or cultural moments.

Rules:
- Exactly ONE fact, ONE sentence, museum-placard tone. No preamble, no "Did you know", no citations, no emoji.
- It must be about the watch MODEL (not a specific owner). Must be true — if unsure, pick a safer well-documented fact.
- It must be clearly distinct from any already-used fact listed above.
- Prefer the most interesting fact first; only reach for smaller details once the obvious ones are used.

Return JSON only:
{"fact": "one-sentence fact here"}`;
}

// Detect-mode prompt (count watches + bounding boxes). Static.
export const DETECT_PROMPT = `Look at this image and find every wristwatch. For each watch, describe where it is in the image, then provide a bounding box.

The bounding box should be [x, y, width, height] as percentages (0-100) of the image. x is from the left edge, y is from the top edge. The box should be tightly centered on the watch DIAL (the circular/square face where the hands and brand name are). Include the full case and a small margin, but do NOT include other watches or large areas of background.

For a watch box with 4 watches stacked vertically, each watch is roughly 20-25% of the image height. The bounding boxes should NOT overlap.

After your analysis, return JSON:
{"count": N, "watches": [{"boundingBox": [x, y, w, h]}]}

Order watches from top to bottom, left to right.
If no watches visible: {"count": 0, "watches": []}`;

interface CollectionWatch {
  brand?: string;
  name?: string;
  ref?: string;
}

// Build the collection-matching prompt from the user's owned watches.
export function buildCollectionPrompt(collection: CollectionWatch[]): string {
  return `Identify the watch in this image. The user owns: ${collection.map((w) => `${w.brand} ${w.name}${w.ref ? ` (ref: ${w.ref})` : ""}`).join(", ")}

If you recognize it as one of these, use the exact names. Do NOT force a match — if it's not in the list, identify it independently.

Return JSON only, no explanation:
{"watches": [{"brand": "BrandName", "model": "ModelName", "reference": "ref or empty string", "dialText": "text on dial", "estimatedColor": "#hex", "confidence": "high/medium/low", "productUrl": "", "boundingBox": [x, y, width, height]}]}

boundingBox: [x, y, width, height] as percentages (0-100) of image, centered on dial.
estimatedColor: #c9a84c (gold), #94a3b8 (silver), #818cf8 (indigo), #fbbf24 (amber), #38bdf8 (blue), #a78bfa (purple), #f43f5e (rose), #4caf7d (teal)
If no watches: {"watches": []}`;
}

// Cold-identification prompt for Gemini grounded search. Static.
export const COLD_PROMPT = `Look at this image carefully. Identify every watch visible.

For each watch: read all text on the dial, examine the logo, note the case shape, bezel style, bracelet/strap type, and any distinguishing features. Then use search to verify your identification and find the exact reference number, manufacturing years, and specifications.

Brand identification guide:
- Rolex: Crown logo at 12 o'clock, Cyclops lens over date, Oyster/Jubilee/President bracelets
- Tudor: Shield logo, snowflake hands on Black Bay models
- Omega: Ω symbol, Speedmaster has tachymeter bezel, Seamaster has wave dial
- Patek Philippe: Calatrava cross logo, typically dress watches
- Audemars Piguet: Royal Oak octagonal bezel with 8 hex screws, Tapisserie dial
- Vacheron Constantin: Maltese cross logo
- Cartier: Roman numerals, blue sword hands, cursive "Cartier"
- IWC: "IWC SCHAFFHAUSEN" on dial
- Breitling: Winged B logo, slide rule bezel
- Panerai: Cushion case, crown-protecting bridge
- Grand Seiko: "GS" logo, zaratsu polishing

Return a JSON object with your identifications:
{"watches": [{"brand": "BrandName", "model": "ModelName", "reference": "exact reference number or empty string", "dialText": "text you read on dial", "estimatedColor": "#hex", "confidence": "high/medium/low", "yearRange": "e.g. 2018-2023 or empty string", "movementType": "automatic/manual-wind/quartz or empty string", "caliber": "movement caliber name or empty string", "caseMaterial": "e.g. stainless steel, 18k yellow gold, titanium or empty string", "caseDiameter": "e.g. 41mm or empty string", "waterResistance": "e.g. 300m or empty string", "retailPrice": "estimated retail USD or empty string", "productUrl": "official manufacturer product page URL or empty string"}]}

Rules:
- Only provide reference if you can confirm it via search or clear visual evidence. Do NOT guess.
- productUrl: search for the official product page on the manufacturer's website (e.g. rolex.com, omegawatches.com, patek.com). Only provide verified URLs.
- estimatedColor: #c9a84c (gold), #94a3b8 (silver), #818cf8 (indigo), #fbbf24 (amber), #38bdf8 (blue), #a78bfa (purple), #f43f5e (rose), #4caf7d (teal)
- If no watches: {"watches": []}`;

// Brand-cue block reused by the Claude fallback prompt. Static.
export const BRAND_CUES = `Brand identification guide:
- Rolex: Crown logo at 12 o'clock, "ROLEX" on dial, Cyclops lens over date, Oyster/Jubilee/President bracelets, fluted or smooth bezel
- Tudor: Shield logo at 12 o'clock, "TUDOR" on dial, snowflake hands on Black Bay models, rose or shield emblem
- Omega: Ω symbol, "OMEGA" on dial, Speedmaster has tachymeter bezel, Seamaster has wave dial pattern
- Patek Philippe: Calatrava cross logo, "PATEK PHILIPPE GENEVE" on dial, typically dress watches with leather straps
- Audemars Piguet: "AP" initials, Royal Oak has octagonal bezel with 8 exposed hexagonal screws, "Tapisserie" waffle dial pattern
- Vacheron Constantin: Maltese cross logo, "VACHERON CONSTANTIN" on dial, Overseas has distinctive cross-shaped bezel
- Cartier: Roman numerals, blue sword hands, "Cartier" in cursive, Santos has exposed screws
- IWC: "IWC SCHAFFHAUSEN" on dial, Portugieser has railroad chapter ring
- Breitling: Winged B logo, "BREITLING" on dial, often with slide rule bezel
- Panerai: Cushion case, crown-protecting bridge/lever, large luminous numerals
- Grand Seiko: "GS" logo, "Grand Seiko" text, zaratsu polishing with sharp case edges
- GRØNE: "GRØNE" on dial, Danish microbrand, minimalist Scandinavian design
- Anoma: "Anoma" on dial, microbrand`;

// Claude Opus fallback prompt for cold identification.
export function buildClaudeFallbackPrompt(): string {
  return `Look at this image carefully. Identify every watch visible.

For each watch, describe what you see: read the text on the dial, look at the logo, note the case shape, bezel, bracelet/strap, and any distinguishing features. Then give your best identification.

${BRAND_CUES}

After your analysis, return a JSON object with your identifications:
{"watches": [{"brand": "BrandName", "model": "ModelName", "reference": "ref or empty string", "dialText": "text you read on dial", "estimatedColor": "#hex", "confidence": "high/medium/low", "yearRange": "e.g. 2018-2023 or empty string", "movementType": "automatic/manual-wind/quartz or empty string", "caliber": "movement caliber name or empty string", "caseMaterial": "e.g. stainless steel or empty string", "caseDiameter": "e.g. 41mm or empty string", "waterResistance": "e.g. 300m or empty string", "retailPrice": "estimated retail USD or empty string", "productUrl": "", "boundingBox": [x, y, width, height]}]}

For boundingBox: provide [x, y, width, height] as percentages (0-100) of the image dimensions, centered on the watch dial. Order watches from top to bottom.
For estimatedColor pick from: #c9a84c (gold), #94a3b8 (slate/silver), #818cf8 (indigo), #fbbf24 (amber), #38bdf8 (sky blue), #a78bfa (purple), #f43f5e (rose), #4caf7d (teal)
Only provide reference if you are confident. Do NOT guess reference numbers.
If no watches: {"watches": []}`;
}

// Model key for the shared fun-fact pool. MUST match the SQL in
// sql/2026-07-20-watch-fun-facts.sql — `lower(trim(brand)) || '|' || lower(trim(name))`
// — because that is what pick/commit_watch_fact key the pool on.
export function factModelKey(brand: string, name: string): string {
  return `${(brand ?? "").trim().toLowerCase()}|${(name ?? "").trim().toLowerCase()}`;
}

// True when the caller owns a watch matching this brand/model. Facts generation is
// gated on this: brand/model arrived straight from the client with no validation, so
// one user could mint a fact pool (and burn a grounded Gemini search) for any string
// they liked, for watches nobody owns. Compared on the same normalized key the pool
// itself uses, so "  rolex " and "Rolex" are the same watch.
export function ownsFactModel(
  watchRows: { brand?: string | null; name?: string | null }[],
  brand: string,
  model: string,
): boolean {
  const want = factModelKey(brand, model);
  return (watchRows || []).some((w) => factModelKey(w?.brand ?? "", w?.name ?? "") === want);
}
