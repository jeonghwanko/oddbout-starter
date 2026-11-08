import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { digest, evidenceDigest, evaluate, swappedPair } from '../scripts/animation-review-eval-lib.mjs';

const names = ['anatomy', 'identity', 'continuity', 'alternation', 'contact'];
const clone = value => structuredClone(value);
function evidence(seed = 'a') {
  return {
    stage: 'sequence',
    scope: 'walk',
    images: [
      { role: 'reference', sha256: digest('shared-reference'), width: 4, height: 4 },
      ...Array.from({ length: 16 }, (_, index) => ({
        role: 'candidate',
        sha256: digest(`${seed}-${index}`),
        width: 4,
        height: 4,
        index,
        durationMs: 80 + index,
      })),
    ],
  };
}
function labeled(id, split = 'calibration', label = 'clear') {
  const binding = evidence(id);
  return {
    id,
    split,
    sourceGroup: evidenceDigest(binding),
    evidence: binding,
    labels: Object.fromEntries(names.map(n => [n, n === 'continuity' ? label : 'clear'])),
  };
}
const manifest = cases => ({ version: 1, provenance: { method: 'human-independent', reviewer: 'reviewer-a', recordedAt: '2026-01-01T00:00:00.000Z' }, cases });
function answer(choice, score = 0.9, confidence = 0.95) {
  return {
    status: score >= 0.8 && confidence >= 0.8 ? choice : 'unverified',
    choice,
    confidence,
    probabilities: Object.fromEntries(['clear', 'defect', 'unverified'].map(v => [v, v === choice ? score : (1 - score) / 2])),
  };
}
function call(entry, check = answer('clear')) {
  return {
    status: 'response_received',
    httpStatus: 200,
    caseId: `operator-${entry.id}`,
    // Runner request hash is intentionally NOT the model prompt hash or evidence hash.
    requestSha256: digest('runner-body'),
    report: {
      status: 'completed',
      stage: 'sequence',
      scope: 'walk',
      binding: {
        images: entry.evidence.images,
        model: 'gpt-6-luna',
        rubric: 'hosted-sprite-v1',
        threshold: 0.8,
        requestSha256: digest(`model-prompt-${entry.id}`),
      },
      checks: Object.fromEntries(names.map(n => [n, n === 'continuity' ? check : answer('clear')])),
    },
  };
}
const continuity = (result, split = 'calibration', view = 'recorded') => result.cohorts[0].partitions[split][view].byQuestion.continuity;

test('per-question false clears, false rejects, and abstentions retain their denominators', () => {
  const bad = labeled('bad', 'calibration', 'defect'),
    clean = labeled('clean'),
    unknown = labeled('unknown', 'calibration', 'unverified');
  const held = labeled('held', 'held-out', 'defect'),
    missing = labeled('missing', 'held-out', 'defect');
  const unavailable = call(held);
  unavailable.report.status = 'request_started';
  delete unavailable.report.checks;
  const result = evaluate(manifest([bad, clean, unknown, held, missing]), {
    calls: [call(bad), call(clean, answer('defect')), call(unknown), unavailable, { status: 'transport_outcome_unknown', report: null }],
  });
  const m = continuity(result);
  assert.equal(m.falseClear, 1);
  assert.equal(m.falseReject, 1);
  assert.equal(m.humanUnverifiedAttempts, 1);
  assert.equal(m.labeledDefectAttempts, 1);
  assert.equal(m.labeledCleanAttempts, 1);
  assert.equal(m.defectRecall, 0);
  const h = continuity(result, 'held-out');
  assert.equal(h.notAttempted, 1);
  assert.equal(h.unavailable, 1);
  assert.equal(h.coverage, 0.5);
  assert.equal(h.defectAbstentions, 1);
  assert.equal(h.falseClear, 0);
  assert.equal(h.defectRecall, 0);
  assert.equal(h.abstentionRate, 1);
  assert.equal(result.unboundCalls, 1);
  assert.equal(result.visualApproval, false);
});

