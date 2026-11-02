import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Problem, logFailure, rpcProblem } from '../api/http.mjs';
import { createHandler } from '../api/handler.mjs';

// API 점검 2026-11-03: a 503 used to leave no trace. A 5xx now writes one JSON line; a 4xx, the caller's, writes none.
const TOKEN = 'fixture-bearer-token-that-must-not-be-logged';
const request = (path = '/ai-fighter/admin/me?token=query-secret') => new Request(`https://test${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
/** @param {import('node:test').TestContext} t */
const capture = t => t.mock.method(console, 'error', () => {});
const lines = mocked => mocked.mock.calls.map(call => JSON.parse(call.arguments[0]));

test('a 4xx logs nothing; a 503 logs the route, its code and the database error behind it, without details, query or token', t => {
  const error = capture(t);
  logFailure('api', request(), new Problem(404, 'not-found'));
  logFailure('api', request(), new Problem(409, 'review-conflict'));
  assert.equal(error.mock.callCount(), 0);
  const database = { message: 'function public.af_admin_storage(uuid) does not exist', code: '42883', hint: 'No function matches the given name.',
    details: 'Key (email)=(someone@example.com) already exists.' };
  const problem = rpcProblem(database, { 'admin-required': 403 }, { unavailable: 'admin-unavailable' });
  assert.equal(problem.status, 503); assert.equal(problem.cause, database);
  logFailure('admin', request(), problem);
  const [line] = lines(error);
  assert.deepEqual(line, { stage: 'api-failure', scope: 'admin', method: 'GET', path: '/ai-fighter/admin/me', status: 503, code: 'admin-unavailable',
    error: { message: database.message, code: '42883', hint: database.hint } });
  const raw = error.mock.calls[0].arguments[0];
  for (const secret of ['someone@example.com', 'query-secret', TOKEN, 'Bearer']) assert.ok(!raw.includes(secret), secret);
  // A refusal the route knows stays a 4xx and carries no cause.
  assert.equal(rpcProblem({ message: 'admin-required' }, { 'admin-required': 403 }).cause, undefined);
});

test('a bug logs its name, message and first stack frames', t => {
  const error = capture(t);
  logFailure('generation', request('/ai-fighter/generations'), new TypeError('Cannot read properties of undefined'));
  const [line] = lines(error);
  assert.equal(line.status, 503); assert.equal(line.code, undefined);
  assert.deepEqual(line.error, { name: 'TypeError', message: 'Cannot read properties of undefined' });
  assert.ok(Array.isArray(line.stack) && line.stack.length >= 1 && line.stack.length <= 3);
});

test('a line names the MCP call that made it by its UUID request id; any other value is left out', t => {
  const error = capture(t), id = crypto.randomUUID();
  const withId = value => new Request('https://test/ai-fighter/generations', { headers: { 'x-request-id': value } });
  logFailure('generation', withId(id), new Problem(503, 'storage-unavailable'));
  logFailure('generation', withId('"},{"stage":"forged'), new Problem(503, 'storage-unavailable'));
  const [named, other] = lines(error);
  assert.equal(named.requestId, id); assert.equal(other.requestId, undefined); assert.equal(other.stage, 'api-failure');
});

test('the admin route logs one line when its database call fails, and answers the caller as before', async t => {
  const error = capture(t);
  const handle = createHandler({ db: {
    auth: { getUser: async () => ({ data: { user: { id: '0f0f0f0f-1111-4222-8333-444444444444' } } }) },
    rpc: async () => ({ data: null, error: { message: 'permission denied for function af_admin_account', code: '42501' } }),
  } });
  const response = await handle(request());
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, code: 'admin-unavailable' });
  assert.deepEqual(lines(error).map(line => [line.scope, line.code, line.error.code]), [['admin', 'admin-unavailable', '42501']]);
});
