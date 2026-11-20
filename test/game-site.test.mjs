import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  assertConsentFirst,
  buildGameSite,
  checkGameOrigin,
  GAME_SITE_PAGES,
  gameOriginVerdict,
  gameProject,
  gamePublicationTarget,
  gameSiteFiles,
  gameSiteOrigin,
  gameSiteRelease,
  parseBuildGameSiteArgs,
  parsePublishGameSiteArgs,
  verifyGameArtifact,
} from '../scripts/game-site.mjs';
import { fingerprint, hosting, verifyServedFiles } from '../scripts/hosting-lib.mjs';
import { cloudflareFetch } from '../scripts/site-publication.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const origin = 'https://forge.oddbout.com';
const revision = { sourceCommit: 'a'.repeat(40), hostingCommit: 'b'.repeat(40) };
const consent = '<script data-oddbout-consent-defaults>window.dataLayer=window.dataLayer||[];</script>';
const page = `<!doctype html><html><head>${consent}<script type="module" src="./assets/forge.js"></script></head><body></body></html>`;

/** A built forge site: the entry pages, the analytics module and its deployment.json. */
async function forgeSite(files = {}) {
  const site = await mkdtemp(join(tmpdir(), 'game-site-test-'));
  await mkdir(join(site, 'assets'));
  const contents = {
    'index.html': page,
    'forge.html': page,
    'assets/forge.js': `(()=>{})(\`${hosting.analyticsMeasurementId}\`,\`forge.oddbout.com\`,null,[],\`forge\`);"https://www.googletagmanager.com/gtag/js?id="`,
    'art/forge/ore-1.webp': 'RIFF',
    ...files,
  };
  for (const [path, text] of Object.entries(contents)) {
    await mkdir(join(site, path, '..'), { recursive: true });
    await writeFile(join(site, path), text);
  }
  const release = gameSiteRelease({ game: 'forge', origin, builtAt: '2026-11-19T00:00:00.000Z', revision, measured: await fingerprint(site) });
  await writeFile(join(site, 'deployment.json'), JSON.stringify(release, null, 2) + '\n');
  return { site, release };
}

test('game site arguments, project names and origins', () => {
  assert.deepEqual(parseBuildGameSiteArgs(['/src/kaito_web', 'forge', '/tmp/out']), { source: '/src/kaito_web', game: 'forge', output: '/tmp/out' });
  for (const argv of [
    ['/src', 'fighter', '/out'],
    ['/src', 'forge'],
    ['/src', 'forge', '/out', '--extra'],
  ]) {
    assert.throws(() => parseBuildGameSiteArgs(argv), /Usage: node scripts\/build-game-site\.mjs/);
  }
  assert.deepEqual(parsePublishGameSiteArgs(['pudding', '/out', '--preview', '--dry-run']), { game: 'pudding', output: '/out', dryRun: true, preview: true });
  for (const argv of [['pudding'], ['oddbout', '/out'], ['forge', '/out', '--skip-gate'], ['forge', '/out', '--preview', '--preview']]) {
    assert.throws(() => parsePublishGameSiteArgs(argv), /Usage: node scripts\/publish-game-site\.mjs/);
  }
  assert.equal(gameProject('forge'), 'oddbout-forge');
  assert.equal(gameSiteOrigin({ forge: { origin, live: false } }, 'forge'), origin);
  for (const sites of [{}, { forge: { origin: 'http://forge.oddbout.com' } }, { forge: { origin: origin + '/' } }, { forge: { origin: origin + '/x' } }]) {
    assert.throws(() => gameSiteOrigin(sites, 'forge'), /https origin/);
  }
});

test('the publication target comes from the environment publish:game passes', () => {
  const env = { CLOUDFLARE_ACCOUNT_ID: 'c'.repeat(32), ODDBOUT_GAME_ORIGIN: origin };
  assert.deepEqual(gamePublicationTarget(env, { game: 'forge', preview: false }), {
    account: 'c'.repeat(32),
    origin,
    project: 'oddbout-forge',
    branch: 'main',
    token: false,
  });
  const preview = gamePublicationTarget({ ...env, CLOUDFLARE_API_TOKEN: 'token' }, { game: 'forge', preview: true });
  assert.equal(preview.branch, 'preview');
  assert.equal(preview.token, true);
  assert.throws(() => gamePublicationTarget({ ODDBOUT_GAME_ORIGIN: origin }, { game: 'forge', preview: false }), /CLOUDFLARE_ACCOUNT_ID/);
  assert.throws(() => gamePublicationTarget({ ...env, ODDBOUT_GAME_ORIGIN: undefined }, { game: 'forge', preview: false }), /ODDBOUT_GAME_ORIGIN/);
});

