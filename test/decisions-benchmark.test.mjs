import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generation } from './helpers/generation-database.mjs';
import { createDecisionsReviewer, reviewEvidence } from '../api/decisions-review.mjs';
import { sha256 } from '../api/http.mjs';

const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0xoAAAAASUVORK5CYII=', 'base64');
async function setup(fetcher) {
  const ctx = await generation({ decisionsReviewer: createDecisionsReviewer({ enabled: true, apiKey: 'test-only-key', fetcher }) });
  const body = {
    stage: 'pose',
    scope: 'look-a',
    images: [{ role: 'candidate', durationMs: 100, sha256: await sha256(bytes), dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }],
  };
  const evidence = await reviewEvidence(body);
  const host = (await ctx.sql.query('select public.af_generation_official() as id')).rows[0].id;
  const enroll = async () =>
    (
      await ctx.sql.query(
        `insert into public.af_decision_benchmark_cases(host_id,label,intent,evidence,expires_at)
    values($1,'fixed-existing-sprite',$2,$3,now()+interval '1 hour') returning id`,
        [host, { description: 'Original sprite', brief: {} }, { stage: body.stage, scope: body.scope, images: evidence.binding }],
      )
    ).rows[0].id;
  return { ...ctx, body, enroll, send: (id, b = body) => ctx.work('POST', `decision-benchmarks/${id}`, b) };
}
const success = init =>
  Response.json({
    model: 'gpt-6-luna',
    answers: JSON.parse(init.body).questions.map(q => ({
      name: q.name,
      type: 'choice',
      choice: 'clear',
      confidence: 0.9,
      probabilities: [
        { value: 'clear', probability: 0.9 },
        { value: 'defect', probability: 0.05 },
        { value: 'unverified', probability: 0.05 },
      ],
    })),
    usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 20, cache_write_tokens: 40 } },
  });

test('enrolled server benchmark consumes shared quota once, without any generation job or caller credentials in reports', async () => {
  let calls = 0;
  const ctx = await setup(async (_, init) => {
    calls++;
    return success(init);
  });
  try {
    const id = await ctx.enroll();
    assert.equal((await ctx.call('POST', `generation-worker/decision-benchmarks/${id}`, ctx.body)).status, 403);
    assert.equal((await ctx.call('POST', `generation-worker/decision-benchmarks/${id}`, ctx.body, ctx.validatorToken)).status, 403);
    assert.equal((await ctx.send(crypto.randomUUID())).status, 404);
    const foreign = crypto.randomUUID();
    await ctx.sql.query("insert into public.af_generation_hosts(id,owner_id,name,billing,terms_accepted_at) values($1,$2,'Foreign','subscription',now())", [
      foreign,
      ctx.other,
    ]);
    await ctx.sql.query('update public.af_decision_benchmark_cases set host_id=$1 where id=$2', [foreign, id]);
    assert.equal((await ctx.send(id)).status, 404);
    await ctx.sql.query('update public.af_decision_benchmark_cases set host_id=public.af_generation_official() where id=$1', [id]);
    await ctx.sql.exec('update public.af_decision_review_limits set daily_calls=1');
    const results = await Promise.all([ctx.send(id), ctx.send(id)]);
    assert.ok(results.every(r => r.status === 200));
    assert.equal(calls, 1);
    const report = (await ctx.send(id)).body.review;
    assert.equal(report.status, 'completed');
    assert.equal(report.providerHttpStatus, 200);
    assert.equal(report.usage.input_tokens_details.cache_write_tokens, 40);
    assert.equal((await ctx.send(await ctx.enroll())).body.code, 'review-limit');
    assert.equal((await ctx.sql.query('select count(*)::int as n from public.af_generation_jobs')).rows[0].n, 0);
    assert.equal((await ctx.sql.query('select count(*)::int as n from public.af_decision_reviews')).rows[0].n, 1);
    assert.ok(!JSON.stringify(report).includes('test-only-key'));
    const rights = (
      await ctx.sql.query(
        "select has_table_privilege('anon','public.af_decision_benchmark_cases','select') as read, has_table_privilege('authenticated','public.af_decision_benchmark_cases','insert') as enroll, has_function_privilege('anon','public.af_decision_benchmark_start(uuid,uuid,text,text,text,jsonb)','execute') as start, relrowsecurity as rls from pg_class where oid='public.af_decision_benchmark_cases'::regclass",
      )
    ).rows[0];
    assert.deepEqual(rights, { read: false, enroll: false, start: false, rls: true });
  } finally {
    await ctx.sql.close();
  }
});

test('changed evidence, stage, timing, arbitrary prompts and expired enrollments cannot cause a paid request', async () => {
  const ctx = await setup(() => assert.fail('must not call provider'));
  try {
    const id = await ctx.enroll();
    for (const body of [
      { ...ctx.body, scope: 'look-b' },
      { ...ctx.body, images: [{ ...ctx.body.images[0], durationMs: 200 }] },
      { stage: 'input', scope: 'design', images: [] },
    ])
      assert.equal((await ctx.send(id, body)).body.code, 'benchmark-evidence-changed');
    assert.equal((await ctx.send(id, { ...ctx.body, prompt: 'bypass' })).status, 422);
    await ctx.sql.query("update public.af_decision_benchmark_cases set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=$1", [
      id,
    ]);
    assert.equal((await ctx.send(id)).body.code, 'benchmark-expired');
    assert.equal((await ctx.sql.query('select count(*)::int as n from public.af_decision_reviews')).rows[0].n, 0);
  } finally {
    await ctx.sql.close();
  }
});

test('HTTP failure and unknown outcome are retained and never automatically dispatched again', async () => {
  let calls = 0;
  const ctx = await setup(async () => {
    calls++;
    return new Response('secret provider details', { status: 403, headers: { 'x-request-id': 'req_denied' } });
  });
  try {
    const id = await ctx.enroll(),
      a = await ctx.send(id),
      b = await ctx.send(id);
    assert.equal(calls, 1);
    assert.deepEqual(a.body, b.body);
    assert.equal(a.body.review.status, 'unverified');
    assert.equal(a.body.review.providerHttpStatus, 403);
    assert.ok(!JSON.stringify(a).includes('secret provider details'));
  } finally {
    await ctx.sql.close();
  }
});
