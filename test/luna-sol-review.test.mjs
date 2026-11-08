import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLunaSolReviewer } from '../api/luna-sol-review.mjs';
import { followupQuestions } from '../api/responses-benchmark.mjs';
import { reviewEvidence } from '../api/decisions-review.mjs';
import { sha256 } from '../api/http.mjs';
import { generation } from './helpers/generation-database.mjs';

const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0xoAAAAASUVORK5CYII=', 'base64');
async function setup({ choices = {}, fail, afterLuna, snapshot = '' } = {}) {
  const requests = [];
  const reviewer = createLunaSolReviewer({
    enabled: true,
    apiKey: 'test-server-key',
    fetcher: async (url, init) => {
      const request = JSON.parse(init.body);
      requests.push(request);
      assert.equal(init.redirect, 'error');
      assert.ok(['gpt-6-luna', 'gpt-6.1-sol'].includes(request.model));
      if (fail === request.model) throw Error('test-server-key upstream secret');
      if (request.model === 'gpt-6-luna') {
        assert.equal(url, 'https://api.openai.com/v1/decisions');
        await afterLuna?.();
        return Response.json({
          model: request.model + snapshot,
          answers: request.questions.map(q => {
            const choice = choices[q.name] ?? 'clear',
              low = choice === 'low-clear';
            if (choice === 'refusal') return { name: q.name, type: 'refusal' };
            return {
              name: q.name,
              type: 'choice',
              choice: low ? 'clear' : choice,
              confidence: low ? 0.6 : 0.95,
              probabilities: ['clear', 'defect', 'unverified'].map(value => ({ value, probability: value === (low ? 'clear' : choice) ? 0.9 : 0.05 })),
            };
          }),
        });
      }
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(request.store, false);
      assert.equal(request.reasoning.effort, 'medium');
      assert.equal(request.max_output_tokens, 1800);
      assert.equal(request.tools, undefined);
      return Response.json({
        model: request.model + snapshot,
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify(
                  Object.fromEntries(request.text.format.schema.required.map(name => [name, { choice: 'clear', reason: 'Visible evidence.', frames: [0] }])),
                ),
              },
            ],
          },
        ],
      });
    },
  });
  const ctx = await generation({ cascadeReviewer: reviewer });
  const body = {
    stage: 'pose',
    scope: 'look-a',
    images: [{ role: 'candidate', durationMs: 100, sha256: await sha256(bytes), dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }],
  };
  const evidence = await reviewEvidence(body);
  async function job() {
    await ctx.healthy();
    await ctx.call('POST', 'generations', { description: 'A small blue cat boxer with a scarf', language: 'en' }, undefined, {
      'idempotency-key': crypto.randomUUID(),
    });
    const brief = (await ctx.work('POST', 'claim', {})).body.job;
    await ctx.work('POST', 'finish', { jobId: brief.id, leaseToken: brief.leaseToken, outcome: 'ok', result: { brief: { look: { subject: 'blue cat' } } } });
    return (await ctx.work('POST', 'claim', {})).body.job;
  }
  const send = (j, b = body) => ctx.work('POST', `jobs/${j.id}/decisions`, b, { 'x-generation-lease': j.leaseToken });
  return { ...ctx, body, evidence, requests, reviewer, job, send };
}

test('production reviews only uncertain/defect questions with Sol once, without changing Luna or approval', async () => {
  const ctx = await setup({ choices: { anatomy: 'defect', identity: 'low-clear' } });
  try {
    const job = await ctx.job();
    assert.equal(job.decisionsReview.mode, 'shadow');
    const duplicates = await Promise.all([ctx.send(job), ctx.send(job)]);
    assert.ok(duplicates.every(r => r.status === 200));
    const response = await ctx.send(job),
      r = response.body.review;
    assert.equal(ctx.requests.length, 2);
    assert.deepEqual(r.cascade.questionNames, ['anatomy', 'identity']);
    assert.deepEqual(ctx.requests[1].text.format.schema.required, ['anatomy', 'identity']);
    assert.deepEqual(
      ctx.requests[1].input[1].content.map(p => (p.type === 'input_text' ? { type: 'input_json', data: JSON.parse(p.text) } : p)),
      ctx.requests[0].input[1].content,
    );
    assert.equal(r.checks.anatomy.status, 'defect');
    assert.equal(r.checks.identity.status, 'unverified');
    assert.equal(r.followup.checks.anatomy.status, 'clear');
    assert.equal(r.followup.visualApproval, false);
    assert.equal(r.visualApproval, false);
    assert.equal(r.followup.binding.parentRequestSha256, r.binding.requestSha256);
    assert.equal(r.followup.binding.model, 'gpt-6.1-sol');
    const records = (await ctx.call('GET', `generations/${job.id}/reviews`)).body.reviews;
    assert.equal(records.length, 2);
    assert.ok(!JSON.stringify(records).includes('test-server-key'));
    for (const patch of [{ model: 'gpt-6-astra' }, { questionNames: ['framing'] }, { primary: r }])
      assert.equal((await ctx.send(job, { ...ctx.body, ...patch })).status, 422);
    assert.equal(ctx.requests.length, 2);
    const completed = await ctx.work('POST', 'finish', {
      jobId: job.id,
      leaseToken: job.leaseToken,
      outcome: 'ok',
      result: { candidates: ['look-a-0', 'look-b-0'] },
    });
    assert.equal(completed.status, 200);
    assert.equal((await ctx.send(job)).status, 409);
  } finally {
    await ctx.sql.close();
  }
});

