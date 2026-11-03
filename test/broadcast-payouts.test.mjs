import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCommerceHandler } from '../api/commerce/handler.mjs';
import { createCommerceService } from '../api/commerce/service.mjs';
import { createPayPalSandbox, PayPalError } from '../api/commerce/paypal.mjs';
import { createPayoutService, payoutReceivers } from '../api/commerce/payouts.mjs';
import { COMMERCE_CATALOG } from '../api/commerce/catalog.mjs';
import { Problem, verifiedUserId } from '../api/http.mjs';
import { createConcierge } from '../broadcast/concierge.mjs';
import { payoutsFromEnvironment } from '../scripts/broadcast-demo.mjs';
import { commerceDatabase } from './helpers/commerce-database.mjs';

// Creator appearance-fee payouts (PayPal Sandbox Payouts). This is money logic: the ledger SQL, the payout service, the real
// PayPal Sandbox adapter, the HTTP handler and the concierge all run for real. The only fake is PayPal's HTTP boundary, which
// keeps PayPal's own idempotency (the same PayPal-Request-Id returns the original batch).

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'https://console.example.test';
const MERCHANT = 'SANDBOXMERCHANT';
const HOST = 'current-pc';
const PAYPAL_ORIGIN = 'https://api-m.sandbox.paypal.com';
const FIGHTERS = ['kuma', 'yume', 'bravow', 'beotim'];
// beotim is a cup fighter without a receiver: it earns nothing.
const RECEIVERS = { kuma: 'kuma.creator@personal.example.com', yume: 'yume.creator@personal.example.com', bravow: 'bravow.creator@personal.example.com' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CUP_CREDITS = COMMERCE_CATALOG.tools.host_cup.credits;

const problem = (status, code) => error => {
  assert.ok(error instanceof Problem, `expected a Problem(${status}, ${code}), got ${error}`);
  assert.equal(error.status, status);
  assert.equal(error.message, code);
  return true;
};
const paypalError = (code, { status, outcomeUnknown } = {}) => error => {
  assert.ok(error instanceof PayPalError, `expected a PayPalError, got ${error}`);
  assert.equal(error.code, code);
  if (status !== undefined) assert.equal(error.status, status);
  if (outcomeUnknown !== undefined) assert.equal(error.outcomeUnknown, outcomeUnknown);
  return true;
};
/** The payout service validates some keys synchronously, so wrap the call: a refusal is a rejection either way. */
const refuses = (run, check, message) => assert.rejects(async () => run(), check, message);
const minor = value => BigInt(value.replace('.', ''));

/** PayPal Sandbox's HTTP boundary: oauth, POST /v1/payments/payouts (idempotent on PayPal-Request-Id) and GET /v1/payments/payouts/:id.
 * Faults for the next payout POSTs: {status} refuses with that HTTP status (creates nothing), {network} fails the connection
 * (creates nothing), {lose} creates the batch and then loses the reply, {garbage} creates the batch and answers 201 with a body
 * that has no batch header. */
function fakePayPal() {
  const calls = [], batches = new Map(), byRequest = new Map(), senders = new Map(), faults = [], violations = [];
  let tokenFault = 0, created = 0;
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const header = batch => ({ batch_header: { payout_batch_id: batch.id, batch_status: batch.status, sender_batch_header: { sender_batch_id: batch.senderBatchId } } });
  async function fetch(url, init) {
    const target = new URL(url), method = init.method ?? 'GET', path = target.pathname;
    if (target.origin !== PAYPAL_ORIGIN) violations.push(`unexpected origin ${target.origin}`);
    const body = init.body && init.body !== 'grant_type=client_credentials' ? JSON.parse(init.body) : null;
    const requestId = new Headers(init.headers).get('paypal-request-id');
    calls.push({ path, method, body, requestId });
    if (path === '/v1/oauth2/token') {
      if (tokenFault) return json({ error: 'invalid_client' }, tokenFault);
      return json({ access_token: 'fixture-token', token_type: 'Bearer', expires_in: 3600 });
    }
    if (path === '/v1/payments/payouts' && method === 'POST') {
      const senderBatchId = body?.sender_batch_header?.sender_batch_id;
      if (!requestId) violations.push('payout POST without PayPal-Request-Id');
      if (requestId !== `p-${senderBatchId}`) violations.push(`request id ${requestId} does not match sender_batch_id ${senderBatchId}`);
      const fault = faults.shift();
      if (fault?.status) return json({ name: 'FAULT', message: 'refused' }, fault.status);
      if (fault?.network) throw new TypeError('fetch failed');
      let batch = byRequest.get(requestId);
      if (!batch) {
        if (senders.has(senderBatchId)) violations.push(`sender_batch_id ${senderBatchId} reused with another request id`);
        batch = { id: `PAYOUTBATCH${++created}`, senderBatchId, status: 'PENDING', body, requestId };
        byRequest.set(requestId, batch); senders.set(senderBatchId, batch); batches.set(batch.id, batch);
      }
      if (fault?.lose) throw new TypeError('response lost after PayPal created the batch');
      if (fault?.garbage) return json({ unexpected: true }, 201);
      return json(header(batch), 201);
    }
    const match = path.match(/^\/v1\/payments\/payouts\/([A-Za-z0-9_-]+)$/);
    if (match && method === 'GET') {
      const batch = batches.get(match[1]);
      return batch ? json(header(batch)) : json({ name: 'RESOURCE_NOT_FOUND' }, 404);
    }
    violations.push(`unexpected PayPal request ${method} ${path}`);
    return json({}, 404);
  }
  return {
    fetch, calls, batches, violations,
    fail: (...next) => faults.push(...next),
    failToken: status => { tokenFault = status; },
    setStatus: (status, id) => { for (const batch of id ? [batches.get(id)] : batches.values()) batch.status = status; },
    posts: () => calls.filter(call => call.path === '/v1/payments/payouts' && call.method === 'POST'),
    polls: () => calls.filter(call => call.path.startsWith('/v1/payments/payouts/') && call.method === 'GET'),
  };
}

/** Real ledger SQL + real PayPal adapter over the fake boundary + real payout service (`f.service`); `f.plain` is the service without payouts. */
async function fixture(t, { feeCents = 2, receivers = RECEIVERS } = {}) {
  const database = await commerceDatabase();
  t.after(() => database.db.close());
  const { store, db } = database;
  const fake = fakePayPal();
  t.after(() => assert.deepEqual(fake.violations, [], 'the PayPal boundary saw a protocol violation'));
  const adapter = createPayPalSandbox({ clientId: 'fixture-client', clientSecret: 'fixture-secret', merchantId: MERCHANT, fetch: fake.fetch });
  const payouts = createPayoutService({ store, paypal: adapter, receivers: payoutReceivers(receivers, COMMERCE_CATALOG.fighters), feeCents });
  const plain = createCommerceService({ store, paypal: adapter, merchantId: MERCHANT, publicOrigin: ORIGIN, hosts: [{ id: HOST }] });
  for (const owner of [OWNER, OTHER]) {
    const topup = await store.createTopup(owner, { requestKey: 'fixture-funding', amountCents: 1000, credits: 1000, currency: 'USD' });
    await store.attachOrder(owner, topup.id, `ORDER-${owner}`);
    await store.creditCapture(owner, topup.id, { providerOrderId: `ORDER-${owner}`, captureId: `CAPTURE-${owner}`, amountCents: 1000, currency: 'USD', status: 'COMPLETED' });
  }
  let n = 0;
  const f = {
    ...database, fake, adapter, payouts, plain, feeCents, service: { ...plain, payouts },
    count: async (table, where = '') => (await db.query(`select count(*)::int as n from commerce.${table} ${where}`)).rows[0].n,
    /** A started session (approved budget for 4 cups) on the demo host. */
    async session(owner, channelId = `session-${++n}`) {
      const approval = await store.approveBudget(owner, { requestKey: `approval-${++n}`, channelId, hostId: HOST, endsAt: new Date(Date.now() + 3_600_000).toISOString(),
        maxCredits: CUP_CREDITS * 4, allowedTools: ['host_cup'], fighterIds: FIGHTERS, priceVersion: COMMERCE_CATALOG.version });
      return store.startBroadcast(owner, { requestKey: `start-${n}`, approvalId: approval.id });
    },
    enqueue: (owner, broadcast) => store.enqueueCup(owner, { requestKey: `cup-${++n}`, broadcastId: broadcast.id, fighterIds: FIGHTERS,
      priceVersion: COMMERCE_CATALOG.version, priceCredits: CUP_CREDITS }),
    /** Queue a cup, let the host claim it and finish it with a real fenced completion. 'succeeded' carries valid bout evidence. */
    async cup(owner, broadcast, outcome = 'succeeded') {
      const queued = await f.enqueue(owner, broadcast), worker = `worker-${queued.id}`;
      const claim = await store.claimJob(worker, { hostId: HOST });
      assert.equal(claim?.id, queued.id, 'the host must claim the cup that was just queued');
      const result = outcome === 'succeeded' ? { protocolVersion: 1, jobId: claim.id, leaseToken: claim.leaseToken, seed: claim.seed, winnerId: claim.fighterIds[0],
        bouts: [[claim.fighterIds[0], claim.fighterIds[1]], [claim.fighterIds[2], claim.fighterIds[3]], [claim.fighterIds[0], claim.fighterIds[2]]]
          .map(([leftId, rightId], index) => ({ leftId, rightId, winnerId: leftId, winner: 0, seed: (claim.seed + index) >>> 0, how: 'decision', ms: 100, hp: [1, 0], contacts: [0, 0], digest: '1234abcd' })) }
        : { reason: outcome === 'failed' ? 'confirmed-runner-failure' : 'browser-result-not-observed' };
      const done = await store.completeJob(worker, { jobId: claim.id, leaseToken: claim.leaseToken, outcome, result });
      assert.equal(done.status, outcome);
      return done;
    },
    /** One unknown cup (it blocks the host) and one queued cup that never ran. Call this last in a scenario. */
    async stranded(owner, broadcast) {
      const unknown = await f.enqueue(owner, broadcast), queued = await f.enqueue(owner, broadcast);
      const claim = await store.claimJob('worker-unknown', { hostId: HOST });
      assert.equal(claim?.id, unknown.id);
      assert.equal((await store.completeJob('worker-unknown', { jobId: claim.id, leaseToken: claim.leaseToken, outcome: 'unknown', result: { reason: 'browser-result-not-observed' } })).status, 'unknown');
      return { unknown, queued };
    },
    propose: (owner, broadcast, requestKey = randomUUID()) => payouts.propose(owner, { broadcastId: broadcast.id, requestKey }),
    /** A session with `count` succeeded cups of the four fighters. */
    async paidSession(owner, count = 2) {
      const broadcast = await f.session(owner);
      const jobs = [];
      for (let i = 0; i < count; i++) jobs.push(await f.cup(owner, broadcast));
      return { broadcast, jobs };
    },
    /** Walk a batch to `submitted` through the store, without PayPal. */
    async submitted(owner, batch, providerBatchId) {
      await store.approvePayout(owner, batch.id);
      return store.attachPayout(owner, batch.id, providerBatchId);
    },
    items: async batchId => (await db.query('select job_id, fighter_id, receiver, cents from commerce.payout_items where batch_id=$1 order by fighter_id, job_id', [batchId])).rows,
    row: async batchId => (await db.query('select * from commerce.payout_batches where id=$1', [batchId])).rows[0],
  };
  return f;
}

// ---------------------------------------------------------------- 1. propose

test('propose: two succeeded cups pay each receiver-backed fighter once per cup; the fighter without a receiver is absent', async t => {
  const f = await fixture(t, { feeCents: 7 });
  const { broadcast, jobs } = await f.paidSession(OWNER, 2);
  const batch = await f.propose(OWNER, broadcast);

  assert.match(batch.id, UUID);
  assert.equal(batch.status, 'proposed');
  assert.equal(batch.broadcastId, broadcast.id);
  assert.equal(batch.owner, OWNER);
  assert.equal(batch.currency, 'USD');
  assert.equal(batch.providerBatchId, null);
  assert.equal(batch.totalCents, 6 * 7, '3 paid fighters x 2 cups x the fee');
  assert.deepEqual(batch.items, ['bravow', 'kuma', 'yume'].map(fighterId => ({ fighterId, receiver: RECEIVERS[fighterId], cents: 2 * 7, cups: 2 })));
  assert.equal(batch.items.reduce((sum, item) => sum + item.cents, 0), batch.totalCents);
  assert.ok(!batch.items.some(item => item.fighterId === 'beotim'), 'no receiver, no payout');

  // One ledger row per paid appearance, each bound to a real succeeded job.
  const rows = await f.items(batch.id);
  assert.equal(rows.length, 6);
  assert.deepEqual([...new Set(rows.map(row => row.job_id))].sort(), jobs.map(job => job.id).sort());
  assert.ok(rows.every(row => row.cents === 7 && row.receiver === RECEIVERS[row.fighter_id]));
  assert.equal(await f.count('payout_batches'), 1);
  assert.equal(f.fake.calls.length, 0, 'proposing sends nothing to PayPal');
  // Proposing moves no credits either.
  assert.equal((await f.store.wallet(OWNER)).balanceCredits, 1000 - 2 * CUP_CREDITS);
});

test('propose: failed, queued and unknown cups, other sessions and unknown sessions are never payable', async t => {
  const f = await fixture(t);
  const paid = await f.session(OWNER, 'with-a-paid-cup'), stuck = await f.session(OWNER, 'with-no-paid-cup');
  await f.cup(OWNER, paid);                       // the only succeeded cup of this owner
  await f.cup(OWNER, stuck, 'failed');
  await f.stranded(OWNER, stuck);
  const states = (await f.db.query('select status from commerce.jobs where broadcast_id=$1 order by created_at', [stuck.id])).rows.map(row => row.status);
  assert.deepEqual(states, ['failed', 'unknown', 'queued']);

  await assert.rejects(f.propose(OWNER, stuck), problem(409, 'nothing-to-pay'));
  assert.equal(await f.count('payout_batches'), 0);
  assert.equal(await f.count('payout_items'), 0);
  // The paid cup of the other session is not borrowed by it, and it stays payable in its own session: 3 fighters, 1 cup.
  const batch = await f.propose(OWNER, paid);
  assert.equal(batch.totalCents, 3 * f.feeCents);
  assert.deepEqual(batch.items.map(item => item.cups), [1, 1, 1]);
  await assert.rejects(f.propose(OWNER, stuck), problem(409, 'nothing-to-pay'));

  // A session that does not exist.
  await assert.rejects(f.payouts.propose(OWNER, { broadcastId: randomUUID(), requestKey: randomUUID() }), problem(404, 'not-found'));
});

test('propose: the same request key returns the same batch, also while it is in flight, and creates no second one', async t => {
  const f = await fixture(t);
  const { broadcast } = await f.paidSession(OWNER, 2);
  const requestKey = randomUUID();
  const first = await f.propose(OWNER, broadcast, requestKey);
  assert.deepEqual(await f.propose(OWNER, broadcast, requestKey), first);
  assert.deepEqual(await f.propose(OWNER, broadcast, requestKey.toUpperCase()), first, 'keys are case-insensitive UUIDs');
  const concurrent = await Promise.all(Array.from({ length: 4 }, () => f.propose(OWNER, broadcast, requestKey)));
  assert.ok(concurrent.every(batch => batch.id === first.id));
  assert.equal(await f.count('payout_batches'), 1);
  assert.equal(await f.count('payout_items'), 6);

  // After approval the key still names the batch, now in its newer state, and it dispatches nothing by itself.
  await f.payouts.approve(OWNER, first.id);
  const again = await f.propose(OWNER, broadcast, requestKey);
  assert.equal(again.id, first.id);
  assert.equal(again.status, 'submitted');
  assert.equal(f.fake.posts().length, 1);
});

test('propose: an appearance is paid once; a second proposal, concurrent proposals and a duplicate ledger row all fail', async t => {
  const f = await fixture(t);
  const { broadcast } = await f.paidSession(OWNER, 2);
  const first = await f.propose(OWNER, broadcast);
  await assert.rejects(f.propose(OWNER, broadcast), problem(409, 'nothing-to-pay'));

  // Still unpayable while submitting, submitted and paid.
  await f.store.approvePayout(OWNER, first.id);
  await assert.rejects(f.propose(OWNER, broadcast), problem(409, 'nothing-to-pay'));
  await f.store.attachPayout(OWNER, first.id, 'PAYOUT-ONCE');
  await assert.rejects(f.propose(OWNER, broadcast), problem(409, 'nothing-to-pay'));
  await f.store.settlePayout(OWNER, first.id, 'SUCCESS');
  assert.equal((await f.store.getPayout(OWNER, first.id)).status, 'paid');
  await assert.rejects(f.propose(OWNER, broadcast), problem(409, 'nothing-to-pay'));

  // The ledger's (job, fighter) key is the backstop even if some code path forgot to look.
  const [row] = await f.items(first.id);
  await f.db.query(`insert into commerce.payout_batches(owner,broadcast_id,request_key,total_cents,currency) values($1,$2,'rogue',1,'USD')`, [OWNER, broadcast.id]);
  const rogue = (await f.db.query(`select id from commerce.payout_batches where request_key='rogue'`)).rows[0].id;
  await assert.rejects(f.db.query('insert into commerce.payout_items(batch_id,job_id,fighter_id,receiver,cents) values($1,$2,$3,$4,1)', [rogue, row.job_id, row.fighter_id, row.receiver]),
    /payout_items_pkey|duplicate key/);
  assert.equal(await f.count('payout_items', `where job_id='${row.job_id}' and fighter_id='${row.fighter_id}'`), 1);

  // Racing proposals over a fresh session: exactly one wins every appearance.
  const second = await f.paidSession(OWNER, 1);
  const settled = await Promise.allSettled(Array.from({ length: 5 }, () => f.propose(OWNER, second.broadcast)));
  assert.equal(settled.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of settled.filter(result => result.status === 'rejected')) problem(409, 'nothing-to-pay')(result.reason);
  assert.equal(await f.count('payout_items', `where job_id='${second.jobs[0].id}'`), 3);
});

test('propose: another owner cannot propose for, read, approve or cancel a session or batch; malformed input is refused', async t => {
  const f = await fixture(t);
  const { broadcast } = await f.paidSession(OWNER, 1);
  await assert.rejects(f.propose(OTHER, broadcast), problem(404, 'not-found'));
  assert.equal(await f.count('payout_batches'), 0);
  assert.deepEqual(await f.payouts.list(OTHER, broadcast.id), []);

  const batch = await f.propose(OWNER, broadcast);
  await assert.rejects(f.payouts.get(OTHER, batch.id), problem(404, 'not-found'));
  await assert.rejects(f.payouts.approve(OTHER, batch.id), problem(404, 'not-found'));
  await assert.rejects(f.payouts.cancel(OTHER, batch.id), problem(404, 'not-found'));
  assert.equal((await f.payouts.get(OWNER, batch.id)).status, 'proposed');
  assert.equal(f.fake.calls.length, 0);

  await refuses(() => f.payouts.propose(OWNER, null), problem(422, 'invalid-input'));
  await refuses(() => f.payouts.propose(OWNER, { broadcastId: 'not-a-uuid', requestKey: randomUUID() }), problem(422, 'invalid-request-key'));
  await refuses(() => f.payouts.propose(OWNER, { broadcastId: broadcast.id, requestKey: 'short' }), problem(422, 'invalid-request-key'));
  await refuses(() => f.payouts.propose(OWNER, { broadcastId: broadcast.id }), problem(422, 'invalid-request-key'));
  await refuses(() => f.payouts.approve(OWNER, 'not-a-uuid'), problem(422, 'invalid-request-key'));
  await refuses(() => f.payouts.cancel(OWNER, 'not-a-uuid'), problem(422, 'invalid-request-key'));
  await refuses(() => f.payouts.list(OWNER, 'nope'), problem(422, 'invalid-request-key'));
  await refuses(() => f.payouts.get(OWNER, randomUUID()), problem(404, 'not-found'));
  assert.equal(await f.count('payout_batches'), 1);
});

// ---------------------------------------------------------------- 2. approve -> PayPal -> settle

test('approve sends exactly one well-formed PayPal batch; get follows PayPal PENDING then SUCCESS to paid; approving again sends nothing', async t => {
  const f = await fixture(t);   // fee 2 cents
  const { broadcast } = await f.paidSession(OWNER, 2);
  const proposed = await f.propose(OWNER, broadcast);
  assert.equal(proposed.totalCents, 12);

  const approved = await f.payouts.approve(OWNER, proposed.id);
  assert.equal(f.fake.posts().length, 1, 'exactly one POST /v1/payments/payouts');
  const [post] = f.fake.posts();
  assert.equal(post.requestId, `p-${proposed.id}`);
  assert.equal(post.body.sender_batch_header.sender_batch_id, proposed.id);
  assert.equal(typeof post.body.sender_batch_header.email_subject, 'string');
  assert.equal(post.body.items.length, 3, 'one item per receiver');
  const byReceiver = Object.fromEntries(post.body.items.map(item => [item.receiver, item]));
  assert.deepEqual(Object.keys(byReceiver).sort(), Object.values(RECEIVERS).sort());
  for (const item of post.body.items) {
    assert.equal(item.recipient_type, 'EMAIL');
    assert.deepEqual(item.amount, { value: '0.04', currency: 'USD' }, 'a decimal string, 2 cups x 2 cents');
    assert.match(item.sender_item_id, new RegExp(`^${proposed.id.slice(0, 8)}-[1-3]$`));
    assert.ok(item.note.length > 0 && item.note.length <= 4000);
  }
  assert.equal(new Set(post.body.items.map(item => item.sender_item_id)).size, 3);
  for (const [fighter, email] of Object.entries(RECEIVERS)) assert.ok(byReceiver[email].note.includes(fighter));
  assert.ok(!JSON.stringify(post.body).includes('beotim'), 'the fighter without a receiver is not in the PayPal request');
  assert.equal(post.body.items.reduce((sum, item) => sum + minor(item.amount.value), 0n), BigInt(proposed.totalCents), 'PayPal is asked to pay exactly the batch total');

  assert.equal(approved.status, 'submitted');
  assert.equal(approved.id, proposed.id);
  assert.equal(approved.providerBatchId, 'PAYOUTBATCH1');
  assert.equal(approved.totalCents, 12);
  assert.equal(f.fake.batches.size, 1);
  assert.equal((await f.row(proposed.id)).provider_batch_id, 'PAYOUTBATCH1');

  // PENDING: still in flight, items stay reserved.
  assert.equal(f.fake.polls().length, 0, 'approving does not poll');
  let seen = await f.payouts.get(OWNER, proposed.id);
  assert.equal(seen.status, 'submitted');
  assert.equal(seen.providerStatus, 'PENDING');
  assert.equal(f.fake.polls().length, 1);
  assert.equal(f.fake.polls()[0].path, '/v1/payments/payouts/PAYOUTBATCH1');
  assert.equal((await f.payouts.get(OWNER, proposed.id)).providerStatus, 'PENDING');
  assert.equal(f.fake.polls().length, 2, 'every read of an in-flight batch asks PayPal');
  assert.equal((await f.items(proposed.id)).length, 6);
  await assert.rejects(f.propose(OWNER, broadcast), problem(409, 'nothing-to-pay'));

  // SUCCESS: paid.
  f.fake.setStatus('SUCCESS');
  seen = await f.payouts.get(OWNER, proposed.id);
  assert.equal(seen.status, 'paid');
  assert.equal(seen.providerStatus, 'SUCCESS');
  assert.ok(seen.completedAt);
  assert.equal(seen.items.length, 3);
  assert.equal((await f.items(proposed.id)).length, 6, 'a paid batch keeps its appearances');
  const polls = f.fake.polls().length;
  assert.equal((await f.payouts.get(OWNER, proposed.id)).status, 'paid');
  assert.equal(f.fake.polls().length, polls, 'a paid batch is not polled again');

  // Approving a paid batch sends nothing.
  assert.equal((await f.payouts.approve(OWNER, proposed.id)).status, 'paid');
  assert.equal(f.fake.posts().length, 1);
  await assert.rejects(f.propose(OWNER, broadcast), problem(409, 'nothing-to-pay'));
  assert.deepEqual((await f.payouts.list(OWNER, broadcast.id)).map(batch => [batch.id, batch.status]), [[proposed.id, 'paid']]);
});

test('approving a submitted batch again sends nothing; amounts are exact decimals and receivers sharing an address are one PayPal item', async t => {
  const shared = { kuma: 'shared.creator@personal.example.com', yume: 'shared.creator@personal.example.com', bravow: 'bravow.creator@personal.example.com' };
  const f = await fixture(t, { feeCents: 1999, receivers: shared });
  const { broadcast } = await f.paidSession(OWNER, 2);
  const proposed = await f.propose(OWNER, broadcast);
  assert.equal(proposed.totalCents, 6 * 1999);
  assert.equal(proposed.items.length, 3, 'the batch still records every fighter');

  const submitted = await f.payouts.approve(OWNER, proposed.id);
  assert.equal(submitted.status, 'submitted');
  assert.equal((await f.payouts.approve(OWNER, proposed.id)).status, 'submitted');
  assert.equal((await f.payouts.approve(OWNER, proposed.id)).providerBatchId, submitted.providerBatchId);
  assert.equal(f.fake.posts().length, 1);

  const [post] = f.fake.posts();
  assert.equal(post.body.items.length, 2, 'one item per receiver address');
  const amounts = Object.fromEntries(post.body.items.map(item => [item.receiver, item.amount.value]));
  assert.deepEqual(amounts, { 'shared.creator@personal.example.com': '79.96', 'bravow.creator@personal.example.com': '39.98' });
  assert.ok(post.body.items.every(item => /^\d+\.\d{2}$/.test(item.amount.value) && item.amount.currency === 'USD'));
  const note = post.body.items.find(item => item.receiver === 'shared.creator@personal.example.com').note;
  assert.ok(note.includes('kuma') && note.includes('yume'));
  assert.equal(post.body.items.reduce((sum, item) => sum + minor(item.amount.value), 0n), BigInt(6 * 1999));
});

test('PayPal later denying or cancelling an in-flight batch fails it and frees its appearances for a new proposal', async t => {
  for (const status of ['DENIED', 'CANCELED']) {
    await t.test(status, async t => {
      const f = await fixture(t);
      const { broadcast } = await f.paidSession(OWNER, 2);
      const batch = await f.propose(OWNER, broadcast);
      await f.payouts.approve(OWNER, batch.id);
      f.fake.setStatus(status);
      const failed = await f.payouts.get(OWNER, batch.id);
      assert.equal(failed.status, 'failed');
      assert.equal(failed.providerStatus, status);
      assert.deepEqual(failed.items, []);
      assert.equal(await f.count('payout_items'), 0);
      const again = await f.propose(OWNER, broadcast);
      assert.notEqual(again.id, batch.id);
      assert.equal(again.totalCents, 12);
      assert.equal(again.items.length, 3);
    });
  }
});

// ---------------------------------------------------------------- 3. uncertain dispatch

for (const [name, fault, expectation] of [
  ['HTTP 500', { status: 500 }, paypalError('paypal_http_error', { status: 500, outcomeUnknown: true })],
  ['network error', { network: true }, paypalError('paypal_network_error', { outcomeUnknown: true })],
  ['reply lost after PayPal created the batch', { lose: true }, paypalError('paypal_network_error', { outcomeUnknown: true })],
  ['201 without a batch header', { garbage: true }, paypalError('paypal_invalid_response', { outcomeUnknown: true })],
]) {
  test(`uncertain dispatch (${name}): the batch stays submitting with its appearances reserved; approving again retries the same ids and creates one PayPal batch`, async t => {
    const f = await fixture(t);
    const { broadcast } = await f.paidSession(OWNER, 2);
    const proposed = await f.propose(OWNER, broadcast);
    f.fake.fail(fault);
    await assert.rejects(f.payouts.approve(OWNER, proposed.id), expectation);

    const stuck = await f.payouts.get(OWNER, proposed.id);
    assert.equal(stuck.status, 'submitting');
    assert.equal(stuck.providerBatchId, null);
    assert.equal(stuck.items.length, 3);
    assert.equal(await f.count('payout_items'), 6, 'the appearances stay reserved');
    await assert.rejects(f.propose(OWNER, broadcast), problem(409, 'nothing-to-pay'));
    await assert.rejects(f.payouts.cancel(OWNER, proposed.id), problem(409, 'payout-not-cancellable'));
    assert.equal(f.fake.polls().length, 0, 'there is no PayPal batch id to ask about yet');

    const retried = await f.payouts.approve(OWNER, proposed.id);
    assert.equal(retried.status, 'submitted');
    assert.ok(retried.providerBatchId);
    assert.equal(f.fake.batches.size, 1, 'exactly one PayPal batch in total');
    assert.equal(retried.providerBatchId, [...f.fake.batches.keys()][0]);
    const posts = f.fake.posts();
    assert.equal(posts.length, 2);
    assert.equal(posts[1].requestId, posts[0].requestId);
    assert.equal(posts[1].requestId, `p-${proposed.id}`);
    assert.equal(posts[1].body.sender_batch_header.sender_batch_id, posts[0].body.sender_batch_header.sender_batch_id);
    assert.equal(posts[1].body.sender_batch_header.sender_batch_id, proposed.id);
    assert.deepEqual(posts[1].body, posts[0].body, 'the retry is the same request');

    // It then completes like any other batch.
    f.fake.setStatus('SUCCESS');
    assert.equal((await f.payouts.get(OWNER, proposed.id)).status, 'paid');
    assert.equal(f.fake.posts().length, 2);
    assert.equal(f.fake.batches.size, 1);
  });
}

test('uncertain dispatch: a refusal of a retry never frees the appearances, because PayPal may already hold the batch', async t => {
  const f = await fixture(t);
  const { broadcast } = await f.paidSession(OWNER, 2);
  const batch = await f.propose(OWNER, broadcast);
  // The first send is lost after PayPal made the batch; the retry is then refused (for example, rotated credentials).
  f.fake.fail({ lose: true }, { status: 403 });
  await assert.rejects(f.payouts.approve(OWNER, batch.id), error => error instanceof PayPalError && error.outcomeUnknown === true);
  await assert.rejects(f.payouts.approve(OWNER, batch.id), error => error instanceof PayPalError && error.status === 403);
  const held = await f.payouts.get(OWNER, batch.id);
  assert.equal(held.status, 'submitting');
  assert.equal(held.dispatchAttempts, 2);
  assert.equal(await f.count('payout_items'), 6, 'the appearances stay reserved');
  await assert.rejects(f.propose(OWNER, broadcast), problem(409, 'nothing-to-pay'));
  // The ledger itself refuses to free them after more than one send.
  await assert.rejects(f.store.settlePayout(OWNER, batch.id, 'REJECTED'), problem(409, 'payout-conflict'));
  // Once the outage ends, approving again finds PayPal's one batch.
  const done = await f.payouts.approve(OWNER, batch.id);
  assert.equal(done.status, 'submitted');
  assert.equal(f.fake.batches.size, 1);
});

test('propose: a request key reused for another session is an idempotency conflict, never that other batch', async t => {
  const f = await fixture(t);
  const first = await f.paidSession(OWNER, 1), second = await f.paidSession(OWNER, 1);
  const key = randomUUID();
  const batch = await f.propose(OWNER, first.broadcast, key);
  await assert.rejects(f.propose(OWNER, second.broadcast, key), problem(409, 'idempotency-conflict'));
  assert.equal((await f.propose(OWNER, first.broadcast, key)).id, batch.id);
});

test('uncertain dispatch: repeated outages never create a second batch; concurrent approvals share one', async t => {
  const f = await fixture(t);
  const { broadcast } = await f.paidSession(OWNER, 2);
  const batch = await f.propose(OWNER, broadcast);
  f.fake.fail({ lose: true }, { network: true }, { status: 503 });
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(f.payouts.approve(OWNER, batch.id), error => error instanceof PayPalError && error.outcomeUnknown === true);
    assert.equal((await f.payouts.get(OWNER, batch.id)).status, 'submitting');
  }
  assert.equal(f.fake.batches.size, 1, 'the first (lost) reply already created the only batch');
  const results = await Promise.all([f.payouts.approve(OWNER, batch.id), f.payouts.approve(OWNER, batch.id)]);
  assert.ok(results.every(result => result.status === 'submitted' && result.providerBatchId === 'PAYOUTBATCH1'));
  assert.equal(f.fake.batches.size, 1);
  assert.equal(new Set(f.fake.posts().map(post => post.requestId)).size, 1);
});

