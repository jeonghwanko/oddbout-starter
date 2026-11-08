// @ts-check
import { Problem, readBody } from '../http.mjs';

/** Private account purchases/media/Start; opaque public manifest only after explicit publication.
 * @param {{service:ReturnType<typeof import('./campaigns.mjs').createCampaignService>,publicOrigin:string,
 * authenticate:(request:Request)=>Promise<string|null>,
 * upload?:(owner:string,id:string,input:unknown)=>Promise<unknown>}} options */
export function createCampaignHandler({ service, publicOrigin, authenticate, upload }) {
  /** @type {Map<string,{count:number,until:number}>} */
  const rates = new Map();
  /** @param {string} id @param {number} max */
  function limit(id, max) {
    const now = Date.now();
    for (const [key, value] of rates) if (value.until <= now) rates.delete(key);
    const value = rates.get(id) ?? { count: 0, until: now + 60000 };
    if (value.count >= max || rates.size >= 10000) throw new Problem(429, 'too-many-requests');
    value.count++;
    rates.set(id, value);
  }
  return async (/** @type {Request} */ request) => {
    const url = new URL(request.url),
      route = url.pathname.split('/').filter(Boolean).slice(1),
      method = request.method;
    const json = (/** @type {unknown} */ data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          ...(status === 429 ? { 'retry-after': '60' } : {}),
        },
      });
    try {
      const origin = request.headers.get('origin');
      if (url.origin !== publicOrigin || (origin && origin !== publicOrigin)) throw new Problem(403, 'origin-not-allowed');
      let data;
      if (route.length === 1 && route[0] === 'catalog' && method === 'GET') return json({ ok: true, data: service.catalog() });
      if (route.length === 2 && route[0] === 'watch' && method === 'GET') return json({ ok: true, data: await service.manifest(route[1]) });
      const owner = await authenticate(request);
      if (!owner) throw new Problem(401, 'authentication-required');
      if (route.length === 1 && route[0] === 'calendar' && method === 'GET')
        return json({
          ok: true,
          data: await service.calendar(owner, {
            from: url.searchParams.get('from') ?? '',
            to: url.searchParams.get('to') ?? '',
            ...(url.searchParams.has('cursor') ? { cursor: url.searchParams.get('cursor') ?? '' } : {}),
          }),
        });
      let input = /** @type {Record<string,any>} */ ({});
      if (method === 'POST') {
        if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Problem(415, 'json-required');
        input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 16384)));
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Problem(422, 'invalid-input');
        if (origin !== publicOrigin) throw new Problem(403, 'web-approval-required');
        limit(owner, 60);
        if (['media', 'link'].includes(route[2])) limit(owner + ':media', 2);
        if (route[2] === 'upload') limit(owner + ':upload', 5);
      }
      const { confirmed, ...body } = input;
      const consent = () => {
        if (confirmed !== true) throw new Problem(403, 'web-approval-required');
      };
      if (route.length === 1 && route[0] === 'orders') {
        if (method === 'GET')
          data = await service.list(owner, {
            ...(url.searchParams.has('limit') ? { limit: Number(url.searchParams.get('limit')) } : {}),
            ...(url.searchParams.has('cursor') ? { cursor: url.searchParams.get('cursor') ?? '' } : {}),
          });
        else if (method === 'POST') {
          consent();
          data = await service.purchase(owner, body);
        } else throw new Problem(404, 'not-found');
      } else if (route.length === 2 && route[0] === 'orders' && method === 'GET') data = await service.get(owner, route[1]);
      else if (route.length === 3 && route[0] === 'orders' && route[2] === 'preview' && method === 'GET') data = await service.preview(owner, route[1]);
      else if (route.length === 3 && route[0] === 'orders' && route[2] === 'execution' && method === 'GET')
        data = await service.execution(owner, route[1], 'report');
      else if (route.length === 3 && route[0] === 'orders' && method === 'POST') {
        if (route[2] === 'media') {
          consent();
          data = await service.saveMedia(owner, route[1], body);
        } else if (route[2] === 'link') {
          consent();
          data = await service.saveLink(owner, route[1], body);
        } else if (route[2] === 'schedule') {
          consent();
          data = await service.schedule(owner, route[1], body);
        } else if (route[2] === 'start') {
          consent();
          data = await service.start(owner, route[1], body);
        } else if (['stop', 'reconcile', 'propose', 'pay', 'retry'].includes(route[2])) {
          consent();
          data = await service.execution(owner, route[1], /** @type {'stop'|'reconcile'|'propose'|'pay'|'retry'} */ (route[2]), body);
        } else if (route[2] === 'upload' && upload) {
          await service.get(owner, route[1]);
          data = await upload(owner, route[1], body);
        } else throw new Problem(404, 'not-found');
      } else throw new Problem(404, 'not-found');
      return json({ ok: true, data });
    } catch (error) {
      if (error instanceof Problem) return json({ ok: false, code: error.message }, error.status);
      if (error instanceof SyntaxError || error instanceof TypeError) return json({ ok: false, code: 'invalid-input' }, 422);
      return json({ ok: false, code: 'campaign-unavailable' }, 503);
    }
  };
}
