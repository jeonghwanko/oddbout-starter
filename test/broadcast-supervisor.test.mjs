import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommerceMcpHandler, createIssuedProducerGrants } from '../mcp/cloud/commerce-handler.mjs';
import { createCommerceHandler } from '../api/commerce/handler.mjs';
import { createCommerceService } from '../api/commerce/service.mjs';
import { createProducerMcp } from '../broadcast/producer.mjs';
import { createProducerSupervisor } from '../broadcast/supervisor.mjs';
import { autoProducerFromEnvironment } from '../scripts/broadcast-demo.mjs';
import { commerceDatabase } from './helpers/commerce-database.mjs';

const ORIGIN = 'http://127.0.0.1:5180';
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
// Five approved fighters: the model has to choose four, so a job's fighters prove whose decision it was.
const FIGHTERS = ['kuma', 'yume', 'bravow', 'beotim', 'quickcat'];
const rpc = (method, params = {}) => ({ jsonrpc: '2.0', id: 1, method, params });
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

/** Bounded polling, never a blind sleep: resolves with the first truthy value of check(). */
async function until(check, label, milliseconds = 10_000) {
  const deadline = Date.now() + milliseconds;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${label}`);
    await pause(10);
  }
}

// The only fake: the external model boundary. Everything else (MCP SDK, handler, ledger SQL, producer) is real.
const hostCup = context => ({
  action: 'host_cup',
  fighterIds: context.eligibleFighterIds.slice(-4),
  reason: 'Four approved fighters are available.',
  episode: 'NIGHTCROWN: Test',
});
const wait = () => ({ action: 'wait', fighterIds: null, reason: 'Waiting for the next window.', episode: null });
const stop = () => ({ action: 'stop', fighterIds: null, reason: 'Done for the night.', episode: null });
function fakeModel(decide = hostCup) {
  const calls = [];
  const call = async (context, { signal } = {}) => {
    calls.push(context);
    const decision = await decide(context, signal);
    return { decision, observation: { answeredModel: 'test-model' } };
  };
  return { call, calls };
}
function gate() {
  let release;
  const open = new Promise(resolve => {
    release = resolve;
  });
  return { open, release };
}

async function fixture(t) {
  const cleanups = [];
  // One LIFO hook: supervisors stop before the database closes and before their state directories disappear.
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
  });
  const database = await commerceDatabase();
  cleanups.push(() => database.db.close());
  const service = createCommerceService({ store: database.store, paypal: null, publicOrigin: ORIGIN, hosts: [{ id: 'current-pc' }] });
  for (const owner of [OWNER, OTHER]) {
    const topup = await database.store.createTopup(owner, { requestKey: 'fixture-funding', amountCents: 1000, credits: 1000, currency: 'USD' });
    await database.store.attachOrder(owner, topup.id, `ORDER-${owner}`);
    await database.store.creditCapture(owner, topup.id, {
      providerOrderId: `ORDER-${owner}`,
      captureId: `CAPTURE-${owner}`,
      amountCents: 1000,
      currency: 'USD',
      status: 'COMPLETED',
    });
  }
  const issued = createIssuedProducerGrants();
  const handle = createCommerceMcpHandler({ db: { rpc: database.rpc }, commerce: { service, publicOrigin: ORIGIN }, producers: [], issued });
  const stateDirs = [];
  let channels = 0;

  /** A human approval through the real handler: same-origin and explicitly confirmed. */
  async function approve(owner) {
    const human = createCommerceHandler({ service, publicOrigin: ORIGIN, authenticate: async () => owner });
    const response = await human(
      new Request(`${ORIGIN}/commerce/approvals`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({
          confirmed: true,
          requestKey: randomUUID(),
          hostId: 'current-pc',
          channelId: `channel-${++channels}`,
          endsAt: new Date(Date.now() + 3_600_000).toISOString(),
          maxCredits: 100,
          fighterIds: FIGHTERS,
        }),
      }),
    );
    assert.equal(response.status, 200);
    return (await response.json()).data;
  }
  const startedSession = async owner => service.start(owner, { requestKey: randomUUID(), approvalId: (await approve(owner)).id });
  async function stateDir() {
    const directory = await mkdtemp(join(tmpdir(), 'oddbout-supervisor-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    stateDirs.push(directory);
    return directory;
  }
  /** A supervisor wired like production (in-process MCP against the real handler), plus recorders. */
  async function supervise({ model = fakeModel(), directory, wrapFetch, ...options } = {}) {
    const mcpCalls = [],
      issuances = [];
    const grants = {
      issue: (owner, broadcastId, expiresAt) => {
        const grant = issued.issue(owner, broadcastId, expiresAt);
        issuances.push({ owner, broadcastId, expiresAt, token: grant.token });
        return grant;
      },
    };
    const mcpFetch = (input, init) => {
      let tool;
      try {
        const body = JSON.parse(init.body);
        if (body.method === 'tools/call') {
          tool = body.params.name;
          mcpCalls.push({ tool, broadcastId: body.params.arguments?.broadcastId });
        }
      } catch {
        /* not a JSON-RPC body */
      }
      const request = new Request(input, init);
      return wrapFetch ? wrapFetch(request, () => handle(request), tool) : handle(request);
    };
    const supervisor = createProducerSupervisor({
      grants,
      service,
      mcpUrl: `${ORIGIN}/mcp`,
      mcpFetch,
      model: 'test-model',
      modelCall: model.call,
      stateDir: directory ?? (await stateDir()),
      pollMs: 20,
      ...options,
    });
    cleanups.push(() => supervisor.close());
    return { supervisor, model, mcpCalls, issuances };
  }
  const polls = (run, name) => run.mcpCalls.filter(call => call.tool === name).length;
  const jobsOf = async (owner, broadcast) => (await service.report(owner, broadcast.id)).jobs;
  const checkpoint = async (directory, broadcast) => JSON.parse(await readFile(join(directory, `producer-${broadcast.id}.json`), 'utf8'));
  return { ...database, service, issued, handle, approve, startedSession, stateDir, supervise, polls, jobsOf, checkpoint };
}

test('explicit retry preserves call limits and queues once; another owner cannot restart it', async t => {
  const f = await fixture(t),
    broadcast = await f.startedSession(OWNER),
    directory = await f.stateDir();
  let attempts = 0;
  const run = await f.supervise({
    directory,
    model: fakeModel(context => {
      if (++attempts === 1) throw new Error('invalid model response');
      return hostCup(context);
    }),
  });
  run.supervisor.ensure(OWNER, broadcast.id);
  await until(() => run.supervisor.status(OWNER, broadcast.id).canRetry, 'failed model');
  assert.equal((await f.jobsOf(OWNER, broadcast)).length, 0);
  await assert.rejects(run.supervisor.retry(OTHER, broadcast.id), /producer-retry-unavailable/);
  await Promise.all([run.supervisor.retry(OWNER, broadcast.id), run.supervisor.retry(OWNER, broadcast.id)]);
  await until(async () => (await f.jobsOf(OWNER, broadcast)).length === 1, 'retried job');
  assert.equal(run.model.calls.length, 2);
  assert.equal(run.supervisor.status(OWNER, broadcast.id).modelCalls, 2);
  const saved = await f.checkpoint(directory, broadcast);
  assert.equal(saved.producer.retries.length, 1);
  assert.equal(saved.producer.retries[0].reason, 'producer_model_outcome_unverified');
});

test('auto start: ensure() runs the producer for a started session, which queues a host_cup job with the model fighters and no one else asks for a cup', async t => {
  const f = await fixture(t);
  const broadcast = await f.startedSession(OWNER);
  const directory = await f.stateDir();
  const run = await f.supervise({ directory });
  assert.deepEqual(await f.jobsOf(OWNER, broadcast), []);
  // Repeated starts of the same session (any id casing) race for one producer, never two.
  run.supervisor.ensure(OWNER, broadcast.id);
  run.supervisor.ensure(OWNER, broadcast.id);
  run.supervisor.ensure(OWNER.toUpperCase(), broadcast.id.toUpperCase());

  const [job] = await until(async () => {
    const jobs = await f.jobsOf(OWNER, broadcast);
    return jobs.length > 0 && jobs;
  }, 'host_cup job');
  assert.equal(job.tool, 'host_cup');
  assert.equal(job.broadcastId, broadcast.id);
  assert.equal(job.owner, OWNER);
  assert.deepEqual(job.fighterIds, FIGHTERS.slice(-4));
  assert.equal(job.status, 'queued');

  // The model's proposal was the only input: it saw the session's approved fighters, and the single cup request came from the producer.
  assert.equal(run.model.calls.length, 1);
  assert.equal(run.model.calls[0].broadcastId, broadcast.id);
  assert.deepEqual(run.model.calls[0].eligibleFighterIds, FIGHTERS);
  assert.equal(f.polls(run, 'host_cup'), 1);
  const saved = await until(async () => {
    const record = await f.checkpoint(directory, broadcast);
    return record.producer?.pending?.status === 'queued' && record;
  }, 'checkpointed queued cup');
  assert.equal(saved.producer.pending.requestKey, job.requestKey);
  assert.equal(saved.producer.pending.jobId, job.id);
  assert.equal(saved.owner, OWNER);
  assert.equal(saved.result, null);

  const status = run.supervisor.status(OWNER, broadcast.id);
  assert.ok(['running', 'finished'].includes(status.state), status.state);
  assert.ok(status.modelCalls >= 1);
  assert.equal(status.model, 'test-model');
  assert.equal(status.decisions.at(-1).action, 'host_cup');
  assert.deepEqual(status.decisions.at(-1).fighterIds, FIGHTERS.slice(-4));
  assert.equal(status.decisions.at(-1).episode, 'NIGHTCROWN: Test');
  assert.equal(status.decisions.at(-1).answeredModel, 'test-model');

  // Idempotent: the same session is supervised once. Later ensure() calls buy neither a model call, a grant nor a second cup.
  run.supervisor.ensure(OWNER, broadcast.id);
  const before = f.polls(run, 'get_broadcast_job');
  await until(() => f.polls(run, 'get_broadcast_job') >= before + 2, 'two more producer polls');
  assert.equal(run.model.calls.length, 1);
  assert.equal(run.issuances.length, 1);
  assert.equal(f.polls(run, 'host_cup'), 1);
  assert.equal((await f.jobsOf(OWNER, broadcast)).length, 1);
  // Never throws into a start request, whatever it is handed.
  for (const [owner, id] of [
    ['not-a-uuid', broadcast.id],
    [OWNER, 'not-a-uuid'],
    [undefined, undefined],
  ])
    assert.equal(run.supervisor.ensure(owner, id), undefined);
});

test('auto start through the demo wiring: the start response does not wait for the producer, and the status route reports it', async t => {
  const f = await fixture(t);
  const release = gate();
  const run = await f.supervise({
    model: fakeModel(async context => {
      await release.open;
      return hostCup(context);
    }),
  });
  // Same shape as scripts/broadcast-demo.mjs: wrap start to supervise the new session, and expose its status.
  const wired = {
    ...f.service,
    async start(owner, input) {
      const broadcast = await f.service.start(owner, input);
      run.supervisor.ensure(owner, broadcast.id);
      return broadcast;
    },
    producer: (owner, id) => run.supervisor.status(owner, id),
  };
  const api = createCommerceHandler({ service: wired, publicOrigin: ORIGIN, authenticate: async () => OWNER });

  const approval = await f.approve(OWNER);
  const started = await api(
    new Request(`${ORIGIN}/commerce/broadcasts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestKey: randomUUID(), approvalId: approval.id }),
    }),
  );
  assert.equal(started.status, 200);
  const broadcast = (await started.json()).data;
  // The model call is still pending, yet the start request already returned.
  await until(() => run.model.calls.length === 1, 'first model call');
  const route = () => api(new Request(`${ORIGIN}/commerce/broadcasts/${broadcast.id}/producer`)).then(response => response.json());
  assert.equal((await route()).data.state, 'running');
  assert.deepEqual(await f.jobsOf(OWNER, broadcast), []);

  release.release();
  await until(async () => (await f.jobsOf(OWNER, broadcast)).length === 1, 'host_cup job');
  const body = await route();
  assert.equal(body.ok, true);
  assert.ok(['running', 'finished'].includes(body.data.state));
  assert.equal(body.data.decisions[0].action, 'host_cup');
  assert.equal(run.model.calls.length, 1);
});

