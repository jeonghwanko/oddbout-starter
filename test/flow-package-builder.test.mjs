import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateFighter } from '../contracts/ai-fighter/validate.mjs';
import { runRegister } from '../scripts/register-fighter.mjs';
import { validateFighterPackage } from '../server/ai-fighter-package.mjs';
import { prepareDummyFixture } from '../tools/flow/fixtures.mjs';
import { buildDummyPackage } from '../tools/flow/package-builder.mjs';
import { DUMMY_SEAL, DUMMY_SIDECAR, manifestSealed } from '../tools/flow/seal.mjs';
import { createDummyStore } from '../tools/flow/store.mjs';

const STYLE = { mix: { slam: 3, combo: 2, fast: 1 }, special: 'slam', super: 'dash', distance: 2, temper: { patience: 5 } };

async function packageRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'flow-package-builder-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function assertStamped(result) {
  assert.equal(result.mode, 'dummy');
  assert.equal(result.service, 'oddbout-dummy');
  assert.equal(result.production, false);
  assert.match(result.label, /ODDBOUT-DUMMY/);
  assert.equal(result.phase, 'agent');
  assert.equal(result.submissionCreated, false);
  assert.equal(result.fighterChanged, false);
}

test('revision package preserves its registered target and becomes a new immutable submission only when submitted', async t => {
  const root = await packageRoot(t);
  const { store } = await prepareDummyFixture('registered');
  const before = structuredClone(store.listFighters().body.fighters[0]);
  const previous = structuredClone(store.getSubmission(before.submissionIds[0]).body);
  const made = await buildDummyPackage(store, root, { fighterId: before.id, language: 'ko', style: STYLE });
  assertStamped(made);
  assert.equal(made.ok, true, JSON.stringify(made));
  assert.equal(made.operation, 'revision');
  assert.equal(made.fighterId, before.id);
  assert.deepEqual(store.fighter(before.id).body.fighter, before, 'building files must not update the target');
  const text = await readFile(made.manifestPath, 'utf8');
  const data = JSON.parse(text);
  assert.equal(data.profile.name, before.name, 'a revision defaults to the verified target name');
  assert.equal(data.profile.language, 'ko');
  assert.deepEqual(data.combat.style, STYLE);
  assert.equal(validateFighter(data).ok, true);
  assert.equal((await validateFighterPackage(made.manifestPath)).ok, true);
  assert.equal(made.manifestSha256, createHash('sha256').update(text).digest('hex'));
  const prepared = store.createSubmission({ text, fighterId: made.fighterId, idempotencyKey: randomUUID() }).body;
  assert.equal(prepared.ok, true);
  assert.equal(prepared.missingAssets.length, 11);
  for (const asset of prepared.missingAssets) {
    const file = made.assets.find(candidate => candidate.id === asset.id);
    assert.ok(file);
    assert.equal(store.putAsset(prepared.submissionId, asset.id, await readFile(file.filePath)).body.ok, true);
  }
  store.submit(prepared.submissionId);
  const registered = store.getSubmission(prepared.submissionId).body;
  assert.equal(registered.stage, 'registered');
  assert.equal(registered.fighterId, before.id);
  assert.notEqual(registered.submissionId, previous.submissionId);
  assert.deepEqual(store.getSubmission(previous.submissionId).body, previous, 'the previous submission stays unchanged');
  const after = store.listFighters().body;
  assert.equal(after.account.fighterCount, 1);
  assert.deepEqual(after.fighters[0].submissionIds, [...before.submissionIds, prepared.submissionId]);
  assert.equal(after.fighters[0].style.super, 'dash');
  assert.equal(after.fighters[0].publicPlay, false);
});

