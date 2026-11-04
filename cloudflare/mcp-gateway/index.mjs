// @ts-check
import { gatewayFetch } from '../../worker/gateway-core.mjs';
export default {
  /** @param {Request} request */
  async fetch(request) {
    const response = await gatewayFetch(request);
    if (!response) return fetch(request);
    // A cf-ray alone also appears on the Render fallback; this identifies actual Worker handling.
    response.headers.set('x-oddbout-gateway', 'cloudflare');
    return response;
  },
};
