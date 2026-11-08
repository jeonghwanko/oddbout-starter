import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBroadcastRunner,
  createPlaywrightRenderer,
  createWorkerTransport,
  ConfirmedRenderFailure,
  WorkerRefusal,
  validateCupResult,
} from '../broadcast/runner.mjs';
import { parseRunnerArgs } from '../scripts/broadcast-runner.mjs';
import { commerceDatabase } from './helpers/commerce-database.mjs';
import { createBroadcastWorkerHandler } from '../broadcast/worker-api.mjs';

const cupResult = (job = claimedJob()) => ({
  protocolVersion: 1,
  jobId: job.id,
  leaseToken: job.leaseToken,
  seed: job.seed,
  winnerId: 'a',
  bouts: [
    { leftId: 'a', rightId: 'b', winnerId: 'a', seed: job.seed, winner: 0, how: 'ko', ms: 1000, hp: [1, 0], contacts: [1, 0], digest: '1234abcd' },
    { leftId: 'c', rightId: 'd', winnerId: 'c', seed: (job.seed + 1) >>> 0, winner: 0, how: 'ko', ms: 1000, hp: [1, 0], contacts: [1, 0], digest: '2345abcd' },
    { leftId: 'a', rightId: 'c', winnerId: 'a', seed: (job.seed + 2) >>> 0, winner: 0, how: 'ko', ms: 1000, hp: [1, 0], contacts: [1, 0], digest: '3456abcd' },
  ],
});
const claimedJob = () => ({
  id: 'job-1',
  broadcastId: 'broadcast-1',
  hostId: 'current-pc',
  channelId: 'channel-1',
  workerId: 'current-pc:worker-one',
  endsAt: new Date(Date.now() + 60_000).toISOString(),
  seed: 123,
  fighterIds: ['a', 'b', 'c', 'd'],
  leaseToken: 2,
});

test('adversarial stale/missing job identity and fabricated engine evidence cannot validate as successful', () => {
  const job = claimedJob();
  assert.throws(() => validateCupResult({ winnerId: 'a', bouts: cupResult().bouts }, job), /runner_invalid_render_result/);
  const complete = {
    protocolVersion: 1,
    jobId: job.id,
    leaseToken: job.leaseToken,
    seed: job.seed,
    winnerId: 'a',
    bouts: [
      { leftId: 'a', rightId: 'b', winnerId: 'a', seed: 123, winner: 0, how: 'ko', ms: 1000, hp: [1, 0], contacts: [1, 0], digest: '1234abcd' },
      { leftId: 'c', rightId: 'd', winnerId: 'c', seed: 124, winner: 0, how: 'ko', ms: 1000, hp: [1, 0], contacts: [1, 0], digest: '1234abcd' },
      { leftId: 'a', rightId: 'c', winnerId: 'a', seed: 125, winner: 0, how: 'ko', ms: 1000, hp: [1, 0], contacts: [1, 0], digest: '1234abcd' },
    ],
  };
  for (const change of [{ jobId: 'different-job' }, { leaseToken: 1 }, { seed: 124 }, { protocolVersion: 2 }])
    assert.throws(() => validateCupResult({ ...complete, ...change }, job), /runner_invalid_render_result/);
  for (const change of [
    { seed: 999 },
    { digest: 'invented' },
    { ms: -1 },
    { winner: 1 },
    { hp: [2, 0] },
    { contacts: [0.5, 0] },
    { contacts: [Number.MAX_SAFE_INTEGER + 1, 0] },
  ]) {
    const bad = structuredClone(complete);
    Object.assign(bad.bouts[0], change);
    assert.throws(() => validateCupResult(bad, job), /runner_invalid_render_result/);
  }
  const verified = validateCupResult(complete, job);
  complete.bouts[0].digest = 'mutated';
  assert.equal(verified.bouts[0].digest, '1234abcd');
});
function fixture(extra = {}) {
  const job = claimedJob();
  const calls = [];
  const obsCalls = [];
  const checkpoints = [];
  let closes = 0;
  let renders = 0;
  const base = {
    hostId: 'current-pc',
    apiOrigin: 'http://localhost:8000',
    workerToken: 'test-worker-token-not-a-credential',
    workerId: 'worker-one',
    arenaUrl: 'http://localhost:5178/broadcast.html',
    heartbeatMs: 5,
    retryMs: 1,
    obs: {
      request: async type => {
        obsCalls.push(type);
        return { outputActive: true, outputReconnecting: false };
      },
      close() {},
    },
    renderer: {
      runCup: async () => {
        renders++;
        return cupResult();
      },
      close: async () => {
        closes++;
      },
    },
    checkpoint: async record => {
      checkpoints.push(record ? structuredClone(record) : null);
    },
    transport: async (command, input) => {
      calls.push({ command, input: structuredClone(input) });
      if (command === 'claim') return job;
      if (command === 'renew') return { ...job };
      return { ...job, status: input.outcome };
    },
  };
  return {
    job,
    calls,
    obsCalls,
    checkpoints,
    get closes() {
      return closes;
    },
    get renders() {
      return renders;
    },
    options: { ...base, ...extra },
  };
}

