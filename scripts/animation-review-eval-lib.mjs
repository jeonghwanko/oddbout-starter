// @ts-check
// Offline analysis only. Never dispatches review/generation or changes approval policy.
import { createHash } from 'node:crypto';
import { reviewEvidence, questions, gaitCount } from '../api/decisions-review.mjs';
import { RESPONSE_REVIEW } from '../api/responses-benchmark.mjs';
import { SEQUENCE_METHODS, PAIRED_SEQUENCE_METHOD, BENCHMARK_TIMEOUT_MS } from '../api/sequence-benchmark.mjs';
import { validateComparisonPlan } from './animation-review-plan.mjs';

/**
 * @typedef {import('../api/decisions-review.mjs').Choice} Choice
 * @typedef {import('../api/decisions-review.mjs').Check & { unavailable?: boolean }} SavedCheck  A report's answer, or a stand-in for a missing one.
 * @typedef {{ id: string, sourceGroup: string, split: 'calibration' | 'held-out', evidence: { stage: 'sequence', scope: 'walk' | 'run', images: object[] },
 *   labels: Record<string, Choice>, evidenceSha256: string }} LabeledCase
 * @typedef {ReturnType<typeof checkedReport>} Row
 * @typedef {{ info: Row['cohort'], luna: boolean, rows: Map<string, Row> }} Cohort
 */

const HEX = /^[a-f0-9]{64}$/;
const VALUES = ['clear', 'defect', 'unverified'];
const NAMES = questions('sequence').map(q => q.name);
/** @type {(message: string) => never} */
const fail = message => {
  throw new Error(message);
};
/** @type {(value: any) => boolean} */
const object = value => value && typeof value === 'object' && !Array.isArray(value);
/** @type {(value: any, keys: readonly string[]) => boolean} */
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
/** @type {(n: unknown) => boolean} */
const unit = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
/** @type {(value: unknown) => boolean} */
const hash = value => typeof value === 'string' && HEX.test(value);
/** @type {(value: unknown, max: number) => boolean} */
const identifier = (value, max) => typeof value === 'string' && value.length <= max && /^[a-zA-Z0-9_-]+$/.test(value);
/** @type {(bytes: string | Uint8Array) => string} */
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// This is the image-evidence identity, NOT the server prompt/request fingerprint.
// Normalize key order while retaining image order, reference, dimensions and timing.
/** @param {any} value  Parsed JSON, checked here. @param {{ native?: boolean }} [options] */
export function canonicalEvidence(value, { native = false } = {}) {
  if (!exact(value, ['stage', 'scope', 'images']) || value.stage !== 'sequence' || !['walk', 'run'].includes(value.scope) || !Array.isArray(value.images))
    fail('Expected sequence evidence');
  let candidates = 0,
    references = 0;
  const images = /** @type {any[]} */ (value.images).map(image => {
    if (!object(image) || !['candidate', 'reference'].includes(image.role)) fail('Invalid image binding');
    const candidate = image.role === 'candidate';
    const keys = ['role', 'sha256', 'width', 'height', ...(candidate ? ['index', 'durationMs'] : [])];
    if (
      !exact(image, keys) ||
      !hash(image.sha256) ||
      ![image.width, image.height].every(n => Number.isInteger(n) && n >= 1 && n <= 2048) ||
      (candidate && (image.index !== candidates || !Number.isInteger(image.durationMs) || image.durationMs < 1 || image.durationMs > 10_000))
    )
      fail('Invalid image binding');
    if (candidate) candidates++;
    else references++;
    return Object.fromEntries(keys.map(k => [k, image[k]]));
  });
  if (references !== 1 || (native ? candidates < 2 || candidates > 64 : !gaitCount(value.scope, candidates))) fail('Wrong sequence image count');
  return { stage: value.stage, scope: value.scope, images };
}
/** @type {(value: any, options?: { native?: boolean }) => string} */
export const evidenceDigest = (value, options) => digest(JSON.stringify(canonicalEvidence(value, options)));

