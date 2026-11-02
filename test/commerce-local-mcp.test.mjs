import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createCommerceMcpHandler } from '../mcp/cloud/commerce-handler.mjs';
import { createCommerceHandler } from '../api/commerce/handler.mjs';
import { verifiedUserId } from '../api/http.mjs';
import { createCommerceService } from '../api/commerce/service.mjs';
import { COMMERCE_CATALOG } from '../api/commerce/catalog.mjs';
import { commerceDatabase } from './helpers/commerce-database.mjs';

const ORIGIN = 'http://127.0.0.1:5180';
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'obp_' + 'a'.repeat(40);
const OTHER_TOKEN = 'obp_' + 'b'.repeat(40);
const USER_JWT = 'fixture-user-jwt-with-full-account-authority';
const FIGHTERS = ['kuma', 'yume', 'bravow', 'beotim'];
const rpc = (method, params = {}) => ({ jsonrpc: '2.0', id: 1, method, params });
function request(body, { token = TOKEN, origin, path = '/mcp', method = 'POST', contentType = 'application/json' } = {}) {
  return new Request(`${ORIGIN}${path}`, { method, headers: { accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin !== undefined ? { origin } : {}), ...(contentType ? { 'content-type': contentType } : {}) }, ...(['GET', 'OPTIONS'].includes(method) ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}
async function setup(t) {
  const database = await commerceDatabase(); t.after(() => database.db.close());
  const claimsCalls = [];
  const db = { rpc: database.rpc, auth: { getClaims: async token => {
    claimsCalls.push(token);
    return { data: { claims: token === USER_JWT ? { sub: OWNER, role: 'authenticated', is_anonymous: false } : null }, error: null };
  } } };
  const service = createCommerceService({ store: database.store, paypal: null, publicOrigin: ORIGIN, hosts: [{ id: 'current-pc' }] });
  const commerce = { service, publicOrigin: ORIGIN };
  for (const owner of [OWNER, OTHER]) {
    const topup = await database.store.createTopup(owner, { requestKey: 'fixture-funding', amountCents: 1000, credits: 1000, currency: 'USD' });
    await database.store.attachOrder(owner, topup.id, `ORDER-${owner}`);
    await database.store.creditCapture(owner, topup.id, { providerOrderId: `ORDER-${owner}`, captureId: `CAPTURE-${owner}`, amountCents: 1000, currency: 'USD', status: 'COMPLETED' });
  }
  let index = 0;
  const approvalBody = () => ({ confirmed: true, requestKey: randomUUID(), hostId: 'current-pc', channelId: `channel-${++index}`, endsAt: new Date(Date.now() + 3_600_000).toISOString(), maxCredits: 100, fighterIds: FIGHTERS });
  async function session(owner) {
    const human = createCommerceHandler({ ...commerce, authenticate: async () => owner });
    const approved = await human(new Request(`${ORIGIN}/commerce/approvals`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(approvalBody()) }));
    assert.equal(approved.status, 200);
    const approval = (await approved.json()).data;
    return service.start(owner, { requestKey: randomUUID(), approvalId: approval.id });
  }
  const broadcast = await session(OWNER), sibling = await session(OWNER), foreign = await session(OTHER);
  const expiresAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
  const producers = [{ owner: OWNER, broadcastId: broadcast.id, token: TOKEN, expiresAt }, { owner: OTHER, broadcastId: foreign.id, token: OTHER_TOKEN, expiresAt }];
  const makeHandler = options => createCommerceMcpHandler({ db, commerce, producers, ...options });
  return { ...database, dbFacade: db, claimsCalls, commerce, service, broadcast, sibling, foreign, producers, approvalBody, makeHandler, handle: makeHandler() };
}
async function clientFor(t, handle, token = TOKEN) {
  const client = new Client({ name: 'session-producer-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } }, fetch: (input, init) => handle(new Request(input, init)) });
  await client.connect(transport); t.after(() => client.close()); return client;
}
const tool = async (client, name, args = {}) => (await client.callTool({ name, arguments: args })).structuredContent;

test('only unique valid server-provisioned opaque session credentials authenticate; default and full user JWT fail closed', async t => {
  const f = await setup(t);
  const empty = createCommerceMcpHandler({ db: f.dbFacade, commerce: f.commerce });
  assert.equal((await empty(request(rpc('tools/list')))).status, 401);
  for (const token of [null, USER_JWT, 'invalid', 'obp_' + 'x'.repeat(40)]) {
    const response = await f.handle(request(rpc('tools/list'), { token }));
    assert.equal(response.status, 401); assert.equal(response.headers.get('www-authenticate'), `Bearer resource_metadata="${ORIGIN}/mcp/.well-known/oauth-protected-resource"`);
  }
  assert.equal((await f.handle(request(rpc('tools/list')))).status, 200);
  assert.deepEqual(f.claimsCalls, []);
  for (const change of [{ owner: 'not-a-uuid' }, { broadcastId: 'not-a-uuid' }, { token: USER_JWT }, { token: 'obp_short' }, { token: 'obp_' + '.'.repeat(40) }, { expiresAt: 'bad-date' }, { expiresAt: '12/01/2026' }, { expiresAt: '2026-12-01' }, { expiresAt: '2026-12-01T00:00:00' }, { expiresAt: '2026-02-30T00:00:00.000Z' }, { secret: 'not-allowed' }]) {
    assert.throws(() => f.makeHandler({ producers: [{ ...f.producers[0], ...change }] }), /invalid-producer-credentials/);
  }
  assert.throws(() => f.makeHandler({ producers: [f.producers[0], f.producers[0]] }), /invalid-producer-credentials/);
  const wrongOwner = f.makeHandler({ producers: [{ ...f.producers[0], owner: OTHER }] });
  assert.equal((await wrongOwner(request(rpc('tools/list')))).status, 403);
});

test('only producer allowlist is exposed; paid mutation is bound to exact grant session despite same-owner or cross-owner inputs', async t => {
  const f = await setup(t); const owner = await clientFor(t, f.handle); const other = await clientFor(t, f.handle, OTHER_TOKEN);
  assert.deepEqual((await owner.listTools()).tools.map(item => item.name).sort(), ['get_credit_balance', 'get_broadcast_prices', 'get_broadcast', 'get_broadcast_job', 'get_broadcast_report', 'host_cup'].sort());
  for (const name of ['approve_broadcast', 'create_topup_checkout', 'confirm_topup', 'quote_broadcast', 'start_broadcast', 'stop_broadcast']) assert.equal((await owner.callTool({ name, arguments: {} })).isError, true);
  for (const broadcastId of [f.sibling.id, f.foreign.id]) {
    const requestKey = randomUUID();
    const refused = await tool(owner, 'host_cup', { requestKey, broadcastId, fighterIds: FIGHTERS });
    assert.equal(refused.ok, false); assert.equal(refused.code, 'producer-session-scope');
    assert.equal((await tool(owner, 'get_broadcast_report', { broadcastId })).code, 'producer-session-scope');
  }
  assert.equal((await f.db.query('select count(*)::int as n from commerce.jobs')).rows[0].n, 0);
  const args = { requestKey: randomUUID(), broadcastId: f.broadcast.id, fighterIds: FIGHTERS, priceCredits: 1, owner: OTHER };
  const queued = await tool(owner, 'host_cup', args); assert.equal(queued.ok, true); assert.equal(queued.data.owner, OWNER); assert.equal(queued.data.priceCredits, COMMERCE_CATALOG.tools.host_cup.credits);
  assert.equal((await tool(owner, 'get_broadcast_report', { broadcastId: f.broadcast.id.toUpperCase() })).data.broadcast.id, f.broadcast.id);
  assert.equal((await tool(owner, 'host_cup', args)).data.id, queued.data.id);
  assert.equal((await tool(owner, 'get_broadcast_job', { jobId: queued.data.id })).data.broadcastId, f.broadcast.id);
  const siblingJob = await f.service.cup(OWNER, { requestKey: randomUUID(), broadcastId: f.sibling.id, fighterIds: FIGHTERS });
  const foreignJob = await f.service.cup(OTHER, { requestKey: randomUUID(), broadcastId: f.foreign.id, fighterIds: FIGHTERS });
  assert.equal((await tool(owner, 'get_broadcast_job', { jobId: siblingJob.id })).code, 'producer-session-scope');
  assert.equal((await tool(owner, 'get_broadcast_job', { jobId: foreignJob.id })).code, 'not-found');
  const wallets = await Promise.all([tool(owner, 'get_credit_balance'), tool(other, 'get_credit_balance')]);
  assert.deepEqual(wallets.map(item => item.data.owner), [OWNER, OTHER]);
  assert.deepEqual(f.claimsCalls, []);
});

test('grant expiration and shorter session deadline are enforced again on every request without mutating jobs', async t => {
  const f = await setup(t); let clock = Date.now();
  const short = f.makeHandler({ producers: [{ ...f.producers[0], expiresAt: new Date(clock + 1000).toISOString() }], now: () => clock });
  assert.equal((await short(request(rpc('tools/list')))).status, 200); clock += 1001;
  assert.equal((await short(request(rpc('tools/list')))).status, 401);
  const late = f.makeHandler({ now: () => Date.parse(f.broadcast.endsAt) + 1 });
  const denied = await late(request(rpc('tools/call', { name: 'host_cup', arguments: { requestKey: randomUUID(), broadcastId: f.broadcast.id, fighterIds: FIGHTERS } })));
  assert.equal(denied.status, 401); assert.equal((await f.db.query('select count(*)::int as n from commerce.jobs')).rows[0].n, 0);
  await f.db.query("update commerce.broadcasts set ends_at=clock_timestamp()-interval '1 second' where id=$1", [f.broadcast.id]);
  assert.equal((await f.handle(request(rpc('tools/list')))).status, 401);
});

test('opaque producer bearer cannot approve budgets through real human REST handler even with forged same-origin confirmation', async t => {
  const f = await setup(t); const main = createCommerceHandler({ ...f.commerce, authenticate: request => verifiedUserId(f.dbFacade, request) });
  const approve = token => main(new Request(`${ORIGIN}/ai-fighter/commerce/approvals`, { method: 'POST', headers: { authorization: `Bearer ${token}`, origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(f.approvalBody()) }));
  const before = (await f.db.query('select count(*)::int as n from commerce.approvals')).rows[0].n;
  assert.equal((await approve(TOKEN)).status, 401);
  assert.equal((await f.db.query('select count(*)::int as n from commerce.approvals')).rows[0].n, before);
  assert.equal((await approve(USER_JWT)).status, 200);
  assert.equal((await f.handle(request(rpc('tools/list'), { token: USER_JWT }))).status, 401);
});

test('same-origin CORS only, bounded request parsing and metadata remain intact under producer auth', async t => {
  const f = await setup(t);
  const denied = await f.handle(request(rpc('tools/list'), { origin: 'https://attacker.test' })); assert.equal(denied.status, 403); assert.equal(denied.headers.has('access-control-allow-origin'), false);
  const preflight = await f.handle(request(undefined, { method: 'OPTIONS', origin: ORIGIN, token: null })); assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
  const absent = await f.handle(request(rpc('tools/list'))); assert.equal(absent.status, 200); assert.equal(absent.headers.has('access-control-allow-origin'), false);
  assert.equal((await f.handle(request('{}', { path: '/other' }))).status, 404);
  assert.equal((await f.handle(request(undefined, { method: 'GET' }))).status, 405);
  assert.equal((await f.handle(request('{}', { contentType: 'text/plain' }))).status, 415);
  for (const body of ['not json', '[]', '{}']) assert.equal((await f.handle(request(body))).status, 400);
  assert.equal((await f.handle(request(JSON.stringify({ method: 'tools/list', padding: 'x'.repeat(65536) })))).status, 413);
  const metadata = await f.handle(request(undefined, { method: 'GET', path: '/mcp/.well-known/oauth-protected-resource', token: null })); assert.equal(metadata.status, 200); assert.equal((await metadata.json()).resource, `${ORIGIN}/mcp`);
});

test('producer expiry while a request body is delayed revokes even tools/list before SDK dispatch',async t=>{
  const f=await setup(t);let clock=Date.now();const expiry=clock+1000;
  const handle=f.makeHandler({producers:[{...f.producers[0],expiresAt:new Date(expiry).toISOString()}],now:()=>clock});
  let controller;const stream=new ReadableStream({start(value){controller=value;}});
  const response=handle(new Request(`${ORIGIN}/mcp`,{method:'POST',headers:{authorization:`Bearer ${TOKEN}`,accept:'application/json, text/event-stream','content-type':'application/json'},body:stream,duplex:'half'}));
  const deadline=Date.now()+5000;while(!stream.locked&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(stream.locked,true);clock=expiry+1;controller.enqueue(new TextEncoder().encode(JSON.stringify(rpc('tools/list'))));controller.close();
  assert.equal((await response).status,401);
});

test('stalled body cancels at credential lifetime and an unverified clock fails closed',async t=>{
  const f=await setup(t);let clock=Date.now();let cancelled=false;
  const handle=f.makeHandler({producers:[{...f.producers[0],expiresAt:new Date(clock+1000).toISOString()}],now:()=>clock});
  const stream=new ReadableStream({cancel(){cancelled=true;}});
  const pending=handle(new Request(`${ORIGIN}/mcp`,{method:'POST',headers:{authorization:`Bearer ${TOKEN}`,accept:'application/json, text/event-stream','content-type':'application/json'},body:stream,duplex:'half'}));
  const deadline=Date.now()+5000;while(!stream.locked&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,1));assert.equal(stream.locked,true);
  clock+=1001;
  const response=await pending;assert.equal(response.status,401);assert.equal(cancelled,true);
  assert.equal((await f.makeHandler({now:()=>NaN})(request(rpc('tools/list')))).status,503);
});