test('a built game site passes only with its own deployment.json, consent first, Analytics for its host and unchanged files', async t => {
  const { site, release } = await forgeSite();
  t.after(() => rm(site, { recursive: true, force: true }));
  assert.deepEqual(await verifyGameArtifact(site, { game: 'forge', origin }), release);
  assert.equal(release.siteUrl, 'https://forge.oddbout.com/');
  assert.equal(release.game, 'forge');
  assert.deepEqual(await gameSiteFiles(site), ['art/forge/ore-1.webp', 'assets/forge.js', 'deployment.json', 'forge.html', 'index.html']);
  await assert.rejects(verifyGameArtifact(site, { game: 'pudding', origin: 'https://pudding.oddbout.com' }), /Missing game site file: pudding\.html/);
  await assert.rejects(verifyGameArtifact(site, { game: 'forge', origin: 'https://pudding.oddbout.com' }), /no Analytics tag/);
  await assert.rejects(verifyGameArtifact(site, { game: 'forge', origin, measurementId: 'G-OTHER12345' }), /no Analytics tag/);
  await writeFile(join(site, 'art/forge/ore-1.webp'), 'RIFX');
  await assert.rejects(verifyGameArtifact(site, { game: 'forge', origin }), /changed after build/);

  for (const [files, message] of [
    [{ 'index.html': page.replace('</body>', 'x</body>') }, /index\.html must be the forge\.html entry/],
    [{ 'assets/other.js': 'fetch("https://rupin.pryzm.gg/")' }, /Old host dependency/],
    [{ 'assets/forge.js': 'console.log(1)' }, /no Analytics tag/],
  ]) {
    const broken = await forgeSite(files);
    await assert.rejects(verifyGameArtifact(broken.site, { game: 'forge', origin }), message);
    await rm(broken.site, { recursive: true, force: true });
  }
  const dirty = await forgeSite();
  await writeFile(join(dirty.site, 'deployment.json'), JSON.stringify({ ...dirty.release, dirty: true }));
  await assert.rejects(verifyGameArtifact(dirty.site, { game: 'forge', origin }), /clean, committed sources/);
  await rm(dirty.site, { recursive: true, force: true });
});

test('bounce: index.html is an intro page and game.html serves the game, both with consent first', async t => {
  const bounceOrigin = 'https://bounce.oddbout.com';
  const intro = `<!doctype html><html><head>${consent}<script type="module" src="./assets/intro.js"></script></head><body><a href="./game">Play</a></body></html>`;
  const game = `<!doctype html><html><head>${consent}<script type="module" src="./assets/game.js"></script></head><body></body></html>`;
  const analytics = `(()=>{})(\`${hosting.analyticsMeasurementId}\`,\`bounce.oddbout.com\`,null,[],null);"https://www.googletagmanager.com/gtag/js?id="`;
  /** @param {Record<string, string>} files */
  async function bounceSite(files = {}) {
    const site = await mkdtemp(join(tmpdir(), 'game-site-test-'));
    for (const [path, text] of Object.entries({ 'index.html': intro, 'game.html': game, 'assets/game.js': analytics, ...files })) {
      await mkdir(join(site, path, '..'), { recursive: true });
      await writeFile(join(site, path), text);
    }
    const release = gameSiteRelease({ game: 'bounce', origin: bounceOrigin, builtAt: '2026-11-20T00:00:00.000Z', revision, measured: await fingerprint(site) });
    await writeFile(join(site, 'deployment.json'), JSON.stringify(release, null, 2) + '\n');
    return { site, release };
  }
  assert.deepEqual(GAME_SITE_PAGES.bounce, { entry: 'game.html', home: 'intro' });
  assert.equal(gameProject('bounce'), 'oddbout-bounce');
  const { site, release } = await bounceSite();
  t.after(() => rm(site, { recursive: true, force: true }));
  assert.deepEqual(await verifyGameArtifact(site, { game: 'bounce', origin: bounceOrigin }), release);
  for (const [files, message] of [
    [{ 'index.html': game }, /index\.html must be the intro page/],
    [{ 'index.html': '<!doctype html><html><head><script src="./assets/intro.js"></script></head></html>' }, /first script: index\.html/],
    [{ 'game.html': '<!doctype html><html><head></head></html>' }, /first script: game\.html/],
  ]) {
    const broken = await bounceSite(files);
    await assert.rejects(verifyGameArtifact(broken.site, { game: 'bounce', origin: bounceOrigin }), message);
    await rm(broken.site, { recursive: true, force: true });
  }
  const noGame = await bounceSite();
  await rm(join(noGame.site, 'game.html'));
  await assert.rejects(verifyGameArtifact(noGame.site, { game: 'bounce', origin: bounceOrigin }), /Missing game site file: game\.html/);
  await rm(noGame.site, { recursive: true, force: true });
});

