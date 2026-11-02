import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { createBroadcastDemo } from '../scripts/broadcast-demo.mjs';

const jwt = role => `e30.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.fixture`;
test('public Sandbox binding is explicit, HTTPS-only and honors the platform port', () => {
  assert.equal(createBroadcastDemo({}).bindHost, '127.0.0.1');
  assert.throws(() => createBroadcastDemo({ ODDBOUT_BROADCAST_BIND_HOST: 'example.com' }), /invalid-demo-bind-host/);
  for (const origin of [undefined, 'http://demo.example', 'http://127.0.0.1:5180']) {
    assert.throws(() => createBroadcastDemo({ ODDBOUT_BROADCAST_BIND_HOST: '0.0.0.0', ODDBOUT_COMMERCE_ORIGIN: origin }), /public-demo-https-required/);
  }
  const env = { ODDBOUT_BROADCAST_BIND_HOST: '0.0.0.0', ODDBOUT_COMMERCE_ORIGIN: 'https://demo.example', PORT: '10000' };
  assert.equal(createBroadcastDemo(env).port, 10000);
  assert.equal(createBroadcastDemo(env).bindHost, '0.0.0.0');
  assert.equal(createBroadcastDemo({ ...env, ODDBOUT_BROADCAST_PORT: '5180' }).port, 5180);
  assert.throws(() => createBroadcastDemo({ ...env, ODDBOUT_COMMERCE_ENABLED: '1' }), /demo-commerce-database-required/);
});

test('public proxy requests keep exact Host and origin checks; health is liveness only', async t => {
  const { server } = createBroadcastDemo({ ODDBOUT_BROADCAST_BIND_HOST: '0.0.0.0', ODDBOUT_COMMERCE_ORIGIN: 'https://demo.example' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (path, headers = {}) => new Promise((resolve, reject) => {
    get(`http://127.0.0.1:${server.address().port}${path}`, { headers }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('error', reject); res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
  assert.deepEqual(JSON.parse((await request('/healthz')).body), { ok: true, service: 'oddbout-broadcast-sandbox' });
  assert.equal((await request('/broadcast/config', { host: 'internal', 'x-forwarded-host': 'demo.example' })).status, 403);
  const config = await request('/broadcast/config', { host: 'demo.example' });
  assert.equal(config.status, 200);
  assert.equal(JSON.parse(config.body).publicOrigin, 'https://demo.example');
  assert.equal(JSON.parse(config.body).mode, 'preview-unconfigured');
  assert.equal((await request('/broadcast/supabase.js', { host: 'demo.example' })).status, 200);
  assert.equal((await request('/commerce/catalog', { host: 'demo.example', origin: 'https://attacker.example' })).status, 403);
  assert.equal((await request('/commerce/wallet', { host: 'demo.example' })).status, 401);
});
test('demo refuses privileged or malformed keys in the public browser-key setting before serving', () => {
  for (const key of ['sb_secret_not-for-a-browser', jwt('service_role'), jwt('authenticated'), 'malformed']) {
    assert.throws(() => createBroadcastDemo({ SUPABASE_PUBLISHABLE_KEY: key }), error => {
      assert.equal(error.message, 'invalid-browser-publishable-key');
      assert.equal(error.message.includes(key), false);
      return true;
    });
  }
});

test('demo public config exposes only approved publishable key formats, never server credentials', async t => {
  for (const publicKey of ['sb_publishable_fixtureFixtureFixture01', jwt('anon')]) {
    const { server } = createBroadcastDemo({ SUPABASE_PUBLISHABLE_KEY: publicKey, SUPABASE_SERVICE_ROLE_KEY: 'private-server-key' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const response = await new Promise((resolve, reject) => {
      get(`http://127.0.0.1:${server.address().port}/broadcast/config`, { headers: { host: '127.0.0.1:5180' } }, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
        res.on('error', reject); res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject);
    });
    assert.equal(response.status, 200);
    const config = JSON.parse(response.body);
    assert.equal(config.publishableKey, publicKey);
    assert.equal(JSON.stringify(config).includes('private-server-key'), false);
    assert.equal(config.authConfigured, false);
  }
});
