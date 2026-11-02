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

const SHA = 'a'.repeat(64);
const DETAIL = { ok: true, fighter: { name: 'Example Fighter', ownerId: 'owner-1', enteredAt: '2026-11-02T00:00:00Z', manifestSha256: SHA } };

test('replace-package shows whose fighter changes until --yes, then creates, uploads, submits and waits for the validation', async () => {
  const { dir, manifest } = await packageDir(), calls = [];
  const answers = [DETAIL, DETAIL, { stage: 'uploading', submissionId: JOB }, ...manifest.assets.map(() => ({ ok: true })), { stage: 'queued', submissionId: JOB },
    { stage: 'validating', submissionId: JOB }, { stage: 'registered', availability: 'active', submissionId: JOB, keepEntry: true }];
  const connect = async () => ({ request: async (route, options = {}) => { calls.push({ route, ...options }); return answers[calls.length - 1]; } });
  const dry = await runAdmin({ argv: ['replace-package', JOB, dir, '--reason', '다운 모션 교체'], connect, env: {} });
  assert.equal(dry.dryRun, true); assert.match(dry.change, /출전 중 — 유지/); assert.match(dry.change, /owner-1/);
  assert.equal(dry.warning, manifest.profile.name === 'Example Fighter' ? undefined : 'name-differs');
  assert.deepEqual(calls.map(c => c.route), [`admin/fighters/${JOB}`], 'a dry run only reads the fighter');
  const waits = [];
  const done = await runAdmin({ argv: ['replace-package', JOB, `${dir}/fighter.json`, '--reason', '다운 모션 교체', '--yes'], connect, env: {},
    wait: async ms => { waits.push(ms); } });
  assert.equal(done.stage, 'registered'); assert.ok(done.done); assert.equal(waits.length, 2);
  const [, , create, ...rest] = calls;
  assert.equal(create.route, `admin/fighters/${JOB}/submissions`);
  assert.equal(decodeURIComponent(create.headers['x-admin-reason']), '다운 모션 교체');
  assert.equal(create.headers['idempotency-key'], dry.request.idempotencyKey, 'the dry run names the key the change will use');
  assert.equal(create.body, JSON.stringify(manifest));
  assert.deepEqual(rest.slice(0, manifest.assets.length).map(c => [c.route, c.method, c.headers['content-type'], c.body.length]),
    manifest.assets.map(a => [`admin/submissions/${JOB}/assets/${a.id}`, 'PUT', 'image/webp', a.bytes]));
  assert.deepEqual(rest.slice(manifest.assets.length).map(c => c.route), [`admin/submissions/${JOB}/submit`, `admin/submissions/${JOB}`, `admin/submissions/${JOB}`]);
});

test('replace-package is not done when its package is not the fighter\'s: superseded, rejected or still waiting', async () => {
  const { dir } = await packageDir();
  const run = async last => {
    const answers = [DETAIL, last];
    const connect = async () => ({ request: async () => answers.shift() ?? last });
    return runAdmin({ argv: ['replace-package', JOB, dir, '--reason', 'x', '--yes'], connect, env: {}, wait: async () => {} });
  };
  const superseded = await run({ stage: 'registered', availability: 'superseded', submissionId: JOB });
  assert.deepEqual([superseded.ok, superseded.code, superseded.done], [false, 'package-superseded', undefined]);
  assert.equal((await run({ stage: 'rejected', submissionId: JOB })).code, 'validation-rejected');
  assert.equal((await run({ stage: 'validating', submissionId: JOB })).code, 'validation-timeout');
  // The key names the package it replaces: the same package over a newer one is a new submission.
  const keys = [];
  for (const sha of ['c'.repeat(64), 'd'.repeat(64)]) {
    const connect = async () => ({ request: async () => ({ ...DETAIL, fighter: { ...DETAIL.fighter, manifestSha256: sha } }) });
    keys.push((await runAdmin({ argv: ['replace-package', JOB, dir, '--reason', 'x'], connect, env: {} })).request.idempotencyKey);
  }
  assert.notEqual(keys[0], keys[1]);
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
    return options.method === 'PATCH' ? { ok: true, stage: 'registered' } : { ...DETAIL, fighter: { ...DETAIL.fighter, manifestSha256: sha } }; } });
  const dry = await runAdmin({ argv: ['edit-profile', JOB, '--reason', '오타', '--profile', '{"description":"고친 소개"}', '--style', 'null'], connect, env: {} });
  assert.equal(dry.dryRun, true); assert.deepEqual(dry.request.body, { profile: { description: '고친 소개' }, style: null });
  assert.match(dry.change, /Example Fighter/); assert.deepEqual(calls.map(c => c.method ?? 'GET'), ['GET']);
  await runAdmin({ argv: ['edit-profile', JOB, '--reason', '오타', '--profile', '{"description":"고친 소개"}', '--yes'], connect, env: {} });
  assert.equal(calls[1].route, `admin/fighters/${JOB}`);
  assert.equal(calls[2].method, 'PATCH'); assert.equal(calls[2].route, `admin/fighters/${JOB}/profile`);
  assert.equal(decodeURIComponent(calls[2].headers['x-admin-reason']), '오타');
  assert.deepEqual(JSON.parse(calls[2].body), { profile: { description: '고친 소개' }, expectedManifestSha256: sha });
  await assert.rejects(runAdmin({ argv: ['edit-profile', JOB, '--reason', 'x'], connect, env: {} }), /missing-value:--profile/);
  await assert.rejects(runAdmin({ argv: ['edit-profile', JOB, '--reason', 'x', '--style', '{bad'], connect, env: {} }), /invalid-value:--style/);
});

