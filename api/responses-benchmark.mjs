// @ts-check
// Shared Responses transport. Production uses the fixed Sol-only factory below;
// arbitrary comparison models remain restricted to operator-enrolled benchmarks.
import { Problem, readBody, rpcCaller, sha256 } from './http.mjs';
import { REVIEW_STATUS, RULES, questions } from './decisions-review.mjs';

/**
 * @typedef {import('./decisions-review.mjs').Evidence} Evidence
 * @typedef {import('./decisions-review.mjs').Stage} Stage
 * @typedef {import('./decisions-review.mjs').Question} Question
 * @typedef {import('./decisions-review.mjs').ReviewJob} ReviewJob
 * @typedef {import('./decisions-review.mjs').Check} Check
 * @typedef {import('./decisions-review.mjs').Usage} Usage
 */
/**
 * The model and questions a Responses review asks; a Sol follow-up also binds the policy and the Luna request it follows.
 * @typedef {{ model: string, questions: Question[], binding?: { policy: string, parentRequestSha256: string } }} Selection
 */
/**
 * What a Responses reviewer receives: the review arguments plus, for an enrolled benchmark, the operator's config, or for a
 * Sol follow-up, the stored Luna report it follows. Both are checked before use.
 * @typedef {import('./decisions-review.mjs').ReviewArgs & { config?: any, primary?: any }} ResponsesReviewArgs
 */

export const RESPONSE_MODELS = Object.freeze(['gpt-6.1-sol', 'gpt-6-astra']);
export const RESPONSE_REVIEW = Object.freeze({
  rubric: 'hosted-sprite-v1',
  adapter: 'responses-choice-v1',
  reasoning: 'medium',
  maxOutputTokens: 1800,
  timeoutMs: 110_000,
});
const OPTIONS = ['clear', 'defect', 'unverified'];
const invalid = () => {
  throw new Problem(422, 'invalid-benchmark-config');
};

/**
 * @param {any} config  A case intent's benchmarkReview: operator-written JSON, checked here.
 * @param {Stage} stage
 * @returns {Selection}
 */
export function benchmarkConfig(config, stage) {
  if (
    !config ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    Object.keys(config).some(k => !['model', 'questionNames'].includes(k)) ||
    !RESPONSE_MODELS.includes(config.model)
  )
    invalid();
  const all = questions(stage),
    names = config.questionNames;
  if (!Array.isArray(names) || !names.length || new Set(names).size !== names.length || names.some(name => !all.some(q => q.name === name))) invalid();
  // Sol is the full first comparison. Astra may answer the frozen difficult subset in original order.
  if (config.model === 'gpt-6.1-sol' && names.length !== all.length) invalid();
  return { model: config.model, questions: all.filter(q => names.includes(q.name)) };
}

/** @param {{ model: string, job: ReviewJob, evidence: Evidence, questionNames: string[] }} options */
export function responsesRequest({ model, job, evidence, questionNames }) {
  const selected = benchmarkConfig({ model, questionNames }, evidence.stage).questions;
  return buildRequest({ model, job, evidence, selected });
}
/** @param {{ model: string, job: ReviewJob, evidence: Evidence, selected: Question[] }} options */
function buildRequest({ model, job, evidence, selected }) {
  const frameCount = evidence.binding.filter(image => image.role === 'candidate').length;
  const intent = {
    description: job.description,
    brief: job.brief,
    appearanceNote: job.appearance_note ?? null,
    motionNote: job.motion_note ?? null,
    scope: evidence.scope,
    stage: evidence.stage,
  };
  const item = {
    type: 'object',
    properties: {
      choice: { type: 'string', enum: OPTIONS },
      reason: { type: 'string', maxLength: 400 },
      frames: { type: 'array', items: { type: 'integer', minimum: 0, maximum: Math.max(0, frameCount - 1) }, maxItems: frameCount },
    },
    required: ['choice', 'reason', 'frames'],
    additionalProperties: false,
  };
  // input_json is serialized without altering its data; images, order, detail and durations are unchanged.
  const content = [{ type: 'input_json', data: { designIntentNotObservations: intent } }, ...evidence.content].map(p =>
    p.type === 'input_json' ? { type: 'input_text', text: JSON.stringify(p.data) } : p,
  );
  return {
    model,
    store: false,
    service_tier: 'default',
    reasoning: { effort: RESPONSE_REVIEW.reasoning },
    max_output_tokens: RESPONSE_REVIEW.maxOutputTokens,
    input: [
      {
        role: 'developer',
        content:
          RULES +
          '\nAnswer exactly these questions using their choices. ' +
          'Give a short visible-evidence reason and relevant zero-based candidate frame indices (empty if none). ' +
          'Do not invent probabilities or confidence scores.\n' +
          JSON.stringify(selected),
      },
      { role: 'user', content },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'sprite_review',
        strict: true,
        schema: {
          type: 'object',
          properties: Object.fromEntries(selected.map(q => [q.name, item])),
          required: selected.map(q => q.name),
          additionalProperties: false,
        },
      },
    },
  };
}

