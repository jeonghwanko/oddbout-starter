import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bootstrap, doctor, findBinary, resume, safeError } from '../scripts/dots-workspace.mjs';
import { guardDotsExecution, inspectProvider } from '../scripts/dots-provider.mjs';
import { INSTALL_OUTCOME_UNKNOWN, safePath, sha256 } from '../scripts/dots-safety.mjs';

const pin = 'a'.repeat(40), commit = 'b'.repeat(40), id = '11111111-1111-4111-8111-111111111111';
async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), 'oddbout-dots-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const runtime = path.join(base, 'kit'), workspace = path.join(base, 'work');
  const put = async (relative, value, root = runtime) => {
    const file = path.join(root, relative); await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value)); return file;
  };
  const pkg = { name: 'fixture', version: '0.5.4', dependencies: { fixture: '1.0.0' }, scripts: { 'dots:doctor': 'node scripts/dots-workspace.mjs doctor' } };
  await put('package.json', pkg); await put('package-lock.json', { lockfileVersion: 3, packages: { '': pkg } });
  await put('vendor/sprite-gen/sprite_gen/gen/codex_provider.py', 'def _rollout_files(sessions_root): pass\n');
  for (const file of ['scripts/dots-workspace.mjs', 'scripts/dots-provider.mjs', 'scripts/sprite-gen.mjs', 'mcp/creation-jobs.mjs']) await put(file, 'await guardDotsExecution();\n');
  const f = { base, runtime, workspace, put, pkg, calls: [], installed: true, vendorPin: pin };
  f.run = async (command, args, options) => {
    f.calls.push({ command, args, cwd: options.cwd });
    if (command !== 'git') return { code: 0, text: 'ok' };
    const text = args.join(' ');
    if (text === 'rev-parse --show-toplevel') return { code: 0, text: options.cwd };
    if (text === 'rev-parse HEAD') return { code: 0, text: options.cwd === runtime ? commit : f.vendorPin };
    if (text === 'ls-tree HEAD vendor/sprite-gen') return { code: 0, text: `160000 commit ${pin}\tvendor/sprite-gen` };
    if (text === 'branch --show-current') return { code: 0, text: 'main' };
    return { code: 0, text: '' };
  };
  f.options = { runtime, workspace, provider: 'codex' };
  f.deps = { run: f.run, find: async () => null };
  return f;
}
const exists = file => lstat(file).then(() => true, () => false);
// The launcher and the sibling module it imports, as a bundle's plugin directory carries them.
const copyLauncher = plugin => Promise.all(['launcher.mjs', 'local-files.mjs']
  .map(file => cp(new URL(`../plugins/ai-fighter/${file}`, import.meta.url), path.join(plugin, file))));

test('default doctor is offline, creates no workspace/cache and never starts a CLI or reads credentials', async t => {
  const f = await fixture(t);
  const before = await readdir(f.base);
  const report = await doctor(f.options, f.deps);
  assert.deepEqual(await readdir(f.base), before);
  assert.equal(await exists(f.workspace), false);
  assert.ok(f.calls.every(c => c.command === 'git' && !c.args.some(a => ['fetch', 'merge', 'pull'].includes(a))));
  assert.equal(report.auth.status, 'unknown'); assert.equal(report.network.status, 'not-probed');
  assert.equal(report.provider.reason, 'protected-session-output-contract');
  assert.equal(report.readyForGeneration, false); assert.equal(report.delivery.displayedVerified, false);
  for (const name of ['ffmpeg', 'ffprobe', 'img2webp', 'codex']) assert.equal(report.tools[name].status, 'missing');
  assert.equal(report.tools.rife.required, false);
});

test('official auth status is opt-in, redacted, and cannot certify images; expiry and billing stay separate', async t => {
  const f = await fixture(t);
  const secret = 'SECRET_DO_NOT_EMIT_123';
  for (const [text, code, status] of [[`Logged in using ChatGPT ${secret}`, 0, 'signed-in'],
    [`expired ${secret}`, 1, 'sign-in-required'], [`API key ${secret}`, 0, 'api-billing-blocked'], [secret, 1, 'unknown']]) {
    const report = await doctor({ ...f.options, checkAuth: true }, { ...f.deps, find: async () => '/mock/codex',
      run: async (command, args, opts) => command === 'git' ? f.run(command, args, opts) : { code, text } });
    assert.equal(report.auth.status, status); assert.equal(report.readyForGeneration, false);
    assert.equal(report.auth.imageAccess, 'unknown'); assert.ok(!JSON.stringify(report).includes(secret));
  }
  assert.equal(safeError(Error(secret)), 'workspace-inspection-failed');
});

