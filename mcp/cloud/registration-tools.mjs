// @ts-check
// The registration tools: the contract, the connected account and its readiness, the owner's fighters, deletion, and a package's way in.
import { z } from 'zod';
import { Problem, rpcProblem, sha256 } from '../../api/http.mjs';
import spec from '../../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import schema from '../../contracts/ai-fighter/v1/fighter.schema.json' with { type: 'json' };
import { CREATOR_PAGE, FILE, NO_FILES, UUID_ARG, downloadHostFile, frontNext, siteUrl, unavailable } from './common.mjs';
import { cleanupPublicFiles } from '../../api/profile-sets.mjs';
/**
 * @typedef {import('./common.mjs').Identity} Identity
 * @typedef {import('./common.mjs').Invoke} Invoke
 * @typedef {import('./common.mjs').RecordAgent} RecordAgent
 * @typedef {import('./common.mjs').Register} Register
 * @typedef {{ id: string, path: string, bytes: number, sha256: string }} ManifestAsset  An asset as the stored fighter.json lists it.
 */

/**
 * A submission's or fighter's result with where the user follows it on the site (siteUrl, 2026-11-03): the fighter's all-motions page once
 * registered (registering does not enter him; his owner does, after watching), else the submission's page — a refused one too, where
 * the site lists why. A failed call and a deleted fighter point nowhere.
 * @param {any} result  The API's JSON. @param {{ directory?: boolean }} [options]
 */
/**
 * A submission's `pending` array is remaining pipeline stage names (`server-validation`, `registration`), including while
 * assets are still uploading. Asset ids are `missingAssets` (or `assets` on prepare, when the upload state is not confirmed).
 * Older servers omit the split; this fills it without dropping `pending`.
 * @param {any} result
 */
export function clarifySubmission(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const pending = Array.isArray(result.pending) ? result.pending.filter((/** @type {unknown} */ item) => typeof item === 'string') : null;
  const pendingStages = Array.isArray(result.pendingStages) ? result.pendingStages : pending;
  const declared = Array.isArray(result.assets) ? result.assets : [];
  let missingAssets = Array.isArray(result.missingAssets) ? result.missingAssets : [];
  if (
    result.stage === 'uploading' &&
    result.code !== 'upload-expired' &&
    result.assetUploadState !== 'confirmed' &&
    declared.length &&
    missingAssets.length === 0
  )
    missingAssets = declared;
  if (pendingStages === null && !Array.isArray(result.missingAssets) && result.stage !== 'uploading') return result;
  const clarified = { ...result, ...(pendingStages ? { pendingStages } : {}), missingAssets };
  if (clarified.stage !== 'uploading' || clarified.code === 'upload-expired') return clarified;
  const guidance = 'pending and pendingStages are pipeline stage names, never asset ids. Upload each missingAssets entry, then submit.';
  const site = typeof clarified.next === 'string' ? clarified.next : '';
  return site.includes('never asset ids') ? clarified : { ...clarified, next: site ? `${guidance} ${site}` : guidance };
}

/** @param {any} result  The API's JSON. @param {{ directory?: boolean }} [options] */
export function withSiteLink(result, { directory = false } = {}) {
  if (!result?.ok || result.stage === 'deleted') return result;
  const url = siteUrl({ fighterId: result.fighter?.id ?? (result.stage === 'registered' ? result.fighterId : null), submissionId: result.submissionId });
  // The directory edition keeps ODDBOUT's Korean state names out (directory-edition.mjs).
  return url
    ? {
        ...result,
        siteUrl: url,
        next:
          result.next ??
          'The user can also follow this on the ODDBOUT website: give him siteUrl to see its progress or why it was refused, ' +
            `and once registered to review the eleven motions and enter the fighter${directory ? ' into public play' : ' (출전)'}.`,
      }
    : result;
}
/**
 * The hosted route as the creation guide and the readiness check name it: an agent with no workspace (Grok, Claude, a ChatGPT chat without
 * the kit) cannot follow the workspace steps, which need the kit, the user's generation account and attached package files.
 */
