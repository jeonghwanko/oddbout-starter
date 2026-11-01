import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCall, parseArgs, runAdmin } from '../scripts/admin.mjs';

const JOB = 'd242bcce-997e-4248-b57b-16fab1bf2109';
/** A client that records each call and answers ok. */
function recorder() {
  const calls = [];
  return { calls, connect: async sessionPath => ({ request: async (route, options = {}) => { calls.push({ sessionPath, route, ...options }); return { ok: true }; } }) };
}

test('reads go out at once; a change is only shown until --yes', async () => {
  const { calls, connect } = recorder();
  assert.deepEqual(await runAdmin({ argv: ['review'], connect, env: { ODDBOUT_ADMIN_SESSION: '/tmp/admin.json' } }), { ok: true });
  assert.deepEqual(calls.map(c => [c.sessionPath, c.route]), [['/tmp/admin.json', 'admin/generations?status=needs_review']]);
  const dry = await runAdmin({ argv: ['cancel', JOB], connect, env: {} });
  assert.equal(dry.dryRun, true); assert.equal(dry.request.route, `admin/generations/${JOB}/cancel`); assert.equal(calls.length, 1);
  const done = await runAdmin({ argv: ['cancel', JOB, '--yes', '--session', '/tmp/other.json'], connect, env: {} });
  assert.match(done.done, /취소/);
  assert.deepEqual([calls[1].sessionPath, calls[1].route, calls[1].method, calls[1].body], ['/tmp/other.json', `admin/generations/${JOB}/cancel`, 'POST', '{}']);
});

test('each command names its route, and refuses a bad id, value or command before any call', () => {
  const plan = argv => { const { positional, flags } = parseArgs(argv); return planCall(positional, flags); };
  assert.equal(plan(['show', JOB.toUpperCase()]).route, `generations/${JOB}`);
  assert.equal(plan(['fighters', '--status', 'all', '--search', '냥', '--page', '2']).route, 'fighters?status=all&search=%EB%83%A5&page=2');
  assert.deepEqual(plan(['fighter-remove', JOB, '--version', '3', '--reason', '규칙 위반']).body, { action: 'remove', version: 3, reason: '규칙 위반' });
  assert.deepEqual(plan(['host-withdraw', JOB]).body, { approved: false });
  assert.equal(plan(['profiles', '--status', 'approved']).route, 'profile-sets?status=approved');
  assert.throws(() => plan(['show', 'd242bcce']), /invalid-id:job/);
  assert.throws(() => plan(['profile-reject', JOB]), /missing-value:--reason/);
  assert.throws(() => plan(['fighter-restore', JOB, '--version', '-1', '--reason', 'x']), /invalid-value:--version/);
  assert.throws(() => plan(['fighters', '--status', 'pending']), /invalid-value:--status/);
  assert.throws(() => plan(['delete-everything']), /unknown-command/);
  assert.throws(() => parseArgs(['show', JOB, '--session']), /missing-value:--session/);
});

test('a missing session file asks for a sign-in', async () => {
  const connect = async () => { throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }); };
  await assert.rejects(runAdmin({ argv: ['whoami'], connect, env: {} }), /client-sign-in-required/);
});
