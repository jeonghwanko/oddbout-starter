// @ts-check
// A bout's browser link and the X caption an assistant may post (2026-11-13). The arena's own page
// (`oddbout-arena-engine` arenaBoutPageUrl) is null for two registered fighters: its link shape allows
// only one UUID. This fills that gap with the same query the game already parses for a shared bout
// (`play=1`, `fighter`, `opponent`, `bout`, `rules`, `d`). The game still has to accept two registered
// corners before that URL plays; see docs/BOUT-VIDEO.md. Nothing here calls the arena or X.
/** X's composer with the caption filled in. The same query as scripts/social/budget.mjs `intentUrl`. @param {string} text @param {string[]} hashtags */
function intentUrl(text, hashtags) {
  const params = new URLSearchParams({ text, hashtags: hashtags.join(',') });
  return `https://x.com/intent/post?${params}`;
}

/** The game page a shared bout opens. Cloudflare keeps the query when it canonicalises `.html`. */
export const BOUT_PAGE = 'https://oddbout.com/fighter.html';

const FIGHTER_ID = /^[a-z0-9-]{1,64}$/;
const DIGEST = /^[a-f0-9]{8}$/;

/**
 * Two whole staminas 0..100, or null. The game reads them as `st=a-b`.
 * @param {unknown} value
 * @returns {readonly [number, number] | null}
 */
export function staminaPair(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [a, b] = value;
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > 100 || b > 100) return null;
  return [a, b];
}

/**
 * The page that plays this pair and seed from the first step. Null when the ids or the seed are not a bout link.
 * Two registered ids are allowed: the arena withholds that link, and the game must still honour it (docs/BOUT-VIDEO.md).
 * @param {{ a: string, b: string, seed: number, rules?: number | null, digest?: string | null, stamina?: readonly [number, number] | null,
 *   locale?: string, base?: string }} bout
 */
export function boutPlaybackUrl(bout) {
  const { a, b, seed } = bout;
  if (typeof a !== 'string' || typeof b !== 'string' || !FIGHTER_ID.test(a) || !FIGHTER_ID.test(b) || a === b) return null;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
  const locale = bout.locale ?? 'ko';
  if (locale !== 'ko' && locale !== 'en' && locale !== 'ja') return null;
  const query = new URLSearchParams({ lang: locale, play: '1', fighter: a, opponent: b, bout: String(seed) });
  if (Number.isInteger(bout.rules) && /** @type {number} */ (bout.rules) >= 0 && /** @type {number} */ (bout.rules) <= 9999)
    query.set('rules', String(bout.rules));
  if (typeof bout.digest === 'string' && DIGEST.test(bout.digest)) query.set('d', bout.digest);
  const stamina = staminaPair(bout.stamina);
  if (stamina) query.set('st', `${stamina[0]}-${stamina[1]}`);
  return `${bout.base ?? BOUT_PAGE}?${query}`;
}

/** @param {number | null | undefined} ms The engine's `record.ms`: milliseconds when it is at least 1000, otherwise seconds. */
export function boutSeconds(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  const seconds = ms >= 1000 ? ms / 1000 : ms;
  return Math.round(seconds * 10) / 10;
}

/** A Hangul syllable with a batchim. Latin and a syllable with none are false. @param {string} word */
function batchim(word) {
  const code = [...word].at(-1)?.codePointAt(0) ?? 0;
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
}

/** Korean subject particle. A Hangul syllable with no batchim takes 가. @param {string} name */
function subject(name) {
  return batchim(name) ? '이' : '가';
}

const HOW = new Map([
  ['ko', 'KO'],
  ['decision', '판정'],
  ['time', '시간 종료'],
  ['draw', '무승부'],
]);

/**
 * Suggested post text. The playback link is not in it: X puts a link in the first reply (`share.reply`).
 * @param {readonly [string, string]} names @param {{ winner?: number, how?: string, ms?: number }} record
 */
export function boutCaption(names, record) {
  const [left, right] = names;
  const winner = record.winner === 0 ? left : record.winner === 1 ? right : null;
  const how = typeof record.how === 'string' ? (HOW.get(record.how) ?? (record.how.length <= 24 ? record.how : null)) : null;
  const seconds = boutSeconds(record.ms);
  const time = seconds === null ? '' : `${seconds}초 `;
  if (winner && how) return `${left} 대 ${right}. ${winner}${subject(winner)} ${time}${how}${batchim(how) ? '으로' : '로'} 이겼다.`;
  if (winner) return `${left} 대 ${right}. ${winner}${subject(winner)} 이겼다.`;
  return `${left} 대 ${right}.`;
}

/** @param {any} result */
function namesOf(result) {
  const fighters = Array.isArray(result.fighters) ? result.fighters : [];
  const left = (typeof fighters[0]?.name === 'string' && fighters[0].name) || result.a;
  const right = (typeof fighters[1]?.name === 'string' && fighters[1].name) || result.b;
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return null;
  return /** @type {readonly [string, string]} */ ([left, right]);
}

/**
 * Caption, intent URL and the reply link for a bout the arena already fought. Null when there is nothing to share.
 * `postsToX` is false: the assistant posts with the user's own X connection.
 * @param {any} result @param {string | null} page
 */
export function boutShareText(result, page) {
  const names = namesOf(result);
  const link = page ?? (typeof result.page === 'string' ? result.page : null);
  if (!names && !link) return null;
  const caption =
    names && result.record && typeof result.record === 'object' ? boutCaption(names, result.record) : names ? `${names[0]} 대 ${names[1]}.` : null;
  return {
    page: link,
    caption,
    ...(caption ? { intent: intentUrl(caption, ['ODDBOUT']) } : {}),
    reply: link,
    postsToX: false,
  };
}

/**
 * The arena answer plus a playback page when it withheld one, and `share` (caption, intent, reply).
 * A page the arena already returned is kept. A failed answer is unchanged.
 * @param {any} result @param {string} [locale]
 */
export function attachBoutShare(result, locale = 'ko') {
  if (result?.ok !== true || typeof result.a !== 'string' || typeof result.b !== 'string' || !Number.isInteger(result.seed)) return result;
  const built = boutPlaybackUrl({
    a: result.a,
    b: result.b,
    seed: result.seed,
    rules: result.rules,
    digest: result.record?.digest,
    stamina: staminaPair(result.stamina) ?? staminaPair(result.record?.stamina),
    locale,
  });
  const page = typeof result.page === 'string' && result.page ? result.page : built;
  const share = boutShareText(result, page);
  if (!share && page === result.page) return result;
  return { ...result, ...(page && result.page !== page ? { page } : {}), ...(share ? { share } : {}) };
}

/**
 * The highlight span to keep, in milliseconds, or null when the record has no times.
 * Highlight times use the same unit as `record.ms`.
 * @param {any} record @param {number} [padMs]
 * @returns {{ startMs: number, endMs: number } | null}
 */
export function highlightWindow(record, padMs = 1000) {
  const raw = Array.isArray(record?.highlights) ? record.highlights : [];
  /** @type {number[]} */
  const times = [];
  for (const mark of raw) {
    const value = typeof mark === 'number' ? mark : (mark?.ms ?? mark?.t ?? mark?.at);
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) times.push(value);
  }
  if (!times.length) return null;
  const end = typeof record.ms === 'number' && record.ms >= Math.max(...times) ? record.ms : Math.max(...times);
  return { startMs: Math.max(0, Math.min(...times) - padMs), endMs: end + 1500 };
}
