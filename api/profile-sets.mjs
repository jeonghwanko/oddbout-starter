// @ts-check
// 선수 프로필 세트 (2026-10-31, supabase/migrations/20261031100000_oddbout_profile_sets.sql): a registered fighter's front painting and its face
// square, kept outside his duel package. The owner uploads the set (`fighters/<id>/profile-sets` → `profile-sets/<id>/assets/front` →
// `profile-sets/<id>/submit`); the Render validator decodes it and stores a 600-px card and a 192-px face (`worker/profile-sets/*`); an
// operator approves it (admin.mjs), which copies the derived files to the public bucket; the roster names them (`rosterProfileSet`).
// No Node-only imports: Deno and Node.
import { Problem, UUID, jsonResponse, logFailure, readBody, rpcProblem, sha256 } from './http.mjs';
import { BUCKET } from './submissions.mjs';
import { probeImage } from './image-probe.mjs';
import { PROFILE_SET_ASSETS, PROFILE_SET_LIMITS, PROFILE_SET_VERSION, parseProfileSet } from './profile-set-contract.mjs';
// The set file's contract lives in profile-set-contract.mjs (no imports: the validator and the kit read it); the API's callers import it here.
export { PROFILE_SET_ASSETS, PROFILE_SET_EXPRESSIONS, PROFILE_SET_EXPRESSIONS_PROMPT, PROFILE_SET_LIMITS, PROFILE_SET_SPEC, PROFILE_SET_STYLE,
  PROFILE_SET_VERSION, STYLE_ANCHOR_URL, parseProfileSet } from './profile-set-contract.mjs';
/** @typedef {import('./profile-set-contract.mjs').ProfileSetFile} ProfileSetFile */
/** @typedef {import('./profile-set-contract.mjs').FaceSquare} FaceSquare */

// The worker stamps this on every receipt; af_profile_set_finish takes this version and 0.1.0 (a worker from before the expression sheet,
// which can pass only a set without one).
export const PROFILE_SET_VALIDATOR_VERSION = 'oddbout-profile-set-validator-0.2.0';
/** The approved derived files, at `<fighter>/<sha256>.webp`. Public: the roster and the home read them by address. */
export const PUBLIC_BUCKET = 'af-profile-sets';
/**
 * A row of af_profile_sets as the API reads it.
 * @typedef {{ id: string, fighter_id: string, owner_id: string, status: string, manifest_text: string, manifest_sha: string,
 *   manifest: ProfileSetFile, derived: any, validation: any, reason: string | null, lease_token: string | null, lease_until: string | null,
 *   expires_at: string, created_at: string, validated_at: string | null, approved_at: string | null, based_on?: string | null }} ProfileSetRow
 */

