import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { createCommerceHandler } from '../api/commerce/handler.mjs';
import { createCommerceService } from '../api/commerce/service.mjs';
import { createPayPalSandbox } from '../api/commerce/paypal.mjs';
import { COMMERCE_CATALOG } from '../api/commerce/catalog.mjs';
import { Problem } from '../api/http.mjs';
import { CONCIERGE_TOOLS, createConcierge, createConciergeModel } from '../broadcast/concierge.mjs';
import { conciergeFromEnvironment, createBroadcastDemo } from '../scripts/broadcast-demo.mjs';
import { commerceDatabase } from './helpers/commerce-database.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'https://console.example.test';
const MERCHANT = 'SANDBOXMERCHANT';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FIVE_TOOLS = ['get_credit_balance', 'get_broadcast_prices', 'quote_broadcast', 'create_topup_checkout', 'confirm_topup'];
const STOP_SENTENCE = 'I stopped after several steps. Check the console, then tell me how to continue.';
const FOUR = ['kuma', 'yume', 'bravow', 'beotim'];

// Responses API items. Function call ids are unique per call so a test can find the matching output.
let sequence = 0;
const fnCall = (name, args = {}, raw = JSON.stringify(args)) => { const n = ++sequence; return { type: 'function_call', id: `fc_${n}`, call_id: `call_${n}`, name, arguments: raw }; };
const say = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const problem = (status, code) => error => {
  assert.ok(error instanceof Problem, `expected a Problem, got ${error}`);
  assert.equal(error.status, status);
  assert.equal(error.message, code);
  return true;
};
/** The function_call_output the model was shown for one call, parsed; `raw` is exactly what it saw. */
function shown(input, callId) {
  const item = input.find(entry => entry.type === 'function_call_output' && entry.call_id === callId);
  assert.ok(item, `no function_call_output for ${callId}`);
  return { raw: item.output, ...JSON.parse(item.output) };
}

/** The only fake model boundary: each step is a list of output items, or a function returning one (it may throw or wait).
 * Every call records a snapshot of the input it received, so assertions see what the model saw at that moment. */
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

/** Real ledger SQL, real commerce service and real PayPal Sandbox adapter; the only fake is the PayPal HTTP boundary (create -> approve -> capture). */
async function fixture(t, options = {}, { paypal: withPayPal = true, now: serviceNow } = {}) {
  const database = await commerceDatabase();
  t.after(() => database.db.close());
  const orders = new Map(), paypalCalls = [];
  let failOrder = false;
  const paypal = createPayPalSandbox({ clientId: 'fixture-client', clientSecret: 'fixture-secret', merchantId: MERCHANT,
    fetch: async (url, init) => {
      assert.equal(new URL(url).origin, 'https://api-m.sandbox.paypal.com');
      const path = new URL(url).pathname, body = init.body && init.body !== 'grant_type=client_credentials' ? JSON.parse(init.body) : null;
      paypalCalls.push({ path, method: init.method, body, requestId: new Headers(init.headers).get('paypal-request-id') });
      const json = data => new Response(JSON.stringify(data));
      if (path === '/v1/oauth2/token') return json({ access_token: 'fixture-token', token_type: 'Bearer', expires_in: 3600 });
      if (path === '/v2/checkout/orders' && init.method === 'POST') {
        if (failOrder) { failOrder = false; return new Response('{}', { status: 500 }); }
        const id = `ORDER${orders.size + 1}`;
        const order = { id, intent: body.intent, status: 'CREATED', purchase_units: structuredClone(body.purchase_units),
          links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] };
        orders.set(id, order); return json(order);
      }
      const match = path.match(/^\/v2\/checkout\/orders\/([A-Z0-9]+)(\/capture)?$/);
      assert.ok(match, `unexpected PayPal request ${path}`);
      const order = orders.get(match[1]); assert.ok(order);
      if (match[2]) {
        order.status = 'COMPLETED';
        order.purchase_units[0].payments = { captures: [{ id: `CAPTURE${order.id}`, status: 'COMPLETED', final_capture: true, amount: structuredClone(order.purchase_units[0].amount) }] };
      }
      return json(order);
    } });
  const service = createCommerceService({ store: database.store, paypal: withPayPal ? paypal : null, merchantId: MERCHANT, publicOrigin: ORIGIN, hosts: [{ id: 'current-pc' }], now: serviceNow });
  for (const owner of [OWNER, OTHER]) {
    const topup = await database.store.createTopup(owner, { requestKey: 'fixture-funding', amountCents: 1000, credits: 1000, currency: 'USD' });
    await database.store.attachOrder(owner, topup.id, `ORDER-${owner}`);
    await database.store.creditCapture(owner, topup.id, { providerOrderId: `ORDER-${owner}`, captureId: `CAPTURE-${owner}`, amountCents: 1000, currency: 'USD', status: 'COMPLETED' });
  }
  const model = scriptedModel();
  const concierge = createConcierge({ service, modelCall: model.call, ...options });
  const count = async (table, where = '') => (await database.db.query(`select count(*)::int as n from commerce.${table} ${where}`)).rows[0].n;
  return { ...database, service, model, concierge, orders, paypalCalls, count, failNextOrder: () => { failOrder = true; },
    createOrders: () => paypalCalls.filter(call => call.path === '/v2/checkout/orders' && call.method === 'POST').length,
    captures: () => paypalCalls.filter(call => call.path.endsWith('/capture')).length,
    /** The buyer approves on PayPal: the fake order moves to APPROVED. */
    approve: intentId => { const order = [...orders.values()].find(item => item.purchase_units[0].reference_id === intentId); assert.ok(order, 'no order for that intent'); order.status = 'APPROVED'; return order; },
    /** PayPal finished the capture outside the conversation (the buyer approved and the order completed). */
    complete: intentId => { const order = [...orders.values()].find(item => item.purchase_units[0].reference_id === intentId); assert.ok(order); order.status = 'COMPLETED';
      order.purchase_units[0].payments = { captures: [{ id: `CAPTURE${order.id}`, status: 'COMPLETED', final_capture: true, amount: structuredClone(order.purchase_units[0].amount) }] }; },
    orderOf: intentId => [...orders.values()].find(item => item.purchase_units[0].reference_id === intentId),
    balances: async (owner = OWNER) => { const wallet = await database.store.wallet(owner); return { balanceCredits: wallet.balanceCredits, reservedCredits: wallet.reservedCredits, availableCredits: wallet.availableCredits }; },
    /** Scripts a turn and runs it. */
    async say(owner, message, steps, conversationId) { model.script(...steps); return concierge.turn(owner, { message, ...(conversationId ? { conversationId } : {}) }); },
  };
}
const noSessions = async f => { for (const table of ['approvals', 'broadcasts', 'jobs']) assert.equal(await f.count(table), 0, `commerce.${table} must stay empty`); assert.equal(await f.count('ledger', "where kind in ('reserve','spend')"), 0); };

