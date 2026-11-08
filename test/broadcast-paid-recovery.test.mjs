import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPaidOperations } from '../api/commerce/paid-operations.mjs';
import { createPaidOperationHandler } from '../api/commerce/paid-handler.mjs';
import { createConcierge } from '../broadcast/concierge.mjs';
import { createPaidOperationClient } from '../mcp/paid-operations.mjs';
import { paidFixture, taskInput, proof, OWNER, OTHER, ORIGIN } from './helpers/paid-operations.mjs';

async function fixture(t, ensureProducer = () => {}) {
  const f = await paidFixture(t);
  const service = createPaidOperations({ store: f.store, commerce: f.commerce, publicOrigin: ORIGIN, ensureProducer });
  const handler = createPaidOperationHandler({
    service,
    store: f.store,
    publicOrigin: ORIGIN,
    authenticate: async request => (request.headers.get('authorization') === `Bearer fixture-${OTHER}` ? OTHER : OWNER),
  });
  const phone = async (path, body, owner = OWNER) => {
    const response = await handler(
      new Request(`${ORIGIN}/paid-operations/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { origin: ORIGIN, authorization: `Bearer fixture-${owner}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    return { status: response.status, ...(await response.json()) };
  };
  return { ...f, service, handler, phone };
}

test('ordinary broadcast consent + PayPal webhook continue the original multi-cup session without a client', async t => {
  const ensured = [],
    f = await fixture(t, (owner, id) => ensured.push({ owner, id }));
  const input = taskInput({ maxCredits: 50, fighterIds: ['kuma', 'yume', 'bravow', 'beotim', 'quickcat'] });
  const prepared = await f.phone('broadcasts', input),
    operation = prepared.data;
  assert.equal(prepared.status, 200);
  assert.equal(operation.kind, 'broadcast');
  assert.match(operation.approvalUrl, /\/broadcast\/\?operation=/);
  assert.equal((await f.phone('broadcasts', input)).data.id, operation.id);
  assert.equal((await f.phone(`operations/${operation.id}/approve`, { confirmed: true })).code, 'automatic-start-consent-required');
  assert.equal(await f.service.continueBroadcasts(), 0);
  assert.equal(ensured.length, 0);
  const approved = await f.phone(`operations/${operation.id}/approve`, { confirmed: true, startWhenFunded: true });
  assert.equal(approved.data.startWhenFunded, true);
  const payment = await f.phone(`operations/${operation.id}/checkout`, { confirmed: true });
  assert.equal(payment.status, 200);
  assert.equal(payment.data.operation.input.product.credits, 1000);
  f.orders.get(payment.data.operation.payment.providerOrderId).status = 'APPROVED';
  f.loseCapture();
  await f.event('CHECKOUT.ORDER.APPROVED', { id: payment.data.operation.payment.providerOrderId });
  assert.equal(await f.service.continueBroadcasts(), 1);
  const started = await f.service.get(OWNER, operation.id);
  assert.equal(started.state, 'queued');
  assert.equal(started.jobId, null);
  assert.equal(started.broadcast.id, started.broadcastId);
  assert.deepEqual(ensured, [{ owner: OWNER, id: started.broadcastId }]);
  const events = await f.service.events(OWNER, operation.id);
  const consent = events.filter(event => event.kind === 'automatic_start_authorized');
  const bindings = events.filter(event => event.kind === 'broadcast_bound');
  assert.equal(consent.length, 1);
  assert.equal(consent[0].detail.startWhenFunded, true);
  assert.equal(consent[0].detail.approvalId, started.approvalId);
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].detail.broadcastId, started.broadcastId);
  assert.equal(bindings[0].detail.endsAt, started.effectiveEndsAt);
  assert.equal((await f.store.recovery(null, 'health')).schemaVersion, 3);
  assert.equal((await f.store.wallet(OWNER)).reservedCredits, 50);
  // The original producer API can schedule multiple cups; the legacy one-job guard must not apply.
  for (let index = 0; index < 2; index++) {
    await f.commerce.cup(OWNER, { requestKey: randomUUID(), broadcastId: started.broadcastId, fighterIds: input.fighterIds.slice(0, 4) });
    const job = await f.store.claimJob('renderer', { hostId: input.hostId });
    await f.store.completeJob('renderer', { jobId: job.id, leaseToken: job.leaseToken, outcome: 'succeeded', result: proof(job) });
    assert.notEqual((await f.commerce.report(OWNER, started.broadcastId)).broadcast.status, 'completed');
  }
  await f.commerce.stop(OWNER, started.broadcastId);
  assert.equal((await f.service.get(OWNER, operation.id)).state, 'completed');
  assert.equal((await f.store.wallet(OWNER)).balanceCredits, 950);
  assert.equal((await f.store.wallet(OWNER)).reservedCredits, 0);
  const recovered = (await f.service.page(OWNER, { kind: 'broadcast' })).items[0];
  assert.equal(recovered.broadcastId, started.broadcastId);
  assert.equal((await f.phone(`operations/${operation.id}`, undefined, OTHER)).status, 404);
  assert.equal((await f.db.query('select count(*)::int n from commerce.broadcasts')).rows[0].n, 1);
});

