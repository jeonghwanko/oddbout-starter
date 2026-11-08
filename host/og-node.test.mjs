import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostEnv, installFiles } from '../scripts/host.mjs';
import { codexCommand } from '../mcp/generation-connection.mjs';
import { outcome } from './ledger-report.mjs';
import { createFrontCheck, ogClient, parseHealth, spritePython } from './generation-worker.mjs';
import * as og from './og.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const linux = process.platform === 'linux',
  windows = process.platform === 'win32';
// The memory slice and the worker's user unit are systemd's (Windows has no SIGTERM or file modes either: those checks say `!windows`).
const linuxOnly = { skip: !linux && "systemd is Linux's" };
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const until = async (check, ms = 10_000) => {
  for (const end = Date.now() + ms; !(await check()) && Date.now() < end;) await new Promise(done => setTimeout(done, 50));
};
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

test("og.mjs keeps bash og's tool lists, pinned versions and defaults", async () => {
  const bash = (await readFile(path.join(here, 'og'), 'utf8')).replace(/\r\n/g, '\n');
  const words = name =>
    bash
      .match(new RegExp(`^${name}="([^"]*)"`, 'm'))[1]
      .trim()
      .split(/\s+/)
      .sort();
  const value = name => bash.match(new RegExp(`^${name}=(?:\\$\\{[A-Z_]+:-)?([^}\\s]+)\\}?$`, 'm'))[1];
  assert.deepEqual([...og.LOCAL_TOOLS].sort(), words('LOCAL_TOOLS'));
  assert.deepEqual([...og.GROK_TOOLS].sort(), words('GROK_TOOLS'));
  assert.deepEqual([...og.REFUSED_TOOLS].sort(), words('REFUSED_TOOLS'));
  assert.deepEqual([...og.CODEX_OFF].sort(), words('CODEX_OFF'));
  assert.deepEqual([...og.CODEX_KEEP_ON].sort(), words('CODEX_KEEP_ON'));
  assert.deepEqual(
    [og.KIT_URL, og.KIT_REF, og.CODEX_VERSION, og.GROK_VERSION, String(og.RUN_TIMEOUT), String(og.SLOT_WAIT), og.CODEX_MODEL],
    ['KIT_URL', 'KIT_REF', 'CODEX_VERSION', 'GROK_VERSION', 'RUN_TIMEOUT', 'SLOT_WAIT', 'CODEX_MODEL'].map(value),
  );
  assert.equal(bash.match(/^HARDEN_MARK="([^"]+)"$/m)[1], og.HARDEN_MARK);
  assert.equal(bash.match(/^DOCS_MARK="([^"]+)"$/m)[1], og.DOCS_MARK);
  // The user install's unit names (bash og's MODE=user branch).
  const user = bash.slice(bash.indexOf('MODE=user'), bash.indexOf('MODE=service'));
  assert.match(user, new RegExp(`SLICE=${escape(og.SLICE)}\\n`));
  assert.match(user, new RegExp(`WORKER_UNIT=${escape(og.WORKER_UNIT)}\\n`));
  assert.match(bash, /--kill-after=30 /);
  assert.equal(og.KILL_AFTER_MS, 30_000);
});

test('what a command bills: the provider and codex slots bash og gives it, and its ledger label', () => {
  const sprite = (...args) => ['npm', 'run', 'sprite', '--', ...args];
  const cases = [
    [sprite('gen', '--provider', 'codex', '--prompt-file', 'p.txt'), 'codex', 1, 'npm run sprite gen'],
    [sprite('gen-set', '--run-dir', 'x', '--provider', 'codex', '--concurrency', '2'), 'codex', 2, 'npm run sprite gen-set'],
    [sprite('video-set', '--run-dir', 'x'), 'grok', 0, 'npm run sprite video-set'],
    [sprite('extract', 'x'), 'local', 0, 'npm run sprite extract'],
    [sprite('a-tool-not-known-yet'), 'codex', 1, 'npm run sprite a-tool-not-known-yet'],
    [sprite('gen', '--provider=grok'), 'grok', 0, 'npm run sprite gen'],
    [['codex', 'exec', '-m', 'gpt-6.1-sol', '-'], 'codex', 1, 'codex exec'],
    [['grok', '-p', 'Reply with the single word ok.'], 'grok', 0, 'grok'],
    [['npm', 'run', 'fighter:pack', '--', '/abs/plan.json'], 'local', 0, 'npm run fighter:pack'],
  ];
  for (const [args, provider, slots, label] of cases) {
    assert.deepEqual(og.classify(args, 3), { provider, slots }, args.join(' '));
    assert.equal(og.toolLabel(args), label);
  }
  assert.throws(() => og.classify(sprite('gen', '--provider', 'claude'), 3), /provider 'claude' is not allowed/);
  assert.throws(() => og.classify(sprite('pixel-draw'), 3), /reaches a provider P0 does not use/);
  assert.throws(() => og.classify(sprite('gen-set', '--provider', 'codex'), 2), /--concurrency 1\.\.2/);
  assert.throws(() => og.classify(sprite('gen-set', '--concurrency', '3'), 2), /--concurrency 1\.\.2/);
});

