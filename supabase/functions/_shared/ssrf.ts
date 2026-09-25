// Outbound-fetch guard for functions that fetch caller-influenced URLs
// (search-watch-image, extract-url-meta). Audit SEC-23-20: the old per-function
// checks missed IPv6 spellings of internal addresses (WHATWG URL turns
// ::ffff:169.254.169.254 into ::ffff:a9fe:a9fe; NAT64 64:ff9b::a9fe:a9fe),
// never looked at what a hostname resolves to, followed redirects unchecked
// (search-watch-image) and read bodies of any size.
// Residual: DNS can change between our lookup and fetch()'s (rebinding).

// ── literal addresses ──

function ipv4Octets(s: string): number[] | null {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.some((x) => x > 255) ? null : o;
}

function privateV4(o: number[]): boolean {
  const [a, b, c] = o;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||          // CGNAT
    (a === 169 && b === 254) ||                    // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||       // benchmarking
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) ||
    a >= 224;                                      // multicast, reserved, broadcast
}

/** 8 hextets for an IPv6 literal (brackets / zone id tolerated), else null. */
function ipv6Hextets(s: string): number[] | null {
  let h = s.toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  h = h.split("%")[0];
  if (!h.includes(":")) return null;
  // Embedded dotted IPv4 (::ffff:1.2.3.4) → two hex groups, then parse as usual.
  const lastColon = h.lastIndexOf(":");
  const last = h.slice(lastColon + 1);
  if (last.includes(".")) {
    const o = ipv4Octets(last);
    if (!o) return null;
    h = h.slice(0, lastColon + 1) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const parts = h.split("::");
  if (parts.length > 2) return null;
  const parse = (x: string) => x ? x.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)) : [];
  const head = parse(parts[0]);
  const tail = parts.length === 2 ? parse(parts[1]) : [];
  let groups = head;
  if (parts.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...new Array(fill).fill(0), ...tail];
  }
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function v4FromHextets(hi: number, lo: number): number[] {
  return [hi >> 8, hi & 255, lo >> 8, lo & 255];
}

/** True for any IPv4/IPv6 literal that is not a public unicast address. */
export function isPrivateAddress(host: string): boolean {
  const v4 = ipv4Octets(host);
  if (v4) return privateV4(v4);
  const g = ipv6Hextets(host);
  if (!g) return false;                            // not an IP literal
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zeros(0, 8)) return true;                                         // ::
  if (zeros(0, 7) && g[7] === 1) return true;                           // ::1
  if (zeros(0, 5) && g[5] === 0xffff) return privateV4(v4FromHextets(g[6], g[7])); // ::ffff:v4
  if (zeros(0, 6)) return true;                                         // ::v4 (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b) return zeros(2, 6) ? privateV4(v4FromHextets(g[6], g[7])) : true; // NAT64
  if (g[0] === 0x2002) return privateV4(v4FromHextets(g[1], g[2]));     // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true;                       // Teredo
  if (g[0] === 0x100 && zeros(1, 4)) return true;                       // discard-only
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link/site-local
  if ((g[0] & 0xfe00) === 0xfc00) return true;                          // unique local
  if ((g[0] & 0xff00) === 0xff00) return true;                          // multicast
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true;                   // documentation
  return false;
}

/** Scheme, credentials, port, internal names and IP literals. */
export function isSafeFetchUrl(urlStr: string): boolean {
  let u: URL;
  try { u = new URL(urlStr); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "80" && u.port !== "443") return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|corp|arpa)$/.test(host)) return false;
  return !isPrivateAddress(host);
}

// ── DNS ──

export type Resolver = (host: string, type: "A" | "AAAA") => Promise<string[]>;
export const denoResolver: Resolver = (host, type) =>
  // deno-lint-ignore no-explicit-any
  (Deno as any).resolveDns(host, type) as Promise<string[]>;

/** True if the hostname resolves to any internal address. Unresolvable names
 *  are not "private" (the fetch itself will fail); a runtime without
 *  resolveDns is logged and treated as unknown. */
export async function resolvesToPrivate(host: string, resolver: Resolver = denoResolver): Promise<boolean> {
  const h = host.replace(/^\[|\]$/g, "");
  if (ipv4Octets(h) || ipv6Hextets(h)) return isPrivateAddress(h);
  const addrs: string[] = [];
  for (const t of ["A", "AAAA"] as const) {
    try { addrs.push(...await resolver(h, t)); } catch (e) {
      if (e instanceof TypeError) console.warn("[ssrf] resolveDns unavailable:", e.message);
    }
  }
  return addrs.some(isPrivateAddress);
}

// ── fetch ──

/** fetch() that re-validates every redirect hop (URL + DNS) instead of following blindly. */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  opts: { maxHops?: number; fetchImpl?: typeof fetch; resolver?: Resolver } = {},
): Promise<Response> {
  const { maxHops = 5, fetchImpl = fetch, resolver = denoResolver } = opts;
  let current = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    if (!isSafeFetchUrl(current) || await resolvesToPrivate(new URL(current).hostname, resolver)) {
      console.warn("[ssrf] blocked:", new URL(current).hostname);
      throw new Error("Blocked fetch to a disallowed address");
    }
    const res = await fetchImpl(current, { ...init, redirect: "manual" });
    if (res.status < 300 || res.status > 399) return res;
    const loc = res.headers.get("location");
    if (!loc) return res;
    current = new URL(loc, current).href;
  }
  throw new Error("Too many redirects");
}

/** Response body as text, stopping at `maxBytes` (pages we only scan for tags). */
export async function readTextCapped(res: Response, maxBytes = 2_000_000): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  try { await reader.cancel(); } catch { /* already closed */ }
  const buf = new Uint8Array(Math.min(total, maxBytes));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, buf.length - off);
    buf.set(c.subarray(0, take), off);
    off += take;
    if (off >= buf.length) break;
  }
  return new TextDecoder().decode(buf);
}
