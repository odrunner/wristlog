// Authenticating calls that come from our own DB triggers / pg_cron — pure,
// tested in trigger-auth.test.ts. They send x-campaign-secret, read from Vault
// (see sql/2026-09-24-campaign-secret-vault.sql). Audit SEC-23-19.

/** Constant-time string compare (no early exit on the first difference). */
export function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Fails closed: an unset secret authorises nobody. */
export function triggerSecretOk(provided: string | null | undefined, expected: string | null | undefined): boolean {
  return !!expected && !!provided && timingSafeEqual(provided, expected);
}

/** True when `createdAt` is within `maxAgeMs` of `nowMs` (not in the future by
 *  more than a minute of clock skew). Stops an old row being replayed. */
export function isFresh(createdAt: string | null | undefined, nowMs: number, maxAgeMs = 15 * 60 * 1000): boolean {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  if (Number.isNaN(t)) return false;
  return nowMs - t <= maxAgeMs && t - nowMs <= 60 * 1000;
}
