import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generation } from './helpers/generation-database.mjs';
import { registerHostedTools } from '../mcp/cloud/hosted-tools.mjs';

const profile = { name: 'Auto Cat', description: 'A boxer.' };
const preview = [{ clip: 'idle', name: 'motion-idle-0' }];
async function held(sql, owner, draft = profile) {
  const id = crypto.randomUUID(), token = crypto.randomUUID();
  await sql.query(`insert into public.af_generation_jobs(id,owner_id,idempotency_key,description,language,status,brief,choice,lease_token,lease_expires_at)
    values($1,$2,$3,'Auto cat boxer','en','motions',$4,'a',$5,now()+interval '10 minutes')`,
  [id, owner, crypto.randomUUID(), { profile: draft }, token]);
  return { id, token, finish: async (result = { preview }) => (await sql.query(
    "select to_jsonb(public.af_generation_finish($1,$2,'ok',$3)) as job", [id, token, result])).rows[0].job };
}

test('quota-blocked automatic registration retries only registration and rechecks quota and admin rights', async () => {
  const { sql, owner, other } = await generation();
  try {
    await sql.query('insert into public.af_admins(owner_id) values($1)', [other]);
    await sql.query('update public.af_creators set fighter_limit=1 where owner_id=$1', [owner]);
    await sql.query('select public.af_register_character_profile($1,$2,$3,$4)', [owner, crypto.randomUUID(),
      { name: 'Existing', description: 'Existing fighter', portrait: '/art/character-profiles/test-v1.webp', color: '#ffeebb' }, 'kkumssi']);
    const job = await held(sql, owner), done = await job.finish();
    assert.equal(done.status, 'needs_review'); assert.equal(done.error_code, 'fighter-quota');
    await assert.rejects(sql.query('select public.af_admin_generation_retry($1,$2)', [owner, job.id]), /admin-required/);
    await assert.rejects(sql.query('select public.af_admin_generation_retry($1,$2)', [other, job.id]), /fighter-quota/);
    await sql.query('update public.af_creators set fighter_limit=2 where owner_id=$1', [owner]);
    const { rows } = await sql.query('select public.af_admin_generation_retry($1,$2) as job', [other, job.id]);
    assert.equal(rows[0].job.status, 'submitting');
    const row = (await sql.query('select * from public.af_generation_jobs where id=$1', [job.id])).rows[0];
    assert.deepEqual(row.preview, preview); assert.deepEqual(row.profile, profile); assert.equal(row.error_code, null);
  } finally { await sql.close(); }
});

test('missing previews cannot auto-register; invalid profiles cannot cause regeneration on operator retry', async () => {
  const { sql, owner, other } = await generation();
  try {
    await sql.query('insert into public.af_admins(owner_id) values($1)', [other]);
    const noPreview = await held(sql, owner);
    await assert.rejects(noPreview.finish({}), /invalid-result/);
    for (const name of [42, {}, [], '', '   ']) {
      const job = await held(sql, owner, { ...profile, name }), done = await job.finish();
      assert.equal(done.status, 'needs_review', JSON.stringify(name));
      assert.equal(done.error_code, 'invalid-profile');
      await assert.rejects(sql.query('select public.af_admin_generation_retry($1,$2)', [other, job.id]), /invalid-profile/);
      assert.deepEqual((await sql.query('select preview from public.af_generation_jobs where id=$1', [job.id])).rows[0].preview, preview);
    }
  } finally { await sql.close(); }
});

test('resumed registration consumes the old admission blocker before a later submitting-host failure', async () => {
  const { sql, owner, other } = await generation();
  try {
    await sql.query('insert into public.af_admins(owner_id) values($1)', [other]);
    await sql.query('update public.af_creators set fighter_limit=1 where owner_id=$1', [owner]);
    const addFighter = () => sql.query('select public.af_register_character_profile($1,$2,$3,$4)', [owner, crypto.randomUUID(),
      { name: 'Existing', description: 'Existing fighter', portrait: '/art/character-profiles/test-v1.webp', color: '#ffeebb' }, 'kkumssi']);
    await addFighter();
    const job = await held(sql, owner); assert.equal((await job.finish()).error_code, 'fighter-quota');
    await sql.query('update public.af_creators set fighter_limit=2 where owner_id=$1', [owner]);
    await sql.query('select public.af_admin_generation_retry($1,$2)', [other, job.id]);
    await addFighter(); // Admission already succeeded. Submission checks still enforce the current quota.
    await sql.query("update public.af_generation_jobs set status='needs_review',error_code='submitting-host-lost' where id=$1", [job.id]);
    const { rows } = await sql.query('select public.af_admin_generation_retry($1,$2) as job', [other, job.id]);
    assert.equal(rows[0].job.status, 'submitting');
    // No fresh registration admission: resume the existing packaging/submission stage with its immutable key.
    assert.equal((await sql.query("select count(*)::int as n from public.af_generation_events where job_id=$1 and kind='register'", [job.id])).rows[0].n, 1);
  } finally { await sql.close(); }
});

