import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { parseProfileSet } from '../api/profile-set-contract.mjs';
import { prepareDummyFixture } from '../tools/flow/fixtures.mjs';
import { createDummyPackage, createDummyProfileSet, readPackageFiles, readProfileSetFiles } from '../tools/flow/sprites.mjs';
import { createDummyStore } from '../tools/flow/store.mjs';

let work;
let pack;
let profilePack;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const request = (store, extra = {}) =>
  store.requestHosted({
    description: '흰 고양이 복서',
    language: 'ko',
    delegate: true,
    idempotencyKey: randomUUID(),
    ...extra,
  });
const createStore = options => {
  const store = createDummyStore(options);
  store.setPlaceholder(pack, profilePack);
  return store;
};

before(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'oddbout-hosted-runtime-'));
  const made = await createDummyPackage(path.join(work, 'pack'), {
    name: 'DUMMY Generic Template',
    localId: 'dummy-template',
    prompt: 'generic geometric fixture',
  });
  pack = await readPackageFiles(made.dir);
  const profile = await createDummyProfileSet(path.join(work, 'profile'));
  assert.equal(profile.ok, true);
  profilePack = await readProfileSetFiles(profile.folder);
});
after(async () => {
  if (work) await rm(work, { recursive: true, force: true });
});

test('a five-second hosted wait completes eleven motions and registration in one measured call', async () => {
  const store = createStore();
  const key = randomUUID();
  const created = request(store, { idempotencyKey: key });
  const start = performance.now();
  const result = await store.waitHosted({ idempotencyKey: key, waitSeconds: 5 });
  const elapsed = performance.now() - start;
  assert.equal(result.status, 200);
  assert.equal(result.body.statusSummary.completed, true);
  assert.deepEqual(result.body.job.drafts, store.motions);
  assert.equal(result.body.job.id, created.body.job.id);
  assert.ok(elapsed >= 1100 && elapsed < 5000, `elapsed ${elapsed}`);
  assert.ok(Math.abs(result.body.waitedMs - elapsed) < 50);
  assert.equal(result.body.tokensCharged, false);
  assert.equal(result.body.production, false);

  const fighter = store.fighter(result.body.job.submission.fighterId).body.fighter;
  assert.equal(fighter.name, 'DUMMY 흰 고양이 복서');
  assert.equal(fighter.localId, `dummy-hosted-${created.body.job.id.replaceAll('-', '')}`);
  assert.equal(fighter.publicPlay, false);
  assert.equal(fighter.entered, false);
  assert.equal(fighter.front.ok, true);
  assert.equal(fighter.front.operatorApproved, false);
  assert.equal(fighter.front.expressions, true);
  assert.match(fighter.manifestSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(fighter.manifestSha256, hash(Buffer.from(pack.text)));

  const set = store.profileSet(fighter.front.profileSetId).body;
  assert.equal(set.stage, 'ready');
  assert.deepEqual(set.missingAssets, []);
  assert.equal(set.assets.length, 2);
  assert.equal(parseProfileSet(profilePack.text).ok, true);
  for (const asset of set.assets) {
    const bytes = profilePack.files.get(asset.id);
    assert.equal(asset.bytes, bytes.length);
    assert.equal(asset.sha256, hash(bytes));
    const metadata = await sharp(bytes).metadata();
    assert.equal(asset.width, metadata.width);
    assert.equal(asset.height, metadata.height);
    assert.equal(metadata.hasAlpha, true);
  }
  assert.deepEqual(
    set.assets.map(asset => asset.id),
    ['front', 'expressions'],
  );

  const again = await store.waitHosted({ jobId: created.body.job.id, waitSeconds: 30 });
  assert.equal(again.body.job.submission.id, result.body.job.submission.id);
  assert.ok(again.body.waitedMs < 100);
  assert.equal(request(store, { idempotencyKey: key }).body.job.id, created.body.job.id);
  assert.equal(store.registerHosted(created.body.job.id).body.job.submission.id, result.body.job.submission.id);
  const listed = store.listFighters().body;
  assert.equal(listed.account.fighterCount, 1);
  assert.equal(listed.fighters[0].submissionIds.length, 1);
  assert.equal(listed.notifications.filter(event => event.kind === 'profile-set-ready').length, 1);
});

test('wait bounds reject invalid input without advancing; zero-wait stays a synchronous single step', async () => {
  const store = createStore();
  const jobId = request(store).body.job.id;
  for (const waitSeconds of [-1, 31, 0.5, NaN, Infinity, '5']) {
    const result = await store.waitHosted({ jobId, waitSeconds });
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'invalid-wait-seconds');
  }
  const zero = await store.waitHosted({ jobId, waitSeconds: 0 });
  assert.equal(zero.body.job.drafts.length, 1);
  assert.equal(zero.body.waitedMs, 0);
  const synchronous = store.getHosted({ jobId });
  assert.equal(synchronous instanceof Promise, false);
  assert.equal(synchronous.body.job.drafts.length, 2);

  const start = performance.now();
  const partial = await store.waitHosted({ jobId, waitSeconds: 1 });
  const elapsed = performance.now() - start;
  assert.equal(partial.body.statusSummary.completed, false);
  assert.equal(partial.body.job.status, 'motions');
  assert.ok(partial.body.job.drafts.length > 2 && partial.body.job.drafts.length <= store.motions.length);
  assert.ok(elapsed >= 950 && elapsed < 2500, `elapsed ${elapsed}`);
  assert.ok(Math.abs(partial.body.waitedMs - elapsed) < 50);
  const finished = await store.waitHosted({ jobId, waitSeconds: 5 });
  assert.equal(finished.body.statusSummary.completed, true);
  assert.equal((await store.waitHosted({ jobId: randomUUID(), waitSeconds: 30 })).status, 404);
});

