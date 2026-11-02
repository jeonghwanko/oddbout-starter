// @ts-check
// First-party HTTPS entry point for the same ODDBOUT MCP resource server.
// No admin key, arbitrary URL forwarding, cookies or payload logging.
import { randomUUID } from 'node:crypto';
// The addresses are the function's own (mcp/cloud/resources.mjs): one copy for both. The sign-in-first and directory addresses exist only at
// mcp.oddbout.com. Cursor's Grok Bot looks for the resource metadata at the host root, where RFC 9728 puts it
// (`/.well-known/oauth-protected-resource/<path>`); at the Supabase host that root is not ours and answers 401: the bot told its user
// ODDBOUT's login was down, dropped its sign-in and asked again (10-31, twice). Here the root is ours.
import { CLOUD_RESOURCE as UPSTREAM, LEGACY_PUBLIC_RESOURCE, PUBLIC_DIRECTORY_RESOURCE, PUBLIC_RESOURCE, PUBLIC_SIGN_IN_RESOURCE }
  from '../mcp/cloud/resources.mjs';
export { LEGACY_PUBLIC_RESOURCE, PUBLIC_DIRECTORY_RESOURCE, PUBLIC_RESOURCE, PUBLIC_SIGN_IN_RESOURCE };
const METADATA = '/.well-known/oauth-protected-resource';
/** Each fixed route and the upstream path it reaches; nothing else is forwarded. */
const ROUTES = new Map([['/mcp', ''], ['/mcp' + METADATA, METADATA], [METADATA + '/mcp', METADATA]]);
const SIGN_IN_ROUTES = new Map([['/signin', '/signin'], ['/signin' + METADATA, '/signin' + METADATA], [METADATA + '/signin', '/signin' + METADATA]]);
const DIRECTORY_ROUTES = new Map([['/claude', '/claude'], ['/claude' + METADATA, '/claude' + METADATA], [METADATA + '/claude', '/claude' + METADATA]]);
export const DOMAIN_CHALLENGE = 'c8ZJAeo0-MPwQFn6nJQ1rcg_qzCq_kxMyIcZJksSfrM';
export const BRANDED_DOMAIN_CHALLENGE = 'v4qUmFhpjDn1BF6ilHvAVROEnUfTK5XJMumPWkOK8PY';
// The upstream must answer with headers in HEADER_TIMEOUT_MS; a streamed (SSE) body may then run until TOTAL_TIMEOUT_MS,
// a little past the Edge function's own request limit. Before, 30 s covered the whole body and cut long streams off.
// The function answers each call as one JSON response, so its headers come when the tool is done: the header limit is the whole call's.
// The function ends a call by its own budget (CALL_BUDGET_MS, 25 s); 45 s leaves its sign-in check and answer room (MCP 점검 2026-11-03,
// when 30 s cut off an enter_cup that had made its cup).
const HEADER_TIMEOUT_MS = 45_000, TOTAL_TIMEOUT_MS = 160_000;
/**
 * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {typeof fetch} [fetcher]
 * @param {{ headerTimeoutMs?: number, totalTimeoutMs?: number }} [timeouts]
 */
export async function cloudGateway(req, res, fetcher = fetch, { headerTimeoutMs = HEADER_TIMEOUT_MS, totalTimeoutMs = TOTAL_TIMEOUT_MS } = {}) {
  const route = /** @type {string} */ (req.url); // always set on a request a server received
  // Our host whatever its case or explicit default port: the sign-in-first and directory routes exist only there.
  const branded = (req.headers.host ?? '').toLowerCase().replace(/:443$/, '') === 'mcp.oddbout.com', signIn = branded && SIGN_IN_ROUTES.has(route);
  const directory = branded && DIRECTORY_ROUTES.has(route);
  const path = signIn ? SIGN_IN_ROUTES.get(route) : directory ? DIRECTORY_ROUTES.get(route) : ROUTES.get(route);
  if (path === undefined && route !== '/.well-known/openai-apps-challenge') return false;
  /** @type {(status: number, body: string, type?: string) => void} */
  const reply = (status, body, type = 'application/json') => { res.writeHead(status, {'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'}); res.end(body); };
  if (route === '/.well-known/openai-apps-challenge') {
    const challenge = branded ? BRANDED_DOMAIN_CHALLENGE : DOMAIN_CHALLENGE;
    reply(req.method === 'GET' ? 200 : 405, req.method === 'GET' ? challenge : '', 'text/plain'); return true;
  }
  // HEAD too: Gemini CLI asks the sign-in-first address with HEAD before it connects.
  if (!['POST','GET','HEAD','OPTIONS'].includes(/** @type {string} */ (req.method))) { reply(405,'{}'); return true; }
  const control = new AbortController();
  const headerTimer = setTimeout(() => control.abort(), headerTimeoutMs), totalTimer = setTimeout(() => control.abort(), totalTimeoutMs);
  // A client that goes away (closes the stream) ends the upstream request too.
  res.once('close', () => { if (!res.writableFinished) control.abort(); });
  try {
    const resource = signIn ? PUBLIC_SIGN_IN_RESOURCE : directory ? PUBLIC_DIRECTORY_RESOURCE : branded ? PUBLIC_RESOURCE : LEGACY_PUBLIC_RESOURCE;
    // A request id of our own (never the client's) ties the function's log lines for this call together; the client gets it back.
    const requestId = randomUUID();
    const headers = new Headers({'x-oddbout-public-resource':resource,'x-request-id':requestId});
    // The client's user-agent too: without it the function's logs show only this gateway's, and which client called is what a sign-in diagnosis needs.
    for (const name of ['authorization','content-type','accept','origin','user-agent']) if (typeof req.headers[name] === 'string') headers.set(name,req.headers[name]);
    // Every Mcp-* header too: 2026-07-28 requests carry Mcp-Method and Mcp-Name beside MCP-Protocol-Version, and the SDK refuses one without them.
    for (const [name,value] of Object.entries(req.headers)) if (name.startsWith('mcp-') && typeof value === 'string') headers.set(name,value);
    const chunks=[]; let bytes=0;
    for await (const part of req) { bytes += part.length; if (bytes > 65536) { reply(413,'{"error":"body_limit"}'); return true; } chunks.push(part); }
    const response = await fetcher(UPSTREAM+path,{method:req.method,headers,redirect:'error',signal:control.signal,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})});
    clearTimeout(headerTimer);
    /** @type {Record<string, string>} */
    const responseHeaders = {'cache-control':'no-store','x-content-type-options':'nosniff','x-request-id':requestId};
    for (const name of ['content-type','www-authenticate','retry-after','allow','access-control-allow-origin','access-control-allow-methods','access-control-allow-headers','access-control-expose-headers']) if(response.headers.has(name)) responseHeaders[name]=/** @type {string} */ (response.headers.get(name));
    for (const [name,value] of response.headers) if (name.startsWith('mcp-')) responseHeaders[name]=value;
    res.writeHead(response.status,responseHeaders);
    for await (const part of response.body ?? []) res.write(part);
    res.end();
  } catch { if(!res.headersSent) reply(502,'{"error":"mcp_upstream_unavailable"}'); else res.end(); }
  finally { clearTimeout(headerTimer); clearTimeout(totalTimer); }
  return true;
}
