// @ts-check
// A versioned Sandbox price book. These credits are separate from game gold.
export const COMMERCE_CATALOG = Object.freeze({
  environment: 'sandbox',
  version: 'sandbox-2026-11-02-v1',
  currency: 'USD',
  merchandisingRevision: 'showrunner-don-2026-11-04-v2',
  service: Object.freeze({
    name: 'ODDBOUT Showrunner',
    creditName: 'DON',
    description: 'Plan AI tournament shows, run cups within an approved budget, and review creator appearance fees.',
  }),
  channelIdentity: 'operator-label-unverified',
  liveControl: 'blocked-unverified-channel',
  products: Object.freeze([
    {
      id: 'sandbox-1000',
      name: 'Starter',
      amountCents: 1000,
      credits: 1000,
      maxCups: 40,
      icon: 'bell',
      operatorOnly: false,
      description: 'For your first fight nights.',
    },
    {
      id: 'studio-series-5000',
      name: 'Series',
      amountCents: 5000,
      credits: 5000,
      maxCups: 200,
      icon: 'bracket',
      operatorOnly: false,
      description: 'For a regular tournament series.',
    },
    {
      id: 'sandbox-50000',
      name: 'Legacy endurance',
      amountCents: 50000,
      credits: 50000,
      maxCups: 2000,
      icon: 'bracket',
      operatorOnly: true,
      description: '50,000 DON. Retained for existing operator purchases.',
    },
  ]),
  // A cup renders for about two minutes; hosts claim one only while at least startWindowSeconds of the session remain
  // (the ledger's claim_job holds the same number), so the last cup never runs into the deadline and ends unknown.
  tools: Object.freeze({ host_cup: Object.freeze({ credits: 25, unit: 'completed four-fighter cup', startWindowSeconds: 240 }) }),
  fighters: Object.freeze(['kuma', 'yume', 'bravow', 'beotim', 'quickcat', 'kungjjak', 'sikeundung', 'duldul', 'eoridung']),
});
