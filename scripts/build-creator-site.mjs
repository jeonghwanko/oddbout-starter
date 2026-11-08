// @ts-check
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homepageEntries } from './homepage-entry.mjs';
import { writeSiteDiscovery } from './site-discovery.mjs';
import { readUpdatesManifest } from './site-updates.mjs';
import { writeUpdatesAnalytics } from './site-updates-analytics.mjs';
import { publishEnvironmentProfiles } from '../mcp/environment-profiles.mjs';
import { buildPluginPolicySite, sitePrivacyNotice, policyFiles } from './build-plugin-policy-site.mjs';
import { buildCloudConnect } from './build-cloud-connect.mjs';

import { youtubeChannelPlugin } from './site-social.mjs';
import { milestonePlugin } from './site-milestones.mjs';
import { googleAnalyticsPlugin } from './site-analytics.mjs';
import { PUBLIC_CREATOR_PAGE } from '../mcp/creator-handoff.mjs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fingerprint, buildRevision, assertSameRevision, siteEntries, publicSiteText } from './hosting-lib.mjs';

// Build the AI Fighter entries with explicit public settings, without loading source .env files.
const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) throw new Error('Usage: node scripts/build-creator-site.mjs <kaito_web> <empty-output-directory>');
const source = resolve(sourceArg),
  output = resolve(outputArg);
const relativeOutput = relative(source, output);
if (!relativeOutput || (!isAbsolute(relativeOutput) && relativeOutput !== '..' && !relativeOutput.startsWith('..\\') && !relativeOutput.startsWith('../'))) {
  throw new Error('Output directory must be outside the source tree');
}
const hostingRoot = fileURLToPath(new URL('../', import.meta.url));
const revision = buildRevision(source, hostingRoot);
const builtAt = new Date().toISOString();
const config = JSON.parse(await readFile(new URL('../deploy/creator-site.json', import.meta.url), 'utf8'));
if (config.siteUrl !== PUBLIC_CREATOR_PAGE) throw new Error('Hosting URL must match the MCP homepage');
if (!config.publishableKey.startsWith('sb_publishable_')) throw new Error('A public publishable key is required');
await readFile(join(source, 'creator.html'));
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error('Output directory must be empty');
const { build } = await import(pathToFileURL(join(source, 'node_modules/vite/dist/node/index.js')).href);
const { creationContextPlugin } = await import(pathToFileURL(join(source, 'tools/ai-fighter/creation-context-plugin.mjs')).href);
// Per-match-up share previews: the game writes every shareable pair's page and card and links them. Older sources have no plugin and
// keep linking fighter.html, so a rollback still builds.
const boutShareModule = join(source, 'tools/ai-fighter/bout-share-pages.mjs');
const boutSharePages = (await readFile(boutShareModule).then(
  () => true,
  () => false,
))
  ? [(await import(pathToFileURL(boutShareModule).href)).boutSharePagesPlugin(new URL('.', config.gameUrl).href)]
  : [];
// The plugins that shape the game's shipped bundle (2026-10-30 — the sound registry's game copy, without its source and rights records).
// configFile: false keeps the game's vite.config.ts out, so the game lists them for both builds. Older sources have no list and build without.
const gamePluginsModule = join(source, 'tools/ai-fighter/site-build-plugins.mjs');
const gamePlugins = (await readFile(gamePluginsModule).then(
  () => true,
  () => false,
))
  ? (await import(pathToFileURL(gamePluginsModule).href)).siteBuildPlugins()
  : [];