/** @param {any} manifest  Parsed labels JSON, checked here. @returns {LabeledCase[]} */
export function validateLabels(manifest) {
  const native = manifest?.version === 2;
  if (
    !exact(manifest, ['version', 'provenance', 'cases', ...(native ? ['evidencePolicy'] : [])]) ||
    ![1, 2].includes(manifest.version) ||
    (native && manifest.evidencePolicy !== 'native-2-64-v1') ||
    !exact(manifest.provenance, ['method', 'reviewer', 'recordedAt']) ||
    !['human-independent', 'synthetic-demo'].includes(manifest.provenance.method) ||
    !identifier(manifest.provenance.reviewer, 64) ||
    typeof manifest.provenance.recordedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(manifest.provenance.recordedAt) ||
    !Number.isFinite(Date.parse(manifest.provenance.recordedAt)) ||
    new Date(manifest.provenance.recordedAt).toISOString() !== manifest.provenance.recordedAt ||
    !Array.isArray(manifest.cases) ||
    !manifest.cases.length ||
    manifest.cases.length > 1000
  )
    fail('Invalid labels manifest');
  const ids = new Set(),
    bindings = new Set(),
    groups = new Map(),
    inventories = new Map();
  return /** @type {any[]} */ (manifest.cases).map(entry => {
    if (
      !exact(entry, ['id', 'sourceGroup', 'split', 'evidence', 'labels']) ||
      !identifier(entry.id, 80) ||
      ids.has(entry.id) ||
      !hash(entry.sourceGroup) ||
      !['calibration', 'held-out'].includes(entry.split) ||
      !exact(entry.labels, NAMES) ||
      Object.values(entry.labels).some(v => !VALUES.includes(v))
    )
      fail('Invalid or duplicate labeled case');
    const evidenceSha256 = evidenceDigest(entry.evidence, { native });
    if (bindings.has(evidenceSha256)) fail('Duplicate labeled evidence');
    if (groups.has(entry.sourceGroup) && groups.get(entry.sourceGroup) !== entry.split) fail('Source family crosses calibration/held-out split');
    // Catch undeclared frame permutations/time variants even if sourceGroup was assigned incorrectly.
    // A shared reference alone does not group unrelated candidate sequences.
    const inventory = digest(
      JSON.stringify(
        canonicalEvidence(entry.evidence, { native })
          .images.map(({ role, sha256, width, height }) => JSON.stringify({ role, sha256, width, height }))
          .sort(),
      ),
    );
    if (inventories.has(inventory) && inventories.get(inventory) !== entry.split) fail('Same image inventory crosses calibration/held-out split');
    inventories.set(inventory, entry.split);
    ids.add(entry.id);
    bindings.add(evidenceSha256);
    groups.set(entry.sourceGroup, entry.split);
    return { ...entry, evidenceSha256 };
  });
}

