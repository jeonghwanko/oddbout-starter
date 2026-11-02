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

// 운영자 선수 수정 (2026-11-02): a package on disk as the CLI reads it, written here (the example's own files are not in the repository).
async function packageDir() {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'), path = await import('node:path'), { createHash } = await import('node:crypto');
  const example = (await import('../contracts/ai-fighter/v1/example.fighter.json', { with: { type: 'json' } })).default;
  const dir = await mkdtemp(path.join(tmpdir(), 'admin-package-')), manifest = structuredClone(example);
  await mkdir(path.join(dir, 'assets'));
  for (const asset of manifest.assets) {
    const bytes = Buffer.alloc(asset.bytes, 7); bytes.write('RIFF', 0); bytes.write('WEBP', 8);
    asset.sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(path.join(dir, asset.path), bytes);
  }
  await writeFile(path.join(dir, 'fighter.json'), JSON.stringify(manifest));
  return { dir, manifest };
}

test('replace-package shows its change until --yes, then creates, uploads, submits and waits for the validation', async () => {
  const { dir, manifest } = await packageDir(), calls = [];
  const answers = [{ stage: 'uploading', submissionId: JOB }, ...manifest.assets.map(() => ({ ok: true })), { stage: 'queued', submissionId: JOB },
    { stage: 'validating', submissionId: JOB }, { stage: 'registered', submissionId: JOB, keepEntry: true }];
  const connect = async () => ({ request: async (route, options = {}) => { calls.push({ route, ...options }); return answers[calls.length - 1]; } });
  const dry = await runAdmin({ argv: ['replace-package', JOB, dir, '--reason', '다운 모션 교체'], connect, env: {} });
  assert.equal(dry.dryRun, true); assert.match(dry.change, /출전 중이면 출전을 유지/); assert.equal(calls.length, 0);
  const waits = [];
  const done = await runAdmin({ argv: ['replace-package', JOB, `${dir}/fighter.json`, '--reason', '다운 모션 교체', '--yes'], connect, env: {},
    wait: async ms => { waits.push(ms); } });
  assert.equal(done.stage, 'registered'); assert.equal(waits.length, 2);
  const [create, ...rest] = calls;
  assert.equal(create.route, `admin/fighters/${JOB}/submissions?reason=${encodeURIComponent('다운 모션 교체').replaceAll('%20', '+')}`);
  assert.equal(create.headers['idempotency-key'], dry.request.idempotencyKey, 'the dry run names the key the change will use');
  assert.equal(create.body, JSON.stringify(manifest));
  assert.deepEqual(rest.slice(0, manifest.assets.length).map(c => [c.route, c.method, c.headers['content-type'], c.body.length]),
    manifest.assets.map(a => [`admin/submissions/${JOB}/assets/${a.id}`, 'PUT', 'image/webp', a.bytes]));
  assert.deepEqual(rest.slice(manifest.assets.length).map(c => c.route), [`admin/submissions/${JOB}/submit`, `admin/submissions/${JOB}`, `admin/submissions/${JOB}`]);
});

test('replace-package refuses a package whose file differs from its manifest, before any call', async () => {
  const { dir, manifest } = await packageDir(), { writeFile } = await import('node:fs/promises');
  await writeFile(`${dir}/${manifest.assets[0].path}`, Buffer.from('changed'));
  await assert.rejects(runAdmin({ argv: ['replace-package', JOB, dir, '--reason', 'x', '--yes'], connect: async () => { throw Error('no call'); }, env: {} }),
    new RegExp(`asset-mismatch:${manifest.assets[0].id}`));
});

test('edit-profile reads the current package hash and sends the edit with the reason', async () => {
  const calls = [], sha = 'b'.repeat(64);
  const connect = async () => ({ request: async (route, options = {}) => { calls.push({ route, ...options });
    return calls.length === 1 ? { ok: true, fighter: { manifestSha256: sha } } : { ok: true, stage: 'registered' }; } });
  const dry = await runAdmin({ argv: ['edit-profile', JOB, '--reason', '오타', '--profile', '{"description":"고친 소개"}', '--style', 'null'], connect, env: {} });
  assert.equal(dry.dryRun, true); assert.deepEqual(dry.request.body, { profile: { description: '고친 소개' }, style: null }); assert.equal(calls.length, 0);
  await runAdmin({ argv: ['edit-profile', JOB, '--reason', '오타', '--profile', '{"description":"고친 소개"}', '--yes'], connect, env: {} });
  assert.equal(calls[0].route, `admin/fighters/${JOB}`);
  assert.equal(calls[1].method, 'PATCH'); assert.match(calls[1].route, new RegExp(`^admin/fighters/${JOB}/profile\\?reason=`));
  assert.deepEqual(JSON.parse(calls[1].body), { profile: { description: '고친 소개' }, expectedManifestSha256: sha });
  await assert.rejects(runAdmin({ argv: ['edit-profile', JOB, '--reason', 'x'], connect, env: {} }), /missing-value:--profile/);
  await assert.rejects(runAdmin({ argv: ['edit-profile', JOB, '--reason', 'x', '--style', '{bad'], connect, env: {} }), /invalid-value:--style/);
});
