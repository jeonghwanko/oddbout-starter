import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMigration, migratedDatabase, migrationNames, supabasePlatform } from './helpers/fighter-database.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { sha256, VALIDATOR_VERSION } from '../api/handler.mjs';

test('Postgres enforces open registration, immutability, queue, leases, unique registration and RLS', async () => {
  const db = await migratedDatabase();
  try {
    const owner = crypto.randomUUID(),
      other = crypto.randomUUID(),
      key = crypto.randomUUID();
    await db.query('insert into auth.users values($1),($2)', [owner, other]);
    await db.query('insert into public.af_creators(owner_id) values($1),($2)', [owner, other]);
    const text = JSON.stringify(example),
      sha = await sha256(new TextEncoder().encode(text)),
      bytes = example.assets.reduce((sum, a) => sum + a.bytes, 0);
    const create = (who, k, t = text, hash = sha) =>
      db.query('select to_jsonb(public.af_create_submission($1,$2,$3,$4,$5)) as value', [who, k, t, hash, bytes]).then(r => r.rows[0].value);
    const row = await create(owner, key);
    await assert.rejects(db.query('update public.af_submissions set manifest_text=manifest_text||$1 where id=$2', [' ', row.id]), /immutable-submission/);
    assert.equal((await create(owner, key)).id, row.id);
    await assert.rejects(create(owner, key, text + ' ', 'f'.repeat(64)), /idempotency-conflict/);
    await assert.rejects(create(owner, crypto.randomUUID()), /open-submission-exists/);
    await assert.rejects(db.query('select public.af_submit($1,$2)', [other, row.id]), /not-found/);
    await assert.rejects(db.query('select public.af_submit($1,$2)', [owner, row.id]), /assets-incomplete/);
    for (const a of example.assets)
      await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${row.id}/${a.id}.webp`, { size: a.bytes }]);
    await db.query('select public.af_submit($1,$2)', [owner, row.id]);
    const claim = (await db.query('select to_jsonb(public.af_claim($1)) as value', [row.id])).rows[0].value;
    assert.equal(claim.status, 'validating');
    assert.equal((await db.query('select public.af_claim($1) is null as empty', [row.id])).rows[0].empty, true);
    const result = { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: [] };
    const finish = lease => db.query('select to_jsonb(public.af_finish($1,$2,$3,true,$4)) as value', [row.id, lease, sha, result]).then(r => r.rows[0].value);
    await assert.rejects(finish(crypto.randomUUID()), /stale-validation/);
    const registered = await finish(claim.lease_token);
    assert.equal(registered.status, 'registered');
    assert.equal((await finish(claim.lease_token)).fighter_id, registered.fighter_id);
    assert.equal((await db.query('select count(*)::int as n from public.af_fighters')).rows[0].n, 1);
    assert.equal((await create(owner, key)).fighter_id, registered.fighter_id);
    const next = await create(owner, crypto.randomUUID());
    assert.equal(next.status, 'uploading');
    await db.query("update public.af_submissions set status='rejected' where id=$1", [next.id]);
    const admitted = (await db.query('select * from af_fighters where id=$1', [registered.fighter_id])).rows[0];
    assert.equal(admitted.runtime_approved, true);
    assert.equal(admitted.duel_approved, true);
    assert.equal(admitted.runtime_manifest_sha, sha);
    assert.equal(admitted.review_evidence.authorization, 'open-registration');
    await assert.rejects(db.query('update af_fighters set runtime_manifest_sha=$1', ['f'.repeat(64)]), /af_fighters_runtime_admission/);
    await assert.rejects(db.query('update af_fighters set duel_manifest_sha=$1', ['f'.repeat(64)]), /af_fighters_duel_admission/);
    // Real roles and RLS: a normal caller cannot perform privileged transitions or read another owner.
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${other}';`);
    assert.equal((await db.query('select id from public.af_submissions')).rows.length, 0);
    await assert.rejects(db.query('select public.af_claim(null)'), /permission denied/);
    await assert.rejects(db.query('update public.af_fighters set runtime_approved=true'), /permission denied/);
    await assert.rejects(db.query('update public.af_fighters set duel_approved=true'), /permission denied/);
    await db.exec('reset role');
    const retry = await create(other, crypto.randomUUID());
    await db.query(
      "update public.af_submissions set status='validating',lease_token=gen_random_uuid(),lease_until=now()-interval '1 second',attempts=1 where id=$1",
      [retry.id],
    );
    const reclaimed = (await db.query('select to_jsonb(public.af_claim($1)) as value', [retry.id])).rows[0].value;
    assert.equal(reclaimed.attempts, 2);
    await db.query("update public.af_submissions set lease_until=now()-interval '1 second',attempts=3 where id=$1", [retry.id]);
    await db.query('select public.af_claim($1)', [retry.id]);
    assert.equal((await db.query('select status from public.af_submissions where id=$1', [retry.id])).rows[0].status, 'rejected');
    await db.exec('update public.af_settings set max_reserved_bytes=1');
    await assert.rejects(create(other, crypto.randomUUID()), /storage-budget-full/);
  } finally {
    await db.close();
  }
});

