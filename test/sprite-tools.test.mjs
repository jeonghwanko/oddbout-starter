import { test } from 'node:test';
import { run, setupTools } from '../scripts/sprite-gen.mjs';
import { INSTALL_OUTCOME_UNKNOWN } from '../scripts/dots-safety.mjs';
import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { LIBWEBP, img2webpInstall, inspectRife, inspectTools, installImg2webp, toolBin, toolEnv, toolsItem, which } from '../scripts/sprite-tools.mjs';

async function directory(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sprite-tools-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const present = file => access(file).then(() => true, () => false);
// A fake machine: programs by name, each answering -version / -h.
const machine = programs => ({
  find: async name => programs[name] ? `/usr/bin/${name}` : null,
  probe: async (command, args) => {
    const program = programs[path.basename(command)];
    return program ? program(args) : { code: 1, output: 'python missing' };
  },
});
const ffmpeg = () => ({ code: 0, output: 'ffmpeg version 6.1.1-3ubuntu5 Copyright' });
const oldWebp = args => ({ code: 0, output: args[0] === '-version' ? 'WebP Encoder version: 1.3.2\n' : 'Usage: img2webp [file_options] [[frame_options] frame_file]...\n -lossless\n' });
const newWebp = args => ({ code: 0, output: args[0] === '-version' ? 'WebP Encoder version: 1.6.0\n' : ' -exact, -noexact ..... preserve or alter RGB values in transparent area\n' });

test('tools are classified as sprite-gen sees them: missing, broken (img2webp without -exact) or ok', async () => {
  const tools = await inspectTools({ spriteRoot: '/kit/vendor/sprite-gen', env: {}, platform: 'linux', arch: 'x64', rife: false,
    ...machine({ ffmpeg, img2webp: oldWebp }) });
  assert.deepEqual([tools.ffmpeg.status, tools.ffmpeg.version], ['ok', '6.1.1-3ubuntu5']);
  assert.equal(tools.ffprobe.status, 'missing');
  assert.deepEqual([tools.img2webp.status, tools.img2webp.version], ['broken', '1.3.2']);
  assert.match(tools.img2webp.reason, /-exact/);
  const item = toolsItem(tools);
  assert.equal(item.status, 'action-required'); assert.deepEqual(item.missing, ['ffprobe', 'img2webp']);
  // The kit fetches img2webp itself; ffmpeg needs the workspace preparer (sudo), which the kit never runs.
  assert.deepEqual(item.nextCommands, ['npm run sprite:setup']);
  assert.deepEqual(item.nextAction.commands, ['sudo apt install ffmpeg']);
  assert.equal(item.ffprobe.install.actor, 'user'); assert.equal(item.ffprobe.install.sudo, true);
  const ready = toolsItem(await inspectTools({ env: {}, platform: 'linux', arch: 'x64', rife: false, ...machine({ ffmpeg, ffprobe: ffmpeg, img2webp: newWebp }) }));
  assert.deepEqual([ready.status, ready.img2webp.status, ready.img2webp.version, ready.nextCommands, ready.nextAction], ['ready', 'ok', '1.6.0', [], undefined]);
});

test('light setup omits RIFE probing and download while repairing required img2webp', async () => {
  let installed = false;
  const forbidden = () => assert.fail('Optional RIFE must not be probed or installed');
  assert.equal(await setupTools({ includeRife: false, inspectOptional: forbidden, execute: forbidden, log: () => {},
    installWebp: async () => { installed = true; return '/fixture/img2webp'; },
    inspect: async options => {
      assert.equal(options.rife, false);
      return { ffmpeg: { status: 'ok' }, ffprobe: { status: 'ok' },
        img2webp: { status: installed ? 'ok' : 'missing', install: { actor: 'agent', command: 'fixture' } } };
    } }), 0);
  assert.equal(installed, true);
});

test('an interrupted setup subprocess preserves its unknown outcome exit code', async () => {
  assert.equal(await run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeout: 50 }), INSTALL_OUTCOME_UNKNOWN);
});

test('a broken ffmpeg is reported with its own message, not as missing', async () => {
  const tools = await inspectTools({ env: {}, platform: 'darwin', arch: 'arm64', rife: false,
    ...machine({ ffmpeg: () => ({ code: 127, output: 'dyld: Library not loaded: libavdevice.61.dylib' }), ffprobe: ffmpeg, img2webp: newWebp }) });
  assert.equal(tools.ffmpeg.status, 'broken'); assert.match(tools.ffmpeg.reason, /libavdevice/);
  assert.equal(tools.ffmpeg.install.command, 'brew install ffmpeg'); assert.equal(tools.ffmpeg.install.sudo, false);
});

test('install advice per platform: a pinned libwebp download where one exists, else the system package', () => {
  for (const [platform, arch] of [['linux', 'x64'], ['linux', 'arm64'], ['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']])
    assert.deepEqual([platform, img2webpInstall(platform, arch).actor, img2webpInstall(platform, arch).command], [platform, 'agent', 'npm run sprite:setup']);
  assert.equal(img2webpInstall('linux', 'riscv64').actor, 'user');
  assert.equal(img2webpInstall('linux', 'riscv64').sudo, false);
  for (const [, [name, sha]] of Object.entries(LIBWEBP.archives)) {
    assert.ok(name.startsWith(`libwebp-${LIBWEBP.version}-`)); assert.match(sha, /^[0-9a-f]{64}$/);
  }
});

