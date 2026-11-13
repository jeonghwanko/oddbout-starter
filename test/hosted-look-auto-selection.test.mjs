import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generation } from './helpers/generation-database.mjs';
import { hostedNext, hostedStatus } from '../mcp/cloud/hosted-tools.mjs';
import { widget } from './helpers/hosted-widget.mjs';

async function ready(g, { delegate = false, choice, candidates = ['front-a-0', 'front-b-0'] } = {}) {
  const id = crypto.randomUUID(),
    token = crypto.randomUUID();
  await g.sql.query(
    `insert into public.af_generation_jobs(id,owner_id,idempotency_key,description,language,status,delegate,lease_token,lease_expires_at)
    values($1,$2,$3,'A test squirrel boxer','ko','appearance',$4,$5,now()+interval '5 minutes')`,
    [id, g.owner, crypto.randomUUID(), delegate, token],
  );
  await g.sql.query("select public.af_generation_finish($1,$2,'ok',$3)", [id, token, { candidates, ...(choice ? { choice } : {}) }]);
  return id;
}
const tick = async g => (await g.sql.query('select public.af_generation_auto_choose_look() as n')).rows[0].n;
const row = async (g, id) => (await g.sql.query('select * from public.af_generation_jobs where id=$1', [id])).rows[0];
const overdue = (g, id) => g.sql.query("update public.af_generation_jobs set appearance_auto_select_at=now()-interval '1 second' where id=$1", [id]);

test('new looks get three minutes; only the server selects A once and the same job is claimable', async () => {
  const g = await generation();
  try {
    await g.healthy();
    const id = await ready(g),
      initial = await row(g, id);
    assert.equal(new Date(initial.appearance_auto_select_at).getTime() - new Date(initial.waiting_since).getTime(), 180_000);
    assert.equal(await tick(g), 0);
    const read = (await g.call('GET', `generations/${id}`)).body.job;
    assert.equal(Date.parse(read.appearanceAutoSelectAt), new Date(initial.appearance_auto_select_at).getTime());
    assert.equal(read.choice, null);
    assert.equal(read.appearanceAutoSelection, null);
    // Boundary is inclusive, using one transaction's clock; no wall-clock sleep/generation.
    await g.sql.exec('begin');
    await g.sql.query('update public.af_generation_jobs set appearance_auto_select_at=now() where id=$1', [id]);
    const pending = (await g.call('GET', `generations/${id}`)).body.job;
    assert.equal(pending.status, 'appearance_ready', 'GET does not select a look, even after the deadline');
    assert.equal(await tick(g), 1);
    await g.sql.exec('commit');
    assert.equal(await tick(g), 0);
    const selected = await row(g, id);
    assert.deepEqual(
      [selected.status, selected.choice, selected.progress, selected.waiting_since, selected.appearance_auto_select_at],
      ['motions', 'a', 0, null, null],
    );
    const events = (await g.sql.query("select kind,data from public.af_generation_events where job_id=$1 and kind like 'appearance-%'", [id])).rows;
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'appearance-auto-selected');
    assert.deepEqual([events[0].data.choice, events[0].data.reason], ['a', 'no-answer']);
    const selectedView = (await g.call('GET', `generations/${id}`)).body.job;
    assert.equal(selectedView.appearanceAutoSelectAt, null);
    assert.equal(selectedView.appearanceAutoSelection.choice, 'a');
    assert.ok(Date.parse(selectedView.appearanceAutoSelection.selectedAt) >= Date.parse(selectedView.appearanceAutoSelection.deadline));
    const claimed = (await g.work('POST', 'claim', {})).body.job;
    assert.equal(claimed.id, id);
    assert.equal(claimed.status, 'motions');
    assert.equal((await g.call('POST', `generations/${id}/appearance`, { choose: 'b' })).status, 409);
    assert.equal((await row(g, id)).choice, 'a', 'a late answer cannot replace art already queued');
  } finally {
    await g.sql.close();
  }
});