/** @param {any} report  A saved report: parsed JSON, checked here. @param {string} [transport] */
function checkedReport(report, transport = 'standalone') {
  if (!object(report) || !['completed', 'unverified', 'request_started'].includes(report.status) || !object(report.binding)) fail('Invalid saved report');
  const b = report.binding;
  if (!hash(b.requestSha256) || b.rubric !== 'hosted-sprite-v1') fail('Unsupported report binding/rubric');
  const luna = b.model === 'gpt-6-luna';
  const research = b.sequenceBenchmark;
  if (
    research !== undefined &&
    (!luna ||
      !exact(research, ['version', 'evidencePolicy', 'timeoutMs', 'method', 'planSha256', 'sourceEvidenceSha256', 'presentationSha256']) ||
      research.version !== 1 ||
      research.evidencePolicy !== 'native-2-64-v1' ||
      research.timeoutMs !== BENCHMARK_TIMEOUT_MS ||
      !SEQUENCE_METHODS.includes(research.method) ||
      ![research.planSha256, research.sourceEvidenceSha256, research.presentationSha256].every(hash) ||
      b.threshold !== 0.8 ||
      b.policy !== undefined)
  )
    fail('Invalid native benchmark binding');
  if (
    luna
      ? b.adapter !== undefined || !unit(b.threshold)
      : !['gpt-6.1-sol', 'gpt-6-astra'].includes(b.model) ||
        b.adapter !== 'responses-choice-v1' ||
        b.confidenceType !== 'not-available' ||
        b.reasoning !== RESPONSE_REVIEW.reasoning ||
        b.maxOutputTokens !== RESPONSE_REVIEW.maxOutputTokens
  )
    fail('Unsupported report model/adapter/configuration');
  const names = luna ? NAMES : b.questionNames;
  if (!Array.isArray(names) || !names.length || new Set(names).size !== names.length || names.some(n => !NAMES.includes(n))) fail('Invalid report questions');
  if (b.policy !== undefined && (b.policy !== 'luna-sol-v1' || b.model !== 'gpt-6.1-sol' || !hash(b.parentRequestSha256))) fail('Invalid followup policy');
  const evidence = canonicalEvidence({ stage: report.stage, scope: report.scope, images: b.images }, { native: research !== undefined });
  const sourceEvidenceSha256 = evidenceDigest(evidence, { native: research !== undefined });
  if (research && research.sourceEvidenceSha256 !== sourceEvidenceSha256) fail('Native source evidence mismatch');
  if (report.checks !== undefined && (!object(report.checks) || Object.keys(report.checks).some(n => !names.includes(n)))) fail('Unexpected report checks');
  /** @type {Record<string, SavedCheck>} */
  const checks = {};
  for (const name of names) {
    const c = report.checks?.[name];
    if (report.status !== 'completed' || c === undefined) {
      checks[name] = { status: 'unverified', unavailable: true };
      continue;
    }
    if (!object(c) || !VALUES.includes(c.status)) fail('Invalid saved check');
    if (luna && c.choice === undefined) {
      if (c.status !== 'unverified' || c.reason !== 'refusal') fail('Missing Decisions answer');
      checks[name] = { status: 'unverified' };
      continue;
    }
    if (!VALUES.includes(c.choice)) fail('Invalid saved choice');
    if (luna) {
      if (
        !unit(c.confidence) ||
        !exact(c.probabilities, VALUES) ||
        !Object.values(c.probabilities).every(unit) ||
        Math.abs(Object.values(c.probabilities).reduce((a, n) => a + n, 0) - 1) > 0.0001
      )
        fail('Invalid saved probabilities');
      if (c.status !== gated(c, b.threshold)) fail('Recorded status contradicts its bound threshold');
    } else if (
      c.status !== c.choice ||
      typeof c.reason !== 'string' ||
      c.reason.length > 400 ||
      !Array.isArray(c.frames) ||
      c.frames.length > evidence.images.length - 1 ||
      new Set(c.frames).size !== c.frames.length ||
      /** @type {any[]} */ (c.frames).some(n => !Number.isInteger(n) || n < 0 || n >= evidence.images.length - 1)
    )
      fail('Invalid Responses answer');
    checks[name] = c;
  }
  const cohort = {
    model: b.model,
    adapter: luna ? 'decisions' : b.adapter,
    rubric: b.rubric,
    ...(research ? { method: research.method, evidencePolicy: research.evidencePolicy, planSha256: research.planSha256, transport } : {}),
    policy: b.policy ?? 'standalone',
    questionNames: NAMES.filter(n => names.includes(n)),
    ...(luna ? { recordedThreshold: b.threshold } : { reasoning: b.reasoning, maxOutputTokens: b.maxOutputTokens }),
  };
  return { report, checks, luna, cohort, evidenceSha256: sourceEvidenceSha256 };
}
/** @param {any} report  A saved report: parsed JSON. */
function unpackPaired(report) {
  const b = report.binding,
    p = b?.sequenceBenchmark;
  if (p?.method !== PAIRED_SEQUENCE_METHOD) return [{ report, transport: 'standalone' }];
  if (
    !exact(p, ['version', 'evidencePolicy', 'timeoutMs', 'method', 'planSha256', 'sourceEvidenceSha256', 'arms']) ||
    p.version !== 1 ||
    p.evidencePolicy !== 'native-2-64-v1' ||
    !hash(p.planSha256) ||
    !hash(p.sourceEvidenceSha256) ||
    !exact(p.arms, SEQUENCE_METHODS) ||
    report.followup !== undefined ||
    (report.checks !== undefined &&
      (!object(report.checks) || Object.keys(report.checks).some(n => ![...NAMES, ...NAMES.map(n => `improved_${n}`)].includes(n))))
  )
    fail('Invalid paired report');
  return SEQUENCE_METHODS.map((method, index) => {
    const arm = p.arms[method],
      expectedNames = NAMES.map(n => (index ? `improved_${n}` : n));
    if (
      !exact(arm, ['presentationSha256', 'questionNames']) ||
      !hash(arm.presentationSha256) ||
      JSON.stringify(arm.questionNames) !== JSON.stringify(expectedNames)
    )
      fail('Invalid paired question mapping');
    return {
      transport: 'paired-independent-questions-v1',
      report: {
        ...report,
        binding: {
          ...b,
          sequenceBenchmark: {
            version: p.version,
            evidencePolicy: p.evidencePolicy,
            timeoutMs: p.timeoutMs,
            method,
            planSha256: p.planSha256,
            sourceEvidenceSha256: p.sourceEvidenceSha256,
            presentationSha256: arm.presentationSha256,
          },
        },
        checks: Object.fromEntries(
          NAMES.flatMap((name, i) => (report.checks?.[expectedNames[i]] === undefined ? [] : [[name, report.checks[expectedNames[i]]]])),
        ),
      },
    };
  });
}
/** @type {(check: SavedCheck, cutoff: number) => Choice} A missing score compares false. */
const gated = (check, cutoff) =>
  check.choice && /** @type {number} */ (check.confidence) >= cutoff && /** @type {number} */ (check.probabilities?.[check.choice]) >= cutoff
    ? check.choice
    : 'unverified';