test('appearance, legacy review and registration capacity return promptly without drawing or automatic retries', async () => {
  const store = createStore({ fighterLimit: 1 });
  const appearance = request(store, { delegate: false }).body.job.id;
  const blockedLook = await store.waitHosted({ jobId: appearance, waitSeconds: 30 });
  assert.equal(blockedLook.body.statusSummary.actionRequired, 'choose_look');
  assert.equal(blockedLook.body.job.choice, null);
  assert.equal(blockedLook.body.job.drafts.length, 0);
  assert.ok(blockedLook.body.waitedMs < 100);
  const legacy = createStore({ policy: 'legacy-motion' });
  const legacyJob = request(legacy).body.job.id;
  assert.equal((await legacy.waitHosted({ jobId: legacyJob, waitSeconds: 30 })).body.statusSummary.actionRequired, 'register_or_revise');

  const first = request(store).body.job.id;
  const second = request(store).body.job.id;
  for (let i = 0; i <= store.motions.length; i++) store.getHosted({ jobId: first });
  const blocked = await store.waitHosted({ jobId: second, waitSeconds: 5 });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'fighter-quota');
  assert.equal(blocked.body.statusSummary.actionRequired, 'retry_registration');
  assert.equal(blocked.body.job.submission, null);
  assert.deepEqual(blocked.body.job.drafts, store.motions);
  const read = await store.waitHosted({ jobId: second, waitSeconds: 30 });
  assert.equal(read.body.job.status, 'needs_review');
  assert.ok(read.body.waitedMs < 100);
  store.setFighterLimit(2);
  assert.equal((await store.waitHosted({ jobId: second, waitSeconds: 5 })).body.job.status, 'needs_review');
  const recovered = store.registerHosted(second).body;
  assert.equal(recovered.statusSummary.completed, true);
  assert.deepEqual(recovered.job.drafts, blocked.body.job.drafts);
  assert.equal(store.fighter(recovered.job.submission.fighterId).body.fighter.front.expressions, true);
  assert.equal(store.registerHosted(second).body.job.submission.id, recovered.job.submission.id);
});

