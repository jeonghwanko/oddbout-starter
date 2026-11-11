import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { planCreation } from '../mcp/creation-plan.mjs';
import { preflightCreation } from '../mcp/creation-preflight.mjs';
import { createJobStore } from '../mcp/creation-jobs.mjs';
import { createCreationStore, localPath } from '../mcp/creation-store.mjs';
import { runPlan } from '../scripts/creation-plan.mjs';
import { runPreflight } from '../scripts/creation-preflight.mjs';
import { KIT_BRANCH } from '../mcp/creation-readiness.mjs';

const kitRoot = fileURLToPath(new URL('../', import.meta.url));
const sessionId = 'test-fighter';
const context = {
  owner: 'game',
  contextVersion: 1,
  specVersion: spec.specVersion,
  revision: 'a'.repeat(64),
  contract: { motions: spec.motions },
  controls: { actions: [] },
  timing: { clocks: {} },
  workflow: {
    gates: {},
    groups: [
      { id: 'appearance', motions: ['idle'] },
      { id: 'locomotion', motions: ['fightIdle', 'walk', 'run'] },
      { id: 'attacks', motions: ['combo', 'slam', 'dash'] },
      { id: 'defense', motions: ['block', 'hit', 'groggy', 'fall'], auxiliaries: ['getUp'] },
      { id: 'final', motions: [] },
    ],
  },
};
const request = async () => new Response(JSON.stringify(context));

