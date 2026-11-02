// @ts-check
import { Problem, readBody } from '../http.mjs';
import { PayPalError } from './paypal.mjs';

/** @typedef {ReturnType<typeof import('./service.mjs').createCommerceService>} Service */
/** @param {{service:Service,authenticate:(request:Request)=>Promise<string|null>,publicOrigin:string,agent?:boolean}} options */
export function createCommerceHandler({ service, authenticate, publicOrigin, agent = false }) {
  /** @param {Request} request @param {string[]} [segments] */
  return async (request, segments) => {
    const path = segments ?? new URL(request.url).pathname.split('/').filter(Boolean);
    const prefix = path.indexOf('commerce'), route = path.slice(prefix + 1), method = request.method;
    const origin = request.headers.get('origin');
    /** @param {any} value @param {number} [status] */
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: {
      'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      ...(origin === publicOrigin ? { 'access-control-allow-origin': origin, vary: 'Origin',
        'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type' } : {}),
    } });
    try {
      if (origin && origin !== publicOrigin) throw new Problem(403, 'origin-not-allowed');
      if (method === 'OPTIONS') return json({ ok: true });
      if (route.join('/') === 'webhook' && method === 'POST') {
        return json({ ok: true, ...await service.webhook(request.headers, new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 262144))) });
      }
      if (route.join('/') === 'catalog' && method === 'GET') return json({ ok: true, catalog: service.catalog() });
      const owner = await authenticate(request);
      if (!owner) throw new Problem(401, 'authentication-required');
      let body;
      if (method === 'POST') {
        if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Problem(415, 'json-required');
        body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 16384)));
      }
      let data;
      if (route.join('/') === 'wallet' && method === 'GET') data = await service.wallet(owner);
      else if (route.join('/') === 'checkout' && method === 'POST') data = await service.checkout(owner, body);
      else if (route.length === 3 && route[0] === 'topups' && route[2] === 'capture' && method === 'POST') data = await service.capture(owner, route[1]);
      else if (route.join('/') === 'quote' && method === 'POST') data = service.quote(body);
      else if (route.join('/') === 'approvals' && method === 'POST') {
        if (agent || origin !== publicOrigin || body?.confirmed !== true) throw new Problem(403, 'web-approval-required');
        data = await service.approve(owner, body);
      } else if (route.join('/') === 'broadcasts' && method === 'POST') data = await service.start(owner, body);
      else if (route.join('/') === 'cups' && method === 'POST') data = await service.cup(owner, body);
      else if (route.length === 3 && route[0] === 'broadcasts') {
        if (route[2] === 'stop' && method === 'POST') data = await service.stop(owner, route[1]);
        else if (route[2] === 'report' && method === 'GET') data = await service.report(owner, route[1]);
        else if (route[2] === 'jobs' && method === 'GET') data = await service.jobs(owner, route[1]);
        else throw new Problem(404, 'not-found');
      } else if (route.length === 2 && route[0] === 'jobs' && method === 'GET') data = await service.job(owner, route[1]);
      else throw new Problem(404, 'not-found');
      return json({ ok: true, data });
    } catch (error) {
      if (error instanceof Problem) return json({ ok: false, code: error.message }, error.status);
      if (error instanceof PayPalError) return json({ ok: false, code: error.code, outcomeUnknown: error.outcomeUnknown }, 502);
      if (error instanceof SyntaxError || error instanceof TypeError) return json({ ok: false, code: 'invalid-input' }, 422);
      return json({ ok: false, code: 'commerce-unavailable' }, 503);
    }
  };
}
