import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { assetsToUpload, readFighterPackage, runRegister } from '../scripts/register-fighter.mjs';

const FIGHTER = 'b65cd3f2-e934-4d49-aaa1-2d2665e5ee52';
const SUBMISSION = '11111111-1111-4111-8111-111111111111';

async function packageDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'fighter-register-'));
  await cp(fileURLToPath(new URL('../examples/sparring-bot/', import.meta.url)), dir, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(dir, 'fighter.json'), 'utf8'));
  await writeFile(path.join(dir, 'fighter.json'), JSON.stringify(manifest));
  return { dir, manifest };
}

test('stage names in pending are not asset ids', () => {
  const files = [
    { id: 'idle', bytes: Buffer.alloc(4) },
    { id: 'walk', bytes: Buffer.alloc(4) },
  ];
  const legacy = { stage: 'uploading', pending: ['server-validation', 'registration'] };
  assert.deepEqual(
    assetsToUpload(legacy, files).map(file => file.id),
    ['idle', 'walk'],
  );
  const confirmed = {
    stage: 'uploading',
    assetUploadState: 'confirmed',
    pending: ['server-validation', 'registration'],
    missingAssets: [{ id: 'walk', path: 'assets/walk.webp' }],
  };
  assert.deepEqual(
    assetsToUpload(confirmed, files).map(file => file.id),
    ['walk'],
  );
  assert.deepEqual(assetsToUpload({ stage: 'queued', pending: ['server-validation', 'registration'] }, files), []);
});

test('a dry run checks the package, saves one idempotency key and does not call the server', async () => {
  const { dir, manifest } = await packageDir();
  let calls = 0;
  const connect = async () => {
    calls++;
    return { request: async () => ({}) };
  };
  const dry = await runRegister({ argv: ['--dir', dir, '--fighter', FIGHTER], connect, env: {} });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.ok, true);
  assert.equal(calls, 0);
  assert.equal(dry.fighterId, FIGHTER);
  assert.equal(dry.request.route, `submissions?fighter=${FIGHTER}`);
  assert.match(dry.idempotencyKey, /^[0-9a-f-]{36}$/);
  assert.equal(dry.assets.length, manifest.assets.length);
  assert.ok(dry.warnings.some(warning => warning.code === 'BORROWED_LANDMARK'));
  const saved = JSON.parse(await readFile(dry.idempotencyKeyPath, 'utf8'));
  assert.equal(saved.idempotencyKey, dry.idempotencyKey);
  assert.equal(saved.manifestSha256, dry.manifestSha256);
  assert.equal(saved.fighterId, FIGHTER);
  const again = await runRegister({ argv: ['--dir', dir, '--fighter', FIGHTER], connect, env: {} });
  assert.equal(again.idempotencyKey, dry.idempotencyKey);
  assert.equal(again.idempotencyKeyReused, true);
  const other = await runRegister({ argv: ['--dir', dir], connect, env: {} });
  assert.notEqual(other.idempotencyKey, dry.idempotencyKey);
  assert.equal(other.request.route, 'submissions');
});

test('concurrent commands save and reuse one idempotency key for identical package bytes', async () => {
  const { dir } = await packageDir();
  const script = fileURLToPath(new URL('../scripts/register-fighter.mjs', import.meta.url));
  const results = await Promise.all(
    Array.from({ length: 6 }, async () => {
      const { stdout } = await promisify(execFile)(process.execPath, [script, '--dir', dir]);
      return JSON.parse(stdout);
    }),
  );
  assert.equal(new Set(results.map(result => result.idempotencyKey)).size, 1);
  assert.equal(results.filter(result => !result.idempotencyKeyReused).length, 1);
  const saved = JSON.parse(await readFile(path.join(dir, '.oddbout-registration.json'), 'utf8'));
  assert.equal(saved.idempotencyKey, results[0].idempotencyKey);
  const retry = await runRegister({ argv: ['--dir', dir] });
  assert.equal(retry.idempotencyKey, saved.idempotencyKey);
});

