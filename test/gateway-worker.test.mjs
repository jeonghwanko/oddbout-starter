import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import miniflare from 'miniflare';
import { DOMAIN_CHALLENGE, BRANDED_DOMAIN_CHALLENGE, PUBLIC_RESOURCE } from '../worker/gateway-core.mjs';

test('workerd runs the actual Worker: routing, redirect refusal, decoded compression, and origin passthrough', async () => {
  let mode = 'json'; const calls = [];
  const root = fileURLToPath(new URL('../', import.meta.url));
  const modules = ['cloudflare/mcp-gateway/index.mjs', 'worker/gateway-core.mjs', 'mcp/cloud/resources.mjs']
    .map(path => ({ type: 'ESModule', path: fileURLToPath(new URL('../' + path, import.meta.url)) }));
  const mf = new miniflare.Miniflare(miniflare.convertV4MiniflareOptions({
    modules, modulesRoot: root, compatibilityDate: '2026-11-04', compatibilityFlags: ['enable_request_signal'],
    outboundService: async request => {
      calls.push(request);
      if (new URL(request.url).hostname === 'mcp.oddbout.com') return new Response('origin', { status: 404 });
      assert.equal(request.headers.get('accept-encoding'), 'identity');
      assert.equal(request.headers.get('x-oddbout-public-resource'), PUBLIC_RESOURCE);
      assert.equal(request.headers.get('cookie'), null);
      if (new URL(request.url).pathname.endsWith('/.well-known/oauth-protected-resource')) return Response.json({ resource: PUBLIC_RESOURCE });
      if (mode === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://evil.test' } });
      // The service bridge applies Content-Encoding automatically, as a Worker Response does.
      if (mode === 'gzip') return new Response('{"ok":true}', { headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } });
      return new Response('data: first\n\ndata: second\n\n', { headers: { 'content-type': 'text/event-stream' } });
    },
  }));
  try {
    for (const [host, challenge] of [['mcp.oddbout.com', BRANDED_DOMAIN_CHALLENGE], ['example.workers.dev', DOMAIN_CHALLENGE]]) {
      const proof = await mf.dispatchFetch(`https://${host}/.well-known/openai-apps-challenge`);
      assert.equal(await proof.text(), challenge);
    }
    const response = await mf.dispatchFetch('https://mcp.oddbout.com/mcp', { method: 'POST', body: '{}', headers: { cookie: 'test=private' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'text/event-stream');
    assert.equal(await response.text(), 'data: first\n\ndata: second\n\n');
    mode = 'gzip';
    const compressed = await mf.dispatchFetch('https://mcp.oddbout.com/mcp', { method: 'POST', body: '{}' });
    assert.equal(compressed.headers.get('content-encoding'), null); assert.deepEqual(await compressed.json(), { ok: true });
    mode = 'redirect';
    const redirected = await mf.dispatchFetch('https://mcp.oddbout.com/mcp', { method: 'POST', body: '{}' });
    assert.equal(redirected.status, 502); assert.deepEqual(await redirected.json(), { error: 'mcp_upstream_unavailable' });
    for (const path of ['/health', '/mcp?url=https://evil.test']) {
      const fallback = await mf.dispatchFetch('https://mcp.oddbout.com' + path);
      assert.equal(fallback.status, 404); assert.equal(await fallback.text(), 'origin');
    }
    assert.equal(calls.length, 5, 'no redirect destination was fetched');
    // A probe of the MCP address is answered by the Worker (MCP 최적화 2026-11-05), and a metadata answer is kept in the cache.
    const probe = await mf.dispatchFetch('https://mcp.oddbout.com/mcp');
    assert.deepEqual([probe.status, probe.headers.get('allow'), probe.headers.get('x-oddbout-gateway'), await probe.json()],
      [405, 'POST, OPTIONS', 'cloudflare', { error: 'method_not_allowed' }]);
    for (let i = 0; i < 2; i++) {
      const metadata = await mf.dispatchFetch('https://mcp.oddbout.com/.well-known/oauth-protected-resource/mcp');
      assert.deepEqual([metadata.status, metadata.headers.get('cache-control'), metadata.headers.get('x-oddbout-gateway'), (await metadata.json()).resource],
        [200, 'no-store', 'cloudflare', PUBLIC_RESOURCE]);
    }
    assert.equal(calls.length, 6, 'the second metadata read came from the cache');
  } finally { await mf.dispose(); }
});
