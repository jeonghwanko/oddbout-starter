import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStages, submissionOutcome } from '../host/generation-stages.mjs';
import { generation } from './helpers/generation-database.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };

test('registration capacity refusals preserve completed art for operator recovery', () => {
  for (const code of ['fighter-quota', 'submission-quota', 'open-submission-exists']) {
    assert.equal(submissionOutcome({ status: 409, code }), 'review', code);
    assert.equal(submissionOutcome({ code }), 'review', code);
  }
  assert.equal(submissionOutcome({ status: 503, code: 'database-unavailable' }), 'retry');
  assert.equal(submissionOutcome({ status: 429, code: 'rate-limit' }), 'retry');
});

test('exhausted submission leases preserve completed work and recover only registration', async t => {
  for (const lostFinish of [false, true]) await t.test(lostFinish ? 'submitted package with lost finishes' : 'temporary service refusals', async () => {
    const { sql, owner, other, call, work, healthy } = await generation();
    try {
      await healthy();
      await sql.query('insert into public.af_admins(owner_id) values($1)', [other]);
      const id = crypto.randomUUID(), token = crypto.randomUUID();
      const profile = { name: example.profile.name, description: example.profile.description };
      const preview = [{ clip: 'idle', name: 'motion-idle-0' }];
      await sql.query(`insert into public.af_generation_jobs(id,owner_id,idempotency_key,description,language,status,brief,choice,lease_token)
        values($1,$2,$1,'A fixture boxer','en','motions',$3,'a',$4)`, [id, owner, { profile }, token]);
      assert.equal((await work('POST', 'finish', { jobId: id, leaseToken: token, outcome: 'ok', result: { preview } })).body.status, 'submitting');
      let submissionId;
      for (let attempt = 0; attempt < 3; attempt++) {
        const held = (await work('POST', 'claim', {})).body.job;
        assert.equal(held.id, id); assert.equal(held.status, 'submitting');
        if (lostFinish && attempt === 0) {
          const reply = await work('POST', `jobs/${id}/submission`, JSON.stringify(example),
            { 'x-generation-lease': held.leaseToken, 'content-type': 'application/json' });
          assert.equal(reply.body.stage, 'uploading'); submissionId = reply.body.submissionId;
          for (const asset of example.assets) await sql.query('insert into storage.objects values($1,$2,$3)',
            ['ai-fighter-beta', `${owner}/${submissionId}/${asset.id}.webp`, { size: asset.bytes }]);
          assert.equal((await work('POST', `jobs/${id}/submission/submit`, {}, { 'x-generation-lease': held.leaseToken })).body.stage, 'queued');
        }
        if (!lostFinish) assert.equal((await work('POST', 'finish', { jobId: id, leaseToken: held.leaseToken,
          outcome: submissionOutcome({ status: 503, code: 'database-unavailable' }), result: { code: 'database-unavailable' } })).body.status, 'submitting');
        // Advance only the lease clock; all state changes come from the actual worker API.
        await sql.query("update public.af_generation_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [id]);
      }
      assert.equal((await work('POST', 'claim', {})).body.stage, 'idle');
      const job = (await call('GET', `generations/${id}`)).body.job;
      assert.equal(job.status, 'needs_review'); assert.equal(job.error, 'stage-attempts');
      assert.deepEqual(job.profile, profile); assert.equal(job.preview[0].clip, 'idle');
      assert.deepEqual((await work('POST', 'ended', { jobs: [id] })).body.ended, []);
      await assert.rejects(sql.query('select public.af_admin_generation_retry($1,$2)', [owner, id]), /admin-required/);
      assert.equal((await sql.query('select public.af_admin_generation_retry($1,$2) as result', [other, id])).rows[0].result.status, 'submitting');
      const resumed = (await work('POST', 'claim', {})).body.job;
      assert.equal(resumed.id, id); assert.equal(resumed.status, 'submitting');
      if (lostFinish) {
        const reply = await work('POST', `jobs/${id}/submission`, JSON.stringify(example),
          { 'x-generation-lease': resumed.leaseToken, 'content-type': 'application/json' });
        assert.equal(reply.body.submissionId, submissionId); assert.equal(reply.body.stage, 'queued');
        assert.equal((await work('POST', 'finish', { jobId: id, leaseToken: resumed.leaseToken,
          outcome: 'ok', result: { submissionId } })).body.status, 'submitted');
      }
    } finally { await sql.close(); }
  });
});

test('a completed hosted package blocked by another upload resumes the same submission without generation or duplicate upload', async () => {
  const { sql, owner, other, call, work, healthy } = await generation();
  const root = await mkdtemp(path.join(tmpdir(), 'oddbout-submit-recovery-'));
  try {
    await healthy();
    await sql.query('insert into public.af_admins(owner_id) values($1)', [other]);
    const id = crypto.randomUUID(), token = crypto.randomUUID(), profile = { name: example.profile.name, description: example.profile.description };
    await sql.query(`insert into public.af_generation_jobs(id,owner_id,idempotency_key,description,language,status,brief,choice,lease_token)
      values($1,$2,$1,'A fixture boxer','en','motions',$3,'a',$4)`, [id, owner, { profile }, token]);
    const preview = [{ clip: 'idle', name: 'motion-idle-0' }];
    assert.equal((await work('POST', 'finish', { jobId: id, leaseToken: token, outcome: 'ok', result: { preview } })).body.status, 'submitting');
    const held = (await work('POST', 'claim', {})).body.job;
    assert.equal(held.id, id); assert.equal(held.status, 'submitting');
    // A separate package takes the owner's upload slot after automatic registration has already queued.
    const blocker = await call('POST', 'submissions', JSON.stringify(example), undefined,
      { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() });
    assert.equal(blocker.body.stage, 'uploading');
    await mkdir(path.join(root, 'package'));
    const file = path.join(root, 'package', 'fighter.json'), original = JSON.stringify(example);
    await writeFile(file, original);
    let sentText, generationCalls = 0;
    const api = {
      submission: async (job, text) => {
        sentText = text;
        const reply = await work('POST', `jobs/${job.id}/submission`, text,
          { 'x-generation-lease': job.leaseToken, 'content-type': 'application/json' });
        return { ...reply.body, status: reply.status };
      },
      asset: async () => { assert.fail('completed upload must not be sent again'); },
      submit: async () => { assert.fail('completed upload must not be submitted again'); },
    };
    const stages = createStages({ api, og: async () => { generationCalls++; assert.fail('registration recovery must never generate'); } });
    const refused = await stages.submitting(held, root);
    assert.equal(refused.result.code, 'open-submission-exists');
    const report = await work('POST', 'finish', { jobId: id, leaseToken: held.leaseToken, ...refused });
    assert.equal(report.body.status, 'needs_review');
    const kept = (await call('GET', `generations/${id}`)).body.job;
    assert.equal(kept.error, 'open-submission-exists'); assert.equal(kept.preview[0].clip, 'idle');
    assert.deepEqual(kept.profile, profile);
    // Simulate expiration of the unrelated upload, then use the normal operator recovery route.
    await sql.query("update public.af_submissions set status='rejected' where id=$1", [blocker.body.submissionId]);
    assert.equal((await sql.query('select public.af_admin_generation_retry($1,$2) as result', [other, id])).rows[0].result.status, 'submitting');
    const resumed = (await work('POST', 'claim', {})).body.job;
    assert.equal(resumed.id, id); assert.equal(resumed.status, 'submitting'); assert.deepEqual(resumed.profile, profile);
    // The upload/submit already committed before a worker restart; supply storage metadata as the existing fixture does.
    const created = await api.submission(resumed, sentText);
    assert.equal(created.stage, 'uploading');
    const submission = created.submissionId;
    for (const asset of example.assets) await sql.query('insert into storage.objects values($1,$2,$3)',
      ['ai-fighter-beta', `${owner}/${submission}/${asset.id}.webp`, { size: asset.bytes }]);
    assert.equal((await work('POST', `jobs/${id}/submission/submit`, {}, { 'x-generation-lease': resumed.leaseToken })).body.stage, 'queued');
    const recovered = await stages.submitting(resumed, root);
    assert.deepEqual(recovered, { outcome: 'ok', result: { submissionId: submission } });
    assert.equal((await work('POST', 'finish', { jobId: id, leaseToken: resumed.leaseToken, ...recovered })).body.status, 'submitted');
    assert.equal((await sql.query('select count(*)::int as n from public.af_submissions where owner_id=$1 and idempotency_key=$2', [owner, id])).rows[0].n, 1);
    assert.equal(await readFile(file, 'utf8'), original); assert.equal(generationCalls, 0);
  } finally {
    await sql.close();
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir())); assert.match(path.basename(root), /^oddbout-submit-recovery-/);
    await rm(root, { recursive: true, force: true });
  }
});
