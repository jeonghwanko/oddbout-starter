// @ts-check
// 운영자 선수 수정 (2026-11-02 사용자: "슈퍼 계정으로 어드민이 수정할 수 있는 루트도 하나 만들어두자"): an operator replaces a fighter's
// package or edits his profile and fighting style without his owner's sign-in. The routes are the owner's own, under `admin/` and with a
// reason (the `X-Admin-Reason` header, percent-encoded UTF-8, 1-500 characters — a header, not the address the request logs keep): the
// database functions (`af_admin_*`, 20261102100000) check the operator, then run the owner's functions under the owner's id and record the
// edit in af_admin_fighter_edits (the only place with the operator's id and reason). An operator's new package keeps the fighter's entry.
//   GET   admin/fighters/<id>                        the fighter as an edit starts from: owner, package hash, entry, combat, recent edits
//   POST  admin/fighters/<id>/submissions            a new package (Idempotency-Key, X-Admin-Reason, body fighter.json), as POST submissions?fighter=<id>
//   GET   admin/submissions/<id>                      that submission's state (an operator's package only)
//   PUT   admin/submissions/<id>/assets/<asset>       one asset (image/webp)
//   POST  admin/submissions/<id>/submit               to the validator queue
//   PATCH admin/fighters/<id>/profile                 a profile or style edit (Idempotency-Key, X-Admin-Reason), as PATCH fighters/<id>/profile
import { updateFighterProfile } from './fighter-profile.mjs';
import { Problem, UUID, jsonResponse, rpcProblem } from './http.mjs';
import { SUBMISSION_STATUS, checkedManifest, storeAsset } from './submissions.mjs';

export const ADMIN_EDIT_CORS = { methods: 'GET, POST, PUT, PATCH, OPTIONS', headers: 'Authorization, Content-Type, Idempotency-Key, X-Admin-Reason' };
const STATUS = Object.freeze({ ...SUBMISSION_STATUS, 'admin-required': 403, 'invalid-reason': 400 });

/** Is this path one of the operator's edit routes? @param {string[]} parts */
export function adminFighterEditRoute(parts) {
  return parts[0] === 'admin' && (parts[1] === 'fighters' && parts.length >= 3 && parts.length <= 4 && (parts.length === 3 || ['submissions', 'profile'].includes(parts[3]))
    || parts[1] === 'submissions' && parts.length >= 3);
}

/** @type {(value: any) => string} */
const requireId = value => { if (!UUID.test(value ?? '')) throw new Problem(400, 'invalid-id'); return value.toLowerCase(); };
/** The edit's reason from `X-Admin-Reason` (percent-encoded UTF-8): trimmed, 1-500 characters of well-formed text. @param {Request} request */
function reasonOf(request) {
  let reason;
  try { reason = decodeURIComponent(request.headers.get('x-admin-reason') ?? '').trim(); } catch { throw new Problem(400, 'invalid-reason'); }
  if (!reason || reason.length > 500 || reason.includes('\0') || !reason.isWellFormed()) throw new Problem(400, 'invalid-reason');
  return reason;
}

/**
 * @param {{ db: any, present: (row: any) => Promise<object> }} options  `present`: the creator routes' view of a submission row.
 * @returns {(request: Request, parts: string[], actor: string) => Promise<Response>}
 */
