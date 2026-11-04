// @ts-check
// Runtime-independent policy shared by Render and Cloudflare. No arbitrary upstreams.
import { CLOUD_RESOURCE as UPSTREAM, LEGACY_PUBLIC_RESOURCE, PUBLIC_DIRECTORY_RESOURCE, PUBLIC_RESOURCE, PUBLIC_SIGN_IN_RESOURCE }
  from '../mcp/cloud/resources.mjs';
export { LEGACY_PUBLIC_RESOURCE, PUBLIC_DIRECTORY_RESOURCE, PUBLIC_RESOURCE, PUBLIC_SIGN_IN_RESOURCE };
const METADATA = '/.well-known/oauth-protected-resource';
const ROUTES = new Map([['/mcp', ''], ['/mcp' + METADATA, METADATA], [METADATA + '/mcp', METADATA]]);
const SIGN_IN_ROUTES = new Map([['/signin', '/signin'], ['/signin' + METADATA, '/signin' + METADATA], [METADATA + '/signin', '/signin' + METADATA]]);
const DIRECTORY_ROUTES = new Map([['/claude', '/claude'], ['/claude' + METADATA, '/claude' + METADATA], [METADATA + '/claude', '/claude' + METADATA]]);
export const DOMAIN_CHALLENGE = 'c8ZJAeo0-MPwQFn6nJQ1rcg_qzCq_kxMyIcZJksSfrM';
export const BRANDED_DOMAIN_CHALLENGE = 'v4qUmFhpjDn1BF6ilHvAVROEnUfTK5XJMumPWkOK8PY';
export const GATEWAY_METHODS = ['POST', 'GET', 'HEAD', 'OPTIONS'];
/** Match the raw path before the Node Request constructor normalizes it. @param {string} host @param {string} route */
export function gatewayRoute(host, route) {
  const branded = host.toLowerCase().replace(/:443$/, '') === 'mcp.oddbout.com';
  const signIn = branded && SIGN_IN_ROUTES.has(route), directory = branded && DIRECTORY_ROUTES.has(route);
  const path = signIn ? SIGN_IN_ROUTES.get(route) : directory ? DIRECTORY_ROUTES.get(route) : ROUTES.get(route);
  if (path === undefined && route !== '/.well-known/openai-apps-challenge') return null;
  return { path, branded, challenge: route === '/.well-known/openai-apps-challenge',
    resource: signIn ? PUBLIC_SIGN_IN_RESOURCE : directory ? PUBLIC_DIRECTORY_RESOURCE : branded ? PUBLIC_RESOURCE : LEGACY_PUBLIC_RESOURCE };
}
/** @param {number} status @param {string} body @param {string} [type] */
export function gatewayReply(status, body, type = 'application/json') {
  return new Response(body || null, { status, headers: { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
/** Read at most 64 KiB, including bodies with no Content-Length. @param {ReadableStream<Uint8Array> | null} body @param {AbortSignal} signal */
export async function readGatewayBody(body, signal) {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const chunks = []; let bytes = 0;
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65_536) { void reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
    const result = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}
/**
 * @param {Request} request
 * @param {{ fetcher?: typeof fetch, headerTimeoutMs?: number, totalTimeoutMs?: number }} [options]
 * @returns {Promise<Response | null>}
 */
export async function gatewayFetch(request, { fetcher = fetch, headerTimeoutMs = 45_000, totalTimeoutMs = 160_000 } = {}) {
  const url = new URL(request.url);
  // Keep even an empty '?' significant; only exact, fixed paths belong to the gateway.
  const route = gatewayRoute(url.hostname, request.url.slice(url.origin.length));
  if (!route) return null;
  if (route.challenge) return gatewayReply(request.method === 'GET' ? 200 : 405,
    request.method === 'GET' ? (route.branded ? BRANDED_DOMAIN_CHALLENGE : DOMAIN_CHALLENGE) : '', 'text/plain');
  if (!GATEWAY_METHODS.includes(request.method)) return gatewayReply(405, '{}');
  const control = new AbortController();
  const abort = () => control.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  const headerTimer = setTimeout(abort, headerTimeoutMs), totalTimer = setTimeout(abort, totalTimeoutMs);
  const cleanup = () => { clearTimeout(headerTimer); clearTimeout(totalTimer); request.signal.removeEventListener('abort', abort); };
  try {
    const requestId = crypto.randomUUID();
    const headers = new Headers({ 'x-oddbout-public-resource': route.resource, 'x-request-id': requestId });
    for (const [name, value] of request.headers) {
      if (['authorization', 'content-type', 'accept', 'origin', 'user-agent'].includes(name) || name.startsWith('mcp-')) headers.set(name, value);
    }
    // Both runtimes must receive a decoded upstream body; compression is negotiated again at the edge.
    headers.set('accept-encoding', 'identity');
    const body = await readGatewayBody(request.body, control.signal);
    if (body === null) { cleanup(); return gatewayReply(413, '{"error":"body_limit"}'); }
    // Workers supports manual, not error. Reject redirects without sending credentials onward.
    const response = await fetcher(UPSTREAM + route.path, { method: request.method, headers, redirect: 'manual', signal: control.signal,
      ...(request.method === 'POST' ? { body } : {}) });
    clearTimeout(headerTimer);
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => {});
      throw new Error('upstream-redirect');
    }
    const responseHeaders = new Headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-request-id': requestId });
    for (const [name, value] of response.headers) {
      if (['content-type', 'www-authenticate', 'retry-after', 'allow', 'access-control-allow-origin', 'access-control-allow-methods',
        'access-control-allow-headers', 'access-control-expose-headers'].includes(name) || name.startsWith('mcp-')) responseHeaders.set(name, value);
    }
    if (!response.body || request.method === 'HEAD' || [204, 205, 304].includes(response.status)) {
      void response.body?.cancel().catch(() => {});
      cleanup(); return new Response(null, { status: response.status, headers: responseHeaders });
    }
    const reader = response.body.getReader();
    /** @type {() => void} */ let streamAbort;
    const finish = () => { control.signal.removeEventListener('abort', streamAbort); cleanup(); };
    const stream = new ReadableStream({
      start(controller) {
        streamAbort = () => { controller.error(new Error('mcp_upstream_unavailable')); void reader.cancel().catch(() => {}); finish(); };
        control.signal.addEventListener('abort', streamAbort, { once: true });
        if (control.signal.aborted) streamAbort();
      },
      async pull(controller) {
        try {
          const { value, done } = await reader.read();
          if (control.signal.aborted) return;
          if (done) { finish(); controller.close(); } else controller.enqueue(value);
        } catch { finish(); controller.error(new Error('mcp_upstream_unavailable')); }
      },
      cancel() { finish(); control.abort(); return reader.cancel().catch(() => {}); },
    });
    return new Response(stream, { status: response.status, headers: responseHeaders });
  } catch {
    cleanup(); control.abort(); return gatewayReply(502, '{"error":"mcp_upstream_unavailable"}');
  }
}
