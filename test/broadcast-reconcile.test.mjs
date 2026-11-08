import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCommerceHandler } from '../api/commerce/handler.mjs';
import { createCommerceService } from '../api/commerce/service.mjs';
import { Problem } from '../api/http.mjs';
import { PAYPAL_READ_TOOLS, PAYPAL_MCP_TOOL_SWITCHES, compareTopup, connectPayPalMcp, createReconciler } from '../broadcast/reconcile.mjs';
import { reconcilerFromEnvironment } from '../scripts/broadcast-demo.mjs';
import { commerceDatabase } from './helpers/commerce-database.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const NOBODY = '33333333-3333-4333-8333-333333333333';
const ORIGIN = 'https://console.example.test';
const MERCHANT = 'SANDBOXMERCHANT';
const TOKEN = 'A21AAFixtureSandboxAccessToken0000000000000000';
const REAL_ENTRY = fileURLToPath(new URL('../deploy/paypal-mcp/node_modules/@paypal/mcp/dist/index.js', import.meta.url));
const T0 = Date.parse('2026-11-03T10:00:00.000Z');

const problem = (status, code) => error => {
  assert.ok(error instanceof Problem, `expected a Problem, got ${error}`);
  assert.equal(error.status, status);
  assert.equal(error.message, code);
  return true;
};

// ---- ledger fixtures: real PGlite SQL, PayPal-shaped identifiers ----
let serial = 0;
const orderIdOf = n => `5O190127TN${String(364700 + n).padStart(6, '0')}T`;
const captureIdOf = n => `3C679366HH${String(908900 + n).padStart(6, '0')}F`;

async function ledger(t) {
  const database = await commerceDatabase();
  t.after(() => database.db.close());
  return database;
}
/** state: 'created' (checkout never reached PayPal), 'ordered' (order attached) or 'credited' (capture credited). */
async function topup(store, owner, state = 'credited', { amountCents = 1000, order } = {}) {
  const n = ++serial;
  const created = await store.createTopup(owner, { requestKey: `topup-${n}`, amountCents, credits: amountCents, currency: 'USD' });
  if (state === 'created') return created;
  const providerOrderId = order ?? orderIdOf(n);
  const ordered = await store.attachOrder(owner, created.id, providerOrderId);
  if (state === 'ordered') return ordered;
  return store.creditCapture(owner, created.id, { providerOrderId, captureId: captureIdOf(n), amountCents, currency: 'USD', status: 'COMPLETED' });
}

