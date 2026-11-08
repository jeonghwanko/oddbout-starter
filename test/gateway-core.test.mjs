import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gatewayFetch,
  gatewayRoute,
  DOMAIN_CHALLENGE,
  BRANDED_DOMAIN_CHALLENGE,
  PUBLIC_RESOURCE,
  PUBLIC_SIGN_IN_RESOURCE,
  PUBLIC_DIRECTORY_RESOURCE,
  LEGACY_PUBLIC_RESOURCE,
} from '../worker/gateway-core.mjs';
import { CLOUD_RESOURCE, DIRECTORY_RESOURCE } from '../mcp/cloud/resources.mjs';
import { createCloudHandler } from '../mcp/cloud.mjs';

const at = (path, init = {}, host = 'mcp.oddbout.com') => new Request(`https://${host}${path}`, init);
// A call the function answers (a GET or HEAD at /mcp or /claude is the gateway's own since 2026-11-05).
const post = (path, init = {}) => at(path, { method: 'POST', body: '{}', ...init });
const answer = async () => new Response('{}');

test('all fixed routes select their exact upstream path and resource, with branded-only editions', async () => {
  const metadata = '/.well-known/oauth-protected-resource';
  for (const [prefix, resource, suffix] of [
    ['/mcp', PUBLIC_RESOURCE, ''],
    ['/signin', PUBLIC_SIGN_IN_RESOURCE, '/signin'],
    ['/claude', PUBLIC_DIRECTORY_RESOURCE, '/claude'],
  ]) {
    for (const [path, upstream] of [
      [prefix, suffix],
      [prefix + metadata, suffix + metadata],
      [metadata + prefix, suffix + metadata],
    ]) {
      for (const method of ['GET', 'POST', 'HEAD', 'OPTIONS']) {
        // A probe of the MCP address itself is answered here (below); /signin's goes to its sign-in check.
        if (['GET', 'HEAD'].includes(method) && path === prefix && prefix !== '/signin') continue;
        let call;
        const response = await gatewayFetch(at(path, { method }), {
          fetcher: async (url, options) => {
            call = { url, options };
            return new Response(method === 'HEAD' ? null : '{}');
          },
        });
        assert.equal(response.status, 200);
        await response.text();
        assert.equal(call.url, CLOUD_RESOURCE + upstream);
        assert.equal(call.options.method, method);
        assert.equal(call.options.headers.get('x-oddbout-public-resource'), resource);
      }
    }
  }
  const legacy = await gatewayFetch(at('/mcp', {}, 'example.workers.dev'), {
    fetcher: async (_, options) => {
      assert.equal(options.headers.get('x-oddbout-public-resource'), LEGACY_PUBLIC_RESOURCE);
      return answer();
    },
  });
  await legacy.text();
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
  for (const [host, expected] of [
    ['mcp.oddbout.com', BRANDED_DOMAIN_CHALLENGE],
    ['example.workers.dev', DOMAIN_CHALLENGE],
  ]) {
    const response = await gatewayFetch(at('/.well-known/openai-apps-challenge', {}, host));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), expected);
    assert.equal(response.headers.get('content-type'), 'text/plain');
    for (const method of ['POST', 'HEAD', 'OPTIONS', 'DELETE']) {
      const denied = await gatewayFetch(at('/.well-known/openai-apps-challenge', { method }, host));
      assert.equal(denied.status, 405);
      assert.equal(await denied.text(), '');
    }
  }
});