/** @type {(value: unknown) => boolean} */
const int = value => Number.isSafeInteger(value);
/** @param {unknown} value @returns {value is Record<string, any>} */
function object(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

/**
 * The private object of a set's file: the uploads `front` and `expressions`, the derived `card`, `face` and `sheet`.
 * @param {string} owner @param {string} id @param {string} name
 */
export const profileSetKey = (owner, id, name) => `${owner}/profile-sets/${id}/${name}.webp`;
/** The public object of an approved derived file. @param {string} fighter @param {string} sha */
export const publicProfileSetPath = (fighter, sha) => `${fighter}/${sha}.webp`;
/** The derived files a set has: the card and face always, the arena's sheet when he sent an expression sheet. @param {any} derived */
export const derivedNames = derived => ['card', 'face', ...(object(derived?.sheet) ? ['sheet'] : [])];
/** Is this the arena's sheet as the validator makes it? @param {unknown} sheet */
const runtimeSheet = sheet => object(sheet) && sheet.width === PROFILE_SET_LIMITS.sheet.width && sheet.height === PROFILE_SET_LIMITS.sheet.height
  && sheet.cell === PROFILE_SET_LIMITS.sheet.cell;

/**
 * The roster's `profileSet` for a fighter whose approved set af_roster_entries joined (`profile_set`), or nothing. The addresses are this
 * project's public bucket; the site and the arena take no other. `expressions` is the arena's sheet (ARENA_FACE_EXPRESSIONS order), only
 * when his set has one.
 * @param {any} db @param {{ id: string, profile_set?: { id: string, derived: any } | null }} row
 * @returns {{ profileSet?: { id: string, card: { url: string, width: number, height: number, face: FaceSquare }, face: { url: string, size: number },
 *   expressions?: { url: string, width: number, height: number, cell: number } } }}
 */
export function rosterProfileSet(db, row) {
  const set = row.profile_set, card = set?.derived?.card, face = set?.derived?.face, sheet = set?.derived?.sheet;
  if (!set || !object(card) || !object(face) || !object(card.face)) return {};
  const bucket = db.storage?.from?.(PUBLIC_BUCKET);
  if (typeof bucket?.getPublicUrl !== 'function') return {};
  /** @type {(sha: unknown) => string | null} */
  const url = sha => {
    if (typeof sha !== 'string' || !/^[a-f0-9]{64}$/.test(sha)) return null;
    const address = bucket.getPublicUrl(publicProfileSetPath(row.id, sha))?.data?.publicUrl;
    return typeof address === 'string' && address.startsWith('https://') ? address : null;
  };
  const cardUrl = url(card.sha256), faceUrl = url(face.sha256);
  if (!cardUrl || !faceUrl || ![card.width, card.height, card.face.x, card.face.y, card.face.side, face.size].every(int)
    || card.height !== PROFILE_SET_LIMITS.cardHeight || card.width < 1 || card.width > PROFILE_SET_LIMITS.cardMaxWidth || face.size !== PROFILE_SET_LIMITS.faceSize) return {};
  // A sheet that does not read leaves his card and face: the arena then shows his face square for every mood.
  const sheetUrl = runtimeSheet(sheet) ? url(sheet.sha256) : null;
  return { profileSet: { id: set.id, card: { url: cardUrl, width: card.width, height: card.height,
    face: { x: card.face.x, y: card.face.y, side: card.face.side } }, face: { url: faceUrl, size: face.size },
    ...(sheetUrl ? { expressions: { url: sheetUrl, width: sheet.width, height: sheet.height, cell: sheet.cell } } : {}) } };
}

/** The refusals of the profile-set functions and their statuses. @type {Readonly<Record<string, number>>} */
export const PROFILE_SET_STATUS = Object.freeze({
  'idempotency-conflict': 409, 'open-profile-set-exists': 409, 'profile-set-quota': 409, 'submissions-paused': 409, 'assets-incomplete': 409,
  'upload-expired': 409, 'upload-closed': 409, 'stale-validation': 409, 'review-conflict': 409, 'fighter-deleted': 409,
  'not-found': 404, 'fighter-not-found': 404, 'rate-limit': 429, 'account-disabled': 403, 'admin-required': 403,
  'validator-version': 400, 'validation-incomplete': 400, 'validation-result-limit': 400, 'invalid-release-code': 400, 'invalid-review': 400,
  'invalid-query': 400, 'byte-budget-mismatch': 422, 'invalid-reason': 400, 'fighter-mismatch': 409,
});

/** Is this path a profile set's? (The worker's are under `worker/`, the operator's under `admin/`.) @param {string[]} parts */
export function profileSetRoute(parts) {
  return (parts[0] === 'fighters' && parts[2] === 'profile-sets' && parts.length === 3) || parts[0] === 'profile-sets';
}
/** Is this path the validator's? @param {string[]} parts */
export const profileSetWorkerRoute = parts => parts[0] === 'worker' && parts[1] === 'profile-sets';

/** @type {(row: ProfileSetRow) => boolean} */
const uploadExpired = row => row.status === 'uploading' && Date.parse(row.expires_at) <= Date.now();
/**
 * A set as its owner reads it. `urls` signs his own files for a preview (a single set's read only); a file not stored yet is null.
 * @param {ProfileSetRow} row @param {Record<string, string | null>} [urls]
 */
export function profileSetView(row, urls) {
  const card = row.derived?.card, face = row.derived?.face, sheet = row.derived?.sheet, expressions = row.manifest.expressions;
  return { ok: true, stage: row.status, profileSetId: row.id, fighterId: row.fighter_id, manifestSha256: row.manifest_sha,
    front: row.manifest.front, face: row.manifest.face, ...(expressions ? { expressions } : {}), ...(uploadExpired(row) ? { code: 'upload-expired' } : {}),
    ...(row.status === 'uploading' && !uploadExpired(row) ? { assets: [{ id: 'front', bytes: row.manifest.front.bytes, sha256: row.manifest.front.sha256 },
      ...(expressions ? [{ id: 'expressions', bytes: expressions.bytes, sha256: expressions.sha256 }] : [])] } : {}),
    ...(card && face ? { derived: { card: { width: card.width, height: card.height, face: card.face }, face: { size: face.size },
      ...(sheet ? { sheet: { width: sheet.width, height: sheet.height, cell: sheet.cell } } : {}) } } : {}),
    ...(row.reason ? { reason: row.reason } : {}), ...(row.validation?.errors ? { errors: row.validation.errors } : {}),
    // A sheet the validator left out of a passing set (2026-11-03): the set goes on with his face square only.
    ...(Array.isArray(row.validation?.sheetErrors) && row.validation.sheetErrors.length ? { sheetErrors: row.validation.sheetErrors } : {}),
    createdAt: row.created_at, ...(row.approved_at ? { approvedAt: row.approved_at } : {}), ...(urls ? { urls } : {}),
    pending: { uploading: [...PROFILE_SET_ASSETS.filter(id => id === 'front' || expressions).map(id => `upload-${id}`), 'submit'],
      queued: ['server-validation', 'operator-review'], validating: ['server-validation', 'operator-review'], review: ['operator-review'] }[row.status] ?? [] };
}
/**
 * Sign a set's private files in one Storage call: its uploads once submitted and, once validated, its derived files. A file Storage cannot
 * sign (not uploaded yet, removed) is null; a failed call throws.
 * @param {any} db @param {ProfileSetRow} row @param {number} seconds @returns {Promise<Record<string, string | null>>}
 */
export async function signProfileSet(db, row, seconds) {
  const names = [...(row.status === 'uploading' ? [] : ['front', ...(row.manifest.expressions ? ['expressions'] : [])]),
    ...(row.derived ? derivedNames(row.derived).filter(name => object(row.derived[name])) : [])];
  if (!names.length) return {};
  const paths = names.map(name => profileSetKey(row.owner_id, row.id, name));
  const { data, error } = await db.storage.from(BUCKET).createSignedUrls(paths, seconds);
  if (error || !Array.isArray(data)) throw new Problem(503, 'storage-unavailable');
  const signed = new Map(data.map(item => [item?.path, item]));
  return Object.fromEntries(names.map((name, index) => {
    const item = signed.get(paths[index]);
    return [name, item && !item.error && typeof item.signedUrl === 'string' ? item.signedUrl : null];
  }));
}

/** @type {(bytes: Uint8Array) => boolean} */
const webp = bytes => bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
/**
 * Store an object once: an existing object is a successful retry only if its bytes match. True when this call wrote it.
 * @param {any} db @param {string} bucketName @param {string} path @param {Uint8Array} bytes @param {string} hash @param {boolean} [upsert]
 * @param {string} [cacheControl]  seconds: a year for private files; a day for the public copies, which leave when a set does
 * @returns {Promise<boolean>}
 */
export async function storeOnce(db, bucketName, path, bytes, hash, upsert = false, cacheControl = '31536000') {
  const bucket = db.storage.from(bucketName);
  const { error } = await bucket.upload(path, bytes, { contentType: 'image/webp', cacheControl, upsert });
  if (!error) return true;
  const { data, error: getError } = await bucket.download(path);
  if (getError || !data || data.size !== bytes.length || await sha256(new Uint8Array(await data.arrayBuffer())) !== hash) throw new Problem(503, 'storage-unavailable');
  return false;
}

/** A small JSON body. @param {Request} request @param {number} limit */
async function jsonBody(request, limit) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, limit))); }
  catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-body'); }
}

