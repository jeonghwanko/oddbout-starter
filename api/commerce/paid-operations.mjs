// @ts-check
import { Problem, UUID } from '../http.mjs';
import { COMMERCE_CATALOG } from './catalog.mjs';

/** @param {unknown} value */
export function operationId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Problem(422, 'invalid-request-key');
  return value.toLowerCase();
}
/** @param {{store:ReturnType<typeof import('./store.mjs').createCommerceStore>,
 * commerce:ReturnType<typeof import('./service.mjs').createCommerceService>,publicOrigin:string}} options */
export function createPaidOperations({ store, commerce, publicOrigin }) {
  /** @param {any} operation */
  const decorate = operation => ({ ...operation, approvalUrl: `${publicOrigin}/broadcast/tasks/?operation=${operation.id}` });
  /** @param {string} owner @param {string} id */
  const get = async (owner, id) => decorate(await store.operation(owner, 'get', { operationId: operationId(id) }));
  return {
    catalog: () => commerce.catalog(),
    get,
    /** @param {string} owner */
    async list(owner) { return (await store.operation(owner, 'list')).map(decorate); },
    /** A fixed one-cup adapter. Server supplies prices/product; neither client nor LLM can change them.
     * @param {string} owner @param {any} input */
    async prepare(owner, input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || input.fighterIds?.length !== 4) throw new Problem(422, 'invalid-input');
      const quote = commerce.quote({ hostId: input.hostId, channelId: input.channelId, endsAt: input.endsAt,
        fighterIds: input.fighterIds, maxCredits: COMMERCE_CATALOG.tools.host_cup.credits });
      return decorate(await store.operation(owner, 'prepare', { ...quote, requestKey: operationId(input.requestKey), product: COMMERCE_CATALOG.products[0] }));
    },
    /** Human web consent only. @param {string} owner @param {string} id */
    async approve(owner, id) { return decorate(await store.operation(owner, 'approve', { operationId: operationId(id) })); },
    /** @param {string} owner @param {string} id */
    async cancel(owner, id) { return decorate(await store.operation(owner, 'cancel', { operationId: operationId(id) })); },
    /** One top-up bound atomically BEFORE any provider call. Retrying never makes a replacement order.
     * @param {string} owner @param {string} id */
    async checkout(owner, id) {
      const operation = await store.operation(owner, 'fund', { operationId: operationId(id) });
      if (['cancelled', 'expired', 'blocked'].includes(operation.state)) throw new Problem(409, 'operation-not-payable');
      const checkout = await commerce.checkout(owner, { requestKey: operation.id, productId: operation.input.product.id }, operation.id);
      return { operation: await get(owner, id), checkout };
    },
    /** Confirmation never queues work. Webhooks and PC recovery use the same provider order.
     * @param {string} owner @param {string} id */
    async reconcile(owner, id) {
      const operation = await get(owner, id);
      if (operation.payment && operation.payment.status !== 'credited' && operation.payment.providerOrderId) {
        try { await commerce.capture(owner, operation.payment.intentId); }
        catch (error) {
          if (!(error instanceof Problem && error.message === 'paypal-approval-required')) throw error;
        }
      }
      return get(owner, id);
    },
    /** One transaction creates the session, enqueues the cup and binds both IDs. No auto-producer is launched.
     * @param {string} owner @param {string} id */
    async resume(owner, id) {
      const operation = await this.reconcile(owner, id);
      if (operation.state !== 'ready') return operation;
      return decorate(await store.operation(owner, 'resume', { operationId: operationId(id), priceVersion: COMMERCE_CATALOG.version }));
    },
  };
}
