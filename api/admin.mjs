// @ts-check
import { Problem, UUID, jsonResponse, readBody, rpcCaller, verifiedUserId } from './http.mjs';
import { cleanupPublicFiles, profileSetKey, publishProfileSet, removePublicFiles } from './profile-sets.mjs';
import { BUCKET } from './submissions.mjs';
import { GENERATION_BUCKET, GENERATION_LIMITS, artifactPath } from './generations.mjs';

const CORS = { methods: 'GET, POST, OPTIONS', headers: 'Authorization, Content-Type' };
/** @type {(body: any, status?: number) => Response} */
const reply = (body, status = 200) => jsonResponse(body, status, CORS);
/** @type {Record<string, number>} */
const statuses = { 'admin-required': 403, 'not-found': 404, 'review-conflict': 409, 'beta-capacity': 409, 'fighter-deleted': 409,
  'invalid-query': 400, 'invalid-review': 400, 'validation-incomplete': 409, 'registration-open': 410 };
// A small JSON body with only the named keys.
/** @param {Request} request @param {string[]} keys */
async function smallBody(request, keys) {
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 1000))); }
  catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-body'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !keys.includes(key))) throw new Problem(400, 'invalid-review');
  return body;
}
/**
 * The operator's review list (선수 프로필 세트, 2026-10-31): each set with its files signed for ten minutes in one Storage call — the front
 * painting, the validator's card and face, and his current package's idle sheet to compare with. A file Storage cannot sign is null.
 * @param {any} db @param {any[]} sets
 */
async function reviewList(db, sets) {
  /** @type {string[]} */
  const paths = [];
  /** @type {(path: string | null | undefined) => number} */
  const want = path => (typeof path === 'string' && path ? paths.push(path) - 1 : -1);
  const wanted = sets.map(set => ({ front: want(profileSetKey(set.ownerId, set.id, 'front')),
    card: set.derived?.card ? want(profileSetKey(set.ownerId, set.id, 'card')) : -1,
    face: set.derived?.face ? want(profileSetKey(set.ownerId, set.id, 'face')) : -1, preview: want(set.previewKey) }));
  /** @type {Map<string, string>} */
  const signed = new Map();
  if (paths.length) {
    const { data } = await db.storage.from(BUCKET).createSignedUrls(paths, 600);
    for (const item of Array.isArray(data) ? data : []) if (item && !item.error && typeof item.signedUrl === 'string') signed.set(item.path, item.signedUrl);
  }
  /** @type {(index: number) => string | null} */
  const url = index => (index >= 0 ? signed.get(paths[index]) ?? null : null);
  return sets.map((set, index) => {
    const card = set.derived?.card, face = set.derived?.face, at = wanted[index];
    return { id: set.id, fighterId: set.fighterId, fighterName: set.name ?? '', ownerEmail: set.email ?? '', status: set.status,
      submittedAt: set.submittedAt ?? set.createdAt, front: { url: url(at.front), width: set.manifest?.front?.width ?? null, height: set.manifest?.front?.height ?? null },
      card: card ? { url: url(at.card), width: card.width, height: card.height, face: card.face } : null,
      face: face ? { url: url(at.face), size: face.size } : null, previewUrl: url(at.preview),
      reason: set.reason ?? null, current: set.current === true, entered: set.entered === true, validatedAt: set.validatedAt ?? null, reviewedAt: set.reviewedAt ?? null };
  });
}
/** Events the detail shows: the latest, newest first. */
export const ADMIN_JOB_EVENTS = 80;
const ARTIFACT_NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
/**
 * One request in full for the operator (상세, 2026-11-01): what the list cuts short (the whole description, notes, rounds, lease), the hosts by
 * name, its pictures signed for ten minutes (the references, both looks, the motion previews) and its latest events. The brief and the
 * prompt stay out; the profile only by name.
 * @param {any} db @param {string} id
 */