test('only an observed valid three-bout render completes; existing OBS stream remains untouched', async () => {
  const f = fixture();
  const runner = createBroadcastRunner(f.options);
  const report = await runner.runOnce();
  assert.equal(report.status, 'completed');
  assert.equal(f.renders, 1);
  assert.ok(f.closes >= 1);
  assert.deepEqual(f.obsCalls, ['GetStreamStatus']);
  assert.deepEqual(
    f.calls.map(x => x.command),
    ['claim', 'complete'],
  );
  const complete = f.calls[1].input;
  assert.equal(complete.jobId, f.job.id);
  assert.equal(complete.leaseToken, 2);
  assert.equal(complete.outcome, 'succeeded');
  assert.equal(complete.result.winnerId, 'a');
  assert.deepEqual(complete.result.runnerObservation.broadcast, { verified: false, liveSeconds: null });
  assert.equal(complete.result.runnerObservation.obs.outputActive, true);
  assert.equal(f.checkpoints[0].status, 'claim-pending');
  assert.equal(f.checkpoints.at(-1), null);
});

test('OBS unavailable or reconnecting prevents claim; explicit live stays blocked without channel identity', async () => {
  for (const obs of [
    {
      request: async () => {
        throw new Error('socket unavailable');
      },
      close() {},
    },
    { request: async () => ({ outputActive: true, outputReconnecting: true }), close() {} },
  ]) {
    const f = fixture({ obs });
    const report = await createBroadcastRunner(f.options).runOnce();
    assert.equal(report.status, 'unconfigured');
    assert.equal(report.reason, 'runner_obs_unavailable');
    assert.equal(f.calls.length, 0);
    assert.equal(f.renders, 0);
  }
  const f = fixture({ live: true });
  const report = await createBroadcastRunner(f.options).runOnce();
  assert.equal(report.reason, 'runner_live_channel_unverified');
  assert.equal(f.calls.length, 0);
  assert.equal(f.obsCalls.length, 0);
});

test('malformed/missing renderer result is unknown, never successful, and blocks another claim', async () => {
  for (const value of [undefined, {}, { ...cupResult(), winnerId: 'outsider' }, { ...cupResult(), bouts: cupResult().bouts.slice(0, 2) }]) {
    const f = fixture({ renderer: { runCup: async () => value, close: async () => {} } });
    const runner = createBroadcastRunner(f.options);
    const report = await runner.runOnce();
    assert.equal(report.status, 'unknown');
    const completed = f.calls.filter(x => x.command === 'complete');
    assert.equal(completed.length, 1);
    assert.equal(completed[0].input.outcome, 'unknown');
    const repeated = await runner.runOnce();
    assert.equal(repeated.reason, 'runner_reconciliation_required');
    assert.equal(f.calls.filter(x => x.command === 'claim').length, 1);
    assert.notEqual(f.checkpoints.at(-1), null);
  }
});

test('known pre-dispatch setup failure releases as failed; dispatched browser errors remain unknown', async () => {
  for (const [error, outcome] of [
    [new ConfirmedRenderFailure('runner_renderer_setup_failed'), 'failed'],
    [new Error('browser connection vanished'), 'unknown'],
  ]) {
    const f = fixture({
      renderer: {
        runCup: async () => {
          throw error;
        },
        close: async () => {},
      },
    });
    const report = await createBroadcastRunner(f.options).runOnce();
    assert.equal(report.status, outcome);
    assert.equal(f.calls.find(x => x.command === 'complete').input.outcome, outcome);
    assert.equal(f.checkpoints.at(-1) === null, outcome === 'failed');
  }
});

test('heartbeat renewals maintain fence, and a lost lease aborts rendering even when a late result arrives', async () => {
  const f = fixture();
  let aborted = false;
  let renewals = 0;
  const original = f.options.transport;
  f.options.transport = async (command, input) => {
    if (command === 'renew') {
      renewals++;
      if (renewals === 2) throw new WorkerRefusal('stale-lease', 409);
    }
    return original(command, input);
  };
  f.options.renderer = {
    runCup: async (_, { signal }) =>
      new Promise(resolve =>
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            resolve(cupResult());
          },
          { once: true },
        ),
      ),
    close: async () => {},
  };
  const report = await createBroadcastRunner(f.options).runOnce();
  assert.equal(renewals, 2);
  assert.equal(aborted, true);
  assert.equal(report.status, 'unknown');
  assert.equal(report.reason, 'runner_lease_lost');
  const renew = f.calls.find(x => x.command === 'renew').input;
  assert.equal(renew.leaseToken, 2);
  assert.equal(renew.jobId, f.job.id);
  assert.equal(f.calls.find(x => x.command === 'complete').input.outcome, 'unknown');
});