/** @param {any} value  The provider's usage JSON, checked here. */
function usageOf(value) {
  if (!value || typeof value !== 'object') return null;
  /** @type {Usage} */
  const out = {};
  for (const name of /** @type {const} */ (['input_tokens', 'output_tokens', 'total_tokens']))
    if (Number.isSafeInteger(value[name]) && value[name] >= 0) out[name] = value[name];
  for (const [group, names] of /** @type {['input_tokens_details' | 'output_tokens_details', string[]][]} */ ([
    ['input_tokens_details', ['cached_tokens', 'cache_write_tokens']],
    ['output_tokens_details', ['reasoning_tokens']],
  ]))
    for (const name of names) if (Number.isSafeInteger(value[group]?.[name]) && value[group][name] >= 0) (out[group] ??= {})[name] = value[group][name];
  return Object.keys(out).length ? out : null;
}
// The requested model, or a dated snapshot of it: the Responses API answers with the snapshot it ran (`gpt-6.1-sol-2026-10-01`).
/** @type {(answered: unknown, model: string) => boolean} */
const sameModel = (answered, model) => typeof answered === 'string' && (answered === model || answered.startsWith(`${model}-`));
/**
 * @param {any} value  The provider's JSON, checked here.
 * @param {string} model
 * @param {string[]} names
 * @param {number} count  Candidate frames: answers may cite indices below it.
 * @returns {Record<string, Check>}
 */
function checksOf(value, model, names, count) {
  if (!sameModel(value.model, model) || value.status !== 'completed' || !Array.isArray(value.output)) throw Error('invalid-response');
  const parts = /** @type {any[]} */ (value.output).filter(o => o.type === 'message').flatMap(o => o.content ?? []);
  if (parts.length !== 1 || parts[0].type !== 'output_text') throw Error('invalid-response');
  const answers = JSON.parse(parts[0].text);
  if (!answers || Array.isArray(answers) || Object.keys(answers).length !== names.length) throw Error('invalid-response');
  /** @type {Record<string, Check>} */
  const checks = {};
  for (const name of names) {
    const a = answers[name];
    if (
      !a ||
      Object.keys(a).sort().join(',') !== 'choice,frames,reason' ||
      !OPTIONS.includes(a.choice) ||
      typeof a.reason !== 'string' ||
      a.reason.length > 400 ||
      a.reason.includes('\0') ||
      !a.reason.isWellFormed() ||
      !Array.isArray(a.frames) ||
      a.frames.length > count ||
      new Set(a.frames).size !== a.frames.length ||
      /** @type {any[]} */ (a.frames).some(n => !Number.isSafeInteger(n) || n < 0 || n >= count)
    )
      throw Error('invalid-response');
    checks[name] = { status: a.choice, choice: a.choice, reason: a.reason, frames: a.frames };
  }
  return checks;
}

/**
 * @param {{ apiKey?: string, enabled?: boolean, fetcher?: typeof fetch }} [options]
 * @returns {import('./http.mjs').Reviewer}
 */
export function createResponsesBenchmarkReviewer({ apiKey, enabled = false, fetcher = fetch } = {}) {
  return createReviewer({ apiKey, enabled, fetcher, select: ({ config, evidence }) => benchmarkConfig(config, evidence.stage) });
}

export const SOL_FOLLOWUP = Object.freeze({ model: 'gpt-6.1-sol', policy: 'luna-sol-v1', timeoutMs: 90_000 });
/**
 * @param {any} primary  The Luna report as stored, checked here before it selects anything.
 * @param {Evidence} evidence
 * @returns {Question[]}
 */
export function followupQuestions(primary, evidence) {
  // Only completed semantic judgments can trigger a second model. A transport failure,
  // unknown outcome or refusal is not evidence of a visual defect and is not retried.
  if (
    primary?.status !== 'completed' ||
    primary.binding?.model !== 'gpt-6-luna' ||
    !/^[a-f0-9]{64}$/.test(primary.binding.requestSha256 ?? '') ||
    primary.stage !== evidence.stage ||
    primary.scope !== evidence.scope ||
    !Array.isArray(primary.binding.images) ||
    primary.binding.images.length !== evidence.binding.length ||
    evidence.binding.some((image, index) => {
      const original = primary.binding.images[index];
      return (
        !original ||
        Object.keys(original).length !== Object.keys(image).length ||
        Object.keys(image).some(k => /** @type {Record<string, unknown>} */ (image)[k] !== original[k])
      );
    })
  )
    return [];
  return questions(evidence.stage).filter(
    q => ['unverified', 'defect'].includes(primary.checks?.[q.name]?.status) && OPTIONS.includes(primary.checks[q.name].choice),
  );
}
/**
 * @param {{ apiKey?: string, enabled?: boolean, fetcher?: typeof fetch }} [options]
 * @returns {import('./http.mjs').Reviewer}
 */
