// @ts-check
import { Problem } from '../http.mjs';

/** Convert database row columns, preserving the caller's immutable JSON payloads.
 * @param {any} value @returns {any}
 */
function row(value) {
  if (Array.isArray(value)) return value.map(row);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [
    key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
    ['input', 'result', 'final_report'].includes(key) ? val : row(val),
  ]));
}

/** Server-only persistence. Owner MUST come from verified authentication, never model/body input.
 * Prices and capture evidence MUST be selected/verified by the calling server.
 * This service-role-only RPC owns all accounting and fencing in one PostgreSQL transaction.
 * @param {{rpc: (name:string,args:any)=>PromiseLike<{data:any,error:any}>}} db
 */
export function createCommerceStore(db) {
  /** @param {string|null} owner @param {string} command @param {any} [input] @param {string} [rpc] */
  async function command(owner, command, input = {}, rpc = 'commerce_command') {
    const { data, error } = await db.rpc(rpc, { p_owner: owner, p_command: command, p_input: input });
    if (error) {
      const known = String(error.message ?? '').match(/^commerce:([a-z_-]+)/)?.[1];
      const status = known === 'not-found' ? 404 : known === 'insufficient-credits' ? 402
        : known === 'invalid-input' || known === 'invalid-result' ? 422
        : known === 'owner-required' ? 401 : known ? 409 : 503;
      throw new Problem(status, known ?? 'commerce-unavailable');
    }
    return row(data);
  }
  return {
    /** Leased payment recovery and operator diagnostics, service-role only.
     * @param {string|null} owner @param {string} action @param {any} [input] */
    recovery: (owner, action, input = {}) => command(owner, action, input, 'commerce_operation_recovery'),
    /** Durable paid-task commands; owner is verified by the web/device handler.
     * @param {string} owner @param {string} action @param {any} [input] */
    operation: (owner, action, input = {}) => command(owner, action, input, 'commerce_operation'),
    /** Server-only device pairing. Secrets are hashed before persistence.
     * @param {string|null} owner @param {string} action @param {any} [input] */
    operationDevice: (owner, action, input = {}) => command(owner, action, input, 'commerce_operation_device'),
    /** @param {string} owner @param {any} input */
    createTopup: (owner, input) => command(owner, 'create_topup', input),
    /** @param {string} owner @param {string} intentId */
    findTopup: (owner, intentId) => command(owner, 'find_topup', { intentId }),
    /** @param {string} owner */
    listTopups: owner => command(owner, 'list_topups'),
    /** Creator appearance fees (supabase/sandbox/20261104090000_commerce_payouts.sql).
     * @param {string} owner @param {{broadcastId:string,requestKey:string,feeCents:number,receivers:Record<string,string>}} input */
    proposePayout: (owner, input) => command(owner, 'propose', input, 'commerce_payout'),
    /** @param {string} owner @param {string} broadcastId */
    listPayouts: (owner, broadcastId) => command(owner, 'list', { broadcastId }, 'commerce_payout'),
    /** @param {string} owner @param {string} batchId */
    getPayout: (owner, batchId) => command(owner, 'get', { batchId }, 'commerce_payout'),
    /** @param {string} owner @param {string} batchId */
    approvePayout: (owner, batchId) => command(owner, 'approve', { batchId }, 'commerce_payout'),
    /** @param {string} owner @param {string} batchId */
    cancelPayout: (owner, batchId) => command(owner, 'cancel', { batchId }, 'commerce_payout'),
    /** @param {string} owner @param {string} batchId @param {string} providerBatchId */
    attachPayout: (owner, batchId, providerBatchId) => command(owner, 'attach', { batchId, providerBatchId }, 'commerce_payout'),
    /** @param {string} owner @param {string} batchId @param {string} providerStatus */
    settlePayout: (owner, batchId, providerStatus) => command(owner, 'settle', { batchId, providerStatus }, 'commerce_payout'),
    /** Trusted webhook reverse lookup. @param {string} providerOrderId */
    lookupOrder: providerOrderId => command(null, 'lookup_order', { providerOrderId }),
    /** Verified signed refund/reversal only. Owner is resolved from persisted capture, never the payload.
     * @param {{eventId:string,eventType:string,captureId:string,providerOrderId?:string}} input */
    recordPaymentAdjustment: input => command(null,'record_adjustment',input),
    /** @param {string} owner @param {string} intentId @param {string} providerOrderId */
    attachOrder: (owner, intentId, providerOrderId) => command(owner, 'attach_order', { intentId, providerOrderId }),
    /** @param {string} owner @param {string} intentId @param {any} verified */
    creditCapture: (owner, intentId, verified) => command(owner, 'credit_capture', { ...verified, intentId }),
    /** @param {string} owner */
    wallet: owner => command(owner, 'wallet'),
    /** Trusted web approval only. @param {string} owner @param {any} input */
    approveBudget: (owner, input) => command(owner, 'approve_budget', input),
    /** @param {string} owner @param {any} input */
    startBroadcast: (owner, input) => command(owner, 'start_broadcast', input),
    /** @param {string} owner @param {any} input */
    enqueueCup: (owner, input) => command(owner, 'enqueue_cup', input),
    /** @param {string} workerId @param {any} [input] */
    claimJob: (workerId, input = {}) => command(null, 'claim_job', { ...input, workerId }),
    /** @param {string} workerId @param {any} input */
    renewJob: (workerId, input) => command(null, 'renew_job', { ...input, workerId }),
    /** @param {string} workerId @param {any} input */
    completeJob: (workerId, input) => command(null, 'complete_job', { ...input, workerId }),
    /** The named job, or every running/unknown job, held by this worker. @param {string} workerId @param {{jobId?:string}} [input] */
    workerJobs: (workerId, input = {}) => command(null, 'worker_jobs', { ...input, workerId }),
    /** Operator only, never an HTTP route: close an unknown job without charging it. @param {string} jobId @param {string} note */
    releaseJob: (jobId, note) => command(null, 'release_job', { jobId, note }),
    /** @param {string} owner @param {string} broadcastId */
    stopBroadcast: (owner, broadcastId) => command(owner, 'stop_broadcast', { broadcastId }),
    /** @param {string} owner @param {string} broadcastId */
    report: (owner, broadcastId) => command(owner, 'report', { broadcastId }),
    /** @param {string} owner @param {string} broadcastId */
    listJobs: (owner, broadcastId) => command(owner, 'list_jobs', { broadcastId }),
    /** @param {string} owner @param {string} jobId */
    getJob: (owner, jobId) => command(owner, 'get_job', { jobId }),
  };
}