test('request and response headers are allowlisted; client ids, cookies and wake credentials never cross', async () => {
  const safe = {
    authorization: 'Bearer test-token',
    'content-type': 'application/json',
    accept: 'application/json',
    origin: 'https://example.test',
    'user-agent': 'Test/1',
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': 'tools/list',
    'mcp-name': 'test',
  };
  const blocked = {
    cookie: 'private=test',
    'x-ai-fighter-time': '123',
    'x-oddbout-public-resource': 'https://evil.test',
    'x-request-id': 'client-id',
    'x-forwarded-for': 'example',
    'accept-encoding': 'gzip',
  };
  const outgoing = [];
  for (let i = 0; i < 2; i++) {
    const response = await gatewayFetch(at('/mcp', { method: 'POST', headers: { ...safe, ...blocked }, body: '{}' }), {
      fetcher: async (_, options) => {
        for (const [name, value] of Object.entries(safe)) assert.equal(options.headers.get(name), value, name);
        for (const name of ['cookie', 'x-ai-fighter-time', 'x-forwarded-for']) assert.equal(options.headers.get(name), null);
        assert.equal(options.headers.get('accept-encoding'), 'identity');
        assert.equal(options.headers.get('x-oddbout-public-resource'), PUBLIC_RESOURCE);
        assert.equal(options.redirect, 'manual');
        outgoing.push(options.headers.get('x-request-id'));
        return new Response('{}', {
          status: 401,
          headers: {
            'content-type': 'application/json',
            'www-authenticate': 'Bearer test',
            'retry-after': '30',
            allow: 'GET, POST',
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'POST',
            'access-control-allow-headers': 'authorization',
            'access-control-expose-headers': 'mcp-session-id',
            'mcp-session-id': 'test-session',
            'set-cookie': 'private=test',
            server: 'private',
            'x-request-id': 'upstream-id',
            'cache-control': 'public',
          },
        });
      },
    });
    assert.equal(response.status, 401);
    await response.text();
    for (const name of [
      'content-type',
      'www-authenticate',
      'retry-after',
      'allow',
      'access-control-allow-origin',
      'access-control-allow-methods',
      'access-control-allow-headers',
      'access-control-expose-headers',
      'mcp-session-id',
    ])
      assert.ok(response.headers.has(name), name);
    for (const name of ['set-cookie', 'server']) assert.equal(response.headers.get(name), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-request-id'), outgoing.at(-1));
  }
  assert.notEqual(outgoing[0], 'client-id');
  assert.notEqual(outgoing[0], outgoing[1]);
  assert.match(outgoing[0], /^[a-f0-9-]{36}$/);
});

test('methods, byte-counted streamed body limits, failures and redirects fail safely', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return answer();
  };
  assert.equal((await gatewayFetch(at('/mcp', { method: 'DELETE' }), { fetcher })).status, 405);
  const oversized = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(32_768));
      c.enqueue(new Uint8Array(32_769));
      c.close();
    },
  });
  const denied = await gatewayFetch(at('/mcp', { method: 'POST', body: oversized, duplex: 'half' }), { fetcher });
  assert.equal(denied.status, 413);
  assert.equal(await denied.text(), '{"error":"body_limit"}');
  assert.equal(calls, 0);
  const exact = await gatewayFetch(at('/mcp', { method: 'POST', body: 'é'.repeat(32_768) }), { fetcher });
  assert.equal(exact.status, 200);
  await exact.text();
  assert.equal(calls, 1);
  for (const fail of [
    async () => {
      throw new Error('private-token');
    },
    async () => new Response(null, { status: 302, headers: { location: 'https://evil.test' } }),
  ]) {
    const response = await gatewayFetch(post('/mcp'), { fetcher: fail });
    assert.equal(response.status, 502);
    assert.equal(await response.text(), '{"error":"mcp_upstream_unavailable"}');
    assert.equal(response.headers.get('location'), null);
  }
});

test('headers and upload wait have deadlines; streamed response retains total deadline and cancellation', async () => {
  let signal;
  const timed = await gatewayFetch(post('/mcp'), {
    headerTimeoutMs: 20,
    totalTimeoutMs: 1000,
    fetcher: async (_, options) => {
      signal = options.signal;
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    },
  });
  assert.equal(timed.status, 502);
  assert.ok(signal.aborted);
  const stalled = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
  });
  const upload = await gatewayFetch(at('/mcp', { method: 'POST', body: stalled, duplex: 'half' }), { headerTimeoutMs: 20, fetcher: answer });
  assert.equal(upload.status, 502);
  let canceled = false;
  const streamed = await gatewayFetch(post('/mcp'), {
    headerTimeoutMs: 10,
    totalTimeoutMs: 80,
    fetcher: async (_, options) => {
      signal = options.signal;
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('data: first\n\n'));
          },
          cancel() {
            canceled = true;
          },
        }),
      );
    },
  });
  const reader = streamed.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
  await assert.rejects(reader.read(), /mcp_upstream_unavailable/);
  assert.ok(signal.aborted);
  assert.ok(canceled);
  const client = new AbortController();
  const response = await gatewayFetch(post('/mcp', { signal: client.signal }), {
    fetcher: async (_, options) => {
      signal = options.signal;
      return new Response(new ReadableStream());
    },
  });
  client.abort();
  assert.ok(signal.aborted);
  await assert.rejects(response.text());
  const cancelResponse = await gatewayFetch(post('/mcp'), {
    fetcher: async (_, options) => {
      signal = options.signal;
      return new Response(new ReadableStream());
    },
  });
  await cancelResponse.body.cancel();
  assert.ok(signal.aborted);
});

