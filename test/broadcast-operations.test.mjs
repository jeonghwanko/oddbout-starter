import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOperationJournal, isConfirmedRejection } from '../web/broadcast/operations.mjs';

const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
test('reload and account switching preserve original pending mutation key and input', () => {
  const disk = storage(), first = createOperationJournal(disk, 'alice');
  const input = { productId: 'sandbox-1000' }, pending = first.begin('topup', input);
  const reloaded = createOperationJournal(disk, 'alice');
  assert.deepEqual(reloaded.begin('topup', input), pending);
  assert.throws(() => reloaded.begin('topup', { productId: 'different' }), /pending topup/);
  assert.equal(createOperationJournal(disk, 'bob').get('topup'), null);
  reloaded.acknowledge('topup', pending.requestKey, { intentId: 'persisted-order' });
  assert.equal(first.get('topup').result.intentId, 'persisted-order');
  reloaded.complete('topup', pending.requestKey);
  assert.notEqual(first.begin('topup', input).requestKey, pending.requestKey);
});

test('late acknowledgement cannot alter or delete a newer paid operation', () => {
  const saved = createOperationJournal(storage(), 'alice');
  const old = saved.begin('cup', { broadcastId: 'one' });
  saved.complete('cup', old.requestKey);
  const current = saved.begin('cup', { broadcastId: 'two' });
  assert.throws(() => saved.acknowledge('cup', old.requestKey, { id: 'late-job' }), /pending request changed/);
  assert.throws(() => saved.complete('cup', old.requestKey), /pending request changed/);
  assert.deepEqual(saved.get('cup'), current);
});

test('concurrent account tabs refuse a second paid action while the first is in flight', async () => {
  const held = new Set();
  // Web Locks boundary only: production browser lock behavior is also exercised in the UI check.
  const locks = { async request(name, options, callback) {
    assert.equal(options.ifAvailable, true);
    if (held.has(name)) return callback(null);
    held.add(name); try { return await callback({ name }); } finally { held.delete(name); }
  } };
  const disk = storage(), tab1 = createOperationJournal(disk, 'alice', { locks }), tab2 = createOperationJournal(disk, 'alice', { locks });
  let release; const gate = new Promise(resolve => { release = resolve; }); let submissions = 0;
  const pending = tab1.exclusive(async () => { tab1.begin('cup', {}); submissions++; await gate; });
  await assert.rejects(tab2.exclusive(async () => { submissions++; tab2.begin('cup', {}); }), /Another tab/);
  assert.equal(submissions, 1); release(); await pending;
  assert.equal(tab1.get('cup').requestKey, tab2.get('cup').requestKey);
  await assert.rejects(createOperationJournal(disk, 'alice', { locks: null }).exclusive(() => {}), /Web Locks/);
});

test('only confirmed precondition refusals permit new input, never provider or ambiguous failures', () => {
  for (const [status, code] of [[402, 'insufficient-credits'], [409, 'approval-expired'], [422, 'invalid-fighters'], [409, 'nothing-to-pay']])
    assert.equal(isConfirmedRejection({ responseOk: false, status, code }), true);
  for (const value of [new Error('network'), { responseOk: false, status: 502, code: 'paypal-timeout' },
    { responseOk: false, status: 409, code: 'idempotency-conflict' }, { responseOk: false, status: 503, code: 'commerce-unavailable' }])
    assert.equal(isConfirmedRejection(value), false);
});
test('unavailable or damaged storage blocks dispatch key creation', () => {
  assert.throws(() => createOperationJournal({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, 'alice').begin('cup', {}), /quota/);
  assert.throws(() => createOperationJournal({ getItem: () => '{}', setItem() {} }, 'alice').begin('cup', {}), /reconciliation/);
});

test('dispatch uncertainty survives reload and cannot be downgraded by a later refusal', () => {
  const disk = storage(), first = createOperationJournal(disk, 'alice');
  const original = first.begin('cup', { broadcastId: 'session' });
  assert.equal(original.dispatched, false);
  first.markDispatched('cup', original.requestKey);
  const restored = createOperationJournal(disk, 'alice');
  assert.equal(restored.get('cup').dispatched, true);
  assert.equal(restored.begin('cup', original.input).requestKey, original.requestKey);
  assert.throws(() => restored.markDispatched('cup', crypto.randomUUID()), /pending request changed/);
  // Missing old-version markers must never be interpreted as never dispatched.
  const legacy = { input: original.input, requestKey: original.requestKey };
  disk.setItem('oddbout.broadcast.operations.v1:legacy', JSON.stringify({ pending: { cup: legacy }, selected: {} }));
  assert.notEqual(createOperationJournal(disk, 'legacy').get('cup').dispatched, false);
});
test('approved budget and session references survive sign-in in a new tab', () => {
  const disk = storage(), first = createOperationJournal(disk, 'alice');
  first.select('approvalId', 'approved'); first.select('broadcastId', 'running');
  const restored = createOperationJournal(disk, 'alice');
  assert.equal(restored.selected('approvalId'), 'approved');
  assert.equal(restored.selected('broadcastId'), 'running');
});

test('operator release takes one UUID and a note, and reports the released job without a charge', async () => {
  const { parseReleaseArgs, releaseJob } = await import('../scripts/broadcast-release.mjs');
  const id = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(parseReleaseArgs(['--job', id.toUpperCase(), '--note', 'no cup on screen']), { jobId: id, note: 'no cup on screen' });
  for (const argv of [[], ['--job', 'job-1', '--note', 'x'], ['--job', id], ['--job', id, '--note', 'x'.repeat(501)], ['--job', id, '--note', 'x', '--force', '1']])
    assert.throws(() => parseReleaseArgs(argv), /release_invalid_arguments/);
  await assert.rejects(releaseJob(['--job', id, '--note', 'x'], { env: {} }), /release_environment_required/);
  const calls = [];
  const store = /** @type {any} */ ({ releaseJob: async (jobId, note) => { calls.push([jobId, note]);
    return { id: jobId, status: 'failed', broadcastId: 'b', hostId: 'current-pc', result: { reason: 'operator-released-unknown' }, owner: 'private' }; } });
  assert.deepEqual(await releaseJob(['--job', id, '--note', 'checked'], { store }), { id, status: 'failed', broadcastId: 'b', hostId: 'current-pc', reason: 'operator-released-unknown' });
  assert.deepEqual(calls, [[id, 'checked']]);
});
