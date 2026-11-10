// @ts-check
import { publicApiFetch } from '../../worker/public-api.mjs';

export default {
  /** @param {Request} request */
  fetch(request) {
    return publicApiFetch(request, { cache: /** @type {CacheStorage & { default: Cache }} */ (caches).default });
  },
};
