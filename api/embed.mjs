// @ts-check
import { Problem, UUID, bearerToken, jsonResponse, logFailure, readBody, rpcCaller, sha256 } from './http.mjs';
import { loadDuelManifest, presentDuel } from './duels.mjs';

const HASH = /^[a-f0-9]{64}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const ENGINE = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const STATUS = Object.freeze({
  'authentication-required': 401,
  'invalid-grant': 401,
  'invalid-launch': 422,
  'invalid-match': 422,
  'account-disabled': 403,
  'origin-denied': 403,
  'not-found': 404,
  'idempotency-conflict': 409,
  'duel-not-approved': 409,
  'engine-mismatch': 409,
  'result-conflict': 409,
  'match-busy': 409,
  'duels-paused': 503,
  'embed-budget': 429,
  'rate-limit': 429,
  'invalid-result': 503,
});
/** @typedef {{ enabled?: boolean, gameOrigin?: string }} EmbedConfig */
/** @param {EmbedConfig | null} config */
export function embedEnabled(config) {
  if (config?.enabled !== true || !config.gameOrigin) return false;
  try {
    const url = new URL(config.gameOrigin);
    return url.protocol === 'https:' && url.origin === config.gameOrigin;
  } catch {
    return false;
  }
}
/** @param {string} prefix */
const secret = prefix => prefix + Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
/** @param {string} value */
const hash = value => sha256(new TextEncoder().encode(value));
/** @param {string} verifier */
export async function embedChallenge(verifier) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
/**
 * Called only by a private MCP tool with an already verified connector identity. The returned bearer secret belongs only in the
 * tool's private widget metadata; never in model-visible text or structuredContent. PostgreSQL stores only its SHA-256 hash.
 * @param {{ db: any, identity: { owner: string, claims: any }, attemptId: string, challenge: string, gameOrigin: string, enabled?: boolean }} options
 * @returns {Promise<{grant: string, expiresAt: string}>}
 */
export async function issueEmbedLaunchGrant({ db, identity, attemptId, challenge, gameOrigin, enabled = false }) {
  if (!embedEnabled({ enabled, gameOrigin })) throw new Problem(404, 'not-found');
  if (!identity || !UUID.test(identity.owner ?? '') || !UUID.test(identity.claims?.session_id ?? '') || !UUID.test(identity.claims?.client_id ?? ''))
    throw new Problem(401, 'authentication-required');
  if (typeof attemptId !== 'string' || typeof challenge !== 'string' || !UUID.test(attemptId) || !CHALLENGE.test(challenge))
    throw new Problem(422, 'invalid-launch');
  const grant = secret('afg_');
  const call = rpcCaller(db, STATUS, { unavailable: 'embed-unavailable' });
  const issued = await call('af_embed_issue_grant', {
    p_owner: identity.owner,
    p_session: identity.claims.session_id,
    p_client: identity.claims.client_id,
    p_attempt: attemptId.toLowerCase(),
    p_challenge: challenge,
    p_origin: gameOrigin,
    p_hash: await hash(grant),
  });
  return { grant, expiresAt: issued.expiresAt };
}
/** @param {Request} request @returns {Promise<any>} */
async function bodyOf(request) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 2048)));
  } catch (e) {
    if (e instanceof Problem) throw e;
    throw new Problem(422, 'invalid-body');
  }
}
/** @param {any} body @param {string} keys */
const exactKeys = (body, keys) => body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).sort().join(',') === keys;
/** @param {any} row */
const privateMatch = row => ({ ...presentDuel(row), idempotencyKey: row.request_key });
/** @param {any} row */
const pendingMatch = row => ({
  id: row.id,
  a: row.a,
  b: row.b,
  hashes: [row.hash_a, row.hash_b],
  engine: row.engine,
  idempotencyKey: row.request_key,
  createdAt: row.created_at,
});

/**
 * A separate credential and private match ledger: no account, upload, ranking, reward or Discord writes. Disabled by default.
 * Tokens stay only in the iframe's memory. Every database operation rechecks the originating OAuth session and consent.
 * @param {{ db: any, embed?: EmbedConfig | null, simulateDuel?: any, engineVersion?: any, engines?: any }} options
 * @returns {import('./http.mjs').Route}
 */
