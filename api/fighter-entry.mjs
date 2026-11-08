// @ts-check
// 출전 (2026-10-30 사용자: "제작완료된 캐릭터를 '출전'해서 다른 사람들이 제작된 캐릭터로 토너먼트 플레이할 수 있도록 단계를 나눠야 돼"): a validated
// fighter is 제작 중 until his owner enters him. `POST fighters/<id>/entry` enters him on the package he watched — its hash and every
// required motion he ticked on the creator site's motions page; `DELETE fighters/<id>/entry` returns him to 제작 중. Both answer the same
// when repeated, so they need no idempotency key (`supabase/migrations/20261030130000_ai_fighter_entry.sql`).
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { Problem, UUID, jsonResponse, logFailure, readBody, rpcCaller, verifiedUserId } from './http.mjs';

const CORS = { methods: 'POST, DELETE, OPTIONS', headers: 'Authorization, Content-Type' };
const STATUS = Object.freeze({
  'authentication-required': 401,
  'account-disabled': 403,
  'not-found': 404,
  'rate-limit': 429,
  'fighter-changed': 409,
  'fighter-not-ready': 409,
  'profile-set-required': 409,
  'invalid-entry': 422,
});
/** The motions an entry must name: every required clip of the contract, each once. */
export const ENTRY_CLIPS = Object.freeze(Object.keys(spec.motions));

/** Is this path the entry's? @param {string[]} parts */
export function entryRoute(parts) {
  return parts[0] === 'fighters' && parts[2] === 'entry' && parts.length === 3;
}

/**
 * An entry request's body, checked: the package hash he watched and the required motions he ticked.
 * @param {any} body
 * @returns {{ sha: string, clips: string[] }}
 */
export function entryRequest(body) {
  const clips = body?.reviewedClips;
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some(key => !['expectedManifestSha256', 'reviewedClips'].includes(key)) ||
    !/^[a-f0-9]{64}$/.test(body.expectedManifestSha256 ?? '') ||
    !Array.isArray(clips) ||
    clips.length !== ENTRY_CLIPS.length ||
    new Set(clips).size !== clips.length ||
    !ENTRY_CLIPS.every(clip => clips.includes(clip))
  )
    throw new Problem(422, 'invalid-entry');
  return { sha: body.expectedManifestSha256, clips: [...ENTRY_CLIPS] };
}

/**
 * @param {{ db: any }} options
 * @returns {import('./http.mjs').Route}
 */
export function createFighterEntryHandler({ db }) {
  const call = rpcCaller(db, STATUS);
  return async (request, parts) => {
    /** @type {(body: any, status?: number) => Response} */
    const json = (body, status = 200) => jsonResponse(body, status, CORS);
    try {
      if (request.method === 'OPTIONS') return json({ ok: true });
      if (!['POST', 'DELETE'].includes(request.method)) throw new Problem(404, 'route-not-found');
      if (!UUID.test(parts[1] ?? '')) throw new Problem(400, 'invalid-id');
      const owner = await verifiedUserId(db, request);
      if (!owner) throw new Problem(401, 'authentication-required');
      await call('af_authorize', { p_owner: owner });
      const fighter = parts[1].toLowerCase();
      if (request.method === 'DELETE') return json(await call('af_withdraw_fighter', { p_owner: owner, p_fighter: fighter }));
      let body;
      try {
        body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 2000)));
      } catch (error) {
        if (error instanceof Problem) throw error;
        throw new Problem(400, 'invalid-body');
      }
      const { sha, clips } = entryRequest(body);
      try {
        return json(await call('af_enter_fighter', { p_owner: owner, p_fighter: fighter, p_sha: sha, p_clips: clips }));
      } catch (error) {
        // What his front lacks goes with the refusal (정면 판정, 2026-11-03): the site and the MCP say which step comes next.
        if (!(error instanceof Problem) || error.message !== 'profile-set-required') throw error;
        const { data: front } = await Promise.resolve(db.rpc('af_fighter_front', { p_fighter: fighter })).catch(() => ({ data: null }));
        return json({ ok: false, stage: 'api', code: error.message, ...(front ? { front } : {}) }, error.status);
      }
    } catch (error) {
      logFailure('fighter-entry', request, error);
      if (error instanceof Problem) return json({ ok: false, stage: 'api', code: error.message }, error.status);
      return json({ ok: false, stage: 'api', code: 'service-unavailable' }, 503);
    }
  };
}
