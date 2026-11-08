import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRemoteClient } from '../api/client.mjs';

const url = 'https://abcdefghijklmnopqrst.supabase.co';
const jwt = secondsFromNow => `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow })).toString('base64url')}.signature`;
let directory, realFetch, sentTokens;
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'fighter-client-'));
  realFetch = globalThis.fetch;
  globalThis.fetch = async (_, init) => {
    sentTokens.push(init.headers.authorization.slice('Bearer '.length));
    return new Response(JSON.stringify({ ok: true, stage: 'public-contract' }), { headers: { 'content-type': 'application/json' } });
  };
});
after(async () => {
  globalThis.fetch = realFetch;
  await rm(directory, { recursive: true, force: true });
});

async function clientWith(accessToken, refresh) {
  const file = path.join(directory, `${crypto.randomUUID()}.json`);
  await writeFile(file, JSON.stringify({ url, publishableKey: 'sb_publishable_test', accessToken, refreshToken: 'r1' }), { mode: 0o600 });
  const refreshes = [];
  const client = await createRemoteClient(file, {
    createAuthClient: () => ({
      auth: {
        refreshSession: async ({ refresh_token }) => {
          refreshes.push(refresh_token);
          await new Promise(resolve => setTimeout(resolve, 10));
          return refresh();
        },
      },
    }),
  });
  sentTokens = [];
  return { file, client, refreshes };
}

test('a valid access token is reused without an auth round trip', async () => {
  const token = jwt(3600),
    { client, refreshes } = await clientWith(token, () => assert.fail('no refresh expected'));
  await client.request('spec');
  await client.request('spec');
  assert.deepEqual(refreshes, []);
  assert.deepEqual(sentTokens, [token, token]);
});

test('a running client adopts reauthentication and stops after logout', async () => {
  const file = path.join(directory, 'late-login.json');
  const config = { url, publishableKey: 'sb_publishable_test', accessToken: jwt(3600), refreshToken: 'first' };
  await writeFile(file, JSON.stringify(config));
  const client = await createRemoteClient(file, { createAuthClient: () => ({ auth: { refreshSession: () => assert.fail('fresh token') } }) });
  sentTokens = [];
  await client.request('me');
  const replacement = jwt(1800);
  await writeFile(file, JSON.stringify({ ...config, accessToken: replacement, refreshToken: 'second' }));
  await client.request('me');
  assert.deepEqual(sentTokens, [config.accessToken, replacement]);
  await rm(file);
  await assert.rejects(client.request('me'), /client-sign-in-required/);
  assert.equal(sentTokens.length, 2);
});

test('session replacement cannot silently change the owner of subsequent upload requests', async () => {
  const { file, client } = await clientWith(jwt(3600), () => assert.fail('fresh token'));
  const config = JSON.parse(await readFile(file, 'utf8'));
  const replacement = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, sub: 'another-user' })).toString('base64url')}.signature`;
  await writeFile(file, JSON.stringify({ ...config, accessToken: replacement }));
  await assert.rejects(client.request('submissions'), /client-account-changed/);
  assert.deepEqual(sentTokens, []);
});
test('a token near expiry is refreshed once for concurrent calls and the session file is replaced atomically', async () => {
  const fresh = jwt(3600);
  const { file, client, refreshes } = await clientWith(jwt(10), () => ({ data: { session: { access_token: fresh, refresh_token: 'r2' } } }));
  await Promise.all([client.request('spec'), client.request('spec'), client.request('spec')]);
  assert.deepEqual(refreshes, ['r1']);
  assert.deepEqual(sentTokens, [fresh, fresh, fresh]);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual([saved.accessToken, saved.refreshToken, saved.url], [fresh, 'r2', url]);
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(
    (await readdir(directory)).filter(name => name.endsWith('.tmp')),
    [],
  );
});
test('a revoked session asks for a new sign-in and keeps the saved file', async () => {
  const { file, client } = await clientWith(jwt(-5), () => ({ data: { session: null }, error: new Error('revoked') }));
  const before = await readFile(file, 'utf8');
  await assert.rejects(client.request('spec'), /client-sign-in-required/);
  assert.equal(await readFile(file, 'utf8'), before);
  assert.deepEqual(sentTokens, []);
});
test('a blocked refresh preserves the session and is not reported as a revoked account', async () => {
  for (const [error, reason] of [
    [new Error('fetch failed', { cause: new Error('Tunnel connection failed: 403 Forbidden') }), 'network-connect-forbidden'],
    [new TypeError('fetch failed'), 'api-unreachable'],
  ]) {
    const { file, client } = await clientWith(jwt(-5), () => ({ data: { session: null }, error }));
    const before = await readFile(file, 'utf8');
    await assert.rejects(client.request('me'), { message: reason });
    assert.equal(await readFile(file, 'utf8'), before);
    assert.deepEqual(sentTokens, []);
  }
});
test('processes sharing one session file adopt a saved refresh instead of spending an old token', async () => {
  const fresh = jwt(3600);
  const shared = await clientWith(jwt(10), () => ({ data: { session: { access_token: fresh, refresh_token: 'r2' } } }));
  // A second process: same file, same stale session in memory.
  const refreshes = [];
  const second = await createRemoteClient(shared.file, {
    createAuthClient: () => ({
      auth: {
        refreshSession: async ({ refresh_token }) => {
          refreshes.push(refresh_token);
          return { data: { session: { access_token: jwt(3600), refresh_token: 'r3' } } };
        },
      },
    }),
  });
  await shared.client.request('spec');
  sentTokens = [];
  await second.request('spec');
  assert.deepEqual(refreshes, []); // r1 is spent; using it again could end the whole session.
  assert.deepEqual(sentTokens, [fresh]);
});
test('concurrent refreshes in separate processes run one at a time; a stale lock is cleared', async () => {
  const { file, client, refreshes } = await clientWith(jwt(10), () => ({ data: { session: { access_token: jwt(3600), refresh_token: 'r2' } } }));
  const lock = `${file}.lock`;
  await writeFile(lock, '99999');
  const past = new Date(Date.now() - 60000);
  await utimes(lock, past, past);
  const peer = await createRemoteClient(file, {
    createAuthClient: () => ({
      auth: {
        refreshSession: async () => {
          refreshes.push('peer');
          return { data: { session: { access_token: jwt(3600), refresh_token: 'r3' } } };
        },
      },
    }),
  });
  await Promise.all([client.request('spec'), peer.request('spec')]);
  assert.equal(refreshes.length, 1, JSON.stringify(refreshes));
  await assert.rejects(stat(lock), { code: 'ENOENT' });
});
test('transfer timeouts grow with the body size', async () => {
  const { transferTimeoutMs } = await import('../api/client.mjs');
  assert.equal(transferTimeoutMs(0), 30000);
  assert.ok(transferTimeoutMs(4000000) >= 90000);
});
