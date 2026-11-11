import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, sha256 } from '../api/handler.mjs';
import { embedChallenge, embedEnabled } from '../api/embed.mjs';
import { fixture, ORIGIN, RESULT } from './helpers/embed-fixture.mjs';

test('embed is disabled by default, requires an exact HTTPS origin and implements standard S256', async () => {
  assert.equal(await embedChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  for (const config of [
    null,
    {},
    { enabled: true },
    { enabled: true, gameOrigin: 'http://game.example' },
    { enabled: true, gameOrigin: ORIGIN + '/' },
    { enabled: true, gameOrigin: ORIGIN + '/path' },
  ])
    assert.equal(embedEnabled(config), false);
  let used = false;
  const db = {
    rpc: () => {
      used = true;
      throw Error('unreachable');
    },
  };
  const disabled = createHandler({ db });
  assert.equal((await disabled(new Request('https://api.example/embed/exchange', { method: 'POST' }))).status, 404);
  assert.equal(used, false);
  const enabled = createHandler({ db, embed: { enabled: true, gameOrigin: ORIGIN } });
  for (const origin of [null, 'https://attacker.example', 'null']) {
    const response = await enabled(new Request('https://api.example/embed/exchange', { method: 'OPTIONS', headers: origin ? { origin } : {} }));
    assert.equal(response.status, 403);
    assert.equal(response.headers.has('access-control-allow-origin'), false);
  }
  const preflight = await enabled(new Request('https://api.example/embed/exchange', { method: 'OPTIONS', headers: { origin: ORIGIN } }));
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
});

test('launch is single use, bound to attempt/PKCE/origin and stores hashes only; revocation and expiry are immediate', async () => {
  const f = await fixture();
  try {
    const issued = await f.launch();
    assert.match(issued.grant, /^afg_[a-f0-9]{64}$/);
    const stored = (await f.sql.query('select * from af_embed_grants')).rows[0];
    assert.equal(stored.grant_hash, await sha256(new TextEncoder().encode(issued.grant)));
    assert.equal(JSON.stringify(stored).includes(issued.grant), false);
    assert.equal(Date.parse(stored.expires_at) - Date.parse(stored.created_at), 60_000);
    for (const edit of [{ verifier: 'x'.repeat(64) }, { attemptId: crypto.randomUUID() }]) {
      const r = await f.request('exchange', { body: { grant: issued.grant, verifier: issued.verifier, attemptId: issued.attemptId, ...edit } });
      assert.equal(r.status, 401);
    }
    assert.equal(
      (
        await f.request('exchange', {
          origin: 'https://attacker.example',
          body: { grant: issued.grant, verifier: issued.verifier, attemptId: issued.attemptId },
        })
      ).status,
      403,
    );
    const response = await f.exchange(issued),
      token = response.token;
    assert.match(token, /^afe_[a-f0-9]{64}$/);
    assert.deepEqual(response.account, { id: f.identities[0].owner, name: 'Tester' });
    const session = (await f.sql.query('select * from af_embed_sessions')).rows[0];
    assert.equal(JSON.stringify(session).includes(token), false);
    assert.equal(Date.parse(session.expires_at) - Date.parse(session.created_at), 900_000);
    assert.equal((await f.sql.query('select count(*)::int as n from af_embed_matches')).rows[0].n, 0);
    assert.equal((await f.request('exchange', { body: { grant: issued.grant, verifier: issued.verifier, attemptId: issued.attemptId } })).status, 401);
    assert.equal((await f.request('fighters', { token })).status, 200);
    assert.equal((await f.handle(new Request('https://api.example/ai-fighter/me', { headers: { authorization: `Bearer ${token}` } }))).status, 401);
    assert.equal((await f.request('fighters', { token: 'web-or-oauth-token' })).status, 401);
    await f.sql.query('update auth.oauth_consents set revoked_at=now() where user_id=$1', [f.identities[0].owner]);
    assert.equal((await f.request('fighters', { token })).status, 401);
    await f.sql.query('update auth.oauth_consents set revoked_at=null where user_id=$1', [f.identities[0].owner]);
    await f.request('session', { token, method: 'DELETE' });
    assert.equal((await f.request('fighters', { token })).status, 401);
    const second = await f.exchange();
    await f.sql.query("update af_embed_sessions set expires_at=now()-interval '1 second' where token_hash=$1", [
      await sha256(new TextEncoder().encode(second.token)),
    ]);
    assert.equal((await f.request('fighters', { token: second.token })).status, 401);
    const expired = await f.launch();
    await f.sql.query("update af_embed_grants set expires_at=now()-interval '1 second' where grant_hash=$1", [
      await sha256(new TextEncoder().encode(expired.grant)),
    ]);
    assert.equal((await f.request('exchange', { body: { grant: expired.grant, verifier: expired.verifier, attemptId: expired.attemptId } })).status, 401);
    const reissued = await f.launch(f.identities[0], issued.attemptId);
    const active = await f.exchange(reissued);
    await f.launch(f.identities[0], issued.attemptId);
    assert.equal((await f.request('fighters', { token: active.token })).status, 401);
    const concurrent = await f.launch(f.identities[1]);
    const exchanges = await Promise.all(
      [1, 2].map(() => f.request('exchange', { body: { grant: concurrent.grant, verifier: concurrent.verifier, attemptId: concurrent.attemptId } })),
    );
    assert.deepEqual(exchanges.map(r => r.status).sort(), [200, 401]);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await f.sql.exec(`set role ${role}`);
      await assert.rejects(f.sql.query('select * from af_embed_grants'), /permission denied/);
      await assert.rejects(f.sql.query('select * from af_embed_sessions'), /permission denied/);
      await assert.rejects(f.sql.query('select * from af_embed_matches'), /permission denied/);
      if (role !== 'service_role') await assert.rejects(f.sql.query('select af_embed_fighters($1,$2)', ['0'.repeat(64), ORIGIN]), /permission denied/);
      await assert.rejects(
        f.sql.query('select af_embed_connection_active($1,$2,$3)', [
          f.identities[0].owner,
          f.identities[0].claims.session_id,
          f.identities[0].claims.client_id,
        ]),
        /permission denied/,
      );
      await f.sql.exec('reset role');
    }
  } finally {
    await f.sql.close();
  }
});

