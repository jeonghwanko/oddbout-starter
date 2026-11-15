// @ts-check
import { publicApiFetch } from '../../worker/public-api.mjs';

/** @param {{ request: Request }} context */
export async function onRequest({ request }) {
  const response = await publicApiFetch(request, { cache: /** @type {CacheStorage & { default: Cache }} */ (caches).default });
  response.headers.set('x-oddbout-api-runtime', 'pages-function');
  return response;
}
