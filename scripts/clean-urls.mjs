// @ts-check
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Cloudflare Pages answers `/x.html` with a 308 to `/x` and `/dir/index.html` with `/dir/`. Search engines must be told the final address.
/** @param {string} href @param {string} base absolute public site URL
 * @returns {string} the clean absolute URL, or the input when it is not on the site's origin */
export function cleanPageUrl(href, base) {
  let url;
  try {
    url = new URL(href, base);
  } catch {
    return href;
  }
  if (url.origin !== new URL(base).origin) return href;
  url.pathname = url.pathname.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '');
  return url.href;
}

/** Rewrite only canonical, hreflang alternate and og:url targets that point at the site; links and assets stay as they are.
 * @param {string} html @param {string} base */
export function cleanSeoUrls(html, base) {
  /** @type {(tag: string, attribute: string) => string} */
  const rewrite = (tag, attribute) =>
    tag.replace(new RegExp(`(\\b${attribute}=)(["'])([^"']*)\\2`, 'i'), (_, name, quote, value) => name + quote + cleanPageUrl(value, base) + quote);
  return html
    .replace(/<link\b[^>]*>/gi, tag => (/\brel=["'](?:canonical|alternate)["']/i.test(tag) ? rewrite(tag, 'href') : tag))
    .replace(/<meta\b[^>]*>/gi, tag => (/\bproperty=["']og:url["']/i.test(tag) ? rewrite(tag, 'content') : tag));
}

/** @param {string} root @param {string[]} pages @param {string} siteUrl */
export async function cleanSiteSeoUrls(root, pages, siteUrl) {
  const base = new URL('.', siteUrl).href;
  for (const page of pages) {
    if (!page.endsWith('.html')) continue;
    const html = await readFile(join(root, page), 'utf8').catch(() => null);
    if (html === null) continue;
    const cleaned = cleanSeoUrls(html, base);
    if (cleaned !== html) await writeFile(join(root, page), cleaned);
  }
}