test('private practice shares package validation and engine, atomically binds key/input/owner, recovers pending and never ranks', async () => {
  let releaseRun, startedRun;
  const gate = new Promise(resolve => {
    releaseRun = resolve;
  });
  const started = new Promise(resolve => {
    startedRun = resolve;
  });
  const f = await fixture({
    beforeRun: () => {
      startedRun();
      return gate;
    },
  });
  try {
    const { token } = await f.exchange();
    const roster = await (await f.request('fighters', { token })).json();
    assert.equal(roster.engine, 'test-v1');
    assert.deepEqual(
      roster.fighters.map(x => [x.id, x.manifestSha256, x.owned]),
      [
        [f.fighters[0], f.hash, true],
        [f.fighters[1], f.hash, false],
      ],
    );
    const guest = await f.exchange(await f.launch(f.identities[2]));
    const guestRoster = await (await f.request('fighters', { token: guest.token })).json();
    assert.ok(guestRoster.fighters.every(x => x.owned === false));
    const body = f.matchBody();
    for (const extra of [{ seed: 1 }, { result: RESULT }, { owner: f.identities[1].owner }])
      assert.equal((await f.request('matches', { token, body: { ...body, ...extra } })).status, 422);
    assert.equal((await f.request('matches', { token, body: { ...body, engine: 'unknown' } })).status, 409);
    assert.equal((await f.request('matches', { token, body: { ...body, hashes: ['0'.repeat(64), f.hash] } })).status, 409);
    const first = f.request('matches', { token, body });
    await started;
    const responses = await Promise.all([2, 3].map(() => f.request('matches', { token, body })));
    assert.ok(responses.every(r => r.status === 409));
    for (const response of responses) assert.equal((await response.json()).code, 'match-busy');
    releaseRun();
    const completed = await first;
    assert.equal(completed.status, 200);
    const { match } = await completed.json();
    assert.equal(f.calls(), 1);
    assert.deepEqual(match.result, RESULT);
    assert.equal(match.idempotencyKey, body.idempotencyKey);
    const before = f.calls();
    assert.equal((await f.request('matches', { token, body })).status, 200);
    assert.equal(f.calls(), before);
    for (const input of [{ a: body.b, b: body.a }, { hashes: ['0'.repeat(64), f.hash] }])
      assert.equal((await f.request('matches', { token, body: { ...body, ...input } })).status, 409);
    const other = await f.exchange(await f.launch(f.identities[1]));
    assert.equal((await f.request(`matches/${match.id}`, { token: other.token })).status, 404);
    assert.equal((await f.request('matches', { token: other.token, body })).status, 200); // Account scopes a key.
    const tokenHash = await sha256(new TextEncoder().encode(token)),
      pendingBody = f.matchBody();
    const pending = await f.db.rpc('af_embed_reserve_match', {
      p_token_hash: tokenHash,
      p_origin: ORIGIN,
      p_key: pendingBody.idempotencyKey,
      p_a: pendingBody.a,
      p_b: pendingBody.b,
      p_hash_a: f.hash,
      p_hash_b: f.hash,
      p_engine: pendingBody.engine,
    });
    assert.ok(pending.data.id);
    const list = await (await f.request('matches', { token })).json();
    assert.equal(list.matches.length, 1);
    assert.equal(list.pending.length, 1);
    assert.equal(list.pending[0].idempotencyKey, pendingBody.idempotencyKey);
    assert.equal((await f.request(`matches/${pending.data.id}`, { token })).status, 202);
    assert.equal((await f.request('matches', { token, body: pendingBody })).status, 409);
    await f.sql.query("update af_embed_matches set last_run_at=now()-interval '31 seconds' where id=$1", [pending.data.id]);
    assert.equal((await f.request('matches', { token, body: pendingBody })).status, 200);
    await f.sql.query('update af_fighters set entered_at=null where id=$1', [body.b]);
    assert.equal((await f.request('matches', { token, body: f.matchBody() })).status, 409);
    assert.equal((await f.request('matches', { token, body })).status, 200); // Stored result survives roster changes.
    await f.sql.query('update af_fighters set entered_at=now() where id=$1', [body.b]);
    // Registered submissions are immutable. Corrupt the adapter's returned bytes, as a storage/transport defect, without rewriting one.
    const originalFrom = f.db.from;
    f.db.from = table => {
      const query = originalFrom(table);
      if (table === 'af_submissions') {
        const read = query.maybeSingle;
        query.maybeSingle = async () => {
          const response = await read();
          return { ...response, data: response.data ? { ...response.data, manifest_text: response.data.manifest_text + ' ' } : null };
        };
      }
      return query;
    };
    try {
      assert.equal((await f.request('matches', { token, body: f.matchBody() })).status, 409);
    } finally {
      f.db.from = originalFrom;
    }
    assert.equal((await f.sql.query('select count(*)::int as n from af_duels')).rows[0].n, 0);
    assert.equal((await f.sql.query('select coalesce(sum(appearances),0)::int as n from af_duel_statistics()')).rows[0].n, 0);
    assert.deepEqual((await f.sql.query("select tgname from pg_trigger where tgrelid='af_embed_matches'::regclass and not tgisinternal")).rows, []);
    // Account disable and sign-out also stop a live credential, without waiting for its fifteen-minute expiry.
    await f.sql.query('update af_creators set enabled=false where owner_id=$1', [f.identities[0].owner]);
    assert.equal((await f.request('matches', { token })).status, 401);
    await f.sql.query('update af_creators set enabled=true where owner_id=$1', [f.identities[0].owner]);
    await f.sql.query('delete from auth.sessions where id=$1', [f.identities[0].claims.session_id]);
    assert.equal((await f.request('matches', { token })).status, 401);
  } finally {
    await f.sql.close();
  }
});

