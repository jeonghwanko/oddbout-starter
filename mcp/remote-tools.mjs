// @ts-check
import { constants } from 'node:fs';
import { lstat, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseFighterJson, validateFighter } from '../contracts/ai-fighter/validate.mjs';
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { resolveManifest } from './package-access.mjs';
import { creatorLink } from './creator-handoff.mjs';
import { errorCode } from './error-code.mjs';
import { profileLimits } from '../contracts/ai-fighter/profile-limits.mjs';

const CHANGED = 'package-changed-after-validation';
/** @type {(bytes: Buffer) => string} */
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Read exactly the declared size from a regular file. The final component must not be a symbolic link. @param {string} file @param {number} bytes */
async function readDeclaredFile(file, bytes) {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== bytes) throw new Error(CHANGED);
    const buffer = Buffer.alloc(bytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size !== bytes) throw new Error(CHANGED);
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}

/** The manifest bytes, or null when the path is not an allowed, existing manifest. @param {string} root @param {string} manifestPath */
async function readManifest(root, manifestPath) {
  try {
    const location = await resolveManifest(root, manifestPath);
    return location ? { location, bytes: await readFile(location) } : null;
  } catch { return null; }
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ remote: import('../api/client.mjs').RemoteClient, validatePackage?: (relative: string) => Promise<import('./package-access.mjs').PackageCheck>,
 *   root?: string, respond: import('./server.mjs').Respond, creatorPage?: string }} options
 */
