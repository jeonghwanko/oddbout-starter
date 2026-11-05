// @ts-check
import { Problem, bearerToken, jsonResponse, logFailure, readBody, rpcCaller, sha256, verifiedUserId } from './http.mjs';
import { CLIENT_LIMITS } from './client-limit.mjs';
import { text } from './canon.mjs';
import { formatUserCode, newUserCode, normalizeUserCode } from './device-login.mjs';

// 내 PC 연결, 코드 복사 없이 (2026-11-05): a generation PC pairs with its owner's account the way a workspace signs in (device-login.mjs).
//   POST generations/host/pairings           runner, no auth: { name, platform } → secret pairingCode, public userCode, the page to open
//   GET  generations/host/pairings/<code>    site, signed-in: the PC's name and OS while the code is open
//   POST generations/host/pairings/approve   site, signed-in: { userCode } → his host (made if none: a default name, the terms accepted)
//   POST generations/host/pairings/token     runner, no auth: { pairingCode } every five seconds; once approved, the worker key, once
// The database keeps the secret's hash and the approval's join code (`af_generation_host_join_code`); the key comes from the same
// `af_generation_host_join` a typed join code uses (supabase/migrations/20261105230000_oddbout_generation_host_pairings.sql).
export const PAIRING_TTL_SECONDS = 600;
export const PAIRING_POLL_INTERVAL_SECONDS = 5;
export const PAIRING_PAGE = 'https://oddbout.com/creator.html';
export const PAIRING_PLATFORMS = Object.freeze(['windows', 'macos', 'linux']);
const PAIRING_CODE = /^ohp_[a-f0-9]{64}$/;
const SITE_CORS = { methods: 'GET, POST, OPTIONS', headers: 'Authorization, Content-Type' };
/** @type {Record<string, number>} */
const errorStatus = { 'rate-limit': 429, 'slow-down': 429, 'pairing-not-found': 404, 'user-code-collision': 409, 'account-disabled': 403,
  'host-not-found': 404, 'invalid-host': 422, 'host-terms-required': 422, 'join-code-invalid': 410 };

/** @type {(bytes: Uint8Array) => string} */
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
/** @type {(value: string) => Promise<string>} */
const hashOf = value => sha256(new TextEncoder().encode(value));

/** @type {(parts: string[]) => boolean} Is this path a host pairing's? */
export const hostPairingRoute = parts => parts[0] === 'generations' && parts[1] === 'host' && parts[2] === 'pairings';

/**
 * @param {{ db: any, limiter?: import('./http.mjs').Limiter | null, random?: (n: number) => Uint8Array }} options
 * @returns {import('./http.mjs').Route}
 */
