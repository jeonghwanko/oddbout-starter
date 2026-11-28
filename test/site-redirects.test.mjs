import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadSiteRedirects, siteRedirectLines, siteRedirectState, validateSiteRedirects, verifySiteRedirects } from '../scripts/site-redirects.mjs';

const table = (/** @type {unknown[]} */ redirects) => ({ redirects });

async function site(/** @type {string[]} */ files) {
  const root = await mkdtemp(join(tmpdir(), 'site-redirects-'));
  for (const file of files) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), '<!doctype html>');
  }
  return root;
}

test('the checked-in table is valid', async () => {
  await loadSiteRedirects();
});

test('a rule names two clean site paths and a permanent status', () => {
  assert.deepEqual(validateSiteRedirects(table([{ from: '/world.html', to: '/fight-club/world/' }])), [
    { from: '/world.html', to: '/fight-club/world/', status: 301 },
  ]);
  for (const bad of [
    { from: 'world.html', to: '/fight-club/world/' },
    { from: '/world.html?lang=ko', to: '/fight-club/world/' },
    { from: '/world.html', to: '/fight-club/world/#lore' },
    { from: '/fighters/*', to: '/fight-club/fighters/:splat' },
    { from: '/a/../b', to: '/c/' },
    { from: '/world.html', to: 'https://example.com/' },
    { from: '/world.html', to: '/fight-club/world/', status: 302 },
    { from: '/world.html', to: '/fight-club/world.html' },
    { from: '/fight-club/index.html', to: '/fight-club/' },
    { from: '/same/', to: '/same/' },
  ])
    assert.throws(() => validateSiteRedirects(table([bad])), /site-redirects/, JSON.stringify(bad));
  assert.throws(() => validateSiteRedirects({}), /array/);
});

test('a source appears once in either spelling, and no rule leads to another', () => {
  assert.throws(
    () =>
      validateSiteRedirects(
        table([
          { from: '/world.html', to: '/fight-club/world/' },
          { from: '/world', to: '/fight-club/world/' },
        ]),
      ),
    /appears twice/,
  );
  assert.throws(
    () =>
      validateSiteRedirects(
        table([
          { from: '/old/', to: '/world' },
          { from: '/world.html', to: '/fight-club/world/' },
        ]),
      ),
    /leads to another redirect/,
  );
});

test('a rule waits until the build moves its page, then redirects both spellings', async () => {
  const rules = validateSiteRedirects(
    table([
      { from: '/world.html', to: '/fight-club/world/' },
      { from: '/fighters/velora/', to: '/fight-club/fighters/velora/' },
    ]),
  );
  const before = await site(['world.html', 'fighters/velora/index.html']);
  const after = await site(['fight-club/world/index.html', 'fight-club/fighters/velora/index.html']);
  try {
    assert.deepEqual(await siteRedirectState(before, rules), { active: [], pending: rules });
    const moved = await siteRedirectState(after, rules);
    assert.deepEqual(moved, { active: rules, pending: [] });
    assert.deepEqual(siteRedirectLines(moved.active), [
      '/world.html /fight-club/world/ 301',
      '/world /fight-club/world/ 301',
      '/fighters/velora/ /fight-club/fighters/velora/ 301',
    ]);
  } finally {
    await rm(before, { recursive: true, force: true });
    await rm(after, { recursive: true, force: true });
  }
});

test('an old page published beside its target, or a rule with neither, stops the publication', async () => {
  const rules = validateSiteRedirects(table([{ from: '/world.html', to: '/fight-club/world/' }]));
  const both = await site(['world.html', 'fight-club/world/index.html']);
  const neither = await site(['index.html']);
  try {
    await assert.rejects(siteRedirectState(both, rules), /still publishes \/world\.html/);
    await assert.rejects(siteRedirectState(neither, rules), /neither/);
  } finally {
    await rm(both, { recursive: true, force: true });
    await rm(neither, { recursive: true, force: true });
  }
});

test('a deployment must answer each spelling with the status, the target and the query', async () => {
  const rules = validateSiteRedirects(table([{ from: '/world.html', to: '/fight-club/world/' }]));
  /** @type {string[]} */
  const asked = [];
  const answer = (/** @type {string} */ location, status = 301) =>
    /** @type {typeof fetch} */ (
      async url => {
        asked.push(String(url));
        return new Response(null, { status, headers: { location } });
      }
    );
  await verifySiteRedirects('https://preview.example/', rules, answer('/fight-club/world/?lang=ko'));
  assert.deepEqual(asked, ['https://preview.example/world.html?lang=ko', 'https://preview.example/world?lang=ko']);
  await assert.rejects(verifySiteRedirects('https://preview.example/', rules, answer('/fight-club/world/')), /expected 301/);
  await assert.rejects(verifySiteRedirects('https://preview.example/', rules, answer('/fight-club/world/?lang=ko', 302)), /answered 302/);
  await assert.rejects(verifySiteRedirects('https://preview.example/', rules, answer('/world/?lang=ko')), /expected/);
});
