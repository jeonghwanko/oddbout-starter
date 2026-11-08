// @ts-check
// Label-blind plan preparation only. No credentials, network, or enrollment.
import { createHash } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeSequenceEvidence, decisionsRequest, DECISIONS, RULES, questions } from '../api/decisions-review.mjs';
import { SEQUENCE_METHODS, SEQUENCE_RULES, PAIRED_SEQUENCE_METHOD, BENCHMARK_BODY_BYTES, BENCHMARK_TIMEOUT_MS } from '../api/sequence-benchmark.mjs';

/**
 * @typedef {{ id: string, sourceGroup: string, split: 'calibration' | 'held-out', sourceEvidenceSha256: string, sourceRequestSha256: string,
 *   frameCount: number, methods: Record<string, { requestSha256: string, presentationSha256: string }> }} PlanCase
 * @typedef {{ version: 1, protocol: typeof COMPARISON_PROTOCOL, cases: PlanCase[], planSha256: string }} ComparisonPlan
 */

/** @type {(bytes: string | Uint8Array) => string} */
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
/** @type {(value: any, names: readonly string[]) => boolean} */
const exact = (value, names) =>
  value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
/** @type {(value: unknown) => boolean} */
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = () => {
  throw Error('Invalid label-free comparison plan');
};
export const COMPARISON_PROTOCOL = Object.freeze({
  version: 1,
  evidencePolicy: 'native-2-64-v1',
  model: DECISIONS.model,
  endpoint: 'https://api.openai.com/v1/decisions',
  rubric: DECISIONS.rubric,
  threshold: DECISIONS.threshold,
  timeoutMs: BENCHMARK_TIMEOUT_MS,
  methods: SEQUENCE_METHODS,
  questions: questions('sequence'),
  rules: RULES,
  improvedRules: SEQUENCE_RULES,
  transport: 'paired-independent-questions-v1',
  enrollmentMethod: PAIRED_SEQUENCE_METHOD,
  performanceAccounting: 'shared-call-only-no-per-arm-cost-or-latency',
  retryPolicy: 'never-redispatch-unknown-outcome',
  tuningPolicy: 'candidate-authored-without-label-access-frozen-before-model-results-no-result-driven-tuning',
  blindingPolicy: 'candidate-authors-blinded-operator-may-have-seen-labels',
  comparison: 'paired-source-evidence-recorded-gate',
  sourceFamilyPolicy: 'preserve-declared-family-and-split',
});

/** @param {any} plan  Parsed JSON, checked here. @returns {ComparisonPlan} */
export function validateComparisonPlan(plan) {
  if (
    !exact(plan, ['version', 'protocol', 'cases', 'planSha256']) ||
    plan.version !== 1 ||
    JSON.stringify(plan.protocol) !== JSON.stringify(COMPARISON_PROTOCOL) ||
    !Array.isArray(plan.cases) ||
    !plan.cases.length ||
    plan.cases.length > 1000 ||
    !hash(plan.planSha256) ||
    digest(JSON.stringify({ version: plan.version, protocol: plan.protocol, cases: plan.cases })) !== plan.planSha256
  )
    fail();
  const ids = new Set(),
    sources = new Set(),
    families = new Map();
  for (const entry of plan.cases) {
    if (
      !exact(entry, ['id', 'sourceGroup', 'split', 'sourceEvidenceSha256', 'sourceRequestSha256', 'frameCount', 'methods']) ||
      typeof entry.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(entry.id) ||
      ids.has(entry.id) ||
      ![entry.sourceGroup, entry.sourceEvidenceSha256, entry.sourceRequestSha256].every(hash) ||
      sources.has(entry.sourceEvidenceSha256) ||
      !['calibration', 'held-out'].includes(entry.split) ||
      !Number.isInteger(entry.frameCount) ||
      entry.frameCount < 2 ||
      entry.frameCount > 64 ||
      !exact(entry.methods, SEQUENCE_METHODS)
    )
      fail();
    for (const method of SEQUENCE_METHODS) {
      const bound = entry.methods[method];
      if (!exact(bound, ['requestSha256', 'presentationSha256']) || !Object.values(bound).every(hash)) fail();
    }
    if (families.has(entry.sourceGroup) && families.get(entry.sourceGroup) !== entry.split) fail();
    ids.add(entry.id);
    sources.add(entry.sourceEvidenceSha256);
    families.set(entry.sourceGroup, entry.split);
  }
  return plan;
}

