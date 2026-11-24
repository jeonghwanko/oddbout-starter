// @ts-check
// Game sites (docs/CREATOR-HOSTING.md#game-sites): Legendary Forge at forge.oddbout.com, Pudding Escape at pudding.oddbout.com and
// Bounce Ball at bounce.oddbout.com, each its
// own Cloudflare Pages project, built and published apart from the ODDBOUT site. The game repository owns the package
// (kaito_web/tools/deploy/game-package.mjs, `buildGamePackage`) and the guards before a publish (`npm run publish:game`); this repository
// owns what a game site adds to the package (Analytics, deployment.json), the upload and its checks.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertSameRevision, buildRevision, fingerprint, hosting } from './hosting-lib.mjs';
import { googleAnalyticsPlugin } from './site-analytics.mjs';

/** The games with a site. The name is the Pages project's suffix (`oddbout-<game>`) and the key in the game's `game-sites.json`. */
export const GAME_SITES = Object.freeze(['forge', 'pudding', 'bounce', 'bouceball']);
/**
 * Each game site's pages. `entry` is the page that serves the game (the game package's `entry`). `home: 'entry'` means `index.html` is a
 * copy of it (the game opens at `/`); `home: 'intro'` means `index.html` is an intro page that links to the game (bounce: `/` intro,
 * `/game` game).
 * @type {Readonly<Record<string, Readonly<{ entry: string, home: 'entry' | 'intro' }>>>}
 */
export const GAME_SITE_PAGES = Object.freeze({
  forge: Object.freeze({ entry: 'forge.html', home: 'entry' }),
  pudding: Object.freeze({ entry: 'pudding.html', home: 'entry' }),
  bounce: Object.freeze({ entry: 'game.html', home: 'intro' }),
  bouceball: Object.freeze({ entry: 'bouceball.html', home: 'entry' }),
});
/** The Pages branch of `--preview` uploads (`preview.oddbout-<game>.pages.dev`); production is `main`. */
export const GAME_PREVIEW_BRANCH = 'preview';
export const GAME_PRODUCTION_BRANCH = 'main';
/** Hosts the ODDBOUT site moved away from; a game site must not depend on them. */
const OLD_HOSTS = ['rupin.pryzm.gg', 'findthem'];
const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const CONSENT_MARKER = 'data-oddbout-consent-defaults';

export const buildGameSiteUsage = `Usage: node scripts/build-game-site.mjs <kaito_web> <${GAME_SITES.join('|')}> <empty-output-directory>`;
export const publishGameSiteUsage = `Usage: node scripts/publish-game-site.mjs <${GAME_SITES.join('|')}> <built-directory> [--dry-run] [--preview]`;

/** @param {string} game */
export const gameProject = game => `oddbout-${game}`;

/** @param {unknown} game @returns {asserts game is string} */
function assertGame(game, usage = `Unknown game: ${String(game)}`) {
  if (typeof game !== 'string' || !GAME_SITES.includes(game)) throw new Error(usage);
}

/** @param {string[]} argv */
export function parseBuildGameSiteArgs(argv) {
  const [source, game, output, ...extra] = argv;
  if (!source || !output || extra.length) throw new Error(buildGameSiteUsage);
  assertGame(game, buildGameSiteUsage);
  return { source: resolve(source), game, output: resolve(output) };
}

/** @param {string[]} argv */
export function parsePublishGameSiteArgs(argv) {
  const [game, output, ...flags] = argv;
  if (!output || flags.some(flag => !['--dry-run', '--preview'].includes(flag)) || new Set(flags).size !== flags.length) {
    throw new Error(publishGameSiteUsage);
  }
  assertGame(game, publishGameSiteUsage);
  return { game, output: resolve(output), dryRun: flags.includes('--dry-run'), preview: flags.includes('--preview') };
}

