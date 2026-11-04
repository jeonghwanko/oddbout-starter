// @ts-check
// The agent tools (3단계, 2026-10-27): ODDBOUT's public records, spars, cups and the owner's fighting style and profile edits.
import { z } from 'zod';
import { Problem } from '../../api/http.mjs';
import spec from '../../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { profileLimits } from '../../contracts/ai-fighter/profile-limits.mjs';
import { CUP_WAIT_MS, UUID_ARG, arenaCall, frontNext, pause, timeLeft, unavailable } from './common.mjs';
import { ENTRY_CLIPS } from '../../api/fighter-entry.mjs';
/**
 * @typedef {import('./common.mjs').Identity} Identity
 * @typedef {import('./common.mjs').Arena} Arena
 * @typedef {import('./common.mjs').Invoke} Invoke
 * @typedef {import('./common.mjs').RecordAgent} RecordAgent
 * @typedef {import('./common.mjs').Register} Register
 */

/**
 * How a fighter's `combat.style` reads (the game contract's README, 전투 스타일; values in `spec.combatStyle`). An agent translates the
 * fighter's concept into these closed choices itself; the server only checks them. Grade 3 and missing values are the standard kit.
 */
export const STYLE_GUIDE = Object.freeze({
  mix: 'How often each swing is chosen, slam/combo/fast 0-4 each: '
    + 'slam = one heavy blow, combo = a chained string, fast = a quick jab (counted half). At least one above 0; '
    + 'fast at most slam + combo.',
  special: 'The swing (slam, combo or fast) used to chase an opponent who opens distance and to strike back while getting up.',
  super: 'The move used as the super: slam, combo, fast or dash.',
  distance: 'Fighting range 1-5: 1 swings up close, 5 from far.',
  shockwave: 'true: the heavy blow sends a ground shockwave.',
  summon: 'One summon called by the heavy-blow clip: crane, bolt, sportsCar or roadster.',
  temper: 'Temperament 1-5 each: guard (blocking), retreat (backing off), measure (keeping distance), patience (waiting).',
  exchanges: 'Exchange patterns 0-3 each: cross (crossing dash), pinball (rope bounces), rush (head-on clash). '
    + '0 never, 1 half, 2 standard, 3 double.',
  extras: 'The skill clip, a summon and a shockwave together: at most two (STYLE_EXTRAS).',
  skill: 'The unique skill comes from the optional skill clip (stretch, pincer, flight, feint, slide, counter, brace), '
    + 'fixed at registration; a style edit cannot add one.',
  translate: 'Read the fighter\'s concept, moves and lines. Pick only the choices the character clearly implies; leave the rest out. '
    + 'Spar before and after a change and keep the version that fights like the character.',
});

/**
 * `identity` is null only on a signed-out call, which register lets reach the public tools alone: the account tools cast it.
 * `uploads`: whether this address lists the upload tools (only /mcp, 2026-11-05: common.mjs frontNext).
 * @param {{ register: Register, arena: Arena, db: any, identity: Identity | null, invoke: Invoke, recordAgent: RecordAgent, caller: string | null, directory?: boolean,
 *   uploads?: boolean }} options
 */
