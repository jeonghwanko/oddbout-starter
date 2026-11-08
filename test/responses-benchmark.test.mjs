import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generation } from './helpers/generation-database.mjs';
import { reviewEvidence, RULES, questions } from '../api/decisions-review.mjs';
import { createResponsesBenchmarkReviewer } from '../api/responses-benchmark.mjs';
import { sha256 } from '../api/http.mjs';

const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0xoAAAAASUVORK5CYII=', 'base64');
async function setup(fetcher) {
  const ctx = await generation({ responsesReviewer: createResponsesBenchmarkReviewer({ enabled: true, apiKey: 'test-secret-only', fetcher }) });
  const body = {
    stage: 'pose',
    scope: 'look-a',
    images: [{ role: 'candidate', durationMs: 100, sha256: await sha256(bytes), dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }],
  };
  const evidence = await reviewEvidence(body);
  const enroll = async (config = { model: 'gpt-6.1-sol', questionNames: ['anatomy', 'identity', 'framing'] }) =>
    (
      await ctx.sql.query(
        `insert into public.af_decision_benchmark_cases(host_id,label,intent,evidence,expires_at)
      values(public.af_generation_official(),'model-comparison',$1,$2,now()+interval '1 hour') returning id`,
        [
          { description: 'Original sprite', brief: {}, ...(config === null ? {} : { benchmarkReview: config }) },
          { stage: body.stage, scope: body.scope, images: evidence.binding },
        ],
      )
    ).rows[0].id;
  return { ...ctx, body, evidence, enroll, send: (id, b = body) => ctx.work('POST', `decision-benchmarks/${id}`, b) };
}
function success(init) {
  const request = JSON.parse(init.body);
  return Response.json({
    model: request.model,
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify(
              Object.fromEntries(
                request.text.format.schema.required.map(name => [name, { choice: 'unverified', reason: 'Insufficient visible evidence.', frames: [] }]),
              ),
            ),
          },
        ],
      },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 80,
      total_tokens: 180,
      input_tokens_details: { cached_tokens: 10, cache_write_tokens: 60 },
      output_tokens_details: { reasoning_tokens: 50 },
    },
  });
}

test('Responses comparisons preserve questions/evidence, use only enrolled models, and consume shared quota once', async () => {
  let calls = 0,
    last;
  const ctx = await setup(async (url, init) => {
    calls++;
    last = JSON.parse(init.body);
    assert.equal(url, 'https://api.openai.com/v1/responses');
    return success(init);
  });
  try {
    const id = await ctx.enroll();
    assert.equal((await ctx.call('POST', `generation-worker/decision-benchmarks/${id}`, ctx.body)).status, 403);
    const results = await Promise.all([ctx.send(id), ctx.send(id)]);
    assert.ok(results.every(r => r.status === 200));
    assert.equal(calls, 1);
    const report = results[0].body.review;
    assert.equal(report.status, 'completed');
    assert.equal(report.visualApproval, false);
    assert.equal(report.binding.model, 'gpt-6.1-sol');
    assert.equal(report.binding.confidenceType, 'not-available');
    assert.equal(report.usage.output_tokens_details.reasoning_tokens, 50);
    assert.equal(report.usage.input_tokens_details.cache_write_tokens, 60);
    assert.ok(!JSON.stringify(report).includes('test-secret-only'));
    assert.equal(last.store, false);
    assert.equal(last.service_tier, 'default');
    assert.equal(last.max_output_tokens, 1800);
    assert.equal(last.reasoning.effort, 'medium');
    assert.equal(last.tools, undefined);
    assert.ok(last.input[0].content.startsWith(RULES));
    assert.ok(last.input[0].content.endsWith(JSON.stringify(questions('pose'))));
    const restored = last.input[1].content.slice(1).map(p => (p.type === 'input_text' ? { type: 'input_json', data: JSON.parse(p.text) } : p));
    assert.deepEqual(restored, ctx.evidence.content);
    for (const body of [
      { ...ctx.body, model: 'gpt-6-astra' },
      { ...ctx.body, questionNames: ['framing'] },
      { ...ctx.body, prompt: 'override' },
    ])
      assert.equal((await ctx.send(await ctx.enroll(), body)).status, 422);
    assert.equal(calls, 1);
    await ctx.sql.exec('update public.af_decision_review_limits set daily_calls=1');
    assert.equal((await ctx.send(await ctx.enroll())).body.code, 'review-limit');
    assert.equal((await ctx.sql.query('select count(*)::int as n from public.af_generation_jobs')).rows[0].n, 0);
  } finally {
    await ctx.sql.close();
  }
});

test('Astra subset is operator-controlled; invalid, unenrolled, changed or expired evidence cannot dispatch', async () => {
  let calls = 0,
    last;
  const ctx = await setup(async (_, init) => {
    calls++;
    last = JSON.parse(init.body);
    return success(init);
  });
  try {
    for (const config of [
      { model: 'gpt-6-astra', questionNames: ['fake'] },
      { model: 'gpt-6-astra', questionNames: [] },
      { model: 'gpt-6.1-sol', questionNames: ['anatomy'] },
      { model: 'other', questionNames: ['anatomy'] },
      { model: 'gpt-6-astra', questionNames: ['anatomy'], endpoint: 'https://evil.test' },
    ])
      assert.equal((await ctx.send(await ctx.enroll(config))).body.code, 'invalid-benchmark-config');
    assert.equal((await ctx.send(await ctx.enroll(null))).body.review.status, 'disabled');
    const id = await ctx.enroll({ model: 'gpt-6-astra', questionNames: ['identity', 'anatomy'] });
    assert.equal((await ctx.send(id, { ...ctx.body, scope: 'look-b' })).body.code, 'benchmark-evidence-changed');
    assert.equal(calls, 0);
    assert.equal((await ctx.send(id)).body.review.status, 'completed');
    assert.equal(last.model, 'gpt-6-astra');
    assert.deepEqual(last.text.format.schema.required, ['anatomy', 'identity']);
    assert.ok(last.input[0].content.endsWith(JSON.stringify(questions('pose').slice(0, 2))));
    assert.equal(calls, 1);
    const expired = await ctx.enroll();
    await ctx.sql.query("update public.af_decision_benchmark_cases set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=$1", [
      expired,
    ]);
    assert.equal((await ctx.send(expired)).body.code, 'benchmark-expired');
    assert.equal(calls, 1);
  } finally {
    await ctx.sql.close();
  }
});

test('Responses failure/incomplete output is retained with safe usage and never retried', async () => {
  let calls = 0;
  const ctx = await setup(async () => {
    calls++;
    return calls === 1
      ? new Response('secret upstream failure', { status: 403, headers: { 'x-request-id': 'req_denied' } })
      : Response.json({ model: 'gpt-6.1-sol', status: 'incomplete', output: [], usage: { input_tokens: 100, output_tokens: 1800 } });
  });
  try {
    const a = await ctx.enroll(),
      b = await ctx.enroll();
    const first = await ctx.send(a);
    assert.equal(first.body.review.status, 'unverified');
    assert.equal(first.body.review.providerHttpStatus, 403);
    assert.deepEqual((await ctx.send(a)).body, first.body);
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(first).includes('secret upstream failure'));
    const second = await ctx.send(b);
    assert.equal(second.body.review.status, 'unverified');
    assert.equal(second.body.review.usage.output_tokens, 1800);
    await ctx.send(b);
    assert.equal(calls, 2);
  } finally {
    await ctx.sql.close();
  }
});