export function createSolFollowupReviewer(options = {}) {
  return createReviewer({
    ...options,
    timeoutMs: SOL_FOLLOWUP.timeoutMs,
    select: ({ primary, evidence }) => {
      const selected = followupQuestions(primary, evidence);
      if (!selected.length) throw new Problem(422, 'invalid-followup');
      return { model: SOL_FOLLOWUP.model, questions: selected, binding: { policy: SOL_FOLLOWUP.policy, parentRequestSha256: primary.binding.requestSha256 } };
    },
  });
}

/**
 * @param {{ apiKey?: string, enabled?: boolean, fetcher?: typeof fetch,
 *   select: (context: { config?: any, evidence: Evidence, primary?: any }) => Selection, timeoutMs?: number }} options
 * @returns {import('./http.mjs').Reviewer}
 */
function createReviewer({ apiKey, enabled = false, fetcher = fetch, select, timeoutMs = RESPONSE_REVIEW.timeoutMs }) {
  const active = enabled === true && typeof apiKey === 'string' && apiKey.trim().length > 0;
  return {
    enabled: active,
    /** @param {ResponsesReviewArgs} args */
    async review({ db, job, host, lease, evidence, config, primary }) {
      if (!active) return { mode: 'off', status: 'disabled', advisory: true, visualApproval: false };
      const selected = select({ config, evidence, primary }),
        names = selected.questions.map(q => q.name);
      const request = buildRequest({ model: selected.model, job, evidence, selected: selected.questions });
      const raw = JSON.stringify(request),
        requestSha256 = await sha256(new TextEncoder().encode(raw));
      const binding = {
        images: evidence.binding,
        requestSha256,
        model: selected.model,
        rubric: RESPONSE_REVIEW.rubric,
        adapter: RESPONSE_REVIEW.adapter,
        questionNames: names,
        reasoning: RESPONSE_REVIEW.reasoning,
        maxOutputTokens: RESPONSE_REVIEW.maxOutputTokens,
        confidenceType: 'not-available',
        approvalGate: false,
        ...selected.binding,
      };
      const fingerprint = selected.binding ? await sha256(new TextEncoder().encode(JSON.stringify({ requestSha256, ...selected.binding }))) : requestSha256;
      const rpc = rpcCaller(db, REVIEW_STATUS, { contains: true, unavailable: 'review-store-unavailable' });
      const claimed = await rpc('af_decision_review_start', {
        p_job: job.id,
        p_host: host,
        p_lease: lease,
        p_fingerprint: fingerprint,
        p_stage: evidence.stage,
        p_scope: evidence.scope,
        p_binding: binding,
      });
      if (!claimed.started) {
        // Benchmark cases are one-shot even if an operator later edits their config.
        // Never present a previously consumed Luna/different request as a Sol answer.
        if (
          claimed.report?.binding?.requestSha256 !== requestSha256 ||
          claimed.report.binding.model !== selected.model ||
          claimed.report.binding.parentRequestSha256 !== binding.parentRequestSha256
        )
          throw new Problem(409, 'review-binding-changed');
        return claimed.report;
      }
      const start = performance.now();
      let requestId = /** @type {string | null} */ (null),
        providerHttpStatus = /** @type {number | null} */ (null),
        usage = /** @type {Usage | null} */ (null),
        report;
      try {
        const response = await fetcher('https://api.openai.com/v1/responses', {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: raw,
        });
        providerHttpStatus = response.status;
        const rid = response.headers.get('x-request-id');
        requestId = /^req_[A-Za-z0-9_-]{1,120}$/.test(rid ?? '') ? rid : null;
        if (!response.ok) {
          await response.body?.cancel();
          throw Error('provider-refused');
        }
        const value = JSON.parse(new TextDecoder().decode(await readBody(response, 128 * 1024)));
        usage = usageOf(value.usage);
        report = { status: 'completed', checks: checksOf(value, selected.model, names, evidence.binding.filter(x => x.role === 'candidate').length) };
      } catch {
        report = {
          status: 'unverified',
          errorCode: 'provider-outcome-unverified',
          checks: Object.fromEntries(names.map(name => [name, { status: 'unverified' }])),
        };
      }
      return rpc('af_decision_review_finish', {
        p_id: claimed.id,
        p_report: { ...claimed.report, ...report, requestId, providerHttpStatus, usage, elapsedSeconds: (performance.now() - start) / 1000 },
      });
    },
  };
}
