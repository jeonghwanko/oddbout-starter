import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createCommerceHandler } from '../api/commerce/handler.mjs';
import { verifiedUserId } from '../api/http.mjs';
import { createCommerceService } from '../api/commerce/service.mjs';
import { createPayPalSandbox } from '../api/commerce/paypal.mjs';
import { COMMERCE_CATALOG } from '../api/commerce/catalog.mjs';
import { createBroadcastWorkerHandler } from '../broadcast/worker-api.mjs';
import { registerCommerceTools } from '../mcp/cloud/commerce-tools.mjs';
import { output } from '../mcp/cloud/common.mjs';
import { commerceDatabase } from './helpers/commerce-database.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'https://console.example.test';
const MERCHANT = 'SANDBOXMERCHANT';
const FIGHTERS = ['kuma', 'yume', 'bravow', 'beotim'];
const product = COMMERCE_CATALOG.products[0];
const budget = (extra = {}) => ({ requestKey: randomUUID(), hostId: 'current-pc', channelId: 'integration-channel', endsAt: new Date(Date.now() + 3_600_000).toISOString(), fighterIds: FIGHTERS, maxCredits: 100, confirmed: true, ...extra });
const proof=job=>({protocolVersion:1,jobId:job.id,leaseToken:job.leaseToken,seed:job.seed,winnerId:job.fighterIds[0],bouts:[
  [job.fighterIds[0],job.fighterIds[1]],[job.fighterIds[2],job.fighterIds[3]],[job.fighterIds[0],job.fighterIds[2]],
].map(([leftId,rightId],index)=>({leftId,rightId,winnerId:leftId,winner:0,seed:(job.seed+index)>>>0,how:'decision',ms:100,hp:[1,0],contacts:[0,0],digest:'1234abcd'}))});

/** The real Sandbox adapter runs against this single mocked HTTP boundary. No
 * service/store/accounting/worker/MCP rules are replaced. Auth claims below are
 * fixed identities supplied by the separate Supabase authentication boundary. */