/** @type {(n: number, d: number) => number | null} */
const ratio = (n, d) => (d ? n / d : null);
function emptyMetric() {
  return {
    expectedCases: 0,
    attempted: 0,
    notAttempted: 0,
    unavailable: 0,
    confusion: Object.fromEntries(VALUES.map(label => [label, Object.fromEntries(VALUES.map(prediction => [prediction, 0]))])),
  };
}
/** @param {ReturnType<typeof emptyMetric>} m */
function finishMetric(m) {
  const c = m.confusion,
    defects = Object.values(c.defect).reduce((a, n) => a + n, 0),
    clean = Object.values(c.clear).reduce((a, n) => a + n, 0);
  const abstentions = c.clear.unverified + c.defect.unverified + c.unverified.unverified;
  const correct = c.clear.clear + c.defect.defect;
  return {
    ...m,
    falseClear: c.defect.clear,
    falseReject: c.clear.defect,
    detectedDefects: c.defect.defect,
    defectAbstentions: c.defect.unverified,
    labeledDefectAttempts: defects,
    labeledCleanAttempts: clean,
    humanUnverifiedAttempts: Object.values(c.unverified).reduce((a, n) => a + n, 0),
    abstentions,
    definitiveHumanCorrect: correct,
    definitiveHumanAccuracy: ratio(correct, defects + clean),
    resolvedPredictions: m.attempted - abstentions,
    resolvedCoverage: ratio(m.attempted - abstentions, m.attempted),
    coverage: ratio(m.attempted, m.expectedCases),
    falseClearRate: ratio(c.defect.clear, defects),
    falseRejectRate: ratio(c.clear.defect, clean),
    defectRecall: ratio(c.defect.defect, defects),
    abstentionRate: ratio(abstentions, m.attempted),
  };
}
/**
 * @param {LabeledCase[]} cases @param {Map<string, Row>} rows @param {readonly string[]} names
 * @param {'recorded' | 'raw-choice' | 'frozen-cutoff'} view @param {number} [cutoff]  frozen-cutoff only
 */
function metrics(cases, rows, names, view, cutoff) {
  const byQuestion = Object.fromEntries(names.map(n => [n, emptyMetric()])),
    total = emptyMetric();
  for (const entry of cases) {
    const row = rows.get(entry.evidenceSha256);
    for (const name of names)
      for (const m of [byQuestion[name], total]) {
        m.expectedCases++;
        if (!row) {
          m.notAttempted++;
          continue;
        }
        const check = row.checks[name];
        m.attempted++;
        if (check.unavailable) m.unavailable++;
        const prediction =
          view === 'raw-choice' ? (check.choice ?? 'unverified') : view === 'frozen-cutoff' ? gated(check, /** @type {number} */ (cutoff)) : check.status;
        m.confusion[entry.labels[name]][prediction]++;
      }
  }
  return { total: finishMetric(total), byQuestion: Object.fromEntries(Object.entries(byQuestion).map(([n, m]) => [n, finishMetric(m)])) };
}

