// @ts-check
import { Problem } from '../http.mjs';
import { PayPalError } from './paypal.mjs';

/** A durable DB lease surrounds provider work. A restarted process uses the same order/request IDs.
 * No provider POST is retried by the HTTP adapter itself; unknown creation past its safe window stays held.
 * @param {{store:ReturnType<typeof import('./store.mjs').createCommerceStore>,
 * commerce:ReturnType<typeof import('./service.mjs').createCommerceService>}} options */
export function createPaymentRecovery({ store, commerce }) {
  return {
    /** @param {string|null} [owner] @param {string} [operationId] */
    async runOne(owner = null, operationId) {
      const lease = await store.recovery(owner, 'claim', operationId ? { operationId } : {});
      if (!lease) return false;
      let state = 'succeeded',
        code = null,
        approvalUrl,
        delaySeconds = 60;
      try {
        const operation = await store.operation(lease.owner, 'get', { operationId: lease.operationId });
        if (!operation.payment?.providerOrderId) {
          if (operation.cancelledAt) throw new Problem(409, 'cancelled-checkout-needs-review');
          const checkout = await commerce.checkout(lease.owner, { requestKey: operation.id, productId: operation.input.product.id }, operation.id);
          approvalUrl = checkout.approvalUrl;
        }
        try {
          await commerce.capture(lease.owner, operation.payment.intentId);
        } catch (error) {
          if (error instanceof Problem && error.message === 'paypal-approval-required') {
            if (!approvalUrl) {
              const checkout = await commerce.checkout(lease.owner, { requestKey: operation.id, productId: operation.input.product.id }, operation.id);
              approvalUrl = checkout.approvalUrl;
            }
          }
          throw error;
        }
      } catch (error) {
        code = error instanceof Problem ? error.message : error instanceof PayPalError ? error.code : 'payment-service-unavailable';
        if (code === 'paypal-approval-required') {
          const operation = await store.operation(lease.owner, 'get', { operationId: lease.operationId });
          state = Date.now() - Date.parse(operation.createdAt) > 86_400_000 ? 'needs_attention' : 'waiting_for_approval';
        } else {
          const transient =
            code === 'paypal_capture_pending' ||
            code === 'payment-service-unavailable' ||
            (error instanceof PayPalError &&
              !['paypal_capture_mismatch', 'paypal_invalid_approval', 'paypal_capture_failed'].includes(code) &&
              (!error.status || error.status === 429 || error.status >= 500));
          state = transient && lease.failures < 7 ? 'pending' : 'needs_attention';
          delaySeconds = Math.min(900, 15 * 2 ** Math.min(lease.failures, 6));
        }
      }
      await store.recovery(lease.owner, 'finish', {
        operationId: lease.operationId,
        leaseId: lease.leaseId,
        state,
        code,
        delaySeconds,
        ...(approvalUrl ? { approvalUrl } : {}),
      });
      return true;
    },
  };
}

/** Starts only with the listening server. Replicas coordinate through fenced DB leases, not process memory.
 * @param {{recovery:ReturnType<typeof createPaymentRecovery>,continueBroadcasts?:()=>Promise<number>,intervalMs?:number,log?:(event:unknown)=>void}} options */
export function createRecoveryWorker({ recovery, continueBroadcasts, intervalMs = 10_000, log = () => {} }) {
  let stopped = true;
  /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
  /** @type {Promise<void>|undefined} */ let active;
  const tick = async () => {
    if (stopped || active) return;
    active = (async () => {
      try {
        for (let i = 0; i < 3 && !stopped; i++) if (!(await recovery.runOne())) break;
      } catch {
        log({ event: 'paid_recovery_unavailable', at: new Date().toISOString() });
      }
      if (!stopped && continueBroadcasts) {
        try {
          await continueBroadcasts();
        } catch {
          log({ event: 'broadcast_continuation_unavailable', at: new Date().toISOString() });
        }
      }
    })();
    try {
      await active;
    } finally {
      active = undefined;
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  };
  return {
    start() {
      if (!stopped) return;
      stopped = false;
      void tick();
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await active;
    },
  };
}
