import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase } from './helpers/fighter-database.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { createHandler, sha256, VALIDATOR_VERSION } from '../api/handler.mjs';
import { SITE_CLIENT } from '../api/fighter-deletion.mjs';

test('owner deletion binds live identity, name, expiry and snapshot; removes visibility, frees one slot and retries safely', async () => {
  const db = await migratedDatabase();
  try {
    const owner = crypto.randomUUID(),
      other = crypto.randomUUID(),
      session = crypto.randomUUID(),
      client = crypto.randomUUID();
    await db.query('insert into auth.users(id) values($1),($2)', [owner, other]);
    await db.query('insert into auth.oauth_clients(id) values($1)', [client]);
    await db.query('insert into auth.sessions(id,user_id,oauth_client_id,scopes) values($1,$2,$3,$4)', [session, owner, client, 'openid email profile']);
    await db.query('insert into auth.oauth_consents(user_id,client_id,scopes) values($1,$2,$3)', [owner, client, 'openid email profile']);
    const profile = { name: 'Deletion fixture', description: 'Test only', portrait: '/art/character-profiles/test-v1.webp', color: '#ffeebb' };
    const create = () =>
      db
        .query('select to_jsonb(af_register_character_profile($1,$2,$3,$4)) value', [owner, crypto.randomUUID(), profile, 'kkumssi'])
        .then(r => r.rows[0].value);
    const f = await create(),
      second = await create(),
      third = await create();
    await assert.rejects(create(), /fighter-quota/);
    const prepare = (who = owner, id = f.id, s = session, c = client) =>
      db.query('select af_prepare_fighter_deletion($1,$2,$3,$4) value', [who, id, s, c]).then(r => r.rows[0].value);
    const remove = (d, name = d.confirmName, s = session) =>
      db.query('select af_delete_owned_fighter($1,$2,$3,$4,$5,$6) value', [owner, f.id, s, client, d.confirmationToken, name]).then(r => r.rows[0].value);
    const before = (await db.query('select * from af_fighters where id in ($1,$2) order by id', [second.id, third.id])).rows;
    await assert.rejects(prepare(other), /authentication-required/);
    const foreign = (await db.query('select to_jsonb(af_register_character_profile($1,$2,$3,null)) value', [other, crypto.randomUUID(), profile])).rows[0]
      .value;
    await assert.rejects(prepare(owner, foreign.id), /not-found/);
    let d = await prepare();
    assert.equal(d.stage, 'confirmation-required');
    assert.equal(d.ownerId, owner);
    assert.equal(d.effects.retainPrivatePackageAndHistory, true);
    assert.equal((await prepare()).confirmationToken, d.confirmationToken);
    await assert.rejects(remove({ ...d, confirmationToken: crypto.randomUUID() }), /invalid-deletion-confirmation/);
    await assert.rejects(remove(d, 'Another name'), /deletion-name-mismatch/);
    await assert.rejects(remove(d, d.confirmName, crypto.randomUUID()), /authentication-required/);
    const secondSession = crypto.randomUUID();
    await db.query('insert into auth.sessions(id,user_id,oauth_client_id,scopes) values($1,$2,$3,$4)', [secondSession, owner, client, 'openid email profile']);
    await assert.rejects(remove(d, d.confirmName, secondSession), /invalid-deletion-confirmation/);
    await db.query('update af_fighters set profile=profile||$1 where id=$2', [{ description: 'Changed after confirmation' }, f.id]);
    await assert.rejects(remove(d), /fighter-changed/);
    const old = d;
    d = await prepare();
    assert.notEqual(d.confirmationToken, old.confirmationToken);
    await assert.rejects(remove(old), /invalid-deletion-confirmation/);
    await db.query("update af_fighter_deletions set expires_at=now()-interval '1 second' where token=$1", [d.confirmationToken]);
    await assert.rejects(remove(d), /deletion-confirmation-expired/);
    d = await prepare();
    await db.exec('update auth.oauth_consents set revoked_at=now()');
    await assert.rejects(remove(d), /authentication-required/);
    await db.exec('update auth.oauth_consents set revoked_at=null');
    await db.exec('set role authenticated');
    await assert.rejects(prepare(), /permission denied/);
    await assert.rejects(remove(d), /permission denied/);
    await assert.rejects(db.query('select * from af_fighter_deletions'), /permission denied/);
    await db.exec('reset role; set role service_role');
    const result = await remove(d);
    assert.equal(result.stage, 'deleted');
    assert.equal(result.fighterSlotReleased, true);
    await db.exec('reset role');
    await db.query("update af_fighter_deletions set expires_at=now()-interval '1 second' where token=$1", [d.confirmationToken]);
    assert.deepEqual(await remove(d), result);
    assert.equal((await prepare()).stage, 'deleted');
    const row = (await db.query('select * from af_fighters where id=$1', [f.id])).rows[0];
    assert.ok(row.deleted_at);
    assert.equal(row.account_slot, null);
    assert.equal(row.runtime_approved, false);
    assert.equal(row.duel_approved, false);
    assert.equal(row.review_state, 'rejected');
    assert.equal(row.profile.name, profile.name);
    const audit = (await db.query('select snapshot from af_fighter_deletions where token=$1', [d.confirmationToken])).rows[0];
    assert.equal(audit.snapshot.worldMembership.fighter_id, f.id);
    assert.equal((await db.query('select * from af_world_fighters where fighter_id=$1', [f.id])).rows.length, 0);
    await assert.rejects(db.query('update af_fighters set deleted_at=null,account_slot=1 where id=$1', [f.id]), /fighter-deleted/);
    assert.deepEqual((await db.query('select * from af_fighters where id in ($1,$2) order by id', [second.id, third.id])).rows, before);
    const replacement = await create();
    assert.equal(replacement.account_slot, f.account_slot);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}'`);
    assert.equal((await db.query('select id from af_fighters where id=$1', [f.id])).rows.length, 0);
    assert.equal((await db.query('select id from af_fighters')).rows.length, 3);
    await db.exec('reset role; set role anon');
    assert.equal((await db.query('select id from af_public_character_profiles where id=$1', [f.id])).rows.length, 0);
  } finally {
    await db.close();
  }
});

