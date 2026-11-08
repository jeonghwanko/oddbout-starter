import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { writeUpdatesAnalytics } from '../scripts/site-updates-analytics.mjs';
import { readUpdatesManifest } from '../scripts/site-updates.mjs';

test('every emitted translation and detail gets one executable tag; neutral redirect gets none', async t => {
  const root = await mkdtemp(join(tmpdir(), 'oddbout-update-analytics-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const details = ['2026-11-03-vice-arrives', '2026-11-02-new-arena'];
  const pages = [
    'updates.html',
    ...['ko', 'en', 'ja'].map(lang => `updates.${lang}.html`),
    ...details.flatMap(slug => ['', '.en', '.ja'].map(lang => `updates/${slug}${lang}.html`)),
  ];
  await mkdir(join(root, 'updates'));
  await writeFile(join(root, 'updates-manifest.json'), JSON.stringify({ version: 1, pages, assets: [] }));
  const original = '<!doctype html><html lang="en"><head><title>Updates</title></head><body>Updates</body></html>';
  for (const page of pages) await writeFile(join(root, page), original);
  await writeUpdatesAnalytics(root, (await readUpdatesManifest(root)).pages, 'G-ABC123DEF4', 'https://oddbout.com/');
  await writeUpdatesAnalytics(root, pages, 'G-ABC123DEF4', 'https://oddbout.com/'); // harmless rerun
  for (const page of pages) {
    const html = await readFile(join(root, page), 'utf8');
    if (page === 'updates.html') {
      assert.equal(html, original);
      continue;
    }
    const tags = [...html.matchAll(/<script data-oddbout-updates-analytics>([\s\S]*?)<\/script>/g)];
    assert.equal(tags.length, 1, page);
    for (const [href, gpc, expectedViews] of [
      [`https://oddbout.com/${page}?utm_source=tiktok&utm_medium=social&utm_campaign=profile&email=private#private`, false, 1],
      [`https://oddbout.com/${page}`, true, 0],
      [`http://localhost/${page}`, false, 0],
    ]) {
      const scripts = [];
      const window = { location: new URL(href), addEventListener() {}, dispatchEvent() {} };
      const document = { title: 'Updates', referrer: '', createElement: () => ({}), head: { append: script => scripts.push(script) } };
      runInNewContext(tags[0][1], { window, document, navigator: { globalPrivacyControl: gpc }, URL, URLSearchParams, CustomEvent: class {} });
      const views = (window.dataLayer ?? []).map(args => Array.from(args)).filter(args => args[1] === 'page_view');
      assert.equal(views.length, expectedViews, `${page}: ${href}`);
      assert.equal(scripts.length, expectedViews);
      if (expectedViews) assert.equal(views[0][2].page_location, `https://oddbout.com/${page}?utm_source=tiktok&utm_medium=social&utm_campaign=profile`);
    }
  }
});

test('disabled analytics leaves static output alone and incomplete body fails the build', async t => {
  const root = await mkdtemp(join(tmpdir(), 'oddbout-update-no-analytics-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'updates.en.html'), '<head></head>');
  await writeUpdatesAnalytics(root, ['updates.en.html'], undefined, 'https://oddbout.com/');
  assert.equal(await readFile(join(root, 'updates.en.html'), 'utf8'), '<head></head>');
  await assert.rejects(writeUpdatesAnalytics(root, ['updates.en.html'], 'G-ABC123DEF4', 'https://oddbout.com/'), /Missing updates HTML body/);
});
