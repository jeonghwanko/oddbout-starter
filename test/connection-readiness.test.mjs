import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { transportCode, connectionAction } from '../api/connection-errors.mjs';
import { readProject } from '../mcp/connection-readiness.mjs';
import { apiRequest } from '../api/client.mjs';

test('public config yields safe login arguments; missing or malformed values never produce a login command', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'fighter-public-config-')); t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await readProject(root), null);
  await mkdir(path.join(root, 'deploy'));
  const config = { apiBase: 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/ai-fighter', siteUrl: 'https://example.test/creator.html',
    publishableKey: 'sb_publishable_fixtureFixtureFixture01' };
  const save = async value => writeFile(path.join(root, 'deploy/creator-site.json'), JSON.stringify(value));
  await save(config); assert.match((await readProject(root)).flags, /^--url https:\/\/abcdefghijklmnopqrst\.supabase\.co --key sb_publishable_/);
  const anon = Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url');
  for (const change of [{ publishableKey: `e30.${anon}.sig;command` }, { siteUrl: 'https://example.test/creator.html#token=secret' },
    { apiBase: 'https://other.test/api' }, { publishableKey: 'sb_secret_fixtureFixtureFixture01' }]) {
    await save({ ...config, ...change }); assert.equal(await readProject(root), null);
  }
});

test('CONNECT 403 is infrastructure failure, while a service HTTP 403 is not reclassified as proxy denial', async () => {
  const denied = new TypeError('fetch failed', { cause: new Error('Tunnel connection failed: 403 Forbidden; token=do-not-echo') });
  const proxy = transportCode(denied);
  assert.deepEqual([proxy, connectionAction(proxy).actor], ['network-connect-forbidden', 'environment-preparer']);
  assert.ok(!JSON.stringify(connectionAction(proxy)).includes('do-not-echo'));
  assert.equal(connectionAction('api-http-403').actor, 'service-operator');
  assert.equal(transportCode(new Error('fetch failed')), 'api-unreachable');
  assert.equal(transportCode(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), 'network-timeout');
  assert.equal(transportCode(new Error('fetch failed', { cause: Object.assign(new Error('host'), { code: 'ENOTFOUND' }) })), 'network-dns-failed');
});

test('API client preserves safe transport codes and distinguishes non-JSON HTTP failures', async t => {
  const realFetch = globalThis.fetch; t.after(() => { globalThis.fetch = realFetch; });
  const request = () => apiRequest('https://abcdefghijklmnopqrst.supabase.co', 'secret', 'me');
  globalThis.fetch = async () => { throw new Error('CONNECT tunnel failed, response 403, secret'); };
  await assert.rejects(request(), error => error.message === 'network-connect-forbidden' && !error.message.includes('secret'));
  globalThis.fetch = async () => new Response('Forbidden', { status: 403 });
  await assert.rejects(request(), error => error.message === 'api-http-403' && error.status === 403);
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'authentication-required' }), { status: 401 });
  await assert.rejects(request(), error => connectionAction(error.message).actor === 'user');
});
