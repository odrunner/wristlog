// FCM HTTP v1 sender (IO). Pure logic lives in ./fcm-lib.ts. The service-account JSON comes
// from the FCM_SERVICE_ACCOUNT secret; the OAuth access token is cached module-level until
// shortly before expiry, like the APNs JWT pattern.

import { buildFcmMessage, buildOauthClaims, fcmSendUrl, isDeadFcmResult } from "./fcm-lib.ts";
import type { FcmRoute } from "./fcm-lib.ts";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlBytes(bytes: Uint8Array): string {
  return b64url(String.fromCharCode(...bytes));
}

function stripPemArmor(pem: string): string {
  return pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
}

async function accessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 300 > now) return cachedToken.token;
  try {
    const der = Uint8Array.from(atob(stripPemArmor(sa.private_key)), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(JSON.stringify(buildOauthClaims(sa.client_email, now)));
    const input = `${header}.${claims}`;
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
    const jwt = `${input}.${b64urlBytes(new Uint8Array(sig))}`;
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.access_token) return null;
    cachedToken = { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
    return cachedToken.token;
  } catch (_e) {
    return null;
  }
}

/** Send one push to one FCM registration token. Every failure is non-throwing; `dead` means
 *  the token should be pruned (user-scoped, like the APNs send-push pattern). */
export async function sendFcm(
  token: string,
  msg: { title: string; body: string },
  w?: FcmRoute,
): Promise<{ success: boolean; status: number; dead: boolean }> {
  try {
    const raw = Deno.env.get("FCM_SERVICE_ACCOUNT");
    if (!raw) return { success: false, status: 0, dead: false };
    const sa = JSON.parse(raw) as ServiceAccount;
    const bearer = await accessToken(sa);
    if (!bearer) return { success: false, status: 0, dead: false };
    const resp = await fetch(fcmSendUrl(sa.project_id), {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildFcmMessage(token, msg, w)),
    });
    if (resp.ok) return { success: true, status: resp.status, dead: false };
    let errorStatus: string | undefined;
    try {
      const body = await resp.json();
      errorStatus = body?.error?.status ??
        body?.error?.details?.find((d: { errorCode?: string }) => d.errorCode)?.errorCode;
    } catch (_e) { /* non-JSON error body */ }
    return { success: false, status: resp.status, dead: isDeadFcmResult(resp.status, errorStatus) };
  } catch (_e) {
    return { success: false, status: 0, dead: false };
  }
}
