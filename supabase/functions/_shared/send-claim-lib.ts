// _shared/send-claim-lib — pure half of the per-notification send guard.
//
// send-push and send-email are fired by an AFTER INSERT webhook on
// notifications. Before actually sending, each claims the row with
//   UPDATE notifications SET <pushed_at|emailed_at> = now()
//   WHERE id = <id> AND <column> IS NULL RETURNING id
// Exactly one invocation gets the row back; a replayed webhook (manual
// re-fire, a future pg_net retry policy, a second trigger) gets zero rows
// and skips. (Audit 2026-11-06 F3.)
//
// FAILS OPEN: a query error or throw yields "proceed with the send" — the
// exact pre-guard behavior, where the duplicate risk only exists on an
// actual replay. A guard must never turn a DB blip into a dropped
// notification.

// true = this invocation owns the send; false = already claimed, skip.
export function claimVerdict(
  rows: unknown[] | null | undefined,
  error: unknown,
): boolean {
  if (error) return true; // fail open
  return Array.isArray(rows) && rows.length > 0;
}