test('uncertain dispatch: a ledger failure after PayPal created the batch is retried onto the same PayPal batch', async t => {
  const f = await fixture(t);
  let failAttach = true;
  const flaky = { ...f.store, attachPayout: async (...args) => {
    if (failAttach) { failAttach = false; throw new Problem(503, 'commerce-unavailable'); }
    return f.store.attachPayout(...args);
  } };
  const payouts = createPayoutService({ store: flaky, paypal: f.adapter, receivers: RECEIVERS, feeCents: 2 });
  const { broadcast } = await f.paidSession(OWNER, 2);
  const batch = await f.propose(OWNER, broadcast);
  await assert.rejects(payouts.approve(OWNER, batch.id), problem(503, 'commerce-unavailable'));
  assert.equal(f.fake.batches.size, 1, 'PayPal already has the batch');
  assert.equal((await f.store.getPayout(OWNER, batch.id)).status, 'submitting');
  const retried = await payouts.approve(OWNER, batch.id);
  assert.equal(retried.status, 'submitted');
  assert.equal(retried.providerBatchId, 'PAYOUTBATCH1');
  assert.equal(f.fake.batches.size, 1);
  assert.equal(f.fake.posts().length, 2);
});

// ---------------------------------------------------------------- 4. definite refusal

for (const status of [400, 403, 422]) {
  test(`definite refusal (HTTP ${status}): the batch fails REJECTED, its appearances are freed and a new proposal pays them`, async t => {
    const f = await fixture(t);
    const { broadcast } = await f.paidSession(OWNER, 2);
    const batch = await f.propose(OWNER, broadcast);
    f.fake.fail({ status });
    await assert.rejects(f.payouts.approve(OWNER, batch.id), paypalError('paypal_http_error', { status }));

    const failed = await f.payouts.get(OWNER, batch.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.providerStatus, 'REJECTED');
    assert.equal(failed.providerBatchId, null);
    assert.ok(failed.completedAt);
    assert.deepEqual(failed.items, []);
    assert.equal(await f.count('payout_items'), 0);
    assert.equal(f.fake.batches.size, 0, 'a refusal created nothing at PayPal');
    assert.equal(f.fake.polls().length, 0);
    await assert.rejects(f.payouts.approve(OWNER, batch.id), problem(409, 'payout-not-approvable'));
    await assert.rejects(f.payouts.cancel(OWNER, batch.id), problem(409, 'payout-not-cancellable'));
    assert.equal(f.fake.posts().length, 1, 'a failed batch is never sent again');

    // The same appearances can be proposed and paid, as a different batch with its own ids.
    const again = await f.propose(OWNER, broadcast);
    assert.notEqual(again.id, batch.id);
    assert.equal(again.totalCents, 12);
    assert.deepEqual(again.items.map(item => item.cups), [2, 2, 2]);
    assert.equal((await f.payouts.approve(OWNER, again.id)).status, 'submitted');
    assert.equal(f.fake.batches.size, 1);
    assert.equal(f.fake.posts()[1].requestId, `p-${again.id}`);
    assert.notEqual(f.fake.posts()[1].requestId, f.fake.posts()[0].requestId);
  });
}