export function createEmbedHandler({ db, embed = null, simulateDuel = null, engineVersion = null, engines = null }) {
  const call = rpcCaller(db, STATUS, { unavailable: 'embed-unavailable' });
  /** @type {Map<string, any>} */
  const available = new Map(Object.entries(engines ?? {}).filter(([name, run]) => ENGINE.test(name) && typeof run === 'function'));
  if (ENGINE.test(engineVersion ?? '') && typeof simulateDuel === 'function') available.set(engineVersion, simulateDuel);
  return async (request, parts) => {
    /** @param {any} data @param {number} [status] */
    const reply = (data, status = 200) => {
      const response = jsonResponse(data, status);
      if (embed?.gameOrigin && embedEnabled(embed) && request.headers.get('origin') === embed.gameOrigin) {
        response.headers.set('access-control-allow-origin', embed.gameOrigin);
        response.headers.set('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
        response.headers.set('access-control-allow-headers', 'Authorization, Content-Type');
        response.headers.set('vary', 'Origin');
      }
      return response;
    };
    try {
      if (!embedEnabled(embed)) throw new Problem(404, 'not-found');
      const origin = request.headers.get('origin');
      if (!origin || origin !== embed?.gameOrigin) throw new Problem(403, 'origin-denied');
      const route = parts.slice(1).join('/');
      const known = ['exchange', 'fighters', 'matches', 'session'].includes(route) || (parts.length === 3 && parts[1] === 'matches' && UUID.test(parts[2]));
      if (!known) throw new Problem(404, 'not-found');
      if (request.method === 'OPTIONS') return reply({ ok: true });
      if (request.method === 'POST' && route === 'exchange') {
        const body = await bodyOf(request);
        if (
          !exactKeys(body, 'attemptId,grant,verifier') ||
          typeof body.grant !== 'string' ||
          typeof body.verifier !== 'string' ||
          typeof body.attemptId !== 'string' ||
          !/^afg_[a-f0-9]{64}$/.test(body.grant) ||
          !VERIFIER.test(body.verifier) ||
          !UUID.test(body.attemptId)
        )
          throw new Problem(422, 'invalid-launch');
        const token = secret('afe_');
        const exchanged = await call('af_embed_exchange', {
          p_hash: await hash(body.grant),
          p_challenge: await embedChallenge(body.verifier),
          p_attempt: body.attemptId.toLowerCase(),
          p_origin: origin,
          p_token_hash: await hash(token),
        });
        return reply({ ok: true, token, expiresAt: exchanged.expiresAt, account: exchanged.account });
      }
      const token = bearerToken(request);
      if (!token || !/^afe_[a-f0-9]{64}$/.test(token)) throw new Problem(401, 'authentication-required');
      const auth = { p_token_hash: await hash(token), p_origin: origin };
      if (request.method === 'DELETE' && route === 'session') {
        await call('af_embed_revoke_session', auth);
        return reply({ ok: true });
      }
      if (request.method === 'GET' && route === 'fighters') {
        const fighters = await call('af_embed_fighters', auth);
        return reply({ ok: true, fighters, engine: available.has(engineVersion) ? engineVersion : null, engines: [...available.keys()] });
      }
      if (request.method === 'GET' && route === 'matches') {
        /** @type {any[]} */
        const rows = await call('af_embed_matches', { ...auth, p_id: null });
        return reply({
          ok: true,
          matches: rows.filter(row => row.result !== null).map(privateMatch),
          pending: rows.filter(row => row.result === null).map(pendingMatch),
        });
      }
      if (request.method === 'GET' && parts.length === 3 && parts[1] === 'matches') {
        const rows = await call('af_embed_matches', { ...auth, p_id: parts[2].toLowerCase() });
        if (!rows.length) throw new Problem(404, 'not-found');
        return rows[0].result === null ? reply({ ok: true, pending: pendingMatch(rows[0]) }, 202) : reply({ ok: true, match: privateMatch(rows[0]) });
      }
      if (request.method !== 'POST' || route !== 'matches') throw new Problem(404, 'not-found');
      const body = await bodyOf(request);
      if (
        !exactKeys(body, 'a,b,engine,hashes,idempotencyKey') ||
        ![body.a, body.b, body.idempotencyKey].every(x => typeof x === 'string' && UUID.test(x)) ||
        body.a.toLowerCase() === body.b.toLowerCase() ||
        !Array.isArray(body.hashes) ||
        body.hashes.length !== 2 ||
        !body.hashes.every((/** @type {unknown} */ x) => typeof x === 'string' && HASH.test(x)) ||
        typeof body.engine !== 'string' ||
        !ENGINE.test(body.engine)
      )
        throw new Problem(422, 'invalid-match');
      const run = available.get(body.engine);
      if (!run) throw new Problem(409, 'engine-mismatch');
      const row = await call('af_embed_reserve_match', {
        ...auth,
        p_key: body.idempotencyKey.toLowerCase(),
        p_a: body.a.toLowerCase(),
        p_b: body.b.toLowerCase(),
        p_hash_a: body.hashes[0],
        p_hash_b: body.hashes[1],
        p_engine: body.engine,
      });
      if (row.result) return reply({ ok: true, match: privateMatch(row) });
      let result;
      try {
        const [ma, mb] = await Promise.all([loadDuelManifest(db, row.a, row.hash_a), loadDuelManifest(db, row.b, row.hash_b)]);
        result = await run(row.a, ma, row.b, mb, row.seed);
      } catch (e) {
        throw e instanceof Problem ? e : Object.assign(new Problem(503, 'duel-engine-failed'), { cause: e });
      }
      const completed = await call('af_embed_complete_match', { ...auth, p_id: row.id, p_engine: row.engine, p_result: result });
      return reply({ ok: true, match: privateMatch(completed) });
    } catch (e) {
      logFailure('embed', request, e);
      return reply({ ok: false, code: e instanceof Problem ? e.message : 'embed-unavailable' }, e instanceof Problem ? e.status : 503);
    }
  };
}
