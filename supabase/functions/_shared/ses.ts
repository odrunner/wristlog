// _shared/ses — SES v2 send client for edge functions.
// SigV4 signing via aws4fetch (WebCrypto-based, edge-safe).
// Secrets: SES_AWS_ACCESS_KEY_ID, SES_AWS_SECRET_ACCESS_KEY, SES_REGION,
//          SES_CONFIG_SET (default "wrotate-events").

import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";
import { buildSesPayload, chunk, sesEndpoint } from "./ses-lib.ts";
import type { SesMessage } from "./ses-lib.ts";
export type { SesMessage } from "./ses-lib.ts";

const REGION = Deno.env.get("SES_REGION") ?? "us-east-1";
const CONFIG_SET = Deno.env.get("SES_CONFIG_SET") ?? "wrotate-events";

let client: AwsClient | null = null;
function getClient(): AwsClient {
  if (!client) {
    client = new AwsClient({
      accessKeyId: Deno.env.get("SES_AWS_ACCESS_KEY_ID") ?? "",
      secretAccessKey: Deno.env.get("SES_AWS_SECRET_ACCESS_KEY") ?? "",
      region: REGION,
      service: "ses",
    });
  }
  return client;
}

export type SesResult =
  | { ok: true; id: string }
  | { ok: false; status: number; error: string };

export async function sendSesEmail(msg: SesMessage): Promise<SesResult> {
  try {
    const res = await getClient().fetch(sesEndpoint(REGION), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSesPayload(msg, CONFIG_SET)),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, error: JSON.stringify(data).slice(0, 500) };
    }
    return { ok: true, id: (data as { MessageId?: string }).MessageId ?? "" };
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }
}

// SES has no arbitrary-payload batch endpoint (bulk requires stored templates),
// so send individually: waves of 10 concurrent with a 1s pause between waves —
// ~10/sec, under the 14/sec default SES account rate limit.
// results[i] always corresponds to msgs[i].
export async function sendSesBatch(
  msgs: SesMessage[],
): Promise<{ results: SesResult[]; sent: number; failed: number }> {
  const results: SesResult[] = [];
  const waves = chunk(msgs, 10);
  for (let i = 0; i < waves.length; i++) {
    const wave = await Promise.all(waves[i].map(sendSesEmail));
    results.push(...wave);
    if (i < waves.length - 1) await new Promise((r) => setTimeout(r, 1000));
  }
  const sent = results.filter((r) => r.ok).length;
  return { results, sent, failed: results.length - sent };
}