async function generationDetail(db, id) {
  const { data: row, error } = await db.from('af_generation_jobs').select('*').eq('id', id).maybeSingle();
  if (error) throw new Problem(503, 'admin-unavailable');
  if (!row) throw new Problem(404, 'not-found');
  const hostIds = [...new Set([row.requested_host, row.assigned_host].filter(Boolean))];
  const [hosts, uploads, events, user] = await Promise.all([
    hostIds.length ? db.from('af_generation_hosts').select('id,name,official').in('id', hostIds) : { data: [] },
    db.from('af_generation_uploads').select('id,path,content_type,width,height').eq('job_id', id),
    db.from('af_generation_events').select('id,at,kind,data').eq('job_id', id).order('at', { ascending: false }).limit(ADMIN_JOB_EVENTS),
    typeof db.auth?.admin?.getUserById === 'function' ? db.auth.admin.getUserById(row.owner_id).catch(() => null) : null]);
  if (hosts.error || uploads.error || events.error) throw new Problem(503, 'admin-unavailable');
  /** @type {Map<string, { id: string, name: string, official: boolean }>} */
  const named = new Map((hosts.data ?? []).map(/** @param {any} h */ h => [h.id, { id: h.id, name: h.name, official: h.official === true }]));
  const candidates = (Array.isArray(row.candidates) ? row.candidates : []).filter(/** @param {any} name */ name => ARTIFACT_NAME.test(name ?? ''));
  const preview = (Array.isArray(row.preview) ? row.preview : []).filter(/** @param {any} p */ p => p && typeof p === 'object' && ARTIFACT_NAME.test(p.name ?? ''));
  const refs = uploads.data ?? [];
  /** @type {Map<string, string>} */
  const urls = new Map();
  const paths = [...refs.map(/** @param {any} ref */ ref => ref.path), ...candidates.map(/** @param {string} name */ name => artifactPath(id, name)),
    ...preview.map(/** @param {any} p */ p => artifactPath(id, p.name))];
  if (paths.length) {
    // A picture Storage cannot sign is null; the detail shows the rest.
    const { data } = await db.storage.from(GENERATION_BUCKET).createSignedUrls(paths, GENERATION_LIMITS.signedSeconds);
    for (const item of Array.isArray(data) ? data : []) if (item && !item.error && typeof item.signedUrl === 'string') urls.set(item.path, item.signedUrl);
  }
  const host = /** @param {string | null} hid */ hid => (hid ? named.get(hid) ?? { id: hid, name: null, official: false } : null);
  return { id: row.id, status: row.status, errorCode: row.error_code ?? null, progress: row.progress, description: row.description, language: row.language,
    email: user?.data?.user?.email ?? null, ownerId: row.owner_id, delegate: row.delegate === true, hostChoice: row.host_choice ?? null,
    requestedHost: host(row.requested_host ?? null), assignedHost: host(row.assigned_host ?? null), official: host(row.assigned_host ?? null)?.official ?? row.host_choice === 'oddbout',
    profileName: typeof row.profile?.name === 'string' ? row.profile.name : typeof row.brief?.profile?.name === 'string' ? row.brief.profile.name : null,
    choice: row.choice ?? null, appearanceNote: row.appearance_note ?? null, appearanceRound: row.appearance_revisions, motionNote: row.motion_note ?? null,
    motionRound: row.motion_revisions, leases: row.stage_leases, leased: !!row.lease_expires_at && Date.parse(row.lease_expires_at) > Date.now(),
    submissionId: row.submission_id ?? null, waitingSince: row.waiting_since ?? null, createdAt: row.created_at, updatedAt: row.updated_at,
    refs: refs.map(/** @param {any} ref */ ref => ({ id: ref.id, width: ref.width, height: ref.height, url: urls.get(ref.path) ?? null })),
    candidates: candidates.map(/** @param {string} name @param {number} i */ (name, i) => ({ key: i === 0 ? 'a' : 'b', name, url: urls.get(artifactPath(id, name)) ?? null })),
    preview: preview.map(/** @param {any} p */ p => ({ clip: typeof p.clip === 'string' ? p.clip : null, name: p.name, url: urls.get(artifactPath(id, p.name)) ?? null })),
    events: (events.data ?? []).map(/** @param {any} e */ e => ({ at: e.at, kind: e.kind, data: e.data ?? {} })) };
}
/** @param {{ db: any }} options @returns {import('./http.mjs').Route} */
export function createAdminHandler({ db }) {
  const rpc = rpcCaller(db, statuses, { unavailable: 'admin-unavailable' });
  return async (request, parts) => {
    try {
      if (request.method === 'OPTIONS') return reply({ ok: true });
      const actor = await verifiedUserId(db, request);
      if (!actor) throw new Problem(401, 'authentication-required');
      if (await rpc('af_admin_account', { p_actor: actor }) !== true) throw new Problem(403, 'admin-required');
      if (parts.length === 2 && parts[1] === 'me' && request.method === 'GET') return reply({ ok: true, admin: true });
      if (parts.length === 2 && parts[1] === 'fighters' && request.method === 'GET') {
        const query = new URL(request.url).searchParams, page = query.get('page') ?? '0', status = query.get('status') ?? 'active', search = (query.get('search') ?? '').trim();
        if (!/^(0|[1-9][0-9]{0,4})$/.test(page) || Number(page)>10000 || search.length>200 || search.includes('\0')
          || !['active','removed','all'].includes(status)) throw new Problem(400, 'invalid-query');
        return reply({ ok: true, ...await rpc('af_admin_fighters', { p_actor: actor, p_status: status, p_search: search, p_page: Number(page) }) });
      }
      if (parts.length === 4 && parts[1] === 'fighters' && parts[3] === 'moderation' && request.method === 'POST') {
        if (!UUID.test(parts[2])) throw new Problem(400, 'invalid-review');
        let body;
        try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 4000))); }
        catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-body'); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['action','version','reason'].includes(key))
          || !['remove','restore'].includes(body.action) || !Number.isSafeInteger(body.version) || body.version<0
          || typeof body.reason !== 'string') throw new Problem(400, 'invalid-review');
        const reason = body.reason.trim();
        if (!reason || reason.length>500 || reason.includes('\0') || !reason.isWellFormed()) throw new Problem(400, 'invalid-review');
        const moderation = await rpc('af_moderate_fighter', { p_actor: actor, p_fighter: parts[2], p_version: body.version, p_action: body.action, p_reason: reason });
        // A removal withdraws his profile sets (20261031100000); their public copies go after it commits. A restore does not bring them back.
        if (body.action === 'remove') await cleanupPublicFiles(db, parts[2].toLowerCase());
        return reply({ ok: true, moderation });
      }
      if (parts.length === 2 && parts[1] === 'access-requests' && request.method === 'GET') {
        const query = new URL(request.url).searchParams, page = query.get('page') ?? '0', status = query.get('status') ?? 'pending', search = (query.get('search') ?? '').trim();
        if (!/^(0|[1-9][0-9]{0,4})$/.test(page) || Number(page)>10000 || search.length>200 || search.includes('\0')
          || !['pending','approved','declined','all'].includes(status)) throw new Problem(400, 'invalid-query');
        return reply({ ok: true, ...await rpc('af_admin_requests', { p_actor: actor, p_status: status, p_search: search, p_page: Number(page) }) });
      }
      if (parts.length === 4 && parts[1] === 'access-requests' && parts[3] === 'review' && request.method === 'POST') {
        if (!UUID.test(parts[2])) throw new Problem(400, 'invalid-review');
        let body;
        try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 4000))); }
        catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-body'); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['decision','version','reason'].includes(key))
          || !['approved','declined'].includes(body.decision) || typeof body.version !== 'string'
          || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(body.version) || !Number.isFinite(Date.parse(body.version))
          || (body.reason !== undefined && typeof body.reason !== 'string')) throw new Problem(400, 'invalid-review');
        const reason = (body.reason ?? '').trim();
        if (reason.length>500 || reason.includes('\0') || !reason.isWellFormed()) throw new Problem(400, 'invalid-review');
        return reply({ ok: true, review: await rpc('af_admin_review', { p_actor: actor, p_owner: parts[2], p_version: body.version, p_decision: body.decision, p_reason: reason }) });
      }
      // 생성 호스트와 확인을 기다리는 신청 (2026-10-28): approve or withdraw a host; run a stopped stage again or cancel a request.
      if (parts.length === 2 && parts[1] === 'generation-hosts' && request.method === 'GET')
        return reply({ ok: true, hosts: await rpc('af_admin_generation_hosts', { p_actor: actor }) });
      if (parts.length === 4 && parts[1] === 'generation-hosts' && parts[3] === 'approval' && request.method === 'POST') {
        if (!UUID.test(parts[2])) throw new Problem(400, 'invalid-review');
        const body = await smallBody(request, ['approved']);
        if (typeof body.approved !== 'boolean') throw new Problem(400, 'invalid-review');
        return reply({ ok: true, host: await rpc('af_admin_generation_host_approval', { p_actor: actor, p_host: parts[2], p_approved: body.approved }) });
      }
      if (parts.length === 2 && parts[1] === 'generations' && request.method === 'GET') {
        const status = new URL(request.url).searchParams.get('status') ?? 'needs_review';
        if (!['needs_review', 'open'].includes(status)) throw new Problem(400, 'invalid-query');
        return reply({ ok: true, jobs: await rpc('af_admin_generations', { p_actor: actor, p_status: status }) });
      }
      if (parts.length === 3 && parts[1] === 'generations' && request.method === 'GET') {
        if (!UUID.test(parts[2])) throw new Problem(400, 'invalid-query');
        return reply({ ok: true, job: await generationDetail(db, parts[2].toLowerCase()) });
      }
      if (parts.length === 4 && parts[1] === 'generations' && ['retry', 'cancel'].includes(parts[3]) && request.method === 'POST') {
        if (!UUID.test(parts[2])) throw new Problem(400, 'invalid-review');
        return reply({ ok: true, job: await rpc(parts[3] === 'retry' ? 'af_admin_generation_retry' : 'af_admin_generation_cancel', { p_actor: actor, p_id: parts[2] }) });
      }
      // 선수 프로필 세트 (2026-10-31): the sets the validator passed wait here; approving copies their derived files to the public bucket.
      if (parts.length === 2 && parts[1] === 'profile-sets' && request.method === 'GET') {
        const status = new URL(request.url).searchParams.get('status') ?? 'review';
        if (!['review', 'approved', 'rejected'].includes(status)) throw new Problem(400, 'invalid-query');
        return reply({ ok: true, profileSets: await reviewList(db, await rpc('af_admin_profile_sets', { p_actor: actor, p_status: status })) });
      }
      if (parts.length === 4 && parts[1] === 'profile-sets' && ['approve', 'reject'].includes(parts[3]) && request.method === 'POST') {
        if (!UUID.test(parts[2])) throw new Problem(400, 'invalid-review');
        const id = parts[2].toLowerCase();
        if (parts[3] === 'approve') {
          const set = await rpc('af_admin_profile_set', { p_actor: actor, p_id: id });
          if (!['review', 'approved'].includes(set.status)) throw new Problem(409, 'review-conflict');
          // Public first, then the roster names it: a failed approval leaves no roster entry, and the files this call wrote are removed.
          const written = await publishProfileSet(db, set);
          let approved;
          try { approved = await rpc('af_admin_profile_set_approve', { p_actor: actor, p_id: id }); }
          catch (error) {
            await removePublicFiles(db, set.fighterId, written);
            throw error;
          }
          // The set it replaced is superseded: its copies leave unless this set has the same file.
          await cleanupPublicFiles(db, set.fighterId);
          return reply({ ok: true, status: approved.status });
        }
        let body;
        try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 4000))); }
        catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-body'); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'reason') || typeof body.reason !== 'string')
          throw new Problem(400, 'invalid-review');
        const reason = body.reason.trim();
        if (!reason || reason.length > 300 || reason.includes('\0') || !reason.isWellFormed()) throw new Problem(400, 'invalid-review');
        const rejected = await rpc('af_admin_profile_set_reject', { p_actor: actor, p_id: id, p_reason: reason });
        // A rejected current set leaves the roster; its public files go with it.
        if (rejected.previous === 'approved') await cleanupPublicFiles(db, rejected.fighterId);
        return reply({ ok: true, status: rejected.status });
      }
      return reply({ ok: false, code: 'not-found' }, 404);
    } catch (error) {
      return reply({ ok: false, code: error instanceof Problem ? error.message : 'admin-unavailable' }, error instanceof Problem ? error.status : 503);
    }
  };
}
