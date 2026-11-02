// @ts-check
// 선수 프로필 세트 (2026-10-31, supabase/migrations/20261031100000_oddbout_profile_sets.sql): a registered fighter's front painting and its face
// square, kept outside his duel package. The owner uploads the set (`fighters/<id>/profile-sets` → `profile-sets/<id>/assets/front` →
// `profile-sets/<id>/submit`); the Render validator decodes it and stores a 600-px card and a 192-px face (`worker/profile-sets/*`); an
// operator approves it (admin.mjs), which copies the derived files to the public bucket; the roster names them (`rosterProfileSet`).
// No Node-only imports: Deno and Node.
import { Problem, UUID, jsonResponse, logFailure, readBody, rpcProblem, sha256 } from './http.mjs';
import { BUCKET } from './submissions.mjs';

export const PROFILE_SET_VERSION = 'oddbout-profile-set-v1';
// The worker stamps this on every receipt; af_profile_set_finish takes only this version.
export const PROFILE_SET_VALIDATOR_VERSION = 'oddbout-profile-set-validator-0.1.0';
/** The approved derived files, at `<fighter>/<sha256>.webp`. Public: the roster and the home read them by address. */
export const PUBLIC_BUCKET = 'af-profile-sets';
export const PROFILE_SET_LIMITS = Object.freeze({ jsonBytes: 4000, frontBytes: 4000000, longSide: Object.freeze([1024, 2048]),
  shortSideMin: 512, faceMin: 16, derivedBytes: 1000000, cardHeight: 600, cardMaxWidth: 600, faceSize: 192 });
export const STYLE_ANCHOR_URL = 'https://oddbout.com/art/oddbout/style-anchor-front.webp';
/**
 * The house colouring every profile painting keeps (사용자 2026-10-31: "우리 아트스타일의 담백한 채색을 하도록 하는 것을 꼭 넣어줘"): the words
 * the house front concepts were generated with, and the style anchor attached as the last reference image.
 */
export const PROFILE_SET_STYLE = [
  'STYLE: clean painted 2D anime game illustration, the same rendering as the LAST image (the style anchor):',
  'warm dark line art (not pure black), restrained cel shading with soft painterly light, natural anatomy.',
  'COLOURING: OUR game\'s colouring, plain and restrained, exactly like the LAST image: flat clean cel colours with',
  'one soft shadow tone, warm dark line art (not pure black), a little soft painterly light.',
  'NOT semi-realistic, NOT heavy rendering, no glossy highlights, no dramatic lighting, no texture.',
  'Not pixel art, not chibi, not 3D, not photorealistic.',
  'The LAST image is the STYLE ANCHOR: match only its rendering, colouring, line weight, camera, framing and scale —',
  'do NOT copy its face, hair, body or costume.',
].join('\n');
export const PROFILE_SET_SPEC = Object.freeze({
  version: PROFILE_SET_VERSION,
  purpose: 'A registered fighter\'s front painting and face square: his profile, roster card, home face and the arena\'s faces. '
    + 'The home lists a fighter only with an approved set. It is not part of the duel package: changing it never changes the package.',
  file: { name: 'profile-set.json', maxBytes: PROFILE_SET_LIMITS.jsonBytes, example: { version: PROFILE_SET_VERSION,
    front: { path: 'front.webp', bytes: 812345, sha256: '<64 hex>', width: 1024, height: 1536 }, face: { x: 402, y: 96, side: 228 } } },
  front: { format: 'static WebP with a real alpha channel (transparent background)', maxBytes: PROFILE_SET_LIMITS.frontBytes,
    orientation: 'portrait: height greater than width', longSide: PROFILE_SET_LIMITS.longSide, shortSideMin: PROFILE_SET_LIMITS.shortSideMin,
    cardMaxWidth: PROFILE_SET_LIMITS.cardMaxWidth, framing: [
      'One character only, full body from head to feet.',
      'Front view: chest, face and toes toward the viewer; symmetric, not three-quarter.',
      'Camera at chest height looking straight ahead; no top-down tilt, no worm\'s-eye.',
      'Feet flat on one invisible ground line; head to feet about 86 percent of the image height, empty margin above the head and below the feet.',
      'Arms close to the body: the silhouette fits a tall narrow card (the character no wider than tall).',
      'No background, floor, cast shadow, scenery, frame, text, logo or other character. An item he always carries may stay.',
      'The same character, costume and colours as his side-view motions.'] },
  face: { shape: 'a square { x, y, side } in the front painting\'s pixels, holding the whole head and a little of the hair',
    rules: ['inside the painting and inside the character', 'side 10–30 % of the character\'s height (head to feet)',
      'its centre in the top 40 % of the character'] },
  style: { colouring: PROFILE_SET_STYLE, anchor: { url: STYLE_ANCHOR_URL,
    use: 'Attach it as the LAST reference image of every generation (front candidates, the side still, later edits). '
      + 'Follow only its rendering, colouring, line weight, camera, framing and scale. The user\'s reference pictures give the character, '
      + 'costume and colours, never the colouring style.' } },
  order: ['brief', 'two front candidates; the user picks or asks for a change', 'the face square, shown to the user as a round crop',
    'one side still from the chosen front (same colouring)', 'motions', 'register the package',
    'prepare_profile_set → upload_profile_set_asset → submit_profile_set with the front the user chose', 'enter after the motion review'],
  review: 'The validator decodes the file and makes a 600-px card and a 192-px face; an operator approves the set before the roster shows it.',
});