test('RIFE is optional: missing before sprite-gen exists, and a failed check frame points at Vulkan, not a reinstall', async t => {
  const dir = await directory(t), python = path.join(dir, 'python');
  const absent = await inspectRife({ python, env: {}, platform: 'linux' });
  assert.deepEqual([absent.status, absent.reason, absent.required, absent.install.command], ['missing', 'sprite-gen-not-installed', false, 'npm run sprite:setup']);
  await writeFile(python, '');
  const answer = json => async () => ({ code: 0, output: `rife install: downloading\n${JSON.stringify(json)}\n` });
  assert.equal((await inspectRife({ python, env: {}, probe: answer({ status: 'ok', path: '/r/rife-ncnn-vulkan', version: '20221029' }) })).status, 'ok');
  const missing = await inspectRife({ python, env: {}, probe: answer({ status: 'missing', reason: 'rife-ncnn-vulkan not found' }) });
  assert.equal(missing.install.actor, 'agent');
  const broken = await inspectRife({ python, env: {}, platform: 'linux', probe: answer({ status: 'broken', reason: 'installed, but the check frame failed: vkCreateInstance failed' }) });
  assert.deepEqual([broken.status, broken.install.actor, broken.install.command], ['broken', 'user', 'sudo apt install libvulkan1 mesa-vulkan-drivers']);
  const garbled = await inspectRife({ python, env: {}, probe: async () => ({ code: 1, output: 'Traceback: ModuleNotFoundError' }) });
  assert.equal(garbled.status, 'broken'); assert.match(garbled.reason, /ModuleNotFoundError/);
  // RIFE never blocks readiness; it only warns.
  const item = toolsItem({ ffmpeg: { status: 'ok' }, ffprobe: { status: 'ok' }, img2webp: { status: 'ok' }, rife: missing });
  assert.equal(item.status, 'ready'); assert.deepEqual(item.warnings.map(w => [w.tool, w.command]), [['rife', 'npm run sprite:setup']]);
});

test('a working RIFE reports its resident binary; one sprite:setup can install is missing, with the setup command, and never a warning', async t => {
  const dir = await directory(t), python = path.join(dir, 'python');
  await writeFile(python, '');
  const answer = serve => async () => ({ code: 0, output: `${JSON.stringify({ status: 'ok', path: '/r/rife-ncnn-vulkan', version: '20221029', serve })}\n` });
  const missing = await inspectRife({ python, env: {}, probe: answer({ status: 'missing' }) });
  assert.deepEqual([missing.status, missing.serve.status, missing.serve.install.actor, missing.serve.install.command], ['ok', 'missing', 'agent', 'npm run sprite:setup']);
  assert.match(missing.serve.effectWhenMissing, /once per frame/);
  for (const serve of [{ status: 'ok', path: '/r/rife-ncnn-vulkan-serve' }, { status: 'off', reason: 'SPRITE_GEN_RIFE_SERVE is set empty' },
    { status: 'not-offered', reason: 'no resident binary is released for macos arm64' }, { status: 'broken', reason: 'not an executable file' }]) {
    const found = await inspectRife({ python, env: {}, probe: answer(serve) });
    assert.deepEqual(found.serve, serve, serve.status); // only a missing one gets an install
  }
  const item = toolsItem({ ffmpeg: { status: 'ok' }, ffprobe: { status: 'ok' }, img2webp: { status: 'ok' }, rife: missing });
  assert.deepEqual([item.status, item.warnings], ['ready', []]);
});

test('setup runs rife install for a missing RIFE and for a working one without its resident binary, and shows the binary', async () => {
  const ok = { ffmpeg: { status: 'ok' }, ffprobe: { status: 'ok' }, img2webp: { status: 'ok' } };
  const rifeOk = serve => ({ status: 'ok', required: false, path: '/r/rife-ncnn-vulkan', version: '20221029', serve });
  const setup = async (before, after) => {
    const installs = [], lines = [];
    let probes = 0;
    assert.equal(await setupTools({ inspect: async () => ok, log: line => lines.push(line),
      inspectOptional: async () => (probes++ ? after : before),
      execute: async (command, args) => { installs.push(args.join(' ')); return 0; } }), 0);
    return { installs, lines, probes };
  };
  const install = ['-m sprite_gen.cli rife install'];
  // RIFE installed before the resident binary existed: rife install keeps it (only its check) and adds the binary beside it.
  const added = await setup(rifeOk({ status: 'missing' }), rifeOk({ status: 'ok', path: '/r/rife-ncnn-vulkan-serve' }));
  assert.deepEqual([added.installs, added.probes], [install, 2]);
  assert.ok(added.lines.some(line => /^ {2}rife-serve +ok +\/r\/rife-ncnn-vulkan-serve$/.test(line)), added.lines.join('\n'));
  assert.deepEqual((await setup({ status: 'missing', required: false }, rifeOk({ status: 'ok', path: '/r/s' }))).installs, install);
  // Nothing rife install could add: no second run, every setup.
  for (const serve of [{ status: 'ok', path: '/r/s' }, { status: 'off', reason: 'set empty' }, { status: 'not-offered', reason: 'macos' }, { status: 'broken', reason: 'x' }]) {
    const kept = await setup(rifeOk(serve), rifeOk(serve));
    assert.deepEqual([kept.installs, kept.probes], [[], 1], serve.status);
    assert.ok(kept.lines.some(line => line.startsWith(`  rife-serve ${serve.status}`)), kept.lines.join('\n'));
  }
  // A refused or failed download leaves RIFE working as before: still missing, shown with what it costs, and setup does not fail.
  const refused = await setup(rifeOk({ status: 'missing' }), (await inspectRifeFixture({ status: 'missing' })));
  assert.ok(refused.lines.some(line => line.startsWith('  rife-serve missing') && line.includes('once per frame')), refused.lines.join('\n'));
});