/**
 * @param {any} manifest  Parsed labels JSON. @param {any} results  The runner's saved calls: parsed JSON, checked here.
 * @param {{ cutoff?: number | null, plan?: import('./animation-review-plan.mjs').ComparisonPlan | null }} [options]  The plan is checked by validateComparisonPlan.
 */
export function evaluate(manifest, results, { cutoff = null, plan = null } = {}) {
  const cases = validateLabels(manifest);
  if (plan !== null) {
    validateComparisonPlan(plan);
    if (manifest.version !== 2 || cases.length !== plan.cases.length) fail('Plan/label inventory mismatch');
    for (const entry of cases) {
      const frozen = plan.cases.find(c => c.id === entry.id);
      if (
        !frozen ||
        frozen.sourceEvidenceSha256 !== entry.evidenceSha256 ||
        frozen.sourceGroup !== entry.sourceGroup ||
        frozen.split !== entry.split ||
        frozen.frameCount !== entry.evidence.images.length - 1
      )
        fail('Plan/label source or split mismatch');
    }
    if (cutoff !== null && cutoff !== plan.protocol.threshold) fail('Frozen plan threshold mismatch');
  }
  if (cutoff !== null && !unit(cutoff)) fail('Cutoff must be a finite number in [0, 1]');
  if (!object(results) || !Array.isArray(results.calls) || results.calls.length > 5000) fail('Expected saved benchmark runner calls');
  const labels = new Map(cases.map(c => [c.evidenceSha256, c]));
  const cohorts = /** @type {Map<string, Cohort>} */ (new Map());
  let unboundCalls = 0;
  for (const call of results.calls) {
    if (!object(call) || !['response_received', 'request_started', 'transport_outcome_unknown'].includes(call.status)) fail('Invalid saved call');
    if (!call.report?.binding) {
      unboundCalls++;
      continue;
    }
    if (call.status !== 'response_received' || call.httpStatus !== 200) fail('Bound report contradicts call outcome');
    const reports = [call.report];
    if (call.report.followup) {
      const followup = call.report.followup;
      // Disabled/limit-skipped followups have no binding and are not model answers.
      if (followup.binding) {
        if (
          followup.binding.policy !== 'luna-sol-v1' ||
          followup.binding.parentRequestSha256 !== call.report.binding.requestSha256 ||
          evidenceDigest({ stage: followup.stage, scope: followup.scope, images: followup.binding.images }) !==
            evidenceDigest({ stage: call.report.stage, scope: call.report.scope, images: call.report.binding.images })
        )
          fail('Followup evidence/parent mismatch');
        reports.push(followup);
      }
    }
    for (const originalReport of reports)
      for (const { report, transport } of unpackPaired(originalReport)) {
        const row = checkedReport(report, transport);
        if (!labels.has(row.evidenceSha256)) fail('Report evidence has no matching independent labels');
        if (plan !== null) {
          const frozen = plan.cases.find(c => c.sourceEvidenceSha256 === row.evidenceSha256);
          const research = report.binding.sequenceBenchmark,
            method = frozen?.methods[row.cohort.method];
          if (
            !method ||
            research.planSha256 !== plan.planSha256 ||
            transport !== plan.protocol.transport ||
            method.requestSha256 !== report.binding.requestSha256 ||
            method.presentationSha256 !== research.presentationSha256 ||
            call.requestSha256 !== frozen.sourceRequestSha256
          )
            fail('Report does not match frozen plan');
        }
        const key = JSON.stringify(row.cohort);
        if (!cohorts.has(key)) cohorts.set(key, { info: row.cohort, luna: row.luna, rows: new Map() });
        const cohort = /** @type {Cohort} */ (cohorts.get(key)); // set above
        if (cohort.rows.has(row.evidenceSha256)) fail('Duplicate evidence within model cohort; evaluate repeated trials separately');
        cohort.rows.set(row.evidenceSha256, row);
      }
  }
  if (plan)
    for (const method of SEQUENCE_METHODS) {
      const info = {
        model: 'gpt-6-luna',
        adapter: 'decisions',
        rubric: 'hosted-sprite-v1',
        method,
        evidencePolicy: 'native-2-64-v1',
        planSha256: plan.planSha256,
        transport: plan.protocol.transport,
        policy: 'standalone',
        questionNames: NAMES,
        recordedThreshold: 0.8,
      };
      const key = JSON.stringify(info);
      if (!cohorts.has(key)) cohorts.set(key, { info, luna: true, rows: new Map() });
    }
  const output = [];
  for (const { info, luna, rows } of cohorts.values()) {
    /** @type {Record<string, object>} */
    const partitions = {};
    for (const split of ['calibration', 'held-out']) {
      const subset = cases.filter(c => c.split === split);
      partitions[split] = {
        labeledCases: subset.length,
        observedCases: subset.filter(c => rows.has(c.evidenceSha256)).length,
        recorded: metrics(subset, rows, info.questionNames, 'recorded'),
        ...(luna ? { rawChoice: metrics(subset, rows, info.questionNames, 'raw-choice') } : {}),
        ...(luna && cutoff !== null ? { frozenCutoff: { cutoff, ...metrics(subset, rows, info.questionNames, 'frozen-cutoff', cutoff) } } : {}),
      };
    }
    output.push({
      ...info,
      partitions,
      ...(luna && !info.method
        ? {
            calibrationSweep: Array.from({ length: 11 }, (_, i) => i / 10).map(t => ({
              cutoff: t,
              ...metrics(
                cases.filter(c => c.split === 'calibration'),
                rows,
                info.questionNames,
                'frozen-cutoff',
                t,
              ),
            })),
          }
        : {}),
    });
  }
  return {
    version: manifest.version,
    advisory: true,
    visualApproval: false,
    mechanicsOnly: manifest.provenance.method === 'synthetic-demo',
    provenance: manifest.provenance,
    labelsSha256: digest(JSON.stringify(manifest)),
    frozenCutoff: cutoff,
    labeledCases: cases.length,
    unboundCalls,
    cohorts: output,
    ...(plan
      ? {
          planSha256: plan.planSha256,
          sourceFamilies: new Set(cases.map(c => c.sourceGroup)).size,
          pairedComparison: comparePaired(cases, [...cohorts.values()]),
          sharedCalls: {
            recordedCalls: results.calls.length,
            completedCalls: /** @type {any[]} */ (results.calls).filter(c => c.report?.status === 'completed').length,
            perArmCost: null,
            perArmLatency: null,
            accounting: 'Shared paired requests; do not sum virtual cohort usage or infer per-arm cost/latency.',
          },
        }
      : {}),
    limitations: [
      'Human independence and source-family declarations require operator verification.',
      'Unbound calls cannot be assigned a model or evidence; inspect the server ledger, never retry automatically.',
      'Unverified human labels are excluded from defect/clean denominators; missing reports are not clean.',
      'Calibration sweep replays separate confidence and chosen-choice probability gates; it does not calibrate either score.',
      'No cutoff is selected automatically. Freeze the cutoff before inspecting held-out results.',
      'Cohorts with different question subsets or coverage are not an equal-case model comparison.',
      'Frame references are not transition localization; this evaluator does not score localization or approve artwork.',
    ],
  };
}