test("ownership: status is owner-scoped and an issued grant cannot reach another owner's session", async t => {
  const f = await fixture(t);
  const mine = await f.startedSession(OWNER),
    foreign = await f.startedSession(OTHER);
  const run = await f.supervise();
  run.supervisor.ensure(OWNER, mine.id);
  await until(async () => (await f.jobsOf(OWNER, mine)).length === 1, 'OWNER cup');

  assert.deepEqual(run.supervisor.status(OTHER, mine.id), { state: 'none' });
  assert.deepEqual(run.supervisor.status(OTHER.toUpperCase(), mine.id.toUpperCase()), { state: 'none' });
  assert.deepEqual(run.supervisor.status(OWNER, foreign.id), { state: 'none' });
  assert.deepEqual(run.supervisor.status(OWNER, 'not-a-uuid'), { state: 'none' });
  assert.equal(run.supervisor.status(OWNER.toUpperCase(), mine.id.toUpperCase()).decisions[0].action, 'host_cup');
  assert.notEqual(run.supervisor.status(OWNER, mine.id).state, 'none');

  // OTHER's session was never touched by OWNER's producer: not in a model context, not in a tool call, no job, no grant.
  assert.ok(run.model.calls.every(context => context.broadcastId === mine.id));
  assert.ok(run.mcpCalls.every(call => call.broadcastId === undefined || call.broadcastId === mine.id));
  assert.deepEqual(
    run.issuances.map(item => [item.owner, item.broadcastId]),
    [[OWNER, mine.id]],
  );
  assert.deepEqual(await f.jobsOf(OTHER, foreign), []);

  // The issued grant itself is bound to one session: another owner's session and jobs are refused by the real handler.
  const grant = f.issued.issue(OWNER, mine.id, Date.parse(mine.endsAt));
  const mcp = await createProducerMcp({ url: `${ORIGIN}/mcp`, token: grant.token, fetchImpl: (input, init) => f.handle(new Request(input, init)) });
  t.after(() => mcp.close());
  await assert.rejects(mcp.callTool('get_broadcast_report', { broadcastId: foreign.id }), /producer_mcp_call_failed/);
  await assert.rejects(mcp.callTool('get_broadcast', { broadcastId: foreign.id }), /producer_mcp_call_failed/);
  await assert.rejects(
    mcp.callTool('host_cup', { broadcastId: foreign.id, requestKey: randomUUID(), fighterIds: FIGHTERS.slice(0, 4) }),
    /producer_mcp_call_failed/,
  );
  assert.deepEqual(await f.jobsOf(OTHER, foreign), []);
  const foreignJob = await f.service.cup(OTHER, { requestKey: randomUUID(), broadcastId: foreign.id, fighterIds: FIGHTERS.slice(0, 4) });
  await assert.rejects(mcp.callTool('get_broadcast_job', { jobId: foreignJob.id }), /producer_mcp_call_failed/);
  assert.equal((await f.jobsOf(OTHER, foreign)).length, 1);
  assert.equal((await mcp.callTool('get_broadcast_report', { broadcastId: mine.id })).broadcast.id, mine.id);
  // A grant that pairs OWNER with OTHER's session cannot even open an MCP connection.
  const mismatched = f.issued.issue(OWNER, foreign.id, Date.parse(foreign.endsAt));
  await assert.rejects(
    createProducerMcp({ url: `${ORIGIN}/mcp`, token: mismatched.token, fetchImpl: (input, init) => f.handle(new Request(input, init)) }),
    /producer_mcp_connection_failed/,
  );
  mismatched.revoke();
  grant.revoke();
});