/** An `https://<host>` origin, without a path, query or trailing slash. @param {unknown} value @param {string} label */
function assertOrigin(value, label) {
  if (typeof value !== 'string' || !/^https:\/\/[a-z0-9.-]+$/.test(value) || new URL(value).origin !== value) {
    throw new Error(`${label} must be an https origin without a path: ${String(value)}`);
  }
  return value;
}

/** The game's origin from the game repository's `src/platform/game-sites.json`. @param {unknown} sites @param {string} game */
export function gameSiteOrigin(sites, game) {
  assertGame(game);
  const entry = sites && typeof sites === 'object' && Object.hasOwn(sites, game) ? /** @type {Record<string, any>} */ (sites)[game] : null;
  return assertOrigin(entry?.origin, `game-sites.json ${game}.origin`);
}

/**
 * The upload's target from the environment `npm run publish:game` passes: `CLOUDFLARE_ACCOUNT_ID`, `ODDBOUT_GAME_ORIGIN` and, for an
 * upload, `CLOUDFLARE_API_TOKEN` (checked by the caller before uploading, so a dry run needs none).
 * @param {NodeJS.ProcessEnv} env @param {{ game: string, preview: boolean }} options
 */
export function gamePublicationTarget(env, { game, preview }) {
  assertGame(game);
  const account = env.CLOUDFLARE_ACCOUNT_ID ?? '';
  if (!/^[a-f0-9]{32}$/.test(account)) throw new Error('CLOUDFLARE_ACCOUNT_ID must be the 32-character Cloudflare account ID');
  const origin = assertOrigin(env.ODDBOUT_GAME_ORIGIN, 'ODDBOUT_GAME_ORIGIN');
  return {
    account,
    origin,
    project: gameProject(game),
    branch: preview ? GAME_PREVIEW_BRANCH : GAME_PRODUCTION_BRANCH,
    token: typeof env.CLOUDFLARE_API_TOKEN === 'string' && env.CLOUDFLARE_API_TOKEN.trim() !== '',
  };
}

/**
 * The game site's `deployment.json`. Names follow the ODDBOUT site's: `sourceCommit` (the game repository) and `hostingCommit` (this one).
 * The game repository's lineage check and `game:record` read `sourceCommit` and `game` from `https://<game domain>/deployment.json`.
 * @param {{ game: string, origin: string, builtAt: string, revision: { sourceCommit: string, hostingCommit: string },
 *   measured: { digest: string, files: number, bytes: number }, buildId?: string }} options
 */
export function gameSiteRelease({ game, origin, builtAt, revision, measured, buildId = randomUUID() }) {
  return {
    buildId,
    game,
    siteUrl: origin + '/',
    builtAt,
    sourceCommit: revision.sourceCommit,
    hostingCommit: revision.hostingCommit,
    dirty: false,
    ...measured,
  };
}

/**
 * The entry page's tags: the consent defaults the game package adds (kaito_web site-consent-plugin.mjs) are the page's first script, before
 * AdSense (pudding) and the module that loads Analytics. @param {string} html @param {string} file
 */
export function assertConsentFirst(html, file) {
  const first = /<script\b[^>]*>/i.exec(html);
  if (!first?.[0].includes(CONSENT_MARKER)) throw new Error(`The consent defaults must be the first script: ${file}`);
}

/**
 * Checks a built game site: its entry pages, consent defaults, the Analytics tag for the configured measurement ID, no old host, and the
 * `deployment.json` of this game and origin whose fingerprint matches the files. Returns the release.
 * @param {string} root @param {{ game: string, origin: string, measurementId?: string }} options
 */