test('an infrastructure hand-back requeues under the caller lease without spending attempts, up to its own limit', async () => {
  const db = await migratedDatabase();
  try {
    const owner = crypto.randomUUID();
    await db.query('insert into auth.users values($1)', [owner]);
    await db.query('insert into public.af_creators(owner_id) values($1)', [owner]);
    const text = JSON.stringify(example),
      sha = await sha256(new TextEncoder().encode(text)),
      bytes = example.assets.reduce((sum, a) => sum + a.bytes, 0);
    const row = (await db.query('select to_jsonb(public.af_create_submission($1,$2,$3,$4,$5)) as value', [owner, crypto.randomUUID(), text, sha, bytes]))
      .rows[0].value;
    await db.query("update public.af_submissions set status='queued' where id=$1", [row.id]);
    const value = result => result.rows[0].value;
    const claim = async () => value(await db.query('select to_jsonb(public.af_claim($1)) as value', [row.id]));
    const release = (lease, code = 'download-failed') => db.query('select to_jsonb(public.af_release($1,$2,$3)) as value', [row.id, lease, code]).then(value);
    const first = await claim();
    assert.equal(first.attempts, 1);
    await assert.rejects(release(crypto.randomUUID()), /stale-validation/, 'only the current lease holder');
    await assert.rejects(release(first.lease_token, 'Not A Code'), /invalid-release-code/);
    const requeued = await release(first.lease_token);
    assert.deepEqual([requeued.status, requeued.attempts, requeued.infra_failures, requeued.lease_token], ['queued', 0, 1, null]);
    await assert.rejects(release(first.lease_token), /stale-validation/, 'a released lease cannot be released again');
    // Ten hand-backs in a row stop a package that crashes the validator every time.
    for (let n = 2; n < 10; n++) assert.equal((await release((await claim()).lease_token)).status, 'queued');
    const stopped = await release((await claim()).lease_token, 'validator-timeout');
    assert.deepEqual(
      [stopped.status, stopped.infra_failures, stopped.validation],
      ['rejected', 10, { code: 'worker-infrastructure-limit', lastFailure: 'validator-timeout' }],
    );
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}';`);
    await assert.rejects(db.query('select public.af_release($1,$2,$3)', [row.id, crypto.randomUUID(), 'x']), /permission denied/);
    await db.exec('reset role');
  } finally {
    await db.close();
  }
});

