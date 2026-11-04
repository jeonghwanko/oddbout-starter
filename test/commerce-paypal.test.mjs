import test from 'node:test';
import assert from 'node:assert/strict';
import { createPayPalSandbox, validateCapturedOrder, PayPalError } from '../api/commerce/paypal.mjs';

const ORIGIN = 'https://api-m.sandbox.paypal.com';
const expected = { orderId: 'ORDER1', referenceId: 'topup-1', amountMinor: 501, currency: 'USD', merchantId: 'MERCHANT1' };
const input = { ...expected, requestId: 'create-1', returnUrl: 'http://localhost:5178/return', cancelUrl: 'http://localhost:5178/cancel' };
const token = { access_token: 'private-token', token_type: 'Bearer', expires_in: 3600 };
const json = value => new Response(JSON.stringify(value), { status: 200 });
const completed = () => ({ id: 'ORDER1', intent: 'CAPTURE', status: 'COMPLETED', purchase_units: [{ reference_id: 'topup-1', amount: { currency_code: 'USD', value: '5.01' }, payee: { merchant_id: 'MERCHANT1' }, payments: { captures: [{ id: 'CAPTURE1', status: 'COMPLETED', final_capture: true, amount: { currency_code: 'USD', value: '5.01' } }] } }] });
function setup(handler, options = {}) {
  const calls = [];
  const adapter = createPayPalSandbox({ clientId: 'private-client', clientSecret: 'private-secret', merchantId: 'MERCHANT1', fetch: async (url, init) => {
    calls.push({ url, ...init });
    assert.ok(url.startsWith(ORIGIN + '/'));
    assert.equal(init.redirect, 'error');
    return handler(url, init, calls);
  }, ...options });
  return { adapter, calls };
}

