import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { JOIN_CODE as API_JOIN_CODE, HOST_SETUP_STAGES as API_SETUP_STAGES } from '../api/generations.mjs';
import { pinProblems, PLATFORMS } from './check-pins.mjs';
import { aboutHealth, spritePython } from './generation-worker.mjs';
import { HOST_FILES, checkSystem, defaultRoot, hostEnv, readHostEnv } from './install.mjs';
import { download, readZip, unzip, zipEntry } from './pinned.mjs';
import { JOIN_CODE, PINS, STAGES, VERSION, installKit, parseArgs, pcName, runRunner, takeLock } from './runner.mjs';

// npx oddbout-host (계획 1.3, 2026-11-07): the npm package, its pins, its downloads and the first run, against a fake API and a fake og.
const here = path.dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const tmp = prefix => mkdtemp(path.join(os.tmpdir(), prefix));

/** A ZIP as the kit's and ffmpeg's are written: stored or deflated entries, Unix modes. */
function makeZip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name), data = Buffer.from(file.data ?? ''), method = file.method ?? 8;
    const body = method === 8 ? deflateRawSync(data) : data, crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE((3 << 8) | 20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(((file.mode ?? 0o100644) << 16) >>> 0, 38); entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}
/** A creator-kit release as fetch-creator-kit.py and the runner read it: runtime/ files and the manifest of their hashes. */
function makeKit(files, version = '9.9.9') {
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, spriteGenCommit: 'e'.repeat(40),
    files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, sha(Buffer.from(data))])) }));
  const zip = makeZip([{ name: 'plugin.json', data: '{}' }, { name: 'runtime-manifest.json', data: manifest },
    ...Object.entries(files).map(([name, data]) => ({ name: `runtime/${name}`, data }))]);
  return { zip, pin: { version, url: `https://oddbout.com/creator-kit/${version}/x/oddbout-${version}.zip`, bytes: zip.length, sha256: sha(zip),
    runtime: 'runtime/', runtimeManifestSha256: sha(manifest), spriteGenCommit: 'e'.repeat(40) } };
}
/** fetch for fixed bytes per URL (and a count of the calls). */
const bytesFetcher = table => {
  const fetcher = async url => { fetcher.calls.push(url); const body = table[url]; return body ? new Response(body) : new Response('no', { status: 404 }); };
  fetcher.calls = [];
  return fetcher;
};

test('pins.json pins every download for every platform the runner serves, and agrees with og.mjs, the CLIs\' lockfiles and the kit\'s site', async () => {
  assert.deepEqual(pinProblems(PINS), []);
  const site = JSON.parse(await readFile(path.join(here, '..', 'deploy', 'creator-site.json'), 'utf8'));
  assert.deepEqual(PINS.service, { apiBase: site.apiBase, publishableKey: site.publishableKey });
  assert.equal(JOIN_CODE.source, API_JOIN_CODE.source);
  assert.deepEqual(STAGES, ['kit', 'python', 'sprite', 'ffmpeg', 'grok-login', 'codex-login', 'ready']);
  assert.deepEqual(STAGES, API_SETUP_STAGES); // the steps the server passes on to the site's My PC card
  // A broken pin is named, not passed.
  const broken = structuredClone(PINS);
  broken.cli.grok.version = '1.0.53'; delete broken.python.builds['darwin-arm64']; broken.ffmpeg.builds['linux-x64'][1].files = {};
  const problems = pinProblems(broken).join('\n');
  assert.match(problems, /cli\.grok: 1\.0\.53 but og\.mjs pins 1\.0\.52/);
  assert.match(problems, /python\.darwin-arm64/);
  assert.match(problems, /ffmpeg\.linux-x64/);
  assert.equal(PLATFORMS.length, 6);
});