test('both models may answer with a dated snapshot of the model asked for', async () => {
  const ctx = await setup({ choices: { anatomy: 'defect' }, snapshot: '-2026-10-01' });
  try {
    const r = (await ctx.send(await ctx.job())).body.review;
    assert.deepEqual([r.status, r.responseModel, r.checks.anatomy.status], ['completed', 'gpt-6-luna-2026-10-01', 'defect']);
    assert.deepEqual([r.followup.status, r.followup.checks.anatomy.status], ['completed', 'clear']);
  } finally {
    await ctx.sql.close();
  }
});

test('clear, refused or unknown Luna outcomes do not invoke a second model or retry the first', async () => {
  for (const options of [{}, { choices: { anatomy: 'refusal' } }, { fail: 'gpt-6-luna' }]) {
    const ctx = await setup(options);
    try {
      const job = await ctx.job();
      const r = (await ctx.send(job)).body.review;
      assert.equal(r.followup, null);
      assert.deepEqual(r.cascade.questionNames, []);
      await ctx.send(job);
      assert.equal(ctx.requests.length, 1);
      await ctx.sql.exec(`update public.af_decision_reviews set report=jsonb_set(report,'{status}','"request_started"')`);
      assert.equal((await ctx.send(job)).body.review.followup, null);
      assert.equal(ctx.requests.length, 1);
    } finally {
      await ctx.sql.close();
    }
  }
});

test('Sol failures and shared quota exhaustion preserve Luna and never produce approval', async () => {
  for (const quota of [false, true]) {
    const ctx = await setup({ choices: { anatomy: 'unverified' }, fail: quota ? undefined : 'gpt-6.1-sol' });
    try {
      const job = await ctx.job();
      if (quota) await ctx.sql.exec('update public.af_decision_review_limits set daily_calls=1');
      const r = (await ctx.send(job)).body.review;
      assert.equal(r.status, 'completed');
      assert.equal(r.followup.status, 'unverified');
      assert.equal(r.followup.errorCode, quota ? 'review-limit' : 'provider-outcome-unverified');
      assert.equal(r.followup.visualApproval, false);
      assert.ok(!JSON.stringify(r).includes('secret'));
      await ctx.send(job);
      assert.equal(ctx.requests.length, quota ? 1 : 2);
    } finally {
      await ctx.sql.close();
    }
  }
});

test('a lease lost between models blocks Sol, and changed/foreign primary evidence cannot select it', async () => {
  let expire = async () => {};
  const ctx = await setup({ choices: { anatomy: 'defect' }, afterLuna: () => expire() });
  try {
    const job = await ctx.job();
    expire = () => ctx.sql.query("update public.af_generation_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [job.id]);
    const r = (await ctx.send(job)).body.review;
    assert.equal(r.status, 'completed');
    assert.equal(r.followup.errorCode, 'lease-lost');
    assert.equal(ctx.requests.length, 1);
    assert.deepEqual(followupQuestions({ ...r, binding: { ...r.binding, model: 'gpt-6-astra' } }, ctx.evidence), []);
    assert.deepEqual(followupQuestions(r, { ...ctx.evidence, binding: [{ ...ctx.evidence.binding[0], durationMs: 200 }] }), []);
  } finally {
    await ctx.sql.close();
  }
});

test('operator paired cases exercise the real cascade without creating a generation job', async () => {
  const ctx = await setup({ choices: { anatomy: 'defect' } });
  try {
    const intent = { description: 'Existing sprite', brief: {} },
      binding = { stage: ctx.body.stage, scope: ctx.body.scope, images: ctx.evidence.binding };
    const enroll = async i =>
      (
        await ctx.sql.query(
          `insert into public.af_decision_benchmark_cases(host_id,label,intent,evidence,expires_at)
      values(public.af_generation_official(),'cascade-smoke',$1,$2,now()+interval '1 hour') returning id`,
          [i, binding],
        )
      ).rows[0].id;
    const child = await enroll(intent),
      parent = await enroll({ ...intent, cascadeFollowupCaseId: child });
    const send = () => ctx.work('POST', `decision-benchmarks/${parent}`, ctx.body);
    assert.equal((await ctx.call('POST', `generation-worker/decision-benchmarks/${parent}`, ctx.body)).status, 403);
    const r = (await send()).body.review;
    assert.equal(r.status, 'completed');
    assert.equal(r.followup.status, 'completed');
    assert.equal(ctx.requests.length, 2);
    await send();
    assert.equal(ctx.requests.length, 2);
    assert.equal((await ctx.sql.query('select count(*)::int as n from public.af_generation_jobs')).rows[0].n, 0);
    await ctx.sql.query("update public.af_decision_benchmark_cases set intent='{}' where id=$1", [child]);
    assert.equal((await send()).body.code, 'invalid-benchmark-config');
    assert.equal(ctx.requests.length, 2);
    const consumed = await enroll(intent),
      again = await enroll({ ...intent, cascadeFollowupCaseId: consumed });
    await ctx.sql.query(
      `insert into public.af_decision_reviews(benchmark_id,host_id,fingerprint,stage,scope,report)
      values($1,public.af_generation_official(),$2,'pose','look-a',$3)`,
      [consumed, 'a'.repeat(64), { status: 'completed', binding: { model: 'gpt-6-luna', requestSha256: 'a'.repeat(64) } }],
    );
    const reused = (await ctx.work('POST', `decision-benchmarks/${again}`, ctx.body)).body.review;
    assert.equal(reused.followup.errorCode, 'review-binding-changed');
    assert.equal(ctx.requests.length, 3); // New Luna only; no Sol for the consumed case.
  } finally {
    await ctx.sql.close();
  }
});
