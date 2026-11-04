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
    const redirected = await mf.dispatchFetch('https://mcp.oddbout.com/mcp');
    assert.equal(redirected.status, 502); assert.deepEqual(await redirected.json(), { error: 'mcp_upstream_unavailable' });
    for (const path of ['/health', '/mcp?url=https://evil.test']) {
      const fallback = await mf.dispatchFetch('https://mcp.oddbout.com' + path);
      assert.equal(fallback.status, 404); assert.equal(await fallback.text(), 'origin');
    }
    assert.equal(calls.length, 5, 'no redirect destination was fetched');
  } finally { await mf.dispose(); }
});