test('missing revision target creates no files or substitute and remains a stamped agent failure', async t => {
  const root = await packageRoot(t);
  const store = createDummyStore();
  const result = await buildDummyPackage(store, root, { fighterId: randomUUID(), name: 'Replacement must not exist' });
  assertStamped(result);
  assert.equal(result.ok, false);
  assert.equal(result.operation, 'revision');
  assert.equal(result.code, 'fighter-not-found');
  assert.deepEqual(await readdir(root), []);
  assert.equal(store.listFighters().body.account.fighterCount, 0);
  assert.equal(store.getHosted({}).body.jobs.length, 0);
  assert.equal('manifestPath' in result, false);
});

test('each package uses fresh private paths and preserves earlier package bytes', async t => {
  const root = await packageRoot(t);
  const store = createDummyStore();
  const input = { name: '../Folder/Flow Bot', description: 'x'.repeat(2000) };
  const first = await buildDummyPackage(store, root, input);
  assert.equal(first.ok, true, JSON.stringify(first));
  const original = await readFile(first.manifestPath);
  const second = await buildDummyPackage(store, root, input);
  assert.equal(second.ok, true, JSON.stringify(second));
  assertStamped(second);
  assert.equal(second.operation, 'new');
  assert.notEqual(second.dir, first.dir);
  assert.deepEqual(await readFile(first.manifestPath), original);
  assert.equal(path.basename(first.manifestPath), 'fighter.json');
  assert.equal(path.dirname(path.dirname(first.dir)), root);
  assert.match(path.basename(path.dirname(first.dir)), /^package-/);
  for (const made of [first, second]) {
    const data = JSON.parse(await readFile(made.manifestPath, 'utf8'));
    assert.match(data.profile.name, /^DUMMY /);
    assert.ok(data.profile.description.length <= 600);
    assert.match(data.profile.description, /ODDBOUT-DUMMY/);
    assert.match(data.localId, /^dummy-/);
    assert.equal(made.assets.length, 11);
    for (const asset of made.assets) assert.ok(asset.filePath.startsWith(made.dir + path.sep));
  }
  assert.equal(store.listFighters().body.account.fighterCount, 0);
});

test('builder preserves all dummy seals and live registration refuses before connecting', async t => {
  const root = await packageRoot(t);
  const made = await buildDummyPackage(createDummyStore(), root, {});
  assert.equal(made.ok, true, JSON.stringify(made));
  const data = JSON.parse(await readFile(made.manifestPath, 'utf8'));
  assert.equal(manifestSealed(data), true);
  const sidecar = JSON.parse(await readFile(path.join(made.dir, DUMMY_SIDECAR), 'utf8'));
  assert.equal(sidecar.seal, DUMMY_SEAL);
  assert.equal(sidecar.notForProduction, true);
  let connects = 0;
  const refused = await runRegister({
    argv: ['--dir', made.dir, '--submit'],
    env: {},
    connect: async () => {
      connects++;
      throw new Error('live-connect-forbidden');
    },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'dummy-package-refused');
  assert.equal(refused.production, false);
  assert.equal(connects, 0);
});

test('invalid styles fail contract validation and never mutate the roster', async t => {
  const root = await packageRoot(t);
  const store = createDummyStore();
  for (const style of [{ super: 'invented' }, { mix: { slam: 0, combo: 0, fast: 0 } }, { temper: { patience: 6 } }]) {
    const result = await buildDummyPackage(store, root, { style });
    assertStamped(result);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid-style');
    assert.ok(result.errors.length > 0);
    assert.equal('manifestPath' in result, false);
    const failed = JSON.parse(await readFile(path.join(result.dir, 'fighter.json'), 'utf8'));
    assert.deepEqual(failed.combat.style, style);
    assert.equal(validateFighter(failed).ok, false, 'failed attempts must not leave a valid package with a substitute style');
  }
  assert.equal(store.listFighters().body.account.fighterCount, 0);
  const validNull = await buildDummyPackage(store, root, { style: null });
  assert.equal(validNull.ok, true);
  assert.equal(JSON.parse(await readFile(validNull.manifestPath, 'utf8')).combat.style, undefined);
});
