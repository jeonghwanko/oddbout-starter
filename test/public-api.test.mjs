import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicApiFetch } from '../worker/public-api.mjs';

const SITE = 'https://oddbout.com';
const RANKINGS = '/api/ai-fighter/rankings';
const ROSTER = '/api/ai-fighter/roster';
const ARENA = '/api/oddbout-arena/rankings';
const UUID = '11223344-5566-7788-99aa-bbccddeeff00';
const call = (path, options, init) => publicApiFetch(new Request(SITE + path, init), options);

function memoryCache() {
  const entries = new Map();
  return {
    entries,
    async match(request) {
      return entries.get(request.url)?.clone();
    },
    async put(request, response) {
      entries.set(request.url, response);
    },
  };
}

test('rejects everything outside the public GET contract before using upstream or cache', async () => {
  const never = () => assert.fail('unexpected fetch or cache call');
  const options = { fetcher: never, cache: { match: never, put: never } };
  for (const [path, status, init] of [
    ['/api/ai-fighter/roster/' + UUID, 404],
    ['/api/ai-fighter/rankings/', 404],
    ['/api/ai-fighter/roster%2F' + UUID, 404],
    ['/api/ai-fighter/admin', 404],
    ['/api/oddbout-arena/booth/state', 404],
    ['/api/oddbout-arena/club/tour', 404],
    [RANKINGS, 405, { method: 'POST' }],
    [RANKINGS, 405, { method: 'OPTIONS' }],
    [RANKINGS, 405, { method: 'HEAD' }],
    [RANKINGS, 403, { headers: { origin: 'https://not-oddbout.com' } }],
    [RANKINGS, 403, { headers: { origin: 'null' } }],
    [RANKINGS, 400, { headers: { authorization: '' } }],
    [RANKINGS, 400, { headers: { cookie: 'private=1' } }],
    [RANKINGS, 400, { headers: { apikey: 'private' } }],
    [RANKINGS + '?x-region=us-east-1', 400],
    [RANKINGS + '?__oddbout_public_api=1', 400],
    [ROSTER + '?after=' + UUID, 400],
    [ROSTER + '?after=' + encodeURIComponent('2026-02-30T00:00:00Z|' + UUID), 400],
    [ROSTER + '?after=' + encodeURIComponent('2026-02-10T00:00:00Z|' + UUID + '|extra'), 400],
    [ARENA + '?scope=registered&scope=registered', 400],
    [ARENA + '?scope=registered&', 400],
    [ARENA + '?scope=other', 400],
  ]) {
    const response = await call(path, options, init);
    assert.equal(response.status, status, path);
    assert.equal(response.headers.get('x-oddbout-cache'), 'BYPASS');
  }
});

test('forwards only canonical public URLs to Singapore and expires entries after 15 seconds', async () => {
  const cache = memoryCache();
  const upstream = [];
  let now = 20_000;
  const options = {
    cache,
    clock: () => now,
    fetcher: async (url, init) => {
      upstream.push(url.toString());
      assert.deepEqual(Object.fromEntries(new Headers(init.headers)), {
        accept: 'application/json',
        'accept-encoding': 'identity',
        'x-region': 'ap-southeast-1',
      });
      assert.equal(init.redirect, 'manual');
      assert.equal(init.credentials, 'omit');
      return Response.json(
        { ok: true, count: upstream.length },
        { headers: { 'x-sb-edge-region': 'ap-southeast-1', 'access-control-allow-origin': 'https://other.test', 'cache-control': 'no-store' } },
      );
    },
  };
  const after = (timestamp, id = UUID) => ROSTER + '?after=' + encodeURIComponent(timestamp + '|' + id);
  const first = await call(after('2026-11-11T06:01:00.001230+00:00', UUID.toUpperCase()), options, {
    headers: { origin: SITE, 'x-region': 'us-east-1', 'if-none-match': '*', 'x-private': 'secret' },
  });
  assert.equal(first.headers.get('x-oddbout-cache'), 'MISS');
  assert.equal(first.headers.get('access-control-allow-origin'), SITE);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await first.json(), { ok: true, count: 1 });
  const kept = [...cache.entries.values()][0];
  assert.equal(kept.headers.get('cache-control'), 'public, max-age=15');
  assert.equal(kept.headers.get('access-control-allow-origin'), null);
  assert.match([...cache.entries.keys()][0], /__oddbout_public_api=\d+$/);
  now += 14_000;
  const second = await call(after('2026-11-11T06:01:00.00123Z'), options);
  assert.equal(second.headers.get('x-oddbout-cache'), 'HIT');
  assert.equal(second.headers.get('x-oddbout-cache-age'), '14');
  assert.equal(second.headers.get('x-sb-edge-region'), 'ap-southeast-1');
  assert.equal(second.headers.get('x-oddbout-cache-stored-at'), null);
  assert.deepEqual(await second.json(), { ok: true, count: 1 });
  now += 1_000;
  const third = await call(after('2026-11-11T06:01:00.00123Z'), options);
  assert.equal(third.headers.get('x-oddbout-cache'), 'MISS');
  assert.deepEqual(await third.json(), { ok: true, count: 2 });
  for (const path of [ROSTER, ARENA, ARENA + '?scope=registered', RANKINGS]) {
    const response = await call(path, options);
    assert.equal(response.headers.get('x-oddbout-cache'), 'MISS');
  }
  const prefix = 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1';
  assert.deepEqual(upstream, [
    ...Array(2).fill(prefix + after('2026-11-11T06:01:00.00123Z').slice(4)),
    ...[ROSTER, ARENA, ARENA + '?scope=registered', RANKINGS].map(path => prefix + path.slice(4)),
  ]);
});

