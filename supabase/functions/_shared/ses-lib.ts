// _shared/ses-lib — pure logic for the SES v2 client (no Deno/IO/network).
// ses.ts imports these; ses-lib.test.ts tests them.

export interface SesMessage {
  from: string;
  to: string[];
  subject: string;
  html: string;
  headers?: Record<string, string>;
  // Overrides the isolate-wide config set for this one message. Used to pick
  // the click-tracked set per recipient (see _shared/tracked-lib.ts).
  configSet?: string;
  // Stable id of WHAT this email is ("follow", "wear_reminder"), sent as the SES
  // message tag wr_msg. SES echoes tags on every event, ses-webhook stores it in
  // email_events.msg_key, and the admin stats group by it — so a subject line
  // translated into the recipient's language still counts in the right row.
  msgKey?: string;
}

// SES rejects a tag value outside [A-Za-z0-9_-] (and the whole send with it),
// so anything else is dropped rather than sent: a lost tag costs a stats row,
// a rejected send costs the email.
export function msgTag(key: string | undefined | null): { Name: string; Value: string }[] | null {
  return key && /^[A-Za-z0-9_-]{1,64}$/.test(key) ? [{ Name: "wr_msg", Value: key }] : null;
}

export function sesEndpoint(region: string): string {
  return `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
}

// Shape a SES v2 SendEmail request body. ConfigurationSetName is mandatory:
// the config set publishes Send events to SNS, which become the
// email_events 'sent' rows that the broadcast drain quota and _NofM batch
// dedup depend on. A send without it is invisible to those systems.
export function buildSesPayload(
  msg: SesMessage,
  configSet: string,
): Record<string, unknown> {
  const simple: Record<string, unknown> = {
    Subject: { Data: msg.subject, Charset: "UTF-8" },
    Body: { Html: { Data: msg.html, Charset: "UTF-8" } },
  };
  const entries = Object.entries(msg.headers ?? {});
  if (entries.length) {
    simple.Headers = entries.map(([Name, Value]) => ({ Name, Value }));
  }
  const payload: Record<string, unknown> = {
    FromEmailAddress: msg.from,
    Destination: { ToAddresses: msg.to },
    Content: { Simple: simple },
    ConfigurationSetName: msg.configSet ?? configSet,
  };
  const tags = msgTag(msg.msgKey);
  if (tags) payload.EmailTags = tags;
  return payload;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