test('calibration sweep never consumes held-out labels; separate confidence and choice probability gates replay together', () => {
  const bad = labeled('bad', 'calibration', 'defect'),
    held = labeled('held', 'held-out', 'defect');
  const data = manifest([bad, held]),
    results = { calls: [call(bad, answer('clear', 0.9, 0.7)), call(held)] };
  const first = evaluate(data, results, { cutoff: 0.8 });
  assert.equal(continuity(first).falseClear, 0);
  assert.equal(continuity(first).defectAbstentions, 1);
  assert.equal(continuity(first, 'calibration', 'rawChoice').falseClear, 1);
  assert.equal(continuity(first, 'held-out', 'frozenCutoff').falseClear, 1);
  const changed = clone(data);
  changed.cases[1].labels.continuity = 'clear';
  const second = evaluate(changed, results, { cutoff: 0.8 });
  assert.deepEqual(first.cohorts[0].calibrationSweep, second.cohorts[0].calibrationSweep);
  assert.equal(first.cohorts[0].calibrationSweep[7].byQuestion.continuity.falseClear, 1);
  assert.equal(first.cohorts[0].calibrationSweep[8].byQuestion.continuity.falseClear, 0);
  assert.throws(() => evaluate(data, results, { cutoff: NaN }), /Cutoff/);
});

test('declared source families cannot leak across split; shared identity reference alone does not group motions', () => {
  const a = labeled('a'),
    b = labeled('b', 'held-out');
  assert.doesNotThrow(() => evaluate(manifest([a, b]), { calls: [] }));
  b.sourceGroup = a.sourceGroup;
  assert.throws(() => evaluate(manifest([a, b]), { calls: [] }), /Source family crosses/);
  const duplicate = { ...clone(a), id: 'different-id' };
  assert.throws(() => evaluate(manifest([a, duplicate]), { calls: [] }), /Duplicate labeled evidence/);
  const swapped = clone(a);
  swapped.id = 'swapped';
  swapped.split = 'held-out';
  swapped.sourceGroup = digest('incorrect-family');
  [swapped.evidence.images[1].sha256, swapped.evidence.images[2].sha256] = [swapped.evidence.images[2].sha256, swapped.evidence.images[1].sha256];
  swapped.evidence.images[1].durationMs++;
  assert.throws(() => evaluate(manifest([a, swapped]), { calls: [] }), /Same image inventory crosses/);
});

test('full ordered image binding guards timing, dimensions, pixels, references and request hash confusion', () => {
  const entry = labeled('a'),
    saved = call(entry);
  assert.equal(evaluate(manifest([entry]), { calls: [saved] }).cohorts.length, 1);
  for (const mutate of [
    r => {
      r.binding.images[1].durationMs++;
    },
    r => {
      r.binding.images[1].width++;
    },
    r => {
      r.binding.images[0].sha256 = digest('other-reference');
    },
    r => {
      [r.binding.images[1].sha256, r.binding.images[2].sha256] = [r.binding.images[2].sha256, r.binding.images[1].sha256];
    },
    r => {
      r.binding.rubric = 'other-rubric';
    },
    r => {
      r.binding.model = 'unknown-model';
    },
    r => {
      r.binding.images[1].index = 2;
    },
    r => {
      r.checks.continuity.probabilities.clear = 0.1;
    },
    r => {
      r.checks.continuity.status = 'defect';
    },
    r => {
      r.binding.requestSha256 = 'bad';
    },
  ]) {
    const changed = clone(saved);
    mutate(changed.report);
    assert.throws(() => evaluate(manifest([entry]), { calls: [changed] }));
  }
  assert.throws(() => evaluate(manifest([entry]), { calls: [saved, saved] }), /Duplicate evidence/);
});

