import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMigration, migrationNames, supabasePlatform } from './helpers/fighter-database.mjs';

const scopes = 'openid email profile';
const migration = (await migrationNames()).find(name => name.endsWith('_oddbout_oauth_grant_limit.sql'));
assert.ok(migration);

async function authFixture(t) {
  const db = await supabasePlatform();
  t.after(() => db.close());
  const clients = Array.from({ length: 5 }, () => crypto.randomUUID());
  const owner = crypto.randomUUID();
  const other = crypto.randomUUID();
  await db.query('insert into auth.users(id) values ($1), ($2)', [owner, other]);
  await db.query('insert into auth.oauth_clients(id) select unnest($1::uuid[])', [clients]);
  const grant = (user, client) =>
    db.query('insert into auth.oauth_consents(user_id,client_id,scopes) values($1,$2,$3)', [user, client, scopes]);
  const active = async user =>
    (await db.query(`select client_id from auth.oauth_consents g join auth.oauth_clients c on c.id = g.client_id
      where g.user_id = $1 and g.revoked_at is null and c.deleted_at is null order by client_id`, [user])).rows.map(row => row.client_id);
  return { db, clients, owner, other, grant, active };
}

test('initial reset only revokes every OAuth grant, session and usable code of owners above the limit', async t => {
  const { db, clients, owner, other, grant, active } = await authFixture(t);
  const [first, second, third, fourth, deleted] = clients;
  await db.query('update auth.oauth_clients set deleted_at=now() where id=$1', [deleted]);
  for (const client of clients) await grant(owner, client);
  for (const client of [first, second, third, deleted]) await grant(other, client);

  const [removedFirst, removedSecond, unaffected, browser] = Array.from({ length: 4 }, () => crypto.randomUUID());
  await db.query(
    'insert into auth.sessions(id,user_id,oauth_client_id) values ($1,$5,$7), ($2,$5,$7), ($3,$6,$7), ($4,$5,null)',
    [removedFirst, removedSecond, unaffected, browser, owner, other, first],
  );
  await db.query('insert into auth.refresh_tokens(id,session_id) values (1,$1),(2,$2),(3,$3),(4,$4)', [
    removedFirst, removedSecond, unaffected, browser,
  ]);

  const [pending, approved, expired, otherApproved, unbound] = Array.from({ length: 5 }, () => crypto.randomUUID());
  await db.query(`insert into auth.oauth_authorizations(id,user_id,client_id,status,expires_at) values
    ($1,$6,$8,'pending',now()+interval '1 hour'),
    ($2,$6,$8,'approved',now()+interval '1 hour'),
    ($3,$6,$8,'approved',now()-interval '1 hour'),
    ($4,$7,$8,'approved',now()+interval '1 hour'),
    ($5,null,$8,'pending',now()+interval '1 hour')`, [pending, approved, expired, otherApproved, unbound, owner, other, fourth]);

  await applyMigration(db, migration);
  assert.deepEqual(await active(owner), []);
  assert.equal((await db.query('select count(*)::int as n from auth.oauth_consents where user_id=$1 and revoked_at is not null', [owner])).rows[0].n, 5);
  assert.deepEqual(await active(other), [first, second, third].sort());
  assert.deepEqual((await db.query('select id from auth.sessions order by id')).rows.map(row => row.id), [unaffected, browser].sort());
  assert.deepEqual((await db.query('select id::int from auth.refresh_tokens order by id')).rows.map(row => row.id), [3, 4]);
  assert.deepEqual((await db.query('select id from auth.oauth_authorizations order by id')).rows.map(row => row.id), [expired, otherApproved, unbound].sort());
});

test('a fourth distinct active client rolls back approval and a revoked slot can be reused', async t => {
  const { db, clients, owner, other, grant, active } = await authFixture(t);
  const [first, second, third, fourth, deleted] = clients;
  await applyMigration(db, migration);
  await db.query('update auth.oauth_clients set deleted_at=now() where id=$1', [deleted]);
  for (const client of [first, second, third, deleted]) await grant(owner, client);
  await grant(other, fourth);

  await db.query('update auth.oauth_consents set revoked_at=null, granted_at=now() where user_id=$1 and client_id=$2', [owner, first]);
  const authorization = crypto.randomUUID();
  await db.query(`insert into auth.oauth_authorizations(id,user_id,client_id,status,expires_at)
    values($1,$2,$3,'pending',now()+interval '1 hour')`, [authorization, owner, fourth]);
  await assert.rejects(
    db.transaction(async tx => {
      await tx.query("update auth.oauth_authorizations set status='approved' where id=$1", [authorization]);
      await tx.query('insert into auth.oauth_consents(user_id,client_id,scopes) values($1,$2,$3)', [owner, fourth, scopes]);
    }),
    { code: '23514', message: /ai_fighter_oauth_grant_limit/ },
  );
  assert.equal((await db.query('select status from auth.oauth_authorizations where id=$1', [authorization])).rows[0].status, 'pending');

  await db.query('update auth.oauth_consents set revoked_at=now() where user_id=$1 and client_id=$2', [owner, first]);
  await grant(owner, fourth);
  await assert.rejects(
    db.query('update auth.oauth_consents set revoked_at=null, granted_at=now() where user_id=$1 and client_id=$2', [owner, first]),
    { code: '23514', message: /ai_fighter_oauth_grant_limit/ },
  );
  assert.deepEqual(await active(owner), [second, third, fourth].sort());
  assert.deepEqual(await active(other), [fourth]);
});
