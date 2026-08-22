// _shared/mailer-lib — pure logic for the email provider switch.
// mailer.ts imports these; mailer-lib.test.ts tests them.

export type Provider = "ses" | "resend";

// The message shape both transports accept. SesMessage and ResendMessage are
// structurally identical, so this is assignable to either with no adapter.
export interface MailMessage {
  from: string;
  to: string[];
  subject: string;
  html: string;
  headers?: Record<string, string>;
  // Per-message SES configuration set override (click-tracked sends). Resend
  // has no equivalent and ignores it — safe under the provider switch.
  configSet?: string;
}

export type MailResult =
  | { ok: true; id: string }
  // `retryable` distinguishes "the provider was busy / the network blipped"
  // from "this message will never be accepted". The broadcast queue only ever
  // re-selects `pending`, so a row marked `failed` is dropped forever.
  | { ok: false; status: number; error: string; retryable: boolean };

// Resolve the EMAIL_PROVIDER secret. Anything that is not exactly "ses"
// (case- and whitespace-insensitive) resolves to Resend. This asymmetry is
// deliberate: a cleared or misspelled secret must fail back to the provider
// that is known to work, never forward to the one under test.
export function resolveProvider(raw: string | undefined | null): Provider {
  return (raw ?? "").trim().toLowerCase() === "ses" ? "ses" : "resend";
}
