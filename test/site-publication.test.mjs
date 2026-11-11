import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, open, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicationConfig, loadPublicationEnvironment, cloudflareFetch, assertProviderServesSite } from '../scripts/site-publication.mjs';
import { validateCloudflareFiles } from '../scripts/cloudflare-publication.mjs';

test('publication defaults to GitHub and rejects unknown or incomplete provider settings', () => {
  assert.equal(publicationConfig({}).provider, 'github-pages');
  assert.throws(() => publicationConfig({ ODDBOUT_SITE_PROVIDER: 'typo' }), /Unsupported/);
  assert.throws(() => publicationConfig({ ODDBOUT_SITE_PROVIDER: 'cloudflare-pages' }), /requires/);
  assert.equal(
    publicationConfig({ ODDBOUT_SITE_PROVIDER: 'cloudflare-pages', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), ODDBOUT_CLOUDFLARE_PROJECT: 'oddbout' }).branch,
    'main',
  );
});

test('private env loads only deployment keys, preserving shell precedence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'site-env-test-'));
  try {
    const file = join(root, '.env');
    await writeFile(file, 'ODDBOUT_SITE_PROVIDER=cloudflare-pages\nCLOUDFLARE_API_TOKEN="test-only"\nVITE_SECRET=never-load\n');
    const env = { ODDBOUT_SITE_PROVIDER: 'github-pages' };
    await loadPublicationEnvironment(env, file);
    assert.equal(env.ODDBOUT_SITE_PROVIDER, 'github-pages');
    assert.equal(env.CLOUDFLARE_API_TOKEN, 'test-only');
    assert.equal(env.VITE_SECRET, undefined);
    await assert.rejects(loadPublicationEnvironment({ ODDBOUT_DEPLOY_ENV_FILE: join(root, 'missing') }), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Cloudflare verification follows only same-origin HTML canonical redirects', async () => {
  for (const [path, location] of [
    ['/fighter.html', '/fighter'],
    ['/index.html', '/'],
    ['/about/index.html', '/about/'],
  ]) {
    const calls = [];
    const request = cloudflareFetch(async (url, init) => {
      calls.push([String(url), init.redirect]);
      return calls.length === 1 ? new Response(null, { status: 308, headers: { location } }) : new Response('exact bytes');
    });
    assert.equal(await (await request('https://example.pages.dev' + path)).text(), 'exact bytes');
    assert.deepEqual(calls[1], ['https://example.pages.dev' + location, 'error']);
  }
  for (const location of ['https://evil.example/fighter', '/login', '/fighter?unexpected=1']) {
    const request = cloudflareFetch(async () => new Response(null, { status: 302, headers: { location } }));
    await assert.rejects(request('https://example.pages.dev/fighter.html'), /Unexpected/);
  }
  await assert.rejects(
    cloudflareFetch(async () => new Response(null, { status: 301, headers: { location: '/assets/x' } }))('https://example.pages.dev/assets/x.js'),
    /Unexpected/,
  );
});

test('the GitHub route refuses a live site that answers like Cloudflare Pages', async () => {
  const github = publicationConfig({});
  const cloudflare = publicationConfig({ ODDBOUT_SITE_PROVIDER: 'cloudflare-pages', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), ODDBOUT_CLOUDFLARE_PROJECT: 'oddbout' });
  const canonical = async () => new Response(null, { status: 308, headers: { location: '/' } });
  await assert.rejects(assertProviderServesSite(github, 'https://example.com', canonical), /site-provider-mismatch/);
  await assert.doesNotReject(assertProviderServesSite(github, 'https://example.com', async () => new Response('page')));
  await assert.doesNotReject(assertProviderServesSite(github, 'https://example.com', async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/' } })));
  let called = false;
  await assert.doesNotReject(assertProviderServesSite(cloudflare, 'https://example.com', async () => ((called = true), new Response('page'))));
  assert.equal(called, false);
});

test('Cloudflare upload rejects oversized assets and executable routing controls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'site-assets-test-'));
  try {
    await writeFile(join(root, 'index.html'), 'site');
    assert.equal(await validateCloudflareFiles(root), 1);
    const asset = await open(join(root, 'large.webp'), 'w');
    await asset.truncate(25 * 1024 * 1024 + 1);
    await asset.close();
    await assert.rejects(validateCloudflareFiles(root), /25 MiB/);
    await rm(join(root, 'large.webp'));
    await mkdir(join(root, 'functions'));
    await assert.rejects(validateCloudflareFiles(root), /explicit review/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
