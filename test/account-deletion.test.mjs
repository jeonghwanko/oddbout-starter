import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHandler } from '../api/handler.mjs';
import { migratedDatabase } from './helpers/fighter-database.mjs';

test('only a live first-party session can confirm its own account deletion', async () => {
  const owner = crypto.randomUUID(), other = crypto.randomUUID(), session = crypto.randomUUID();
  let eligibility = 'eligible', claims = { sub: owner, session_id: session, role: 'authenticated' };
  const deleted = [], checked = [];
  const route = createHandler({ db: {
    auth: {
      getClaims: async () => ({ data: { claims } }),
      admin: { deleteUser: async id => { deleted.push(id); return { error: null }; } },
    },
    rpc: async (name, args) => { checked.push([name, args]); return { data: eligibility }; },
  } });
  const request = (id = owner, token = true, method = 'POST') => route(new Request('https://example.test/functions/v1/ai-fighter/account/deletion', {
    method,
    headers: token ? { authorization: 'Bearer locally-verified-test-token', 'content-type': 'application/json' } : {},
    ...(method === 'POST' ? { body: JSON.stringify({ confirmAccount: id }) } : {}),
  }));

  assert.match((await request(owner, false, 'OPTIONS')).headers.get('access-control-allow-headers'), /apikey/);
  assert.equal((await request(owner, false, 'GET')).status, 404);
  assert.equal((await request(owner, false)).status, 401);
  assert.equal((await request(other)).status, 422);
  claims = { ...claims, client_id: other };
  assert.equal((await request()).status, 401);
  assert.equal(checked.length, 0);

  claims = { sub: owner, session_id: session, role: 'authenticated' };
  eligibility = 'sign-in';
  assert.equal((await request()).status, 401);
  eligibility = 'support';
  assert.equal((await request()).status, 409);
  assert.deepEqual(deleted, []);
  eligibility = 'eligible';
  const response = await request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, deleted: true });
  assert.deepEqual(deleted, [owner]);
  assert.deepEqual(checked.at(-1), ['af_account_deletion_eligibility', { p_owner: owner, p_session: session }]);
});

test('the migration permits an empty creator to leave and preserves submitted packages and private originals', async () => {
  const db = await migratedDatabase();
  try {
    const owner = crypto.randomUUID(), creator = crypto.randomUUID(), sourceOwner = crypto.randomUUID(), session = crypto.randomUUID();
    const eligibility = id => db.query('select public.af_account_deletion_eligibility($1,$2) as value', [id, session]).then(r => r.rows[0].value);
    const remove = id => db.query('delete from auth.users where id=$1', [id]);
    await db.query('insert into auth.users(id) values($1),($2),($3)', [owner, creator, sourceOwner]);
    await db.query('insert into public.af_creators(owner_id) values($1),($2)', [owner, creator]);
    await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session, owner]);
    assert.equal(await eligibility(owner), 'eligible');
    assert.equal(await eligibility(creator), 'sign-in');
    await db.exec('set role authenticated');
    await assert.rejects(eligibility(owner), /permission denied/);
    await db.exec('reset role');

    await db.query(`insert into public.af_submissions(owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes)
      values($1,gen_random_uuid(),'{}','{}',repeat('0',64),1)`, [creator]);
    await db.query('update auth.sessions set user_id=$1 where id=$2', [creator, session]);
    assert.equal(await eligibility(creator), 'support');
    await assert.rejects(remove(creator), error => error.code === '23503');

    await db.query(`insert into public.af_creator_sources(owner_id,idempotency_key,sha256,bytes,width,height)
      values($1,gen_random_uuid(),repeat('0',64),33,16,16)`, [sourceOwner]);
    await db.query('update auth.sessions set user_id=$1 where id=$2', [sourceOwner, session]);
    assert.equal(await eligibility(sourceOwner), 'support');
    await assert.rejects(remove(sourceOwner), /af_creator_sources_owner_id_fkey/);

    assert.equal((await remove(owner)).affectedRows, 1);
    assert.deepEqual((await db.query('select owner_id from public.af_creators')).rows, [{ owner_id: creator }]);
    assert.equal((await db.query('select count(*)::int as count from auth.users')).rows[0].count, 2);
  } finally {
    await db.close();
  }
});
