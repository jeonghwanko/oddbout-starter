import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMigration, enforceSafeupdate, migrationNames, supabasePlatform } from './helpers/fighter-database.mjs';
import { createHandler } from '../api/handler.mjs';

test('owned statistics use all completed matches beyond top 20, preserve public ranking and enforce access', async () => {
  const sql = await supabasePlatform();
  try {
    const migrations = await migrationNames();
    // Compare rankings before and after this migration; later migrations apply after the comparison.
    const target = migrations.indexOf('20261020090000_ai_fighter_owned_statistics.sql');
    assert.ok(target > 0);
    for (const name of migrations.slice(0, target)) await applyMigration(sql, name);
    const owners = Array.from({ length: 23 }, () => crypto.randomUUID());
    const owner = owners[20],
      other = owners[0],
      ids = Array.from({ length: 23 }, () => crypto.randomUUID()),
      hash = 'a'.repeat(64);
    for (const [index, id] of ids.entries()) {
      const submission = crypto.randomUUID(),
        who = owners[index];
      await sql.query('insert into auth.users values($1)', [who]);
      await sql.query('insert into af_creators(owner_id,enabled) values($1,$2)', [who, index !== 20]);
      await sql.query(
        `insert into af_submissions(id,owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes,status)
        values($1,$2,$3,'{}','{}',$4,1,'registered')`,
        [submission, who, crypto.randomUUID(), hash],
      );
      await sql.query(
        `insert into af_fighters(id,submission_id,owner_id,manifest_sha,profile,review_state,runtime_approved,runtime_scope,runtime_manifest_sha,review_evidence,duel_approved,duel_manifest_sha)
        values($1,$2,$3,$4,$5,'approved',true,'arena-player-v1',$4,$6,true,$4)`,
        [id, submission, who, hash, { name: `Fighter ${index}` }, { authorization: 'fixture', validation: 'fixture', duelValidation: 'fixture' }],
      );
    }
    const record = async (a, b, winner, n) =>
      sql.query(
        `insert into af_duels(request_key,a,b,hash_a,hash_b,seed,engine,completed_at,winner,result)
      select gen_random_uuid(),$1,$2,$4,$4,0,'fixture',now(),$3,'{"winner":0}' from generate_series(1,$5::int)`,
        [a, b, winner, hash, n],
      );
    for (let index = 0; index <= 20; index++) await record(ids[index], ids[22], ids[index], 21 - index);
    await record(ids[0], ids[20], ids[0], 3); // Target also loses from corner B.
    await sql.query(
      `insert into af_duels(request_key,a,b,hash_a,hash_b,seed,engine)
      values(gen_random_uuid(),$1,$2,$3,$3,0,'unfinished')`,
      [ids[20], ids[22], hash],
    );
    const rankings = async () => (await sql.query('select to_jsonb(r) as record from af_duel_rankings() r')).rows.map(row => row.record);
    const before = await rankings();
    assert.equal(before.length, 20);
    assert.ok(before.every(row => row.id !== ids[20]));
    await applyMigration(sql, migrations[target]);
    assert.deepEqual(await rankings(), before); // Top-20 behavior and ties stay backward compatible.
    for (const name of migrations.slice(target + 1)) await applyMigration(sql, name);
    await enforceSafeupdate(sql); // Migrated in steps, so migratedDatabase() cannot add it.
    // Later the ranking also carries each fighter's per-language names (2026-10-29); the ranking itself stays as it was.
    const after = await rankings();
    assert.deepEqual(
      after.map(({ names, ...row }) => row),
      before,
    );
    assert.ok(after.every(row => 'names' in row));
    await sql.exec('set role service_role');
    const calls = [];
    const db = {
      auth: {
        getUser: async token =>
          token === 'fixture-owner-token'
            ? { data: { user: { id: owner } } }
            : token === 'fixture-zero-owner-token'
              ? { data: { user: { id: owners[21] } } }
              : token === 'fixture-anon-token'
                ? { data: { user: { id: owner, is_anonymous: true } } }
                : { error: new Error('invalid') },
      },
      rpc: async (name, args) => {
        calls.push({ name, args });
        assert.equal(name, 'af_owned_fighter_statistics');
        return {
          data: (await sql.query('select to_jsonb(r) as record from af_owned_fighter_statistics($1,$2) r', [args.p_owner, args.p_fighter])).rows.map(
            row => row.record,
          ),
        };
      },
    };
    const handle = createHandler({ db });
    const request = (id = ids[20], token = 'fixture-owner-token', method = 'GET', suffix = '') =>
      handle(
        new Request(`https://test/ai-fighter/fighters/${id}/statistics${suffix}`, {
          method,
          ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
        }),
      );
    const result = await request();
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(result.headers.get('access-control-allow-origin'), '*');
    const expected = { id: ids[20], appearances: 4, won: 1, lost: 3, points: 3, rank: 21 };
    assert.deepEqual(await result.json(), { ok: true, statistics: expected });
    assert.deepEqual((await (await request()).json()).statistics, expected); // A read cannot increment appearances.
    // A fighter with no completed match stayed out of the entry (20261030130000, "전적 있는 선수만 출전"): in production, so unranked.
    assert.deepEqual((await (await request(ids[21], 'fixture-zero-owner-token')).json()).statistics, {
      id: ids[21],
      appearances: 0,
      won: 0,
      lost: 0,
      points: 0,
      rank: null,
    });
    assert.equal((await request(ids[0], 'fixture-owner-token', 'GET', `?owner=${other}`)).status, 404);
    assert.equal((await request(crypto.randomUUID())).status, 404);
    assert.equal((await request(ids[20], null)).status, 401);
    assert.equal((await request(ids[20], 'fixture-anon-token')).status, 401);
    assert.equal((await request(ids[20], 'invalid-token-long-enough')).status, 401);
    assert.equal((await request('invalid')).status, 404);
    assert.equal((await request(ids[20], null, 'OPTIONS')).status, 200);
    assert.equal((await request(ids[20], null, 'OPTIONS')).headers.get('access-control-allow-headers'), 'Authorization, Content-Type');
    assert.equal((await request(ids[20], 'fixture-owner-token', 'POST')).status, 405);
    assert.ok(calls.every(call => [owner, owners[21]].includes(call.args.p_owner)));
    await sql.query('update af_fighters set duel_approved=false,duel_manifest_sha=null where id=$1', [ids[20]]);
    assert.deepEqual((await (await request()).json()).statistics, { ...expected, rank: null }); // Revoked admission retains history.
    await sql.exec('reset role');
    for (const role of ['anon', 'authenticated']) {
      await sql.exec(`set role ${role}`);
      await assert.rejects(sql.query('select * from af_owned_fighter_statistics($1,$2)', [owner, ids[20]]), /permission denied/);
      await assert.rejects(sql.query('select * from af_duel_statistics()'), /permission denied/);
      await assert.rejects(sql.query('select * from af_duels'), /permission denied/);
      await sql.exec('reset role');
    }
    const unsafe = await sql.query(`select proname from pg_proc where proname in ('af_duel_statistics','af_owned_fighter_statistics','af_duel_rankings')
      and (prosecdef or not ('search_path=""'=any(proconfig)))`);
    assert.equal(unsafe.rows.length, 0);
  } finally {
    await sql.close();
  }
});

test('statistics failure never becomes a zero record, and errors retain CORS without raw database messages', async () => {
  const owner = crypto.randomUUID(),
    fighter = crypto.randomUUID();
  for (const [error, status, code] of [
    [{ code: 'PGRST202', message: 'private SQL' }, 503, 'statistics-not-ready'],
    [{ message: 'private SQL' }, 503, 'statistics-unavailable'],
  ]) {
    const handle = createHandler({ db: { auth: { getUser: async () => ({ data: { user: { id: owner } } }) }, rpc: async () => ({ error }) } });
    const response = await handle(
      new Request(`https://test/ai-fighter/fighters/${fighter}/statistics`, { headers: { authorization: 'Bearer fixture-owner-token' } }),
    );
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { ok: false, code });
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
  }
});
