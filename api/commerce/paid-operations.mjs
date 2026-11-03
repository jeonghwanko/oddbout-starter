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
 * commerce:ReturnType<typeof import('./service.mjs').createCommerceService>,publicOrigin:string,
 * ensureProducer?:(owner:string,broadcastId:string)=>void}} options */
export function createPaidOperations({ store, commerce, publicOrigin, ensureProducer }) {
  const recovery = createPaymentRecovery({ store, commerce });
  /** @param {any} operation */
  const decorate = operation => ({ ...operation, approvalUrl: `${publicOrigin}/broadcast/${operation.kind === 'broadcast' ? '' : 'tasks/'}?operation=${operation.id}` });
  /** @param {string} owner @param {string} id */
  const get = async (owner, id) => decorate(await store.operation(owner, 'get', { operationId: operationId(id) }));
  return {
    recovery,
    catalog: () => commerce.catalog(),
    get,
    /** @param {string} owner */
    async list(owner) { return (await store.operation(owner, 'list')).map(decorate); },
    /** @param {string} owner @param {{limit?:number,filter?:string,query?:string,cursor?:string,kind?:string}} [options] */
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
        || options.query !== undefined && (typeof options.query !== 'string' || options.query.length > 64)
        || options.kind !== undefined && !['broadcast','one_cup'].includes(options.kind)) throw new Problem(422, 'invalid-input');
      const page = await store.operation(owner, 'page', { limit: options.limit ?? 20, filter: options.filter ?? 'all', query: options.query ?? '', ...(cursor ? { cursor } : {}), ...(options.kind ? {kind:options.kind} : {}) });
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
        if (existing.kind === 'broadcast') throw new Problem(409, 'idempotency-conflict');
        for (const field of ['hostId','channelId','endsAt','fighterIds']) if (JSON.stringify(input[field]) !== JSON.stringify(existing.input[field])) throw new Problem(409, 'idempotency-conflict');
        return decorate(existing);
      }
      const quote = commerce.quote({ hostId: input.hostId, channelId: input.channelId, endsAt: input.endsAt,
        fighterIds: input.fighterIds, maxCredits: COMMERCE_CATALOG.tools.host_cup.credits });
      return decorate(await store.operation(owner, 'prepare', { ...quote, requestKey: operationId(input.requestKey), product: COMMERCE_CATALOG.products[0] }));
    },
    /** Ordinary broadcast plan, durably saved before human consent. Prices and funding packs are server-selected.
     * @param {string} owner @param {any} input */
    async prepareBroadcast(owner, input) {
      if (!ensureProducer) throw new Problem(503, 'automatic-producer-unavailable');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Problem(422, 'invalid-input');
      const requestKey = operationId(input.requestKey);
      const existing = await store.operation(owner, 'find_request', { requestKey });
      if (existing) {
        if (existing.kind !== 'broadcast') throw new Problem(409, 'idempotency-conflict');
        for (const field of ['hostId','channelId','endsAt','fighterIds','maxCredits'])
          if (JSON.stringify(input[field]) !== JSON.stringify(existing.input[field])) throw new Problem(409, 'idempotency-conflict');
        return decorate(existing);
      }
      const quote = commerce.quote(input), wallet = await commerce.wallet(owner);
      const shortfall = Math.max(0, quote.maxCredits - wallet.availableCredits);
      const product = COMMERCE_CATALOG.products.find(item => item.credits >= shortfall);
      if (!product) throw new Problem(422, 'credit-pack-shortfall-too-large');
      return decorate(await store.operation(owner, 'prepare_broadcast', { ...quote, requestKey, product }));
    },
    /** Human web consent only. @param {string} owner @param {string} id @param {boolean} [startWhenFunded] */
    async approve(owner, id, startWhenFunded = false) {
      const operation = await get(owner,id);
      if (operation.kind === 'broadcast' && !ensureProducer) throw new Problem(503, 'automatic-producer-unavailable');
      return decorate(await store.operation(owner, 'approve', { operationId: operationId(id), ...(startWhenFunded ? {startWhenFunded:true} : {}) }));
    },
    /** The person explicitly approves a new deadline; task, funding and request key remain unchanged.
     * @param {string} owner @param {string} id @param {unknown} endsAt @param {boolean} [startWhenFunded] */
    async renew(owner, id, endsAt, startWhenFunded = false) {
      if (typeof endsAt !== 'string' || !Number.isFinite(Date.parse(endsAt))) throw new Problem(422, 'invalid-end-time');
      const operation=await get(owner,id);
      if (operation.kind === 'broadcast' && !ensureProducer) throw new Problem(503, 'automatic-producer-unavailable');
      return decorate(await store.operation(owner, 'renew_consent', { operationId: operationId(id), endsAt,
        ...(startWhenFunded ? {startWhenFunded:true} : {}) }));
    },
    /** @param {string} owner @param {string} id */
    async cancel(owner, id) { return decorate(await store.operation(owner, 'cancel', { operationId: operationId(id) })); },
    /** One top-up bound atomically BEFORE any provider call. Retrying never makes a replacement order.
     * @param {string} owner @param {string} id */
    async checkout(owner, id) {
      const current = await get(owner,id);
      if (current.kind === 'broadcast' && current.state === 'awaiting_payment'
        && current.input.product.credits < current.input.maxCredits - current.availableCredits) throw new Problem(409, 'credit-pack-shortfall-too-large');
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
    /** Existing one-cup operations enqueue once. Broadcasts bind their session atomically and use the original producer.
     * @param {string} owner @param {string} id */
    async resume(owner, id) {
      const operation = await this.reconcile(owner, id);
      if (operation.kind === 'broadcast' && !ensureProducer) throw new Problem(503, 'automatic-producer-unavailable');
      const resumed = operation.state === 'ready'
        ? decorate(await store.operation(owner, 'resume', { operationId: operationId(id), priceVersion: COMMERCE_CATALOG.version })) : operation;
      if (resumed.kind === 'broadcast' && resumed.broadcastId && ['queued','running'].includes(resumed.state)) {
        const report = await commerce.report(owner,resumed.broadcastId);
        const unallocatedCredits = report.remainingReservedCredits - report.broadcast.allocatedCredits;
        const unsettled = report.jobs.some((/** @type {any} */ job) => ['queued','running','unknown'].includes(job.status));
        // A deterministic budget halt finishes the same session after every job has a known outcome.
        // Pending/unknown allocations remain held; they are never released to make a session look complete.
        if (Number.isSafeInteger(unallocatedCredits) && unallocatedCredits >= 0
          && unallocatedCredits < COMMERCE_CATALOG.tools.host_cup.credits && !unsettled) {
          await commerce.stop(owner,resumed.broadcastId);
          return get(owner,id);
        }
        ensureProducer?.(owner,resumed.broadcastId);
      }
      return resumed;
    },
    /** Durable work is discovered independently of payment polling, including previously funded accounts.
     * One configured producer service owns the original supervisor; this is not a cross-replica producer lease. */
    async continueBroadcasts() {
      if (!ensureProducer) return 0;
      const operations = await store.operationContinuations();
      let continued = 0;
      for (const operation of operations) {
        try { await this.resume(operation.owner,operation.id); continued++; }
        catch { /* The durable row remains due after its bounded delay; no replacement task is made. */ }
      }
      return continued;
    },
  };
}
