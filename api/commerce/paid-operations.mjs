// @ts-check
import { Problem, UUID } from '../http.mjs';
import { COMMERCE_CATALOG } from './catalog.mjs';
import { createPaymentRecovery } from './payment-recovery.mjs';

/** @param {unknown} value */
export function operationId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Problem(422, 'invalid-request-key');
  return value.toLowerCase();
}
/** @param {{store:ReturnType<typeof import('./store.mjs').createCommerceStore>,
 * commerce:ReturnType<typeof import('./service.mjs').createCommerceService>,publicOrigin:string}} options */
export function createPaidOperations({ store, commerce, publicOrigin }) {
  const recovery = createPaymentRecovery({ store, commerce });
  /** @param {any} operation */
  const decorate = operation => ({ ...operation, approvalUrl: `${publicOrigin}/broadcast/tasks/?operation=${operation.id}` });
  /** @param {string} owner @param {string} id */
  const get = async (owner, id) => decorate(await store.operation(owner, 'get', { operationId: operationId(id) }));
  return {
    recovery,
    catalog: () => commerce.catalog(),
    get,
    /** @param {string} owner */
    async list(owner) { return (await store.operation(owner, 'list')).map(decorate); },
    /** @param {string} owner @param {{limit?:number,filter?:string,query?:string,cursor?:string}} [options] */
    async page(owner, options = {}) {
      let cursor;
      if (options.cursor) {
        try {
          if (options.cursor.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(options.cursor)) throw new Error();
          cursor = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
          if (!Number.isFinite(Date.parse(cursor.createdAt)) || !UUID.test(cursor.id)) throw new Error();
        } catch { throw new Problem(422, 'invalid-cursor'); }
      }
      if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50)
        || options.query !== undefined && (typeof options.query !== 'string' || options.query.length > 64)) throw new Problem(422, 'invalid-input');
      const page = await store.operation(owner, 'page', { limit: options.limit ?? 20, filter: options.filter ?? 'all', query: options.query ?? '', ...(cursor ? { cursor } : {}) });
      return { items: page.items.map(decorate), hasMore: page.hasMore,
        nextCursor: page.nextCursor ? Buffer.from(JSON.stringify(page.nextCursor)).toString('base64url') : null };
    },
    /** @param {string} owner @param {string} id @param {string} [before] */
    events(owner, id, before) {
      if (before !== undefined && !/^[1-9][0-9]{0,18}$/.test(before)) throw new Problem(422, 'invalid-cursor');
      return store.operation(owner, 'events', { operationId: operationId(id), ...(before ? { before } : {}) });
    },
    /** A fixed one-cup adapter. Server supplies prices/product; neither client nor LLM can change them.
     * @param {string} owner @param {any} input */
    async prepare(owner, input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || input.fighterIds?.length !== 4) throw new Problem(422, 'invalid-input');
      const existing = await store.operation(owner, 'find_request', { requestKey: operationId(input.requestKey) });
      if (existing) {
        for (const field of ['hostId','channelId','endsAt','fighterIds']) if (JSON.stringify(input[field]) !== JSON.stringify(existing.input[field])) throw new Problem(409, 'idempotency-conflict');
        return decorate(existing);
      }
      const quote = commerce.quote({ hostId: input.hostId, channelId: input.channelId, endsAt: input.endsAt,
        fighterIds: input.fighterIds, maxCredits: COMMERCE_CATALOG.tools.host_cup.credits });
      return decorate(await store.operation(owner, 'prepare', { ...quote, requestKey: operationId(input.requestKey), product: COMMERCE_CATALOG.products[0] }));
    },
    /** Human web consent only. @param {string} owner @param {string} id */
    async approve(owner, id) { return decorate(await store.operation(owner, 'approve', { operationId: operationId(id) })); },
    /** The person explicitly approves a new deadline; task, funding and request key remain unchanged.
     * @param {string} owner @param {string} id @param {unknown} endsAt */
    async renew(owner, id, endsAt) {
      if (typeof endsAt !== 'string' || !Number.isFinite(Date.parse(endsAt))) throw new Problem(422, 'invalid-end-time');
      return decorate(await store.operation(owner, 'renew_consent', { operationId: operationId(id), endsAt }));
    },
    /** @param {string} owner @param {string} id */
    async cancel(owner, id) { return decorate(await store.operation(owner, 'cancel', { operationId: operationId(id) })); },
    /** One top-up bound atomically BEFORE any provider call. Retrying never makes a replacement order.
     * @param {string} owner @param {string} id */
    async checkout(owner, id) {
      const operation = await store.operation(owner, 'fund', { operationId: operationId(id) });
      if (['cancelled', 'expired', 'blocked'].includes(operation.state)) throw new Problem(409, 'operation-not-payable');
      await recovery.runOne(owner, operation.id);
      const status = await store.recovery(owner, 'status', { operationId: operation.id });
      return { operation: await get(owner, id), checkout: { intentId: operation.topupId, status: status?.state,
        ...(status?.approvalUrl && status.state === 'waiting_for_approval' ? { approvalUrl: status.approvalUrl } : {}) } };
    },
    /** Confirmation never queues work. Webhooks and PC recovery use the same provider order.
     * @param {string} owner @param {string} id */
    async reconcile(owner, id) {
      const operation = await get(owner, id);
      if (operation.payment && operation.payment.status !== 'credited') {
        await recovery.runOne(owner, operation.id);
      }
      return get(owner, id);
    },
    /** Human requested verification of the same order; never a replacement payment.
     * @param {string} owner @param {string} id */
    async retryPayment(owner, id) {
      await store.recovery(owner, 'retry', { operationId: operationId(id) });
      await recovery.runOne(owner, id); return get(owner, id);
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