export function createAdminFighterEdits({ db, present }) {
  /** @type {(body: any, status?: number) => Response} */
  const json = (body, status = 200) => jsonResponse(body, status, ADMIN_EDIT_CORS);
  /** @param {string} name @param {Record<string, unknown>} args */
  async function rpc(name, args) { const { data, error } = await db.rpc(name, args); if (error) throw rpcProblem(error, STATUS); return data; }
  /** @param {string} id */
  async function fighter(id) {
    const { data, error } = await db.from('af_fighters').select('id,owner_id,submission_id,manifest_sha,profile,status,review_state,runtime_approved,duel_approved,entered_at,deleted_at,moderation_version,updated_at')
      .eq('id', id).maybeSingle();
    if (error) throw new Problem(503, 'database-unavailable');
    if (!data || data.deleted_at) throw new Problem(404, 'fighter-not-found');
    return data;
  }
  /** An operator's package submission (only those: an owner's own stays his — the audit row tells them apart). @param {string} id */
  async function adminSubmission(id) {
    const { data: edit, error: editError } = await db.from('af_admin_fighter_edits').select('submission_id').eq('submission_id', requireId(id))
      .eq('kind', 'package').maybeSingle();
    if (editError) throw new Problem(503, 'database-unavailable');
    if (!edit) throw new Problem(404, 'not-found');
    const { data, error } = await db.from('af_submissions').select('*').eq('id', edit.submission_id).maybeSingle();
    if (error) throw new Problem(503, 'database-unavailable');
    if (!data) throw new Problem(404, 'not-found');
    return data;
  }
  /** A submission's status (an edit's outcome in the detail), or null. @param {string} id */
  async function statusOf(id) {
    const { data, error } = await db.from('af_submissions').select('status').eq('id', id).maybeSingle();
    if (error) throw new Problem(503, 'database-unavailable');
    return data?.status ?? null;
  }
  return async (request, parts, actor) => {
    try {
      const method = request.method;
      if (parts[1] === 'fighters') {
        const id = requireId(parts[2]);
        if (parts.length === 3 && method === 'GET') {
          const f = await fighter(id);
          // A fighter without a package yet (`submission_id` null) has no combat to show.
          const { data: current, error } = f.submission_id ? await db.from('af_submissions').select('manifest').eq('id', f.submission_id).maybeSingle()
            : { data: null, error: null };
          if (error) throw new Problem(503, 'database-unavailable');
          const { data: edits, error: editsError } = await db.from('af_admin_fighter_edits').select('actor,submission_id,kind,reason,kept_entry,created_at')
            .eq('fighter_id', id).order('created_at', { ascending: false }).limit(5);
          if (editsError) throw new Problem(503, 'database-unavailable');
          const manifest = current?.manifest;
          return json({ ok: true, fighter: { id: f.id, ownerId: f.owner_id, name: f.profile?.name ?? '', manifestSha256: f.manifest_sha,
            submissionId: f.submission_id, status: f.status, reviewState: f.review_state, runtimeApproved: f.runtime_approved, duelApproved: f.duel_approved,
            enteredAt: f.entered_at, updatedAt: f.updated_at, moderationVersion: f.moderation_version, profile: f.profile,
            combat: manifest ? { stats: manifest.combat?.stats ?? null, style: manifest.combat?.style ?? null, skill: manifest.clips?.skill?.skill?.kind ?? null } : null },
            // Each edit with its submission's outcome: a package that failed validation or expired is in the audit too.
            edits: await Promise.all((edits ?? []).map(async (/** @type {any} */ e) => ({ actor: e.actor, submissionId: e.submission_id, kind: e.kind,
              reason: e.reason, keptEntry: e.kept_entry, at: e.created_at, status: await statusOf(e.submission_id) }))) });
        }
        if (parts[3] === 'submissions' && method === 'POST') {
          const reason = reasonOf(request), key = requireId(request.headers.get('idempotency-key'));
          const manifest = await checkedManifest(request);
          const row = await rpc('af_admin_create_submission', { p_actor: actor, p_fighter: id, p_key: key, p_text: manifest.text, p_sha: manifest.sha,
            p_bytes: manifest.bytes, p_reason: reason });
          return json({ ...await present(row), keepEntry: row.keep_entry === true });
        }
        if (parts[3] === 'profile' && method === 'PATCH') {
          const reason = reasonOf(request), key = requireId(request.headers.get('idempotency-key')), owner = (await fighter(id)).owner_id;
          // The owner's edit, its last call the operator's: same checks, then the audit row in the same transaction.
          /** @type {(name: string, args: Record<string, unknown>) => Promise<any>} */
          const edit = (name, args) => {
            if (name !== 'af_update_fighter_profile') throw new Problem(503, 'admin-unavailable');
            return rpc('af_admin_update_fighter_profile', { ...args, p_actor: actor, p_reason: reason });
          };
          return json(await present(await updateFighterProfile({ request, owner, id, key, db, rpc: edit })));
        }
      }
      if (parts[1] === 'submissions') {
        const row = await adminSubmission(parts[2]);
        if (parts.length === 3 && method === 'GET') return json({ ...await present(row), keepEntry: row.keep_entry === true });
        if (parts.length === 4 && parts[3] === 'submit' && method === 'POST')
          return json(await present(await rpc('af_admin_submit', { p_actor: actor, p_id: row.id })));
        if (parts.length === 5 && parts[3] === 'assets' && method === 'PUT') return json(await storeAsset(db, row, parts[4], request));
      }
      throw new Problem(404, 'route-not-found');
    } catch (error) {
      if (error instanceof Problem) return json({ ok: false, stage: 'api', code: error.message, ...(error.errors ? { errors: error.errors } : {}) }, error.status);
      return json({ ok: false, stage: 'api', code: 'admin-unavailable' }, 503);
    }
  };
}
