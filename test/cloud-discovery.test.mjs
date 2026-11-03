import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkCloudDiscovery } from '../scripts/check-cloud-discovery.mjs';

const reply = value => Response.json(value);
const mock = (tools = ['get_profile', 'check_creation_readiness'], { versions = ['2026-07-28'], modern } = {}) => {
  const requests = [];
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body); requests.push({ url, options, body });
    if (body.method === 'initialize') return reply({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } });
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (options.headers['mcp-protocol-version'] === '2026-07-28' && modern) return modern(body);
    if (body.method === 'server/discover') return reply({ jsonrpc: '2.0', id: body.id, result: { supportedVersions: versions, capabilities: { tools: {} } } });
    return reply({ jsonrpc: '2.0', id: body.id, result: { tools: tools.map(name => ({ name })) } });
  };
  return { fetcher, requests };
};
test('offline inspection does not contact server; public discovery never proves host or account', async () => {
  const m = mock();
  const offline = await checkCloudDiscovery({ fetcher: m.fetcher });
  assert.equal(offline.config, 'valid'); assert.equal(offline.server, 'unverified'); assert.equal(m.requests.length, 0);
  const result = await checkCloudDiscovery({ probe: true, fetcher: m.fetcher });
  assert.deepEqual(result, { config: 'valid', server: 'discovered', modernServer: 'discovered', hostPlugin: 'unverified', conversationTools: 'unverified',
    account: 'unverified' });
  assert.deepEqual(m.requests.map(r => r.body.method), ['initialize', 'notifications/initialized', 'tools/list', 'server/discover', 'tools/list']);
  for (const r of m.requests) {
    assert.equal(r.url, 'https://mcp.oddbout.com/mcp'); assert.equal(r.options.headers.authorization, undefined);
    assert.equal(r.options.redirect, 'error'); assert.equal(r.options.credentials, 'omit');
  }
  assert.equal(m.requests[0].options.headers['mcp-protocol-version'], undefined);
  for (const r of m.requests.slice(1, 3)) assert.equal(r.options.headers['mcp-protocol-version'], '2025-03-26');
  // The 2026-07-28 requests have no session: each names its method in a header and carries the protocol in its _meta.
  for (const r of m.requests.slice(3)) {
    assert.equal(r.options.headers['mcp-protocol-version'], '2026-07-28'); assert.equal(r.options.headers['mcp-method'], r.body.method);
    assert.equal(r.options.headers['mcp-session-id'], undefined);
    assert.equal(r.body.params._meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28');
  }
});
test('a 2026-07-28 failure is reported beside the 2025 result and fails the probe without changing it', async () => {
  const probe = async options => checkCloudDiscovery({ probe: true, fetcher: mock(undefined, options).fetcher });
  assert.equal((await probe({ versions: ['2027-01-01'] })).modernServer, 'version-unsupported');
  for (const [answer, expected] of [[() => new Response('{}', { status: 400 }), 'http-error'], [() => new Response(null, { status: 401 }), 'authentication-required'],
    [() => reply({ wrong: true }), 'malformed-response'], [() => { throw Error('offline'); }, 'network-error']]) {
    const result = await probe({ modern: answer });
    assert.equal(result.server, 'discovered'); assert.equal(result.modernServer, expected);
  }
  const missing = await probe({ modern: body => body.method === 'server/discover' ? reply({ jsonrpc: '2.0', id: body.id, result: { supportedVersions: ['2026-07-28'] } })
    : reply({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'get_profile' }] } }) });
  assert.equal(missing.modernServer, 'required-tools-missing');
  // A 2025 failure never reaches the 2026 step.
  assert.equal((await checkCloudDiscovery({ probe: true, fetcher: mock(['get_profile']).fetcher })).modernServer, 'unverified');
});
test('missing tools, malformed response, 401 and network errors remain distinct', async () => {
  assert.equal((await checkCloudDiscovery({ probe: true, fetcher: mock(['get_profile']).fetcher })).server, 'required-tools-missing');
  assert.equal((await checkCloudDiscovery({ probe: true, fetcher: async () => reply({wrong:true}) })).server, 'malformed-response');
  for (const value of [null, 3, {jsonrpc:'2.0',id:1,result:null}])
    assert.equal((await checkCloudDiscovery({ probe: true, fetcher: async () => reply(value) })).server, 'malformed-response');
  assert.equal((await checkCloudDiscovery({ probe: true, fetcher: async () => new Response(null,{status:401}) })).server, 'authentication-required');
  assert.equal((await checkCloudDiscovery({ probe: true, fetcher: async () => { throw Error('offline'); } })).server, 'network-error');
  assert.equal((await checkCloudDiscovery({ probe: true, fetcher: async () => { throw Error('redirect'); } })).server, 'network-error');
  assert.equal((await checkCloudDiscovery({ probe: true, fetcher: async () => new Response('x',{headers:{'content-length':'1048577'}}) })).server, 'malformed-response');
});
test('each protocol has its own time limit: a slow 2025 step leaves the 2026 one its whole limit', async () => {
  const slow = mock(), fetcher = async (url, options) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 80);
      options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(Error('aborted')); }, { once: true });
    });
    return slow.fetcher(url, options);
  };
  // Three 2025 requests, then two 2026 ones, 80 ms each: 400 ms in all, more than the 300 ms each protocol may take.
  const result = await checkCloudDiscovery({ probe: true, fetcher, timeoutMs: 300 });
  assert.equal(result.server, 'discovered'); assert.equal(result.modernServer, 'discovered');
});
test('untrusted plugin configuration never triggers a request', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cloud-config-'));
  try {
    const config = JSON.parse(await readFile(new URL('../plugins/ai-fighter/mcp.json', import.meta.url), 'utf8'));
    for (const change of [c => { c.mcpServers.oddbout.url = 'https://example.test/mcp'; },
      c => { c.mcpServers.oddbout.headers = { Authorization: 'secret' }; }]) {
      const value = structuredClone(config); change(value); const configPath = path.join(dir, 'mcp.json');
      await writeFile(configPath, JSON.stringify(value)); let called = false;
      const result = await checkCloudDiscovery({probe:true,configPath,fetcher:async()=>{called=true;throw Error('unexpected')}});
      assert.equal(result.config,'invalid'); assert.equal(called,false);
      for (const field of ['hostPlugin','conversationTools','account']) assert.equal(result[field],'unverified');
    }
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('SSE replies and session IDs are supported without exposing them', async () => {
  const seen = [];
  const sse = (data, headers = {}) => new Response(`event: message\ndata: ${JSON.stringify(data)}\n\n`, { headers: {'content-type':'text/event-stream', ...headers} });
  const fetcher = async (_, options) => {
    const body = JSON.parse(options.body); seen.push(options.headers['mcp-session-id']);
    if (body.method === 'initialize') return sse({jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-03-26'}}, {'mcp-session-id':'session-test'});
    if (body.method === 'notifications/initialized') return new Response(null,{status:202});
    if (body.method === 'server/discover') return sse({jsonrpc:'2.0',id:body.id,result:{supportedVersions:['2026-07-28']}});
    return sse({jsonrpc:'2.0',id:body.id,result:{tools:[{name:'get_profile'},{name:'check_creation_readiness'}]}});
  };
  const result = await checkCloudDiscovery({probe:true,fetcher});
  assert.equal(result.server,'discovered'); assert.equal(result.modernServer,'discovered');
  assert.deepEqual(seen,[undefined,'session-test','session-test',undefined,undefined]);
  assert.ok(!JSON.stringify(result).includes('session-test'));
});
