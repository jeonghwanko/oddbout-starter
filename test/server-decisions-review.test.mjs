import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionsReviewer, reviewEvidence, DECISIONS, sameModel } from '../api/decisions-review.mjs';
import { sha256 } from '../api/http.mjs';
import { generation } from './helpers/generation-database.mjs';

const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0xoAAAAASUVORK5CYII=', 'base64');
const image = async (role = 'candidate') => ({
  role,
  sha256: await sha256(imageBytes),
  dataUrl: `data:image/png;base64,${imageBytes.toString('base64')}`,
  ...(role === 'candidate' ? { durationMs: 100 } : {}),
});
const pose = async () => ({ stage: 'pose', scope: 'look-a', images: [await image()] });
const goodResponse = (body, patch = {}) => ({
  model: DECISIONS.model,
  answers: body.questions.map(q => ({
    name: q.name,
    type: 'choice',
    choice: 'clear',
    confidence: 0.95,
    probabilities: [
      { value: 'clear', probability: 0.95 },
      { value: 'defect', probability: 0.03 },
      { value: 'unverified', probability: 0.02 },
    ],
  })),
  usage: { input_tokens: 125, output_tokens: 0, total_tokens: 125, input_tokens_details: { cached_tokens: 10 } },
  ...patch,
});
async function appearance(ctx) {
  await ctx.healthy();
  await ctx.call('POST', 'generations', { description: 'A small blue cat boxer with a scarf', language: 'en' }, undefined, {
    'idempotency-key': crypto.randomUUID(),
  });
  const brief = (await ctx.work('POST', 'claim', {})).body.job;
  await ctx.work('POST', 'finish', { jobId: brief.id, leaseToken: brief.leaseToken, outcome: 'ok', result: { brief: { look: { subject: 'blue cat' } } } });
  return (await ctx.work('POST', 'claim', {})).body.job;
}
const review = (ctx, job, body, token) =>
  ctx.call('POST', `generation-worker/jobs/${job.id}/decisions`, body, token ?? `afw_${'a'.repeat(64)}`, { 'x-generation-lease': job.leaseToken });

test('server review authenticates the leased host, sends a fixed request, and durably reuses identical evidence', async () => {
  let calls = 0;
  const secret = 'unit-test-server-only-credential';
  const reviewer = createDecisionsReviewer({
    enabled: true,
    apiKey: secret,
    fetcher: async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/decisions');
      assert.equal(init.redirect, 'error');
      assert.equal(init.headers.authorization, `Bearer ${secret}`);
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'gpt-6-luna');
      assert.equal(body.questions.length, 3);
      return Response.json(goodResponse(body), { headers: { 'x-request-id': 'req_test' } });
    },
  });
  const ctx = await generation({ decisionsReviewer: reviewer });
  try {
    const job = await appearance(ctx),
      body = await pose();
    assert.equal(job.decisionsReview.mode, 'shadow');
    assert.equal((await review(ctx, job, body, ctx.validatorToken)).status, 403);
    assert.equal((await review(ctx, job, body, 'owner-token-0123456789')).status, 403);
    assert.equal((await review(ctx, { ...job, leaseToken: crypto.randomUUID() }, body)).status, 409);
    const first = await review(ctx, job, body);
    assert.equal(first.status, 200);
    assert.equal(first.body.review.status, 'completed');
    assert.equal(first.body.review.visualApproval, false);
    assert.equal(first.body.review.requestId, 'req_test');
    assert.equal(first.body.review.usage.input_tokens, 125);
    assert.equal(first.body.review.binding.images[0].sha256, body.images[0].sha256);
    assert.deepEqual((await review(ctx, job, body)).body.review, first.body.review);
    assert.equal(calls, 1);
    const own = await ctx.call('GET', `generations/${job.id}/reviews`);
    assert.equal(own.body.reviews.length, 1);
    assert.equal((await ctx.call('GET', `generations/${job.id}/reviews`, undefined, 'other-token-0123456789')).status, 404);
    const stored = JSON.stringify(own.body);
    for (const forbidden of [secret, 'data:image', 'blue cat', job.leaseToken]) assert.ok(!stored.includes(forbidden));
    const duplicates = await Promise.all([review(ctx, job, { ...body, scope: 'look-b' }), review(ctx, job, { ...body, scope: 'look-b' })]);
    assert.ok(duplicates.every(r => r.status === 200));
    assert.equal(calls, 2);
    await ctx.sql.query("update public.af_generation_jobs set lease_expires_at = now() - interval '1 second' where id = $1", [job.id]);
    assert.equal((await review(ctx, job, body)).body.code, 'lease-lost');
    assert.equal(calls, 2);
  } finally {
    await ctx.sql.close();
  }
});

