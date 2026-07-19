// _shared/ses-lib — pure logic for the SES v2 client (no Deno/IO/network).
// ses.ts imports these; ses-lib.test.ts tests them.

export interface SesMessage {
  from: string;
  to: string[];
  subject: string;
  html: string;
  headers?: Record<string, string>;
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
  return {
    FromEmailAddress: msg.from,
    Destination: { ToAddresses: msg.to },
    Content: { Simple: simple },
    ConfigurationSetName: configSet,
  };
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
