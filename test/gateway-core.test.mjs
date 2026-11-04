import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatewayFetch, gatewayRoute, DOMAIN_CHALLENGE, BRANDED_DOMAIN_CHALLENGE,
  PUBLIC_RESOURCE, PUBLIC_SIGN_IN_RESOURCE, PUBLIC_DIRECTORY_RESOURCE, LEGACY_PUBLIC_RESOURCE } from '../worker/gateway-core.mjs';
import { CLOUD_RESOURCE } from '../mcp/cloud/resources.mjs';

const at = (path, init = {}, host = 'mcp.oddbout.com') => new Request(`https://${host}${path}`, init);
const answer = async () => new Response('{}');

test('all fixed routes select their exact upstream path and resource, with branded-only editions', async () => {
  const metadata = '/.well-known/oauth-protected-resource';
  for (const [prefix, resource, suffix] of [['/mcp', PUBLIC_RESOURCE, ''], ['/signin', PUBLIC_SIGN_IN_RESOURCE, '/signin'], ['/claude', PUBLIC_DIRECTORY_RESOURCE, '/claude']]) {
    for (const [path, upstream] of [[prefix, suffix], [prefix + metadata, suffix + metadata], [metadata + prefix, suffix + metadata]]) {
      for (const method of ['GET', 'POST', 'HEAD', 'OPTIONS']) {
        let call;
        const response = await gatewayFetch(at(path, { method }), { fetcher: async (url, options) => { call = { url, options }; return new Response(method === 'HEAD' ? null : '{}'); } });
        assert.equal(response.status, 200); await response.text();
        assert.equal(call.url, CLOUD_RESOURCE + upstream);
        assert.equal(call.options.method, method);
        assert.equal(call.options.headers.get('x-oddbout-public-resource'), resource);
      }
    }
  }
  const legacy = await gatewayFetch(at('/mcp', {}, 'example.workers.dev'), { fetcher: async (_, options) => {
    assert.equal(options.headers.get('x-oddbout-public-resource'), LEGACY_PUBLIC_RESOURCE); return answer();
  } }); await legacy.text();
  for (const path of ['/signin', '/claude', metadata + '/signin', metadata + '/claude']) {
    assert.equal(await gatewayFetch(at(path, {}, 'example.workers.dev')), null);
  }
});

test('unknown paths, all queries including an empty query, and encoded paths are not proxied', async () => {
  for (const path of ['/health', '/wake', '/mcp/', '/mcp?x=1', '/mcp?', '/signin?url=https://evil.test', '/%6dcp', '/.well-known/openai-apps-challenge?']) {
    assert.equal(await gatewayFetch(at(path)), null, path);
  }
  assert.equal(gatewayRoute('mcp.oddbout.com', '/other/../mcp'), null);
  assert.equal(gatewayRoute('mcp.oddbout.com:80', '/signin'), null);
  assert.equal(gatewayRoute('MCP.ODDBOUT.COM:443', '/signin').resource, PUBLIC_SIGN_IN_RESOURCE);
});

test('domain verification remains local and GET-only on branded and legacy hosts', async () => {
  for (const [host, expected] of [['mcp.oddbout.com', BRANDED_DOMAIN_CHALLENGE], ['example.workers.dev', DOMAIN_CHALLENGE]]) {
    const response = await gatewayFetch(at('/.well-known/openai-apps-challenge', {}, host));
    assert.equal(response.status, 200); assert.equal(await response.text(), expected);
    assert.equal(response.headers.get('content-type'), 'text/plain');
    for (const method of ['POST', 'HEAD', 'OPTIONS', 'DELETE']) {
      const denied = await gatewayFetch(at('/.well-known/openai-apps-challenge', { method }, host));
      assert.equal(denied.status, 405); assert.equal(await denied.text(), '');
    }
  }
});

