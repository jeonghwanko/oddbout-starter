import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, cp, rm, readFile } from 'node:fs/promises';
import { policyFiles, buildPluginPolicySite, sitePrivacyNotice } from '../scripts/build-plugin-policy-site.mjs';
import { discoveryFiles } from '../scripts/site-discovery.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint, hosting, verifyArtifact, verifyLiveSite, siteEntries, buildRevision, assertSameRevision, git, waitForJson } from '../scripts/hosting-lib.mjs';
import { createServer } from 'node:http';

test('published policies have effective dates and working local links, while previews remain marked', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fighter-policy-test-'));
  try {
    const destination = join(root, 'ai-fighter-creator');
    await buildPluginPolicySite(destination);
    assert.match(await readFile(join(destination, 'terms.html'), 'utf8'), /POLICY PREVIEW/);
    await buildPluginPolicySite(destination, { publish: true });
    for (const file of policyFiles.filter(file => file.endsWith('.html'))) {
      const html = await readFile(join(root, file), 'utf8');
      assert.match(html, /Lucas Foundation/);
      assert.match(html, /Effective: 2 November 2026|시행일: 2026-11-02/);
      assert.match(html, /rel="canonical"/);
      assert.doesNotMatch(html, /POLICY PREVIEW|publication pending|공개 준비본|name="robots" content="noindex"|Supervillain Labs/);
      assert.doesNotMatch(html, /일체의? 책임|any responsibility at all|under no circumstances/i, file);
      for (const match of html.matchAll(/(?:href|src)="\.\/([^"#]+)(?:#[^"]*)?"/g)) {
        await readFile(join(destination, match[1]));
      }
    }
    // Who runs it and what it answers for (2026-11-02), with the carve-out that keeps the exclusions valid (약관규제법 제7조 1호).
    const terms = await readFile(join(destination, 'terms.html'), 'utf8'), termsKo = await readFile(join(destination, 'terms.ko.html'), 'utf8');
    assert.match(terms, /small independent team of individuals/); assert.match(terms, /Unless caused by our intent or gross negligence/);
    assert.match(termsKo, /운영자의 고의 또는 중대한 과실로 인한 경우가 아니면/);
    const source = '<section id="scope"><p>The service is operated by Supervillain Labs.</p></section><section id="data">Preserve data practices</section>';
    const updated = sitePrivacyNotice(source);
    assert.match(updated, /operated by Lucas Foundation/);
    assert.match(updated, /href="\/ai-fighter-creator\/privacy.ko.html"/);
    assert.match(updated, /<section id="data">Preserve data practices<\/section>/);
    assert.throws(() => sitePrivacyNotice('<main>Unexpected privacy source</main>'), /Privacy source changed/);
  } finally { await rm(root, { recursive: true }); }
});

