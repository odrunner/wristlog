// send-push — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.

// True if a webhook record carries the fields required to process it.
export function isValidRecord(
  record: { user_id?: unknown; type?: unknown } | null | undefined,
): boolean {
  return !!record && !!record.user_id && !!record.type;
}

// Resolve a display name for the actor, falling back to "Someone".
export function resolveActorName(
  actor: { display_name?: string | null; username?: string | null } | null | undefined,
): string {
  if (!actor) return "Someone";
  return actor.display_name || actor.username || "Someone";
}

// Notification type → human-readable push message.
// Unknown types fall back to a generic body (never null in practice).
export function buildMessage(
  type: string,
  actorName: string,
): { title: string; body: string } | null {
  const title = "WRotate";
  switch (type) {
    case "like":
      return { title, body: `${actorName} liked your post` };
    case "comment":
      return { title, body: `${actorName} commented on your post` };
    case "follow":
      return { title, body: `${actorName} started following you` };
    case "follow_request":
      return { title, body: `${actorName} requested to follow you` };
    case "follow_accepted":
      return { title, body: `${actorName} accepted your follow request` };
    case "friend_request":
      return { title, body: `${actorName} sent you a close friend request` };
    case "friend_accepted":
      return { title, body: `${actorName} accepted your close friend request` };
    case "club_invite":
      return { title, body: `${actorName} invited you to join a club` };
    case "club_join_request":
      return { title, body: `${actorName} wants to join your club` };
    case "club_join_accepted":
      return { title, body: `${actorName} approved your club request` };
    case "mention":
      return { title, body: `${actorName} mentioned you` };
    case "comment_like":
      return { title, body: `${actorName} liked your comment` };
    default:
      return { title, body: `${actorName} sent you a notification` };
  }
}

// Build the APNs alert payload for a message.
export function buildAlertPayload(
  message: { title: string; body: string },
): { aps: { alert: { title: string; body: string }; sound: string; badge: number } } {
  return {
    aps: {
      alert: { title: message.title, body: message.body },
      sound: "default",
      badge: 1,
    },
  };
}

// Choose the APNs host based on the sandbox flag.
export function apnsHost(useSandbox: boolean): string {
  return useSandbox
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
}

// Base64url-encode a string (used for JWT header/payload segments).
export function base64UrlEncode(s: string): string {
  return btoa(s)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Base64url-encode raw bytes (used for the JWT signature segment).
export function base64UrlEncodeBytes(bytes: Uint8Array): string {
  return base64UrlEncode(String.fromCharCode(...bytes));
}

// Strip PEM armor + whitespace from a .p8 key, leaving the base64 body.
export function stripPemArmor(pem: string): string {
  return pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
}

// Build the APNs device URL for a token.
export function apnsDeviceUrl(host: string, token: string): string {
  return `${host}/3/device/${token}`;
}
