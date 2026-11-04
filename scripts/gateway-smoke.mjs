// @ts-check
// Read-only checks. No account tool, OAuth token, generation or registered duel is used.
import assert from 'node:assert/strict';
import { DOMAIN_CHALLENGE, BRANDED_DOMAIN_CHALLENGE } from '../worker/gateway-core.mjs';
const base = new URL(process.argv[2] ?? 'https://mcp.oddbout.com');
if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Use an HTTPS origin without credentials, path or query');
const branded = base.hostname === 'mcp.oddbout.com';
const requireWorker = process.argv.includes('--worker');
/** @param {string} path @param {RequestInit} [init] */
const get = (path, init = {}) => fetch(new URL(path, base), { ...init, redirect: 'error', signal: AbortSignal.timeout(55_000) });
/** @param {Response} response */
const checkWorker = response => { if (requireWorker) assert.equal(response.headers.get('x-oddbout-gateway'), 'cloudflare', 'Worker handling marker'); };
const proof = await get('/.well-known/openai-apps-challenge');
assert.equal(proof.status, 200); checkWorker(proof);
assert.equal(await proof.text(), branded ? BRANDED_DOMAIN_CHALLENGE : DOMAIN_CHALLENGE);
console.log('domain challenge: passed');
for (const path of branded ? ['/mcp', '/claude', '/signin'] : ['/mcp']) {
  const meta = await get('/.well-known/oauth-protected-resource' + path);
  assert.equal(meta.status, 200); checkWorker(meta);
  const metadata = await meta.json();
  if (branded) assert.equal(metadata.resource, new URL(path, base).href);
  for (const method of ['initialize', 'tools/list']) {
    /** @type {string[] | undefined} */ let toolNames;
    for (const encoding of ['identity', 'gzip, br']) {
      const params = method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'oddbout-gateway-smoke', version: '1' } } : {};
      const response = await get(path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'accept-encoding': encoding },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      checkWorker(response);
      if (path === '/signin') { assert.equal(response.status, 401); assert.ok(response.headers.get('www-authenticate')?.includes('/signin')); await response.text(); continue; }
      assert.equal(response.status, 200);
      const body = await response.text();
      const json = JSON.parse(body.startsWith('data:') ? body.slice(5).trim() : body);
      assert.ok(json.result, 'JSON-RPC result');
      if (method === 'tools/list') {
        const names = json.result.tools.map((/** @type {{name: string}} */ tool) => tool.name).sort();
        assert.ok(names.length > 0);
        if (toolNames) assert.deepEqual(names, toolNames, 'compressed and identity results');
        toolNames = names;
      }
    }
    console.log(`${path} ${method}: passed (identity and compression)`);
  }
}
if (branded) {
  const health = await get('/health'); assert.equal(health.status, 200); assert.equal((await health.json()).ok, true);
  assert.equal(health.headers.get('x-oddbout-gateway'), null, 'health is answered by Render');
  console.log('Render health passthrough: passed');
}
console.log('All gateway smoke checks passed. Client login and billing metrics still need separate verification.');
