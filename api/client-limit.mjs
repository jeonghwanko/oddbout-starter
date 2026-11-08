// @ts-check
// Per-caller brakes for unauthenticated routes. Stores only a keyed hash of the caller's address (af_rate_hits).
//
// Which header carries the real address on Supabase Edge is an operator setting, not a guess in code:
// the first X-Forwarded-For entry is written by the client itself (github.com/orgs/supabase/discussions/34647),
// so it is never used. `source` is 'cf-connecting-ip' or 'forwarded-last' (the entry the edge proxy appended),
// chosen after a probe with spoofed headers. Without a source or secret the brake is off and only the
// global limits apply; a limiter fault also lets the request through to those global limits.
const SOURCES = ['cf-connecting-ip', 'forwarded-last'];
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/**
 * An IPv6 address's eight 16-bit groups, or null when it is not one. A dotted IPv4 tail (`::ffff:192.0.2.1`) is its last two groups.
 * @param {string} value  Lowercase.
 * @returns {number[] | null}
 */
function ipv6Groups(value) {
  let text = value;
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    if (!IPV4.test(dotted[2])) return null;
    const [a, b, c, d] = dotted[2].split('.').map(Number);
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const [head, tail] = halves.map(half => (half ? half.split(':') : []));
  const missing = 8 - head.length - (tail?.length ?? 0);
  // `::` stands for at least one group of zeros; without it the eight groups are all written.
  if (tail ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array(tail ? missing : 0).fill('0'), ...(tail ?? [])];
  return groups.every(group => /^[0-9a-f]{1,4}$/.test(group)) ? groups.map(group => parseInt(group, 16)) : null;
}

/**
 * The caller from the configured header, or null when it is missing or not an address. An IPv4 address is itself; an IPv6 address is
 * its /64 (`2001:db8:0:0::/64`): one host or network is given a whole /64, so keyed by address it had a fresh brake per request
 * (API 점검 2026-10-29). IPv4 written as IPv6 (`::ffff:198.51.100.7`) is that IPv4 address.
 * @param {Request} request
 * @param {string} source
 * @returns {string | null}
 */
export function clientAddress(request, source) {
  let value = /** @type {string | null} */ (null);
  if (source === 'cf-connecting-ip') value = request.headers.get('cf-connecting-ip');
  else if (source === 'forwarded-last') value = request.headers.get('x-forwarded-for')?.split(',').at(-1) ?? null;
  value = value?.trim().toLowerCase() ?? null;
  if (!value) return null;
  if (IPV4.test(value)) return value;
  const groups = value.includes(':') ? ipv6Groups(value) : null;
  if (!groups) return null;
  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff)
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.');
  return `${groups
    .slice(0, 4)
    .map(group => group.toString(16))
    .join(':')}::/64`;
}

/** @param {string} secret @param {string} text */
async function keyedHash(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * `allow(request, bucket, limit, windowSeconds)` resolves false only when this caller is over `limit` in the window.
 * `secret` must be at least 32 characters; it never leaves the Edge function.
 */
/**
 * @param {{ db: any, secret?: string, source?: string, now?: () => Date, warn?: (...args: any[]) => void }} options
 * @returns {import('./http.mjs').Limiter}
 */
export function createClientLimiter({ db, secret, source, now = () => new Date(), warn = console.warn }) {
  const enabled = typeof secret === 'string' && secret.length >= 32 && SOURCES.includes(/** @type {string} */ (source));
  return {
    enabled,
    async allow(request, bucket, limit, windowSeconds) {
      if (!enabled) return true;
      const address = clientAddress(request, /** @type {string} */ (source)); // enabled: source is one of SOURCES
      if (!address) return true; // Nothing to key on: the global brakes still apply.
      const day = now().toISOString().slice(0, 10);
      try {
        const { data, error } = await db.rpc('af_rate_hit', {
          p_bucket: bucket,
          p_key: await keyedHash(secret, `${bucket}|${day}|${address}`),
          p_limit: limit,
          p_window_seconds: windowSeconds,
        });
        if (error) throw error;
        return data !== false;
      } catch {
        warn(JSON.stringify({ stage: 'client-limit-unavailable', bucket }));
        return true;
      }
    },
  };
}

// The brakes in use. Each stays well under its route's global limit so one caller cannot spend it for everyone.
export const CLIENT_LIMITS = Object.freeze({
  duel: { bucket: 'duel-start', limit: 25, windowSeconds: 86_400 }, // global: 100 a day
  deviceLogin: { bucket: 'device-login-start', limit: 10, windowSeconds: 600 }, // global: 120 per 10 minutes
  hostPairing: { bucket: 'host-pairing-start', limit: 10, windowSeconds: 600 }, // global: 120 per 10 minutes
});