test('definite refusal: PayPal rejecting the credentials at the oauth step (HTTP 401) also settles REJECTED', async t => {
  const f = await fixture(t);
  const { broadcast } = await f.paidSession(OWNER, 1);
  const batch = await f.propose(OWNER, broadcast);
  f.fake.failToken(401);
  await assert.rejects(f.payouts.approve(OWNER, batch.id), paypalError('paypal_http_error', { status: 401 }));
  assert.equal(f.fake.posts().length, 0);
  const failed = await f.payouts.get(OWNER, batch.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.providerStatus, 'REJECTED');
  assert.equal(await f.count('payout_items'), 0);
});

for (const status of [408, 409, 429, 500, 502, 503, 504]) {
  test(`HTTP ${status} from PayPal is uncertain, not a refusal: the batch stays submitting and nothing is freed`, async t => {
    const f = await fixture(t);
    const { broadcast } = await f.paidSession(OWNER, 1);
    const batch = await f.propose(OWNER, broadcast);
    f.fake.fail({ status });
    await assert.rejects(f.payouts.approve(OWNER, batch.id), paypalError('paypal_http_error', { status, outcomeUnknown: true }));
    const stuck = await f.payouts.get(OWNER, batch.id);
    assert.equal(stuck.status, 'submitting');
    assert.equal(stuck.providerStatus, null);
    assert.equal(await f.count('payout_items'), 3);
    await assert.rejects(f.propose(OWNER, broadcast), problem(409, 'nothing-to-pay'));
    assert.equal((await f.payouts.approve(OWNER, batch.id)).status, 'submitted');
    assert.equal(f.fake.batches.size, 1);
  });
}

