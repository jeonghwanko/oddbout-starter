// @ts-check
// 공방과 연대기 (4단계, 2026-10-27): the shapes the workshop API accepts — a canon sheet, a note's evidence and proposal, a world's text and
// factions. Pure checks; each returns the cleaned value or throws Problem(422). No Node-only imports: this file runs on Deno and Node.
import { Problem, UUID } from './http.mjs';
/**
 * What the checks below return. WorldFields: `worldText` gives the text fields; the workshop adds a world's cover and factions to them.
 * @typedef {{ cup: string, round: number, slot: number } | { a: string, b: string, seed: number }} Evidence  A bout a note points at.
 * @typedef {{ canon?: Record<string, string | string[] | null>, style?: object | null, remake?: string }} Proposal
 * @typedef {{ fighter: string, kind: string, body: string, evidence: Evidence[], proposal?: Proposal }} Note
 * @typedef {{ id: string, name: string, description?: string }} Faction
 * @typedef {{ name?: string, tagline?: string, description?: string, place?: string, cover?: string, factions?: Faction[] }} WorldFields
 */

/**
 * The canon sheet (사연, `canon-sheet-1`): who the fighter is, in his owner's words. Every field is optional; a sheet has at least one.
 * personality 성격, voice 말투, motive 동기, taboos 금기 (what he never does or says), scenes 대표 장면 (moments that show him).
 * Relations are not here: the relation graph holds them (declared ones and those his bouts made).
 * `items`: a list of up to that many texts; `lines`: newlines allowed.
 * @type {Readonly<Record<string, Readonly<{ max: number, lines?: boolean, items?: number }>>>}
 */
export const CANON_FIELDS = Object.freeze({
  personality: Object.freeze({ max: 300, lines: true }),
  voice: Object.freeze({ max: 200 }),
  motive: Object.freeze({ max: 300, lines: true }),
  taboos: Object.freeze({ max: 80, items: 5 }),
  scenes: Object.freeze({ max: 200, items: 3, lines: true }),
});
export const NOTE_KINDS = Object.freeze(['critique', 'proposal', 'review']);
export const RELATION_KINDS = Object.freeze(['rival', 'comrade', 'mentor', 'student']);
export const NOTE_LIMITS = Object.freeze({ body: 1200, remake: 400, evidence: 3 });
export const WORLD_LIMITS = Object.freeze({
  name: 60,
  tagline: 80,
  description: 600,
  place: 60,
  factions: 8,
  factionName: 40,
  factionDescription: 200,
  postTitle: 80,
  postBody: 2000,
});
const BUILTIN = /^[a-z][a-z0-9-]{0,63}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;
// Control characters (newlines too, except where `lines` allows them) and unpaired surrogates never reach the store.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/;
const NEWLINE = /[\n\r\t]/;

/** @type {(code: string, path: string) => Problem} */
const invalid = (code, path) => new Problem(422, code, [{ path }]);
/** @type {(value: unknown) => boolean} */
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A trimmed text of `min`..`max` characters. `lines`: newlines allowed (a post's or note's body). Windows (`\r\n`) and old Mac (`\r`)
 * line ends are `\n`: a carriage return is a control character, and a multi-line text from Windows was refused (API 점검 2026-10-29).
 * @param {unknown} value
 * @param {number} max
 * @param {string} path
 * @param {{ min?: number, lines?: boolean, code?: string }} [options]
 * @returns {string}
 */
export function text(value, max, path, { min = 1, lines = false, code = 'invalid-text' } = {}) {
  if (typeof value !== 'string' || !value.isWellFormed()) throw invalid(code, path);
  const trimmed = value.replace(/\r\n?/g, '\n').trim(),
    length = [...trimmed].length;
  if (length < min || length > max || CONTROL.test(trimmed) || (!lines && NEWLINE.test(trimmed))) throw invalid(code, path);
  return trimmed;
}

/** @param {string} name  A key of CANON_FIELDS. @param {unknown} value @param {string} path */
function field(name, value, path) {
  const rule = CANON_FIELDS[name];
  const lines = rule.lines === true;
  if (!rule.items) return text(value, rule.max, path, { lines, code: 'invalid-canon' });
  if (!Array.isArray(value) || value.length < 1 || value.length > rule.items) throw invalid('invalid-canon', path);
  return value.map((item, i) => text(item, rule.max, `${path}/${i}`, { lines, code: 'invalid-canon' }));
}