test('selection evidence rejects worker claims, invalid event times and superseded choices without inventing history', async () => {
  const g = await generation();
  try {
    await g.healthy();
    const id = await ready(g);
    await overdue(g, id);
    await tick(g);
    const read = async () => (await g.call('GET', `generations/${id}`)).body.job.appearanceAutoSelection;
    const original = await read();
    assert.equal(original.choice, 'a');
    const claimed = (await g.work('POST', 'claim', {})).body.job;
    for (const kind of ['appearance-auto-selected', 'appearance-answer']) {
      assert.equal(
        (
          await g.work('POST', 'progress', {
            jobId: id,
            leaseToken: claimed.leaseToken,
            event: { kind, choice: 'a', reason: 'no-answer', deadline: original.deadline },
          })
        ).status,
        422,
      );
    }
    assert.deepEqual(await read(), original);
    for (const data of [
      { kind: 'appearance-auto-selected', choice: 'a', reason: 'no-answer', deadline: original.deadline },
      { choice: 'a', reason: 'no-answer', deadline: 'invalid' },
      { choice: 'a', reason: 'no-answer', deadline: '2999-01-01T00:00:00Z' },
    ]) {
      await g.sql.query("insert into public.af_generation_events(job_id,kind,data) values($1,'appearance-auto-selected',$2)", [id, data]);
      assert.equal(await read(), null);
    }
    await g.sql.query("insert into public.af_generation_events(job_id,kind,data) values($1,'appearance-auto-selected',$2)", [
      id,
      { choice: 'a', reason: 'no-answer', deadline: original.deadline },
    ]);
    assert.ok(await read());
    await g.sql.query('insert into public.af_generation_events(job_id,kind,data) values($1,\'appearance-answer\',\'{"choice":"a","revise":false}\')', [id]);
    assert.equal(await read(), null, 'a later explicit answer overrides an older timeout event');
  } finally {
    await g.sql.close();
  }
});

test('a manual B answer or cancellation committed before a tick wins even after the deadline', async () => {
  const g = await generation();
  try {
    const b = await ready(g);
    await overdue(g, b);
    assert.equal((await g.call('POST', `generations/${b}/appearance`, { choose: 'b' })).status, 200);
    const cancelled = await ready(g);
    await overdue(g, cancelled);
    assert.equal((await g.call('DELETE', `generations/${cancelled}`)).status, 200);
    assert.equal(await tick(g), 0);
    assert.equal((await row(g, b)).choice, 'b');
    assert.equal((await row(g, cancelled)).status, 'cancelled');
    assert.equal((await row(g, b)).appearance_auto_select_at, null);
  } finally {
    await g.sql.close();
  }
});

test('a revision cancels the old timer; a fresh pair gets a fresh three minutes', async () => {
  const g = await generation();
  try {
    const id = await ready(g);
    await overdue(g, id);
    assert.equal((await g.call('POST', `generations/${id}/appearance`, { revise: '초록 장갑을 더 크게' })).status, 200);
    assert.equal((await row(g, id)).appearance_auto_select_at, null);
    assert.equal(await tick(g), 0);
    const token = crypto.randomUUID();
    await g.sql.query("update public.af_generation_jobs set lease_token=$2,lease_expires_at=now()+interval '5 minutes' where id=$1", [id, token]);
    await g.sql.query("select public.af_generation_finish($1,$2,'ok',$3)", [id, token, { candidates: ['front-a-1', 'front-b-1'] }]);
    const revised = await row(g, id);
    assert.equal(new Date(revised.appearance_auto_select_at).getTime() - new Date(revised.waiting_since).getTime(), 180_000);
    assert.equal(await tick(g), 0);
    assert.deepEqual(revised.candidates, ['front-a-1', 'front-b-1']);
  } finally {
    await g.sql.close();
  }
});