test('restart resume: a new supervisor continues the queued cup without another model call or a second job', async t => {
  const f = await fixture(t);
  const broadcast = await f.startedSession(OWNER);
  const directory = await f.stateDir();

  const first = await f.supervise({ directory });
  assert.equal(await first.supervisor.resume(), 0, 'an empty state directory has nothing to resume');
  first.supervisor.ensure(OWNER, broadcast.id);
  const [job] = await until(async () => {
    const jobs = await f.jobsOf(OWNER, broadcast);
    return jobs.length > 0 && jobs;
  }, 'host_cup job');
  await until(async () => (await f.checkpoint(directory, broadcast)).producer?.pending?.status === 'queued', 'checkpointed queued cup');
  await first.supervisor.close();
  assert.equal(first.model.calls.length, 1);
  assert.equal(f.issued.size, 0, 'closing revokes the producer grant');

  // No job is claimed here, so the cup stays queued: the resumed producer may only watch it.
  const second = await f.supervise({ directory });
  assert.equal(await second.supervisor.resume(), 1);
  const resumed = second.supervisor.status(OWNER, broadcast.id);
  assert.equal(resumed.state, 'running');
  assert.equal(resumed.modelCalls, 1);
  assert.equal(resumed.decisions[0].action, 'host_cup');
  await until(() => f.polls(second, 'get_broadcast_job') >= 3, 'resumed producer reconciles the queued job');
  assert.equal(second.model.calls.length, 0);
  assert.equal(f.polls(second, 'host_cup'), 0);
  const jobs = await f.jobsOf(OWNER, broadcast);
  assert.deepEqual(
    jobs.map(item => [item.id, item.status]),
    [[job.id, 'queued']],
  );
  assert.equal((await f.db.query("select count(*)::int as n from commerce.jobs where tool = 'host_cup'")).rows[0].n, 1);
  assert.equal(second.supervisor.status(OWNER, broadcast.id).state, 'running');
  assert.equal((await f.checkpoint(directory, broadcast)).result, null);
});