// entries contain ONLY source provenance, immutable original request bytes and design intent.
// Human labels/notes are deliberately absent from this API and its strict accepted keys.
/** @param {{ id: string, sourceGroup: string, split: string, raw: Uint8Array, intent: import('../api/decisions-review.mjs').ReviewJob }[]} entries  Checked here. */
export async function freezeComparison(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 1000) fail();
  const cases = [],
    inventories = new Map();
  for (const entry of entries) {
    if (
      !exact(entry, ['id', 'sourceGroup', 'split', 'raw', 'intent']) ||
      !(entry.raw instanceof Uint8Array) ||
      entry.raw.byteLength > BENCHMARK_BODY_BYTES ||
      !exact(entry.intent, ['description', 'brief', 'appearance_note', 'motion_note'])
    )
      fail();
    const evidence = await nativeSequenceEvidence(JSON.parse(Buffer.from(entry.raw).toString('utf8')));
    const inventory = digest(JSON.stringify(evidence.binding.map(({ role, sha256, width, height }) => JSON.stringify({ role, sha256, width, height })).sort()));
    if (inventories.has(inventory) && inventories.get(inventory) !== entry.split) fail();
    inventories.set(inventory, entry.split);
    /** @type {PlanCase['methods']} */
    const methods = {};
    const built = await decisionsRequest({ job: entry.intent, evidence, sequenceConfig: { method: PAIRED_SEQUENCE_METHOD, planSha256: '0'.repeat(64) } });
    const sourceEvidenceSha256 = /** @type {Record<string, any>} */ (built.binding.sequenceBenchmark).sourceEvidenceSha256; // paired: always bound
    for (const method of SEQUENCE_METHODS) {
      methods[method] = {
        requestSha256: built.binding.requestSha256,
        presentationSha256: /** @type {Record<string, any>} */ (built.binding.sequenceBenchmark).arms[method].presentationSha256,
      };
    }
    cases.push({
      id: entry.id,
      sourceGroup: entry.sourceGroup,
      split: entry.split,
      sourceEvidenceSha256,
      sourceRequestSha256: digest(entry.raw),
      frameCount: evidence.binding.length - 1,
      methods,
    });
  }
  const core = { version: 1, protocol: COMPARISON_PROTOCOL, cases };
  return validateComparisonPlan({ ...core, planSha256: digest(JSON.stringify(core)) });
}

/** @param {string[]} args */
export async function main(args) {
  const [selectionFile, output] = args;
  if (args.length !== 2) throw Error('Usage: animation-review-plan.mjs <label-free-selection.json> <new-plan.json>');
  if ((await stat(selectionFile)).size > 1024 * 1024) fail();
  const selection = JSON.parse(await readFile(selectionFile, 'utf8'));
  if (!exact(selection, ['version', 'cases']) || selection.version !== 1 || !Array.isArray(selection.cases)) fail();
  const entries = [];
  for (const entry of selection.cases) {
    if (!exact(entry, ['id', 'sourceGroup', 'split', 'request', 'requestSha256', 'intent']) || !hash(entry.requestSha256) || typeof entry.request !== 'string')
      fail();
    const filename = path.resolve(path.dirname(selectionFile), entry.request);
    if ((await stat(filename)).size > BENCHMARK_BODY_BYTES) fail();
    const raw = await readFile(filename);
    if (digest(raw) !== entry.requestSha256) fail();
    entries.push({ id: entry.id, sourceGroup: entry.sourceGroup, split: entry.split, raw, intent: entry.intent });
  }
  const plan = await freezeComparison(entries);
  await writeFile(output, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Frozen ${plan.cases.length} cases; plan SHA-256 ${plan.planSha256}. No model calls or labels read.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(() => {
    console.error('Unable to freeze comparison plan; check selection schema, original request hashes, and exclusive output path.');
    process.exitCode = 1;
  });