/**
 * The owner's routes and the validator's. `authenticate` is handler.mjs's: the owner (after af_authorize) or, for a validation worker key, null.
 * @param {{ db: any, authenticate: (request: Request, worker: false | 'validation' | 'generation') => Promise<string | null> }} options
 * @returns {import('./http.mjs').Route}
 */
export function createProfileSetHandler({ db, authenticate }) {
  /** @param {string} name @param {Record<string, unknown>} args */
  async function rpc(name, args) {
    const { data, error } = await db.rpc(name, args);
    if (error) throw rpcProblem(error, PROFILE_SET_STATUS);
    return data;
  }
  /** @param {string} id @param {string | null} owner @returns {Promise<ProfileSetRow>} */
  async function readSet(id, owner) {
    if (!UUID.test(id ?? '')) throw new Problem(400, 'invalid-id');
    let query = db.from('af_profile_sets').select('*').eq('id', id.toLowerCase());
    if (owner) query = query.eq('owner_id', owner);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Problem(503, 'database-unavailable');
    if (!data) throw new Problem(404, 'not-found');
    return data;
  }
  const cors = profileSetCors;
  return async (request, parts) => {
    const worker = profileSetWorkerRoute(parts);
    /** @type {(body: any, status?: number) => Response} */
    const json = (body, status = 200) => jsonResponse(body, status, worker ? undefined : cors);
    try {
      const method = request.method;
      if (!worker && method === 'OPTIONS') return json({ ok: true });
      if (worker) return json(await workerRoute(request, parts, await authenticate(request, 'validation')));
      const owner = /** @type {string} */ (await authenticate(request, false));
      if (parts[0] === 'fighters') {
        if (!UUID.test(parts[1] ?? '')) throw new Problem(400, 'invalid-id');
        const fighter = parts[1].toLowerCase();
        if (method === 'GET') {
          const { data, error } = await db.from('af_profile_sets').select('*').eq('fighter_id', fighter).eq('owner_id', owner)
            .order('created_at', { ascending: false }).limit(10);
          if (error) throw new Problem(503, 'database-unavailable');
          return json({ ok: true, fighterId: fighter, profileSets: (data ?? []).map(/** @param {ProfileSetRow} row */ row => profileSetView(row)) });
        }
        if (method !== 'POST') throw new Problem(404, 'route-not-found');
        const key = request.headers.get('idempotency-key');
        if (!UUID.test(key ?? '')) throw new Problem(400, 'invalid-id');
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, PROFILE_SET_LIMITS.jsonBytes)); }
        catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-utf8'); }
        const parsed = parseProfileSet(text);
        if (!parsed.ok) throw new Problem(422, 'invalid-profile-set', parsed.errors);
        const row = await rpc('af_profile_set_create', { p_owner: owner, p_fighter: fighter, p_key: /** @type {string} */ (key).toLowerCase(), p_text: text,
          p_sha: await sha256(new TextEncoder().encode(text)), p_bytes: parsed.data.front.bytes });
        return json(profileSetView(row));
      }
      const row = await readSet(parts[1], owner);
      if (method === 'GET' && parts.length === 2) return json(profileSetView(row, await signProfileSet(db, row, 600)));
      if (method === 'POST' && parts.length === 3 && parts[2] === 'submit') return json(profileSetView(await rpc('af_profile_set_submit', { p_owner: owner, p_id: row.id })));
      if (method === 'PUT' && parts.length === 4 && parts[2] === 'assets' && PROFILE_SET_ASSETS.includes(parts[3])) {
        const id = /** @type {'front' | 'expressions'} */ (parts[3]), file = row.manifest[id];
        if (!file) throw new Problem(404, 'route-not-found');
        if (row.status !== 'uploading' || uploadExpired(row)) throw new Problem(409, 'upload-closed');
        if (request.headers.get('content-type') !== 'image/webp') throw new Problem(415, 'webp-required');
        const bytes = await readBody(request, file.bytes);
        if (bytes.length !== file.bytes || await sha256(bytes) !== file.sha256) throw new Problem(422, 'asset-hash-or-size');
        if (!webp(bytes)) throw new Problem(422, 'webp-required');
        await storeOnce(db, BUCKET, profileSetKey(row.owner_id, row.id, id), bytes, file.sha256);
        return json({ ok: true, stage: 'uploaded', assetId: id, bytes: bytes.length });
      }
      throw new Problem(404, 'route-not-found');
    } catch (error) {
      logFailure('profile-sets', request, error);
      if (error instanceof Problem) return json({ ok: false, stage: 'api', code: error.message, ...(error.errors ? { errors: error.errors } : {}) }, error.status);
      return json({ ok: false, stage: 'api', code: 'service-unavailable' }, 503);
    }
  };

  /**
   * The validator's routes: claim a queued set, store its derived files under the lease, finish or release it.
   * @param {Request} request @param {string[]} parts @param {string | null} _worker
   */
  async function workerRoute(request, parts, _worker) {
    const route = parts.slice(2).join('/'), method = request.method;
    if (method === 'PUT' && parts.length === 5 && parts[3] === 'derived' && ['card', 'face', 'sheet'].includes(parts[4])) {
      const lease = request.headers.get('x-profile-set-lease');
      if (!UUID.test(lease ?? '')) throw new Problem(400, 'invalid-id');
      const row = await readSet(parts[2], null);
      if (row.status !== 'validating' || row.lease_token !== /** @type {string} */ (lease).toLowerCase() || Date.parse(row.lease_until ?? '') <= Date.now())
        throw new Problem(409, 'stale-validation');
      if (request.headers.get('content-type') !== 'image/webp') throw new Problem(415, 'webp-required');
      const bytes = await readBody(request, PROFILE_SET_LIMITS.derivedBytes);
      if (!webp(bytes)) throw new Problem(422, 'webp-required');
      const hash = await sha256(bytes);
      // A reclaimed lease makes the same files again: the newest bytes under the live lease win.
      await storeOnce(db, BUCKET, profileSetKey(row.owner_id, row.id, parts[4]), bytes, hash, true);
      return { ok: true, stage: 'uploaded', name: parts[4], bytes: bytes.length, sha256: hash };
    }
    if (method !== 'POST') throw new Problem(404, 'route-not-found');
    const body = await jsonBody(request, 16000);
    if (!object(body)) throw new Problem(400, 'invalid-body');
    if (route === 'claim') {
      if (body.profileSetId !== undefined && !UUID.test(body.profileSetId)) throw new Problem(400, 'invalid-id');
      /** @type {ProfileSetRow | null} */
      const row = await rpc('af_profile_set_claim', { p_id: body.profileSetId ?? null });
      if (!row?.id) return { ok: true, stage: 'idle' };
      // The lease is five minutes; the URL outlives it so a slow job fails on its deadline, not on a dead link.
      const { front, expressions } = await signProfileSet(db, { ...row, derived: null }, 360);
      if (!front || (row.manifest.expressions && !expressions)) throw new Problem(503, 'storage-unavailable');
      return { ok: true, stage: 'validating', profileSetId: row.id, leaseToken: row.lease_token, manifestText: row.manifest_text,
        manifestSha256: row.manifest_sha, front: { ...row.manifest.front, downloadUrl: front }, face: row.manifest.face,
        ...(row.manifest.expressions ? { expressions: { ...row.manifest.expressions, downloadUrl: expressions } } : {}) };
    }
    if (route === 'finish') {
      if (!UUID.test(body.profileSetId ?? '') || !UUID.test(body.leaseToken ?? '') || !/^[a-f0-9]{64}$/.test(body.manifestSha256 ?? '')
        || typeof body.passed !== 'boolean' || !object(body.result) || (body.passed && !object(body.derived))) throw new Problem(400, 'invalid-result');
      const row = await rpc('af_profile_set_finish', { p_id: body.profileSetId, p_lease: body.leaseToken, p_sha: body.manifestSha256,
        p_passed: body.passed, p_result: body.result, p_derived: body.passed ? body.derived : null });
      return profileSetView(row);
    }
    if (route === 'release') {
      if (!UUID.test(body.profileSetId ?? '') || !UUID.test(body.leaseToken ?? '')) throw new Problem(400, 'invalid-id');
      if (typeof body.code !== 'string' || !/^[a-z0-9-]{1,64}$/.test(body.code)) throw new Problem(400, 'invalid-release-code');
      const released = await rpc('af_profile_set_release', { p_id: body.profileSetId, p_lease: body.leaseToken, p_code: body.code });
      return { ok: true, stage: released.status === 'queued' ? 'requeued' : 'rejected' };
    }
    throw new Problem(404, 'route-not-found');
  }
}
/** The creator site calls these with its session's bearer token, from oddbout.com. */
export const profileSetCors = { methods: 'GET, POST, PUT, OPTIONS', headers: 'Authorization, Content-Type, Idempotency-Key' };

