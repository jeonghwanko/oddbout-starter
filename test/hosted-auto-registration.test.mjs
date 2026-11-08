import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generation } from './helpers/generation-database.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { VALIDATOR_VERSION } from '../api/submissions.mjs';
import { withProfile } from '../host/generation-prompts.mjs';
import { hostedStatus } from '../mcp/cloud/hosted-tools.mjs';
import { sha256 } from '../api/http.mjs';

test('completed motions atomically queue registration, keep owner/profile and never enter a fighter', async () => {
  const { sql, owner } = await generation();
  try {
    const id = crypto.randomUUID(), token = crypto.randomUUID();
    const profile = { name: 'Auto Cat', description: 'A boxer.' };
    await sql.query(`insert into public.af_generation_jobs(id,owner_id,idempotency_key,description,language,status,brief,choice,lease_token,lease_expires_at)
      values($1,$2,$3,'Auto cat boxer','en','motions',$4,'a',$5,now()+interval '10 minutes')`,
    [id, owner, crypto.randomUUID(), { profile }, token]);
    const finish = () => sql.query("select (public.af_generation_finish($1,$2,'ok',$3)).*", [id, token, { preview: [{ clip: 'idle', name: 'motion-idle-0' }] }]);
    // Call composite once, not once per expanded column (which would consume the lease repeatedly).
    const result = await sql.query("select to_jsonb(public.af_generation_finish($1,$2,'ok',$3)) as job", [id, token,
      { preview: [{ clip: 'idle', name: 'motion-idle-0' }] }]);
    const job = result.rows[0].job;
    assert.equal(job.status, 'submitting'); assert.equal(job.owner_id, owner); assert.deepEqual(job.profile, profile);
    assert.equal(job.waiting_since, null); assert.equal(job.lease_token, null);
    assert.equal((await sql.query("select count(*)::int as n from public.af_generation_events where job_id=$1 and kind='register'", [id])).rows[0].n, 1);
    assert.equal((await sql.query('select count(*)::int as n from public.af_fighters')).rows[0].n, 0);
    await assert.rejects(finish, /lease-lost/);
  } finally { await sql.close(); }
});

test('a missing profile preserves completed art for operator attention rather than regeneration', async () => {
  const { sql, owner } = await generation();
  try {
    const id = crypto.randomUUID(), token = crypto.randomUUID(), preview = [{ clip: 'idle', name: 'motion-idle-0' }];
    await sql.query(`insert into public.af_generation_jobs(id,owner_id,idempotency_key,description,language,status,choice,lease_token,lease_expires_at)
      values($1,$2,$3,'Auto cat boxer','en','motions','a',$4,now()+interval '10 minutes')`, [id, owner, crypto.randomUUID(), token]);
    const { rows } = await sql.query("select to_jsonb(public.af_generation_finish($1,$2,'ok',$3)) as job", [id, token, { preview }]);
    assert.equal(rows[0].job.status, 'needs_review'); assert.equal(rows[0].job.error_code, 'invalid-profile');
    assert.deepEqual(rows[0].job.preview, preview); assert.equal(rows[0].job.lease_token, null);
  } finally { await sql.close(); }
});