test('create and duplicate request use caller key, one server amount/payee and sandbox approval; OAuth is reused', async () => {
  const { adapter, calls } = setup(url => json(url.endsWith('/token') ? token : { id: 'ORDER1', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1' }] }));
  const first = await adapter.createOrder(input);
  assert.deepEqual(await adapter.createOrder(input), first);
  assert.deepEqual(first, { id: 'ORDER1', approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1' });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].headers['PayPal-Request-Id'], 'create-1');
  assert.equal(calls[2].headers['PayPal-Request-Id'], 'create-1');
  const body = JSON.parse(calls[1].body);
  assert.equal(body.intent, 'CAPTURE');
  assert.deepEqual(body.purchase_units, [{ reference_id: 'topup-1', amount: { currency_code: 'USD', value: '5.01' }, payee: { merchant_id: 'MERCHANT1' } }]);
  assert.equal(body.payment_source.paypal.experience_context.user_action, 'PAY_NOW');
});

test('concurrent GETs share a token and expiry refreshes it in memory', async () => {
  let clock = 0;
  const { adapter, calls } = setup(url => json(url.endsWith('/token') ? token : completed()), { now: () => clock });
  await Promise.all([adapter.getOrder('ORDER1'), adapter.getOrder('ORDER1')]);
  assert.equal(calls.filter(call => call.url.endsWith('/token')).length, 1);
  clock = 3600_000;
  await adapter.getOrder('ORDER1');
  assert.equal(calls.filter(call => call.url.endsWith('/token')).length, 2);
});

test('completed order validates full binding; approval, pending, malformed and mismatches cannot credit', () => {
  assert.deepEqual(validateCapturedOrder(completed(), expected), { ...expected, captureId: 'CAPTURE1' });
  const mutations = [
    order => { order.status = 'APPROVED'; }, order => { order.intent = 'AUTHORIZE'; },
    order => { order.id = 'OTHER'; }, order => { order.purchase_units.push(order.purchase_units[0]); },
    order => { order.purchase_units[0].reference_id = 'other-owner'; },
    order => { order.purchase_units[0].payee.merchant_id = 'OTHER'; },
    order => { order.purchase_units[0].amount.currency_code = 'EUR'; },
    order => { order.purchase_units[0].amount.value = '5.02'; },
    order => { order.purchase_units[0].payments.captures[0].status = 'PENDING'; },
    order => { order.purchase_units[0].payments.captures[0].final_capture = false; },
    order => { order.purchase_units[0].payments.captures[0].amount.value = '5.010'; },
    order => { order.purchase_units[0].payments.captures[0].amount.value = 5.01; },
    order => { order.purchase_units[0].payments.captures[0].amount.currency_code = 'EUR'; },
    order => { order.purchase_units[0].payments.captures.push(order.purchase_units[0].payments.captures[0]); },
    order => { order.purchase_units[0].payments.captures[0].supplementary_data = { related_ids: { order_id: 'OTHER' } }; },
  ];
  for (const mutate of mutations) { const order = completed(); mutate(order); assert.throws(() => validateCapturedOrder(order, expected), PayPalError); }
  for (const invalid of [null, {}, [], { purchase_units: null }]) assert.throws(() => validateCapturedOrder(invalid, expected), PayPalError);
});

test('rejects live, attacker, credential and mismatched-token approval links', async () => {
  for (const href of ['https://www.paypal.com/checkoutnow?token=ORDER1', 'https://www.sandbox.paypal.com.attacker.test/checkoutnow?token=ORDER1', 'https://www.sandbox.paypal.com@attacker.test/checkoutnow?token=ORDER1', 'https://x@www.sandbox.paypal.com/checkoutnow?token=ORDER1', 'https://www.sandbox.paypal.com/checkoutnow?token=OTHER', 'javascript:alert(1)']) {
    const { adapter } = setup(url => json(url.endsWith('/token') ? token : { id: 'ORDER1', links: [{ rel: 'approve', href }] }));
    await assert.rejects(adapter.createOrder(input), error => error.code === 'paypal_invalid_approval' && error.outcomeUnknown);
  }
});

test('capture uses stable key and getOrder reconciles response loss; no hidden retry or secret output', async () => {
  const { adapter, calls } = setup(url => {
    if (url.endsWith('/token')) return json(token);
    if (url.endsWith('/capture')) throw new Error('private-secret private-token private-client');
    return json(completed());
  });
  await assert.rejects(adapter.captureOrder({ orderId: 'ORDER1', requestId: 'capture-1' }), error => {
    assert.equal(error.code, 'paypal_network_error'); assert.equal(error.outcomeUnknown, true);
    assert.doesNotMatch(JSON.stringify(error) + error.stack, /private-/);
    return true;
  });
  assert.equal(calls[1].headers['PayPal-Request-Id'], 'capture-1');
  assert.deepEqual(validateCapturedOrder(await adapter.getOrder('ORDER1'), expected), { ...expected, captureId: 'CAPTURE1' });
  assert.equal(calls.length, 3);
});

test('provider HTTP and malformed/oversized responses are redacted; mutations remain uncertain', async () => {
  for (const response of [new Response('private-secret private-token', { status: 500 }), new Response('ORDER_ALREADY_CAPTURED private-token', { status: 422 }), new Response('not JSON private-token'), new Response('x'.repeat(262145))]) {
    const { adapter, calls } = setup(url => url.endsWith('/token') ? json(token) : response);
    await assert.rejects(adapter.captureOrder({ orderId: 'ORDER1', requestId: 'capture-1' }), error => {
      assert.equal(error.outcomeUnknown, true); assert.doesNotMatch(error.stack + JSON.stringify(error), /private-/); return true;
    });
    assert.equal(calls.length, 2);
  }
});

test('capture timeout is bounded and uncertain even if injected fetch ignores AbortSignal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let dispatched;
  const reached = new Promise(resolve => { dispatched = resolve; });
  const { adapter, calls } = setup(url => {
    if (url.endsWith('/token')) return json(token);
    dispatched(); return new Promise(() => {});
  });
  const pending = adapter.captureOrder({ orderId: 'ORDER1', requestId: 'capture-1' });
  await reached;
  const rejected = assert.rejects(pending, error => error.code === 'paypal_timeout' && error.outcomeUnknown);
  t.mock.timers.tick(10_000);
  await rejected;
  assert.equal(calls.length, 2);
  assert.equal(calls[1].signal.aborted, true);
});

test('webhook checks Sandbox cert origin and forwards exact event and signature for remote verification', async () => {
  let success = true;
  const { adapter, calls } = setup(url => json(url.endsWith('/token') ? token : { verification_status: success ? 'SUCCESS' : 'FAILURE' }));
  const headers = { 'PayPal-Auth-Algo': 'SHA256withRSA', 'PayPal-Cert-Url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT1', 'PayPal-Transmission-Id': 'TRANSMISSION1', 'PayPal-Transmission-Sig': 'signature', 'PayPal-Transmission-Time': '2026-11-02T00:00:00Z' };
  const body = { id: 'EVENT1', event_type: 'PAYMENT.CAPTURE.COMPLETED' };
  assert.equal(await adapter.verifyWebhook({ headers, body, webhookId: 'WEBHOOK1' }), true);
  const posted = JSON.parse(calls[1].body);
  assert.deepEqual(posted.webhook_event, body); assert.equal(posted.webhook_id, 'WEBHOOK1');
  assert.equal(posted.transmission_sig, 'signature');
  success = false;
  const rawBody = '{ "id" : "EVENT1",\n  "event_type": "PAYMENT.CAPTURE.COMPLETED" }';
  assert.equal(await adapter.verifyWebhook({ headers, body: rawBody, webhookId: 'WEBHOOK1' }), false);
  assert.ok(calls[2].body.endsWith('"webhook_event":' + rawBody + '}'));
  headers['PayPal-Cert-Url'] = 'https://attacker.test/cert';
  assert.equal(await adapter.verifyWebhook({ headers, body, webhookId: 'WEBHOOK1' }), false);
  assert.equal(calls.length, 3);
});

test('missing signature metadata fails authentication without OAuth or verifier traffic',async()=>{
  const {adapter,calls}=setup(()=>{throw new Error('must not dispatch');});
  const headers={'paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.sandbox.paypal.com/v1/notifications/certs/CERT1',
    'paypal-transmission-id':'TX1','paypal-transmission-sig':'signature','paypal-transmission-time':'2026-11-02T00:00:00Z'};
  for(const key of Object.keys(headers)){
    const incomplete={...headers};delete incomplete[key];
    assert.equal(await adapter.verifyWebhook({headers:incomplete,body:{id:'EVENT1'},webhookId:'WEBHOOK1'}),false);
  }
  assert.equal(calls.length,0);
});

test('invalid price/currency/path/request IDs fail before HTTP', async () => {
  const { adapter, calls } = setup(() => { throw new Error('must not fetch'); });
  for (const change of [{ amountMinor: 1.5 }, { amountMinor: -1 }, { amountMinor: Number.MAX_SAFE_INTEGER + 1 }, { currency: 'EUR' }, { requestId: '' }, { returnUrl: 'http://attacker.test' }]) await assert.rejects(adapter.createOrder({ ...input, ...change }), PayPalError);
  await assert.rejects(adapter.getOrder('../OTHER'), PayPalError);
  assert.equal(calls.length, 0);
});

test('batch success requires every recipient success and complete pagination',async()=>{
  const data={batch_header:{payout_batch_id:'BATCH1',batch_status:'SUCCESS',sender_batch_header:{sender_batch_id:'LOCAL1'}},total_items:2,total_pages:1,
    items:[{payout_item_id:'ITEM1',transaction_status:'SUCCESS'},{payout_item_id:'ITEM2',transaction_status:'UNCLAIMED'}]};
  const {adapter,calls}=setup(url=>json(url.endsWith('/token')?token:data));
  assert.equal((await adapter.getPayout('BATCH1')).status,'ITEMS_NEED_REVIEW');
  data.items[1].transaction_status='SUCCESS';assert.equal((await adapter.getPayout('BATCH1')).status,'SUCCESS');
  data.total_pages=2;assert.equal((await adapter.getPayout('BATCH1')).status,'ITEMS_NEED_REVIEW');
  data.total_pages=1;data.total_items=3;assert.equal((await adapter.getPayout('BATCH1')).status,'ITEMS_NEED_REVIEW');
  data.total_items=2;data.items[1].payout_item_id='ITEM1';assert.equal((await adapter.getPayout('BATCH1')).status,'ITEMS_NEED_REVIEW');
  assert.match(calls[1].url,/page_size=1000&total_required=true/);
});
