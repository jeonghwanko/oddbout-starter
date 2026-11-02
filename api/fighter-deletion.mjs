// @ts-check
// 선수 삭제 (2026-10-30 사용자: "삭제하기는 별도로 버튼이 있고, 확실히 처리를 해야할 것 같거든"): the creator site's delete button runs the
// cloud MCP's two steps. `POST fighters/<id>/deletion` prepares — the exact fighter, what deletion does and a 10-minute confirmation — and
// deletes nothing. `POST fighters/<id>/deletion/confirm` deletes with that confirmation and the name typed back. Both are bound to the
// signed-in session; the database rechecks the owner, the session, the expiry and the fighter's version under its lock, and a lost answer
// is safe to retry with the same confirmation (`supabase/migrations/20261030120000_ai_fighter_site_deletion.sql`).
import { Problem, UUID, jsonResponse, logFailure, readBody, rpcCaller, verifiedUser } from './http.mjs';
import { cleanupPublicFiles } from './profile-sets.mjs';

/** The client a site sign-in stands for in af_fighter_deletions, which has no OAuth client; the database reads this value as the site. */
export const SITE_CLIENT = '00000000-0000-0000-0000-000000000000';
const CORS = { methods: 'POST, OPTIONS', headers: 'Authorization, Content-Type' };
const STATUS = Object.freeze({ 'authentication-required': 401, 'account-disabled': 403, 'not-found': 404, 'rate-limit': 429,
  'invalid-deletion-confirmation': 409, 'deletion-confirmation-expired': 409, 'fighter-changed': 409, 'fighter-deleted': 409,
  'deletion-name-mismatch': 422 });

/** Is this path the deletion's? @param {string[]} parts */
export function deletionRoute(parts) {
  return parts[0] === 'fighters' && parts[2] === 'deletion' && (parts.length === 3 || parts.length === 4 && parts[3] === 'confirm');
}

/**
 * @param {{ db: any }} options
 * @returns {import('./http.mjs').Route}
 */
export function createFighterDeletionHandler({ db }) {
  const call = rpcCaller(db, STATUS);
  return async (request, parts) => {
    /** @type {(body: any, status?: number) => Response} */
    const json = (body, status = 200) => jsonResponse(body, status, CORS);
    try {
      if (request.method === 'OPTIONS') return json({ ok: true });
      if (request.method !== 'POST') throw new Problem(404, 'route-not-found');
      if (!UUID.test(parts[1] ?? '')) throw new Problem(400, 'invalid-id');
      const user = await verifiedUser(db, request);
      // A token that names no session cannot be checked against a sign-out, so it cannot delete.
      if (!user?.session) throw new Problem(401, 'authentication-required');
      await call('af_authorize', { p_owner: user.owner });
      const identity = { p_owner: user.owner, p_fighter: parts[1].toLowerCase(), p_session: user.session, p_client: SITE_CLIENT };
      if (parts.length === 3) return json(await call('af_prepare_fighter_deletion', identity));
      let body;
      try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 2000))); }
      catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-body'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['confirmationToken', 'confirmName'].includes(key))
        || !UUID.test(body.confirmationToken ?? '') || typeof body.confirmName !== 'string' || !body.confirmName || body.confirmName.length > 200)
        throw new Problem(422, 'invalid-confirmation');
      const deleted = await call('af_delete_owned_fighter', { ...identity, p_token: body.confirmationToken.toLowerCase(), p_confirm_name: body.confirmName });
      // His profile sets were withdrawn with him; their public copies go now (a retried deletion tries again).
      await cleanupPublicFiles(db, identity.p_fighter);
      return json(deleted);
    } catch (error) {
      logFailure('fighter-deletion', request, error);
      if (error instanceof Problem) return json({ ok: false, stage: 'api', code: error.message }, error.status);
      return json({ ok: false, stage: 'api', code: 'service-unavailable' }, 503);
    }
  };
}
