// @ts-check
// The registration tools: the contract, the connected account and its readiness, the owner's fighters, deletion, and a package's way in.
import { z } from 'zod';
import { Problem, sha256 } from '../../api/http.mjs';
import spec from '../../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import schema from '../../contracts/ai-fighter/v1/fighter.schema.json' with { type: 'json' };
import { FILE, UUID_ARG, downloadHostFile } from './common.mjs';
import { cleanupPublicFiles } from '../../api/profile-sets.mjs';
/**
 * @typedef {import('./common.mjs').Identity} Identity
 * @typedef {import('./common.mjs').Invoke} Invoke
 * @typedef {import('./common.mjs').RecordAgent} RecordAgent
 * @typedef {import('./common.mjs').Register} Register
 * @typedef {{ id: string, path: string, bytes: number, sha256: string }} ManifestAsset  An asset as the stored fighter.json lists it.
 */

/**
 * Registers the tools every connection lists. `invoke` calls the in-process API as the verified owner; `recordAgent` labels a submission.
 * `identity` is null only on a signed-out call, which register lets reach the public tools alone: the account tools cast it.
 * @param {{ register: Register, db: any, identity: Identity | null, invoke: Invoke, fetcher: typeof fetch, recordAgent: RecordAgent }} options
 */
export function registerRegistrationTools({ register, db, identity, invoke, fetcher, recordAgent }) {
  register('get_fighter_spec', '캐릭터 등록 규격', 'Read the fighter contract before authoring. All 11 motions and actual visual review are required. '
    + 'This does not generate or register.',
    { section: z.enum(['overview', 'schema', 'creation']).default('overview') }, async ({ section }) => {
      if (section === 'overview') {
        // Reuse the deployed API's registration policy instead of the offline authoring fallback.
        const result = await invoke('spec');
        if (!result.ok) return result;
        return { ...result, data: { ...result.data, registration: { ...result.data.registration,
          auth: 'google-oauth-via-cloud-connector', assetUpload: 'openai-fileParams', requiresPc: false,
          readinessTool: 'check_creation_readiness' } } };
      }
      return { ok: true, data: section === 'schema' ? schema : {
        steps: ['appearance review', 'locomotion review', 'attack review', 'defense/reaction review',
          'optional style review (skill, entrance and victory clips, fighting style; may be skipped)', 'final review', 'prepare_fighter_registration',
          'upload_fighter_asset for each pending asset', 'submit_fighter_registration', 'get_fighter_submission',
          'prepare_profile_set, upload_profile_set_asset, submit_profile_set with the front painting the user chose (overview: profileSet)'],
        delivery: 'Use the current conversation’s actual image previews and approved files. A file path or a readiness flag is not a preview.',
        package: 'Produce fighter.json and assets/<id>.webp with the kit game-pack/pack commands, then pass actual host file attachments. '
          + 'For an existing approved package, preserve the original bytes and verify them; '
          + 'do not regenerate or rebuild unchanged art. Never invent measurements or hashes.',
        files: 'If the host exposes a file input as an absolute path, supply the existing workspace file. '
          + 'For Library or Page references, use supported materialization or an original-byte read, '
          + 'then verify the saved file size and SHA-256. Rendered previews are not package files. '
          + 'Recover existing files before any retry.',
        account: 'Use only the current user’s chosen generation account; no subscription/API billing substitution. '
          + 'Before registration, verify get_profile matches the intended connected registration account.',
        network: 'The native cloud connector handles registration and host file downloads; '
          + 'no user PC MCP or VM registration API login is needed. '
          + 'VM direct-network restrictions are separate from connector access; do not bypass network policy.' } };
    }, { publicTool: true });
  register('get_profile', 'ODDBOUT 연결 계정', 'Read the connected ODDBOUT account. Its opaque ID is stable across reconnections and email changes. '
    + 'No creation or publication.', {},
    async () => ({ id: /** @type {Identity} */ (identity).owner, ...(/** @type {Identity} */ (identity).email ? { email: /** @type {Identity} */ (identity).email } : {}), nickname: 'ODDBOUT' }), { profile: true });
  register('open_creator_homepage', '제작자 홈페이지', 'Get the creator website address. Sign in normally on the website and ensure its account matches get_profile; '
    + 'the cloud connection does not sign in to the website.', {},
    async () => ({ url: 'https://oddbout.com/creator.html', signIn: 'Sign in normally on the website with the same account as get_profile.' }));
  register('check_creation_readiness', '클라우드 제작·등록 연결 점검', 'Use before first generation, after a workspace restart and before registration. '
    + 'Checks this cloud account’s registration access without a PC or CLI login. '
    + 'Generation, conversation display and package review remain unverified until actual evidence exists; '
    + 'this call never generates.',
    { purpose: z.enum(['generation','connection','registration']).default('registration') }, async ({ purpose }) => {
      const result = await invoke('me');
      if (!result.ok) return result;
      return { ok: true, purpose, scope: 'cloud-registration-connection', account: result.account,
        registration: { status: result.account.canSubmit ? 'ready' : 'blocked', requiresPc: false, auth: 'connected-google-oauth' },
        generation: { status: 'unverified', reason: 'actual-host-generation-call-required' },
        delivery: { status: 'unverified', inputCapability: 'openai-fileParams', reason: 'actual-conversation-preview-and-file-transfer-required' },
        package: { status: 'unverified', reason: 'final-visual-review-and-package-validation-required' },
        nextCommands: [], nextAction: result.account.canSubmit ? 'Continue the user-requested review group or register the approved actual package using host file attachments. '
          + 'Verify generation/display separately in the current conversation.' : 'Account registration access is unavailable; inspect the account response.' };
    });
  register('list_my_fighters', '내 캐릭터', 'List only the connected user’s registered fighters.', {}, async () => {
    const { data, error } = await db.from('af_fighters').select('id,profile,status,review_state,created_at,entered_at').eq('owner_id', /** @type {Identity} */ (identity).owner)
      .is('deleted_at', null).order('created_at', { ascending: false }).limit(50);
    if (error) throw new Problem(503, 'database-unavailable'); return { ok: true, fighters: data };
  });
  /** @param {string} name @param {Record<string, unknown>} args */
  const deletionRpc = async (name, args) => {
    const { data, error } = await db.rpc(name, { p_owner: /** @type {Identity} */ (identity).owner,
      p_session: /** @type {Identity} */ (identity).claims.session_id, p_client: /** @type {Identity} */ (identity).claims.client_id, ...args });
    if (error) {
      const expected = ['not-found','authentication-required','invalid-deletion-confirmation','deletion-name-mismatch',
        'deletion-confirmation-expired','fighter-changed','fighter-deleted'];
      throw new Problem(400, expected.includes(error.message) ? error.message : 'database-unavailable');
    }
    return data;
  };
  register('prepare_fighter_deletion', '캐릭터 삭제 확인', 'After a deletion request, verify ownership and return the exact account, fighter, effects and a 10-minute confirmation. '
    + 'This does not delete. Show the result to the user. '
    + 'Deletion removes the fighter from owned/public lists and new matches, frees its slot, '
    + 'and retains private package bytes and history. Never interpret preparation alone as approval.',
    { fighterId: UUID_ARG() }, async ({ fighterId }) => ({
      ...await deletionRpc('af_prepare_fighter_deletion', { p_fighter: fighterId }),
      account: { id: /** @type {Identity} */ (identity).owner, email: /** @type {Identity} */ (identity).email },
    }), { write: true, idempotent: true });
  register('delete_fighter', '내 캐릭터 삭제', 'Execute only the user’s explicit deletion instruction for the exact account and fighter returned by '
    + 'prepare_fighter_deletion. Pass that token and exact confirmName, with confirm=true. '
    + 'Existing approval counts only if it unambiguously matches this unchanged fighter and deletion scope; '
    + 'otherwise ask first. Ownership, live session, expiry and package/profile identity are rechecked atomically. '
    + 'This is soft deletion: private package bytes and history remain. Retry only with identical confirmation arguments.',
    { fighterId: UUID_ARG(), confirmationToken: UUID_ARG(), confirmName: z.string().min(1).max(200), confirm: z.literal(true) },
    async ({ fighterId, confirmationToken, confirmName }) => {
      const deleted = await deletionRpc('af_delete_owned_fighter', { p_fighter: fighterId, p_token: confirmationToken, p_confirm_name: confirmName });
      // His profile sets were withdrawn with him; their public copies go now (a retried deletion tries again).
      await cleanupPublicFiles(db, fighterId.toLowerCase());
      return deleted;
    }, { write: true, publish: true, openWorld: true, idempotent: true });
  register('prepare_fighter_registration', '캐릭터 등록 준비', 'After the user requests registration and approves the final package, '
    + 'create/resume a private upload from the actual fighter.json file. '
    + 'For an explicit update to your existing fighter, provide fighterId to keep its ID and history; a new package returns it to production for review. '
    + 'Use a new UUID for changed package bytes and the same UUID for immutable retries. This does not publish. '
    + 'Return pending asset IDs for upload_fighter_asset.',
    { manifest: FILE, idempotencyKey: UUID_ARG(), fighterId: UUID_ARG().optional() }, async ({ manifest, idempotencyKey, fighterId }) => {
      const bytes = await downloadHostFile(manifest, spec.limits.jsonBytes, fetcher);
      const result = await invoke(fighterId ? `submissions?fighter=${encodeURIComponent(fighterId)}` : 'submissions', 'POST', bytes, { 'content-type': 'application/json', 'idempotency-key': idempotencyKey });
      if (result.ok) await recordAgent(result.submissionId);
      if (!result.ok || result.stage !== 'uploading') return result;
      const { data, error } = await db.from('af_submissions').select('manifest').eq('id', result.submissionId).eq('owner_id', /** @type {Identity} */ (identity).owner).single();
      if (error) throw new Problem(503, 'database-unavailable');
      return { ...result, assets: data.manifest.assets.map(/** @param {ManifestAsset} asset */ ({ id, path, bytes, sha256 }) => ({ id, path, bytes, sha256 })) };
    }, { write: true, openWorld: true, idempotent: true, files: ['manifest'] });
  register('upload_fighter_asset', '캐릭터 파일 전달', 'Upload one actual WebP file to your private submission. Its size and SHA-256 must match fighter.json. '
    + 'Repeat safely with identical bytes; never regenerate for a delivery failure.',
    { submissionId: UUID_ARG(), assetId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), file: FILE }, async ({ submissionId, assetId, file }) => {
      const { data: row, error } = await db.from('af_submissions').select('manifest,status,expires_at').eq('id', submissionId).eq('owner_id', /** @type {Identity} */ (identity).owner).maybeSingle();
      if (error) throw new Problem(503, 'database-unavailable'); if (!row) throw new Problem(404, 'not-found');
      if (row.status !== 'uploading' || Date.parse(row.expires_at) <= Date.now()) throw new Problem(409, 'upload-closed');
      const asset = row.manifest.assets.find(/** @param {ManifestAsset} a */ a => a.id === assetId);
      if (!asset || !Number.isSafeInteger(asset.bytes) || asset.bytes > spec.limits.assetBytes) throw new Problem(404, 'asset-not-found');
      const bytes = await downloadHostFile(file, asset.bytes, fetcher);
      if (bytes.length !== asset.bytes || await sha256(bytes) !== asset.sha256) throw new Problem(422, 'asset-hash-or-size');
      return invoke(`submissions/${submissionId}/assets/${assetId}`, 'PUT', bytes, { 'content-type': 'image/webp' });
    }, { write: true, openWorld: true, idempotent: true, files: ['file'] });
  register('submit_fighter_registration', '캐릭터 등록', 'Register the user-approved uploaded package after authoritative validation. '
    + 'Requires the user’s explicit registration request. All asset uploads and visual reviews must be complete. '
    + 'A registered fighter starts in production; other people meet him after his owner enters him. '
    + 'Queued/validating is not registered; follow get_fighter_submission until final.',
    { submissionId: UUID_ARG() }, ({ submissionId }) => invoke(`submissions/${submissionId}/submit`, 'POST'), { write: true, publish: true, openWorld: true, idempotent: true });
  register('get_fighter_submission', '등록 진행 상태', 'Read your submission. Only registered confirms registration; rejected contains the validation failure. '
    + 'Do not regenerate automatically.',
    { submissionId: UUID_ARG() }, ({ submissionId }) => invoke(`submissions/${submissionId}`));
  register('get_registered_fighter', '등록된 캐릭터 확인', 'Read your registered fighter and immutable package identity.',
    { fighterId: UUID_ARG() }, ({ fighterId }) => invoke(`fighters/${fighterId}`));
}
