import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/handler.mjs';
import { CLIENT_LIMITS, clientAddress, createClientLimiter } from '../api/client-limit.mjs';
import { migratedDatabase } from './helpers/fighter-database.mjs';

const secret = 's'.repeat(40);
const request = headers => new Request('https://test/ai-fighter/duels', { method: 'POST', headers });

test('the address never comes from the client-written first X-Forwarded-For entry', () => {
  const spoofed = { 'x-forwarded-for': '6.6.6.6, 203.0.113.9', 'cf-connecting-ip': '198.51.100.7' };
  assert.equal(clientAddress(request(spoofed), 'forwarded-last'), '203.0.113.9');
  assert.equal(clientAddress(request(spoofed), 'cf-connecting-ip'), '198.51.100.7');
  assert.equal(clientAddress(request(spoofed), 'x-forwarded-for'), null, 'unknown sources read nothing');
  // IPv6 by its /64: one host or network holds a whole /64, so a key per address was one per request (API 점검 2026-10-29).
  const v6 = value => clientAddress(request({ 'cf-connecting-ip': value }), 'cf-connecting-ip');
  assert.equal(v6('2001:DB8::1'), '2001:db8:0:0::/64');
  for (const same of ['2001:db8::2', '2001:0db8:0000:0000:ffff:1:2:3', '2001:db8:0:0:1::', '2001:db8::192.0.2.1'])
    assert.equal(v6(same), '2001:db8:0:0::/64', same);
  assert.equal(v6('2001:db8:0:1::1'), '2001:db8:0:1::/64');
  // IPv4 written as IPv6 is that IPv4 address.
  assert.equal(v6('::ffff:198.51.100.7'), '198.51.100.7');
  assert.equal(v6('::FFFF:c633:6407'), '198.51.100.7');
  for (const bad of ['2001:db8::1::2', '1:2:3:4:5:6:7:8:9', '2001:db8::12345', '::ffff:999.1.1.1', 'fe80::1%eth0', ':::']) assert.equal(v6(bad), null, bad);
  for (const bad of ['', 'unknown', '999.1.1.1', '1.2.3', 'not:an;address'])
    assert.equal(clientAddress(request({ 'cf-connecting-ip': bad }), 'cf-connecting-ip'), null, bad);
});

test('the brake is off without a secret and a verified source; on, only a keyed daily hash leaves the function', async () => {
  const calls = [],
    db = {
      rpc: async (name, args) => {
        calls.push([name, args]);
        return { data: true };
      },
    };
  const headers = { 'cf-connecting-ip': '198.51.100.7' };
  for (const options of [
    { secret: undefined, source: 'cf-connecting-ip' },
    { secret: 'short', source: 'cf-connecting-ip' },
    { secret, source: undefined },
  ])
    assert.equal(await createClientLimiter({ db, ...options }).allow(request(headers), 'duel-start', 1, 60), true);
  assert.equal(calls.length, 0);
  let day = '2026-10-28T10:00:00Z';
  const limiter = createClientLimiter({ db, secret, source: 'cf-connecting-ip', now: () => new Date(day) });
  await limiter.allow(request(headers), 'duel-start', 25, 86400);
  await limiter.allow(request(headers), 'duel-start', 25, 86400);
  day = '2026-10-29T10:00:00Z';
  await limiter.allow(request(headers), 'duel-start', 25, 86400);
  const keys = calls.map(([, args]) => args.p_key);
  assert.ok(keys.every(key => /^[a-f0-9]{64}$/.test(key)) && !JSON.stringify(calls).includes('198.51.100.7'), 'the address is never sent');
  assert.equal(keys[0], keys[1], 'stable within a day');
  assert.notEqual(keys[1], keys[2], 'unlinkable across days');
  assert.deepEqual(calls[0], ['af_rate_hit', { p_bucket: 'duel-start', p_key: keys[0], p_limit: 25, p_window_seconds: 86400 }]);
});

test('a limiter fault lets the request reach the global brakes instead of failing it', async () => {
  const warnings = [];
  const limiter = createClientLimiter({
    db: { rpc: async () => ({ error: { message: 'boom' } }) },
    secret,
    source: 'cf-connecting-ip',
    warn: line => warnings.push(line),
  });
  assert.equal(await limiter.allow(request({ 'cf-connecting-ip': '198.51.100.7' }), 'duel-start', 1, 60), true);
  assert.deepEqual(
    warnings.map(line => JSON.parse(line).stage),
    ['client-limit-unavailable'],
  );
});