// 1
test('agent checkout link: the page gets the PayPal approval URL, the model never sees it, the wallet is untouched', async t => {
  const f = await fixture(t);
  const before = await f.balances();
  assert.deepEqual(before, { balanceCredits: 1000, reservedCredits: 0, availableCredits: 1000 });
  const balance = fnCall('get_credit_balance'), checkout = fnCall('create_topup_checkout', { productId: 'sandbox-1000' });
  const result = await f.say(OWNER, 'I want a one-hour show with 1500 credits', [[balance], [checkout], [say('You are 500 credits short. Approve the 1,000-credit pack on PayPal.')]]);

  assert.match(result.conversationId, UUID);
  assert.equal(result.reply, 'You are 500 credits short. Approve the 1,000-credit pack on PayPal.');
  assert.deepEqual(result.toolCalls, [{ name: 'get_credit_balance', ok: true }, { name: 'create_topup_checkout', ok: true }]);
  assert.equal(result.actions.length, 1);
  const [action] = result.actions;
  assert.equal(action.type, 'checkout');
  assert.match(action.intentId, UUID);
  assert.equal(action.approvalUrl, 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1');
  assert.equal(f.createOrders(), 1);
  // The checkout is the server's price for the pack, bound to this intent, not anything the model could name.
  const order = f.orderOf(action.intentId);
  assert.equal(order.id, 'ORDER1');
  assert.deepEqual(order.purchase_units[0].amount, { currency_code: 'USD', value: '10.00' });
  assert.equal((await f.store.findTopup(OWNER, action.intentId)).status, 'ordered');

  assert.equal(f.model.calls.length, 3);
  assert.deepEqual(shown(f.model.calls[1].input, balance.call_id), { raw: JSON.stringify({ ok: true, wallet: { balanceCredits: 1000, reservedCredits: 0, availableCredits: 1000, spendingBlocked: false } }),
    ok: true, wallet: { balanceCredits: 1000, reservedCredits: 0, availableCredits: 1000, spendingBlocked: false } });
  const output = shown(f.model.calls[2].input, checkout.call_id);
  assert.deepEqual({ ok: output.ok, checkout: output.checkout }, { ok: true, checkout: { intentId: action.intentId, status: 'ordered', payPalButtonShown: true } });
  assert.equal(Object.hasOwn(output.checkout, 'approvalUrl'), false);
  // Nothing in any request to the model carries the link.
  for (const { input } of f.model.calls) {
    const text = JSON.stringify(input);
    assert.equal(text.includes(action.approvalUrl), false);
    assert.equal(text.includes('checkoutnow'), false);
    assert.equal(text.includes('approvalUrl'), false);
  }
  assert.deepEqual(await f.balances(), before, 'a checkout moves no credits');
  assert.equal(await f.count('ledger', "where kind='topup'"), 2, 'only the two fixture fundings are in the ledger');
  await noSessions(f);
});

// 2
test('idempotent checkout: one credit pack per conversation is one PayPal order, across steps and later turns', async t => {
  const f = await fixture(t);
  const first = fnCall('create_topup_checkout', { productId: 'sandbox-1000' }), again = fnCall('create_topup_checkout', { productId: 'sandbox-1000' });
  const one = await f.say(OWNER, 'top up please', [[first], [again], [say('done')]]);
  const intents = new Set(one.actions.map(action => action.intentId));
  assert.equal(intents.size, 1, 'repeating the call in one turn returns the same intent');
  const intentId = [...intents][0];
  assert.equal(shown(f.model.calls[2].input, first.call_id).checkout.intentId, intentId);
  assert.equal(shown(f.model.calls[2].input, again.call_id).checkout.intentId, intentId);
  assert.ok(one.actions.every(action => action.type === 'checkout' && action.approvalUrl === 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1'));
  assert.equal(f.createOrders(), 1);

  const later = await f.say(OWNER, 'did you make the link?', [[fnCall('create_topup_checkout', { productId: 'sandbox-1000' })], [say('here')]], one.conversationId);
  assert.equal(later.conversationId, one.conversationId);
  assert.equal(later.actions.length, 1);
  assert.equal(later.actions[0].intentId, intentId);
  assert.equal(later.actions[0].approvalUrl, 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1');
  assert.equal(f.createOrders(), 1, 'a later turn must not create a second PayPal order');
  assert.equal(await f.count('topups', "where owner='" + OWNER + "' and request_key<>'fixture-funding'"), 1);

  // The key is per credit pack and per conversation.
  const other = await f.say(OWNER, 'and the Series pack', [[fnCall('create_topup_checkout', { productId: 'studio-series-5000' })], [say('ok')]], one.conversationId);
  assert.notEqual(other.actions[0].intentId, intentId);
  assert.deepEqual(f.orderOf(other.actions[0].intentId).purchase_units[0].amount, { currency_code: 'USD', value: '50.00' });
  assert.equal(f.createOrders(), 2);
  const fresh = await f.say(OWNER, 'a new chat', [[fnCall('create_topup_checkout', { productId: 'sandbox-1000' })], [say('ok')]]);
  assert.notEqual(fresh.conversationId, one.conversationId);
  assert.notEqual(fresh.actions[0].intentId, intentId);
  assert.equal(f.createOrders(), 3);
  assert.deepEqual(await f.balances(), { balanceCredits: 1000, reservedCredits: 0, availableCredits: 1000 });
});

// 3
test('confirm_topup credits only an approved PayPal order, once, and a credited pack gets a new checkout next time', async t => {
  const f = await fixture(t);
  const made = await f.say(OWNER, 'top up', [[fnCall('create_topup_checkout', { productId: 'sandbox-1000' })], [say('approve it on PayPal')]]);
  const conversationId = made.conversationId, intentId = made.actions[0].intentId;
  const before = await f.balances();

  // Before the buyer approves: refused, nothing credited, nothing captured.
  const early = fnCall('confirm_topup', { intentId });
  const refused = await f.say(OWNER, 'I approved', [[early], [say('not yet')]], conversationId);
  assert.deepEqual(shown(f.model.calls.at(-1).input, early.call_id), { raw: JSON.stringify({ ok: false, code: 'paypal-approval-required' }), ok: false, code: 'paypal-approval-required' });
  assert.deepEqual(refused.toolCalls, [{ name: 'confirm_topup', ok: false, code: 'paypal-approval-required' }]);
  assert.deepEqual(refused.actions, []);
  assert.deepEqual(await f.balances(), before);
  assert.equal(f.captures(), 0);

  // The buyer approves on PayPal: the capture is verified and credited.
  f.approve(intentId);
  const approved = fnCall('confirm_topup', { intentId });
  const credited = await f.say(OWNER, 'now I approved', [[approved], [say('credited')]], conversationId);
  const output = shown(f.model.calls.at(-1).input, approved.call_id);
  assert.deepEqual({ ok: output.ok, topup: output.topup }, { ok: true, topup: { intentId, status: 'credited', credits: 1000 } });
  assert.deepEqual(credited.actions, [{ type: 'topup', intentId, status: 'credited' }]);
  assert.deepEqual(await f.balances(), { balanceCredits: before.balanceCredits + 1000, reservedCredits: 0, availableCredits: before.availableCredits + 1000 });
  assert.equal(f.captures(), 1);
  assert.equal(await f.count('ledger', "where kind='topup'"), 3);

  // Confirming again is a replay, never a second credit or a second capture.
  const replay = fnCall('confirm_topup', { intentId });
  await f.say(OWNER, 'confirm again', [[replay], [say('already credited')]], conversationId);
  assert.equal(shown(f.model.calls.at(-1).input, replay.call_id).topup.status, 'credited');
  assert.equal((await f.balances()).balanceCredits, 2000);
  assert.equal(f.captures(), 1);
  assert.equal(await f.count('ledger', "where kind='topup'"), 3);

  // The credited checkout is retired: the same pack in the same conversation is a new order and a new intent.
  const next = await f.say(OWNER, 'another 1000', [[fnCall('create_topup_checkout', { productId: 'sandbox-1000' })], [say('new link')]], conversationId);
  assert.equal(next.actions.length, 1);
  assert.notEqual(next.actions[0].intentId, intentId);
  assert.equal(next.actions[0].approvalUrl, 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER2');
  assert.equal(f.createOrders(), 2);
  assert.equal((await f.balances()).balanceCredits, 2000, 'a new checkout still moves no credits');
});

// 4
test('a checkout that finds its order already captured is credited once and its key is retired', async t => {
  const f = await fixture(t);
  const made = await f.say(OWNER, 'top up', [[fnCall('create_topup_checkout', { productId: 'sandbox-1000' })], [say('link')]]);
  const intentId = made.actions[0].intentId;
  f.complete(intentId);
  const again = fnCall('create_topup_checkout', { productId: 'sandbox-1000' });
  const credited = await f.say(OWNER, 'again', [[again], [say('credited')]], made.conversationId);
  const output = shown(f.model.calls.at(-1).input, again.call_id);
  assert.deepEqual({ ok: output.ok, checkout: output.checkout }, { ok: true, checkout: { intentId, status: 'credited', payPalButtonShown: false } });
  assert.deepEqual(credited.actions, [], 'there is no PayPal button for a checkout that is already paid');
  assert.equal((await f.balances()).balanceCredits, 2000);
  const next = await f.say(OWNER, 'one more', [[fnCall('create_topup_checkout', { productId: 'sandbox-1000' })], [say('new link')]], made.conversationId);
  assert.equal(next.actions.length, 1);
  assert.notEqual(next.actions[0].intentId, intentId);
  assert.equal(next.actions[0].approvalUrl, 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER2');
  assert.equal(f.createOrders(), 2);
  assert.equal((await f.balances()).balanceCredits, 2000, 'credited exactly once');
  assert.equal(await f.count('ledger', "where kind='topup'"), 3);
});

test('the concierge has no approval or start power: those tools are refused, quote_broadcast approves nothing', async t => {
  const f = await fixture(t);
  const before = await f.balances();
  const calls = [fnCall('approve_budget', { confirmed: true, requestKey: '33333333-3333-4333-8333-333333333333', hostId: 'current-pc', channelId: 'x', maxCredits: 100, fighterIds: FOUR }),
    fnCall('start_broadcast', { approvalId: '33333333-3333-4333-8333-333333333333' }), fnCall('host_cup', { fighterIds: FOUR }), fnCall('stop_broadcast', {}), fnCall('toString', {})];
  const result = await f.say(OWNER, 'start the show for me', [calls, [say('I cannot; approve it in the console.')]]);
  for (const call of calls) assert.deepEqual(shown(f.model.calls[1].input, call.call_id), { raw: JSON.stringify({ ok: false, code: 'tool-not-allowed' }), ok: false, code: 'tool-not-allowed' });
  assert.deepEqual(result.toolCalls, calls.map(call => ({ name: call.name, ok: false, code: 'tool-not-allowed' })));
  assert.deepEqual(result.actions, []);
  assert.deepEqual(await f.balances(), before);
  await noSessions(f);

  const quote = fnCall('quote_broadcast', { hostId: 'current-pc', channelId: 'Friday cup', durationMinutes: 60, maxCredits: 100, fighterIds: FOUR });
  const startedAt = Date.now();
  const planned = await f.say(OWNER, 'quote one hour', [[quote], [say('Review and approve it in the console.')]], result.conversationId);
  assert.deepEqual(planned.actions, [{ type: 'plan', hostId: 'current-pc', channelId: 'Friday cup', durationMinutes: 60, maxCredits: 100, fighterIds: FOUR, cupCredits: 25, maxCups: 4 }]);
  const output = shown(f.model.calls.at(-1).input, quote.call_id);
  assert.equal(output.ok, true);
  assert.equal(output.quote.approved, false);
  const endsAt = Date.parse(output.quote.endsAt);
  assert.ok(endsAt >= startedAt + 3_599_000 && endsAt <= Date.now() + 3_600_000, `a 60 minute plan ends 60 minutes from now, not ${output.quote.endsAt}`);
  assert.deepEqual(await f.balances(), before);
  await noSessions(f);

  // The model is offered exactly these five tools, and none lets it name an owner, price, request key or confirmation.
  const tools = f.model.calls[0].tools;
  assert.deepEqual(tools.map(tool => tool.name), FIVE_TOOLS);
  assert.deepEqual([...CONCIERGE_TOOLS], FIVE_TOOLS);
  assert.ok(tools.every(tool => tool.type === 'function' && tool.strict === true && tool.parameters.additionalProperties === false));
  assert.deepEqual(tools.find(tool => tool.name === 'create_topup_checkout').parameters.properties.productId.enum, COMMERCE_CATALOG.products.filter(product=>!product.operatorOnly).map(product => product.id));
  const names = new Set(tools.flatMap(tool => Object.keys(tool.parameters.properties)));
  for (const forbidden of ['owner', 'requestKey', 'approvalId', 'confirmed', 'amountCents', 'credits', 'priceCredits', 'approvalUrl']) assert.equal(names.has(forbidden), false, `${forbidden} must not be a tool argument`);
});

test('quote_broadcast and tool arguments fail as data the model can read, never as a plan or a crash', async t => {
  const f = await fixture(t);
  const plan = (over = {}) => ({ hostId: 'current-pc', channelId: 'Friday cup', durationMinutes: 60, maxCredits: 100, fighterIds: FOUR, ...over });
  const cases = [
    [fnCall('quote_broadcast', plan({ durationMinutes: 5 })), 'invalid-duration'], [fnCall('quote_broadcast', plan({ durationMinutes: 1441 })), 'invalid-duration'],
    [fnCall('quote_broadcast', plan({ durationMinutes: 60.5 })), 'invalid-duration'], [fnCall('quote_broadcast', plan({ durationMinutes: '60' })), 'invalid-duration'],
    [fnCall('quote_broadcast', plan({ hostId: 'nowhere' })), 'unknown-host'], [fnCall('quote_broadcast', plan({ maxCredits: 24 })), 'invalid-budget'],
    [fnCall('quote_broadcast', plan({ fighterIds: ['kuma', 'yume', 'bravow'] })), 'invalid-fighters'], [fnCall('quote_broadcast', plan({ channelId: 'bad/channel' })), 'invalid-channel'],
    [fnCall('create_topup_checkout', { productId: 'sandbox-1' }), 'unknown-product'], [fnCall('create_topup_checkout', {}), 'unknown-product'],
    [fnCall('confirm_topup', { intentId: 'not-a-uuid' }), 'invalid-intent'], [fnCall('confirm_topup', {}), 'invalid-intent'],
    [fnCall('get_credit_balance', {}, 'not json'), 'invalid-arguments'], [fnCall('get_credit_balance', {}, '[]'), 'invalid-arguments'], [fnCall('confirm_topup', {}, 'null'), 'invalid-arguments'],
  ];
  const result = await f.say(OWNER, 'try bad arguments', [cases.map(([call]) => call), [say('sorry')]]);
  for (const [call, code] of cases) assert.deepEqual(shown(f.model.calls[1].input, call.call_id), { raw: JSON.stringify({ ok: false, code }), ok: false, code }, `${call.name} ${call.arguments}`);
  assert.deepEqual(result.actions, [], 'a failed quote must not produce a plan for the page');
  assert.equal(f.createOrders(), 0);
  await noSessions(f);

  // Prices come from the server's price book.
  const prices = fnCall('get_broadcast_prices');
  await f.say(OWNER, 'what does it cost', [[prices], [say('see tool')]], result.conversationId);
  const output = shown(f.model.calls.at(-1).input, prices.call_id);
  assert.equal(output.ok, true);
  assert.equal(output.prices.version, COMMERCE_CATALOG.version);
  assert.deepEqual(output.prices.creditPacks.map(pack => [pack.productId, pack.credits, pack.priceCents]), COMMERCE_CATALOG.products.filter(pack=>!pack.operatorOnly).map(pack => [pack.id, pack.credits, pack.amountCents]));
  assert.equal(output.prices.cupCredits, 25);
  assert.deepEqual(output.prices.hosts, ['current-pc']);
  assert.deepEqual(output.prices.fighters, COMMERCE_CATALOG.fighters);
  assert.equal(output.prices.paypalConfigured, true);
});

test('quote_broadcast accepts the 10 and 1440 minute limits, and PayPal trouble is data the model can read', async t => {
  const f = await fixture(t);
  const plan = minutes => ({ hostId: 'current-pc', channelId: 'edge', durationMinutes: minutes, maxCredits: 25, fighterIds: FOUR });
  const edges = await f.say(OWNER, 'edge plans', [[fnCall('quote_broadcast', plan(10)), fnCall('quote_broadcast', plan(1440))], [say('planned')]]);
  assert.deepEqual(edges.actions.map(action => [action.type, action.durationMinutes, action.maxCups]), [['plan', 10, 1], ['plan', 1440, 1]]);

  // A PayPal order that failed to be created is a coded failure, retried under the same intent and PayPal request id.
  f.failNextOrder();
  const first = fnCall('create_topup_checkout', { productId: 'sandbox-1000' });
  const failed = await f.say(OWNER, 'top up', [[first], [say('PayPal failed')]], edges.conversationId);
  assert.deepEqual(shown(f.model.calls.at(-1).input, first.call_id), { raw: JSON.stringify({ ok: false, code: 'paypal_http_error' }), ok: false, code: 'paypal_http_error' });
  assert.deepEqual(failed.actions, []);
  assert.deepEqual(failed.toolCalls, [{ name: 'create_topup_checkout', ok: false, code: 'paypal_http_error' }]);
  assert.equal(f.orders.size, 0);
  const retry = await f.say(OWNER, 'try again', [[fnCall('create_topup_checkout', { productId: 'sandbox-1000' })], [say('link')]], edges.conversationId);
  assert.equal(retry.actions.length, 1);
  assert.equal(retry.actions[0].approvalUrl, 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1');
  const attempts = f.paypalCalls.filter(call => call.path === '/v2/checkout/orders' && call.method === 'POST');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].requestId, `o-${retry.actions[0].intentId}`);
  assert.equal(attempts[1].requestId, attempts[0].requestId, 'the retry carries the same PayPal-Request-Id');
  assert.equal(f.orders.size, 1);
  await noSessions(f);
});

test('without PayPal configured the concierge reports it and creates nothing', async t => {
  const f = await fixture(t, {}, { paypal: false });
  const prices = fnCall('get_broadcast_prices'), checkout = fnCall('create_topup_checkout', { productId: 'sandbox-1000' }), confirm = fnCall('confirm_topup', { intentId: '55555555-5555-4555-8555-555555555555' });
  const result = await f.say(OWNER, 'top up', [[prices, checkout, confirm], [say('PayPal is not configured')]]);
  assert.equal(shown(f.model.calls[1].input, prices.call_id).prices.paypalConfigured, false);
  assert.equal(shown(f.model.calls[1].input, checkout.call_id).code, 'paypal-not-configured');
  assert.equal(shown(f.model.calls[1].input, confirm.call_id).code, 'not-found');
  assert.deepEqual(result.actions, []);
  assert.equal(f.paypalCalls.length, 0);
  assert.deepEqual(await f.balances(), { balanceCredits: 1000, reservedCredits: 0, availableCredits: 1000 });
});

// 5
test('ownership: a conversation and its checkout belong to one account', async t => {
  const f = await fixture(t);
  const mine = await f.say(OWNER, 'hello', [[say('hi owner')]]);
  const calls = f.model.calls.length;
  for (const id of [mine.conversationId, mine.conversationId.toUpperCase()]) {
    await assert.rejects(f.concierge.turn(OTHER, { conversationId: id, message: 'let me in' }), problem(404, 'not-found'));
  }
  assert.equal(f.model.calls.length, calls, 'a refused turn never reaches the model');
  await f.say(OWNER, 'still here', [[say('yes')]], mine.conversationId);
  assert.equal(JSON.stringify(f.model.calls.at(-1).input).includes('let me in'), false, 'the intruder message is not in the owner transcript');

  const ownerIntent = (await f.say(OWNER, 'top up', [[fnCall('create_topup_checkout', { productId: 'sandbox-1000' })], [say('link')]], mine.conversationId)).actions[0].intentId;
  const theirs = await f.say(OTHER, 'top up', [[fnCall('create_topup_checkout', { productId: 'sandbox-1000' })], [say('link')]]);
  const otherIntent = theirs.actions[0].intentId;
  assert.notEqual(otherIntent, ownerIntent);
  f.approve(ownerIntent); f.approve(otherIntent);
  const before = { owner: await f.balances(OWNER), other: await f.balances(OTHER) };

  // Each side tries to confirm the other's approved checkout from its own conversation.
  const stolen = fnCall('confirm_topup', { intentId: otherIntent }), reverse = fnCall('confirm_topup', { intentId: ownerIntent });
  const attempt = await f.say(OWNER, 'confirm theirs', [[stolen], [say('no')]], mine.conversationId);
  assert.deepEqual(shown(f.model.calls.at(-1).input, stolen.call_id), { raw: JSON.stringify({ ok: false, code: 'not-found' }), ok: false, code: 'not-found' });
  assert.deepEqual(attempt.toolCalls, [{ name: 'confirm_topup', ok: false, code: 'not-found' }]);
  assert.deepEqual(attempt.actions, []);
  await f.say(OTHER, 'confirm theirs', [[reverse], [say('no')]], theirs.conversationId);
  assert.deepEqual(shown(f.model.calls.at(-1).input, reverse.call_id), { raw: JSON.stringify({ ok: false, code: 'not-found' }), ok: false, code: 'not-found' });
  assert.deepEqual({ owner: await f.balances(OWNER), other: await f.balances(OTHER) }, before);
  assert.equal(f.captures(), 0, 'no PayPal capture is attempted for an intent the caller does not own');
  assert.equal(f.orderOf(otherIntent).status, 'APPROVED');
  assert.equal((await f.store.findTopup(OTHER, otherIntent)).status, 'ordered');

  // Each owner still captures only their own approved order, once.
  await f.say(OWNER, 'confirm mine', [[fnCall('confirm_topup', { intentId: ownerIntent })], [say('ok')]], mine.conversationId);
  assert.deepEqual({ owner: (await f.balances(OWNER)).balanceCredits, other: (await f.balances(OTHER)).balanceCredits }, { owner: 2000, other: 1000 });
});

// 6
test('a failed model call is a 503 with no detail and leaves the transcript as it was', async t => {
  const f = await fixture(t);
  const first = await f.say(OWNER, 'first', [[say('hello')]]);
  const doomed = fnCall('get_credit_balance');
  f.model.script([doomed], () => { throw new Error('upstream said: key sk-secret-123 rejected'); });
  const failure = await f.concierge.turn(OWNER, { conversationId: first.conversationId, message: 'doomed message' }).then(() => assert.fail('must reject'), error => error);
  problem(503, 'concierge-model-unavailable')(failure);
  assert.equal(JSON.stringify([failure.message, failure.errors]).includes('sk-secret'), false);
  assert.equal(f.model.calls.length, 3);

  // The next turn is not blocked, and replays neither the failed message nor its half-finished tool exchange.
  const next = await f.say(OWNER, 'third', [[say('ok')]], first.conversationId);
  assert.equal(next.reply, 'ok');
  assert.deepEqual(f.model.calls.at(-1).input.slice(1), [{ role: 'user', content: 'first' }, say('hello'), { role: 'user', content: 'third' }]);
  assert.equal(f.model.calls.at(-1).input[0].role, 'developer');
});

test('an unknown checkout stays on its original intent after the replay window instead of creating another purchase', async t => {
  let clock = Date.now();
  const f = await fixture(t, {}, { now: () => clock });
  f.failNextOrder();
  const failed = await f.say(OWNER, 'top up', [[fnCall('create_topup_checkout', { productId: 'sandbox-1000' })], [say('PayPal failed')]]);
  assert.deepEqual(failed.toolCalls, [{ name: 'create_topup_checkout', ok: false, code: 'paypal_http_error' }]);
  clock += 6 * 60_000;
  const stuck = await f.say(OWNER, 'again', [[fnCall('create_topup_checkout', { productId: 'sandbox-1000' })], [say('needs reconciliation')]], failed.conversationId);
  assert.deepEqual(stuck.toolCalls, [{ name: 'create_topup_checkout', ok: false, code: 'checkout-needs-reconciliation' }]);
  assert.equal(f.orders.size, 0);
  const fresh = await f.say(OWNER, 'once more', [[fnCall('create_topup_checkout', { productId: 'sandbox-1000' })], [fnCall('create_topup_checkout', { productId: 'sandbox-1000' })], [say('link')]], failed.conversationId);
  assert.equal(fresh.actions.length, 0);
  assert.ok(fresh.toolCalls.every(call=>call.code==='checkout-needs-reconciliation'));
  assert.equal(f.orders.size, 0);
  assert.equal(await f.count('topups', `where owner = '${OWNER}' and request_key <> 'fixture-funding'`), 1, 'only the original unknown intent');
});

test('a failed turn after a checkout keeps the checkout key, so the retry reuses the same PayPal order', async t => {
  const f = await fixture(t);
  const made = await f.say(OWNER, 'start chat', [[say('hi')]]);
  f.model.script([fnCall('create_topup_checkout', { productId: 'sandbox-1000' })], () => { throw new Error('boom'); });
  await assert.rejects(f.concierge.turn(OWNER, { conversationId: made.conversationId, message: 'top up' }), problem(503, 'concierge-model-unavailable'));
  assert.equal(f.createOrders(), 1);
  const retry = await f.say(OWNER, 'top up again', [[fnCall('create_topup_checkout', { productId: 'sandbox-1000' })], [say('link')]], made.conversationId);
  assert.equal(f.createOrders(), 1, 'the retry must not create a second order');
  assert.equal(retry.actions[0].approvalUrl, 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1');
});

test('dailyModelCalls bounds the model calls: the second call of a turn is a 429 until the next day', async t => {
  let time = Date.parse('2026-11-03T10:00:00Z');
  const f = await fixture(t, { dailyModelCalls: 1, now: () => time });
  f.model.script([fnCall('get_credit_balance')]); // a second step is never reached
  await assert.rejects(f.concierge.turn(OWNER, { message: 'balance then answer' }), problem(429, 'concierge-daily-limit'));
  assert.equal(f.model.calls.length, 1, 'the second call must be refused before it reaches the model');
  await assert.rejects(f.concierge.turn(OWNER, { message: 'again today' }), problem(429, 'concierge-daily-limit'));
  assert.equal(f.model.calls.length, 1);
  time += 24 * 3_600_000;
  const result = await f.say(OWNER, 'tomorrow', [[say('fresh day')]]);
  assert.equal(result.reply, 'fresh day');
  assert.equal(f.model.calls.length, 2);
});

test('maxSteps bounds a model that only ever calls tools: the reply is the stop sentence', async t => {
  const f = await fixture(t, { maxSteps: 3 });
  const result = await f.say(OWNER, 'loop forever', [[fnCall('get_credit_balance')], [fnCall('get_credit_balance')], [fnCall('get_credit_balance')]]);
  assert.equal(result.reply, STOP_SENTENCE);
  assert.equal(f.model.calls.length, 3, 'never a fourth model call');
  assert.equal(result.toolCalls.length, 3);
  assert.deepEqual(result.actions, []);
  // The turn still completed, so the conversation continues with those tool exchanges in its transcript.
  const next = await f.say(OWNER, 'ok then', [[say('fine')]], result.conversationId);
  assert.equal(next.reply, 'fine');
  assert.equal(f.model.calls.at(-1).input.filter(item => item.type === 'function_call_output').length, 3);
  // A final answer on the last allowed step is a normal reply.
  const last = await f.say(OWNER, 'two steps', [[fnCall('get_credit_balance')], [fnCall('get_credit_balance')], [say('answered at the limit')]]);
  assert.equal(last.reply, 'answered at the limit');
});

test('replies come from output_text only, are trimmed and bounded, and an empty answer is not an empty reply', async t => {
  const f = await fixture(t);
  const long = await f.say(OWNER, 'long', [[{ type: 'reasoning', id: 'rs_1', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '  first part  ' }, { type: 'refusal', refusal: 'hidden' }, { type: 'output_text', text: 'x'.repeat(3000) }] }]]);
  assert.equal(long.reply.length, 2000);
  assert.ok(long.reply.startsWith('first part  \nxxx'));
  assert.equal(long.reply.includes('hidden'), false);
  const silent = await f.say(OWNER, 'silent', [[{ type: 'reasoning', id: 'rs_2', summary: [] }]]);
  assert.equal(silent.reply, '…');
  assert.deepEqual(silent.actions, []);
});

test('a conversation allows one turn at a time: a concurrent turn is a 409 and the first still completes', async t => {
  const f = await fixture(t);
  const start = await f.say(OWNER, 'start', [[say('ready')]]);
  let release; const gate = new Promise(resolve => { release = resolve; });
  f.model.script(async () => { await gate; return [say('slow answer')]; });
  const slow = f.concierge.turn(OWNER, { conversationId: start.conversationId, message: 'slow question' });
  await assert.rejects(f.concierge.turn(OWNER, { conversationId: start.conversationId, message: 'impatient' }), problem(409, 'concierge-busy'));
  await assert.rejects(f.concierge.turn(OWNER, { conversationId: start.conversationId, message: 'impatient again' }), problem(409, 'concierge-busy'), 'a refused turn must not clear the running turn\'s lock');
  assert.equal(f.model.calls.length, 2, 'only the running turn reached the model');
  // Another conversation of the same owner is not blocked.
  const parallel = await f.say(OWNER, 'elsewhere', [[say('fine')]]);
  assert.equal(parallel.reply, 'fine');
  release();
  assert.equal((await slow).reply, 'slow answer');
  const after = await f.say(OWNER, 'after', [[say('free again')]], start.conversationId);
  assert.equal(after.reply, 'free again');
  const sent = JSON.stringify(f.model.calls.at(-1).input);
  assert.equal(sent.includes('impatient'), false);
  assert.ok(sent.includes('slow question'));
});

test('conversation limits: maxTurns is a 409, and an unknown or expired conversation id restarts under a new server-issued id', async t => {
  let time = Date.parse('2026-11-03T10:00:00Z');
  const f = await fixture(t, { maxTurns: 2, now: () => time, ttlMs: 3_600_000 });
  const one = await f.say(OWNER, 'one', [[say('a')]]);
  assert.equal(one.restarted, false);
  await f.say(OWNER, 'two', [[say('b')]], one.conversationId.toUpperCase());
  await assert.rejects(f.concierge.turn(OWNER, { conversationId: one.conversationId, message: 'three' }), problem(409, 'concierge-conversation-full'));

  const guess = '44444444-4444-4444-8444-444444444444';
  const guessed = await f.say(OWNER, 'with an id the server never issued', [[say('c')]], guess);
  assert.equal(guessed.restarted, true);
  assert.notEqual(guessed.conversationId, guess);
  assert.equal(JSON.stringify(f.model.calls.at(-1).input.slice(1)), JSON.stringify([{ role: 'user', content: 'with an id the server never issued' }]));

  time += 3_600_001;
  const expired = await f.say(OWNER, 'after expiry', [[say('d')]], guessed.conversationId);
  assert.equal(expired.restarted, true);
  assert.notEqual(expired.conversationId, guessed.conversationId);
  assert.equal(f.model.calls.at(-1).input.length, 2, 'an expired conversation forgets its transcript');
});

test('the turn timeout aborts a stalled model call as a 503 and frees the conversation', async t => {
  const f = await fixture(t, { turnTimeoutMs: 20 });
  const start = await f.say(OWNER, 'start', [[say('ready')]]);
  f.model.script((_input, _tools, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })));
  const keepAlive = setTimeout(() => {}, 10_000); // AbortSignal.timeout does not keep the process alive; the server does in production
  try { await assert.rejects(f.concierge.turn(OWNER, { conversationId: start.conversationId, message: 'stall' }), problem(503, 'concierge-model-unavailable')); } finally { clearTimeout(keepAlive); }
  assert.ok(f.model.calls.at(-1).signal instanceof AbortSignal);
  assert.equal(f.model.calls.at(-1).signal.aborted, true);
  const after = await f.say(OWNER, 'after', [[say('free')]], start.conversationId);
  assert.equal(after.reply, 'free');
  assert.equal(JSON.stringify(f.model.calls.at(-1).input).includes('stall'), false);
});

test('maxConversations bounds the in-memory conversations: the oldest is dropped and restarts as a new one', async t => {
  const f = await fixture(t, { maxConversations: 2 });
  const a = await f.say(OWNER, 'a', [[say('1')]]), b = await f.say(OWNER, 'b', [[say('2')]]), c = await f.say(OWNER, 'c', [[say('3')]]);
  const again = await f.say(OWNER, 'a again', [[say('4')]], a.conversationId);
  assert.equal(again.restarted, true);
  assert.notEqual(again.conversationId, a.conversationId);
  const kept = await f.say(OWNER, 'c again', [[say('5')]], c.conversationId);
  assert.equal(kept.restarted, false);
  assert.notEqual(b.conversationId, c.conversationId);
});

// 7
test('input validation: bad messages and conversation ids are 422 before any model call', async t => {
  const f = await fixture(t);
  const bad = [
    {}, null, 'hello', [], { message: 5 }, { message: '' }, { message: '   \n\t ' }, { message: 'x'.repeat(1001) },
    { message: 'bell\u0007' }, { message: 'nul\u0000' }, { message: 'esc\u001b[31m' }, { message: 'del\u007f' }, { message: 'vt\u000b' },
    { message: 'hi', conversationId: 'not-a-uuid' }, { message: 'hi', conversationId: 5 }, { message: 'hi', conversationId: null },
    { message: 'hi', conversationId: '11111111-1111-4111-8111-11111111111' }, { message: 'hi', conversationId: `${OWNER} ` }, { message: 'hi', conversationId: '' },
  ];
  for (const body of bad) await assert.rejects(f.concierge.turn(OWNER, body), problem(422, 'invalid-concierge-message'), JSON.stringify(body));
  assert.equal(f.model.calls.length, 0);

  // Boundaries that are valid: exactly 1000 characters, newlines and tabs, and the text is trimmed before the model sees it.
  const edge = await f.say(OWNER, 'x'.repeat(1000), [[say('ok')]]);
  assert.equal(edge.reply, 'ok');
  assert.equal(f.model.calls[0].input[1].content, 'x'.repeat(1000));
  await f.say(OWNER, '  two\nlines\tand a tab  ', [[say('ok')]]);
  assert.deepEqual(f.model.calls[1].input[1], { role: 'user', content: 'two\nlines\tand a tab' });
});

// 8
const KEY = 'sk-test-secret-key-0123456789';
/** The fake Responses API: records each request and answers with the given JSON or Response. */
function responsesApi(answer, { status = 200 } = {}) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    const value = typeof answer === 'function' ? await answer(requests.length, init) : answer;
    return value instanceof Response ? value : new Response(JSON.stringify(value), { status });
  };
  return { fetchImpl, requests };
}
const completed = (over = {}) => ({ status: 'completed', model: 'gpt-test', output: [say('hello')], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, ...over });
const TOOLS = [{ type: 'function', name: 'get_credit_balance', strict: true, parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } }];
const INPUT = [{ role: 'developer', content: 'rules' }, { role: 'user', content: 'hi' }];
const modelWith = (api, over = {}) => createConciergeModel({ model: 'gpt-test', apiKey: KEY, fetchImpl: api.fetchImpl, ...over });
const unavailable = { name: 'Error', message: 'concierge_model_unavailable' };

