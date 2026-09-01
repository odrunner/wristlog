// _shared/tracked — the IO half of the click-tracking gate.
//
// Pure logic (version compare, row → uid set) lives in tracked-lib.ts; this is
// the one place that asks the DB. Every sender that knows WHICH USER it is
// mailing goes through here, so the 2.6 gate is defined once.
//
// FAILS OPEN TO UNTRACKED, always. A query error, a throw, an unknown user or
// an empty list all yield "not tracked", so a DB blip can never route a CTA
// through click.wrotate.com for someone whose build would open it in Safari
// instead of the app. Losing a click metric is free; breaking the CTA is not.

import { TRACKED_CONFIG_SET, trackedUidSet } from "./tracked-lib.ts";

export { MIN_TRACKED_APP_VERSION, TRACKED_CONFIG_SET } from "./tracked-lib.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

// Which of these users have an iOS 2.6+ install on record.
export async function fetchTrackedUids(db: Db, uids: string[]): Promise<Set<string>> {
  if (!uids || uids.length === 0) return new Set();
  try {
    const { data, error } = await db
      .from("device_tokens")
      .select("user_id, app_version")
      .in("user_id", uids)
      .not("app_version", "is", null);
    if (error) return new Set();
    return trackedUidSet(data as Array<{ user_id: string; app_version: string | null }>);
  } catch {
    return new Set();
  }
}

// Single-recipient convenience: spread straight into a MailMessage.
//   ...(await trackedConfigSet(db, userId))
// Yields `{ configSet: "wrotate-events-tracked" }` when the user qualifies and
// `{}` otherwise, so the message keeps the default (untracked) config set.
export async function trackedConfigSet(
  db: Db,
  uid: string | null | undefined,
): Promise<{ configSet?: string }> {
  if (!uid) return {};
  const tracked = await fetchTrackedUids(db, [uid]);
  return tracked.has(uid) ? { configSet: TRACKED_CONFIG_SET } : {};
}
