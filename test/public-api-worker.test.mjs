import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import miniflare from 'miniflare';

test('workerd serves the public API from the Cloudflare cache after a Singapore fetch', async () => {
  const upstream = [];
  const modules = ['cloudflare/public-api/index.mjs', 'worker/public-api.mjs', 'api/bytes.mjs'].map(path => ({
    type: 'ESModule',
    path: fileURLToPath(new URL('../' + path, import.meta.url)),
  }));
  const worker = new miniflare.Miniflare(
    miniflare.convertV4MiniflareOptions({
      modules,
      modulesRoot: fileURLToPath(new URL('../', import.meta.url)),
      compatibilityDate: '2026-11-04',
      compatibilityFlags: ['enable_request_signal'],
      outboundService: async request => {
        upstream.push(request);
        if (new URL(request.url).pathname.endsWith('/roster')) return Response.redirect('https://other.test', 302);
        return new Response('{"ok":true,"rankings":[]}', {
          headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'x-sb-edge-region': 'ap-southeast-1' },
        });
      },
    }),
  );
  try {
    const site = 'https://oddbout.com';
    const rankings = site + '/api/ai-fighter/rankings';
    for (const result of ['MISS', 'HIT']) {
      const response = await worker.dispatchFetch(rankings);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-oddbout-cache'), result);
      assert.equal(response.headers.get('x-sb-edge-region'), 'ap-southeast-1');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('content-encoding'), null);
      assert.deepEqual(await response.json(), { ok: true, rankings: [] });
    }
    assert.equal(upstream.length, 1);
    assert.equal(upstream[0].url, 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter/rankings');
    assert.equal(upstream[0].headers.get('x-region'), 'ap-southeast-1');
    assert.equal((await worker.dispatchFetch(rankings, { headers: { cookie: 'session=private' } })).status, 400);
    assert.equal((await worker.dispatchFetch(site + '/api/oddbout-arena/booth/state')).status, 404);
    assert.equal(upstream.length, 1);
    for (let i = 0; i < 2; i++) assert.equal((await worker.dispatchFetch(site + '/api/ai-fighter/roster')).status, 502);
    assert.equal(upstream.length, 3);
  } finally {
    await worker.dispose();
  }
});
