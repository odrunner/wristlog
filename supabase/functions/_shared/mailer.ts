// _shared/mailer — the single email transport entry point.
//
// Every sending edge function imports sendEmail/sendBatch from here. Which
// provider they reach is decided at runtime by the EMAIL_PROVIDER secret, so
// switching providers (or rolling back) is a secret flip, not a redeploy:
//
//   npx supabase secrets set EMAIL_PROVIDER=ses      # cut over
//   npx supabase secrets set EMAIL_PROVIDER=resend   # roll back
//
// Unset or unrecognised => resend (see resolveProvider).

import { resolveProvider } from "./mailer-lib.ts";
import { sendResendBatch, sendResendEmail } from "./resend.ts";
import { sendSesBatch, sendSesEmail } from "./ses.ts";

export type { MailMessage, MailResult, Provider } from "./mailer-lib.ts";

// Resolved once per isolate. Exported so handlers can report which provider is
// actually live — otherwise the only way to know is grepping a deployed bundle.
export const currentProvider = resolveProvider(Deno.env.get("EMAIL_PROVIDER"));

const useSes = currentProvider === "ses";

export const sendEmail = useSes ? sendSesEmail : sendResendEmail;
export const sendBatch = useSes ? sendSesBatch : sendResendBatch;