test('the npm package carries host/\'s install and nothing it does not run: npm pack lists HOST_FILES, og.mjs, the runner, its pins and lockfiles', async () => {
  const pkg = JSON.parse(await readFile(path.join(here, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'oddbout-host'); assert.equal(pkg.version, VERSION);
  assert.deepEqual(pkg.bin, { 'oddbout-host': 'runner.mjs' });
  for (const name of [...HOST_FILES, 'og.mjs']) assert.ok(pkg.files.includes(name), `the package lacks ${name}`);
  // Every module a shipped file imports is shipped (a flat npx cache has nothing else of this repository).
  for (const name of pkg.files.filter(name => name.endsWith('.mjs')))
    for (const [, local] of (await readFile(path.join(here, name), 'utf8')).matchAll(/^import [^;]*? from '\.\/([^']+)';/gm))
      assert.ok(pkg.files.includes(local), `${name} imports ${local}, which the package does not carry`);
  assert.ok(!pkg.files.includes('check-pins.mjs'));
  assert.match(readFileSync(path.join(here, 'runner.mjs'), 'utf8'), /^#!\/usr\/bin\/env node\n/);
  const npm = [process.env.npm_execpath && path.join(path.dirname(process.env.npm_execpath), 'npm-cli.js'),
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].find(file => file && existsSync(file));
  const packed = spawnSync(process.execPath, [npm, 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: here, encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  const listed = JSON.parse(packed.stdout)[0].files.map(file => file.path).sort();
  assert.deepEqual(listed, [...pkg.files, 'package.json', 'README.md'].sort());
});

test('a ZIP is read from its central directory, each entry checked, and a name that could leave the folder refused', async () => {
  const zip = makeZip([{ name: 'a/', data: '' }, { name: 'a/b.txt', data: 'hello' }, { name: 'c.bin', data: Buffer.alloc(2000, 7), method: 0, mode: 0o100755 }]);
  const entries = readZip(zip);
  assert.deepEqual(entries.map(e => [e.name, e.directory, e.size]), [['a/', true, 0], ['a/b.txt', false, 5], ['c.bin', false, 2000]]);
  assert.equal(zipEntry(zip, entries[1]).toString(), 'hello');
  assert.equal(entries[2].mode, 0o755);
  for (const name of ['../evil', '/etc/passwd', 'a\\..\\b', 'C:/x', 'a/../../b', 'a//b'])
    assert.throws(() => readZip(makeZip([{ name, data: 'x' }])), /zip-invalid: unsafe name/, name);
  assert.throws(() => readZip(makeZip([{ name: 'link', data: 'target', mode: 0o120777 }])), /symbolic link/);
  // A changed byte in a stored entry fails its CRC; in a deflated one, its inflation.
  const damaged = Buffer.from(zip); damaged[entries[2].offset + 30 + 'c.bin'.length + 10] ^= 0xff;
  assert.throws(() => zipEntry(damaged, readZip(damaged)[2]), /zip-invalid: damaged c.bin/);
  damaged[entries[1].offset + 30 + 'a/b.txt'.length] ^= 0xff;
  assert.throws(() => zipEntry(damaged, readZip(damaged)[1]), /zip-invalid/);
  const dir = await tmp('runner-zip-');
  try {
    const file = path.join(dir, 'x.zip'); await writeFile(file, zip);
    assert.deepEqual(await unzip(file, path.join(dir, 'out'), name => name === 'a/b.txt' ? 'b.txt' : null), ['b.txt']);
    assert.equal(await readFile(path.join(dir, 'out', 'b.txt'), 'utf8'), 'hello');
    assert.ok(!existsSync(path.join(dir, 'out', 'c.bin')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a pinned download is used only with its pinned size and SHA-256, kept for the next run, and never left half-written', async () => {
  const dir = await tmp('runner-download-'), bytes = Buffer.from('the pinned bytes');
  const pin = { url: 'https://example.com/a.zip', bytes: bytes.length, sha256: sha(bytes) };
  try {
    const fetcher = bytesFetcher({ [pin.url]: bytes });
    const file = await download(pin, dir, { fetcher });
    assert.deepEqual(await readFile(file), bytes);
    await download(pin, dir, { fetcher });
    assert.equal(fetcher.calls.length, 1, 'a kept file with the pinned hash is not fetched again');
    // Other bytes of the same size: refused at once, nothing kept.
    const other = { ...pin, url: 'https://example.com/b.zip', sha256: sha('another value!!!') };
    await assert.rejects(download(other, dir, { fetcher: bytesFetcher({ [other.url]: bytes }) }), { code: 'pin-mismatch' });
    assert.ok(!existsSync(path.join(dir, other.sha256)) && !existsSync(path.join(dir, `${other.sha256}.part`)));
    // More bytes than pinned, or a server that keeps failing: tried again, then download-failed.
    const long = { url: 'https://example.com/c.zip', bytes: 3, sha256: sha('abc') };
    const flaky = bytesFetcher({ [long.url]: Buffer.from('abcdef') });
    await assert.rejects(download(long, dir, { fetcher: flaky }), { code: 'download-failed' });
    assert.equal(flaky.calls.length, 3);
    await assert.rejects(download({ url: 'http://example.com/x', bytes: 1, sha256: sha('x') }, dir), { code: 'pin-invalid' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the kit comes from its pinned ZIP: every runtime file against the release manifest, the jobs kept, no Git left to need', async () => {
  const root = await tmp('runner-kit-');
  const { zip, pin } = makeKit({ 'package.json': '{"name":"kit"}', 'scripts/sprite-gen.mjs': '// x\n', 'vendor/sprite-gen/SKILL.md': '# s\n' });
  const deps = { fetcher: bytesFetcher({ [pin.url]: zip }), platform: process.platform, env: process.env };
  try {
    await mkdir(path.join(root, 'kit', 'output', '20261107-gen-a'), { recursive: true });
    await writeFile(path.join(root, 'kit', 'output', '20261107-gen-a', 'request.json'), '{}');
    await writeFile(path.join(root, 'kit', 'stale.txt'), 'from the kit before');
    await installKit(root, pin, deps);
    assert.equal(await readFile(path.join(root, 'kit', 'vendor', 'sprite-gen', 'SKILL.md'), 'utf8'), '# s\n');
    assert.ok(existsSync(path.join(root, 'kit', 'output', '20261107-gen-a', 'request.json')), 'the jobs stay');
    assert.ok(!existsSync(path.join(root, 'kit', 'stale.txt')), 'nothing of the kit before');
    assert.ok(!existsSync(path.join(root, 'kit', 'plugin.json')), 'only runtime/');
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'kit', '.oddbout-kit.json'), 'utf8')), { version: '9.9.9', sha256: pin.sha256, spriteGenCommit: 'e'.repeat(40) });
    // A release whose files do not match its manifest, or another engine than pinned: refused, the kit as it was.
    const bad = makeKit({ 'package.json': '{}' });
    const lying = makeZip([{ name: 'runtime-manifest.json', data: readZip(bad.zip).find(e => e.name === 'runtime-manifest.json') && zipEntry(bad.zip, readZip(bad.zip).find(e => e.name === 'runtime-manifest.json')) },
      { name: 'runtime/package.json', data: '{"changed":true}' }]);
    await assert.rejects(installKit(root, { ...bad.pin, url: 'https://e/l.zip', bytes: lying.length, sha256: sha(lying) }, { ...deps, fetcher: bytesFetcher({ 'https://e/l.zip': lying }) }), { code: 'kit-invalid' });
    await assert.rejects(installKit(root, { ...pin, spriteGenCommit: 'f'.repeat(40) }, deps), { code: 'kit-invalid' });
    assert.ok(existsSync(path.join(root, 'kit', 'vendor', 'sprite-gen', 'SKILL.md')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the install folder is the OS\'s own per-user data folder, and checkSystem asks the runner\'s PC for less than npm run host', () => {
  assert.equal(defaultRoot({ LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'win32', 'C:\\Users\\a'), 'C:\\Users\\a\\AppData\\Local\\oddbout-host');
  assert.equal(defaultRoot({}, 'darwin', '/Users/a'), '/Users/a/Library/Application Support/oddbout-host');
  assert.equal(defaultRoot({}, 'linux', '/home/a'), '/home/a/.local/share/oddbout-host');
  assert.equal(defaultRoot({ XDG_DATA_HOME: '/data' }, 'linux', '/home/a'), '/data/oddbout-host');
  assert.equal(defaultRoot({ ODDBOUT_HOST_ROOT: '/x' }, 'win32'), '/x');
  // macOS's folder has a space; host.env takes it.
  assert.match(hostEnv({ nodeBin: '/opt/homebrew/bin', toolPath: '/Users/a/Library/Application Support/oddbout-host/ffmpeg-9.0.2', platform: 'darwin' }), /TOOL_PATH=\/Users\/a\/Library\/Application Support/);
  // The runner's PC: Node 22.12+, tar; Python and ffmpeg optional (it brings its own); the store's python alias is not a Python.
  const base = { runner: true, memory: 32 * 2 ** 30, run: () => true, env: { SystemRoot: os.tmpdir() } };
  const mac = checkSystem({ ...base, platform: 'darwin', node: '22.12.0', find: name => name === 'tar' ? '/usr/bin/tar' : '', ask: () => null });
  assert.deepEqual([mac.missing, mac.python, mac.ffmpeg], [[], '', '']);
  assert.match(checkSystem({ ...base, platform: 'darwin', node: '22.11.0', find: () => '/usr/bin/tar', ask: () => null }).missing[0], /Node 22\.12/);
  const asked = [];
  const found = checkSystem({ ...base, platform: 'darwin', node: '24.1.0', find: name => `/usr/local/bin/${name}`,
    ask: (command, args) => { asked.push(command); return command.endsWith('python3.12') ? '/opt/py/bin/python3.12\n' : null; } });
  assert.equal(found.python, '/opt/py/bin/python3.12');
  const win = checkSystem({ ...base, platform: 'win32', arch: 'arm64', node: '22.12.0', find: name => name === 'python' ? 'C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe' : '',
    ask: () => { throw new Error('the store alias is never run'); } });
  assert.equal(win.python, '');
  assert.match(win.warnings.join('\n'), /arm64/);
  const linux = checkSystem({ ...base, platform: 'linux', node: '22.12.0', find: name => `/usr/bin/${name}`, ask: () => null, run: command => command !== 'systemctl' });
  assert.match(linux.missing.join('\n'), /systemd 사용자 관리자/);
  assert.equal(checkSystem({ ...base, platform: 'linux', node: '22.12.0', find: name => `/usr/bin/${name}`, ask: () => null }).ffmpeg, '/usr/bin');
  // npm run host stays Linux's, and names the runner to the others.
  assert.match(checkSystem({ platform: 'win32' }).missing[0], /npx oddbout-host/);
});

test('the command line, the PC\'s name, one runner per install, and heartbeats that never claim more than the logins say', async () => {
  assert.deepEqual(parseArgs([]), { command: 'start', replace: false, once: false });
  assert.deepEqual(parseArgs(['login', 'codex', '--replace']), { command: 'login', provider: 'codex', replace: true, once: false });
  assert.equal(parseArgs(['--no-codex', '--slots', '3']).slots, 3);
  assert.throws(() => parseArgs(['--slots', '4']), /--slots/);
  assert.throws(() => parseArgs(['remove']), /모르는 명령/);
  assert.throws(() => parseArgs(['--name']), /값이 필요하다/);
  assert.equal(pcName('  내\n작업실  '), '내 작업실');
  assert.equal(pcName('x'.repeat(60)).length, 40);
  assert.equal(pcName(''), 'My PC');
  const root = await tmp('runner-lock-');
  try {
    const release = takeLock(root, 100, () => true);
    assert.equal(takeLock(root, 200, () => true), null, 'another live runner holds it');
    release();
    writeFileSync(path.join(root, 'runner.lock'), '300');
    assert.equal(typeof takeLock(root, 200, () => false), 'function', 'a dead runner\'s lock is taken over');
  } finally { await rm(root, { recursive: true, force: true }); }
  assert.deepEqual(aboutHealth({ ok: false, grok: false }, { ok: true, setup: 'ready', platform: 'windows' }), { ok: false, grok: false, setup: 'ready', platform: 'windows' });
  assert.deepEqual(aboutHealth({ ok: true }, null), { ok: true });
});

/** The fake world of one PC: the API (pairing, heartbeats), og, npm and the person at the terminal. */
async function world({ root, kit, health = 'og: codex NOT READY — not signed in\nog: grok NOT READY — not signed in\n', approveAfter = 2 }) {
  const api = PINS.service.apiBase, key = `afw_${'c'.repeat(64)}`;
  const lines = [], beats = [], ogCalls = [], opened = [], npmCalls = [];
  let polls = 0, signedIn = health, asked = 0, revoked = '';
  const fetcher = async (url, init = {}) => {
    const route = url.startsWith(api) ? url.slice(api.length + 1) : url;
    const body = init.body ? JSON.parse(init.body) : null;
    if (url === kit.pin.url) return new Response(kit.zip);
    if (route === 'spec') return Response.json({ ok: true, data: { registration: { hostPairing: 'v1' } } });
    if (route === 'generations/host/pairings') {
      assert.equal(init.headers.apikey, PINS.service.publishableKey);
      assert.deepEqual(body, { name: '작업실 PC', platform: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux' });
      return Response.json({ ok: true, pairingCode: `ohp_${'a'.repeat(64)}`, userCode: 'BCDF-GHJK', interval: 5,
        expiresAt: new Date(Date.now() + 600_000).toISOString(), url: 'https://oddbout.com/creator.html#pc=BCDF-GHJK' });
    }
    if (route === 'generations/host/pairings/token') {
      polls += 1;
      return polls < approveAfter ? Response.json({ ok: true, status: 'pending', interval: 5 })
        : Response.json({ ok: true, status: 'approved', key, host: 'h1', name: 'My PC', approved: false });
    }
    if (route === 'generation-worker/heartbeat') {
      if (init.headers.authorization === `Bearer ${revoked}`) return Response.json({ ok: false, code: 'worker-required' }, { status: 403 });
      assert.equal(init.headers.authorization, `Bearer ${key}`);
      beats.push(body.health);
      return Response.json({ ok: true });
    }
    throw new Error(`unexpected ${url}`);
  };
  const og = about => ({
    about,
    main: async (args, io = {}) => {
      const stdin = io.stdin ? await io.stdin() : undefined;
      ogCalls.push(args.join(' ') + (stdin !== undefined ? ` <${stdin.trim().slice(0, 4)}` : ''));
      if (args[0] === 'worker' && args[1] === 'key') await writeFile(path.join(root, 'worker.env'), `ODDBOUT_GENERATION_API=${args[2]}\nODDBOUT_GENERATION_WORKER_KEY=${stdin.trim()}\n`);
      if (args[0] === 'login') { io.out?.('Open https://accounts.x.ai/device and enter WXYZ\n'); signedIn = signedIn.replace(new RegExp(`og: ${args[1]} NOT READY[^\n]*`), `og: ${args[1]} ok (me@x)`); }
      if (args[0] === 'health') io.out?.(signedIn);
      return { code: 0 };
    },
    health: async () => { ogCalls.push('health'); return signedIn; },
    // The engine step leaves sprite-gen's venv Python, as sprite:setup does.
    setupStep: async name => {
      ogCalls.push(`setup ${name}`);
      if (name === 'engine') {
        const python = spritePython(path.join(root, 'kit'));
        await mkdir(path.dirname(python), { recursive: true }); await writeFile(python, '');
      }
    },
    stopAll: async () => {}, running: 0,
  });
  const deps = {
    root, out: line => lines.push(line), write: text => lines.push(String(text)), platform: process.platform, arch: process.arch, env: process.env,
    nodeBin: path.dirname(process.execPath), fetcher, now: Date.now, sleep: async () => {}, hostname: () => '작업실 PC',
    system: () => ({ missing: [], warnings: [], python: path.join(path.dirname(process.execPath), 'python'), toolPath: '', ffmpeg: path.dirname(process.execPath) }),
    serviceActive: () => false, openUrl: url => opened.push(url), ask: async () => { asked += 1; return 'n'; },
    loadOg: async (_root, about) => og(about),
    npm: async (args, { cwd }) => {
      npmCalls.push(path.basename(cwd));
      const manifest = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
      for (const [name, version] of Object.entries(manifest.dependencies)) {
        await mkdir(path.join(cwd, 'node_modules', ...name.split('/')), { recursive: true });
        await writeFile(path.join(cwd, 'node_modules', ...name.split('/'), 'package.json'), JSON.stringify({ name, version }));
      }
      return 0;
    },
    pins: { ...PINS, kit: kit.pin }, pid: process.pid, alive: () => true,
  };
  return { deps, lines, beats, ogCalls, opened, npmCalls, key, asked: () => asked, revoke: old => { revoked = old; polls = 0; } };
}

test('the first run: pairs without a code to copy, installs from pins, signs Grok in, says each step to the site, and runs the worker in front', async () => {
  const root = await tmp('runner-first-');
  const kit = makeKit({ 'package.json': '{"name":"kit","scripts":{}}' });
  const { deps, lines, beats, ogCalls, opened, npmCalls, key, asked, revoke } = await world({ root, kit });
  try {
    assert.equal(await runRunner(['--once'], deps), 0);
    // The connection first: the page opens, the code is on screen, the key goes into og on stdin and nowhere else.
    assert.deepEqual(opened, ['https://oddbout.com/creator.html#pc=BCDF-GHJK']);
    assert.ok(lines.some(line => line.includes('BCDF-GHJK')));
    assert.ok(!lines.join('\n').includes(key), 'the key never reaches the screen');
    assert.deepEqual(ogCalls, [`worker key ${PINS.service.apiBase} <afw_`, 'setup kit', 'setup engine', 'setup slice', 'health', 'login grok', 'health', 'harden', 'worker run --once']);
    assert.deepEqual(npmCalls, ['tools'], 'the Grok CLI from its lockfile; codex declined');
    assert.equal(asked(), 1);
    assert.ok(lines.some(line => line.includes('GPT 그림을 더하려면 나중에: npx oddbout-host login codex')));
    assert.equal(await readFile(path.join(root, 'tools', 'package-lock.json'), 'utf8'), await readFile(path.join(here, 'cli', 'grok', 'lock.json'), 'utf8'));
    // Each step to the site while it installs (the worker sends its own heartbeats once it runs).
    assert.deepEqual(beats.map(b => b.setup), ['kit', 'sprite', 'grok-login', 'grok-login', 'ready']);
    assert.ok(beats.every(b => b.ok === false && b.runner === VERSION));
    // The install: og.mjs beside the generator's files, host.env, the record of what it holds.
    assert.deepEqual((await readdir(path.join(root, 'bin'))).sort(), [...HOST_FILES, 'og.mjs'].sort());
    const env = readHostEnv(await readFile(path.join(root, 'host.env'), 'utf8'));
    assert.equal(env.SLOTS, process.platform === 'linux' ? '3' : '2');
    assert.equal(env.TOOL_PATH, path.dirname(process.execPath));
    const record = JSON.parse(await readFile(path.join(root, 'runner.json'), 'utf8'));
    assert.equal(record.runner, VERSION); assert.equal(record.kit, kit.pin.sha256); assert.equal(record.grok, PINS.cli.grok.integrity);
    assert.ok(!existsSync(path.join(root, 'runner.lock')), 'the lock goes with the runner');

    // The next run: nothing to install, no pairing, the logins as they are, the worker.
    ogCalls.length = 0; beats.length = 0; npmCalls.length = 0;
    assert.equal(await runRunner(['--once'], deps), 0);
    assert.deepEqual(ogCalls, ['health', 'harden', 'worker run --once']);
    // The first heartbeat also asks whether the key still works (it does).
    assert.deepEqual(beats.map(b => b.setup), ['ready', 'ready']);
    assert.deepEqual(npmCalls, []);
    assert.equal(asked(), 1, 'a "no" to codex is asked once');

    // A key the site turned off: the next run pairs again and goes on.
    const old = `afw_${'d'.repeat(64)}`;
    await writeFile(path.join(root, 'worker.env'), `ODDBOUT_GENERATION_API=${PINS.service.apiBase}\nODDBOUT_GENERATION_WORKER_KEY=${old}\n`);
    revoke(old); ogCalls.length = 0; opened.length = 0; lines.length = 0;
    assert.equal(await runRunner(['--once'], deps), 0);
    assert.ok(lines.some(line => line.includes('워커 열쇠가 꺼졌거나 만료됐다')));
    assert.equal(opened.length, 1);
    assert.deepEqual(ogCalls, [`worker key ${PINS.service.apiBase} <afw_`, 'health', 'harden', 'worker run --once']);
    assert.ok((await readFile(path.join(root, 'worker.env'), 'utf8')).includes(key));

    // A new kit while a job is open: the install stays as it is until the job closes; the worker runs on it.
    await mkdir(path.join(root, 'kit', 'output', '20261107-gen-b'), { recursive: true });
    await writeFile(path.join(root, 'kit', 'output', '20261107-gen-b', 'request.json'), '{}');
    const newer = makeKit({ 'package.json': '{"name":"kit","version":"2"}' }, '9.9.10');
    deps.pins = { ...PINS, kit: newer.pin }; lines.length = 0; ogCalls.length = 0;
    assert.equal(await runRunner(['--once'], deps), 0);
    assert.match(lines.join('\n'), /열린 작업 1개\(20261107-gen-b\)가 끝날 때까지/);
    assert.deepEqual(ogCalls, ['health', 'harden', 'worker run --once']);
    assert.equal(JSON.parse(await readFile(path.join(root, 'kit', '.oddbout-kit.json'), 'utf8')).version, '9.9.9');
    // Closed, the next run takes the new kit.
    await writeFile(path.join(root, 'kit', 'output', '20261107-gen-b', '.closed'), '');
    deps.fetcher = (await world({ root, kit: newer })).deps.fetcher;
    ogCalls.length = 0;
    assert.equal(await runRunner(['--once'], deps), 0);
    assert.equal(JSON.parse(await readFile(path.join(root, 'kit', '.oddbout-kit.json'), 'utf8')).version, '9.9.10');
    assert.deepEqual(ogCalls.slice(0, 3), ['setup kit', 'setup engine', 'setup slice']);
    assert.ok(existsSync(path.join(root, 'kit', 'output', '20261107-gen-b', '.closed')), 'the closed job moved with the install');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the first run stops where it must: another runner on the install, a pairing nobody approved, a service worker, a codex he asked for', async () => {
  const root = await tmp('runner-stops-');
  const kit = makeKit({ 'package.json': '{}' });
  try {
    // Another live runner holds the install.
    const busy = await world({ root, kit });
    writeFileSync(path.join(root, 'runner.lock'), '424242');
    assert.equal(await runRunner([], { ...busy.deps, pid: 1 }), 1);
    assert.match(busy.lines.at(-1), /다른 oddbout-host 창이 쓰고 있다/);
    await rm(path.join(root, 'runner.lock'));
    // Linux's service worker (npm run host) already runs on this install.
    assert.equal(await runRunner([], { ...busy.deps, serviceActive: () => true }), 1);
    assert.match(busy.lines.at(-1), /npm run host -- stop/);
    // Ten minutes and nobody pressed 연결.
    const late = await world({ root, kit, approveAfter: Infinity });
    let clock = Date.now();
    late.deps.now = () => (clock += 60_000);
    assert.equal(await runRunner([], late.deps), 1);
    assert.match(late.lines.at(-1), /만료됐다/);
    assert.ok(!existsSync(path.join(root, 'worker.env')));
    // --codex: the Codex CLI from its lockfile, its folder on og's PATH, its sign-in after Grok's.
    const both = await world({ root, kit });
    assert.equal(await runRunner(['--codex', '--once'], both.deps), 0);
    assert.deepEqual(both.npmCalls, ['tools', 'codex']);
    assert.ok(both.ogCalls.includes('login codex'));
    assert.equal(both.beats.at(-2).setup, 'codex-login');
    assert.equal(readHostEnv(await readFile(path.join(root, 'host.env'), 'utf8')).TOOL_PATH,
      [path.dirname(process.execPath), path.join(root, 'codex', 'node_modules', '.bin')].join(process.platform === 'win32' ? ';' : ':'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
