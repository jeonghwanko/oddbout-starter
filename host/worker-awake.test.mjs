import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWakeWatch, main, stayAwake, stayAwakeCommand } from './generation-worker.mjs';

// 1.6 잠자기 (2026-11-07): a host on its owner's PC runs one fighter for 50–68 minutes. While a stage runs the PC must not idle-sleep, and
// after a sleep it could not stop (a closed lid) the stage's lease is renewed at once, not at the next minute's renewal.

test("the block against idle sleep is the platform's own, and each one ends with the worker's process", () => {
  assert.deepEqual(stayAwakeCommand('darwin', 4321), { command: 'caffeinate', args: ['-i', '-w', '4321'], how: 'caffeinate' });
  assert.deepEqual(stayAwakeCommand('linux', 4321), {
    command: 'systemd-inhibit',
    args: ['--what=sleep:idle', '--who=oddbout-host', '--why=generating a fighter', '--mode=block', 'tail', '--pid=4321', '-f', '/dev/null'],
    how: 'systemd-inhibit',
  });
  const win = stayAwakeCommand('win32', 4321);
  assert.equal(win?.command, 'powershell.exe');
  assert.deepEqual(win?.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']);
  // PowerShell's -EncodedCommand is base64 of UTF-16LE.
  const script = Buffer.from(win?.args[3] ?? '', 'base64').toString('utf16le');
  assert.match(script, /SetThreadExecutionState\(\[uint32\]2147483649\)/);
  assert.equal(2147483649, 0x80000000 + 0x00000001, 'ES_CONTINUOUS | ES_SYSTEM_REQUIRED');
  assert.match(script, /-eq 0\) \{ exit 3 \}/);
  assert.match(script, /while \(Get-Process -Id 4321 -ErrorAction SilentlyContinue\) \{ Start-Sleep -Seconds 20 \}/);
  // Anything else has none; a pid that is not one never reaches a command line.
  assert.equal(stayAwakeCommand('freebsd', 4321), null);
  assert.equal(stayAwakeCommand('win32', Number.NaN), null);
  assert.equal(stayAwakeCommand('linux', 0), null);
});

/** A spawn that records its calls and hands back children the test ends by hand. */
function fakeSpawn() {
  /** @type {{ command: string, args: string[], options: any, child: EventEmitter & { killed: number, kill: () => boolean, unref: () => void } }[]} */
  const calls = [];
  const spawn = (command, args, options) => {
    const child = Object.assign(new EventEmitter(), {
      pid: 99,
      killed: 0,
      unref() {},
      kill() {
        child.killed += 1;
        queueMicrotask(() => child.emit('exit', null, 'SIGTERM'));
        return true;
      },
    });
    calls.push({ command, args, options, child });
    return child;
  };
  return { calls, spawn };
}

test('a block that holds is said once, and its release kills the child once, hidden and with no output kept', () => {
  const { calls, spawn } = fakeSpawn(),
    lines = [],
    said = new Set();
  const first = stayAwake({ platform: 'darwin', pid: 4321, spawn, say: line => lines.push(line), said });
  assert.deepEqual(calls[0].options, { stdio: 'ignore', windowsHide: true });
  first.release();
  first.release();
  assert.equal(calls[0].child.killed, 1);
  // The next stage holds it again; the log said so the first time only.
  stayAwake({ platform: 'darwin', pid: 4321, spawn, say: line => lines.push(line), said }).release();
  assert.equal(calls.length, 2);
  assert.deepEqual(lines, ['stay awake during stages: caffeinate']);
});

test('a block that cannot start or ends before its release is said once per process, and the stage runs on without it', async () => {
  const { calls, spawn } = fakeSpawn(),
    lines = [],
    said = new Set(),
    say = line => lines.push(line);
  // No such program: the 'error' event, never a throw.
  for (let stage = 0; stage < 2; stage++) {
    const held = stayAwake({ platform: 'darwin', pid: 4321, spawn, say, said });
    calls.at(-1)?.child.emit('error', Object.assign(new Error('spawn caffeinate ENOENT'), { code: 'ENOENT' }));
    held.release();
    assert.equal(calls.at(-1)?.child.killed, 0, 'nothing to kill');
  }
  // polkit's refusal on a Linux service with no session: systemd-inhibit exits 1 at once.
  for (let stage = 0; stage < 2; stage++) {
    const held = stayAwake({ platform: 'linux', pid: 4321, spawn, say, said });
    calls.at(-1)?.child.emit('exit', 1, null);
    held.release();
    held.release();
    assert.equal(calls.at(-1)?.child.killed, 0, 'after the child ended, release does nothing');
  }
  // A spawn that throws is the same.
  for (let stage = 0; stage < 2; stage++)
    stayAwake({
      platform: 'win32',
      pid: 4321,
      spawn: () => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      },
      say,
      said,
    }).release();
  // A platform with none.
  stayAwake({ platform: 'aix', pid: 4321, spawn, say, said }).release();
  assert.deepEqual(lines, [
    'stay awake during stages: caffeinate did not start (ENOENT) — stages run without it',
    'stay awake during stages: systemd-inhibit ended (exit 1) — stages run without it',
    'stay awake during stages: SetThreadExecutionState did not start (EACCES) — stages run without it',
    'stay awake during stages: nothing on aix',
  ]);
  // A child that died of a signal mid-stage is a failure of its own.
  const held = stayAwake({ platform: 'linux', pid: 4321, spawn, say, said });
  calls.at(-1)?.child.emit('exit', null, 'SIGKILL');
  held.release();
  assert.equal(lines.at(-1), 'stay awake during stages: systemd-inhibit ended (SIGKILL) — stages run without it');
  // A say that throws or rejects never reaches the stage.
  stayAwake({
    platform: 'darwin',
    pid: 4321,
    spawn,
    say: () => {
      throw new Error('log');
    },
    said: new Set(),
  }).release();
  stayAwake({
    platform: 'darwin',
    pid: 4321,
    spawn,
    say: async () => {
      throw new Error('log');
    },
    said: new Set(),
  }).release();
  await new Promise(resolve => setImmediate(resolve));
});