test('real PostgreSQL lease expiry aborts the runner and quarantines the original job without reexecution or charge', async t => {
  const { db, store } = await commerceDatabase();
  t.after(() => db.close());
  const topup = await store.createTopup('owner', { requestKey: 'topup', amountCents: 500, credits: 200, currency: 'USD' });
  await store.attachOrder('owner', topup.id, 'ORDER');
  await store.creditCapture('owner', topup.id, { providerOrderId: 'ORDER', captureId: 'CAPTURE', amountCents: 500, currency: 'USD', status: 'COMPLETED' });
  const approval = await store.approveBudget('owner', {
    requestKey: 'approval',
    channelId: 'channel',
    hostId: 'current-pc',
    endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    maxCredits: 100,
    allowedTools: ['host_cup'],
    fighterIds: ['a', 'b', 'c', 'd'],
    priceVersion: 'test-v1',
  });
  const broadcast = await store.startBroadcast('owner', { requestKey: 'start', approvalId: approval.id });
  const job = await store.enqueueCup('owner', {
    requestKey: 'cup',
    broadcastId: broadcast.id,
    fighterIds: ['a', 'b', 'c', 'd'],
    priceVersion: 'test-v1',
    priceCredits: 25,
  });
  let renders = 0;
  const f = fixture({
    transport: async (command, input) => {
      if (command === 'claim') return store.claimJob(`current-pc:${input.workerId}`, { hostId: 'current-pc' });
      if (command === 'renew') return store.renewJob(`current-pc:${input.workerId}`, { jobId: input.jobId, leaseToken: input.leaseToken });
      return store.completeJob(`current-pc:${input.workerId}`, {
        jobId: input.jobId,
        leaseToken: input.leaseToken,
        outcome: input.outcome,
        result: input.result,
      });
    },
    renderer: {
      runCup: async (active, { signal }) => {
        renders++;
        await db.query("update commerce.jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1", [active.id]);
        if (signal.aborted) throw new Error('lease already lost');
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('lease lost')), { once: true }));
      },
      close: async () => {},
    },
  });
  const result = await createBroadcastRunner(f.options).runOnce();
  assert.equal(result.status, 'unknown');
  assert.equal(renders, 1);
  assert.equal(f.checkpoints.at(-1).completion.outcome, 'unknown');
  assert.equal((await store.getJob('owner', job.id)).status, 'unknown');
  assert.equal(await store.claimJob('replacement', { hostId: 'current-pc' }), null);
  assert.equal((await store.wallet('owner')).balanceCredits, 200);
  await store.stopBroadcast('owner', broadcast.id);
  assert.equal((await store.wallet('owner')).reservedCredits, 25);
  assert.equal((await db.query("select count(*)::int as n from commerce.ledger where kind='spend'")).rows[0].n, 0);
});

test('transport uncertainty after possible successful completion persists original evidence and never rerenders', async () => {
  const f = fixture();
  const original = f.options.transport;
  f.options.transport = async (command, input) => {
    if (command === 'status') throw new Error('unreachable');
    const value = await original(command, input);
    if (command === 'complete') throw new Error('response lost after commit');
    return value;
  };
  const runner = createBroadcastRunner(f.options);
  const report = await runner.runOnce();
  assert.equal(report.reason, 'runner_completion_outcome_unknown');
  // The ledger takes an identical completion again, so the same evidence is resent, never a new render.
  const completes = f.calls.filter(x => x.command === 'complete');
  assert.equal(completes.length, 3);
  assert.ok(completes.every(x => JSON.stringify(x.input) === JSON.stringify(completes[0].input)));
  const saved = f.checkpoints.at(-1);
  assert.equal(saved.status, 'succeeded');
  assert.equal(saved.completion.outcome, 'succeeded');
  assert.deepEqual(saved.completion.result.bouts, cupResult().bouts);
  assert.equal((await runner.runOnce()).reason, 'runner_reconciliation_required');
  assert.equal(f.renders, 1);
  // A restarted process (its own worker ID) asks under the checkpoint's worker ID and resends the kept completion.
  const restored = fixture({ pending: saved, workerId: 'worker-two' });
  const restoredOriginal = restored.options.transport;
  restored.options.transport = async (command, input) => {
    if (command !== 'status' && command !== 'claim') return restoredOriginal(command, input);
    restored.calls.push({ command, input: structuredClone(input) });
    return command === 'status' ? [{ ...restored.job, status: 'running' }] : null;
  };
  assert.equal((await createBroadcastRunner(restored.options).runOnce()).status, 'idle');
  assert.equal(restored.renders, 0);
  assert.deepEqual(
    restored.calls.filter(x => x.command !== 'claim').map(x => [x.command, x.input.workerId]),
    [
      ['status', 'worker-one'],
      ['complete', 'worker-one'],
    ],
  );
  assert.equal(JSON.stringify(restored.calls.find(x => x.command === 'complete').input), JSON.stringify(saved.completion));
  // Once the ledger already shows the job settled, the checkpoint clears without another request.
  const settled = fixture({ pending: saved });
  settled.options.transport = async (command, input) => {
    settled.calls.push({ command, input });
    return command === 'status' ? [{ ...settled.job, status: 'succeeded' }] : null;
  };
  assert.equal((await createBroadcastRunner(settled.options).runOnce()).status, 'idle');
  assert.deepEqual(
    settled.calls.map(x => x.command),
    ['status', 'claim'],
  );
  assert.equal(settled.checkpoints[0], null);
});