test('finished sessions are never restarted: resume() skips them and ensure() makes no model call', async t => {
  const f = await fixture(t);
  const broadcast = await f.startedSession(OWNER);
  const directory = await f.stateDir();

  const first = await f.supervise({ directory, model: fakeModel(stop) });
  first.supervisor.ensure(OWNER, broadcast.id);
  const finished = await until(() => {
    const status = first.supervisor.status(OWNER, broadcast.id);
    return status.state === 'finished' && status;
  }, 'stop decision');
  assert.equal(finished.result.status, 'stopped');
  assert.equal(finished.result.reason, 'Done for the night.');
  assert.equal(finished.decisions.at(-1).action, 'stop');
  assert.equal(first.model.calls.length, 1);
  assert.deepEqual(await f.jobsOf(OWNER, broadcast), []);
  const saved = await f.checkpoint(directory, broadcast);
  assert.equal(saved.result.status, 'stopped');
  assert.equal(saved.producer.halted, 'producer_model_stop');
  await first.supervisor.close();

  // After resume(): known as finished, nothing launched.
  const second = await f.supervise({ directory });
  assert.equal(await second.supervisor.resume(), 0);
  second.supervisor.ensure(OWNER, broadcast.id);
  assert.equal(second.supervisor.status(OWNER, broadcast.id).state, 'finished');
  assert.equal(second.supervisor.status(OWNER, broadcast.id).result.reason, 'Done for the night.');
  // Without resume(): ensure() reads the checkpoint, sees the result, and still launches nothing paid.
  const third = await f.supervise({ directory });
  third.supervisor.ensure(OWNER, broadcast.id);
  await until(() => third.supervisor.status(OWNER, broadcast.id).state === 'finished', 'checkpoint result loaded');
  await pause(150);
  for (const run of [second, third]) {
    assert.equal(run.model.calls.length, 0);
    assert.deepEqual(run.mcpCalls, []);
    assert.deepEqual(run.issuances, []);
    assert.equal(run.supervisor.status(OWNER, broadcast.id).state, 'finished');
  }
  assert.deepEqual(await f.jobsOf(OWNER, broadcast), []);
  assert.equal((await f.checkpoint(directory, broadcast)).result.reason, 'Done for the night.');
});

