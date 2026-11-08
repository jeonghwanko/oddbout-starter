// @ts-check
// Decide AI_FIGHTER_CLIENT_IP_SOURCE from evidence: call the deployed client-ip-probe function with and without
// spoofed headers and report which source (api/client-limit.mjs) a client cannot control.
//   node scripts/probe-client-ip.mjs https://<project-ref>.supabase.co/functions/v1/client-ip-probe
// A source is trusted only if it is a real address, the same in every request, and never one of the spoofed values.
import { pathToFileURL } from 'node:url';
import { clientAddress } from '../api/client-limit.mjs';

const SPOOF = { xff: '192.0.2.66', cf: '192.0.2.77' }; // TEST-NET-1: never a real caller
const CASES = {
  plain: {},
  forwarded: { 'x-forwarded-for': SPOOF.xff },
  cloudflare: { 'cf-connecting-ip': SPOOF.cf },
  both: { 'x-forwarded-for': SPOOF.xff, 'cf-connecting-ip': SPOOF.cf },
};

/**
 * `echoes`: case name → the probe's JSON, or `{ rejectedByEdge: true }` when the edge refused that spoofed request
 * (Cloudflare answers a client-sent CF-Connecting-IP with 403 `error code: 1000`, seen 2026-10-27). A refused spoof
 * never reaches the function, so it is evidence the client cannot set that header. Pure, so it is tested without a network.
 * @param {Record<string, { rejectedByEdge?: boolean, cfConnectingIp?: string | null, forwardedFor?: string | null }>} echoes
 */
export function judge(echoes) {
  /** @type {Record<string, { trusted: boolean, reason: string | null, seen: Record<string, string | null> }>} */
  const verdicts = {};
  const reached = Object.fromEntries(Object.entries(echoes).filter(([, echo]) => !echo.rejectedByEdge));
  for (const source of ['cf-connecting-ip', 'forwarded-last']) {
    const seen = Object.fromEntries(
      Object.entries(reached).map(([name, echo]) => [
        name,
        clientAddress(
          new Request('https://probe', {
            headers: Object.fromEntries(
              [
                ['cf-connecting-ip', echo.cfConnectingIp],
                ['x-forwarded-for', echo.forwardedFor],
              ].filter(([, v]) => v),
            ),
          }),
          source,
        ),
      ]),
    );
    const values = Object.values(seen);
    const reason = values.some(v => v === null)
      ? 'missing-or-not-an-address'
      : values.some(v => v === SPOOF.xff || v === SPOOF.cf)
        ? 'client-controlled'
        : new Set(values).size !== 1
          ? 'unstable'
          : null;
    verdicts[source] = { trusted: reason === null, reason, seen };
  }
  return verdicts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.argv[2];
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/functions\/v1\/client-ip-probe$/.test(url ?? '')) {
    console.error('Usage: node scripts/probe-client-ip.mjs https://<project-ref>.supabase.co/functions/v1/client-ip-probe');
    process.exit(2);
  }
  /** @type {Parameters<typeof judge>[0]} */
  const echoes = {};
  for (const [name, headers] of Object.entries(CASES)) {
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    if (response.status === 403 && /error code: 1000/.test(text) && 'cf-connecting-ip' in headers) {
      echoes[name] = { rejectedByEdge: true };
      continue;
    }
    if (!response.ok) throw new Error(`probe-http-${response.status}`);
    echoes[name] = JSON.parse(text);
  }
  const verdicts = judge(echoes);
  // The raw echoes contain the operator's own address; print them only to this terminal, never to a file or log.
  console.log(JSON.stringify({ echoes, verdicts, recommended: Object.entries(verdicts).find(([, v]) => v.trusted)?.[0] ?? null }, null, 2));
}
