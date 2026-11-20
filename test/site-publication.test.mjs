import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, open, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicationConfig, loadPublicationEnvironment, cloudflareFetch, assertProviderServesSite } from '../scripts/site-publication.mjs';
import { pagesDeployment, validateCloudflareFiles, verifyPagesPublicApi } from '../scripts/cloudflare-publication.mjs';
import { chatGptEmbedBuild } from '../scripts/chatgpt-embed-site.mjs';

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
  const cloudflare = publicationConfig({
    ODDBOUT_SITE_PROVIDER: 'cloudflare-pages',
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    ODDBOUT_CLOUDFLARE_PROJECT: 'oddbout',
  });
  const canonical = async () => new Response(null, { status: 308, headers: { location: '/' } });
  await assert.rejects(assertProviderServesSite(github, 'https://example.com', canonical), /site-provider-mismatch/);
  await assert.doesNotReject(assertProviderServesSite(github, 'https://example.com', async () => new Response('page')));
  await assert.doesNotReject(
    assertProviderServesSite(
      github,
      'https://example.com',
      async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/' } }),
    ),
  );
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
    await rm(join(root, 'functions'), { recursive: true });
    // Only the generated ChatGPT route rules pass; an edited or unexpected file does not.
    const headers = chatGptEmbedBuild(undefined).headers;
    await writeFile(join(root, '_headers'), '\n' + headers);
    await assert.rejects(validateCloudflareFiles(root), /explicit review: _headers/);
    assert.equal(await validateCloudflareFiles(root, { headers }), 2);
    await writeFile(join(root, '_headers'), headers + '\n/*\n  Access-Control-Allow-Origin: *\n');
    await assert.rejects(validateCloudflareFiles(root, { headers }), /explicit review: _headers/);
    await writeFile(join(root, '_headers'), headers.replace('DENY', 'SAMEORIGIN'));
    await assert.rejects(validateCloudflareFiles(root, { headers }), /explicit review: _headers/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('publication verifies all public reads on Pages and rejects a static or legacy Worker response', async () => {
  const paths = [];
  const preview = 'https://deployment.oddbout.pages.dev/';
  const response = (headers, body = { ok: true }) =>
    new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json', ...headers },
    });
  await verifyPagesPublicApi(preview, async url => {
    paths.push(url.pathname + url.search);
    return response({ 'x-oddbout-api-runtime': 'pages-function' });
  });
  assert.deepEqual(paths, ['/api/ai-fighter/roster', '/api/ai-fighter/rankings', '/api/oddbout-arena/rankings?scope=registered']);
  await assert.rejects(
    verifyPagesPublicApi(preview, async () => response({ 'x-oddbout-cache': 'HIT' })),
    /did not serve JSON/,
  );
  await assert.rejects(
    verifyPagesPublicApi(preview, async () => response({ 'x-oddbout-api-runtime': 'pages-function' }, { ok: false })),
    /did not succeed/,
  );
  // A cold deployment: a timeout and a 503 are asked again; a read that never answers is refused after its attempts.
  const waits = [];
  const tries = new Map();
  await verifyPagesPublicApi(
    preview,
    async url => {
      const n = (tries.get(url.pathname) ?? 0) + 1;
      tries.set(url.pathname, n);
      if (n === 1) throw new DOMException('The operation timed out.', 'TimeoutError');
      if (n === 2) return new Response('busy', { status: 503 });
      return response({ 'x-oddbout-api-runtime': 'pages-function' });
    },
    { wait: async ms => waits.push(ms) },
  );
  assert.deepEqual([...tries.values()], [3, 3, 3]);
  assert.deepEqual(waits, [5_000, 5_000, 5_000, 10_000, 10_000, 10_000]);
  // A deployment's address still spreading: its HTML 404 is asked again; a 404 that stays is refused after the attempts.
  const spread = new Map();
  await verifyPagesPublicApi(
    preview,
    async url => {
      const n = (spread.get(url.pathname) ?? 0) + 1;
      spread.set(url.pathname, n);
      if (n === 1) return new Response('<!DOCTYPE html>', { status: 404, headers: { 'content-type': 'text/html' } });
      return response({ 'x-oddbout-api-runtime': 'pages-function' });
    },
    { wait: async () => {} },
  );
  assert.deepEqual([...spread.values()], [2, 2, 2]);
  await assert.rejects(
    verifyPagesPublicApi(preview, async () => new Response('<!DOCTYPE html>', { status: 404, headers: { 'content-type': 'text/html' } }), {
      wait: async () => {},
    }),
    /did not serve JSON/,
  );
  await assert.rejects(
    verifyPagesPublicApi(
      preview,
      async () => {
        throw new TypeError('fetch failed');
      },
      { wait: async () => {} },
    ),
    /did not answer/,
  );
});

test('Wrangler deployment reports must name the requested project, commit and environment', () => {
  const commit = 'a'.repeat(40);
  /** @param {object} fields */
  const report = fields =>
    [
      JSON.stringify({ type: 'wrangler-session' }),
      JSON.stringify({
        type: 'pages-deploy-detailed',
        pages_project: 'oddbout-forge',
        environment: 'production',
        url: 'https://0123abcd.oddbout-forge.pages.dev',
        deployment_trigger: { metadata: { commit_hash: commit } },
        ...fields,
      }),
    ].join('\n') + '\n';
  const expected = { project: 'oddbout-forge', commit, preview: false };
  assert.equal(pagesDeployment(report({}), expected), 'https://0123abcd.oddbout-forge.pages.dev/');
  assert.equal(pagesDeployment(report({ environment: 'preview' }), { ...expected, preview: true }), 'https://0123abcd.oddbout-forge.pages.dev/');
  for (const fields of [{ pages_project: 'oddbout' }, { environment: 'preview' }, { deployment_trigger: { metadata: { commit_hash: 'b'.repeat(40) } } }]) {
    assert.throws(() => pagesDeployment(report(fields), expected), /metadata does not match/);
  }
  assert.throws(() => pagesDeployment(report({ url: 'https://0123abcd.oddbout-pudding.pages.dev' }), expected), /deployment origin/);
  assert.throws(() => pagesDeployment('', expected), /metadata does not match/);
});
