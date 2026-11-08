// @ts-check
import { Problem, UUID } from '../http.mjs';
import { COMMERCE_CATALOG } from './catalog.mjs';

/** The purchased ticket is the authority for one prepaid producer session. No wallet funding is created here.
 * @param {{store:ReturnType<typeof import('./store.mjs').createCommerceStore>,hostId:string|null,
 * supervisor:ReturnType<typeof import('../../broadcast/supervisor.mjs').createProducerSupervisor>|null,
 * payouts:ReturnType<typeof import('./payouts.mjs').createPayoutService>|null,
 * reconciler:ReturnType<typeof import('../../broadcast/reconcile.mjs').createReconciler>|null}} options */
export function createCampaignExecution({ store, hostId, supervisor, payouts, reconciler }) {
  /** @param {string} owner @param {string} id */
  async function report(owner, id) {
    const data = await store.campaignExecution(owner, 'report', { orderId: id });
    const batches = payouts ? await payouts.list(owner, data.order.broadcastId) : [];
    data.payouts = await Promise.all(batches.map((/** @type {any} */ batch) => (batch.status === 'submitted' ? payouts?.get(owner, batch.id) : batch)));
    data.producer = supervisor ? await supervisor.status(owner, data.order.broadcastId) : null;
    data.feeCents = payouts?.feeCents ?? null;
    return data;
  }
  return {
    report,
    /** @param {string} owner @param {string} id @param {any} input @param {any} order */
    async start(owner, id, input, order) {
      if (!hostId || !supervisor || !payouts || !reconciler) throw new Problem(503, 'campaign-execution-unavailable');
      if (!order.fighterIds.every((/** @type {string} */ id) => payouts.eligibleFighterIds.includes(id)))
        throw new Problem(503, 'campaign-receivers-unavailable');
      const started = await store.campaignExecution(owner, 'start', { ...input, orderId: id, hostId, priceVersion: COMMERCE_CATALOG.version });
      supervisor.ensure(owner, started.broadcastId);
      return started;
    },
    /** @param {string} token */
    playback: token => store.campaignExecution(null, 'playback', { watchToken: token }),
    /** @param {string} owner @param {string} id */
    async retry(owner, id) {
      if (!supervisor) throw new Problem(503, 'campaign-execution-unavailable');
      const data = await store.campaignExecution(owner, 'report', { orderId: id });
      if (
        !['queued', 'running'].includes(data.execution.broadcast.status) ||
        data.execution.jobs.some((/** @type {any} */ j) => ['queued', 'running', 'unknown'].includes(j.status))
      )
        throw new Problem(409, 'producer-retry-unavailable');
      try {
        await supervisor.retry(owner, data.order.broadcastId);
      } catch {
        throw new Problem(409, 'producer-retry-unavailable');
      }
      return report(owner, id);
    },
    /** @param {string} owner @param {string} id */
    async stop(owner, id) {
      await store.campaignExecution(owner, 'stop', { orderId: id });
      return report(owner, id);
    },
    /** Reconcile precisely the top-ups attributed to this ticket, not whichever account transactions are newest.
     * @param {string} owner @param {string} id */
    async reconcile(owner, id) {
      if (!reconciler) throw new Problem(503, 'reconciliation-unavailable');
      const data = await store.campaignExecution(owner, 'report', { orderId: id });
      if (data.execution.broadcast.status !== 'completed') throw new Problem(409, 'broadcast-not-finished');
      const ids = data.funding.map((/** @type {any} */ source) => source.intentId);
      const audited = await reconciler.run(owner, ids);
      const fullyFunded = data.funding.reduce((/** @type {number} */ sum, /** @type {any} */ source) => sum + source.credits, 0) === data.order.priceCredits;
      const matched =
        fullyFunded &&
        ids.length > 0 &&
        audited.rows.length === ids.length &&
        audited.rows.every((/** @type {any} */ row) => row.result === 'matched' && ids.includes(row.intentId));
      await store.campaignExecution(owner, 'settlement', { orderId: id, report: { ...audited, status: matched ? 'matched' : 'needs_attention' } });
      return report(owner, id);
    },
    /** @param {string} owner @param {string} id @param {any} input */
    async propose(owner, id, input) {
      if (!payouts) throw new Problem(503, 'payouts-unavailable');
      const data = await store.campaignExecution(owner, 'report', { orderId: id });
      await payouts.propose(owner, { broadcastId: data.order.broadcastId, requestKey: input.requestKey });
      return report(owner, id);
    },
    /** A web-only explicit approval. Batch and ticket must belong to the same session.
     * @param {string} owner @param {string} id @param {any} input */
    async pay(owner, id, input) {
      if (!payouts) throw new Problem(503, 'payouts-unavailable');
      if (typeof input.batchId !== 'string' || !UUID.test(input.batchId)) throw new Problem(422, 'invalid-input');
      const data = await store.campaignExecution(owner, 'report', { orderId: id }),
        batch = await payouts.get(owner, input.batchId);
      if (batch.broadcastId !== data.order.broadcastId) throw new Problem(404, 'not-found');
      await payouts.approve(owner, batch.id);
      return report(owner, id);
    },
    /** DB discovery survives an ephemeral API restart and a lost Start response. No new session is created. */
    async recover() {
      const rows = await store.campaignExecution(null, 'continuations');
      for (const row of rows) {
        const report = await store.report(row.owner, row.id);
        if (['queued', 'running'].includes(report.broadcast.status)) supervisor?.ensure(row.owner, row.id);
      }
    },
  };
}
