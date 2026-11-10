// @ts-check
import { readBody, UUID } from '../api/bytes.mjs';

const SITE_ORIGIN = 'https://oddbout.com';
const UPSTREAM = 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1';
const REGION = 'ap-southeast-1';
const TTL_SECONDS = 15;
const CACHE_VERSION = '1';
const STORED_AT = 'x-oddbout-cache-stored-at';
const MAX_BYTES = 128 * 1024;
const TIMEOUT_MS = 4_000;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/;
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'apikey'];
const PUBLIC_PATHS = new Set(['/api/ai-fighter/rankings', '/api/ai-fighter/roster', '/api/oddbout-arena/rankings']);
const REGION_HEADER = 'x-sb-edge-region';

/** The query to forward and cache, or null for an unsupported query. @param {URL} url */
function publicQuery(url) {
  const query = new URLSearchParams();
  if (!url.search) return query;
  if (url.search.length > 160 || url.search.includes('&')) return null;
  const [entry] = url.searchParams;
  if (!entry) return null;
  const [key, value] = entry;
  if (url.pathname === '/api/oddbout-arena/rankings' && key === 'scope' && value === 'registered') {
    query.set(key, value);
    return query;
  }
  if (url.pathname !== '/api/ai-fighter/roster' || key !== 'after') return null;
  const [timestamp, id, extra] = value.split('|');
  if (extra !== undefined || !TIMESTAMP.test(timestamp) || !UUID.test(id)) return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== timestamp.slice(0, 19)) return null;
  // Preserve the cursor's microseconds, which would be truncated by Date.toISOString().
  const canonicalTimestamp = timestamp
    .replace(/\+00:00$/, 'Z')
    .replace(/(\.\d*?[1-9])0+Z$/, '$1Z')
    .replace(/\.0+Z$/, 'Z');
  query.set(key, `${canonicalTimestamp}|${id.toLowerCase()}`);
  return query;
}

/** @param {BodyInit | null} body @param {number} status @param {'HIT' | 'MISS' | 'BYPASS'} result @param {number} [age] @param {string | null} [region] */
function reply(body, status, result, age, region) {
  const headers = new Headers({
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'access-control-allow-origin': SITE_ORIGIN,
    'access-control-expose-headers': 'x-oddbout-cache, x-oddbout-cache-age, x-sb-edge-region',
    'x-oddbout-cache': result,
  });
  if (age !== undefined) headers.set('x-oddbout-cache-age', String(Math.floor(age / 1000)));
  if (region) headers.set(REGION_HEADER, region);
  if (status === 405) headers.set('allow', 'GET');
  return new Response(body, { status, headers });
}

/** @param {number} status @param {string} code */
const fail = (status, code) => reply(JSON.stringify({ ok: false, code }), status, 'BYPASS');

/** Supabase's outer Cloudflare proxy can set its bot-management cookie on an otherwise public response. @param {Headers} headers */
function publicCookies(headers) {
  if (!headers.has('set-cookie')) return true;
  try {
    const cookies =
      typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : /** @type {Headers & { getAll?: (name: string) => string[] }} */ (headers).getAll?.('Set-Cookie');
    // Fail closed on unknown cookies, including an accidentally combined Set-Cookie field. Expires may contain a comma.
    return Boolean(cookies?.length && cookies.every(cookie => cookie.startsWith('__cf_bm=') && !/,\s*[^=;,\s]+\s*=/.test(cookie)));
  } catch {
    return false;
  }
}

/**
 * Serve allowlisted public reads. The cache stores only the verified body and its own metadata.
 * @param {Request} request
 * @param {{ fetcher?: typeof fetch, cache?: Pick<Cache, 'match' | 'put'>, timeoutMs?: number, clock?: () => number }} [options]
 */
export async function publicApiFetch(request, { fetcher = fetch, cache, timeoutMs = TIMEOUT_MS, clock = Date.now } = {}) {
  const url = new URL(request.url);
  if (!PUBLIC_PATHS.has(url.pathname)) return fail(404, 'not-found');
  if (request.method !== 'GET') return fail(405, 'method-not-allowed');
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== SITE_ORIGIN) return fail(403, 'origin-not-allowed');
  if (CREDENTIAL_HEADERS.some(name => request.headers.has(name))) return fail(400, 'credentials-not-allowed');
  const query = publicQuery(url);
  if (query === null) return fail(400, 'invalid-query');

  const upstream = new URL(UPSTREAM + url.pathname.slice('/api'.length));
  upstream.search = query.toString();
  const cacheUrl = new URL(url.pathname, url.origin);
  cacheUrl.search = upstream.search;
  cacheUrl.searchParams.set('__oddbout_public_api', CACHE_VERSION);
  const cacheKey = new Request(cacheUrl);
  const skipCache = /(?:^|,)\s*no-(?:cache|store)\s*(?:[,=]|$)/i.test(request.headers.get('cache-control') ?? '');
  let writable = skipCache ? undefined : cache;
  if (writable) {
    try {
      const hit = await writable.match(cacheKey);
      if (hit) {
        const storedAt = hit.headers.get(STORED_AT);
        const age = clock() - Number(storedAt);
        if (hit.status === 200 && storedAt !== null && age >= 0 && age < TTL_SECONDS * 1000)
          return reply(hit.body, 200, 'HIT', age, hit.headers.get(REGION_HEADER));
        void hit.body?.cancel().catch(() => {});
      }
    } catch {
      writable = undefined;
    }
  }

  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([request.signal, timeout]);
  try {
    const result = await fetcher(upstream, {
      headers: { accept: 'application/json', 'accept-encoding': 'identity', 'x-region': REGION },
      credentials: 'omit',
      redirect: 'manual',
      signal,
    });
    if (result.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(result.headers.get('content-type') ?? '')) {
      void result.body?.cancel().catch(() => {});
      return fail(result.status >= 400 ? result.status : 502, 'upstream-unavailable');
    }
    const bytes = await readBody(result, MAX_BYTES);
    signal.throwIfAborted();
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (data?.ok !== true) return fail(502, 'upstream-unavailable');
    const reportedRegion = result.headers.get(REGION_HEADER) ?? '';
    const region = /^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(reportedRegion) ? reportedRegion : null;
    if (writable && publicCookies(result.headers)) {
      try {
        await writable.put(
          cacheKey,
          new Response(bytes, {
            headers: {
              'content-type': 'application/json',
              'cache-control': `public, max-age=${TTL_SECONDS}`,
              [STORED_AT]: String(clock()),
              ...(region ? { [REGION_HEADER]: region } : {}),
            },
          }),
        );
        return reply(bytes, 200, 'MISS', 0, region);
      } catch {
        // The verified response still serves the request when the cache is unavailable.
      }
    }
    return reply(bytes, 200, 'BYPASS', undefined, region);
  } catch {
    return fail(timeout.aborted ? 504 : 502, 'upstream-unavailable');
  }
}
