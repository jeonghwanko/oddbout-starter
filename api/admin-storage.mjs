// @ts-check
// 저장 용량 정리 (2026-11-02): the upload budget against its limit, the package folders nothing uses (oldest first), and the removal of the
// ones the operator names. Which folders are unused is the database's answer (20261102130000_oddbout_storage_cleanup.sql); a folder the
// operator named that is in use again, or already removed, is skipped, never deleted.
import { Problem, UUID, readBody } from './http.mjs';
import { BUCKET } from './submissions.mjs';

/** Folders per removal request: each one is a Storage call, and the operator confirms them as one list. */
export const STORAGE_REMOVALS_MAX = 50;

/** @param {string[]} parts */
export const adminStorageRoute = parts => parts[1] === 'storage' && (parts.length === 2 || (parts.length === 3 && parts[2] === 'removals'));

/**
 * GET admin/storage: the report. POST admin/storage/removals `{ submissionIds }`: deletes each still unused folder's files, then records
 * the folders whose files went (a Storage error leaves that folder counted, to be named again).
 * @param {{ db: any, rpc: (name: string, args: Record<string, unknown>) => Promise<any> }} options
 */
export function createAdminStorage({ db, rpc }) {
  /** @param {Request} request @param {string[]} parts @param {string} actor */
  return async (request, parts, actor) => {
    if (parts.length === 2 && request.method === 'GET') return rpc('af_admin_storage', { p_actor: actor });
    if (parts.length !== 3 || request.method !== 'POST') throw new Problem(404, 'not-found');
    let body;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 4000))); }
    catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-body'); }
    const ids = body?.submissionIds;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'submissionIds') || !Array.isArray(ids)
      || !ids.length || ids.length > STORAGE_REMOVALS_MAX || ids.some(id => typeof id !== 'string' || !UUID.test(id))
      || new Set(ids.map(id => id.toLowerCase())).size !== ids.length) throw new Problem(400, 'invalid-review');
    const named = ids.map(id => id.toLowerCase());
    /** @type {{ submissionId: string, bytes: number, keys: string[] }[]} */
    const folders = await rpc('af_admin_storage_folders', { p_actor: actor, p_ids: named });
    /** @type {string[]} */
    const gone = [];
    /** @type {string[]} */
    const failed = [];
    for (const folder of folders) {
      const { error } = await db.storage.from(BUCKET).remove(folder.keys);
      (error ? failed : gone).push(folder.submissionId);
    }
    const recorded = gone.length ? await rpc('af_admin_storage_removed', { p_actor: actor, p_ids: gone }) : { removed: 0, freedBytes: 0 };
    const listed = new Set(folders.map(folder => folder.submissionId));
    return { ...recorded, skipped: named.filter(id => !listed.has(id)), failed };
  };
}