// MCP 최적화 2026-11-05: a GET or HEAD at /mcp or /claude cost a function call for a fixed 405; the gateway answers it as the function does.
test("a probe of /mcp or /claude is answered here as the function answers it; /signin's and the metadata still reach it", async () => {
  const fn = createCloudHandler({ db: {}, log: () => {} });
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    return fn(new Request(url, options));
  };
  for (const [prefix, upstream] of [
    ['/mcp', CLOUD_RESOURCE],
    ['/claude', DIRECTORY_RESOURCE],
  ]) {
    for (const host of prefix === '/mcp' ? ['mcp.oddbout.com', 'example.workers.dev'] : ['mcp.oddbout.com']) {
      for (const method of ['GET', 'HEAD']) {
        for (const origin of [undefined, 'https://claude.ai', 'https://evil.example']) {
          const headers = origin ? { origin } : {};
          const own = await fn(new Request(upstream, { method, headers }));
          const local = await gatewayFetch(at(prefix, { method, headers }, host), { fetcher });
          assert.equal(local.status, own.status, `${prefix} ${method} ${origin}`);
          assert.equal(await local.text(), method === 'HEAD' ? '' : await own.text(), `${prefix} ${method} ${origin}`);
          for (const [name, value] of own.headers) assert.equal(local.headers.get(name), value, `${prefix} ${method} ${name}`);
          assert.match(local.headers.get('x-request-id'), /^[a-f0-9-]{36}$/);
        }
      }
    }
  }
  assert.equal(calls, 0);
  // The sign-in-first address answers a probe with its sign-in check, and the metadata is the function's.
  const signIn = await gatewayFetch(at('/signin'), { fetcher });
  assert.equal(signIn.status, 401);
  await signIn.text();
  assert.equal((await gatewayFetch(at('/signin', { method: 'HEAD' }), { fetcher })).status, 401);
  assert.equal((await (await gatewayFetch(at('/.well-known/oauth-protected-resource/claude'), { fetcher })).json()).resource, PUBLIC_DIRECTORY_RESOURCE);
  assert.equal(calls, 3);
});

test('the Worker keeps a metadata answer five minutes by host and path, tells the client no-store, and keeps nothing else', async () => {
  const kept = new Map();
  const cache = {
    match: async request => kept.get(request.url)?.clone(),
    put: async (request, response) => {
      kept.set(request.url, response);
    },
  };
  const fn = createCloudHandler({ db: {}, log: () => {} });
  let calls = 0,
    failing = false;
  const fetcher = async (url, options) => {
    calls++;
    return failing ? new Response('{"error":"down"}', { status: 503 }) : fn(new Request(url, options));
  };
  const metadata = '/.well-known/oauth-protected-resource';
  const first = await gatewayFetch(at(metadata + '/mcp'), { fetcher, cache });
  const second = await gatewayFetch(at(metadata + '/mcp'), { fetcher, cache });
  assert.equal(calls, 1);
  const [a, b] = [await first.json(), await second.json()];
  assert.deepEqual(b, a);
  assert.equal(a.resource, PUBLIC_RESOURCE);
  for (const response of [first, second]) {
    assert.deepEqual(
      [response.status, response.headers.get('cache-control'), response.headers.get('content-type'), response.headers.get('x-content-type-options')],
      [200, 'no-store', 'application/json', 'nosniff'],
    );
  }
  assert.notEqual(first.headers.get('x-request-id'), second.headers.get('x-request-id'));
  assert.equal(kept.get(`https://mcp.oddbout.com${metadata}/mcp`).headers.get('cache-control'), 'public, max-age=300');
  // Its own entry for each address: the other path of the same edition, another edition, another host.
  await (await gatewayFetch(at('/mcp' + metadata), { fetcher, cache })).text();
  assert.equal((await (await gatewayFetch(at(metadata + '/claude'), { fetcher, cache })).json()).resource, PUBLIC_DIRECTORY_RESOURCE);
  assert.equal((await (await gatewayFetch(at('/mcp' + metadata, {}, 'example.workers.dev'), { fetcher, cache })).json()).resource, LEGACY_PUBLIC_RESOURCE);
  assert.equal(calls, 4);
  assert.equal(kept.size, 4);
  // A failure, a HEAD and an MCP call are never kept; without a cache (the Node adapter) every request goes up.
  failing = true;
  for (let i = 0; i < 2; i++) {
    const refused = await gatewayFetch(at('/signin' + metadata), { fetcher, cache });
    assert.equal(refused.status, 503);
    await refused.text();
  }
  failing = false;
  await gatewayFetch(at(metadata + '/mcp', { method: 'HEAD' }), { fetcher, cache });
  await (await gatewayFetch(post('/mcp'), { fetcher, cache })).text();
  assert.equal(calls, 8);
  assert.equal(kept.size, 4);
  for (let i = 0; i < 2; i++) await (await gatewayFetch(at(metadata + '/mcp'), { fetcher })).text();
  assert.equal(calls, 10);
});
