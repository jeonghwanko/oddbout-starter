// @ts-check
import { updateFighterProfile } from './fighter-profile.mjs';
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { createAccountHandler } from './account.mjs';
import { createDeviceLoginHandler } from './device-login.mjs';
import { createAdminHandler } from './admin.mjs';
import { createDuelHandler } from './duels.mjs';
import { createFighterStatisticsHandler } from './fighter-statistics.mjs';
import { createWorkshopHandler, workshopRoute } from './workshop.mjs';
import { attachJobProfileSet, createGenerationHandler, generationRoute } from './generations.mjs';
import { createFighterDeletionHandler, deletionRoute } from './fighter-deletion.mjs';
import { createFighterEntryHandler, entryRoute } from './fighter-entry.mjs';
import { Problem, UUID, bearerToken, jsonResponse, logFailure, readBody, rpcProblem, sha256, verifiedUserId } from './http.mjs';
import { BUCKET, SUBMISSION_STATUS, checkedManifest, objectKey, storeAsset } from './submissions.mjs';
import { PROFILE_SET_SPEC, createProfileSetHandler, profileSetRoute, profileSetWorkerRoute, rosterProfileSet } from './profile-sets.mjs';

export { Problem, readBody, sha256 } from './http.mjs';
export { BUCKET, VALIDATOR_VERSION, objectKey } from './submissions.mjs';
const ROSTER_CORS = { methods: 'GET, OPTIONS' };
/**
 * A row of af_submissions, as `select('*')` or a submission function returns it. `validation` is the worker's result as af_finish stored it.
 * @typedef {{ id: string, owner_id: string, status: string, manifest_text: string, manifest_sha: string, expires_at: string,
 *   fighter_id: string | null, validation: unknown, lease_token: string | null, asset_source_submission?: string | null,
 *   manifest: { assets: { id: string, bytes: number, sha256: string }[] } }} Submission
 */
/**
 * A registered fighter's admission, as present() reads it from af_fighters.
 * @typedef {{ submission_id: string, runtime_approved: boolean, runtime_scope: string | null, moderation_reason: string }} Admission
 */
/**
 * An af_roster_entries row (af_fighters with its maker) as the roster lists it; `profile` is the registered package's.
 * @typedef {{ id: string, created_at: string, manifest_sha: string, profile: { name: string, names?: Record<string, string> },
 *   runtime_scope: string | null, runtime_manifest_sha: string | null, duel_approved: boolean, duel_manifest_sha: string | null,
 *   made_with: string | null, entered_at: string | null, profile_set?: { id: string, derived: any } | null }} RosterFighter
 */
/**
 * @type {(value: any) => string} An id from the path, a header or a body, checked here, lowercase as the database writes it: an
 * uppercase fighter id made a retried edit's own key a conflict (API 점검 2026-10-29).
 */
const requireId = value => { if (!UUID.test(value ?? '')) throw new Problem(400, 'invalid-id'); return value.toLowerCase(); };
// rejected and expired uploads are final: nothing remains to wait for, so pending is empty.
/** @type {(row: { status: string, expires_at: string }) => boolean} */
const uploadExpired = row => row.status === 'uploading' && Date.parse(row.expires_at) <= Date.now();
/**
 * A registered submission the fighter has moved on from (a later edit or update) is `superseded`, naming the fighter's current one;
 * only the current one carries the fighter's admission.
 * @type {(row: Submission, fighter?: Admission | null) => object}
 */
const view = (row, fighter) => {
  const superseded = Boolean(fighter && fighter.submission_id !== row.id), admission = superseded ? null : fighter;
  return { ok: true, stage: row.status, submissionId: row.id, manifestSha256: row.manifest_sha,
    fighterId: row.fighter_id ?? null, validation: row.validation ?? null, ...(uploadExpired(row) ? { code: 'upload-expired' } : {}),
    runtimeApproved: admission?.runtime_approved === true, runtimeScope: admission?.runtime_scope ?? null,
    ...(row.status !== 'registered' ? {} : superseded ? { availability: 'superseded', currentSubmissionId: fighter?.submission_id }
      : { availability: admission?.runtime_approved ? 'active' : 'removed', moderationReason: admission?.moderation_reason ?? '' }),
    pending: row.status === 'registered' ? []
      : row.status === 'rejected' || uploadExpired(row) ? [] : ['server-validation', 'registration'] };
};
/** @param {{ message: string } | null} error  A database call's error, if any. */
function check(error) { if (error) throw rpcProblem(error, SUBMISSION_STATUS); }
/**
 * `agentClient` (공방과 연대기, 2026-10-27): the cloud MCP's OAuth client for its in-process calls — the workshop labels notes and canon
 * versions with that agent's name, and a hosted request with the agent that asked for it. The public Edge handler never sets it.
 */