test('over the brake, a guest duel and a device-login start are refused before any reservation', async () => {
  const calls = [];
  const db = {
    rpc: async name => {
      calls.push(name);
      return name === 'af_rate_hit' ? { data: false } : { error: { message: 'unexpected' } };
    },
  };
  const handle = createHandler({
    db,
    engineVersion: 'test-v1',
    simulateDuel: () => ({}),
    limiter: createClientLimiter({ db, secret, source: 'cf-connecting-ip' }),
  });
  const headers = { 'cf-connecting-ip': '198.51.100.7' };
  const duel = await handle(
    new Request('https://test/ai-fighter/duels', {
      method: 'POST',
      headers,
      body: JSON.stringify({ a: crypto.randomUUID(), b: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }),
    }),
  );
  assert.deepEqual([duel.status, (await duel.json()).code], [429, 'rate-limit']);
  const login = await handle(new Request('https://test/ai-fighter/device-logins', { method: 'POST', headers }));
  assert.deepEqual([login.status, (await login.json()).code], [429, 'rate-limit']);
  assert.deepEqual(calls, ['af_rate_hit', 'af_rate_hit'], 'no duel reservation or login start was attempted');
});

test('Postgres counts hits per keyed caller and window, keeps a day of rows and is service-only', async () => {
  const db = await migratedDatabase();
  try {
    const hit = (key, limit = 2, window = 600) =>
      db.query('select public.af_rate_hit($1,$2,$3,$4) as allowed', ['duel-start', key, limit, window]).then(r => r.rows[0].allowed);
    const a = 'a'.repeat(64),
      b = 'b'.repeat(64);
    assert.deepEqual([await hit(a), await hit(a), await hit(a), await hit(b)], [true, true, false, true]);
    await assert.rejects(hit('not-a-hash'), /invalid-rate-limit/);
    await assert.rejects(hit(a, 0), /invalid-rate-limit/);
    await db.query("insert into public.af_rate_hits(bucket,key_hash,window_start) values('duel-start',$1,now()-interval '25 hours')", ['c'.repeat(64)]);
    await hit(a);
    assert.equal(
      (await db.query('select count(*)::int as n from public.af_rate_hits where key_hash=$1', ['c'.repeat(64)])).rows[0].n,
      0,
      'older than a day is deleted',
    );
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${crypto.randomUUID()}';`);
    await assert.rejects(hit(a), /permission denied/);
    await assert.rejects(db.query('select * from public.af_rate_hits'), /permission denied/);
    await db.exec('reset role');
  } finally {
    await db.close();
  }
});

test('each per-caller brake stays well under its global limit', () => {
  assert.ok(CLIENT_LIMITS.duel.limit < 100 / 2 && CLIENT_LIMITS.deviceLogin.limit < 120 / 2);
});

test('the probe trusts only a source the spoofed requests could not change', async () => {
  const { judge } = await import('../scripts/probe-client-ip.mjs');
  const real = '203.0.113.9';
  // As reported for Supabase's API: the client's X-Forwarded-For is kept first and the edge appends the real address.
  const appended = {
    plain: { forwardedFor: real },
    forwarded: { forwardedFor: `192.0.2.66, ${real}` },
    cloudflare: { cfConnectingIp: '192.0.2.77', forwardedFor: real },
    both: { cfConnectingIp: '192.0.2.77', forwardedFor: `192.0.2.66, ${real}` },
  };
  const verdicts = judge(appended);
  assert.deepEqual(
    [verdicts['forwarded-last'].trusted, verdicts['cf-connecting-ip'].trusted, verdicts['cf-connecting-ip'].reason],
    [true, false, 'missing-or-not-an-address'],
  );
  // Observed on Supabase Edge (2026-10-27): a spoofed CF-Connecting-IP is refused at the edge; X-Forwarded-For carries the
  // client twice and then an internal proxy, and a client-sent value is dropped.
  const observed = {
    plain: { cfConnectingIp: real, forwardedFor: `${real},${real}, 10.1.2.3` },
    forwarded: { cfConnectingIp: real, forwardedFor: `${real},${real}, 10.4.5.6` },
    cloudflare: { rejectedByEdge: true },
    both: { rejectedByEdge: true },
  };
  assert.deepEqual([judge(observed)['cf-connecting-ip'].trusted, judge(observed)['forwarded-last'].trusted], [true, false]);
  const overwritten = Object.fromEntries(Object.keys(appended).map(name => [name, { cfConnectingIp: real, forwardedFor: `${real}, 10.0.0.${name.length}` }]));
  assert.deepEqual([judge(overwritten)['cf-connecting-ip'].trusted, judge(overwritten)['forwarded-last'].reason], [true, 'unstable']);
});
