import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase } from './helpers/fighter-database.mjs';
import { createHandler } from '../api/handler.mjs';
import { createCreatorLink } from '../api/creator-link.mjs';

test('verified accounts can submit without invitations, including prior declines and expiry', async () => {
  const sql = await migratedDatabase();
  try {
    const owner = crypto.randomUUID(),
      disabled = crypto.randomUUID();
    await sql.query('insert into auth.users values($1),($2)', [owner, disabled]);
    await sql.query("insert into af_access_requests(owner_id,status) values($1,'declined')", [owner]);
    await sql.query('insert into af_creators(owner_id,enabled) values($1,false)', [disabled]);
    const db = {
      auth: {
        getUser: async token =>
          token === 'fixture-owner-token'
            ? { data: { user: { id: owner } } }
            : token === 'fixture-anon-token'
              ? { data: { user: { id: owner, is_anonymous: true } } }
              : { error: { message: 'invalid' } },
      },
      rpc: async (name, args) => {
        try {
          return { data: (await sql.query('select ' + name + '($1) as result', [args.p_owner])).rows[0].result };
        } catch (error) {
          return { error: { message: error.message } };
        }
      },
    };
    const handle = createHandler({ db }),
      call = token => handle(new Request('https://test/ai-fighter/me', { headers: token ? { authorization: 'Bearer ' + token } : {} }));
    assert.equal((await call()).status, 401);
    assert.equal((await call('fixture-anon-token')).status, 401);
    // 보유 토큰 (2026-10-31): the account carries its tokens, 500,000 to start.
    assert.deepEqual((await (await call('fixture-owner-token')).json()).account, {
      invited: true,
      expiresAt: null,
      request: null,
      accessMode: 'open',
      canSubmit: true,
      fighterLimit: 3,
      tokens: { granted: 500000, spent: 0, balance: 500000 },
    });
    await sql.exec('set role service_role');
    assert.equal((await sql.query('select af_authorize($1) as ok', [owner])).rows[0].ok, true);
    await sql.query("update af_creators set expires_at=now()-interval '1 day' where owner_id=$1", [owner]);
    assert.equal((await sql.query('select af_authorize($1) as ok', [owner])).rows[0].ok, true);
    await assert.rejects(sql.query('select af_authorize($1)', [disabled]), /account-disabled/);
    assert.equal((await sql.query('select af_account($1) as a', [disabled])).rows[0].a.canSubmit, false);
    assert.equal((await sql.query('select af_request_access($1,$2) as a', [owner, ''])).rows[0].a.canSubmit, true);
    await sql.query('update af_creators set fighter_limit=10 where owner_id=$1', [owner]);
    assert.equal((await sql.query('select af_account($1) as a', [owner])).rows[0].a.fighterLimit, 10);
    await sql.exec('reset role; set role authenticated');
    await assert.rejects(sql.query('select * from af_creators'), /permission denied/);
    await assert.rejects(sql.query('select af_authorize($1)', [owner]), /permission denied/);
    await assert.rejects(sql.query('select af_account($1)', [owner]), /permission denied/);
  } finally {
    await sql.close();
  }
});

test('a signed-in user gets a one-use homepage token for their own account only', async () => {
  const owner = crypto.randomUUID(),
    other = crypto.randomUUID(),
    hash = 'a'.repeat(56);
  const emails = { [owner]: 'creator@example.test', [other]: '' };
  const minted = [];
  const admin = {
    getUserById: async id => (emails[id] === undefined ? { error: new Error('missing') } : { data: { user: { id, email: emails[id] || null } } }),
    generateLink: async ({ type, email }) => {
      minted.push({ type, email });
      const id = Object.keys(emails).find(key => emails[key] === email);
      return { data: { user: { id }, properties: { hashed_token: hash, action_link: 'https://auth.example/verify?token=secret' } } };
    },
  };
  const tokens = { 'fixture-owner-token': owner, 'fixture-other-token': other };
  const db = { auth: { admin, getUser: async token => (tokens[token] ? { data: { user: { id: tokens[token] } } } : { error: new Error('invalid') }) } };
  const handle = createHandler({ db, creatorLink: createCreatorLink({ db, now: () => Date.parse('2026-10-20T00:00:00Z') }) });
  const post = (token, init = {}) =>
    handle(new Request('https://test/ai-fighter/creator-handoffs', { method: 'POST', ...init, headers: token ? { authorization: `Bearer ${token}` } : {} }));

  assert.equal((await post()).status, 401);
  assert.equal((await post('fixture-unknown-token')).status, 401);
  assert.equal((await post('fixture-owner-token', { method: 'GET' })).status, 405);

  // A user named in the body is ignored: the verified token alone picks the account.
  const response = await post('fixture-owner-token', { body: JSON.stringify({ owner: other }) });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, { ok: true, stage: 'creator-link', tokenHash: hash, expiresAt: '2026-10-20T00:10:00.000Z' });
  assert.deepEqual(minted, [{ type: 'magiclink', email: 'creator@example.test' }]);
  assert.ok(!JSON.stringify(body).includes('secret'), 'the emailed action link never leaves the server');

  const noEmail = await post('fixture-other-token');
  assert.equal(noEmail.status, 422);
  assert.equal((await noEmail.json()).code, 'handoff-email-required');

  // A token Auth issued for a different user is refused.
  admin.generateLink = async () => ({ data: { user: { id: other }, properties: { hashed_token: hash } } });
  const mismatch = await post('fixture-owner-token');
  assert.equal(mismatch.status, 503);
  assert.equal((await mismatch.json()).code, 'handoff-unavailable');

  // Without the Auth admin wiring the route says so instead of failing open.
  const bare = createHandler({ db });
  assert.equal(
    (
      await (
        await bare(new Request('https://test/ai-fighter/creator-handoffs', { method: 'POST', headers: { authorization: 'Bearer fixture-owner-token' } }))
      ).json()
    ).code,
    'handoff-unavailable',
  );
});
