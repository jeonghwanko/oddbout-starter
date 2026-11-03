// @ts-check
// A versioned Sandbox price book. These credits are separate from game gold.
export const COMMERCE_CATALOG = Object.freeze({
  environment: 'sandbox', version: 'sandbox-2026-11-02-v1', currency: 'USD',
  channelIdentity: 'operator-label-unverified', liveControl: 'blocked-unverified-channel',
  products: Object.freeze([
    { id: 'sandbox-1000', name: '1,000 Sandbox credits', amountCents: 1000, credits: 1000 },
    { id: 'sandbox-50000', name: '50,000 Sandbox credits · endurance test', amountCents: 50000, credits: 50000 },
  ]),
  // A cup renders for about two minutes; hosts claim one only while at least startWindowSeconds of the session remain
  // (the ledger's claim_job holds the same number), so the last cup never runs into the deadline and ends unknown.
  tools: Object.freeze({ host_cup: Object.freeze({ credits: 25, unit: 'completed four-fighter cup', startWindowSeconds: 240 }) }),
  fighters: Object.freeze(['kuma', 'yume', 'bravow', 'beotim', 'quickcat', 'kungjjak', 'sikeundung', 'duldul', 'eoridung']),
});