// ---- PayPal Orders v2 JSON, built the way validateCapturedOrder expects ----
const money = cents => ({ currency_code: 'USD', value: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}` });
function paypalOrder(
  row,
  {
    status = 'COMPLETED',
    captureStatus = 'COMPLETED',
    captureId = row.captureId ?? captureIdOf(0),
    amountCents = row.amountCents,
    referenceId = row.id,
    merchantId = MERCHANT,
    orderId = row.providerOrderId,
    finalCapture = true,
  } = {},
) {
  return {
    id: orderId,
    intent: 'CAPTURE',
    status,
    purchase_units: [
      {
        reference_id: referenceId,
        amount: money(amountCents),
        payee: { merchant_id: merchantId },
        ...(status === 'COMPLETED'
          ? { payments: { captures: [{ id: captureId, status: captureStatus, final_capture: finalCapture, amount: money(amountCents) }] } }
          : {}),
      },
    ],
  };
}
const ok = data => ({ ok: true, data });

// ---- fake PayPal MCP boundary ----
const schema = properties => ({ type: 'object', properties, additionalProperties: false, $schema: 'http://json-schema.org/draft-07/schema#' });
const readTools = () => [
  {
    name: 'get_order',
    description: 'Retrieves the order details from PayPal for a given order ID.',
    inputSchema: schema({ id: { type: 'string', pattern: '^[A-Z0-9]{17,32}$' } }),
  },
  {
    name: 'list_transactions',
    description: 'Lists transactions for a date range.',
    inputSchema: schema({ start_date: { type: 'string' }, end_date: { type: 'string' } }),
  },
  { name: 'get_refund', description: 'Retrieves a refund.', inputSchema: schema({ refund_id: { type: 'string' } }) },
];
/** A real-shaped PayPalMcp: `call` refuses non-read names exactly like connectPayPalMcp's own layer, and records every request it receives. */
function fakePaypal({ tools = readTools() } = {}) {
  const orders = new Map();
  const state = { connects: [], calls: [], executed: [], closed: 0, orders, closeError: null, callError: null };
  state.serve = (id, result) => orders.set(id, result);
  state.connect = async options => {
    state.connects.push(options);
    return {
      tools,
      async call(name, args) {
        state.calls.push({ name, args });
        if (state.callError) throw state.callError;
        if (!PAYPAL_READ_TOOLS.includes(name)) return { ok: false, code: 'paypal_mcp_tool_not_allowed' };
        state.executed.push({ name, args });
        if (name === 'get_order') return orders.get(args.id) ?? { ok: false, code: 'paypal_mcp_api_error', status: 404 };
        if (name === 'list_transactions') return ok({ transaction_details: [], total_items: 0 });
        return ok({ id: args.refund_id, status: 'COMPLETED' });
      },
      async close() {
        state.closed++;
        if (state.closeError) throw state.closeError;
      },
    };
  };
  return state;
}
/** The only fake model boundary: each step is a list of Responses API output items, or a function returning one. */
let sequence = 0;
const fnCall = (name, args = {}, raw = JSON.stringify(args)) => {
  const n = ++sequence;
  return { type: 'function_call', id: `fc_${n}`, call_id: `call_${n}`, name, arguments: raw };
};
const say = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
function scriptedModel(...initial) {
  const steps = [...initial],
    calls = [];
  const call = async (input, tools, options = {}) => {
    calls.push({ input: structuredClone(input), tools, signal: options.signal });
    const step = steps.shift();
    if (step === undefined) throw new Error('scripted model exhausted');
    return { output: typeof step === 'function' ? await step(input, tools, options) : step };
  };
  return { call, calls, script: (...next) => steps.push(...next) };
}
/** The output the model was shown for one call, parsed. */
function shown(input, callId) {
  const item = input.find(entry => entry.type === 'function_call_output' && entry.call_id === callId);
  assert.ok(item, `no function_call_output for ${callId}`);
  return JSON.parse(item.output);
}
function clock(start = T0) {
  const state = {
    at: start,
    now: () => state.at,
    advance: ms => {
      state.at += ms;
    },
  };
  return state;
}
function reconciler(store, paypal, options = {}) {
  return createReconciler({
    listTopups: owner => store.listTopups(owner),
    accessToken: async () => TOKEN,
    merchantId: MERCHANT,
    entry: '/unused/paypal-mcp/index.js',
    connect: paypal.connect,
    now: () => T0,
    ...options,
  });
}
const sum = totals => Object.values(totals).reduce((a, b) => a + b, 0);

/** One credited-and-matching top-up, one credited whose capture PayPal shows REFUNDED, one ordered and still APPROVED. */
async function mixedLedger(store, paypal, owner = OWNER) {
  const matched = await topup(store, owner),
    refunded = await topup(store, owner),
    approved = await topup(store, owner, 'ordered');
  paypal.serve(matched.providerOrderId, ok(paypalOrder(matched)));
  paypal.serve(refunded.providerOrderId, ok(paypalOrder(refunded, { captureStatus: 'REFUNDED' })));
  paypal.serve(approved.providerOrderId, ok(paypalOrder(approved, { status: 'APPROVED' })));
  return { matched, refunded, approved };
}

// 1
test("list_topups returns only the owner's top-ups, newest first, at most 50, and [] for an owner with none", async t => {
  const { store } = await ledger(t);
  const mine = [];
  for (let i = 0; i < 52; i++) mine.push(await topup(store, OWNER, i % 3 === 0 ? 'ordered' : 'created'));
  const theirs = [await topup(store, OTHER, 'credited'), await topup(store, OTHER, 'created')];

  const listed = await store.listTopups(OWNER);
  assert.equal(listed.length, 50, 'capped at 50');
  assert.deepEqual(
    listed.map(row => row.id),
    mine
      .slice(2)
      .map(row => row.id)
      .reverse(),
    'the 50 newest, newest first',
  );
  assert.ok(
    listed.every(row => row.owner === OWNER),
    "only the owner's rows",
  );
  assert.equal(listed.filter(row => theirs.some(other => other.id === row.id)).length, 0, "another owner's rows never appear");
  assert.ok(!listed.some(row => row.id === mine[0].id || row.id === mine[1].id), 'the two oldest are cut off');
  // The row is the ledger's own record, camel-cased like every other store read.
  assert.deepEqual(
    Object.keys(listed[0])
      .filter(key => ['providerOrderId', 'captureId', 'amountCents', 'credits', 'currency', 'status'].includes(key))
      .sort(),
    ['amountCents', 'captureId', 'credits', 'currency', 'providerOrderId', 'status'],
  );

  const other = await store.listTopups(OTHER);
  assert.deepEqual(
    other.map(row => row.id),
    theirs.map(row => row.id).reverse(),
  );
  assert.deepEqual(
    other.map(row => [row.status, row.providerOrderId === null]),
    [
      ['created', true],
      ['credited', false],
    ],
  );
  assert.deepEqual(await store.listTopups(NOBODY), []);
  // An owner is required, never defaulted to "everyone".
  await assert.rejects(store.listTopups(null), problem(401, 'owner-required'));
  await assert.rejects(store.listTopups(''), problem(401, 'owner-required'));
});

// 2
test('compareTopup gives the deterministic verdict for each ledger/PayPal combination', () => {
  const credited = {
    id: 'b9c1d2e3-0000-4000-8000-000000000001',
    providerOrderId: orderIdOf(1),
    captureId: captureIdOf(1),
    credits: 1000,
    amountCents: 1000,
    currency: 'USD',
    status: 'credited',
  };
  const ordered = { ...credited, captureId: null, status: 'ordered', id: 'b9c1d2e3-0000-4000-8000-000000000002', providerOrderId: orderIdOf(2) };
  const compare = (row, fetched) => compareTopup(row, fetched, MERCHANT);
  const verdict = (row, fetched) => {
    const { result, reason } = compare(row, fetched);
    return [result, reason];
  };

  assert.deepEqual(compare(credited, ok(paypalOrder(credited))), {
    intentId: credited.id,
    orderId: credited.providerOrderId,
    captureId: credited.captureId,
    credits: 1000,
    amountCents: 1000,
    currency: 'USD',
    ledgerStatus: 'credited',
    paypalStatus: 'COMPLETED',
    result: 'matched',
    reason: null,
  });

  assert.deepEqual(verdict(credited, ok(paypalOrder(credited, { captureId: captureIdOf(99) }))), ['mismatched', 'capture-id-differs']);
  assert.deepEqual(verdict(credited, ok(paypalOrder(credited, { captureStatus: 'REFUNDED' }))), ['mismatched', 'capture-refunded']);
  assert.deepEqual(verdict(credited, ok(paypalOrder(credited, { captureStatus: 'PARTIALLY_REFUNDED' }))), ['mismatched', 'capture-partially_refunded']);
  assert.deepEqual(verdict(credited, ok(paypalOrder(credited, { captureStatus: 'PENDING' }))), ['mismatched', 'capture-pending']);
  for (const [label, order] of [
    ['amount', paypalOrder(credited, { amountCents: 999 })],
    ['reference', paypalOrder(credited, { referenceId: 'someone-elses-intent' })],
    ['merchant', paypalOrder(credited, { merchantId: 'OTHERMERCHANT' })],
    ['order id', paypalOrder(credited, { orderId: orderIdOf(77) })],
    ['not final', paypalOrder(credited, { finalCapture: false })],
    ['order not completed', paypalOrder(credited, { status: 'APPROVED' })],
    ['no purchase units', { ...paypalOrder(credited), purchase_units: [] }],
    ['malformed body', 'not an order'],
    ['null body', null],
  ])
    assert.deepEqual(verdict(credited, ok(order)), ['mismatched', 'paypal-record-differs'], label);

  // PayPal completed an order the ledger never credited: the owner needs "Verify payment".
  const completed = compare(ordered, ok(paypalOrder(ordered, { captureId: captureIdOf(2) })));
  assert.deepEqual(
    [completed.result, completed.reason, completed.paypalStatus, completed.ledgerStatus],
    ['mismatched', 'paypal-completed-not-credited', 'COMPLETED', 'ordered'],
  );
  for (const status of ['APPROVED', 'CREATED']) {
    const pending = compare(ordered, ok(paypalOrder(ordered, { status })));
    assert.deepEqual([pending.result, pending.reason, pending.paypalStatus], ['pending', 'awaiting-approval-or-capture', status]);
  }
  assert.equal(compare(ordered, ok({ ...paypalOrder(ordered, { status: 'APPROVED' }), status: 'X'.repeat(100) })).paypalStatus, 'X'.repeat(40));

  for (const fetched of [
    { ok: false, code: 'paypal_mcp_api_error', status: 404 },
    { ok: false, code: 'paypal_mcp_tool_error' },
    { ok: false, code: 'order-id-format' },
  ]) {
    for (const row of [credited, ordered]) assert.deepEqual(verdict(row, fetched), ['unavailable', fetched.code]);
  }
  assert.deepEqual(verdict(credited, null), ['unavailable', 'not-fetched']);

  const created = { ...credited, providerOrderId: null, captureId: null, status: 'created' };
  assert.deepEqual(compare(created, null), {
    intentId: credited.id,
    orderId: null,
    captureId: null,
    credits: 1000,
    amountCents: 1000,
    currency: 'USD',
    ledgerStatus: 'created',
    paypalStatus: null,
    result: 'no-order',
    reason: 'checkout-never-reached-paypal',
  });
  // With no order there is nothing to compare, whatever the fetch says.
  assert.deepEqual(verdict({ ...created, providerOrderId: undefined }, ok(paypalOrder(credited))), ['no-order', 'checkout-never-reached-paypal']);
});

// 3
test("run() fetches every top-up's order itself, even with no model, and the totals add up to the rows", async t => {
  const { store } = await ledger(t);
  const paypal = fakePaypal();
  const matched = await topup(store, OWNER),
    refunded = await topup(store, OWNER),
    approved = await topup(store, OWNER, 'ordered'),
    completed = await topup(store, OWNER, 'ordered'),
    noOrder = await topup(store, OWNER, 'created'),
    badFormat = await topup(store, OWNER, 'ordered', { order: 'abc-123' }),
    unknown = await topup(store, OWNER, 'ordered');
  const foreign = await topup(store, OTHER);
  paypal.serve(matched.providerOrderId, ok(paypalOrder(matched)));
  paypal.serve(refunded.providerOrderId, ok(paypalOrder(refunded, { captureStatus: 'REFUNDED' })));
  paypal.serve(approved.providerOrderId, ok(paypalOrder(approved, { status: 'APPROVED' })));
  paypal.serve(completed.providerOrderId, ok(paypalOrder(completed, { captureId: captureIdOf(500) })));
  paypal.serve(foreign.providerOrderId, ok(paypalOrder(foreign)));
  // `unknown` is not served: PayPal answers 404 for it.

  const report = await reconciler(store, paypal).run(OWNER);
  assert.deepEqual(
    report.rows.map(row => [row.intentId, row.result, row.reason]),
    [
      [unknown.id, 'unavailable', 'paypal_mcp_api_error'],
      [badFormat.id, 'unavailable', 'order-id-format'],
      [noOrder.id, 'no-order', 'checkout-never-reached-paypal'],
      [completed.id, 'mismatched', 'paypal-completed-not-credited'],
      [approved.id, 'pending', 'awaiting-approval-or-capture'],
      [refunded.id, 'mismatched', 'capture-refunded'],
      [matched.id, 'matched', null],
    ],
    'newest first, one row per top-up',
  );
  assert.deepEqual(report.totals, { matched: 1, mismatched: 2, pending: 1, unavailable: 2, 'no-order': 1 });
  assert.equal(sum(report.totals), report.rows.length);

  // Exactly one server get_order per top-up whose order id can reach PayPal, in row order, with no model involved.
  assert.deepEqual(report.toolCalls, [
    { name: 'get_order', ok: false, code: 'paypal_mcp_api_error', by: 'server' },
    { name: 'get_order', ok: true, by: 'server' },
    { name: 'get_order', ok: true, by: 'server' },
    { name: 'get_order', ok: true, by: 'server' },
    { name: 'get_order', ok: true, by: 'server' },
  ]);
  assert.equal(report.toolCalls.length, report.rows.filter(row => row.orderId && row.reason !== 'order-id-format').length);
  // The malformed id never reaches PayPal's server; another owner's order is never asked for.
  assert.deepEqual(
    paypal.calls.map(call => [call.name, call.args.id]),
    [unknown, completed, approved, refunded, matched].map(row => ['get_order', row.providerOrderId]),
  );
  assert.ok(!paypal.calls.some(call => call.args.id === 'abc-123' || call.args.id === foreign.providerOrderId));
  assert.deepEqual(
    [report.source, report.environment, report.tools, report.summary, report.summaryError, report.checkedAt],
    ['paypal-mcp', 'sandbox', ['get_order', 'list_transactions', 'get_refund'], null, null, '2026-11-03T10:00:00.000Z'],
  );
  assert.deepEqual([paypal.connects.length, paypal.closed], [1, 1]);
  assert.deepEqual(paypal.connects[0], { entry: '/unused/paypal-mcp/index.js', accessToken: TOKEN });
  assert.ok(!JSON.stringify(report).includes(TOKEN), 'the access token never reaches the report');
});

test('run() bounds the rows with maxRows (default 20) and keeps the newest', async t => {
  const { store } = await ledger(t);
  const paypal = fakePaypal();
  const rows = [];
  for (let i = 0; i < 22; i++) {
    const row = await topup(store, OWNER);
    paypal.serve(row.providerOrderId, ok(paypalOrder(row)));
    rows.push(row);
  }
  const newest = rows.map(row => row.id).reverse();

  const byDefault = await reconciler(store, paypal).run(OWNER);
  assert.deepEqual(
    byDefault.rows.map(row => row.intentId),
    newest.slice(0, 20),
  );
  assert.equal(sum(byDefault.totals), 20);
  assert.equal(paypal.calls.length, 20);

  paypal.calls.length = 0;
  const three = await reconciler(store, paypal, { maxRows: 3 }).run(OWNER);
  assert.deepEqual(
    three.rows.map(row => row.intentId),
    newest.slice(0, 3),
  );
  assert.deepEqual(three.totals, { matched: 3, mismatched: 0, pending: 0, unavailable: 0, 'no-order': 0 });
  assert.equal(three.toolCalls.length, 3);
  assert.equal(paypal.calls.length, 3);
});

// 4
test('the AI auditor investigates with the same read tools and explains; its calls are marked by:auditor', async t => {
  const { store } = await ledger(t);
  const paypal = fakePaypal();
  const { refunded } = await mixedLedger(store, paypal);
  const model = scriptedModel(
    [
      fnCall('list_transactions', { start_date: '2026-11-01T00:00:00Z', end_date: '2026-11-03T00:00:00Z' }),
      fnCall('get_order', { id: refunded.providerOrderId }),
    ],
    [say('One top-up matched. The refunded one needs attention. The pending one still awaits approval.')],
  );

  const report = await reconciler(store, paypal, { modelCall: model.call }).run(OWNER);
  assert.equal(report.summary, 'One top-up matched. The refunded one needs attention. The pending one still awaits approval.');
  assert.equal(report.summaryError, null);
  assert.deepEqual(report.toolCalls, [
    { name: 'get_order', ok: true, by: 'server' },
    { name: 'get_order', ok: true, by: 'server' },
    { name: 'get_order', ok: true, by: 'server' },
    { name: 'list_transactions', ok: true, by: 'auditor' },
    { name: 'get_order', ok: true, by: 'auditor' },
  ]);
  // The auditor's requests reached PayPal's server with exactly the model's arguments, after the server's own fetches.
  assert.deepEqual(paypal.calls.slice(3), [
    { name: 'list_transactions', args: { start_date: '2026-11-01T00:00:00Z', end_date: '2026-11-03T00:00:00Z' } },
    { name: 'get_order', args: { id: refunded.providerOrderId } },
  ]);

  // The model is offered exactly the three read tools, loosely typed, with the JSON Schema dialect key stripped.
  assert.equal(model.calls.length, 2);
  for (const call of model.calls) {
    assert.deepEqual(
      call.tools.map(tool => tool.name),
      ['get_order', 'list_transactions', 'get_refund'],
    );
    for (const tool of call.tools) {
      assert.deepEqual(Object.keys(tool).sort(), ['description', 'name', 'parameters', 'strict', 'type']);
      assert.equal(tool.type, 'function');
      assert.equal(tool.strict, false);
      assert.equal(tool.parameters.type, 'object');
      assert.ok(!('$schema' in tool.parameters), `${tool.name} still has $schema`);
    }
    assert.deepEqual(call.tools[0].parameters, {
      type: 'object',
      properties: { id: { type: 'string', pattern: '^[A-Z0-9]{17,32}$' } },
      additionalProperties: false,
    });
    assert.ok(call.signal instanceof AbortSignal && !call.signal.aborted);
  }
  const [developer, user] = model.calls[0].input;
  assert.equal(developer.role, 'developer');
  assert.match(developer.content, /result column is authoritative/);
  assert.deepEqual(JSON.parse(user.content), { checkedAt: '2026-11-03T10:00:00.000Z', environment: 'sandbox', rows: report.rows });
  // What the model saw for each of its calls is the server's tool result, as JSON data.
  const [listCall, orderCall] = model.calls[1].input.filter(item => item.type === 'function_call');
  assert.deepEqual(shown(model.calls[1].input, listCall.call_id), ok({ transaction_details: [], total_items: 0 }));
  assert.equal(shown(model.calls[1].input, orderCall.call_id).data.purchase_units[0].payments.captures[0].status, 'REFUNDED');
});

test("the auditor cannot change a verdict: rows and totals are the server's even when the model claims everything matched", async t => {
  const { store } = await ledger(t);
  const paypal = fakePaypal();
  const { refunded } = await mixedLedger(store, paypal);
  const baseline = await reconciler(store, paypal).run(OWNER);
  assert.deepEqual(baseline.totals, { matched: 1, mismatched: 1, pending: 1, unavailable: 0, 'no-order': 0 });

  const model = scriptedModel(() => {
    // Even if PayPal's record looks fine by the time the auditor asks, that is evidence for the explanation, not a new verdict.
    paypal.serve(refunded.providerOrderId, ok(paypalOrder(refunded)));
    return [fnCall('get_order', { id: refunded.providerOrderId })];
  }, [say('Everything matched. Nothing to do.')]);
  const audited = await reconciler(store, paypal, { modelCall: model.call }).run(OWNER);

  assert.equal(audited.summary, 'Everything matched. Nothing to do.');
  assert.deepEqual(audited.rows, baseline.rows);
  assert.deepEqual(audited.totals, baseline.totals);
  assert.deepEqual(
    audited.toolCalls.filter(call => call.by === 'server'),
    baseline.toolCalls,
  );
  assert.equal(audited.rows.find(row => row.intentId === refunded.id).result, 'mismatched');
  const seen = shown(model.calls[1].input, model.calls[1].input.find(item => item.type === 'function_call').call_id);
  assert.equal(seen.data.purchase_units[0].payments.captures[0].status, 'COMPLETED', 'the auditor really did see a clean-looking record');
});

test('a tool outside the read list is refused by the MCP layer, never executed, and the refusal is what the model sees', async t => {
  const { store } = await ledger(t);
  const paypal = fakePaypal();
  const { matched } = await mixedLedger(store, paypal);
  const refund = fnCall('create_refund', { capture_id: matched.captureId });
  const garbled = fnCall('get_order', {}, '{"id": ');
  const array = fnCall('get_order', {}, '["5O190127TN364715T"]');
  const model = scriptedModel([refund, garbled, array], [say('I could only read.')]);

  const report = await reconciler(store, paypal, { modelCall: model.call }).run(OWNER);
  assert.equal(report.summary, 'I could only read.');
  // run() hands the model's call straight to mcp.call, which is where the allowlist lives.
  assert.deepEqual(
    paypal.calls.find(call => call.name === 'create_refund'),
    { name: 'create_refund', args: { capture_id: matched.captureId } },
  );
  assert.ok(!paypal.executed.some(call => call.name === 'create_refund'), 'never executed');
  // Arguments that are not a JSON object never reach any tool.
  assert.equal(paypal.calls.length, 3 + 1, 'three server fetches and only the refusal attempt');
  assert.deepEqual(
    report.toolCalls.filter(call => call.by === 'auditor'),
    [
      { name: 'create_refund', ok: false, code: 'paypal_mcp_tool_not_allowed', by: 'auditor' },
      { name: 'get_order', ok: false, code: 'invalid-arguments', by: 'auditor' },
      { name: 'get_order', ok: false, code: 'invalid-arguments', by: 'auditor' },
    ],
  );
  assert.deepEqual(shown(model.calls[1].input, refund.call_id), { ok: false, code: 'paypal_mcp_tool_not_allowed' });
  assert.deepEqual(shown(model.calls[1].input, garbled.call_id), { ok: false, code: 'invalid-arguments' });
  assert.deepEqual(shown(model.calls[1].input, array.call_id), { ok: false, code: 'invalid-arguments' });
});

test('a model failure leaves the rows intact with summary:null and summaryError, and never leaks the failure detail', async t => {
  const { store } = await ledger(t);
  const paypal = fakePaypal();
  await mixedLedger(store, paypal);
  const baseline = await reconciler(store, paypal).run(OWNER);

  const model = scriptedModel(() => {
    throw new Error('upstream failure with sk-secret-key');
  });
  const report = await reconciler(store, paypal, { modelCall: model.call }).run(OWNER);
  assert.equal(report.summary, null);
  assert.equal(report.summaryError, 'reconciliation-model-unavailable');
  assert.deepEqual(report.rows, baseline.rows);
  assert.deepEqual(report.totals, baseline.totals);
  assert.ok(!JSON.stringify(report).includes('sk-secret-key'));
  assert.equal(paypal.closed, 2, 'both runs closed their connection');
});

test('auditor limits: empty answer, endless tool calls, and a 1500-character summary cap', async t => {
  const { store } = await ledger(t);
  const paypal = fakePaypal();
  const { approved } = await mixedLedger(store, paypal);

  const empty = scriptedModel([say('   ')]);
  assert.deepEqual(pick(await reconciler(store, paypal, { modelCall: empty.call }).run(OWNER)), {
    summary: null,
    summaryError: 'reconciliation-summary-empty',
  });

  const endless = scriptedModel(...Array.from({ length: 5 }, () => [fnCall('get_order', { id: approved.providerOrderId })]));
  const incomplete = await reconciler(store, paypal, { modelCall: endless.call, maxSteps: 2 }).run(OWNER);
  assert.deepEqual(pick(incomplete), { summary: null, summaryError: 'reconciliation-summary-incomplete' });
  assert.equal(endless.calls.length, 2, 'bounded by maxSteps');
  assert.equal(incomplete.toolCalls.filter(call => call.by === 'auditor').length, 2);

  const long = scriptedModel([say('x'.repeat(5000))]);
  assert.equal((await reconciler(store, paypal, { modelCall: long.call }).run(OWNER)).summary.length, 1500);
  function pick({ summary, summaryError }) {
    return { summary, summaryError };
  }
});

test('dailyModelCalls bounds the auditor across runs and resets on the next UTC day', async t => {
  const { store } = await ledger(t);
  const paypal = fakePaypal();
  await mixedLedger(store, paypal);
  const time = clock();
  const model = scriptedModel([say('first')], [say('second')]);
  const make = () => reconciler(store, paypal, { modelCall: model.call, dailyModelCalls: 1, now: time.now, cacheMs: 0 });
  const audit = make();

  assert.equal((await audit.run(OWNER)).summary, 'first');
  time.advance(60_000);
  const limited = await audit.run(OWNER);
  assert.equal(limited.summary, null);
  assert.equal(limited.summaryError, 'reconciliation-daily-limit');
  assert.equal(limited.totals.matched, 1, 'the deterministic part is unaffected by the limit');
  assert.equal(model.calls.length, 1, 'the model was not asked again');

  time.advance(24 * 3_600_000);
  assert.equal((await audit.run(OWNER)).summary, 'second');

  // A limit of zero never calls the model, and the limit is hit mid-investigation too.
  const none = scriptedModel([say('never')]);
  assert.equal((await reconciler(store, paypal, { modelCall: none.call, dailyModelCalls: 0 }).run(OWNER)).summaryError, 'reconciliation-daily-limit');
  assert.equal(none.calls.length, 0);
  const mid = scriptedModel([fnCall('get_order', { id: orderIdOf(1) })], [say('unreachable')]);
  const stopped = await reconciler(store, paypal, { modelCall: mid.call, dailyModelCalls: 1 }).run(OWNER);
  assert.equal(stopped.summaryError, 'reconciliation-daily-limit');
  assert.equal(mid.calls.length, 1);
});

// 5
test('concurrent runs for one account share a single reconciliation', async t => {
  const { store } = await ledger(t);
  const paypal = fakePaypal();
  await mixedLedger(store, paypal);
  await mixedLedger(store, paypal, OTHER);
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  let listed = 0;
  const slow = createReconciler({
    listTopups: owner => {
      listed++;
      return store.listTopups(owner);
    },
    accessToken: async () => TOKEN,
    merchantId: MERCHANT,
    entry: '/unused',
    connect: async options => {
      await gate;
      return paypal.connect(options);
    },
    now: () => T0,
  });

  const first = slow.run(OWNER),
    second = slow.run(OWNER),
    third = slow.run(OWNER),
    other = slow.run(OTHER);
  release();
  const [a, b, c, o] = await Promise.all([first, second, third, other]);
  assert.equal(paypal.connects.length, 2, 'one connection per account, not per request');
  assert.equal(listed, 2);
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
  assert.equal(a.cached, undefined);
  assert.equal(paypal.calls.length, 6, 'three get_order fetches per account');
  assert.deepEqual(
    a.rows.map(row => row.intentId).filter(id => o.rows.some(other => other.intentId === id)),
    [],
    'the other account got its own rows',
  );
  assert.equal(paypal.closed, 2);
});

test('a run within cacheMs is cached without connecting; after cacheMs it reconciles again', async t => {
  const { store } = await ledger(t);
  const paypal = fakePaypal();
  await mixedLedger(store, paypal);
  const time = clock();
  let listed = 0;
  const run = createReconciler({
    listTopups: owner => {
      listed++;
      return store.listTopups(owner);
    },
    accessToken: async () => TOKEN,
    merchantId: MERCHANT,
    entry: '/unused',
    connect: paypal.connect,
    now: time.now,
    cacheMs: 60_000,
  });

  const fresh = await run.run(OWNER);
  assert.equal(fresh.cached, undefined);
  const late = await topup(store, OWNER, 'created');
  time.advance(59_999);
  const cached = await run.run(OWNER);
  assert.equal(cached.cached, true);
  assert.deepEqual({ ...cached, cached: undefined }, { ...fresh, cached: undefined });
  assert.equal(cached.rows.length, 3, 'a top-up created after the run is not visible yet');
  assert.deepEqual([paypal.connects.length, listed, paypal.calls.length], [1, 1, 3], 'no connection, no ledger read, no PayPal call');
  assert.equal(fresh.cached, undefined, 'caching does not mark the stored report');

  // The cache is per account.
  assert.equal((await run.run(OTHER)).cached, undefined);
  assert.equal(paypal.connects.length, 2);

  time.advance(1);
  const again = await run.run(OWNER);
  assert.equal(again.cached, undefined);
  assert.equal(paypal.connects.length, 3);
  assert.equal(again.rows.length, 4);
  assert.equal(again.rows[0].intentId, late.id);
  assert.equal(again.checkedAt, '2026-11-03T10:01:00.000Z');
  assert.equal(paypal.closed, 3);
});

// 6
test('an unavailable PayPal MCP server is Problem 503 paypal-mcp-unavailable, never cached, and leaks nothing', async t => {
  const { store } = await ledger(t);
  const paypal = fakePaypal();
  await mixedLedger(store, paypal);
  let failing = true;
  const run = createReconciler({
    listTopups: owner => store.listTopups(owner),
    accessToken: async () => TOKEN,
    merchantId: MERCHANT,
    entry: '/unused',
    now: () => T0,
    connect: async options => {
      if (failing) throw new Error(`spawn failed with ${options.accessToken}`);
      return paypal.connect(options);
    },
  });

  await assert.rejects(run.run(OWNER), problem(503, 'paypal-mcp-unavailable'));
  failing = false;
  assert.equal((await run.run(OWNER)).totals.matched, 1, 'the failure was not cached and did not stick');

  // The PayPal token is fetched inside the same guard.
  const noToken = createReconciler({
    listTopups: owner => store.listTopups(owner),
    accessToken: async () => {
      throw new Error('oauth down');
    },
    merchantId: MERCHANT,
    entry: '/unused',
    connect: paypal.connect,
  });
  const before = paypal.connects.length;
  await assert.rejects(noToken.run(OWNER), problem(503, 'paypal-mcp-unavailable'));
  // A ledger failure is the ledger's own problem and starts no MCP server.
  const noLedger = createReconciler({
    listTopups: async () => {
      throw new Problem(503, 'commerce-unavailable');
    },
    accessToken: async () => TOKEN,
    merchantId: MERCHANT,
    entry: '/unused',
    connect: paypal.connect,
  });
  await assert.rejects(noLedger.run(OWNER), problem(503, 'commerce-unavailable'));
  assert.equal(paypal.connects.length, before);
});

test('the MCP connection is always closed, whether the model throws, a call throws or close itself fails', async t => {
  const { store } = await ledger(t);
  const paypal = fakePaypal();
  await mixedLedger(store, paypal);

  const plain = await reconciler(store, paypal).run(OWNER);
  assert.deepEqual([plain.totals.matched, paypal.closed], [1, 1]);

  const throwing = scriptedModel(() => {
    throw new Error('boom');
  });
  assert.equal((await reconciler(store, paypal, { modelCall: throwing.call }).run(OWNER)).summaryError, 'reconciliation-model-unavailable');
  assert.equal(paypal.closed, 2);

  paypal.callError = new Error('transport blew up');
  await assert.rejects(reconciler(store, paypal).run(OWNER), /transport blew up/);
  assert.equal(paypal.closed, 3, 'closed even though the run failed');
  paypal.callError = null;

  paypal.closeError = new Error('already gone');
  const report = await reconciler(store, paypal).run(OWNER);
  assert.equal(report.totals.matched, 1, 'a failing close does not fail an otherwise complete run');
  assert.equal(paypal.closed, 4);
  assert.equal(paypal.connects.length, 4);
});

// 7
test(
  'connectPayPalMcp against the real installed @paypal/mcp server: three read tools, API errors, refusal of every other tool',
  { timeout: 120_000 },
  async t => {
    if (!existsSync(REAL_ENTRY)) return t.skip('the PayPal MCP server is not installed (npm ci --prefix deploy/paypal-mcp)');
    const mcp = await connectPayPalMcp({ entry: REAL_ENTRY, accessToken: 'dummy-access-token', timeoutMs: 45_000 });
    let closed = false;
    t.after(async () => {
      if (!closed) await mcp.close().catch(() => {});
    });
    assert.deepEqual(mcp.tools.map(tool => tool.name).sort(), ['get_order', 'get_refund', 'list_transactions']);
    assert.ok(mcp.tools.every(tool => typeof tool.description === 'string' && tool.description.length <= 1000 && tool.inputSchema?.type === 'object'));

    assert.deepEqual(await mcp.call('get_order', { id: '5O190127TN364715T' }), { ok: false, code: 'paypal_mcp_api_error', status: 401 });
    for (const name of ['create_order', 'capture_order', 'create_refund', 'pay_order', '']) {
      assert.deepEqual(await mcp.call(name, {}), { ok: false, code: 'paypal_mcp_tool_not_allowed' }, name);
    }
    await mcp.close();
    closed = true;
  },
);

// ---- a stdio stub of the PayPal MCP server: the same transport and framing, no PayPal, no network ----
const STUB = `import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const dir = new URL('./', import.meta.url);
const config = JSON.parse(readFileSync(new URL('config.json', dir), 'utf8'));
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
const text = value => ({ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) });
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const { id, method, params } = message;
  if (method === 'initialize') return send({ id, result: { protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'stub', version: '0' } } });
  if (method === 'tools/list') return send({ id, result: { tools: config.tools.map(name => ({ name, description: 'stub ' + name, inputSchema: { type: 'object', properties: {}, $schema: 'http://json-schema.org/draft-07/schema#' } })) } });
  if (method !== 'tools/call') return send({ id, error: { code: -32601, message: 'no such method' } });
  const args = params.arguments ?? {};
  appendFileSync(new URL('calls.log', dir), JSON.stringify({ name: params.name, arguments: args, token: process.env.PAYPAL_ACCESS_TOKEN }) + '\\n');
  const reply = content => send({ id, result: { content } });
  if (args.id === 'ISERROR') return send({ id, result: { content: [text('boom')], isError: true } });
  if (args.id === 'NOTJSON') return reply([text('this is not json')]);
  if (args.id === 'TWOPARTS') return reply([text({ a: 1 }), text({ b: 2 })]);
  if (args.id === 'APIERROR') return reply([text({ ok: false, status: 404, error: 'RESOURCE_NOT_FOUND' })]);
  if (args.id === 'ERRFIELD') return reply([text({ error: 'something' })]);
  if (args.id === 'ENV') return reply([text({ argv: process.argv.slice(2), token: process.env.PAYPAL_ACCESS_TOKEN, environment: process.env.PAYPAL_ENVIRONMENT, probe: process.env.ODDBOUT_TEST_SECRET_PROBE ?? null })]);
  const orders = JSON.parse(readFileSync(new URL('orders.json', dir), 'utf8'));
  return reply([text(orders[args.id] ?? { ok: false, status: 404 })]);
});
`;
async function stubServer(t, { tools = ['get_order', 'list_transactions', 'get_refund'], orders = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'oddbout-reconcile-stub-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await Promise.all([
    writeFile(join(dir, 'index.mjs'), STUB),
    writeFile(join(dir, 'config.json'), JSON.stringify({ tools })),
    writeFile(join(dir, 'orders.json'), JSON.stringify(orders)),
    writeFile(join(dir, 'calls.log'), ''),
  ]);
  const log = async () =>
    (await readFile(join(dir, 'calls.log'), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  return { dir, entry: join(dir, 'index.mjs'), log, setOrders: value => writeFile(join(dir, 'orders.json'), JSON.stringify(value)) };
}
async function connect(t, stub, options = {}) {
  const mcp = await connectPayPalMcp({ entry: stub.entry, accessToken: TOKEN, timeoutMs: 30_000, ...options });
  t.after(() => mcp.close().catch(() => {}));
  return mcp;
}

test('connectPayPalMcp over stdio: read switches, minimal child environment, allowlist before the wire, and result mapping', { timeout: 120_000 }, async t => {
  const stub = await stubServer(t);
  const hadProbe = Object.hasOwn(process.env, 'ODDBOUT_TEST_SECRET_PROBE');
  process.env.ODDBOUT_TEST_SECRET_PROBE = 'must-not-reach-the-child';
  t.after(() => {
    if (!hadProbe) delete process.env.ODDBOUT_TEST_SECRET_PROBE;
  });
  const mcp = await connect(t, stub);

  assert.deepEqual(
    mcp.tools.map(tool => tool.name),
    ['get_order', 'list_transactions', 'get_refund'],
  );
  assert.deepEqual(PAYPAL_MCP_TOOL_SWITCHES, ['orders.get', 'transactions.list', 'payments.getRefunds']);
  const env = await mcp.call('get_order', { id: 'ENV' });
  assert.deepEqual(env, ok({ argv: ['--tools=orders.get,transactions.list,payments.getRefunds'], token: TOKEN, environment: 'SANDBOX', probe: null }));

  for (const name of ['create_refund', 'create_order', 'capture_order', 'get_orders', 'GET_ORDER', 'constructor']) {
    assert.deepEqual(await mcp.call(name, { id: 'x' }), { ok: false, code: 'paypal_mcp_tool_not_allowed' }, name);
  }
  assert.deepEqual(
    (await stub.log()).map(call => call.name),
    ['get_order'],
    'refused names never reached the server',
  );

  assert.deepEqual(await mcp.call('get_order', { id: 'ISERROR' }), { ok: false, code: 'paypal_mcp_tool_error' });
  assert.deepEqual(await mcp.call('get_order', { id: 'NOTJSON' }), { ok: false, code: 'paypal_mcp_tool_error' });
  assert.deepEqual(await mcp.call('get_order', { id: 'TWOPARTS' }), { ok: false, code: 'paypal_mcp_tool_error' });
  assert.deepEqual(await mcp.call('get_order', { id: 'APIERROR' }), { ok: false, code: 'paypal_mcp_api_error', status: 404 });
  assert.deepEqual(await mcp.call('get_order', { id: 'ERRFIELD' }), { ok: false, code: 'paypal_mcp_api_error', status: null });
  assert.deepEqual(await mcp.call('get_order', { id: 'UNKNOWNORDER12345' }), { ok: false, code: 'paypal_mcp_api_error', status: 404 });
  await stub.setOrders({ GOODORDER123456789: { id: 'GOODORDER123456789', status: 'APPROVED' } });
  assert.deepEqual(await mcp.call('get_order', { id: 'GOODORDER123456789' }), ok({ id: 'GOODORDER123456789', status: 'APPROVED' }));
  await mcp.close();
});

test('connectPayPalMcp refuses a server that offers more than the read tools, or none, or does not start', { timeout: 120_000 }, async t => {
  const wide = await stubServer(t, { tools: ['get_order', 'list_transactions', 'create_refund'] });
  await assert.rejects(connectPayPalMcp({ entry: wide.entry, accessToken: TOKEN, timeoutMs: 30_000 }), { message: 'paypal_mcp_unavailable' });
  const empty = await stubServer(t, { tools: [] });
  await assert.rejects(connectPayPalMcp({ entry: empty.entry, accessToken: TOKEN, timeoutMs: 30_000 }), { message: 'paypal_mcp_unavailable' });
  const missing = await stubServer(t);
  await assert.rejects(connectPayPalMcp({ entry: join(missing.dir, 'nope.mjs'), accessToken: TOKEN, timeoutMs: 30_000 }), {
    message: 'paypal_mcp_unavailable',
  });
  // A subset of the read tools is fine: only the names matter, not that all three are present.
  const subset = await stubServer(t, { tools: ['get_order'] });
  assert.deepEqual(
    (await connect(t, subset)).tools.map(tool => tool.name),
    ['get_order'],
  );
});

test(
  'end to end over stdio: real SQL, the real connect, a scripted model; a model-requested refund never reaches the server',
  { timeout: 120_000 },
  async t => {
    const { store } = await ledger(t);
    const matched = await topup(store, OWNER),
      approved = await topup(store, OWNER, 'ordered');
    const stub = await stubServer(t, {
      orders: {
        [matched.providerOrderId]: paypalOrder(matched),
        [approved.providerOrderId]: paypalOrder(approved, { status: 'APPROVED' }),
      },
    });
    const refund = fnCall('create_refund', { capture_id: matched.captureId });
    const model = scriptedModel([refund, fnCall('get_order', { id: approved.providerOrderId })], [say('One matched, one awaits approval.')]);

    const report = await createReconciler({
      listTopups: owner => store.listTopups(owner),
      accessToken: async () => TOKEN,
      merchantId: MERCHANT,
      entry: stub.entry,
      modelCall: model.call,
      now: () => T0,
    }).run(OWNER);
    assert.deepEqual(
      report.rows.map(row => [row.intentId, row.result]),
      [
        [approved.id, 'pending'],
        [matched.id, 'matched'],
      ],
    );
    assert.equal(report.summary, 'One matched, one awaits approval.');
    assert.deepEqual(report.toolCalls, [
      { name: 'get_order', ok: true, by: 'server' },
      { name: 'get_order', ok: true, by: 'server' },
      { name: 'create_refund', ok: false, code: 'paypal_mcp_tool_not_allowed', by: 'auditor' },
      { name: 'get_order', ok: true, by: 'auditor' },
    ]);
    const received = await stub.log();
    assert.deepEqual(
      received.map(call => call.name),
      ['get_order', 'get_order', 'get_order'],
      'the refund was refused before the wire',
    );
    assert.deepEqual(
      received.map(call => call.arguments.id),
      [approved.providerOrderId, matched.providerOrderId, approved.providerOrderId],
    );
    assert.ok(
      received.every(call => call.token === TOKEN),
      'the child process got the token',
    );
    assert.ok(!JSON.stringify(report).includes(TOKEN));
  },
);

// 8
test('POST /commerce/reconciliation returns the report for the authenticated owner only; agents and plain services get 404', async t => {
  const { store } = await ledger(t);
  const paypal = fakePaypal();
  const mine = await mixedLedger(store, paypal),
    theirs = await mixedLedger(store, paypal, OTHER);
  const service = createCommerceService({ store, paypal: null, publicOrigin: ORIGIN, hosts: [{ id: 'current-pc' }] });
  const run = reconciler(store, paypal);
  let owner = OWNER,
    reconciles = 0;
  const wired = {
    ...service,
    reconcile: ownerId => {
      reconciles++;
      return run.run(ownerId);
    },
  };
  const handler = createCommerceHandler({ service: wired, authenticate: async () => owner, publicOrigin: ORIGIN });
  const post = (target, { origin = ORIGIN, type = 'application/json', body = {}, method = 'POST' } = {}) =>
    target(
      new Request(`${ORIGIN}/commerce/reconciliation`, {
        method,
        headers: { ...(origin ? { origin } : {}), ...(type ? { 'content-type': type } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      }),
    );

  const response = await post(handler);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(
    body.data.rows.map(row => row.intentId),
    [mine.approved.id, mine.refunded.id, mine.matched.id],
  );
  assert.deepEqual(body.data.totals, { matched: 1, mismatched: 1, pending: 1, unavailable: 0, 'no-order': 0 });
  assert.deepEqual([body.data.source, body.data.environment, body.data.tools], ['paypal-mcp', 'sandbox', ['get_order', 'list_transactions', 'get_refund']]);
  assert.equal(body.data.summary, null);

  // The owner comes from authentication, never from the body.
  owner = OTHER;
  const spoof = await (await post(handler, { body: { owner: OWNER } })).json();
  assert.deepEqual(
    spoof.data.rows.map(row => row.intentId),
    [theirs.approved.id, theirs.refunded.id, theirs.matched.id],
  );
  owner = OWNER;
  assert.equal((await (await post(handler)).json()).data.cached, true, 'a second click within the window is served from the cache');

  // Refused before it reaches the reconciler.
  const calls = reconciles;
  const agent = await post(createCommerceHandler({ service: wired, authenticate: async () => OWNER, publicOrigin: ORIGIN, agent: true }));
  assert.deepEqual([agent.status, await agent.json()], [404, { ok: false, code: 'not-found' }]);
  const plain = await post(createCommerceHandler({ service, authenticate: async () => OWNER, publicOrigin: ORIGIN }));
  assert.deepEqual([plain.status, await plain.json()], [404, { ok: false, code: 'not-found' }]);
  const get = await post(handler, { method: 'GET' });
  assert.equal(get.status, 404);
  const foreign = await post(handler, { origin: 'https://evil.example.test' });
  assert.deepEqual([foreign.status, await foreign.json()], [403, { ok: false, code: 'origin-not-allowed' }]);
  const text = await post(handler, { type: 'text/plain' });
  assert.equal(text.status, 415);
  const anonymous = await post(createCommerceHandler({ service: wired, authenticate: async () => null, publicOrigin: ORIGIN }));
  assert.equal(anonymous.status, 401);
  assert.equal(reconciles, calls, 'none of the refused requests reached the reconciler');
});

test('POST /commerce/reconciliation reports an unavailable PayPal MCP server as 503 paypal-mcp-unavailable', async t => {
  const { store } = await ledger(t);
  await topup(store, OWNER);
  const service = createCommerceService({ store, paypal: null, publicOrigin: ORIGIN, hosts: [{ id: 'current-pc' }] });
  const run = createReconciler({
    listTopups: owner => store.listTopups(owner),
    accessToken: async () => TOKEN,
    merchantId: MERCHANT,
    entry: '/unused',
    connect: async () => {
      throw new Error('spawn ENOENT');
    },
  });
  const handler = createCommerceHandler({ service: { ...service, reconcile: owner => run.run(owner) }, authenticate: async () => OWNER, publicOrigin: ORIGIN });
  const response = await handler(
    new Request(`${ORIGIN}/commerce/reconciliation`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{}' }),
  );
  assert.deepEqual([response.status, await response.json()], [503, { ok: false, code: 'paypal-mcp-unavailable' }]);
});

// 9
test('reconcilerFromEnvironment: opt-in, validated, and no network at startup', async t => {
  const fetched = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('network must not be used');
  });
  const dir = await mkdtemp(join(tmpdir(), 'oddbout-reconcile-env-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entry = join(dir, 'index.js');
  await writeFile(entry, '// stands in for @paypal/mcp\n');
  const commerce = { store: { listTopups: async () => [] }, paypal: { accessToken: async () => TOKEN }, merchantId: MERCHANT };
  const on = { ODDBOUT_PAYPAL_RECONCILIATION: '1', ODDBOUT_PAYPAL_MCP_ENTRY: entry };

  assert.equal(reconcilerFromEnvironment({}, commerce), null);
  assert.equal(reconcilerFromEnvironment({ ODDBOUT_PAYPAL_RECONCILIATION: '0' }, commerce), null);
  assert.equal(reconcilerFromEnvironment({ ODDBOUT_PAYPAL_RECONCILIATION: '0' }, { store: null, paypal: null, merchantId: '' }), null, 'off needs no PayPal');

  for (const value of ['', 'true', 'TRUE', 'yes', '2', ' 1', '1 ', 'on', '01']) {
    assert.throws(
      () => reconcilerFromEnvironment({ ...on, ODDBOUT_PAYPAL_RECONCILIATION: value }, commerce),
      { message: 'invalid-reconciliation-setting' },
      JSON.stringify(value),
    );
  }
  // The setting is validated before anything else.
  assert.throws(() => reconcilerFromEnvironment({ ODDBOUT_PAYPAL_RECONCILIATION: 'true' }, { store: null, paypal: null, merchantId: '' }), {
    message: 'invalid-reconciliation-setting',
  });

  assert.throws(() => reconcilerFromEnvironment(on, { ...commerce, paypal: null }), { message: 'reconciliation-paypal-required' });
  assert.throws(() => reconcilerFromEnvironment(on, { ...commerce, merchantId: '' }), { message: 'reconciliation-paypal-required' });
  assert.throws(() => reconcilerFromEnvironment(on, { store: null, paypal: null, merchantId: '' }), { message: 'reconciliation-paypal-required' });

  assert.throws(() => reconcilerFromEnvironment({ ...on, ODDBOUT_PAYPAL_MCP_ENTRY: join(dir, 'missing.js') }, commerce), {
    message: 'paypal-mcp-not-installed',
  });
  // The default location is the separate install under deploy/paypal-mcp.
  if (existsSync(REAL_ENTRY)) assert.equal(typeof reconcilerFromEnvironment({ ODDBOUT_PAYPAL_RECONCILIATION: '1' }, commerce).run, 'function');
  else assert.throws(() => reconcilerFromEnvironment({ ODDBOUT_PAYPAL_RECONCILIATION: '1' }, commerce), { message: 'paypal-mcp-not-installed' });

  const plain = reconcilerFromEnvironment(on, commerce);
  assert.equal(typeof plain.run, 'function');
  const audited = reconcilerFromEnvironment({ ...on, ODDBOUT_BROADCAST_MODEL: 'gpt-test', OPENAI_API_KEY: 'sk-test-fixture-key' }, commerce);
  assert.equal(typeof audited.run, 'function');
  assert.equal(fetched.mock.callCount(), 0);
});

test('reconcilerFromEnvironment wires the store and the PayPal token into a working reconciler (stdio stub, no network)', { timeout: 120_000 }, async t => {
  const { store } = await ledger(t);
  const matched = await topup(store, OWNER);
  const stub = await stubServer(t, { orders: { [matched.providerOrderId]: paypalOrder(matched) } });
  const fetched = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('network must not be used');
  });
  let tokens = 0;
  const run = reconcilerFromEnvironment(
    { ODDBOUT_PAYPAL_RECONCILIATION: '1', ODDBOUT_PAYPAL_MCP_ENTRY: stub.entry },
    {
      store,
      paypal: {
        accessToken: async () => {
          tokens++;
          return TOKEN;
        },
      },
      merchantId: MERCHANT,
    },
  );

  const report = await run.run(OWNER);
  assert.deepEqual(
    report.rows.map(row => [row.intentId, row.result]),
    [[matched.id, 'matched']],
  );
  assert.deepEqual(report.toolCalls, [{ name: 'get_order', ok: true, by: 'server' }]);
  assert.equal(report.summary, null, 'no model configured, so no auditor');
  assert.equal(tokens, 1);
  assert.deepEqual(
    (await stub.log()).map(call => call.token),
    [TOKEN],
  );
  assert.equal(fetched.mock.callCount(), 0);
  assert.deepEqual(await run.run(NOBODY).then(other => other.rows), [], 'another account sees only its own (empty) ledger');
});