function hostedTool(tool, invoke) {
  let handler;
  registerHostedTools({ register: (name, _title, _description, _schema, call) => {
    if (name === tool) handler = call;
  }, invoke, db: {}, identity: null, hosted: {}, fetcher: fetch });
  return handler;
}
const registration = invoke => hostedTool('register_hosted_fighter', invoke);

test('a motion edit refused after automatic registration reports the current state without promising motion_ready', async () => {
  let posts = 0;
  const call = hostedTool('revise_hosted_motion', async (_path, method) => {
    if (method === 'POST') { posts++; return { ok: false, code: 'generation-state' }; }
    return { ok: true, job: { id: 'job', status: 'submitting', profile } };
  });
  const result = await call({ jobId: 'job', clip: 'run', note: 'Make the stride longer' });
  assert.equal(result.ok, false); assert.equal(result.code, 'generation-state');
  assert.equal(result.statusSummary?.state, 'submitting');
  assert.match(result.next, /not applied/); assert.doesNotMatch(result.next, /send the change then|take changes again/);
  assert.equal(posts, 1);
});

test('a failed state-conflict reread keeps the refusal and never repeats a revision', async () => {
  for (const fail of [() => ({ ok: false, code: 'not-found' }), () => { throw Error('offline'); }]) {
    let posts = 0;
    const call = hostedTool('revise_hosted_motion', async (_path, method) => {
      if (method === 'POST') { posts++; return { ok: false, code: 'generation-state' }; }
      return fail();
    });
    const result = await call({ jobId: 'job', clip: 'run', note: 'Longer stride' });
    assert.equal(result.ok, false); assert.equal(result.code, 'generation-state');
    assert.match(result.next, /not applied/); assert.doesNotMatch(result.next, /send the change then|take changes again/);
    assert.equal(posts, 1); assert.equal(result.job, undefined);
  }
});
test('racing and lost registration responses recover the winning submission without another POST', async () => {
  for (const code of ['generation-state', 'database-unavailable']) {
    let posts = 0, reads = 0;
    const call = registration(async (_path, method) => {
      if (method === 'POST') { posts++; return { ok: false, code }; }
      return { ok: true, job: { id: 'job', status: ++reads === 1 ? 'motion_ready' : 'submitting', profile } };
    });
    const result = await call({ jobId: 'job' });
    assert.equal(result.ok, true); assert.equal(result.job.status, 'submitting'); assert.equal(posts, 1);
  }
});

test('late profile changes are explicitly refused; an identical registration retry is recovered', async () => {
  const call = registration(async () => ({ ok: true, job: { id: 'job', status: 'submitting', profile } }));
  const changed = await call({ jobId: 'job', profile: { name: 'Another cat' } });
  assert.equal(changed.ok, false); assert.equal(changed.code, 'registration-profile-locked');
  assert.equal((await call({ jobId: 'job', profile: { name: 'Auto Cat' } })).ok, true);
});

test('failed ownership reads never post; an uncertain reread preserves the original failure', async () => {
  const denied = registration(async (_path, method) => {
    assert.notEqual(method, 'POST'); return { ok: false, code: 'not-found' };
  });
  assert.equal((await denied({ jobId: 'foreign' })).code, 'not-found');
  let reads = 0, posts = 0;
  const uncertain = registration(async (_path, method) => {
    if (method === 'POST') { posts++; return { ok: false, code: 'database-unavailable' }; }
    return ++reads === 1 ? { ok: true, job: { id: 'job', status: 'motion_ready', profile } } : { ok: false, code: 'not-found' };
  });
  const result = await uncertain({ jobId: 'job' });
  assert.equal(result.ok, false); assert.equal(result.code, 'database-unavailable'); assert.equal(posts, 1);
});