// ---------------------------------------------------------------- 5. cancel

test('cancel: a proposed batch is cancelled and its appearances are freed; it can never be approved afterwards', async t => {
  const f = await fixture(t);
  const { broadcast } = await f.paidSession(OWNER, 2);
  const batch = await f.propose(OWNER, broadcast);
  const cancelled = await f.payouts.cancel(OWNER, batch.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.completedAt);
  assert.deepEqual(cancelled.items, []);
  assert.equal(await f.count('payout_items'), 0);

  await assert.rejects(f.payouts.approve(OWNER, batch.id), problem(409, 'payout-not-approvable'));
  await assert.rejects(f.payouts.cancel(OWNER, batch.id), problem(409, 'payout-not-cancellable'));
  assert.equal((await f.payouts.get(OWNER, batch.id)).status, 'cancelled');
  assert.equal(f.fake.calls.length, 0, 'cancelling and approving a cancelled batch never reach PayPal');

  // Its key still names the cancelled batch; a new key proposes the freed appearances afresh.
  assert.equal((await f.payouts.propose(OWNER, { broadcastId: broadcast.id, requestKey: batch.requestKey })).status, 'cancelled');
  const again = await f.propose(OWNER, broadcast);
  assert.notEqual(again.id, batch.id);
  assert.equal(again.totalCents, 12);
});

test('cancel: submitting, submitted, paid and failed batches are not cancellable and keep their appearances', async t => {
  const f = await fixture(t);
  const { broadcast } = await f.paidSession(OWNER, 2);
  const batch = await f.propose(OWNER, broadcast);

  f.fake.fail({ status: 500 });
  await assert.rejects(f.payouts.approve(OWNER, batch.id), paypalError('paypal_http_error'));
  assert.equal((await f.payouts.get(OWNER, batch.id)).status, 'submitting');
  await assert.rejects(f.payouts.cancel(OWNER, batch.id), problem(409, 'payout-not-cancellable'));

  assert.equal((await f.payouts.approve(OWNER, batch.id)).status, 'submitted');
  await assert.rejects(f.payouts.cancel(OWNER, batch.id), problem(409, 'payout-not-cancellable'));

  f.fake.setStatus('SUCCESS');
  assert.equal((await f.payouts.get(OWNER, batch.id)).status, 'paid');
  await assert.rejects(f.payouts.cancel(OWNER, batch.id), problem(409, 'payout-not-cancellable'));
  assert.equal(await f.count('payout_items'), 6, 'nothing was freed by the refused cancels');
  assert.equal((await f.payouts.get(OWNER, batch.id)).status, 'paid');

  // A failed batch is not cancellable either (and has nothing left to free).
  const second = await f.paidSession(OWNER, 1);
  const refused = await f.propose(OWNER, second.broadcast);
  f.fake.fail({ status: 403 });
  await assert.rejects(f.payouts.approve(OWNER, refused.id), paypalError('paypal_http_error', { status: 403 }));
  await assert.rejects(f.payouts.cancel(OWNER, refused.id), problem(409, 'payout-not-cancellable'));
  await assert.rejects(f.payouts.cancel(OWNER, randomUUID()), problem(404, 'not-found'));
});

// ---------------------------------------------------------------- 6. settle / attach rules in SQL

test('settle: DENIED and CANCELED fail a submitted batch and free its appearances', async t => {
  const f = await fixture(t);
  const { broadcast } = await f.paidSession(OWNER, 2);
  for (const status of ['DENIED', 'CANCELED']) {
    const batch = await f.propose(OWNER, broadcast);
    await f.submitted(OWNER, batch, `PAYOUT-${status}`);
    assert.equal(await f.count('payout_items'), 6);
    const failed = await f.store.settlePayout(OWNER, batch.id, status);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.providerStatus, status);
    assert.equal(failed.providerBatchId, `PAYOUT-${status}`);
    assert.ok(failed.completedAt);
    assert.deepEqual(failed.items, []);
    assert.equal(await f.count('payout_items'), 0, 'freed');
  }
  const final = await f.propose(OWNER, broadcast);
  assert.equal(final.totalCents, 12);
});