test('an unknown submission resumes its original key after package and target changes', async () => {
  const { dir } = await packageDir();
  const manifestPath = path.join(dir, 'fighter.json');
  const original = await readFile(manifestPath, 'utf8');
  const first = await runRegister({
    argv: ['--dir', dir, '--submit'],
    connect: async () => ({
      request: async route => {
        if (route === 'submissions') return { ok: true, stage: 'uploading', submissionId: SUBMISSION };
        if (route.endsWith('/submit')) throw new Error('api-timeout');
        return { ok: true, stage: 'uploaded' };
      },
    }),
  });
  assert.equal(first.code, 'api-timeout');
  await writeFile(manifestPath, original + '\n');
  const otherPackage = await runRegister({ argv: ['--dir', dir] });
  await writeFile(manifestPath, original);
  const otherTarget = await runRegister({ argv: ['--dir', dir, '--fighter', FIGHTER] });
  const resumed = await runRegister({
    argv: ['--dir', dir, '--submit'],
    connect: async () => ({
      request: async (route, options) => {
        assert.equal(route, 'submissions');
        assert.equal(options.headers['idempotency-key'], first.idempotencyKey);
        return { ok: true, stage: 'registered', submissionId: SUBMISSION, fighterId: FIGHTER };
      },
    }),
  });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.idempotencyKey, first.idempotencyKey);
  const saved = JSON.parse(await readFile(first.idempotencyKeyPath, 'utf8'));
  assert.equal(saved.version, 2);
  assert.equal(saved.submissionId, SUBMISSION);
  assert.deepEqual(
    new Set(saved.attempts.map(attempt => attempt.idempotencyKey)),
    new Set([first.idempotencyKey, otherPackage.idempotencyKey, otherTarget.idempotencyKey]),
  );
});

test('legacy records migrate and explicit key choices retain every earlier attempt', async () => {
  const { dir } = await packageDir();
  const first = await runRegister({ argv: ['--dir', dir] });
  const stored = JSON.parse(await readFile(first.idempotencyKeyPath, 'utf8'));
  const legacy = { ...stored.attempts[0], submissionId: SUBMISSION };
  await writeFile(first.idempotencyKeyPath, JSON.stringify(legacy));
  const migrated = await runRegister({ argv: ['--dir', dir] });
  assert.equal(migrated.idempotencyKey, first.idempotencyKey);
  assert.equal(migrated.submissionId, SUBMISSION);
  const explicit = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  await runRegister({ argv: ['--dir', dir, '--idempotency-key', explicit] });
  assert.equal((await runRegister({ argv: ['--dir', dir] })).idempotencyKey, explicit);
  const restored = await runRegister({ argv: ['--dir', dir, '--idempotency-key', first.idempotencyKey] });
  assert.equal(restored.submissionId, SUBMISSION);
  await runRegister({ argv: ['--dir', dir, '--fighter', FIGHTER] });
  assert.equal((await runRegister({ argv: ['--dir', dir] })).idempotencyKey, first.idempotencyKey);
  const saved = JSON.parse(await readFile(first.idempotencyKeyPath, 'utf8'));
  assert.equal(saved.attempts.length, 3);
  assert.ok(saved.attempts.some(attempt => attempt.idempotencyKey === explicit));
  const before = await readFile(first.idempotencyKeyPath, 'utf8');
  await assert.rejects(runRegister({ argv: ['--dir', dir, '--fighter', FIGHTER, '--idempotency-key', explicit] }), /idempotency-conflict/);
  assert.equal(await readFile(first.idempotencyKeyPath, 'utf8'), before);
});

test('confirmed upload expiration recommends an explicit new key and preserves the expired attempt', async () => {
  const { dir } = await packageDir();
  const expired = await runRegister({
    argv: ['--dir', dir, '--submit'],
    connect: async () => ({
      request: async route => {
        assert.equal(route, 'submissions');
        return { ok: true, stage: 'uploading', code: 'upload-expired', submissionId: SUBMISSION };
      },
    }),
  });
  assert.equal(expired.code, 'upload-expired');
  assert.match(expired.hint, /new --idempotency-key/);
  assert.doesNotMatch(expired.hint, /delete|change the package/);
  const replacement = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const retry = await runRegister({ argv: ['--dir', dir, '--idempotency-key', replacement] });
  assert.equal(retry.idempotencyKey, replacement);
  const saved = JSON.parse(await readFile(retry.idempotencyKeyPath, 'utf8'));
  assert.equal(saved.attempts.length, 2);
  assert.equal(saved.attempts.find(attempt => attempt.idempotencyKey === expired.idempotencyKey).submissionId, SUBMISSION);
});

test('unknown, duplicate and conflicting flags fail before reading packages or connecting', async () => {
  const { dir } = await packageDir();
  const before = await readFile(path.join(dir, 'fighter.json'), 'utf8');
  const connect = async () => assert.fail('invalid flags must not connect');
  for (const flags of [['--fighter-id', FIGHTER], ['--fighter', FIGHTER, '--fighter', FIGHTER], ['--submit'], ['another-package'], ['--dry-run']]) {
    await assert.rejects(runRegister({ argv: ['--dir', dir, '--submit', ...flags], connect }), /invalid-(?:flag|args):/);
    await assert.rejects(readFile(path.join(dir, '.oddbout-registration.json')), { code: 'ENOENT' });
  }
  await assert.rejects(runRegister({ argv: ['--dir', '/does/not/exist', '--submit', '--fighter-id', FIGHTER], connect }), /invalid-flag:--fighter-id/);
  assert.equal(await readFile(path.join(dir, 'fighter.json'), 'utf8'), before);
});