test('hosted display labels omit explicit request wrappers and boundary delegation while preserving the prompt', () => {
  const cases = [
    ['외형 선택까지 맡길게. 흰 고양이 복서를 만들어줘', '흰 고양이 복서'],
    ['흰 고양이 복서를 만들어줘. 외형 선택까지 맡길게.', '흰 고양이 복서'],
    ['외모는 네가 골라줘, 흰 고양이 복서를 만들어주세요!', '흰 고양이 복서'],
    ['You choose the appearance. Please create a white cat boxer.', 'white cat boxer'],
    ["Make me a white cat boxer; I'll leave the look choice to you.", 'white cat boxer'],
    ['Generate a white cat boxer, please!', 'white cat boxer'],
    ['흰 고양이 복서', '흰 고양이 복서'],
    ['Createbot boxer', 'Createbot boxer'],
    ['외형 선택까지 맡길게 고양이', '외형 선택까지 맡길게 고양이'],
    ['외형 선택까지 맡길게. 만들어줘', 'Hosted'],
    ['You pick the look.', 'Hosted'],
    ['DUMMY', 'Hosted'],
    ['DUMMY 흰 고양이 복서', '흰 고양이 복서'],
  ];
  const placeholderText = pack.text;
  for (const [description, label] of cases) {
    const store = createStore();
    const created = request(store, { description });
    assert.equal(created.status, 200, description);
    for (let i = 0; i <= store.motions.length; i++) store.getHosted({ jobId: created.body.job.id });
    const completed = store.getHosted({ jobId: created.body.job.id }).body;
    assert.equal(completed.statusSummary.completed, true, description);
    assert.equal(completed.job.description, description);
    assert.equal(store.fighter(completed.job.submission.fighterId).body.fighter.name, `DUMMY ${label}`, description);
  }
  assert.equal(pack.text, placeholderText);
});

test('hosted display labels respect UTF-16 bounds without splitting a surrogate pair', () => {
  for (const [description, expected] of [
    ['x'.repeat(33) + '🐱 tail', 'DUMMY ' + 'x'.repeat(33)],
    ['🐱'.repeat(20), 'DUMMY ' + '🐱'.repeat(17)],
    ['  \n\t ', 'DUMMY Hosted'],
  ]) {
    const store = createStore();
    const created = request(store, { description });
    assert.equal(created.status, 200);
    for (let i = 0; i <= store.motions.length; i++) store.getHosted({ jobId: created.body.job.id });
    const completed = store.getHosted({ jobId: created.body.job.id }).body;
    assert.equal(completed.statusSummary.completed, true);
    const name = store.fighter(completed.job.submission.fighterId).body.fighter.name;
    assert.equal(name, expected);
    assert.ok(name.length <= 40);
    assert.equal(name.isWellFormed(), true);
  }
});

test('description labels are bounded and the empty MCP fixture includes a real profile set', async () => {
  const { store } = await prepareDummyFixture('empty');
  const created = request(store, { description: '  긴 이름 🐱 '.repeat(35) });
  assert.equal(created.status, 200);
  for (let i = 0; i <= store.motions.length; i++) store.getHosted({ jobId: created.body.job.id });
  const completed = store.getHosted({ jobId: created.body.job.id }).body;
  assert.equal(completed.statusSummary.completed, true);
  const fighter = store.fighter(completed.job.submission.fighterId).body.fighter;
  assert.match(fighter.name, /^DUMMY 긴 이름 🐱/);
  assert.ok(fighter.name.length <= 40);
  assert.equal(fighter.front.expressions, true);
  assert.equal(fighter.front.operatorApproved, false);
  assert.equal(store.profileSet(fighter.front.profileSetId).body.assets.length, 2);
  assert.equal(store.profile().body.dummyRegistrationUrl, null);
  store.setPageBase('http://127.0.0.1:43210');
  assert.equal(store.profile().body.dummyRegistrationUrl, 'http://127.0.0.1:43210');
  const invalid = { ...profilePack, files: new Map(profilePack.files) };
  invalid.files.set('front', Buffer.from('invalid'));
  assert.throws(() => store.setPlaceholder(pack, invalid), /dummy-profile-placeholder-asset:front/);
});
