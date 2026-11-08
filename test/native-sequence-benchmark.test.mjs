import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { generation } from './helpers/generation-database.mjs';
import { createDecisionsReviewer, decisionsRequest, reviewEvidence, nativeSequenceEvidence, questions, DECISIONS } from '../api/decisions-review.mjs';
import { SEQUENCE_METHODS, PAIRED_SEQUENCE_METHOD, BENCHMARK_BODY_BYTES } from '../api/sequence-benchmark.mjs';
import { responsesRequest } from '../api/responses-benchmark.mjs';
import { freezeComparison, validateComparisonPlan } from '../scripts/animation-review-plan.mjs';
import { evaluate, digest } from '../scripts/animation-review-eval-lib.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0xoAAAAASUVORK5CYII=', 'base64');
const names = questions('sequence').map(q => q.name);
const intent = { description: 'Synthetic test fixture', brief: {}, appearance_note: null, motion_note: null };
const request = (count, bytes = png) => ({
  stage: 'sequence',
  scope: 'walk',
  images: Array.from({ length: count + 1 }, (_, i) => ({
    role: i ? 'candidate' : 'reference',
    sha256: digest(bytes),
    dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    ...(i ? { durationMs: 70 + i } : {}),
  })),
});
const entry = count => ({
  id: `fixture-${count}`,
  sourceGroup: digest(`family-${count}`),
  split: 'held-out',
  raw: Buffer.from(JSON.stringify(request(count))),
  intent,
});
const answer = choice => ({
  status: choice,
  choice,
  confidence: 0.9,
  probabilities: Object.fromEntries(['clear', 'defect', 'unverified'].map(v => [v, v === choice ? 0.9 : 0.05])),
});
async function prepared(count = 49) {
  const source = entry(count),
    plan = await freezeComparison([source]);
  const evidence = await nativeSequenceEvidence(JSON.parse(source.raw));
  const built = await decisionsRequest({ job: intent, evidence, sequenceConfig: { method: PAIRED_SEQUENCE_METHOD, planSha256: plan.planSha256 } });
  const labels = {
    version: 2,
    evidencePolicy: 'native-2-64-v1',
    provenance: {
      method: 'synthetic-demo',
      reviewer: 'test-only',
      recordedAt: '2026-01-01T00:00:00.000Z',
    },
    cases: [
      {
        id: source.id,
        sourceGroup: source.sourceGroup,
        split: source.split,
        evidence: { stage: 'sequence', scope: 'walk', images: evidence.binding },
        labels: Object.fromEntries(names.map(name => [name, name === 'contact' ? 'unverified' : name === 'continuity' ? 'defect' : 'clear'])),
      },
    ],
  };
  const report = {
    status: 'completed',
    stage: 'sequence',
    scope: 'walk',
    binding: built.binding,
    checks: Object.fromEntries(built.request.questions.map(q => [q.name, answer(q.name === 'improved_continuity' ? 'defect' : 'clear')])),
  };
  const results = { calls: [{ caseId: 'operator-fixture', status: 'response_received', httpStatus: 200, requestSha256: digest(source.raw), report }] };
  return { source, plan, evidence, built, labels, results };
}

test('native benchmark accepts original counts through 64 while production takes the contract range (walk 12 to 32)', async () => {
  for (const count of [11, 12, 16, 18, 23, 49, 64]) {
    assert.equal((await nativeSequenceEvidence(request(count))).binding.length, count + 1);
    if (count < 12 || count > 32) await assert.rejects(reviewEvidence(request(count)));
  }
  for (const count of [0, 1, 65]) await assert.rejects(nativeSequenceEvidence(request(count)));
  await assert.rejects(nativeSequenceEvidence({ ...request(16), prompt: 'override' }));
  assert.equal(DECISIONS.bodyBytes, 8 * 1024 * 1024);
  assert.equal(DECISIONS.timeoutMs, 25_000);
  assert.equal(BENCHMARK_BODY_BYTES, 16 * 1024 * 1024);
  const evidence = await nativeSequenceEvidence(request(49));
  const schema = responsesRequest({ model: 'gpt-6.1-sol', job: intent, evidence, questionNames: names }).text.format.schema;
  assert.equal(schema.properties.continuity.properties.frames.items.maximum, 48);
  assert.equal(schema.properties.continuity.properties.frames.maxItems, 49);
});

