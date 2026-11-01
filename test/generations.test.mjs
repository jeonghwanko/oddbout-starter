import { test } from 'node:test';
import assert from 'node:assert/strict';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { sha256, VALIDATOR_VERSION } from '../api/handler.mjs';
import { probeImage } from '../api/image-probe.mjs';
import { generation, png, webp } from './helpers/generation-database.mjs';
import { applyMigration, migrationNames, supabasePlatform } from './helpers/fighter-database.mjs';

test('the probe reads a PNG, JPEG and WebP header and nothing else', () => {
  assert.deepEqual(probeImage(png(640, 480)), { type: 'image/png', ext: 'png', width: 640, height: 480 });
  assert.deepEqual(probeImage(webp(300, 200)), { type: 'image/webp', ext: 'webp', width: 300, height: 200 });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 1, 0x2c, 2, 0x58, 3, 0, 0, 0]);
  assert.deepEqual(probeImage(jpeg), { type: 'image/jpeg', ext: 'jpg', width: 600, height: 300 });
  assert.equal(probeImage(new TextEncoder().encode('not a picture at all, just words here')), null);
});

test('a request past the account limit is refused until the operator raises that account', async () => {
  const { sql, owner, call, healthy } = await generation();
  try {
    await healthy();
    const profile = { name: 'Profile character', description: 'Introduction', portrait: '/art/character-profiles/test-v1.webp', color: '#ffeebb' };
    for (let i = 0; i < 3; i++) await sql.query('select public.af_register_character_profile($1,$2,$3,$4)', [owner, crypto.randomUUID(), profile, 'kkumssi']);
    const ask = () => call('POST', 'generations', { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko' }, undefined, { 'idempotency-key': crypto.randomUUID() });
    const check = () => call('POST', 'generations/check', { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko' });
    assert.equal((await ask()).body.code, 'fighter-quota');
    assert.equal((await check()).body.code, 'fighter-quota');
    await sql.query('update public.af_creators set fighter_limit = 4 where owner_id = $1', [owner]);
    // The check makes nothing.
    assert.deepEqual((await check()).body, { ok: true });
    assert.equal((await sql.query('select count(*)::int as n from public.af_generation_jobs')).rows[0].n, 0);
    const made = await ask();
    assert.equal(made.status, 200); assert.equal(made.body.job.status, 'queued');
    const definition = async fn => (await sql.query(`select pg_get_functiondef(oid) as d from pg_proc where proname = $1`, [fn])).rows[0].d;
    // A request's checks live in af_generation_check, which af_generation_create runs.
    for (const fn of ['af_create_submission', 'af_generation_check', 'af_generation_register'])
      assert.match(await definition(fn), /af_fighter_limit\(p_owner\) then raise exception 'fighter-quota'/);
    assert.match(await definition('af_generation_create'), /own := public\.af_generation_check\(p_owner, choice, p_host, p_host_consent\);/);
  } finally { await sql.close(); }
});

test('a request: off until the worker is healthy, pictures with rights, one hosted fighter per account, the same key the same job', async () => {
  const { sql, other, call, work, healthy } = await generation();
  try {
    assert.equal((await call('GET', 'generations/capabilities', undefined, null)).body.capabilities.reason, 'disabled');
    const ask = (key, body) => call('POST', 'generations', { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko', ...body }, undefined, { 'idempotency-key': key });
    assert.equal((await ask(crypto.randomUUID())).body.code, 'generation-unavailable');
    assert.equal((await healthy()).body.capabilities.hosted, true);
    assert.equal((await call('GET', 'generations/capabilities', undefined, null)).body.capabilities.hosted, true);
    // Pictures: a known kind within the sizes, kept privately; the rights confirmed with the request.
    assert.equal((await call('POST', 'generations/uploads', new TextEncoder().encode('plain words, no picture'))).status, 415);
    assert.equal((await call('POST', 'generations/uploads', png(32, 32))).body.code, 'image-size');
    const upload = (await call('POST', 'generations/uploads', png(512, 512))).body.upload;
    assert.equal(upload.width, 512);
    assert.equal((await ask(crypto.randomUUID(), { refs: [upload.id] })).body.code, 'rights-required');
    assert.equal((await call('POST', 'generations', { description: 'x', language: 'ko' }, undefined, { 'idempotency-key': crypto.randomUUID() })).body.code, 'invalid-description');
    // One line from four characters (2026-10-30): the site asks one line.
    assert.equal((await call('POST', 'generations/check', { description: '고양이', language: 'ko' })).body.code, 'invalid-description');
    assert.deepEqual((await call('POST', 'generations/check', { description: '고양이 복서', language: 'ko' })).body, { ok: true });
    const key = crypto.randomUUID(), made = await ask(key, { refs: [upload.id], rightsConfirmed: true });
    assert.equal(made.status, 200); assert.equal(made.body.job.status, 'queued');
    assert.equal((await ask(key, { refs: [upload.id], rightsConfirmed: true })).body.job.id, made.body.job.id);
    assert.equal((await ask(crypto.randomUUID())).body.code, 'generation-quota');
    // Another creator's upload is not his to use; his job is not readable by another.
    const theirs = (await call('POST', 'generations/uploads', png(256, 256), 'other-token-0123456789')).body.upload;
    assert.equal((await call('GET', `generations/${made.body.job.id}`, undefined, 'other-token-0123456789')).status, 404);
    assert.equal((await call('POST', 'generations', { description: '다른 사람의 그림을 쓰는 선수 신청', language: 'ko', refs: [upload.id], rightsConfirmed: true },
      'other-token-0123456789', { 'idempotency-key': crypto.randomUUID() })).body.code, 'invalid-refs');
    assert.ok(theirs.id);
    // A rejected request frees the account again. A full day queues a request to ODDBOUT (첫 선수 무료, 2026-10-30); only past the
    // waiting requests' limit is it refused.
    const claim = (await work('POST', 'claim', {})).body.job;
    assert.equal((await work('POST', 'finish', { jobId: claim.id, leaseToken: claim.leaseToken, outcome: 'rejected', result: { code: 'real-person' } })).body.status, 'rejected');
    assert.equal((await call('GET', 'generations')).body.used, false);
    await sql.query('update public.af_generation_hosts set daily_limit = 1 where official');
    await sql.query("insert into public.af_generation_jobs(owner_id,idempotency_key,description,language) values($1,$2,'남이 이미 신청한 선수 하나','ko')", [other, crypto.randomUUID()]);
    await sql.query('update public.af_generation_settings set queue_limit = 1');
    assert.equal((await ask(crypto.randomUUID())).body.code, 'generation-capacity');
    await sql.query('update public.af_generation_settings set queue_limit = 30');
    assert.equal((await ask(crypto.randomUUID())).body.job.status, 'queued');
  } finally { await sql.close(); }
});

test('the worker carries a job through brief, two looks, a change, a pick, motions, a clip again and the registration under the creator', async () => {
  const { sql, owner, call, work, healthy, objects, validatorToken } = await generation();
  try {
    await healthy();
    const upload = (await call('POST', 'generations/uploads', png(800, 600))).body.upload;
    const job = (await call('POST', 'generations', { description: 'A blue armored cat boxer with a scarf', language: 'en', refs: [upload.id], rightsConfirmed: true },
      undefined, { 'idempotency-key': crypto.randomUUID() })).body.job;
    // Only the generation key works here, and only here.
    assert.equal((await call('POST', 'generation-worker/claim', {}, validatorToken)).status, 403);
    assert.equal((await call('POST', 'worker/claim', {}, `afw_${'a'.repeat(64)}`)).status, 403);
    const step = async status => { const c = (await work('POST', 'claim', {})).body.job; assert.equal(c.status, status); return c; };
    const finish = (c, outcome, result) => work('POST', 'finish', { jobId: c.id, leaseToken: c.leaseToken, outcome, result });
    let held = await step('queued');
    assert.equal(held.refs.length, 1); assert.match(held.refs[0].url, /refs\//); assert.equal(held.description, 'A blue armored cat boxer with a scarf');
    assert.equal((await work('POST', 'claim', {})).body.stage, 'idle');
    assert.equal((await work('POST', 'progress', { jobId: held.id, leaseToken: crypto.randomUUID(), progress: 10 })).body.code, 'lease-lost');
    assert.equal((await work('POST', 'progress', { jobId: held.id, leaseToken: held.leaseToken, progress: 40, event: { kind: 'brief', calls: { codex: 1 } } })).status, 200);
    await finish(held, 'ok', { brief: { profile: { name: 'Blue Cat', description: 'A boxer.', names: { en: 'Blue Cat' } }, prompt: 'internal' } });
    // Two looks, pictures uploaded under the lease.
    held = await step('appearance');
    for (const name of ['look-a-0', 'look-b-0'])
      assert.equal((await work('PUT', `jobs/${held.id}/artifacts/${name}`, webp(400, 600), { 'x-generation-lease': held.leaseToken, 'content-type': 'image/webp' })).status, 200);
    assert.equal((await work('PUT', `jobs/${held.id}/artifacts/look-c-0`, png(10, 10), { 'x-generation-lease': held.leaseToken })).status, 415);
    assert.equal((await finish(held, 'ok', { candidates: ['look-a-0'] })).body.code, 'invalid-result');
    await finish(held, 'ok', { candidates: ['look-a-0', 'look-b-0'] });
    let read = (await call('GET', `generations/${job.id}`)).body.job;
    assert.equal(read.status, 'appearance_ready'); assert.deepEqual(read.candidates.map(c => c.key), ['a', 'b']);
    assert.match(read.candidates[0].url, /jobs\/.*look-a-0\.webp/); assert.equal(read.profile.name, 'Blue Cat'); assert.equal(read.revisionsLeft.appearance, 2);
    // A change asked: a new pair; then a pick.
    assert.equal((await call('POST', `generations/${job.id}/appearance`, { choose: 'c' })).body.code, 'invalid-answer');
    assert.equal((await call('POST', `generations/${job.id}/appearance`, { revise: 'smaller ears' })).body.job.status, 'appearance');
    held = await step('appearance'); assert.equal(held.appearanceNote, 'smaller ears');
    await finish(held, 'ok', { candidates: ['look-a-1', 'look-b-1'] });
    assert.equal((await call('POST', `generations/${job.id}/appearance`, { choose: 'b' })).body.job.status, 'motions');
    held = await step('motions'); assert.equal(held.choice, 'b'); assert.equal(held.candidates[1].name, 'look-b-1');
    // Previews ahead of the package (2026-10-28): the worker's drafts show while the motions are made, this round's only.
    const drafting0 = { 'x-generation-lease': held.leaseToken, 'content-type': 'image/webp' };
    for (const name of ['draft-combo-0', 'draft-walk-t0-0']) assert.equal((await work('PUT', `jobs/${held.id}/artifacts/${name}`, webp(200, 200), drafting0)).status, 200);
    assert.deepEqual((await call('GET', `generations/${job.id}`)).body.job.drafts, []);
    // A walk's take before its gate carries its state (2026-11-01); a state the API does not know is dropped.
    await work('POST', 'progress', { jobId: held.id, leaseToken: held.leaseToken, event: { kind: 'drafts',
      clips: [{ clip: 'combo', name: 'draft-combo-0', state: 'made-up' }, { clip: 'walk', name: 'draft-walk-t0-0', state: 'checking' },
        { clip: 'dance', name: 'draft-dance-0' }, { clip: 'run', name: 'motion-run-0' }] } });
    const drafting = (await call('GET', `generations/${job.id}`)).body.job;
    assert.deepEqual(drafting.drafts.map(d => [d.clip, d.state ?? null]), [['combo', null], ['walk', 'checking']]);
    assert.ok(drafting.drafts.every(d => typeof d.url === 'string'));
    assert.match(drafting.drafts[1].url, /jobs\/.*draft-walk-t0-0\.webp/);
    // The list the worker sent last wins (its `seq`): an earlier send that timed out on the worker and landed after it is not shown.
    const drafts = (seq, state) => work('POST', 'progress', { jobId: held.id, leaseToken: held.leaseToken,
      event: { kind: 'drafts', seq, clips: [{ clip: 'combo', name: 'draft-combo-0' }, { clip: 'walk', name: 'draft-walk-t0-0', state }] } });
    await drafts(1_800_000_000_002, 'retaking');
    await drafts(1_800_000_000_001, 'checking');
    assert.deepEqual((await call('GET', `generations/${job.id}`)).body.job.drafts.map(d => d.state ?? null), [null, 'retaking']);
    // The run made from the walk carries its note (2026-10-29); a note the API does not know is refused.
    const preview = ['idle', 'walk', 'run'].map(clip => ({ clip, name: `motion-${clip.toLowerCase()}-0`, ...(clip === 'run' ? { note: 'run-from-walk' } : {}) }));
    assert.equal((await finish(held, 'ok', { preview: [{ clip: 'dance', name: 'x' }] })).body.code, 'invalid-result');
    assert.equal((await finish(held, 'ok', { preview: preview.map(p => ({ ...p, note: 'made-up' })) })).body.code, 'invalid-result');
    await finish(held, 'ok', { preview });
    read = (await call('GET', `generations/${job.id}`)).body.job;
    assert.equal(read.status, 'motion_ready'); assert.deepEqual(read.preview.map(p => p.clip), ['idle', 'walk', 'run']);
    assert.deepEqual(read.preview.map(p => p.note ?? null), [null, null, 'run-from-walk']);
    assert.deepEqual(read.drafts, []); // the package's previews replace them
    assert.equal((await call('POST', `generations/${job.id}/motions`, { revise: { clip: 'walk', note: '덜 통통 튀게'.repeat(25) } })).body.job.revisionsLeft.motions, 2);
    held = await step('motions'); assert.deepEqual(held.motionNote, { clip: 'walk', note: '덜 통통 튀게'.repeat(25) });
    assert.deepEqual((await call('GET', `generations/${job.id}`)).body.job.drafts, []); // round 0's drafts are not this round's
    await finish(held, 'ok', { preview });
    // Registered: his confirmed profile, the package submitted under his account by the worker.
    assert.equal((await call('POST', `generations/${job.id}/register`, { profile: { name: '', description: 'x' } })).body.code, 'invalid-profile');
    assert.equal((await call('POST', `generations/${job.id}/register`, { profile: { name: 'Blue', description: 'x', stats: { power: 5, toughness: 5, speed: 5 } } })).body.code, 'invalid-profile');
    const profile = { name: 'Blue Cat', description: 'A blue boxer.', lines: { win: 'Again!' }, stats: { power: 4, toughness: 3, speed: 2 } };
    assert.equal((await call('POST', `generations/${job.id}/register`, { profile })).body.job.status, 'submitting');
    held = await step('submitting'); assert.deepEqual(held.profile, profile);
    const lease = { 'x-generation-lease': held.leaseToken };
    const created = await work('POST', `jobs/${held.id}/submission`, JSON.stringify(example), { ...lease, 'content-type': 'application/json' });
    assert.equal(created.status, 200); assert.equal(created.body.stage, 'uploading');
    const row = (await sql.query('select owner_id, id from public.af_submissions where idempotency_key = $1', [held.id])).rows[0];
    assert.equal(row.owner_id, owner);
    for (const a of example.assets) await sql.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${row.id}/${a.id}.webp`, { size: a.bytes }]);
    // An upload past its window is refused by its own code, as on the creator's routes, not as a database fault (API 점검 2026-10-29).
    await sql.query("update public.af_submissions set expires_at = now() - interval '1 minute' where id = $1", [row.id]);
    const expired = await work('POST', `jobs/${held.id}/submission/submit`, {}, lease);
    assert.deepEqual([expired.status, expired.body.code], [409, 'upload-expired']);
    await sql.query("update public.af_submissions set expires_at = now() + interval '1 day' where id = $1", [row.id]);
    assert.equal((await work('POST', `jobs/${held.id}/submission/submit`, {}, lease)).body.stage, 'queued');
    await finish(held, 'ok', { submissionId: row.id });
    read = (await call('GET', `generations/${job.id}`)).body.job;
    assert.equal(read.status, 'submitted'); assert.equal(read.submission.id, row.id);
    assert.ok([...objects.keys()].some(key => key.startsWith('af-generation/jobs/')));
    // The events keep no description or prompt.
    const events = (await sql.query('select data::text as d from public.af_generation_events where job_id = $1', [job.id])).rows.map(r => r.d).join(' ');
    assert.ok(!events.includes('scarf') && !events.includes('internal'));
  } finally { await sql.close(); }
});

test('cancel, leases that run out and creators who do not answer', async () => {
  const { sql, call, work, healthy } = await generation();
  try {
    await healthy();
    const ask = () => call('POST', 'generations', { description: '모자를 쓴 너구리 레슬러', language: 'ko' }, undefined, { 'idempotency-key': crypto.randomUUID() });
    // Cancelled while the worker holds it: his lease no longer counts.
    let job = (await ask()).body.job, held = (await work('POST', 'claim', {})).body.job;
    assert.equal((await call('DELETE', `generations/${job.id}`)).body.job.status, 'cancelled');
    assert.equal((await work('POST', 'finish', { jobId: held.id, leaseToken: held.leaseToken, outcome: 'ok', result: { brief: {} } })).body.code, 'lease-lost');
    // A stage that lost its worker three times fails.
    job = (await ask()).body.job;
    for (let i = 0; i < 3; i += 1) {
      assert.ok((await work('POST', 'claim', {})).body.job);
      await sql.query("update public.af_generation_jobs set lease_expires_at = now() - interval '1 second' where id = $1", [job.id]);
    }
    assert.equal((await work('POST', 'claim', {})).body.stage, 'idle');
    assert.equal((await call('GET', `generations/${job.id}`)).body.job.error, 'stage-attempts');
    // A creator who leaves the looks unanswered for a week: expired, and his free fighter is used (its looks were painted, 2026-10-30).
    await sql.query("delete from public.af_generation_jobs");
    job = (await ask()).body.job;
    held = (await work('POST', 'claim', {})).body.job;
    await work('POST', 'finish', { jobId: held.id, leaseToken: held.leaseToken, outcome: 'ok', result: { brief: { profile: {} } } });
    held = (await work('POST', 'claim', {})).body.job;
    await work('POST', 'finish', { jobId: held.id, leaseToken: held.leaseToken, outcome: 'ok', result: { candidates: ['a-0', 'b-0'] } });
    await sql.query("update public.af_generation_jobs set waiting_since = now() - interval '8 days' where id = $1", [job.id]);
    await work('POST', 'claim', {});
    assert.equal((await call('GET', `generations/${job.id}`)).body.job.status, 'expired');
    // 보유 토큰 (2026-10-31): an expired job uses no free fighter any more; his balance decides, and these stages kept no tokens.
    assert.equal((await call('GET', 'generations')).body.used, false);
  } finally { await sql.close(); }
});

test('retries count toward a stage\'s three leases and wait; progress is a heartbeat; a cancel before any work and a failed package free their slots', async () => {
  const { sql, owner, call, work, healthy } = await generation();
  try {
    await healthy();
    const ask = () => call('POST', 'generations', { description: '모자를 쓴 너구리 레슬러', language: 'ko' }, undefined, { 'idempotency-key': crypto.randomUUID() });
    const first = (await ask()).body.job;
    for (let i = 0; i < 3; i += 1) {
      const held = (await work('POST', 'claim', {})).body.job;
      assert.ok(held, `lease ${i + 1}`);
      await work('POST', 'finish', { jobId: held.id, leaseToken: held.leaseToken, outcome: 'retry', result: { code: 'brief-exit-1' } });
      // A handed-back stage waits before it is claimed again.
      assert.equal((await work('POST', 'claim', {})).body.stage, 'idle');
      await sql.query("update public.af_generation_jobs set lease_expires_at = now() - interval '1 second' where id = $1", [first.id]);
    }
    assert.equal((await work('POST', 'claim', {})).body.stage, 'idle');
    assert.equal((await call('GET', `generations/${first.id}`)).body.job.error, 'stage-attempts');
    // Progress keeps the worker on the books while a long stage runs.
    const second = (await ask()).body.job, held = (await work('POST', 'claim', {})).body.job;
    assert.match(held.createdAt, /^\d{4}-\d{2}-\d{2}/);
    await sql.query("update public.af_generation_hosts set worker_seen_at = now() - interval '10 minutes' where official");
    assert.equal((await call('GET', 'generations/capabilities', undefined, null)).body.capabilities.hosted, false);
    await work('POST', 'progress', { jobId: held.id, leaseToken: held.leaseToken, progress: 50 });
    assert.equal((await call('GET', 'generations/capabilities', undefined, null)).body.capabilities.hosted, true);
    // The official host's day counts the jobs it started (their looks, 2026-10-30): neither of these reached them.
    await sql.query("update public.af_generation_jobs set brief = null, status = 'cancelled', lease_token = null where id = $1", [second.id]);
    const today = (await call('GET', 'generations/capabilities', undefined, null)).body.capabilities.today;
    assert.equal(today, 0);
    // A submitted package that failed its check frees the account's one hosted fighter.
    const third = (await ask()).body.job;
    assert.equal((await ask()).body.code, 'generation-quota');
    const text = JSON.stringify(example), bytes = example.assets.reduce((sum, a) => sum + a.bytes, 0);
    const sub = (await sql.query('select (public.af_create_submission($1, $2, $3, $4, $5, null)).id as id',
      [owner, third.id, text, await sha256(new TextEncoder().encode(text)), bytes])).rows[0];
    await sql.query("update public.af_generation_jobs set status = 'submitted', submission_id = $2 where id = $1", [third.id, sub.id]);
    await sql.query("update public.af_submissions set status = 'rejected' where id = $1", [sub.id]);
    assert.equal((await call('GET', 'generations')).body.used, false);
    await sql.query("update public.af_generation_jobs set created_at = now() - interval '2 days' where id = $1", [first.id]);  // his three a day
    assert.equal((await ask()).status, 200);
    assert.equal(owner.length, 36);
  } finally { await sql.close(); }
});


test('맡기기: the worker picks the look and the job goes on to the motions; with no pick, or a job not left to it, the creator is asked', async () => {
  const { sql, owner, call, work, healthy } = await generation();
  try {
    await healthy();
    // Three requests whose looks are painted and then cancelled: three free fighters (each cancel after its looks keeps one used).
    await sql.query('update public.af_creators set hosted_credits = 3 where owner_id = $1', [owner]);
    const ask = (body, token) => call('POST', 'generations', { description: '모자를 쓴 너구리 레슬러', language: 'ko', ...body }, token, { 'idempotency-key': crypto.randomUUID() });
    assert.equal((await ask({ delegate: 'yes' })).body.code, 'invalid-body');
    const job = (await ask({ delegate: true })).body.job;
    assert.equal(job.delegate, true);
    const finish = (c, result) => work('POST', 'finish', { jobId: c.id, leaseToken: c.leaseToken, outcome: 'ok', result });
    let held = (await work('POST', 'claim', {})).body.job;
    assert.equal(held.delegate, true);
    await finish(held, { brief: { profile: { name: '너구리' } } });
    held = (await work('POST', 'claim', {})).body.job;
    assert.equal((await finish(held, { candidates: ['look-a-0', 'look-b-0'], choice: 'c' })).body.code, 'invalid-result');
    assert.equal((await finish(held, { candidates: ['look-a-0', 'look-b-0'], choice: 'b' })).body.status, 'motions');
    const read = (await call('GET', `generations/${job.id}`)).body.job;
    assert.equal(read.status, 'motions'); assert.equal(read.choice, 'b'); assert.equal(read.candidates.length, 2);
    held = (await work('POST', 'claim', {})).body.job;
    assert.equal(held.status, 'motions'); assert.equal(held.choice, 'b');
    // The pick found none: he is asked as before.
    await call('DELETE', `generations/${job.id}`);
    const asked = (await ask({ delegate: true })).body.job;
    held = (await work('POST', 'claim', {})).body.job; await finish(held, { brief: { profile: {} } });
    held = (await work('POST', 'claim', {})).body.job;
    assert.equal((await finish(held, { candidates: ['look-a-0', 'look-b-0'] })).body.status, 'appearance_ready');
    assert.equal((await call('GET', `generations/${asked.id}`)).body.job.choice, null);
    // A job he did not leave to us takes no pick.
    await call('DELETE', `generations/${asked.id}`);
    const own = (await ask({})).body.job;
    assert.equal(own.delegate, false);
    held = (await work('POST', 'claim', {})).body.job; await finish(held, { brief: { profile: {} } });
    held = (await work('POST', 'claim', {})).body.job;
    assert.equal((await finish(held, { candidates: ['look-a-0', 'look-b-0'], choice: 'a' })).body.code, 'invalid-result');
  } finally { await sql.close(); }
});

// 보유 토큰 (2026-10-31): his own PC's and another person's host's tokens are their subscription's, not his balance's. Review (2026-10-31):
// nor is the brief the official host wrote for such a request (the day's budget counts it), nor an operator's job; a request to any host
// that the official host took is ODDBOUT's making, taken off.
test('his balance counts the official host\'s tokens on his jobs only, however many jobs he made elsewhere', async () => {
  const { sql, owner, call, healthy } = await generation();
  try {
    await healthy();
    const host = (await sql.query(`insert into public.af_generation_hosts(owner_id, name, billing, approved, terms_accepted_at)
      values ($1, '내 PC', 'subscription', true, now()) returning id`, [owner])).rows[0].id;
    const official = (await sql.query('select public.af_generation_official() as id')).rows[0].id;
    const job = async (choice, requested, assigned = requested) => (await sql.query(`insert into public.af_generation_jobs(owner_id, idempotency_key, description,
      language, status, host_choice, requested_host, assigned_host, host_consent, created_at)
      values ($1, $2, 'A fighter', 'en', 'submitted', $3, $4, $5, false, now() - interval '2 days') returning id`,
      [owner, crypto.randomUUID(), choice, requested, assigned])).rows[0].id;
    const used = async (hostId, jobId, tokens, stage = 'motions', admin = false) => sql.query(`insert into public.af_generation_usage(host_id, job_id, stage,
      tokens, admin) values ($1, $2, $3, $4, $5)`, [hostId, jobId, stage, tokens, admin]);
    const ours = await job('oddbout', null, official);
    await used(official, ours, 20000, 'queued');
    await used(official, ours, 100000);
    // An operator's tests on a job of his (marked when the job was an operator's): not his balance's.
    await used(official, ours, 70000, 'appearance', true);
    for (let i = 0; i < 5; i++) {
      const mine = await job('host', host);
      await used(official, mine, 20000, 'queued');
      await used(host, mine, 200000);
    }
    const overview = (await call('GET', 'generations')).body;
    assert.equal(overview.jobs.length, 5);
    assert.deepEqual(overview.tokens, { granted: 500000, spent: 120000, balance: 380000 });
    assert.equal(overview.used, false);
    assert.deepEqual(overview.jobs.map(j => j.tokens), [0, 0, 0, 0, 0], 'his own PC\'s jobs took none of his tokens');
    // The day's budget counts every official token but an operator's: his request and the five briefs.
    assert.equal((await call('GET', 'generations/capabilities', undefined, null)).body.capabilities.usage.tokensToday, 220000);
    // A request to any host the official host took: all its official tokens, its brief too.
    const anywhere = await job('any', null, official);
    await used(official, anywhere, 20000, 'queued');
    await used(official, anywhere, 30000);
    assert.deepEqual((await call('GET', 'generations')).body.tokens, { granted: 500000, spent: 170000, balance: 330000 });
    assert.equal((await call('GET', `generations/${anywhere}`)).body.job.tokens, 50000);
    const ask = await call('POST', 'generations', { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko' }, undefined, { 'idempotency-key': crypto.randomUUID() });
    assert.equal(ask.status, 200);
  } finally { await sql.close(); }
});

// 보유 토큰 (2026-10-31, 사용자: "(회원가입하면) 50만 토큰을 보여주고, 차감 보유 토큰을 보여줘"): every account starts at 500,000; the
// official host's tokens come off whatever the outcome; at or below zero a request is refused, a job under way goes on; the operator raises
// an account's grant, and an operator's own request is never refused.
test('tokens: 500,000 to start, every official token taken off, refused at zero, a job under way goes on, an operator never refused', async () => {
  const { sql, owner, call, work, healthy } = await generation();
  try {
    await healthy();
    const ask = () => call('POST', 'generations', { description: '이름: 냥잽\n빨간 글러브를 낀 고양이 복서', language: 'ko', delegate: true },
      undefined, { 'idempotency-key': crypto.randomUUID() });
    const step = async status => { const c = (await work('POST', 'claim', {})).body.job; assert.equal(c?.status, status); return c; };
    const tokens = total => ({ total, input: total - 100, cachedInput: 50, output: 100, reasoning: 0 });
    const finish = (c, outcome, result) => work('POST', 'finish', { jobId: c.id, leaseToken: c.leaseToken, outcome, result });
    const overview = async () => (await call('GET', 'generations')).body;
    assert.deepEqual((await overview()).tokens, { granted: 500000, spent: 0, balance: 500000 });
    assert.deepEqual((await call('GET', 'me')).body.account.tokens, { granted: 500000, spent: 0, balance: 500000 });
    // The brief and the looks take their tokens off, and the job says how many it used.
    const job = (await ask()).body.job;
    assert.equal(job.tokens, 0);
    await finish(await step('queued'), 'ok', { brief: { profile: { name: '냥잽' } }, tokens: tokens(20000) });
    assert.deepEqual((await overview()).tokens, { granted: 500000, spent: 20000, balance: 480000 });
    // A grant smaller than what he spent: the job under way still goes on, and the balance goes below zero.
    await sql.query('update public.af_creators set token_grant = 25000 where owner_id = $1', [owner]);
    assert.equal((await finish(await step('appearance'), 'ok', { candidates: ['front-a-0', 'front-b-0'], choice: 'a', tokens: tokens(30000) })).body.status, 'motions');
    assert.equal((await call('GET', `generations/${job.id}`)).body.job.tokens, 50000);
    let now = await overview();
    assert.deepEqual(now.tokens, { granted: 25000, spent: 50000, balance: -25000 });
    assert.equal(now.used, true);
    assert.deepEqual((await call('GET', 'me')).body.account.tokens, { granted: 25000, spent: 50000, balance: -25000 });
    // Cancelled: the tokens stay spent, and at or below zero he is refused.
    await call('DELETE', `generations/${job.id}`);
    assert.equal((await overview()).tokens.spent, 50000);
    assert.equal((await ask()).body.code, 'generation-quota');
    // The operator raises his grant: he may ask again.
    await sql.query('update public.af_creators set token_grant = 600000 where owner_id = $1', [owner]);
    now = await overview();
    assert.deepEqual([now.tokens.balance, now.used], [550000, false]);
    const again = (await ask()).body.job;
    assert.ok(again?.id);
    await call('DELETE', `generations/${again.id}`);
    // An operator is never refused, whatever his balance.
    await sql.query('update public.af_creators set token_grant = 0 where owner_id = $1', [owner]);
    assert.equal((await ask()).body.code, 'generation-quota');
    await sql.query('insert into public.af_admins(owner_id) values($1)', [owner]);
    assert.equal((await overview()).used, false);
    assert.ok((await ask()).body.job?.id);
  } finally { await sql.close(); }
});

// 토큰 예산으로 시작 (2026-10-31): the official host starts requests to ODDBOUT while its tokens since 00:00 UTC are under the day's
// budget; each stage's tokens come with its result. An operator's request goes first and is not held back, nor counted.
test('the day\'s token budget queues requests to ODDBOUT: the brief runs, the looks wait, a started job\'s stages and an operator\'s request do not', async () => {
  const { sql, other, call, work, healthy } = await generation();
  try {
    await healthy();
    await sql.query('update public.af_generation_settings set daily_token_budget = 1000');
    const ask = token => call('POST', 'generations', { description: '모자를 쓴 너구리 레슬러', language: 'ko' }, token, { 'idempotency-key': crypto.randomUUID() });
    const claim = async () => (await work('POST', 'claim', {})).body.job ?? null;
    const finish = (c, outcome, result) => work('POST', 'finish', { jobId: c.id, leaseToken: c.leaseToken, outcome, result });
    const tokens = total => ({ total, input: total - 50, cachedInput: 10, output: 50, reasoning: 0 });
    const mine = (await ask()).body.job;
    assert.deepEqual(mine.queue, { position: 1, reason: 'turn', dailyLimit: 3, startedToday: 0 });
    await finish(await claim(), 'ok', { brief: { profile: {} }, tokens: tokens(300) });
    const started = await claim();
    assert.equal(started.id, mine.id); assert.equal(started.status, 'appearance');
    await finish(started, 'ok', { candidates: ['look-a-0', 'look-b-0'], tokens: tokens(800) });
    assert.equal((await call('GET', `generations/${mine.id}`)).body.job.queue, null);
    // Each stage's tokens are kept; a malformed count is left out, the result still lands.
    const kept = (await sql.query('select stage, tokens, input, cached_input, output, admin from public.af_generation_usage order by id')).rows;
    assert.deepEqual(kept.map(r => [r.stage, Number(r.tokens), Number(r.input), Number(r.cached_input), Number(r.output), r.admin]),
      [['queued', 300, 250, 10, 50, false], ['appearance', 800, 750, 10, 50, false]]);
    // 1,100 of 1,000 spent: another creator's request is briefed, then waits for 00:00 UTC (UTC로 통일, 2026-10-31).
    const theirs = (await ask('other-token-0123456789')).body.job;
    await finish(await claim(), 'ok', { brief: { profile: {} }, tokens: { total: -5 } });
    assert.equal((await sql.query('select count(*)::int as n from public.af_generation_usage')).rows[0].n, 2);
    assert.equal(await claim(), null);
    const waiting = (await call('GET', `generations/${theirs.id}`, undefined, 'other-token-0123456789')).body.job;
    const midnight = (await sql.query("select to_jsonb(public.af_generation_day_start() + interval '1 day') #>> '{}' as t")).rows[0].t;
    // The day turns at 00:00 UTC whatever the session's time zone.
    const utcMidnight = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1));
    assert.equal(Date.parse(midnight), utcMidnight.getTime());
    const zone = (await sql.query('select current_setting(\'TimeZone\') as z')).rows[0].z;
    for (const tz of ['Asia/Seoul', 'America/Los_Angeles']) {
      await sql.query('select set_config(\'TimeZone\', $1, false)', [tz]);
      assert.equal(new Date((await sql.query('select public.af_generation_day_start() as t')).rows[0].t).getTime(), utcMidnight.getTime() - 86_400_000, tz);
    }
    await sql.query('select set_config(\'TimeZone\', $1, false)', [zone]);
    assert.deepEqual(waiting.queue, { position: 1, reason: 'usage', resetsAt: midnight, dailyLimit: 3, startedToday: 3 });
    const caps = (await call('GET', 'generations/capabilities', undefined, null)).body.capabilities;
    assert.deepEqual(caps.usage, { tokensToday: 1100, dailyTokenBudget: 1000, resetsAt: midnight }); assert.equal(caps.waiting, 1);
    // His started job's change is not held back.
    await call('POST', `generations/${mine.id}/appearance`, { revise: 'smaller ears' });
    const again = await claim();
    assert.equal(again.id, mine.id);
    await finish(again, 'ok', { candidates: ['look-a-1', 'look-b-1'], tokens: tokens(700) });
    // An operator's request goes first and starts on a spent day; its tokens are kept and not counted.
    const operator = crypto.randomUUID();
    await sql.query('insert into auth.users(id) values($1)', [operator]);
    await sql.query('insert into public.af_creators(owner_id) values($1)', [operator]);
    await sql.query('insert into public.af_admins(owner_id) values($1)', [operator]);
    const test = (await sql.query(`insert into public.af_generation_jobs(owner_id, idempotency_key, description, language, status, brief, created_at, updated_at)
      values ($1, $2, '운영자 시험 선수', 'ko', 'appearance', '{"profile":{}}', now() + interval '1 minute', now() + interval '1 minute') returning id`, [operator, crypto.randomUUID()])).rows[0].id;
    assert.equal((await sql.query('select (public.af_generation_queue($1)->>\'position\')::int as p', [test])).rows[0].p, 1);
    assert.equal((await sql.query('select public.af_generation_queue($1)->>\'reason\' as r', [test])).rows[0].r, 'turn');
    assert.equal((await sql.query('select (public.af_generation_queue($1)->>\'position\')::int as p', [theirs.id])).rows[0].p, 2);
    const first = await claim();
    assert.equal(first.id, test);
    await finish(first, 'ok', { candidates: ['look-a-0', 'look-b-0'], tokens: tokens(5000) });
    assert.equal((await call('GET', 'generations/capabilities', undefined, null)).body.capabilities.usage.tokensToday, 1800);
    assert.equal(await claim(), null);
    // A new day (the spend before 00:00 UTC), or no budget at all, starts the waiting one.
    await sql.query("update public.af_generation_usage set at = public.af_generation_day_start() - interval '1 hour' where not admin");
    const next = await claim();
    assert.equal(next.id, theirs.id); assert.equal(next.status, 'appearance');
    assert.ok((await sql.query('select started_at from public.af_generation_jobs where id = $1', [theirs.id])).rows[0].started_at);
    await sql.query('update public.af_generation_settings set daily_token_budget = null');
    assert.equal((await call('GET', 'generations/capabilities', undefined, null)).body.capabilities.usage.dailyTokenBudget, null);
    assert.equal(other.length, 36);
  } finally { await sql.close(); }
});

// The heartbeat may carry the subscription's rate-limit reading (2026-10-31): kept for the operator, never holding back; a malformed one
// is left out and the heartbeat still answers.
test('the heartbeat keeps the subscription\'s rate-limit reading for the operator and leaves out a malformed one', async () => {
  const { sql, work } = await generation();
  try {
    const health = { ok: true, codex: true, grok: true, at: new Date().toISOString() };
    const reading = { usedPercent: 12.34, windowMinutes: 10080, resetsAt: '2026-11-03T00:00:00.000Z' };
    assert.equal((await work('POST', 'heartbeat', { health, usage: reading })).body.ok, true);
    const kept = async () => (await sql.query('select usage, usage_at is not null as seen from public.af_generation_hosts where official')).rows[0];
    const { usedPercent, windowMinutes, resetsAt } = (await kept()).usage;
    assert.deepEqual([usedPercent, windowMinutes, Date.parse(resetsAt)], [12.3, 10080, Date.parse(reading.resetsAt)]);
    for (const bad of [{ usedPercent: 140 }, { usedPercent: 'x' }, { usedPercent: 5, extra: 1 }, { usedPercent: 5, resetsAt: 'tomorrow' }]) {
      assert.equal((await work('POST', 'heartbeat', { health, usage: bad })).body.ok, true);
      assert.equal((await kept()).usage.usedPercent, 12.3);
    }
  } finally { await sql.close(); }
});

// 첫 선수 무료, review (2026-10-30): idle is not a motion to redo, a limit of 0 takes no request, a stalled host's cancel gives it back.
test('review: idle cannot be redone, a daily limit of 0 refuses, a cancel while the host is offline gives the free fighter back', async () => {
  const { sql, owner, call, work, healthy } = await generation();
  try {
    await healthy();
    await sql.query('update public.af_creators set hosted_credits = 3 where owner_id = $1', [owner]);
    const ask = () => call('POST', 'generations', { description: '모자를 쓴 너구리 레슬러', language: 'ko', delegate: true }, undefined, { 'idempotency-key': crypto.randomUUID() });
    const step = async status => { const c = (await work('POST', 'claim', {})).body.job; assert.equal(c?.status, status); return c; };
    const finish = (c, outcome, result) => work('POST', 'finish', { jobId: c.id, leaseToken: c.leaseToken, outcome, result });
    // The free fighters (첫 선수 무료) as the database still counts them: no longer in the overview (보유 토큰 2026-10-31).
    const credits = async () => (await sql.query('select public.af_generation_credits($1) as c', [owner])).rows[0].c;
    // A job at its finished motions: idle is the look itself, so a change to it is refused before it reaches the worker.
    let job = (await ask()).body.job;
    await finish(await step('queued'), 'ok', { brief: { profile: {} } });
    await finish(await step('appearance'), 'ok', { candidates: ['look-a-0', 'look-b-0'], choice: 'a' });
    await finish(await step('motions'), 'ok', { preview: [{ clip: 'idle', name: 'motion-idle-0' }, { clip: 'walk', name: 'motion-walk-0' }] });
    assert.equal((await call('POST', `generations/${job.id}/motions`, { revise: { clip: 'idle', note: '조금 더 웃게' } })).body.code, 'invalid-answer');
    assert.equal((await call('POST', `generations/${job.id}/motions`, { revise: { clip: 'walk', note: '조금 더 빠르게' } })).body.job.status, 'motions');
    // The worker goes quiet in the middle: he gives up and the free fighter comes back.
    await sql.query("update public.af_generation_hosts set worker_seen_at = now() - interval '10 minutes' where official");
    assert.deepEqual(await credits(), { granted: 3, used: 1, left: 2 });
    await call('DELETE', `generations/${job.id}`);
    assert.deepEqual(await credits(), { granted: 3, used: 0, left: 3 });
    // With the worker back, a painted job's cancel keeps it used, as before.
    await healthy();
    job = (await ask()).body.job;
    await finish(await step('queued'), 'ok', { brief: { profile: {} } });
    await finish(await step('appearance'), 'ok', { candidates: ['look-a-0', 'look-b-0'], choice: 'a' });
    await call('DELETE', `generations/${job.id}`);
    assert.deepEqual(await credits(), { granted: 3, used: 1, left: 2 });
    // A daily limit of 0 starts nothing, so it takes no request.
    await sql.query('update public.af_generation_hosts set daily_limit = 0 where official');
    await sql.query("update public.af_generation_jobs set created_at = now() - interval '2 days' where owner_id = $1", [owner]);
    assert.equal((await ask()).body.code, 'generation-capacity');
  } finally { await sql.close(); }
});

// 정면 먼저 (2026-10-31): the looks are fronts; the side still the motions are made from shows; the chosen front and its face square go
// to the job before the package, and the moment the validator registers the package they become his profile set.
test('a hosted fighter\'s chosen front becomes his profile set when his package is registered', async () => {
  const { sql, owner, call, work, healthy, objects, validatorToken } = await generation();
  try {
    await healthy();
    const job = (await call('POST', 'generations', { description: 'A blue armored cat boxer with a scarf', language: 'en' },
      undefined, { 'idempotency-key': crypto.randomUUID() })).body.job;
    const step = async status => { const c = (await work('POST', 'claim', {})).body.job; assert.equal(c.status, status); return c; };
    const finish = (c, outcome, result) => work('POST', 'finish', { jobId: c.id, leaseToken: c.leaseToken, outcome, result });
    let held = await step('queued');
    await finish(held, 'ok', { brief: { profile: { name: 'Blue Cat', description: 'A boxer.' } } });
    held = await step('appearance');
    const lease = () => ({ 'x-generation-lease': held.leaseToken, 'content-type': 'image/webp' });
    const fronts = { 'front-a-0': webp(1024, 1536), 'front-b-0': webp(1024, 1536) };
    fronts['front-b-0'][40] = 7;   // two different paintings
    for (const [name, bytes] of Object.entries(fronts)) assert.equal((await work('PUT', `jobs/${held.id}/artifacts/${name}`, bytes, lease())).status, 200);
    await finish(held, 'ok', { candidates: ['front-a-0', 'front-b-0'] });
    assert.equal((await call('POST', `generations/${job.id}/appearance`, { choose: 'b' })).body.job.status, 'motions');
    held = await step('motions');
    // The side still shows once the worker names it, for this look round and choice only.
    assert.equal((await call('GET', `generations/${job.id}`)).body.job.side, null);
    await work('PUT', `jobs/${held.id}/artifacts/side-0-b`, webp(600, 900), lease());
    await work('POST', 'progress', { jobId: held.id, leaseToken: held.leaseToken, event: { kind: 'side', artifact: 'side-0-a', outcome: 'chosen', take: 0 } });
    assert.equal((await call('GET', `generations/${job.id}`)).body.job.side, null);
    await work('POST', 'progress', { jobId: held.id, leaseToken: held.leaseToken, event: { kind: 'side', artifact: 'side-0-b', outcome: 'chosen', take: 1 } });
    assert.match((await call('GET', `generations/${job.id}`)).body.job.side.url, /jobs\/.*side-0-b\.webp/);
    await finish(held, 'ok', { preview: [{ clip: 'idle', name: 'motion-idle-0' }] });
    assert.equal((await call('POST', `generations/${job.id}/register`, { profile: { name: 'Blue Cat', description: 'A blue boxer.' } })).body.job.status, 'submitting');
    held = await step('submitting');
    const json = { 'x-generation-lease': held.leaseToken, 'content-type': 'application/json' };
    const front = (artifact, face) => work('POST', `jobs/${held.id}/profile-front`, { artifact, face }, json);
    // Only the chosen front, and a face square inside it.
    assert.equal((await front('front-a-0', { x: 400, y: 30, side: 250 })).body.code, 'invalid-artifact');
    assert.equal((await front('front-b-0', { x: 900, y: 30, side: 250 })).body.code, 'invalid-profile-set');
    const kept = await front('front-b-0', { x: 400, y: 30, side: 250 });
    assert.equal(kept.status, 200);
    assert.deepEqual(kept.body.profileFront, { artifact: 'front-b-0', path: 'front.webp', bytes: 64, sha256: await sha256(fronts['front-b-0']),
      width: 1024, height: 1536, face: { x: 400, y: 30, side: 250 } });
    // The package goes in and the validator registers it: the set is made from the kept front and queued for its own check.
    const created = await work('POST', `jobs/${held.id}/submission`, JSON.stringify(example), json);
    const submission = (await sql.query('select id from public.af_submissions where idempotency_key = $1', [held.id])).rows[0].id;
    assert.equal(created.body.stage, 'uploading');
    for (const a of example.assets) await sql.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${submission}/${a.id}.webp`, { size: a.bytes }]);
    assert.equal((await work('POST', `jobs/${held.id}/submission/submit`, {}, json)).body.stage, 'queued');
    await finish(held, 'ok', { submissionId: submission });
    const claimed = (await call('POST', 'worker/claim', { submissionId: submission }, validatorToken)).body;
    const registered = await call('POST', 'worker/finish', { submissionId: submission, leaseToken: claimed.leaseToken, manifestSha256: claimed.manifestSha256,
      passed: true, result: { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: [] } }, validatorToken);
    assert.equal(registered.body.stage, 'registered');
    const set = (await sql.query('select to_jsonb(p) as value from public.af_profile_sets p where owner_id = $1', [owner])).rows.map(r => r.value);
    assert.equal(set.length, 1);
    const fighter = (await sql.query('select fighter_id from public.af_submissions where id = $1', [submission])).rows[0].fighter_id;
    assert.deepEqual([set[0].status, set[0].fighter_id, set[0].idempotency_key, set[0].manifest.face], ['queued', fighter, held.id, { x: 400, y: 30, side: 250 }]);
    assert.deepEqual(objects.get(`ai-fighter-beta/${owner}/profile-sets/${set[0].id}/front.webp`)?.bytes, fronts['front-b-0']);
    const read = (await call('GET', `generations/${job.id}`)).body.job;
    assert.equal(read.profileSetId, set[0].id);
  } finally { await sql.close(); }
});

// 리뷰 (2026-10-31): a stage whose job was cancelled under it (its lease lost) or whose finish was refused spent its tokens all the same. The
// worker reports them without the lease; one row per lease the stage ran under, whichever route reports it.
test('a stage\'s tokens after its lease was lost are kept through the usage route, once', async () => {
  const { sql, other, call, work, healthy } = await generation();
  try {
    await healthy();
    const tokens = total => ({ total, input: total - 100, cachedInput: 0, output: 100, reasoning: 0 });
    const job = (await call('POST', 'generations', { description: '빨간 글러브를 낀 고양이 복서', language: 'ko', delegate: true }, undefined,
      { 'idempotency-key': crypto.randomUUID() })).body.job;
    const brief = (await work('POST', 'claim', {})).body.job;
    await work('POST', 'finish', { jobId: brief.id, leaseToken: brief.leaseToken, outcome: 'ok', result: { brief: { profile: {} }, tokens: tokens(20000) } });
    const looks = (await work('POST', 'claim', {})).body.job;
    assert.equal(looks.status, 'appearance');
    // He cancels while the looks are being drawn: the finish is refused, its tokens not kept there.
    await call('DELETE', `generations/${job.id}`);
    const refused = await work('POST', 'finish', { jobId: looks.id, leaseToken: looks.leaseToken, outcome: 'ok',
      result: { candidates: ['front-a-0', 'front-b-0'], tokens: tokens(40000) } });
    assert.equal(refused.body.code, 'lease-lost');
    const usage = body => work('POST', `jobs/${looks.id}/usage`, body);
    const report = { leaseToken: looks.leaseToken, stage: 'appearance', tokens: tokens(40000) };
    assert.deepEqual((await usage(report)).body, { ok: true, kept: true });
    assert.deepEqual((await usage(report)).body, { ok: true, kept: false }, 'the same lease twice is one row');
    // The brief's tokens came with its finish, under its lease: a second report of it is that row.
    assert.deepEqual((await usage({ leaseToken: brief.leaseToken, stage: 'queued', tokens: tokens(20000) })).body, { ok: true, kept: false });
    assert.deepEqual((await call('GET', 'generations')).body.tokens, { granted: 500000, spent: 60000, balance: 440000 });
    assert.equal((await call('GET', `generations/${job.id}`)).body.job.tokens, 60000);
    // Malformed, or a stage this host never ran: refused.
    assert.equal((await usage({ ...report, tokens: { total: -1 } })).status, 422);
    assert.equal((await usage({ ...report, stage: 'cancelled' })).status, 422);
    const theirs = (await sql.query(`insert into public.af_generation_jobs(owner_id, idempotency_key, description, language, status, host_choice, host_consent)
      values ($1, $2, '남의 선수', 'ko', 'motions', 'any', true) returning id`, [other, crypto.randomUUID()])).rows[0].id;
    const host = (await sql.query(`insert into public.af_generation_hosts(owner_id, name, billing, approved, terms_accepted_at)
      values ($1, '남의 PC', 'subscription', true, now()) returning id`, [other])).rows[0].id;
    await sql.query('update public.af_generation_jobs set assigned_host = $1 where id = $2', [host, theirs]);
    assert.equal((await work('POST', `jobs/${theirs}/usage`, { ...report, leaseToken: crypto.randomUUID(), stage: 'motions' })).status, 404,
      'the official host did not run another host\'s motions');
    assert.equal((await work('POST', `jobs/${theirs}/usage`, { ...report, leaseToken: crypto.randomUUID(), stage: 'queued' })).body.kept, true,
      'the official host writes every brief');
  } finally { await sql.close(); }
});

// 리뷰 (2026-10-31): the API may be up before its migration (Edge first). The tokens read as null there; the rest reads as before.
test('tokens that cannot be read are null; the overview, a job and the account still read', async () => {
  const { sql, call, healthy } = await generation({ failing: ['af_generation_balance', 'af_generation_job_tokens'] });
  try {
    await healthy();
    const made = await call('POST', 'generations', { description: '빨간 글러브를 낀 고양이 복서', language: 'ko' }, undefined, { 'idempotency-key': crypto.randomUUID() });
    assert.equal(made.status, 200); assert.equal(made.body.job.tokens, null);
    const overview = (await call('GET', 'generations')).body;
    assert.equal(overview.ok, true); assert.equal(overview.tokens, null); assert.equal(overview.jobs[0].tokens, null);
    assert.equal('credits' in overview, false, 'the free fighters before tokens are no longer sent');
    assert.equal((await call('GET', `generations/${made.body.job.id}`)).body.job.tokens, null);
    const me = (await call('GET', 'me')).body;
    assert.equal(me.ok, true); assert.equal('tokens' in me.account, false);
  } finally { await sql.close(); }
});

// 리뷰 (2026-10-31): free fighters an operator gave beyond one become tokens at the same rate when the tokens arrive.
test('an account given more than one free fighter starts with as many times 500,000 tokens', async () => {
  const db = await supabasePlatform(), names = await migrationNames(), at = names.indexOf('20261031130000_oddbout_account_tokens.sql');
  try {
    assert.ok(at > 0);
    for (const name of names.slice(0, at)) await applyMigration(db, name);
    const [two, one, none] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const user of [two, one, none]) await db.query('insert into auth.users(id) values($1)', [user]);
    await db.query('insert into public.af_creators(owner_id, hosted_credits) values ($1, 2), ($2, 1), ($3, null)', [two, one, none]);
    for (const name of names.slice(at)) await applyMigration(db, name);
    const grants = Object.fromEntries((await db.query('select owner_id, token_grant from public.af_creators where owner_id = any($1)', [[two, one, none]]))
      .rows.map(r => [r.owner_id, Number(r.token_grant)]));
    assert.deepEqual([grants[two], grants[one], grants[none]], [1000000, 500000, 500000]);
  } finally { await db.close(); }
});

// 하루 세 건 (2026-10-31): a person whose requests failed on our side was refused for a day with his tokens untouched. Three requests a day
// are his own now: one that failed on our side or that he cancelled while it waited for an operator is left out; a refused one counts.
test('three requests a day count his own: not one that failed on our side or that he cancelled at an operator\'s stop; never an operator', async () => {
  const { sql, owner, call, healthy } = await generation();
  try {
    await healthy();
    const ask = () => call('POST', 'generations', { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko' }, undefined, { 'idempotency-key': crypto.randomUUID() });
    const end = async (status, code, refunded = false) => {
      const made = await ask();
      assert.equal(made.status, 200, JSON.stringify(made.body));
      await sql.query(`update public.af_generation_jobs set status = $2, error_code = $3, refunded_at = ${refunded ? 'now()' : 'null'} where id = $1`,
        [made.body.job.id, status, code]);
    };
    await end('failed', 'stage-attempts');            // our side
    await end('cancelled', 'side-look', true);        // cancelled at an operator's stop
    await end('rejected', 'real-person');             // refused: counts
    await end('cancelled', null);                     // his own cancel: counts
    await end('expired', null);                       // left unanswered: counts
    const refused = await ask();
    assert.deepEqual([refused.status, refused.body.code], [429, 'rate-limit']);
    await sql.query('insert into public.af_admins(owner_id) values($1)', [owner]);
    assert.equal((await ask()).status, 200);
  } finally { await sql.close(); }
});

// 그림 올리기 표 (2026-11-01): an agent with no ChatGPT attachment gets a ticket; the owner adds pictures on the site with its id, a
// terminal with its secret; two at most, for thirty minutes; each an ordinary upload the request then names.
test('a picture ticket: two pictures from the site or a terminal, its owner\'s only, refused once full or past its time', async () => {
  const { sql, owner, call, healthy, objects } = await generation();
  try {
    await healthy();
    // The site's link needs no secret: none is shown unless the agent will run the terminal command.
    const linkOnly = (await call('POST', 'generations/upload-tickets')).body.ticket;
    assert.deepEqual([linkOnly.secret, linkOnly.open, linkOnly.closed, linkOnly.uploads], [undefined, true, null, []]);
    // An empty body (a stream of no bytes) is the same as none.
    assert.equal((await call('POST', 'generations/upload-tickets', new Uint8Array(0))).status, 200);
    const made = await call('POST', 'generations/upload-tickets', { terminal: true });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const { id: ticket, secret } = made.body.ticket;
    assert.match(secret, /^afu_[a-f0-9]{64}$/);
    // The database keeps the secret's hash only.
    assert.equal((await sql.query('select count(*)::int as n from public.af_generation_upload_tickets where secret_hash = $1',
      [await sha256(new TextEncoder().encode(secret))])).rows[0].n, 1);
    const terminal = (body, header) => call('POST', 'generations/ticket-uploads', body, null, header === undefined ? {} : { 'x-oddbout-upload-ticket': header });
    assert.deepEqual([(await terminal(png(512, 512))).status, (await terminal(png(512, 512))).body.code], [403, 'invalid-ticket']);
    assert.equal((await terminal(png(512, 512), `afu_${'0'.repeat(64)}`)).body.code, 'invalid-ticket');
    assert.equal((await terminal(new TextEncoder().encode('plain words, no picture'), secret)).status, 415);
    const first = await terminal(png(512, 512), secret);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    // Another account cannot put pictures under it; its owner can, on the site.
    assert.equal((await call('POST', `generations/uploads?ticket=${ticket}`, png(300, 400), 'other-token-0123456789')).body.code, 'not-found');
    const second = await call('POST', `generations/uploads?ticket=${ticket}`, png(300, 400));
    assert.equal(second.status, 200, JSON.stringify(second.body));
    const stored = objects.size;
    assert.deepEqual([(await terminal(png(512, 512), secret)).status, (await terminal(png(512, 512), secret)).body.code], [409, 'ticket-full']);
    assert.equal(objects.size, stored, 'a full ticket stores nothing');
    // The agent sees what went in (an address for ten minutes) before the user confirms his rights to it.
    const read = (await call('GET', `generations/upload-tickets/${ticket}`)).body.ticket;
    assert.equal(read.secret, undefined);
    assert.deepEqual([read.open, read.closed], [false, 'full']);
    assert.deepEqual(read.uploads.map(u => [u.id, u.width, u.bytes, u.contentType, u.used, u.usable, /^https:\/\/storage\.test\/af-generation\/refs\//.test(u.url)]),
      [[first.body.upload.id, 512, 64, 'image/png', false, true, true], [second.body.upload.id, 300, 64, 'image/png', false, true, true]]);
    assert.equal((await call('GET', `generations/upload-tickets/${ticket}`, undefined, 'other-token-0123456789')).body.code, 'not-found');
    // The request names them as it names any upload of his.
    const job = await call('POST', 'generations', { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko',
      refs: [first.body.upload.id, second.body.upload.id], rightsConfirmed: true }, undefined, { 'idempotency-key': crypto.randomUUID() });
    assert.equal(job.status, 200, JSON.stringify(job.body));
    assert.deepEqual((await call('GET', `generations/upload-tickets/${ticket}`)).body.ticket.uploads.map(u => [u.used, u.usable]), [[true, false], [true, false]]);
    // Past its thirty minutes: refused on both ways, before anything is stored.
    const late = (await call('POST', 'generations/upload-tickets', { terminal: true })).body.ticket;
    await sql.query("update public.af_generation_upload_tickets set expires_at = now() - interval '1 second' where id = $1", [late.id]);
    assert.equal((await call('GET', `generations/upload-tickets/${late.id}`)).body.ticket.closed, 'expired');
    assert.deepEqual([(await terminal(png(512, 512), late.secret)).status, (await terminal(png(512, 512), late.secret)).body.code], [410, 'ticket-expired']);
    assert.equal((await call('POST', `generations/uploads?ticket=${late.id}`, png(512, 512))).body.code, 'ticket-expired');
    assert.equal(objects.size, stored);
    // The database decides on its own too (two uploads racing past the API's check).
    await assert.rejects(sql.query('select public.af_generation_ticket_upload($1,$2,$3,$4,$5,$6,$7,$8)',
      [owner, ticket, crypto.randomUUID(), `refs/${owner}/${crypto.randomUUID()}.png`, 'image/png', 64, 512, 512]), /ticket-full/);
    await assert.rejects(sql.query('select public.af_generation_ticket_upload($1,$2,$3,$4,$5,$6,$7,$8)',
      [owner, late.id, crypto.randomUUID(), `refs/${owner}/${crypto.randomUUID()}.png`, 'image/png', 64, 512, 512]), /ticket-expired/);
    // Twelve tickets in 24 hours.
    for (let i = 4; i < 12; i++) assert.equal((await call('POST', 'generations/upload-tickets')).status, 200);
    assert.deepEqual([(await call('POST', 'generations/upload-tickets')).status, (await call('POST', 'generations/upload-tickets')).body.code], [429, 'rate-limit']);
    // A ticket's own lock: not af_generation_create's, which holds it while it takes the service's capacity lock.
    const definition = (await sql.query("select pg_get_functiondef('public.af_generation_upload_ticket'::regproc) as d")).rows[0].d;
    assert.match(definition, /74280505/); assert.doesNotMatch(definition, /74280502/);
  } finally { await sql.close(); }
});

test('a picture whose keeping has an unknown outcome stays stored; a refusal keeps nothing', async () => {
  // 2차 리뷰 2026-11-01: removing it on an unknown outcome could leave a row the database did commit pointing to no picture.
  const unknown = await generation({ failing: ['af_generation_upload'] });
  try {
    await unknown.healthy();
    const before = unknown.objects.size, sent = await unknown.call('POST', 'generations/uploads', png(512, 512));
    assert.deepEqual([sent.status, sent.body.code], [503, 'database-unavailable']);
    assert.equal(unknown.objects.size, before + 1);
  } finally { await unknown.sql.close(); }
  const { sql, call, healthy, objects } = await generation();
  try {
    await healthy();
    for (let i = 0; i < 12; i++) assert.equal((await call('POST', 'generations/uploads', png(512, 512))).status, 200);
    const before = objects.size, refused = await call('POST', 'generations/uploads', png(512, 512));
    assert.deepEqual([refused.status, refused.body.code], [429, 'rate-limit']);
    assert.equal(objects.size, before);
  } finally { await sql.close(); }
});

test('a ticket takes nothing once his twelve uploads of 24 hours are used, and is not given then', async () => {
  const { sql, call, objects } = await generation();
  try {
    const ticket = (await call('POST', 'generations/upload-tickets', { terminal: true })).body.ticket;
    for (let i = 0; i < 12; i++) assert.equal((await call('POST', 'generations/uploads', png(512, 512))).status, 200);
    assert.equal((await call('GET', `generations/upload-tickets/${ticket.id}`)).body.ticket.closed, 'day-limit');
    const stored = objects.size;
    const refused = await call('POST', 'generations/ticket-uploads', png(512, 512), null, { 'x-oddbout-upload-ticket': ticket.secret });
    assert.deepEqual([refused.status, refused.body.code, objects.size], [429, 'rate-limit', stored]);
    assert.deepEqual([(await call('POST', 'generations/upload-tickets')).status, (await call('POST', 'generations/upload-tickets')).body.code], [429, 'rate-limit']);
    // Tickets a week past their time go when he takes a new one; their pictures stay.
    await sql.query("update public.af_generation_uploads set created_at = now() - interval '2 days'");
    await sql.query("update public.af_generation_upload_tickets set expires_at = now() - interval '8 days', created_at = now() - interval '8 days'");
    assert.equal((await call('POST', 'generations/upload-tickets')).status, 200);
    assert.equal((await sql.query('select count(*)::int as n from public.af_generation_upload_tickets')).rows[0].n, 1);
    assert.equal((await sql.query('select count(*)::int as n from public.af_generation_uploads')).rows[0].n, 12);
  } finally { await sql.close(); }
});

test('a request\'s check refuses refs it could not take: another account\'s, used, older than a day or named twice', async () => {
  const { sql, call, healthy } = await generation();
  try {
    await healthy();
    const upload = async (token = 'owner-token-0123456789') => (await call('POST', 'generations/uploads', png(512, 512), token)).body.upload.id;
    const ask = { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko' };
    const check = refs => call('POST', 'generations/check', { ...ask, refs });
    const mine = await upload(), others = await upload('other-token-0123456789'), old = await upload();
    await sql.query("update public.af_generation_uploads set created_at = now() - interval '25 hours' where id = $1", [old]);
    assert.deepEqual((await check([mine])).body, { ok: true });
    for (const refs of [[others], [old], [mine, mine], [crypto.randomUUID()]]) assert.equal((await check(refs)).body.code, 'invalid-refs', JSON.stringify(refs));
    const made = await call('POST', 'generations', { ...ask, refs: [mine], rightsConfirmed: true }, undefined, { 'idempotency-key': crypto.randomUUID() });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    assert.equal((await check([mine])).body.code, 'invalid-refs');
  } finally { await sql.close(); }
});
