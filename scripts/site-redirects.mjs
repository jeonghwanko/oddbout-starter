// @ts-check
// Reviewed redirects for the published site (oddbout.com). The table is checked in here, never taken from the site archive:
// a publication cannot add its own routing. `stagePublicApi` (cloudflare-publication.mjs) writes the active rules to `_redirects`.
//
// A rule is active only when the build has moved the page: the target is published and the old page is not. While the old page
// is still published and the target is not, the rule waits — so this table can merge before or after the game commit that moves
// the page. Both published, or neither, is a mistake and stops the publication.
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const SITE_REDIRECTS_FILE = new URL('../deploy/site-redirects.json', import.meta.url);
/** Cloudflare Pages accepts 2,000 static rules; stay far below. */
const MAX_RULES = 500;
const STATUSES = new Set([301, 308]);
/** A site path: `/`-separated segments of letters, digits, `.`, `_`, `-` — no query, anchor, wildcard, placeholder or `..`. */
const PATH = /^\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*(?:[A-Za-z0-9_-][A-Za-z0-9._-]*)?$/;

/** @typedef {{ from: string, to: string, status: number }} SiteRedirect */

/**
 * The table, checked: paths, statuses, no duplicate source, no rule that leads to another rule's source.
 * @param {unknown} table @returns {SiteRedirect[]}
 */
export function validateSiteRedirects(table) {
  const list = /** @type {{ redirects?: unknown }} */ (table)?.redirects;
  if (!Array.isArray(list)) throw Error('site-redirects: "redirects" must be an array');
  if (list.length > MAX_RULES) throw Error(`site-redirects: more than ${MAX_RULES} rules`);
  /** @type {SiteRedirect[]} */
  const rules = [];
  for (const entry of list) {
    const { from, to, status = 301 } = /** @type {Record<string, unknown>} */ (entry ?? {});
    for (const path of [from, to])
      if (typeof path !== 'string' || !PATH.test(path) || path.split('/').includes('..')) throw Error(`site-redirects: bad path ${JSON.stringify(path)}`);
    if (typeof status !== 'number' || !STATUSES.has(status)) throw Error(`site-redirects: ${from} needs status 301 or 308`);
    if (from === to) throw Error(`site-redirects: ${from} redirects to itself`);
    if (/** @type {string} */ (to).endsWith('.html')) throw Error(`site-redirects: ${to} — Pages answers .html with a second redirect; name the clean address`);
    if (/(?:^|\/)index\.html$/.test(/** @type {string} */ (from))) throw Error(`site-redirects: ${from} — redirect the folder, not index.html`);
    rules.push({ from: /** @type {string} */ (from), to: /** @type {string} */ (to), status });
  }
  const sources = new Set();
  for (const rule of rules) {
    for (const source of sourcesOf(rule.from)) {
      if (sources.has(source)) throw Error(`site-redirects: ${source} appears twice`);
      sources.add(source);
    }
  }
  for (const rule of rules) if (sources.has(rule.to)) throw Error(`site-redirects: ${rule.from} → ${rule.to} leads to another redirect`);
  return rules;
}

/**
 * Every spelling an old page answered to: Pages serves `/x.html` also as `/x`, and a folder `/x/` also as `/x` (it redirected there while
 * the folder had its page). Both go to the new address in one step.
 */
function sourcesOf(/** @type {string} */ from) {
  if (from.endsWith('.html')) return [from, from.slice(0, -'.html'.length)];
  return from.length > 1 && from.endsWith('/') ? [from, from.slice(0, -1)] : [from];
}

/** The files Pages would answer `path` with. */
function candidates(/** @type {string} */ path) {
  const relative = path.slice(1);
  if (path.endsWith('/')) return [relative + 'index.html'];
  if (path.endsWith('.html')) return [relative];
  return [relative + '.html', relative + '/index.html'];
}

async function published(/** @type {string} */ site, /** @type {string} */ path) {
  for (const file of candidates(path)) if ((await lstat(join(site, file)).catch(() => null))?.isFile()) return true;
  return false;
}

/**
 * The rules this build activates, and the ones still waiting for the game to move their page.
 * @param {string} site @param {SiteRedirect[]} rules
 * @returns {Promise<{ active: SiteRedirect[], pending: SiteRedirect[] }>}
 */
