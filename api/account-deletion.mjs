// @ts-check
import { Problem, jsonResponse, logFailure, readBody, rpcCaller, verifiedUser } from './http.mjs';

const CORS = { methods: 'POST, OPTIONS', headers: 'Authorization, Content-Type, apikey' };

/**
 * Self-service deletion. The body can only confirm the account in the verified first-party session.
 * @param {{ db: any }} options
 * @returns {import('./http.mjs').Route}
 */
export function createAccountDeletionHandler({ db }) {
  const call = rpcCaller(db, {});
  return async request => {
    /** @type {(body: any, status?: number) => Response} */
    const json = (body, status = 200) => jsonResponse(body, status, CORS);
    if (request.method === 'OPTIONS') return json({ ok: true });
    if (request.method !== 'POST') return json({ ok: false, code: 'route-not-found' }, 404);
    try {
      const user = await verifiedUser(db, request);
      if (!user?.session) throw new Problem(401, 'authentication-required');
      let body;
      try {
        body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 256)));
      } catch (error) {
        if (error instanceof Problem) throw error;
        throw new Problem(400, 'invalid-body');
      }
      if (!body || typeof body !== 'object' || Object.keys(body).length !== 1 || body.confirmAccount !== user.owner)
        throw new Problem(422, 'account-confirmation-required');

      const eligibility = await call('af_account_deletion_eligibility', { p_owner: user.owner, p_session: user.session });
      if (eligibility === 'sign-in') throw new Problem(401, 'authentication-required');
      if (eligibility === 'support') throw new Problem(409, 'account-deletion-needs-support');
      if (eligibility !== 'eligible') throw new Problem(503, 'account-deletion-unavailable');

      // Hard deletion removes the Auth user and its sessions. Foreign keys keep immutable submissions intact and roll back a blocked delete.
      const { error } = await db.auth.admin.deleteUser(user.owner);
      if (error) {
        if (error.code === 'user_not_found') throw new Problem(401, 'authentication-required');
        if (error.code === 'unexpected_failure' && error.message === 'Database error deleting user') {
          logFailure('account-deletion', request, error);
          throw new Problem(409, 'account-deletion-needs-support');
        }
        throw error;
      }
      return json({ ok: true, deleted: true });
    } catch (error) {
      logFailure('account-deletion', request, error);
      if (error instanceof Problem) return json({ ok: false, code: error.message }, error.status);
      return json({ ok: false, code: 'account-deletion-unavailable' }, 503);
    }
  };
}