test('createConciergeModel sends a stateless, single-call, encrypted-reasoning request and keeps only reasoning, function_call and message items', async () => {
  const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'ENC' }, call = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'get_credit_balance', arguments: '{}' };
  const api = responsesApi(completed({ model: 'gpt-test-2026-02-01', output: [reasoning, { type: 'web_search_call', id: 'ws_1' }, call, null, 'text', { type: 'code_interpreter_call' }, say('hello'), { type: 'custom_tool_call' }] }));
  const result = await modelWith(api)(INPUT, TOOLS);
  assert.deepEqual(result.output, [reasoning, call, say('hello')]);
  assert.deepEqual(result.observation, { requestedModel: 'gpt-test', answeredModel: 'gpt-test-2026-02-01', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });

  assert.equal(api.requests.length, 1);
  const [{ url, init, body }] = api.requests;
  assert.equal(url, 'https://api.openai.com/v1/responses');
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'error');
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(init.headers['content-type'], 'application/json');
  assert.deepEqual(body, { model: 'gpt-test', store: false, include: ['reasoning.encrypted_content'], max_output_tokens: 800, parallel_tool_calls: false, tool_choice: 'auto', tools: TOOLS, input: INPUT });
  assert.equal(Object.hasOwn(body, 'previous_response_id'), false);
  assert.equal(JSON.stringify(body).includes(KEY), false, 'the key travels only in the header');

  // Usage is advisory: invalid counters are dropped, not trusted or fatal.
  const odd = await modelWith(responsesApi(completed({ usage: { input_tokens: -1, output_tokens: 1.5, total_tokens: '3' } })))(INPUT, TOOLS);
  assert.deepEqual(odd.observation.usage, {});
  assert.deepEqual((await modelWith(responsesApi(completed({ usage: undefined })))(INPUT, TOOLS)).observation.usage, {});
  assert.equal((await modelWith(responsesApi(completed()), { maxOutputTokens: 256 })(INPUT, TOOLS)).output.length, 1);
});