test('old waiting jobs, operator blocks, delegated picks, invalid pairs and disabled accounts never auto-start', async () => {
  const g = await generation();
  try {
    const legacy = crypto.randomUUID();
    await g.sql.query(
      `insert into public.af_generation_jobs(id,owner_id,idempotency_key,description,language,status,candidates,waiting_since)
      values($1,$2,$3,'A legacy squirrel boxer','ko','appearance_ready','["a","b"]',now()-interval '1 hour')`,
      [legacy, g.owner, crypto.randomUUID()],
    );
    await g.sql.query('update public.af_generation_jobs set updated_at=now() where id=$1', [legacy]);
    assert.equal((await row(g, legacy)).appearance_auto_select_at, null);
    const blocked = await ready(g);
    await overdue(g, blocked);
    await g.sql.query("update public.af_generation_jobs set status='needs_review',choice='a',error_code='side-provider-refused' where id=$1", [blocked]);
    const delegated = await ready(g, { delegate: true, choice: 'b' });
    const invalid = await ready(g, { candidates: ['', 'front-b-0'] });
    assert.equal((await row(g, invalid)).appearance_auto_select_at, null);
    const disabled = await ready(g);
    await overdue(g, disabled);
    await g.sql.query('update public.af_creators set enabled=false where owner_id=$1', [g.owner]);
    assert.equal(await tick(g), 0);
    assert.equal((await row(g, disabled)).choice, null);
    assert.equal((await row(g, blocked)).error_code, 'side-provider-refused');
    assert.equal((await row(g, delegated)).choice, 'b');
    // Disabled owners must not consume the bounded batch and starve later active jobs.
    await g.sql.query(
      `insert into public.af_generation_jobs(owner_id,idempotency_key,description,language,status,candidates,waiting_since,appearance_auto_select_at)
      select $1,gen_random_uuid(),'A disabled squirrel boxer','ko','appearance_ready','["a","b"]',now()-interval '1 hour',now()-interval '50 minutes'
      from generate_series(1,100)`,
      [g.owner],
    );
    const active = await ready({ ...g, owner: g.other });
    await overdue(g, active);
    assert.equal(await tick(g), 1);
    assert.equal((await row(g, active)).choice, 'a');
    await g.sql.exec('set role authenticated');
    await assert.rejects(() => tick(g), /permission denied/);
    await g.sql.exec('reset role');
    await g.sql.exec('set role anon');
    await assert.rejects(() => tick(g), /permission denied/);
    await g.sql.exec('reset role');
  } finally {
    await g.sql.close();
  }
});

test('a waiting host selects A when it claims at the deadline, and the job view keeps a compact timeline', async () => {
  const g = await generation();
  try {
    await g.healthy();
    const id = await ready(g);
    const early = (await g.work('POST', 'claim', {})).body;
    assert.equal(early.stage, 'idle');
    assert.equal((await row(g, id)).choice, null);
    assert.equal(early.job, undefined);
    assert.ok(Number.isInteger(early.lookSelectInMs) && early.lookSelectInMs > 0 && early.lookSelectInMs <= 180_000);
    await overdue(g, id);
    const claimed = (await g.work('POST', 'claim', {})).body;
    assert.equal(claimed.job?.id, id);
    assert.equal(claimed.job.status, 'motions');
    assert.equal(claimed.job.choice, 'a');
    assert.equal(await tick(g), 0);
    await g.sql.query('insert into public.af_generation_events(job_id, kind, data) values ($1, $2, $3), ($1, $4, $5)', [
      id,
      'side',
      { kind: 'side', take: 1, outcome: 'fail', failed: ['match'], notes: 'not on the timeline' },
      'warning',
      { kind: 'warning', code: 'side-look', take: 1, outcome: 'continued', failed: ['match'], notes: 'not on the timeline' },
    ]);
    const view = (await g.call('GET', `generations/${id}`)).body.job;
    assert.equal(view.appearanceAutoSelection.choice, 'a');
    assert.ok(view.timeline.some(event => event.kind === 'appearance-auto-selected'));
    assert.ok(view.timeline.some(event => event.kind === 'side' && event.take === 1 && event.outcome === 'fail'));
    const warning = view.warnings.find(item => item.code === 'side-look');
    assert.deepEqual([warning.take, warning.outcome, warning.failed], [1, 'continued', ['match']]);
    assert.equal(warning.notes, undefined);
    for (const event of view.timeline) {
      assert.ok(event.at && event.kind);
      for (const key of Object.keys(event)) assert.ok(['at', 'kind', 'take', 'outcome'].includes(key));
    }
    const listed = (await g.call('GET', 'generations')).body.jobs.find(job => job.id === id);
    assert.equal(listed.timeline, undefined);
    assert.equal(listed.warnings, undefined);
  } finally {
    await g.sql.close();
  }
});

