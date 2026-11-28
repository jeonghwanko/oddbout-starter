// @ts-check
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanPageUrl } from './clean-urls.mjs';

export const discoveryFiles = ['robots.txt', 'sitemap.xml'];

// Pages the sitemap never lists by name: the operator page, the legacy league URL and the not-found page (the game's copy has no noindex).
const unlistedPages = new Set(['admin.html', 'league.html', '404.html']);

/** Every HTML file under root, site-relative with forward slashes, `index.html` first and the rest sorted.
 * @param {string} root */
export async function publishedHtmlPages(root) {
  const pages = (await readdir(root, { recursive: true })).map(path => String(path).replaceAll('\\', '/')).filter(path => path.endsWith('.html'));
  return pages.sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a < b ? -1 : a > b ? 1 : 0));
}

/** @param {string} tag @param {string} name */
function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : undefined;
}

/** The page's own search markup. Comments are ignored: a commented-out tag is not the page's instruction.
 * @param {string} html */
export function readSearchMarkup(html) {
  const live = html.replace(/<!--[\s\S]*?-->/g, '');
  const metas = [...live.matchAll(/<meta\b[^>]*>/gi)].map(match => match[0]);
  const noindex = metas.some(tag => /^(?:robots|googlebot)$/i.test(attribute(tag, 'name') ?? '') && /\bnoindex\b/i.test(attribute(tag, 'content') ?? ''));
  const canonicalTag = [...live.matchAll(/<link\b[^>]*>/gi)].map(match => match[0]).find(tag => /(?:^|\s)canonical(?:\s|$)/i.test(attribute(tag, 'rel') ?? ''));
  const published = metas.find(tag => attribute(tag, 'property') === 'article:published_time');
  return {
    noindex,
    canonical: canonicalTag ? attribute(canonicalTag, 'href') || undefined : undefined,
    published: /^\d{4}-\d{2}-\d{2}/.exec((published && attribute(published, 'content')) ?? '')?.[0],
  };
}

// Derive the sitemap from the final public HTML, preserving each page's canonical URL. The builder passes every published page
// (publishedHtmlPages): apart from unlistedPages, a page is left out only by its own markup — noindex, or a canonical on one of
// `otherHosts`, the hosts that own a copy published here (the games' own domains). A canonical on any other host is a mistake to review.
// Each of `required` must end up listed; a stray noindex or canonical on one of them stops the build.
/** @param {string} root @param {string} siteUrl @param {string[]} pages
 * @param {{ otherHosts?: string[], required?: string[] }} [options] */
export async function writeSiteDiscovery(root, siteUrl, pages, { otherHosts = [], required = [] } = {}) {
  const base = new URL('.', siteUrl);
  if (base.protocol !== 'https:') throw new Error('Search discovery requires the HTTPS public site');
  const owners = new Set(otherHosts.map(host => new URL(host).origin));
  /** @type {Map<string, string | undefined>} */
  const urls = new Map();
  /** @type {Set<string>} */
  const listed = new Set();
  for (const page of pages) {
    if (!page.endsWith('.html') || unlistedPages.has(page)) continue;
    const { noindex, canonical, published } = readSearchMarkup(await readFile(join(root, page), 'utf8'));
    if (noindex) continue;
    const url = new URL(cleanPageUrl(canonical ?? (page === 'index.html' ? './' : page), base.href));
    if (url.origin !== base.origin && owners.has(url.origin) && !url.search && !url.hash) continue;
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.search || url.hash) {
      throw new Error('Review the canonical URL for ' + page);
    }
    // Update posts carry their publication date; it is the page's last modification.
    urls.set(url.href, published);
    listed.add(page);
  }
  const missing = required.filter(page => !listed.has(page));
  if (missing.length) throw new Error('The sitemap must list ' + missing.join(', ') + ': check its noindex and canonical');
  /** @type {(text: string) => string} */
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    [...urls].map(([url, date]) => '  <url><loc>' + escape(url) + '</loc>' + (date ? '<lastmod>' + date + '</lastmod>' : '') + '</url>').join('\n') +
    '\n</urlset>\n';
  await writeFile(join(root, 'sitemap.xml'), xml);
  await writeFile(join(root, 'robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: ' + new URL('sitemap.xml', base).href + '\n');
  return [...urls.keys()];
}