test("npm scripts run as the node command the kit names, and codex as its package's script, as codexCommand finds it", async () => {
  const scripts = JSON.parse(await readFile(path.join(here, '..', 'package.json'), 'utf8')).scripts;
  assert.deepEqual(og.npmScript(['npm', 'run', 'sprite', '--', 'gen', '--x'], scripts), ['scripts/sprite-gen.mjs', 'gen', '--x']);
  assert.deepEqual(og.npmScript(['npm', 'run', '--silent', 'sprite', '--', 'video-set'], scripts), ['scripts/sprite-gen.mjs', 'video-set']);
  assert.deepEqual(og.npmScript(['npm', 'run', 'fighter:gait', '--', 'loop-review', 'c.json'], scripts), ['scripts/gait.mjs', 'loop-review', 'c.json']);
  assert.throws(() => og.npmScript(['npm', 'run', 'test'], { test: 'node --test a && b' }), /not a plain node command/);
  assert.throws(() => og.npmScript(['npm', 'ci'], scripts), /npm run <script>/);

  const base = await mkdtemp(path.join(os.tmpdir(), 'og-cli-'));
  try {
    // A global npm install (codexCommand's case): the shim beside node_modules. On Windows a .cmd that only a shell would start.
    const global = path.join(base, 'global'),
      script = path.join(global, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    await mkdir(path.dirname(script), { recursive: true });
    await writeFile(path.join(global, 'node_modules', '@openai', 'codex', 'package.json'), JSON.stringify({ bin: { codex: 'bin/codex.js' } }));
    await writeFile(script, '#!/usr/bin/env node\n');
    if (windows) await writeFile(path.join(global, 'codex.cmd'), '@node "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
    else {
      await symlink(script, path.join(global, 'codex'));
      await chmod(script, 0o755);
    }
    const found = og.cliCommand('codex', { PATH: global });
    assert.deepEqual(found, await codexCommand({ PATH: global }));
    assert.deepEqual(found, windows ? { command: process.execPath, prefix: [script] } : { command: path.join(global, 'codex'), prefix: [] });
    // og setup's install (npm install --prefix tools): the shims in node_modules/.bin, the package beside it, not above.
    const bin = path.join(base, 'tools', 'node_modules', '.bin'),
      grok = path.join(base, 'tools', 'node_modules', '@xai-official', 'grok');
    await mkdir(bin, { recursive: true });
    await mkdir(path.join(grok, 'bin'), { recursive: true });
    await writeFile(path.join(grok, 'package.json'), JSON.stringify({ bin: { grok: 'bin/grok' } }));
    await writeFile(path.join(grok, 'bin', 'grok'), '#!/usr/bin/env node\nconsole.log("ok")\n');
    assert.deepEqual(og.cliCommand('grok', { PATH: bin, platform: 'win32', node: 'node-here' }), {
      command: 'node-here',
      prefix: [path.join(grok, 'bin', 'grok')],
    });
    assert.equal(og.cliCommand('grok', { PATH: path.join(base, 'nowhere') }), null);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('codex slots are granted all or nothing, in turn: a run needing two is not passed by runs needing one, and a wait ends', async () => {
  const slots = og.createSlots(2),
    order = [];
  assert.equal(await slots.acquire(1, 1000), true);
  const two = slots.acquire(2, 5000).then(got => {
    order.push(['two', got]);
  });
  const one = slots.acquire(1, 5000).then(got => {
    order.push(['one', got]);
  });
  await new Promise(done => setTimeout(done, 50));
  assert.deepEqual(order, [], 'one slot is free, but the run needing two came first');
  slots.release(1);
  await two;
  assert.deepEqual(order, [['two', true]]);
  slots.release(2);
  await one;
  assert.deepEqual(order, [
    ['two', true],
    ['one', true],
  ]);
  assert.equal(await slots.acquire(2, 100), false, 'past its wait it is not started');
  const stop = new AbortController(),
    stopped = slots.acquire(2, 60_000, stop.signal);
  stop.abort();
  assert.equal(await stopped, false);
  await assert.rejects(slots.acquire(3, 100), /needs 3 codex slots, only 2 exist/);
  slots.release(1);
  assert.equal(slots.free, 2);
});

test("hostEnv takes a Windows install's folders on Windows only, and keeps the POSIX rules", () => {
  assert.match(
    hostEnv({ nodeBin: 'C:\\Program Files\\nodejs', toolPath: 'C:\\ffmpeg\\bin;D:/tools', platform: 'win32' }),
    /^TOOL_PATH=C:\\ffmpeg\\bin;D:\/tools$/m,
  );
  assert.throws(() => hostEnv({ nodeBin: 'C:\\Program Files\\nodejs', platform: 'linux' }), /host-env-path/);
  assert.throws(() => hostEnv({ nodeBin: 'C:\\a:b', platform: 'win32' }), /host-env-path/);
  assert.throws(() => hostEnv({ nodeBin: 'C:\\a', toolPath: 'C:\\b\nX=1', platform: 'win32' }), /host-env-path/);
  assert.throws(() => hostEnv({ nodeBin: 'relative', platform: 'win32' }), /host-env-path/);
  assert.match(hostEnv({ nodeBin: '/usr/bin', toolPath: '/opt/a:/opt/b', platform: 'linux' }), /^TOOL_PATH=\/opt\/a:\/opt\/b$/m);
  assert.throws(() => hostEnv({ nodeBin: '/usr/bin', toolPath: '/a:relative', platform: 'linux' }), /host-env-path/);
});

test('the worker takes og and its Python injected: bash og by path, og.mjs as an object that runs in its process', async () => {
  assert.equal(spritePython('/k', 'linux'), path.join('/k', 'vendor', 'sprite-gen', '.venv', 'bin', 'python'));
  assert.equal(spritePython('C:\\k', 'win32'), path.join('C:\\k', 'vendor', 'sprite-gen', '.venv', 'Scripts', 'python.exe'));
  const calls = [];
  const bash = ogClient('/root/bin/og', async (command, args, options) => {
    calls.push([command, args, options.stdin]);
    return 0;
  });
  assert.equal(await bash.run('20261105-gen-x', ['codex', 'exec', '-'], { stdin: 'prompt' }), 0);
  assert.deepEqual(calls, [['/root/bin/og', ['run', '20261105-gen-x', '--', 'codex', 'exec', '-'], 'prompt']]);
  const object = { run: async () => 0, health: async () => '', prune: async () => '' };
  assert.equal(ogClient(object), object);
  // The front check runs its judge through that object, never as a process.
  const kit = await mkdtemp(path.join(os.tmpdir(), 'og-front-'));
  try {
    const runs = [],
      set = {
        id: 'set-1',
        front: { downloadUrl: 'https://x/front.webp', bytes: 1, sha256: '01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b' },
      };
    const check = createFrontCheck({
      api: {
        frontClaim: async () => ({ ok: true, profileSet: set }),
        frontRelease: async () => ({ ok: true }),
        frontFinish: async () => ({ ok: true, frontCheck: { status: 'pass' } }),
      },
      og: {
        run: async (job, args) => {
          runs.push([job, args[0]]);
          return 1;
        },
        health: async () => '',
        prune: async () => '',
      },
      python: 'python',
      kit,
      say: async () => {},
      providerDown: async () => false,
      fetcher: async () => new Response(new Uint8Array([10])),
      runner: async (command, args) => {
        if (command === 'python') await writeFile(args.at(-1), 'png');
        return 0;
      },
      now: () => new Date('2026-11-05T00:00:00Z'),
    });
    assert.equal(await check(), 'failed');
    assert.deepEqual(
      runs.map(([, first]) => first),
      ['codex'],
    );
    assert.match(runs[0][0], /^20261105-front-/);
  } finally {
    await rm(kit, { recursive: true, force: true });
  }
});

// A community host's install as og.mjs runs it: host.env and the generator in <root>/bin, codex and grok as npm packages in <root>/tools
// (scripts run with node, as og setup installs them). On Linux, fake systemctl and systemd-run stand in for the memory slice.
async function hostInstall() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'og-node-')),
    root = path.join(base, 'root'),
    fakes = path.join(base, 'fakes'),
    units = path.join(base, 'units');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await mkdir(fakes);
  await installFiles(root, here);
  await copyFile(path.join(here, 'og.mjs'), path.join(root, 'bin', 'og.mjs'));
  await writeFile(path.join(root, 'host.env'), hostEnv({ nodeBin: path.dirname(process.execPath), slots: 2, memory: '4G' }));
  const token = plan =>
    `x.${Buffer.from(JSON.stringify({ email: 'Host@Example.com', 'https://api.openai.com/auth': { chatgpt_plan_type: plan, chatgpt_account_id: 'acct-123456' } })).toString('base64url')}.y`;
  const modules = path.join(root, 'tools', 'node_modules');
  const provider = async (pkg, name, rel, body) => {
    const file = path.join(modules, pkg, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(path.join(modules, pkg, 'package.json'), JSON.stringify({ name: pkg, version: '0.0.0', bin: { [name]: rel } }));
    await writeFile(
      file,
      `#!/usr/bin/env node\nconst fs = require('fs'), os = require('os'), path = require('path');\nconst base = ${JSON.stringify(base)}, args = process.argv.slice(2);\n${body}\n`,
      { mode: 0o755 },
    );
    if (!windows) {
      await mkdir(path.join(modules, '.bin'), { recursive: true });
      await symlink(path.relative(path.join(modules, '.bin'), file), path.join(modules, '.bin', name));
    }
  };
  // Each provider notes the environment it ran with: the install's root as its home, never the host's own.
  await provider(
    '@openai/codex',
    'codex',
    'bin/codex.js',
    `fs.writeFileSync(path.join(base, 'codex-env.json'), JSON.stringify({ HOME: process.env.HOME, home: os.homedir(),
  CODEX_HOME: process.env.CODEX_HOME, RIFE: process.env.SPRITE_GEN_RIFE_BACKEND || '', TMPDIR: process.env.TMPDIR || '' }));
const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
if (args[0] === 'login') { fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ tokens: { id_token: fs.existsSync(path.join(base, 'free-plan')) ? ${JSON.stringify(token('free'))} : ${JSON.stringify(token('plus'))} } })); }
else if (args[0] === 'logout') fs.rmSync(path.join(home, 'auth.json'), { force: true });
else if (args[0] === '--version') console.log('codex-cli 0.165.0');
else if (args.includes('slow')) { fs.writeFileSync(path.join(base, 'slow-' + process.pid), ''); setInterval(() => {}, 1000); }
else console.log('ok');`,
  );
  await provider(
    '@xai-official/grok',
    'grok',
    'bin/grok',
    `const home = path.join(os.homedir(), '.grok');
if (args[0] === 'login') { fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ 'https://auth.x.ai::u1': { email: 'host@example.com', user_id: 'u1', expires_at: '2099-01-01T00:00:00Z' } })); }
else if (args[0] === 'logout') fs.rmSync(path.join(home, 'auth.json'), { force: true });
else if (args[0] === '--version') console.log('grok 1.0.52');
else console.log('ok');`,
  );
  if (linux) {
    const script = (file, body) => writeFile(file, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
    await script(path.join(fakes, 'systemctl'), `echo "$*" >> "${base}/systemctl.log"`);
    await script(path.join(fakes, 'systemd-run'), `echo "$*" >> "${base}/systemd-run.log"; while [ "$1" != "--" ]; do shift; done; shift; exec "$@"`);
  }
  const env = extra => ({ ...process.env, PATH: `${fakes}${path.delimiter}${process.env.PATH}`, OG_UNIT_DIR: units, ...extra });
  const make = extra => og.createOg({ root, env: env(extra) });
  const call = async (instance, argv, stdin) => {
    let stdout = '',
      stderr = '';
    const { code } = await instance.main(argv, {
      out: text => {
        stdout += text;
      },
      err: text => {
        stderr += text;
      },
      stdin: stdin === undefined ? undefined : async () => stdin,
    });
    return { code, stdout, stderr };
  };
  const ledger = async () =>
    (await readFile(path.join(root, 'ledger.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
  const job = async name => {
    const dir = path.join(root, 'kit', 'output', name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'request.json'), '{}');
    return dir;
  };
  return { base, root, units, make, call, ledger, job, env };
}

test('a host install runs og.mjs as its own account: providers signed in inside the root, the ledger marks the host, codex slots wait', async () => {
  const { base, root, units, make, call, ledger, job } = await hostInstall();
  const g = make();
  try {
    assert.match((await call(g, ['status'])).stdout, new RegExp(`root +${escape(root)} \\(user ${escape(os.userInfo().username)}, user install\\)`));
    assert.match((await call(g, ['status'])).stdout, /^codex +codex-cli 0\.165\.0 /m);
    // The official host's manual flow is not a host's.
    for (const args of [['new', 'red-cat', '1', 'a@b.c'], ['deliver', 'x'], ['close', 'x', 'y'], ['self-update']]) {
      const r = await call(g, args, 'a request');
      assert.notEqual(r.code, 0);
      assert.match(r.stderr, /official host|npm run host -- update/);
    }
    // A ChatGPT account on the free plan is named at once; signing in pins the host's own account; health calls both through the install's home.
    await writeFile(path.join(base, 'free-plan'), '');
    assert.match((await call(g, ['login', 'codex'])).stderr, /free plan — hosting needs a paid plan/);
    await rm(path.join(base, 'free-plan'));
    const paid = await call(g, ['login', 'codex', '--replace']);
    assert.equal(paid.code, 0, paid.stderr);
    assert.doesNotMatch(paid.stderr, /free plan/);
    assert.notEqual((await call(g, ['login', 'grok', '--allow-personal'])).code, 0, 'no personal allowance on a host');
    const pinned = await call(g, ['login', 'grok']);
    assert.equal(pinned.code, 0, pinned.stderr);
    assert.match(pinned.stdout, /this host's own subscription/);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'accounts.json'), 'utf8')), {
      codex: 'host@example.com',
      grok: 'host@example.com',
      personal: {},
    });
    const health = await call(g, ['health']);
    assert.match(health.stdout, /^og: codex ok \(host@example\.com\)$/m);
    assert.match(health.stdout, /^og: grok ok \(host@example\.com\)$/m);
    const seen = JSON.parse(await readFile(path.join(base, 'codex-env.json'), 'utf8'));
    assert.deepEqual([seen.HOME, seen.home, seen.CODEX_HOME], [root, root, path.join(root, '.codex')]);
    // What the worker reads of it (generation-worker.mjs parseHealth).
    assert.ok(parseHealth(await g.health()).ok);

    // A worker job's run: codex slots in this process, the ledger's account `host`, scratch files inside the job; on Linux, the memory slice.
    const name = '20261028-gen-0123abcd',
      dir = await job(name);
    const ran = await call(g, ['run', name, '--', 'codex', 'exec', 'hello']);
    assert.equal(ran.code, 0, ran.stderr);
    if (linux) assert.match(await readFile(path.join(base, 'systemd-run.log'), 'utf8'), /--slice=oddbout-host\.slice/);
    assert.equal(JSON.parse(await readFile(path.join(base, 'codex-env.json'), 'utf8')).TMPDIR, path.join(dir, '.tmp'));
    const end = (await ledger()).at(-1);
    assert.deepEqual([end.kind, end.phase, end.provider, end.account, end.exit, end.tool], ['run', 'end', 'codex', 'host', 0, 'codex exec']);
    // Refused before its command started: exit 3, sprite-gen's "nothing was sent", which the worker may run again.
    const refused = await call(g, ['run', '20261028-gen-missing0', '--', 'codex', 'exec', 'hello']);
    assert.equal(refused.code, 3, refused.stderr);
    assert.match(refused.stderr, /no job 20261028-gen-missing0/);

    // Every codex slot held by runs under way: past OG_SLOT_WAIT a run is not started (exit 3), and the ledger ends it as such.
    const waiting = make({ OG_SLOT_WAIT: '1' }),
      holders = new AbortController();
    const held = [0, 1].map(() => g.run(name, ['codex', 'exec', 'slow'], { signal: holders.signal, note: () => {} }));
    await until(() => g.pool.free === 0);
    assert.equal(g.pool.free, 0, 'two slow runs hold both slots');
    const waited = await call(waiting, ['run', name, '--', 'codex', 'exec', 'hello']);
    assert.equal(waited.code, 3, waited.stderr);
    assert.match(waited.stderr, /no 1 free codex slot\(s\) within 1s — not started/);
    const last = (await ledger()).at(-1);
    assert.deepEqual([last.kind, last.phase, last.exit], ['run', 'end', 3]);
    holders.abort();
    assert.deepEqual(await Promise.all(held), [143, 143], 'a stopped run ends 143, as og ends on SIGTERM');
    assert.equal(g.pool.free, 2);

    // Signed out after its pin: the account's refusal exits 75 before any ledger line, so the worker marks codex down.
    const before = (await ledger()).length;
    await rm(path.join(root, '.codex', 'auth.json'));
    const signedOut = await call(g, ['run', name, '--', 'codex', 'exec', 'hello']);
    assert.equal(signedOut.code, 75, signedOut.stderr);
    assert.match(signedOut.stderr, /codex is not signed in/);
    assert.equal((await ledger()).length, before);
    assert.match(await g.health(), /^og: codex NOT READY — codex is not signed in/m);
    assert.equal((await call(g, ['login', 'codex', '--replace'])).code, 0);

    // The worker's key on stdin (mode 600 where there are modes), never in argv.
    assert.notEqual((await call(g, ['worker', 'key', 'https://example.supabase.co/functions/v1/ai-fighter'], 'not-a-key')).code, 0);
    assert.equal((await call(g, ['worker', 'key', 'https://example.supabase.co/functions/v1/ai-fighter/'], `afw_${'c'.repeat(64)}\n`)).code, 0);
    assert.equal(
      await readFile(path.join(root, 'worker.env'), 'utf8'),
      `ODDBOUT_GENERATION_API=https://example.supabase.co/functions/v1/ai-fighter\nODDBOUT_GENERATION_WORKER_KEY=afw_${'c'.repeat(64)}\n`,
    );
    if (!windows) assert.equal(statSync(path.join(root, 'worker.env')).mode & 0o777, 0o600);
    // The judges mode (2026-11-06): its own line, replaced when set again and kept when the key is written again.
    assert.notEqual((await call(g, ['worker', 'judges', 'gpt'])).code, 0);
    assert.equal((await call(g, ['worker', 'judges', 'pixels'])).code, 0);
    assert.equal((await call(g, ['worker', 'judges', 'hybrid'])).code, 0);
    assert.equal((await call(g, ['worker', 'key', 'https://example.supabase.co/functions/v1/ai-fighter'], `afw_${'c'.repeat(64)}\n`)).code, 0);
    assert.equal(
      await readFile(path.join(root, 'worker.env'), 'utf8'),
      'ODDBOUT_GENERATION_JUDGES=hybrid\n' +
        `ODDBOUT_GENERATION_API=https://example.supabase.co/functions/v1/ai-fighter\nODDBOUT_GENERATION_WORKER_KEY=afw_${'c'.repeat(64)}\n`,
    );
    if (!windows) assert.equal(statSync(path.join(root, 'worker.env')).mode & 0o777, 0o600);
    assert.match((await call(g, ['worker', 'run', '--once'])).stderr, /og harden first/);

    // og harden: codex's tools off and its project instructions off, the same file bash og writes.
    assert.equal((await call(g, ['harden'])).code, 0);
    const configFile = path.join(root, '.codex', 'config.toml'),
      config = await readFile(configFile, 'utf8');
    assert.match(config, /^shell_tool = false$/m);
    const docs = /^project_doc_max_bytes = 0$/m;
    assert.ok(docs.test(config) && config.search(docs) < config.indexOf('[features]'), config);
    // A config hardened before (features only): og harden adds the line at the top, once, and keeps one [features] table.
    await writeFile(configFile, `model = "gpt-6.1-sol"\n${config.replace(/^# og harden \(project docs\).*\nproject_doc_max_bytes = 0\n\n/, '')}`);
    assert.ok(!docs.test(await readFile(configFile, 'utf8')));
    assert.equal((await call(g, ['harden'])).code, 0);
    assert.match((await call(g, ['harden'])).stdout, /already off/);
    const hardened = await readFile(configFile, 'utf8');
    assert.equal(hardened.match(/^project_doc_max_bytes = 0$/gm)?.length, 1);
    assert.ok(hardened.startsWith('# og harden (project docs)') && hardened.match(/^\[features\]$/gm)?.length === 1, hardened);
    // An earlier og harden's block with one feature turned back on is written again; another [features] table is the host's.
    await writeFile(configFile, hardened.replace('shell_tool = false', 'shell_tool = true'));
    assert.equal((await call(g, ['harden'])).code, 0);
    assert.equal((await readFile(configFile, 'utf8')).match(/^\[features\]$/gm)?.length, 1);
    assert.match(await readFile(configFile, 'utf8'), /^shell_tool = false$/m);
    await writeFile(configFile, '[features]\nshell_tool = true\n');
    const theirs = await call(g, ['harden']);
    assert.notEqual(theirs.code, 0);
    assert.match(theirs.stderr, /already has a \[features\] table/);
    // An operator's own value is theirs to change: og harden stops and says so.
    await writeFile(configFile, `project_doc_max_bytes = 4096\n${hardened.replace(/^# og harden \(project docs\).*\nproject_doc_max_bytes = 0\n\n/, '')}`);
    const own = await call(g, ['harden']);
    assert.notEqual(own.code, 0);
    assert.match(own.stderr, /sets project_doc_max_bytes — set it to 0 there by hand/);
    await writeFile(configFile, hardened);

    // The worker as a service: a systemd user unit on Linux; elsewhere it runs in the foreground, and og says so.
    const install = await call(g, ['worker', 'install']);
    if (linux) {
      assert.equal(install.code, 0, install.stderr);
      const unit = await readFile(path.join(units, og.WORKER_UNIT), 'utf8');
      assert.match(unit, new RegExp(`^ExecStart=\\S+ ${escape(path.join(root, 'bin', 'og.mjs'))} worker run$`, 'm'));
      assert.match(unit, /^Slice=oddbout-host\.slice$/m);
      assert.match(await readFile(path.join(base, 'systemctl.log'), 'utf8'), /--user enable --now oddbout-host-worker\.service/);
      await writeFile(path.join(units, og.SLICE), '[Slice]\n');
      assert.equal((await call(g, ['worker', 'uninstall'])).code, 0);
      assert.ok(!existsSync(path.join(units, og.WORKER_UNIT)) && !existsSync(path.join(units, og.SLICE)));
    } else {
      assert.notEqual(install.code, 0);
      assert.match(install.stderr, /no background service on/);
    }
  } finally {
    await g.stopAll();
    await rm(base, { recursive: true, force: true });
  }
});

// The worker stops a stage by aborting its run (2026-11-02's bug: the paid command ran on after og had gone). og.mjs stops the command's
// whole tree — the commands it starts in turn included, as sprite-gen starts Python — and ends after it, the ledger closed.
test("a stopped run ends the command og runs and what that command started, og ends after it, and the command reads the caller's stdin", async () => {
  const { base, root, make, ledger, job } = await hostInstall();
  const g = make();
  try {
    const name = '20261102-gen-0123abcd',
      dir = await job(name),
      kit = path.join(root, 'kit');
    await writeFile(
      path.join(kit, 'read-step.mjs'),
      `import { readFileSync, writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(path.join(base, 'stdin'))}, readFileSync(0));\n`,
    );
    assert.equal(await g.run(name, ['node', 'read-step.mjs'], { stdin: 'the prompt', log: path.join(dir, 'worker.log') }), 0);
    assert.equal(await readFile(path.join(base, 'stdin'), 'utf8'), 'the prompt');

    const started = path.join(base, 'started'),
      stopped = path.join(base, 'stopped');
    await writeFile(
      path.join(kit, 'slow-step.mjs'),
      `import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
process.on('SIGTERM', () => { writeFileSync(${JSON.stringify(stopped)}, 'term'); process.exit(143); });
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
writeFileSync(${JSON.stringify(started)}, String(child.pid));
setInterval(() => {}, 1000);
`,
    );
    const stop = new AbortController(),
      log = path.join(dir, 'worker.log');
    const ended = g.run(name, ['node', 'slow-step.mjs'], { signal: stop.signal, log });
    await until(() => existsSync(started));
    const grandchild = Number(await readFile(started, 'utf8'));
    assert.ok(alive(grandchild), 'the command started its own child');
    const stoppedAt = Date.now();
    stop.abort();
    assert.equal(await ended, 143);
    assert.ok(Date.now() - stoppedAt < 20_000, `og ended ${Date.now() - stoppedAt} ms after the stop`);
    if (!windows) assert.equal(await readFile(stopped, 'utf8'), 'term', 'the command itself got SIGTERM');
    await until(() => !alive(grandchild), 5000);
    assert.ok(!alive(grandchild), "the command's own child ended with it");
    const end = (await ledger()).at(-1);
    assert.deepEqual([end.kind, end.phase, end.tool, end.exit], ['run', 'end', 'node slow-step.mjs', 143]);

    // Its time limit (OG_RUN_TIMEOUT) stops it the same way and reads as a timeout (timeout's 124, or 137 when it had to be killed).
    await rm(started, { force: true });
    const limited = await make({ OG_RUN_TIMEOUT: '1' }).run(name, ['node', 'slow-step.mjs'], { log });
    assert.ok([124, 137].includes(limited), String(limited));
    assert.equal(outcome(limited), 'timeout');
    // A command this host does not have: 127, and its ledger line closes.
    assert.equal(await g.run(name, ['no-such-tool-here'], { log }), 127);
    assert.match(await readFile(log, 'utf8'), /no-such-tool-here is not on this host's PATH/);
    assert.equal((await ledger()).at(-1).exit, 127);
  } finally {
    await g.stopAll();
    await rm(base, { recursive: true, force: true });
  }
});

test('og rife: ncnn by default, torch only with an NVIDIA GPU, and once chosen every provider run carries it', async () => {
  const { base, root, make, call, job } = await hostInstall();
  const g = make();
  try {
    assert.match((await call(g, ['rife', 'status'])).stdout, /^rife +ncnn$/m);
    if (!windows) {
      // The fake GPU and venv tools are shell scripts.
      const venv = path.dirname(spritePython(path.join(root, 'kit'))),
        fakes = path.join(base, 'fakes');
      const script = (file, body) => writeFile(file, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
      await mkdir(venv, { recursive: true });
      await script(path.join(venv, 'python'), 'exit 0');
      await script(path.join(venv, 'pip'), 'exit 0');
      await script(path.join(venv, 'sprite-gen'), `echo "$SPRITE_GEN_RIFE_BACKEND $*" > "${base}/rife-install"`);
      await script(path.join(fakes, 'nvidia-smi'), 'exit 9');
      const noGpu = await call(g, ['rife', 'torch']);
      assert.notEqual(noGpu.code, 0);
      assert.match(noGpu.stderr, /no NVIDIA GPU/);
      await script(path.join(fakes, 'nvidia-smi'), 'echo "GPU 0: Test GPU"');
      const chosen = await call(g, ['rife', 'torch']);
      assert.equal(chosen.code, 0, chosen.stderr);
      assert.equal((await readFile(path.join(base, 'rife-install'), 'utf8')).trim(), 'torch rife install --backend torch');
    } else await writeFile(path.join(root, 'rife.backend'), 'torch\n');
    assert.match((await call(g, ['status'])).stdout, /^rife +torch$/m);
    const name = '20261028-gen-0123abcd',
      dir = await job(name);
    assert.equal((await call(g, ['login', 'codex'])).code, 0);
    const ran = await call(g, ['run', name, '--', 'codex', 'exec', 'hello']);
    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(JSON.parse(await readFile(path.join(base, 'codex-env.json'), 'utf8')).RIFE, 'torch');
    assert.match((await call(g, ['rife', 'ncnn'])).stderr, /jobs still open/);
    await writeFile(path.join(dir, '.closed'), '');
    assert.equal((await call(g, ['rife', 'ncnn'])).code, 0);
    assert.match((await call(g, ['rife', 'status'])).stdout, /^rife +ncnn$/m);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('og prune clears closed jobs past the keep days, worker jobs the API ended without telling (idle 14 days) and old provider sessions', async () => {
  const { base, root, make } = await hostInstall();
  try {
    const output = path.join(root, 'kit', 'output'),
      daysAgo = d => new Date(Date.now() - d * 86_400_000);
    const age = async (file, days) => utimes(file, daysAgo(days), daysAgo(days));
    const job = async (name, days, closed) => {
      const dir = path.join(output, name);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'request.json'), '{}');
      if (closed) await writeFile(path.join(dir, '.closed'), '');
      for (const file of await readdir(dir)) await age(path.join(dir, file), days);
      await age(dir, days);
    };
    await job('20261001-gen-aaaa', 10, true); // closed 10 days ago: past 7
    await job('20261020-gen-bbbb', 3, true); // closed 3 days ago: kept
    await job('20261002-gen-cccc', 20, false); // never closed, untouched 20 days: the API cancelled or expired it
    await job('20261018-gen-dddd', 9, false); // waiting for its creator (up to 7 days) and a little more: kept
    const sessions = path.join(root, '.codex', 'sessions', '2026', '10', '01');
    await mkdir(sessions, { recursive: true });
    await writeFile(path.join(sessions, 'rollout-old.jsonl'), '{}\n');
    await age(path.join(sessions, 'rollout-old.jsonl'), 10);
    await writeFile(path.join(sessions, 'rollout-new.jsonl'), '{}\n');
    const said = await make().prune(7);
    assert.match(said, /older than 7 days removed, idle worker jobs older than 14/);
    assert.deepEqual((await readdir(output)).sort(), ['20261018-gen-dddd', '20261020-gen-bbbb']);
    assert.deepEqual(await readdir(sessions), ['rollout-new.jsonl']);
    const purged = readFileSync(path.join(root, 'ledger.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
      .filter(e => e.kind === 'purge')
      .map(e => e.job)
      .sort();
    assert.deepEqual(purged, ['20261001-gen-aaaa', '20261002-gen-cccc']);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("og.mjs runs from its install's bin folder as a command, beside host.env", async () => {
  const { base, root, env } = await hostInstall();
  try {
    const cli = args => spawnSync(process.execPath, [path.join(root, 'bin', 'og.mjs'), ...args], { encoding: 'utf8', env: env() });
    const status = cli(['status']);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, new RegExp(`^root +${escape(root)} `, 'm'));
    assert.match(
      cli(['explain', '--', 'npm', 'run', 'sprite', '--', 'video-set']).stdout,
      /^provider grok {2}codex-slots 0 {2}ledger "npm run sprite video-set"$/m,
    );
    assert.equal(cli(['no-such-command']).status, 2);
    // Without host.env it is not an install: og.mjs refuses rather than guess a root.
    await rm(path.join(root, 'host.env'));
    const bare = cli(['status']);
    assert.equal(bare.status, 1);
    assert.match(bare.stderr, /no host\.env/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// bash og itself classifies on a Linux host: the two must bill a command alike.
test('og.mjs explains a command as bash og does', linuxOnly, async () => {
  const { base, root, make, call, env } = await hostInstall();
  try {
    const g = make();
    const sprite = (...args) => ['npm', 'run', 'sprite', '--', ...args];
    for (const args of [
      sprite('gen', '--provider', 'codex'),
      sprite('gen-set', '--concurrency', '2'),
      sprite('video-set'),
      sprite('extract'),
      sprite('rife'),
      sprite('gen', '--provider=grok'),
      ['codex', 'exec', '-'],
      ['grok', '-p', 'x'],
      ['npm', 'run', 'fighter:pack', '--', 'x'],
    ]) {
      const bash = spawnSync(path.join(root, 'bin', 'og'), ['explain', '--', ...args], { encoding: 'utf8', env: { ...env(), OG_SVC_USER: '', OG_ROOT: '' } });
      assert.equal(bash.status, 0, bash.stderr);
      assert.equal((await call(g, ['explain', '--', ...args])).stdout, bash.stdout, args.join(' '));
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