test('already-funded approval survives crash after atomic session binding and before producer checkpoint', async t => {
  const f = await fixture(t, () => {
    throw new Error('process lost before checkpoint');
  });
  const checkout = await f.commerce.checkout(OWNER, { requestKey: randomUUID(), productId: 'sandbox-1000' });
  f.orders.values().next().value.status = 'APPROVED';
  await f.commerce.capture(OWNER, checkout.intentId);
  const operation = await f.service.prepareBroadcast(OWNER, taskInput({ maxCredits: 75 }));
  await f.service.approve(OWNER, operation.id, true);
  assert.equal(await f.service.continueBroadcasts(), 0);
  const bound = await f.service.get(OWNER, operation.id);
  assert.ok(bound.broadcastId);
  const ensured = [];
  const restarted = createPaidOperations({ store: f.store, commerce: f.commerce, publicOrigin: ORIGIN, ensureProducer: (owner, id) => ensured.push(id) });
  await f.db.query('update commerce.operations set continuation_next_at=clock_timestamp() where id=$1', [operation.id]);
  assert.equal(await restarted.continueBroadcasts(), 1);
  const repeats = await Promise.all([restarted.resume(OWNER, operation.id), restarted.resume(OWNER, operation.id)]);
  assert.ok(repeats.every(item => item.broadcastId === bound.broadcastId));
  assert.ok(ensured.every(id => id === bound.broadcastId));
  assert.equal((await f.db.query('select count(*)::int n from commerce.broadcasts')).rows[0].n, 1);
  assert.equal((await f.store.wallet(OWNER)).reservedCredits, 75);
  await assert.rejects(restarted.renew(OWNER, operation.id, new Date(Date.now() + 7_200_000).toISOString()), /operation-not-renewable/);
});

test('unknown broadcast work stays held; expiry never renews consent and missing producer cannot prepare', async t => {
  const f = await fixture(t),
    operation = await f.service.prepareBroadcast(OWNER, taskInput({ maxCredits: 50 }));
  await f.service.approve(OWNER, operation.id, true);
  const payment = await f.service.checkout(OWNER, operation.id);
  f.orders.get(payment.operation.payment.providerOrderId).status = 'APPROVED';
  const started = await f.service.resume(OWNER, operation.id);
  await f.commerce.cup(OWNER, { requestKey: randomUUID(), broadcastId: started.broadcastId, fighterIds: operation.input.fighterIds });
  const job = await f.store.claimJob('renderer', { hostId: operation.input.hostId });
  await f.store.completeJob('renderer', { jobId: job.id, leaseToken: job.leaseToken, outcome: 'unknown', result: { reason: 'lost renderer' } });
  await f.db.query('update commerce.operations set continuation_next_at=clock_timestamp() where id=$1', [operation.id]);
  assert.equal(await f.service.continueBroadcasts(), 0);
  assert.equal((await f.service.resume(OWNER, operation.id)).state, 'needs_reconciliation');
  assert.equal((await f.store.wallet(OWNER)).reservedCredits, 50);
  assert.equal((await f.db.query('select count(*)::int n from commerce.jobs')).rows[0].n, 1);
  const expired = await f.service.prepareBroadcast(OWNER, taskInput({ channelId: 'expired', maxCredits: 25 }));
  await f.service.approve(OWNER, expired.id, true);
  await f.db.query("update commerce.operations set effective_ends_at=clock_timestamp()-interval '1 second' where id=$1", [expired.id]);
  assert.equal((await f.service.resume(OWNER, expired.id)).state, 'expired');
  const noProducer = createPaidOperations({ store: f.store, commerce: f.commerce, publicOrigin: ORIGIN });
  await assert.rejects(noProducer.prepareBroadcast(OWNER, taskInput({ maxCredits: 25 })), /automatic-producer-unavailable/);
  const unapproved = await f.service.prepareBroadcast(OWNER, taskInput({ channelId: 'renew unapproved', maxCredits: 25 }));
  await f.db.query("update commerce.operations set effective_ends_at=clock_timestamp()-interval '1 second' where id=$1", [unapproved.id]);
  const deadline = new Date(Date.now() + 7_200_000).toISOString();
  await assert.rejects(f.service.renew(OWNER, unapproved.id, deadline), /automatic-start-consent-required/);
  const renewed = await f.service.renew(OWNER, unapproved.id, deadline, true);
  assert.equal(renewed.startWhenFunded, true);
  assert.ok(renewed.approvalId);
});