test('settle: other PayPal statuses only record themselves on a submitted batch', async t => {
  const f = await fixture(t);
  const { broadcast } = await f.paidSession(OWNER, 1);
  const batch = await f.propose(OWNER, broadcast);
  await f.submitted(OWNER, batch, 'PAYOUT-PROGRESS');
  for (const status of ['NEW', 'PENDING', 'PROCESSING']) {
    const seen = await f.store.settlePayout(OWNER, batch.id, status);
    assert.equal(seen.status, 'submitted');
    assert.equal(seen.providerStatus, status);
    assert.equal(seen.items.length, 3, 'still reserved');
    assert.equal(seen.completedAt, null);
  }
  await assert.rejects(f.propose(OWNER, broadcast), problem(409, 'nothing-to-pay'));
});

test('settle: on a terminal batch (paid, failed, cancelled) any later settle is a no-op', async t => {
  const f = await fixture(t);
  const { broadcast } = await f.paidSession(OWNER, 2);
  const paid = await f.propose(OWNER, broadcast);
  await f.submitted(OWNER, paid, 'PAYOUT-TERMINAL');
  await f.store.settlePayout(OWNER, paid.id, 'SUCCESS');
  const before = await f.store.getPayout(OWNER, paid.id);
  for (const status of ['REJECTED', 'DENIED', 'CANCELED', 'PENDING', 'SUCCESS']) {
    assert.deepEqual(await f.store.settlePayout(OWNER, paid.id, status), before, `paid + ${status}`);
  }
  assert.equal(before.status, 'paid');
  assert.equal(await f.count('payout_items'), 6, 'a paid batch is never freed by a late status');

  const second = await f.paidSession(OWNER, 1);
  const failed = await f.propose(OWNER, second.broadcast);
  await f.submitted(OWNER, failed, 'PAYOUT-FAILED');
  await f.store.settlePayout(OWNER, failed.id, 'DENIED');
  const failedBefore = await f.store.getPayout(OWNER, failed.id);
  for (const status of ['SUCCESS', 'REJECTED', 'CANCELED', 'PENDING']) {
    assert.deepEqual(await f.store.settlePayout(OWNER, failed.id, status), failedBefore, `failed + ${status}`);
  }
  assert.equal(failedBefore.status, 'failed');
  assert.equal(failedBefore.providerStatus, 'DENIED');
  // It must not have taken the freed appearances back: they are proposable again.
  assert.equal((await f.propose(OWNER, second.broadcast)).totalCents, 3 * f.feeCents);

  const third = await f.paidSession(OWNER, 1);
  const cancelled = await f.payouts.cancel(OWNER, (await f.propose(OWNER, third.broadcast)).id);
  for (const status of ['SUCCESS', 'REJECTED', 'DENIED']) {
    assert.deepEqual(await f.store.settlePayout(OWNER, cancelled.id, status), cancelled, `cancelled + ${status}`);
  }
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.providerStatus, null);
});

test('settle: REJECTED is only valid from submitting, any other status only from submitted', async t => {
  const f = await fixture(t);
  const { broadcast } = await f.paidSession(OWNER, 2);
  const batch = await f.propose(OWNER, broadcast);
  const conflict = async (status, expected) => {
    await assert.rejects(f.store.settlePayout(OWNER, batch.id, status), problem(409, 'payout-conflict'), `${status} while ${expected}`);
    const now = await f.store.getPayout(OWNER, batch.id);
    assert.equal(now.status, expected, `${status} must not move a ${expected} batch`);
    assert.equal(now.items.length, 3);
  };
  // proposed: nothing has been sent, so there is nothing to settle.
  for (const status of ['REJECTED', 'SUCCESS', 'DENIED', 'CANCELED', 'PENDING']) await conflict(status, 'proposed');
  // submitting: PayPal has no batch yet, only the server's own REJECTED can apply.
  await f.store.approvePayout(OWNER, batch.id);
  for (const status of ['SUCCESS', 'DENIED', 'CANCELED', 'PENDING']) await conflict(status, 'submitting');
  // submitted: PayPal has a batch, so the server cannot claim it was rejected.
  await f.store.attachPayout(OWNER, batch.id, 'PAYOUT-RULES');
  await conflict('REJECTED', 'submitted');
  assert.equal((await f.store.settlePayout(OWNER, batch.id, 'SUCCESS')).status, 'paid');

  // REJECTED from submitting is the valid path (and frees the appearances).
  const second = await f.paidSession(OWNER, 1);
  const rejected = await f.propose(OWNER, second.broadcast);
  await f.store.approvePayout(OWNER, rejected.id);
  const failed = await f.store.settlePayout(OWNER, rejected.id, 'REJECTED');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.providerStatus, 'REJECTED');
  assert.deepEqual(failed.items, []);
  assert.equal((await f.propose(OWNER, second.broadcast)).items.length, 3);

  // Provider statuses are validated text.
  const third = await f.paidSession(OWNER, 1);
  const open = await f.propose(OWNER, third.broadcast);
  await f.submitted(OWNER, open, 'PAYOUT-VALIDATION');
  for (const bad of ['success', '', 'SUCCESS ', 'DENIED;', 'A'.repeat(41), 'SUCCESS1']) {
    await assert.rejects(f.store.settlePayout(OWNER, open.id, bad), problem(422, 'invalid-input'), JSON.stringify(bad));
  }
  assert.equal((await f.store.getPayout(OWNER, open.id)).status, 'submitted');
});

test('attach: a different provider id conflicts, the same id is idempotent, and a batch can only be attached once approved', async t => {
  const f = await fixture(t);
  const { broadcast } = await f.paidSession(OWNER, 2);
  const batch = await f.propose(OWNER, broadcast);
  await assert.rejects(f.store.attachPayout(OWNER, batch.id, 'PAYOUT-EARLY'), problem(409, 'payout-conflict'), 'a proposed batch has not been sent');
  assert.equal((await f.store.getPayout(OWNER, batch.id)).providerBatchId, null);

  await f.store.approvePayout(OWNER, batch.id);
  const attached = await f.store.attachPayout(OWNER, batch.id, 'PAYOUT-ONE');
  assert.equal(attached.status, 'submitted');
  assert.equal(attached.providerBatchId, 'PAYOUT-ONE');
  await assert.rejects(f.store.attachPayout(OWNER, batch.id, 'PAYOUT-TWO'), problem(409, 'payout-conflict'));
  assert.equal((await f.store.getPayout(OWNER, batch.id)).providerBatchId, 'PAYOUT-ONE');
  assert.deepEqual(await f.store.attachPayout(OWNER, batch.id, 'PAYOUT-ONE'), attached, 'repeating the same attach changes nothing');
  await f.store.settlePayout(OWNER, batch.id, 'SUCCESS');
  assert.equal((await f.store.attachPayout(OWNER, batch.id, 'PAYOUT-ONE')).status, 'paid');
  await assert.rejects(f.store.attachPayout(OWNER, batch.id, 'PAYOUT-TWO'), problem(409, 'payout-conflict'), 'also after it is paid');

  // Invalid ids, and a provider id that already belongs to another batch.
  const second = await f.paidSession(OWNER, 1);
  const other = await f.propose(OWNER, second.broadcast);
  await f.store.approvePayout(OWNER, other.id);
  for (const bad of ['', 'has space', 'a'.repeat(65), 'semi;colon', '../etc']) {
    await assert.rejects(f.store.attachPayout(OWNER, other.id, bad), problem(422, 'invalid-input'), JSON.stringify(bad));
  }
  await assert.rejects(f.store.attachPayout(OWNER, other.id, 'PAYOUT-ONE'), problem(409, 'unique-conflict'), 'one PayPal batch pays one ledger batch');
  assert.equal((await f.store.getPayout(OWNER, other.id)).status, 'submitting');

  // Failed and cancelled batches cannot be attached either.
  const third = await f.paidSession(OWNER, 1);
  const doomed = await f.propose(OWNER, third.broadcast);
  await f.store.approvePayout(OWNER, doomed.id);
  await f.store.settlePayout(OWNER, doomed.id, 'REJECTED');
  await assert.rejects(f.store.attachPayout(OWNER, doomed.id, 'PAYOUT-LATE'), problem(409, 'payout-conflict'));
  const fourth = await f.paidSession(OWNER, 1);
  const dropped = await f.payouts.cancel(OWNER, (await f.propose(OWNER, fourth.broadcast)).id);
  await assert.rejects(f.store.attachPayout(OWNER, dropped.id, 'PAYOUT-LATE-2'), problem(409, 'payout-conflict'));
});

// ---------------------------------------------------------------- 7. HTTP routes

const authentication = {
  auth: { getClaims: async token => ({ data: { claims: token === `fixture-${OWNER}` || token === `fixture-${OTHER}`
    ? { sub: token.slice(8), role: 'authenticated', is_anonymous: false } : null }, error: null }) },
};
function httpClient(service, { agent = false } = {}) {
  const handler = createCommerceHandler({ service, authenticate: request => verifiedUserId(authentication, request), publicOrigin: ORIGIN, agent });
  return async (path, { owner = OWNER, method = 'POST', body = {}, origin = ORIGIN } = {}) => {
    const headers = { ...(owner ? { authorization: `Bearer fixture-${owner}` } : {}), ...(origin !== null ? { origin } : {}), ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) };
    const response = await handler(new Request(`${ORIGIN}/ai-fighter/commerce/${path}`, { method, headers, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }));
    return { status: response.status, body: await response.json() };
  };
}