test('default A after the deadline carries the draft through automatic registration into production without entry', async () => {
  const { sql, owner, call, work, healthy, validatorToken } = await generation();
  try {
    await healthy();
    const draft = { name: 'Auto Cat', description: 'A fixture boxer.', concept: 'A test fixture.',
      names: { en: 'Auto Cat', ko: '자동 고양이' }, lines: { win: 'Again!' }, stats: { power: 4, toughness: 3, speed: 2 } };
    const made = await call('POST', 'generations', { description: 'An automatic cat boxer', language: 'en' },
      undefined, { 'idempotency-key': crypto.randomUUID() });
    assert.equal(made.status, 200);
    const id = made.body.job.id;
    const claim = async status => {
      const response = await work('POST', 'claim', {});
      assert.equal(response.body.job?.status, status); return response.body.job;
    };
    const finish = (job, result) => work('POST', 'finish', { jobId: job.id, leaseToken: job.leaseToken, outcome: 'ok', result });
    await finish(await claim('queued'), { brief: { profile: draft } });
    await finish(await claim('appearance'), { candidates: ['front-a-0', 'front-b-0'] });
    await sql.query("update public.af_generation_jobs set appearance_auto_select_at=now()-interval '1 second' where id=$1", [id]);
    assert.equal((await sql.query('select public.af_generation_auto_choose_look() as n')).rows[0].n, 1);
    const chosen = (await call('GET', `generations/${id}`)).body.job;
    assert.equal(chosen.status, 'motions'); assert.equal(chosen.choice, 'a');
    const motions = await finish(await claim('motions'), { preview: Object.keys(spec.motions).map(clip => ({ clip, name: `motion-${clip.toLowerCase()}-0` })) });
    assert.equal(motions.body.status, 'submitting'); // No user register/approval call, and no manually forced legacy state.
    const held = await claim('submitting'), { concept, ...expected } = draft;
    assert.deepEqual(held.profile, expected);
    const manifest = withProfile(example, held.profile, held.brief), headers = { 'x-generation-lease': held.leaseToken, 'content-type': 'application/json' };
    assert.equal(manifest.profile.concept, concept); assert.equal(manifest.profile.name, draft.name);
    assert.equal((await work('POST', `jobs/${id}/submission`, JSON.stringify({ ...manifest, assets: [] }), headers)).status, 422);
    assert.equal((await sql.query('select count(*)::int as n from public.af_submissions')).rows[0].n, 0);
    const text = JSON.stringify(manifest), created = await work('POST', `jobs/${id}/submission`, text, headers);
    assert.equal(created.body.stage, 'uploading');
    const submissionId = created.body.submissionId;
    assert.equal((await work('POST', `jobs/${id}/submission`, text, headers)).body.submissionId, submissionId);
    // Storage metadata and the validator receipt are fixtures: this tests orchestration, not a real pixel decode.
    for (const asset of manifest.assets) await sql.query('insert into storage.objects values($1,$2,$3)',
      ['ai-fighter-beta', `${owner}/${submissionId}/${asset.id}.webp`, { size: asset.bytes }]);
    assert.equal((await work('POST', `jobs/${id}/submission/submit`, {}, headers)).body.stage, 'queued');
    await finish(held, { submissionId });
    assert.equal(hostedStatus((await call('GET', `generations/${id}`)).body.job).completed, false);
    const validator = (await call('POST', 'worker/claim', { submissionId }, validatorToken)).body;
    const registered = await call('POST', 'worker/finish', { submissionId, leaseToken: validator.leaseToken,
      manifestSha256: validator.manifestSha256, passed: true,
      result: { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: [] } }, validatorToken);
    assert.equal(registered.body.stage, 'registered');
    const job = (await call('GET', `generations/${id}`)).body.job;
    assert.equal(hostedStatus(job).completed, true);
    const fighter = (await sql.query('select owner_id, entered_at, profile from public.af_fighters where id=$1', [job.submission.fighterId])).rows[0];
    assert.equal(fighter.owner_id, owner); assert.equal(fighter.entered_at, null); assert.equal(fighter.profile.name, draft.name);
    assert.equal((await sql.query('select count(*)::int as n from public.af_submissions')).rows[0].n, 1);
  } finally { await sql.close(); }
});

test('submission completion rejects unrelated or unfinished uploads and preserves the lease for the correct result', async t => {
  const { sql, owner, other, work } = await generation();
  const manifest = JSON.stringify(example), hash = await sha256(new TextEncoder().encode(manifest));
  const bytes = example.assets.reduce((sum, asset) => sum + asset.bytes, 0);
  try {
    for (const reason of ['another job', 'another owner', 'still uploading']) await t.test(reason, async () => {
      await sql.exec('begin');
      try {
        const job = crypto.randomUUID(), lease = crypto.randomUUID(), submission = crypto.randomUUID();
        await sql.query(`insert into public.af_generation_jobs(id,owner_id,idempotency_key,description,language,status,lease_token)
          values($1,$2,$1,'Test boxer','en','submitting',$3)`, [job, owner, lease]);
        await sql.query(`insert into public.af_submissions(id,owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes,status)
          values($1,$2,$3,$4::text,$4::text::jsonb,$5,$6,$7)`, [submission, reason === 'another owner' ? other : owner,
          reason === 'another job' ? crypto.randomUUID() : job, manifest, hash, bytes, reason === 'still uploading' ? 'uploading' : 'queued']);
        const finish = submissionId => work('POST', 'finish', { jobId: job, leaseToken: lease, outcome: 'ok', result: { submissionId } });
        await sql.exec('savepoint finishing');
        const refused = await finish(submission);
        // PostgREST rolls back a refused RPC; emulate that boundary inside this fixture transaction.
        await sql.exec('rollback to savepoint finishing');
        assert.equal(refused.body.code, 'invalid-result');
        const kept = (await sql.query('select status,lease_token,submission_id from public.af_generation_jobs where id=$1', [job])).rows[0];
        assert.deepEqual(kept, { status: 'submitting', lease_token: lease, submission_id: null });
        const correct = crypto.randomUUID();
        await sql.query('delete from public.af_submissions where id=$1', [submission]);
        await sql.query(`insert into public.af_submissions(id,owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes,status)
          values($1,$2,$3,$4::text,$4::text::jsonb,$5,$6,'queued')`, [correct, owner, job, manifest, hash, bytes]);
        assert.equal((await finish(correct)).body.status, 'submitted');
      } finally { await sql.exec('rollback'); }
    });
  } finally { await sql.close(); }
});