export async function siteRedirectState(site, rules) {
  /** @type {SiteRedirect[]} */
  const active = [],
    pending = [];
  for (const rule of rules) {
    const [target, old] = [await published(site, rule.to), await published(site, rule.from)];
    if (target && !old) active.push(rule);
    else if (!target && old) pending.push(rule);
    else if (target) throw Error(`site-redirects: the build still publishes ${rule.from} beside ${rule.to}; remove the old page or the rule`);
    else throw Error(`site-redirects: neither ${rule.from} nor ${rule.to} is published`);
  }
  return { active, pending };
}

/** `_redirects` lines for the active rules, each `.html` source in both spellings. */
export function siteRedirectLines(/** @type {SiteRedirect[]} */ active) {
  return active.flatMap(rule => sourcesOf(rule.from).map(source => `${source} ${rule.to} ${rule.status}`));
}

/** The checked-in table. */
export async function loadSiteRedirects(file = SITE_REDIRECTS_FILE) {
  return validateSiteRedirects(JSON.parse(await readFile(file, 'utf8')));
}

/**
 * After a deployment: every active rule answers with its status and target, and keeps the query (`?lang=` chooses the language).
 * @param {string | URL} base @param {SiteRedirect[]} active @param {typeof fetch} [request]
 */
export async function verifySiteRedirects(base, active, request = fetch) {
  for (const rule of active) {
    for (const source of sourcesOf(rule.from)) {
      const url = new URL(source.slice(1) + '?lang=ko', base);
      const response = await request(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      const location = response.headers.get('location');
      await response.body?.cancel();
      const target = location ? new URL(location, url) : null;
      if (response.status !== rule.status || target?.pathname !== rule.to || target.search !== '?lang=ko')
        throw Error(`site-redirects: ${source} answered ${response.status} ${location ?? '(no location)'}, expected ${rule.status} ${rule.to}?lang=ko`);
    }
  }
}

/**
 * The rules production does not answer yet. A rule production already serves was checked when it first went live; a new one has not
 * been seen on a real Pages deployment. A request that fails counts as not live.
 * @param {string | URL} base @param {SiteRedirect[]} active @param {typeof fetch} [request] @returns {Promise<SiteRedirect[]>}
 */
export async function redirectsNotLive(base, active, request = fetch) {
  /** @type {SiteRedirect[]} */
  const fresh = [];
  for (const rule of active) await verifySiteRedirects(base, [rule], request).catch(() => fresh.push(rule));
  return fresh;
}

/** Where this machine keeps the rules a preview deployment has verified (`ODDBOUT_REDIRECT_PREVIEWS` overrides). */
export const previewedRedirectsFile = () => process.env.ODDBOUT_REDIRECT_PREVIEWS || join(homedir(), '.local', 'state', 'oddbout', 'redirect-previews.json');

async function previewed(/** @type {string} */ file) {
  const saved = JSON.parse(await readFile(file, 'utf8').catch(() => '{"rules":[]}'));
  return new Set(Array.isArray(saved.rules) ? saved.rules.filter((/** @type {unknown} */ rule) => typeof rule === 'string') : []);
}

/**
 * After a preview deployment answered every active rule (verifySiteRedirects): remember them, so production may turn them on.
 * @param {SiteRedirect[]} active @param {string} [file]
 */
export async function recordPreviewedRedirects(active, file = previewedRedirectsFile()) {
  const rules = await previewed(file);
  for (const line of siteRedirectLines(active)) rules.add(line);
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ rules: [...rules].sort(), updatedAt: new Date().toISOString() }, null, 2) + '\n');
  await rename(temporary, file);
}

/**
 * A production upload that turns on rules production does not serve yet needs a preview that verified them first: Pages could drop the
 * query (`?lang=`, `?character=`) or let a static file win, and the after-upload check runs once production is already public.
 * @param {SiteRedirect[]} fresh @param {string} [file]
 */
export async function assertRedirectsPreviewed(fresh, file = previewedRedirectsFile()) {
  const rules = await previewed(file);
  const missing = siteRedirectLines(fresh).filter(line => !rules.has(line));
  if (missing.length)
    throw Error(
      `site-redirects: ${missing.length} new redirect(s) were never verified on a preview deployment (${missing[0]} …). ` +
        'Run `npm run site:republish -- <publication sha> --preview` first, then publish again.',
    );
}