test('HTTP: approving or cancelling needs the console (own origin), confirmed:true and no agent; otherwise 403 and PayPal is never called', async t => {
  const f = await fixture(t);
  const call = httpClient(f.service), agent = httpClient(f.service, { agent: true });
  const { broadcast } = await f.paidSession(OWNER, 2);
  const batch = await f.propose(OWNER, broadcast);
  const evil = 'https://evil.example.test';
  const refusals = [
    ['no confirmation', () => call(`payouts/${batch.id}/approve`, { body: {} }), 'web-approval-required'],
    ['confirmed:false', () => call(`payouts/${batch.id}/approve`, { body: { confirmed: false } }), 'web-approval-required'],
    ['confirmed as a string', () => call(`payouts/${batch.id}/approve`, { body: { confirmed: 'true' } }), 'web-approval-required'],
    ['confirmed as 1', () => call(`payouts/${batch.id}/approve`, { body: { confirmed: 1 } }), 'web-approval-required'],
    ['a null body', () => call(`payouts/${batch.id}/approve`, { body: null }), 'web-approval-required'],
    ['no Origin header', () => call(`payouts/${batch.id}/approve`, { body: { confirmed: true }, origin: null }), 'web-approval-required'],
    ['a foreign origin', () => call(`payouts/${batch.id}/approve`, { body: { confirmed: true }, origin: evil }), 'origin-not-allowed'],
    ['an agent credential', () => agent(`payouts/${batch.id}/approve`, { body: { confirmed: true } }), 'web-approval-required'],
    ['cancel: no confirmation', () => call(`payouts/${batch.id}/cancel`, { body: {} }), 'web-approval-required'],
    ['cancel: no Origin header', () => call(`payouts/${batch.id}/cancel`, { body: { confirmed: true }, origin: null }), 'web-approval-required'],
    ['cancel: a foreign origin', () => call(`payouts/${batch.id}/cancel`, { body: { confirmed: true }, origin: evil }), 'origin-not-allowed'],
    ['cancel: an agent credential', () => agent(`payouts/${batch.id}/cancel`, { body: { confirmed: true } }), 'web-approval-required'],
  ];
  for (const [name, run, code] of refusals) {
    const response = await run();
    assert.equal(response.status, 403, name);
    assert.deepEqual(response.body, { ok: false, code }, name);
  }
  assert.equal(f.fake.calls.length, 0, 'no PayPal call was made');
  assert.equal((await f.store.getPayout(OWNER, batch.id)).status, 'proposed', 'and nothing changed');
  assert.equal(await f.count('payout_items'), 6);

  // Another person's console cannot act on it either; it is simply not theirs.
  const stranger = await call(`payouts/${batch.id}/approve`, { owner: OTHER, body: { confirmed: true } });
  assert.deepEqual([stranger.status, stranger.body.code], [404, 'not-found']);
  assert.equal((await call(`payouts/${batch.id}/approve`, { owner: null, body: { confirmed: true } })).status, 401);
  assert.equal((await call('payouts/not-a-uuid/approve', { body: { confirmed: true } })).body.code, 'invalid-request-key');
  assert.equal((await call(`payouts/${batch.id}/approve`, { method: 'GET' })).status, 404, 'approving is a POST');
  assert.equal(f.fake.calls.length, 0);
  assert.equal((await f.store.getPayout(OWNER, batch.id)).status, 'proposed');
});

test('HTTP: an agent credential cannot propose, list or read payouts (404), even though the account is valid', async t => {
  const f = await fixture(t);
  const call = httpClient(f.service), agent = httpClient(f.service, { agent: true });
  const { broadcast } = await f.paidSession(OWNER, 1);
  const batch = await f.propose(OWNER, broadcast);
  const before = await f.count('payout_batches');

  const proposed = await agent('payouts', { body: { broadcastId: broadcast.id, requestKey: randomUUID() } });
  assert.deepEqual([proposed.status, proposed.body], [404, { ok: false, code: 'not-found' }]);
  assert.equal(await f.count('payout_batches'), before, 'no batch was created for the agent');
  assert.deepEqual([(await agent(`payouts/${batch.id}`, { method: 'GET' })).status, (await agent(`broadcasts/${broadcast.id}/payouts`, { method: 'GET' })).status], [404, 404]);
  assert.equal((await call(`payouts/${batch.id}`, { method: 'GET' })).status, 200, 'the console can');
  assert.equal(f.fake.calls.length, 0);
});

test('HTTP: a service without payouts answers 404 on every payout route', async t => {
  const f = await fixture(t);
  const call = httpClient(f.plain);
  const { broadcast } = await f.paidSession(OWNER, 1);
  const batch = await f.propose(OWNER, broadcast);
  const routes = [
    () => call('payouts', { body: { broadcastId: broadcast.id, requestKey: randomUUID() } }),
    () => call(`payouts/${batch.id}/approve`, { body: { confirmed: true } }),
    () => call(`payouts/${batch.id}/cancel`, { body: { confirmed: true } }),
    () => call(`payouts/${batch.id}`, { method: 'GET' }),
    () => call(`broadcasts/${broadcast.id}/payouts`, { method: 'GET' }),
  ];
  for (const run of routes) {
    const response = await run();
    assert.deepEqual([response.status, response.body], [404, { ok: false, code: 'not-found' }]);
  }
  assert.equal((await f.store.getPayout(OWNER, batch.id)).status, 'proposed');
  assert.equal(f.fake.calls.length, 0);
});

test('HTTP: propose, list, approve and read a payout through the console route; the body can set neither fee nor receivers', async t => {
  const f = await fixture(t);
  const call = httpClient(f.service);
  const { broadcast } = await f.paidSession(OWNER, 2);

  const requestKey = randomUUID();
  const proposed = await call('payouts', { body: { broadcastId: broadcast.id, requestKey, feeCents: 10_000, receivers: { beotim: 'attacker@evil.example.com' }, owner: OTHER, totalCents: 1 } });
  assert.equal(proposed.status, 200);
  assert.equal(proposed.body.ok, true);
  const batch = proposed.body.data;
  assert.equal(batch.status, 'proposed');
  assert.equal(batch.totalCents, 12, 'the fee is the server configuration');
  assert.equal(batch.owner, OWNER);
  assert.deepEqual(batch.items.map(item => item.receiver).sort(), Object.values(RECEIVERS).sort());
  assert.equal((await call('payouts', { body: { broadcastId: broadcast.id, requestKey } })).body.data.id, batch.id);
  const second = await call('payouts', { body: { broadcastId: broadcast.id, requestKey: randomUUID() } });
  assert.deepEqual([second.status, second.body], [409, { ok: false, code: 'nothing-to-pay' }]);
  assert.equal((await call('payouts', { body: { broadcastId: broadcast.id } })).status, 422);
  assert.equal((await call('payouts', { body: [] })).status, 422);

  const listed = await call(`broadcasts/${broadcast.id}/payouts`, { method: 'GET' });
  assert.deepEqual([listed.status, listed.body.data.map(item => item.id)], [200, [batch.id]]);
  assert.deepEqual((await call(`broadcasts/${broadcast.id}/payouts`, { method: 'GET', owner: OTHER })).body.data, []);
  assert.equal((await call(`payouts/${batch.id}`, { method: 'GET' })).body.data.status, 'proposed');
  assert.equal((await call(`payouts/${batch.id}`, { method: 'GET', owner: OTHER })).status, 404);
  assert.equal(f.fake.calls.length, 0);

  const approved = await call(`payouts/${batch.id}/approve`, { body: { confirmed: true } });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.data.status, 'submitted');
  assert.equal(approved.body.data.providerBatchId, 'PAYOUTBATCH1');
  assert.equal(f.fake.posts().length, 1);
  assert.deepEqual(f.fake.posts()[0].body.items.map(item => item.receiver).sort(), Object.values(RECEIVERS).sort());
  assert.ok(!JSON.stringify(f.fake.posts()[0].body).includes('evil.example.com'));
  assert.ok(f.fake.posts()[0].body.items.every(item => item.amount.value === '0.04'));

  assert.equal((await call(`payouts/${batch.id}`, { method: 'GET' })).body.data.providerStatus, 'PENDING');
  f.fake.setStatus('SUCCESS');
  const paid = await call(`payouts/${batch.id}`, { method: 'GET' });
  assert.deepEqual([paid.status, paid.body.data.status, paid.body.data.providerStatus], [200, 'paid', 'SUCCESS']);
  const again = await call(`payouts/${batch.id}/approve`, { body: { confirmed: true } });
  assert.deepEqual([again.status, again.body.data.status], [200, 'paid']);
  assert.equal(f.fake.posts().length, 1);
  const cancel = await call(`payouts/${batch.id}/cancel`, { body: { confirmed: true } });
  assert.deepEqual([cancel.status, cancel.body], [409, { ok: false, code: 'payout-not-cancellable' }]);
});

test('HTTP: cancelling through the console frees the batch; a PayPal failure is a 502 that says whether the outcome is unknown', async t => {
  const f = await fixture(t);
  const call = httpClient(f.service);
  const { broadcast } = await f.paidSession(OWNER, 2);
  const first = (await call('payouts', { body: { broadcastId: broadcast.id, requestKey: randomUUID() } })).body.data;
  const cancelled = await call(`payouts/${first.id}/cancel`, { body: { confirmed: true } });
  assert.deepEqual([cancelled.status, cancelled.body.data.status, cancelled.body.data.items], [200, 'cancelled', []]);
  const approveCancelled = await call(`payouts/${first.id}/approve`, { body: { confirmed: true } });
  assert.deepEqual([approveCancelled.status, approveCancelled.body], [409, { ok: false, code: 'payout-not-approvable' }]);

  const batch = (await call('payouts', { body: { broadcastId: broadcast.id, requestKey: randomUUID() } })).body.data;
  f.fake.fail({ status: 500 });
  const uncertain = await call(`payouts/${batch.id}/approve`, { body: { confirmed: true } });
  assert.deepEqual([uncertain.status, uncertain.body], [502, { ok: false, code: 'paypal_http_error', outcomeUnknown: true }]);
  assert.equal((await call(`payouts/${batch.id}`, { method: 'GET' })).body.data.status, 'submitting');
  const retried = await call(`payouts/${batch.id}/approve`, { body: { confirmed: true } });
  assert.deepEqual([retried.status, retried.body.data.status], [200, 'submitted']);
  assert.equal(f.fake.batches.size, 1);

  // A definite refusal is the same 502 and leaves a failed batch behind.
  const second = await f.paidSession(OWNER, 1);
  const refused = (await call('payouts', { body: { broadcastId: second.broadcast.id, requestKey: randomUUID() } })).body.data;
  f.fake.fail({ status: 422 });
  const response = await call(`payouts/${refused.id}/approve`, { body: { confirmed: true } });
  assert.equal(response.status, 502);
  assert.equal(response.body.code, 'paypal_http_error');
  assert.equal((await call(`payouts/${refused.id}`, { method: 'GET' })).body.data.status, 'failed');
});

// ---------------------------------------------------------------- 8. configuration

