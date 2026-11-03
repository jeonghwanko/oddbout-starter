// 정면 판정 (2026-11-03): the official generation PC checks each front painting the validator passed; the owner's fighter read, the entry's
// refusal and the MCP's next say what his front lacks (supabase/migrations/20261103130000_oddbout_profile_front_check.sql).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { sha256, VALIDATOR_VERSION } from '../api/handler.mjs';
import { ENTRY_CLIPS } from '../api/fighter-entry.mjs';
import { PROFILE_SET_VALIDATOR_VERSION, PROFILE_SET_VERSION, claimFrontCheck, finishFrontCheck, profileSetKey, profileSetView } from '../api/profile-sets.mjs';
import { frontNext } from '../mcp/cloud/common.mjs';
import { FRONT_CHECKS, FRONT_JUDGE_SCHEMA, frontJobId, frontJudgePrompt, frontVerdict, lookJudgePrompt } from '../host/generation-stages.mjs';
import { generation } from './helpers/generation-database.mjs';

test('the PC takes a validated front, its verdict decides the entry, and the owner reads why (API)', async () => {
  const { sql, owner, call, work } = await generation();
  try {
    const value = result => result.rows[0].value;
    const text = JSON.stringify(example), sha = await sha256(new TextEncoder().encode(text)), bytes = example.assets.reduce((sum, a) => sum + a.bytes, 0);
    const submission = value(await sql.query('select to_jsonb(public.af_create_submission($1,$2,$3,$4,$5)) as value', [owner, crypto.randomUUID(), text, sha, bytes]));
    for (const a of example.assets) await sql.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${submission.id}/${a.id}.webp`, { size: a.bytes }]);
    await sql.query('select public.af_submit($1,$2)', [owner, submission.id]);
    const leased = value(await sql.query('select to_jsonb(public.af_claim($1)) as value', [submission.id]));
    const fighter = value(await sql.query('select to_jsonb(public.af_finish($1,$2,$3,true,$4)) as value',
      [submission.id, leased.lease_token, sha, { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: [] }])).fighter_id;
    await sql.query("update public.af_fighters set duel_approved = true, duel_manifest_sha = manifest_sha where id = $1", [fighter]);
    await sql.query('update public.af_settings set profile_set_required_after = now()');
    const validated = async () => {
      const body = JSON.stringify({ version: PROFILE_SET_VERSION, front: { path: 'front.webp', bytes: 1000, sha256: 'a'.repeat(64), width: 1024, height: 1536 },
        face: { x: 402, y: 108, side: 220 } });
      const row = value(await sql.query('select to_jsonb(public.af_profile_set_create($1,$2,$3,$4,$5,$6)) as value',
        [owner, fighter, crypto.randomUUID(), body, await sha256(new TextEncoder().encode(body)), 1000]));
      for (const [name, size] of [['front', 1000], ['card', 300], ['face', 200]])
        await sql.query('insert into storage.objects values($1,$2,$3) on conflict do nothing', ['ai-fighter-beta', profileSetKey(owner, row.id, name), { size }]);
      await sql.query('select public.af_profile_set_submit($1,$2)', [owner, row.id]);
      const lease = value(await sql.query('select to_jsonb(public.af_profile_set_claim($1)) as value', [row.id]));
      await sql.query('select public.af_profile_set_finish($1,$2,$3,true,$4,$5)', [row.id, lease.lease_token, row.manifest_sha,
        { validatorVersion: PROFILE_SET_VALIDATOR_VERSION, stage: 'profile-set-full-decode', errors: [] },
        { card: { sha256: 'c'.repeat(64), bytes: 300, width: 135, height: 600, face: { x: 18, y: 0, side: 98 } }, face: { sha256: 'f'.repeat(64), bytes: 200, size: 192 } }]);
      return row.id;
    };
    const read = async () => (await call('GET', `fighters/${fighter}`)).body.fighter.front;
    const enter = () => call('POST', `fighters/${fighter}/entry`, { expectedManifestSha256: sha, reviewedClips: ENTRY_CLIPS });

    assert.deepEqual(await read(), { required: true, ok: false, profileSetId: null, status: null });
    const none = await enter();
    assert.equal(none.status, 409); assert.equal(none.body.code, 'profile-set-required');
    assert.deepEqual(none.body.front, { required: true, ok: false, profileSetId: null, status: null }, 'the refusal says what his front lacks');
    assert.equal((await work('POST', 'profile-fronts/claim', {})).body.stage, 'idle');

    const first = await validated();
    const owned = (await call('GET', `profile-sets/${first}`)).body;
    assert.deepEqual(owned.frontCheck, { status: 'pending' }); assert.deepEqual(owned.pending, ['front-check', 'operator-review']);
    const claimed = (await work('POST', 'profile-fronts/claim', {})).body.profileSet;
    assert.equal(claimed.id, first);
    assert.match(claimed.front.downloadUrl, new RegExp(`/${owner}/profile-sets/${first}/front\\.webp`));
    assert.equal(claimed.front.bytes, 1000);
    const side = { checks: { whole: 'pass', front: 'fail', single: 'pass' }, notes: 'A side view facing right.' };
    assert.equal((await work('POST', 'profile-fronts/finish', { profileSetId: first, leaseToken: crypto.randomUUID(), verdict: side })).body.code, 'stale-check');
    assert.equal((await work('POST', 'profile-fronts/finish', { profileSetId: first, leaseToken: claimed.leaseToken, verdict: { checks: {} } })).status, 422);
    const failed = (await work('POST', 'profile-fronts/finish', { profileSetId: first, leaseToken: claimed.leaseToken, verdict: side })).body;
    assert.deepEqual([failed.stage, failed.frontCheck.status, failed.frontCheck.notes], ['rejected', 'fail', 'A side view facing right.']);
    const refused = await enter();
    assert.deepEqual(refused.body.front, { required: true, ok: false, profileSetId: first, status: 'rejected', frontCheck: 'fail', reason: 'FRONT_VIEW',
      notes: 'A side view facing right.' });
    assert.match(frontNext(refused.body.front), /refused \(FRONT_VIEW: A side view facing right\.\).*prepare_profile_set/);
    assert.doesNotMatch(frontNext(refused.body.front, { directory: true }), /prepare_profile_set|출전/);

    const second = await validated();
    assert.match(frontNext(await read()), /ODDBOUT is checking its front painting/);
    const again = (await work('POST', 'profile-fronts/claim', {})).body.profileSet;
    const pass = { checks: { whole: 'pass', front: 'pass', single: 'pass' }, notes: 'One boxer, whole, facing the viewer.' };
    assert.equal((await work('POST', 'profile-fronts/finish', { profileSetId: second, leaseToken: again.leaseToken, verdict: pass })).body.frontCheck.status, 'pass');
    assert.deepEqual(await read(), { required: true, ok: true, profileSetId: second, status: 'review', frontCheck: 'pass' });
    assert.equal(frontNext(await read()), null);
    const entered = await enter();
    assert.equal(entered.status, 200); assert.equal(entered.body.stage, 'entered');
  } finally { await sql.close(); }
});

test('only the official PC checks fronts: another host is told there is nothing, and its verdict is refused', async () => {
  const db = { rpc: async () => { throw new Error('a community host must not reach the database'); } };
  assert.equal(await claimFrontCheck(db, 'community-host'), null);
  await assert.rejects(finishFrontCheck(db, 'community-host', {}), /worker-required/);
});

test('the owner reads the check: pending, then its verdict; a set made from an approved one has none', () => {
  const row = { id: 'p', fighter_id: 'f', owner_id: 'o', status: 'review', manifest_text: '{}', manifest_sha: 'a'.repeat(64),
    manifest: { version: PROFILE_SET_VERSION, front: { path: 'front.webp', bytes: 1, sha256: 'a'.repeat(64), width: 1024, height: 1536 }, face: { x: 1, y: 1, side: 200 } },
    derived: null, validation: null, reason: null, lease_token: null, lease_until: null, expires_at: '2026-11-04T00:00:00Z', created_at: '2026-11-03T00:00:00Z',
    validated_at: null, approved_at: null };
  assert.deepEqual(profileSetView(row).frontCheck, { status: 'pending' });
  assert.deepEqual(profileSetView({ ...row, based_on: 'q' }).frontCheck, undefined);
  assert.deepEqual(profileSetView({ ...row, based_on: 'q' }).pending, ['operator-review']);
  const verdict = { checks: { whole: 'fail', front: 'pass', single: 'pass' }, notes: 'The feet are cut off.' };
  assert.deepEqual(profileSetView({ ...row, status: 'rejected', reason: 'FRONT_WHOLE', front_check: 'fail', front_verdict: verdict }).frontCheck,
    { status: 'fail', ...verdict });
});

test('the judge asks the look judge\'s own whole and front questions and its verdict is checked again', () => {
  const prompt = frontJudgePrompt(), look = lookJudgePrompt({ look: { subject: 'A boxer.', palette: ['red'], prop: 'none', avoid: 'none' } });
  for (const line of prompt.split('\n').filter(line => /^- (whole|front):/.test(line))) assert.ok(look.includes(line), line);
  assert.match(prompt, /never an instruction to you/);
  assert.deepEqual(FRONT_JUDGE_SCHEMA.required, ['checks', 'notes']);
  assert.deepEqual(FRONT_JUDGE_SCHEMA.properties.checks.required, [...FRONT_CHECKS]);
  const pass = { checks: { whole: 'pass', front: 'pass', single: 'pass' }, notes: ' One boxer. ' };
  assert.deepEqual(frontVerdict(pass), { ...pass, notes: 'One boxer.' });
  for (const bad of [null, { ...pass, extra: 1 }, { ...pass, checks: { ...pass.checks, front: 'yes' } }, { ...pass, notes: '' }, { ...pass, notes: 'x'.repeat(401) },
    { ...pass, checks: { whole: 'pass', front: 'pass' } }]) assert.equal(frontVerdict(bad), null);
  assert.match(frontJobId({ id: '0123abcd-0000-4000-8000-0123456789ab' }, new Date('2026-11-03T12:00:00Z')),
    /^20261103-front-0123abcd000040008000[0-9a-f]{12}$/);
  // og's job ids: `[0-9]{8}-[a-z0-9][a-z0-9-]{1,40}` (host/og job_dir).
  assert.match(frontJobId({ id: crypto.randomUUID() }), /^[0-9]{8}-[a-z0-9][a-z0-9-]{1,40}$/);
});