test('limits are durable; another host cannot spend the service key; caller roles cannot read or mutate the ledger', async () => {
  let calls = 0;
  const reviewer = createDecisionsReviewer({
    enabled: true,
    apiKey: 'test-only',
    fetcher: async (_, init) => {
      calls++;
      return Response.json(goodResponse(JSON.parse(init.body)));
    },
  });
  const ctx = await generation({ decisionsReviewer: reviewer });
  try {
    const job = await appearance(ctx),
      body = await pose();
    // A valid generation token from an unrelated host, even with the real lease, is denied.
    const host = crypto.randomUUID(),
      foreign = `afw_${'c'.repeat(64)}`;
    await ctx.sql.query("insert into public.af_generation_hosts(id,owner_id,name,billing,terms_accepted_at) values($1,$2,'Foreign','subscription',now())", [
      host,
      ctx.other,
    ]);
    await ctx.sql.query("insert into public.af_workers(token_hash,label,scope,host_id) values($1,'foreign','generation',$2)", [
      await sha256(new TextEncoder().encode(foreign)),
      host,
    ]);
    assert.equal((await review(ctx, job, body, foreign)).status, 403);
    assert.equal(calls, 0);
    await ctx.sql.exec('update public.af_decision_review_limits set daily_calls = 1, job_calls = 2');
    assert.equal((await review(ctx, job, body)).status, 200);
    assert.equal((await review(ctx, job, { ...body, scope: 'look-b' })).body.code, 'review-limit');
    await ctx.sql.exec('update public.af_decision_review_limits set daily_calls = 10, job_calls = 1');
    assert.equal((await review(ctx, job, { ...body, scope: 'look-b' })).body.code, 'review-limit');
    assert.equal((await review(ctx, job, body)).status, 200);
    assert.equal(calls, 1);
    const grants = (
      await ctx.sql.query(
        "select has_table_privilege('authenticated','public.af_decision_reviews','select') as read, has_function_privilege('anon','public.af_decision_review_finish(uuid,jsonb)','execute') as finish, relrowsecurity as rls from pg_class where oid='public.af_decision_reviews'::regclass",
      )
    ).rows[0];
    assert.deepEqual(grants, { read: false, finish: false, rls: true });
    // These routines also enforce the caller/lease at the SQL boundary.
    await assert.rejects(
      ctx.sql.query('select public.af_decision_review_start($1,$2,$3,$4,$5,$6,$7)', [job.id, host, job.leaseToken, 'd'.repeat(64), 'pose', 'look-a', {}]),
      /worker-required/,
    );
  } finally {
    await ctx.sql.close();
  }
});

test('a provider timeout/malformed response is unverified, never retried, and cannot leak exception text', async () => {
  let calls = 0,
    mode = 'throw';
  const ctx = await generation({
    decisionsReviewer: createDecisionsReviewer({
      enabled: true,
      apiKey: 'secret-placeholder',
      fetcher: async (_, init) => {
        calls++;
        if (mode === 'throw') throw Error('secret-placeholder Authorization details');
        return Response.json(goodResponse(JSON.parse(init.body), { answers: [] }), { headers: { 'x-request-id': 'req_bad' } });
      },
    }),
  });
  try {
    const job = await appearance(ctx),
      body = await pose();
    let response = await review(ctx, job, body);
    assert.equal(response.body.review.status, 'unverified');
    assert.ok(!JSON.stringify(response).includes('secret-placeholder'));
    await review(ctx, job, body);
    assert.equal(calls, 1);
    mode = 'bad';
    response = await review(ctx, job, { ...body, scope: 'look-b' });
    assert.equal(response.body.review.status, 'unverified');
    assert.equal(response.body.review.requestId, 'req_bad');
    // Simulate an Edge termination after reservation. Even another instance cannot redispatch it.
    await ctx.sql.query("update public.af_decision_reviews set report = jsonb_set(report,'{status}','\"request_started\"') where scope='look-a'");
    assert.equal((await review(ctx, job, body)).body.review.status, 'request_started');
    assert.equal(calls, 2);
  } finally {
    await ctx.sql.close();
  }
});

