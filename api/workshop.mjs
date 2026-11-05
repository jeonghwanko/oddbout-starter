// @ts-check
// 공방과 연대기 (4단계, 2026-10-27): canon sheets, the workshop's notes, declared relations and open worlds. The site and the cloud MCP
// share these routes; the MCP calls them in-process with its OAuth client as `agentClient` (shown as "made with"). Reads are public; every
// write names its owner and the database function checks him (`supabase/migrations/20261027200000_oddbout_workshop.sql`,
// `20261027210000_oddbout_open_worlds.sql`). Another person's text is returned as data in its own field, never mixed into instructions.
import { validateFighter } from '../contracts/ai-fighter/validate.mjs';
import { applyFighterEdit } from './fighter-profile.mjs';
import { Problem, UUID, jsonResponse, logFailure, readBody, rpcCaller, unavailable } from './http.mjs';
import { WORLD_COVERS, canonSheet, factionId, factions, nickname, note, text, worldCover, worldId, worldText, WORLD_LIMITS,
  RELATION_KINDS } from './canon.mjs';

const CORS = { methods: 'GET, POST, PUT, PATCH, DELETE, OPTIONS', headers: 'Authorization, Content-Type' };
/** @type {Record<string, number>} */
const STATUS = { 'nickname-required': 409, 'nickname-taken': 409, 'canon-changed': 409, 'fighter-promoted': 409, 'fighter-not-found': 404, 'not-found': 404,
  'rate-limit': 429, 'world-rate-limit': 429, 'not-a-proposal': 409, 'note-closed': 409, 'relation-exists': 409, 'relation-quota': 409,
  'world-quota': 409, 'world-not-found': 404, 'faction-not-found': 422, 'world-locked': 409, 'not-world-owner': 403,
  'world-membership-required': 409, 'world-author-mismatch': 403, 'account-disabled': 403, 'invite-required': 403, 'canon-empty': 422,
  'invalid-canon': 422, 'post-exists': 409, 'world-full': 409 };
// A unique key two writers raced for, by its name (any other is a plain conflict).
const UNIQUE = /** @type {[RegExp, string][]} */ ([[/af_creator_names_nickname/, 'nickname-taken'], [/af_fighter_relations_pair/, 'relation-exists'], [/af_world_posts_pkey|af_world_posts_world_id_id_key/, 'post-exists']]);
/** A unique or check constraint's refusal (a name taken, a pair already related, text the table refuses), or null. @param {any} error */
function constraintProblem(error) {
  const unique = UNIQUE.find(([name]) => name.test(error.message ?? ''));
  if (unique) return new Problem(409, unique[1]);
  if (error.code === '23505') return new Problem(409, 'conflict');
  if (error.code === '23514' || /violates check constraint/.test(error.message ?? '')) return new Problem(422, 'invalid-text');
  return null;
}
// A story's cursor: the time a page's last note was written, as the story gave it.
const CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Is this path the workshop's? @param {string[]} parts */
export function workshopRoute(parts) {
  return ['story', 'notes', 'relations', 'worlds'].includes(parts[0])
    || parts[0] === 'me' && parts.length === 2 && ['workshop', 'name'].includes(parts[1])
    || parts[0] === 'fighters' && parts.length === 3 && ['canon', 'world'].includes(parts[2]);
}

/**
 * @param {{ db: any, authenticate: (request: Request) => Promise<string>, rpc: import('./fighter-profile.mjs').EditTarget['rpc'],
 *   agentClient?: string | null }} options  `authenticate` resolves to the signed-in creator's id or throws a Problem.
 * @returns {import('./http.mjs').Route}
 */
