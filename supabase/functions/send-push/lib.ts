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
    case "badge_earned":
      // Badges are pushed by the send-badge-push function (batched), not the insert webhook.
      return null;
    default:
      return { title, body: `${actorName} sent you a notification` };
  }
}

// Where the app should navigate when a push is tapped. Mirrors the click targets
// in the web notification panel (renderNotificationPanel in index.html).
//
// This is resolved SERVER-side and shipped in the payload so a new notification
// type can be routed without an App Store build — the app only switches on the
// small, fixed set of route names below.
export type PushRoute = { route: string; id: string | null };

export function buildRoute(
  type: string,
  refId?: string | null,
  actorId?: string | null,
): PushRoute {
  const to = (route: string, id?: string | null): PushRoute =>
    // A route with no target would land the app on nothing — fall back to the
    // bell, which is always a meaningful destination.
    id ? { route, id } : { route: "bell", id: null };

  switch (type) {
    case "like":
    case "comment":
    case "comment_also":
    case "comment_like":
    case "mention":
      return to("post", refId);
    case "follow":
    case "follow_accepted":
    case "friend_accepted":
      return to("profile", actorId);
    case "club_join_accepted":
    case "club_promoted":
      return to("club", refId);
    case "badge_earned":
      return { route: "badges", id: null };
    // follow_request, friend_request, club_invite, club_join_request and system
    // deliberately fall through to the bell. Those rows carry Accept/Decline
    // buttons and have NO click target in the panel — the bell is where the user
    // can actually act on them. (tests/push-route.test.js holds this in step with
    // the panel's own routing.)
    default:
      return { route: "bell", id: null };
  }
}

// Build the APNs alert payload for a message.
//
// `badge` is the recipient's REAL unread count. It is omitted when unknown —
// APNs leaves the icon badge untouched when the key is absent, which is the
// right failure mode. (It used to be hardcoded to 1, so the icon claimed one
// unread notification no matter what the account actually had.)
//
// `w` carries the tap-routing data the iOS app reads. `uid` is the intended
// recipient: the app ignores a push addressed to an account it is not signed
// into, so a token still attached to a stale account can't open the wrong thing.
export function buildAlertPayload(
  message: { title: string; body: string },
  opts: {
    badge?: number | null;
    route?: PushRoute;
    userId?: string | null;
    notifId?: string | null;
    type?: string | null;
  } = {},
): Record<string, unknown> {
  const aps: Record<string, unknown> = {
    alert: { title: message.title, body: message.body },
    sound: "default",
  };
  if (typeof opts.badge === "number" && Number.isFinite(opts.badge)) {
    aps.badge = Math.max(0, Math.trunc(opts.badge));
  }

  const payload: Record<string, unknown> = { aps };
  if (opts.route || opts.userId || opts.notifId) {
    payload.w = {
      route: opts.route?.route ?? "bell",
      id: opts.route?.id ?? null,
      uid: opts.userId ?? null,
      n: opts.notifId ?? null,
      t: opts.type ?? null,
    };
  }
  return payload;
}

// APNs rejections that mean "never send to this token again".
//
// 410 Unregistered           — the app was removed from the device.
// 400 BadDeviceToken         — the token belongs to the OTHER APNs environment
//                              (a dev/TestFlight token pushed to production) or
//                              is malformed. Only 410 was cleaned up before, so
//                              these accumulated forever — one account had 11.
// 400 DeviceTokenNotForTopic — the token was issued for a different bundle id.
export function isDeadToken(status: number, reason?: string | null): boolean {
  if (status === 410) return true;
  if (
    status === 400 &&
    (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic")
  ) return true;
  return false;
}

// Pull APNs' failure reason out of its JSON error body. Returns null for an
// empty or unparseable body so callers treat the failure as retryable.
export function parseApnsReason(body: string | null | undefined): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.reason === "string" ? parsed.reason : null;
  } catch {
    return null;
  }
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