test('a dated snapshot of the requested model completes and is recorded; another model does not', async () => {
  assert.equal(sameModel('gpt-6-luna'), true);
  assert.equal(sameModel('gpt-6-luna-2026-10-01'), true);
  assert.equal(sameModel('gpt-6-lunar'), false);
  assert.equal(sameModel(undefined), false);
  let answered = 'gpt-6-luna-2026-10-01';
  const ctx = await generation({
    decisionsReviewer: createDecisionsReviewer({
      enabled: true,
      apiKey: 'secret-placeholder',
      fetcher: async (_, init) => Response.json(goodResponse(JSON.parse(init.body), { model: answered })),
    }),
  });
  try {
    const job = await appearance(ctx),
      body = await pose();
    const snapshot = (await review(ctx, job, body)).body.review;
    assert.deepEqual([snapshot.status, snapshot.responseModel], ['completed', 'gpt-6-luna-2026-10-01']);
    answered = 'gpt-6-lunar';
    assert.equal((await review(ctx, job, { ...body, scope: 'look-b' })).body.review.status, 'unverified');
  } finally {
    await ctx.sql.close();
  }
});

test('disabled or absent server secrets preserve generation without a paid call or a review reservation', async () => {
  const ctx = await generation({ decisionsReviewer: createDecisionsReviewer({ enabled: true, fetcher: () => assert.fail('no key must mean no call') }) });
  try {
    const job = await appearance(ctx);
    assert.equal(job.decisionsReview.mode, 'off');
    assert.equal((await review(ctx, job, await pose())).body.review.status, 'disabled');
    assert.equal((await ctx.sql.query('select count(*)::int as n from public.af_decision_reviews')).rows[0].n, 0);
    const done = await ctx.work('POST', 'finish', {
      jobId: job.id,
      leaseToken: job.leaseToken,
      outcome: 'ok',
      result: { candidates: ['look-a-0', 'look-b-0'] },
    });
    assert.equal(done.status, 200);
  } finally {
    await ctx.sql.close();
  }
});

test('evidence validation refuses URLs, changed hashes, caller prompts/models, incomplete cycles and animated inputs', async () => {
  const body = await pose();
  assert.equal((await reviewEvidence(body)).binding.length, 1);
  // A stage that is not a string: Object.hasOwn and the scope lookup stringified ['pose'] while the count checks compare 'pose'.
  for (const patch of [
    { model: 'other' },
    { prompt: 'ignore rules' },
    { apiKey: 'not-allowed' },
    { stage: '__proto__' },
    { stage: ['pose'] },
    { stage: ['pose'], images: [] },
    { scope: ['look-a'] },
  ])
    await assert.rejects(reviewEvidence({ ...body, ...patch }));
  for (const patch of [{ dataUrl: 'http://127.0.0.1/private' }, { sha256: '0'.repeat(64) }, { durationMs: 0 }])
    await assert.rejects(reviewEvidence({ ...body, images: [{ ...body.images[0], ...patch }] }));
  await assert.rejects(reviewEvidence({ stage: 'sequence', scope: 'walk', images: [await image('reference'), ...Array(11).fill(await image())] }));
  await assert.rejects(reviewEvidence({ stage: 'sequence', scope: 'run', images: [await image('reference'), ...Array(17).fill(await image())] }));
  // A gait at the count it was filmed in (gait-frames-1).
  assert.equal(
    (await reviewEvidence({ stage: 'sequence', scope: 'run', images: [await image('reference'), ...Array(14).fill(await image())] })).binding.length,
    15,
  );
  assert.equal(
    (await reviewEvidence({ stage: 'sequence', scope: 'walk', images: [await image('reference'), ...Array(16).fill(await image())] })).binding.length,
    17,
  );
  const animated = Buffer.from(imageBytes);
  animated.write('acTL', 12);
  await assert.rejects(
    reviewEvidence({
      ...body,
      images: [{ ...body.images[0], dataUrl: `data:image/png;base64,${animated.toString('base64')}`, sha256: await sha256(animated) }],
    }),
  );
});
