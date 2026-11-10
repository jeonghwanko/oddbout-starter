import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDummyPackage, readPackageFiles } from '../tools/flow/sprites.mjs';
import { createDummyStore } from '../tools/flow/store.mjs';

let work;
let pack;
const key = number => `aaaaaaaa-aaaa-4aaa-8aaa-${String(number).padStart(12, '0')}`;
const request = (store, number, extra = {}) =>
  store.requestHosted({
    description: 'DUMMY white cat boxer',
    language: 'ko',
    idempotencyKey: key(number),
    ...extra,
  });

before(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'oddbout-hosted-policy-'));
  await createDummyPackage(path.join(work, 'pack'), { name: 'DUMMY Hosted Policy', localId: 'dummy-hosted-policy', prompt: 'hosted policy test fixture' });
  pack = await readPackageFiles(path.join(work, 'pack'));
});
after(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

function createStore(options) {
  const store = createDummyStore(options);
  store.setPlaceholder(pack);
  return store;
}

function finishMotions(store, jobId) {
  let result;
  for (let index = 0; index <= store.motions.length; index++) result = store.getHosted({ jobId });
  return result;
}

function prepare(store, number, text = pack.text, fighterId) {
  const result = store.createSubmission({ text, fighterId, idempotencyKey: key(number) });
  assert.equal(result.status, 200);
  for (const asset of result.body.missingAssets) {
    assert.equal(store.putAsset(result.body.submissionId, asset.id, pack.files.get(asset.id)).status, 200);
  }
  assert.equal(store.submit(result.body.submissionId).status, 200);
  return result.body.submissionId;
}

test('delegation selects a dummy look and reaches registration without chooseLook', () => {
  const store = createStore();
  const requested = request(store, 1, { delegate: true });
  assert.equal(requested.status, 200);
  assert.equal(requested.body.job.choice, 'a');
  assert.equal(requested.body.job.status, 'motions');
  assert.equal(requested.body.statusSummary.actionRequired, 'wait');
  // The timeout-only field must not imply a no-answer timeout occurred.
  assert.equal(requested.body.job.appearanceAutoSelection, null);
  assert.equal(requested.body.job.appearanceAutoSelectAt, null);
  const finished = finishMotions(store, requested.body.job.id);
  assert.equal(finished.body.statusSummary.state, 'registered');
  assert.deepEqual(finished.body.job.drafts, store.motions);
  assert.equal(finished.body.tokensCharged, false);
  const fighter = store.fighter(finished.body.job.submission.fighterId).body.fighter;
  assert.equal(fighter.entered, false);
  assert.equal(fighter.publicPlay, false);
  assert.equal(fighter.submissionIds.length, 1);
});

test('nondelegated look choice and legacy motion registration keep their review behavior', () => {
  const store = createStore();
  const requested = request(store, 1);
  const jobId = requested.body.job.id;
  assert.equal(requested.body.job.status, 'appearance_ready');
  assert.equal(requested.body.job.choice, null);
  assert.equal(requested.body.statusSummary.actionRequired, 'choose_look');
  assert.equal(store.getHosted({ jobId }).body.job.drafts.length, 0);
  assert.equal(store.chooseLook(jobId, 'b').body.job.status, 'motions');
  assert.equal(finishMotions(store, jobId).body.job.choice, 'b');

  for (const delegate of [false, true]) {
    const legacy = createStore({ policy: 'legacy-motion' });
    const created = request(legacy, 1, { delegate });
    const id = created.body.job.id;
    if (!delegate) assert.equal(legacy.chooseLook(id, 'b').status, 200);
    assert.equal(legacy.getHosted({ jobId: id }).body.job.status, 'motion_ready');
    assert.equal(legacy.listFighters().body.account.fighterCount, 0);
    assert.equal(legacy.reviseMotion(id, 'dash', 'Dummy revision note').status, 200);
    assert.equal(legacy.registerHosted(id).body.statusSummary.state, 'registered');
    assert.equal(legacy.registerHosted(id).body.statusSummary.state, 'registered');
    assert.equal(legacy.listFighters().body.account.fighterCount, 1);
  }
});

test('three hosted fighters fill three slots and the fourth request is refused; retries remain idempotent', () => {
  const store = createStore();
  const jobs = [];
  for (let number = 1; number <= 3; number++) {
    const created = request(store, number, { delegate: true });
    assert.equal(created.status, 200);
    jobs.push(created.body.job.id);
    assert.equal(finishMotions(store, created.body.job.id).body.statusSummary.state, 'registered');
  }
  const refused = request(store, 4, { delegate: true });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'fighter-quota');
  assert.equal(refused.body.account.fighterCount, 3);
  assert.equal(refused.body.tokensCharged, false);
  assert.equal(store.getHosted({ idempotencyKey: key(4) }).status, 404);
  store.setTokenBalance(0);
  for (let number = 1; number <= 3; number++) {
    const retried = request(store, number, { delegate: true });
    assert.equal(retried.status, 200);
    assert.equal(retried.body.job.id, jobs[number - 1]);
    assert.equal(retried.body.statusSummary.state, 'registered');
    assert.equal(store.registerHosted(jobs[number - 1]).status, 200);
  }
  const listed = store.listFighters().body;
  assert.equal(listed.account.fighterCount, 3);
  assert.equal(listed.notifications.filter(event => event.kind === 'submission-registered').length, 3);
  assert.equal(store.getHosted({}).body.jobs.length, 3);
});