const HOSTED_ROUTE =
  "A user without a workspace (the creator kit and a generation account of the user's own in this conversation) can have " +
  "ODDBOUT make the fighter on its own worker: offer it, and only on the user's request call request_hosted_fighter with the user's words, " +
  "then follow each result's next. Each request spends the user's tokens, whatever the outcome. Pictures go in as files this host attaches, " +
  'else through start_picture_upload.';
/**
 * Registers the tools every connection lists. `invoke` calls the in-process API as the verified owner; `recordAgent` labels a submission.
 * `identity` is null only on a signed-out call, which register lets reach the public tools alone: the account tools cast it.
 * `hosted`: whether this connection lists the hosted generation tools (hosted-tools.mjs), which the creation guide and the readiness
 * check then name (Grok 점검 2026-11-03: an agent without a workspace read only the workspace route there). `directory`: the directory
 * edition, whose next keeps the Korean state names out (common.mjs frontNext). `uploads`: whether this address lists the upload tools (all
 * but the directory edition); without them the guide, the readiness check and next name none and say where files go instead (NO_FILES).
 * @param {{ register: Register, db: any, identity: Identity | null, invoke: Invoke, fetcher: typeof fetch, recordAgent: RecordAgent, hosted?: boolean,
 *   directory?: boolean, uploads?: boolean }} options
 */