test('storage-remove shows which unused folders go and what the budget becomes until --yes, then sends exactly those', async () => {
  const [a, b, c] = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
  const report = { ok: true, usedBytes: 380e6, limitBytes: 400e6, unusedCount: 3, unusedBytes: 30e6, unused: [
    { submissionId: a, email: 'one@example.com', name: '루비아', reason: 'replaced', createdAt: '2026-10-20T01:00:00Z', bytes: 6e6, files: 11 },
    { submissionId: b, email: 'two@example.com', name: 'Rejected', reason: 'rejected', createdAt: '2026-10-21T01:00:00Z', bytes: 9e6, files: 11 },
    { submissionId: c, email: 'one@example.com', name: '모른', reason: 'upload-expired', createdAt: '2026-10-22T01:00:00Z', bytes: 15e6, files: 4 }] };
  const calls = [];
  const connect = async () => ({ request: async (route, options = {}) => { calls.push({ route, ...options }); return route === 'admin/storage' ? report : { ok: true, removed: 2 }; } });
  assert.equal((await runAdmin({ argv: ['storage'], connect, env: {} })).usedBytes, 380e6);
  const dry = await runAdmin({ argv: ['storage-remove', '--oldest', '2'], connect, env: {} });
  assert.equal(dry.dryRun, true); assert.deepEqual(dry.request.body.submissionIds, [a, b]);
  assert.match(dry.change, /2개\(15\.0 MB, 2026-10-20부터\).*380\.0 MB → 365\.0 MB \/ 400\.0 MB/);
  assert.deepEqual(dry.folders.map(folder => folder.email), ['one@example.com', 'two@example.com']);
  assert.deepEqual(calls.map(call => call.route), ['admin/storage', 'admin/storage'], 'a dry run only reads');
  const done = await runAdmin({ argv: ['storage-remove', c.toUpperCase(), a, a, '--yes'], connect, env: {} });
  assert.equal(done.removed, 2); assert.match(done.done, /2개\(21\.0 MB, 2026-10-20부터/);
  assert.deepEqual([calls.at(-1).route, calls.at(-1).method, JSON.parse(calls.at(-1).body)], ['admin/storage/removals', 'POST', { submissionIds: [c, a] }]);
  await assert.rejects(runAdmin({ argv: ['storage-remove', JOB, '--yes'], connect, env: {} }), /not-unused/);
  for (const argv of [['storage-remove'], ['storage-remove', a, '--oldest', '1'], ['storage-remove', '--oldest', '0'], ['storage-remove', '--oldest', '51']])
    await assert.rejects(runAdmin({ argv, connect: async () => { throw Error('no call expected'); }, env: {} }), /missing-value:submission|invalid-value:--oldest/);
});

test('profile-expressions: every sheet is checked before anything is sent; each goes on its own with its reason and a key per set and sheet', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = (await import('node:path')).default;
  const { createHash } = await import('node:crypto');
  const { webp } = await import('./helpers/generation-database.mjs');
  const sharp = (await import('sharp')).default;
  // A sheet the validator's check passes: a bust in each of the six cells on a clear background.
  const rgba = Buffer.alloc(1536 * 1024 * 4);
  for (let cell = 0; cell < 6; cell++) for (let y = Math.floor(cell / 3) * 512 + 80; y < Math.floor(cell / 3) * 512 + 512; y++)
    for (let x = (cell % 3) * 512 + 120; x < (cell % 3) * 512 + 392; x++) rgba.set([90, 120, 200, 255], (y * 1536 + x) * 4);
  const sheet = new Uint8Array(await sharp(rgba, { raw: { width: 1536, height: 1024, channels: 4 } }).webp({ lossless: true }).toBuffer());
  const dir = await mkdtemp(path.join(tmpdir(), 'sheets-')), set = JOB, other = 'a242bcce-997e-4248-b57b-16fab1bf2109';
  await writeFile(path.join(dir, `${set}.webp`), sheet);
  const entry = { fighterId: other, profileSetId: set, name: '꿈순이', file: `${set}.webp`, sha256: createHash('sha256').update(sheet).digest('hex') };
  await writeFile(path.join(dir, 'sheets.json'), JSON.stringify({ sheets: [entry] }));
  const list = path.join(dir, 'sheets.json');
  const calls = [];
  const connect = async () => ({ request: async (route, options = {}) => { calls.push({ route, ...options }); return { ok: true, profileSet: { profileSetId: other, stage: 'queued' } }; } });
  const dry = await runAdmin({ argv: ['profile-expressions', list, '--reason', '패배 표정 추가'], connect, env: {} });
  assert.equal(dry.dryRun, true); assert.match(dry.change, /꿈순이/); assert.equal(calls.length, 0);
  const done = await runAdmin({ argv: ['profile-expressions', list, '--reason', '패배 표정 추가', '--yes'], connect, env: {} });
  assert.deepEqual(done.results, [{ fighterId: other, name: '꿈순이', ok: true, profileSetId: other, stage: 'queued' }]);
  assert.equal(calls[0].route, `admin/profile-sets/${set}/expressions`);
  assert.deepEqual([calls[0].headers['content-type'], decodeURIComponent(calls[0].headers['x-admin-reason']), calls[0].headers['idempotency-key'],
    calls[0].headers['x-admin-fighter']], ['image/webp', '패배 표정 추가', dry.sheets[0].idempotencyKey, other]);
  // --attempt 2: new keys for the same sheets (after an upload-expired).
  const again = await runAdmin({ argv: ['profile-expressions', list, '--reason', 'x', '--attempt', '2'], connect, env: {} });
  assert.notEqual(again.sheets[0].idempotencyKey, dry.sheets[0].idempotencyKey);
  assert.deepEqual(new Uint8Array(calls[0].body), sheet);
  // A sheet that is not what the list says stops the whole run before any call.
  await writeFile(path.join(dir, 'sheets.json'), JSON.stringify({ sheets: [{ ...entry, sha256: 'a'.repeat(64) }] }));
  await assert.rejects(runAdmin({ argv: ['profile-expressions', list, '--reason', 'x', '--yes'], connect, env: {} }), /sheet-mismatch/);
  for (const bad of [webp(1024, 1024), webp(1536, 1024)]) {   // another size; the right size that does not decode
    await writeFile(path.join(dir, `${set}.webp`), bad);
    await writeFile(path.join(dir, 'sheets.json'), JSON.stringify({ sheets: [{ ...entry, sha256: createHash('sha256').update(bad).digest('hex') }] }));
    await assert.rejects(runAdmin({ argv: ['profile-expressions', list, '--reason', 'x', '--yes'], connect, env: {} }), /sheet-mismatch/);
  }
  assert.equal(calls.length, 1);
});

