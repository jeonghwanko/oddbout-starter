import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { siteEntries } from '../scripts/hosting-lib.mjs';
import { writeSiteDiscovery } from '../scripts/site-discovery.mjs';
import { cleanSeoUrls, cleanSiteSeoUrls, cleanPageUrl } from '../scripts/clean-urls.mjs';

test('both service languages are built, verified and discoverable at their own canonical URL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oddbout-service-discovery-'));
  try {
    const pages = ['service.html', 'service.ko.html'];
    for (const file of pages) {
      assert.ok(siteEntries.includes(file), `${file} must be part of the production artifact`);
      await writeFile(join(root, file), `<link rel="canonical" href="https://example.com/${file}">`);
    }
    const urls = await writeSiteDiscovery(root, 'https://example.com/', pages);
    assert.deepEqual(
      urls,
      pages.map(file => `https://example.com/${file.replace('.html', '')}`),
    );
    const sitemap = await readFile(join(root, 'sitemap.xml'), 'utf8');
    for (const url of urls) assert.ok(sitemap.includes(`<loc>${url}</loc>`));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('canonical, hreflang and og:url name the clean address Pages redirects to, and the sitemap lists no .html URL', async () => {
  const base = 'https://example.com/';
  assert.equal(cleanPageUrl('https://example.com/index.html', base), 'https://example.com/');
  assert.equal(cleanPageUrl('https://example.com/ai-fighter-creator/index.html', base), 'https://example.com/ai-fighter-creator/');
  assert.equal(cleanPageUrl('https://example.com/updates/a.html?x=1#y', base), 'https://example.com/updates/a?x=1#y');
  assert.equal(cleanPageUrl('https://other.example/a.html', base), 'https://other.example/a.html');
  const html =
    '<meta property="og:url" content="https://example.com/about.html"><link rel="canonical" href="https://example.com/about.html">' +
    '<link rel="alternate" hreflang="ko" href="https://example.com/updates.ko.html"><link rel="stylesheet" href="https://example.com/a.html">' +
    '<a href="https://example.com/about.html">about</a>';
  assert.equal(
    cleanSeoUrls(html, base),
    '<meta property="og:url" content="https://example.com/about"><link rel="canonical" href="https://example.com/about">' +
      '<link rel="alternate" hreflang="ko" href="https://example.com/updates.ko"><link rel="stylesheet" href="https://example.com/a.html">' +
      '<a href="https://example.com/about.html">about</a>',
  );
  const root = await mkdtemp(join(tmpdir(), 'oddbout-clean-urls-'));
  try {
    await mkdir(join(root, 'updates'), { recursive: true });
    await writeFile(join(root, 'index.html'), '<link rel="canonical" href="https://example.com/index.html">');
    await writeFile(join(root, 'plain.html'), '<title>no canonical</title>');
    await writeFile(
      join(root, 'updates/post.html'),
      '<link rel="canonical" href="https://example.com/updates/post.html"><meta property="article:published_time" content="2026-11-03T00:00:00+09:00">',
    );
    const pages = ['index.html', 'plain.html', 'updates/post.html'];
    await cleanSiteSeoUrls(root, pages, base);
    await writeSiteDiscovery(root, base, pages);
    const sitemap = await readFile(join(root, 'sitemap.xml'), 'utf8');
    assert.doesNotMatch(sitemap, /\.html/);
    assert.match(sitemap, /<loc>https:\/\/example\.com\/<\/loc>/);
    assert.match(sitemap, /<loc>https:\/\/example\.com\/plain<\/loc>/);
    assert.match(sitemap, /<loc>https:\/\/example\.com\/updates\/post<\/loc><lastmod>2026-11-03<\/lastmod>/);
    assert.doesNotMatch(await readFile(join(root, 'index.html'), 'utf8'), /\.html/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