test('ordinary concierge quote persists its original plan and lists it across conversations', async t => {
  const f = await fixture(t);
  let step = 0;
  const parameters = { hostId: 'svl-mac-01', channelId: 'Saved show', durationMinutes: 60, maxCredits: 150, fighterIds: taskInput().fighterIds };
  const agent = createConcierge({
    service: { ...f.commerce, paidOperations: f.service },
    modelCall: async () => {
      const current = step++,
        name = current < 4 ? 'quote_broadcast' : 'list_my_operations';
      return {
        observation: {},
        output:
          current % 2 === 0
            ? [{ type: 'function_call', call_id: String(current), name, arguments: JSON.stringify(name === 'quote_broadcast' ? parameters : {}) }]
            : [{ type: 'message', content: [{ type: 'output_text', text: 'Review the saved show.' }] }],
      };
    },
  });
  const first = await agent.turn(OWNER, { message: 'Plan my broadcast.' });
  const second = await agent.turn(OWNER, { conversationId: first.conversationId, message: 'Show that plan.' });
  const third = await agent.turn(OWNER, { message: 'Find my broadcast.' });
  assert.equal(first.actions[0].type, 'broadcast_plan');
  assert.equal(first.actions[0].operationId, second.actions[0].operationId);
  assert.equal(first.actions[0].operationId, third.actions[0].operationId);
  assert.equal(first.actions[0].maxCredits, 150);
  assert.equal(first.actions[0].maxCups, 6);
  assert.equal((await f.store.wallet(OWNER)).reservedCredits, 0);
  assert.equal(f.orders.size, 0);
  await f.service.prepare(OWNER, taskInput({ channelId: 'legacy' }));
  const page = await f.phone('operations/page?kind=broadcast&limit=1');
  assert.equal(page.status, 200);
  assert.equal(page.data.items.length, 1);
  assert.equal(page.data.items[0].kind, 'broadcast');
});

test('a paired VM prepares the same ordinary broadcast API and discovers it after reconnecting', async t => {
  const f = await fixture(t);
  const connect = async label => {
    const client = createPaidOperationClient({ origin: ORIGIN, fetchImpl: (url, init) => f.handler(new Request(url, init)) });
    const pairing = await client.connect(label),
      params = new URLSearchParams(new URL(pairing.verificationUrl).hash.slice(1));
    assert.equal((await f.phone('devices/approve', { confirmed: true, id: params.get('device'), userCode: pairing.userCode })).status, 200);
    await client.connect(label);
    return client;
  };
  const vm = await connect('original VM'),
    input = taskInput({ maxCredits: 75 });
  const saved = await vm.prepareBroadcast(input);
  assert.equal(saved.kind, 'broadcast');
  assert.equal(saved.state, 'awaiting_approval');
  assert.equal((await vm.prepareBroadcast(input)).id, saved.id);
  const pc = await connect('new PC'),
    page = await pc.list({ kind: 'broadcast' });
  assert.equal(page.items[0].id, saved.id);
  assert.equal((await f.db.query('select count(*)::int n from commerce.operations')).rows[0].n, 1);
});