test('private admission limits concurrent unfinished requests and UTC daily spend without charging retries', async () => {
  const f = await fixture();
  try {
    const { token } = await f.exchange();
    const tokenHash = await sha256(new TextEncoder().encode(token));
    const reserve = body =>
      f.db.rpc('af_embed_reserve_match', {
        p_token_hash: tokenHash,
        p_origin: ORIGIN,
        p_key: body.idempotencyKey,
        p_a: body.a,
        p_b: body.b,
        p_hash_a: body.hashes[0],
        p_hash_b: body.hashes[1],
        p_engine: body.engine,
      });
    const bodies = [f.matchBody(), f.matchBody(), f.matchBody()];
    const rows = await Promise.all(bodies.map(reserve));
    assert.ok(rows.every(x => x.data?.id));
    assert.equal((await f.request('matches', { token, body: f.matchBody() })).status, 429);
    assert.equal((await reserve(bodies[0])).error.message, 'match-busy');
    await f.sql.query("update af_embed_matches set last_run_at=now()-interval '31 seconds' where id=$1", [rows[0].data.id]);
    assert.equal((await f.request('matches', { token, body: bodies[0] })).status, 200);
    for (let attempt = 2; attempt <= 5; attempt++) {
      await f.sql.query("update af_embed_matches set last_run_at=now()-interval '31 seconds' where id=$1", [rows[1].data.id]);
      assert.equal((await reserve(bodies[1])).data.run_attempts, attempt);
    }
    await f.sql.query("update af_embed_matches set last_run_at=now()-interval '31 seconds' where id=$1", [rows[1].data.id]);
    assert.equal((await reserve(bodies[1])).error.message, 'embed-budget');
    // A killed request stops holding concurrency after five minutes; its reservation and key remain recoverable.
    await f.sql.query("update af_embed_matches set created_at=created_at-interval '6 minutes' where owner_id=$1 and result is null", [f.identities[0].owner]);
    assert.equal((await reserve(f.matchBody())).error, undefined);
    // Seed sixteen completed private records to reach the twenty-per-UTC-day account budget without twenty engine invocations.
    await f.sql.query(
      `insert into af_embed_matches(owner_id,request_key,a,b,hash_a,hash_b,engine,seed,result,completed_at)
      select $1,gen_random_uuid(),$2,$3,$4,$4,'test-v1',1,$5,now() from generate_series(1,16)`,
      [f.identities[0].owner, f.fighters[0], f.fighters[1], f.hash, RESULT],
    );
    // The two aged rows can cross UTC midnight. Account for this deterministically before checking today's budget.
    await f.sql.query('update af_embed_matches set created_at=now(),result=$2,completed_at=now() where owner_id=$1', [f.identities[0].owner, RESULT]);
    assert.equal((await f.request('matches', { token, body: f.matchBody() })).status, 429);
    assert.equal((await f.request('matches', { token, body: bodies[0] })).status, 200);
    const olderId = crypto.randomUUID();
    await f.sql.query(
      `insert into af_embed_matches(id,owner_id,request_key,a,b,hash_a,hash_b,engine,seed,result,completed_at,created_at)
      values($1,$2,gen_random_uuid(),$3,$4,$5,$5,'test-v1',1,$6,now()-interval '1 day',now()-interval '1 day')`,
      [olderId, f.identities[0].owner, f.fighters[0], f.fighters[1], f.hash, RESULT],
    );
    const list = await (await f.request('matches', { token })).json();
    assert.equal(list.matches.length + list.pending.length, 20);
    assert.ok(list.matches.every(match => match.id !== olderId));
    assert.equal((await f.request(`matches/${olderId}`, { token })).status, 200);
    // A new account has its own spend and may practise public fighters.
    const other = await f.exchange(await f.launch(f.identities[2]));
    assert.equal((await f.request('matches', { token: other.token, body: f.matchBody() })).status, 200);
  } finally {
    await f.sql.close();
  }
});
