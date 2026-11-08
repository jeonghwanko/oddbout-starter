import { randomUUID } from 'node:crypto';
import { commerceDatabase } from './commerce-database.mjs';
import { createCommerceService } from '../../api/commerce/service.mjs';
import { createPayPalSandbox } from '../../api/commerce/paypal.mjs';
import { createPaidOperations } from '../../api/commerce/paid-operations.mjs';
import { createPaidOperationHandler } from '../../api/commerce/paid-handler.mjs';
import { createPaidOperationClient } from '../../mcp/paid-operations.mjs';

export const OWNER = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';
export const ORIGIN = 'http://127.0.0.1:5193';
export const FIGHTERS = ['kuma', 'yume', 'bravow', 'beotim'];
export const taskInput = (extra = {}) => ({
  requestKey: randomUUID(),
  hostId: 'svl-mac-01',
  channelId: 'Recover my cup',
  endsAt: new Date(Date.now() + 3_600_000).toISOString(),
  fighterIds: FIGHTERS,
  ...extra,
});
export const proof = job => ({
  protocolVersion: 1,
  jobId: job.id,
  leaseToken: job.leaseToken,
  seed: job.seed,
  winnerId: job.fighterIds[0],
  bouts: [
    [0, 1],
    [2, 3],
    [0, 2],
  ].map(([left, right], index) => ({
    leftId: job.fighterIds[left],
    rightId: job.fighterIds[right],
    winnerId: job.fighterIds[left],
    winner: 0,
    seed: (job.seed + index) >>> 0,
    how: 'decision',
    ms: 100,
    hp: [1, 0],
    contacts: [0, 0],
    digest: '1234abcd',
  })),
});

// Only PayPal HTTP and verified auth identity are fixtures. SQL, ledger, services, routes and MCP client are real.
export async function paidFixture(t) {
  const database = await commerceDatabase();
  t.after(() => database.db.close());
  const orders = new Map(),
    calls = [],
    createdRequests = new Map();
  let loseCapture = false,
    loseCreate = false,
    failStatus = 0,
    pendingCapture = false;
  const paypal = createPayPalSandbox({
    clientId: 'test',
    clientSecret: 'test',
    merchantId: 'MERCHANT',
    fetch: async (url, init) => {
      const path = new URL(url).pathname,
        body = init.body && init.body !== 'grant_type=client_credentials' ? JSON.parse(init.body) : null;
      calls.push({ path, method: init.method, requestId: new Headers(init.headers).get('paypal-request-id') });
      const json = data => new Response(JSON.stringify(data));
      if (path === '/v1/oauth2/token') return json({ access_token: 'provider-test-token', token_type: 'Bearer', expires_in: 3600 });
      if (path === '/v1/notifications/verify-webhook-signature')
        return json({ verification_status: body.transmission_sig === 'valid' ? 'SUCCESS' : 'FAILURE' });
      if (failStatus) {
        const status = failStatus;
        failStatus = 0;
        return new Response('{}', { status });
      }
      if (path === '/v2/checkout/orders') {
        const key = new Headers(init.headers).get('paypal-request-id');
        if (createdRequests.has(key)) return json(orders.get(createdRequests.get(key)));
        const id = `ORDER${orders.size + 1}`,
          order = {
            id,
            intent: body.intent,
            status: 'CREATED',
            purchase_units: body.purchase_units,
            links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }],
          };
        orders.set(id, order);
        createdRequests.set(key, id);
        if (loseCreate) {
          loseCreate = false;
          throw new TypeError('lost create response');
        }
        return json(order);
      }
      const match = path.match(/^\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/);
      if (!match) throw new Error('unexpected-provider-request');
      const order = orders.get(match[1]);
      if (!order) throw new Error('missing-order');
      if (match[2]) {
        order.status = 'COMPLETED';
        order.purchase_units[0].payments = {
          captures: [
            { id: `CAPTURE${order.id}`, status: pendingCapture ? 'PENDING' : 'COMPLETED', final_capture: true, amount: order.purchase_units[0].amount },
          ],
        };
        if (loseCapture) {
          loseCapture = false;
          throw new TypeError('lost capture response');
        }
      }
      return json(order);
    },
  });
  const commerce = createCommerceService({
    store: database.store,
    paypal,
    merchantId: 'MERCHANT',
    webhookId: 'WH',
    publicOrigin: ORIGIN,
    hosts: [{ id: 'svl-mac-01' }],
  });
  const service = createPaidOperations({ store: database.store, commerce, publicOrigin: ORIGIN });
  const handler = createPaidOperationHandler({
    service,
    store: database.store,
    publicOrigin: ORIGIN,
    authenticate: async request => {
      const token = request.headers.get('authorization');
      return token === `Bearer fixture-${OWNER}` ? OWNER : token === `Bearer fixture-${OTHER}` ? OTHER : null;
    },
  });
  const fetchImpl = (url, init) => handler(new Request(url, init));
  async function phone(path, body, owner = OWNER) {
    const response = await handler(
      new Request(`${ORIGIN}/paid-operations/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { origin: ORIGIN, authorization: `Bearer fixture-${owner}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    return { status: response.status, ...(await response.json()) };
  }
  async function connect(label, owner = OWNER) {
    const client = createPaidOperationClient({ origin: ORIGIN, fetchImpl }),
      pair = await client.connect(label);
    const params = new URLSearchParams(new URL(pair.verificationUrl).hash.slice(1));
    const approved = await phone('devices/approve', { id: params.get('device'), userCode: pair.userCode, confirmed: true }, owner);
    if (!approved.ok) throw new Error(approved.code);
    await client.connect(label);
    return client;
  }
  async function fund(id) {
    const approved = await phone(`operations/${id}/approve`, { confirmed: true });
    if (!approved.ok) throw new Error(approved.code);
    const payment = await phone(`operations/${id}/checkout`, { confirmed: true });
    if (!payment.ok) throw new Error(payment.code);
    orders.get(payment.data.operation.payment.providerOrderId).status = 'APPROVED';
    return payment.data;
  }
  const signedHeaders = () =>
    new Headers({
      'paypal-transmission-id': 'TX',
      'paypal-transmission-time': new Date().toISOString(),
      'paypal-transmission-sig': 'valid',
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT',
    });
  const event = (type, resource) => commerce.webhook(signedHeaders(), JSON.stringify({ id: randomUUID(), event_type: type, resource }));
  return {
    ...database,
    commerce,
    service,
    handler,
    fetchImpl,
    phone,
    connect,
    fund,
    orders,
    calls,
    event,
    loseCapture: () => {
      loseCapture = true;
    },
    loseCreate: () => {
      loseCreate = true;
    },
    failProvider: (status = 503) => {
      failStatus = status;
    },
    pendingCapture: () => {
      pendingCapture = true;
    },
  };
}