export function registerRemoteTools(server, { remote, validatePackage, root, respond, creatorPage }) {
  const outputSchema = { ok: z.boolean(), stage: z.string(), submissionId: z.string().optional(), manifestSha256: z.string().optional(),
    fighterId: z.string().nullable().optional(), runtimeApproved: z.boolean().optional(), runtimeScope: z.string().nullable().optional(), pending: z.array(z.string()).optional(),
    validation: z.unknown().optional(), code: z.string().optional(), fighter: z.unknown().optional(),
    errors: z.array(z.unknown()).optional(), errorCount: z.number().optional(), loginUrl: z.string().optional(), expiresAt: z.string().optional() };
  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  /** @type {<A>(fn: (args: A) => Promise<import('./server.mjs').ToolResult>) => (args: A) => Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>} */
  const safe = fn => async args => { try { return respond(await fn(args)); } catch (error) { return respond({ ok: false, stage: 'remote-api', code: errorCode(error, 'remote-operation-failed') }); } };
  if (validatePackage) {
    server.registerTool('submit_fighter_package', {
      description: 'Upload the checked local fighter package to the configured Supabase service and queue authoritative validation. Requires user intent to submit. Use one UUID idempotencyKey per immutable package and reuse it for retries. Successful server validation registers the fighter in production: other people meet it after its owner checks every required motion and enters it on the fighter page. For text-only edits use update_fighter_profile without uploading assets. Each account may register up to three fighters: to update an existing fighter (concept, move names, bout lines, stats, fighting style or art), pass its fighterId — the package is replaced in place and the fighter keeps its ID and duel record; new art returns it to production until its owner enters it again. Omit fighterId to register a new fighter while the account has fewer than three.',
      inputSchema: { manifestPath: z.string().min(1).max(512), idempotencyKey: z.string().uuid(), fighterId: z.string().uuid().optional() }, outputSchema,
      annotations: { ...read, readOnlyHint: false },
    }, safe(async ({ manifestPath, idempotencyKey, fighterId }) => {
      // Upload exactly what the validator saw: the manifest must not change while the child process checks it,
      // and every uploaded asset must match the hash in that manifest.
      const before = await readManifest(/** @type {string} */ (root), manifestPath); // set whenever validatePackage is
      const checked = await validatePackage(manifestPath);
      if (!checked.ok) return { ok: false, stage: 'local-validation', errors: checked.errors,
        code: checked.stage === 'local-access' ? 'local-validation-unavailable' : 'package-invalid' };
      const after = await readManifest(/** @type {string} */ (root), manifestPath);
      if (!before || !after || !after.bytes.equals(before.bytes)) throw new Error(CHANGED);
      const manifestText = new TextDecoder('utf-8', { fatal: true }).decode(after.bytes);
      const parsed = parseFighterJson(manifestText);
      // The schema confines every asset path to assets/<id>.webp.
      if (!parsed.ok || !validateFighter(parsed.data).ok) throw new Error(CHANGED);
      const directory = path.dirname(after.location);
      if ((await lstat(path.join(directory, 'assets'))).isSymbolicLink()) throw new Error(CHANGED);
      // A server older than this kit's contract rejects the optional profile extras, names and bout lines, duel grades, fighting style
      // and optional clips; say so before uploading.
      const { profile, combat, clips } = parsed.data, used = [
        ...(['language', 'concept', 'moves'].some(key => key in profile) ? ['profile-extras-1'] : []), ...('names' in profile ? ['profile-names-1'] : []),
        ...('lines' in profile ? ['profile-lines-1'] : []),
        ...('stats' in combat ? ['combat-stats-1'] : []), ...('style' in combat ? ['combat-style-1'] : []),
        ...(Object.keys(spec.optionalClips).some(key => key in clips) ? ['extra-clips-1'] : [])];
      if (Object.values(clips).some(clip => clip.pixelScale !== undefined)) used.push('texture-resolution-1');
      if (used.length) {
        const features = (await remote.request('spec'))?.data?.features ?? [];
        const missing = used.filter(feature => !features.includes(feature));
        if (missing.length) return { ok: false, stage: 'remote-spec', code: 'server-feature-missing', errors: missing };
      }
      const created = await remote.request(fighterId ? `submissions?fighter=${fighterId}` : 'submissions', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body: manifestText });
      if (created.stage !== 'uploading' || created.code === 'upload-expired') return created;
      for (const asset of parsed.data.assets) {
        const bytes = await readDeclaredFile(path.join(directory, asset.path), asset.bytes);
        if (sha256(bytes) !== asset.sha256) throw new Error(CHANGED);
        await remote.request(`submissions/${created.submissionId}/assets/${asset.id}`, { method: 'PUT', headers: { 'content-type': 'image/webp' }, body: bytes });
      }
      return remote.request(`submissions/${created.submissionId}/submit`, { method: 'POST' });
    }));
  }
  server.registerTool('update_fighter_profile', {
    description: 'Edit your registered fighter name, per-language display names (names.ko / names.en; null removes them), bout lines (lines.challenge / lines.win / lines.lose; null removes them), description, language, concept or move text without local image files or image uploads. Requires user intent to edit. Read get_registered_fighter first and pass its manifest_sha as expectedManifestSha256. Keeps the fighter ID and duel record; revisions do not consume the five initial-submission attempts. Reuse one idempotencyKey and identical arguments for retries. A fighter-changed response requires reading the latest profile before a new edit.',
    inputSchema: { fighterId: z.string().uuid(), idempotencyKey: z.string().uuid(), expectedManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
      profile: z.object({ name: z.string().min(1).max(profileLimits.name).optional(), description: z.string().min(1).max(profileLimits.description).optional(),
        language: z.enum(profileLimits.languages).optional(), concept: z.string().min(1).max(profileLimits.concept).optional(),
        names: z.object(Object.fromEntries(profileLimits.languages.map(key => [key, z.string().min(1).max(profileLimits.displayName).optional()]))).strict()
          .refine(value => Object.keys(value).length > 0).nullable().optional(),
        lines: z.object(Object.fromEntries(spec.profileLines.keys.map(key => [key, z.string().min(1).max(spec.profileLines.maxLength).optional()]))).strict()
          .refine(value => Object.keys(value).length > 0).nullable().optional(),
        moves: z.object(Object.fromEntries(profileLimits.moves.map(key => [key, z.object({ name: z.string().min(1).max(profileLimits.moveName),
          description: z.string().min(1).max(profileLimits.moveDescription) }).strict()]))).strict().optional()
      }).strict().refine(value => Object.keys(value).length > 0) }, outputSchema, annotations: { ...read, readOnlyHint: false },
  }, safe(async ({ fighterId, idempotencyKey, expectedManifestSha256, profile }) => {
    const remoteSpec = (await remote.request('spec'))?.data;
    // A server older than these keys rejects them; per-language names and bout lines each need their own /spec feature.
    if (remoteSpec?.registration?.profileUpdate !== 'v1' || [['names', 'profile-names-1'], ['lines', 'profile-lines-1']]
      .some(([key, feature]) => key in profile && !remoteSpec?.features?.includes(feature)))
      return { ok: false, stage: 'remote-spec', code: 'server-feature-missing' };
    return remote.request(`fighters/${fighterId}/profile`, { method: 'PATCH',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body: JSON.stringify({ expectedManifestSha256, profile }) });
  }));
  server.registerTool('open_creator_homepage', {
    description: 'Make a one-use link that signs the current user into the AI Fighter creator homepage (https://oddbout.com/creator.html) with this account: their registered fighters, animations, statistics and downloads. Use when the user asks to see their fighters on the homepage. Give the link to the user as a clickable link; it opens in any browser on any device, works once and expires in 10 minutes. Do not open it yourself: opening it uses it up.',
    inputSchema: {}, outputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, safe(async () => {
    const { loginUrl, expiresAt } = await creatorLink({ page: creatorPage, request: remote.request });
    return { ok: true, stage: 'creator-link', loginUrl, expiresAt };
  }));
  server.registerTool('get_fighter_submission', { description: 'Read the current user’s submission status. registered means server file validation and registry creation; the fighter starts in production until its owner enters it, and can be removed afterward. Empty pending means the status is final.',
    inputSchema: { submissionId: z.string().uuid() }, outputSchema, annotations: read }, safe(({ submissionId }) => remote.request(`submissions/${submissionId}`)));
  server.registerTool('get_registered_fighter', { description: 'Read the current user’s persisted fighter ID and profile from the registry.',
    inputSchema: { fighterId: z.string().uuid() }, outputSchema, annotations: read }, safe(({ fighterId }) => remote.request(`fighters/${fighterId}`)));
}
