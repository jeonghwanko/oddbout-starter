// @ts-check
// 선수 프로필 세트 (2026-10-31): the owner's front painting, face square and expression sheet (2026-11-03) for his registered fighter,
// uploaded the way a package is (api/profile-sets.mjs). It never touches the package: the hash, the entry and the duel record stay.
import { z } from 'zod';
import { Problem, sha256 } from '../../api/http.mjs';
import { PROFILE_SET_ASSETS, PROFILE_SET_LIMITS } from '../../api/profile-sets.mjs';
import { FILE, UUID_ARG, downloadHostFile } from './common.mjs';
/**
 * @typedef {import('./common.mjs').Identity} Identity
 * @typedef {import('./common.mjs').Invoke} Invoke
 * @typedef {import('./common.mjs').Register} Register
 */

/**
 * Registers the profile-set tools every connection lists. `invoke` calls the in-process API as the verified owner.
 * @param {{ register: Register, db: any, identity: Identity | null, invoke: Invoke, fetcher: typeof fetch }} options
 */
export function registerProfileSetTools({ register, db, identity, invoke, fetcher }) {
  register('prepare_profile_set', '프로필 세트 준비', 'After the user chose his registered fighter\'s front painting and expression sheet (get_fighter_spec '
    + 'overview: profileSet), create/resume a private upload from the actual profile-set.json that `npm run fighter:profile-set` wrote: the front '
    + 'painting, the face square and the expression sheet (optional, but without it the arena shows one face for every mood, his KO included). '
    + 'Use a new UUID for changed bytes and the same UUID for immutable retries. This does not publish. Then upload_profile_set_asset.',
    { fighterId: UUID_ARG(), manifest: FILE, idempotencyKey: UUID_ARG() }, async ({ fighterId, manifest, idempotencyKey }) => {
      const bytes = await downloadHostFile(manifest, PROFILE_SET_LIMITS.jsonBytes, fetcher);
      return invoke(`fighters/${fighterId}/profile-sets`, 'POST', bytes, { 'content-type': 'application/json', 'idempotency-key': idempotencyKey });
    }, { write: true, openWorld: true, idempotent: true, files: ['manifest'] });
  register('upload_profile_set_asset', '프로필 그림 전달', 'Upload one actual file of your private profile set: assetId `front` (the front painting, '
    + 'the default) or `expressions` (the expression sheet, when profile-set.json names one). WebP with alpha; its size and SHA-256 must match '
    + 'profile-set.json. Repeat safely with identical bytes; never regenerate for a delivery failure.',
    { profileSetId: UUID_ARG(), file: FILE, assetId: z.enum(PROFILE_SET_ASSETS).optional() }, async ({ profileSetId, file, assetId = 'front' }) => {
      const { data: row, error } = await db.from('af_profile_sets').select('manifest,status,expires_at').eq('id', profileSetId.toLowerCase())
        .eq('owner_id', /** @type {Identity} */ (identity).owner).maybeSingle();
      if (error) throw new Problem(503, 'database-unavailable'); if (!row) throw new Problem(404, 'not-found');
      if (row.status !== 'uploading' || Date.parse(row.expires_at) <= Date.now()) throw new Problem(409, 'upload-closed');
      const expected = row.manifest[assetId];
      if (!expected) throw new Problem(422, 'asset-not-in-profile-set');
      const bytes = await downloadHostFile(file, expected.bytes, fetcher);
      if (bytes.length !== expected.bytes || await sha256(bytes) !== expected.sha256) throw new Problem(422, 'asset-hash-or-size');
      return invoke(`profile-sets/${profileSetId}/assets/${assetId}`, 'PUT', bytes, { 'content-type': 'image/webp' });
    }, { write: true, openWorld: true, idempotent: true, files: ['file'] });
  register('submit_profile_set', '프로필 세트 제출', 'Submit the uploaded profile set for validation and the operator\'s review. '
    + 'Requires the user\'s approval of the front painting, its round face crop and the expression sheet. Queued or in review is not approved: '
    + 'follow get_profile_set. The roster and the home show the fighter\'s painting only once it is approved.',
    { profileSetId: UUID_ARG() }, ({ profileSetId }) => invoke(`profile-sets/${profileSetId}/submit`, 'POST'),
    { write: true, publish: true, openWorld: true, idempotent: true });
  register('get_profile_set', '프로필 세트 상태', 'Read your profile set: uploading, queued, validating, review (waiting for the operator), approved, '
    + 'rejected (with the reason) or superseded. Includes short-lived links to its files. Do not regenerate automatically.',
    { profileSetId: UUID_ARG() }, ({ profileSetId }) => invoke(`profile-sets/${profileSetId}`));
}
