import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommerceService } from '../api/commerce/service.mjs';
import { createCommerceStore } from '../api/commerce/store.mjs';
import { createCommerceHandler } from '../api/commerce/handler.mjs';

const origin = 'https://console.example.test';
const now = Date.parse('2026-11-03T00:00:00Z');
const service = createCommerceService({
  publicOrigin: origin,
  hosts: [{ id: 'svl-mac-01' }],
  now: () => now,
  paypal: null,
  store: createCommerceStore({
    rpc: async () => {
      throw new Error('A quote must not access the ledger.');
    },
  }),
});
const budget = channelId => ({
  hostId: 'svl-mac-01',
  channelId,
  maxCredits: 250,
  endsAt: new Date(now + 2 * 3600000).toISOString(),
  fighterIds: ['kuma', 'yume', 'bravow', 'beotim'],
});

test('session quotes accept human names without changing prices or the live-streaming gate', () => {
  for (const name of ['Friday Night', 'Friday fight night', '금요일 밤', '금요일 Night_2', '_old-channel', 'A'.repeat(64)]) {
    const quote = service.quote(budget(name));
    assert.equal(quote.channelId, name);
    assert.equal(quote.cupCredits, 25);
    assert.equal(quote.maxCups, 10);
    assert.equal(quote.liveControl, 'blocked-unverified-channel');
  }
});

test('session labels still reject blank, overlong, control characters and non-label input', () => {
  for (const name of [
    '',
    '   ',
    'A'.repeat(65),
    'Friday\nNight',
    'Friday Night\n',
    'Friday\tNight',
    'Friday\u0000Night',
    'Friday\u202eNight',
    '<script>',
    'https://twitch.tv/test',
    null,
    7,
  ]) {
    assert.throws(
      () => service.quote(budget(name)),
      error => error.status === 422 && error.message === 'invalid-channel',
    );
  }
});

test('authenticated HTTP quote succeeds for the reported Friday Night input without approving or reserving credits', async () => {
  const handle = createCommerceHandler({ service, publicOrigin: origin, authenticate: async () => 'owner' });
  const response = await handle(
    new Request(origin + '/commerce/quote', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(budget('Friday Night')),
    }),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.data.channelId, 'Friday Night');
  assert.equal(result.data.maxCredits, 250);
});
