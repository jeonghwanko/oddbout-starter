// @ts-check
// A package's way in, shared by the creator's own routes (`handler.mjs`) and the hosted generation worker's (`generations.mjs`, 2026-10-27):
// the fighter.json checked the same way, its WebP assets stored the same way. No Node-only imports: Deno and Node.
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { parseFighterJson, validateFighter } from '../contracts/ai-fighter/validate.mjs';
import { Problem, readBody, sha256, unavailable, unstorableTextPath } from './http.mjs';

export const BUCKET = 'ai-fighter-beta';
// The Render validator (worker/run.mjs) stamps this on every receipt. af_settings.validator_versions lists the versions af_finish accepts.
export const VALIDATOR_VERSION = 'ai-fighter-validator-0.2.0';
/**
 * The submission path's refusals (`af_create_submission`, `af_submit`, `af_finish`, profile edits) and their statuses, for every route
 * that calls it. The hosted worker's routes kept their own copy: an expired upload came back to it as a database fault (503, which it
 * retries) and the service-busy refusals with another status (API 점검 2026-10-29).
 * @type {Readonly<Record<string, number>>}
 */
export const SUBMISSION_STATUS = Object.freeze({
  'idempotency-conflict': 409,
  'fighter-quota': 409,
  'fighter-removed': 409,
  'fighter-unchanged': 409,
  'fighter-changed': 409,
  'profile-not-editable': 409,
  'open-submission-exists': 409,
  'submission-quota': 409,
  'storage-budget-full': 409,
  'assets-incomplete': 409,
  'upload-expired': 409,
  'stale-validation': 409,
  'submissions-paused': 409,
  'beta-capacity': 409,
  'not-found': 404,
  'fighter-not-found': 404,
  'rate-limit': 429,
  'account-disabled': 403,
  'validator-version': 400,
  'validation-incomplete': 400,
  'validation-result-limit': 400,
  'byte-budget-mismatch': 422,
  'profile-only-required': 422,
});
/** @type {(submission: { owner_id: string, asset_source_submission?: string | null, id: string }, asset: { id: string }) => string} */
export const objectKey = (submission, asset) => `${submission.owner_id}/${submission.asset_source_submission ?? submission.id}/${asset.id}.webp`;

/** A request body as a fighter.json the contract accepts: its text, sha256 and asset bytes. Problem(422) names what fails. */
/** @param {Request} request */
export async function checkedManifest(request) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, spec.limits.jsonBytes));
  } catch (error) {
    if (error instanceof Problem) throw error;
    throw new Problem(400, 'invalid-utf8');
  }
  const parsed = parseFighterJson(text);
  if (!parsed.ok) throw new Problem(422, 'invalid-manifest', /** @type {any[]} */ (parsed.errors).slice(0, 20));
  const result = validateFighter(parsed.data);
  if (!result.ok) throw new Problem(422, 'invalid-manifest', result.errors.slice(0, 20));
  // Reject here with 422. Otherwise the jsonb cast in af_create_submission fails and the API returns 503.
  const unstorable = unstorableTextPath(parsed.data);
  if (unstorable !== null)
    throw new Problem(422, 'invalid-manifest', [
      { code: 'UNSUPPORTED_TEXT', path: unstorable, expected: 'text without U+0000 or unpaired surrogates', actual: 'unsupported character' },
    ]);
  return { text, sha: await sha256(new TextEncoder().encode(text)), bytes: result.assetBytes };
}

/**
 * One asset of an uploading submission, its bytes checked against the manifest and stored once (a retry of the same bytes succeeds).
 * @param {any} db
 * @param {{ status: string, expires_at: string, owner_id: string, id: string, asset_source_submission?: string | null,
 *   manifest: { assets: { id: string, bytes: number, sha256: string }[] } }} row  The submission row as read from the database.
 * @param {string} assetId
 * @param {Request} request
 */
export async function storeAsset(db, row, assetId, request) {
  if (row.status !== 'uploading' || new Date(row.expires_at).getTime() <= Date.now()) throw new Problem(409, 'upload-closed');
  const asset = row.manifest.assets.find(a => a.id === assetId);
  if (!asset) throw new Problem(404, 'asset-not-found');
  if (request.headers.get('content-type') !== 'image/webp') throw new Problem(415, 'webp-required');
  const bytes = await readBody(request, asset.bytes);
  if (bytes.length !== asset.bytes || (await sha256(bytes)) !== asset.sha256) throw new Problem(422, 'asset-hash-or-size');
  if (new TextDecoder().decode(bytes.slice(0, 4)) !== 'RIFF' || new TextDecoder().decode(bytes.slice(8, 12)) !== 'WEBP')
    throw new Problem(422, 'webp-required');
  const bucket = db.storage.from(BUCKET),
    path = objectKey(row, asset);
  const { error } = await bucket.upload(path, bytes, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
  if (error) {
    // An existing immutable object is a successful retry only if its actual bytes still match.
    const { data, error: getError } = await bucket.download(path);
    if (getError || !data || data.size !== asset.bytes || (await sha256(await data.arrayBuffer())) !== asset.sha256)
      throw unavailable('storage-unavailable', getError);
  }
  return { ok: true, stage: 'uploaded', assetId: asset.id, bytes: bytes.length };
}
