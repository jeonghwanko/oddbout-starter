import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';
import { registerAgentTools } from '../mcp/cloud/agent-tools.mjs';
import { registerHostedTools } from '../mcp/cloud/hosted-tools.mjs';
import { registerProfileSetTools } from '../mcp/cloud/profile-set-tools.mjs';
import { createConnector, DUMMY_TOOLS } from '../tools/flow/connector.mjs';
import { createDummyProfileSet, readPackageFiles } from '../tools/flow/sprites.mjs';
import { createDummyStore } from '../tools/flow/store.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// Capture the live tool declarations without executing any tool handler or supplying a network client.
function liveShapes() {
  const shapes = new Map();
  const register = (name, _title, _description, shape) => shapes.set(name, z.object(shape));
  const unavailable = () => {
    throw new Error('live-call-forbidden');
  };
  const options = { register, db: {}, identity: null, invoke: unavailable, fetcher: unavailable, recordAgent: unavailable };
  registerHostedTools({ ...options, hosted: {} });
  registerProfileSetTools(options);
  registerAgentTools({ ...options, arena: {}, caller: null });
  return shapes;
}

function dummyShape(name) {
  return z.object(DUMMY_TOOLS.find(tool => tool.name === name).shape);
}

test('dummy non-file arguments preserve the actual cloud tool field names and required values', () => {
  const live = liveShapes();
  const fighterId = randomUUID(),
    jobId = randomUUID(),
    profileSetId = randomUUID(),
    idempotencyKey = randomUUID();
  for (const [dummyName, liveName, selector, input] of [
    ['request_hosted_fighter', 'choose_hosted_look', { step: 'choose_look' }, { jobId, choose: 'a' }],
    ['request_hosted_fighter', 'revise_hosted_motion', { step: 'revise_motion' }, { jobId, clip: 'walk', note: 'slower' }],
    ['submit_fighter_registration', 'submit_profile_set', { kind: 'profile_set' }, { profileSetId }],
    ['get_my_fighters', 'get_profile_set', { view: 'profile_set' }, { profileSetId }],
    ['update_fighter', 'update_fighter_style', { kind: 'style' }, { fighterId, style: null, idempotencyKey }],
    ['enter_fighter', 'enter_fighter', {}, { fighterId, expectedManifestSha256: 'a'.repeat(64), reviewedClips: createDummyStore().motions }],
  ]) {
    const checked = live.get(liveName).parse(input);
    assert.deepEqual(dummyShape(dummyName).parse({ ...selector, ...checked }), { ...selector, ...checked });
  }
  assert.equal(dummyShape('update_fighter').safeParse({ kind: 'style', fighterId, style: {} }).success, false);
  assert.equal(dummyShape('enter_fighter').safeParse({ fighterId }).success, false);
});

test('the shipped stdio MCP completes hosted creation using real choose_look arguments', { timeout: 60_000 }, async t => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, 'scripts/flow-mcp.mjs')],
    cwd: ROOT,
    env: {},
    stderr: 'pipe',
  });
  const client = new Client({ name: 'flow-contract-test', version: '1' });
  t.after(() => client.close());
  await client.connect(transport);
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.equal(result.structuredContent.production, false);
    return result.structuredContent;
  };
  const requested = await call('request_hosted_fighter', {
    description: 'a teal geometric boxer',
    language: 'en',
    idempotencyKey: randomUUID(),
  });
  await call('request_hosted_fighter', { step: 'choose_look', jobId: requested.job.id, choose: 'a' });
  let current;
  for (let i = 0; i < 12; i++) current = await call('get_hosted_fighter', { jobId: requested.job.id });
  assert.equal(current.statusSummary.completed, true);
  assert.equal(current.job.submission.stage, 'registered');
  const again = await call('get_hosted_fighter', { jobId: requested.job.id });
  assert.equal(again.job.submission.id, current.job.submission.id);
  assert.equal((await call('get_my_fighters', { view: 'list' })).fighters.length, 1);
});

async function registerPack(store, pack, target) {
  const prepared = store.createSubmission({ text: pack.text, fighterId: target, idempotencyKey: randomUUID() }).body;
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  for (const asset of prepared.missingAssets) assert.equal(store.putAsset(prepared.submissionId, asset.id, pack.files.get(asset.id)).body.ok, true);
  assert.equal(store.submit(prepared.submissionId).body.stage, 'validating');
  return store.getSubmission(prepared.submissionId).body;
}

