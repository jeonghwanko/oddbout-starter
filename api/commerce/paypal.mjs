// @ts-check
// Sandbox only. Callers persist operation-specific request IDs before dispatch and
// reconcile uncertain outcomes with getOrder; this adapter never retries a POST.
import { encodeBase64 } from '../base64.mjs';

const ORIGIN = 'https://api-m.sandbox.paypal.com';
const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 10_000;

export class PayPalError extends Error {
  /** @param {string} code @param {{status?:number,outcomeUnknown?:boolean}} [options] */
  constructor(code, { status = 0, outcomeUnknown = false } = {}) {
    super(code);
    this.name = 'PayPalError';
    this.code = code;
    this.status = status;
    this.outcomeUnknown = outcomeUnknown;
  }
}

/** @param {unknown} value @returns {Record<string, any>} */
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PayPalError('paypal_invalid_response');
  return /** @type {Record<string, any>} */ (value);
}

/** @param {unknown} value @param {number} [max] @returns {string} */
function text(value, max = 127) {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new PayPalError('paypal_invalid_input');
  }
  return value;
}

/** @param {unknown} value @returns {string} */
function id(value) {
  const result = text(value);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new PayPalError('paypal_invalid_input');
  return result;
}

/** @param {number} amountMinor @param {string} currency */
function money(amountMinor, currency) {
  if (currency !== 'USD' || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new PayPalError('paypal_invalid_amount');
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, '0')}`;
}

/** Decimal strings only; never parse money through floating point.
 * @param {unknown} amount @param {number} expected @param {string} currency */
function matchesMoney(amount, expected, currency) {
  const record = object(amount);
  if (record.currency_code !== currency || typeof record.value !== 'string' || !/^(0|[1-9]\d*)\.\d{2}$/.test(record.value)) return false;
  return BigInt(record.value.replace('.', '')) === BigInt(expected);
}

/** Sandbox payout receivers are email addresses the server configures. @param {unknown} value */
export function payoutReceiver(value) {
  const result = text(value, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new PayPalError('paypal_invalid_input');
  return result;
}

/** @param {string} value */
function callbackUrl(value) {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password) throw new Error();
    return url.href;
  } catch { throw new PayPalError('paypal_invalid_callback_url'); }
}

/** @typedef {{orderId:string,referenceId:string,amountMinor:number,currency:string,merchantId:string}} OrderExpectation */
/** @param {unknown} order @param {OrderExpectation} expected @param {string} status */
function boundOrderUnit(order, expected, status) {
  object(expected); id(expected.orderId); text(expected.referenceId,256); id(expected.merchantId);
  money(expected.amountMinor, expected.currency);
  const value = object(order);
  const fail = () => { throw new PayPalError('paypal_capture_mismatch'); };
  if (value.id !== expected.orderId || value.status !== status || value.intent !== 'CAPTURE' || !Array.isArray(value.purchase_units) || value.purchase_units.length !== 1) fail();
  const unit = object(value.purchase_units[0]);
  if (unit.reference_id !== expected.referenceId || object(unit.payee).merchant_id !== expected.merchantId || !matchesMoney(unit.amount, expected.amountMinor, expected.currency)) fail();
  return unit;
}

/** Before a financial mutation, verify the approved canonical order's complete binding.
 * @param {unknown} order @param {OrderExpectation} expected */
export function validateApprovedOrder(order, expected) { boundOrderUnit(order,expected,'APPROVED'); }

/** Operator recovery of an unlinked provider order: verify the same merchant, intent, amount and currency.
 * This is validation only, never a payment approval. @param {unknown} order @param {OrderExpectation} expected */
export function validateOrderBinding(order, expected) {
  const value = object(order);
  if (!['CREATED','SAVED','APPROVED','VOIDED','COMPLETED','PAYER_ACTION_REQUIRED'].includes(value.status)) throw new PayPalError('paypal_capture_mismatch');
  boundOrderUnit(order, expected, value.status);
}

/** A recovered checkout must obey the same approval-link contract as a new checkout.
 * @param {unknown} order @param {string} orderId */
export function validatedApprovalUrl(order, orderId) {
  try {
    const value=object(order); id(orderId);
    if(value.id!==orderId) throw new Error();
    const link=(Array.isArray(value.links)?value.links:[]).find(item=>item?.rel==='payer-action'||item?.rel==='approve');
    const url=new URL(link?.href);
    if(url.origin!=='https://www.sandbox.paypal.com'||url.username||url.password||url.pathname!=='/checkoutnow'
      ||url.searchParams.getAll('token').length!==1||url.searchParams.get('token')!==orderId||url.hash)throw new Error();
    return url.href;
  } catch {throw new PayPalError('paypal_invalid_approval',{outcomeUnknown:true});}
}

/** Only use authenticated Sandbox API responses as input. No browser/webhook
 * payload alone establishes payment, environment, owner, or ledger uniqueness.
 * @param {unknown} order @param {OrderExpectation} expected */
export function validateCapturedOrder(order, expected) {
  const unit=boundOrderUnit(order,expected,'COMPLETED');
  const fail=()=>{throw new PayPalError('paypal_capture_mismatch');};
  const captures = object(unit.payments).captures;
  if (!Array.isArray(captures) || captures.length !== 1) fail();
  const capture = object(captures[0]);
  if (!matchesMoney(capture.amount, expected.amountMinor, expected.currency)) fail();
  if (capture.status === 'PENDING') throw new PayPalError('paypal_capture_pending', { outcomeUnknown: true });
  if (['DECLINED', 'FAILED'].includes(capture.status)) throw new PayPalError('paypal_capture_failed');
  if (capture.status !== 'COMPLETED' || capture.final_capture !== true || !matchesMoney(capture.amount, expected.amountMinor, expected.currency)) fail();
  // Some Orders responses also include capture payee/order linkage. If present,
  // they must agree; the purchase unit remains the required merchant binding.
  if (capture.payee && object(capture.payee).merchant_id !== expected.merchantId) fail();
  const related = capture.supplementary_data?.related_ids?.order_id;
  if (related !== undefined && related !== expected.orderId) fail();
  return { ...expected, captureId: id(capture.id) };
}

/** @param {{clientId:string,clientSecret:string,merchantId:string,fetch?:typeof globalThis.fetch,now?:()=>number}} options */
export function createPayPalSandbox({ clientId, clientSecret, merchantId, fetch: fetchImpl = globalThis.fetch, now = Date.now }) {
  text(clientId, 2048); text(clientSecret, 2048); id(merchantId);
  /** @type {{value:string,expiresAt:number}|undefined} */
  let token;
  /** @type {Promise<string>|undefined} */
  let tokenPending;

  /** @param {string} path @param {RequestInit} init @param {boolean} [mutation] @returns {Promise<Record<string,any>>} */
  async function request(path, init, mutation = false) {
    const controller = new AbortController();
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new PayPalError('paypal_timeout', { outcomeUnknown: mutation }));
      }, TIMEOUT_MS);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await fetchImpl(ORIGIN + path, { ...init, redirect: 'error', signal: controller.signal });
        if (!response.ok) {
          await response.body?.cancel();
          // Even a 422 may mean ORDER_ALREADY_CAPTURED after an earlier response
          // was lost. Reconcile the existing order rather than infer nonpayment.
          throw new PayPalError('paypal_http_error', { status: response.status, outcomeUnknown: mutation });
        }
        if (!response.body) throw new PayPalError('paypal_invalid_response', { outcomeUnknown: mutation });
        const reader = response.body.getReader();
        const chunks = []; let length = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            length += chunk.value.byteLength;
            if (length > MAX_BYTES) {
              void reader.cancel().catch(() => {});
              throw new PayPalError('paypal_response_too_large', { outcomeUnknown: mutation });
            }
            chunks.push(chunk.value);
          }
        } finally { reader.releaseLock(); }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        try { return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
        catch { throw new PayPalError('paypal_invalid_response', { outcomeUnknown: mutation }); }
      })()]).then(value => /** @type {Record<string,any>} */ (value));
    } catch (error) {
      if (error instanceof PayPalError) throw error;
      // Never expose fetch error text, upstream bodies, credentials or headers.
      throw new PayPalError('paypal_network_error', { outcomeUnknown: mutation });
    } finally { clearTimeout(timer); }
  }

  async function accessToken() {
    if (token && token.expiresAt > now()) return token.value;
    if (tokenPending) return tokenPending;
    tokenPending = (async () => {
      const result = await request('/v1/oauth2/token', {
        method: 'POST', headers: { Authorization: `Basic ${encodeBase64(new TextEncoder().encode(`${clientId}:${clientSecret}`))}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials',
      });
      if (typeof result.access_token !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(result.access_token) || typeof result.token_type !== 'string' || result.token_type.toLowerCase() !== 'bearer' || !Number.isSafeInteger(result.expires_in) || result.expires_in <= 0) throw new PayPalError('paypal_invalid_token_response');
      token = { value: result.access_token, expiresAt: now() + Math.max(0, Math.min(result.expires_in, 28_800) - 30) * 1000 };
      return token.value;
    })();
    try { return await tokenPending; } finally { tokenPending = undefined; }
  }

  /** @param {string} path @param {{method?:string,body?:object|string,requestId?:string,mutation?:boolean}} [options] */
  async function api(path, { method = 'GET', body, requestId, mutation = false } = {}) {
    const access = await accessToken();
    const result = await request(path, { method, headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) }, ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }, mutation);
    return result;
  }

  return {
    /** @param {{requestId:string,referenceId:string,amountMinor:number,currency:string,returnUrl:string,cancelUrl:string,description?:string,brandName?:string}} input */
    async createOrder(input) {
      const requestId = text(input.requestId, 108);
      const referenceId = text(input.referenceId, 256);
      const amount = { currency_code: input.currency, value: money(input.amountMinor, input.currency) };
      const order = await api('/v2/checkout/orders', { method: 'POST', requestId, mutation: true, body: {
        intent: 'CAPTURE', purchase_units: [{ reference_id: referenceId, amount, payee: { merchant_id: merchantId },
          ...(input.description === undefined ? {} : {description:text(input.description,127)}) }],
        payment_source: { paypal: { experience_context: { return_url: callbackUrl(input.returnUrl), cancel_url: callbackUrl(input.cancelUrl), shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW',
          ...(input.brandName === undefined ? {} : {brand_name:text(input.brandName,127)}) } } },
      } });
      try {
        const orderId = id(order.id);
        return { id: orderId, approvalUrl: validatedApprovalUrl(order,orderId) };
      } catch { throw new PayPalError('paypal_invalid_approval', { outcomeUnknown: true }); }
    },
    /** @param {{orderId:string,requestId:string}} input */
    async captureOrder({ orderId, requestId }) {
      return api(`/v2/checkout/orders/${id(orderId)}/capture`, { method: 'POST', requestId: text(requestId, 108), body: {}, mutation: true });
    },
    /** @param {string} orderId */
    async getOrder(orderId) { return api(`/v2/checkout/orders/${id(orderId)}`); },
    /** For the official PayPal MCP server process the reconciliation starts with read-only tools only. Never log it. */
    accessToken,
    /** Payouts v1. The caller persists the batch first and reuses requestId and senderBatchId on every retry.
     * @param {{senderBatchId:string,requestId:string,items:{receiver:string,amountMinor:number,currency:string,senderItemId:string,note:string}[]}} input */
    async createPayout({ senderBatchId, requestId, items }) {
      if (!Array.isArray(items) || !items.length || items.length > 100) throw new PayPalError('paypal_invalid_input');
      const result = await api('/v1/payments/payouts', { method: 'POST', requestId: text(requestId, 108), mutation: true, body: {
        sender_batch_header: { sender_batch_id: text(senderBatchId, 127), email_subject: 'ODDBOUT appearance fees (Sandbox)',
          email_message: 'Your fighter appeared in completed ODDBOUT Sandbox cups.' },
        items: items.map(item => ({ recipient_type: 'EMAIL', receiver: payoutReceiver(item.receiver),
          amount: { value: money(item.amountMinor, item.currency), currency: item.currency }, note: text(item.note, 4000), sender_item_id: id(item.senderItemId) })),
      } });
      try {
        const header = object(result.batch_header);
        return { payoutBatchId: id(header.payout_batch_id), status: id(header.batch_status) };
      } catch { throw new PayPalError('paypal_invalid_response', { outcomeUnknown: true }); }
    },
    /** @param {string} payoutBatchId */
    async getPayout(payoutBatchId) {
      const header = object((await api(`/v1/payments/payouts/${id(payoutBatchId)}`)).batch_header);
      return { payoutBatchId: id(header.payout_batch_id), status: id(header.batch_status), senderBatchId: header.sender_batch_header?.sender_batch_id ?? null };
    },
    /** Supply original UTF-8 request text to preserve signed event formatting.
     * @param {{headers:Headers|Record<string,string>,body:object|string,webhookId:string}} input */
    async verifyWebhook({ headers, body, webhookId }) {
      const source = new Headers(headers);
      if(['auth-algo','cert-url','transmission-id','transmission-sig','transmission-time'].some(name=>!source.get(`paypal-${name}`)))return false;
      /** @param {string} name */
      const header = name => text(source.get(`paypal-${name}`), 4096);
      const certUrl = header('cert-url');
      try {
        const url = new URL(certUrl);
        if (![ORIGIN, 'https://api.sandbox.paypal.com'].includes(url.origin) || !url.pathname.startsWith('/v1/notifications/certs/') || url.username || url.password || url.hash || url.search) return false;
      } catch { return false; }
      const rawEvent = typeof body === 'string' ? body : JSON.stringify(body);
      if (typeof rawEvent !== 'string' || new TextEncoder().encode(rawEvent).byteLength > MAX_BYTES) throw new PayPalError('paypal_webhook_too_large');
      try { object(JSON.parse(rawEvent)); } catch { throw new PayPalError('paypal_invalid_webhook'); }
      const metadata = { auth_algo: header('auth-algo'), cert_url: certUrl, transmission_id: header('transmission-id'), transmission_sig: header('transmission-sig'), transmission_time: header('transmission-time'), webhook_id: id(webhookId) };
      const payload = `${JSON.stringify(metadata).slice(0, -1)},"webhook_event":${rawEvent}}`;
      if (new TextEncoder().encode(payload).byteLength > MAX_BYTES) throw new PayPalError('paypal_webhook_too_large');
      const result = await api('/v1/notifications/verify-webhook-signature', { method: 'POST', body: payload });
      return result.verification_status === 'SUCCESS';
    },
  };
}
