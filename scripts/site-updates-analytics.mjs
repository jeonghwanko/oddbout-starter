// @ts-check
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { analyticsSource } from './site-analytics.mjs';

/** Tag the static pages emitted outside Vite's HTML transform graph. The neutral redirect stays untagged.
 * @param {string} root @param {string[]} pages @param {string | undefined} measurementId
 * @param {string} siteUrl @param {string | null} [apiBase]
 */
export async function writeUpdatesAnalytics(root, pages, measurementId, siteUrl, apiBase = null) {
  if (!measurementId || !pages.length) return;
  const slugs = [
    ...new Set(
      pages.flatMap(page => {
        const match = /^updates\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\.(?:en|ja))?\.html$/.exec(page);
        return match ? [match[1]] : [];
      }),
    ),
  ];
  const source = analyticsSource(measurementId, siteUrl, apiBase, slugs);
  for (const page of pages) {
    if (page === 'updates.html') continue;
    if (!/^(?:updates\.(?:ko|en|ja)|updates\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\.(?:en|ja))?)\.html$/.test(page)) throw new Error('Invalid update Analytics page');
    const file = join(root, page);
    const html = await readFile(file, 'utf8');
    if (html.includes('data-oddbout-updates-analytics')) continue;
    if (!/<\/body\s*>/i.test(html)) throw new Error(`Missing updates HTML body: ${page}`);
    await writeFile(file, html.replace(/<\/body\s*>/i, `<script data-oddbout-updates-analytics>${source}</script>\n</body>`));
  }
}
