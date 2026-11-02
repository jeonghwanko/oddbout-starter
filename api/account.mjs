// @ts-check
import { Problem, bearerToken, jsonResponse, logFailure, readBody, rpcCaller, verifiedUserId } from './http.mjs';

const CORS = { methods: 'GET, POST, OPTIONS', headers: 'Authorization, Content-Type' };
/** @type {(body: any, status?: number) => Response} */
const reply = (body, status = 200) => jsonResponse(body, status, CORS);
const NOTE_LIMIT = 500;
/** @type {Record<string, number>} */
const errorStatus = { 'already-invited': 409, 'request-declined': 409, 'rate-limit': 429, 'note-too-long': 422 };
/** @type {Record<string, string>} */
const ROUTES = { me: 'GET', 'access-requests': 'POST', 'creator-handoffs': 'POST' };

/**
 * GET /me, POST /access-requests and POST /creator-handoffs. Any signed-in, non-anonymous user may call them:
 * invitations are retired; access-requests remains a compatibility alias for the current account state.
 * creatorLink(owner) mints a one-use sign-in token for the creator homepage; the browser redeems it with Supabase Auth.
 */
/**
 * An account's tokens as the database states them (`af_generation_balance`), whole numbers only; null otherwise.
 * @param {unknown} value
 * @returns {{ granted: number, spent: number, balance: number } | null}
 */
export function accountTokens(value) {
  const row = /** @type {Record<string, unknown> | null} */ (value && typeof value === 'object' ? value : null);
  const [granted, spent, balance] = ['granted', 'spent', 'balance'].map(key => Number(row?.[key]));
  return Number.isSafeInteger(granted) && Number.isSafeInteger(spent) && Number.isSafeInteger(balance) && granted >= 0 && spent >= 0
    ? { granted, spent, balance } : null;
}

/**
 * @param {{ db: any, creatorLink?: import('./http.mjs').CreatorLink | null }} options
 * @returns {import('./http.mjs').Route}
 */
export function createAccountHandler({ db, creatorLink = null }) {
  const rpc = rpcCaller(db, errorStatus, { unavailable: error => error.code === 'PGRST202' ? 'account-not-ready' : 'account-unavailable' });
  /** @param {string} name @param {Record<string, unknown>} args */
  async function call(name, args) {
    const data = await rpc(name, args);
    if (!data || typeof data !== 'object' || typeof data.invited !== 'boolean') throw new Problem(503, 'account-unavailable');
    return { invited: data.invited, expiresAt: data.invited ? data.expiresAt ?? null : null, request: data.request ?? null,
      ...(data.accessMode === 'open' ? { accessMode: 'open', canSubmit: data.canSubmit === true } : {}),
      ...(Number.isInteger(data.fighterLimit) && data.fighterLimit > 0 ? { fighterLimit: data.fighterLimit } : {}) };
  }
  /**
   * His tokens (보유 토큰, 2026-10-31): granted, spent by the official host on his jobs, and the balance (below zero when a job outran it).
   * Null when the database has no balance yet (a function deployed before its migration): the account still answers.
   * @param {string} owner
   */
  async function tokensOf(owner) {
    try {
      const data = await rpc('af_generation_balance', { p_owner: owner });
      return accountTokens(data);
    } catch { return null; }
  }
  return async (request, parts) => {
    try {
      const route = parts.join('/');
      if (!Object.hasOwn(ROUTES, route)) return reply({ ok: false, code: 'not-found' }, 404);
      if (request.method === 'OPTIONS') return reply({ ok: true });
      if (request.method !== ROUTES[route]) return reply({ ok: false, code: 'method-not-allowed' }, 405);
      if (!bearerToken(request)) throw new Problem(401, 'authentication-required');
      const owner = await verifiedUserId(db, request);
      if (!owner) throw new Problem(401, 'authentication-required');
      if (route === 'me') {
        const [account, tokens] = await Promise.all([call('af_account', { p_owner: owner }), tokensOf(owner)]);
        return reply({ ok: true, account: { ...account, ...(tokens ? { tokens } : {}) } });
      }
      if (route === 'creator-handoffs') {
        if (!creatorLink) throw new Problem(503, 'handoff-unavailable');
        // Only the verified token names the account; the request body is never read.
        const link = await creatorLink(owner);
        if (!link || typeof link.tokenHash !== 'string' || !/^[a-f0-9]{40,128}$/.test(link.tokenHash)) throw new Problem(503, 'handoff-unavailable');
        return reply({ ok: true, stage: 'creator-link', tokenHash: link.tokenHash, expiresAt: link.expiresAt });
      }
      let note = '';
      const bytes = await readBody(request, 4000);
      if (bytes.length) {
        let body;
        try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
        catch { throw new Problem(400, 'invalid-body'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Problem(400, 'invalid-body');
        if (body.note !== undefined) {
          if (typeof body.note !== 'string') throw new Problem(400, 'invalid-body');
          note = body.note.trim();
          if (note.includes('\0') || !note.isWellFormed()) throw new Problem(422, 'invalid-note');
          if (note.length > NOTE_LIMIT) throw new Problem(422, 'note-too-long');
        }
      }
      return reply({ ok: true, account: await call('af_request_access', { p_owner: owner, p_note: note }) });
    } catch (error) {
      logFailure('account', request, error);
      if (error instanceof Problem) return reply({ ok: false, code: error.message }, error.status);
      return reply({ ok: false, code: 'account-unavailable' }, 503);
    }
  };
}