test('submission retry keys bind both package bytes and revision target', async () => {
  const pack = await readPackageFiles(path.join(ROOT, 'examples/sparring-bot'));
  const store = createDummyStore({ seed: true });
  const fighterId = store.listFighters().body.fighters[0].id;
  const key = randomUUID();
  const original = store.createSubmission({ text: pack.text, idempotencyKey: key }).body;
  const retry = store.createSubmission({ text: pack.text, idempotencyKey: key }).body;
  assert.equal(retry.submissionId, original.submissionId);
  assert.equal(store.createSubmission({ text: pack.text, fighterId, idempotencyKey: key }).body.code, 'idempotency-conflict');
});

test('profile-set ids and asset roles survive custom filenames and immutable retries', async t => {
  const work = await mkdtemp(path.join(tmpdir(), 'oddbout-flow-contract-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const pack = await readPackageFiles(path.join(ROOT, 'examples/sparring-bot'));
  const store = createDummyStore();
  const registered = await registerPack(store, pack);
  const profile = await createDummyProfileSet(path.join(work, 'profile'));
  assert.equal(profile.ok, true, JSON.stringify(profile));
  const data = JSON.parse(await readFile(path.join(profile.folder, 'profile-set.json'), 'utf8'));
  data.front.path = 'chosen-front.webp';
  data.expressions.path = 'arena-faces.webp';
  const key = randomUUID(),
    text = JSON.stringify(data);
  const prepared = store.prepareProfileSet(registered.fighterId, text, key).body;
  assert.deepEqual(
    prepared.missingAssets.map(asset => asset.id),
    ['front', 'expressions'],
  );
  assert.equal(store.prepareProfileSet(registered.fighterId, text, key).body.profileSetId, prepared.profileSetId);
  assert.equal(store.prepareProfileSet(registered.fighterId, text + '\n', key).body.code, 'idempotency-conflict');
  for (const assetId of ['front', 'expressions']) {
    const bytes = await readFile(path.join(profile.folder, `${assetId}.webp`));
    assert.equal(store.uploadProfileAsset(prepared.profileSetId, assetId, bytes).body.ok, true);
  }
  assert.equal(store.submitProfileSet(prepared.profileSetId).body.front.ok, true);
  const connector = createConnector(store, { roots: [work] });
  assert.equal((await connector.call('get_my_fighters', { view: 'profile_set', profileSetId: prepared.profileSetId })).stage, 'ready');
  assert.equal(store.profileSet(prepared.profileSetId).body.profileSetId, prepared.profileSetId);
  assert.equal(store.submitProfileSet(prepared.profileSetId).body.stage, 'ready');
  assert.equal(store.uploadProfileAsset(prepared.profileSetId, 'front', Buffer.from('x')).body.code, 'upload-closed');

  assert.equal(store.enter(registered.fighterId, {}).body.code, 'invalid-entry');
  const review = { expectedManifestSha256: registered.manifestSha256, reviewedClips: store.motions };
  assert.equal(store.enter(registered.fighterId, { ...review, expectedManifestSha256: 'f'.repeat(64) }).body.code, 'fighter-changed');
  assert.equal(store.enter(registered.fighterId, { ...review, reviewedClips: store.motions.slice(1) }).body.code, 'invalid-entry');
  assert.equal(store.enter(registered.fighterId, review).body.entered, true);
  assert.equal(store.updateStyle(registered.fighterId, { super: 'dash' }, randomUUID()).body.ok, true);
  await registerPack(store, { ...pack, text: pack.text + '\n' }, registered.fighterId);
  assert.equal(store.fighter(registered.fighterId).body.fighter.entered, false);
  assert.equal(store.fighter(registered.fighterId).body.fighter.style, null);
  assert.equal(store.getSubmission(registered.submissionId).body.stage, 'registered');
});

test('style edits use the contract schema, allow removal, and bind retry keys', () => {
  const store = createDummyStore({ seed: true });
  const fighterId = store.listFighters().body.fighters[0].id;
  assert.equal(store.updateStyle(fighterId, { super: 'dash' }, randomUUID()).body.ok, true);
  assert.equal(store.updateStyle(fighterId, { mix: { slam: 0, combo: 0, fast: 1 } }, randomUUID()).body.code, 'invalid-style');
  assert.equal(store.updateStyle(fighterId, { mix: { slam: 1, combo: 0, fast: 0 }, skill: 'flight' }, randomUUID()).body.code, 'invalid-style');
  assert.equal(store.updateStyle(fighterId, { exchanges: { cross: 4 } }, randomUUID()).body.code, 'invalid-style');
  const key = randomUUID();
  const removed = store.updateStyle(fighterId, null, key).body;
  assert.equal(removed.ok, true);
  assert.equal(store.updateStyle(fighterId, null, key).body.event.id, removed.event.id);
  assert.equal(store.updateStyle(fighterId, { super: 'slam' }, key).body.code, 'idempotency-conflict');
  assert.equal(store.fighter(fighterId).body.fighter.style, null);
});
