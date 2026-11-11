import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { prepareDummyFixture } from '../tools/flow/fixtures.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

test('fixtures prepare valid registrations before the agent receives a prompt', async () => {
  for (const [fixture, count] of [
    ['empty', 0],
    ['registered', 1],
    ['quota', 3],
  ]) {
    const { store, setup } = await prepareDummyFixture(fixture);
    const listed = store.listFighters().body;
    assert.equal(setup.phase, 'setup');
    assert.equal(setup.production, false);
    assert.equal(setup.fixture, fixture);
    assert.equal(listed.account.fighterCount, count);
    assert.equal(listed.account.fighterLimit, 3);
    assert.equal(setup.fighters.length, count);
    for (const fighter of listed.fighters) {
      assert.match(fighter.name, /^DUMMY /);
      assert.match(fighter.manifestSha256, /^[a-f0-9]{64}$/);
      const registered = store.getSubmission(fighter.submissionIds[0]).body;
      assert.equal(registered.stage, 'registered');
      assert.equal(registered.fighterId, fighter.id);
    }
  }
  await assert.rejects(prepareDummyFixture('unknown'), /unknown-dummy-fixture/);
});

test('stdio quota preset is ready before the first tool call and cannot be changed by agent tools', { timeout: 60_000 }, async t => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, 'scripts/flow-mcp.mjs'), '--fixture', 'quota'],
    cwd: ROOT,
    env: {},
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', chunk => {
    stderr += chunk.toString();
  });
  const client = new Client({ name: 'fixture-contract-test', version: '1' });
  t.after(() => client.close());
  await client.connect(transport);
  const list = await client.callTool({ name: 'get_my_fighters', arguments: { view: 'list' } });
  assert.equal(list.structuredContent.account.fighterCount, 3);
  assert.equal(list.structuredContent.quota.exceeded, true);
  const denied = await client.callTool({
    name: 'request_hosted_fighter',
    arguments: {
      description: 'A fourth geometric fighter',
      language: 'en',
      delegate: true,
      idempotencyKey: randomUUID(),
      confirmed: true,
    },
  });
  assert.equal(denied.isError, true);
  assert.equal(denied.structuredContent.code, 'fighter-quota');
  assert.equal(denied.structuredContent.production, false);
  const tools = await client.listTools();
  assert.equal(
    tools.tools.some(tool => /fixture|set.*limit|set.*balance/i.test(tool.name)),
    false,
  );
  const setup = stderr
    .split('\n')
    .filter(line => line.startsWith('{'))
    .map(line => JSON.parse(line))
    .find(body => body.phase === 'setup');
  assert.equal(setup.fixture, 'quota');
  assert.equal(setup.account.fighterCount, 3);
});
