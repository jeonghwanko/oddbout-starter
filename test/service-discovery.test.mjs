import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { siteEntries } from '../scripts/hosting-lib.mjs';
import { writeSiteDiscovery } from '../scripts/site-discovery.mjs';

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
      pages.map(file => `https://example.com/${file}`),
    );
    const sitemap = await readFile(join(root, 'sitemap.xml'), 'utf8');
    for (const url of urls) assert.ok(sitemap.includes(`<loc>${url}</loc>`));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