test('createConciergeModel rejects a different answered model, a non-completed status and malformed items, each as concierge_model_unavailable', async () => {
  const goodCall = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'get_credit_balance', arguments: '{}' };
  const bad = {
    'a different model': completed({ model: 'gpt-other' }), 'a model that only shares a prefix': completed({ model: 'gpt-testing' }), 'no model': completed({ model: undefined }), 'a non-string model': completed({ model: 5 }),
    incomplete: completed({ status: 'incomplete' }), failed: completed({ status: 'failed' }), queued: completed({ status: 'queued' }), 'no status': completed({ status: undefined }),
    'no output array': completed({ output: undefined }), 'output not an array': completed({ output: { type: 'message' } }),
    'function_call without call_id': completed({ output: [{ ...goodCall, call_id: undefined }] }), 'function_call with numeric call_id': completed({ output: [{ ...goodCall, call_id: 7 }] }),
    'function_call without name': completed({ output: [{ ...goodCall, name: undefined }] }), 'function_call with non-string name': completed({ output: [{ ...goodCall, name: ['x'] }] }),
    'function_call with object arguments': completed({ output: [{ ...goodCall, arguments: {} }] }), 'function_call without arguments': completed({ output: [{ ...goodCall, arguments: undefined }] }),
    'function_call with oversized arguments': completed({ output: [{ ...goodCall, arguments: 'x'.repeat(4097) }] }),
    'an oversized response': completed({ output: [say('x'.repeat(600 * 1024))] }),
    'HTTP 500': () => new Response(JSON.stringify(completed()), { status: 500 }), 'HTTP 429': () => new Response('{}', { status: 429 }), 'an empty body': () => new Response(null, { status: 200 }),
    'invalid JSON': () => new Response('not json', { status: 200 }), 'JSON null': () => new Response('null', { status: 200 }),
  };
  for (const [label, answer] of Object.entries(bad)) await assert.rejects(modelWith(responsesApi(answer))(INPUT, TOOLS), unavailable, label);
  // The limits are inclusive, and a dated snapshot of the requested model is the same model.
  const edge = await modelWith(responsesApi(completed({ model: 'gpt-test-2026-02-01', output: [{ ...goodCall, arguments: 'x'.repeat(4096) }] })))(INPUT, TOOLS);
  assert.equal(edge.output[0].arguments.length, 4096);
  assert.equal((await modelWith(responsesApi(completed({ model: 'gpt-test' })))(INPUT, TOOLS)).observation.answeredModel, 'gpt-test');
});