test('three fighters share an account; a fourth is refused and updates preserve the other fighters', async () => {
  const db = await migratedDatabase();
  try {
    const owner = crypto.randomUUID(),
      bytes = example.assets.reduce((sum, a) => sum + a.bytes, 0);
    await db.query('insert into auth.users values($1)', [owner]);
    await db.query('insert into public.af_creators(owner_id) values($1)', [owner]);
    const text = JSON.stringify(example),
      sha = await sha256(new TextEncoder().encode(text));
    const create = async (key = crypto.randomUUID(), target = null, body = text) =>
      (
        await db.query('select to_jsonb(public.af_create_submission($1,$2,$3,$4,$5,$6)) as value', [
          owner,
          key,
          body,
          await sha256(new TextEncoder().encode(body)),
          bytes,
          target,
        ])
      ).rows[0].value;
    const finish = async row => {
      for (const a of example.assets)
        await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${row.id}/${a.id}.webp`, { size: a.bytes }]);
      await db.query('select public.af_submit($1,$2)', [owner, row.id]);
      const claim = (await db.query('select to_jsonb(public.af_claim($1)) as value', [row.id])).rows[0].value;
      return (
        await db.query('select to_jsonb(public.af_finish($1,$2,$3,true,$4)) as value', [
          row.id,
          claim.lease_token,
          row.manifest_sha,
          { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: [] },
        ])
      ).rows[0].value;
    };
    const rows = [];
    for (let i = 0; i < 3; i++) rows.push(await finish(await create()));
    assert.equal(new Set(rows.map(row => row.fighter_id)).size, 3);
    assert.deepEqual(
      (await db.query('select account_slot from af_fighters where owner_id=$1 order by account_slot', [owner])).rows.map(row => row.account_slot),
      [1, 2, 3],
    );
    await assert.rejects(create(), /fighter-quota/);
    assert.equal((await create(rows[0].idempotency_key)).fighter_id, rows[0].fighter_id);
    // The database bound also applies outside the submission entry point.
    await assert.rejects(
      db.query("insert into af_fighters(submission_id,owner_id,manifest_sha,profile) values(gen_random_uuid(),$1,$2,'{}')", [owner, sha]),
      /fighter-quota/,
    );
    await assert.rejects(db.query('update af_fighters set account_slot=4 where id=$1', [rows[0].fighter_id]), /fighter-quota/);
    await assert.rejects(db.query('update af_fighters set account_slot=2 where id=$1', [rows[0].fighter_id]), /af_fighters_owner_slot_key/);
    const before = (await db.query('select * from af_fighters where owner_id=$1 order by account_slot', [owner])).rows;
    const changed = JSON.stringify({ ...example, profile: { ...example.profile, concept: 'Updated first fighter' } });
    const updated = await finish(await create(crypto.randomUUID(), rows[0].fighter_id, changed));
    assert.equal(updated.fighter_id, rows[0].fighter_id);
    const after = (await db.query('select * from af_fighters where owner_id=$1 order by account_slot', [owner])).rows;
    assert.equal(after.length, 3);
    assert.equal(after[0].account_slot, 1);
    assert.equal(after[0].created_at.getTime(), before[0].created_at.getTime());
    assert.deepEqual(after.slice(1), before.slice(1));
    // Moderation cannot be used to free slots and evade the per-account bound.
    await db.query(
      "update af_fighters set review_state='rejected',runtime_approved=false,runtime_scope=null,runtime_manifest_sha=null,duel_approved=false,duel_manifest_sha=null where id=$1",
      [rows[2].fighter_id],
    );
    await assert.rejects(create(), /fighter-quota/);
    // The operator raises one account: the submission and the slot follow its own limit, and nobody else's.
    await db.query('update af_creators set fighter_limit=5 where owner_id=$1', [owner]);
    for (let i = 0; i < 2; i++) rows.push(await finish(await create()));
    assert.deepEqual(
      (await db.query('select account_slot from af_fighters where owner_id=$1 order by account_slot', [owner])).rows.map(row => row.account_slot),
      [1, 2, 3, 4, 5],
    );
    await assert.rejects(create(), /fighter-quota/);
    await assert.rejects(
      db.query("insert into af_fighters(submission_id,owner_id,manifest_sha,profile) values(gen_random_uuid(),$1,$2,'{}')", [owner, sha]),
      /fighter-quota/,
    );
    await assert.rejects(db.query('update af_creators set fighter_limit=21 where owner_id=$1', [owner]), /af_creators_fighter_limit_check/);
  } finally {
    await db.close();
  }
});

test('profiles use account slots, expose only public fields and promote through validated packages with the same world link', async () => {
  const db = await migratedDatabase();
  try {
    const owner = crypto.randomUUID(),
      other = crypto.randomUUID(),
      key = crypto.randomUUID();
    await db.query('insert into auth.users values($1),($2)', [owner, other]);
    const profile = { name: 'Profile character', description: 'Introduction', portrait: '/art/character-profiles/test-v1.webp', color: '#ffeebb' };
    const create = async (k = crypto.randomUUID(), p = profile) =>
      (await db.query('select to_jsonb(af_register_character_profile($1,$2,$3,$4)) as value', [owner, k, p, 'kkumssi'])).rows[0].value;
    const first = await create(key);
    assert.equal(first.status, 'profile');
    assert.equal(first.submission_id, null);
    assert.equal(first.manifest_sha, null);
    assert.equal(first.runtime_approved, false);
    assert.equal(first.duel_approved, false);
    assert.equal((await create(key)).id, first.id);
    await assert.rejects(create(key, { ...profile, name: 'Changed' }), /idempotency-conflict/);
    await assert.rejects(create(crypto.randomUUID(), { ...profile, portrait: 'https://other.test/image.webp' }), /invalid-profile/);
    const second = await create(),
      third = await create();
    await assert.rejects(create(), /fighter-quota/);
    await assert.rejects(db.query('update af_fighters set runtime_approved=true where id=$1', [first.id]), /af_fighters/);
    assert.equal((await db.query('select count(*)::int as n from af_analytics_outbox')).rows[0].n, 0);
    await db.exec('set role anon');
    assert.equal((await db.query('select id,profile from af_public_character_profiles')).rows.length, 3);
    await assert.rejects(db.query('select owner_id from af_fighters'), /permission denied/);
    await assert.rejects(db.query('select * from af_submissions'), /permission denied/);
    await assert.rejects(create(), /permission denied/);
    await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${other}';`);
    assert.equal((await db.query('select id from af_fighters')).rows.length, 0);
    await assert.rejects(create(), /permission denied/);
    await db.exec('reset role');
    // Complete a real validated package transition at capacity, without another slot or ID.
    const text = JSON.stringify(example),
      hash = await sha256(new TextEncoder().encode(text));
    const submission = (
      await db.query('select to_jsonb(af_create_submission($1,$2,$3,$4,$5,$6)) as value', [
        owner,
        crypto.randomUUID(),
        text,
        hash,
        example.assets.reduce((n, a) => n + a.bytes, 0),
        first.id,
      ])
    ).rows[0].value;
    for (const a of example.assets)
      await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${submission.id}/${a.id}.webp`, { size: a.bytes }]);
    await db.query('select af_submit($1,$2)', [owner, submission.id]);
    const claim = (await db.query('select to_jsonb(af_claim($1)) as value', [submission.id])).rows[0].value;
    await db.query('select af_finish($1,$2,$3,true,$4)', [
      submission.id,
      claim.lease_token,
      hash,
      { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: [] },
    ]);
    const promoted = (await db.query('select status,account_slot,runtime_approved from af_fighters where id=$1', [first.id])).rows[0];
    assert.deepEqual(promoted, { status: 'registered', account_slot: first.account_slot, runtime_approved: true });
    assert.equal((await db.query('select world_id from af_world_fighters where fighter_id=$1', [first.id])).rows[0].world_id, 'kkumssi');
    await db.query('insert into af_admins(owner_id) values($1)', [owner]);
    assert.equal((await db.query("select af_admin_fighters($1,'active')->>'total' as total", [owner])).rows[0].total, '3');
    await db.query("select af_moderate_fighter($1,$2,0,'remove','test')", [owner, second.id]);
    await db.exec('set role anon');
    assert.deepEqual(
      (await db.query('select id from af_public_character_profiles')).rows.map(row => row.id),
      [third.id],
    );
    await db.exec('reset role');
    await db.query("select af_moderate_fighter($1,$2,1,'restore','test')", [owner, second.id]);
    const restored = (await db.query('select status,runtime_approved,duel_approved from af_fighters where id=$1', [second.id])).rows[0];
    assert.deepEqual(restored, { status: 'profile', runtime_approved: false, duel_approved: false });
  } finally {
    await db.close();
  }
});

test('an expired upload closes instead of blocking the creator; integers written as 5258.0 are accepted', async () => {
  const db = await migratedDatabase();
  try {
    const owner = crypto.randomUUID();
    await db.query('insert into auth.users values($1)', [owner]);
    await db.query('insert into public.af_creators(owner_id) values($1)', [owner]);
    const bytes = example.assets.reduce((sum, a) => sum + a.bytes, 0);
    const create = async text =>
      db
        .query('select to_jsonb(public.af_create_submission($1,$2,$3,$4,$5)) as value', [
          owner,
          crypto.randomUUID(),
          text,
          await sha256(new TextEncoder().encode(text)),
          bytes,
        ])
        .then(r => r.rows[0].value);
    const abandoned = await create(JSON.stringify(example));
    await assert.rejects(create(JSON.stringify(example)), /open-submission-exists/);
    await db.query("update public.af_submissions set expires_at=now()-interval '1 second' where id=$1", [abandoned.id]);
    // The validator accepts 5258.0 as an integer; the byte sums must accept it too.
    const first = example.assets[0],
      floatText = JSON.stringify(example).replace(`"bytes":${first.bytes},`, `"bytes":${first.bytes}.0,`);
    assert.notEqual(floatText, JSON.stringify(example));
    const fresh = await create(floatText);
    assert.equal(fresh.status, 'uploading');
    const closed = (await db.query('select status,validation from public.af_submissions where id=$1', [abandoned.id])).rows[0];
    assert.deepEqual(closed, { status: 'rejected', validation: { code: 'upload-expired' } });
    for (const a of example.assets)
      await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${fresh.id}/${a.id}.webp`, { size: a.bytes }]);
    assert.equal((await db.query('select (public.af_submit($1,$2)).status', [owner, fresh.id])).rows[0].status, 'queued');
  } finally {
    await db.close();
  }
});

