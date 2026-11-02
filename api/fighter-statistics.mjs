// @ts-check
import { UUID, bearerToken, jsonResponse, logFailure, verifiedUserId } from './http.mjs';

const CORS = { methods: 'GET, OPTIONS', headers: 'Authorization, Content-Type' };
/** @type {(body: any, status?: number) => Response} */
const reply = (body, status = 200) => jsonResponse(body, status, CORS);

/** Read access depends on verified ownership, not an active submission invitation or leaderboard membership. */
/** @param {{ db: any }} options @returns {import('./http.mjs').Route} */
export function createFighterStatisticsHandler({ db }) {
  return async (request, parts) => {
    try {
      if (parts.length !== 3 || parts[0] !== 'fighters' || parts[2] !== 'statistics' || !UUID.test(parts[1]))
        return reply({ ok: false, code: 'not-found' }, 404);
      if (request.method === 'OPTIONS') return reply({ ok: true });
      if (request.method !== 'GET') return reply({ ok: false, code: 'method-not-allowed' }, 405);
      if (!bearerToken(request)) return reply({ ok: false, code: 'authentication-required' }, 401);
      const owner = await verifiedUserId(db, request);
      if (!owner) return reply({ ok: false, code: 'authentication-required' }, 401);
      const { data: rows, error: queryError } = await db.rpc('af_owned_fighter_statistics', {
        p_owner: owner, p_fighter: parts[1],
      });
      if (queryError) { logFailure('statistics', request, queryError); return reply({ ok: false, code: queryError.code === 'PGRST202' ? 'statistics-not-ready' : 'statistics-unavailable' }, 503); }
      if (!Array.isArray(rows)) return reply({ ok: false, code: 'statistics-unavailable' }, 503);
      if (!rows.length) return reply({ ok: false, code: 'not-found' }, 404);
      if (rows.length !== 1 || rows[0].id !== parts[1].toLowerCase()) return reply({ ok: false, code: 'statistics-unavailable' }, 503);
      return reply({ ok: true, statistics: rows[0] });
    } catch (error) { logFailure('statistics', request, error); return reply({ ok: false, code: 'statistics-unavailable' }, 503); }
  };
}