test('deleting a registered fighter preserves its package and duel record, and allows a replacement upload', async () => {
  const db = await migratedDatabase();
  try {
    const owner = crypto.randomUUID(),
      session = crypto.randomUUID(),
      client = crypto.randomUUID();
    await db.query('insert into auth.users(id) values($1)', [owner]);
    await db.query('insert into af_creators(owner_id) values($1)', [owner]);
    await db.query('insert into auth.oauth_clients(id) values($1)', [client]);
    await db.query('insert into auth.sessions(id,user_id,oauth_client_id,scopes) values($1,$2,$3,$4)', [session, owner, client, 'openid email profile']);
    await db.query('insert into auth.oauth_consents(user_id,client_id,scopes) values($1,$2,$3)', [owner, client, 'openid email profile']);
    const text = JSON.stringify(example),
      hash = await sha256(new TextEncoder().encode(text)),
      bytes = example.assets.reduce((n, a) => n + a.bytes, 0);
    const upload = () =>
      db.query('select to_jsonb(af_create_submission($1,$2,$3,$4,$5)) value', [owner, crypto.randomUUID(), text, hash, bytes]).then(r => r.rows[0].value);
    const s = await upload();
    for (const a of example.assets)
      await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${s.id}/${a.id}.webp`, { size: a.bytes }]);
    await db.query('select af_submit($1,$2)', [owner, s.id]);
    const claim = (await db.query('select to_jsonb(af_claim($1)) value', [s.id])).rows[0].value;
    const done = (
      await db.query('select to_jsonb(af_finish($1,$2,$3,true,$4)) value', [
        s.id,
        claim.lease_token,
        hash,
        { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: [] },
      ])
    ).rows[0].value;
    const profile = { name: 'Test rival', description: 'Test only', portrait: '/art/character-profiles/test-v1.webp', color: '#ffeebb' };
    const rival = (await db.query('select to_jsonb(af_register_character_profile($1,$2,$3,null)) value', [owner, crypto.randomUUID(), profile])).rows[0].value;
    await db.query('select af_register_character_profile($1,$2,$3,null)', [owner, crypto.randomUUID(), profile]);
    await assert.rejects(upload(), /fighter-quota/);
    await db.query(
      `insert into af_duels(request_key,a,b,hash_a,hash_b,seed,engine,completed_at,winner,result)
      values($1,$2,$3,$4,$4,7,'test-v1',now(),$2,'{"winner":0}')`,
      [crypto.randomUUID(), done.fighter_id, rival.id, hash],
    );
    const history = (await db.query('select * from af_duels')).rows;
    // Entered (출전, 2026-10-30): deleting him clears the entry, which a deleted fighter may not hold.
    await db.query('select af_enter_fighter($1,$2,$3,$4)', [
      owner,
      done.fighter_id,
      hash,
      ['idle', 'walk', 'run', 'fightIdle', 'combo', 'slam', 'dash', 'block', 'hit', 'groggy', 'fall'],
    ]);
    const d = (await db.query('select af_prepare_fighter_deletion($1,$2,$3,$4) value', [owner, done.fighter_id, session, client])).rows[0].value;
    await db.query('select af_delete_owned_fighter($1,$2,$3,$4,$5,$6)', [owner, done.fighter_id, session, client, d.confirmationToken, d.confirmName]);
    assert.deepEqual((await db.query('select deleted_at is not null deleted,entered_at from af_fighters where id=$1', [done.fighter_id])).rows[0], {
      deleted: true,
      entered_at: null,
    });
    assert.deepEqual((await db.query('select * from af_duels')).rows, history);
    assert.equal((await db.query('select count(*)::int n from storage.objects')).rows[0].n, example.assets.length);
    assert.equal((await db.query('select manifest_text from af_submissions where id=$1', [s.id])).rows[0].manifest_text, text);
    assert.equal((await db.query('select * from af_duel_rankings() where id=$1', [done.fighter_id])).rows.length, 0);
    assert.equal((await upload()).status, 'uploading');
  } finally {
    await db.close();
  }
});

test('the site deletes with a live first-party session: the nil client, the same user, no OAuth client, not signed out or expired', async () => {
  const db = await migratedDatabase();
  try {
    const site = '00000000-0000-0000-0000-000000000000',
      owner = crypto.randomUUID(),
      other = crypto.randomUUID(),
      client = crypto.randomUUID();
    const session = crypto.randomUUID(),
      foreign = crypto.randomUUID(),
      connector = crypto.randomUUID(),
      expired = crypto.randomUUID();
    await db.query('insert into auth.users(id) values($1),($2)', [owner, other]);
    await db.query('insert into auth.oauth_clients(id) values($1)', [client]);
    await db.query('insert into auth.sessions(id,user_id) values($1,$2),($3,$4)', [session, owner, foreign, other]);
    await db.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()-interval '1 second')", [expired, owner]);
    await db.query('insert into auth.sessions(id,user_id,oauth_client_id,scopes) values($1,$2,$3,$4)', [connector, owner, client, 'openid email profile']);
    await db.query('insert into auth.oauth_consents(user_id,client_id,scopes) values($1,$2,$3)', [owner, client, 'openid email profile']);
    const profile = { name: 'Site deletion fixture', description: 'Test only', portrait: '/art/character-profiles/test-v1.webp', color: '#ffeebb' };
    const f = (await db.query('select to_jsonb(af_register_character_profile($1,$2,$3,null)) value', [owner, crypto.randomUUID(), profile])).rows[0].value;
    const prepare = (s = session, c = site) =>
      db.query('select af_prepare_fighter_deletion($1,$2,$3,$4) value', [owner, f.id, s, c]).then(r => r.rows[0].value);
    const remove = (d, s = session, c = site) =>
      db.query('select af_delete_owned_fighter($1,$2,$3,$4,$5,$6) value', [owner, f.id, s, c, d.confirmationToken, d.confirmName]).then(r => r.rows[0].value);
    await assert.rejects(prepare(foreign), /authentication-required/);
    await assert.rejects(prepare(expired), /authentication-required/);
    // A connector's session is not a site session, and a site session is no connector's.
    await assert.rejects(prepare(connector), /authentication-required/);
    await assert.rejects(prepare(session, client), /authentication-required/);
    const d = await prepare();
    assert.equal(d.stage, 'confirmation-required');
    assert.equal(d.confirmName, profile.name);
    // The connector's own confirmation for the same fighter is a separate one: neither token works for the other.
    const viaConnector = await prepare(connector, client);
    assert.notEqual(viaConnector.confirmationToken, d.confirmationToken);
    await assert.rejects(remove(viaConnector), /invalid-deletion-confirmation/);
    // Signing out deletes the session row; without it the confirmation is refused (the row is put back to go on).
    await db.query('delete from auth.sessions where id=$1', [session]);
    await assert.rejects(remove(d), /authentication-required/);
    await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session, owner]);
    const result = await remove(d);
    assert.equal(result.stage, 'deleted');
    assert.equal(result.fighterSlotReleased, true);
    assert.deepEqual(await remove(d), result);
    assert.equal((await db.query('select client_id from af_fighter_deletions where token=$1', [d.confirmationToken])).rows[0].client_id, site);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select af_owner_session_active($1,$2,$3)', [owner, session, site]), /permission denied/);
  } finally {
    await db.close();
  }
});

test('the site deletion route binds the signed-in session and the site client, checks the confirmation and maps refusals', async () => {
  const owner = crypto.randomUUID(),
    session = crypto.randomUUID(),
    fighter = crypto.randomUUID(),
    token = crypto.randomUUID(),
    calls = [];
  let claims = { sub: owner, session_id: session.toUpperCase() },
    refusal = null;
  const handle = createHandler({
    db: {
      auth: { getClaims: async () => ({ data: { claims } }) },
      rpc: async (name, args) => {
        calls.push([name, args]);
        if (name === 'af_authorize') return { data: true };
        if (refusal) return { error: { message: refusal } };
        return {
          data:
            name === 'af_prepare_fighter_deletion'
              ? { ok: true, stage: 'confirmation-required', confirmationToken: token, confirmName: '꿈돌이' }
              : { ok: true, stage: 'deleted', fighterId: fighter },
        };
      },
    },
  });
  const send = (path, body, method = 'POST') =>
    handle(
      new Request(`https://test/ai-fighter/fighters/${path}`, {
        method,
        headers: { authorization: 'Bearer signed-user-token-for-test', 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  const preflight = await handle(new Request(`https://test/ai-fighter/fighters/${fighter}/deletion`, { method: 'OPTIONS' }));
  assert.equal(preflight.status, 200);
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
  const prepared = await send(`${fighter.toUpperCase()}/deletion`);
  assert.equal(prepared.status, 200);
  assert.equal((await prepared.json()).confirmName, '꿈돌이');
  assert.deepEqual(calls.at(-1), ['af_prepare_fighter_deletion', { p_owner: owner, p_fighter: fighter, p_session: session, p_client: SITE_CLIENT }]);
  const done = await send(`${fighter}/deletion/confirm`, { confirmationToken: token, confirmName: '꿈돌이' });
  assert.equal(done.status, 200);
  assert.equal((await done.json()).stage, 'deleted');
  assert.deepEqual(calls.find(([name]) => name === 'af_delete_owned_fighter')[1], {
    p_owner: owner,
    p_fighter: fighter,
    p_session: session,
    p_client: SITE_CLIENT,
    p_token: token,
    p_confirm_name: '꿈돌이',
  });
  // Then his withdrawn profile sets' public copies (선수 프로필 세트, 2026-10-31).
  assert.deepEqual(calls.at(-1), ['af_profile_set_stale_public', { p_fighter: fighter }]);
  // Nothing reaches the database without a whole confirmation.
  calls.length = 0;
  for (const body of [
    { confirmationToken: token },
    { confirmationToken: 'nope', confirmName: '꿈돌이' },
    { confirmationToken: token, confirmName: '' },
    { confirmationToken: token, confirmName: '꿈돌이', confirm: true },
    [],
  ])
    assert.equal((await send(`${fighter}/deletion/confirm`, body)).status, 422);
  assert.equal((await send('not-an-id/deletion')).status, 400);
  assert.equal((await send(`${fighter}/deletion`, undefined, 'GET')).status, 404);
  assert.ok(!calls.some(([name]) => name !== 'af_authorize'));
  for (const [code, status] of [
    ['deletion-name-mismatch', 422],
    ['fighter-changed', 409],
    ['deletion-confirmation-expired', 409],
    ['invalid-deletion-confirmation', 409],
    ['not-found', 404],
    ['authentication-required', 401],
    ['something-else', 503],
  ]) {
    refusal = code;
    const answer = await send(`${fighter}/deletion/confirm`, { confirmationToken: token, confirmName: '꿈돌이' });
    assert.equal(answer.status, status);
    assert.equal((await answer.json()).code, code === 'something-else' ? 'database-unavailable' : code);
  }
  // A token naming no session, or a connector's token, cannot delete from the site.
  refusal = null;
  calls.length = 0;
  claims = { sub: owner };
  assert.equal((await send(`${fighter}/deletion`)).status, 401);
  claims = { sub: owner, session_id: session, client_id: crypto.randomUUID() };
  assert.equal((await send(`${fighter}/deletion`)).status, 401);
  assert.deepEqual(calls, []);
});
