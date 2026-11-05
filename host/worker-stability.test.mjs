import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ASKS, GROK_LIMITED, createStages } from './generation-stages.mjs';
import { STAGE_LIMIT_MS, createApi, createCooldowns, createDispatches, dispatchUnknownOutcome, generates, healthAfter, reportStageTokens, run,
  STAGE_STOPPED, TIMING, errorCode, projectDocsAt, stageLimitMs, timedOutOutcome, unlessStopped } from './generation-worker.mjs';

test('the codex folder\'s project instructions: every AGENTS.md from its checkout\'s root down to it, none beside the checkout', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-cwd-'));
  try {
    // A kit checkout: its AGENTS.md reaches a folder anywhere inside it (og's job folders, which is why the judges no longer run there).
    const kit = path.join(root, 'kit'), job = path.join(kit, 'output', 'job');
    await mkdir(path.join(kit, '.git'), { recursive: true }); await mkdir(job, { recursive: true });
    await writeFile(path.join(kit, 'AGENTS.md'), '# kit'); await writeFile(path.join(job, 'AGENTS.override.md'), '# job');
    assert.deepEqual(await projectDocsAt(job), [path.join(kit, 'AGENTS.md'), path.join(job, 'AGENTS.override.md')]);
    // The worker's folder beside the kit, in a checkout of its own with no instructions: nothing.
    const host = path.join(root, 'host'), cwd = path.join(host, 'codex-cwd');
    await mkdir(path.join(host, '.git'), { recursive: true }); await mkdir(cwd, { recursive: true });
    assert.deepEqual(await projectDocsAt(cwd), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

const brief = { profile: { name: 'Blue' }, look: { subject: 'A blue cat boxer', palette: ['blue'], prop: 'gloves', avoid: 'none' },
  motion: { temper: 'bold', attack: 'jab' } };
const job = { id: 'j', brief, refs: [], candidates: [], appearanceRound: 0, appearanceNote: null };
const report = (ok, errors = []) => JSON.stringify({ ok, provider_submitted: true, errors });
const asked = { state: null, code: 'provider-asks', retryable: false, message: 'codex cannot run here' };

/** A fake og for looks: `plan[name]` is the exit code, or `{ code, errors }` for a failure with a report. A 0 makes the look. */
function looksOg(plan, made) {
  return async args => {
    const out = args[args.indexOf('--out') + 1], file = args[args.indexOf('--report') + 1], name = path.basename(out, '.png');
    made.push(name);
    const step = typeof plan[name] === 'object' ? plan[name] : { code: plan[name] ?? 0, errors: [] };
    if (step.code === 0) { await writeFile(out, 'png'); await writeFile(file, report(true)); }
    else if (step.errors.length) await writeFile(file, report(false, step.errors));
    return { code: step.code };
  };
}

test('a look this round already made is kept when the stage runs again for the other one', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'look-keep-')), made = [];
  try {
    const plan = { 'front-a-0': 0, 'front-b-0': { code: 1, errors: [{ state: null, code: 'provider-rate-limited', retryable: true, message: '429' }] } };
    const stages = createStages({ og: looksOg(plan, made), api: { artifact: async () => ({ ok: true }) }, fetchBytes: async () => new Uint8Array(), toWebp: async (png, webp) => writeFile(webp, 'webp') });
    assert.deepEqual(await stages.appearance(job, dir), { outcome: 'retry', result: { code: 'look-exit-1' } });
    plan['front-b-0'] = 0; made.length = 0;
    assert.deepEqual(await stages.appearance(job, dir), { outcome: 'ok', result: { candidates: ['front-a-0', 'front-b-0'] } });
    assert.deepEqual(made, ['front-b-0'], 'front a was paid for once');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('codex that cannot run here now is a stage to run again, not an operator task', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'look-asks-')), made = [];
  try {
    const plan = { 'front-a-0': 75, 'front-b-0': 0, 'front-a-1': { code: 1, errors: [asked] }, 'front-b-1': 0 };
    const stages = createStages({ og: looksOg(plan, made), api: { artifact: async () => ({ ok: true }) }, fetchBytes: async () => new Uint8Array(), toWebp: async (png, webp) => writeFile(webp, 'webp') });
    assert.deepEqual(await stages.appearance(job, dir), { outcome: 'retry', result: { code: ASKS } });
    // The same question read from a report (exit 1): a retry too.
    assert.deepEqual(await stages.appearance({ ...job, appearanceRound: 1 }, dir), { outcome: 'retry', result: { code: ASKS } });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Decisions screening runs beside the looks, and the stage returns only once it is done', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'look-screen-')), order = [];
  try {
    let release; const held = new Promise(resolve => { release = resolve; });
    const og = async args => {
      const out = args[args.indexOf('--out') + 1];
      order.push(`gen ${path.basename(out, '.png')}`);
      if (order.filter(o => o.startsWith('gen')).length === 2) release();   // the design review answers only once both looks are under way
      await writeFile(out, 'png'); await writeFile(args[args.indexOf('--report') + 1], report(true));
      return { code: 0 };
    };
    const api = {
      artifact: async () => ({ ok: true }),
      decisions: async (_, evidence) => {
        order.push(`review ${evidence.scope}`);
        if (evidence.scope === 'design') await held;
        order.push(`reviewed ${evidence.scope}`);
        return { ok: true, review: { status: 'completed', checks: {}, advisory: true, visualApproval: false } };
      },
    };
    const stages = createStages({ og, api, fetchBytes: async () => new Uint8Array(), toWebp: async (png, webp) => writeFile(webp, 'webp') });
    const result = await stages.appearance({ ...job, decisionsReview: { mode: 'shadow' } }, dir);
    assert.equal(result.outcome, 'ok');
    assert.ok(order.indexOf('gen front-a-0') < order.indexOf('reviewed design'), order.join(', '));
    assert.deepEqual(order.filter(o => o.startsWith('reviewed')).sort(), ['reviewed design', 'reviewed look-a', 'reviewed look-b']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('each stage has a time limit, and a codex question is checked again within the hour', () => {
  assert.deepEqual(Object.keys(STAGE_LIMIT_MS).sort(), ['appearance', 'motions', 'queued', 'submitting']);
  assert.equal(stageLimitMs('motions'), 150 * 60_000);
  assert.equal(stageLimitMs('something-new'), 150 * 60_000);
  assert.ok(TIMING.askedRecheckMs < TIMING.healthMs);
});

test('a stopped stage starts no run: its next og or motions.py call ends the stage instead', async () => {
  const controller = new AbortController();
  let started = 0;
  const start = async () => { started += 1; return { code: 0 }; };
  assert.deepEqual(await unlessStopped(controller.signal, start), { code: 0 });
  controller.abort();
  await assert.rejects(unlessStopped(controller.signal, start), error => error.code === STAGE_STOPPED);
  assert.equal(started, 1);
  // The stage turns it into its own end; the worker then reports the timeout or drops the cancelled job.
  const stages = createStages({ og: args => unlessStopped(controller.signal, start), api: { artifact: async () => ({ ok: true }) },
    fetchBytes: async () => new Uint8Array(), toWebp: async () => {}, signal: controller.signal });
  const dir = await mkdtemp(path.join(tmpdir(), 'look-stopped-'));
  try {
    await assert.rejects(stages.appearance(job, dir), error => error.code === STAGE_STOPPED);
    assert.equal(started, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an error code the finish takes is a short string, whatever the error carried', () => {
  assert.equal(errorCode({ code: 137 }), '137');
  assert.equal(errorCode(Object.assign(new Error('x'), { code: 'artifact-refused' })), 'artifact-refused');
  assert.equal(errorCode(new Error('no code')), 'stage-error');
  assert.equal(errorCode(null), 'stage-error');
  assert.equal(errorCode({ code: 'x'.repeat(80) }).length, 60);
});

test('a look whose outcome is unknown goes to an operator even when the other look asked the codex question', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'look-unknown-')), made = [];
  try {
    const timeout = { state: null, code: 'provider-timeout', retryable: false, message: 'no answer in time' };
    const plan = { 'front-a-0': 75, 'front-b-0': { code: 1, errors: [timeout] } };
    const stages = createStages({ og: looksOg(plan, made), api: { artifact: async () => ({ ok: true }) }, fetchBytes: async () => new Uint8Array(), toWebp: async () => {} });
    assert.deepEqual(await stages.appearance(job, dir), { outcome: 'review', result: { code: 'look-outcome-unknown' } });
    // The other way round, and with a look that may be retried: still the operator's.
    Object.assign(plan, { 'front-a-0': { code: 1, errors: [{ ...timeout, code: 'provider-rate-limited', retryable: true }] }, 'front-b-0': { code: 1, errors: [timeout] } });
    assert.deepEqual(await stages.appearance(job, dir), { outcome: 'review', result: { code: 'look-outcome-unknown' } });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a stage past its limit goes to an operator with the xAI requests it named, to resume rather than film again', () => {
  assert.deepEqual(timedOutOutcome('motions', { outcome: 'review', result: { code: 'video-unfinished', requestIds: ['req-1'] } }),
    { outcome: 'review', result: { code: 'motions-stage-timeout', requestIds: ['req-1'] } });
  assert.deepEqual(timedOutOutcome('appearance', undefined), { outcome: 'review', result: { code: 'appearance-stage-timeout' } });
  assert.deepEqual(timedOutOutcome('motions', { outcome: 'retry', result: { code: 'stage-stopped' } }),
    { outcome: 'review', result: { code: 'motions-stage-timeout' } });
});

test('a look gen said it made but whose picture is not there goes to an operator, never sent again', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'look-no-output-')), made = [];
  try {
    const og = async args => { made.push(args); await writeFile(args[args.indexOf('--report') + 1], report(true)); return { code: 0 }; };
    const stages = createStages({ og, api: { artifact: async () => ({ ok: true }) }, fetchBytes: async () => new Uint8Array(), toWebp: async () => {} });
    assert.deepEqual(await stages.appearance(job, dir), { outcome: 'review', result: { code: 'look-no-output' } });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a provider that cannot run here now is marked down, the other keeps its health, and any other outcome changes nothing', () => {
  const up = { ok: true, codex: true, grok: true, at: 't' };
  assert.deepEqual(healthAfter(up, ASKS), { ok: false, codex: false, grok: true, at: 't' });
  assert.deepEqual(healthAfter(up, GROK_LIMITED), { ok: false, codex: true, grok: false, at: 't' });
  assert.equal(healthAfter(up, 'video-exit-1'), up);
  assert.equal(healthAfter(up, undefined), up);
});

test('a provider a real stage found limited stays down past a health check that only says hello, for longer each time it is found limited again', () => {
  let now = 1_000_000;
  const cool = createCooldowns(() => now), up = { ok: true, codex: true, grok: true, at: 't' }, minute = 60_000;
  assert.deepEqual(cool.apply(up), up);
  assert.equal(cool.limit('grok'), TIMING.askedRecheckMs);
  // The text probe passes again after the first wait is over only if the wait is: until then grok stays down and so does the host.
  now += TIMING.askedRecheckMs - minute;
  assert.deepEqual(cool.apply(up), { ok: false, codex: true, grok: false, at: 't' });
  now += minute;
  assert.deepEqual(cool.apply(up), up);
  // Found limited again: twice as long, then no longer than a health period.
  assert.equal(cool.limit('grok'), 2 * TIMING.askedRecheckMs);
  assert.equal(cool.limit('grok'), TIMING.healthMs);
  assert.equal(cool.limit('grok'), TIMING.healthMs);
  // A failed probe stays failed whatever the cool-down says, and the other provider is untouched.
  assert.deepEqual(cool.apply({ ...up, codex: false, ok: false }), { ok: false, codex: false, grok: false, at: 't' });
  // A stage that used grok and made its work ends the streak: the next limit starts from the first wait again.
  cool.worked(['grok']);
  assert.equal(cool.limit('grok'), TIMING.askedRecheckMs);
  cool.limit('codex');
  assert.deepEqual(cool.apply(up), { ok: false, codex: false, grok: false, at: 't' });
});

// 리뷰 (2026-10-31): a stage whose job was cancelled under it (lease lost) or whose finish was refused spent its tokens all the same. They
// go on their own route with the lease the stage ran under; a refusal or a lost reply is logged, never dropped.
test('a stage\'s tokens after its lease was lost go on the usage route, and what became of them is logged', async () => {
  const sent = [], lines = [], say = async line => { lines.push(line); };
  const api = createApi({ base: 'https://api.test/ai-fighter', key: 'afw_x', fetcher: async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, kept: sent.length === 1 }), { status: 200 });
  } });
  const job = { id: 'job-1', status: 'motions', leaseToken: 'lease-1' }, tokens = { total: 900, input: 800, cachedInput: 0, output: 100, reasoning: 0 };
  assert.deepEqual(await reportStageTokens(api, job, tokens, say), { status: 200, ok: true, kept: true });
  await reportStageTokens(api, job, tokens, say);
  assert.deepEqual(sent.map(s => s.url), Array(2).fill('https://api.test/ai-fighter/generation-worker/jobs/job-1/usage'));
  assert.deepEqual(sent[0].body, { leaseToken: 'lease-1', stage: 'motions', tokens });
  assert.deepEqual(lines, ['job job-1 motions 900 tokens reported', 'job job-1 motions 900 tokens reported before']);
  // No tokens: nothing sent. A refusal and a lost reply are logged.
  assert.equal(await reportStageTokens(api, job, null, say), null);
  assert.equal(sent.length, 2);
  await reportStageTokens({ usage: async () => ({ ok: false, status: 404, code: 'not-found' }) }, job, tokens, say);
  await reportStageTokens({ usage: async () => { throw new Error('fetch failed'); } }, job, tokens, say);
  assert.deepEqual(lines.slice(2), ['job job-1 motions 900 tokens not reported (not-found)', 'job job-1 motions 900 tokens not reported (fetch failed)']);
});