export function createWorkshopHandler({ db, authenticate, rpc: profileRpc, agentClient = null }) {
  const client = UUID.test(agentClient ?? '') ? agentClient : null;
  /** @param {string} name @param {Record<string, unknown>} args */
  // The longest code a message names (`faction-not-found` before `not-found`), then a constraint's refusal.
  const call = rpcCaller(db, STATUS, { contains: true, otherwise: constraintProblem });
  /** @param {Request} request @param {number} [limit] */
  async function readJson(request, limit = 24000) {
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, limit))); }
    catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-body'); }
  }
  /** @type {(value: any) => string} An id from the path or a body, checked here. */
  const id = value => { if (!UUID.test(value ?? '')) throw new Problem(400, 'invalid-id'); return value.toLowerCase(); };
  /** @type {(body: any, allowed: string[]) => Record<string, any>} A request's JSON object with only the allowed keys, checked here. */
  const fields = (body, allowed) => {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw new Problem(422, 'invalid-body');
    return body;
  };
  // His current package, as an accepted style would edit it.
  /** @param {string} fighter @returns {Promise<{ owner: string, sha: string, manifest: any }>} */
  async function currentPackage(fighter) {
    const { data: f, error } = await db.from('af_fighters').select('owner_id,submission_id,manifest_sha').eq('id', fighter).maybeSingle();
    if (error) throw unavailable('database-unavailable', error);
    if (!f) throw new Problem(404, 'fighter-not-found');
    const { data: row, error: rowError } = await db.from('af_submissions').select('manifest').eq('id', f.submission_id).maybeSingle();
    if (rowError) throw unavailable('database-unavailable', rowError);
    if (!row) throw new Problem(404, 'fighter-not-found');
    return { owner: f.owner_id, sha: f.manifest_sha, manifest: row.manifest };
  }
  // A proposed style must make a valid package of his current one.
  /** @param {any} manifest  His package's fighter.json as stored. @param {object | null} style */
  function checkStyle(manifest, style) {
    const combat = { ...manifest.combat, style }; if (style === null) delete combat.style;
    const result = validateFighter({ ...manifest, combat });
    if (!result.ok) throw new Problem(422, 'invalid-proposal', result.errors?.slice(0, 20));
  }
  // A proposal's style, applied once: the note's id keys the edit, so a retry finds it made and does not make it twice.
  /**
   * @param {string} noteId
   * @param {string} fighter
   * @param {object | null} style
   * @param {string} owner
   * @param {{ sha: string }} pack
   */
  async function applyStyle(noteId, fighter, style, owner, pack) {
    const { data: made, error } = await db.from('af_submissions').select('id').eq('owner_id', owner).eq('idempotency_key', noteId).maybeSingle();
    if (error) throw unavailable('database-unavailable', error);
    if (made) return false;
    try { await applyFighterEdit({ body: { style, expectedManifestSha256: pack.sha }, owner, id: fighter, key: noteId, db, rpc: profileRpc }); }
    catch (problem) { if (!(problem instanceof Problem && problem.message === 'fighter-unchanged')) throw problem; }
    return true;
  }
  /** @param {string} fighter @param {URL} url */
  async function story(fighter, url) {
    const before = url.searchParams.get('before'), version = url.searchParams.get('version');
    if (before !== null && (!CURSOR.test(before) || !Number.isFinite(Date.parse(before)))) throw new Problem(422, 'invalid-cursor');
    if (version !== null && !/^[1-9]\d{0,3}$/.test(version)) throw new Problem(422, 'invalid-version');
    const data = await call('af_fighter_story', { p_fighter: fighter, p_before: before, p_version: version === null ? null : Number(version) });
    if (!data) throw new Problem(404, 'fighter-not-found');
    const notes = data.notes.slice(0, 20);
    return { ok: true, fighter, canon: data.canon, versions: data.versions, notes, hasMore: data.notes.length > 20,
      nextBefore: data.notes.length > 20 ? notes.at(-1).createdAt : null, relations: data.relations,
      // A registered fighter promoted to an official package (20261105200000): the official id his story now belongs to (only then).
      ...(data.promotedTo ? { promotedTo: data.promotedTo } : {}) };
  }
  /** @param {string} id */
  async function world(id) {
    const { data, error } = await db.from('af_worlds').select('id').eq('id', id).eq('published', true).eq('hidden', false).maybeSingle();
    if (error) throw unavailable('database-unavailable', error);
    if (!data) throw new Problem(404, 'world-not-found');
    const overview = await call('af_world_overview', { p_world: id }), chronicle = await call('af_world_chronicle', { p_world: id });
    return { ok: true, world: overview.world, owner: overview.owner ?? null, memberCount: overview.memberCount,
      fighters: overview.characters.map(/** @param {{ fighter_id: string, name: string, faction?: string | null, promoted_to?: string | null }} c */ c => ({ id: c.fighter_id, name: c.name, faction: c.faction ?? null, ...(c.promoted_to ? { promotedTo: c.promoted_to } : {}) })), chronicle };
  }
  return async (request, parts) => {
    /** @type {(body: any, status?: number) => Response} */
    const json = (body, status = 200) => jsonResponse(body, status, CORS);
    try {
      const method = request.method, url = new URL(request.url), route = parts.join('/');
      if (method === 'OPTIONS') return json({ ok: true });
      // Public reads.
      if (method === 'GET' && parts[0] === 'story' && parts.length === 2) return json(await story(id(parts[1]), url));
      if (method === 'GET' && route === 'worlds') return json({ ok: true, worlds: await call('af_world_list', {}), covers: WORLD_COVERS.map(worldCover) });
      if (method === 'GET' && parts[0] === 'worlds' && parts.length === 2) {
        if (!worldId(parts[1])) throw new Problem(404, 'world-not-found');
        return json(await world(parts[1]));
      }
      const owner = await authenticate(request);
      if (method === 'GET' && route === 'me/workshop') return json({ ok: true, ...await call('af_workshop_inbox', { p_owner: owner }) });
      if (method === 'PUT' && route === 'me/name') {
        const body = fields(await readJson(request), ['nickname']);
        return json({ ok: true, nickname: await call('af_set_creator_name', { p_owner: owner, p_nickname: nickname(body.nickname) }) });
      }
      if (method === 'PUT' && parts[0] === 'fighters' && parts[2] === 'canon') {
        const body = fields(await readJson(request), ['base', 'sheet']);
        if (!Number.isInteger(body.base) || body.base < 0) throw new Problem(422, 'invalid-base');
        const row = await call('af_canon_write', { p_owner: owner, p_fighter: id(parts[1]), p_base: body.base, p_sheet: canonSheet(body.sheet), p_client: client });
        return json({ ok: true, version: row.version, sheet: row.sheet, madeWith: row.made_with ?? null });
      }
      if (method === 'POST' && route === 'notes') {
        const value = note(await readJson(request));
        if (value.proposal?.style !== undefined) checkStyle((await currentPackage(value.fighter)).manifest, value.proposal.style);
        const row = await call('af_note_post', { p_owner: owner, p_fighter: value.fighter, p_kind: value.kind, p_body: value.body,
          p_evidence: value.evidence, p_proposal: value.proposal ?? null, p_client: client });
        return json({ ok: true, note: { id: row.id, fighter: row.fighter_id, kind: row.kind, state: row.state, baseVersion: row.base_version,
          madeWith: row.made_with ?? null, createdAt: row.created_at } });
      }
      if (method === 'POST' && parts[0] === 'notes' && parts[2] === 'resolve' && parts.length === 3) {
        const noteId = id(parts[1]), body = fields(await readJson(request), ['decision']);
        if (!['accept', 'decline'].includes(body.decision)) throw new Problem(422, 'invalid-decision');
        const { data: n, error } = await db.from('af_fighter_notes').select('fighter_id,kind,state,proposal,hidden,resolved_version').eq('id', noteId).maybeSingle();
        if (error) throw unavailable('database-unavailable', error);
        if (!n || n.hidden) throw new Problem(404, 'not-found');
        // The answer first, under the note's lock (the database merges a proposal's canon fields over the sheet as it is then); a proposal's
        // style after it. A style his package cannot take refuses the accept before anything is written; an accepted proposal whose style
        // edit failed after the answer is finished by accepting it again.
        const style = body.decision === 'accept' && n.kind === 'proposal' && n.proposal?.style !== undefined;
        let pack = /** @type {{ owner: any, sha: any, manifest: any } | null} */ (null);
        if (style && ['open', 'accepted'].includes(n.state)) {
          pack = await currentPackage(n.fighter_id);
          if (pack.owner !== owner) throw new Problem(404, 'not-found');
          if (n.state === 'accepted') {
            if (!await applyStyle(noteId, n.fighter_id, n.proposal.style, owner, pack)) throw new Problem(409, 'note-closed');
            return json({ ok: true, note: { id: noteId, state: 'accepted', resolvedVersion: n.resolved_version } });
          }
          checkStyle(pack.manifest, n.proposal.style);
        }
        const row = await call('af_note_resolve', { p_owner: owner, p_note: noteId, p_accept: body.decision === 'accept', p_sheet: null, p_client: client });
        // `pack` is set here: af_note_resolve refuses a note that was not open (`note-closed`), and an accepted one returned above.
        if (style) await applyStyle(noteId, n.fighter_id, n.proposal.style, owner, /** @type {{ sha: string }} */ (pack));
        return json({ ok: true, note: { id: row.id, state: row.state, resolvedVersion: row.resolved_version } });
      }
      if (method === 'DELETE' && parts[0] === 'notes' && parts.length === 2) {
        const row = await call('af_note_withdraw', { p_owner: owner, p_note: id(parts[1]) });
        return json({ ok: true, note: { id: row.id, state: row.state } });
      }
      if (method === 'POST' && route === 'relations') {
        const body = fields(await readJson(request), ['fighter', 'other', 'kind']);
        if (!RELATION_KINDS.includes(body.kind) || body.fighter === body.other) throw new Problem(422, 'invalid-relation');
        const row = await call('af_relation_propose', { p_owner: owner, p_fighter: id(body.fighter), p_other: id(body.other), p_kind: body.kind });
        return json({ ok: true, relation: { id: row.id, fighter: row.fighter_id, other: row.other_id, kind: row.kind, state: row.state } });
      }
      if (method === 'POST' && parts[0] === 'relations' && parts[2] === 'answer' && parts.length === 3) {
        const body = fields(await readJson(request), ['accept']);
        if (typeof body.accept !== 'boolean') throw new Problem(422, 'invalid-answer');
        const row = await call('af_relation_answer', { p_owner: owner, p_relation: id(parts[1]), p_accept: body.accept });
        return json({ ok: true, relation: { id: row.id, state: row.state } });
      }
      if (method === 'DELETE' && parts[0] === 'relations' && parts.length === 2) {
        await call('af_relation_remove', { p_owner: owner, p_relation: id(parts[1]) });
        return json({ ok: true });
      }
      if (method === 'POST' && route === 'worlds') {
        const body = fields(await readJson(request), ['name', 'tagline', 'description', 'place', 'nickname', 'cover']);
        const values = worldText(body), cover = body.cover ?? WORLD_COVERS[0];
        if (!WORLD_COVERS.includes(cover)) throw new Problem(422, 'invalid-cover');
        const created = await call('af_world_create', { p_owner: owner, p_name: values.name, p_tagline: values.tagline ?? '', p_description: values.description ?? '',
          p_place: values.place ?? '', p_nickname: nickname(body.nickname), p_cover: worldCover(cover) });
        return json({ ok: true, world: created });
      }
      if (method === 'PATCH' && parts[0] === 'worlds' && parts.length === 2) {
        if (!worldId(parts[1])) throw new Problem(404, 'world-not-found');
        const body = fields(await readJson(request), ['name', 'tagline', 'description', 'place', 'cover', 'factions', 'canon', 'remove']);
        const patch = worldText(body, { partial: true });
        if (body.cover !== undefined) { if (!WORLD_COVERS.includes(body.cover)) throw new Problem(422, 'invalid-cover'); patch.cover = worldCover(body.cover); }
        if (body.factions !== undefined) patch.factions = factions(body.factions);
        // The whole body is checked before the first write: a malformed canon or removal once came back refused after the text was saved
        // (API 점검 2026-10-29).
        const canon = body.canon === undefined ? null : fields(body.canon, ['post', 'on']);
        if (canon && typeof canon.on !== 'boolean') throw new Problem(422, 'invalid-body');
        const post = canon ? id(canon.post) : null, removed = body.remove === undefined ? null : id(body.remove);
        if (!Object.keys(patch).length && !canon && !removed) throw new Problem(422, 'invalid-body');
        let result = null;
        if (Object.keys(patch).length) result = await call('af_world_update', { p_owner: owner, p_world: parts[1], p_patch: patch });
        if (canon) await call('af_world_canon', { p_owner: owner, p_world: parts[1], p_post: post, p_on: canon.on });
        if (removed) await call('af_world_remove_fighter', { p_owner: owner, p_world: parts[1], p_fighter: removed });
        return json({ ok: true, ...(result ? { world: result } : {}) });
      }
      if (method === 'PUT' && parts[0] === 'fighters' && parts[2] === 'world') {
        const body = fields(await readJson(request), ['world', 'faction']);
        if (body.world !== null && !worldId(body.world) || body.faction !== undefined && body.faction !== null && !factionId(body.faction))
          throw new Problem(422, 'invalid-body');
        return json({ ok: true, ...await call('af_world_place', { p_owner: owner, p_fighter: id(parts[1]), p_world: body.world,
          p_faction: body.world === null ? null : body.faction ?? null }) });
      }
      if (method === 'POST' && parts[0] === 'worlds' && parts[2] === 'posts' && parts.length === 3) {
        if (!worldId(parts[1])) throw new Problem(404, 'world-not-found');
        const body = fields(await readJson(request), ['id', 'title', 'body', 'nickname', 'canon']);
        if (body.canon !== undefined && typeof body.canon !== 'boolean') throw new Problem(422, 'invalid-body');
        const post = await call('af_world_post_as', { p_owner: owner, p_world: parts[1], p_id: id(body.id),
          p_title: text(body.title, WORLD_LIMITS.postTitle, '/title', { min: 2, code: 'invalid-post' }),
          p_body: text(body.body, WORLD_LIMITS.postBody, '/body', { min: 2, lines: true, code: 'invalid-post' }),
          p_nickname: body.nickname === undefined ? null : nickname(body.nickname), p_canon: body.canon === true });
        return json({ ok: true, post });
      }
      throw new Problem(404, 'route-not-found');
    } catch (error) {
      logFailure('workshop', request, error);
      if (error instanceof Problem) return json({ ok: false, stage: 'workshop', code: error.message, ...(error.errors ? { errors: error.errors } : {}) }, error.status);
      return json({ ok: false, stage: 'workshop', code: 'service-unavailable' }, 503);
    }
  };
}