test('symlinked asset directories, asset files and manifests are rejected', async () => {
  const external = await packageDir();
  const linkedDirectory = await packageDir();
  await rm(path.join(linkedDirectory.dir, 'assets'), { recursive: true });
  await symlink(path.join(external.dir, 'assets'), path.join(linkedDirectory.dir, 'assets'), 'dir');
  await assert.rejects(readFighterPackage(linkedDirectory.dir), /asset-escape:/);

  const linkedFile = await packageDir();
  const asset = linkedFile.manifest.assets[0];
  await rm(path.join(linkedFile.dir, asset.path));
  await symlink(path.join(external.dir, asset.path), path.join(linkedFile.dir, asset.path), 'file');
  await assert.rejects(readFighterPackage(linkedFile.dir), new RegExp(`asset-escape:${asset.id}`));

  const linkedManifest = await packageDir();
  await rm(path.join(linkedManifest.dir, 'fighter.json'));
  await symlink(path.join(external.dir, 'fighter.json'), path.join(linkedManifest.dir, 'fighter.json'), 'file');
  await assert.rejects(readFighterPackage(linkedManifest.dir), /package-symlink/);
});

test('oversized manifest and asset files are refused before full-file reads', async () => {
  const oversizedManifest = await packageDir();
  await truncate(path.join(oversizedManifest.dir, 'fighter.json'), spec.limits.jsonBytes + 1);
  await assert.rejects(readFighterPackage(oversizedManifest.dir), /package-invalid/);
  const oversizedAsset = await packageDir();
  const asset = oversizedAsset.manifest.assets[0];
  await truncate(path.join(oversizedAsset.dir, asset.path), asset.bytes + 1);
  await assert.rejects(readFighterPackage(oversizedAsset.dir), new RegExp(`asset-mismatch:${asset.id}`));
});

test('a FIFO asset is refused without waiting for a writer or contacting the server', { skip: process.platform === 'win32', timeout: 5000 }, async () => {
  const { dir, manifest } = await packageDir();
  const asset = manifest.assets[0];
  const file = path.join(dir, asset.path);
  await rm(file);
  await promisify(execFile)('mkfifo', [file]);
  await assert.rejects(
    runRegister({ argv: ['--dir', dir, '--submit'], connect: async () => assert.fail('FIFO assets must not connect') }),
    new RegExp(`asset-mismatch:${asset.id}`),
  );
  await assert.rejects(readFile(path.join(dir, '.oddbout-registration.json')), { code: 'ENOENT' });
});

test('matching hashes do not let undecodable WebP files reach key creation or the server', async () => {
  const { dir, manifest } = await packageDir();
  const asset = manifest.assets[0];
  const corrupt = Buffer.alloc(asset.bytes, 7);
  corrupt.write('RIFF', 0);
  corrupt.write('WEBP', 8);
  asset.sha256 = createHash('sha256').update(corrupt).digest('hex');
  await writeFile(path.join(dir, asset.path), corrupt);
  await writeFile(path.join(dir, 'fighter.json'), JSON.stringify(manifest));
  for (const flags of [[], ['--submit']]) {
    await assert.rejects(
      runRegister({ argv: ['--dir', dir, ...flags], connect: async () => assert.fail('undecodable art must not connect') }),
      error => error.message === 'package-invalid' && error.errors.some(issue => issue.code === 'ASSET_READ_OR_DECODE'),
    );
    await assert.rejects(readFile(path.join(dir, '.oddbout-registration.json')), { code: 'ENOENT' });
  }
});