test('a new validator version finishes only after the operator allows it', async () => {
  const db = await migratedDatabase();
  try {
    const owner = crypto.randomUUID(),
      text = JSON.stringify(example),
      sha = await sha256(new TextEncoder().encode(text));
    await db.query('insert into auth.users values($1)', [owner]);
    await db.query('insert into public.af_creators(owner_id) values($1)', [owner]);
    const row = (
      await db.query('select to_jsonb(public.af_create_submission($1,$2,$3,$4,$5)) as value', [
        owner,
        crypto.randomUUID(),
        text,
        sha,
        example.assets.reduce((sum, a) => sum + a.bytes, 0),
      ])
    ).rows[0].value;
    for (const a of example.assets)
      await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${row.id}/${a.id}.webp`, { size: a.bytes }]);
    await db.query('select public.af_submit($1,$2)', [owner, row.id]);
    const claim = (await db.query('select to_jsonb(public.af_claim($1)) as value', [row.id])).rows[0].value;
    const finish = version =>
      db
        .query('select (public.af_finish($1,$2,$3,true,$4)).status', [
          row.id,
          claim.lease_token,
          sha,
          { validatorVersion: version, stage: 'bytes-hashes-and-full-decode', errors: [] },
        ])
        .then(r => r.rows[0].status);
    await assert.rejects(finish('ai-fighter-validator-0.3.0'), /validator-version/);
    await db.query("update public.af_settings set validator_versions=array_append(validator_versions,'ai-fighter-validator-0.3.0')");
    assert.equal(await finish('ai-fighter-validator-0.3.0'), 'registered');
    assert.deepEqual((await db.query('select validator_versions from public.af_settings')).rows[0].validator_versions, [
      VALIDATOR_VERSION,
      'ai-fighter-validator-0.3.0',
    ]);
  } finally {
    await db.close();
  }
});

test('an owner replaces their fighter in place: same ID and record, old duels keep their hashes', async () => {
  const db = await migratedDatabase();
  try {
    const [owner, other] = [crypto.randomUUID(), crypto.randomUUID()],
      bytes = example.assets.reduce((sum, a) => sum + a.bytes, 0);
    await db.query('insert into auth.users values($1),($2)', [owner, other]);
    await db.query('insert into public.af_creators(owner_id) values($1),($2)', [owner, other]);
    const manifest = changes =>
      JSON.stringify({ ...example, profile: { ...example.profile, ...changes.profile }, combat: { ...example.combat, ...changes.combat } });
    const value = r => r.rows[0].value;
    const create = async (who, text, fighter = null, key = crypto.randomUUID()) =>
      value(
        await db.query('select to_jsonb(public.af_create_submission($1,$2,$3,$4,$5,$6)) as value', [
          who,
          key,
          text,
          await sha256(new TextEncoder().encode(text)),
          bytes,
          fighter,
        ]),
      );
    const register = async (who, text, fighter = null) => {
      const row = await create(who, text, fighter);
      for (const a of example.assets)
        await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${who}/${row.id}/${a.id}.webp`, { size: a.bytes }]);
      await db.query('select public.af_submit($1,$2)', [who, row.id]);
      const claim = value(await db.query('select to_jsonb(public.af_claim($1)) as value', [row.id]));
      return value(
        await db.query('select to_jsonb(public.af_finish($1,$2,$3,true,$4)) as value', [
          row.id,
          claim.lease_token,
          row.manifest_sha,
          { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: [] },
        ]),
      );
    };
    const fighterOf = async id => (await db.query('select * from public.af_fighters where id=$1', [id])).rows[0];
    const first = await register(owner, JSON.stringify(example)),
      rival = await register(other, JSON.stringify(example));
    const before = await fighterOf(first.fighter_id);
    await db.query(
      `insert into public.af_duels(request_key,a,b,hash_a,hash_b,seed,engine,completed_at,winner,result)
      values($1,$2,$3,$4,$4,7,'test-v1',now(),$2,'{"winner":0}')`,
      [crypto.randomUUID(), first.fighter_id, rival.fighter_id, before.manifest_sha],
    );

    await assert.rejects(create(owner, JSON.stringify(example), first.fighter_id), /fighter-unchanged/);
    await assert.rejects(create(owner, manifest({ profile: { concept: 'x' } }), rival.fighter_id), /fighter-not-found/);
    const key = crypto.randomUUID(),
      text = manifest({ profile: { concept: 'New concept' }, combat: { stats: { power: 5, toughness: 1, speed: 3 } } });
    await create(owner, text, first.fighter_id, key);
    await assert.rejects(create(owner, text, null, key), /idempotency-conflict/);
    await db.query("update public.af_submissions set expires_at=now()-interval '1 second' where status='uploading'");

    const updated = await register(owner, text, first.fighter_id),
      after = await fighterOf(first.fighter_id);
    assert.equal(updated.status, 'registered');
    assert.equal(updated.fighter_id, first.fighter_id);
    assert.equal(after.submission_id, updated.id);
    assert.equal(after.manifest_sha, updated.manifest_sha);
    assert.notEqual(after.manifest_sha, before.manifest_sha);
    assert.equal(after.profile.concept, 'New concept');
    assert.equal(after.runtime_manifest_sha, after.manifest_sha);
    assert.equal(after.duel_manifest_sha, after.manifest_sha);
    assert.equal(after.created_at.getTime(), before.created_at.getTime());
    assert.ok(after.updated_at);
    assert.equal((await db.query('select count(*)::int as n from public.af_fighters where owner_id=$1', [owner])).rows[0].n, 1);
    assert.equal((await db.query('select status from public.af_submissions where id=$1', [first.id])).rows[0].status, 'registered');
    assert.equal((await db.query('select hash_a from public.af_duels')).rows[0].hash_a, before.manifest_sha);
    const record = (await db.query('select won,lost from public.af_duel_statistics() where id=$1', [first.fighter_id])).rows[0];
    assert.deepEqual({ won: Number(record.won), lost: Number(record.lost) }, { won: 1, lost: 0 });

    // A removed fighter cannot be updated, and a removal during validation wins over the update.
    const pending = await create(owner, manifest({ profile: { concept: 'During removal' } }), first.fighter_id);
    for (const a of example.assets)
      await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${pending.id}/${a.id}.webp`, { size: a.bytes }]);
    await db.query('select public.af_submit($1,$2)', [owner, pending.id]);
    const claim = value(await db.query('select to_jsonb(public.af_claim($1)) as value', [pending.id]));
    await db.query(
      `update public.af_fighters set review_state='rejected',runtime_approved=false,runtime_scope=null,runtime_manifest_sha=null,
      duel_approved=false,duel_manifest_sha=null where id=$1`,
      [first.fighter_id],
    );
    const refused = value(
      await db.query('select to_jsonb(public.af_finish($1,$2,$3,true,$4)) as value', [
        pending.id,
        claim.lease_token,
        pending.manifest_sha,
        { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: [] },
      ]),
    );
    assert.equal(refused.status, 'rejected');
    assert.equal(refused.validation.code, 'fighter-removed');
    assert.equal((await fighterOf(first.fighter_id)).manifest_sha, after.manifest_sha);
    await assert.rejects(create(owner, manifest({ profile: { concept: 'After removal' } }), first.fighter_id), /fighter-removed/);
  } finally {
    await db.close();
  }
});

test('a validated fighter starts in production; his owner enters him on the watched package and a new package returns him (출전, 2026-10-30)', async () => {
  const db = await migratedDatabase();
  try {
    const [owner, other] = [crypto.randomUUID(), crypto.randomUUID()],
      bytes = example.assets.reduce((sum, a) => sum + a.bytes, 0);
    await db.query('insert into auth.users values($1),($2)', [owner, other]);
    await db.query('insert into public.af_creators(owner_id) values($1),($2)', [owner, other]);
    const value = r => r.rows[0].value;
    const register = async (text, fighter = null) => {
      const row = value(
        await db.query('select to_jsonb(public.af_create_submission($1,$2,$3,$4,$5,$6)) as value', [
          owner,
          crypto.randomUUID(),
          text,
          await sha256(new TextEncoder().encode(text)),
          bytes,
          fighter,
        ]),
      );
      for (const a of example.assets)
        await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${row.id}/${a.id}.webp`, { size: a.bytes }]);
      await db.query('select public.af_submit($1,$2)', [owner, row.id]);
      const claim = value(await db.query('select to_jsonb(public.af_claim($1)) as value', [row.id]));
      return value(
        await db.query('select to_jsonb(public.af_finish($1,$2,$3,true,$4)) as value', [
          row.id,
          claim.lease_token,
          row.manifest_sha,
          { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: [] },
        ]),
      );
    };
    const fighterOf = async id => (await db.query('select * from public.af_fighters where id=$1', [id])).rows[0];
    const clips = ['idle', 'walk', 'run', 'fightIdle', 'combo', 'slam', 'dash', 'block', 'hit', 'groggy', 'fall'];
    const enter = (who, id, sha, list = clips) => db.query('select public.af_enter_fighter($1,$2,$3,$4) as value', [who, id, sha, list]).then(value);
    const first = await register(JSON.stringify(example)),
      fighter = await fighterOf(first.fighter_id);
    assert.equal(fighter.entered_at, null);
    assert.equal(fighter.duel_approved, true);
    await assert.rejects(enter(other, fighter.id, fighter.manifest_sha), /not-found/);
    await assert.rejects(enter(owner, fighter.id, 'f'.repeat(64)), /fighter-changed/);
    await assert.rejects(enter(owner, fighter.id, fighter.manifest_sha, []), /invalid-entry/);
    const entered = await enter(owner, fighter.id, fighter.manifest_sha);
    assert.equal(entered.stage, 'entered');
    assert.ok(entered.enteredAt);
    assert.equal((await enter(owner, fighter.id, fighter.manifest_sha)).enteredAt, entered.enteredAt);
    const evidence = (await fighterOf(fighter.id)).review_evidence;
    assert.equal(evidence.entry.manifestSha, fighter.manifest_sha);
    assert.deepEqual(evidence.entry.clips, clips);
    assert.equal(evidence.authorization, 'open-registration');

    // A replacement the validator refuses changes nothing: he stays entered on the package he was entered on.
    const refusedText = JSON.stringify({ ...example, profile: { ...example.profile, concept: 'Refused art' } });
    const refused = value(
      await db.query('select to_jsonb(public.af_create_submission($1,$2,$3,$4,$5,$6)) as value', [
        owner,
        crypto.randomUUID(),
        refusedText,
        await sha256(new TextEncoder().encode(refusedText)),
        bytes,
        fighter.id,
      ]),
    );
    for (const a of example.assets)
      await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${refused.id}/${a.id}.webp`, { size: a.bytes }]);
    await db.query('select public.af_submit($1,$2)', [owner, refused.id]);
    const refusedClaim = value(await db.query('select to_jsonb(public.af_claim($1)) as value', [refused.id]));
    await db.query('select public.af_finish($1,$2,$3,false,$4)', [
      refused.id,
      refusedClaim.lease_token,
      refused.manifest_sha,
      { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: ['EMPTY_FRAME'] },
    ]);
    assert.equal((await fighterOf(fighter.id)).entered_at.getTime(), new Date(entered.enteredAt).getTime());
    // An operator's removal hides him (the gates need his approvals too); restoring the same package gives back the entry he had.
    await db.query('insert into public.af_admins(owner_id) values($1)', [other]);
    await db.query("select public.af_moderate_fighter($1,$2,0,'remove','test')", [other, fighter.id]);
    assert.equal((await db.query('select public.af_duel_admitted(f) as ok from public.af_fighters f where id=$1', [fighter.id])).rows[0].ok, false);
    await db.query("select public.af_moderate_fighter($1,$2,1,'restore','test')", [other, fighter.id]);
    assert.deepEqual(
      (await db.query('select entered_at is not null as entered, public.af_duel_admitted(f) as ok from public.af_fighters f where id=$1', [fighter.id]))
        .rows[0],
      { entered: true, ok: true },
    );

    // A new package for him: other people stop meeting him until his owner watches it.
    await register(JSON.stringify({ ...example, profile: { ...example.profile, concept: 'New art' } }), fighter.id);
    const replaced = await fighterOf(fighter.id);
    assert.equal(replaced.entered_at, null);
    assert.notEqual(replaced.manifest_sha, fighter.manifest_sha);
    await enter(owner, fighter.id, replaced.manifest_sha);
    assert.deepEqual(value(await db.query('select public.af_withdraw_fighter($1,$2) as value', [owner, fighter.id])), {
      ok: true,
      stage: 'in-production',
      fighterId: fighter.id,
      enteredAt: null,
    });
    assert.equal((await fighterOf(fighter.id)).entered_at, null);

    // A removed fighter is not ready; a profile-only fighter cannot hold an entry.
    await db.query(
      `update public.af_fighters set review_state='rejected',runtime_approved=false,runtime_scope=null,runtime_manifest_sha=null,
      duel_approved=false,duel_manifest_sha=null where id=$1`,
      [fighter.id],
    );
    await assert.rejects(enter(owner, fighter.id, replaced.manifest_sha), /fighter-not-ready/);
    await assert.rejects(db.query("update public.af_fighters set status='profile',entered_at=now() where id=$1", [fighter.id]), /af_fighters_entry_registered/);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(enter(owner, fighter.id, replaced.manifest_sha), /permission denied/);
      await db.exec('reset role');
    }
  } finally {
    await db.close();
  }
});

test('the entry migration enters only registered fighters with a record (사용자 결정 2026-10-30, "전적 있는 선수만 출전")', async () => {
  const db = await supabasePlatform();
  try {
    const names = await migrationNames(),
      at = names.indexOf('20261030130000_ai_fighter_entry.sql');
    assert.ok(at > 0);
    for (const name of names.slice(0, at)) await applyMigration(db, name);
    const text = JSON.stringify(example),
      sha = await sha256(new TextEncoder().encode(text));
    // One owner each: an account holds three fighters.
    const fighter = async name => {
      const owner = crypto.randomUUID(),
        sub = crypto.randomUUID(),
        id = crypto.randomUUID();
      await db.query('insert into auth.users values($1)', [owner]);
      await db.query('insert into public.af_creators(owner_id) values($1)', [owner]);
      await db.query(
        `insert into public.af_submissions(id,owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes,status)
        values($1,$2,$3,$4,$5,$6,1,'registered')`,
        [sub, owner, crypto.randomUUID(), text, example, sha],
      );
      await db.query(
        `insert into public.af_fighters(id,submission_id,owner_id,manifest_sha,profile,review_state,runtime_approved,runtime_scope,
        runtime_manifest_sha,review_evidence,duel_approved,duel_manifest_sha) values($1,$2,$3,$4,$5,'approved',true,'arena-player-v1',$4,$6,true,$4)`,
        [id, sub, owner, sha, { name }, { authorization: 'test', validation: 'test', duelValidation: 'test' }],
      );
      return id;
    };
    const ids = {};
    for (const name of ['winner', 'loser', 'pendingOnly', 'cupOnly', 'fresh', 'deleted', 'removed']) ids[name] = await fighter(name);
    const duel = (a, b, done) =>
      db.query(
        `insert into public.af_duels(request_key,a,b,hash_a,hash_b,seed,engine,completed_at,winner,result)
      values($1,$2,$3,$4,$4,7,'test-v1',${done ? `now(),$2,'{"winner":0}'` : 'null,null,null'})`,
        [crypto.randomUUID(), a, b, sha],
      );
    await duel(ids.winner, ids.loser, true);
    await duel(ids.pendingOnly, ids.winner, false);
    await duel(ids.deleted, ids.removed, true);
    // A deleted fighter may hold no entry (the new constraint): the backfill must leave him out, or the migration fails.
    await db.query(
      `update public.af_fighters set deleted_at=now(),account_slot=null,review_state='rejected',runtime_approved=false,runtime_scope=null,
      runtime_manifest_sha=null,duel_approved=false,duel_manifest_sha=null where id=$1`,
      [ids.deleted],
    );
    await db.query(
      `update public.af_fighters set review_state='rejected',runtime_approved=false,runtime_scope=null,runtime_manifest_sha=null,
      duel_approved=false,duel_manifest_sha=null where id=$1`,
      [ids.removed],
    );
    // A cup record lives in the arena relay's totals; the stand-in has only the columns the backfill reads.
    await db.exec('create table public.af_arena_fighter_totals(id text primary key, won bigint, lost bigint)');
    await db.query('insert into public.af_arena_fighter_totals values($1,2,1),($2,0,0)', [ids.cupOnly, ids.fresh]);
    await applyMigration(db, names[at]);
    const rows = (await db.query("select profile->>'name' as name, entered_at is not null as entered from public.af_fighters")).rows;
    assert.deepEqual(Object.fromEntries(rows.map(r => [r.name, r.entered])), {
      winner: true,
      loser: true,
      pendingOnly: false,
      cupOnly: true,
      fresh: false,
      deleted: false,
      removed: true,
    });
    const evidence = Object.fromEntries(
      (await db.query("select profile->>'name' as name, review_evidence->'entry' as entry from public.af_fighters")).rows.map(r => [
        r.name,
        r.entry && { backfill: r.entry.backfill, reason: r.entry.reason },
      ]),
    );
    assert.deepEqual(
      [evidence.winner, evidence.cupOnly, evidence.fresh],
      [{ backfill: '20261030130000', reason: 'completed-duel' }, { backfill: '20261030130000', reason: 'cup-bout' }, null],
    );
  } finally {
    await db.close();
  }
});