test('consent defaults must come before AdSense and the Analytics module', () => {
  assertConsentFirst(page, 'forge.html');
  assert.throws(
    () => assertConsentFirst('<head><script async src="https://pagead2.googlesyndication.com/x.js"></script>' + consent, 'pudding.html'),
    /first script/,
  );
  assert.throws(() => assertConsentFirst('<head></head>', 'forge.html'), /first script/);
});

test('a published game site is checked file by file through Cloudflare canonical redirects', async t => {
  const { site } = await forgeSite();
  t.after(() => rm(site, { recursive: true, force: true }));
  const base = 'https://0123abcd.oddbout-forge.pages.dev/';
  const served = new Map();
  for (const file of await gameSiteFiles(site)) served.set('/' + file.replace(/(?:^|\/)index\.html$/, '').replace(/\.html$/, ''), file);
  const types = { html: 'text/html', js: 'application/javascript', json: 'application/json', webp: 'image/webp' };
  let changed = null;
  /** @type {typeof fetch} */
  const request = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('.html') && init?.redirect === 'manual') {
      return new Response(null, { status: 308, headers: { location: url.pathname.replace(/(?:^|\/)index\.html$/, '/').replace(/\.html$/, '') } });
    }
    const file = served.get(url.pathname === '/' ? '/' : url.pathname) ?? (url.pathname === '/' ? 'index.html' : null);
    if (!file) return new Response('missing', { status: 404 });
    const body = file === changed ? 'other' : await readFile(join(site, file));
    return new Response(body, { status: 200, headers: { 'content-type': types[/** @type {keyof types} */ (file.split('.').pop())] } });
  };
  await verifyServedFiles(site, await gameSiteFiles(site), { siteUrl: base, request: cloudflareFetch(request) });
  changed = 'art/forge/ore-1.webp';
  await assert.rejects(
    verifyServedFiles(site, await gameSiteFiles(site), { siteUrl: base, request: cloudflareFetch(request) }),
    /differs from build: art\/forge\/ore-1\.webp/,
  );
});

test("the game's domain is live, not attached yet, stale or another game's", async () => {
  const release = { game: 'forge', buildId: 'build-1', sourceCommit: 'a'.repeat(40) };
  assert.equal(gameOriginVerdict({ game: 'forge', buildId: 'build-1', sourceCommit: 'a'.repeat(40) }, release), 'live');
  assert.equal(gameOriginVerdict({ game: 'forge', buildId: 'build-0', sourceCommit: 'd'.repeat(40) }, release), 'stale');
  for (const body of [null, '<html>', { game: 'forge' }, { siteUrl: 'https://oddbout.com/creator.html', sourceCommit: 'short' }]) {
    assert.equal(gameOriginVerdict(body, release), 'unreadable');
  }
  assert.throws(() => gameOriginVerdict({ game: 'pudding', sourceCommit: 'a'.repeat(40) }, release), /pudding/);

  const waits = [];
  const options = { wait: async (/** @type {number} */ ms) => waits.push(ms), timeoutMs: 60_000, intervalMs: 15_000 };
  /** @param {(() => Promise<Response>)[]} answers */
  const answering = answers =>
    /** @type {typeof fetch} */ (async () => (answers.length > 1 ? /** @type {() => Promise<Response>} */ (answers.shift()) : answers[0])());
  const json = (/** @type {object} */ body) => async () => Response.json(body);
  const down = async () => Promise.reject(new TypeError('fetch failed'));

  const live = await checkGameOrigin(origin, release, { ...options, request: answering([json({ ...release, buildId: 'build-0' }), json(release)]) });
  assert.equal(live.status, 'live');
  assert.deepEqual(waits, [15_000]);

  const absent = await checkGameOrigin(origin, release, { ...options, request: answering([down, async () => new Response('', { status: 404 }), down]) });
  assert.equal(absent.status, 'no-domain');
  assert.match(absent.message, /custom domain of the Cloudflare Pages project oddbout-forge/);
  assert.match(absent.message, new RegExp(`sourceCommit ${'a'.repeat(40)}`));

  let clock = 0;
  await assert.rejects(
    checkGameOrigin(origin, release, {
      ...options,
      now: () => (clock += 20_000),
      request: answering([json({ ...release, buildId: 'build-0', sourceCommit: 'd'.repeat(40) })]),
    }),
    /still serves another build \(d{40}\)/,
  );
  await assert.rejects(
    checkGameOrigin(origin, release, { ...options, request: answering([json({ game: 'pudding', sourceCommit: 'a'.repeat(40) })]) }),
    /pudding/,
  );
});

