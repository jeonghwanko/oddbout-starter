import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generation } from './helpers/generation-database.mjs';

async function stopped(g) {
  const id = crypto.randomUUID();
  await g.sql.query(`insert into public.af_generation_jobs(id,owner_id,idempotency_key,description,language,status,choice,candidates,error_code)
    values($1,$2,$1,'Existing otter boxer','en','needs_review','a','["front-a-0","front-b-0"]','side-provider-refused')`, [id, g.owner]);
  return id;
}
const job = async (g, id) => (await g.sql.query('select to_jsonb(j) as job from public.af_generation_jobs j where id=$1', [id])).rows[0].job;
const request = (g, key = crypto.randomUUID()) => g.call('POST', 'generations',
  { description: 'An adult otter boxer', language: 'en', delegate: false }, undefined, { 'idempotency-key': key });

test('a preserved operator-review job permits one new request; every runnable state still blocks another', async () => {
  const g = await generation();
  try {
    await g.healthy();
    const old = await stopped(g), before = await job(g, old), key = crypto.randomUUID();
    const made = await request(g, key);
    assert.equal(made.status, 200, JSON.stringify(made.body));
    assert.equal(made.body.job.status, 'queued');
    assert.deepEqual(await job(g, old), before, 'old images, selection, error and timestamps remain unchanged');
    assert.equal((await request(g, key)).body.job.id, made.body.job.id, 'the same key still resumes the same request');
    for (const state of ['queued', 'appearance', 'appearance_ready', 'motions', 'motion_ready', 'submitting']) {
      await g.sql.query('update public.af_generation_jobs set status=$2 where id=$1', [made.body.job.id, state]);
      const refused = await request(g);
      assert.equal(refused.status, 409, state);
      assert.equal(refused.body.code, 'generation-quota', state);
    }
    assert.equal((await g.sql.query('select count(*)::int as n from public.af_generation_jobs where owner_id=$1', [g.owner])).rows[0].n, 2);
  } finally { await g.sql.close(); }
});

test('operator retry waits for the newer job to finish, then resumes the original without changing its choice', async () => {
  const g = await generation();
  try {
    await g.healthy();
    await g.sql.query('insert into public.af_admins(owner_id) values($1)', [g.other]);
    const old = await stopped(g), before = await job(g, old);
    const newer = (await request(g)).body.job.id;
    const retry = () => g.sql.query('select public.af_admin_generation_retry($1,$2) as result', [g.other, old]);
    await assert.rejects(retry, /review-conflict/);
    assert.deepEqual(await job(g, old), before);
    assert.equal((await g.call('POST', `admin/generations/${old}/retry`, {}, 'other-token-0123456789')).status, 409);
    await g.sql.query("update public.af_generation_jobs set status='submitted' where id=$1", [newer]);
    // A brief binds the chosen artwork to the motions stage.
    await g.sql.query("update public.af_generation_jobs set brief='{}' where id=$1", [old]);
    assert.equal((await retry()).rows[0].result.status, 'motions');
    assert.equal((await job(g, old)).choice, 'a');
    assert.deepEqual((await job(g, old)).candidates, before.candidates);
    assert.equal((await g.sql.query("select count(*)::int as n from public.af_generation_events where job_id=$1 and kind='operator'", [old])).rows[0].n, 1);
  } finally { await g.sql.close(); }
});

test('suspended work does not waive token, daily-request, owner authorization or operator authorization checks', async () => {
  const g = await generation();
  try {
    await g.healthy();
    const old = await stopped(g);
    await assert.rejects(g.sql.query('select public.af_admin_generation_retry($1,$2)', [g.owner, old]), /admin-required/);
    await g.sql.query('update public.af_creators set token_grant=0 where owner_id=$1', [g.owner]);
    const empty = await request(g);
    assert.equal(empty.status, 409); assert.equal(empty.body.code, 'generation-quota');
    await g.sql.query('update public.af_creators set token_grant=500000 where owner_id=$1', [g.owner]);
    await stopped(g); await stopped(g);
    const limited = await request(g);
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, 'rate-limit');
    await g.sql.query('update public.af_creators set enabled=false where owner_id=$1', [g.owner]);
    assert.equal((await request(g)).status, 403);
  } finally { await g.sql.close(); }
});
