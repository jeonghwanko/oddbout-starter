import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildPluginPolicySite } from '../scripts/build-plugin-policy-site.mjs';
import { buildBrowserFightingGame } from '../scripts/build-browser-fighting-game.mjs';
import { discoveryFiles } from '../scripts/site-discovery.mjs';
import { fingerprint, hosting, movedSiteEntries, siteEntries, siteEntriesIn, verifyArtifact } from '../scripts/hosting-lib.mjs';
import { loadSiteRedirects, siteRedirectLines, siteRedirectState } from '../scripts/site-redirects.mjs';

// 2026-11-28: the game moved its fighters, docs and world pages under /fight-club/. This starter builds both layouts, and the reviewed
// redirect table activates only for the moved one.
const moved = new Set(Object.values(movedSiteEntries));

test('a moved page is found at its folder; an older game keeps its root file', () => {
  assert.deepEqual(
    siteEntriesIn(() => true),
    siteEntries,
  );
  const folders = siteEntriesIn(path => !(path in movedSiteEntries));
  assert.deepEqual(folders.filter(page => moved.has(page)).sort(), [...moved].sort());
  assert.equal(folders.length, siteEntries.length);
  // Neither in the tree: the old name stays, so the missing file is reported by its familiar name.
  assert.deepEqual(
    siteEntriesIn(path => !moved.has(path) && !(path in movedSiteEntries)),
    siteEntries,
  );
});

async function write(root, files) {
  for (const file of files) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), 'test');
  }
}

test('the artifact check accepts a build with the pages in their folders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fight-club-artifact-'));
  try {
    const entries = siteEntries.map(page => movedSiteEntries[page] ?? page);
    await mkdir(join(root, '.vite'));
    await buildPluginPolicySite(join(root, 'ai-fighter-creator'), { publish: true });
    await buildBrowserFightingGame(root);
    await write(root, [...entries, ...discoveryFiles, 'index.html', '.nojekyll', 'assets/main.js']);
    await writeFile(join(root, '.vite/manifest.json'), JSON.stringify(Object.fromEntries(entries.map(page => [page, { file: 'assets/main.js' }]))));
    if (hosting.customDomain) await writeFile(join(root, 'CNAME'), hosting.customDomain + '\n');
    const release = {
      siteUrl: hosting.siteUrl,
      buildId: '11111111-1111-4111-8111-111111111111',
      builtAt: new Date().toISOString(),
      sourceCommit: 'a'.repeat(40),
      hostingCommit: 'b'.repeat(40),
      dirty: false,
      ...(await fingerprint(root)),
    };
    await writeFile(join(root, 'deployment.json'), JSON.stringify(release));
    await verifyArtifact(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the checked-in table waits for an older game and redirects every old address of a moved one', async () => {
  const rules = await loadSiteRedirects();
  const older = await mkdtemp(join(tmpdir(), 'fight-club-older-'));
  const newer = await mkdtemp(join(tmpdir(), 'fight-club-newer-'));
  const pages = rules.map(rule => (rule.from.endsWith('/') ? rule.from.slice(1) + 'index.html' : rule.from.slice(1)));
  const folders = rules.map(rule => rule.to.slice(1) + 'index.html');
  try {
    await write(older, pages);
    await write(newer, folders);
    assert.deepEqual(await siteRedirectState(older, rules), { active: [], pending: rules });
    const state = await siteRedirectState(newer, rules);
    assert.equal(state.pending.length, 0);
    const lines = siteRedirectLines(state.active);
    for (const line of [
      '/fighters.html /fight-club/fighters/ 301',
      '/fighters /fight-club/fighters/ 301',
      '/docs /fight-club/docs/ 301',
      '/world.html /fight-club/world/ 301',
    ])
      assert.ok(lines.includes(line), line);
    assert.ok(lines.includes('/fighters/velora/en/ /fight-club/fighters/velora/en/ 301'));
    assert.ok(lines.includes('/fighters/leon /fight-club/fighters/leon/ 301'));
  } finally {
    await rm(older, { recursive: true, force: true });
    await rm(newer, { recursive: true, force: true });
  }
});
