// Pure helpers for the FCM HTTP v1 sender (IO in ./fcm.ts). Mirrors the pure/IO split the
// APNs senders use. No imports, no network — unit-tested by fcm-lib.test.ts.

export interface FcmRoute {
  route: string;
  id?: string | null;
  uid: string;
  n?: string | null;
  t?: string | null;
}

/** FCM v1 message: notification for the tray + a STRING-ONLY data map for tap routing
 *  (FCM rejects non-string data values; nulls are omitted, numbers stringified upstream). */
export function buildFcmMessage(
  token: string,
  msg: { title: string; body: string },
  w?: FcmRoute,
): object {
  const message: Record<string, unknown> = {
    token,
    notification: { title: msg.title, body: msg.body },
    android: { priority: "high" },
  };
  if (w) {
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(w)) {
      if (v !== null && v !== undefined) data[k] = String(v);
    }
    message.data = data;
  }
  return { message };
}

/** OAuth2 JWT-bearer claims for the service account (RS256-signed in fcm.ts). */
export function buildOauthClaims(clientEmail: string, nowSecs: number): object {
  return {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSecs,
    exp: nowSecs + 3600,
  };
}

export function fcmSendUrl(projectId: string): string {
  return `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
}

/** Dead = the registration token is gone (uninstall/rotation): prune it. Everything else
 *  (quota, auth, 5xx) is a transient failure — never delete a token for those. */
export function isDeadFcmResult(status: number, errorStatus?: string): boolean {
  if (status === 404) return true;
  if (status === 400 && (errorStatus === "UNREGISTERED" || errorStatus === "INVALID_ARGUMENT")) return true;
  return false;
}