async function fixture(t) {
  const parent = path.join(kitRoot, 'output');
  await mkdir(parent, { recursive: true });
  const root = await realpath(await mkdtemp(path.join(parent, 'agent-flow-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createCreationStore(root, { contextRequest: request });
  await store.create({ sessionId, brief: 'A white cat boxer. Callback https://example.invalid/cb?token=secret', mode: 'creation' });
  const jobs = createJobStore(store);
  const change = async event => store.change(sessionId, (await store.read(sessionId)).revision, event);
  const put = async (name, bytes = name) => {
    const filename = await localPath(root, name, { createParents: true });
    await writeFile(filename, bytes);
    return name;
  };
  return { root, store, jobs, change, put };
}

test('session summaries redact secrets and stay behind the session record', async t => {
  const { root, store, change } = await fixture(t);
  const brief = await readFile(path.join(root, 'output', sessionId + '-work', 'BRIEF.md'), 'utf8');
  const progress = await readFile(path.join(root, 'output', sessionId + '-work', 'PROGRESS.md'), 'utf8');
  assert.match(brief, /white cat boxer/);
  assert.doesNotMatch(brief, /https:|token=/);
  assert.match(brief, /\[omitted\]/);
  assert.match(progress, /Group: appearance/);
  assert.match(await readFile(path.join(root, 'output', sessionId + '-work', 'creation-session.json'), 'utf8'), /token=secret/);
  await assert.rejects(change({ type: 'memory', route: 'hosted', next: 'open https://example.invalid/callback' }), /memory-secret-refused/);
  await change({
    type: 'memory',
    route: 'hosted',
    accountId: '00000000-0000-4000-8000-00000000d0a1',
    accountEmail: 'owner@example.com',
    hostedJobId: '00000000-0000-4000-8000-000000000010',
    next: 'Read get_hosted_fighter for the saved job.',
  });
  const again = await readFile(path.join(root, 'output', sessionId + '-work', 'BRIEF.md'), 'utf8');
  assert.match(again, /Route: hosted/);
  assert.match(again, /owner@example.com/);
  assert.match(again, /00000000-0000-4000-8000-000000000010/);
  assert.equal((await store.read(sessionId)).memory.route, 'hosted');
});

test('a plan lists open items and does not generate or price them', async t => {
  const { root, store, jobs } = await fixture(t);
  const plan = await planCreation(store, jobs, sessionId);
  assert.equal(plan.startedGeneration, false);
  assert.deepEqual(plan.executed, []);
  assert.equal(plan.cost.known, false);
  assert.deepEqual(
    plan.open.map(item => item.item),
    ['idle'],
  );
  assert.deepEqual(plan.kept, []);
  const cli = await runPlan(['--workspace', root, '--session', sessionId]);
  assert.equal(cli.ok, true);
  assert.equal(cli.startedGeneration, false);
  assert.match(cli.say, /No generation was started/);
  assert.match(cli.next, /preview/i);
});

test('reuse is opt-in and does not replace a selected version or the registration key', async t => {
  const { store, jobs, change, put } = await fixture(t);
  const source = await put(`input/idle-v1.txt`, 'bytes');
  await change({ type: 'version', item: 'idle', version: 'v1', files: [source], note: 'Test bytes, not generated art' });
  await change({ type: 'select', item: 'idle', version: 'v1', feedback: 'Accept this test version' });
  const kept = await put(`output/${sessionId}-work/artifacts/idle/failed.txt`, 'failed-run');
  await change({ type: 'reuse', item: 'idle', files: [kept], note: 'Keep the failed idle frame' });
  assert.equal((await store.read(sessionId)).items.idle.selectedVersion, 'v1');
  const outside = await put('input/other.txt', 'nope');
  await assert.rejects(change({ type: 'reuse', item: 'idle', files: [outside], note: 'Outside the session' }), /reuse-outside-session/);
  const revision = (await store.read(sessionId)).revision;
  const blocked = {
    engine: 'sprite',
    args: ['gen', '--provider', 'codex', '--prompt', 'fixture'],
    workflowArgs: ['workflow', '--kind', 'image', '--image-provider', 'codex', '--confirmed-access', 'codex'],
    groupId: 'appearance',
    targets: [{ item: 'idle', version: 'v2' }],
    inputs: [],
    outputs: [`output/${sessionId}-work/artifacts/idle/v2/image.png`],
  };
  await assert.rejects(jobs.prepare(sessionId, revision, randomUUID(), blocked), /reuse-recorded/);
  await assert.rejects(jobs.prepare(sessionId, revision, randomUUID(), { ...blocked, regenerate: ['walk'] }), /regenerate-not-a-target/);
  const prepared = await jobs.prepare(sessionId, revision, randomUUID(), { ...blocked, regenerate: ['idle'] });
  assert.equal(prepared.status, 'prepared');
  const seen = await jobs.inspect(sessionId, prepared.jobId);
  assert.equal(seen.executedByThisCall, false);
  assert.equal(seen.cancelledByThisCall, false);
  assert.equal(seen.canExecute, true);
  assert.equal((await store.read(sessionId)).items.idle.selectedVersion, 'v1');
  assert.equal((await store.read(sessionId)).idempotencyKey, undefined);
});

test('preflight reports one purpose and does not fetch, elicit or generate', async () => {
  const connection = await runPreflight(['--purpose', 'connection']);
  assert.equal(connection.ok, true);
  assert.equal(connection.startedGeneration, false);
  assert.equal(connection.mutated, false);
  assert.deepEqual(connection.executed, []);
  assert.ok(connection.notDone.includes('generation-engine'));
  assert.equal(connection.checks.find(check => check.id === 'account').status, 'skip');
  const calls = [];
  let elicited = false;
  const git = async args => {
    calls.push(args[0]);
    if (args[0] === 'fetch' || args[0] === 'merge') throw new Error('mutated');
    if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { code: 0, stdout: KIT_BRANCH };
    if (args[0] === 'status') return { code: 0, stdout: '' };
    return { code: 0, stdout: '' };
  };
  const generation = await preflightCreation({
    purpose: 'generation',
    account: 'grok',
    elicitInput: async () => {
      elicited = true;
      return { action: 'accept', content: { account: 'gpt' } };
    },
    kit: {
      installed: { source: true, environment: true },
      git,
      fetchRemote: true,
      inspectEngine: async () => ({ version: 'test', motion: true }),
    },
    tools: {
      inspect: async () => ({ ffmpeg: { status: 'ok' }, ffprobe: { status: 'ok' }, img2webp: { status: 'ok' }, rife: { status: 'ok' } }),
    },
    environment: {
      read: async () => null,
      inspect: async () => ({ status: 'ready', readyForGeneration: false, certifiesGeneration: false }),
    },
  });
  assert.equal(elicited, false);
  assert.equal(calls.includes('fetch'), false);
  assert.equal(calls.includes('merge'), false);
  assert.equal(generation.startedGeneration, false);
  assert.equal(generation.readyForGeneration, false);
  assert.equal(generation.ok, true);
  assert.match(generation.say, /Nothing was installed or generated/);
});