/** @typedef {{ path: string, bytes: number, sha256: string, width: number, height: number }} FrontFile */
/** @typedef {{ x: number, y: number, side: number }} FaceSquare */
/** @typedef {{ version: string, front: FrontFile, face: FaceSquare }} ProfileSetFile */
/**
 * A row of af_profile_sets as the API reads it.
 * @typedef {{ id: string, fighter_id: string, owner_id: string, status: string, manifest_text: string, manifest_sha: string,
 *   manifest: ProfileSetFile, derived: any, validation: any, reason: string | null, lease_token: string | null, lease_until: string | null,
 *   expires_at: string, created_at: string, validated_at: string | null, approved_at: string | null }} ProfileSetRow
 */

/** @type {(value: unknown) => boolean} */
const int = value => Number.isSafeInteger(value);
/** @param {unknown} value @returns {value is Record<string, any>} */
function object(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
/** @type {(value: Record<string, any>, keys: string[]) => boolean} */
const exactKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/**
 * A profile-set.json, checked: its shape, the painting's byte and size limits and the face square inside the painting. The validator
 * checks the decoded pixels later.
 * @param {string} text
 * @returns {{ ok: true, data: ProfileSetFile } | { ok: false, errors: { code: string, path: string }[] }}
 */
export function parseProfileSet(text) {
  /** @type {{ code: string, path: string }[]} */
  const errors = [];
  /** @type {(code: string, path: string) => { ok: false, errors: { code: string, path: string }[] }} */
  const fail = (code, path) => ({ ok: false, errors: [...errors, { code, path }] });
  let value;
  try { value = JSON.parse(text); } catch { return fail('INVALID_JSON', ''); }
  if (!object(value) || !exactKeys(value, ['version', 'front', 'face'])) return fail('PROFILE_SET_KEYS', '');
  if (value.version !== PROFILE_SET_VERSION) return fail('PROFILE_SET_VERSION', '/version');
  const { front, face } = value;
  if (!object(front) || !exactKeys(front, ['path', 'bytes', 'sha256', 'width', 'height'])) return fail('FRONT_KEYS', '/front');
  if (typeof front.path !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}\.webp$/.test(front.path)) errors.push({ code: 'FRONT_PATH', path: '/front/path' });
  if (!int(front.bytes) || front.bytes < 1 || front.bytes > PROFILE_SET_LIMITS.frontBytes) errors.push({ code: 'FRONT_BYTES', path: '/front/bytes' });
  if (typeof front.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(front.sha256)) errors.push({ code: 'FRONT_SHA256', path: '/front/sha256' });
  if (!int(front.width) || !int(front.height)) return fail('FRONT_DIMENSIONS', '/front');
  const long = Math.max(front.width, front.height), short = Math.min(front.width, front.height);
  if (long < PROFILE_SET_LIMITS.longSide[0] || long > PROFILE_SET_LIMITS.longSide[1] || short < PROFILE_SET_LIMITS.shortSideMin)
    errors.push({ code: 'FRONT_DIMENSIONS', path: '/front' });
  // A card stands tall: a landscape painting cannot hold a full-body front view at the roster's height.
  if (front.height <= front.width) errors.push({ code: 'FRONT_ORIENTATION', path: '/front' });
  if (!object(face) || !exactKeys(face, ['x', 'y', 'side']) || ![face.x, face.y, face.side].every(int)) return fail('FACE_KEYS', '/face');
  if (face.x < 0 || face.y < 0 || face.side < PROFILE_SET_LIMITS.faceMin || face.x + face.side > front.width || face.y + face.side > front.height)
    errors.push({ code: 'FACE_OUTSIDE', path: '/face' });
  if (errors.length) return { ok: false, errors };
  return { ok: true, data: /** @type {ProfileSetFile} */ (value) };
}

/** The private object of a set's file: `front`, `card` or `face`. @param {string} owner @param {string} id @param {string} name */
export const profileSetKey = (owner, id, name) => `${owner}/profile-sets/${id}/${name}.webp`;
/** The public object of an approved derived file. @param {string} fighter @param {string} sha */
export const publicProfileSetPath = (fighter, sha) => `${fighter}/${sha}.webp`;