/** @param {LabeledCase[]} cases @param {Cohort[]} cohorts  Each method's, which evaluate adds for a plan. */
function comparePaired(cases, cohorts) {
  const baseline = /** @type {Cohort} */ (cohorts.find(c => c.info.method === SEQUENCE_METHODS[0])).rows;
  const improved = /** @type {Cohort} */ (cohorts.find(c => c.info.method === SEQUENCE_METHODS[1])).rows;
  /** @type {Record<string, object>} */
  const partitions = {};
  for (const split of ['calibration', 'held-out']) {
    const expected = cases.filter(c => c.split === split),
      matched = expected.filter(c => baseline.has(c.evidenceSha256) && improved.has(c.evidenceSha256));
    /** @param {string[]} names */
    const transitions = names => {
      const counts = {
        expectedJudgments: expected.length * names.length,
        matchedJudgments: matched.length * names.length,
        humanUnverified: 0,
        humanDefinitive: 0,
        bothResolved: 0,
        baselineUnavailable: 0,
        improvedUnavailable: 0,
        baselineCorrectOnly: 0,
        improvedCorrectOnly: 0,
        bothCorrect: 0,
        neitherCorrect: 0,
        predictionTransitions: Object.fromEntries(VALUES.map(v => [v, Object.fromEntries(VALUES.map(w => [w, 0]))])),
      };
      for (const entry of matched)
        for (const name of names) {
          const a = /** @type {Row} */ (baseline.get(entry.evidenceSha256)).checks[name],
            b = /** @type {Row} */ (improved.get(entry.evidenceSha256)).checks[name],
            human = entry.labels[name];
          counts.predictionTransitions[a.status][b.status]++;
          if (a.unavailable) counts.baselineUnavailable++;
          if (b.unavailable) counts.improvedUnavailable++;
          if (human === 'unverified') {
            counts.humanUnverified++;
            continue;
          }
          counts.humanDefinitive++;
          if (a.status !== 'unverified' && b.status !== 'unverified') counts.bothResolved++;
          if (a.status === human && b.status === human) counts.bothCorrect++;
          else if (a.status === human) counts.baselineCorrectOnly++;
          else if (b.status === human) counts.improvedCorrectOnly++;
          else counts.neitherCorrect++;
        }
      return counts;
    };
    const a = metrics(matched, baseline, NAMES, 'recorded'),
      b = metrics(matched, improved, NAMES, 'recorded');
    partitions[split] = {
      expectedCases: expected.length,
      matchedCases: matched.length,
      pairedCoverage: ratio(matched.length, expected.length),
      sourceFamilies: new Set(expected.map(c => c.sourceGroup)).size,
      baseline: a,
      improved: b,
      deltaImprovedMinusBaseline: Object.fromEntries(
        /** @type {const} */ (['falseClearRate', 'falseRejectRate', 'defectRecall', 'abstentionRate', 'definitiveHumanAccuracy', 'resolvedCoverage']).map(
          key => [key, a.total[key] === null || b.total[key] === null ? null : b.total[key] - a.total[key]],
        ),
      ),
      total: transitions(NAMES),
      byQuestion: Object.fromEntries(NAMES.map(name => [name, transitions([name])])),
    };
  }
  return {
    methods: SEQUENCE_METHODS,
    view: 'recorded-0.8-gate',
    partitions,
    limitations: [
      'Descriptive matched judgments only; correlated clips within a source family are not independent trials.',
      'Human-unverified labels are separate; model abstentions and unavailable results are not clean.',
      'No statistical significance or guaranteed improvement is claimed; report unchanged/worse results without tuning.',
    ],
  };
}