export function registerRegistrationTools({ register, db, identity, invoke, fetcher, recordAgent, hosted = false, directory = false, uploads = !directory }) {
  register(
    'get_fighter_spec',
    '캐릭터 등록 규격',
    'Read the fighter contract before authoring. All 11 motions and required file checks are required; quality diagnostics are deferred. ' +
      'This does not generate or register.',
    { section: z.enum(['overview', 'schema', 'creation']).default('overview') },
    async ({ section }) => {
      if (section === 'overview') {
        // Reuse the deployed API's registration policy instead of the offline authoring fallback.
        const result = await invoke('spec');
        if (!result.ok) return result;
        return {
          ...result,
          data: {
            ...result.data,
            registration: {
              ...result.data.registration,
              auth: 'google-oauth-via-cloud-connector',
              assetUpload: uploads ? 'openai-fileParams' : 'none',
              requiresPc: false,
              readinessTool: 'check_creation_readiness',
            },
            // The profile set's upload step names tools an address without a file host does not list.
            ...(uploads || !result.data.profileSet
              ? {}
              : {
                  profileSet: {
                    ...result.data.profileSet,
                    order: result.data.profileSet.order.map(
                      /** @param {string} step */ step => (step.startsWith('prepare_profile_set') ? `the profile set: ${NO_FILES}` : step),
                    ),
                  },
                }),
          },
        };
      }
      return {
        ok: true,
        data:
          section === 'schema'
            ? schema
            : {
                ...(hosted ? { hosted: `${HOSTED_ROUTE} The steps below are the workspace route.` } : {}),
                steps: [
                  'appearance review',
                  'locomotion review',
                  'attack review',
                  'defense/reaction review',
                  'optional style review (skill, entrance and victory clips, fighting style; may be skipped)',
                  'final review',
                  ...(uploads
                    ? [
                        'prepare_fighter_registration',
                        'upload_fighter_asset for each missingAssets id (pending and pendingStages are stage names, not asset ids)',
                        'submit_fighter_registration',
                        'get_fighter_submission',
                        'prepare_profile_set, upload_profile_set_asset (front, then expressions), submit_profile_set with the front painting and expression sheet the user chose (overview: profileSet)',
                      ]
                    : [`registration and the profile set (overview: profileSet): ${NO_FILES}`, 'get_fighter_submission']),
                ],
                delivery: 'Use the current conversation’s actual image previews and approved files. A file path or a readiness flag is not a preview.',
                package:
                  'Use prepare_fighter_packaging to inspect and build fighter.json and assets/<id>.webp from existing workspace files, ' +
                  (uploads ? 'then pass actual host file attachments. ' : `then register it elsewhere. ${NO_FILES} `) +
                  'For an existing approved package, preserve the original bytes and verify them; ' +
                  'do not regenerate or rebuild unchanged art. Never invent measurements or hashes.',
                files: uploads
                  ? 'If the host exposes a file input as an absolute path, supply the existing workspace file. ' +
                    'For Library or Page references, use supported materialization or an original-byte read, ' +
                    'then verify the saved file size and SHA-256. Rendered previews are not package files. ' +
                    'Recover existing files before any retry.'
                  : NO_FILES,
                account:
                  'Use only the current user’s chosen generation account; no subscription/API billing substitution. ' +
                  'Before registration, verify get_profile matches the intended connected registration account.',
                network:
                  'The native cloud connector handles registration and host file downloads; ' +
                  'no user PC MCP or VM registration API login is needed. ' +
                  'VM direct-network restrictions are separate from connector access; do not bypass network policy.',
              },
      };
    },
    { publicTool: true },
  );
  register(
    'get_profile',
    'ODDBOUT 연결 계정',
    'Read the connected ODDBOUT account. Its opaque ID is stable across reconnections and email changes. ' + 'No creation or publication.',
    {},
    async () => {
      // One cast, not one per field: a formatter that moves a cast's parentheses would cast the whole spread (2026-11-08).
      const who = /** @type {Identity} */ (identity);
      return { id: who.owner, ...(who.email ? { email: who.email } : {}), nickname: 'ODDBOUT' };
    },
    { profile: true },
  );
  register(
    'open_creator_homepage',
    '제작자 홈페이지',
    'Get the creator website address. Sign in normally on the website and ensure its account matches get_profile; ' +
      'the cloud connection does not sign in to the website.',
    {},
    async () => ({ url: CREATOR_PAGE, signIn: 'Sign in normally on the website with the same account as get_profile.' }),
  );
  register(
    'check_creation_readiness',
    '클라우드 제작·등록 연결 점검',
    'Use before first generation, after a workspace restart and before registration. ' +
      'Checks this cloud account’s registration access without a PC or CLI login. ' +
      'Generation, conversation display and package review remain unverified until actual evidence exists; ' +
      'this call never generates.',
    { purpose: z.enum(['generation', 'connection', 'registration']).default('registration') },
    async ({ purpose }) => {
      // The service's state beside the account (both reads at once): whether ODDBOUT's making is on, the switch and its worker. The
      // account's own checks (tokens, one request at a time, a host's consent) answer the request itself; a failed read is unknown (null).
      const [result, service] = await Promise.all([invoke('me'), hosted ? invoke('generations/capabilities') : null]);
      if (!result.ok) return result;
      const making =
        service && result.account.canSubmit
          ? {
              tool: 'request_hosted_fighter',
              capabilities: service.ok ? service.capabilities : null,
              note: `${HOSTED_ROUTE} capabilities is the service only: the account's own checks answer the request.`,
            }
          : null;
      return {
        ok: true,
        purpose,
        scope: 'cloud-registration-connection',
        account: result.account,
        ...(making ? { hosted: making } : {}),
        registration: { status: result.account.canSubmit ? 'ready' : 'blocked', requiresPc: false, auth: 'connected-google-oauth' },
        generation: { status: 'unverified', reason: 'actual-host-generation-call-required' },
        delivery: {
          status: 'unverified',
          inputCapability: uploads ? 'openai-fileParams' : 'none',
          reason: 'actual-conversation-preview-and-file-transfer-required',
        },
        package: { status: 'unverified', reason: 'final-visual-review-and-package-validation-required' },
        nextCommands: [],
        nextAction:
          (result.account.canSubmit
            ? (uploads
                ? 'Continue the user-requested review group or register the approved actual package using host file attachments. '
                : `Continue the user-requested review group. ${NO_FILES} `) + 'Verify generation/display separately in the current conversation.'
            : 'Account registration access is unavailable; inspect the account response.') +
          (making && purpose !== 'registration' ? " A new fighter without a workspace of the user's own: see hosted." : ''),
      };
    },
  );
  register(
    'list_my_fighters',
    '내 캐릭터',
    "List only the connected user's registered fighters. The account block is this login: id, email, fighterCount and fighterLimit " +
      '(null when the limit could not be read). The default limit is 3; an account may have its own fighter_limit. get_profile nickname is always ODDBOUT.',
    {},
    async () => {
      const who = /** @type {Identity} */ (identity);
      const { data, error } = await db
        .from('af_fighters')
        .select('id,profile,status,review_state,created_at,entered_at')
        .eq('owner_id', who.owner)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw unavailable('database-unavailable', error);
      const fighters = data ?? [];
      let fighterLimit = null;
      try {
        const limit = await db.from('af_creators').select('fighter_limit').eq('owner_id', who.owner).maybeSingle();
        if (!limit?.error && limit?.data && Object.hasOwn(limit.data, 'fighter_limit')) {
          const value = limit.data.fighter_limit;
          fighterLimit = Number.isInteger(value) && value > 0 ? value : 3;
        }
      } catch {
        fighterLimit = null;
      }
      return {
        ok: true,
        account: { id: who.owner, ...(who.email ? { email: who.email } : {}), fighterCount: fighters.length, fighterLimit },
        fighters,
      };
    },
  );
  // The deletion functions' own refusals; anything else is the database's, a 503 to retry (it was a 400 until 2026-11-03).
  const deletionRefusals = Object.fromEntries(
    [
      'not-found',
      'authentication-required',
      'invalid-deletion-confirmation',
      'deletion-name-mismatch',
      'deletion-confirmation-expired',
      'fighter-changed',
      'fighter-deleted',
    ].map(code => [code, 400]),
  );
  /** @param {string} name @param {Record<string, unknown>} args */
  const deletionRpc = async (name, args) => {
    const { data, error } = await db.rpc(name, {
      p_owner: /** @type {Identity} */ (identity).owner,
      p_session: /** @type {Identity} */ (identity).claims.session_id,
      p_client: /** @type {Identity} */ (identity).claims.client_id,
      ...args,
    });
    if (error) throw rpcProblem(error, deletionRefusals);
    return data;
  };
  register(
    'prepare_fighter_deletion',
    '캐릭터 삭제 확인',
    'After a deletion request, verify ownership and return the exact account, fighter, effects and a 10-minute confirmation. ' +
      'This does not delete. Show the result to the user. ' +
      'Deletion removes the fighter from owned/public lists and new matches, frees its slot, ' +
      'and retains private package bytes and history. Never interpret preparation alone as approval.',
    { fighterId: UUID_ARG() },
    async ({ fighterId }) => ({
      ...(await deletionRpc('af_prepare_fighter_deletion', { p_fighter: fighterId })),
      account: { id: /** @type {Identity} */ (identity).owner, email: /** @type {Identity} */ (identity).email },
    }),
    { write: true, idempotent: true },
  );
  register(
    'delete_fighter',
    '내 캐릭터 삭제',
    'Execute only the user’s explicit deletion instruction for the exact account and fighter returned by ' +
      'prepare_fighter_deletion. Pass that token and exact confirmName, with confirm=true. ' +
      'Existing approval counts only if it unambiguously matches this unchanged fighter and deletion scope; ' +
      'otherwise ask first. Ownership, live session, expiry and package/profile identity are rechecked atomically. ' +
      'This is soft deletion: private package bytes and history remain. Retry only with identical confirmation arguments.',
    { fighterId: UUID_ARG(), confirmationToken: UUID_ARG(), confirmName: z.string().min(1).max(200), confirm: z.literal(true) },
    async ({ fighterId, confirmationToken, confirmName }) => {
      const deleted = await deletionRpc('af_delete_owned_fighter', { p_fighter: fighterId, p_token: confirmationToken, p_confirm_name: confirmName });
      // His profile sets were withdrawn with him; their public copies go now (a retried deletion tries again).
      await cleanupPublicFiles(db, fighterId.toLowerCase());
      return deleted;
    },
    { write: true, publish: true, openWorld: true, idempotent: true },
  );
  register(
    'prepare_fighter_registration',
    '캐릭터 등록 준비',
    'After the user requests registration and approves the final package, ' +
      'create/resume a private upload from the actual fighter.json file. ' +
      'For an explicit update to your existing fighter, provide fighterId to keep its ID and history; a new package returns it to production for review. ' +
      'Use a new UUID for changed package bytes and the same UUID for immutable retries. This does not publish. ' +
      'pending and pendingStages are pipeline stage names, never asset ids. Upload each missingAssets entry (or assets, when the upload state is unconfirmed).',
    { manifest: FILE, idempotencyKey: UUID_ARG(), fighterId: UUID_ARG().optional() },
    async ({ manifest, idempotencyKey, fighterId }) => {
      const bytes = await downloadHostFile(manifest, spec.limits.jsonBytes, fetcher);
      const result = await invoke(fighterId ? `submissions?fighter=${encodeURIComponent(fighterId)}` : 'submissions', 'POST', bytes, {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      });
      if (result.ok) await recordAgent(result.submissionId);
      if (!result.ok || result.stage !== 'uploading') return clarifySubmission(withSiteLink(result));
      const { data, error } = await db
        .from('af_submissions')
        .select('manifest')
        .eq('id', result.submissionId)
        .eq('owner_id', /** @type {Identity} */ (identity).owner)
        .single();
      if (error) throw unavailable('database-unavailable', error);
      return clarifySubmission(
        withSiteLink({
          ...result,
          assets: data.manifest.assets.map(/** @param {ManifestAsset} asset */ ({ id, path, bytes, sha256 }) => ({ id, path, bytes, sha256 })),
        }),
      );
    },
    { write: true, openWorld: true, idempotent: true, files: ['manifest'] },
  );
  register(
    'upload_fighter_asset',
    '캐릭터 파일 전달',
    'Upload one actual WebP file to your private submission. Its size and SHA-256 must match fighter.json. ' +
      'Repeat safely with identical bytes; never regenerate for a delivery failure.',
    { submissionId: UUID_ARG(), assetId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), file: FILE },
    async ({ submissionId, assetId, file }) => {
      const { data: row, error } = await db
        .from('af_submissions')
        .select('manifest,status,expires_at')
        .eq('id', submissionId)
        .eq('owner_id', /** @type {Identity} */ (identity).owner)
        .maybeSingle();
      if (error) throw unavailable('database-unavailable', error);
      if (!row) throw new Problem(404, 'not-found');
      if (row.status !== 'uploading' || Date.parse(row.expires_at) <= Date.now()) throw new Problem(409, 'upload-closed');
      const asset = row.manifest.assets.find(/** @param {ManifestAsset} a */ a => a.id === assetId);
      if (!asset || !Number.isSafeInteger(asset.bytes) || asset.bytes > spec.limits.assetBytes) throw new Problem(404, 'asset-not-found');
      const bytes = await downloadHostFile(file, asset.bytes, fetcher);
      if (bytes.length !== asset.bytes || (await sha256(bytes)) !== asset.sha256) throw new Problem(422, 'asset-hash-or-size');
      return invoke(`submissions/${submissionId}/assets/${assetId}`, 'PUT', bytes, { 'content-type': 'image/webp' });
    },
    { write: true, openWorld: true, idempotent: true, files: ['file'] },
  );
  register(
    'submit_fighter_registration',
    '캐릭터 등록',
    'Register the user-approved uploaded package after authoritative validation. ' +
      'Requires the user’s explicit registration request and selected final package. All asset uploads and required file checks must be complete; quality diagnostics are deferred. ' +
      'A registered fighter starts in production; other people meet him after his owner enters him. ' +
      'Queued/validating is not registered; follow get_fighter_submission until final.',
    { submissionId: UUID_ARG() },
    async ({ submissionId }) => clarifySubmission(withSiteLink(await invoke(`submissions/${submissionId}/submit`, 'POST'))),
    { write: true, publish: true, openWorld: true, idempotent: true },
  );
  register(
    'get_fighter_submission',
    '등록 진행 상태',
    'Read your submission. Only registered confirms registration; rejected contains the validation failure. ' + 'Do not regenerate automatically.',
    { submissionId: UUID_ARG() },
    async ({ submissionId }) => clarifySubmission(withSiteLink(await invoke(`submissions/${submissionId}`))),
  );
  register(
    'get_registered_fighter',
    '등록 정보',
    'Read your registered fighter and immutable package identity, and his front for the entry ' +
      "(front: whether the entry needs one, and ok once a front painting passed ODDBOUT's check; otherwise next says what to do).",
    { fighterId: UUID_ARG() },
    async ({ fighterId }) => {
      const result = await invoke(`fighters/${fighterId}`);
      // 정면 판정 (2026-11-03): a fighter in production hears what his front lacks before anyone asks to enter him.
      const next = result?.fighter && !result.fighter.entered_at ? frontNext(result.fighter.front, { directory, uploads }) : null;
      return withSiteLink(next ? { ...result, next } : result, { directory });
    },
  );
}