test('partial Responses and Sol followups stay separate and never invent probabilities or localization accuracy', () => {
  const entry = labeled('a', 'calibration', 'defect'),
    luna = call(entry);
  const response = {
    status: 'completed',
    stage: 'sequence',
    scope: 'walk',
    binding: {
      images: entry.evidence.images,
      requestSha256: digest('sol-prompt'),
      model: 'gpt-6.1-sol',
      rubric: 'hosted-sprite-v1',
      adapter: 'responses-choice-v1',
      confidenceType: 'not-available',
      reasoning: 'medium',
      maxOutputTokens: 1800,
      questionNames: ['continuity'],
      policy: 'luna-sol-v1',
      parentRequestSha256: luna.report.binding.requestSha256,
    },
    checks: { continuity: { status: 'defect', choice: 'defect', reason: 'Synthetic observation', frames: [3, 4] } },
  };
  luna.report.followup = response;
  const result = evaluate(manifest([entry]), { calls: [luna] }, { cutoff: 0.8 });
  assert.equal(result.cohorts.length, 2);
  const sol = result.cohorts[1];
  assert.deepEqual(sol.questionNames, ['continuity']);
  assert.equal(sol.partitions.calibration.recorded.total.detectedDefects, 1);
  assert.equal(sol.calibrationSweep, undefined);
  assert.equal(sol.partitions.calibration.frozenCutoff, undefined);
  assert.equal(sol.partitions.calibration.rawChoice, undefined);
  const wrong = clone(luna);
  wrong.report.followup.binding.parentRequestSha256 = digest('unrelated');
  assert.throws(() => evaluate(manifest([entry]), { calls: [wrong] }), /Followup evidence\/parent mismatch/);
  for (const [field, value] of [
    ['reasoning', 'high'],
    ['maxOutputTokens', 900],
    ['parentRequestSha256', [luna.report.binding.requestSha256]],
  ]) {
    const changed = clone(luna);
    changed.report.followup.binding[field] = value;
    assert.throws(() => evaluate(manifest([entry]), { calls: [changed] }));
  }
});

test('missing checks and refusals abstain; unknown human labels never become clean', () => {
  const entry = labeled('a', 'calibration', 'unverified'),
    saved = call(entry);
  delete saved.report.checks.continuity;
  saved.report.checks.contact = { status: 'unverified', reason: 'refusal' };
  const result = evaluate(manifest([entry]), { calls: [saved] });
  const m = continuity(result);
  assert.equal(m.unavailable, 1);
  assert.equal(m.humanUnverifiedAttempts, 1);
  assert.equal(m.labeledCleanAttempts, 0);
  assert.equal(m.falseClearRate, null);
  assert.equal(m.defectRecall, null);
  assert.equal(result.cohorts[0].partitions.calibration.recorded.byQuestion.contact.abstentions, 1);
});

test('malformed labels, report questions and call outcomes fail closed', () => {
  const entry = labeled('a'),
    source = manifest([entry]),
    results = { calls: [call(entry)] };
  for (const mutate of [
    m => {
      m.cases[0].labels.contact = 'probably-clear';
    },
    m => {
      delete m.cases[0].labels.contact;
    },
    m => {
      m.provenance.method = 'model-generated';
    },
    m => {
      m.version = 2;
    },
    m => {
      m.cases[0].evidence.images[1].durationMs = 0;
    },
    m => {
      m.cases[0].sourceGroup = [m.cases[0].sourceGroup];
    },
    m => {
      m.cases[0].id = ['a'];
    },
    m => {
      m.provenance.reviewer = 123;
    },
    m => {
      m.cases[0].evidence.images[0].sha256 = [digest('shared-reference')];
    },
  ]) {
    const changed = clone(source);
    mutate(changed);
    assert.throws(() => evaluate(changed, results));
  }
  const changed = clone(results);
  changed.calls[0].report.checks.other = answer('clear');
  assert.throws(() => evaluate(source, changed), /Unexpected report checks/);
  changed.calls[0].httpStatus = 403;
  assert.throws(() => evaluate(source, changed), /contradicts call outcome/);
  const arrayHash = clone(results);
  arrayHash.calls[0].report.binding.requestSha256 = [digest('model-prompt-a')];
  assert.throws(() => evaluate(source, arrayHash), /Unsupported report binding/);
});

