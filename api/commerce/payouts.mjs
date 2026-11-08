// @ts-check
import { Problem, UUID } from '../http.mjs';
import { PayPalError, payoutReceiver } from './paypal.mjs';

/** @typedef {ReturnType<typeof import('./store.mjs').createCommerceStore>} Store */
/** @typedef {ReturnType<typeof import('./paypal.mjs').createPayPalSandbox>} PayPal */
/** @param {unknown} value */
const key = value => {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Problem(422, 'invalid-request-key');
  return value.toLowerCase();
};

/** Validate the server's fighter -> Sandbox receiver mapping once, at startup.
 * @param {unknown} value @param {readonly string[]} fighters @returns {Record<string,string>} */
export function payoutReceivers(value, fighters) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) throw new Error('payout-receivers-required');
  /** @type {Record<string,string>} */ const receivers = {};
  for (const [fighter, receiver] of Object.entries(value)) {
    if (!fighters.includes(fighter)) throw new Error('payout-receivers-unknown-fighter');
    try {
      receivers[fighter] = payoutReceiver(receiver);
    } catch {
      throw new Error('payout-receivers-invalid-email');
    }
  }
  return receivers;
}

/** A definite refusal: PayPal answered and created nothing. Anything else may have created the batch.
 * @param {unknown} error */
const refused = error =>
  error instanceof PayPalError && error.code === 'paypal_http_error' && error.status >= 400 && error.status < 500 && ![408, 409, 429].includes(error.status);

/** Creator appearance fees paid with PayPal Sandbox Payouts. Every completed cup pays each of its fighters
 * `feeCents` once (the ledger's (job, fighter) key). Anyone may propose; only the session owner's console
 * approval sends money. A batch's id is its PayPal sender_batch_id and request id, so an uncertain dispatch
 * is retried by approving again and can never create a second batch.
 * @param {{store:Store,paypal:PayPal,receivers:Record<string,string>,feeCents:number}} options */
export function createPayoutService({ store, paypal, receivers, feeCents }) {
  if (!Number.isSafeInteger(feeCents) || feeCents < 1 || feeCents > 10_000) throw new Error('invalid-payout-fee');
  /** @param {string} owner @param {any} batch */
  async function dispatch(owner, batch) {
    /** @type {Map<string,{cents:number,fighters:string[]}>} */ const byReceiver = new Map();
    for (const item of batch.items) {
      const entry = byReceiver.get(item.receiver) ?? { cents: 0, fighters: [] };
      entry.cents += item.cents;
      entry.fighters.push(item.fighterId);
      byReceiver.set(item.receiver, entry);
    }
    let sent;
    try {
      sent = await paypal.createPayout({
        senderBatchId: batch.id,
        requestId: `p-${batch.id}`,
        items: [...byReceiver].map(([receiver, entry], index) => ({
          receiver,
          amountMinor: entry.cents,
          currency: batch.currency,
          senderItemId: `${batch.id.slice(0, 8)}-${index + 1}`,
          note: `Appearance fees for ${entry.fighters.join(', ')} in completed ODDBOUT Sandbox cups.`,
        })),
      });
    } catch (error) {
      // Only the first send can prove nothing exists. After an uncertain one, PayPal may already hold the
      // batch, so a later refusal keeps the appearances reserved until someone checks PayPal.
      if (refused(error) && batch.dispatchAttempts === 1) await store.settlePayout(owner, batch.id, 'REJECTED');
      throw error;
    }
    return store.attachPayout(owner, batch.id, sent.payoutBatchId);
  }
  return {
    feeCents,
    eligibleFighterIds: Object.freeze(Object.keys(receivers)),
    /** @param {string} owner @param {unknown} input */
    async propose(owner, input) {
      const body = /** @type {any} */ (input);
      if (!body || typeof body !== 'object') throw new Problem(422, 'invalid-input');
      return store.proposePayout(owner, { broadcastId: key(body.broadcastId), requestKey: key(body.requestKey), feeCents, receivers });
    },
    /** Console only: sends the batch to PayPal, or retries an uncertain earlier dispatch.
     * @param {string} owner @param {string} batchId */
    async approve(owner, batchId) {
      const batch = await store.approvePayout(owner, key(batchId));
      return batch.status === 'submitting' ? dispatch(owner, batch) : batch;
    },
    /** @param {string} owner @param {string} batchId */
    cancel: async (owner, batchId) => store.cancelPayout(owner, key(batchId)),
    /** Read a batch, asking PayPal for the latest status while it is in flight.
     * @param {string} owner @param {string} batchId */
    async get(owner, batchId) {
      const batch = await store.getPayout(owner, key(batchId));
      if (batch.status !== 'submitted' || !batch.providerBatchId) return batch;
      const current = await paypal.getPayout(batch.providerBatchId);
      return current.status === batch.providerStatus ? batch : store.settlePayout(owner, batch.id, current.status);
    },
    /** @param {string} owner @param {string} broadcastId */
    list: async (owner, broadcastId) => store.listPayouts(owner, key(broadcastId)),
  };
}
