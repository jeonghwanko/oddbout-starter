// @ts-check
import { createDecisionsReviewer } from './decisions-review.mjs';
import { createSolFollowupReviewer, followupQuestions, SOL_FOLLOWUP } from './responses-benchmark.mjs';

/** Both calls and credentials stay in the Edge function. Never changes an existing approval gate. */
/**
 * @param {{ apiKey?: string, enabled?: boolean, fetcher?: typeof fetch }} [options]
 * @returns {import('./http.mjs').Reviewer}
 */
export function createLunaSolReviewer(options = {}) {
  const luna = createDecisionsReviewer(options),
    sol = createSolFollowupReviewer(options);
  return {
    enabled: luna.enabled,
    async review(args) {
      const primary = await luna.review(args);
      const questionNames = followupQuestions(primary, args.evidence).map(q => q.name);
      const cascade = { policy: SOL_FOLLOWUP.policy, questionNames, advisory: true, visualApproval: false };
      if (!questionNames.length) return { ...primary, cascade, followup: null };
      let followup;
      try {
        followup = await sol.review({ ...args, primary });
      } catch (/** @type {any} */ error) {
        // Quota, lease or persistence failure must not erase a completed Luna review,
        // trigger generation, expose an exception, or turn this advisory into approval.
        const code = [
          'review-limit',
          'lease-lost',
          'worker-required',
          'generation-state',
          'benchmark-expired',
          'benchmark-evidence-changed',
          'review-binding-changed',
        ].find(c => c === error?.message);
        followup = {
          status: 'unverified',
          advisory: true,
          visualApproval: false,
          errorCode: code ?? 'review-store-unavailable',
          checks: Object.fromEntries(questionNames.map(name => [name, { status: 'unverified' }])),
        };
      }
      // Preserve first/second opinions separately. A Sol clear never overwrites a Luna
      // defect, and neither opinion certifies physical feet, ground contact or gait.
      return { ...primary, cascade, followup };
    },
  };
}
