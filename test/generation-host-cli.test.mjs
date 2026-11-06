import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HOST_FILES, checkSystem, codexHealthy, healthy, hostEnv, openJobs, readHostEnv, runHost } from '../scripts/host.mjs';
import { generation } from './helpers/generation-database.mjs';

// 커뮤니티 호스트 H2 (2026-10-28): npm run host -- … against the API on a test database; og is a fake that records its calls.
async function hostDeps(call, token) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-cli-'));
  await mkdir(path.join(root, 'bin')); await writeFile(path.join(root, 'bin', 'og'), '');
  await writeFile(path.join(root, 'host.env'), hostEnv({ nodeBin: '/usr/bin' }));
  const lines = [], ogCalls = [];
  const deps = {
    root, out: line => lines.push(line),
    // As api/client.mjs: a reply that is not ok throws its code.
    request: async (route, { method = 'GET', body } = {}) => {
      const reply = await call(method, route, body ? JSON.parse(body) : undefined, token);
      if (!reply.body.ok) throw Object.assign(new Error(reply.body.code ?? `api-http-${reply.status}`), { status: reply.status });
      return reply.body;
    },
    apiBase: async () => 'https://example.supabase.co/functions/v1/ai-fighter',
    og: async (args, { stdin } = {}) => {
      ogCalls.push({ args, stdin });
      if (args[0] === 'health') return { code: 0, output: 'og: codex ok (host@example.com)\nog: grok ok (host@example.com)\n' };
      if (args.join(' ').startsWith('worker key')) await writeFile(path.join(root, 'worker.env'), 'written by og');
      return { code: 0, output: '' };
    },
    system: () => ({ missing: [], warnings: [], python: '/usr/bin/python3', toolPath: '' }),
    linger: () => true,
  };
  return { root, lines, ogCalls, deps };
}

test('a creator applies to host, waits for approval, and start puts a fresh worker key into og without ever showing it', async () => {
  const { sql, call } = await generation();
  const { root, lines, ogCalls, deps } = await hostDeps(call, 'other-token-0123456789');
  const host = async () => (await sql.query('select enabled, accepts_any, daily_limit from public.af_generation_hosts where not official')).rows[0];
  try {
    // The host terms first: without --accept-terms nothing is sent.
    assert.equal(await runHost(['apply', '--name', '고양이 공방'], deps), 1);
    assert.ok(lines.some(line => line.includes('호스트 약속')));
    assert.equal(await host(), undefined);
    assert.equal(await runHost(['apply', '--name', '고양이 공방', '--accept-terms'], deps), 0);
    assert.match(lines.at(-1), /승인을 기다린다/);
    // Not approved, start all the same: the worker makes his own requests (내 선수는 내 PC로, 2026-10-28).
    lines.length = 0;
    assert.equal(await runHost(['start'], deps), 0);
    const keyCalls = ogCalls.filter(c => c.args.join(' ').startsWith('worker key'));
    assert.equal(keyCalls.length, 1);
    assert.deepEqual(keyCalls[0].args, ['worker', 'key', 'https://example.supabase.co/functions/v1/ai-fighter']);
    assert.match(keyCalls[0].stdin, /^afw_[a-f0-9]{64}\n$/);
    assert.ok(!lines.join('\n').includes(keyCalls[0].stdin.trim()), 'the key is never printed');
    assert.ok(ogCalls.some(c => c.args.join(' ') === 'worker install'));
    // A second start keeps the key it has.
    assert.equal(await runHost(['start'], deps), 0);
    assert.equal(ogCalls.filter(c => c.args.join(' ').startsWith('worker key')).length, 1);

    // His switches, on the server.
    await runHost(['pause'], deps); assert.equal((await host()).enabled, false);
    await runHost(['resume'], deps); assert.equal((await host()).enabled, true);
    await runHost(['any', 'off'], deps); assert.equal((await host()).accepts_any, false);
    await runHost(['limit', '5'], deps); assert.equal((await host()).daily_limit, 5);
    assert.equal(await runHost(['limit', '99'], deps), 1);

    // Revoking stops the worker and drops its key file; the next start gets a new key.
    assert.equal(await runHost(['revoke'], deps), 0);
    assert.ok(!existsSync(path.join(root, 'worker.env')));
    assert.ok(ogCalls.some(c => c.args.join(' ') === 'worker stop'));
    assert.equal((await sql.query('select count(*)::int as n from public.af_workers where host_id is not null and enabled')).rows[0].n, 0);

    // Removing asks first, then takes the unit, the keys and the whole folder (the requesters' words and pictures with it).
    assert.equal(await runHost(['remove'], deps), 1);
    assert.ok(existsSync(root));
    assert.equal(await runHost(['remove', '--yes'], deps), 0);
    assert.ok(!existsSync(root));
    assert.ok(ogCalls.some(c => c.args.join(' ') === 'worker uninstall'));
    assert.equal((await host()).enabled, false);
  } finally { await sql.close(); await rm(root, { recursive: true, force: true }); }
});