export async function verifyGameArtifact(root, { game, origin, measurementId = hosting.analyticsMeasurementId }) {
  assertGame(game);
  assertOrigin(origin, 'The game origin');
  const { entry: entryPage, home } = GAME_SITE_PAGES[game];
  const pages = ['index.html', entryPage];
  for (const page of [...pages, 'deployment.json']) {
    if (!(await stat(join(root, page)).catch(() => null))?.isFile()) throw new Error(`Missing game site file: ${page}`);
  }
  const [index, entry] = await Promise.all(pages.map(page => readFile(join(root, page), 'utf8')));
  if (home === 'entry' && index !== entry) throw new Error(`index.html must be the ${entryPage} entry`);
  if (home === 'intro' && index === entry) throw new Error(`index.html must be the intro page, not the ${entryPage} entry`);
  assertConsentFirst(entry, entryPage);
  if (home === 'intro') assertConsentFirst(index, 'index.html');
  const scripts = (await readdir(root, { recursive: true })).map(path => String(path).replaceAll('\\', '/')).filter(path => /\.(?:m?js|html)$/.test(path));
  const loader = 'googletagmanager.com/gtag/js?id=',
    host = new URL(origin).hostname;
  let analytics = false;
  for (const path of scripts) {
    const text = await readFile(join(root, path), 'utf8');
    const old = OLD_HOSTS.find(host => text.includes(host));
    if (old) throw new Error(`Old host dependency found in ${path}: ${old}`);
    // The minifier may requote strings, so look for the bare values: the tag loader, the measurement ID and the host it is bound to.
    if (measurementId && [loader, measurementId, host].every(value => text.includes(value))) analytics = true;
  }
  if (!measurementId || !analytics) throw new Error(`The game site has no Analytics tag for ${measurementId} on ${host}`);
  const release = JSON.parse(await readFile(join(root, 'deployment.json'), 'utf8'));
  if (
    release.game !== game ||
    release.siteUrl !== origin + '/' ||
    release.dirty !== false ||
    !UUID.test(release.buildId ?? '') ||
    !Number.isFinite(Date.parse(release.builtAt)) ||
    !SHA.test(release.sourceCommit ?? '') ||
    !SHA.test(release.hostingCommit ?? '')
  ) {
    throw new Error(`The game site requires clean, committed sources and its own deployment.json (${game}, ${origin}/)`);
  }
  const measured = await fingerprint(root);
  if (measured.digest !== release.digest || measured.files !== release.files || measured.bytes !== release.bytes) {
    throw new Error('Game site changed after build; rebuild before publishing');
  }
  return release;
}