test('public artifacts reject changed bytes, private inputs and dirty source metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fighter-artifact-test-'));
  try {
    await mkdir(join(root, '.vite')); await mkdir(join(root, 'assets'));
    await buildPluginPolicySite(join(root, 'ai-fighter-creator'), { publish: true });
    for (const file of [...siteEntries, ...discoveryFiles, 'index.html', '.nojekyll', 'assets/main.js']) {
      await writeFile(join(root, file), 'test');
    }
    // Every page's entry, as Vite writes it: the artifact check walks the graph before anything is pushed (2026-10-31).
    await writeFile(join(root, '.vite/manifest.json'), JSON.stringify(Object.fromEntries(siteEntries.map(page => [page, { file: 'assets/main.js' }]))));
    if (hosting.customDomain) await writeFile(join(root, 'CNAME'), hosting.customDomain + '\n');
    const release = { siteUrl: hosting.siteUrl, buildId: '11111111-1111-4111-8111-111111111111', builtAt: new Date().toISOString(),
      sourceCommit: 'a'.repeat(40), hostingCommit: 'b'.repeat(40), dirty: false, ...await fingerprint(root) };
    await writeFile(join(root, 'deployment.json'), JSON.stringify(release));
    await verifyArtifact(root);
    if (hosting.customDomain) {
      await writeFile(join(root, 'CNAME'), 'wrong.example\n');
      await assert.rejects(verifyArtifact(root), /Custom domain CNAME/);
      await writeFile(join(root, 'CNAME'), hosting.customDomain + '\n');
    }
    await writeFile(join(root, 'deployment.json'), JSON.stringify({ ...release, buildId: undefined }));
    await assert.rejects(verifyArtifact(root), /clean, committed/);
    await writeFile(join(root, 'deployment.json'), JSON.stringify(release));
    const clone = join(root, 'copy');
    await mkdir(clone);
    for (const file of [...siteEntries, ...discoveryFiles, 'ai-fighter-creator', 'assets', 'index.html', '.nojekyll', '.vite', 'deployment.json', ...(hosting.customDomain ? ['CNAME'] : [])]) {
      await cp(join(root, file), join(clone, file), { recursive: true });
    }
    await mkdir(join(clone, '.git'));
    await verifyArtifact(clone, { gitCheckout: true });
    await writeFile(join(clone, 'creator.html'), 'changed during copy');
    await assert.rejects(verifyArtifact(clone, { gitCheckout: true }), /changed after build/);
    await rm(clone, { recursive: true });
    await rm(join(root, 'ai-fighter-creator/terms.html'));
    await assert.rejects(verifyArtifact(root), /ENOENT/);
    await buildPluginPolicySite(join(root, 'ai-fighter-creator'), { publish: true });
    await writeFile(join(root, 'fighter.html'), 'changed');
    await assert.rejects(verifyArtifact(root), /changed after build/);
    await writeFile(join(root, '.env.production'), 'private');
    await assert.rejects(fingerprint(root), /Non-public/);
    await rm(join(root, '.env.production'));
    await writeFile(join(root, 'deployment.json'), JSON.stringify({ ...release, dirty: true }));
    await assert.rejects(verifyArtifact(root), /clean, committed/);
  } finally { await rm(root, { recursive: true }); }
});