test('caller flags and a claimed display receipt never certify delivery without bytes or current evidence', async t => {
  const f = await fixture(t), now = Date.now();
  const base = await doctor(f.options, { ...f.deps, now });
  const record = { schemaVersion: 1, environmentId: base.environmentId, ready: true, supportsImages: true,
    auth: { checkedAt: new Date(now).toISOString(), expiresAt: new Date(now - 1).toISOString(), token: 'SECRET' },
    delivery: { displayed: true, file: { path: 'output/missing.png', bytes: 3, sha256: sha256('png') } } };
  await f.put('output/receipt.json', record, f.workspace);
  let report = await doctor({ ...f.options, evidence: 'output/receipt.json', ready: true, supportsImages: true }, { ...f.deps, now });
  assert.equal(report.auth.status, 'stale-or-unknown'); assert.equal(report.delivery.status, 'blocked');
  assert.equal(report.readyForGeneration, false); assert.ok(!JSON.stringify(report).includes('SECRET'));
  await f.put('output/missing.png', 'png', f.workspace);
  report = await doctor({ ...f.options, evidence: 'output/receipt.json' }, { ...f.deps, now });
  assert.equal(report.delivery.status, 'bytes-verified-display-unverified');
  assert.equal(report.delivery.decode, 'not-checked'); assert.equal(report.delivery.displayedVerified, false);
  record.environmentId = 'different-host'; await f.put('output/receipt.json', record, f.workspace);
  assert.equal((await doctor({ ...f.options, evidence: 'output/receipt.json' }, f.deps)).reason, 'evidence-environment-mismatch');
});

test('opt-in public probes send only bounded HEAD without credentials and never imply permission or capability', async t => {
  const f = await fixture(t), calls = [];
  const report = await doctor({ ...f.options, checkNetwork: true }, { ...f.deps, fetchPublic: async (url, options) => {
    calls.push({ url, options }); return { status: 403 };
  } });
  assert.equal(calls.length, 3);
  for (const { options } of calls) { assert.equal(options.method, 'HEAD'); assert.equal(options.redirect, 'error'); assert.equal(options.headers, undefined); assert.ok(options.signal); }
  assert.equal(report.network.results[0].httpStatus, 403); assert.equal(report.readyForGeneration, false);
});

test('pin/version mismatch and source/bundle confusion are explicit blockers', async t => {
  const f = await fixture(t);
  f.vendorPin = 'c'.repeat(40);
  assert.ok((await doctor(f.options, f.deps)).blockers.includes('vendor-pin-mismatch'));
  await assert.rejects(bootstrap({ ...f.options, install: true }, f.deps), /vendor-pin-mismatch/);
  await f.put('package.json', { ...f.pkg, version: '0.2.0' });
  assert.ok((await doctor(f.options, f.deps)).blockers.includes('package-lock-mismatch'));
  await f.put('package.json', f.pkg);
  assert.ok((await doctor(f.options, { ...f.deps, run: async () => ({ code: 1, text: '' }) })).blockers.includes('source-or-bundle-layout-required'));
});

test('bootstrap reuses locked dependencies, repairs partial installs, uses scoped caches and never logs in', async t => {
  const f = await fixture(t), commands = [];
  const run = async (command, args, options) => {
    if (command === 'git') return f.run(command, args, options);
    commands.push({ command, args });
    if (command === 'npm') {
      assert.equal(options.env.npm_config_cache, path.join(f.workspace, '.cache/oddbout/npm'));
      assert.equal(options.env.PIP_CACHE_DIR, path.join(f.workspace, '.cache/oddbout/pip'));
      assert.equal(options.env.HOME, process.env.HOME); assert.equal(options.env.CODEX_HOME, process.env.CODEX_HOME);
      await f.put('node_modules/fixture/package.json', { version: '1.0.0' });
    } else if (args[1] === 'setup') {
      assert.equal(args[2], '--skip-rife');
      const python = await f.put(`vendor/sprite-gen/.venv/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`, '#!/bin/sh\nexit 0\n'); await chmod(python, 0o700);
    }
    return { code: 0, text: '' };
  };
  let result = await bootstrap({ ...f.options, install: true }, { ...f.deps, run });
  assert.equal(result.steps.length, 2); assert.equal(result.readyForGeneration, false);
  result = await bootstrap({ ...f.options, install: true }, { ...f.deps, run });
  assert.equal(result.installation, 'reused');
  await rm(path.join(f.runtime, 'node_modules/fixture/package.json'));
  result = await bootstrap({ ...f.options, install: true }, { ...f.deps, run });
  assert.deepEqual(result.steps.map(s => s.step), ['npm']);
  assert.ok(commands.every(c => !c.args.includes('login') && !c.args.includes('gen')));
});