test('concurrent admitted jobs recheck final capacity and retry preserved motions without phantom submissions', () => {
  const store = createStore({ fighterLimit: 1 });
  const first = request(store, 1, { delegate: true }).body.job.id;
  const second = request(store, 2, { delegate: true }).body.job.id;
  const registered = finishMotions(store, first);
  assert.equal(registered.body.statusSummary.state, 'registered');
  const blocked = finishMotions(store, second);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'fighter-quota');
  assert.equal(blocked.body.job.status, 'needs_review');
  assert.equal(blocked.body.job.errorCode, 'fighter-quota');
  assert.equal(blocked.body.job.registrationBlocked, true);
  assert.equal(blocked.body.job.submission, null);
  assert.equal(blocked.body.statusSummary.completed, false);
  assert.equal(blocked.body.statusSummary.terminal, false);
  assert.equal(blocked.body.statusSummary.actionRequired, 'retry_registration');
  assert.deepEqual(blocked.body.job.drafts, store.motions);
  assert.equal(store.registerHosted(second).body.job.submission, null);
  const read = store.getHosted({ jobId: second });
  assert.equal(read.body.job.status, 'needs_review');
  assert.deepEqual(read.body.job.drafts, blocked.body.job.drafts);
  assert.equal(request(store, 2, { delegate: true }).body.job.id, second);
  const listed = store.listFighters().body;
  assert.equal(listed.account.fighterCount, 1);
  assert.equal(listed.notifications.filter(event => event.kind === 'submission-registered').length, 1);
  assert.equal(listed.notifications.filter(event => event.kind === 'hosted-registration-blocked').length, 1);

  store.setFighterLimit(2);
  // Reads do not retry operator-review work or re-run its completed motion stage.
  assert.equal(store.getHosted({ jobId: second }).body.job.status, 'needs_review');
  const recovered = store.registerHosted(second);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.statusSummary.state, 'registered');
  assert.deepEqual(recovered.body.job.drafts, store.motions);
  assert.equal(recovered.body.job.choice, 'a');
  assert.equal(recovered.body.job.errorCode, null);
  assert.equal(recovered.body.job.registrationBlocked, false);
  assert.equal(store.registerHosted(second).body.job.submission.id, recovered.body.job.submission.id);
  assert.equal(request(store, 2, { delegate: true }).body.job.submission.id, recovered.body.job.submission.id);
  const after = store.listFighters().body;
  assert.equal(after.account.fighterCount, 2);
  assert.equal(after.notifications.filter(event => event.kind === 'submission-registered').length, 1);
  assert.equal(after.fighters.find(fighter => fighter.id === recovered.body.job.submission.fighterId).submissionIds.length, 1);
});

test('normal registration also checks final capacity, preserves uploads for retry and allows revisions at capacity', () => {
  const store = createStore({ fighterLimit: 1 });
  const pending = prepare(store, 1);
  const competitor = request(store, 2, { delegate: true }).body.job.id;
  const current = finishMotions(store, competitor).body.job.submission.fighterId;
  const blocked = store.getSubmission(pending).body;
  assert.equal(blocked.stage, 'validating');
  assert.equal(blocked.code, 'fighter-quota');
  assert.equal(blocked.fighterId, null);
  assert.equal(blocked.missingAssets.length, 0);
  assert.deepEqual(blocked.pending, ['registration']);
  assert.equal(store.createSubmission({ text: pack.text, idempotencyKey: key(1) }).body.submissionId, pending);
  assert.equal(store.listFighters().body.account.fighterCount, 1);

  const revised = JSON.parse(pack.text);
  revised.profile.name = 'DUMMY Hosted Policy Revised';
  const revisionId = prepare(store, 3, JSON.stringify(revised), current);
  const revision = store.getSubmission(revisionId).body;
  assert.equal(revision.stage, 'registered');
  assert.equal(revision.fighterId, current);
  assert.equal(store.listFighters().body.account.fighterCount, 1);

  store.setFighterLimit(2);
  const recovered = store.getSubmission(pending).body;
  assert.equal(recovered.stage, 'registered');
  assert.equal(recovered.submissionId, pending);
  assert.equal(recovered.code, undefined);
  assert.equal(recovered.reason, undefined);
  assert.equal(store.getSubmission(pending).body.fighterId, recovered.fighterId);
  assert.equal(store.listFighters().body.account.fighterCount, 2);
});
