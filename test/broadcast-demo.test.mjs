import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { createBroadcastDemo } from '../scripts/broadcast-demo.mjs';

const jwt = role => `e30.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.fixture`;
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