test('automatic continuation closes an exhausted original broadcast and releases only its unused remainder', async t => {
  for (const budget of [25, 60])
    await t.test(`budget ${budget}`, async t => {
      const ensured = [],
        f = await fixture(t, (owner, id) => ensured.push(id));
      const operation = await f.service.prepareBroadcast(OWNER, taskInput({ maxCredits: budget }));
      await f.service.approve(OWNER, operation.id, true);
      const payment = await f.service.checkout(OWNER, operation.id);
      f.orders.get(payment.operation.payment.providerOrderId).status = 'APPROVED';
      const started = await f.service.resume(OWNER, operation.id);
      for (let index = 0; index < Math.floor(budget / 25); index++) {
        await f.commerce.cup(OWNER, { requestKey: randomUUID(), broadcastId: started.broadcastId, fighterIds: operation.input.fighterIds });
        const job = await f.store.claimJob('renderer', { hostId: operation.input.hostId });
        await f.store.completeJob('renderer', { jobId: job.id, leaseToken: job.leaseToken, outcome: 'succeeded', result: proof(job) });
      }
      assert.equal((await f.service.get(OWNER, operation.id)).state, 'running');
      const producerStarts = ensured.length;
      await f.db.query('update commerce.operations set continuation_next_at=clock_timestamp() where id=$1', [operation.id]);
      assert.equal(await f.service.continueBroadcasts(), 1);
      const completed = await f.service.get(OWNER, operation.id),
        report = await f.commerce.report(OWNER, started.broadcastId);
      assert.equal(completed.state, 'completed');
      assert.equal(completed.broadcastId, started.broadcastId);
      assert.equal(report.broadcast.status, 'completed');
      assert.equal(report.remainingReservedCredits, 0);
      assert.equal(report.confirmedSpentCredits, Math.floor(budget / 25) * 25);
      assert.equal(report.jobs.length, Math.floor(budget / 25));
      assert.equal((await f.store.wallet(OWNER)).reservedCredits, 0);
      assert.equal((await f.service.resume(OWNER, operation.id)).broadcastId, started.broadcastId);
      assert.equal(ensured.length, producerStarts);
      assert.equal((await f.db.query('select count(*)::int n from commerce.broadcasts')).rows[0].n, 1);
    });
});

test('budget allocated to queued, running or unknown work cannot be closed or released by continuation', async t => {
  const f = await fixture(t),
    operation = await f.service.prepareBroadcast(OWNER, taskInput({ maxCredits: 25 }));
  await f.service.approve(OWNER, operation.id, true);
  const payment = await f.service.checkout(OWNER, operation.id);
  f.orders.get(payment.operation.payment.providerOrderId).status = 'APPROVED';
  const started = await f.service.resume(OWNER, operation.id);
  await f.commerce.cup(OWNER, { requestKey: randomUUID(), broadcastId: started.broadcastId, fighterIds: operation.input.fighterIds });
  assert.equal((await f.service.resume(OWNER, operation.id)).state, 'queued');
  assert.equal((await f.store.wallet(OWNER)).reservedCredits, 25);
  const job = await f.store.claimJob('renderer', { hostId: operation.input.hostId });
  assert.equal((await f.service.resume(OWNER, operation.id)).state, 'running');
  await f.store.completeJob('renderer', { jobId: job.id, leaseToken: job.leaseToken, outcome: 'unknown', result: { reason: 'lost renderer' } });
  assert.equal((await f.service.resume(OWNER, operation.id)).state, 'needs_reconciliation');
  const report = await f.commerce.report(OWNER, started.broadcastId);
  assert.notEqual(report.broadcast.status, 'completed');
  assert.equal(report.jobs[0].status, 'unknown');
  assert.equal(report.confirmedSpentCredits, 0);
  assert.equal((await f.store.wallet(OWNER)).reservedCredits, 25);
  assert.equal(report.ledger.filter(entry => entry.kind === 'release').length, 0);
});