test('profile-front: the kit\'s set folder is checked before anything is sent; the dry run reads the fighter; one form carries the set', async () => {
  const { mkdtemp, readFile, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = (await import('node:path')).default;
  const sharp = (await import('sharp')).default;
  const { buildProfileSet } = await import('../scripts/profile-set.mjs');
  /** A PNG with filled rectangles [x0, y0, x1, y1] on a clear background. */
  const picture = (width, height, rects) => {
    const data = Buffer.alloc(width * height * 4);
    for (const [x0, y0, x1, y1] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data.set([200, 120, 90, 255], (y * width + x) * 4);
    return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  };
  const dir = await mkdtemp(path.join(tmpdir(), 'front-')), front = path.join(dir, 'front.png'), sheet = path.join(dir, 'sheet.png'), out = path.join(dir, 'set');
  await writeFile(front, await picture(800, 1200, [[350, 100, 449, 199], [300, 200, 500, 1000]]));
  await writeFile(sheet, await picture(1536, 1024, [0, 1, 2, 3, 4, 5].map(c => [(c % 3) * 512 + 80, Math.floor(c / 3) * 512 + 60, (c % 3) * 512 + 430, Math.floor(c / 3) * 512 + 511])));
  assert.equal((await buildProfileSet({ front, expressions: sheet, out })).ok, true);
  const fighter = 'b138c92b-9e89-4cd6-888d-6b882bcf433c', calls = [];
  const connect = async () => ({ request: async (route, options = {}) => {
    calls.push({ route, ...options });
    return route === `admin/fighters/${fighter}` ? { ok: true, fighter: { name: '서리엘', ownerId: 'owner-1', manifestSha256: SHA } }
      : { ok: true, profileSet: { profileSetId: JOB, stage: 'queued' } };
  } });
  const dry = await runAdmin({ argv: ['profile-front', fighter, out, '--reason', '정면 추가'], connect, env: {} });
  assert.equal(dry.dryRun, true); assert.match(dry.change, /「서리엘」.*주인 owner-1.*표정 시트 있음.*사유: 정면 추가/);
  assert.deepEqual(calls.map(call => call.route), [`admin/fighters/${fighter}`], 'a dry run only reads the fighter');
  const done = await runAdmin({ argv: ['profile-front', fighter, out, '--reason', '정면 추가', '--yes'], connect, env: {} });
  assert.deepEqual([done.profileSet.stage, done.done], ['queued', dry.change]);
  const sent = calls.at(-1);
  assert.deepEqual([sent.route, sent.method, sent.headers['idempotency-key'], decodeURIComponent(sent.headers['x-admin-reason'])],
    [`admin/fighters/${fighter}/profile-sets`, 'POST', dry.request.idempotencyKey, '정면 추가']);
  assert.equal(sent.headers['content-type'], undefined, 'fetch writes the multipart boundary');
  const set = JSON.parse(await readFile(path.join(out, 'profile-set.json'), 'utf8'));
  assert.deepEqual([...sent.body.keys()], ['profile-set', 'front', 'expressions']);
  for (const [name, file] of [['profile-set', 'profile-set.json'], ['front', set.front.path], ['expressions', set.expressions.path]])
    assert.deepEqual(Buffer.from(await sent.body.get(name).arrayBuffer()), await readFile(path.join(out, file)), name);
  // --attempt 2: a new key for the same set (after an upload-expired).
  const again = await runAdmin({ argv: ['profile-front', fighter, out, '--reason', 'x', '--attempt', '2'], connect, env: {} });
  assert.notEqual(again.request.idempotencyKey, dry.request.idempotencyKey);
  // A picture that is not what the set file says, or a set file the server does not read, stops before any call.
  const count = calls.length, bytes = await readFile(path.join(out, set.front.path));
  await writeFile(path.join(out, set.front.path), Buffer.concat([bytes, Buffer.from([0])]));
  await assert.rejects(runAdmin({ argv: ['profile-front', fighter, out, '--reason', 'x', '--yes'], connect, env: {} }), /asset-mismatch/);
  await writeFile(path.join(out, set.front.path), bytes);
  await writeFile(path.join(out, 'profile-set.json'), JSON.stringify({ ...set, face: { x: 0, y: 0, side: 1 } }));
  await assert.rejects(runAdmin({ argv: ['profile-front', fighter, out, '--reason', 'x', '--yes'], connect, env: {} }), /profile-set-invalid/);
  await assert.rejects(runAdmin({ argv: ['profile-front', fighter, out, '--yes'], connect, env: {} }), /missing-value:--reason/);
  assert.equal(calls.length, count);
});
