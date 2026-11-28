import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { siteEntries } from '../scripts/hosting-lib.mjs';
import { publishedHtmlPages, writeSiteDiscovery } from '../scripts/site-discovery.mjs';
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

test('publishedHtmlPages lists every HTML file in the tree, nested ones too, with index.html first', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oddbout-published-pages-'));
  try {
    await mkdir(join(root, 'games/pudding'), { recursive: true });
    await mkdir(join(root, 'assets'), { recursive: true });
    for (const file of ['terms.html', 'index.html', 'games/pudding/intro.html', 'contact.html', 'assets/app.js', 'sitemap.xml'])
      await writeFile(join(root, file), '');
    assert.deepEqual(await publishedHtmlPages(root), ['index.html', 'contact.html', 'games/pudding/intro.html', 'terms.html']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the sitemap leaves out only noindex pages, the unlisted names and copies owned by a game domain', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oddbout-discovery-all-'));
  const site = 'https://example.com/';
  const otherHosts = ['https://pudding.example.net'];
  try {
    await mkdir(join(root, 'games/pudding'), { recursive: true });
    const files = {
      'index.html': '<link rel="canonical" href="https://example.com/">',
      'contact.html': '<title>no canonical</title><!-- <link rel="canonical" href="https://pudding.example.net/old"> -->',
      'broadcast.html': '<meta name="robots" content="noindex"><title>overlay</title>',
      'auth.html': '<meta content="noindex, nofollow" name=googlebot>',
      'draft.html': '<!-- <meta name="robots" content="noindex"> --><title>live page</title>',
      '404.html': '<title>not found</title>',
      'games/pudding/intro.html': '<link href="https://pudding.example.net/intro" rel=canonical>',
    };
    for (const [file, html] of Object.entries(files)) await writeFile(join(root, file), html);
    const pages = await publishedHtmlPages(root);
    const urls = await writeSiteDiscovery(root, site, pages, { otherHosts, required: ['index.html', 'contact.html'] });
    assert.deepEqual(urls, ['https://example.com/', 'https://example.com/contact', 'https://example.com/draft']);
    assert.doesNotMatch(await readFile(join(root, 'sitemap.xml'), 'utf8'), /pudding|broadcast|auth|404/);
    // A required page that drops out stops the build instead of shipping a sitemap without it.
    await assert.rejects(writeSiteDiscovery(root, site, pages, { otherHosts, required: ['broadcast.html'] }), /must list broadcast\.html/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a canonical on a host that is not a game domain, or with a query, still stops the build for review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oddbout-discovery-review-'));
  const site = 'https://example.com/';
  try {
    for (const [html, otherHosts] of /** @type {[string, string[]][]} */ ([
      ['<link rel="canonical" href="http://example.com/">', []],
      ['<link rel="canonical" href="https://www.example.com/page">', []],
      ['<link rel="canonical" href="https://user.github.io/starter/page">', ['https://pudding.example.net']],
      ['<link rel="canonical" href="https://example.com/page?lang=en">', []],
      ['<link rel="canonical" href="https://pudding.example.net/intro?lang=ko">', ['https://pudding.example.net']],
    ])) {
      await writeFile(join(root, 'page.html'), html);
      await assert.rejects(writeSiteDiscovery(root, site, ['page.html'], { otherHosts }), /Review the canonical URL for page\.html/, html);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the site build hands the sitemap every published page, not a list of its own', async () => {
  const builder = await readFile(new URL('../scripts/build-creator-site.mjs', import.meta.url), 'utf8');
  assert.match(builder, /const publishedPages = await publishedHtmlPages\(output\);/);
  assert.match(builder, /writeSiteDiscovery\(output, config\.siteUrl, publishedPages, \{/);
  assert.match(builder, /otherHosts: Object\.values\(gameSites\)/);
});