test('credentials are rejected in copied JSON, HTML, CSS, and the unhashed deployment marker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fighter-secret-test-'));
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('{"role":"service_role"}').toString('base64url')}.fakeSignature`;
  try {
    for (const [file, credential] of [
      ['settings.json', 'sb_secret_' + 'a'.repeat(32)],
      ['index.html', 'afw_' + 'a'.repeat(64)],
      ['style.css', '-----BEGIN OPENSSH PRIVATE KEY-----'],
      ['deployment.json', 'https://api.render.com/deploy/srv-test?key=example'],
      ['settings.json', jwt],
      ['settings.json', 'AI_FIGHTER_WAKE_TOKEN = ' + 'b'.repeat(64)],
    ]) {
      await writeFile(join(root, file), '\0' + JSON.stringify({ credential }));
      await assert.rejects(fingerprint(root), error => /Private credential/.test(error.message) && !error.message.includes(credential));
      await rm(join(root, file));
    }
    await mkdir(join(root, '.github'));
    await assert.rejects(fingerprint(root), /Non-public/);
  } finally { await rm(root, { recursive: true }); }
});

test('live checks reject missing or wrong asset bytes even when entry HTML returns 200', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fighter-live-test-'));
  try {
    await mkdir(join(root, '.vite'));
    await mkdir(join(root, 'assets'));
    await mkdir(join(root, 'ai-fighter-creator'));
    const manifest = Object.fromEntries(siteEntries.map(page => [page, { file: 'assets/main.js', imports: ['shared'], css: ['assets/main.css'] }]));
    manifest.shared = { file: 'assets/shared.js', dynamicImports: ['lazy'] };
    manifest.lazy = { file: 'assets/lazy.js' };
    await writeFile(join(root, '.vite/manifest.json'), JSON.stringify(manifest));
    const content = new Map([...siteEntries, ...policyFiles, ...discoveryFiles, 'index.html', 'assets/main.js', 'assets/main.css', 'assets/shared.js', 'assets/lazy.js', ...(hosting.customDomain ? ['CNAME'] : [])].map(path => [path, `content for ${path}`]));
    for (const [path, value] of content) await writeFile(join(root, path), value);
    let broken = false, missing = false, staleHtml = false, wrongMime = false, stalePolicy = false;
    const request = async url => {
      const path = url.pathname.slice(new URL('.', hosting.siteUrl).pathname.length);
      if (missing && path === 'assets/lazy.js') return new Response('missing', { status: 404 });
      const wrong = (broken && path === 'assets/main.js') || (staleHtml && path === 'creator.html') || (stalePolicy && path === 'ai-fighter-creator/privacy.ko.html');
      const mime = wrongMime ? 'text/plain' : path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : path.endsWith('.xml') ? 'application/xml' : path.endsWith('.txt') ? 'text/plain' : 'text/javascript';
      return new Response(wrong ? '<html>wrong version</html>' : content.get(path), { status: 200, headers: { 'content-type': mime } });
    };
    await verifyLiveSite(root, { request });
    broken = true;
    await assert.rejects(verifyLiveSite(root, { request }), /differs from build/);
    broken = false; missing = true;
    await assert.rejects(verifyLiveSite(root, { request }), /unavailable/);
    missing = false; staleHtml = true;
    await assert.rejects(verifyLiveSite(root, { request }), /differs from build/);
    staleHtml = false; stalePolicy = true;
    await assert.rejects(verifyLiveSite(root, { request }), /differs from build/);
    stalePolicy = false; wrongMime = true;
    await assert.rejects(verifyLiveSite(root, { request }), /content type/);
  } finally { await rm(root, { recursive: true }); }
});

test('shared HTML entries verify emitted modules, styles and transitive assets without a per-page manifest key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fighter-shared-entry-test-'));
  try {
    for (const dir of ['.vite', 'assets', 'ai-fighter-creator']) await mkdir(join(root, dir));
    const manifest = Object.fromEntries(siteEntries.map(page => [page, { file: 'assets/main.js' }]));
    delete manifest['service.html']; delete manifest['service.ko.html'];
    manifest.service = { file: 'assets/service.js', dynamicImports: ['serviceLazy'] };
    manifest.serviceLazy = { file: 'assets/service-lazy.js' };
    await writeFile(join(root, '.vite/manifest.json'), JSON.stringify(manifest));
    const content = new Map([...siteEntries, ...policyFiles, ...discoveryFiles, 'index.html', 'assets/main.js',
      'assets/service.js', 'assets/service-lazy.js', 'assets/service.css', ...(hosting.customDomain ? ['CNAME'] : [])]
      .map(path => [path, `content for ${path}`]));
    for (const page of ['service.html', 'service.ko.html']) content.set(page,
      '<script crossorigin src="./assets/service.js" type="module"></script><link rel="stylesheet" href="/assets/service.css">');
    for (const [path, value] of content) await writeFile(join(root, path), value);
    let broken = '';
    const request = async url => {
      const path = url.pathname.slice(1);
      const mime = path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css'
        : path.endsWith('.xml') ? 'application/xml' : path.endsWith('.txt') ? 'text/plain' : 'text/javascript';
      return new Response(path === broken ? 'wrong bytes' : content.get(path), { headers: { 'content-type': mime } });
    };
    await verifyLiveSite(root, { siteUrl: 'https://example.com/', request });
    for (broken of ['service.html', 'service.ko.html', 'assets/service.js', 'assets/service-lazy.js', 'assets/service.css']) {
      await assert.rejects(verifyLiveSite(root, { siteUrl: 'https://example.com/', request }), /differs from build/);
    }
    broken = '';
    await writeFile(join(root, 'service.html'), '<main>No entry module</main>');
    await assert.rejects(verifyLiveSite(root), /Missing Vite entry: service.html/);
    await writeFile(join(root, 'service.html'), '<script type="module" src="/assets/unknown.js"></script>');
    await assert.rejects(verifyLiveSite(root), /Missing Vite module/);
    await writeFile(join(root, 'service.html'), '<script type="module" src="https://other.example/foreign.js"></script>');
    await assert.rejects(verifyLiveSite(root), /Unsafe emitted asset URL/);
  } finally { await rm(root, { recursive: true }); }
});

test('the artifact check walks the pages\' module graph before the push, shared entries included (2026-10-31)', async () => {
  // The graph was first walked after the push: a page the live check could not follow (service.html) stopped the publication with the
  // site already live, and the game's next step — its creation context — never ran. A build the graph cannot account for stops here now.
  const root = await mkdtemp(join(tmpdir(), 'fighter-artifact-graph-test-'));
  try {
    for (const dir of ['.vite', 'assets']) await mkdir(join(root, dir));
    await buildPluginPolicySite(join(root, 'ai-fighter-creator'), { publish: true });
    const manifest = Object.fromEntries(siteEntries.map(page => [page, { file: 'assets/main.js' }]));
    delete manifest['service.html']; delete manifest['service.ko.html'];
    manifest.service = { file: 'assets/service.js', css: ['assets/service.css'], dynamicImports: ['serviceLazy'] };
    manifest.serviceLazy = { file: 'assets/service-lazy.js' };
    await writeFile(join(root, '.vite/manifest.json'), JSON.stringify(manifest));
    for (const file of [...siteEntries, ...discoveryFiles, 'index.html', '.nojekyll', 'assets/main.js', 'assets/service.js', 'assets/service.css',
      'assets/service-lazy.js']) await writeFile(join(root, file), `content for ${file}`);
    for (const page of ['service.html', 'service.ko.html']) await writeFile(join(root, page), '<script type="module" src="./assets/service.js"></script>');
    if (hosting.customDomain) await writeFile(join(root, 'CNAME'), hosting.customDomain + '\n');
    const seal = async () => writeFile(join(root, 'deployment.json'), JSON.stringify({ siteUrl: hosting.siteUrl,
      buildId: '11111111-1111-4111-8111-111111111111', builtAt: new Date().toISOString(), sourceCommit: 'a'.repeat(40), hostingCommit: 'b'.repeat(40),
      dirty: false, ...await fingerprint(root) }));
    await seal();
    await verifyArtifact(root); // the shared entry is followed through its module tag
    // A module the graph reaches but the build lacks.
    await rm(join(root, 'assets/service-lazy.js')); await seal();
    await assert.rejects(verifyArtifact(root), /Missing built asset: assets\/service-lazy\.js/);
    await writeFile(join(root, 'assets/service-lazy.js'), 'content'); await seal();
    // A page whose entry cannot be followed at all.
    await writeFile(join(root, 'service.ko.html'), '<main>No entry module</main>'); await seal();
    await assert.rejects(verifyArtifact(root), /Missing Vite entry: service\.ko\.html/);
  } finally { await rm(root, { recursive: true }); }
});

test('a passing hiccup of the published site is retried; a missing file or wrong bytes are not (2026-10-30)', async () => {
  // A publish stopped at one font file's brief 503 after the build was live, and the creation context was never published.
  const root = await mkdtemp(join(tmpdir(), 'fighter-live-retry-test-'));
  try {
    await mkdir(join(root, '.vite'));
    await mkdir(join(root, 'assets'));
    await mkdir(join(root, 'ai-fighter-creator'));
    const manifest = Object.fromEntries(siteEntries.map(page => [page, { file: 'assets/main.js', assets: ['assets/font.woff2'] }]));
    await writeFile(join(root, '.vite/manifest.json'), JSON.stringify(manifest));
    const content = new Map([...siteEntries, ...policyFiles, ...discoveryFiles, 'index.html', 'assets/main.js', 'assets/font.woff2', ...(hosting.customDomain ? ['CNAME'] : [])].map(path => [path, `content for ${path}`]));
    for (const [path, value] of content) await writeFile(join(root, path), value);
    const mime = path => path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : path.endsWith('.xml') ? 'application/xml' : path.endsWith('.txt') ? 'text/plain' : path.endsWith('.js') ? 'text/javascript' : 'font/woff2';
    let calls = 0, failures = 0, failure = null;
    const request = async url => {
      const path = url.pathname.slice(new URL('.', hosting.siteUrl).pathname.length);
      if (path === 'assets/font.woff2') {
        calls++;
        if (failures > 0) { failures--; if (failure === 'network') throw new TypeError('fetch failed'); return new Response('busy', { status: failure }); }
      }
      return new Response(content.get(path), { status: 200, headers: { 'content-type': mime(path) } });
    };
    const waits = [], wait = async ms => { waits.push(ms); };
    for (const [kind, times] of [[503, 1], ['network', 2], [502, 2], [429, 1]]) {
      calls = 0; failure = kind; failures = times; waits.length = 0;
      await verifyLiveSite(root, { request, wait });
      assert.equal(calls, times + 1, String(kind)); assert.equal(waits.length, times);
    }
    // Still failing after the retries: the publish stops, naming the file and the last status.
    calls = 0; failure = 503; failures = 10;
    await assert.rejects(verifyLiveSite(root, { request, wait }), /Published asset unavailable: assets\/font\.woff2 \(503\)/);
    assert.equal(calls, 3);
    // A missing file is not a hiccup: no retry.
    calls = 0; failure = 404; failures = 10;
    await assert.rejects(verifyLiveSite(root, { request, wait }), /unavailable: assets\/font\.woff2 \(404\)/);
    assert.equal(calls, 1);
  } finally { await rm(root, { recursive: true }); }
});

test('build revisions detect changed inputs and commits while allowing unrelated repo files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fighter-revision-test-'));
  try {
    const sourceRepo = join(root, 'source'), builder = join(root, 'builder');
    for (const dir of [sourceRepo, builder]) {
      await mkdir(dir);
      git(dir, 'init', '-q');
      git(dir, 'config', 'user.name', 'Test');
      git(dir, 'config', 'user.email', 'test@example.invalid');
      await writeFile(join(dir, 'README'), 'fixture');
      git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'fixture');
    }
    const source = join(sourceRepo, 'kaito_web');
    await mkdir(source);
    await writeFile(join(source, 'tsconfig.json'), '{}');
    git(sourceRepo, 'add', '.'); git(sourceRepo, 'commit', '-qm', 'source config');
    const initial = buildRevision(source, builder);
    await writeFile(join(sourceRepo, 'unrelated.txt'), 'unrelated');
    await writeFile(join(source, 'tsconfig.tsbuildinfo'), 'generated');
    assert.deepEqual(buildRevision(source, builder), initial);
    await writeFile(join(source, 'tsconfig.json'), '{"compilerOptions":{}}');
    assert.throws(() => buildRevision(source, builder), /clean source/);
    git(sourceRepo, 'add', 'kaito_web/tsconfig.json'); git(sourceRepo, 'commit', '-qm', 'changed config');
    assert.throws(() => assertSameRevision(initial, buildRevision(source, builder)), /revision changed/);
  } finally { await rm(root, { recursive: true }); }
});

test('a healthy old deployment does not count as the requested commit', async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, commit: ++calls < 3 ? 'old' : 'new' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await waitForJson(url, body => body.ok && body.commit === 'new', { timeoutMs: 1000, intervalMs: 5 });
    assert.equal(calls, 3);
    await assert.rejects(waitForJson(url, body => body.commit === 'missing', { timeoutMs: 30, intervalMs: 5 }), /not confirmed/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