test('createConciergeModel never leaks the API key, the endpoint, the upstream body or the cause in an error', async () => {
  const echoes = {
    'fetch throws with the key': () => { throw new TypeError(`connect failed with Authorization: Bearer ${KEY} to https://api.openai.com/v1/responses`); },
    'HTTP 401 echoing the key': () => new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}` } }), { status: 401 }),
    'a 200 whose model field carries the key': () => new Response(JSON.stringify(completed({ model: KEY })), { status: 200 }),
    'unparsable body with the key': () => new Response(`<html>${KEY}</html>`, { status: 200 }),
  };
  for (const [label, answer] of Object.entries(echoes)) {
    const error = await modelWith(responsesApi(answer))(INPUT, TOOLS).then(() => assert.fail(label), failure => failure);
    assert.equal(error.message, 'concierge_model_unavailable', label);
    assert.equal(error.cause, undefined, label);
    const everything = [error.message, error.stack, String(error), JSON.stringify(error, Object.getOwnPropertyNames(error))].join('\n');
    assert.equal(everything.includes(KEY), false, label);
    assert.equal(everything.includes('openai.com'), false, label);
  }
  // Through the concierge it becomes the 503 Problem, still without the key.
  const concierge = createConcierge({ service: { catalog: () => COMMERCE_CATALOG }, modelCall: modelWith(responsesApi(echoes['HTTP 401 echoing the key'])) });
  const refused = await concierge.turn(OWNER, { message: 'hi' }).then(() => assert.fail('must reject'), failure => failure);
  problem(503, 'concierge-model-unavailable')(refused);
  assert.equal(`${refused.message}${refused.stack}${JSON.stringify(refused.errors)}`.includes(KEY), false);
});

test('createConciergeModel honours the caller signal and its own timeout, and rejects an unusable configuration', async () => {
  const hanging = () => responsesApi((_, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })));
  const controller = new AbortController(), api = hanging();
  const pending = modelWith(api)(INPUT, TOOLS, { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(api.requests[0].init.signal.aborted, false);
  controller.abort();
  await assert.rejects(pending, unavailable);
  assert.equal(api.requests[0].init.signal.aborted, true);
  // AbortSignal.timeout does not keep the process alive; the server does in production, this timer does here.
  const keepAlive = setTimeout(() => {}, 10_000);
  try { await assert.rejects(modelWith(hanging(), { timeoutMs: 20 })(INPUT, TOOLS), unavailable, 'a stalled request ends at its timeout'); } finally { clearTimeout(keepAlive); }

  for (const bad of [{ model: '' }, { model: 'bad model!' }, { model: '-gpt' }, { model: 5 }, { apiKey: '' }, { apiKey: undefined }, { apiKey: 'k'.repeat(4097) },
    { maxOutputTokens: 127 }, { maxOutputTokens: 4097 }, { maxOutputTokens: 1.5 }, { timeoutMs: 0 }, { timeoutMs: 120_001 }]) {
    assert.throws(() => createConciergeModel({ model: 'gpt-test', apiKey: KEY, ...bad }), { message: 'concierge_model_configuration_required' }, JSON.stringify(bad));
  }
});

test('adapter and loop together: encrypted reasoning, the function call and its output are replayed to the model', async t => {
  const f = await fixture(t);
  const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'ENC' };
  const call = { type: 'function_call', id: 'fc_9', call_id: 'call_9', name: 'get_credit_balance', arguments: '{}' };
  const api = responsesApi(count => completed({ output: count === 1 ? [reasoning, call] : [say('You have 1000 credits.')] }));
  const concierge = createConcierge({ service: f.service, modelCall: modelWith(api) });
  const result = await concierge.turn(OWNER, { message: 'what is my balance?' });
  assert.equal(result.reply, 'You have 1000 credits.');
  assert.deepEqual(result.toolCalls, [{ name: 'get_credit_balance', ok: true }]);
  assert.equal(api.requests.length, 2);
  assert.ok(api.requests.every(({ body }) => body.store === false && body.parallel_tool_calls === false && body.tools.length === 5));
  assert.deepEqual(api.requests[0].body.tools.map(tool => tool.name), FIVE_TOOLS);
  const [developer, ...replay] = api.requests[1].body.input;
  assert.equal(developer.role, 'developer');
  assert.deepEqual(replay.slice(0, 3), [{ role: 'user', content: 'what is my balance?' }, reasoning, call]);
  assert.equal(replay[3].type, 'function_call_output');
  assert.equal(replay[3].call_id, 'call_9');
  assert.equal(JSON.parse(replay[3].output).wallet.availableCredits, 1000);
  assert.equal(replay.length, 4);
});

// 9
test('POST /commerce/concierge runs a turn for the authenticated owner and returns its reply, actions and tool calls', async t => {
  const f = await fixture(t);
  const wired = { ...f.service, concierge: (owner, body) => f.concierge.turn(owner, body) };
  let owner = OWNER;
  const person = createCommerceHandler({ service: wired, authenticate: async () => owner, publicOrigin: ORIGIN });
  const post = (handler, body, { origin = ORIGIN, type = 'application/json' } = {}) => handler(new Request(`${ORIGIN}/commerce/concierge`, { method: 'POST',
    headers: { ...(origin ? { origin } : {}), ...(type ? { 'content-type': type } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) }));

  f.model.script([fnCall('get_credit_balance')], [fnCall('create_topup_checkout', { productId: 'sandbox-1000' })], [say('Approve the pack on PayPal.')]);
  const response = await post(person, { message: 'I want 1500 credits of show' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.match(body.data.conversationId, UUID);
  assert.equal(body.data.reply, 'Approve the pack on PayPal.');
  assert.equal(body.data.restarted, false);
  assert.deepEqual(body.data.toolCalls, [{ name: 'get_credit_balance', ok: true }, { name: 'create_topup_checkout', ok: true }]);
  assert.equal(body.data.actions.length, 1);
  assert.equal(body.data.actions[0].type, 'checkout');
  assert.equal(body.data.actions[0].approvalUrl, 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1');
  assert.deepEqual(await f.balances(), { balanceCredits: 1000, reservedCredits: 0, availableCredits: 1000 });

  // Problems keep their status and code; nothing else leaks.
  f.model.script([say('continued')]);
  assert.equal((await (await post(person, { conversationId: body.data.conversationId, message: 'again' })).json()).data.conversationId, body.data.conversationId);
  const invalid = await post(person, { message: '' });
  assert.deepEqual([invalid.status, await invalid.json()], [422, { ok: false, code: 'invalid-concierge-message' }]);
  const notJson = await post(person, 'not json');
  assert.equal(notJson.status, 422);
  const plain = await post(person, { message: 'hi' }, { type: 'text/plain' });
  assert.equal(plain.status, 415);
  const foreign = await post(person, { message: 'hi' }, { origin: 'https://attacker.test' });
  assert.deepEqual([foreign.status, (await foreign.json()).code], [403, 'origin-not-allowed']);
  owner = OTHER;
  const stolen = await post(person, { conversationId: body.data.conversationId, message: 'mine now' });
  assert.deepEqual([stolen.status, await stolen.json()], [404, { ok: false, code: 'not-found' }]);
  owner = OWNER;
  f.model.script(() => { throw new Error('upstream failure with secret'); });
  const down = await post(person, { message: 'hi' });
  assert.deepEqual([down.status, await down.json()], [503, { ok: false, code: 'concierge-model-unavailable' }]);
  const anonymous = await post(createCommerceHandler({ service: wired, authenticate: async () => null, publicOrigin: ORIGIN }), { message: 'hi' });
  assert.equal(anonymous.status, 401);
});

test('POST /commerce/concierge is not served to agent handlers or to a service without a concierge', async t => {
  const f = await fixture(t);
  const wired = { ...f.service, concierge: (owner, body) => f.concierge.turn(owner, body) };
  const post = handler => handler(new Request(`${ORIGIN}/commerce/concierge`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'hi' }) }));
  const agent = await post(createCommerceHandler({ service: wired, authenticate: async () => OWNER, publicOrigin: ORIGIN, agent: true }));
  assert.deepEqual([agent.status, await agent.json()], [404, { ok: false, code: 'not-found' }]);
  const plain = await post(createCommerceHandler({ service: f.service, authenticate: async () => OWNER, publicOrigin: ORIGIN }));
  assert.deepEqual([plain.status, await plain.json()], [404, { ok: false, code: 'not-found' }]);
  assert.equal(f.model.calls.length, 0, 'neither request reached the model');
  // Other verbs on the route are not a turn either.
  const wrong = await createCommerceHandler({ service: wired, authenticate: async () => OWNER, publicOrigin: ORIGIN })(new Request(`${ORIGIN}/commerce/concierge`, { method: 'GET', headers: { origin: ORIGIN } }));
  assert.equal(wrong.status, 404);
  assert.equal(f.model.calls.length, 0);
});

// 10
test('conciergeFromEnvironment: opt-in only, an explicit model and key, a bounded daily budget, and no network at startup', async t => {
  const fetched = t.mock.method(globalThis, 'fetch', () => { throw new Error('network must not be used'); });
  const service = createCommerceService({ store: null, paypal: null, publicOrigin: ORIGIN, hosts: [{ id: 'current-pc' }] });
  const on = { ODDBOUT_BROADCAST_CONCIERGE: '1', ODDBOUT_BROADCAST_MODEL: 'gpt-test', OPENAI_API_KEY: KEY };
  assert.equal(conciergeFromEnvironment({}, service), null);
  assert.equal(conciergeFromEnvironment({ ODDBOUT_BROADCAST_CONCIERGE: '0' }, service), null);
  assert.equal(conciergeFromEnvironment({ ODDBOUT_BROADCAST_CONCIERGE: '0', ODDBOUT_BROADCAST_MODEL: 'gpt-test', OPENAI_API_KEY: KEY }, service), null);

  for (const missing of [{}, { ODDBOUT_BROADCAST_MODEL: 'gpt-test' }, { OPENAI_API_KEY: KEY }, { ODDBOUT_BROADCAST_MODEL: '', OPENAI_API_KEY: KEY }, { ODDBOUT_BROADCAST_MODEL: 'gpt-test', OPENAI_API_KEY: '' }]) {
    assert.throws(() => conciergeFromEnvironment({ ODDBOUT_BROADCAST_CONCIERGE: '1', ...missing }, service), { message: 'concierge-model-required' }, JSON.stringify(Object.keys(missing)));
  }
  for (const value of ['true', 'yes', '2', '', ' 1', '01', 'on', 'false']) {
    assert.throws(() => conciergeFromEnvironment({ ...on, ODDBOUT_BROADCAST_CONCIERGE: value }, service), { message: 'invalid-concierge-setting' }, JSON.stringify(value));
  }
  for (const daily of ['0', '-1', '1.5', 'abc', '', '100001', 'Infinity']) {
    assert.throws(() => conciergeFromEnvironment({ ...on, ODDBOUT_BROADCAST_CONCIERGE_DAILY_CALLS: daily }, service), { message: 'invalid-concierge-setting' }, JSON.stringify(daily));
  }
  assert.throws(() => conciergeFromEnvironment({ ...on, ODDBOUT_BROADCAST_MODEL: 'bad model!' }, service), { message: 'concierge_model_configuration_required' });
  for (const daily of [undefined, '1', '300', '100000']) {
    const concierge = conciergeFromEnvironment({ ...on, ...(daily === undefined ? {} : { ODDBOUT_BROADCAST_CONCIERGE_DAILY_CALLS: daily }) }, service);
    assert.equal(typeof concierge.turn, 'function');
  }
  // A configured concierge is a real one: a bad message is refused before it would call the model.
  await assert.rejects(conciergeFromEnvironment(on, service).turn(OWNER, { message: '' }), problem(422, 'invalid-concierge-message'));
  assert.equal(fetched.mock.callCount(), 0);
});

test('the demo server advertises the concierge only when it is enabled, and refuses to start half-configured', async t => {
  const base = { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'private-server-key', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixtureFixtureFixture01',
    ODDBOUT_COMMERCE_ENABLED: '1', ODDBOUT_BROADCAST_HOST_IDS: 'current-pc' };
  const fetched = t.mock.method(globalThis, 'fetch', () => { throw new Error('network must not be used'); });
  const config = async env => {
    const { server } = createBroadcastDemo(env);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    return new Promise((resolve, reject) => get(`http://127.0.0.1:${server.address().port}/broadcast/config`, { headers: { host: '127.0.0.1:5180' } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; }); res.on('error', reject); res.on('end', () => resolve({ status: res.statusCode, text, json: JSON.parse(text) }));
    }).on('error', reject));
  };
  const off = await config(base);
  assert.equal(off.status, 200);
  assert.equal(off.json.commerceEnabled, true);
  assert.equal(off.json.concierge, false);
  const on = await config({ ...base, ODDBOUT_BROADCAST_CONCIERGE: '1', ODDBOUT_BROADCAST_MODEL: 'gpt-test', OPENAI_API_KEY: KEY });
  assert.equal(on.json.concierge, true);
  assert.equal(on.text.includes(KEY), false);
  assert.equal(on.text.includes('private-server-key'), false);
  assert.throws(() => createBroadcastDemo({ ...base, ODDBOUT_BROADCAST_CONCIERGE: '1' }), { message: 'concierge-model-required' });
  assert.throws(() => createBroadcastDemo({ ...base, ODDBOUT_BROADCAST_CONCIERGE: 'maybe' }), { message: 'invalid-concierge-setting' });
  assert.equal(fetched.mock.callCount(), 0);
});
