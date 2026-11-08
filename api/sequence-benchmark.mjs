// @ts-check
// Fixed, label-free research presentations. Not a production acceptance policy.
import { Problem, sha256 } from './http.mjs';

/**
 * An operator-enrolled sequence benchmark: the presentation it uses, bound to the frozen plan it belongs to.
 * @typedef {{ method: string, planSha256: string }} SequenceConfig
 */

export const SEQUENCE_METHODS = Object.freeze(['ordered-native-v1', 'timeline-loop-native-v1']);
export const PAIRED_SEQUENCE_METHOD = 'paired-native-v1';
/**
 * A research request's body. It was 32 MiB: a request holds about seven times its body while it is read, decoded, presented and sent
 * (measured 2026-10-30: 28 MiB took 185–220 MiB more), so one near that limit could pass the Edge isolate's 256 MB — the pilot's 49-frame
 * request already stopped once at WORKER_RESOURCE_LIMIT. 16 MiB keeps about half the isolate free and twice production's 8 MiB. A plan is
 * frozen against this bound too (`scripts/animation-review-plan.mjs`), so an entry over it is refused before enrollment or a paid call.
 */
export const BENCHMARK_BODY_BYTES = 16 * 1024 * 1024;
export const BENCHMARK_TIMEOUT_MS = 110_000;
export const SEQUENCE_RULES =
  '\nReview the complete original sequence in its supplied order and timing before answering each question. ' +
  'Trace visible body/foot identity through every adjacent pair, including the last-to-first transition. ' +
  'Use the timeline and transition table to locate evidence, not as proof of motion quality. ' +
  'The repeated last/first panel shows the same original pixels, not additional observations or extra playback frames. ' +
  'Distinguish intended cyclic displacement from unexplained jumps; do not assume foot identity or ground contact when hidden. ' +
  'Consider the whole loop rather than judging isolated attractive poses. Use unverified when the still sequence cannot establish the criterion.';
/** @type {(value: unknown) => boolean} */
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
/**
 * @param {any} value  A case intent's sequenceBenchmark: operator-written JSON, checked here.
 * @returns {SequenceConfig}
 */
export function sequenceConfig(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'method,planSha256' ||
    ![...SEQUENCE_METHODS, PAIRED_SEQUENCE_METHOD].includes(value.method) ||
    !hash(value.planSha256)
  )
    throw new Problem(422, 'invalid-benchmark-config');
  return value;
}
/**
 * @param {import('./decisions-review.mjs').Evidence} evidence
 * @param {SequenceConfig} config
 */
export async function sequencePresentation(evidence, config) {
  sequenceConfig(config);
  if (!SEQUENCE_METHODS.includes(config.method)) throw new Problem(422, 'invalid-benchmark-config');
  const frames = evidence.binding.filter(image => image.role === 'candidate');
  if (evidence.stage !== 'sequence' || frames.length < 2 || frames.length > 64) throw new Problem(422, 'invalid-benchmark-config');
  let elapsed = 0;
  const timeline = frames.map(frame => {
    const startMs = elapsed;
    elapsed += frame.durationMs;
    return { index: frame.index, sha256: frame.sha256, startMs, endMs: elapsed, durationMs: frame.durationMs };
  });
  const mapping = {
    version: 1,
    method: config.method,
    originalFrameCount: frames.length,
    originalImages: evidence.binding,
    loopDurationMs: elapsed,
    ...(config.method === 'timeline-loop-native-v1'
      ? {
          timeline,
          transitions: frames.map((frame, index) => ({
            from: frame.index,
            to: (index + 1) % frames.length,
            atMs: timeline[index].endMs,
            loopSeam: index === frames.length - 1,
          })),
          repeatedPanel: {
            kind: 'last-to-first-original-pixels',
            indices: [frames.length - 1, 0],
            sha256: [/** @type {import('./decisions-review.mjs').CandidateImage} */ (frames.at(-1)).sha256, frames[0].sha256],
            resampled: false,
          },
        }
      : {}),
  };
  const presentationSha256 = await sha256(new TextEncoder().encode(JSON.stringify(mapping)));
  const sourceEvidenceSha256 = await sha256(
    new TextEncoder().encode(JSON.stringify({ stage: evidence.stage, scope: evidence.scope, images: evidence.binding })),
  );
  let content = evidence.content,
    rules = '';
  if (config.method === 'timeline-loop-native-v1') {
    /** @type {(index: number) => import('./decisions-review.mjs').ContentPart} */
    const source = index => {
      const offset = evidence.binding.findIndex(image => image.role === 'candidate' && image.index === index);
      return evidence.content[offset * 2 + 1];
    };
    rules = SEQUENCE_RULES;
    content = [
      { type: 'input_json', data: { presentationMappingNotObservations: mapping } },
      ...content,
      { type: 'input_json', data: { repeatedLoopSeamPanel: mapping.repeatedPanel } },
      { type: 'input_json', data: { originalCandidateIndex: frames.length - 1 } },
      source(frames.length - 1),
      { type: 'input_json', data: { originalCandidateIndex: 0 } },
      source(0),
    ];
  }
  return {
    content,
    rules,
    mapping,
    binding: {
      version: 1,
      evidencePolicy: 'native-2-64-v1',
      timeoutMs: BENCHMARK_TIMEOUT_MS,
      method: config.method,
      planSha256: config.planSha256,
      sourceEvidenceSha256,
      presentationSha256,
    },
  };
}
