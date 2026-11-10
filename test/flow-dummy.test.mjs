import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createDummyClient } from '../tools/flow/client.mjs';
import { createDummyMcp } from '../tools/flow/mcp.mjs';
import { checkFixtures } from '../tools/flow/prompts.mjs';
import { formatReport, runFlows } from '../tools/flow/run.mjs';
import { assertDummyBase } from '../tools/flow/seal.mjs';
import { createDummyStore } from '../tools/flow/store.mjs';

test('dummy addresses and prompt fixtures never name a live route', () => {
  assert.throws(() => assertDummyBase('https://oddbout.com'), /dummy-url-refused/);
  assert.throws(() => assertDummyBase('https://abc.supabase.co'), /dummy-url-refused|dummy-url-not-loopback/);
  assert.throws(() => assertDummyBase('http://127.0.0.1/functions/v1/ai-fighter'), /dummy-url-not-loopback/);
  assert.equal(assertDummyBase('http://127.0.0.1:9').hostname, '127.0.0.1');
  assert.equal(checkFixtures().ok, true, checkFixtures().problems.join('; '));
});

test('the dummy MCP answers get_profile as dummy', async () => {
  const server = createDummyMcp(createDummyStore(), { roots: [process.cwd()] });
  const client = new Client({ name: 'dummy-flow-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const listed = await client.listTools();
  assert.ok(listed.tools.some(tool => tool.name === 'request_hosted_fighter' && tool.description.startsWith('DUMMY ONLY')));
  const result = await client.callTool({ name: 'get_profile', arguments: {} });
  const body = /** @type {any} */ (result).structuredContent;
  assert.equal(body.mode, 'dummy');
  assert.equal(body.production, false);
  assert.equal(body.nickname, 'ODDBOUT');
  assert.equal(result.isError, false);
  await client.close();
});

test('createDummyClient does not fetch a refused URL', async () => {
  let fetches = 0;
  await assert.rejects(
    createDummyClient('http://example.supabase.co', {
      fetchImpl: async () => {
        fetches += 1;
        throw new Error('fetched');
      },
    }),
    /dummy-url-refused|dummy-url-not-loopback/,
  );
  assert.equal(fetches, 0);
});

test('the dummy flow covers registration, revision, rejection and delivery', { timeout: 180_000 }, async () => {
  const originalFetch = globalThis.fetch;
  let loopbackRequests = 0;
  const refused = [];
  globalThis.fetch = (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)) {
      refused.push(url.origin);
      throw new Error('flow-test-network-escape');
    }
    loopbackRequests += 1;
    return originalFetch(input, options);
  };
  let result;
  try {
    result = await runFlows();
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(refused, [], 'the complete flow must never attempt an external HTTP request');
  assert.ok(loopbackRequests > 0, 'the integration test must exercise actual loopback HTTP');
  const report = formatReport(result);
  assert.equal(result.ok, true, report);
  assert.match(report, /ODDBOUT-DUMMY/);
  assert.match(report, /result: PASS/);
  assert.match(report, /review-rejected/);
  assert.match(report, /assets-incomplete/);
  assert.match(report, /fighter-quota/);
  assert.match(report, /dummy-package-refused/);
  assert.equal(report.includes('https://'), false);
  assert.equal(report.includes('supabase.co'), false);
  assert.equal(report.includes('oddbout.com'), false);
  assert.equal(result.tokensSpent, 0);
  assert.equal(result.productionContact, false);
  const missing = result.scenarios.find(item => item.id === 'missing-target');
  assert.deepEqual(
    missing.events.filter(event => event.kind === 'agent').map(event => event.tool),
    ['get_profile', 'get_my_fighters'],
  );
  const revision = result.scenarios.find(item => item.id === 'revise');
  assert.equal(revision.events[0].kind, 'setup');
  assert.equal(revision.events.filter(event => event.kind === 'agent' && event.tool === 'fighter:register').length, 1);
  const quota = result.scenarios.find(item => item.id === 'quota');
  assert.deepEqual(
    quota.events.filter(event => event.kind === 'agent').map(event => event.tool),
    ['get_profile', 'get_my_fighters'],
  );
  assert.ok(quota.events.some(event => event.kind === 'probe' && event.title === 'hosted request is fighter-quota' && event.ok));
});