/**
 * Copy an approved set's derived files to the public bucket, each checked against the validator's hash. Returns the paths this call wrote
 * (an earlier approval's identical file stays).
 * @param {any} db @param {{ id: string, fighterId: string, ownerId: string, derived: any }} set
 */
export async function publishProfileSet(db, set) {
  /** @type {string[]} */
  const written = [];
  for (const name of derivedNames(set.derived)) {
    const file = set.derived?.[name];
    if (!object(file) || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Problem(409, 'review-conflict');
    const { data, error } = await db.storage.from(BUCKET).download(profileSetKey(set.ownerId, set.id, name));
    if (error || !data) throw new Problem(503, 'storage-unavailable');
    const bytes = new Uint8Array(await data.arrayBuffer());
    // The private object can change only under a live validation lease; what the operator approves is what the validator recorded.
    if (bytes.length !== file.bytes || await sha256(bytes) !== file.sha256) throw new Problem(409, 'review-conflict');
    const path = publicProfileSetPath(set.fighterId, file.sha256);
    if (await storeOnce(db, PUBLIC_BUCKET, path, bytes, file.sha256, false, '86400')) written.push(path);
  }
  return written;
}

/**
 * Remove public copies. Storage answers a failure as `{ error }` (or throws): one more try, then the failure is recorded
 * (af_profile_set_events `public-cleanup-failed`). True when they are gone.
 * @param {any} db @param {string} fighterId @param {string[]} paths @returns {Promise<boolean>}
 */
export async function removePublicFiles(db, fighterId, paths) {
  if (!paths.length) return true;
  const bucket = db.storage.from(PUBLIC_BUCKET);
  /** @type {() => Promise<any>} */
  const remove = () => Promise.resolve().then(() => bucket.remove(paths)).catch(caught => ({ error: caught }));
  let result = await remove();
  if (result?.error) result = await remove();
  if (!result?.error) return true;
  await Promise.resolve().then(() => db.rpc('af_profile_set_cleanup_failed', { p_fighter: fighterId, p_paths: paths,
    p_error: String(result.error?.message ?? result.error).slice(0, 200) })).catch(() => {});
  return false;
}

/**
 * Remove the public copies of a fighter's sets that were approved and no longer are (superseded, rejected, withdrawn with him), after the
 * database change that made them stale has committed. Storage answers a failure as `{ error }`: one more try, then the failure is recorded
 * (af_profile_set_events `public-cleanup-failed`) and the next cleanup of this fighter tries again. Never throws: the change it follows stands.
 * @param {any} db @param {string} fighterId @returns {Promise<{ removed: number, failed?: number }>}
 */
export async function cleanupPublicFiles(db, fighterId) {
  try {
    const { data, error } = await db.rpc('af_profile_set_stale_public', { p_fighter: fighterId });
    if (error || !Array.isArray(data) || !data.length) return { removed: 0 };
    /** @type {string[]} */
    const shas = data.flatMap(row => (Array.isArray(row?.shas) ? row.shas : [])).filter(sha => typeof sha === 'string' && /^[a-f0-9]{64}$/.test(sha));
    const paths = [...new Set(shas)].map(sha => publicProfileSetPath(fighterId, sha));
    if (!await removePublicFiles(db, fighterId, paths)) return { removed: 0, failed: paths.length };
    await db.rpc('af_profile_set_unpublished', { p_fighter: fighterId, p_ids: data.map(row => row.id) });
    return { removed: paths.length };
  } catch { return { removed: 0 }; }
}

/**
 * 운영자의 표정 시트 (2026-11-03 — 사용자: "무투장 패배 표정 없는 캐릭터들은 image-gen으로 생성해서 추가하고"): a sheet for a registered fighter,
 * without his owner's sign-in. From his current approved set (`setId`) a new set is made under his owner with the same front painting and
 * face square and the sheet, its front copied in private storage, and submitted: the validator, then the operator's review, as any set.
 * His current set stays until the new one is approved, and it is approved only while the set it was copied from is still his current one
 * (af_admin_profile_set_approve). af_admin_profile_set_expressions makes the set, records its base and the operator's event in one
 * transaction. `fighterId` is the fighter the operator means: another set's fighter is refused. The same key answers the same set for the
 * same sheet, also after it was approved; a failure after the set was made expires it, so it never holds his owner's own upload.
 * @param {any} db @param {{ actor: string, setId: string, fighterId: string, key: string, reason: string, bytes: Uint8Array<ArrayBuffer> }} input
 */
export async function addOperatorSheet(db, { actor, setId, fighterId, key, reason, bytes }) {
  /** @param {string} name @param {Record<string, unknown>} args */
  const rpc = async (name, args) => { const { data, error } = await db.rpc(name, args); if (error) throw rpcProblem(error, PROFILE_SET_STATUS); return data; };
  const { data: from, error } = await db.from('af_profile_sets').select('*').eq('id', setId).maybeSingle();
  if (error) throw new Problem(503, 'database-unavailable');
  if (!from) throw new Problem(404, 'not-found');
  if (from.fighter_id !== fighterId) throw new Problem(409, 'fighter-mismatch');
  const probed = probeImage(bytes);
  if (probed?.type !== 'image/webp') throw new Problem(415, 'webp-required');
  const { front, face } = JSON.parse(from.manifest_text);
  const expressions = { path: 'expressions.webp', bytes: bytes.length, sha256: await sha256(bytes), width: probed.width, height: probed.height };
  const text = JSON.stringify({ version: PROFILE_SET_VERSION, front, face, expressions });
  const parsed = parseProfileSet(text);
  if (!parsed.ok) throw new Problem(422, 'invalid-profile-set', parsed.errors);
  const sha = await sha256(new TextEncoder().encode(text));
  // A retry after the set went past its upload (even approved, which supersedes `from`): the same set, for the same sheet only.
  const { data: earlier, error: earlierError } = await db.from('af_profile_sets').select('*').eq('owner_id', from.owner_id).eq('idempotency_key', key).maybeSingle();
  if (earlierError) throw new Problem(503, 'database-unavailable');
  if (earlier && (earlier.manifest_sha !== sha || earlier.based_on !== from.id)) throw new Problem(409, 'idempotency-conflict');
  if (earlier && earlier.status !== 'uploading') return profileSetView(earlier);
  if (earlier && uploadExpired(earlier)) throw new Problem(409, 'upload-expired');
  // His approved front, checked before anything is made (리뷰 2026-11-03: a set made first and left half-uploaded held his owner's upload).
  const { data: download, error: downloadError } = await db.storage.from(BUCKET).download(profileSetKey(from.owner_id, from.id, 'front'));
  if (downloadError || !download) throw new Problem(503, 'storage-unavailable');
  const frontBytes = new Uint8Array(await download.arrayBuffer());
  if (frontBytes.length !== front.bytes || await sha256(frontBytes) !== front.sha256) throw new Problem(409, 'review-conflict');
  /** @type {ProfileSetRow} */
  const row = await rpc('af_admin_profile_set_expressions', { p_actor: actor, p_from: from.id, p_key: key, p_text: text, p_sha: sha,
    p_bytes: front.bytes, p_reason: reason });
  if (row.status !== 'uploading') return profileSetView(row);
  try {
    await storeOnce(db, BUCKET, profileSetKey(row.owner_id, row.id, 'front'), frontBytes, front.sha256);
    await storeOnce(db, BUCKET, profileSetKey(row.owner_id, row.id, 'expressions'), bytes, expressions.sha256);
    return profileSetView(await rpc('af_profile_set_submit', { p_owner: row.owner_id, p_id: row.id }));
  } catch (caught) {
    await expireUpload(db, row.id);
    throw caught;
  }
}
/**
 * Close a set left half-uploaded by the API itself (an operator's sheet, a hosted fighter's): it no longer holds his owner's own upload.
 * Never throws: the failure it follows is the answer.
 * @param {any} db @param {string} id
 */
export async function expireUpload(db, id) {
  await Promise.resolve().then(() => db.from('af_profile_sets').update({ expires_at: new Date().toISOString() }).eq('id', id).eq('status', 'uploading'))
    .catch(() => {});
}