test("limits: maxActive 1 holds the second owner's session in waiting until the first finishes", async t => {
  const f = await fixture(t);
  const first = await f.startedSession(OWNER),
    second = await f.startedSession(OTHER);
  const release = gate();
  let firstWhenSecondAsked;
  const model = fakeModel(async context => {
    if (context.broadcastId === first.id) await release.open;
    else firstWhenSecondAsked = run.supervisor.status(OWNER, first.id).state;
    return stop();
  });
  const run = await f.supervise({ model, maxActive: 1 });
  run.supervisor.ensure(OWNER, first.id);
  run.supervisor.ensure(OTHER, second.id);

  await until(() => model.calls.length === 1, 'first producer at the model');
  assert.equal(run.supervisor.status(OWNER, first.id).state, 'running');
  assert.equal(run.supervisor.status(OTHER, second.id).state, 'waiting');
  assert.equal(f.issued.size, 1, 'a waiting session holds no grant');
  await pause(150);
  assert.equal(model.calls.length, 1);
  assert.equal(run.supervisor.status(OTHER, second.id).state, 'waiting');

  release.release();
  await until(() => run.supervisor.status(OWNER, first.id).state === 'finished', 'first finished');
  await until(() => run.supervisor.status(OTHER, second.id).state === 'finished', 'second finished');
  assert.equal(firstWhenSecondAsked, 'finished', 'the second producer started only after the first had finished');
  assert.deepEqual(
    model.calls.map(context => context.broadcastId),
    [first.id, second.id],
  );
  assert.equal(f.issued.size, 0);
});

