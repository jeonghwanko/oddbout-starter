import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generation } from './helpers/generation-database.mjs';

// The list of a creator's jobs reads them together (N+1, 리뷰 2026-11-08): what it shows of each job is what that job's own read shows,
// in a bounded number of reads however many jobs it lists.

async function job(g, { status, choice = 'a', revisions = 0, at }) {
  const id = crypto.randomUUID();
  await g.sql.query(`insert into public.af_generation_jobs(id,owner_id,idempotency_key,description,language,status,choice,candidates,motion_revisions,created_at)
    values($1,$2,$3,'A test squirrel boxer','ko',$4,$5,$6,$7,$8)`,
  [id, g.owner, crypto.randomUUID(), status, choice, ['front-a-0', 'front-b-0'], revisions, at]);
  return id;
}
const event = (g, id, kind, data) => g.sql.query('insert into public.af_generation_events(job_id,kind,data) values($1,$2,$3)', [id, kind, data]);

/** Counts the database and storage reads the handler makes. */
function counted(g) {
  const counts = { from: 0, signing: 0 };
  const from = g.db.from, storage = g.db.storage.from;
  g.db.from = (/** @type {string} */ table) => { counts.from++; return from(table); };
  g.db.storage.from = (/** @type {string} */ bucket) => {
    const b = storage(bucket);
    return { ...b, createSignedUrls: (/** @type {any[]} */ ...args) => { counts.signing++; return b.createSignedUrls(...args); } };
  };
  return counts;
}

async function fixture(g) {
  const base = Date.now();
  const at = (/** @type {number} */ i) => new Date(base - i * 60_000).toISOString();
  const motions = await job(g, { status: 'motions', revisions: 1, at: at(0) });
  await event(g, motions, 'drafts', { seq: 2, clips: [{ clip: 'walk', name: 'draft-walk-t0-1' }] });
  await event(g, motions, 'drafts', { seq: 1, clips: [{ clip: 'combo', name: 'draft-combo-1' }] });
  await event(g, motions, 'side', { artifact: 'side-0-a', outcome: 'chosen' });
  await event(g, motions, 'expressions', { artifact: 'expressions-0-a', outcome: 'chosen' });
  await event(g, motions, 'stage', { name: 'not read by the view' });
  const ready = await job(g, { status: 'motion_ready', choice: 'b', at: at(1) });
  await event(g, ready, 'side', { artifact: 'side-0-b', outcome: 'chosen' });
  const auto = await job(g, { status: 'submitted', at: at(2) });
  await g.sql.query("insert into public.af_generation_events(job_id,kind,data,at) values($1,'appearance-auto-selected',$2,now())",
    [auto, { choice: 'a', reason: 'no-answer', deadline: new Date(base - 3_600_000).toISOString() }]);
  await job(g, { status: 'queued', choice: null, at: at(3) });
  // Two jobs on one registered submission: the list reads it once for both.
  const submission = crypto.randomUUID(), fighter = crypto.randomUUID();
  await g.sql.query(`insert into public.af_submissions(id,owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes,status,fighter_id)
    values($1,$2,gen_random_uuid(),'{}','{}'::jsonb,repeat('a',64),1,'registered',$3)`, [submission, g.owner, fighter]);
  await g.sql.query("update public.af_generation_jobs set submission_id = $1 where id = any($2)", [submission, [ready, auto]]);
  return { motions, ready, auto, fighter };
}

test('the list shows each job as its own read does, in reads that do not grow with its jobs', async () => {
  const g = await generation();
  try {
    await g.healthy();
    const { motions, ready, auto, fighter } = await fixture(g);
    const counts = counted(g);
    const list = (await g.call('GET', 'generations')).body;
    assert.equal(list.ok, true);
    assert.equal(list.jobs.length, 4);
    // Jobs, events, hosts, submissions: one each however many jobs share them; one signing call for all their pictures.
    assert.ok(counts.from <= 4, `database reads ${counts.from}`);
    assert.equal(counts.signing, 1);
    for (const shown of list.jobs) {
      const own = (await g.call('GET', `generations/${shown.id}`)).body.job;
      assert.deepEqual({ ...shown, profileFront: null }, { ...own, profileFront: null }, shown.status);
    }
    const byId = new Map(list.jobs.map((/** @type {any} */ j) => [j.id, j]));
    assert.deepEqual(byId.get(motions).drafts.map((/** @type {any} */ d) => d.clip), ['walk']);
    assert.ok(byId.get(motions).side.url.includes('side-0-a'));
    assert.ok(byId.get(motions).expressions.url.includes('expressions-0-a'));
    assert.ok(byId.get(ready).side.url.includes('side-0-b'));
    assert.equal(byId.get(auto).appearanceAutoSelection.choice, 'a');
    for (const id of [ready, auto]) assert.deepEqual(byId.get(id).submission, { id: byId.get(id).submission.id, stage: 'registered', fighterId: fighter });
  } finally { await g.sql.close(); }
});

test('the events the views read have an index by job and kind', async () => {
  const g = await generation();
  try {
    const { rows } = await g.sql.query("select indexdef from pg_indexes where schemaname = 'public' and indexname = 'af_generation_events_job_kind'");
    assert.match(rows[0]?.indexdef ?? '', /\(job_id, kind, id DESC\)/);
  } finally { await g.sql.close(); }
});

test('past the batch bound, each job reads its own events and shows the same', async () => {
  const g = await generation();
  try {
    await g.healthy();
    const { motions } = await fixture(g);
    // A busy history: more view events than one batched read takes.
    await g.sql.query("insert into public.af_generation_events(job_id,kind,data,at) select $1,'side','{}'::jsonb,now()-interval '1 hour' from generate_series(1,200)", [motions]);
    const list = (await g.call('GET', 'generations')).body;
    for (const shown of list.jobs) {
      const own = (await g.call('GET', `generations/${shown.id}`)).body.job;
      assert.deepEqual({ ...shown, profileFront: null }, { ...own, profileFront: null }, shown.status);
    }
    assert.ok(list.jobs.find((/** @type {any} */ j) => j.id === motions).side.url.includes('side-0-a'));
  } finally { await g.sql.close(); }
});