/** The files a game site serves: all of them (Pages reads none of its control files from a game site). @param {string} root */
export async function gameSiteFiles(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter(entry => entry.isFile())
    .map(entry => relative(root, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .sort();
}

/**
 * Builds a game site into an empty folder: the game repository's web package with this repository's Analytics, then `deployment.json`.
 * `revision` reads the commits of clean checkouts (tests replace it).
 * @param {{ source: string, game: string, output: string, hostingRoot?: string, env?: NodeJS.ProcessEnv,
 *   revision?: (source: string, hostingRoot: string) => { sourceCommit: string, hostingCommit: string } }} options
 */
export async function buildGameSite({
  source,
  game,
  output,
  hostingRoot = fileURLToPath(new URL('../', import.meta.url)),
  env = process.env,
  revision = buildRevision,
}) {
  assertGame(game);
  const outside = relative(source, output);
  if (!outside || (!isAbsolute(outside) && outside !== '..' && !outside.startsWith('..\\') && !outside.startsWith('../'))) {
    throw new Error('Output directory must be outside the source tree');
  }
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error('Output directory must be empty');
  const before = revision(source, hostingRoot);
  const builtAt = new Date().toISOString();
  const measurementId = hosting.analyticsMeasurementId;
  if (!measurementId) throw new Error('deploy/creator-site.json has no analyticsMeasurementId');
  const origin = gameSiteOrigin(JSON.parse(await readFile(join(source, 'src/platform/game-sites.json'), 'utf8')), game);
  if (env.ODDBOUT_GAME_ORIGIN !== undefined && env.ODDBOUT_GAME_ORIGIN !== origin) {
    throw new Error(`ODDBOUT_GAME_ORIGIN (${env.ODDBOUT_GAME_ORIGIN}) is not the game's origin in game-sites.json (${origin})`);
  }
  /** @type {{ buildGamePackage: (options: { game: string, portal: string, output: string, plugins?: unknown[] }) => Promise<{ entry: string, origin: string | null }> }} */
  const gamePackage = await import(pathToFileURL(join(source, 'tools/deploy/game-package.mjs')).href);
  const built = await gamePackage.buildGamePackage({
    game,
    portal: 'web',
    output,
    // `game` makes the entry page count as `/` in Analytics; an intro home keeps `/` and the game's own page apart.
    plugins: [googleAnalyticsPlugin(measurementId, origin + '/', null, { game: GAME_SITE_PAGES[game].home === 'entry' ? game : null })],
  });
  const { entry } = GAME_SITE_PAGES[game];
  if (built.origin !== origin || built.entry !== entry) {
    throw new Error(`The game package is not ${entry} at ${origin}: ${built.entry} at ${built.origin}`);
  }
  assertSameRevision(before, revision(source, hostingRoot));
  const release = gameSiteRelease({ game, origin, builtAt, revision: before, measured: await fingerprint(output) });
  await writeFile(join(output, 'deployment.json'), JSON.stringify(release, null, 2) + '\n');
  return verifyGameArtifact(output, { game, origin, measurementId });
}

/**
 * What the game's domain answers for the published release: `live` (this build), `stale` (another build of this game) or `unreadable`
 * (no domain yet, not a game site, an error page). Another game's deployment.json means the domain points at the wrong project.
 * @param {any} body @param {{ game: string, buildId: string, sourceCommit: string }} release
 */
export function gameOriginVerdict(body, release) {
  if (!body || typeof body !== 'object' || typeof body.sourceCommit !== 'string' || !SHA.test(body.sourceCommit)) return 'unreadable';
  if (body.game !== release.game) throw new Error(`The domain serves ${JSON.stringify(body.game)}'s deployment.json, not ${release.game}'s`);
  return body.buildId === release.buildId && body.sourceCommit === release.sourceCommit ? 'live' : 'stale';
}

/**
 * After a production upload, reads `<origin>/deployment.json` until it is this build. An unreadable answer (the custom domain is not
 * attached yet) ends with `no-domain` and what to do; another build still served after `timeoutMs` is an error.
 * @param {string} origin @param {{ game: string, buildId: string, sourceCommit: string }} release
 * @param {{ request?: typeof fetch, timeoutMs?: number, intervalMs?: number, unreadableAttempts?: number,
 *   wait?: (ms: number) => Promise<unknown>, now?: () => number }} [options]
 * @returns {Promise<{ status: 'live' | 'no-domain', message: string }>}
 */
export async function checkGameOrigin(
  origin,
  release,
  {
    request = fetch,
    timeoutMs = 5 * 60_000,
    intervalMs = 15_000,
    unreadableAttempts = 3,
    wait = ms => new Promise(done => setTimeout(done, ms)),
    now = Date.now,
  } = {},
) {
  const url = `${origin}/deployment.json`;
  const deadline = now() + timeoutMs;
  let unreadable = 0;
  for (;;) {
    const response = await request(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) }).catch(() => null);
    const body = response?.ok ? await response.json().catch(() => null) : null;
    if (response && !response.ok) await response.body?.cancel().catch(() => {});
    const verdict = gameOriginVerdict(body, release);
    if (verdict === 'live') return { status: 'live', message: `${url} serves ${release.sourceCommit.slice(0, 12)}` };
    if (verdict === 'unreadable' && ++unreadable >= unreadableAttempts) {
      return {
        status: 'no-domain',
        message:
          `${url} did not answer with a game deployment.json. If ${new URL(origin).hostname} is not yet a custom domain of the Cloudflare Pages ` +
          `project ${gameProject(release.game)}, attach it, then check that ${url} shows sourceCommit ${release.sourceCommit} ` +
          "(the game repository's `npm run game:record` reads it).",
      };
    }
    if (now() >= deadline) throw new Error(`${url} still serves another build (${body?.sourceCommit ?? 'unknown'}); check the Pages project's domains`);
    await wait(verdict === 'unreadable' ? 5_000 : intervalMs);
  }
}
