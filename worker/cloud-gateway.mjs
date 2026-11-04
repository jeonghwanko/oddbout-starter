// @ts-check
// Node adapter; routing, limits and header policy live in gateway-core.mjs.
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gatewayFetch, gatewayRoute, gatewayReply, readGatewayBody, GATEWAY_METHODS } from './gateway-core.mjs';
export { DOMAIN_CHALLENGE, BRANDED_DOMAIN_CHALLENGE, LEGACY_PUBLIC_RESOURCE, PUBLIC_DIRECTORY_RESOURCE, PUBLIC_RESOURCE, PUBLIC_SIGN_IN_RESOURCE } from './gateway-core.mjs';
/**
 * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {typeof fetch} [fetcher]
 * @param {{ headerTimeoutMs?: number, totalTimeoutMs?: number }} [timeouts]
 */
export async function cloudGateway(req, res, fetcher = fetch, timeouts = {}) {
  const path = req.url ?? '', host = req.headers.host ?? '';
  const route = gatewayRoute(host, path);
  if (!route) return false;
  const control = new AbortController();
  const close = () => { if (!res.writableFinished) control.abort(); };
  res.once('close', close);
  let bodyTimer;
  try {
    const method = req.method ?? 'GET';
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
    // Request disallows CONNECT/TRACE; represent unsupported methods by DELETE for the core's 405.
    const init = /** @type {RequestInit & { duplex?: string }} */ ({ method: GATEWAY_METHODS.includes(method) ? method : 'DELETE', headers, signal: control.signal });
    if (method === 'POST') { init.body = /** @type {ReadableStream<Uint8Array>} */ (Readable.toWeb(req)); init.duplex = 'half'; }
    // Fetch Request forbids GET/HEAD bodies; the Node gateway still bounds and discards them.
    bodyTimer = setTimeout(() => control.abort(), timeouts.headerTimeoutMs ?? 45_000);
    const extraBody = !route.challenge && method !== 'POST' && GATEWAY_METHODS.includes(method)
      ? await readGatewayBody(/** @type {ReadableStream<Uint8Array>} */ (Readable.toWeb(req)), control.signal) : new Uint8Array();
    clearTimeout(bodyTimer);
    const response = extraBody === null ? gatewayReply(413, '{"error":"body_limit"}')
      : await gatewayFetch(new Request(`https://${route.branded ? 'mcp.oddbout.com' : 'gateway.invalid'}${path}`, init), { fetcher, ...timeouts });
    if (!response) return false;
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) await pipeline(Readable.fromWeb(/** @type {import('node:stream/web').ReadableStream} */ (response.body)), res);
    else res.end();
  } catch {
    control.abort();
    if (!res.headersSent) { res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end('{"error":"mcp_upstream_unavailable"}'); }
    else res.end();
  } finally { clearTimeout(bodyTimer); res.removeListener('close', close); }
  return true;
}