test('lost claim response persists a pre-claim barrier, including when no job ID is known', async () => {
  const f = fixture({
    transport: async () => {
      throw new Error('claim response lost');
    },
  });
  const runner = createBroadcastRunner(f.options);
  assert.equal((await runner.runOnce()).reason, 'runner_claim_outcome_unknown');
  const saved = f.checkpoints.at(-1);
  assert.equal(saved.status, 'claim-pending');
  assert.equal(saved.job, undefined);
  assert.equal((await runner.runOnce()).reason, 'runner_reconciliation_required');
  // Restarted: nothing held under the old worker ID means the claim never happened, so polling resumes.
  const empty = fixture({ pending: saved, workerId: 'worker-two' });
  empty.options.transport = async (command, input) => {
    empty.calls.push({ command, input });
    return command === 'status' ? [] : null;
  };
  assert.equal((await createBroadcastRunner(empty.options).runOnce()).status, 'idle');
  assert.equal(empty.renders, 0);
  assert.deepEqual(
    empty.calls.map(x => [x.command, x.input.workerId]),
    [
      ['status', 'worker-one'],
      ['claim', 'worker-two'],
    ],
  );
  // A job the lost claim did take was never rendered by this runner: it settles as failed, so its credits and host return.
  const held = fixture({ pending: saved, workerId: 'worker-two' });
  const heldOriginal = held.options.transport;
  held.options.transport = async (command, input) => {
    if (command !== 'status' && command !== 'claim') return heldOriginal(command, input);
    held.calls.push({ command, input: structuredClone(input) });
    return command === 'status' ? [{ ...held.job, status: 'running' }] : null;
  };
  assert.equal((await createBroadcastRunner(held.options).runOnce()).status, 'idle');
  assert.equal(held.renders, 0);
  const failed = held.calls.find(x => x.command === 'complete').input;
  assert.deepEqual(
    [failed.workerId, failed.jobId, failed.leaseToken, failed.outcome, failed.result.reason],
    ['worker-one', held.job.id, 2, 'failed', 'runner_claim_reply_lost'],
  );
  // A refused claim (the server answered) took nothing: no barrier, and a bad credential stops the loop.
  for (const [refusal, status] of [
    [new WorkerRefusal('invalid-worker-id', 422), 'idle'],
    [new WorkerRefusal('worker-authentication-required', 401), 'unconfigured'],
    [new WorkerRefusal('runner_api_unreachable', 0), 'idle'],
  ]) {
    const g = fixture({
      transport: async () => {
        throw refusal;
      },
    });
    const result = await createBroadcastRunner(g.options).runOnce();
    assert.equal(result.status, status);
    assert.equal(result.reason, refusal.message);
    assert.equal(g.checkpoints.at(-1), null);
  }
});

test('shutdown aborts the active renderer and retains the fenced unknown job instead of claiming more', async () => {
  const controller = new AbortController();
  let started;
  const running = new Promise(resolve => {
    started = resolve;
  });
  const f = fixture({
    renderer: {
      runCup: async (_, { signal }) => {
        started();
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('closed')), { once: true }));
      },
      close: async () => {},
    },
  });
  const promise = createBroadcastRunner(f.options).runOnce({ signal: controller.signal });
  await running;
  controller.abort();
  const report = await promise;
  assert.equal(report.status, 'unknown');
  assert.equal(report.reason, 'runner_stopped');
  assert.equal(f.calls.find(x => x.command === 'complete').input.outcome, 'unknown');
  assert.equal(f.checkpoints.at(-1).job.id, f.job.id);
});

test('idle clears the pre-claim marker, invalid host claims stay blocked, and checkpoint failures prevent dispatch', async () => {
  const idle = fixture({ transport: async () => null });
  assert.equal((await createBroadcastRunner(idle.options).runOnce()).status, 'idle');
  assert.equal(idle.checkpoints.at(-1), null);
  const wrong = fixture({ transport: async () => ({ ...claimedJob(), hostId: 'office-stable' }) });
  const runner = createBroadcastRunner(wrong.options);
  assert.equal((await runner.runOnce()).reason, 'runner_invalid_claim');
  assert.equal(wrong.renders, 0);
  assert.equal((await runner.runOnce()).reason, 'runner_reconciliation_required');
  const failed = fixture({
    checkpoint: async () => {
      throw new Error('disk full');
    },
  });
  assert.equal((await createBroadcastRunner(failed.options).runOnce()).reason, 'runner_checkpoint_failed');
  assert.equal(failed.calls.length, 0);
  assert.equal(failed.renders, 0);
});

test('worker transport uses fixed authenticated endpoints, bounded signals and redacts server failures', async () => {
  const calls = [];
  const transport = createWorkerTransport({
    apiOrigin: 'https://example.test/functions/v1/ai-fighter/',
    workerToken: 'test-token-never-printed',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true, data: null }), { status: 200 });
    },
  });
  assert.equal(await transport('claim', { workerId: 'worker-one' }), null);
  assert.equal(calls[0].url, 'https://example.test/functions/v1/ai-fighter/commerce-worker/claim');
  assert.equal(calls[0].init.headers.authorization, 'Bearer test-token-never-printed');
  assert.equal(calls[0].init.redirect, 'error');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  const failed = createWorkerTransport({
    apiOrigin: 'https://example.test',
    workerToken: 'test-token-never-printed',
    fetchImpl: async () => new Response('private upstream diagnostic', { status: 409 }),
  });
  await assert.rejects(failed('renew', { jobId: 'job', leaseToken: 2 }), error => error.message === 'runner_worker_request_failed');
  assert.throws(
    () => createWorkerTransport({ apiOrigin: 'https://user:secret@example.test', workerToken: 'test-token-never-printed' }),
    /runner_invalid_api_origin/,
  );
});