test('limits: one account runs one producer at a time across channels, while other accounts are not held back', async t => {
  const f = await fixture(t);
  const first = await f.startedSession(OWNER),
    sibling = await f.startedSession(OWNER),
    stranger = await f.startedSession(OTHER);
  const sessions = await Promise.all([first, sibling].map(async broadcast => (await f.service.report(OWNER, broadcast.id)).broadcast));
  assert.notEqual(sessions[0].channelId, sessions[1].channelId);
  const release = gate();
  let firstWhenSiblingAsked;
  const model = fakeModel(async context => {
    if (context.broadcastId === sibling.id) firstWhenSiblingAsked = run.supervisor.status(OWNER, first.id).state;
    await release.open;
    return stop();
  });
  const run = await f.supervise({ model, maxActive: 3 });
  run.supervisor.ensure(OWNER, first.id);
  run.supervisor.ensure(OWNER, sibling.id);
  run.supervisor.ensure(OTHER, stranger.id);

  await until(() => model.calls.length === 2, 'first and other-account producers at the model');
  assert.deepEqual(model.calls.map(context => context.broadcastId).sort(), [first.id, stranger.id].sort());
  assert.equal(run.supervisor.status(OWNER, first.id).state, 'running');
  assert.equal(run.supervisor.status(OTHER, stranger.id).state, 'running');
  assert.equal(run.supervisor.status(OWNER, sibling.id).state, 'waiting');
  await pause(150);
  assert.equal(model.calls.length, 2);
  assert.equal(run.supervisor.status(OWNER, sibling.id).state, 'waiting');

  release.release();
  for (const [owner, broadcast] of [
    [OWNER, first],
    [OWNER, sibling],
    [OTHER, stranger],
  ])
    await until(() => run.supervisor.status(owner, broadcast.id).state === 'finished', `${broadcast.id} finished`);
  assert.equal(firstWhenSiblingAsked, 'finished');
  assert.equal(model.calls.length, 3);
});

test('limits: dailyModelCalls 1 refuses the second session before the model is called and records the reason', async t => {
  const f = await fixture(t);
  const first = await f.startedSession(OWNER),
    second = await f.startedSession(OTHER);
  const today = Date.now();
  const run = await f.supervise({ model: fakeModel(stop), dailyModelCalls: 1, now: () => today });
  run.supervisor.ensure(OWNER, first.id);
  await until(() => run.supervisor.status(OWNER, first.id).state === 'finished', 'first session');
  assert.equal(run.supervisor.status(OWNER, first.id).result.reason, 'Done for the night.');

  run.supervisor.ensure(OTHER, second.id);
  const limited = await until(() => {
    const status = run.supervisor.status(OTHER, second.id);
    return status.state === 'finished' && status;
  }, 'second session');
  assert.equal(limited.result.reason, 'producer_daily_model_limit');
  assert.equal(run.model.calls.length, 1, 'the fake model was not invoked for the refused call');
  assert.equal(run.model.calls[0].broadcastId, first.id);
  assert.deepEqual(await f.jobsOf(OTHER, second), []);
  assert.equal(f.issued.size, 0);
});

test('grant revocation: the issued grant authenticates only while its producer runs, and never after it finishes, is closed, or fails', async t => {
  const f = await fixture(t);
  const [finishing, closing, failing] = [await f.startedSession(OWNER), await f.startedSession(OWNER), await f.startedSession(OWNER)];
  const listTools = token =>
    f.handle(
      new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        body: JSON.stringify(rpc('tools/list')),
        headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', authorization: `Bearer ${token}` },
      }),
    );

  // Finished by a stop decision.
  const release = gate();
  const run = await f.supervise({
    model: fakeModel(async () => {
      await release.open;
      return stop();
    }),
  });
  run.supervisor.ensure(OWNER, finishing.id);
  await until(() => run.model.calls.length === 1, 'producer at the model');
  assert.equal(f.issued.size, 1);
  const [issuance] = run.issuances;
  assert.deepEqual([issuance.owner, issuance.broadcastId, issuance.expiresAt], [OWNER, finishing.id, Date.parse(finishing.endsAt)]);
  assert.equal((await listTools(issuance.token)).status, 200);
  release.release();
  await until(() => run.supervisor.status(OWNER, finishing.id).state === 'finished', 'producer finished');
  assert.equal(f.issued.size, 0);
  const refused = await listTools(issuance.token);
  assert.equal(refused.status, 401);
  assert.equal((await refused.json()).code, 'producer-credential-required');

  // Closed while running: shutdown is not an outcome, but the credential must not outlive the loop.
  const hold = await f.supervise({ model: fakeModel(() => new Promise(() => {})) });
  hold.supervisor.ensure(OWNER, closing.id);
  await until(() => hold.model.calls.length === 1, 'second producer at the model');
  assert.equal(f.issued.size, 1);
  assert.equal((await listTools(hold.issuances[0].token)).status, 200);
  await hold.supervisor.close();
  assert.equal(f.issued.size, 0);
  assert.equal((await listTools(hold.issuances[0].token)).status, 401);
  assert.equal(hold.supervisor.status(OWNER, closing.id).result, null, 'a shutdown is not recorded as a result');

  // The model fails: the producer ends as unverified and still revokes.
  const broken = await f.supervise({
    model: fakeModel(() => {
      throw new Error('model unavailable');
    }),
  });
  broken.supervisor.ensure(OWNER, failing.id);
  const failed = await until(() => {
    const status = broken.supervisor.status(OWNER, failing.id);
    return status.state === 'finished' && status;
  }, 'failed producer');
  assert.notEqual(failed.result.status, 'queued');
  assert.equal(f.issued.size, 0);
  assert.equal((await listTools(broken.issuances[0].token)).status, 401);
});

