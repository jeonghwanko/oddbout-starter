// @ts-check
// 운영자의 정면 (2026-11-03 — 사용자: "운영자가 올릴 수 있게 해줘"; supabase/migrations/20261103120000_oddbout_admin_profile_front.sql): a whole
// profile set for a registered fighter who has no approved set, without his owner's sign-in. The operator's sheet (profile-sets.mjs
// addOperatorSheet) needs an approved front to copy; this is the way for a fighter who never had one. Only the admin API imports it: the
// Render validator reads profile-sets.mjs and does not change with it.
// No Node-only imports: Deno and Node.
import { Problem, readBody, rpcProblem, sha256 } from './http.mjs';
import { probeImage } from './image-probe.mjs';
import { BUCKET } from './submissions.mjs';
import { PROFILE_SET_LIMITS, PROFILE_SET_STATUS, expireUpload, parseProfileSet, profileSetKey, profileSetView, storeOnce } from './profile-sets.mjs';

/** The refusals of the operator's front: a set's, and a fighter who already has an approved one (he gets a sheet instead). */
const STATUS = Object.freeze({ ...PROFILE_SET_STATUS, 'approved-profile-set-exists': 409 });
/** The form's parts: the set file, the front painting and the sheet it names. */
const PARTS = Object.freeze(['profile-set', 'front', 'expressions']);
/** The form's room: the three files at their limits and the multipart framing. */
const FORM_BYTES = PROFILE_SET_LIMITS.jsonBytes + PROFILE_SET_LIMITS.frontBytes + PROFILE_SET_LIMITS.expressionsBytes + 16000;

/**
 * The request's form (`multipart/form-data`): `profile-set` (profile-set.json, as the kit's `npm run fighter:profile-set` writes it),
 * `front` and, when the set file names one, `expressions`, each once. The set file's text is kept byte for byte: its hash is the set's.
 * @param {Request} request @returns {Promise<{ text: string, front: Uint8Array<ArrayBuffer>, expressions: Uint8Array<ArrayBuffer> | null }>}
 */
export async function operatorFrontForm(request) {
  const type = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data;\s*boundary=/i.test(type)) throw new Problem(415, 'multipart-required');
  const body = await readBody(request, FORM_BYTES);
  let form;
  try { form = await new Response(body, { headers: { 'content-type': type } }).formData(); } catch { throw new Problem(400, 'invalid-body'); }
  const names = [...form.keys()];
  if (names.some(name => !PARTS.includes(name)) || new Set(names).size !== names.length) throw new Problem(400, 'invalid-body');
  /** @param {string} name @returns {Promise<Uint8Array<ArrayBuffer> | null>} */
  const bytes = async name => {
    const value = form.get(name);
    if (value === null) return null;
    return typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(await value.arrayBuffer());
  };
  const [file, front, expressions] = await Promise.all(PARTS.map(bytes));
  if (!file || !front) throw new Problem(400, 'invalid-body');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(file); } catch { throw new Problem(400, 'invalid-utf8'); }
  return { text, front, expressions };
}

/**
 * The operator's front: his owner's set from the operator's files, made as his owner's af_profile_set_create makes one (his account, his
 * fighter, his open set and his daily sets count), with the operator's event in the same transaction (af_admin_profile_set_front). Then the
 * files go to his private storage and the set to the validator, then to the operator's review, as any set. Every file is checked against
 * the set file before anything is made. It is approved only while the fighter still has no current set (af_admin_profile_set_approve). The
 * same key answers the same set for the same set file, also after it was approved; a failure after the set was made expires it, so it never
 * holds his owner's own upload.
 * @param {any} db
 * @param {{ actor: string, fighterId: string, key: string, reason: string, text: string, front: Uint8Array<ArrayBuffer>,
 *   expressions: Uint8Array<ArrayBuffer> | null }} input
 */
export async function addOperatorFront(db, { actor, fighterId, key, reason, text, front, expressions }) {
  /** @param {string} name @param {Record<string, unknown>} args */
  const rpc = async (name, args) => { const { data, error } = await db.rpc(name, args); if (error) throw rpcProblem(error, STATUS); return data; };
  const parsed = parseProfileSet(text);
  if (!parsed.ok) throw new Problem(422, 'invalid-profile-set', parsed.errors);
  const set = parsed.data;
  // A sheet the set file does not name, or a named one left out: the set would not be the files the operator checked.
  if (Boolean(set.expressions) !== Boolean(expressions)) throw new Problem(422, 'assets-mismatch');
  /** @type {{ name: string, bytes: Uint8Array<ArrayBuffer>, file: import('./profile-set-contract.mjs').FrontFile }[]} */
  const files = [{ name: 'front', bytes: front, file: set.front }];
  if (set.expressions && expressions) files.push({ name: 'expressions', bytes: expressions, file: set.expressions });
  for (const { bytes, file } of files) {
    if (bytes.length !== file.bytes || await sha256(bytes) !== file.sha256) throw new Problem(422, 'asset-hash-or-size');
    const probed = probeImage(bytes);
    if (probed?.type !== 'image/webp' || probed.width !== file.width || probed.height !== file.height) throw new Problem(422, 'webp-required');
  }
  /** @type {import('./profile-sets.mjs').ProfileSetRow} */
  const row = await rpc('af_admin_profile_set_front', { p_actor: actor, p_fighter: fighterId, p_key: key, p_text: text,
    p_sha: await sha256(new TextEncoder().encode(text)), p_bytes: set.front.bytes, p_reason: reason });
  if (row.status !== 'uploading') return profileSetView(row);
  if (Date.parse(row.expires_at) <= Date.now()) throw new Problem(409, 'upload-expired');
  try {
    for (const { name, bytes, file } of files) await storeOnce(db, BUCKET, profileSetKey(row.owner_id, row.id, name), bytes, file.sha256);
    return profileSetView(await rpc('af_profile_set_submit', { p_owner: row.owner_id, p_id: row.id }));
  } catch (caught) {
    await expireUpload(db, row.id);
    throw caught;
  }
}