test('the chat card explains the server deadline without inventing a selection or timing out old jobs', () => {
  const job = { id: crypto.randomUUID(), status: 'appearance_ready', appearanceAutoSelectAt: '2026-11-08T01:10:00Z' };
  const status = hostedStatus(job);
  assert.equal(status.actionRequired, 'choose_look_or_wait');
  assert.match(hostedNext(job), /server automatically selects A after 2026-11-08T01:10:00Z/);
  assert.match(hostedNext(job), /three minutes after this pair was ready/);
  assert.match(hostedNext(job), /waiting host selects at that time/);
  assert.match(hostedNext(job), /Do not send choose_hosted_look on his behalf/);
  assert.match(hostedNext({ ...job, status: 'motions', warnings: [{ code: 'side-look' }, { code: 'walk-not-clean' }] }), /side-look, walk-not-clean/);
  const ui = widget();
  ui.render({ structuredContent: { job, statusSummary: status } });
  assert.match(ui.root.text, /응답이 없으면 A로 자동 진행/);
  assert.match(ui.root.text, /시안 준비 후 3분/);
  assert.match(ui.root.text, /UTC/);
  const warned = widget();
  warned.render({
    structuredContent: {
      job: { ...job, status: 'motions', warnings: [{ code: 'walk-not-clean' }] },
      statusSummary: hostedStatus({ ...job, status: 'motions' }),
    },
  });
  assert.match(warned.root.text, /경고를 남기고 이어감: walk-not-clean/);
  assert.doesNotMatch(ui.root.text, /A.*선택됨/);
  const old = { id: crypto.randomUUID(), status: 'appearance_ready' };
  ui.render({ structuredContent: { job: old, statusSummary: hostedStatus(old) } });
  assert.doesNotMatch(ui.root.text, /자동 진행|자동 선택 예정/);
  assert.doesNotMatch(hostedNext(old), /automatically selects/);
});

test('the status contract and chat card retain actual automatic selection evidence through registration', () => {
  const selection = { choice: 'a', selectedAt: '2026-11-08T01:11:00Z', deadline: '2026-11-08T01:10:00Z' };
  for (const status of ['motions', 'submitting', 'submitted']) {
    const job = {
      id: crypto.randomUUID(),
      status,
      choice: 'a',
      appearanceAutoSelection: selection,
      ...(status === 'submitted' ? { submission: { stage: 'registered' } } : {}),
    };
    assert.deepEqual(hostedStatus(job).appearanceAutoSelection, selection);
    assert.match(hostedNext(job), /automatically selected A after no answer at 2026-11-08T01:11:00Z/);
    const ui = widget();
    ui.render({ structuredContent: { job, statusSummary: hostedStatus(job) } });
    assert.match(ui.root.text, /응답이 없어 A가 자동 선택됐습니다/);
    const unverified = { id: crypto.randomUUID(), status, choice: 'a' };
    ui.render({ structuredContent: { job: unverified, statusSummary: hostedStatus(unverified) } });
    assert.doesNotMatch(ui.root.text, /자동 선택됐습니다/);
  }
});
