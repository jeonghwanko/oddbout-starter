// @ts-check
import { gatewayFetch } from '../../worker/gateway-core.mjs';
export default {
  /** @param {Request} request */
  async fetch(request) {
    // The data center's cache keeps the metadata answers (MCP 최적화 2026-11-05): gateway-core.mjs gatewayFetch.
    const response = await gatewayFetch(request, { cache: /** @type {CacheStorage & { default: Cache }} */ (caches).default });
    if (!response) return fetch(request);
    // A cf-ray alone also appears on the Render fallback; this identifies actual Worker handling.
    response.headers.set('x-oddbout-gateway', 'cloudflare');
    return response;
  },
};
