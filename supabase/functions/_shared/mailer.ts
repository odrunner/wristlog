// _shared/mailer — the single email transport entry point.
//
// Every sending edge function imports sendEmail/sendBatch from here rather
// than from ses.ts directly, so the transport stays swappable behind one seam.
// Since 2026-07-30 the only transport is AWS SES (Resend was retired
// 2026-08-31 after a month of 100% SES sends with clean bounce/complaint
// rates), so this is a plain re-export.

import { sendSesBatch, sendSesEmail } from "./ses.ts";

export type { MailMessage, MailResult, Provider } from "./mailer-lib.ts";

// Reported by send-broadcast's quota_only introspection so the live provider
// is visible without grepping a deployed bundle.
export const currentProvider: import("./mailer-lib.ts").Provider = "ses";

export const sendEmail = sendSesEmail;
export const sendBatch = sendSesBatch;