test('visible Playwright adapter dispatches exactly the persisted job/fence/seed and closes its browser', async () => {
  const observed = {};
  let closed = 0;
  const page = {
    goto: async (url, options) => {
      observed.url = url;
      observed.navigation = options;
    },
    url: () => observed.url,
    waitForFunction: async () => {},
    frameLocator: selector => {
      observed.frame = selector;
      return {
        locator: selector => ({
          click: async options => {
            observed.audioClick = { selector, options };
          },
        }),
      };
    },
    evaluate: async (_fn, input) => {
      observed.input = input;
      return cupResult();
    },
  };
  const playwright = {
    chromium: {
      launch: async options => {
        observed.launch = options;
        return {
          newContext: async () => ({ newPage: async () => page }),
          close: async () => {
            closed++;
          },
        };
      },
    },
  };
  const renderer = createPlaywrightRenderer({ arenaUrl: 'http://localhost:5178/broadcast.html', playwright, platform: 'win32' });
  const job = claimedJob();
  const output = await renderer.runCup(job, { signal: new AbortController().signal });
  assert.deepEqual(observed.launch, { headless: false });
  assert.deepEqual(observed.input, { jobId: job.id, leaseToken: 2, seed: 123, fighterIds: ['a', 'b', 'c', 'd'] });
  assert.equal(output.rendererObservation.renderer, 'playwright-visible-chromium');
  assert.ok(closed >= 1);
  assert.equal(output.rendererObservation.audioGestureDispatched, true);
  assert.equal(observed.frame, 'iframe[title="ODDBOUT exhibition battle"]');
  assert.equal(observed.audioClick.selector, 'canvas');
  await assert.rejects(renderer.runCup(job, { signal: new AbortController().signal }), ConfirmedRenderFailure);
  const linux = createPlaywrightRenderer({ arenaUrl: 'http://localhost/broadcast.html', platform: 'linux', env: {}, playwright });
  await assert.rejects(linux.runCup(job, { signal: new AbortController().signal }), error => error.message === 'runner_graphical_session_required');
});

test('a failed audio gesture preserves the completed cup without redispatching', async () => {
  let dispatches = 0;
  const arenaUrl = 'http://localhost:5178/broadcast.html';
  const page = {
    goto: async () => {},
    url: () => arenaUrl,
    waitForFunction: async () => {},
    evaluate: async () => {
      dispatches++;
      return cupResult();
    },
    frameLocator: () => ({
      locator: () => ({
        click: async () => {
          throw new Error('canvas detached');
        },
      }),
    }),
  };
  const playwright = { chromium: { launch: async () => ({ newContext: async () => ({ newPage: async () => page }), close: async () => {} }) } };
  const renderer = createPlaywrightRenderer({ arenaUrl, playwright, platform: 'win32' });
  const result = await renderer.runCup(claimedJob(), { signal: new AbortController().signal });
  assert.equal(dispatches, 1);
  assert.equal(result.rendererObservation.audioGestureDispatched, false);
  assert.deepEqual(result.bouts, cupResult().bouts);
});

test('CLI accepts only public selectors and explicit modes; credentials come from environment', () => {
  const args = parseRunnerArgs(['--host', 'svl-mac-01', '--config', 'hosts.json', '--state', 'state.json', '--worker-id', 'mac-worker', '--once']);
  assert.equal(args.hostId, 'svl-mac-01');
  assert.equal(args.once, true);
  assert.equal(args.live, false);
  assert.equal(args.statePath, 'state.json');
  for (const argv of [
    ['--token', 'secret'],
    ['--host', '../../host'],
    ['--once', '--once'],
    ['--config'],
    ['--worker-id', 'invalid:worker'],
    ['--worker-id', 'x'.repeat(65)],
  ])
    assert.throws(() => parseRunnerArgs(argv), /runner_invalid_arguments/);
  assert.ok(parseRunnerArgs(['--host', 'x'.repeat(64)]).workerId.length <= 64);
  assert.equal(parseRunnerArgs(['--live']).live, true);
});

test('worker transport caps streamed bytes and times out ignored aborts or a body that never ends', async () => {
  let cancelled = false;
  const oversized = createWorkerTransport({
    apiOrigin: 'http://localhost:8000',
    workerToken: 'test-token-never-printed',
    requestTimeoutMs: 30,
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(1024 * 1024 + 1));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  await assert.rejects(oversized('claim', {}), /runner_worker_request_failed/);
  assert.equal(cancelled, true);
  const stalled = createWorkerTransport({
    apiOrigin: 'http://localhost:8000',
    workerToken: 'test-token-never-printed',
    requestTimeoutMs: 10,
    fetchImpl: async () => new Promise(() => {}),
  });
  await assert.rejects(stalled('claim', {}), /runner_worker_request_failed/);
  const body = createWorkerTransport({
    apiOrigin: 'http://localhost:8000',
    workerToken: 'test-token-never-printed',
    requestTimeoutMs: 10,
    fetchImpl: async () => new Response(new ReadableStream()),
  });
  await assert.rejects(body('claim', {}), /runner_worker_request_failed/);
});

test('mismatched claimed worker or out-of-range seed never dispatches; rebound renew loses lease immediately', async () => {
  for (const change of [{ workerId: 'current-pc:another-worker' }, { seed: -1 }, { seed: 0x100000000 }]) {
    const f = fixture({ transport: async () => ({ ...claimedJob(), ...change }) });
    assert.equal((await createBroadcastRunner(f.options).runOnce()).reason, 'runner_invalid_claim');
    assert.equal(f.renders, 0);
  }
  const f = fixture();
  let renewals = 0;
  const original = f.options.transport;
  f.options.transport = async (command, input) => {
    if (command === 'renew') {
      renewals++;
      if (renewals > 1) throw new Error();
      return { ...f.job, workerId: 'current-pc:another-worker' };
    }
    return original(command, input);
  };
  f.options.renderer = {
    runCup: async (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error()), { once: true })),
    close: async () => {},
  };
  assert.equal((await createBroadcastRunner(f.options).runOnce()).reason, 'runner_lease_lost');
  assert.equal(renewals, 1);
});

