import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import Ajv from 'ajv';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { runRegister } from '../scripts/register-fighter.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

async function session(t, fixture = 'registered') {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, 'scripts/flow-mcp.mjs'), '--fixture', fixture],
    cwd: ROOT,
    env: {},
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', chunk => {
    stderr += chunk;
  });
  const client = new Client({ name: 'flow-session-test', version: '1' });
  t.after(() => client.close());
  await client.connect(transport);
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.equal(result.structuredContent.mode, 'dummy');
    assert.equal(result.structuredContent.production, false);
    return result.structuredContent;
  };
  return {
    client,
    call,
    setup: () =>
      stderr
        .split('\n')
        .filter(line => line.startsWith('{'))
        .map(line => JSON.parse(line))
        .find(item => item.phase === 'setup'),
  };
}

test('one stdio session builds revisions and shares their immutable history with the registration CLI', { timeout: 60_000 }, async t => {
  const { client, call, setup } = await session(t);
  const profile = await call('get_profile');
  assert.match(profile.dummyRegistrationUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(profile.dummyRegistrationUrl, setup().dummyRegistrationUrl);
  const initial = await call('get_my_fighters', { view: 'list' });
  const fighter = initial.fighters[0];
  const original = await call('get_my_fighters', { view: 'submission', submissionId: fighter.submissionIds[0] });
  const missing = await client.callTool({ name: 'create_dummy_package', arguments: { fighterId: randomUUID() } });
  assert.equal(missing.isError, true);
  assert.equal(missing.structuredContent.code, 'fighter-not-found');
  assert.equal((await call('get_my_fighters', { view: 'list' })).fighters.length, 1);
  const built = await call('create_dummy_package', {
    fighterId: fighter.id,
    name: '야근왕 박과장 v2',
    language: 'ko',
    style: { super: 'dash' },
    moves: { dash: { name: '노래방 각성', description: '노래방 각성기로 지정한 돌진' } },
  });
  assert.equal(built.operation, 'revision');
  assert.equal(built.submissionCreated, false);
  assert.equal(JSON.parse(await readFile(built.manifestPath, 'utf8')).profile.moves.dash.name, '노래방 각성');
  const prepared = await call('prepare_fighter_registration', {
    kind: 'package',
    fighterId: fighter.id,
    manifestPath: built.manifestPath,
    idempotencyKey: randomUUID(),
  });
  for (const asset of prepared.missingAssets) {
    await call('upload_fighter_asset', { kind: 'package', submissionId: prepared.submissionId, assetId: asset.id, filePath: path.join(built.dir, asset.path) });
  }
  await call('submit_fighter_registration', { kind: 'package', submissionId: prepared.submissionId });
  const second = await call('get_my_fighters', { view: 'submission', submissionId: prepared.submissionId });
  assert.equal(second.stage, 'registered');
  assert.equal(second.fighterId, fighter.id);

  const thirdPack = await call('create_dummy_package', {
    fighterId: fighter.id,
    name: '야근왕 박과장 v3',
    language: 'ko',
    style: { super: 'slam', temper: { patience: 5 } },
  });
  assert.notEqual(thirdPack.dir, built.dir);
  let liveCalls = 0;
  const cli = await runRegister({
    argv: ['--dir', thirdPack.dir, '--fighter', fighter.id, '--dummy', profile.dummyRegistrationUrl, '--submit'],
    env: {},
    wait: async () => {},
    connect: async () => {
      liveCalls++;
      throw new Error('live-connect-forbidden');
    },
  });
  assert.equal(cli.ok, true, JSON.stringify(cli));
  assert.equal(cli.fighterId, fighter.id);
  assert.equal(liveCalls, 0);
  const final = (await call('get_my_fighters', { view: 'fighter', fighterId: fighter.id })).fighter;
  assert.equal(final.submissionIds.length, 3);
  assert.deepEqual(final.style, { super: 'slam', temper: { patience: 5 } });
  assert.equal((await call('get_my_fighters', { view: 'submission', submissionId: original.submissionId })).manifestSha256, original.manifestSha256);
  assert.equal((await call('get_my_fighters', { view: 'submission', submissionId: second.submissionId })).manifestSha256, second.manifestSha256);
  await client.close();
  await assert.rejects(access(setup().packageRoot));
  await assert.rejects(fetch(`${profile.dummyRegistrationUrl}/dummy/health`));
});

test('advertised schemas and runtime both require creation keys, but not existing look choices', { timeout: 30_000 }, async t => {
  const { client, call } = await session(t, 'empty');
  const listed = await client.listTools();
  const schema = name => {
    const copy = structuredClone(listed.tools.find(tool => tool.name === name).inputSchema);
    delete copy.$schema;
    return new Ajv({ allErrors: true }).compile(copy);
  };
  const prepare = schema('prepare_fighter_registration');
  assert.equal(prepare({ manifestPath: '/unused' }), false);
  assert.equal(prepare({ manifestPath: '/unused', idempotencyKey: randomUUID() }), true);
  const hosted = schema('request_hosted_fighter');
  const request = { description: '흰 고양이 복서', language: 'ko' };
  assert.equal(hosted(request), false);
  assert.equal(hosted({ ...request, idempotencyKey: randomUUID() }), true);
  assert.equal(hosted({ ...request, description: 'abc', idempotencyKey: randomUUID() }), false);
  assert.equal(hosted({ ...request, description: 'a'.repeat(601), idempotencyKey: randomUUID() }), false);
  assert.equal(hosted({ step: 'choose_look', jobId: randomUUID(), choose: 'a' }), true);
  for (const [name, args] of [
    ['prepare_fighter_registration', { manifestPath: '/unused' }],
    ['request_hosted_fighter', request],
  ]) {
    assert.equal((await client.callTool({ name, arguments: args })).isError, true);
  }
  assert.equal((await call('get_hosted_fighter')).jobs.length, 0);
  const created = await call('request_hosted_fighter', { ...request, idempotencyKey: randomUUID() });
  await call('request_hosted_fighter', { step: 'choose_look', jobId: created.job.id, choose: 'a' });
  const finished = await call('get_hosted_fighter', { jobId: created.job.id, waitSeconds: 5 });
  assert.equal(finished.statusSummary.completed, true);
  assert.ok(finished.waitedMs > 0);
  const fighter = (await call('get_my_fighters', { view: 'fighter', fighterId: finished.job.submission.fighterId })).fighter;
  assert.equal(fighter.name, 'DUMMY 흰 고양이 복서');
  assert.equal(fighter.front.ok, true);
  assert.equal(fighter.front.expressions, true);
  assert.equal(fighter.front.operatorApproved, false);
});

test('stdio EOF releases the HTTP listener and removes only the private package directory', { timeout: 30_000 }, async t => {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/flow-mcp.mjs')], { cwd: ROOT, env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  let stderr = '';
  let setup;
  for await (const chunk of child.stderr) {
    stderr += chunk;
    setup = stderr
      .split('\n')
      .filter(line => line.startsWith('{'))
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .find(item => item?.phase === 'setup');
    if (setup) break;
  }
  assert.ok(setup);
  assert.equal((await fetch(`${setup.dummyRegistrationUrl}/dummy/health`)).status, 200);
  const socket = createConnection({ host: '127.0.0.1', port: Number(new URL(setup.dummyRegistrationUrl).port) });
  socket.on('error', () => {});
  t.after(() => socket.destroy());
  await once(socket, 'connect');
  socket.write('POST /submissions HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 1000\r\n\r\nx');
  const exited = once(child, 'exit');
  child.stdin.end();
  assert.deepEqual(await exited, [0, null]);
  await assert.rejects(access(setup.packageRoot));
  await assert.rejects(fetch(`${setup.dummyRegistrationUrl}/dummy/health`));
  assert.ok((await readFile(path.join(ROOT, 'AGENTS.md'))).length > 0);
});