/** @param {Uint8Array} raw  A sequence review request's bytes. @param {number} a @param {number} b */
export async function swappedPair(raw, a, b) {
  if (!(raw instanceof Uint8Array) || raw.byteLength > 8 * 1024 * 1024) fail('Request must be at most 8 MiB');
  const request = JSON.parse(Buffer.from(raw).toString('utf8'));
  const original = await reviewEvidence(request);
  if (original.stage !== 'sequence') fail('Swap requires sequence evidence');
  const slots = /** @type {any[]} */ (request.images).flatMap((image, index) => (image.role === 'candidate' ? [index] : []));
  if (![a, b].every(n => Number.isSafeInteger(n) && n >= 0 && n < slots.length) || a === b) fail('Two distinct zero-based candidate indices required');
  const variant = structuredClone(request),
    x = slots[a],
    y = slots[b];
  if (request.images[x].sha256 === request.images[y].sha256) fail('Selected frames have identical bytes');
  // Swap pixels only. Each playback slot retains its original duration.
  variant.images[x] = { ...request.images[y], durationMs: request.images[x].durationMs };
  variant.images[y] = { ...request.images[x], durationMs: request.images[y].durationMs };
  const changed = await reviewEvidence(variant),
    variantBytes = Buffer.from(JSON.stringify(variant, null, 2) + '\n');
  const originalEvidence = canonicalEvidence({ stage: original.stage, scope: original.scope, images: original.binding });
  const variantEvidence = canonicalEvidence({ stage: changed.stage, scope: changed.scope, images: changed.binding });
  return {
    variantBytes,
    provenance: {
      version: 1,
      operation: 'swap-candidate-pixels-preserve-slot-durations',
      indices: [a, b],
      sourceRequestSha256: digest(raw),
      variantRequestSha256: digest(variantBytes),
      sourceGroup: evidenceDigest(originalEvidence),
      originalEvidence,
      variantEvidence,
      proposedFaultOnly: true,
      labels: null,
    },
  };
}