test('shutdown settles when an injected heartbeat ignores abort, retaining unknown allocation', async () => {
  const controller = new AbortController();
  let renewStarted;
  const started = new Promise(resolve => {
    renewStarted = resolve;
  });
  const f = fixture({ requestTimeoutMs: 30 });
  const original = f.options.transport;
  f.options.transport = async (command, input) => {
    if (command === 'renew') {
      renewStarted();
      return new Promise(() => {});
    }
    return original(command, input);
  };
  f.options.renderer = { runCup: async () => new Promise(() => {}), close: async () => {} };
  const running = createBroadcastRunner(f.options).runOnce({ signal: controller.signal });
  await started;
  controller.abort();
  const report = await running;
  assert.equal(report.status, 'unknown');
  assert.equal(report.reason, 'runner_stopped');
  assert.equal(f.checkpoints.at(-1).completion.outcome, 'unknown');
});

test('approval deadline aborts a stalled renderer without reporting late success', async () => {
  const f = fixture();
  f.job.endsAt = new Date(Date.now() + 15).toISOString();
  f.options.renderer = { runCup: async () => new Promise(() => {}), close: async () => {} };
  const result = await createBroadcastRunner(f.options).runOnce();
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'runner_approval_expired');
  assert.equal(f.calls.find(call => call.command === 'complete').input.outcome, 'unknown');
});

