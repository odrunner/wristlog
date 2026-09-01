// _shared/mailer-lib — pure types for the email transport seam.
// mailer.ts re-exports these.

export type Provider = "ses";

// The message shape the transport accepts.
export interface MailMessage {
  from: string;
  to: string[];
  subject: string;
  html: string;
  headers?: Record<string, string>;
  // Per-message SES configuration set override (click-tracked sends).
  configSet?: string;
}

export type MailResult =
  | { ok: true; id: string }
  // `retryable` distinguishes "the provider was busy / the network blipped"
  // from "this message will never be accepted". The broadcast queue only ever
  // re-selects `pending`, so a row marked `failed` is dropped forever.
  | { ok: false; status: number; error: string; retryable: boolean };