test('native base64 codec preserves legacy bytes, canonical content, and malformed-tail rejection', async () => {
  const body = request(16),
    canonical = png.toString('base64');
  assert.ok(canonical.endsWith('='));
  const unpadded = canonical.replace(/=+$/, '');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const tailIndex = unpadded.length - 1;
  const nonzeroPadBits = unpadded.slice(0, tailIndex) + alphabet[alphabet.indexOf(unpadded[tailIndex]) + 1] + canonical.slice(unpadded.length);
  const expected = await reviewEvidence(body);
  for (const encoded of [canonical, unpadded, nonzeroPadBits]) {
    const variant = { ...body, images: body.images.map(image => ({ ...image, dataUrl: `data:image/png;base64,${encoded}` })) };
    assert.deepEqual(await nativeSequenceEvidence(variant), expected);
    assert.deepEqual(await reviewEvidence(variant), expected);
  }
  for (const encoded of ['A', 'AA=', 'AAA==', 'AAAA=', canonical + '=', canonical + '===', canonical + 'A', canonical + '\n', canonical.replace(/.$/, '-')]) {
    const variant = { ...body, images: body.images.map(image => ({ ...image, dataUrl: `data:image/png;base64,${encoded}` })) };
    await assert.rejects(reviewEvidence(variant));
    await assert.rejects(nativeSequenceEvidence(variant));
  }
});

test('native and production evidence both avoid per-byte JS string codecs', async t => {
  const expected = await reviewEvidence(request(16));
  t.mock.method(globalThis, 'atob', () => {
    throw Error('legacy decoder invoked');
  });
  t.mock.method(globalThis, 'btoa', () => {
    throw Error('legacy encoder invoked');
  });
  assert.deepEqual(await nativeSequenceEvidence(request(16)), expected);
  assert.deepEqual(await reviewEvidence(request(16)), expected);
});

test('paired independent questions preserve baseline prefix and isolate exact original seam images to improved questions', async () => {
  const { evidence, built, plan } = await prepared();
  assert.equal(plan.protocol.timeoutMs, 110_000);
  assert.equal(built.binding.sequenceBenchmark.timeoutMs, 110_000);
  const baseline = await decisionsRequest({ job: intent, evidence });
  assert.deepEqual(built.request.input, baseline.request.input);
  assert.deepEqual(built.request.questions.slice(0, 5), questions('sequence'));
  assert.equal(built.request.questions.length, 10);
  for (const q of built.request.questions.slice(5)) {
    assert.ok(q.name.startsWith('improved_'));
    assert.ok(q.instructions.every(part => ['input_text', 'input_image'].includes(part.type)));
    const mapping = JSON.parse(q.instructions[1].text).presentationMappingNotObservations;
    assert.equal(mapping.timeline.length, 49);
    assert.deepEqual(mapping.transitions.at(-1), { from: 48, to: 0, atMs: mapping.loopDurationMs, loopSeam: true });
    const images = q.instructions.filter(part => part.type === 'input_image');
    assert.deepEqual(images, [evidence.content.at(-1), evidence.content[3]]);
    assert.deepEqual(mapping.originalImages, evidence.binding);
  }
  for (const method of SEQUENCE_METHODS) assert.equal(plan.cases[0].methods[method].requestSha256, built.binding.requestSha256);
  const changed = structuredClone(plan);
  changed.cases[0].split = 'calibration';
  assert.throws(() => validateComparisonPlan(changed));
  await assert.rejects(freezeComparison([{ ...entry(49), labels: {} }]));
});