test('a damaged existing record is preserved and never mints a replacement key or contacts the server', async () => {
  const { dir } = await packageDir();
  const recordPath = path.join(dir, '.oddbout-registration.json');
  let calls = 0;
  const connect = async () => {
    calls++;
    return { request: async () => ({}) };
  };
  for (const text of ['{"idempotencyKey":', '{}', 'null']) {
    await writeFile(recordPath, text);
    for (const flags of [[], ['--idempotency-key', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee']]) {
      await assert.rejects(runRegister({ argv: ['--dir', dir, '--submit', ...flags], connect }), /registration-record-invalid/);
      assert.equal(await readFile(recordPath, 'utf8'), text);
    }
  }
  assert.equal(calls, 0);
});

test('an unreadable existing record fails closed before connecting', async () => {
  const { dir } = await packageDir();
  await mkdir(path.join(dir, '.oddbout-registration.json'));
  await assert.rejects(
    runRegister({
      argv: ['--dir', dir, '--submit'],
      connect: async () => assert.fail('must not connect without the original registration record'),
    }),
    /registration-record-unreadable/,
  );
});

test('--submit uploads local asset ids, ignores pending stage names, and polls until registered', async () => {
  const { dir, manifest } = await packageDir();
  const calls = [];
  const answers = [
    { ok: true, stage: 'uploading', submissionId: SUBMISSION, pending: ['server-validation', 'registration'] },
    ...manifest.assets.map(() => ({ ok: true, stage: 'uploaded' })),
    { ok: true, stage: 'queued', submissionId: SUBMISSION, pending: ['server-validation', 'registration'] },
    { ok: true, stage: 'validating', submissionId: SUBMISSION, pending: ['server-validation', 'registration'] },
    { ok: true, stage: 'registered', submissionId: SUBMISSION, fighterId: FIGHTER, pending: [] },
  ];
  const connect = async () => ({
    request: async (route, options = {}) => {
      calls.push({ route, ...options });
      return answers[calls.length - 1];
    },
  });
  const waits = [];
  const done = await runRegister({
    argv: ['--dir', `${dir}/fighter.json`, '--fighter', FIGHTER, '--idempotency-key', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', '--submit'],
    connect,
    env: {},
    wait: async ms => {
      waits.push(ms);
    },
  });
  assert.equal(done.ok, true);
  assert.equal(done.stage, 'registered');
  assert.equal(done.fighterId, FIGHTER);
  assert.equal(waits.length, 2);
  assert.equal(calls[0].route, `submissions?fighter=${FIGHTER}`);
  assert.equal(calls[0].headers['idempotency-key'], 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  assert.equal(calls[0].headers['content-type'], 'application/json');
  assert.equal(calls[0].body, JSON.stringify(manifest));
  assert.deepEqual(
    calls.slice(1, 1 + manifest.assets.length).map(call => [call.method, call.route, call.headers['content-type']]),
    manifest.assets.map(asset => ['PUT', `submissions/${SUBMISSION}/assets/${asset.id}`, 'image/webp']),
  );
  assert.ok(!calls.some(call => call.route.includes('/assets/server-validation') || call.route.includes('/assets/registration')));
  assert.deepEqual(
    calls.slice(1 + manifest.assets.length).map(call => call.route),
    [`submissions/${SUBMISSION}/submit`, `submissions/${SUBMISSION}`, `submissions/${SUBMISSION}`],
  );
  const saved = JSON.parse(await readFile(path.join(dir, '.oddbout-registration.json'), 'utf8'));
  assert.equal(saved.submissionId, SUBMISSION);
});

test('a confirmed missingAssets list uploads only those files, and a rejection is not registered', async () => {
  const { dir, manifest } = await packageDir();
  const only = manifest.assets[0].id;
  const calls = [];
  const connect = async () => ({
    request: async (route, options = {}) => {
      calls.push({ route, method: options.method });
      if (route === 'submissions' && options.method === 'POST')
        return {
          ok: true,
          stage: 'uploading',
          submissionId: SUBMISSION,
          assetUploadState: 'confirmed',
          missingAssets: [{ id: only }],
          pending: ['server-validation', 'registration'],
        };
      if (route.endsWith('/submit')) return { ok: true, stage: 'rejected', submissionId: SUBMISSION, validation: { errors: [{ code: 'ASSET_HASH' }] } };
      return { ok: true, stage: 'uploaded', assetId: only };
    },
  });
  const rejected = await runRegister({ argv: ['--dir', dir, '--submit'], connect, env: {}, wait: async () => {} });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'validation-rejected');
  assert.deepEqual(
    calls.map(call => call.route),
    ['submissions', `submissions/${SUBMISSION}/assets/${only}`, `submissions/${SUBMISSION}/submit`],
  );
});

test('assets-incomplete is reported without treating pending as asset ids, and a bad package never calls the server', async () => {
  const { dir } = await packageDir();
  const calls = [];
  const connect = async () => ({
    request: async (route, options = {}) => {
      calls.push(route);
      if (options.method === 'POST' && route === 'submissions')
        return { ok: true, stage: 'uploading', submissionId: SUBMISSION, pending: ['server-validation', 'registration'] };
      if (String(route).endsWith('/submit')) throw new Error('assets-incomplete');
      return { ok: true, stage: 'uploaded' };
    },
  });
  const incomplete = await runRegister({ argv: ['--dir', dir, '--submit'], connect, env: {}, wait: async () => {} });
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.code, 'assets-incomplete');
  assert.match(incomplete.hint, /pending is stage names/);
  assert.ok(calls.every(route => !route.includes('/assets/server-validation')));
  await writeFile(path.join(dir, 'fighter.json'), '{');
  const callsBefore = calls.length;
  await assert.rejects(runRegister({ argv: ['--dir', dir, '--submit'], connect, env: {} }), /package-invalid/);
  assert.equal(calls.length, callsBefore);
});