/**
 * The roster's `profileSet` for a fighter whose approved set af_roster_entries joined (`profile_set`), or nothing. The addresses are this
 * project's public bucket; the site and the arena take no other.
 * @param {any} db @param {{ id: string, profile_set?: { id: string, derived: any } | null }} row
 * @returns {{ profileSet?: { id: string, card: { url: string, width: number, height: number, face: FaceSquare }, face: { url: string, size: number } } }}
 */
export function rosterProfileSet(db, row) {
  const set = row.profile_set, card = set?.derived?.card, face = set?.derived?.face;
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
  return { profileSet: { id: set.id, card: { url: cardUrl, width: card.width, height: card.height,
    face: { x: card.face.x, y: card.face.y, side: card.face.side } }, face: { url: faceUrl, size: face.size } } };
}

/** The refusals of the profile-set functions and their statuses. @type {Readonly<Record<string, number>>} */
export const PROFILE_SET_STATUS = Object.freeze({
  'idempotency-conflict': 409, 'open-profile-set-exists': 409, 'profile-set-quota': 409, 'submissions-paused': 409, 'assets-incomplete': 409,
  'upload-expired': 409, 'upload-closed': 409, 'stale-validation': 409, 'review-conflict': 409, 'fighter-deleted': 409,
  'not-found': 404, 'fighter-not-found': 404, 'rate-limit': 429, 'account-disabled': 403, 'admin-required': 403,
  'validator-version': 400, 'validation-incomplete': 400, 'validation-result-limit': 400, 'invalid-release-code': 400, 'invalid-review': 400,
  'invalid-query': 400, 'byte-budget-mismatch': 422,
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
  const card = row.derived?.card, face = row.derived?.face;
  return { ok: true, stage: row.status, profileSetId: row.id, fighterId: row.fighter_id, manifestSha256: row.manifest_sha,
    front: row.manifest.front, face: row.manifest.face, ...(uploadExpired(row) ? { code: 'upload-expired' } : {}),
    ...(row.status === 'uploading' && !uploadExpired(row) ? { assets: [{ id: 'front', bytes: row.manifest.front.bytes, sha256: row.manifest.front.sha256 }] } : {}),
    ...(card && face ? { derived: { card: { width: card.width, height: card.height, face: card.face }, face: { size: face.size } } } : {}),
    ...(row.reason ? { reason: row.reason } : {}), ...(row.validation?.errors ? { errors: row.validation.errors } : {}),
    createdAt: row.created_at, ...(row.approved_at ? { approvedAt: row.approved_at } : {}), ...(urls ? { urls } : {}),
    pending: { uploading: ['upload-front', 'submit'], queued: ['server-validation', 'operator-review'], validating: ['server-validation', 'operator-review'],
      review: ['operator-review'] }[row.status] ?? [] };
}

/**
 * Sign a set's private files in one Storage call: the front painting once uploaded and, once validated, its card and face. A file Storage
 * cannot sign (not uploaded yet, removed) is null; a failed call throws.
 * @param {any} db @param {ProfileSetRow} row @param {number} seconds @returns {Promise<Record<string, string | null>>}
 */
export async function signProfileSet(db, row, seconds) {
  const names = [...(row.status === 'uploading' ? [] : ['front']), ...(row.derived?.card ? ['card'] : []), ...(row.derived?.face ? ['face'] : [])];
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
      if (method === 'PUT' && parts.length === 4 && parts[2] === 'assets' && parts[3] === 'front') {
        if (row.status !== 'uploading' || uploadExpired(row)) throw new Problem(409, 'upload-closed');
        if (request.headers.get('content-type') !== 'image/webp') throw new Problem(415, 'webp-required');
        const front = row.manifest.front, bytes = await readBody(request, front.bytes);
        if (bytes.length !== front.bytes || await sha256(bytes) !== front.sha256) throw new Problem(422, 'asset-hash-or-size');
        if (!webp(bytes)) throw new Problem(422, 'webp-required');
        await storeOnce(db, BUCKET, profileSetKey(row.owner_id, row.id, 'front'), bytes, front.sha256);
        return json({ ok: true, stage: 'uploaded', assetId: 'front', bytes: bytes.length });
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
    if (method === 'PUT' && parts.length === 5 && parts[3] === 'derived' && ['card', 'face'].includes(parts[4])) {
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
      const { front } = await signProfileSet(db, { ...row, derived: null }, 360);
      if (!front) throw new Problem(503, 'storage-unavailable');
      return { ok: true, stage: 'validating', profileSetId: row.id, leaseToken: row.lease_token, manifestText: row.manifest_text,
        manifestSha256: row.manifest_sha, front: { ...row.manifest.front, downloadUrl: front }, face: row.manifest.face };
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
  for (const name of ['card', 'face']) {
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