export function registerAgentTools({ register, arena, db, identity, invoke, recordAgent, caller, directory = false, uploads = !directory }) {
  /** @type {(path: string, body?: object) => Promise<any>} */
  const call = (path, body) => arenaCall(arena, path, body);
  // A read's budget: the signed-in owner's; signed out, the host's anonymous user (`caller`); else every signed-out agent's together.
  /** @type {(path: string) => Promise<any>} */
  const read = path => identity ? arenaCall(arena, path, undefined, identity.owner)
    : arenaCall(arena, path, undefined, caller ?? 'public', undefined, { signedOut: caller !== null });
  const ID = z.string().min(1).max(64).regex(/^[a-z0-9-]+$/);
  register('get_style_guide', '전투 스타일 안내', 'Read how a fighter\'s combat.style choices fight, to translate the character\'s concept into them. '
    + 'Values and limits are the contract\'s (spec.combatStyle). This changes nothing.',
    {}, async () => ({ ok: true, contract: spec.combatStyle, guide: STYLE_GUIDE }), { publicTool: true });
  register('list_fighters', 'ODDBOUT 선수 명단', 'List ODDBOUT\'s fighters: the built-in roster and the listed, entered registered fighters (id and name). '
    + 'Use the ids for records, spars and bouts.',
    {}, async () => {
      // The arena's list and the roster's first page at once (the two hops were 650 ms in a row).
      const [builtins, first] = await Promise.all([call('fighters'), invoke('roster')]);
      if (!builtins.ok) return builtins;
      const registered = [];
      // The pages one after another: each one's cursor is the last fighter of the page before (keyset), not known up front.
      for (let cursor = null, page = 0; page < 5; page++) {
        /** @type {any} */
        const list = page === 0 ? first : await invoke(`roster?after=${encodeURIComponent(cursor)}`);
        if (!list.ok) return list;
        registered.push(...list.fighters.map(/** @param {{ id: string, name: string, names?: Record<string, string> }} fighter */ ({ id, name, names }) => ({ id, name, ...(names ? { names } : {}) })));
        if (!list.hasMore) break;
        cursor = list.nextCursor;
      }
      return { ok: true, rules: builtins.rules, builtin: builtins.fighters, registered };
    }, { publicTool: true });
  register('get_rankings', 'ODDBOUT 랭킹', 'Read the cup rankings: built-in fighters by cup points, '
    + 'or registered fighters by cup win rate (a minimum number of bouts).',
    { scope: z.enum(['builtin', 'registered']).default('builtin') }, ({ scope }) => call(scope === 'registered' ? 'rankings?scope=registered' : 'rankings'), { publicTool: true });
  register('get_fighter_record', '전적', 'Read a fighter\'s public cup record: wins, losses, '
    + 'recent bouts (with each cup\'s seed for read_bout) and the rivals he met most.',
    { fighterId: ID }, async ({ fighterId }) => {
      const record = await call(`fighter?id=${encodeURIComponent(fighterId)}`);
      // Each bout's package pins are 64-character hashes an agent never uses; read_bout finds them from the cup.
      return record.ok && Array.isArray(record.recent) ? { ...record, recent: record.recent.map(/** @param {Record<string, unknown>} bout */ ({ registered, ...bout }) => bout) } : record;
    }, { publicTool: true });
  register('get_cup', '컵 결과', 'Read a cup by its id (one enter_cup returned, or a week\'s): '
    + 'its bracket, state and every played bout with its winner and finish.',
    { cupId: UUID_ARG() }, ({ cupId }) => call(`cup?id=${cupId}`), { publicTool: true });
  register('read_bout', '경기 기록 읽기', 'Fight a bout again and read its record: who won and how, HP left, hits landed and the highlights (super, air combo, '
    + 'throw, wall, big hit, comeback, KO, clutch) with their times. '
    + 'Give a played cup bout (cupId, round 0-3, slot) or a pair and seed (current packages). '
    + 'The page link plays it in the browser.',
    { cupId: UUID_ARG().optional(), round: z.number().int().min(0).max(3).optional(), slot: z.number().int().min(0).max(7).optional(),
      a: ID.optional(), b: ID.optional(), seed: z.number().int().min(0).max(0xffffffff).optional() },
    async ({ cupId, round, slot, a, b, seed }) => {
      if (cupId !== undefined && round !== undefined && slot !== undefined) return read(`bout?cup=${cupId}&round=${round}&slot=${slot}`);
      if (a !== undefined && b !== undefined && seed !== undefined) return read(`bout?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}&seed=${seed}`);
      return { ok: false, code: 'invalid-bout' };
    }, { publicTool: true });
  register('spar', '스파링', 'Spar: one bout between two fighters on their current packages, read back with its record (as read_bout). '
    + 'Not ranked and not kept. Use it to see how a fighter fights, before and after a style change. Registered fighters must be entered. '
    + 'Give a seed to fight the same bout again.',
    { fighterId: ID, opponentId: ID, seed: z.number().int().min(0).max(0xffffffff).optional() },
    ({ fighterId, opponentId, seed }) => call('agent/spar', { owner: /** @type {Identity} */ (identity).owner, a: fighterId, b: opponentId, ...(seed === undefined ? {} : { seed }) }));
  register('enter_cup', '16강 컵 출전', 'Enter the connected user\'s registered fighter in a 16-fighter cup. '
    + 'The server draws the other fifteen from the built-in roster and fights every bout; '
    + 'the results count in the cup rankings. Only an entered fighter (enter_fighter) enters. Requires the user\'s request. '
    + 'Returns the finished cup (a few seconds); '
    + 'if it is still running, read it with get_cup. Use a new UUID per cup and the same UUID to retry it: '
    + 'a retry after an unknown outcome returns the cup it made (replayed), never a second cup. '
    + 'career: true makes it the user\'s career cup (fight money to the account, the fighter\'s fans and upgrades grow; not ranked) — '
    + 'its prep between bouts is get_career then choose_career_prep.',
    // The key names the cup at the arena (2026-11-03): a gateway once cut off a call whose cup was made, and the retry made a second one.
    // 파이트머니 2판 (2026-11-03): `career` makes it the user's career cup — the fighter's money, fans and upgrades go on with every bout,
    // the account's gold is paid, and between his bouts the cup waits for the prep (get_career, choose_career_prep; or the auto manager).
    { fighterId: UUID_ARG(), idempotencyKey: UUID_ARG(), career: z.boolean().optional() }, async ({ fighterId, idempotencyKey, career }, { signal, deadline: due }) => {
      const issued = await arenaCall(arena, 'agent/cup', { owner: /** @type {Identity} */ (identity).owner, fighter: fighterId,
        idempotencyKey: idempotencyKey.toLowerCase(), ...(career ? { career: true } : {}) }, undefined, timeLeft(due, 20000));
      if (!issued.ok) return issued;
      // A career cup stops at his next bout for the prep: the agent reads it with get_career.
      if (issued.career === true) return { ...issued, state: 'open', next: 'get_career' };
      // A cup is fought in about seven seconds: wait for it here so the agent needs no second call (MCP 점검 2026-10-27).
      // The wait ends by the call's deadline (counted from its request, the issue included: 2026-11-03) or CUP_WAIT_MS, each read bounded by
      // the time left; a client that went away ends it at once. The cup is made either way: an open one is read with get_cup.
      // Its reads come after 1, 1, 2, 3, 4… seconds (MCP 최적화 2026-11-05): a read a second took twelve reads to wait twelve seconds for a
      // cup that ran long; seven now wait 22.
      const deadline = Math.min(due, Date.now() + (arena.cupWaitMs ?? CUP_WAIT_MS)), pollMs = arena.pollMs ?? 1000;
      for (let i = 0, wait = pollMs; i < (arena.pollTries ?? 12) && Date.now() + wait < deadline && !signal.aborted; i++, wait = pollMs * Math.max(1, i)) {
        await pause(wait, signal);
        if (signal.aborted) break;
        const cup = await arenaCall(arena, `cup?id=${issued.ticket}`, undefined, undefined, timeLeft(deadline, 20000), { signal }).catch(() => null);
        if (cup?.ok && cup.cup && cup.cup.state !== 'open') return { ...issued, cup: cup.cup };
      }
      return { ...issued, state: 'open', next: 'get_cup' };
    }, { write: true, openWorld: true, idempotent: true });
  const CARD = z.enum(['light', 'heavy', 'skill']);
  register('get_career', '커리어 준비', 'Read the user\'s career of a fighter (fight money): fans, stamina, upgrade levels, the account\'s gold, '
    + 'and the newest career cup with the prep it owes — the situation, the open choices (upgrade, stamina story, rest), the three story cards. '
    + 'Then choose_career_prep.',
    { fighterId: ID }, ({ fighterId }) => read(`agent/career?fighter=${encodeURIComponent(fighterId)}`));
  register('choose_career_prep', '커리어 준비 고르기', 'Make the prep a career cup owes (get_career): an upgrade card (light, heavy, skill — its price '
    + 'from the account\'s gold), a story card from the three offered, or rest. The cup goes on to his next bout. Requires the user\'s request.',
    { cupId: UUID_ARG(), kind: z.enum(['upgrade', 'story', 'rest']), card: CARD.optional(), storyId: z.string().regex(/^[a-z0-9-]{1,40}$/).optional() },
    ({ cupId, kind, card, storyId }) => {
      const choice = kind === 'upgrade' ? (card ? { kind, card } : null) : kind === 'story' ? (storyId ? { kind, id: storyId } : null) : { kind };
      if (!choice) return { ok: false, code: 'invalid-choice' };
      return call('agent/career/manage', { owner: /** @type {Identity} */ (identity).owner, ticket: cupId.toLowerCase(), choice });
    }, { write: true, idempotent: false });
  register('set_career_auto', '자동 매니저', 'Turn the auto manager of the user\'s career of a fighter on or off (open after four prep steps): '
    + 'on, every prep is made at once without waiting. Requires the user\'s request.',
    { fighterId: ID, on: z.boolean() },
    ({ fighterId, on }) => call('agent/career/auto', { owner: /** @type {Identity} */ (identity).owner, fighter: fighterId, on }), { write: true, idempotent: true });
  // The owner's current registered package hash (the version an edit is made on), or a 404.
  /** @param {string} fighterId */
  const currentSha = async fighterId => {
    const { data: fighter, error } = await db.from('af_fighters').select('manifest_sha').eq('id', fighterId).eq('owner_id', /** @type {Identity} */ (identity).owner)
      .is('deleted_at', null).maybeSingle();
    if (error) throw unavailable('database-unavailable', error);
    if (!fighter) throw new Problem(404, 'fighter-not-found');
    return fighter.manifest_sha;
  };
  // The package an edit is made on. A key that already made its edit names the package that edit started from: the fighter has since
  // moved to the edit's own package, and rebuilt on that, a successful edit whose response was lost came back as a conflict
  // (MCP 점검 2026-10-29). The API checks the key's fighter and change itself.
  /** @param {string} fighterId @param {string} idempotencyKey */
  const baseSha = async (fighterId, idempotencyKey) => {
    const { data: previous, error } = await db.from('af_submissions').select('validation').eq('owner_id', /** @type {Identity} */ (identity).owner)
      .eq('idempotency_key', idempotencyKey).maybeSingle();
    if (error) throw unavailable('database-unavailable', error);
    const base = previous?.validation?.profileBaseSubmission;
    if (!base) return currentSha(fighterId);
    const { data, error: baseError } = await db.from('af_submissions').select('manifest_sha').eq('id', base).eq('owner_id', /** @type {Identity} */ (identity).owner).maybeSingle();
    if (baseError) throw unavailable('database-unavailable', baseError);
    return data?.manifest_sha ?? currentSha(fighterId);
  };
  /** @param {string} fighterId @param {object} change @param {string} idempotencyKey */
  const edit = async (fighterId, change, idempotencyKey) => {
    const result = await invoke(`fighters/${fighterId}/profile`, 'PATCH', JSON.stringify({ expectedManifestSha256: await baseSha(fighterId, idempotencyKey), ...change }),
      { 'content-type': 'application/json', 'idempotency-key': idempotencyKey });
    if (result.ok) await recordAgent(result.submissionId);
    return result;
  };
  register('update_fighter_profile', '프로필 고치기', 'Change the connected user\'s registered fighter\'s profile text without new art: '
    + 'name, description, language, concept, moves, per-language names or bout lines (challenge, win, lose). '
    + 'Give only the fields to change; null removes names or lines. Checked against the contract. '
    + 'Requires the user\'s approval of the change. Use a new UUID per change and the same UUID to retry it.',
    { fighterId: UUID_ARG(), profile: z.object({ name: z.string().min(1).max(profileLimits.name), description: z.string().min(1).max(profileLimits.description),
      language: z.enum(profileLimits.languages), concept: z.string().min(1).max(profileLimits.concept), moves: z.record(z.string(), z.unknown()),
      names: z.union([z.record(z.string(), z.string()), z.null()]),
      lines: z.union([z.record(z.string(), z.string()), z.null()]) }).partial().strict(), idempotencyKey: UUID_ARG() },
    ({ fighterId, profile, idempotencyKey }) => Object.keys(profile).length ? edit(fighterId, { profile }, idempotencyKey) : { ok: false, code: 'invalid-profile' },
    { write: true, publish: true, openWorld: true, idempotent: true });
  register('update_fighter_style', '전투 스타일 고치기', 'Change the connected user\'s registered fighter\'s fighting style (combat.style) without new art: '
    + 'an object replaces it, null removes it. Checked against the contract (get_style_guide). '
    + 'His next bouts fight the new style. Requires the user\'s approval of the change. '
    + 'Use a new UUID per change and the same UUID to retry it.',
    { fighterId: UUID_ARG(), style: z.union([z.record(z.string(), z.unknown()), z.null()]), idempotencyKey: UUID_ARG() },
    ({ fighterId, style, idempotencyKey }) => edit(fighterId, { style }, idempotencyKey), { write: true, publish: true, openWorld: true, idempotent: true });
  // 출전 (2026-10-30): a validated fighter is 제작 중 until his owner enters him; only then do other people meet him. Both calls answer the
  // same when repeated (supabase/migrations/20261030130000_ai_fighter_entry.sql). They are the site's own route (`api/fighter-entry.mjs`),
  // its account check first (`af_authorize` — 적대적 리뷰 2026-10-30: a disabled account entered its fighter here while the site refused it).
  // This file once kept a copy of that route's calls and codes (MCP 점검 2026-11-03).
  /** @param {string} fighterId @param {'POST' | 'DELETE'} method @param {object} [body] */
  const entry = (fighterId, method, body) => invoke(`fighters/${fighterId}/entry`, method, body === undefined ? undefined : JSON.stringify(body),
    body === undefined ? {} : { 'content-type': 'application/json' });
  register('enter_fighter', '출전하기', 'Enter the connected user\'s registered fighter (출전): other people then meet him in the roster, '
    + 'ranked duels, cups and their rankings. A validated fighter starts in production (제작 중): out of other people\'s cups, ranked duels and lists while his owner previews and practises him. '
    + 'First show the user each of the eleven required motions; enter only on his request once he confirmed every one. '
    + 'Pass the package hash he watched (get_registered_fighter) and those motions. A new package returns him to production. '
    + 'He enters only with a front painting that passed ODDBOUT\'s check (one character, whole, facing the viewer straight on): read '
    + 'get_registered_fighter first and tell the user what its front lacks '
    // Without the upload tools (2026-11-05: /signin; the directory edition has its own text) it names none of them.
    + (uploads ? '(a new painting goes in through prepare_profile_set, upload_profile_set_asset and submit_profile_set). '
      : '(this connector cannot upload one: the user uploads a new painting from the ODDBOUT app in ChatGPT or with the creator kit). ')
    + 'profile-set-required: next says what to do.',
    { fighterId: UUID_ARG(), expectedManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
      reviewedClips: z.array(z.enum(/** @type {[string, ...string[]]} */ ([...ENTRY_CLIPS]))).length(ENTRY_CLIPS.length) },
    async ({ fighterId, expectedManifestSha256, reviewedClips }) => {
      const result = await entry(fighterId, 'POST', { expectedManifestSha256, reviewedClips });
      const next = result?.code === 'profile-set-required' ? frontNext(result.front, { directory, uploads }) : null;
      return next ? { ...result, next } : result;
    },
    { write: true, publish: true, openWorld: true, idempotent: true });
  register('withdraw_fighter', '출전 취소', 'Return the connected user\'s entered fighter to production (제작 중): other people stop meeting him '
    + 'in the roster, ranked duels and cups; his record stays. Requires the user\'s request.',
    { fighterId: UUID_ARG() }, ({ fighterId }) => entry(fighterId, 'DELETE'),
    { write: true, publish: true, openWorld: true, idempotent: true });
}