test('controlled swap preserves original image bytes/hashes and slot durations, proposes no defect label', async () => {
  const frames = await Promise.all(
    [20, 200].map(r =>
      sharp({ create: { width: 4, height: 4, channels: 4, background: { r, g: 50, b: 100, alpha: 1 } } })
        .png()
        .toBuffer(),
    ),
  );
  const images = Array.from({ length: 17 }, (_, i) => {
    const png = frames[i % 2];
    return {
      role: i === 0 ? 'reference' : 'candidate',
      sha256: digest(png),
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      ...(i ? { durationMs: 70 + i } : {}),
    };
  });
  const request = { stage: 'sequence', scope: 'walk', images },
    raw = Buffer.from(JSON.stringify(request));
  const before = Buffer.from(raw),
    pair = await swappedPair(raw, 0, 1),
    variant = JSON.parse(pair.variantBytes);
  assert.deepEqual(raw, before);
  assert.deepEqual(variant.images[0], images[0]);
  assert.equal(variant.images[1].dataUrl, images[2].dataUrl);
  assert.equal(variant.images[1].sha256, images[2].sha256);
  assert.deepEqual(
    variant.images.map(i => i.durationMs),
    images.map(i => i.durationMs),
  );
  assert.equal(pair.provenance.sourceRequestSha256, digest(raw));
  assert.equal(pair.provenance.variantRequestSha256, digest(pair.variantBytes));
  assert.equal(pair.provenance.sourceGroup, evidenceDigest(pair.provenance.originalEvidence));
  assert.equal(pair.provenance.proposedFaultOnly, true);
  assert.equal(pair.provenance.labels, null);
  assert.deepEqual(variant.images.slice(3), images.slice(3));
  await assert.rejects(swappedPair(raw, 0, 0), /distinct/);
  await assert.rejects(swappedPair(raw, 0, 16), /distinct/);
  await assert.rejects(swappedPair(raw, 0, 2), /identical bytes/);
  const tampered = clone(request);
  tampered.images[1].sha256 = digest('wrong');
  await assert.rejects(swappedPair(Buffer.from(JSON.stringify(tampered)), 0, 1));
});

test('offline CLI demo and evaluation run without credentials and refuse overwrites', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'animation-review-eval-'));
  const script = path.resolve('scripts/animation-review-eval.mjs'),
    demo = path.join(directory, 'demo');
  const run = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: '' } });
  try {
    const made = run(['demo', demo]);
    assert.equal(made.status, 0, made.stderr);
    assert.match(made.stdout, /SYNTHETIC/);
    const labels = path.join(demo, 'labels.json'),
      results = path.join(demo, 'results.json'),
      output = path.join(directory, 'evaluation.json');
    const analyzed = run(['evaluate', labels, results, output, '0.8']);
    assert.equal(analyzed.status, 0, analyzed.stderr);
    const saved = JSON.parse(await readFile(output));
    assert.equal(saved.mechanicsOnly, true);
    assert.equal(saved.labeledCases, 4);
    assert.equal(continuity(saved, 'held-out').falseClear, 1);
    assert.equal(saved.inputFiles.labelsSha256, digest(await readFile(labels)));
    const originalOutput = await readFile(output);
    assert.equal(run(['evaluate', labels, results, output]).status, 1);
    assert.deepEqual(await readFile(output), originalOutput);
    assert.equal(run(['demo', demo]).status, 1);
    const pair = path.join(directory, 'pair');
    const swapped = run(['swap', path.join(demo, 'calibration.request.json'), '4', '9', pair]);
    assert.equal(swapped.status, 0, swapped.stderr);
    assert.deepEqual(await readFile(path.join(pair, 'original.request.json')), await readFile(path.join(demo, 'calibration.request.json')));
    assert.equal(run(['swap', path.join(demo, 'calibration.request.json'), '0', '0', path.join(directory, 'invalid')]).status, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
