import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUpdatesManifest, updatesPublishedFiles } from '../scripts/site-updates.mjs';
import { publishedFiles, siteEntries, verifyLiveSite } from '../scripts/hosting-lib.mjs';
import { writeSiteDiscovery } from '../scripts/site-discovery.mjs';

const siteUrl = 'https://example.com/game/';
const manifest = { version: 1, pages: ['updates.html', 'updates/2026-11-03-vice-arrives.html'], assets: ['art/ui/logo.webp'] };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'oddbout-updates-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function writeManifest(root, value = manifest) {
  await writeFile(join(root, 'updates-manifest.json'), JSON.stringify(value));
}

test('older artifacts remain supported; partial update output cannot be published', async t => {
  const root = await fixture(t);
  assert.deepEqual(await readUpdatesManifest(root), { pages: [], assets: [] });
  await writeFile(join(root, 'updates.html'), 'landing');
  await assert.rejects(readUpdatesManifest(root), /Incomplete updates/);
  await writeManifest(root);
  assert.deepEqual(await readUpdatesManifest(root), { pages: manifest.pages, assets: manifest.assets });
  await writeManifest(root, { ...manifest, pages: [...manifest.pages, 'updates.ko.html', 'updates.en.html', 'updates.ja.html'] });
  assert.equal((await readUpdatesManifest(root)).pages.length, 5);
  await rm(join(root, 'updates.html'));
  await assert.rejects(readUpdatesManifest(root), /Incomplete updates/);
});

test('update manifest rejects traversal, foreign pages, duplicate paths and unsupported versions', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'updates.html'), 'landing');
  for (const bad of [
    { ...manifest, version: 2 },
    ...['../secret.html', 'updates/../admin.html', 'updates/%2e%2e/secret.html', 'https://example.com/a.html', 'creator.html', 'updates.html?x=1', 'updates.html'].map(page => ({ ...manifest, pages: ['updates.html', page] })),
    ...['art/../secret.webp', '/art/logo.webp', 'art/%2e%2e/logo.webp', 'art/logo.webp#x'].map(asset => ({ ...manifest, assets: [asset] })),
  ]) {
    await writeManifest(root, bad);
    await assert.rejects(readUpdatesManifest(root), /Invalid updates manifest/);
  }
});

test('static pages, nested relative styles and official art join publication and search discovery', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'updates'));
  await mkdir(join(root, '.vite'));
  await writeManifest(root);
  await writeFile(join(root, 'updates.html'), '<link rel="stylesheet" href="./assets/updates-abc.css">');
  await writeFile(join(root, manifest.pages[1]), '<link rel="stylesheet" href="../assets/updates-abc.css">');
  await writeFile(join(root, '.vite/manifest.json'), JSON.stringify(Object.fromEntries(siteEntries.map(page => [page, { file: 'assets/main.js' }]))));
  const files = await publishedFiles(root, siteUrl);
  for (const path of ['updates-manifest.json', ...manifest.pages, ...manifest.assets, 'assets/updates-abc.css', 'assets/main.js']) assert.ok(files.has(path), path);
  const urls = await writeSiteDiscovery(root, siteUrl, (await readUpdatesManifest(root)).pages);
  assert.deepEqual(urls, manifest.pages.map(page => new URL(page, siteUrl).href));
  assert.match(await readFile(join(root, 'sitemap.xml'), 'utf8'), /updates\/2026-11-03-vice-arrives.html/);
  // A successful HTTP response with stale update art must still fail the live check.
  for (const path of files) {
    const destination = join(root, path);
    await mkdir(join(destination, '..'), { recursive: true });
    if (!['updates.html', manifest.pages[1], 'updates-manifest.json'].includes(path)) await writeFile(destination, `content:${path}`);
  }
  let stale = false;
  const request = async url => {
    const path = url.pathname.slice('/game/'.length);
    const mime = path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.webp') ? 'image/webp' : path.endsWith('.json') ? 'application/json' : path.endsWith('.xml') ? 'application/xml' : 'text/plain';
    return new Response(stale && path === 'art/ui/logo.webp' ? 'stale' : await readFile(join(root, path)), { headers: { 'content-type': mime } });
  };
  await verifyLiveSite(root, { siteUrl, request });
  stale = true;
  await assert.rejects(verifyLiveSite(root, { siteUrl, request }), /differs from build/);
});

test('static styles must stay within the published asset directory', async t => {
  const root = await fixture(t);
  await writeManifest(root, { ...manifest, pages: ['updates.html'] });
  for (const href of ['https://external.example/style.css', '../assets/style.css', '/other/style.css', './assets/style.css?v=1', './assets/%2e%2e/style.css']) {
    await writeFile(join(root, 'updates.html'), `<link rel="stylesheet" href="${href}">`);
    await assert.rejects(updatesPublishedFiles(root, siteUrl), /Unsafe updates stylesheet/);
  }
});
