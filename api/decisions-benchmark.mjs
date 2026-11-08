// @ts-check
import { Problem, UUID } from './http.mjs';
import { reviewEvidence, nativeSequenceEvidence } from './decisions-review.mjs';
import { sequenceConfig as validateSequenceConfig } from './sequence-benchmark.mjs';
import { benchmarkConfig } from './responses-benchmark.mjs';

/**
 * A row of af_decision_benchmark_cases. `intent` is operator-written JSON; each field is checked where it is used.
 * @typedef {{ id: string, host_id: string, intent: any, evidence: unknown, expires_at: string }} BenchmarkCase
 */

/**
 * A generation worker may submit only evidence enrolled for its host by an operator, once per case.
 * @param {{ db: any, reviewer: import('./http.mjs').Reviewer | null, responsesReviewer: import('./http.mjs').Reviewer | null,
 *   cascadeReviewer: import('./http.mjs').Reviewer | null, host: string | null, caseId: string, body: any }} options
 *   `host` is the worker's host (null: the official one); `body` is its upload, checked by the evidence parsers.
 */
export async function benchmarkReview({ db, reviewer, responsesReviewer, cascadeReviewer, host, caseId, body }) {
  const effectiveHost = host ?? (await db.rpc('af_generation_official', {})).data;
  const { data: row, error } = await db
    .from('af_decision_benchmark_cases')
    .select('id,host_id,intent,evidence,expires_at')
    .eq('id', caseId)
    .eq('host_id', effectiveHost)
    .maybeSingle();
  if (error) throw new Problem(503, 'review-store-unavailable');
  if (!row) throw new Problem(404, 'not-found');
  if (Date.parse(row.expires_at) <= Date.now()) throw new Problem(410, 'benchmark-expired');
  const sequenceConfig = row.intent.sequenceBenchmark;
  if (sequenceConfig !== undefined) validateSequenceConfig(sequenceConfig);
  const evidence = await (sequenceConfig === undefined ? reviewEvidence(body) : nativeSequenceEvidence(body));
  const config = row.intent.benchmarkReview;
  if (sequenceConfig !== undefined && (config !== undefined || row.intent.cascadeFollowupCaseId !== undefined))
    throw new Problem(422, 'invalid-benchmark-config');
  if (config !== undefined) {
    benchmarkConfig(config, evidence.stage);
    reviewer = responsesReviewer;
  }
  // Operators may pair two one-call cases to smoke-test the production cascade on
  // existing art. Workers cannot enroll a case or choose a second model/case.
  const followupId = row.intent.cascadeFollowupCaseId;
  /** @type {(r: BenchmarkCase) => Record<string, unknown>} */
  const intentOf = r => ({
    description: r.intent.description,
    brief: r.intent.brief,
    appearance_note: r.intent.appearance_note ?? null,
    motion_note: r.intent.motion_note ?? null,
  });
  if (followupId !== undefined) {
    if (config !== undefined || !UUID.test(followupId) || followupId === caseId) throw new Problem(422, 'invalid-benchmark-config');
    const { data: child, error: childError } = await db
      .from('af_decision_benchmark_cases')
      .select('id,host_id,intent,evidence,expires_at')
      .eq('id', followupId)
      .eq('host_id', effectiveHost)
      .maybeSingle();
    if (childError) throw new Problem(503, 'review-store-unavailable');
    if (
      !child ||
      child.intent.benchmarkReview !== undefined ||
      child.intent.cascadeFollowupCaseId !== undefined ||
      child.intent.sequenceBenchmark !== undefined ||
      JSON.stringify(intentOf(child)) !== JSON.stringify(intentOf(row)) ||
      JSON.stringify(child.evidence) !== JSON.stringify(row.evidence)
    )
      throw new Problem(422, 'invalid-benchmark-config');
    if (Date.parse(child.expires_at) <= Date.now()) throw new Problem(410, 'benchmark-expired');
    reviewer = cascadeReviewer;
  }
  if (!reviewer?.enabled) return { mode: 'off', status: 'disabled', advisory: true, visualApproval: false };
  // SQL compares the complete binding again while holding the shared quota lock.
  /** @type {{ rpc: (name: string, args: Record<string, any>) => Promise<any> }} */
  const mapped = {
    rpc: (name, args) =>
      name === 'af_decision_review_start'
        ? db.rpc('af_decision_benchmark_start', {
            p_case: followupId && args.p_binding.model === 'gpt-6.1-sol' ? followupId : caseId,
            p_host: host,
            p_fingerprint: args.p_fingerprint,
            p_stage: args.p_stage,
            p_scope: args.p_scope,
            p_binding: args.p_binding,
          })
        : db.rpc(name, args),
  };
  const job = {
    id: caseId,
    description: row.intent.description,
    brief: row.intent.brief,
    appearance_note: row.intent.appearance_note,
    motion_note: row.intent.motion_note,
  };
  return reviewer.review({ db: mapped, job, host, lease: null, evidence, config, sequenceConfig });
}
