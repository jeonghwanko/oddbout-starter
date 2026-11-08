// @ts-check
import { createCommerceStore } from './store.mjs';
import { createPayPalSandbox } from './paypal.mjs';
import { createCommerceService } from './service.mjs';

/** @param {{db:any,get:(name:string)=>string|undefined}} options */
export function commerceFromEnvironment({ db, get }) {
  if (get('ODDBOUT_COMMERCE_ENABLED') !== '1') return null;
  const publicOrigin = get('ODDBOUT_COMMERCE_ORIGIN');
  if (!publicOrigin) throw new Error('commerce-origin-required');
  const hostIds = (get('ODDBOUT_BROADCAST_HOST_IDS') ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
  if (!hostIds.length || hostIds.some(id => !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id))) throw new Error('commerce-hosts-required');
  const clientId = get('PAYPAL_SANDBOX_CLIENT_ID'),
    clientSecret = get('PAYPAL_SANDBOX_CLIENT_SECRET'),
    merchantId = get('PAYPAL_SANDBOX_MERCHANT_ID');
  const partial = [clientId, clientSecret, merchantId].filter(Boolean).length;
  if (partial && partial !== 3) throw new Error('paypal-incomplete-configuration');
  const paypal =
    partial === 3
      ? createPayPalSandbox({
          clientId: /** @type {string} */ (clientId),
          clientSecret: /** @type {string} */ (clientSecret),
          merchantId: /** @type {string} */ (merchantId),
        })
      : null;
  const store = createCommerceStore(db);
  return {
    publicOrigin,
    store,
    paypal,
    merchantId: merchantId ?? '',
    service: createCommerceService({
      store,
      paypal,
      merchantId,
      publicOrigin,
      webhookId: get('PAYPAL_SANDBOX_WEBHOOK_ID'),
      hosts: [...new Set(hostIds)].map(id => ({ id })),
    }),
  };
}