await build({
  configFile: false,
  root: source,
  envDir: false,
  base: config.base,
  plugins: [
    creationContextPlugin(),
    ...boutSharePages,
    ...gamePlugins,
    milestonePlugin(),
    youtubeChannelPlugin(config.youtubeChannelUrl),
    googleAnalyticsPlugin(config.analyticsMeasurementId, config.siteUrl, config.apiBase),
    {
      name: 'standalone-creator-origin',
      transformIndexHtml: {
        order: 'pre',
        /** @param {string} html @param {{ filename: string }} context */
        handler(html, context) {
          const text = publicSiteText(html);
          return context.filename.replaceAll('\\', '/').endsWith('/privacy.html') ? sitePrivacyNotice(text) : text;
        },
      },
      /** @param {string} code @param {string} id */
      transform(code, id) {
        code = publicSiteText(code);
        if (!id.replaceAll('\\', '/').endsWith('/src/platform/fighterCreator.ts')) return code;
        const old = 'export const PUBLIC_CREATOR_ORIGIN = "https://rupin.pryzm.gg";';
        if (!code.includes(old)) throw new Error('Creator origin source changed; review the standalone build');
        return code.replace(old, `export const PUBLIC_CREATOR_ORIGIN = ${JSON.stringify(new URL(config.siteUrl).origin)};`);
      },
    },
  ],
  define: {
    'import.meta.env.VITE_AI_FIGHTER_API_BASE': JSON.stringify(config.apiBase),
    'import.meta.env.VITE_AI_FIGHTER_PUBLISHABLE_KEY': JSON.stringify(config.publishableKey),
    'import.meta.env.VITE_AI_FIGHTER_GAME_URL': JSON.stringify(config.gameUrl),
  },
  build: {
    target: 'es2022',
    manifest: true,
    outDir: output,
    emptyOutDir: false,
    copyPublicDir: false,
    rolldownOptions: { input: Object.fromEntries(siteEntries.map(page => [page.replace('.html', ''), join(source, page)])) },
  },
});
// Keep original asset names, manifests and license notices, including lazily loaded character packs.
// The public tree is under Pages' 1 GB site limit and contains no environment or server files.
for (const entry of await readdir(join(source, 'public'))) {
  // Standalone ODDBOUT pages take precedence over the shared game's legacy notices.
  if (siteEntries.includes(entry) || entry === 'CNAME') continue;
  await cp(join(source, 'public', entry), join(output, entry), { recursive: true, force: false, errorOnExist: true });
}
await writeFile(join(output, '.nojekyll'), '');
if (config.customDomain) await writeFile(join(output, 'CNAME'), config.customDomain + '\n');
// Policy files must exist before the artifact fingerprint is measured.
await buildPluginPolicySite(join(output, 'ai-fighter-creator'), { publish: true });
await buildCloudConnect(output);
await publishEnvironmentProfiles(output);
// Serve the actual homepage at /; retain the old filename as a compatible redirect.
const homepage = await readFile(join(output, 'league.html'), 'utf8');
for (const [path, html] of Object.entries(homepageEntries(homepage))) {
  await writeFile(join(output, path), html);
}
const updatesOutput = await readUpdatesManifest(output);
await writeUpdatesAnalytics(output, updatesOutput.pages, config.analyticsMeasurementId, config.siteUrl, config.apiBase);
await writeSiteDiscovery(output, config.siteUrl, ['index.html', ...siteEntries, ...policyFiles, ...updatesOutput.pages]);
// The game's public 404 belongs to another site and links to the domain root, which is not ours.
await writeFile(
  join(output, '404.html'),
  `<!doctype html>
<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex"><title>AI Fighter · 페이지를 찾을 수 없습니다</title>
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#14212d;color:#f5f2e9;font:16px/1.6 Arial,sans-serif;text-align:center}h1{font-size:28px;margin:0 0 12px}a{color:#e9f56a}</style>
<main><h1>페이지를 찾을 수 없습니다 · Page not found</h1>
<p><a href="${config.base}">AI Fighter 홈으로 · Back to AI Fighter</a></p></main></html>
`,
);
const assets = await readdir(join(output, 'assets'));
const js = (await Promise.all(assets.filter(f => f.endsWith('.js')).map(f => readFile(join(output, 'assets', f), 'utf8')))).join('\n');
const css = (await Promise.all(assets.filter(f => f.endsWith('.css')).map(f => readFile(join(output, 'assets', f), 'utf8')))).join('\n');
for (const value of [config.apiBase, config.publishableKey, config.gameUrl]) {
  if (!js.includes(value)) throw new Error('Public configuration missing from build');
}
if (js.includes('rupin.pryzm.gg') || js.includes('findthem')) throw new Error('Old host dependency found in build');
// Every font a stylesheet loads must be in the output at the address it gives: the site's Pretendard slices are bundled (assets/), the
// game page's whole fonts stay under fonts/. A font inlined as a data URI has no file to check.
const fontUrls = [...css.matchAll(/url\(\s*['"]?([^'")]+\.woff2?)(?:[?#][^'")]*)?['"]?\s*\)/g)].map(match => match[1]);
if (!fontUrls.some(url => /Pretendard-Regular/.test(url)) || !fontUrls.some(url => /Pretendard-Bold/.test(url)))
  throw new Error('Site stylesheet does not load Pretendard');
for (const url of new Set(fontUrls)) {
  if (/^[a-z]+:/i.test(url)) throw new Error(`Font loaded from another origin: ${url}`);
  const path = url.startsWith(config.base) ? url.slice(config.base.length) : join('assets', url);
  await readFile(join(output, path)).catch(() => {
    throw new Error(`Incorrect deployed font URL: ${url}`);
  });
}
for (const font of ['Pretendard-Regular.woff2', 'Pretendard-Bold.woff2']) await readFile(join(output, 'fonts', font));
assertSameRevision(revision, buildRevision(source, hostingRoot));
const release = {
  buildId: randomUUID(),
  siteUrl: config.siteUrl,
  builtAt,
  ...revision,
  dirty: false,
  ...(await fingerprint(output)),
};
await writeFile(join(output, 'deployment.json'), JSON.stringify(release, null, 2) + '\n');
console.log(JSON.stringify({ output, ...release, checks: 'public-config-and-font-paths-passed' }));
