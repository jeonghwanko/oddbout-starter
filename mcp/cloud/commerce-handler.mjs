// @ts-check
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createCommerceHandler } from '../../api/commerce/handler.mjs';
import { Problem, UUID } from '../../api/http.mjs';
import { registerCommerceTools } from './commerce-tools.mjs';
import { CALL_BUDGET_MS, output } from './common.mjs';

const PRODUCER_TOOLS = new Set(['get_credit_balance', 'get_broadcast_prices', 'get_broadcast', 'get_broadcast_job', 'get_broadcast_report', 'host_cup']);
const TOKEN = /^obp_[A-Za-z0-9_-]{32,256}$/;
/** Bound slow bodies by both credential lifetime and a short parsing window.
 * @param {Request} request @param {number} expiry @param {()=>number} now */
async function readProducerBody(request, expiry, now) {
  if (Number(request.headers.get('content-length')) > 65536) throw new Problem(413, 'body-limit');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const remaining = expiry - now(), expiresFirst = remaining <= 10000;
  /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
  /** @type {(()=>void)|undefined} */ let abort;
  try {
    return await Promise.race([(async () => {
      const parts = []; let length = 0;
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        length += chunk.value.byteLength; if (length > 65536) throw new Problem(413, 'body-limit');
        parts.push(chunk.value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
      return bytes;
    })(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Problem(expiresFirst ? 401 : 408, expiresFirst ? 'producer-credential-expired' : 'producer-request-timeout')), Math.max(1, Math.min(10000, remaining)));
      abort = () => reject(new Problem(408, 'producer-request-aborted'));
      if (request.signal.aborted) abort(); else request.signal.addEventListener('abort', abort, { once: true });
    })]).then(bytes => /** @type {Uint8Array<ArrayBuffer>} */ (bytes));
  } finally {
    clearTimeout(timer); if (abort) request.signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
/** @typedef {{owner:string,broadcastId:string,token:string,expiresAt:string}} ProducerCredential */
/** Isolated producer MCP. Server-provisioned opaque credentials are scoped to a
 * single already-approved session, and cannot authenticate human REST endpoints.
 * No user JWT, production connector grant, or request-supplied owner is accepted.
 * @param {{db?:any,commerce:{service:import('../../api/commerce/handler.mjs').Service,publicOrigin:string},producers?:readonly ProducerCredential[],now?:()=>number}} options
 * @returns {(request:Request)=>Promise<Response>} */
export function createCommerceMcpHandler({ commerce, producers = [], now = Date.now }) {
  const origin = new URL(commerce.publicOrigin);
  if (origin.origin !== commerce.publicOrigin || !(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) throw new Error('invalid-commerce-mcp-origin');
  const resource = `${origin.origin}/mcp`;
  if (!Array.isArray(producers) || producers.length > 1000) throw new Error('invalid-producer-credentials');
  const seen = new Set();
  const grants = producers.map(value => {
    if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['owner', 'broadcastId', 'token', 'expiresAt'].includes(key))
      || typeof value.owner !== 'string' || !UUID.test(value.owner) || typeof value.broadcastId !== 'string' || !UUID.test(value.broadcastId)
      || typeof value.token !== 'string' || !TOKEN.test(value.token) || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))
      || new Date(value.expiresAt).toISOString() !== value.expiresAt) throw new Error('invalid-producer-credentials');
    const digest = createHash('sha256').update(value.token).digest();
    if (seen.has(digest.toString('hex'))) throw new Error('invalid-producer-credentials');
    seen.add(digest.toString('hex'));
    return { owner: value.owner.toLowerCase(), broadcastId: value.broadcastId.toLowerCase(), digest, expiresAt: Date.parse(value.expiresAt) };
  });
  const clock = () => { const value = now(); if (!Number.isFinite(value)) throw new Problem(503, 'producer-clock-unavailable'); return value; };
  /** @param {typeof grants[number]} grant */
  async function sessionOf(grant) {
    if (grant.expiresAt <= clock()) throw new Problem(401, 'producer-credential-expired');
    const report = await commerce.service.report(grant.owner, grant.broadcastId);
    const session = report?.broadcast;
    if (!session || session.id !== grant.broadcastId || session.owner !== grant.owner || typeof session.endsAt !== 'string' || !Number.isFinite(Date.parse(session.endsAt))) throw new Problem(403, 'producer-session-scope');
    if (Math.min(grant.expiresAt, Date.parse(session.endsAt)) <= clock()) throw new Problem(401, 'producer-credential-expired');
    return report;
  }
  return async request => {
    const requestOrigin = request.headers.get('origin');
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      ...(requestOrigin === origin.origin ? { 'access-control-allow-origin': origin.origin, vary: 'Origin', 'access-control-expose-headers': 'WWW-Authenticate' } : {}) };
    /** @param {unknown} data @param {number} [status] @param {Record<string,string>} [extra] */
    const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'content-type': 'application/json', ...extra } });
    const url = new URL(request.url);
    if (url.origin !== origin.origin || (requestOrigin !== null && requestOrigin !== origin.origin)) return json({ error: 'origin_not_allowed' }, 403);
    if (url.pathname === '/mcp/.well-known/oauth-protected-resource' && request.method === 'GET') return json({ resource, resource_name: 'ODDBOUT Sandbox commerce', bearer_methods_supported: ['header'] });
    if (url.pathname !== '/mcp') return json({ error: 'not_found' }, 404);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type, MCP-Protocol-Version' } });
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST, OPTIONS' });
    const token = request.headers.get('authorization')?.match(/^Bearer (obp_[A-Za-z0-9_-]{32,256})$/)?.[1];
    let grant;
    if (token) {
      const digest = createHash('sha256').update(token).digest();
      for (const candidate of grants) if (timingSafeEqual(candidate.digest, digest)) grant = candidate;
    }
    const challenge = { 'www-authenticate': `Bearer resource_metadata="${resource}/.well-known/oauth-protected-resource"` };
    if (!grant) return json({ error: 'invalid_token', code: 'producer-credential-required' }, 401, challenge);
    let effectiveExpiry;
    try { const report = await sessionOf(grant); effectiveExpiry = Math.min(grant.expiresAt, Date.parse(report.broadcast.endsAt)); }
    catch (error) {
      if (error instanceof Problem && error.status === 401) return json({ error: 'invalid_token', code: error.message }, 401, challenge);
      if (error instanceof Problem && [403, 404].includes(error.status)) return json({ error: 'forbidden', code: 'producer-session-scope' }, 403);
      return json({ error: 'temporarily_unavailable', code: 'producer-session-check-unavailable' }, 503);
    }
    if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'json_required' }, 415);
    let body;
    try {
      const bytes = await readProducerBody(request, effectiveExpiry, clock);
      await sessionOf(grant);
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.method !== 'string') return json({ error: 'invalid_request' }, 400);
    } catch (error) {
      if (error instanceof Problem && error.status === 401) return json({ error: 'invalid_token', code: error.message }, 401, challenge);
      if (error instanceof Problem && [408, 413].includes(error.status)) return json({ error: 'invalid_request', code: error.message }, error.status);
      if (error instanceof Problem && [403, 404, 503].includes(error.status)) return json({ error: 'producer_session_unavailable' }, error.status === 503 ? 503 : 403);
      return json({ error: 'invalid_request' }, 400);
    }

    const activeGrant = grant;
    const api = createCommerceHandler({ service: commerce.service, publicOrigin: origin.origin, agent: true, authenticate: async () => activeGrant.owner });
    /** @type {import('./common.mjs').Invoke} */
    const invoke = async (path, method = 'GET', input, extraHeaders = {}) => {
      // The tool allowlist and route guard are independent. A later tool edit
      // cannot accidentally expose checkout, approval, start, stop or another session.
      if (method === 'GET' && ['commerce/wallet', 'commerce/catalog', `commerce/broadcasts/${activeGrant.broadcastId}/report`].includes(path)) { /* Scoped read. */ }
      else if (method === 'POST' && path === 'commerce/cups') {
        const payload = JSON.parse(String(input));
        if (payload.broadcastId?.toLowerCase() !== activeGrant.broadcastId) throw new Problem(403, 'producer-session-scope');
      } else if (method === 'GET' && /^commerce\/jobs\/[a-f0-9-]{36}$/i.test(path)) {
        const job = await commerce.service.job(activeGrant.owner, path.split('/').at(-1) ?? '');
        if (job.broadcastId !== activeGrant.broadcastId || job.owner !== activeGrant.owner) throw new Problem(403, 'producer-session-scope');
      } else throw new Problem(403, 'producer-tool-not-allowed');
      const response = await api(new Request(`${origin.origin}/${path}`, { method, headers: extraHeaders, ...(input === undefined ? {} : { body: input }) }));
      return response.json();
    };
    const server = new McpServer({ name: 'oddbout-sandbox-commerce', version: '1.0.0' }, { instructions: 'Producer for one already-approved Sandbox session only. You may read its state and queue host_cup within its fixed budget. Payment, approval, start, stop and session changes stay in the human console. Reuse request keys after interruption and reconcile unknown outcomes; never claim verified live time without observations.' });
    /** @type {import('./common.mjs').Register} */
    const register = (name, title, description, inputSchema, run, { write = false, publish = false, openWorld = false, idempotent = !write } = {}) => {
      if (!PRODUCER_TOOLS.has(name)) return;
      server.registerTool(name, { title, description, inputSchema: /** @type {import('zod').ZodRawShape} */ (inputSchema), annotations: { readOnlyHint: !write, destructiveHint: publish, openWorldHint: openWorld, idempotentHint: idempotent } }, async (/** @type {Record<string,unknown>} */ args, /** @type {{ signal?: AbortSignal } | undefined} */ extra) => {
        /** @type {import('./common.mjs').ToolContext} */
        const context = { signal: extra?.signal ?? new AbortController().signal, deadline: Date.now() + CALL_BUDGET_MS };
        try {
          await sessionOf(activeGrant);
          if (['host_cup', 'get_broadcast', 'get_broadcast_report'].includes(name) && (typeof args.broadcastId !== 'string' || args.broadcastId.toLowerCase() !== activeGrant.broadcastId)) throw new Problem(403, 'producer-session-scope');
          const scopedArgs = ['host_cup', 'get_broadcast', 'get_broadcast_report'].includes(name) ? { ...args, broadcastId: activeGrant.broadcastId } : args;
          return output(await run(/** @type {Parameters<typeof run>[0]} */ (scopedArgs), context));
        } catch (error) { return output({ ok: false, code: error instanceof Problem ? error.message : 'commerce-unavailable' }); }
      });
    };
    registerCommerceTools({ register, invoke });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request, { parsedBody: body });
      const merged = new Headers(response.headers);
      for (const [key, value] of Object.entries(headers)) merged.set(key, value);
      return new Response(response.body, { status: response.status, headers: merged });
    } catch { return json({ error: 'mcp_unavailable' }, 503); }
    finally { await server.close(); }
  };
}
