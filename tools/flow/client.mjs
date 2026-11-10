// @ts-check
// HTTP client for the loopback dummy server. It never uses a login session or a production origin.
import { assertDummyBase, DUMMY_MODE, DUMMY_SERVICE } from './seal.mjs';

/**
 * @param {string | URL} base
 * @param {{ fetchImpl?: typeof fetch }} [options]
 */
export async function createDummyClient(base, { fetchImpl = globalThis.fetch } = {}) {
  const url = assertDummyBase(base instanceof URL ? base.href : base);
  const request = async (
    /** @type {string} */ route,
    /** @type {{ method?: string, body?: any, headers?: Record<string, string>, timeoutMs?: number }} */ options = {},
  ) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(route) || route.startsWith('//')) throw new Error('dummy-route-refused');
    const target = new URL(route.replace(/^\//, ''), `${url.origin}/`);
    if (target.origin !== url.origin) throw new Error('dummy-route-refused');
    assertDummyBase(`${target.origin}/`);
    /** @type {Record<string, string>} */
    const headers = {};
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      if (/^(authorization|apikey|cookie|set-cookie)$/i.test(key)) continue;
      headers[key] = value;
    }
    headers['x-oddbout-dummy'] = '1';
    /** @type {Response} */
    let response;
    try {
      response = await fetchImpl(target, {
        method: options.method ?? 'GET',
        body: options.body,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
    } catch (/** @type {any} */ error) {
      if (error instanceof Error && error.message.startsWith('dummy-')) throw error;
      throw new Error('dummy-unreachable');
    }
    /** @type {any} */
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('dummy-response-unlabelled');
    }
    if (result?.mode !== DUMMY_MODE || result?.service !== DUMMY_SERVICE || result?.production !== false) throw new Error('dummy-response-unlabelled');
    if (!response.ok) {
      const error = /** @type {Error & { status?: number }} */ (new Error(typeof result.code === 'string' ? result.code : `api-http-${response.status}`));
      error.status = response.status;
      throw error;
    }
    return result;
  };
  const health = await request('dummy/health');
  if (health.ok !== true) throw new Error('dummy-handshake-failed');
  return { request };
}