test('start refuses until both subscriptions answer; setup refuses with open jobs or a missing tool', async () => {
  const { sql, call } = await generation();
  const { root, lines, ogCalls, deps } = await hostDeps(call, 'other-token-0123456789');
  try {
    await runHost(['apply', '--name', '고양이 공방', '--accept-terms'], deps);
    await sql.query('update public.af_generation_hosts set approved = true where not official');
    const og = deps.og;
    deps.og = async (args, options) => args[0] === 'health' ? { code: 0, output: 'og: codex ok (a)\nog: grok NOT READY — grok is not signed in\n' } : og(args, options);
    assert.equal(await runHost(['start'], deps), 1);
    assert.match(lines.at(-1), /host:login/);
    assert.ok(!ogCalls.some(c => c.args.join(' ') === 'worker install'));

    await mkdir(path.join(root, 'kit', 'output', '20261028-gen-abcd'), { recursive: true });
    await writeFile(path.join(root, 'kit', 'output', '20261028-gen-abcd', 'request.json'), '{}');
    assert.deepEqual(openJobs(root), ['20261028-gen-abcd']);
    assert.equal(await runHost(['setup'], deps), 1);
    assert.match(lines.at(-1), /진행 중인 작업/);
    await writeFile(path.join(root, 'kit', 'output', '20261028-gen-abcd', '.closed'), '');
    deps.system = () => ({ missing: ['img2webp'], warnings: [], python: '', toolPath: '' });
    assert.equal(await runHost(['setup'], deps), 1);
    assert.match(lines.at(-1), /img2webp/);
    assert.ok(!ogCalls.some(c => c.args[0] === 'setup'));
  } finally { await sql.close(); await rm(root, { recursive: true, force: true }); }
});

