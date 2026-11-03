// @ts-check
import { Problem, UUID } from '../http.mjs';
import { COMMERCE_CATALOG } from './catalog.mjs';
import { PayPalError, validateCapturedOrder, validateApprovedOrder, validatedApprovalUrl } from './paypal.mjs';

/** @typedef {ReturnType<typeof import('./store.mjs').createCommerceStore>} Store */
/** @typedef {ReturnType<typeof import('./paypal.mjs').createPayPalSandbox>} PayPal */
/** @param {unknown} value */
const key = value => { if (typeof value !== 'string' || !UUID.test(value)) throw new Problem(422, 'invalid-request-key'); return value.toLowerCase(); };
/** @param {unknown} value */
const record = value => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Problem(422, 'invalid-input'); return /** @type {Record<string,any>} */ (value); };

/** A trusted service used by authenticated API and MCP entry points. No request/model supplies prices or owner.
 * @param {{store:Store,paypal:PayPal|null,merchantId?:string,publicOrigin:string,webhookId?:string,
 * hosts:readonly {id:string,label?:string}[],now?:()=>number}} options
 */
export function createCommerceService({ store, paypal, merchantId = '', publicOrigin, webhookId = '', hosts, now = Date.now }) {
  const origin = new URL(publicOrigin).origin;
  if (origin !== publicOrigin || !(origin.startsWith('https:') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) throw new Error('invalid-commerce-origin');
  const configuredHosts = new Set(hosts.map(host => host.id));
  /** @returns {PayPal} */
  function payments() { if (!paypal || !merchantId) throw new Problem(503, 'paypal-not-configured'); return paypal; }
  /** @param {string} owner @param {any} intent */
  async function reconcile(owner, intent) {
    if (!intent.providerOrderId) throw new Problem(409, 'checkout-outcome-unknown');
    const order = await payments().getOrder(intent.providerOrderId);
    const verified = validateCapturedOrder(order, { orderId: intent.providerOrderId, referenceId: intent.id,
      amountMinor: intent.amountCents, currency: intent.currency, merchantId });
    return store.creditCapture(owner, intent.id, { providerOrderId: verified.orderId, captureId: verified.captureId,
      amountCents: verified.amountMinor, currency: verified.currency, status: 'COMPLETED' });
  }
  return {
    catalog: () => ({ ...COMMERCE_CATALOG, hosts, paypalConfigured: Boolean(paypal && merchantId) }),
    /** @param {string} owner */
    wallet: owner => store.wallet(owner),
    /** @param {string} owner @param {unknown} input @param {string} [operationId] Trusted server linkage only. */
    async checkout(owner, input, operationId) {
      const body = record(input), requestKey = key(body.requestKey);
      const product = COMMERCE_CATALOG.products.find(item => item.id === body.productId);
      if (!product) throw new Problem(422, 'unknown-product');
      const provider = payments();
      const intent = await store.createTopup(owner, { requestKey, amountCents: product.amountCents, credits: product.credits, currency: COMMERCE_CATALOG.currency });
      if (intent.status === 'credited') return { intentId: intent.id, status: intent.status };
      if (intent.providerOrderId) {
        const order = await provider.getOrder(intent.providerOrderId);
        if (order.status === 'COMPLETED') return { intentId: intent.id, status: (await reconcile(owner, intent)).status };
        let approval;
        try { approval=validatedApprovalUrl(order,intent.providerOrderId); }
        catch { throw new Problem(409,'checkout-not-approvable'); }
        return { intentId: intent.id, status: intent.status, approvalUrl: approval };
      }
      // Never blindly replay an unknown create after the documented provider deduplication window.
      // A short recovery window also keeps a retained local key from turning into a new provider order later.
      if (now() - Date.parse(intent.createdAt) > 5 * 60_000) throw new Problem(409, 'checkout-needs-reconciliation');
      const operation = operationId ? await store.operation(owner,'get',{operationId:key(operationId)}) : null;
      const callback = operation ? `${origin}/broadcast/${operation.kind === 'broadcast' ? '' : 'tasks/'}?operation=${key(operationId)}`
        : `${origin}/broadcast/?intent=${encodeURIComponent(intent.id)}`;
      const order = await provider.createOrder({ requestId: `o-${intent.id}`, referenceId: intent.id,
        amountMinor: intent.amountCents, currency: intent.currency, returnUrl: callback, cancelUrl: `${callback}&cancelled=1` });
      await store.attachOrder(owner, intent.id, order.id);
      return { intentId: intent.id, status: 'ordered', approvalUrl: order.approvalUrl };
    },
    /** User approval is completed at PayPal; this endpoint only captures/reconciles that persisted order.
     * @param {string} owner @param {string} intentId */
    async capture(owner, intentId) {
      const intent = await store.findTopup(owner, key(intentId));
      if (intent.status === 'credited') return intent;
      if (!intent.providerOrderId) throw new Problem(409, 'checkout-outcome-unknown');
      const provider = payments(), order = await provider.getOrder(intent.providerOrderId);
      if (order.status === 'VOIDED') throw new Problem(409, 'paypal-order-voided');
      if (order.status !== 'COMPLETED') {
        if (order.status !== 'APPROVED') throw new Problem(409, 'paypal-approval-required');
        validateApprovedOrder(order,{orderId:intent.providerOrderId,referenceId:intent.id,
          amountMinor:intent.amountCents,currency:intent.currency,merchantId});
        try { await provider.captureOrder({ orderId: intent.providerOrderId, requestId: `c-${intent.id}` }); }
        catch (error) { if (!(error instanceof PayPalError) || !error.outcomeUnknown) throw error; /* Query same order, never replace it. */ }
      }
      return reconcile(owner, intent);
    },
    /** @param {Headers} headers @param {string} body */
    async webhook(headers, body) {
      if (!webhookId || !(await payments().verifyWebhook({ headers, body, webhookId }))) throw new Problem(400, 'invalid-paypal-webhook');
      const event = JSON.parse(body);
      if(event?.event_type==='PAYMENT.CAPTURE.REFUNDED'||event?.event_type==='PAYMENT.CAPTURE.REVERSED'){
        const related=event.resource?.supplementary_data?.related_ids;
        // A refund resource names its capture by the `up` link; supplementary_data, when present, must agree with it.
        const up=(Array.isArray(event.resource?.links)?event.resource.links:[]).find((/** @type {any} */ link)=>link?.rel==='up')?.href;
        const linked=typeof up==='string'?up.match(/^https:\/\/api(?:-m)?\.sandbox\.paypal\.com\/v2\/payments\/captures\/([A-Za-z0-9_-]{1,128})$/)?.[1]:undefined;
        if(event.event_type==='PAYMENT.CAPTURE.REFUNDED'&&linked!==undefined&&related?.capture_id!==undefined&&related.capture_id!==linked)throw new Problem(409,'adjustment-mismatch');
        const captureId=event.event_type==='PAYMENT.CAPTURE.REFUNDED'?related?.capture_id??linked:event.resource?.id;
        if(typeof event.id!=='string'||typeof captureId!=='string'||(related?.order_id!==undefined&&typeof related.order_id!=='string'))throw new Problem(422,'webhook-adjustment-linkage-missing');
        if(event.event_type==='PAYMENT.CAPTURE.REVERSED'&&related?.capture_id!==undefined&&related.capture_id!==captureId)throw new Problem(409,'adjustment-mismatch');
        const adjustment=await store.recordPaymentAdjustment({eventId:event.id,eventType:event.event_type,captureId,
          ...(related?.order_id===undefined?{}:{providerOrderId:related.order_id})});
        return {received:true,recorded:true,applied:adjustment.status==='needs_reconciliation',needsReconciliation:true};
      }
      // Approval can arrive after the phone/browser has closed. Verify and capture the SAME persisted order.
      if (event.event_type === 'CHECKOUT.ORDER.APPROVED') {
        if (typeof event.resource?.id !== 'string') throw new Problem(422, 'webhook-order-missing');
        const intent = await store.lookupOrder(event.resource.id);
        if (!intent) throw new Problem(409, 'webhook-order-unlinked');
        await this.capture(intent.owner, intent.id);
        return { received: true, applied: true };
      }
      if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') return { received: true, applied: false };
      const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
      if (typeof orderId !== 'string') throw new Problem(422, 'webhook-order-missing');
      const intent = await store.lookupOrder(orderId);
      if (!intent) throw new Problem(409, 'webhook-order-unlinked');
      // A late duplicate COMPLETED event after a refund is not a new credit or an
      // instruction to remove the independently recorded adjustment freeze.
      if(intent.status!=='credited')await reconcile(intent.owner, intent);
      return { received: true, applied: true };
    },
    /** @param {unknown} input */
    quote(input) {
      const body = record(input);
      if (!configuredHosts.has(body.hostId)) throw new Problem(422, 'unknown-host');
      // This is an operator's session label, not a verified Twitch login or URL.
      if (typeof body.channelId !== 'string' || !body.channelId.trim() || body.channelId.length > 64
        || /[^\p{L}\p{N} _-]/u.test(body.channelId)) throw new Problem(422, 'invalid-channel');
      if (!Number.isSafeInteger(body.maxCredits) || body.maxCredits < 25 || body.maxCredits > 1_000_000) throw new Problem(422, 'invalid-budget');
      if (typeof body.endsAt !== 'string' || !Number.isFinite(Date.parse(body.endsAt)) || Date.parse(body.endsAt) <= now() || Date.parse(body.endsAt) > now() + 86_400_000) throw new Problem(422, 'invalid-end-time');
      if (!Array.isArray(body.fighterIds) || body.fighterIds.length < 4 || body.fighterIds.length > 9 || new Set(body.fighterIds).size !== body.fighterIds.length
        || body.fighterIds.some((/** @type {any} */ id) => !COMMERCE_CATALOG.fighters.includes(id))) throw new Problem(422, 'invalid-fighters');
      return { hostId: body.hostId, channelId: body.channelId, endsAt: body.endsAt, maxCredits: body.maxCredits,
        channelIdentity: 'operator-label-unverified', liveControl: 'blocked-unverified-channel',
        fighterIds: [...body.fighterIds], allowedTools: ['host_cup'], priceVersion: COMMERCE_CATALOG.version,
        cupCredits: COMMERCE_CATALOG.tools.host_cup.credits, maxCups: Math.floor(body.maxCredits / COMMERCE_CATALOG.tools.host_cup.credits),
        streamMetering: 'not-enabled', note: 'Sandbox cup execution only; 24-hour live operation requires host and stream validation.' };
    },
    /** Web-only approval; never register as an MCP tool. @param {string} owner @param {unknown} input */
    approve(owner, input) { const body = record(input); return store.approveBudget(owner, { ...this.quote(body), requestKey: key(body.requestKey) }); },
    /** @param {string} owner @param {unknown} input */
    start(owner, input) { const body = record(input); return store.startBroadcast(owner, { requestKey: key(body.requestKey), approvalId: key(body.approvalId) }); },
    /** @param {string} owner @param {unknown} input */
    cup(owner, input) {
      const body = record(input);
      if (!Array.isArray(body.fighterIds) || body.fighterIds.length !== 4 || body.fighterIds.some((/** @type {any} */ id) => !COMMERCE_CATALOG.fighters.includes(id))) throw new Problem(422, 'invalid-fighters');
      return store.enqueueCup(owner, { requestKey: key(body.requestKey), broadcastId: key(body.broadcastId), fighterIds: body.fighterIds,
        priceCredits: COMMERCE_CATALOG.tools.host_cup.credits, priceVersion: COMMERCE_CATALOG.version });
    },
    /** @param {string} owner @param {string} id */
    stop: (owner, id) => store.stopBroadcast(owner, key(id)),
    /** @param {string} owner @param {string} id */
    report: (owner, id) => store.report(owner, key(id)),
    /** @param {string} owner @param {string} id */
    jobs: (owner, id) => store.listJobs(owner, key(id)),
    /** @param {string} owner @param {string} id */
    job: (owner, id) => store.getJob(owner, key(id)),
  };
}
