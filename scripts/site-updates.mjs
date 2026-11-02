// @ts-check
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const updatesManifestFile = 'updates-manifest.json';

/** Read the game's static update output without making older source revisions require it.
 * @param {string} root
 * @returns {Promise<{pages: string[], assets: string[]}>}
 */
export async function readUpdatesManifest(root) {
  const landing = await stat(join(root, 'updates.html')).catch(() => null);
  const source = await readFile(join(root, updatesManifestFile), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!landing && source === null) return { pages: [], assets: [] };
  if (!landing?.isFile() || source === null) throw new Error('Incomplete updates output: landing and manifest are both required');
  const manifest = JSON.parse(source);
  const pages = manifest?.pages, assets = manifest?.assets;
  if (manifest?.version !== 1 || !Array.isArray(pages) || !Array.isArray(assets) ||
      !pages.includes('updates.html') || new Set(pages).size !== pages.length || new Set(assets).size !== assets.length ||
      pages.some(page => typeof page !== 'string' || !/^(?:updates(?:\.(?:ko|en|ja))?|updates\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\.(?:en|ja))?)\.html$/.test(page)) ||
      assets.some(asset => typeof asset !== 'string' || !/^art\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.webp$/.test(asset))) {
    throw new Error('Invalid updates manifest');
  }
  return { pages, assets };
}

/** Static update HTML has no application module. Follow its local styles separately from the game's mandatory Vite entries.
 * @param {string} root @param {string} siteUrl
 */
export async function updatesPublishedFiles(root, siteUrl) {
  const { pages, assets } = await readUpdatesManifest(root);
  const files = new Set(pages.length ? [updatesManifestFile, ...pages, ...assets] : []);
  const base = new URL('.', siteUrl);
  for (const page of pages) {
    const html = await readFile(join(root, page), 'utf8');
    for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
      const attributes = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(match => [match[1], match[2]]));
      if (attributes.rel !== 'stylesheet') continue;
      if (!attributes.href || /[\\%]/.test(attributes.href)) throw new Error(`Unsafe updates stylesheet: ${page}`);
      const url = new URL(attributes.href, new URL(page, base));
      const file = url.pathname.slice(base.pathname.length);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.search || url.hash ||
          !/^assets\/[a-zA-Z0-9_-]+\.css$/.test(file)) throw new Error(`Unsafe updates stylesheet: ${page}`);
      files.add(file);
    }
  }
  return files;
}
