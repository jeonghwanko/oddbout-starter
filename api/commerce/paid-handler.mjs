// @ts-check
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Problem, readBody } from '../http.mjs';
import { PayPalError } from './paypal.mjs';
import { operationId } from './paid-operations.mjs';

/** @param {string} token */
const hash = token => createHash('sha256').update(token).digest('hex');
/** Separate credential/route boundary: device grants can only discover, prepare and resume paid tasks.
 * They cannot approve, buy credit packs, access the human commerce API or use producer tools.
 * @param {{service:ReturnType<typeof import('./paid-operations.mjs').createPaidOperations>,
 * store:ReturnType<typeof import('./store.mjs').createCommerceStore>,publicOrigin:string,
 * authenticate:(request:Request)=>Promise<string|null>}} options */
export function createPaidOperationHandler({ service, store, publicOrigin, authenticate }) {
  return async (/** @type {Request} */ request) => {
    const url = new URL(request.url), [prefix, ...route] = url.pathname.split('/').filter(Boolean);
    const agent = prefix === 'paid-agent', origin = request.headers.get('origin'), method = request.method;
    const json = (/** @type {any} */ data, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
    try {
      if (url.origin !== publicOrigin || (origin && origin !== publicOrigin)) throw new Problem(403, 'origin-not-allowed');
      if (!['paid-agent', 'paid-operations'].includes(prefix)) throw new Problem(404, 'not-found');
      let body = {};
      if (method === 'POST') {
        if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Problem(415, 'json-required');
        body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 16384)));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Problem(422, 'invalid-input');
      }
      const input = /** @type {Record<string,any>} */ (body), path = route.join('/');
      if (agent && path === 'connect' && method === 'POST') {
        if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 64) throw new Problem(422, 'invalid-input');
        const token = `obt_${randomBytes(32).toString('base64url')}`, id = randomUUID(), userCode = randomBytes(4).toString('hex').toUpperCase();
        const device = await store.operationDevice(null, 'begin', { id, userCode, label: input.label, secretHash: hash(token) });
        // Only the local MCP transport receives token. It must never emit it to its caller/model or save it in a URL.
        return json({ ok: true, data: { token, userCode, expiresAt: device.approveBy,
          verificationUrl: `${publicOrigin}/broadcast/tasks/#device=${id}&code=${userCode}` } });
      }
      let owner;
      if (agent) {
        const token = request.headers.get('authorization')?.match(/^Bearer (obt_[A-Za-z0-9_-]{43})$/)?.[1];
        if (!token) throw new Problem(401, 'device-connection-required');
        const device = await store.operationDevice(null, 'authenticate', { secretHash: hash(token) });
        if (path === 'status' && method === 'GET') return json({ ok: true, data: { state: device.state, expiresAt: device.expiresAt } });
        owner = device.owner;
      } else owner = await authenticate(request);
      if (!owner) throw new Problem(401, agent ? 'device-approval-required' : 'authentication-required');
      // A credential's scope is enforced here independently of the MCP tool list.
      const humanConsent = () => {
        if (agent || origin !== publicOrigin || input.confirmed !== true) throw new Problem(403, 'web-approval-required');
      };
      let data;
      if (path === 'catalog' && method === 'GET') data = service.catalog();
      else if (path === 'operations' && method === 'GET') data = await service.list(owner);
      else if (path === 'operations' && method === 'POST') data = await service.prepare(owner, input);
      else if (route[0] === 'operations' && route.length >= 2 && route.length <= 3) {
        const id = operationId(route[1]), action = route[2];
        if (method === 'GET' && !action) data = await service.get(owner, id);
        else if (method === 'POST' && action === 'resume') data = await service.resume(owner, id);
        else if (method === 'POST' && action === 'reconcile' && !agent) data = await service.reconcile(owner, id);
        else if (method === 'POST' && ['approve', 'cancel', 'checkout'].includes(action)) {
          humanConsent();
          data = action === 'approve' ? await service.approve(owner, id)
            : action === 'cancel' ? await service.cancel(owner, id) : await service.checkout(owner, id);
        } else throw new Problem(404, 'not-found');
      } else if (!agent && path === 'devices' && method === 'GET') data = await store.operationDevice(owner, 'list');
      else if (!agent && path === 'devices/approve' && method === 'POST') {
        humanConsent();
        if (!/^[A-F0-9]{8}$/.test(input.userCode)) throw new Problem(422, 'invalid-input');
        data = await store.operationDevice(owner, 'approve', { id: operationId(input.id), userCode: input.userCode });
      } else if (!agent && path === 'devices/revoke' && method === 'POST') {
        humanConsent(); data = await store.operationDevice(owner, 'revoke', { id: operationId(input.id) });
      } else throw new Problem(404, 'not-found');
      return json({ ok: true, data });
    } catch (error) {
      if (error instanceof Problem) return json({ ok: false, code: error.message }, error.message === 'device-expired' ? 401 : error.status);
      if (error instanceof PayPalError) return json({ ok: false, code: error.code, outcomeUnknown: error.outcomeUnknown }, 502);
      if (error instanceof SyntaxError || error instanceof TypeError) return json({ ok: false, code: 'invalid-input' }, 422);
      return json({ ok: false, code: 'paid-operations-unavailable' }, 503);
    }
  };
}