test('payoutReceivers: rejects an empty map, a non-object, an unknown fighter and an invalid email; accepts known fighters', () => {
  const fighters = COMMERCE_CATALOG.fighters;
  assert.deepEqual(payoutReceivers(RECEIVERS, fighters), RECEIVERS);
  for (const empty of [{}, null, undefined, [], 'kuma', 5]) assert.throws(() => payoutReceivers(empty, fighters), { message: 'payout-receivers-required' }, JSON.stringify(empty));
  assert.throws(() => payoutReceivers({ ...RECEIVERS, nobody: 'nobody@personal.example.com' }, fighters), { message: 'payout-receivers-unknown-fighter' });
  assert.throws(() => payoutReceivers({ kuma: 'a@b.example.com' }, ['yume']), { message: 'payout-receivers-unknown-fighter' });
  for (const bad of ['not-an-email', '', 'a@b', '@b.example.com', 'a b@c.example.com', 'a@b.example.com\n', ' a@b.example.com', 5, null, undefined, `${'x'.repeat(250)}@b.example.com`])
    assert.throws(() => payoutReceivers({ kuma: bad }, fighters), { message: 'payout-receivers-invalid-email' }, JSON.stringify(bad));
});

test('payoutsFromEnvironment: unset or 0 is off; anything else but 1 throws; 1 needs PayPal, valid receivers JSON and a valid fee', async t => {
  const f = await fixture(t);
  const commerce = { store: f.store, paypal: f.adapter, merchantId: MERCHANT };
  const receivers = JSON.stringify(RECEIVERS);
  const on = extra => ({ ODDBOUT_PAYOUTS: '1', ODDBOUT_PAYOUT_RECEIVERS_JSON: receivers, ...extra });
  assert.equal(payoutsFromEnvironment({}, commerce), null);
  assert.equal(payoutsFromEnvironment({ ODDBOUT_PAYOUTS: '0', ODDBOUT_PAYOUT_RECEIVERS_JSON: receivers }, commerce), null);
  assert.equal(payoutsFromEnvironment({ ODDBOUT_PAYOUTS: '0' }, { store: f.store, paypal: null, merchantId: '' }), null, 'off needs nothing else');
  for (const bad of ['', 'yes', 'true', '2', ' 1', '1 ', 'on']) assert.throws(() => payoutsFromEnvironment({ ODDBOUT_PAYOUTS: bad, ODDBOUT_PAYOUT_RECEIVERS_JSON: receivers }, commerce), { message: 'invalid-payouts-setting' }, JSON.stringify(bad));

  assert.throws(() => payoutsFromEnvironment(on(), { store: f.store, paypal: null, merchantId: '' }), { message: 'payouts-paypal-required' });
  assert.throws(() => payoutsFromEnvironment(on(), { store: f.store, paypal: f.adapter, merchantId: '' }), { message: 'payouts-paypal-required' });
  assert.throws(() => payoutsFromEnvironment(on({ ODDBOUT_PAYOUT_RECEIVERS_JSON: '{not json' }), commerce), { message: 'payout-receivers-required' });
  assert.throws(() => payoutsFromEnvironment({ ODDBOUT_PAYOUTS: '1' }, commerce), { message: 'payout-receivers-required' }, 'receivers unset');
  assert.throws(() => payoutsFromEnvironment(on({ ODDBOUT_PAYOUT_RECEIVERS_JSON: '{}' }), commerce), { message: 'payout-receivers-required' });
  assert.throws(() => payoutsFromEnvironment(on({ ODDBOUT_PAYOUT_RECEIVERS_JSON: '[]' }), commerce), { message: 'payout-receivers-required' });
  assert.throws(() => payoutsFromEnvironment(on({ ODDBOUT_PAYOUT_RECEIVERS_JSON: '{"nobody":"a@b.example.com"}' }), commerce), { message: 'payout-receivers-unknown-fighter' });
  assert.throws(() => payoutsFromEnvironment(on({ ODDBOUT_PAYOUT_RECEIVERS_JSON: '{"kuma":"nope"}' }), commerce), { message: 'payout-receivers-invalid-email' });
  for (const fee of ['', '0', '-1', '1.5', 'abc', '10001', 'NaN', 'Infinity', '1e9'])
    assert.throws(() => payoutsFromEnvironment(on({ ODDBOUT_PAYOUT_FEE_CENTS: fee }), commerce), { message: 'invalid-payout-fee' }, JSON.stringify(fee));

  assert.equal(payoutsFromEnvironment(on(), commerce).feeCents, 2, 'default fee');
  for (const fee of [1, 125, 10_000]) assert.equal(payoutsFromEnvironment(on({ ODDBOUT_PAYOUT_FEE_CENTS: String(fee) }), commerce).feeCents, fee);
  // The service it returns is the real one: it carries the configured fee into a proposal.
  const { broadcast } = await f.paidSession(OWNER, 1);
  const configured = payoutsFromEnvironment(on({ ODDBOUT_PAYOUT_FEE_CENTS: '125' }), commerce);
  assert.equal((await configured.propose(OWNER, { broadcastId: broadcast.id, requestKey: randomUUID() })).totalCents, 3 * 125);
});