test('request and response headers are allowlisted; client ids, cookies and wake credentials never cross', async () => {
  const safe = { authorization: 'Bearer test-token', 'content-type': 'application/json', accept: 'application/json', origin: 'https://example.test', 'user-agent': 'Test/1',
    'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list', 'mcp-name': 'test' };
  const blocked = { cookie: 'private=test', 'x-ai-fighter-time': '123', 'x-oddbout-public-resource': 'https://evil.test', 'x-request-id': 'client-id', 'x-forwarded-for': 'example', 'accept-encoding': 'gzip' };
  const outgoing = [];
  for (let i = 0; i < 2; i++) {
    const response = await gatewayFetch(at('/mcp', { method: 'POST', headers: { ...safe, ...blocked }, body: '{}' }), { fetcher: async (_, options) => {
      for (const [name, value] of Object.entries(safe)) assert.equal(options.headers.get(name), value, name);
      for (const name of ['cookie', 'x-ai-fighter-time', 'x-forwarded-for']) assert.equal(options.headers.get(name), null);
      assert.equal(options.headers.get('accept-encoding'), 'identity');
      assert.equal(options.headers.get('x-oddbout-public-resource'), PUBLIC_RESOURCE);
      assert.equal(options.redirect, 'manual');
      outgoing.push(options.headers.get('x-request-id'));
      return new Response('{}', { status: 401, headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer test', 'retry-after': '30', allow: 'GET, POST',
        'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'authorization', 'access-control-expose-headers': 'mcp-session-id',
        'mcp-session-id': 'test-session', 'set-cookie': 'private=test', server: 'private', 'x-request-id': 'upstream-id', 'cache-control': 'public' } });
    } });
    assert.equal(response.status, 401); await response.text();
    for (const name of ['content-type', 'www-authenticate', 'retry-after', 'allow', 'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'access-control-expose-headers', 'mcp-session-id']) assert.ok(response.headers.has(name), name);
    for (const name of ['set-cookie', 'server']) assert.equal(response.headers.get(name), null);
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-request-id'), outgoing.at(-1));
  }
  assert.notEqual(outgoing[0], 'client-id'); assert.notEqual(outgoing[0], outgoing[1]); assert.match(outgoing[0], /^[a-f0-9-]{36}$/);
});

test('methods, byte-counted streamed body limits, failures and redirects fail safely', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return answer(); };
  assert.equal((await gatewayFetch(at('/mcp', { method: 'DELETE' }), { fetcher })).status, 405);
  const oversized = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(32_768)); c.enqueue(new Uint8Array(32_769)); c.close(); } });
  const denied = await gatewayFetch(at('/mcp', { method: 'POST', body: oversized, duplex: 'half' }), { fetcher });
  assert.equal(denied.status, 413); assert.equal(await denied.text(), '{"error":"body_limit"}'); assert.equal(calls, 0);
  const exact = await gatewayFetch(at('/mcp', { method: 'POST', body: 'é'.repeat(32_768) }), { fetcher });
  assert.equal(exact.status, 200); await exact.text(); assert.equal(calls, 1);
  for (const fail of [async () => { throw new Error('private-token'); }, async () => new Response(null, { status: 302, headers: { location: 'https://evil.test' } })]) {
    const response = await gatewayFetch(at('/mcp'), { fetcher: fail });
    assert.equal(response.status, 502); assert.equal(await response.text(), '{"error":"mcp_upstream_unavailable"}');
    assert.equal(response.headers.get('location'), null);
  }
});

test('headers and upload wait have deadlines; streamed response retains total deadline and cancellation', async () => {
  let signal;
  const timed = await gatewayFetch(at('/mcp'), { headerTimeoutMs: 20, totalTimeoutMs: 1000, fetcher: async (_, options) => {
    signal = options.signal; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  } });
  assert.equal(timed.status, 502); assert.ok(signal.aborted);
  const stalled = new ReadableStream({ pull() { return new Promise(() => {}); } });
  const upload = await gatewayFetch(at('/mcp', { method: 'POST', body: stalled, duplex: 'half' }), { headerTimeoutMs: 20, fetcher: answer });
  assert.equal(upload.status, 502);
  let canceled = false;
  const streamed = await gatewayFetch(at('/mcp'), { headerTimeoutMs: 10, totalTimeoutMs: 80, fetcher: async (_, options) => {
    signal = options.signal; return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: first\n\n')); }, cancel() { canceled = true; } }));
  } });
  const reader = streamed.body.getReader(); assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
  await assert.rejects(reader.read(), /mcp_upstream_unavailable/); assert.ok(signal.aborted); assert.ok(canceled);
  const client = new AbortController();
  const response = await gatewayFetch(at('/mcp', { signal: client.signal }), { fetcher: async (_, options) => { signal = options.signal; return new Response(new ReadableStream()); } });
  client.abort(); assert.ok(signal.aborted); await assert.rejects(response.text());
  const cancelResponse = await gatewayFetch(at('/mcp'), { fetcher: async (_, options) => { signal = options.signal; return new Response(new ReadableStream()); } });
  await cancelResponse.body.cancel(); assert.ok(signal.aborted);
});
