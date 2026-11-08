import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Problem, rpcCaller, rpcProblem } from '../api/http.mjs';

const answer = problem => [problem.status, problem.message];

test('a database refusal is its code with its status, exactly or as the longest code a message contains; anything else is unavailable', () => {
  const statuses = { 'not-found': 404, 'faction-not-found': 422, 'rate-limit': 429 };
  assert.deepEqual(answer(rpcProblem({ message: 'not-found' }, statuses)), [404, 'not-found']);
  assert.deepEqual(answer(rpcProblem({ message: 'P0001: faction-not-found' }, statuses)), [503, 'database-unavailable'], 'exact by default');
  assert.deepEqual(answer(rpcProblem({ message: 'P0001: faction-not-found' }, statuses, { contains: true })), [422, 'faction-not-found']);
  assert.deepEqual(answer(rpcProblem({ message: 'constructor' }, statuses)), [503, 'database-unavailable'], 'own codes only');
  assert.deepEqual(answer(rpcProblem(null, statuses, { unavailable: 'admin-unavailable' })), [503, 'admin-unavailable']);
  const notReady = { unavailable: error => (error.code === 'PGRST202' ? 'account-not-ready' : 'account-unavailable') };
  assert.deepEqual(answer(rpcProblem({ message: 'x', code: 'PGRST202' }, statuses, notReady)), [503, 'account-not-ready']);
  const otherwise = error => (error.code === '23505' ? new Problem(409, 'conflict') : null);
  assert.deepEqual(answer(rpcProblem({ message: 'duplicate key', code: '23505' }, statuses, { otherwise })), [409, 'conflict']);
  assert.deepEqual(answer(rpcProblem({ message: 'other' }, statuses, { otherwise })), [503, 'database-unavailable']);
});

test("a module's caller returns the data or throws the refusal", async () => {
  const call = rpcCaller({ rpc: async name => (name === 'ok' ? { data: { value: 1 } } : { error: { message: 'rate-limit' } }) }, { 'rate-limit': 429 });
  assert.deepEqual(await call('ok', {}), { value: 1 });
  await assert.rejects(call('busy', {}), error => error instanceof Problem && error.status === 429 && error.message === 'rate-limit');
});
