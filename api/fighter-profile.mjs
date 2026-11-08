// @ts-check
import { parseFighterJson, validateFighter } from '../contracts/ai-fighter/validate.mjs';
import { Problem, readBody, sha256, unavailable, unstorableTextPath } from './http.mjs';

const editable = new Set(['name', 'description', 'language', 'concept', 'moves', 'names', 'lines']);
/**
 * Whose fighter an edit changes, keyed for an idempotent retry. `rpc` calls a database function and resolves to its data.
 * @typedef {{ owner: string, id: string, key: string, db: any, rpc: (name: string, args: Record<string, unknown>) => Promise<any> }} EditTarget
 */
/**
 * Reconstruct from the expected immutable version, including on an idempotent retry.
 * @param {EditTarget & { request: Request }} options
 */
export async function updateFighterProfile({ request, owner, id, key, db, rpc }) {
  let body;
  try {
    const parsed = parseFighterJson(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 16000)));
    if (!parsed.ok) throw new Error('invalid-json');
    body = parsed.data;
  } catch (error) {
    if (error instanceof Problem) throw error;
    throw new Problem(400, 'invalid-body');
  }
  return applyFighterEdit({ body, owner, id, key, db, rpc });
}

/**
 * A parsed edit (the PATCH body). The workshop applies an accepted style proposal through it too, the note's id as its key.
 * @param {EditTarget & { body: any }} options  `body` is unchecked: this checks it.
 */
export async function applyFighterEdit({ body, owner, id, key, db, rpc }) {
  // `style` (2026-10-27): the fighting style (`combat.style`) — an object replaces it, null removes it. A body edits the profile, the style or both.
  const profileOk =
    body?.profile === undefined ||
    (body.profile &&
      typeof body.profile === 'object' &&
      !Array.isArray(body.profile) &&
      Object.keys(body.profile).length &&
      Object.keys(body.profile).every(k => editable.has(k)));
  const styleOk = body?.style === undefined || body.style === null || (body.style && typeof body.style === 'object' && !Array.isArray(body.style));
  if (
    !body ||
    Array.isArray(body) ||
    Object.keys(body).some(k => !['profile', 'style', 'expectedManifestSha256'].includes(k)) ||
    !/^[a-f0-9]{64}$/.test(body.expectedManifestSha256 ?? '') ||
    !profileOk ||
    !styleOk ||
    (body.profile === undefined && body.style === undefined)
  )
    throw new Problem(422, 'invalid-profile');
  const { data: previous, error: previousError } = await db.from('af_submissions').select('*').eq('owner_id', owner).eq('idempotency_key', key).maybeSingle();
  if (previousError) throw unavailable('database-unavailable', previousError);
  if (previous && (previous.replaces_fighter !== id || !previous.validation?.profileBaseSubmission)) throw new Problem(409, 'idempotency-conflict');
  let query = db
    .from('af_submissions')
    .select('*')
    .eq('owner_id', owner)
    .eq('fighter_id', id)
    .eq('manifest_sha', body.expectedManifestSha256)
    .eq('status', 'registered');
  if (previous) query = query.eq('id', previous.validation.profileBaseSubmission);
  const { data: base, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw unavailable('database-unavailable', error);
  if (!base) throw new Problem(previous ? 409 : 404, previous ? 'idempotency-conflict' : 'fighter-not-found');
  const manifest = { ...base.manifest, profile: { ...base.manifest.profile, ...body.profile } };
  // `names: null` / `lines: null` remove the per-language names / bout lines (contract profile.names, profile.lines); leaving them out keeps them.
  for (const key of ['names', 'lines']) if (body.profile?.[key] === null) delete manifest.profile[key];
  if (body.style !== undefined) {
    manifest.combat = { ...base.manifest.combat, style: body.style };
    if (body.style === null) delete manifest.combat.style;
  }
  const result = validateFighter(manifest);
  if (!result.ok || unstorableTextPath(manifest) !== null) throw new Problem(422, 'invalid-profile', result.errors?.slice(0, 20));
  const text = JSON.stringify(manifest);
  return rpc('af_update_fighter_profile', {
    p_owner: owner,
    p_key: key,
    p_fighter: id,
    p_base: base.id,
    p_text: text,
    p_sha: await sha256(new TextEncoder().encode(text)),
  });
}