async function fixture(t) {
  const database = await commerceDatabase();
  t.after(() => database.db.close());
  const orders = new Map(); const calls = [];
  let loseCaptureResponse = false;
  const paypal = createPayPalSandbox({ clientId: 'fixture-client', clientSecret: 'fixture-secret', merchantId: MERCHANT,
    fetch: async (url, init) => {
      assert.equal(new URL(url).origin, 'https://api-m.sandbox.paypal.com');
      const path = new URL(url).pathname; const body = init.body && init.body !== 'grant_type=client_credentials' ? JSON.parse(init.body) : null;
      calls.push({ path, method: init.method, body, requestId: new Headers(init.headers).get('paypal-request-id') });
      const json = data => new Response(JSON.stringify(data));
      if (path === '/v1/oauth2/token') return json({ access_token: 'fixture-token', token_type: 'Bearer', expires_in: 3600 });
      if (path === '/v1/notifications/verify-webhook-signature') return json({ verification_status: body.transmission_sig === 'fixture-valid-signature' && body.webhook_id === 'WEBHOOK1' ? 'SUCCESS' : 'FAILURE' });
      if (path === '/v2/checkout/orders' && init.method === 'POST') {
        const id = `ORDER${orders.size + 1}`;
        const order = { id, intent: body.intent, status: 'CREATED', purchase_units: structuredClone(body.purchase_units), links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] };
        orders.set(id, order); return json(order);
      }
      const match = path.match(/^\/v2\/checkout\/orders\/([A-Z0-9]+)(\/capture)?$/);
      assert.ok(match, `unexpected PayPal request ${path}`);
      const order = orders.get(match[1]); assert.ok(order);
      if (match[2]) {
        order.status = 'COMPLETED';
        order.purchase_units[0].payments = { captures: [{ id: `CAPTURE${order.id}`, status: 'COMPLETED', final_capture: true, amount: structuredClone(order.purchase_units[0].amount) }] };
        if (loseCaptureResponse) { loseCaptureResponse = false; throw new TypeError('simulated response loss after provider capture'); }
      }
      return json(order);
    },
  });
  const service = createCommerceService({ store: database.store, paypal, merchantId: MERCHANT, publicOrigin: ORIGIN, webhookId: 'WEBHOOK1', hosts: [{ id: 'current-pc' }, { id: 'office-stable' }, { id: 'svl-mac-01' }] });
  const db = { rpc: database.rpc, auth: { getClaims: async token => ({ data: { claims: token === `fixture-${OWNER}` || token === `fixture-${OTHER}` ? { sub: token.slice(8), role: 'authenticated', is_anonymous: false } : null }, error: null }) } };
  const commerce = { service, publicOrigin: ORIGIN };
  // The Sandbox API runs only in the demo server (scripts/broadcast-demo.mjs), never in the production ai-fighter function.
  const handle = createCommerceHandler({ ...commerce, authenticate: request => verifiedUserId(db, request) });
  const agentHandle = createCommerceHandler({ ...commerce, authenticate: request => verifiedUserId(db, request), agent: true });
  async function call(path, { owner = OWNER, method = 'POST', body = {}, origin = ORIGIN, handler = handle } = {}) {
    const response = await handler(new Request(`${ORIGIN}/ai-fighter/commerce/${path}`, { method, headers: { ...(owner ? { authorization: `Bearer fixture-${owner}` } : {}), ...(origin !== null ? { origin } : {}), ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }));
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  async function checkout(extra = {}) {
    const response = await call('checkout', { body: { requestKey: randomUUID(), productId: product.id, ...extra } });
    assert.equal(response.status, 200); return response.body.data;
  }
  async function funded() {
    const intent = await checkout();
    const order = [...orders.values()].find(order => order.purchase_units[0].reference_id === intent.intentId);
    order.status = 'APPROVED';
    const response = await call(`topups/${intent.intentId}/capture`); assert.equal(response.status, 200);
    return intent;
  }
  async function started(extra = {}) {
    const approved = await call('approvals', { body: budget(extra) }); assert.equal(approved.status, 200);
    const response = await call('broadcasts', { body: { requestKey: randomUUID(), approvalId: approved.body.data.id } }); assert.equal(response.status, 200);
    return response.body.data;
  }
  const workers = [{ hostId: 'current-pc', token: 'current-test-worker-token-32-characters' }, { hostId: 'office-stable', token: 'office-test-worker-token-32-characters' }];
  const worker = createBroadcastWorkerHandler({ store: database.store, workers });
  async function work(command, hostId = 'current-pc', body = {}) {
    const response = await worker(new Request(`https://worker.example.test/broadcast-worker/${command}`, { method: 'POST', headers: { authorization: `Bearer ${workers.find(item => item.hostId === hostId).token}`, 'content-type': 'application/json' }, body: JSON.stringify({ workerId: 'integration-worker', ...body }) }));
    return { status: response.status, body: await response.json() };
  }
  // An account-bound agent's tool surface: the commerce tools over the agent-mode handler, which refuses budget approval.
  async function mcp(owner = OWNER) {
    const server = new McpServer({ name: 'commerce-integration', version: '1.0.0' });
    const api = createCommerceHandler({ ...commerce, authenticate: async () => owner, agent: true });
    /** @type {import('../mcp/cloud/common.mjs').Invoke} */
    const invoke = async (path, method = 'GET', body, headers = {}) =>
      (await api(new Request(`${ORIGIN}/${path}`, { method, headers, ...(body === undefined ? {} : { body }) }))).json();
    registerCommerceTools({ invoke, register: (name, title, description, inputSchema, run, { write = false, idempotent = !write } = {}) =>
      server.registerTool(name, { title, description, inputSchema, annotations: { readOnlyHint: !write, idempotentHint: idempotent } }, async args => output(await run(args))) });
    const client = new Client({ name: 'commerce-integration', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    t.after(async () => { await client.close(); await server.close(); });
    return client;
  }
  return { ...database, dbFacade: db, orders, calls, service, call, checkout, funded, started, work, mcp, agentHandle, loseNextCaptureResponse: () => { loseCaptureResponse = true; } };
}

test('HTTP checkout enforces server product/owner, reconciles capture response loss, and replays without another credit', async t => {
  const f = await fixture(t); const requestKey = randomUUID();
  const intent = await f.checkout({ requestKey, owner: OTHER, amountMinor: 1, amountCents: 1, credits: 999999, currency: 'EUR' });
  const creation = f.calls.find(call => call.path === '/v2/checkout/orders');
  assert.deepEqual(creation.body.purchase_units, [{ reference_id: intent.intentId, amount: { currency_code: 'USD', value: '10.00' }, payee: { merchant_id: MERCHANT } }]);
  assert.equal(creation.requestId, `o-${intent.intentId}`);
  const before = f.calls.length;
  const stolen = await f.call(`topups/${intent.intentId}/capture`, { owner: OTHER, body: { owner: OWNER } });
  assert.equal(stolen.status, 404); assert.equal(stolen.body.code, 'not-found'); assert.equal(f.calls.length, before);
  assert.equal((await f.call(`topups/${intent.intentId}/capture`)).body.code, 'paypal-approval-required');
  assert.equal((await f.store.wallet(OWNER)).balanceCredits, 0);
  f.orders.get('ORDER1').status = 'APPROVED'; f.loseNextCaptureResponse();
  const captured = await f.call(`topups/${intent.intentId}/capture`); assert.equal(captured.status, 200); assert.equal(captured.body.data.status, 'credited');
  const replay = await f.call(`topups/${intent.intentId}/capture`); assert.equal(replay.status, 200);
  const checkoutReplay = await f.call('checkout', { body: { requestKey, productId: product.id } }); assert.equal(checkoutReplay.body.data.status, 'credited');
  assert.equal(f.calls.filter(call => call.path.endsWith('/capture')).length, 1);
  assert.equal(f.calls.find(call => call.path.endsWith('/capture')).requestId, `c-${intent.intentId}`);
  assert.equal((await f.store.wallet(OWNER)).balanceCredits, product.credits);
  assert.equal((await f.store.wallet(OTHER)).balanceCredits, 0);
  assert.equal((await f.db.query("select count(*)::int as n from commerce.ledger where kind='topup'")).rows[0].n, 1);
});

test('real PayPal validation rejects forged amount, currency, reference, merchant and pending capture before credit', async t => {
  const f = await fixture(t);
  const mutations = [unit => { unit.amount.value = '0.01'; }, unit => { unit.amount.currency_code = 'EUR'; }, unit => { unit.reference_id = randomUUID(); }, unit => { unit.payee.merchant_id = 'OTHERSELLER'; }, unit => { unit.payments.captures[0].status = 'PENDING'; }];
  for (const mutate of mutations) {
    const intent = await f.checkout();
    const order = [...f.orders.values()].find(order => order.purchase_units[0].reference_id === intent.intentId);
    order.status = 'COMPLETED'; const unit = order.purchase_units[0];
    unit.payments = { captures: [{ id: `CAPTURE${order.id}`, status: 'COMPLETED', final_capture: true, amount: structuredClone(unit.amount) }] };
    mutate(unit);
    const response = await f.call(`topups/${intent.intentId}/capture`);
    assert.equal(response.status, 502); assert.equal(response.body.ok, false); assert.equal((await f.store.wallet(OWNER)).balanceCredits, 0);
    assert.equal((await f.store.findTopup(OWNER, intent.intentId)).status, 'ordered');
  }
  assert.equal((await f.db.query("select count(*)::int as n from commerce.ledger where kind='topup'")).rows[0].n, 0);
});

test('approved order binding is validated before any provider capture mutation',async t=>{
  const f=await fixture(t);
  const intent=await f.checkout();const order=f.orders.get('ORDER1');order.status='APPROVED';
  order.purchase_units[0].amount.value='0.01';
  const response=await f.call(`topups/${intent.intentId}/capture`);
  assert.equal(response.status,502);
  assert.equal(f.calls.filter(call=>call.path.endsWith('/capture')).length,0,'a mismatched order must never be charged before validation');
  assert.equal((await f.store.wallet(OWNER)).balanceCredits,0);
});

test('recovered checkout refuses approval links for another order or another PayPal path',async t=>{
  const f=await fixture(t);const requestKey=randomUUID();await f.checkout({requestKey});
  const order=f.orders.get('ORDER1');
  for(const href of ['https://www.sandbox.paypal.com/checkoutnow?token=OTHER','https://www.sandbox.paypal.com/other-path?token=ORDER1']){
    order.links=[{rel:'payer-action',href}];
    const response=await f.call('checkout',{body:{requestKey,productId:product.id}});
    assert.equal(response.status,409);
    assert.equal(Object.hasOwn(response.body.data??{},'approvalUrl'),false);
  }
});

test('budget approvals require same-origin confirmed human web request; owner and tool price remain server controlled', async t => {
  const f = await fixture(t); await f.funded(); const approval = budget({ owner: OTHER, priceVersion: 'attacker-price', cupCredits: 1 });
  for (const change of [{ origin: null }, { origin: 'https://attacker.test' }, { handler: f.agentHandle }, { body: { ...approval, confirmed: false } }]) {
    const response = await f.call('approvals', { body: approval, ...change }); assert.equal(response.status, 403);
  }
  assert.equal((await f.call('approvals', { owner: null, body: approval })).status, 401);
  const approved = await f.call('approvals', { body: approval }); assert.equal(approved.status, 200);
  assert.equal(approved.body.data.owner, OWNER); assert.equal(approved.body.data.priceVersion, COMMERCE_CATALOG.version);
  const startBody = { requestKey: randomUUID(), approvalId: approved.body.data.id, owner: OWNER, hostId: 'office-stable', maxCredits: 999999 };
  assert.equal((await f.call('broadcasts', { owner: OTHER, body: startBody })).status, 404);
  const started = await f.call('broadcasts', { body: startBody }); assert.equal(started.status, 200); assert.equal(started.body.data.hostId, 'current-pc');
  const queued = await f.call('cups', { body: { requestKey: randomUUID(), broadcastId: started.body.data.id, fighterIds: FIGHTERS, priceCredits: 1, priceVersion: 'attacker', owner: OTHER } });
  assert.equal(queued.status, 200); assert.equal(queued.body.data.owner, OWNER); assert.equal(queued.body.data.priceCredits, 25); assert.equal(queued.body.data.priceVersion, COMMERCE_CATALOG.version);
  for (const path of [`jobs/${queued.body.data.id}`, `broadcasts/${started.body.data.id}/jobs`, `broadcasts/${started.body.data.id}/report`]) assert.equal((await f.call(path, { owner: OTHER, method: 'GET' })).status, 404);
});

test('null, primitive and malformed mutation boundaries cannot reach PayPal, approve a budget or reserve credits',async t=>{
  const f=await fixture(t);
  for(const body of [null,[],false,42,{}, {requestKey:null,productId:product.id}]){
    const checkout=await f.call('checkout',{body});assert.ok(checkout.status>=400&&checkout.status<500);
    const start=await f.call('broadcasts',{body});assert.ok(start.status>=400&&start.status<500);
    const cup=await f.call('cups',{body});assert.ok(cup.status>=400&&cup.status<500);
  }
  for(const change of [{requestKey:null},{hostId:null},{channelId:null},{maxCredits:null},{endsAt:null},{fighterIds:[...FIGHTERS.slice(0,3),null]},{confirmed:null}]){
    const response=await f.call('approvals',{body:budget(change)});assert.ok(response.status>=400&&response.status<500);
  }
  assert.equal(f.calls.length,0);
  assert.equal((await f.db.query('select count(*)::int as n from commerce.approvals')).rows[0].n,0);
  assert.equal((await f.db.query('select count(*)::int as n from commerce.topups')).rows[0].n,0);
  assert.equal((await f.store.wallet(OWNER)).reservedCredits,0);
});

test('host worker bearer controls claims despite body.hostId; lease fencing and unknown holds survive stop', async t => {
  const f = await fixture(t); await f.funded(); const broadcast = await f.started({ hostId: 'office-stable' });
  const queued = await f.call('cups', { body: { requestKey: randomUUID(), broadcastId: broadcast.id, fighterIds: FIGHTERS } }); assert.equal(queued.status, 200);
  assert.deepEqual((await f.work('claim', 'current-pc', { hostId: 'office-stable' })).body, { ok: true, data: null });
  const first = (await f.work('claim', 'office-stable', { hostId: 'current-pc' })).body.data;
  assert.equal(first.id, queued.body.data.id); assert.equal(first.hostId, 'office-stable'); assert.equal(first.workerId, 'office-stable:integration-worker');
  const completion = { jobId: first.id, leaseToken: first.leaseToken, outcome: 'failed' };
  assert.equal((await f.work('complete', 'current-pc', completion)).body.code, 'stale-lease');
  await f.db.query("update commerce.jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1", [first.id]);
  assert.equal((await f.work('claim', 'office-stable')).body.data, null);
  const unknown = await f.store.getJob(OWNER, first.id);
  assert.equal(unknown.status, 'unknown'); assert.equal(unknown.seed, first.seed); assert.equal(unknown.leaseToken, first.leaseToken);
  assert.equal((await f.work('complete', 'office-stable', completion)).body.code, 'stale-lease');
  assert.equal((await f.work('claim', 'office-stable')).body.data, null);
  const stopped = await f.call(`broadcasts/${broadcast.id}/stop`); assert.equal(stopped.status, 200); assert.equal(stopped.body.data.reservedCredits, 25);
  assert.equal((await f.store.wallet(OWNER)).balanceCredits, 1000); assert.equal((await f.store.wallet(OWNER)).reservedCredits, 25);
  assert.equal((await f.work('complete', 'office-stable', completion)).body.code, 'stale-lease');
  const report = await f.call(`broadcasts/${broadcast.id}/report`, { method: 'GET' });
  assert.equal(report.body.data.confirmedSpentCredits, 0); assert.equal(report.body.data.remainingReservedCredits, 25); assert.equal(report.body.data.broadcastObservation.liveSeconds, null);
});

test('commerce MCP tools invoke account-bound service/store, expose no approval tool and keep server prices', async t => {
  const f = await fixture(t); await f.funded(); const approved = await f.call('approvals', { body: budget() }); assert.equal(approved.status, 200);
  const owner = await f.mcp(); const other = await f.mcp(OTHER);
  const list = await owner.listTools();
  assert.ok(list.tools.some(tool => tool.name === 'host_cup'));
  assert.equal(list.tools.some(tool => /approv.*budget|budget.*approv|approve_broadcast/.test(tool.name)), false);
  assert.equal(list.tools.find(tool => tool.name === 'host_cup').annotations.idempotentHint, true);
  const call = async (client, name, args = {}) => (await client.callTool({ name, arguments: args })).structuredContent;
  const quote = await call(owner, 'quote_broadcast', budget({ cupCredits: 1, priceVersion: 'attacker', owner: OTHER }));
  assert.equal(quote.ok, true); assert.equal(quote.data.cupCredits, 25); assert.equal(quote.data.priceVersion, COMMERCE_CATALOG.version);
  const stolen = await call(other, 'start_broadcast', { requestKey: randomUUID(), approvalId: approved.body.data.id }); assert.equal(stolen.ok, false); assert.equal(stolen.code, 'not-found');
  const startArgs = { requestKey: randomUUID(), approvalId: approved.body.data.id };
  const started = await call(owner, 'start_broadcast', startArgs); assert.equal(started.ok, true); assert.equal((await call(owner, 'start_broadcast', startArgs)).data.id, started.data.id);
  const cupArgs = { requestKey: randomUUID(), broadcastId: started.data.id, fighterIds: FIGHTERS, priceCredits: 1, owner: OTHER };
  const queued = await call(owner, 'host_cup', cupArgs); assert.equal(queued.ok, true); assert.equal(queued.data.owner, OWNER); assert.equal(queued.data.priceCredits, 25);
  assert.equal((await call(owner, 'host_cup', cupArgs)).data.id, queued.data.id);
  assert.equal((await call(other, 'get_broadcast_job', { jobId: queued.data.id })).code, 'not-found');
  assert.equal((await call(owner, 'get_credit_balance')).data.reservedCredits, 100);
});

test('webhook authenticity is checked before linkage, and duplicate completion shares capture uniqueness with sync replay', async t => {
  const f = await fixture(t); const intent = await f.funded();
  const event = { id: 'EVENT1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { supplementary_data: { related_ids: { order_id: 'ORDER1' } }, amount: { value: '999.99', currency_code: 'EUR' }, payee: { merchant_id: 'FORGEDPAYEE' } } };
  // The webhook resource is merely a signal: canonical order data is re-fetched.
  const headers = { 'content-type': 'application/json', 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT1', 'paypal-transmission-id': 'TX1', 'paypal-transmission-time': new Date().toISOString(), 'paypal-transmission-sig': 'fixture-valid-signature' };
  const before = f.calls.length;
  const forged = await f.call('webhook', { owner: null, origin: null, body: event, handler: request => createCommerceHandler({ service: f.service, publicOrigin: ORIGIN, authenticate: request => verifiedUserId(f.dbFacade, request) })(new Request(request, { headers: { ...headers, 'paypal-transmission-sig': 'forged' } })) });
  assert.equal(forged.status, 400); assert.equal(forged.body.code, 'invalid-paypal-webhook');
  assert.equal(f.calls.length, before + 1); assert.equal(f.calls.at(-1).path, '/v1/notifications/verify-webhook-signature');
  const actual = createCommerceHandler({ service: f.service, publicOrigin: ORIGIN, authenticate: request => verifiedUserId(f.dbFacade, request) });
  for (let index = 0; index < 2; index++) {
    const response = await actual(new Request(`${ORIGIN}/ai-fighter/commerce/webhook`, { method: 'POST', headers, body: JSON.stringify(event) }));
    assert.equal(response.status, 200); assert.equal((await response.json()).applied, true);
  }
  assert.equal((await f.call(`topups/${intent.intentId}/capture`)).status, 200);
  assert.equal((await f.store.wallet(OWNER)).balanceCredits, product.credits);
  assert.equal((await f.db.query("select count(*)::int as n from commerce.ledger where kind='topup'")).rows[0].n, 1);
});

test('verified refunds dedupe durably, freeze the capture owner and block new/active spending without debiting or auto-refunding',async t=>{
  const f=await fixture(t);await f.funded();
  const pendingKey=randomUUID();const pending=await f.checkout({requestKey:pendingKey});
  const nextApproval=await f.call('approvals',{body:budget({channelId:'next-session'})});assert.equal(nextApproval.status,200);
  const broadcast=await f.started();const queued=await f.call('cups',{body:{requestKey:randomUUID(),broadcastId:broadcast.id,fighterIds:FIGHTERS}});
  const active=(await f.work('claim')).body.data;assert.equal(active.id,queued.body.data.id);
  const handler=createCommerceHandler({service:f.service,publicOrigin:ORIGIN,authenticate:request=>verifiedUserId(f.dbFacade,request)});
  const send=async(event,signature='fixture-valid-signature')=>{
    const response=await handler(new Request(`${ORIGIN}/ai-fighter/commerce/webhook`,{method:'POST',headers:{'content-type':'application/json',
      'paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.sandbox.paypal.com/v1/notifications/certs/CERT1',
      'paypal-transmission-id':'TX1','paypal-transmission-time':new Date().toISOString(),...(signature===null?{}:{'paypal-transmission-sig':signature})},body:JSON.stringify(event)}));
    return {status:response.status,body:await response.json()};
  };
  const event={id:'REFUND-EVENT-1',event_type:'PAYMENT.CAPTURE.REFUNDED',owner:OTHER,resource:{id:'REFUND-RESOURCE-1',
    privateMemo:'fixture-sensitive-event-body',supplementary_data:{related_ids:{capture_id:'CAPTUREORDER1',order_id:'ORDER1'}}}};
  assert.equal((await send(event,'forged')).status,400);assert.equal((await send(event,null)).status,400);
  assert.equal((await f.store.wallet(OWNER)).spendingBlocked,false);
  const unlinked=structuredClone(event);unlinked.id='UNLINKED';unlinked.resource.supplementary_data.related_ids.capture_id='UNKNOWN';
  const early=await send(unlinked);assert.equal(early.status,200);assert.equal(early.body.recorded,true);assert.equal(early.body.applied,false);assert.equal((await f.store.wallet(OWNER)).spendingBlocked,false);
  const mismatch=structuredClone(event);mismatch.id='MISMATCH';mismatch.resource.supplementary_data.related_ids.order_id='OTHERORDER';
  assert.equal((await send(mismatch)).status,409);assert.equal((await f.store.wallet(OWNER)).spendingBlocked,false);
  const duplicates=await Promise.all([send(event),send(event)]);assert.ok(duplicates.every(response=>response.status===200&&response.body.applied&&response.body.needsReconciliation));
  const wallet=await f.store.wallet(OWNER);assert.equal(wallet.spendingBlocked,true);assert.equal(wallet.blockReason,'payment-adjustment-needs-reconciliation');
  assert.equal(wallet.balanceCredits,1000);assert.equal(wallet.reservedCredits,100);assert.equal((await f.store.wallet(OTHER)).spendingBlocked,false);
  const rows=(await f.db.query('select * from commerce.payment_adjustments')).rows;assert.equal(rows.length,1);assert.equal(rows[0].owner,OWNER);
  assert.equal(rows[0].capture_id,'CAPTUREORDER1');assert.doesNotMatch(JSON.stringify(rows),/fixture-sensitive-event-body/);
  f.orders.get('ORDER1').purchase_units[0].payments.captures[0].status='REFUNDED';
  assert.equal((await send({id:'OLD-COMPLETED',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{supplementary_data:{related_ids:{order_id:'ORDER1'}}}})).status,200);
  assert.equal((await f.store.wallet(OWNER)).spendingBlocked,true);
  assert.equal((await f.db.query("select count(*)::int as n from commerce.ledger where kind='topup'")).rows[0].n,1);
  const creates=f.calls.filter(call=>call.path==='/v2/checkout/orders').length;
  assert.equal((await f.call('checkout',{body:{requestKey:randomUUID(),productId:product.id}})).body.code,'wallet-frozen');
  assert.equal(f.calls.filter(call=>call.path==='/v2/checkout/orders').length,creates);
  assert.equal((await f.call('approvals',{body:budget({channelId:'another'})})).body.code,'wallet-frozen');
  assert.equal((await f.call('broadcasts',{body:{requestKey:randomUUID(),approvalId:nextApproval.body.data.id}})).body.code,'wallet-frozen');
  assert.equal((await f.call('cups',{body:{requestKey:randomUUID(),broadcastId:broadcast.id,fighterIds:FIGHTERS}})).body.code,'wallet-frozen');
  assert.equal((await f.work('claim')).body.data,null);
  assert.equal((await f.work('renew','current-pc',{jobId:active.id,leaseToken:active.leaseToken})).body.code,'wallet-frozen');
  assert.equal((await f.work('complete','current-pc',{jobId:active.id,leaseToken:active.leaseToken,outcome:'succeeded',result:proof(active)})).body.code,'wallet-frozen');
  assert.equal((await f.store.getJob(OWNER,active.id)).status,'unknown');
  assert.equal((await f.call(`broadcasts/${broadcast.id}/stop`)).body.data.reservedCredits,25);
  assert.equal((await f.call('checkout',{body:{requestKey:pendingKey,productId:product.id}})).status,200);
  f.orders.get('ORDER2').status='APPROVED';assert.equal((await f.call(`topups/${pending.intentId}/capture`)).status,200);
  const reconciled=await f.store.wallet(OWNER);assert.equal(reconciled.balanceCredits,2000);assert.equal(reconciled.reservedCredits,25);assert.equal(reconciled.spendingBlocked,true);
  assert.equal((await f.db.query("select count(*)::int as n from commerce.ledger where kind='spend'")).rows[0].n,0);
});

test('verified reversal resolves resource capture ID strictly and cannot freeze an unlinked or mismatched owner',async t=>{
  const f=await fixture(t);await f.funded();
  const event={id:'REVERSED-1',event_type:'PAYMENT.CAPTURE.REVERSED',owner:OTHER,resource:{id:'CAPTUREORDER1',supplementary_data:{related_ids:{order_id:'ORDER1'}}}};
  const headers=new Headers({'paypal-transmission-sig':'fixture-valid-signature','paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.sandbox.paypal.com/v1/notifications/certs/CERT1','paypal-transmission-id':'TX1','paypal-transmission-time':new Date().toISOString()});
  await f.service.webhook(headers,JSON.stringify(event));await f.service.webhook(headers,JSON.stringify(event));
  assert.equal((await f.store.wallet(OWNER)).spendingBlocked,true);assert.equal((await f.store.wallet(OTHER)).spendingBlocked,false);
  assert.equal((await f.db.query('select count(*)::int as n from commerce.payment_adjustments')).rows[0].n,1);
  await assert.rejects(f.service.webhook(headers,JSON.stringify({...event,id:'MISMATCH-REVERSED',resource:{id:'CAPTUREORDER1',supplementary_data:{related_ids:{capture_id:'OTHER'}}}})),error=>error.message==='adjustment-mismatch');
  const unlinked=await f.service.webhook(headers,JSON.stringify({...event,id:'UNLINKED-REVERSED',resource:{id:'UNKNOWN'}}));
  assert.equal(unlinked.recorded,true);assert.equal(unlinked.applied,false);
});

test('signed refund before provider order creation survives capture-response loss and stale completed replay without spendable credit',async t=>{
  const f=await fixture(t);
  const headers=new Headers({'paypal-transmission-sig':'fixture-valid-signature','paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.sandbox.paypal.com/v1/notifications/certs/CERT1','paypal-transmission-id':'EARLY-TX','paypal-transmission-time':new Date().toISOString()});
  const adjustment={id:'BEFORE-CREATE',event_type:'PAYMENT.CAPTURE.REFUNDED',owner:OTHER,resource:{supplementary_data:{related_ids:{order_id:'ORDER1',capture_id:'CAPTUREORDER1'}}}};
  const received=await f.service.webhook(headers,JSON.stringify(adjustment));
  assert.deepEqual(received,{received:true,recorded:true,applied:false,needsReconciliation:true});
  assert.equal(f.calls.some(call=>call.path==='/v2/checkout/orders'),false);
  assert.equal((await f.store.wallet(OWNER)).spendingBlocked,false);assert.equal((await f.store.wallet(OTHER)).spendingBlocked,false);
  const intent=await f.checkout();f.orders.get('ORDER1').status='APPROVED';f.loseNextCaptureResponse();
  assert.equal((await f.call(`topups/${intent.intentId}/capture`)).status,200);
  const wallet=await f.store.wallet(OWNER);assert.equal(wallet.balanceCredits,product.credits);assert.equal(wallet.spendingBlocked,true);
  assert.equal((await f.call('approvals',{body:budget()})).body.code,'wallet-frozen');
  await f.service.webhook(headers,JSON.stringify(adjustment));
  await f.service.webhook(headers,JSON.stringify({id:'LATE-COMPLETED',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{supplementary_data:{related_ids:{order_id:'ORDER1'}}}}));
  assert.equal((await f.store.wallet(OWNER)).spendingBlocked,true);assert.equal((await f.store.wallet(OTHER)).spendingBlocked,false);
  assert.equal((await f.db.query("select count(*)::int as n from commerce.ledger where kind='topup'")).rows[0].n,1);
  assert.equal((await f.db.query('select count(*)::int as n from commerce.payment_adjustment_inbox')).rows[0].n,1);
});