test('createPayoutService rejects a fee outside 1..10000 cents', () => {
  const parts = { store: {}, paypal: {}, receivers: RECEIVERS };
  for (const feeCents of [0, -1, 1.5, 10_001, NaN, Infinity, '2', undefined, null, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => createPayoutService({ ...parts, feeCents }), { message: 'invalid-payout-fee' }, String(feeCents));
  for (const feeCents of [1, 2, 10_000]) assert.equal(createPayoutService({ ...parts, feeCents }).feeCents, feeCents);
});

test('createPayout validates before any network call and formats every amount as an exact decimal string', async () => {
  const fake = fakePayPal();
  const adapter = createPayPalSandbox({ clientId: 'fixture-client', clientSecret: 'fixture-secret', merchantId: MERCHANT, fetch: fake.fetch });
  const item = (extra = {}) => ({ receiver: RECEIVERS.kuma, amountMinor: 4, currency: 'USD', senderItemId: 'item-1', note: 'Appearance fees', ...extra });
  const send = (items, extra = {}) => adapter.createPayout({ senderBatchId: 'batch-1', requestId: 'p-batch-1', items, ...extra });
  const invalid = code => paypalError(code, { outcomeUnknown: false });

  for (const receiver of ['not-an-email', '', 'a@b', 'two words@example.com', 'a@b.example.com\n', '@example.com', 'a@@b.example.com', null, undefined, 42]) {
    await assert.rejects(send([item({ receiver })]), invalid('paypal_invalid_input'), JSON.stringify(receiver));
  }
  await assert.rejects(send([item(), item({ receiver: 'bad' })]), invalid('paypal_invalid_input'), 'one bad receiver stops the whole batch');
  await assert.rejects(send([]), invalid('paypal_invalid_input'));
  await assert.rejects(send(undefined), invalid('paypal_invalid_input'));
  await assert.rejects(send(Array.from({ length: 101 }, (_, n) => item({ senderItemId: `item-${n}` }))), invalid('paypal_invalid_input'));
  for (const amountMinor of [0, -1, 1.5, NaN, Infinity, '4', undefined, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(send([item({ amountMinor })]), invalid('paypal_invalid_amount'), String(amountMinor));
  for (const currency of ['EUR', 'usd', '', undefined]) await assert.rejects(send([item({ currency })]), invalid('paypal_invalid_amount'), String(currency));
  for (const senderItemId of ['', 'has space', 'a/b', undefined]) await assert.rejects(send([item({ senderItemId })]), invalid('paypal_invalid_input'), String(senderItemId));
  await assert.rejects(send([item({ note: '' })]), invalid('paypal_invalid_input'));
  await assert.rejects(send([item({ note: 'x'.repeat(4001) })]), invalid('paypal_invalid_input'));
  await assert.rejects(send([item()], { requestId: '' }), invalid('paypal_invalid_input'));
  await assert.rejects(send([item()], { requestId: 'p'.repeat(109) }), invalid('paypal_invalid_input'));
  await assert.rejects(send([item()], { senderBatchId: '' }), invalid('paypal_invalid_input'));
  assert.equal(fake.calls.length, 0, 'not even the oauth token was requested');

  const amounts = [1, 4, 10, 99, 100, 101, 1999, 10_000, 12_345, 123_456_789];
  const expected = ['0.01', '0.04', '0.10', '0.99', '1.00', '1.01', '19.99', '100.00', '123.45', '1234567.89'];
  const sent = await send(amounts.map((amountMinor, index) => item({ amountMinor, senderItemId: `item-${index}` })));
  assert.deepEqual(sent, { payoutBatchId: 'PAYOUTBATCH1', status: 'PENDING' });
  assert.deepEqual(fake.posts()[0].body.items.map(entry => entry.amount), expected.map(value => ({ value, currency: 'USD' })));
  assert.ok(fake.posts()[0].body.items.every(entry => typeof entry.amount.value === 'string' && entry.recipient_type === 'EMAIL'));
  assert.deepEqual(fake.violations, []);
});

// ---------------------------------------------------------------- 9. concierge

let sequence = 0;
const fnCall = (name, args = {}, raw = JSON.stringify(args)) => { const n = ++sequence; return { type: 'function_call', id: `fc_${n}`, call_id: `call_${n}`, name, arguments: raw }; };
const say = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
/** The function_call_output the model was shown for one call, parsed; `raw` is exactly what it saw. */
function shown(input, callId) {
  const item = input.find(entry => entry.type === 'function_call_output' && entry.call_id === callId);
  assert.ok(item, `no function_call_output for ${callId}`);
  return { raw: item.output, ...JSON.parse(item.output) };
}
/** The only fake model boundary: each step is a list of output items or a function returning one (it sees the input the model sees). */
function scriptedModel() {
  const steps = [], calls = [];
  const call = async (input, tools, options = {}) => {
    calls.push({ input: structuredClone(input), tools, signal: options.signal });
    const step = steps.shift();
    if (step === undefined) throw new Error('scripted model exhausted');
    return { output: typeof step === 'function' ? await step(input, tools, options) : step, observation: {} };
  };
  return { call, calls, script: (...next) => steps.push(...next) };
}
const developer = input => input.find(entry => entry.role === 'developer').content;
const sessionIn = input => developer(input).match(/Selected session id: ([0-9a-f-]{36})\./)?.[1];
const PAYOUT_TOOL = 'propose_creator_payouts';

test('concierge: propose_creator_payouts is offered only when the service pays creators, and without it a call is tool-not-allowed', async t => {
  const f = await fixture(t);
  const withPayouts = scriptedModel(), without = scriptedModel();
  const concierge = createConcierge({ service: f.service, modelCall: withPayouts.call });
  const plainConcierge = createConcierge({ service: f.plain, modelCall: without.call });
  const { broadcast } = await f.paidSession(OWNER, 1);

  withPayouts.script([say('hello')]);
  await concierge.turn(OWNER, { message: 'hi' });
  const names = withPayouts.calls[0].tools.map(tool => tool.name);
  assert.ok(names.includes(PAYOUT_TOOL));
  assert.equal(names.length, 6);
  const tool = withPayouts.calls[0].tools.find(entry => entry.name === PAYOUT_TOOL);
  assert.equal(tool.strict, true);
  assert.deepEqual(tool.parameters.required, ['broadcastId']);
  assert.equal(tool.parameters.additionalProperties, false);
  assert.deepEqual(Object.keys(tool.parameters.properties), ['broadcastId'], 'the model can name a session, never a fee, receiver or amount');
  assert.ok(developer(withPayouts.calls[0].input).includes('creator appearance-fee payouts'));
  assert.ok(developer(withPayouts.calls[0].input).includes('You cannot approve or send payouts'));

  const call = fnCall(PAYOUT_TOOL, { broadcastId: broadcast.id });
  without.script([say('hello')], [call], [say('I cannot')]);
  await plainConcierge.turn(OWNER, { message: 'hi' });
  assert.ok(!without.calls[0].tools.some(entry => entry.name === PAYOUT_TOOL));
  assert.equal(without.calls[0].tools.length, 5);
  assert.ok(!developer(without.calls[0].input).includes('appearance-fee'));
  const result = await plainConcierge.turn(OWNER, { message: 'pay the creators', broadcastId: broadcast.id });
  assert.deepEqual(result.toolCalls, [{ name: PAYOUT_TOOL, ok: false, code: 'tool-not-allowed' }]);
  assert.deepEqual(result.actions, []);
  assert.equal(shown(without.calls.at(-1).input, call.call_id).code, 'tool-not-allowed');
  assert.equal(await f.count('payout_batches'), 0);
});

test('concierge: a scripted model proposing for the context session gets a payout action; no batch is approved and PayPal is not called', async t => {
  const f = await fixture(t);
  const model = scriptedModel();
  const concierge = createConcierge({ service: f.service, modelCall: model.call });
  const { broadcast } = await f.paidSession(OWNER, 2);
  const calls = [];
  model.script(
    input => { const call = fnCall(PAYOUT_TOOL, { broadcastId: sessionIn(input) }); calls.push(call); return [call]; },
    [say('kuma, yume and bravow would be paid 0.04 each. Approve it in the console.')],
  );
  const result = await concierge.turn(OWNER, { message: 'pay the creators for this session', broadcastId: broadcast.id.toUpperCase() });

  assert.equal(result.reply, 'kuma, yume and bravow would be paid 0.04 each. Approve it in the console.');
  assert.deepEqual(result.toolCalls, [{ name: PAYOUT_TOOL, ok: true }]);
  const [batch] = await f.payouts.list(OWNER, broadcast.id);
  assert.equal(batch.status, 'proposed');
  const items = ['bravow', 'kuma', 'yume'].map(fighterId => ({ fighterId, cents: 4, cups: 2 }));
  assert.deepEqual(result.actions, [{ type: 'payout', batchId: batch.id, broadcastId: broadcast.id, status: 'proposed', totalCents: 12, currency: 'USD', items }]);
  assert.equal(f.fake.calls.length, 0, 'the concierge only proposes; PayPal is untouched');
  assert.equal(await f.count('payout_batches'), 1);
  assert.equal((await f.store.getPayout(OWNER, batch.id)).status, 'proposed');

  const seen = shown(model.calls[1].input, calls[0].call_id);
  assert.deepEqual({ ok: seen.ok, payout: seen.payout }, { ok: true, payout: { batchId: batch.id, status: 'proposed', totalCents: 12, currency: 'USD', items } });
});

test('concierge: the model is never shown a receiver email, and the page action carries none either', async t => {
  const f = await fixture(t);
  const model = scriptedModel();
  const concierge = createConcierge({ service: f.service, modelCall: model.call });
  const { broadcast } = await f.paidSession(OWNER, 2);
  const call = fnCall(PAYOUT_TOOL, { broadcastId: broadcast.id });
  model.script([call], [say('done')]);
  const result = await concierge.turn(OWNER, { message: 'pay them', broadcastId: broadcast.id });
  assert.equal(result.actions.length, 1);
  const everything = JSON.stringify([model.calls.map(entry => entry.input), result]);
  for (const email of Object.values(RECEIVERS)) assert.equal(everything.includes(email), false, email);
  assert.equal(everything.includes('@'), false, 'no address of any kind');
  assert.equal(everything.includes('personal.example.com'), false);
  assert.equal(Object.hasOwn(shown(model.calls[1].input, call.call_id).payout.items[0], 'receiver'), false);
  assert.equal(Object.hasOwn(result.actions[0].items[0], 'receiver'), false);
  // The server still has them for the PayPal request.
  assert.deepEqual((await f.store.getPayout(OWNER, result.actions[0].batchId)).items.map(item => item.receiver).sort(), Object.values(RECEIVERS).sort());
});

test('concierge: proposing twice never double-pays, and bad or foreign arguments are refused in the tool result', async t => {
  const f = await fixture(t);
  const model = scriptedModel();
  const concierge = createConcierge({ service: f.service, modelCall: model.call, maxSteps: 12 });
  const mine = await f.paidSession(OWNER, 2), theirs = await f.paidSession(OTHER, 1);
  // Whatever else the model puts in the arguments, the fee and receivers are the server's.
  const first = fnCall(PAYOUT_TOOL, { broadcastId: mine.broadcast.id, feeCents: 10_000, receivers: { beotim: 'attacker@evil.example.com' }, requestKey: randomUUID() });
  const again = fnCall(PAYOUT_TOOL, { broadcastId: mine.broadcast.id });
  const foreign = fnCall(PAYOUT_TOOL, { broadcastId: theirs.broadcast.id }), ghost = fnCall(PAYOUT_TOOL, { broadcastId: randomUUID() });
  const notUuid = fnCall(PAYOUT_TOOL, { broadcastId: 'the-latest' }), missing = fnCall(PAYOUT_TOOL, {}), garbage = fnCall(PAYOUT_TOOL, {}, 'not json');
  model.script([first], [again], [foreign], [ghost], [notUuid], [missing], [garbage], [say('done')]);
  const result = await concierge.turn(OWNER, { message: 'pay', broadcastId: mine.broadcast.id });

  assert.deepEqual(result.toolCalls, [
    { name: PAYOUT_TOOL, ok: true }, { name: PAYOUT_TOOL, ok: false, code: 'nothing-to-pay' }, { name: PAYOUT_TOOL, ok: false, code: 'not-found' },
    { name: PAYOUT_TOOL, ok: false, code: 'not-found' }, { name: PAYOUT_TOOL, ok: false, code: 'invalid-broadcast' }, { name: PAYOUT_TOOL, ok: false, code: 'invalid-broadcast' },
    { name: PAYOUT_TOOL, ok: false, code: 'invalid-arguments' },
  ]);
  assert.equal(result.actions.length, 1, 'only the first call proposed anything');
  assert.equal(result.actions[0].totalCents, 12, 'the server fee, not the model-supplied one');
  assert.equal(await f.count('payout_batches'), 1);
  assert.equal(await f.count('payout_items'), 6);
  assert.ok((await f.items(result.actions[0].batchId)).every(row => !row.receiver.includes('evil')));
  assert.equal((await f.payouts.list(OTHER, theirs.broadcast.id)).length, 0, 'the other owner is untouched');
  assert.equal(shown(model.calls.at(-1).input, again.call_id).code, 'nothing-to-pay');
  assert.equal(f.fake.calls.length, 0);
});

test('concierge: the model has no way to approve, cancel or send a payout', async t => {
  const f = await fixture(t);
  const model = scriptedModel();
  const concierge = createConcierge({ service: f.service, modelCall: model.call });
  const { broadcast } = await f.paidSession(OWNER, 1);
  const batch = await f.propose(OWNER, broadcast);
  const attempts = ['approve_creator_payout', 'approve_payout', 'cancel_creator_payout', 'send_payout', 'create_payout'].map(name => fnCall(name, { batchId: batch.id, confirmed: true }));
  model.script(attempts, [say('I cannot approve payouts.')]);
  const result = await concierge.turn(OWNER, { message: 'approve the payout', broadcastId: broadcast.id });
  assert.deepEqual(result.toolCalls.map(entry => entry.code), Array(5).fill('tool-not-allowed'));
  assert.ok(!model.calls[0].tools.some(tool => /approve|cancel|send/.test(tool.name)));
  assert.equal((await f.store.getPayout(OWNER, batch.id)).status, 'proposed');
  assert.equal(f.fake.calls.length, 0);
});

test('concierge: the developer message names the selected session when the body has broadcastId, otherwise says none is selected', async t => {
  const f = await fixture(t);
  const model = scriptedModel();
  const concierge = createConcierge({ service: f.service, modelCall: model.call });
  const { broadcast } = await f.paidSession(OWNER, 1);
  model.script([say('one')], [say('two')]);

  await concierge.turn(OWNER, { message: 'which session?', broadcastId: broadcast.id.toUpperCase() });
  assert.ok(developer(model.calls[0].input).includes(`Selected session id: ${broadcast.id}.`), 'lower-cased id');
  assert.ok(!developer(model.calls[0].input).includes('No session is selected.'));
  assert.equal(sessionIn(model.calls[0].input), broadcast.id);

  await concierge.turn(OWNER, { message: 'and now?' });
  assert.ok(developer(model.calls[1].input).includes('No session is selected.'));
  assert.ok(!developer(model.calls[1].input).includes('Selected session id'));

  await assert.rejects(concierge.turn(OWNER, { message: 'bad', broadcastId: 'latest' }), problem(422, 'invalid-concierge-message'));
  await assert.rejects(concierge.turn(OWNER, { message: 'bad', broadcastId: 42 }), problem(422, 'invalid-concierge-message'));
  assert.equal(model.calls.length, 2, 'a malformed session id never reaches the model');
});