/**
 * @param {{ db: any, simulateDuel?: any, engineVersion?: any, engines?: any, release?: any, creatorLink?: import('./http.mjs').CreatorLink | null,
 *   analytics?: import('./http.mjs').Analytics | null, agentClient?: any, limiter?: import('./http.mjs').Limiter | null, decisionsReviewer?: import('./http.mjs').Reviewer | null,
 *   responsesReviewer?: import('./http.mjs').Reviewer | null, cascadeReviewer?: import('./http.mjs').Reviewer | null }} options
 * @returns {(request: Request) => Promise<Response>}
 */
export function createHandler({ db, simulateDuel = null, engineVersion = null, engines = null, release = null, creatorLink = null, analytics = null, agentClient = null, limiter = null, decisionsReviewer = null, responsesReviewer = null, cascadeReviewer = null }) {
  const duelHandler = createDuelHandler({db,simulateDuel,engineVersion,engines,release,limiter});
  const statisticsHandler = createFighterStatisticsHandler({ db });
  const accountHandler = createAccountHandler({ db, creatorLink });
  const deviceLoginHandler = createDeviceLoginHandler({ db, creatorLink, limiter });
  /** @param {string} name @param {Record<string, unknown>} args */
  async function rpc(name, args) { const { data, error } = await db.rpc(name, args); check(error); return data; }
  /** @param {Submission} row */
  async function present(row) {
    if (row.status !== 'registered') return view(row);
    // By the fighter, not by this submission: an older submission of an edited fighter found none and read as removed (API 점검 2026-10-29).
    const { data, error } = await db.from('af_fighters').select('submission_id,runtime_approved,runtime_scope,moderation_reason').eq('id', row.fighter_id).maybeSingle();
    check(error); return view(row, data);
  }
  /** One Storage call signs every asset of a submission, in manifest order. @param {Submission} row @param {number} seconds @returns {Promise<string[]>} */
  async function signedUrls(row, seconds) {
    const paths = row.manifest.assets.map(asset => objectKey(row, asset));
    const { data, error } = await db.storage.from(BUCKET).createSignedUrls(paths, seconds);
    const signed = new Map((Array.isArray(data) ? data : []).map(item => [item.path, item]));
    return paths.map(key => {
      const item = signed.get(key);
      if (error || !item || item.error || typeof item.signedUrl !== 'string') throw new Problem(503, 'storage-unavailable');
      return item.signedUrl;
    });
  }
  // `worker`: false for a creator; 'validation' or 'generation' for a worker key of that scope (2026-10-27 — the generation worker has its own).
  /** @param {Request} request @param {false | 'validation' | 'generation'} worker */
  async function authenticate(request, worker) {
    const token = bearerToken(request);
    if (!token) throw new Problem(401, 'authentication-required');
    if (worker) {
      if (!/^afw_[a-f0-9]{64}$/.test(token)) throw new Problem(403, 'worker-required');
      const hash = await sha256(new TextEncoder().encode(token));
      const { data, error } = await db.from('af_workers').select('token_hash,host_id').eq('token_hash', hash).eq('enabled', true).eq('scope', worker)
        .gt('expires_at', new Date().toISOString()).maybeSingle();
      check(error); if (!data) throw new Problem(403, 'worker-required');
      // A generation key names its host (커뮤니티 호스트, 2026-10-28); one without is the official host's.
      return worker === 'generation' ? data.host_id ?? null : null;
    }
    const owner = await verifiedUserId(db, request);
    if (!owner) throw new Problem(401, 'authentication-required');
    await rpc('af_authorize', { p_owner: owner });
    return owner;
  }
  // The operator's routes, his fighter edits shown as the creator's own (`present`).
  const adminHandler = createAdminHandler({ db, present });
  const workshopHandler = createWorkshopHandler({ db, authenticate: request => authenticate(request, false), rpc, agentClient });
  const generationHandler = createGenerationHandler({ db, authenticate, present, decisionsReviewer, responsesReviewer, cascadeReviewer, agentClient });
  const deletionHandler = createFighterDeletionHandler({ db });
  const entryHandler = createFighterEntryHandler({ db });
  const profileSetHandler = createProfileSetHandler({ db, authenticate });
  /** @param {string} owner @param {string} id @returns {Promise<Submission>} */
  async function ownSubmission(owner, id) {
    const { data, error } = await db.from('af_submissions').select('*').eq('id', requireId(id)).eq('owner_id', owner).maybeSingle();
    check(error); if (!data) throw new Problem(404, 'not-found'); return data;
  }
  return async request => {
    /** @type {{ methods: string, headers?: string } | undefined} */
    let cors;
    /** @type {(body: any, status?: number) => Response} */
    const json = (body, status = 200) => jsonResponse(body, status, cors);
    try {
      const segments = new URL(request.url).pathname.split('/').filter(Boolean), prefix = segments.indexOf('ai-fighter');
      const parts = prefix >= 0 ? segments.slice(prefix + 1) : segments, method = request.method;
      const profileRoute = parts[0] === 'fighters' && parts[2] === 'profile' && parts.length === 3;
      if (profileRoute) {
        cors = { methods: 'PATCH, OPTIONS', headers: 'Authorization, Content-Type, Idempotency-Key' };
        if (method === 'OPTIONS') return json({ ok: true });
      }
      // The creator page registers a package picked in the browser (2026-10-26): create, upload, submit and poll.
      // Bearer auth only, no cookies, so any origin may call it the way the kit's CLI does.
      if (parts[0] === 'submissions') {
        cors = { methods: 'GET, POST, PUT, OPTIONS', headers: 'Authorization, Content-Type, Idempotency-Key' };
        if (method === 'OPTIONS') return json({ ok: true });
      }
      if (parts[0] === 'admin') return adminHandler(request, parts);
      if (workshopRoute(parts)) return workshopHandler(request, parts);
      if (generationRoute(parts)) return generationHandler(request, parts);
      if (parts[0] === 'duels' || parts[0] === 'rankings') return duelHandler(request,parts);
      if (parts[0] === 'fighters' && parts[2] === 'statistics') return statisticsHandler(request, parts);
      // The site's delete button (2026-10-30): its own session check, so before the routes below authenticate.
      if (deletionRoute(parts)) return deletionHandler(request, parts);
      if (entryRoute(parts)) return entryHandler(request, parts);
      // 선수 프로필 세트 (2026-10-31): the owner's upload and the validator's queue (api/profile-sets.mjs).
      if (profileSetRoute(parts) || profileSetWorkerRoute(parts)) return profileSetHandler(request, parts);
      // Device-connection sign-in: start and poll are unauthenticated; approve verifies the user itself.
      if (parts[0] === 'device-logins') return deviceLoginHandler(request, parts);
      // Account and sign-in handoff routes work for every verified account.
      if (parts.length === 1 && ['me', 'access-requests', 'creator-handoffs'].includes(parts[0])) return accountHandler(request, parts);
      if (method === 'GET' && parts.join('/') === 'spec') return json({ ok: true, stage: 'public-contract', data: { ...spec,
        registration: { available: true, mode: 'open', auth: 'supabase-user-jwt', assetUpload: 'authenticated-binary',
          approvalRequired: false, publication: 'owner-entry-after-file-validation', moderation: 'post-publication', deviceLogin: 'v1', profileUpdate: 'v1',
          fighterEntry: 'v1', dailySubmissionLimit: 5, revisionsCountTowardLimit: false, profileSet: 'v1' }, profileSet: PROFILE_SET_SPEC } });
      // Validated, active packages are public; uploads and removed packages remain private. The list holds entered fighters only (출전,
      // 2026-10-30): one in production is served at his own address, for his owner's previews and practice, and meets nobody else.
      if (parts[0] === 'roster' && (method === 'GET' || method === 'OPTIONS')) {
        /** @type {(body: any, status?: number) => Response} */
        const reply = (body, status = 200) => jsonResponse(body, status, ROSTER_CORS);
        if (method === 'OPTIONS') return reply({ ok: true });
        // af_roster_entries joins the agent that made each fighter (`made_with`), so a page or a fighter is one query (2026-10-29).
        let query = db.from('af_roster_entries').select('id,created_at,submission_id,manifest_sha,profile,runtime_approved,runtime_scope,runtime_manifest_sha,duel_approved,duel_manifest_sha,made_with,entered_at,profile_set')
          .eq('runtime_approved', true).eq('runtime_scope', 'arena-player-v1').eq('review_state', 'approved');
        if (parts.length === 1) {
          // An unlisted fighter (`listed`, 2026-10-27) is left out of the list only: his own address below still serves him.
          query = query.eq('listed', true).not('entered_at', 'is', null);
          const cursor = new URL(request.url).searchParams.get('after');
          if (cursor !== null) {
            // Strictly validate both parts before placing them in PostgREST filter syntax.
            const parts = cursor.split('|'), [createdAt, id] = parts;
            if (parts.length !== 2 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(createdAt)
              || !Number.isFinite(Date.parse(createdAt)) || !UUID.test(id)) return reply({ ok: false, code: 'invalid-cursor' }, 400);
            query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.gt.${id})`);
          }
          query = query.order('created_at', { ascending: false }).order('id');
          const { data, error } = await query.limit(21); check(error);
          const last = data[19], hasMore = data.length > 20, shown = /** @type {RosterFighter[]} */ (data.slice(0, 20)).filter(f => f.runtime_manifest_sha === f.manifest_sha);
          return reply({ ok: true, hasMore, nextCursor: hasMore ? `${last.created_at}|${last.id}` : null,
            fighters: shown.map(f => ({ id: f.id, manifestSha256: f.manifest_sha, name: f.profile.name, ...(f.profile.names ? { names: f.profile.names } : {}), runtimeScope: f.runtime_scope,
              duelApproved: f.duel_approved === true && f.duel_manifest_sha === f.manifest_sha && f.entered_at != null, entered: true, ...(f.made_with ? { madeWith: f.made_with } : {}),
              ...rosterProfileSet(db, f) })) });
        }
        if (parts.length !== 2 || !UUID.test(parts[1])) return reply({ ok: false, code: 'not-found' }, 404);
        const { data: fighter, error } = await query.eq('id', parts[1]).maybeSingle(); check(error);
        if (!fighter || fighter.runtime_manifest_sha !== fighter.manifest_sha) return reply({ ok: false, code: 'not-found' }, 404);
        const { data: row, error: readError } = await db.from('af_submissions').select('*').eq('id', fighter.submission_id).eq('status', 'registered').maybeSingle();
        check(readError);
        if (!row || row.manifest_sha !== fighter.manifest_sha) return reply({ ok: false, code: 'not-found' }, 404);
        // `duelApproved` is whether he may meet other people now: admitted on this package and entered (af_duel_admitted's own gate).
        const urls = await signedUrls(row, 600), maker = fighter.made_with;
        const files = row.manifest.assets.map(/** @param {{ id: string }} asset @param {number} index */ (asset, index) => ({ id: asset.id, downloadUrl: urls[index] }));
        return reply({ ok: true, fighterId: fighter.id, manifestSha256: fighter.manifest_sha, runtimeApproved: true,
          runtimeScope: fighter.runtime_scope, duelApproved: fighter.duel_approved === true && fighter.duel_manifest_sha === fighter.manifest_sha
            && fighter.entered_at != null, entered: fighter.entered_at != null, manifestText: row.manifest_text, files, ...(maker ? { madeWith: maker } : {}),
          ...rosterProfileSet(db, fighter) });
      }
      if (parts.join('/') === 'analytics/context' && request.method === 'OPTIONS' && analytics) return analytics.preflight();
      const isWorker = parts[0] === 'worker';
      const owner = await authenticate(request, isWorker ? 'validation' : false);
      if (!isWorker && parts.join('/') === 'analytics/context' && analytics) return analytics.context(request, owner);
      if (profileRoute && method === 'PATCH') {
        const row = await updateFighterProfile({ request, owner, id: requireId(parts[1]), key: requireId(request.headers.get('idempotency-key')), db, rpc });
        return json(await present(row));
      }
      if (method === 'POST' && parts.join('/') === 'submissions') {
        const key = requireId(request.headers.get('idempotency-key'));
        // ?fighter=<id> replaces the package of the caller's own fighter in place (2026-10-23); absent, it registers another fighter within the account quota.
        const target = new URL(request.url).searchParams.get('fighter');
        if (target !== null && !UUID.test(target)) throw new Problem(422, 'invalid-fighter');
        const manifest = await checkedManifest(request);
        const row = await rpc('af_create_submission', { p_owner: owner, p_key: key, p_text: manifest.text, p_sha: manifest.sha, p_bytes: manifest.bytes, p_fighter: target });
        return json(await present(row), 200);
      }
      if (parts[0] === 'submissions' && parts.length >= 2) {
        const row = await ownSubmission(owner, parts[1]);
        if (method === 'GET' && parts.length === 2) return json(await present(row));
        if (method === 'POST' && parts.length === 3 && parts[2] === 'submit')
          return json(await present(await rpc('af_submit', { p_owner: owner, p_id: row.id })));
        if (method === 'PUT' && parts.length === 4 && parts[2] === 'assets') return json(await storeAsset(db, row, parts[3], request));
      }
      if (method === 'GET' && parts[0] === 'fighters' && parts.length === 2) {
        const { data, error } = await db.from('af_fighters').select('id,submission_id,manifest_sha,profile,status,review_state,runtime_approved,runtime_scope,duel_approved,created_at,moderation_reason,deleted_at,entered_at').eq('id', requireId(parts[1])).eq('owner_id', owner).maybeSingle();
        check(error); if (!data) throw new Problem(404, 'not-found');
        if (data.deleted_at) return json({ ok: true, stage: 'deleted', fighterId: data.id, deletedAt: data.deleted_at });
        // His current combat (2026-10-27): the stats, the fighting style and the skill clip's kind — what a style edit starts from.
        const { data: current, error: currentError } = await db.from('af_submissions').select('manifest').eq('id', data.submission_id)
          .eq('owner_id', owner).maybeSingle();
        check(currentError);
        const manifest = current?.manifest;
        // His front for the entry (정면 판정, 2026-11-03): whether the gate asks for one and the set that lets him enter, or why none does yet.
        // A read that fails leaves it out, never his fighter (an API deployed before its migration).
        const front = data.status === 'registered' ? (await Promise.resolve(db.rpc('af_fighter_front', { p_fighter: data.id })).catch(() => null))?.data ?? null : null;
        return json({ ok: true, stage: 'registered', fighter: { ...data, ...(manifest ? { combat: { stats: manifest.combat?.stats ?? null,
          style: manifest.combat?.style ?? null, skill: manifest.clips?.skill?.skill?.kind ?? null } } : {}), ...(front ? { front } : {}) } });
      }
      if (isWorker && method === 'POST') {
        let body;
        try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 16000))); }
        catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-body'); }
        if (parts.join('/') === 'worker/claim') {
          if (body.submissionId) requireId(body.submissionId);
          /** @type {Submission | null} */
          const row = await rpc('af_claim', { p_id: body.submissionId ?? null });
          if (!row?.id) return json({ ok: true, stage: 'idle' });
          // The lease is five minutes; the URLs outlive it so a slow job fails on its deadline, not on a dead link.
          const urls = await signedUrls(row, 360);
          const files = row.manifest.assets.map((asset, index) => ({ ...asset, downloadUrl: urls[index] }));
          return json({ ok: true, stage: 'validating', submissionId: row.id, leaseToken: row.lease_token,
            manifestText: row.manifest_text, manifestSha256: row.manifest_sha, files });
        }
        if (parts.join('/') === 'worker/finish') {
          requireId(body.submissionId); requireId(body.leaseToken);
          if (!/^[a-f0-9]{64}$/.test(body.manifestSha256 ?? '') || typeof body.passed !== 'boolean' || !body.result || Array.isArray(body.result)) throw new Problem(400, 'invalid-result');
          const completed = await rpc('af_finish', { p_id: body.submissionId, p_lease: body.leaseToken,
            p_sha: body.manifestSha256, p_passed: body.passed, p_result: body.result });
          try { await analytics?.registered(completed); } catch { /* Analytics must never break registration. */ }
          // A hosted fighter's profile set (2026-10-31): his chosen front, kept on his job, becomes his set now that he is registered.
          try { await attachJobProfileSet(db, completed); } catch { /* A set never breaks registration; his owner can upload one. */ }
          return json(await present(completed));
        }
        // An infrastructure failure under the caller's own lease: requeue without spending one of the package's attempts.
        if (parts.join('/') === 'worker/release') {
          requireId(body.submissionId); requireId(body.leaseToken);
          if (!/^[a-z0-9-]{1,64}$/.test(body.code ?? '')) throw new Problem(400, 'invalid-release-code');
          const released = await rpc('af_release', { p_id: body.submissionId, p_lease: body.leaseToken, p_code: body.code });
          return json({ ok: true, stage: released.status === 'queued' ? 'requeued' : 'rejected' });
        }
      }
      throw new Problem(404, 'route-not-found');
    } catch (error) {
      logFailure('api', request, error);
      if (error instanceof Problem) return json({ ok: false, stage: 'api', code: error.message, ...(error.errors ? { errors: error.errors } : {}) }, error.status);
      return json({ ok: false, stage: 'api', code: 'service-unavailable' }, 503);
    }
  };
}
