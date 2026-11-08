// @ts-check
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const discoveryFiles = ['robots.txt', 'sitemap.xml'];

// Derive the sitemap from the final public HTML, preserving each page's canonical URL.
/** @param {string} root @param {string} siteUrl @param {string[]} pages */
export async function writeSiteDiscovery(root, siteUrl, pages) {
  const base = new URL('.', siteUrl);
  if (base.protocol !== 'https:') throw new Error('Search discovery requires the HTTPS public site');
  const urls = new Set();
  for (const page of pages) {
    if (!page.endsWith('.html') || page === 'admin.html' || page === 'league.html') continue;
    const html = await readFile(join(root, page), 'utf8');
    if (/<meta\b(?=[^>]*\bname=["']robots["'])[^>]*\bcontent=["'][^"']*noindex/i.test(html)) continue;
    const canonical = html.match(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/i)?.[1];
    const url = new URL(canonical ?? (page === 'index.html' ? './' : page), base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.search || url.hash) {
      throw new Error('Review the canonical URL for ' + page);
    }
    urls.add(url.href);
  }
  /** @type {(text: string) => string} */
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    [...urls].map(url => '  <url><loc>' + escape(url) + '</loc></url>').join('\n') +
    '\n</urlset>\n';
  await writeFile(join(root, 'sitemap.xml'), xml);
  await writeFile(join(root, 'robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: ' + new URL('sitemap.xml', base).href + '\n');
  return [...urls];
}
