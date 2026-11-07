import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generation } from './helpers/generation-database.mjs';

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
