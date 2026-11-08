// @ts-check
import { z } from 'zod';
import { UUID_ARG } from './common.mjs';

/** Opt-in account-bound tools. Budget approval is deliberately absent.
 * @param {{register:import('./common.mjs').Register,invoke:import('./common.mjs').Invoke}} context */
export function registerCommerceTools({ register, invoke }) {
  const write = { write: true, idempotent: true };
  const post = (/** @type {string} */ path, /** @type {unknown} */ input) =>
    invoke(`commerce/${path}`, 'POST', JSON.stringify(input), { 'content-type': 'application/json' });
  register('get_credit_balance', 'ODDBOUT credit balance', 'Read Sandbox balance and reservations. Free; separate from game gold.', {}, () =>
    invoke('commerce/wallet'),
  );
  register(
    'get_broadcast_prices',
    'Broadcast prices and hosts',
    'Read versioned prices and configured hosts. Configuration alone is not proof of live readiness.',
    {},
    () => invoke('commerce/catalog'),
  );
  register(
    'create_topup_checkout',
    'PayPal Sandbox checkout',
    'Get a Sandbox approval link. The user approves on PayPal. Reuse the exact requestKey after interruption; never replace an uncertain payment with a new key.',
    { requestKey: UUID_ARG(), productId: z.string().max(64) },
    args => post('checkout', args),
    { ...write, openWorld: true },
  );
  register(
    'confirm_topup',
    'Confirm approved checkout',
    'Capture and reconcile the persisted order after PayPal user approval. This cannot approve a payment.',
    { intentId: UUID_ARG() },
    args => post(`topups/${args.intentId}/capture`, {}),
    { ...write, openWorld: true },
  );
  register(
    'quote_broadcast',
    'Quote a broadcast',
    'Preview host, channel, deadline and credit limit. No reservation or spending approval. User approval must occur in the ODDBOUT web console.',
    {
      hostId: z.string().max(64),
      channelId: z.string().max(64),
      endsAt: z.string().max(40),
      maxCredits: z.number().int().positive(),
      fighterIds: z.array(z.string().max(64)).min(4).max(9),
    },
    args => post('quote', args),
  );
  register(
    'start_broadcast',
    'Start approved broadcast session',
    'Reserve a budget already approved by the user in the web console, bound to host/channel/price/deadline. Does not certify a live stream.',
    { requestKey: UUID_ARG(), approvalId: UUID_ARG() },
    args => post('broadcasts', args),
    write,
  );
  register(
    'host_cup',
    'Host a paid four-fighter cup',
    'Queue three actual bouts. Credits settle on verified completion. Reuse the same requestKey after timeout; polling is free.',
    { requestKey: UUID_ARG(), broadcastId: UUID_ARG(), fighterIds: z.array(z.string().max(64)).length(4) },
    args => post('cups', args),
    write,
  );
  register(
    'get_broadcast',
    'Broadcast session',
    'Read stored accounting and observations. Do not infer live time or viewers from completed cups.',
    { broadcastId: UUID_ARG() },
    args => invoke(`commerce/broadcasts/${args.broadcastId}/report`),
  );
  register('get_broadcast_job', 'Broadcast job status', 'Inspect the same job before recovery. No new work or charge.', { jobId: UUID_ARG() }, args =>
    invoke(`commerce/jobs/${args.jobId}`),
  );
  register(
    'stop_broadcast',
    'Stop broadcast session',
    'Stop new work and release unused reservations. Running or uncertain allocations remain held until reconciliation.',
    { broadcastId: UUID_ARG() },
    args => post(`broadcasts/${args.broadcastId}/stop`, {}),
    { ...write, publish: true },
  );
  register(
    'get_broadcast_report',
    'Broadcast report',
    'Read the persisted spending report. Missing broadcast/viewer evidence must remain unverified.',
    { broadcastId: UUID_ARG() },
    args => invoke(`commerce/broadcasts/${args.broadcastId}/report`),
  );
}