test('real worker completion rejects stale or bare renderer evidence and settles only the exact persisted job once', async t => {
  const { db, store } = await commerceDatabase();
  t.after(() => db.close());
  const topup = await store.createTopup('owner', { requestKey: 'proof-topup', amountCents: 500, credits: 200, currency: 'USD' });
  await store.attachOrder('owner', topup.id, 'PROOFORDER');
  await store.creditCapture('owner', topup.id, {
    providerOrderId: 'PROOFORDER',
    captureId: 'PROOFCAPTURE',
    amountCents: 500,
    currency: 'USD',
    status: 'COMPLETED',
  });
  const approval = await store.approveBudget('owner', {
    requestKey: 'proof-approval',
    channelId: 'proof-channel',
    hostId: 'current-pc',
    endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    maxCredits: 100,
    allowedTools: ['host_cup'],
    fighterIds: ['a', 'b', 'c', 'd'],
    priceVersion: 'test-v1',
  });
  const broadcast = await store.startBroadcast('owner', { requestKey: 'proof-start', approvalId: approval.id });
  await store.enqueueCup('owner', {
    requestKey: 'proof-cup',
    broadcastId: broadcast.id,
    fighterIds: ['a', 'b', 'c', 'd'],
    priceVersion: 'test-v1',
    priceCredits: 25,
  });
  const token = 'fixture-worker-credential-32-characters';
  const handle = createBroadcastWorkerHandler({ store, workers: [{ hostId: 'current-pc', token }] });
  const request = async (command, body = {}) => {
    const response = await handle(
      new Request(`https://worker.example/commerce-worker/${command}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ workerId: 'worker-one', ...body }),
      }),
    );
    return { status: response.status, body: await response.json() };
  };
  const job = (await request('claim')).body.data;
  const result = cupResult(job);
  const completion = { jobId: job.id, leaseToken: job.leaseToken, outcome: 'succeeded', result };
  for (const bad of [
    { winnerId: 'a', bouts: result.bouts },
    { ...result, jobId: 'stale-job' },
    { ...result, leaseToken: job.leaseToken + 1 },
    { ...result, seed: (job.seed + 1) >>> 0 },
  ]) {
    const response = await request('complete', { ...completion, result: bad });
    assert.equal(response.status, 422);
    assert.equal((await store.wallet('owner')).balanceCredits, 200);
  }
  assert.equal((await request('complete', completion)).status, 200);
  assert.equal((await request('complete', completion)).status, 200);
  assert.equal((await store.wallet('owner')).balanceCredits, 175);
  assert.equal((await db.query("select count(*)::int as n from commerce.ledger where kind='spend'")).rows[0].n, 1);
});

test('visible renderer refuses a redirected arena before dispatch and treats post-dispatch navigation as unknown', async () => {
  for (const redirectedAt of ['before', 'after']) {
    let pageUrl = 'http://localhost:5178/broadcast.html';
    let dispatched = 0;
    let closed = 0;
    const page = {
      url: () => pageUrl,
      goto: async () => {
        if (redirectedAt === 'before') pageUrl = 'https://attacker.test/broadcast.html';
      },
      waitForFunction: async () => {},
      evaluate: async () => {
        dispatched++;
        if (redirectedAt === 'after') pageUrl = 'https://attacker.test/broadcast.html';
        return cupResult();
      },
    };
    const playwright = {
      chromium: {
        launch: async () => ({
          newContext: async () => ({ newPage: async () => page }),
          close: async () => {
            closed++;
          },
        }),
      },
    };
    const renderer = createPlaywrightRenderer({ arenaUrl: 'http://localhost:5178/broadcast.html', playwright, platform: 'win32' });
    await assert.rejects(renderer.runCup(claimedJob(), { signal: new AbortController().signal }), error =>
      redirectedAt === 'before' ? error instanceof ConfirmedRenderFailure : error.message === 'runner_render_outcome_unknown',
    );
    assert.equal(dispatched, redirectedAt === 'before' ? 0 : 1);
    assert.ok(closed >= 1);
  }
});

test('owned Chromium cleanup failure keeps an observed result unknown and never releases the host slot as completed', async () => {
  let pageUrl = 'http://localhost:5178/broadcast.html';
  let closes = 0;
  const page = {
    url: () => pageUrl,
    goto: async url => {
      pageUrl = url;
    },
    waitForFunction: async () => {},
    evaluate: async () => cupResult(),
  };
  const playwright = {
    chromium: {
      launch: async () => ({
        newContext: async () => ({ newPage: async () => page }),
        close: async () => {
          closes++;
          throw new Error('owned browser did not exit');
        },
      }),
    },
  };
  const f = fixture({ renderer: createPlaywrightRenderer({ arenaUrl: pageUrl, playwright, platform: 'win32' }) });
  const report = await createBroadcastRunner(f.options).runOnce();
  assert.equal(report.status, 'unknown');
  assert.ok(closes >= 1);
  assert.equal(f.calls.find(call => call.command === 'complete').input.outcome, 'unknown');
  assert.deepEqual(f.checkpoints.at(-1).completion.result.observedResult.bouts, cupResult().bouts);
  assert.notEqual(f.checkpoints.at(-1), null);
});

test('cleanup uncertainty persists real result evidence through the worker API while SQL retains credits and the host slot', async t => {
  const { db, store } = await commerceDatabase();
  t.after(() => db.close());
  const topup = await store.createTopup('owner', { requestKey: 'cleanup-topup', amountCents: 500, credits: 200, currency: 'USD' });
  await store.attachOrder('owner', topup.id, 'CLEANUPORDER');
  await store.creditCapture('owner', topup.id, {
    providerOrderId: 'CLEANUPORDER',
    captureId: 'CLEANUPCAPTURE',
    amountCents: 500,
    currency: 'USD',
    status: 'COMPLETED',
  });
  const a = await store.approveBudget('owner', {
    requestKey: 'cleanup-approval',
    channelId: 'cleanup-channel',
    hostId: 'current-pc',
    endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    maxCredits: 100,
    allowedTools: ['host_cup'],
    fighterIds: ['a', 'b', 'c', 'd'],
    priceVersion: 'test-v1',
  });
  const b = await store.startBroadcast('owner', { requestKey: 'cleanup-start', approvalId: a.id });
  const job = await store.enqueueCup('owner', {
    requestKey: 'cleanup-cup',
    broadcastId: b.id,
    fighterIds: ['a', 'b', 'c', 'd'],
    priceVersion: 'test-v1',
    priceCredits: 25,
  });
  const token = 'fixture-cleanup-worker-token-32-characters';
  const handle = createBroadcastWorkerHandler({ store, workers: [{ hostId: 'current-pc', token }] });
  const transport = createWorkerTransport({
    apiOrigin: 'https://worker.example.test',
    workerToken: token,
    fetchImpl: async (url, init) => handle(new Request(url, init)),
  });
  const page = {
    url: () => 'http://localhost:5178/broadcast.html',
    goto: async () => {},
    waitForFunction: async () => {},
    evaluate: async (_, { jobId, leaseToken, seed, fighterIds }) => cupResult({ id: jobId, leaseToken, seed, fighterIds }),
  };
  const playwright = {
    chromium: {
      launch: async () => ({
        newContext: async () => ({ newPage: async () => page }),
        close: async () => {
          throw new Error('owned browser cleanup failed');
        },
      }),
    },
  };
  const f = fixture({ transport, renderer: createPlaywrightRenderer({ arenaUrl: 'http://localhost:5178/broadcast.html', playwright, platform: 'win32' }) });
  const report = await createBroadcastRunner(f.options).runOnce();
  assert.equal(report.status, 'unknown');
  const saved = await store.getJob('owner', job.id);
  assert.equal(saved.status, 'unknown');
  assert.equal(saved.result.reason, 'runner_renderer_cleanup_unknown');
  assert.equal(saved.result.observedResult.jobId, job.id);
  assert.equal(saved.result.observedResult.seed, job.seed);
  assert.equal(saved.result.observedResult.bouts.length, 3);
  assert.equal(await store.claimJob('other-worker', { hostId: 'current-pc' }), null);
  assert.equal((await store.wallet('owner')).balanceCredits, 200);
  await store.stopBroadcast('owner', b.id);
  assert.equal((await store.wallet('owner')).reservedCredits, 25);
  assert.equal((await db.query("select count(*)::int as n from commerce.ledger where kind='spend'")).rows[0].n, 0);
});

test('an explicitly selected browser is used once; launch failure never falls back', async () => {
  const launches = [];
  const playwright = {
    chromium: {
      launch: async options => {
        launches.push(options);
        throw new Error('installed browser unavailable');
      },
    },
  };
  const renderer = createPlaywrightRenderer({
    arenaUrl: 'http://localhost/broadcast.html',
    platform: 'win32',
    playwright,
    env: { ODDBOUT_BROADCAST_BROWSER_CHANNEL: 'chrome' },
  });
  await assert.rejects(renderer.runCup(claimedJob(), { signal: new AbortController().signal }), /runner_renderer_setup_failed/);
  assert.deepEqual(launches, [{ headless: false, channel: 'chrome' }]);
  assert.throws(
    () => createPlaywrightRenderer({ arenaUrl: 'http://localhost/broadcast.html', env: { ODDBOUT_BROADCAST_BROWSER_CHANNEL: 'unreviewed' } }),
    /runner_invalid_browser_channel/,
  );
});

test('a late browser launch after cancellation closes exactly once and never dispatches a cup, a confirmed failure', async () => {
  let launch;
  let closed = 0;
  let dispatched = 0;
  const pending = new Promise(resolve => {
    launch = resolve;
  });
  const playwright = { chromium: { launch: async () => pending } };
  const renderer = createPlaywrightRenderer({ arenaUrl: 'http://localhost:5178/broadcast.html', playwright, platform: 'win32' });
  const controller = new AbortController();
  const result = renderer.runCup(claimedJob(), { signal: controller.signal });
  controller.abort();
  await renderer.close();
  launch({
    newContext: async () => {
      dispatched++;
      throw new Error('must not dispatch');
    },
    close: async () => {
      closed++;
    },
  });
  await assert.rejects(result, error => error instanceof ConfirmedRenderFailure && error.message === 'runner_renderer_setup_failed');
  assert.equal(closed, 1);
  assert.equal(dispatched, 0);
});

test('worker transport separates a refusal the server answered from an uncertain failure', async () => {
  const make = fetchImpl => createWorkerTransport({ apiOrigin: 'http://localhost:8000', workerToken: 'test-worker-token-not-a-credential', fetchImpl });
  const reply = (status, body) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  await assert.rejects(
    make(reply(409, { ok: false, code: 'stale-lease' }))('renew', {}),
    error => error instanceof WorkerRefusal && error.message === 'stale-lease' && error.status === 409,
  );
  await assert.rejects(
    make(reply(503, { ok: false, code: 'worker-request-failed' }))('renew', {}),
    error => !(error instanceof WorkerRefusal) && error.message === 'runner_worker_request_failed',
  );
  await assert.rejects(make(reply(404, '<html>proxy</html>'))('renew', {}), error => !(error instanceof WorkerRefusal));
  await assert.rejects(
    make(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    })('claim', {}),
    error => error instanceof WorkerRefusal && error.status === 0,
  );
  await assert.rejects(
    make(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    })('claim', {}),
    error => !(error instanceof WorkerRefusal),
  );
});

test('a lost claim reply over the real worker API settles after restart: no render, no charge, host free', async t => {
  const { db, store } = await commerceDatabase();
  t.after(() => db.close());
  const topup = await store.createTopup('owner', { requestKey: 'lost-topup', amountCents: 500, credits: 200, currency: 'USD' });
  await store.attachOrder('owner', topup.id, 'LOSTORDER');
  await store.creditCapture('owner', topup.id, {
    providerOrderId: 'LOSTORDER',
    captureId: 'LOSTCAPTURE',
    amountCents: 500,
    currency: 'USD',
    status: 'COMPLETED',
  });
  const approval = await store.approveBudget('owner', {
    requestKey: 'lost-approval',
    channelId: 'lost-channel',
    hostId: 'current-pc',
    endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    maxCredits: 100,
    allowedTools: ['host_cup'],
    fighterIds: ['a', 'b', 'c', 'd'],
    priceVersion: 'test-v1',
  });
  const broadcast = await store.startBroadcast('owner', { requestKey: 'lost-start', approvalId: approval.id });
  const job = await store.enqueueCup('owner', {
    requestKey: 'lost-cup',
    broadcastId: broadcast.id,
    fighterIds: ['a', 'b', 'c', 'd'],
    priceVersion: 'test-v1',
    priceCredits: 25,
  });
  const token = 'fixture-worker-credential-32-characters';
  const handle = createBroadcastWorkerHandler({ store, workers: [{ hostId: 'current-pc', token }] });
  let loseClaim = true;
  const fetchImpl = async (url, init) => {
    const response = await handle(new Request(url, init));
    if (loseClaim && String(url).endsWith('/claim')) {
      loseClaim = false;
      throw new TypeError('fetch failed');
    }
    return response;
  };
  const options = f => ({ ...f.options, transport: createWorkerTransport({ apiOrigin: 'http://localhost:8000', workerToken: token, fetchImpl }) });
  const first = fixture();
  assert.equal((await createBroadcastRunner(options(first)).runOnce()).reason, 'runner_claim_outcome_unknown');
  assert.equal((await store.getJob('owner', job.id)).status, 'running');
  const restarted = fixture({ pending: first.checkpoints.at(-1), workerId: 'worker-two' });
  assert.equal((await createBroadcastRunner(options(restarted)).runOnce()).status, 'idle');
  assert.equal(first.renders + restarted.renders, 0);
  const settled = await store.getJob('owner', job.id);
  assert.equal(settled.status, 'failed');
  assert.equal(settled.result.reason, 'runner_claim_reply_lost');
  assert.equal((await store.wallet('owner')).balanceCredits, 200);
  assert.equal(restarted.checkpoints.at(-1), null);
  const bad = await handle(
    new Request('https://worker.example/commerce-worker/status', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ workerId: 'worker-one', jobId: 'not-a-uuid' }),
    }),
  );
  assert.equal(bad.status, 422);
  assert.equal((await bad.json()).code, 'invalid-job-id');
});