test('v2 scores matched original evidence in two separate frozen cohorts and separates human unknowns', async () => {
  const { plan, labels, results } = await prepared();
  const result = evaluate(labels, results, { plan, cutoff: 0.8 });
  assert.equal(result.cohorts.length, 2);
  assert.ok(result.cohorts.every(c => c.transport === 'paired-independent-questions-v1' && !c.calibrationSweep));
  const p = result.pairedComparison.partitions['held-out'];
  assert.equal(p.matchedCases, 1);
  assert.equal(p.pairedCoverage, 1);
  assert.equal(p.baseline.byQuestion.continuity.falseClear, 1);
  assert.equal(p.improved.byQuestion.continuity.detectedDefects, 1);
  assert.equal(p.total.improvedCorrectOnly, 1);
  assert.equal(p.total.humanUnverified, 1);
  assert.equal(result.sharedCalls.recordedCalls, 1);
  assert.equal(result.sharedCalls.perArmCost, null);
  const noCalls = evaluate(labels, { calls: [] }, { plan });
  assert.equal(noCalls.cohorts.length, 2);
  assert.equal(noCalls.pairedComparison.partitions['held-out'].pairedCoverage, 0);
  const missing = structuredClone(results);
  delete missing.calls[0].report.checks.improved_continuity;
  const m = evaluate(labels, missing, { plan }).pairedComparison.partitions['held-out'];
  assert.equal(m.total.improvedUnavailable, 1);
  assert.equal(m.improved.byQuestion.continuity.defectAbstentions, 1);
  for (const mutate of [
    r => {
      delete r.calls[0].requestSha256;
    },
    r => {
      r.calls[0].requestSha256 = digest('changed-source-request');
    },
    r => {
      r.calls[0].report.binding.sequenceBenchmark.sourceEvidenceSha256 = digest('other');
    },
    r => {
      r.calls[0].report.binding.sequenceBenchmark.arms['ordered-native-v1'].presentationSha256 = digest('other');
    },
    r => {
      r.calls[0].report.binding.requestSha256 = digest('other');
    },
    r => {
      r.calls[0].report.binding.images[2].durationMs++;
    },
    r => {
      r.calls[0].report.binding.sequenceBenchmark.arms['timeline-loop-native-v1'].questionNames.reverse();
    },
    r => {
      r.calls[0].report.checks.extra = answer('clear');
    },
  ]) {
    const changed = structuredClone(results);
    mutate(changed);
    assert.throws(() => evaluate(labels, changed, { plan }));
  }
  assert.throws(() => evaluate(labels, results, { plan, cutoff: 0.7 }));
  const changedLabels = structuredClone(labels);
  changedLabels.cases[0].sourceGroup = digest('other-family');
  assert.throws(() => evaluate(changedLabels, results, { plan }));
  const legacy = structuredClone(labels);
  legacy.version = 1;
  delete legacy.evidencePolicy;
  assert.throws(() => evaluate(legacy, results));
});

test('64-frame paired enrollment uses one durable ledger call, rejects mixed config, and never retries unknown outcome', async () => {
  let calls = 0;
  const ctx = await generation({
    decisionsReviewer: createDecisionsReviewer({
      apiKey: 'test-only-key',
      enabled: true,
      fetcher: async (_, init) => {
        calls++;
        assert.equal(JSON.parse(init.body).questions.length, 10);
        throw Error('unknown');
      },
    }),
  });
  try {
    const { plan, evidence } = await prepared(64),
      body = request(64);
    const host = (await ctx.sql.query('select public.af_generation_official() as id')).rows[0].id;
    const config = { method: PAIRED_SEQUENCE_METHOD, planSha256: plan.planSha256 };
    const enroll = async override =>
      (
        await ctx.sql.query(
          `insert into public.af_decision_benchmark_cases(host_id,label,intent,evidence,expires_at)
      values($1,'synthetic-native',$2,$3,now()+interval '1 hour') returning id`,
          [host, { ...intent, sequenceBenchmark: config, ...override }, { stage: 'sequence', scope: 'walk', images: evidence.binding }],
        )
      ).rows[0].id;
    const id = await enroll({}),
      send = () => ctx.work('POST', `decision-benchmarks/${id}`, body);
    assert.equal((await ctx.call('POST', `generation-worker/decision-benchmarks/${id}`, body)).status, 403);
    const first = await send();
    assert.equal(first.status, 200);
    assert.equal(first.body.review.status, 'unverified');
    assert.deepEqual((await send()).body, first.body);
    assert.equal(calls, 1);
    assert.equal((await ctx.sql.query('select count(*)::int as n from public.af_decision_reviews')).rows[0].n, 1);
    assert.equal((await ctx.sql.query('select count(*)::int as n from public.af_generation_jobs')).rows[0].n, 0);
    const mixed = await enroll({ benchmarkReview: { model: 'gpt-6.1-sol', questionNames: names } });
    assert.equal((await ctx.work('POST', `decision-benchmarks/${mixed}`, body)).body.code, 'invalid-benchmark-config');
    await ctx.sql.query('update public.af_decision_benchmark_cases set intent=$1 where id=$2', [
      { ...intent, sequenceBenchmark: { ...config, planSha256: digest('changed-plan') } },
      id,
    ]);
    assert.equal((await send()).body.code, 'review-binding-changed');
    assert.equal(calls, 1);
  } finally {
    await ctx.sql.close();
  }
});