/** inspectRife's answer for a working RIFE whose resident binary is `serve`. */
async function inspectRifeFixture(serve) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sprite-tools-')), python = path.join(dir, 'python');
  try {
    await writeFile(python, '');
    return await inspectRife({ python, env: {}, probe: async () => ({ code: 0, output: JSON.stringify({ status: 'ok', path: '/r/rife-ncnn-vulkan', version: '20221029', serve }) }) });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('sprite-gen runs with the kit venv first on PATH, keeping a single PATH key', () => {
  const env = toolEnv('/kit/vendor/sprite-gen', { Path: 'C:\\Windows', OTHER: '1' });
  assert.deepEqual(Object.keys(env).sort(), ['OTHER', 'Path']);
  assert.equal(env.Path.split(path.delimiter)[0], toolBin('/kit/vendor/sprite-gen'));
  assert.equal(toolEnv('/s', {}).PATH, toolBin('/s'));
});

test('which follows PATH order and needs an executable file', { skip: process.platform === 'win32' }, async t => {
  const dir = await directory(t), first = path.join(dir, 'a'), second = path.join(dir, 'b');
  await mkdir(first); await mkdir(second);
  await writeFile(path.join(first, 'img2webp'), 'not executable');
  await writeFile(path.join(second, 'img2webp'), '#!/bin/sh\n'); await chmod(path.join(second, 'img2webp'), 0o755);
  assert.equal(await which('img2webp', { PATH: [first, second].join(path.delimiter) }), path.join(second, 'img2webp'));
  assert.equal(await which('img2webp', { PATH: first }), null);
});

const python3 = spawnSync('python3', ['--version']).status === 0 ? 'python3' : null;
test('the pinned img2webp is unpacked into the kit venv only after its SHA-256 matches', { skip: process.platform === 'win32' || !python3 }, async t => {
  const dir = await directory(t), spriteRoot = path.join(dir, 'sprite-gen'), top = `libwebp-${LIBWEBP.version}-linux-x86-64`;
  await mkdir(path.join(dir, 'src', top, 'bin'), { recursive: true });
  await writeFile(path.join(dir, 'src', top, 'bin', 'img2webp'), '#!/bin/sh\necho " -exact, -noexact"\n');
  await writeFile(path.join(dir, 'src', top, 'README.md'), 'libwebp\n');
  await writeFile(path.join(dir, 'src', top, 'bin', 'cwebp'), 'not kept');
  const archivePath = path.join(dir, `${top}.tar.gz`);
  assert.equal(spawnSync('tar', ['czf', archivePath, '-C', path.join(dir, 'src'), top]).status, 0);
  const options = { spriteRoot, python: python3, platform: 'linux', arch: 'x64', archivePath, log: () => {} };
  await assert.rejects(installImg2webp(options), /SHA-256 .*nothing was installed/);
  assert.equal(await present(path.join(toolBin(spriteRoot), 'img2webp')), false);
  const pinned = LIBWEBP.archives['linux-x64'];
  LIBWEBP.archives['linux-x64'] = [pinned[0], createHash('sha256').update(await readFile(archivePath)).digest('hex')];
  t.after(() => { LIBWEBP.archives['linux-x64'] = pinned; });
  const installed = await installImg2webp(options);
  assert.equal(installed, path.join(toolBin(spriteRoot), 'img2webp'));
  assert.equal(spawnSync(installed, []).stdout.toString().trim(), '-exact, -noexact');
  assert.equal(await present(path.join(toolBin(spriteRoot), 'cwebp')), false);
  assert.equal(JSON.parse(await readFile(path.join(toolBin(spriteRoot), 'libwebp-install.json'), 'utf8')).version, LIBWEBP.version);
  // Found through the env sprite-gen gets, ahead of an older system img2webp.
  assert.equal(await which('img2webp', toolEnv(spriteRoot, { PATH: '/usr/bin' })), installed);
});