test('a block still running after it settled is said as holding before the stage ends', async () => {
  const { spawn } = fakeSpawn(),
    lines = [];
  const held = stayAwake({ platform: 'linux', pid: 4321, spawn, say: line => lines.push(line), said: new Set(), settleMs: 10 });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.deepEqual(lines, ['stay awake during stages: systemd-inhibit']);
  held.release();
  assert.equal(lines.length, 1);
});

test('the wake watch fires once on a jump of the wall clock, never on a normal tick', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let clock = 1_000_000;
  const gaps = [];
  const watch = createWakeWatch({ now: () => clock, onWake: gap => gaps.push(gap) });
  for (let i = 0; i < 3; i++) {
    clock += 5_000;
    t.mock.timers.tick(5_000);
  }
  // A late tick inside the slack (a busy loop, a timer's drift) is no wake.
  clock += 19_000;
  t.mock.timers.tick(5_000);
  assert.deepEqual(gaps, []);
  // Ten minutes asleep: the monotonic timers stood still, the wall clock moved on.
  clock += 10 * 60_000;
  t.mock.timers.tick(5_000);
  assert.deepEqual(gaps, [10 * 60_000]);
  clock += 5_000;
  t.mock.timers.tick(5_000);
  assert.deepEqual(gaps, [10 * 60_000]);
  // Stopped (the stage ended), it fires no more.
  watch.stop();
  clock += 60_000;
  t.mock.timers.tick(5_000);
  assert.deepEqual(gaps, [10 * 60_000]);
  // An onWake that throws never stops the watch.
  let woke = 0;
  const failing = createWakeWatch({
    now: () => clock,
    onWake: () => {
      woke += 1;
      throw new Error('renew');
    },
  });
  for (let i = 0; i < 2; i++) {
    clock += 60_000;
    t.mock.timers.tick(5_000);
  }
  failing.stop();
  assert.equal(woke, 2);
});

test('a stage renews its lease at once when the PC wakes, and holds the PC awake only while it runs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'worker-awake-')),
    real = globalThis.fetch;
  /** @type {{ route: string, body: any }[]} */
  const sent = [],
    events = [];
  try {
    await writeFile(path.join(root, 'worker.env'), `ODDBOUT_GENERATION_API=https://api.test/ai-fighter\nODDBOUT_GENERATION_WORKER_KEY=afw_${'a'.repeat(64)}\n`);
    const job = { id: 'job-1', status: 'not-a-stage', leaseToken: 'lease-1', owner: 'o', createdAt: '2026-11-07T00:00:00Z' };
    const replies = { heartbeat: { ok: true }, claim: { ok: true, job }, progress: { ok: true }, finish: { ok: true, status: 'failed' } };
    globalThis.fetch = async (url, init) => {
      const route = String(url).replace('https://api.test/ai-fighter/generation-worker/', '');
      sent.push({ route, body: JSON.parse(String(init?.body ?? '{}')) });
      if (route === 'finish') events.push('finish');
      return new Response(JSON.stringify(replies[route] ?? { ok: false, code: 'not-found' }), { status: 200 });
    };
    const og = { run: async () => 0, health: async () => 'og: grok ok (g@x)\n', prune: async () => 'pruned 0' };
    await main({
      once: true,
      root,
      og,
      python: 'python',
      about: null,
      keepAwake: () => {
        events.push('awake');
        return { release: () => events.push('released') };
      },
      // The PC slept ten minutes during the stage.
      wakeWatch: ({ onWake }) => {
        events.push('watch');
        onWake(600_000);
        return { stop: () => events.push('stopped') };
      },
    });
    const progress = sent.filter(s => s.route === 'progress');
    // The versions event, then the renewal the wake sent — not the minute's, a minute away.
    assert.equal(progress.length, 2);
    assert.equal(progress[0].body.event?.kind, 'versions');
    assert.deepEqual(progress[1].body, { jobId: 'job-1', leaseToken: 'lease-1' });
    assert.deepEqual(events, ['awake', 'watch', 'stopped', 'released', 'finish']);
    const log = path.join(root, 'worker.log'),
      woke = 'job job-1 not-a-stage woke after 600 s — lease renewed';
    for (const until = Date.now() + 5000; !(await readFile(log, 'utf8')).includes(woke) && Date.now() < until;) await new Promise(done => setTimeout(done, 20));
    assert.ok((await readFile(log, 'utf8')).includes(woke));
  } finally {
    globalThis.fetch = real;
    await rm(root, { recursive: true, force: true });
  }
});
