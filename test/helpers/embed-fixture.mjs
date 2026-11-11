import assert from 'node:assert/strict';
import { createHandler, sha256 } from '../../api/handler.mjs';
import { embedChallenge, issueEmbedLaunchGrant } from '../../api/embed.mjs';
import { migratedDatabase } from './fighter-database.mjs';
import example from '../../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };

export const ORIGIN = 'https://game.example';
export const RESULT = { winner: 0, how: 'ko', ms: 1000, hp: [0.5, 0], contacts: [3, 1], digest: '1234abcd' };
const RPC_ARGS = {
  af_embed_issue_grant: ['p_owner', 'p_session', 'p_client', 'p_attempt', 'p_challenge', 'p_origin', 'p_hash'],
  af_embed_exchange: ['p_hash', 'p_challenge', 'p_attempt', 'p_origin', 'p_token_hash'],
  af_embed_revoke_session: ['p_token_hash', 'p_origin'],
  af_embed_fighters: ['p_token_hash', 'p_origin'],
  af_embed_matches: ['p_token_hash', 'p_origin', 'p_id'],
  af_embed_reserve_match: ['p_token_hash', 'p_origin', 'p_key', 'p_a', 'p_b', 'p_hash_a', 'p_hash_b', 'p_engine', 'p_mode', 'p_official'],
  af_embed_complete_match: ['p_token_hash', 'p_origin', 'p_id', 'p_engine', 'p_result', 'p_official'],
};
export async function fixture({ origin = ORIGIN, beforeRun = null, official = false, includeRegistered = true, beforeOfficialRun = null } = {}) {
  const gameOrigin = origin;
  const sql = await migratedDatabase();
  const client = crypto.randomUUID(),
    identities = [],
    fighters = [];
  const manifestText = JSON.stringify(example),
    hash = await sha256(new TextEncoder().encode(manifestText));
  await sql.query('insert into auth.oauth_clients(id) values($1)', [client]);
  for (let i = 0; i < 3; i++) {
    const owner = crypto.randomUUID(),
      session = crypto.randomUUID();
    identities.push({ owner, claims: { session_id: session, client_id: client } });
    await sql.query('insert into auth.users(id) values($1)', [owner]);
    await sql.query('insert into af_creators(owner_id) values($1)', [owner]);
    await sql.query("insert into auth.sessions(id,user_id,oauth_client_id,scopes) values($1,$2,$3,'openid email profile')", [session, owner, client]);
    await sql.query("insert into auth.oauth_consents(user_id,client_id,scopes) values($1,$2,'openid email profile')", [owner, client]);
    if (i === 2 || !includeRegistered) continue; // The third account can try public fighters without claiming ownership.
    const submission = crypto.randomUUID(),
      id = crypto.randomUUID();
    fighters.push(id);
    await sql.query(
      `insert into af_submissions(id,owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes,status)
      values($1,$2,$3,$4,$5,$6,1,'registered')`,
      [submission, owner, crypto.randomUUID(), manifestText, example, hash],
    );
    await sql.query(
      `insert into af_fighters(id,submission_id,owner_id,manifest_sha,profile,review_state,runtime_approved,runtime_scope,
      runtime_manifest_sha,review_evidence,duel_approved,duel_manifest_sha,entered_at)
      values($1,$2,$3,$4,$5,'approved',true,'arena-player-v1',$4,$6,true,$4,now())`,
      [id, submission, owner, hash, { name: String.fromCharCode(65 + i) }, { authorization: 'test', validation: 'test', duelValidation: 'test' }],
    );
  }
  await sql.query('insert into af_creator_names(user_id,nickname) values($1,$2)', [identities[0].owner, 'Tester']);
  const db = {
    auth: { getClaims: async () => ({ data: { claims: null }, error: { message: 'invalid-token' } }) },
    rpc: async (name, args) => {
      assert.ok(Object.hasOwn(RPC_ARGS, name), `unexpected RPC ${name}`);
      try {
        const keys = RPC_ARGS[name].filter(key => Object.hasOwn(args, key));
        const values = keys.map(key => args[key]);
        const placeholders = keys.map((key, i) => key + ' => $' + (i + 1)).join(',');
        const query =
          name === 'af_embed_matches'
            ? `select to_jsonb(m) as value from public.${name}(${placeholders}) m`
            : `select to_jsonb(public.${name}(${placeholders})) as value`;
        const result = await sql.query(query, values);
        return { data: name === 'af_embed_matches' ? result.rows.map(row => row.value) : result.rows[0].value };
      } catch (error) {
        return { error };
      }
    },
    from: table => {
      assert.ok(['af_fighters', 'af_submissions'].includes(table));
      const filters = [],
        values = [];
      const q = {
        select: () => q,
        eq: (column, value) => {
          assert.match(column, /^\w+$/);
          values.push(value);
          filters.push(`${column}=$${values.length}`);
          return q;
        },
        maybeSingle: async () => ({ data: (await sql.query(`select * from ${table} where ${filters.join(' and ')}`, values)).rows[0] ?? null }),
      };
      return q;
    },
  };
  let calls = 0,
    officialCalls = 0;
  const officialPractice = official
    ? {
        engine: 'official-test-v1',
        fighters: [
          { id: 'academy-one', name: '공식 하나', manifestSha256: 'a'.repeat(64) },
          { id: 'academy-two', name: '공식 둘', manifestSha256: 'b'.repeat(64) },
        ],
        simulate: async (a, b, seed) => {
          officialCalls++;
          if (beforeOfficialRun) await beforeOfficialRun();
          assert.equal(a, 'academy-one');
          assert.equal(b, 'academy-two');
          assert.ok(seed >= 0 && seed <= 0xffffffff);
          return RESULT;
        },
      }
    : null;
  const handle = createHandler({
    db,
    embed: { enabled: true, gameOrigin },
    officialPractice,
    engineVersion: 'test-v1',
    simulateDuel: async (a, ma, b, mb, seed) => {
      calls++;
      if (beforeRun) await beforeRun();
      assert.ok(fighters.includes(a) && fighters.includes(b));
      assert.deepEqual(ma, example);
      assert.deepEqual(mb, example);
      assert.ok(seed >= 0 && seed <= 0xffffffff);
      return RESULT;
    },
  });
  const request = (path, { token, body, method = body ? 'POST' : 'GET', origin = gameOrigin } = {}) => {
    const headers = new Headers();
    if (origin) headers.set('origin', origin);
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (body) headers.set('content-type', 'application/json');
    return handle(new Request(`https://api.example/ai-fighter/embed/${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
  };
  const launch = async (identity = identities[0], attemptId = crypto.randomUUID()) => {
    const verifier = 'v'.repeat(64);
    const issued = await issueEmbedLaunchGrant({ db, identity, attemptId, challenge: await embedChallenge(verifier), gameOrigin, enabled: true });
    return { ...issued, attemptId, verifier };
  };
  const exchange = async (grant = null) => {
    const issued = grant ?? (await launch());
    const response = await request('exchange', { body: { grant: issued.grant, attemptId: issued.attemptId, verifier: issued.verifier } });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    return response.json();
  };
  const matchBody = () => ({ a: fighters[0], b: fighters[1], hashes: [hash, hash], engine: 'test-v1', idempotencyKey: crypto.randomUUID() });
  const officialBody = () => ({
    mode: 'official',
    a: 'academy-one',
    b: 'academy-two',
    hashes: ['a'.repeat(64), 'b'.repeat(64)],
    engine: 'official-test-v1',
    idempotencyKey: crypto.randomUUID(),
  });
  const officialAdmission = () => ({
    engine: officialPractice.engine,
    fighters: officialPractice.fighters.map(({ id, manifestSha256 }) => ({ id, manifestSha256 })),
  });
  return {
    sql,
    db,
    handle,
    request,
    launch,
    exchange,
    matchBody,
    officialBody,
    officialAdmission,
    officialPractice,
    identities,
    fighters,
    hash,
    calls: () => calls,
    officialCalls: () => officialCalls,
  };
}
