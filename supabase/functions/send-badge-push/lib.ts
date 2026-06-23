// send-badge-push — pure logic + APNs helpers (self-contained; mirrors send-push's
// stable APNs code intentionally — see spec "Accepted tradeoff").

const BUNDLE_ID = "com.wrotate.Wrotate";

// Badge name list -> single APNs message. null when there is nothing to send.
export function buildBadgePushMessage(
  badgeNames: string[],
): { title: string; body: string } | null {
  if (!badgeNames || badgeNames.length === 0) return null;
  const title = "WRotate";
  if (badgeNames.length === 1) {
    return { title, body: `You earned the "${badgeNames[0]}" badge 🏅` };
  }
  return { title, body: `You earned ${badgeNames.length} badges! 🏅` };
}

export function buildAlertPayload(message: { title: string; body: string }) {
  return {
    aps: {
      alert: { title: message.title, body: message.body },
      sound: "default",
      badge: 1,
    },
  };
}

export function apnsHost(useSandbox: boolean): string {
  return useSandbox
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
}

export function apnsDeviceUrl(host: string, token: string): string {
  return `${host}/3/device/${token}`;
}

export function base64UrlEncode(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlEncodeBytes(bytes: Uint8Array): string {
  return base64UrlEncode(String.fromCharCode(...bytes));
}

export function stripPemArmor(pem: string): string {
  return pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
}

// Build an ES256 APNs JWT from the .p8 key material.
export async function createAPNsJWT(
  keyP8: string,
  keyId: string,
  teamId: string,
): Promise<string> {
  const header = { alg: "ES256", kid: keyId };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: teamId, iat: now };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const pemContents = stripPemArmor(keyP8);
  const keyData = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  const sigB64 = base64UrlEncodeBytes(new Uint8Array(signature));
  return `${signingInput}.${sigB64}`;
}

// Send one push to a single device token.
export async function sendPush(
  token: string,
  message: { title: string; body: string },
  jwt: string,
  host: string,
): Promise<{ token: string; success: boolean; status: number }> {
  const url = apnsDeviceUrl(host, token);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": BUNDLE_ID,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      },
      body: JSON.stringify(buildAlertPayload(message)),
    });
    return { token, success: response.ok, status: response.status };
  } catch (_err) {
    return { token, success: false, status: 0 };
  }
}