// A stage reclaimed after the worker died mid-run (2026-11-02) looked only at its outputs: a look with no picture yet went out again.
const sprite = (...args) => ['npm', 'run', 'sprite', '--', ...args];
test('only runs that make a picture or a clip are recorded: sprite-gen image and video tools, not text runs or pixel tools', () => {
  for (const tool of ['gen', 'gen-set', 'video-set', 'video', 'a-tool-not-known-yet']) assert.equal(generates(sprite(tool, '--x')), true, tool);
  for (const tool of ['extract', 'prepare', 'scale-check', 'video-loop', 'video-cycle-align', 'game-pack']) assert.equal(generates(sprite(tool, '--x')), false, tool);
  assert.equal(generates(['codex', 'exec', '-m', 'gpt']), false);
  assert.equal(generates(['npm', 'run', 'fighter:pack', '--', 'plan.json']), false);
});

test('a generating run with no end on record sends the stage to an operator until the server has taken that, then lets it run', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dispatch-'));
  try {
    const dispatches = createDispatches(dir, () => 't');
    assert.equal(await dispatches.begin(sprite('extract', '--run-dir', 'r')), null);
    assert.deepEqual(await dispatches.unended(), []);
    // A run that ended (any code: the stage that saw it judged it) leaves nothing open.
    const ended = await dispatches.begin(sprite('gen', '--out', 'a.png'));
    await dispatches.end(ended, 1);
    assert.deepEqual(JSON.parse(await readFile(ended.file, 'utf8')), { tool: 'sprite gen', startedAt: 't', end: { code: 1, at: 't' } });
    assert.deepEqual(await dispatches.unended(), []);
    // The worker died during a run: its record has no end. A record that cannot be read counts too.
    await dispatches.begin(sprite('video-set', '--states', 'walk'));
    await writeFile(path.join(dir, 'dispatches', '9-torn.json'), '{"tool":');
    const open = await dispatches.unended();
    assert.deepEqual(open.map(record => record.tool), ['sprite video-set', null]);
    assert.deepEqual(dispatchUnknownOutcome('motions', open), { outcome: 'review', result: { code: 'motions-dispatch-unknown', runs: ['sprite video-set', 'unreadable'] } });
    // Handed to an operator (the server took the review): an operator's retry runs the stage.
    await dispatches.handOver(open);
    assert.deepEqual(await dispatches.unended(), []);
    assert.equal((await readdir(path.join(dir, 'dispatches'))).length, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a child that ends without reading its input ends its run with its own code, not the worker with a write error', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'run-')), log = path.join(dir, 'worker.log');
  try {
    // More than a pipe holds, so the write is still going when the child has gone.
    assert.equal(await run(process.execPath, ['-e', 'process.exit(75)'], { cwd: dir, log, stdin: 'x'.repeat(1 << 20) }), 75);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a run hands its output to a reader as it goes to the log, and a reader that throws never stops it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'run-')), log = path.join(dir, 'worker.log');
  try {
    // codex exec's header names its session on stderr (the stage reads it: generation-stages codexSessionId).
    const script = 'process.stderr.write("session id: 019a7f2e-1c3d-7a00-9b1e-0123456789ab\\n"); process.stdout.write("done\\n")';
    let seen = '';
    assert.equal(await run(process.execPath, ['-e', script], { cwd: dir, log, onOutput: chunk => { seen += chunk; } }), 0);
    assert.match(seen, /session id: 019a7f2e-1c3d-7a00-9b1e-0123456789ab/);
    assert.match(seen, /done/);
    assert.equal(await run(process.execPath, ['-e', script], { cwd: dir, log, onOutput: () => { throw Error('reader'); } }), 0);
    // The log's appends are not awaited by the run: both runs' lines land there all the same.
    const logged = async () => (await readFile(log, 'utf8').catch(() => '')).match(/session id:/g)?.length ?? 0;
    for (const until = Date.now() + 5000; await logged() < 2 && Date.now() < until;) await new Promise(done => setTimeout(done, 20));
    assert.equal(await logged(), 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// Process groups: the worker and og run on a Linux host.
const linuxOnly ={ skip: process.platform !== 'linux' && 'process groups are the Linux host\'s' };
test('a run whose child exited while something it left holds the output ends anyway, and a stopped run that ignores SIGTERM gets SIGKILL', linuxOnly, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'run-')), log = path.join(dir, 'worker.log');
  try {
    let started = Date.now();
    assert.equal(await run('bash', ['-c', 'sleep 3 & exit 0'], { cwd: dir, log, drainMs: 200 }), 0);
    assert.ok(Date.now() - started < 2000, `${Date.now() - started} ms`);
    const controller = new AbortController();
    started = Date.now();
    const stopped = run('bash', ['-c', 'trap "" TERM; sleep 3; sleep 3'], { cwd: dir, log, signal: controller.signal, graceMs: 200 });
    setTimeout(() => controller.abort(), 100);
    assert.equal(await stopped, 137);
    assert.ok(Date.now() - started < 2000, `${Date.now() - started} ms`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