test('setup writes host.env and the generator files (Unix line endings, og runnable only by the host)', { skip: process.platform !== 'linux' && 'host setup requires Linux paths and Unix permissions' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-setup-')), from = path.join(root, 'from');
  try {
    await mkdir(from);
    for (const name of HOST_FILES) await writeFile(path.join(from, name), 'line one\r\nline two\r\n');
    const ogCalls = [];
    const code = await runHost(['setup', '--slots', '2', '--memory', '6G'], { root, out: () => {}, hostDir: from, linger: () => true,
      system: () => ({ missing: [], warnings: [], python: '/opt/py/bin/python3.12', toolPath: '/opt/ffmpeg/bin' }),
      og: async args => { ogCalls.push(args.join(' ')); return { code: 0, output: '' }; } });
    assert.equal(code, 0);
    assert.deepEqual(ogCalls, ['setup', 'harden']);
    assert.equal(await readFile(path.join(root, 'bin', 'og'), 'utf8'), 'line one\nline two\n');
    assert.equal(statSync(path.join(root, 'bin', 'og')).mode & 0o777, 0o700);
    assert.equal(statSync(path.join(root, 'bin', 'motions.py')).mode & 0o777, 0o600);
    const env = readHostEnv(await readFile(path.join(root, 'host.env'), 'utf8'));
    assert.deepEqual([env.PYTHON, env.TOOL_PATH, env.SLOTS, env.MEMORY], ['/opt/py/bin/python3.12', '/opt/ffmpeg/bin', '2', '6G']);
    // --rife torch puts the alignment's RIFE on PyTorch after the setup; a GPU without it gets the hint; anything else is refused.
    ogCalls.length = 0; const lines = [];
    const again = extra => runHost(['setup', ...extra], { root, out: line => lines.push(line), hostDir: from, linger: () => true,
      system: () => ({ missing: [], warnings: [], python: '/opt/py/bin/python3.12', toolPath: '', gpu: true }),
      og: async args => { ogCalls.push(args.join(' ')); return { code: 0, output: '' }; } });
    const made = () => ogCalls.filter(call => call !== 'worker status'); // installed now: setup first asks whether its worker runs
    assert.equal(await again(['--rife', 'torch']), 0);
    assert.deepEqual(made(), ['setup', 'harden', 'rife torch']);
    ogCalls.length = 0;
    assert.equal(await again([]), 0);
    assert.deepEqual(made(), ['setup', 'harden']); assert.ok(lines.some(line => line.includes('--rife torch')));
    assert.equal(await again(['--rife', 'cuda']), 1);
    assert.equal(statSync(root).mode & 0o777, 0o700);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('host.env refuses values og would put on PATH badly; checkSystem names what a PC lacks', () => {
  assert.throws(() => hostEnv({ nodeBin: '/usr/bin', toolPath: '/a:relative' }), /host-env-path/);
  assert.throws(() => hostEnv({ nodeBin: '/usr/bin', python: '/a\nB=1' }), /host-env-path/);
  assert.throws(() => hostEnv({ nodeBin: '/usr/bin', slots: 4 }), /host-env-limits/);
  assert.ok(healthy('og: codex ok (a)\nog: grok ok (b)')); assert.ok(!healthy('og: codex ok (a)\nog: grok FAILED (exit 1)'));
  // 1.1 (2026-11-06): a SuperGrok-only PC works; codex adds GPT pictures.
  assert.ok(healthy('og: codex NOT READY — not signed in\nog: grok ok (b)'));
  assert.ok(!codexHealthy('og: codex NOT READY — not signed in\nog: grok ok (b)')); assert.ok(codexHealthy('og: codex ok (a)\nog: grok ok (b)'));

  assert.match(checkSystem({ platform: 'darwin' }).missing[0], /Linux/);
  const found = { ffmpeg: '/opt/ffmpeg/bin/ffmpeg', ffprobe: '/opt/ffmpeg/bin/ffprobe', 'python3.12': '/usr/bin/python3.12', python3: '/usr/bin/python3' };
  const system = checkSystem({ platform: 'linux', node: '22.22.2', memory: 8 * 2 ** 30,
    find: name => found[name] ?? (name === 'img2webp' || name.startsWith('python') ? '' : `/usr/bin/${name}`), run: (command, args) => command !== '/usr/bin/python3' && args[0] !== '--user' });
  assert.deepEqual(system.missing, ['img2webp (libwebp 도구 — 예: apt install webp)']);
  assert.equal(system.python, '/usr/bin/python3.12');
  assert.equal(system.toolPath, '/opt/ffmpeg/bin');
  assert.equal(system.warnings.length, 2);
  assert.match(checkSystem({ platform: 'linux', node: '20.1.0', memory: 32 * 2 ** 30, find: name => `/usr/bin/${name}`, run: () => true }).missing[0], /Node 22/);
});

test('signin uses this kit\'s project (no URL or key to type): the browser login, or the device login on a PC without a browser', async () => {
  const calls = [], lines = [];
  const deps = { root: '/nonexistent', out: line => lines.push(line),
    project: async () => ({ origin: 'https://example.supabase.co', publishableKey: 'sb_publishable_example' }),
    signin: { browser: async argv => calls.push(['browser', ...argv]), startDevice: async argv => calls.push(['start', ...argv]), waitDevice: async replace => calls.push(['wait', replace]) } };
  assert.equal(await runHost(['signin'], deps), 0);
  assert.equal(await runHost(['signin', '--device', '--replace'], deps), 0);
  assert.deepEqual(calls, [['browser', '--url', 'https://example.supabase.co', '--key', 'sb_publishable_example'],
    ['start', '--url', 'https://example.supabase.co', '--key', 'sb_publishable_example'], ['wait', true]]);
  deps.project = async () => null;
  assert.equal(await runHost(['signin'], deps), 1);
});

test('signin --device waits again on a link made before, and says how to get a new one when it ran out', async () => {
  const calls = [], lines = [];
  const deps = { root: '/nonexistent', out: line => lines.push(line),
    project: async () => ({ origin: 'https://example.supabase.co', publishableKey: 'sb_publishable_example' }),
    signin: { startDevice: async () => { calls.push('start'); throw new Error('device-login-already-pending'); }, waitDevice: async () => { calls.push('wait'); } } };
  assert.equal(await runHost(['signin', '--device'], deps), 0);
  assert.deepEqual(calls, ['start', 'wait']);
  assert.ok(lines.some(line => line.includes('이어서 기다린다')));
  deps.signin.waitDevice = async () => { throw new Error('device-login-expired'); };
  assert.equal(await runHost(['signin', '--device'], deps), 1);
  assert.match(lines.at(-1), /만료됐다\. npm run host -- signin --device 로 새 링크를 받는다/);
});

// 내 PC 붙이기 (2026-10-28): a join code from the site, no sign-in on the PC; the key goes into og's stdin only, then the worker starts.
test('join puts the site\'s code to work: the key into og only, then health and the worker, no session and no approval needed', { skip: process.platform !== 'linux' && 'host setup requires Linux paths and Unix permissions' }, async () => {
  const lines = [], ogCalls = [], code = `ohj_${'a'.repeat(40)}`, key = `afw_${'b'.repeat(64)}`;
  const root = await mkdtemp(path.join(os.tmpdir(), 'og-join-')), from = path.join(root, 'from'), install = path.join(root, 'install');
  let healthOutput = 'og: codex ok (h@x)\nog: grok ok (h@x)\n';
  const deps = { root: install, out: line => lines.push(line), linger: () => true, hostDir: from,
    system: () => ({ missing: [], warnings: [], python: '/usr/bin/python3', toolPath: '' }),
    request: async () => { throw new Error('client-sign-in-required'); },
    join: async given => { assert.equal(given, code); return { key, host: 'h1', name: '고양이 공방', approved: false, apiBase: 'https://example.supabase.co/functions/v1/ai-fighter' }; },
    og: async (args, options = {}) => { ogCalls.push([args.join(' '), options.stdin]);
      if (args[0] === 'login') healthOutput = 'og: codex ok (h@x)\nog: grok ok (h@x)\n';
      return { code: 0, output: args[0] === 'health' ? healthOutput : '' }; } };
  try {
    await mkdir(from);
    for (const name of HOST_FILES) await writeFile(path.join(from, name), 'x\n');
    assert.equal(await runHost(['join', 'ohj_short'], deps), 1);
    assert.match(lines.at(-1), /붙이기 코드 모양이 아니다/);
    // One command on a new PC: the code first, then the install, the key, the sign-in it lacks (grok here), the worker.
    healthOutput = 'og: codex ok (h@x)\nog: grok not signed in\n';
    assert.equal(await runHost(['join', code, '--slots', '2'], deps), 0);
    assert.deepEqual(ogCalls.map(([args]) => args), ['setup', 'harden', 'worker key https://example.supabase.co/functions/v1/ai-fighter', 'health',
      'login grok', 'health', 'health', 'worker install']);
    assert.equal(ogCalls[2][1], `${key}\n`);
    assert.ok(!lines.some(line => line.includes(key)), 'the key never reaches the screen');
    assert.ok(lines.some(line => line.includes('승인 전에는 내 신청만 이 PC로 만든다')));
    assert.equal(readHostEnv(await readFile(path.join(install, 'host.env'), 'utf8')).SLOTS, '2');
    // Installed and signed in: the key and the worker only.
    ogCalls.length = 0;
    assert.equal(await runHost(['join', code], deps), 0);
    assert.deepEqual(ogCalls.map(([args]) => args), ['worker key https://example.supabase.co/functions/v1/ai-fighter', 'health', 'health', 'worker install']);
    // A used or late code says how to get a new one.
    deps.join = async () => { throw new Error('join-code-invalid'); };
    assert.equal(await runHost(['join', code], deps), 1);
    assert.match(lines.at(-1), /새 코드를 받는다/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// An account with no subscription signs in and then fails health: login says what to do now (2026-10-28).
test('login names a missing subscription right away', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'og-login-')), lines = [];
  try {
    await mkdir(path.join(root, 'bin'), { recursive: true }); await writeFile(path.join(root, 'host.env'), ''); await writeFile(path.join(root, 'bin', 'og'), '');
    const deps = { root, out: line => lines.push(line),
      og: async args => ({ code: 0, output: args[0] === 'health' ? health : '' }) };
    let health = 'og: codex ok (h@x)\nog: grok unhealthy (no subscription)\n';
    assert.equal(await runHost(['login', 'grok'], deps), 1);
    assert.match(lines.at(-1), /유료 구독\(SuperGrok\) 계정으로 다시 로그인한다/);
    // 1.1: grok alone is enough; a codex sign-in that does not answer says GPT pictures are off, and how to fix it.
    health = 'og: codex NOT READY — not signed in\nog: grok ok (h@x)\n';
    assert.equal(await runHost(['login'], deps), 0);
    assert.match(lines.at(-1), /codex\(ChatGPT\)는 없어도 된다/);
    assert.equal(await runHost(['login', 'codex'], deps), 1);
    assert.match(lines.at(-1), /GPT 그림은 고를 수 없다\(Grok 그림은 된다\)/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