test('only the benchmark route accepts original PNG evidence above 8 MiB, still bounded at 16 MiB', async () => {
  let calls = 0;
  const ctx = await generation({
    decisionsReviewer: createDecisionsReviewer({
      apiKey: 'test-only-key',
      enabled: true,
      fetcher: async () => {
        calls++;
        throw Error('unknown');
      },
    }),
  });
  try {
    const noisy = await sharp(randomBytes(256 * 256 * 3), { raw: { width: 256, height: 256, channels: 3 } })
      .png()
      .toBuffer();
    const body = request(49, noisy),
      raw = JSON.stringify(body);
    assert.ok(Buffer.byteLength(raw) > DECISIONS.bodyBytes && Buffer.byteLength(raw) < BENCHMARK_BODY_BYTES);
    const evidence = await nativeSequenceEvidence(body);
    const host = (await ctx.sql.query('select public.af_generation_official() as id')).rows[0].id;
    const id = (
      await ctx.sql.query(
        `insert into public.af_decision_benchmark_cases(host_id,label,intent,evidence,expires_at)
      values($1,'synthetic-large',$2,$3,now()+interval '1 hour') returning id`,
        [
          host,
          { ...intent, sequenceBenchmark: { method: PAIRED_SEQUENCE_METHOD, planSha256: digest('test-plan') } },
          { stage: 'sequence', scope: 'walk', images: evidence.binding },
        ],
      )
    ).rows[0].id;
    assert.equal((await ctx.work('POST', `decision-benchmarks/${id}`, body)).status, 200);
    assert.equal(calls, 1);
    const tooLarge = raw + ' '.repeat(BENCHMARK_BODY_BYTES - Buffer.byteLength(raw) + 1);
    assert.equal((await ctx.call('POST', `generation-worker/decision-benchmarks/${id}`, tooLarge, null, { 'content-type': 'application/json' })).status, 401);
    assert.equal((await ctx.work('POST', `decision-benchmarks/${id}`, tooLarge, { 'content-type': 'application/json' })).status, 413);
    assert.equal(calls, 1);
  } finally {
    await ctx.sql.close();
  }
});

test('a finish-store failure retains request_started and a repeated call cannot redispatch', async () => {
  const { evidence, plan } = await prepared(11);
  let calls = 0,
    saved;
  const db = {
    rpc: async (name, args) => {
      if (name === 'af_decision_review_start') {
        if (saved) return { data: { started: false, report: saved } };
        saved = { status: 'request_started', stage: 'sequence', scope: 'walk', binding: args.p_binding };
        return { data: { started: true, id: 'test-ledger', report: saved } };
      }
      return { error: { message: 'store unavailable' } };
    },
  };
  const reviewer = createDecisionsReviewer({
    apiKey: 'test-only-key',
    enabled: true,
    fetcher: async () => {
      calls++;
      throw Error('unknown');
    },
  });
  const input = { db, job: intent, host: null, lease: null, evidence, sequenceConfig: { method: PAIRED_SEQUENCE_METHOD, planSha256: plan.planSha256 } };
  await assert.rejects(reviewer.review(input));
  assert.equal((await reviewer.review(input)).status, 'request_started');
  assert.equal(calls, 1);
});