test('does not cache an upstream failure, redirect, oversized body, non-success JSON or cookie', async () => {
  const cache = memoryCache();
  for (const [response, status] of [
    [new Response(null, { status: 302, headers: { location: 'https://evil.test' } }), 502],
    [new Response(null, { status: 503 }), 503],
    [new Response('{"ok":true}'), 502],
    [new Response('{broken', { headers: { 'content-type': 'application/json' } }), 502],
    [Response.json({ ok: false }), 502],
    [Response.json({ ok: true, padding: 'x'.repeat(128 * 1024) }), 502],
    [Response.json({ ok: true }, { headers: { 'set-cookie': 'user=1' } }), 200],
  ]) {
    const result = await call(RANKINGS, { cache, fetcher: async () => response });
    assert.equal(result.status, status);
    assert.equal(result.headers.get('x-oddbout-cache'), 'BYPASS');
    assert.equal(result.headers.get('set-cookie'), null);
    assert.equal(result.headers.get('location'), null);
  }
  assert.equal(cache.entries.size, 0);
});

test('caches a public body with only the confirmed infrastructure cookie and strips all cookies', async () => {
  const cache = memoryCache();
  const botCookie = '__cf_bm=test; Expires=Wed, 11 Nov 2026 00:30:00 GMT; Secure; HttpOnly';
  for (const cookies of [[botCookie, 'session=private'], [botCookie + ', session=private'], ['_cfuvid=unconfirmed']]) {
    const headers = new Headers();
    for (const cookie of cookies) headers.append('set-cookie', cookie);
    const response = await call(RANKINGS, { cache, fetcher: async () => Response.json({ ok: true }, { headers }) });
    assert.equal(response.headers.get('x-oddbout-cache'), 'BYPASS');
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.equal(cache.entries.size, 0);
  const options = { cache, fetcher: async () => Response.json({ ok: true }, { headers: { 'set-cookie': botCookie } }) };
  for (const status of ['MISS', 'HIT']) {
    const response = await call(RANKINGS, options);
    assert.equal(response.headers.get('x-oddbout-cache'), status);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.equal([...cache.entries.values()][0].headers.get('set-cookie'), null);
});

test('a cache read/write failure or a diagnostic bypass still serves fresh public data', async () => {
  const unavailable = () => Promise.reject(new Error('cache unavailable'));
  for (const cache of [
    { match: unavailable, put: unavailable },
    { match: async () => undefined, put: unavailable },
  ]) {
    const response = await call(RANKINGS, { cache, fetcher: async () => Response.json({ ok: true }) });
    assert.equal(response.headers.get('x-oddbout-cache'), 'BYPASS');
    assert.deepEqual(await response.json(), { ok: true });
  }
  const cache = memoryCache();
  const options = { cache, fetcher: async () => Response.json({ ok: true, fresh: true }) };
  await call(RANKINGS, { ...options, fetcher: async () => Response.json({ ok: true, fresh: false }) });
  for (const cacheControl of ['no-cache', 'max-age=0, no-store']) {
    const response = await call(RANKINGS, options, { headers: { 'cache-control': cacheControl } });
    assert.equal(response.headers.get('x-oddbout-cache'), 'BYPASS');
    assert.deepEqual(await response.json(), { ok: true, fresh: true });
  }
  assert.deepEqual(await (await call(RANKINGS, options)).json(), { ok: true, fresh: false });
});

test('bounds upstream fetch and does not cache a timeout', async () => {
  const cache = memoryCache();
  const keepAlive = setTimeout(() => {}, 1_000);
  try {
    const response = await call(RANKINGS, {
      cache,
      timeoutMs: 5,
      fetcher: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
    });
    assert.equal(response.status, 504);
    assert.equal(cache.entries.size, 0);
  } finally {
    clearTimeout(keepAlive);
  }
});