export function createHostPairingHandler({ db, limiter = null, random = n => crypto.getRandomValues(new Uint8Array(n)) }) {
  const rpc = rpcCaller(db, errorStatus, { unavailable: error => error.code === 'PGRST202' ? 'pairing-not-ready' : 'pairing-unavailable' });
  /** @param {string} name @param {Record<string, unknown>} args */
  async function call(name, args) {
    const data = await rpc(name, args);
    if (!data || typeof data !== 'object') throw new Problem(503, 'pairing-unavailable');
    return data;
  }
  /** @param {Request} request @param {string[]} allowed */
  async function body(request, allowed) {
    const bytes = await readBody(request, 1000);
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key))) return value;
    } catch { /* below */ }
    throw new Problem(400, 'invalid-body');
  }
  /** The signed-in owner (the site's routes). @param {Request} request */
  async function owner(request) {
    if (!bearerToken(request)) throw new Problem(401, 'authentication-required');
    const id = await verifiedUserId(db, request);
    if (!id) throw new Problem(401, 'authentication-required');
    return id;
  }
  /** @param {Request} request */
  async function start(request) {
    // No account: one caller is braked by a keyed hash of his address, under the database's 120 per 10 minutes for everyone.
    const { bucket, limit, windowSeconds } = CLIENT_LIMITS.hostPairing;
    if (limiter && !await limiter.allow(request, bucket, limit, windowSeconds)) throw new Problem(429, 'rate-limit');
    const { name, platform } = await body(request, ['name', 'platform']);
    // The PC's name as it says it (its host name): one line of 1-40 characters; the runner shortens a longer one.
    const pc = text(name, 40, '/name', { code: 'invalid-pc' });
    if (typeof platform !== 'string' || !PAIRING_PLATFORMS.includes(platform)) throw new Problem(422, 'invalid-pc');
    const pairingCode = `ohp_${hex(random(32))}`;
    for (let attempt = 0; ; attempt++) {
      try {
        const row = await call('af_generation_host_pairing_start', { p_secret_hash: await hashOf(pairingCode), p_user_code: newUserCode(random),
          p_pc_name: pc, p_platform: platform, p_ttl_seconds: PAIRING_TTL_SECONDS });
        const userCode = formatUserCode(row.userCode);
        return { ok: true, stage: 'host-pairing', pairingCode, userCode, expiresAt: row.expiresAt, interval: PAIRING_POLL_INTERVAL_SECONDS,
          url: `${PAIRING_PAGE}#pc=${userCode}` };
      } catch (/** @type {any} */ error) {
        if (error.message !== 'user-code-collision' || attempt >= 2) throw error;
      }
    }
  }
  /** @param {Request} request @param {string} typed */
  async function view(request, typed) {
    await owner(request);
    let decoded = '';
    try { decoded = decodeURIComponent(typed); } catch { /* not a code */ }
    const code = normalizeUserCode(decoded);
    if (!code) throw new Problem(400, 'invalid-user-code');
    const row = await call('af_generation_host_pairing_view', { p_user_code: code });
    return { ok: true, stage: 'host-pairing', pairing: { userCode: formatUserCode(row.userCode), name: row.name, platform: row.platform, expiresAt: row.expiresAt } };
  }
  /** @param {Request} request */
  async function approve(request) {
    const who = await owner(request);
    const code = normalizeUserCode((await body(request, ['userCode'])).userCode);
    if (!code) throw new Problem(400, 'invalid-user-code');
    // The join code's secret is never shown or kept: only its hash, which the PC's poll trades for the key.
    const row = await call('af_generation_host_pairing_approve', { p_owner: who, p_user_code: code, p_join_hash: await hashOf(`ohj_${hex(random(20))}`) });
    return { ok: true, stage: 'host-pairing-approved', host: row.host, pc: row.pc };
  }
  /** @param {Request} request @returns {Promise<[Record<string, any>, number]>} */
  async function token(request) {
    const { pairingCode } = await body(request, ['pairingCode']);
    if (typeof pairingCode !== 'string' || !PAIRING_CODE.test(pairingCode)) throw new Problem(400, 'invalid-pairing-code');
    // A key for every poll; the database keeps its hash only when this poll is the one that trades the approval.
    const key = `afw_${hex(random(32))}`;
    const state = await call('af_generation_host_pairing_poll', { p_secret_hash: await hashOf(pairingCode), p_key_hash: await hashOf(key) });
    if (state.status === 'pending') return [{ ok: true, stage: 'host-pairing', status: 'pending', interval: PAIRING_POLL_INTERVAL_SECONDS }, 200];
    if (state.status === 'expired') throw new Problem(410, 'pairing-expired');
    if (state.status === 'consumed') throw new Problem(410, 'pairing-consumed');
    if (state.status !== 'approved' || typeof state.host !== 'string') throw new Problem(503, 'pairing-unavailable');
    return [{ ok: true, stage: 'host-pairing', status: 'approved', key, host: state.host, name: state.name, approved: state.approved === true,
      expiresAt: state.expiresAt }, 200];
  }
  return async (request, parts) => {
    const route = parts.join('/'), site = parts.length === 4 && parts[3] !== 'token';
    /** @type {(value: any, status?: number) => Response} */
    const reply = (value, status = 200) => jsonResponse(value, status, site ? SITE_CORS : undefined);
    try {
      if (parts.length > 4) return reply({ ok: false, code: 'not-found' }, 404);
      if (request.method === 'OPTIONS' && site) return reply({ ok: true });
      if (route === 'generations/host/pairings') {
        if (request.method !== 'POST') return reply({ ok: false, code: 'method-not-allowed' }, 405);
        return reply(await start(request));
      }
      if (route === 'generations/host/pairings/approve' || route === 'generations/host/pairings/token') {
        if (request.method !== 'POST') return reply({ ok: false, code: 'method-not-allowed' }, 405);
        if (parts[3] === 'approve') return reply(await approve(request));
        const [value, status] = await token(request);
        return reply(value, status);
      }
      if (request.method !== 'GET') return reply({ ok: false, code: 'method-not-allowed' }, 405);
      return reply(await view(request, parts[3]));
    } catch (error) {
      logFailure('host-pairing', request, error);
      if (error instanceof Problem) return reply({ ok: false, code: error.message }, error.status);
      return reply({ ok: false, code: 'pairing-unavailable' }, 503);
    }
  };
}