test('publish-game-site checks the files and stops before uploading without a token', async t => {
  const { site, release } = await forgeSite();
  const env = await mkdtemp(join(tmpdir(), 'game-site-env-'));
  t.after(() => Promise.all([rm(site, { recursive: true, force: true }), rm(env, { recursive: true, force: true })]));
  await writeFile(join(env, '.env'), '');
  const base = { PATH: process.env.PATH, ODDBOUT_DEPLOY_ENV_FILE: join(env, '.env'), CLOUDFLARE_ACCOUNT_ID: 'c'.repeat(32), ODDBOUT_GAME_ORIGIN: origin };
  const script = join(root, 'scripts/publish-game-site.mjs');
  const dry = await run(process.execPath, [script, 'forge', site, '--dry-run'], { env: base });
  const plan = JSON.parse(dry.stdout);
  assert.equal(plan.status, 'verified-only');
  assert.equal(plan.project, 'oddbout-forge');
  assert.equal(plan.branch, 'main');
  assert.equal(plan.sourceCommit, release.sourceCommit);
  assert.equal(plan.uploadFiles, 5);
  await assert.rejects(run(process.execPath, [script, 'forge', site], { env: base }), /CLOUDFLARE_API_TOKEN is not set: nothing was uploaded/);
  await assert.rejects(
    run(process.execPath, [script, 'forge', site, '--dry-run'], { env: { ...base, ODDBOUT_GAME_ORIGIN: 'https://pudding.oddbout.com' } }),
    /no Analytics tag|deployment\.json/,
  );
  await writeFile(join(site, '_headers'), '/*\n  X-Test: 1\n');
  await assert.rejects(run(process.execPath, [script, 'forge', site, '--dry-run'], { env: base }), /changed after build|explicit review/);
});

// The game repository's real package builder. Set ODDBOUT_GAME_SOURCE to a game checkout's kaito_web (with its node_modules).
const gameSource = process.env.ODDBOUT_GAME_SOURCE;
test('build-game-site builds the real game package with Analytics and deployment.json', { skip: !gameSource && 'set ODDBOUT_GAME_SOURCE' }, async t => {
  const output = await mkdtemp(join(tmpdir(), 'game-site-build-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const sites = JSON.parse(await readFile(join(/** @type {string} */ (gameSource), 'src/platform/game-sites.json'), 'utf8'));
  // The commits come from clean checkouts in a real build; this test runs in a working tree.
  const release = await buildGameSite({ source: /** @type {string} */ (gameSource), game: 'forge', output, env: {}, revision: () => revision });
  assert.equal(release.siteUrl, sites.forge.origin + '/');
  assert.equal(release.sourceCommit, revision.sourceCommit);
  const html = await readFile(join(output, 'index.html'), 'utf8');
  assert.equal(html, await readFile(join(output, 'forge.html'), 'utf8'));
  assertConsentFirst(html, 'index.html');
  assert.deepEqual(JSON.parse(await readFile(join(output, 'deployment.json'), 'utf8')), release);
  await assert.rejects(
    buildGameSite({ source: /** @type {string} */ (gameSource), game: 'forge', output, env: {}, revision: () => revision }),
    /must be empty/,
  );
});
