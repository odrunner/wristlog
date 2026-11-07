// _shared/send-claim — the IO half of the per-notification send guard.
// Verdict logic lives in send-claim-lib.ts. See that file for the contract.
//
// To deliberately re-send a notification (say, after an SES outage), null
// its stamp first: UPDATE notifications SET emailed_at = NULL WHERE id = …
// — then re-fire the webhook.

import { claimVerdict } from "./send-claim-lib.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

// Atomically claim the send for one notification. true = send; false = a
// previous invocation already sent (or claimed) this one — skip.
export async function claimSend(
  db: Db,
  notifId: string,
  column: "pushed_at" | "emailed_at",
): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("notifications")
      .update({ [column]: new Date().toISOString() })
      .eq("id", notifId)
      .is(column, null)
      .select("id");
    return claimVerdict(data, error);
  } catch {
    return true; // fail open — see send-claim-lib.ts
  }
}
