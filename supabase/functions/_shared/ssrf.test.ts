import { assertEquals, assertRejects } from "jsr:@std/assert";
import { isPrivateAddress, isSafeFetchUrl, readTextCapped, resolvesToPrivate, safeFetch } from "./ssrf.ts";

Deno.test("isPrivateAddress — IPv4 private/reserved vs public", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255"]) {
    assertEquals(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "172.15.0.1", "172.32.0.1", "1.1.1.1"]) assertEquals(isPrivateAddress(ip), false, ip);
});

Deno.test("isPrivateAddress — every IPv6 spelling of an internal address", () => {
  for (const ip of [
    "::1", "[::1]", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "fec0::1",
    "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "[::ffff:a9fe:a9fe]", "::ffff:127.0.0.1", "::ffff:7f00:1",
    "64:ff9b::a9fe:a9fe", "64:ff9b::169.254.169.254", "64:ff9b:1::1", "2002:a9fe:a9fe::1", "2002:0a00:0001::1",
    "2001:0:4136:e378::1", "::127.0.0.1", "2001:db8::1", "0:0:0:0:0:0:0:1",
  ]) assertEquals(isPrivateAddress(ip), true, ip);
});

Deno.test("isPrivateAddress — public IPv6, mapped public v4, and non-IPs", () => {
  for (const ip of ["2606:4700:4700::1111", "2a00:1450:4001:80b::200e", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:0808:0808::1", "example.com"]) {
    assertEquals(isPrivateAddress(ip), false, ip);
  }
});

Deno.test("isSafeFetchUrl — the URL parser's own normalisations are caught", () => {
  assertEquals(isSafeFetchUrl("http://[::ffff:169.254.169.254]/latest"), false);
  assertEquals(isSafeFetchUrl("http://[64:ff9b::a9fe:a9fe]/a"), false);
  assertEquals(isSafeFetchUrl("http://2852039166/"), false, "decimal 169.254.169.254");
  assertEquals(isSafeFetchUrl("http://0x7f.0.0.1/"), false, "hex loopback");
  assertEquals(isSafeFetchUrl("http://localhost./"), false);
  assertEquals(isSafeFetchUrl("http://db.internal/"), false);
  assertEquals(isSafeFetchUrl("file:///etc/passwd"), false);
  assertEquals(isSafeFetchUrl("http://user:pw@example.com/"), false);
  assertEquals(isSafeFetchUrl("http://example.com:8080/"), false);
  assertEquals(isSafeFetchUrl("https://www.omegawatches.com/watch-omega-speedmaster"), true);
});

Deno.test("resolvesToPrivate — a public-looking name pointing inside is caught", async () => {
  const dns = (map: Record<string, string[]>) => (h: string, t: "A" | "AAAA") => Promise.resolve(map[`${h}/${t}`] ?? []);
  assertEquals(await resolvesToPrivate("evil.example", dns({ "evil.example/A": ["169.254.169.254"] })), true);
  assertEquals(await resolvesToPrivate("evil6.example", dns({ "evil6.example/AAAA": ["::1"] })), true);
  assertEquals(await resolvesToPrivate("good.example", dns({ "good.example/A": ["93.184.216.34"] })), false);
  assertEquals(await resolvesToPrivate("nx.example", () => Promise.reject(new Error("NXDOMAIN"))), false);
});

Deno.test("safeFetch — re-checks every redirect hop", async () => {
  const dns = () => Promise.resolve(["93.184.216.34"]);
  const hops: string[] = [];
  const fake = ((u: string) => {
    hops.push(u);
    if (u === "https://public.example/a") return Promise.resolve(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }));
    return Promise.resolve(new Response("ok"));
  }) as unknown as typeof fetch;
  await assertRejects(() => safeFetch("https://public.example/a", {}, { fetchImpl: fake, resolver: dns }), Error, "disallowed");
  assertEquals(hops, ["https://public.example/a"], "never fetched the metadata address");
  const ok = await safeFetch("https://public.example/b", {}, { fetchImpl: fake, resolver: dns });
  assertEquals(await ok.text(), "ok");
});

Deno.test("readTextCapped — stops at the byte cap", async () => {
  const big = new Response("x".repeat(5_000_000));
  assertEquals((await readTextCapped(big, 1000)).length, 1000);
  assertEquals(await readTextCapped(new Response("small"), 1000), "small");
});