/**
 * A whole sheet: known fields only, at least one.
 * @param {any} value  Unchecked: this checks it.
 * @param {string} [path]
 */
export function canonSheet(value, path = '/sheet') {
  if (!isObject(value)) throw invalid('invalid-canon', path);
  const keys = Object.keys(value);
  if (!keys.length || keys.some(key => !Object.hasOwn(CANON_FIELDS, key))) throw invalid('invalid-canon', path);
  return Object.fromEntries(
    Object.keys(CANON_FIELDS)
      .filter(key => key in value)
      .map(key => [key, field(key, value[key], `${path}/${key}`)]),
  );
}

/**
 * A proposal's canon change: known fields, each a new value or null (remove it).
 * @param {any} value  Unchecked: this checks it.
 * @param {string} [path]
 */
export function canonPatch(value, path = '/proposal/canon') {
  if (!isObject(value) || !Object.keys(value).length || Object.keys(value).some(key => !Object.hasOwn(CANON_FIELDS, key)))
    throw invalid('invalid-proposal', path);
  return Object.fromEntries(
    Object.keys(CANON_FIELDS)
      .filter(key => key in value)
      .map(key => [key, value[key] === null ? null : field(key, value[key], `${path}/${key}`)]),
  );
}

/** @type {(value: unknown) => boolean} */
const fighterId = value => typeof value === 'string' && (UUID.test(value) || BUILTIN.test(value));

/**
 * Bouts a note points at: a cup bout (`cup`, `round` 0-3, `slot` within the round) or a pairing and seed (a spar or a replay link).
 * @param {any} value  Unchecked: this checks it.
 * @param {string} [path]
 * @returns {Evidence[]}
 */
export function evidence(value, path = '/evidence') {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > NOTE_LIMITS.evidence) throw invalid('invalid-evidence', path);
  return value.map((item, i) => {
    const at = `${path}/${i}`;
    if (!isObject(item)) throw invalid('invalid-evidence', at);
    const keys = Object.keys(item).sort().join(',');
    if (keys === 'cup,round,slot') {
      if (
        !UUID.test(item.cup) ||
        !Number.isInteger(item.round) ||
        item.round < 0 ||
        item.round > 3 ||
        !Number.isInteger(item.slot) ||
        item.slot < 0 ||
        item.slot >= 8 >> item.round
      )
        throw invalid('invalid-evidence', at);
      return { cup: item.cup.toLowerCase(), round: item.round, slot: item.slot };
    }
    if (keys === 'a,b,seed') {
      // A registered fighter's id is stored as the site reads ids: lower case.
      const a = UUID.test(item.a ?? '') ? item.a.toLowerCase() : item.a,
        b = UUID.test(item.b ?? '') ? item.b.toLowerCase() : item.b;
      if (!fighterId(a) || !fighterId(b) || a === b || !Number.isInteger(item.seed) || item.seed < 0 || item.seed > 0xffffffff)
        throw invalid('invalid-evidence', at);
      return { a, b, seed: item.seed };
    }
    throw invalid('invalid-evidence', at);
  });
}

/**
 * A proposal: canon fields, a fighting style (an object replaces it, null removes it — checked against his package by the caller) and a remake request.
 * @param {any} value  Unchecked: this checks it.
 * @param {string} [path]
 * @returns {Proposal}
 */
export function proposal(value, path = '/proposal') {
  if (!isObject(value) || !Object.keys(value).length || Object.keys(value).some(key => !['canon', 'style', 'remake'].includes(key)))
    throw invalid('invalid-proposal', path);
  const out = {};
  if (value.canon !== undefined) out.canon = canonPatch(value.canon, `${path}/canon`);
  if (value.style !== undefined) {
    if (value.style !== null && !isObject(value.style)) throw invalid('invalid-proposal', `${path}/style`);
    out.style = value.style;
  }
  if (value.remake !== undefined) out.remake = text(value.remake, NOTE_LIMITS.remake, `${path}/remake`, { min: 2, lines: true, code: 'invalid-proposal' });
  return out;
}