test('failed install stops once; interrupted lock and unwritable cache are preserved', async t => {
  const f = await fixture(t); let installs = 0;
  const result = await bootstrap({ ...f.options, install: true }, { ...f.deps, run: async (c, a, o) => {
    if (c === 'git') return f.run(c, a, o); installs++; return { code: 42, text: 'SECRET=not-output' };
  } });
  assert.equal(installs, 1); assert.equal(result.steps[0].exitCode, 42); assert.equal(result.automaticRetry, false);
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  await f.put('.dots-bootstrap.lock', 'unknown-owner');
  await assert.rejects(bootstrap({ ...f.options, install: true }, f.deps), /bootstrap-busy-or-interrupted/);
  assert.equal(await readFile(path.join(f.runtime, '.dots-bootstrap.lock'), 'utf8'), 'unknown-owner');
});

test('POSIX unwritable cache blocks installation', { skip: process.platform === 'win32' ? 'Windows does not implement POSIX mode bits' : false }, async t => {
  const f = await fixture(t), cache = path.join(f.base, 'locked-cache'); await mkdir(cache, { mode: 0o500 });
  try { await assert.rejects(bootstrap({ ...f.options, cache, install: true }, f.deps), /installation-path-not-writable/); }
  finally { await chmod(cache, 0o700); }
});

test('installation timeout preserves an unknown lock and a second invocation cannot dispatch', async t => {
  const f = await fixture(t); let dispatches = 0;
  const run = async (c, a, o) => c === 'git' ? f.run(c, a, o) : (++dispatches, { code: 1, uncertain: true, text: '' });
  const result = await bootstrap({ ...f.options, install: true }, { ...f.deps, run });
  assert.equal(result.reason, 'installation-outcome-unknown'); assert.equal(dispatches, 1);
  await assert.rejects(bootstrap({ ...f.options, install: true }, { ...f.deps, run }), /bootstrap-busy-or-interrupted/);
  assert.equal(dispatches, 1);
});