test('autoProducerFromEnvironment: unset or 0 is off, 1 needs an explicit model and key, anything else is refused', async t => {
  // Configuration branches only: nothing here makes a model or network call.
  const parts = { commerce: { service: {}, publicOrigin: ORIGIN }, issued: createIssuedProducerGrants(), mcp: async () => new Response(null, { status: 500 }) };
  assert.equal(autoProducerFromEnvironment({}, parts), null);
  assert.equal(autoProducerFromEnvironment({ ODDBOUT_BROADCAST_AUTO_PRODUCER: '0' }, parts), null);
  assert.equal(autoProducerFromEnvironment({ ODDBOUT_BROADCAST_AUTO_PRODUCER: '0', ODDBOUT_BROADCAST_MODEL: 'm', OPENAI_API_KEY: 'k' }, parts), null);

  for (const env of [
    {},
    { ODDBOUT_BROADCAST_MODEL: 'test-model' },
    { OPENAI_API_KEY: 'sk-test' },
    { ODDBOUT_BROADCAST_MODEL: '', OPENAI_API_KEY: 'sk-test' },
    { ODDBOUT_BROADCAST_MODEL: 'test-model', OPENAI_API_KEY: '' },
  ]) {
    assert.throws(() => autoProducerFromEnvironment({ ODDBOUT_BROADCAST_AUTO_PRODUCER: '1', ...env }, parts), /auto-producer-model-required/);
  }
  for (const value of ['', 'true', 'yes', 'on', '2', ' 1', '1 ', 'TRUE', '01']) {
    assert.throws(
      () => autoProducerFromEnvironment({ ODDBOUT_BROADCAST_AUTO_PRODUCER: value, ODDBOUT_BROADCAST_MODEL: 'test-model', OPENAI_API_KEY: 'sk-test' }, parts),
      /invalid-auto-producer-setting/,
      JSON.stringify(value),
    );
  }

  // A complete configuration builds a supervisor (construction only; no request is sent).
  const directory = await mkdtemp(join(tmpdir(), 'oddbout-supervisor-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const complete = {
    ODDBOUT_BROADCAST_AUTO_PRODUCER: '1',
    ODDBOUT_BROADCAST_MODEL: 'test-model',
    OPENAI_API_KEY: 'sk-test',
    ODDBOUT_BROADCAST_PRODUCER_STATE_DIR: directory,
  };
  const supervisor = autoProducerFromEnvironment(complete, parts);
  t.after(() => supervisor.close());
  assert.deepEqual(Object.keys(supervisor).sort(), ['close', 'ensure', 'resume', 'retry', 'status']);
  assert.deepEqual(supervisor.status(OWNER, randomUUID()), { state: 'none' });
  // Limits are validated up front, not when the first session starts.
  for (const [name, value] of [
    ['ODDBOUT_BROADCAST_AUTO_PRODUCER_MAX_ACTIVE', '0'],
    ['ODDBOUT_BROADCAST_AUTO_PRODUCER_DAILY_CALLS', 'many'],
    ['ODDBOUT_BROADCAST_MAX_MODEL_CALLS', '101'],
  ]) {
    assert.throws(() => autoProducerFromEnvironment({ ...complete, [name]: value }, parts), /producer_supervisor_invalid_configuration/, name);
  }
});

test('status route: GET /commerce/broadcasts/:id/producer serves the supervisor status, and a plain service has no such route', async t => {
  const f = await fixture(t);
  const broadcast = await f.startedSession(OWNER);
  const run = await f.supervise({ model: fakeModel(wait) });
  const service = { ...f.service, producer: (owner, id) => run.supervisor.status(owner, id) };
  const handler = authenticate => createCommerceHandler({ service, authenticate, publicOrigin: ORIGIN });
  const get = (api, id = broadcast.id) => api(new Request(`${ORIGIN}/commerce/broadcasts/${id}/producer`));
  const api = handler(async () => OWNER);

  // Before the producer is launched there is nothing to show.
  const idle = await get(api);
  assert.equal(idle.status, 200);
  assert.deepEqual(await idle.json(), { ok: true, data: { state: 'none' } });

  run.supervisor.ensure(OWNER, broadcast.id);
  await until(() => run.model.calls.length === 1, 'model decision');
  const response = await get(api);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.state, 'running');
  assert.equal(body.data.model, 'test-model');
  assert.equal(body.data.result, null);
  assert.equal(body.data.maxModelCalls, 24);
  assert.equal(body.data.modelCalls, 1);
  assert.equal(body.data.decisions.length, 1);
  assert.deepEqual(Object.keys(body.data.decisions[0]).sort(), ['action', 'answeredModel', 'at', 'episode', 'fighterIds', 'outcome', 'reason', 'sequence']);
  assert.equal(body.data.decisions[0].action, 'wait');
  assert.equal(body.data.decisions[0].answeredModel, 'test-model');
  // Only the decision summary is exposed: no credential, request key, wallet or raw model context.
  assert.doesNotMatch(JSON.stringify(body), /obp_|requestKey|availableCredits|eligibleFighterIds/);

  // Another account sees nothing; no login is refused before the supervisor is consulted.
  assert.deepEqual(await (await get(handler(async () => OTHER))).json(), { ok: true, data: { state: 'none' } });
  assert.equal((await get(handler(async () => null))).status, 401);
  // Other routes keep working beside it.
  assert.equal((await api(new Request(`${ORIGIN}/commerce/broadcasts/${broadcast.id}/report`))).status, 200);

  // A host without a producer (the plain service) has no such route.
  const missing = await get(createCommerceHandler({ service: f.service, authenticate: async () => OWNER, publicOrigin: ORIGIN }));
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { ok: false, code: 'not-found' });
});

