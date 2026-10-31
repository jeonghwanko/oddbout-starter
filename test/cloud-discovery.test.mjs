import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkCloudDiscovery } from '../scripts/check-cloud-discovery.mjs';

const reply = value => Response.json(value);
const mock = (tools = ['get_profile', 'check_creation_readiness']) => {
  const requests = [];
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body); requests.push({ url, options, body });
    if (body.method === 'initialize') return reply({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } });
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    return reply({ jsonrpc: '2.0', id: 2, result: { tools: tools.map(name => ({ name })) } });
  };
  return { fetcher, requests };
};
test('offline inspection does not contact server; public discovery never proves host or account', async () => {
  const m = mock();
  const offline = await checkCloudDiscovery({ fetcher: m.fetcher });
  assert.equal(offline.config, 'valid'); assert.equal(offline.server, 'unverified'); assert.equal(m.requests.length, 0);
  const result = await checkCloudDiscovery({ probe: true, fetcher: m.fetcher });
  assert.deepEqual(result, { config: 'valid', server: 'discovered', hostPlugin: 'unverified', conversationTools: 'unverified', account: 'unverified' });
  assert.deepEqual(m.requests.map(r => r.body.method), ['initialize', 'notifications/initialized', 'tools/list']);
  for (const r of m.requests) {
    assert.equal(r.url, 'https://mcp.oddbout.com/mcp'); assert.equal(r.options.headers.authorization, undefined);
    assert.equal(r.options.redirect, 'error'); assert.equal(r.options.credentials, 'omit');
  }
  assert.equal(m.requests[0].options.headers['mcp-protocol-version'], undefined);
  for (const r of m.requests.slice(1)) assert.equal(r.options.headers['mcp-protocol-version'], '2025-03-26');
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
    return sse({jsonrpc:'2.0',id:2,result:{tools:[{name:'get_profile'},{name:'check_creation_readiness'}]}});
  };
  const result = await checkCloudDiscovery({probe:true,fetcher});
  assert.equal(result.server,'discovered'); assert.deepEqual(seen,[undefined,'session-test','session-test']);
  assert.ok(!JSON.stringify(result).includes('session-test'));
});