test('symlinked npm or pip cache children block installation before any dispatch or workspace creation', async t => {
  const f = await fixture(t), cache = path.join(f.base, 'cache'), protectedDir = path.join(f.base, '.codex');
  await mkdir(cache); await mkdir(protectedDir);
  for (const name of ['npm', 'pip']) {
    await symlink(protectedDir, path.join(cache, name), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(bootstrap({ ...f.options, cache, install: true }, f.deps), /symlink-not-allowed/);
    assert.equal(f.calls.length, 0); assert.equal(await exists(f.workspace), false);
    await rm(path.join(cache, name));
  }
});

test('an internal sprite setup interruption keeps the lock and prevents a second install dispatch', async t => {
  const f = await fixture(t); let calls = 0;
  const run = async (c, a, o) => {
    if (c === 'git') return f.run(c, a, o);
    calls++;
    return { code: c === 'npm' ? 0 : INSTALL_OUTCOME_UNKNOWN, text: '' };
  };
  const result = await bootstrap({ ...f.options, install: true }, { ...f.deps, run });
  assert.equal(result.reason, 'installation-outcome-unknown'); assert.equal(calls, 2);
  await assert.rejects(bootstrap({ ...f.options, install: true }, { ...f.deps, run }), /bootstrap-busy-or-interrupted/);
  assert.equal(calls, 2);
});

test('resume inventories hashes and unknown jobs without any dispatch, and blocks bootstrap over existing work', async t => {
  const f = await fixture(t), content = 'existing original';
  await f.put('input/source.png', content, f.workspace);
  const file = { path: 'input/source.png', bytes: Buffer.byteLength(content), sha256: sha256(content) };
  await f.put('output/fighter-work/creation-session.json', { storeVersion: 1, sessionId: 'fighter', revision: 4,
    brief: 'SECRET', items: { idle: { versions: { v1: { files: [file] } } } } }, f.workspace);
  await f.put(`output/fighter-work/jobs/${id}.json`, { sessionId: 'fighter', jobId: id, status: 'unknown', inputs: [file],
    outputs: [], plan: { prompt: 'SECRET' } }, f.workspace);
  const result = await resume(f.options);
  assert.equal(result.sessions[0].jobs[0].nextAction, 'inspect-original-run-no-retry');
  assert.equal(result.sessions[0].evidence[0].status, 'verified-bytes'); assert.equal(result.automaticDispatch, false);
  assert.ok(result.blockers.includes('pending-or-unknown-job')); assert.ok(!JSON.stringify(result).includes('SECRET'));
  await f.put('input/source.png', 'changed', f.workspace);
  assert.ok((await resume(f.options)).blockers.includes('job-input-changed'));
  await assert.rejects(bootstrap({ ...f.options, install: true }, f.deps), /existing-work-preserved-install-blocked/);
});

test('protected paths, traversal and artifact symlinks are rejected; normal executable symlinks work', async t => {
  const f = await fixture(t);
  for (const relative of ['../outside', '.codex/sessions/a', 'input/auth.json', 'https://example.com/file'])
    await assert.rejects(safePath(relative, { root: f.runtime }));
  await symlink(f.runtime, path.join(f.base, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(doctor({ ...f.options, workspace: path.join(f.base, 'link') }, f.deps), /symlink-not-allowed/);
});

test('normal executable symlinks work', async t => {
  const f = await fixture(t);
  const binary = await f.put('bin/python-real', '#!/bin/sh\nexit 0\n'); await chmod(binary, 0o700);
  try { await symlink(binary, path.join(f.runtime, 'bin/python3')); }
  catch (e) { if (process.platform === 'win32' && e.code === 'EPERM') return t.skip('Windows file symlink privilege unavailable'); throw e; }
  assert.equal(await findBinary('python3', { PATH: path.join(f.runtime, 'bin') }), path.join(f.runtime, 'bin/python3'));
});

test('Dots blocks Codex image paths without making Grok depend on Codex source', async t => {
  const f = await fixture(t), env = { AI_FIGHTER_EXECUTION_HOST: 'dots' };
  for (const args of [['gen', '--provider', 'codex'], ['gen-set', '--provider=codex'], ['gen-motion'],
    ['video-set', '--base', 'front=still.png', '--states', 'walk', '--still-provider', 'codex']])
    await assert.rejects(guardDotsExecution(f.runtime, f.workspace, args, env), /dots-protected-session-provider-blocked/);
  await guardDotsExecution(f.runtime, f.workspace, ['game-pack'], env);
  await f.put('vendor/sprite-gen/sprite_gen/gen/codex_provider.py', '# official stdout adapter placeholder\n');
  assert.equal((await inspectProvider(f.runtime)).status, 'unknown');
  await assert.rejects(guardDotsExecution(f.runtime, f.workspace, ['gen', '--provider', 'codex'], env), /dots-generation-output-contract-unverified/);
  const grok = await doctor({ ...f.options, provider: 'grok' }, f.deps);
  assert.equal(grok.provider.provider, 'grok'); assert.equal(grok.provider.executionPolicy, 'existing-provider-checks');
  assert.equal(grok.provider.reason, 'grok-generation-and-delivery-unverified');
  assert.equal(grok.readyForGeneration, false); assert.equal(grok.auth.status, 'unknown');
});

test('bundle status is read-only; explicit install binds a reviewed hash and doctor rejects forged or corrupted provenance', async t => {
  const f = await fixture(t), plugin = path.join(f.base, 'plugin'), user = path.join(f.base, 'user');
  await mkdir(plugin);
  await copyLauncher(plugin);
  await cp(f.runtime, path.join(plugin, 'runtime'), { recursive: true });
  const files = {};
  for (const relative of ['package.json', 'package-lock.json', 'vendor/sprite-gen/sprite_gen/gen/codex_provider.py',
    'scripts/dots-workspace.mjs', 'scripts/dots-provider.mjs', 'scripts/sprite-gen.mjs', 'mcp/creation-jobs.mjs'])
    files[relative] = sha256(await readFile(path.join(plugin, 'runtime', relative)));
  const manifest = JSON.stringify({ distribution: 'source', platform: 'any', arch: 'any', spriteGenCommit: pin, files });
  await writeFile(path.join(plugin, 'runtime-manifest.json'), manifest);
  const launcher = await import(pathToFileURL(path.join(plugin, 'launcher.mjs')));
  assert.equal((await launcher.inspect({ base: user })).installed, false); assert.equal(await exists(user), false);
  await assert.rejects(launcher.initialize({ base: user, manifestSha256: '0'.repeat(64) }), /hash mismatch/);
  const installed = await launcher.initialize({ base: user, manifestSha256: sha256(manifest) });
  let report = await doctor({ ...f.options, runtime: installed.runtime }, f.deps);
  assert.ok(report.blockers.includes('bundle-trust-anchor-required'));
  const opts = { ...f.options, runtime: installed.runtime, manifestSha256: sha256(manifest) };
  report = await doctor(opts, f.deps); assert.equal(report.kit.distribution, 'bundle');
  await writeFile(path.join(installed.runtime, 'package.json'), JSON.stringify({ ...f.pkg, compromised: true }));
  report = await doctor(opts, f.deps); assert.ok(report.blockers.includes('bundle-integrity-invalid'));
  await assert.rejects(launcher.inspect({ base: user }), /integrity/);
});

test('invalid install options and old runtimes fail before an install subprocess or workspace write', async t => {
  const f = await fixture(t);
  for (const options of [{ provider: 'invalid' }, { evidence: '../escape' }, { report: '../escape' }])
    await assert.rejects(bootstrap({ ...f.options, install: true, ...options }, f.deps));
  await f.put('package.json', { ...f.pkg, scripts: {} });
  await assert.rejects(bootstrap({ ...f.options, install: true }, f.deps), /dots-runtime-contract-missing/);
  assert.equal(await exists(f.workspace), false);
  assert.ok(f.calls.every(call => call.command === 'git'));
});

test('launcher rejects symlink metadata before reading its contents', async t => {
  const f = await fixture(t), plugin = path.join(f.base, 'unsafe-plugin');
  await mkdir(plugin); await copyLauncher(plugin);
  const launcher = await import(pathToFileURL(path.join(plugin, 'launcher.mjs')));
  const target = await f.put('.codex/auth.json', 'SECRET', f.base);
  try { await symlink(target, path.join(plugin, 'runtime-manifest.json')); }
  catch (e) { if (process.platform === 'win32' && e.code === 'EPERM') return t.skip('Windows file symlink privilege unavailable'); throw e; }
  await assert.rejects(launcher.inspect({ base: path.join(f.base, 'user') }), /symlink/);
  await assert.rejects(launcher.initialize({ base: path.join(f.base, 'user') }), /symlink/);
});

test('a known WebP network failure identifies the preparer without leaking child output', async t => {
  const f = await fixture(t);
  const result = await bootstrap({ ...f.options, install: true }, { ...f.deps, run: async (c, a, o) => {
    if (c === 'git') return f.run(c, a, o);
    return c === 'npm' ? { code: 0, text: '' } : { code: 1,
      text: 'SECRET=never-report\nimg2webp: network network-connect-forbidden host=storage.googleapis.com\n' };
  } });
  assert.deepEqual(result.diagnostic, { actor: 'environment-preparer', reason: 'network-connect-forbidden', host: 'storage.googleapis.com' });
  assert.equal(result.automaticRetry, false); assert.doesNotMatch(JSON.stringify(result), /SECRET|never-report/);
});

test('Grok auth storage is checked before probing, keeps its selector, and never certifies media access', async t => {
  const f = await fixture(t);
  const target = path.join(f.base, 'private-grok'); await mkdir(target, { mode: 0o700 });
  const env = { GROK_HOME: target }, calls = [];
  const deps = { ...f.deps, env, run: async (command, args, opts) => {
    if (command === 'git') return f.run(command, args, opts);
    calls.push({ command, args, env: opts.env });
    return { code: 0, text: JSON.stringify({ login: 'ready', billing: 'subscription' }) };
  } };
  const options = { ...f.options, provider: 'grok', checkAuth: true };
  const report = await doctor(options, deps);
  assert.equal(calls.length, 1); assert.equal(calls[0].env.GROK_HOME, target);
  assert.equal(report.auth.status, 'signed-in');
  assert.equal(report.auth.storage.status, 'permission-available');
  assert.equal(report.auth.storage.loginSaveVerified, false);
  assert.equal(report.auth.imageAccess, 'unknown'); assert.equal(report.auth.videoAccess, 'unknown');
  assert.deepEqual(await readdir(target), []);
  calls.length = 0;
  const blocked = await doctor(options, { ...deps, env: { GROK_HOME: 'relative' } });
  assert.equal(calls.length, 0); assert.equal(blocked.auth.status, 'unknown');
  assert.equal(blocked.auth.storage.reason, 'grok-auth-storage-path-invalid');
});