test('shutdown while a producer is mid-poll is not an outcome: the next process resumes the same producer', async t => {
  const f = await fixture(t);
  const broadcast = await f.startedSession(OWNER);
  const directory = await f.stateDir();

  // The model waits, so the producer only polls. Hold the fourth report read in flight, as a SIGTERM could, then shut down.
  let reads = 0,
    inFlight = false;
  const first = await f.supervise({
    directory,
    model: fakeModel(wait),
    wrapFetch: (request, forward, tool) => {
      if (tool !== 'get_broadcast_report' || ++reads < 4) return forward();
      inFlight = true;
      return new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    },
  });
  first.supervisor.ensure(OWNER, broadcast.id);
  await until(() => inFlight, 'a report read in flight');
  assert.equal(first.model.calls.length, 1);
  await first.supervisor.close();

  const second = await f.supervise({ directory, model: fakeModel(wait) });
  assert.equal(await second.supervisor.resume(), 1);
  const before = f.polls(second, 'get_broadcast_report');
  const resumed = await until(
    () => f.polls(second, 'get_broadcast_report') >= before + 3 || second.supervisor.status(OWNER, broadcast.id).state === 'finished',
    'resumed producer polls or ends',
  );
  assert.ok(resumed);
  assert.equal(second.supervisor.status(OWNER, broadcast.id).state, 'running', JSON.stringify(second.supervisor.status(OWNER, broadcast.id).result));
  assert.equal(second.supervisor.status(OWNER, broadcast.id).result, null);
  assert.equal(second.model.calls.length, 0, 'the unchanged context needs no second model call');
  const saved = await f.checkpoint(directory, broadcast);
  assert.equal(saved.result, null);
  assert.equal(saved.producer.halted, undefined, 'a shutdown abort must not halt the producer for good');
});
