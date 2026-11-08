// @ts-check
import { Problem, bearerToken, jsonResponse, logFailure, readBody, rpcCaller, sha256, verifiedUserId } from './http.mjs';
import { CLIENT_LIMITS } from './client-limit.mjs';

// Device-connection sign-in (RFC 8628 style) for a workspace the user's browser cannot reach.
//   POST /device-logins          workspace, no auth: secret deviceCode + public userCode
//   POST /device-logins/approve  homepage, signed-in user: approve that userCode for this user
//   POST /device-logins/token    workspace, no auth: poll with deviceCode; once approved, a one-use magic-link token hash
// Only the deviceCode's SHA-256 is stored. The userCode is public: approving needs the user's own sign-in.
export const DEVICE_LOGIN_TTL_SECONDS = 600;
export const DEVICE_POLL_INTERVAL_SECONDS = 5;
const ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const DEVICE_CODE = /^afd_[a-f0-9]{64}$/;
const APPROVE_CORS = { methods: 'POST, OPTIONS', headers: 'Authorization, Content-Type' };
/** @type {Record<string, number>} */
const errorStatus = { 'rate-limit': 429, 'slow-down': 429, 'device-login-not-found': 404, 'user-code-collision': 409 };

/** Letters only, no vowels or look-alikes; dashes, spaces and case are ignored. Null when invalid. */
/** @param {unknown} value */
export function normalizeUserCode(value) {
  const code = typeof value === 'string' ? value.toUpperCase().replace(/[\s-]/g, '') : '';
  return new RegExp(`^[${ALPHABET}]{8}$`).test(code) ? code : null;
}
/** @type {(code: string) => string} */
export const formatUserCode = code => `${code.slice(0, 4)}-${code.slice(4)}`;

/** A fresh code of eight letters (the host pairing's too, api/host-pairing.mjs). @param {(n: number) => Uint8Array} random */
export function newUserCode(random) {
  let code = '';
  // Rejection sampling keeps the 20 letters uniform.
  while (code.length < 8) for (const byte of random(16)) if (byte < 240 && code.length < 8) code += ALPHABET[byte % 20];
  return code;
}

/**
 * @param {{ db: any, creatorLink?: import('./http.mjs').CreatorLink | null, limiter?: import('./http.mjs').Limiter | null, random?: (n: number) => Uint8Array }} options
 * @returns {import('./http.mjs').Route}
 */
export function createDeviceLoginHandler({ db, creatorLink = null, limiter = null, random = n => crypto.getRandomValues(new Uint8Array(n)) }) {
  const rpc = rpcCaller(db, errorStatus, { unavailable: error => (error.code === 'PGRST202' ? 'device-login-not-ready' : 'device-login-unavailable') });
  /** @param {string} name @param {Record<string, unknown>} args */
  async function call(name, args) {
    const data = await rpc(name, args);
    if (!data || typeof data !== 'object') throw new Problem(503, 'device-login-unavailable');
    return data;
  }
  /** @param {Request} request */
  async function body(request) {
    const bytes = await readBody(request, 1000);
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {
      /* below */
    }
    throw new Problem(400, 'invalid-body');
  }
  /** @param {Request} request */
  async function start(request) {
    // Unauthenticated: one caller is braked by a keyed hash of their address, under the global 120 per 10 minutes.
    const { bucket, limit, windowSeconds } = CLIENT_LIMITS.deviceLogin;
    if (limiter && !(await limiter.allow(request, bucket, limit, windowSeconds))) throw new Problem(429, 'rate-limit');
    const deviceCode = `afd_${Array.from(random(32), b => b.toString(16).padStart(2, '0')).join('')}`;
    const hash = await sha256(new TextEncoder().encode(deviceCode));
    for (let attempt = 0; ; attempt++) {
      try {
        const row = await call('af_device_login_start', {
          p_device_code_hash: hash,
          p_user_code: newUserCode(random),
          p_ttl_seconds: DEVICE_LOGIN_TTL_SECONDS,
        });
        return {
          ok: true,
          stage: 'device-login',
          deviceCode,
          userCode: formatUserCode(row.userCode),
          expiresAt: row.expiresAt,
          interval: DEVICE_POLL_INTERVAL_SECONDS,
        };
      } catch (/** @type {any} */ error) {
        if (error.message !== 'user-code-collision' || attempt >= 2) throw error;
      }
    }
  }
  /** @param {Request} request */
  async function approve(request) {
    if (!bearerToken(request)) throw new Problem(401, 'authentication-required');
    const owner = await verifiedUserId(db, request);
    if (!owner) throw new Problem(401, 'authentication-required');
    const code = normalizeUserCode((await body(request)).userCode);
    if (!code) throw new Problem(400, 'invalid-user-code');
    const row = await call('af_device_login_approve', { p_owner: owner, p_user_code: code });
    return { ok: true, stage: 'device-login-approved', expiresAt: row.expiresAt };
  }
  /** @param {Request} request @returns {Promise<[Record<string, any>, number]>} */
  async function token(request) {
    const { deviceCode } = await body(request);
    if (typeof deviceCode !== 'string' || !DEVICE_CODE.test(deviceCode)) throw new Problem(400, 'invalid-device-code');
    const state = await call('af_device_login_poll', { p_device_code_hash: await sha256(new TextEncoder().encode(deviceCode)) });
    if (state.status === 'pending') return [{ ok: true, stage: 'device-login', status: 'pending', interval: DEVICE_POLL_INTERVAL_SECONDS }, 200];
    if (state.status === 'expired') throw new Problem(410, 'device-login-expired');
    if (state.status === 'consumed') throw new Problem(410, 'device-login-consumed');
    if (state.status !== 'approved' || typeof state.owner !== 'string') throw new Problem(503, 'device-login-unavailable');
    if (!creatorLink) throw new Problem(503, 'handoff-unavailable');
    // The approval is already spent: a failure here means starting over, never a second token.
    const link = await creatorLink(state.owner);
    if (!link || typeof link.tokenHash !== 'string' || !/^[a-f0-9]{40,128}$/.test(link.tokenHash)) throw new Problem(503, 'handoff-unavailable');
    return [{ ok: true, stage: 'device-login', status: 'approved', tokenHash: link.tokenHash, expiresAt: link.expiresAt }, 200];
  }
  return async (request, parts) => {
    const route = parts.join('/'),
      cors = route === 'device-logins/approve' ? APPROVE_CORS : undefined;
    /** @type {(value: any, status?: number) => Response} */
    const reply = (value, status = 200) => jsonResponse(value, status, cors);
    try {
      if (!['device-logins', 'device-logins/approve', 'device-logins/token'].includes(route)) return reply({ ok: false, code: 'not-found' }, 404);
      if (request.method === 'OPTIONS' && cors) return reply({ ok: true });
      if (request.method !== 'POST') return reply({ ok: false, code: 'method-not-allowed' }, 405);
      if (route === 'device-logins') return reply(await start(request));
      if (route === 'device-logins/approve') return reply(await approve(request));
      const [value, status] = await token(request);
      return reply(value, status);
    } catch (error) {
      logFailure('device-login', request, error);
      if (error instanceof Problem) return reply({ ok: false, code: error.message }, error.status);
      return reply({ ok: false, code: 'device-login-unavailable' }, 503);
    }
  };
}