/**
 * A note: its kind, body, evidence (a review points at one bout or more) and, for a proposal only, the proposal.
 * @param {any} body  Unchecked: this checks it.
 */
export function note(body) {
  if (
    !isObject(body) ||
    Object.keys(body).some(key => !['fighter', 'kind', 'body', 'evidence', 'proposal'].includes(key)) ||
    !UUID.test(body.fighter ?? '') ||
    !NOTE_KINDS.includes(body.kind)
  )
    throw invalid('invalid-note', '/');
  /** @type {Note} */
  const out = {
    fighter: body.fighter.toLowerCase(),
    kind: body.kind,
    body: text(body.body, NOTE_LIMITS.body, '/body', { min: 2, lines: true, code: 'invalid-note' }),
    evidence: evidence(body.evidence),
  };
  if (body.kind === 'review' && !out.evidence.length) throw invalid('invalid-evidence', '/evidence');
  if ((body.kind === 'proposal') !== (body.proposal !== undefined)) throw invalid('invalid-proposal', '/proposal');
  if (body.kind === 'proposal') out.proposal = proposal(body.proposal);
  return out;
}

/** @type {(value: unknown) => string} */
export const nickname = value => text(value, 16, '/nickname', { min: 2, code: 'invalid-nickname' });

/**
 * A world's text fields (`partial`: only those given).
 * @param {any} body  Unchecked: this checks it.
 * @param {{ partial?: boolean }} [options]
 */
export function worldText(body, { partial = false } = {}) {
  /** @type {WorldFields} */
  const out = {};
  for (const [key, max, min] of /** @type {['name' | 'tagline' | 'description' | 'place', number, number][]} */ ([
    ['name', WORLD_LIMITS.name, 1],
    ['tagline', WORLD_LIMITS.tagline, 0],
    ['description', WORLD_LIMITS.description, 0],
    ['place', WORLD_LIMITS.place, 0],
  ])) {
    if (body[key] === undefined) {
      if (!partial && key === 'name') throw invalid('invalid-world', `/${key}`);
      continue;
    }
    if (min === 0 && typeof body[key] === 'string' && body[key].trim() === '') {
      out[key] = '';
      continue;
    }
    out[key] = text(body[key], max, `/${key}`, { min, lines: key === 'description', code: 'invalid-world' });
  }
  return out;
}

/**
 * A world's factions (진영): at most eight, ids unique.
 * @param {any} value  Unchecked: this checks it.
 * @param {string} [path]
 * @returns {Faction[]}
 */
export function factions(value, path = '/factions') {
  if (!Array.isArray(value) || value.length > WORLD_LIMITS.factions) throw invalid('invalid-world', path);
  const seen = new Set();
  return value.map((item, i) => {
    const at = `${path}/${i}`;
    if (!isObject(item) || Object.keys(item).some(key => !['id', 'name', 'description'].includes(key)) || !SLUG.test(item.id ?? '') || seen.has(item.id))
      throw invalid('invalid-world', at);
    seen.add(item.id);
    return {
      id: item.id,
      name: text(item.name, WORLD_LIMITS.factionName, `${at}/name`, { code: 'invalid-world' }),
      ...(item.description ? { description: text(item.description, WORLD_LIMITS.factionDescription, `${at}/description`, { code: 'invalid-world' }) } : {}),
    };
  });
}

/**
 * The covers a world opened by a creator may wear (`/art/worlds/open/<id>.webp`, generated art shipped with the site, 2026-10-27).
 * Operator worlds keep their own cover. The first is the default.
 */
export const WORLD_COVERS = Object.freeze(['neon-city', 'sky-isles', 'mushroom-wood', 'deep-sea', 'desert-ruins', 'star-station', 'snow-dojo', 'spooky-fair']);
/** @type {(id: string) => string} */
export const worldCover = id => `/art/worlds/open/${id}.webp`;

/** @type {(value: unknown) => boolean} */
export const worldId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/.test(value);
/** @type {(value: unknown) => boolean} */
export const factionId = value => typeof value === 'string' && SLUG.test(value);
