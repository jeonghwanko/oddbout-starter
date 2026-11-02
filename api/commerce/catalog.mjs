// @ts-check
// A versioned Sandbox price book. These credits are separate from game gold.
export const COMMERCE_CATALOG = Object.freeze({
  environment: 'sandbox', version: 'sandbox-2026-11-02-v1', currency: 'USD',
  channelIdentity: 'operator-label-unverified', liveControl: 'blocked-unverified-channel',
  products: Object.freeze([{ id: 'sandbox-1000', name: '1,000 Sandbox credits', amountCents: 1000, credits: 1000 }]),
  tools: Object.freeze({ host_cup: Object.freeze({ credits: 25, unit: 'completed four-fighter cup' }) }),
  fighters: Object.freeze(['kuma', 'yume', 'bravow', 'beotim', 'quickcat', 'kungjjak', 'sikeundung', 'duldul', 'eoridung']),
});
