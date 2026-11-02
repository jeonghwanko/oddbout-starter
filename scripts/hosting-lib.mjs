// @ts-check
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { policyFiles } from './build-plugin-policy-site.mjs';
import { discoveryFiles } from './site-discovery.mjs';
import { updatesPublishedFiles } from './site-updates.mjs';

export const hosting = JSON.parse(await readFile(new URL('../deploy/creator-site.json', import.meta.url), 'utf8'));
/** @type {(cwd: string, ...args: string[]) => string} */
export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// Rewrite public site and homepage links while retaining repository documentation links.
/** @param {string} text */
export function publicSiteText(text) {
  const base = new URL('.', hosting.siteUrl).href;
  // The game's pages may still carry the repository's old name (ai-fighter-dots-starter) until they are re-saved.
  return text.replaceAll('https://jeonghwanko.github.io/ai-fighter-dots-starter/', base)
    .replaceAll('https://jeonghwanko.github.io/oddbout-starter/', base)
    .replaceAll(base + 'league.html', base)
    .replaceAll('./league.html', './')
    .replace(/((?:\\)?["'])league\.html(?=(?:\\)?["'])/g, '$1');
}
export const siteEntries = ['creator.html', 'fighter.html', 'league.html', 'fighters.html', 'about.html', 'service.html', 'service.ko.html', 'docs.html', 'privacy.html', 'credits.html', 'admin.html', 'world.html'];

// The kit has its own immutable release/fingerprint. Restore it only after verifying
// a newly built site's own artifact, then prove its staged Git objects are unchanged.
/** @param {string} checkout */
export function restoreCreatorKitReleases(checkout) {
  const entry = git(checkout, 'ls-tree', 'HEAD', '--', 'creator-kit');
  if (!entry) return 0;
  if (!/^040000 tree [a-f0-9]{40}\tcreator-kit$/.test(entry)) throw Error('Unexpected creator-kit object in hosting branch');
  git(checkout, 'checkout', 'HEAD', '--', 'creator-kit');
  return git(checkout, 'ls-tree', '-r', '--name-only', 'HEAD', '--', 'creator-kit').split('\n').filter(Boolean).length;
}

/** @param {string} checkout */
export function assertCreatorKitsUnchanged(checkout) {
  if (git(checkout, 'diff', '--cached', '--name-only', 'HEAD', '--', 'creator-kit'))
    throw Error('A whole-site deployment must preserve existing creator-kit releases; use the additive kit publisher.');
}

/** @param {Buffer} data @param {string} path */
function assertPublicContent(data, path) {
  if (!['sb_secret_', 'afw_', 'AI_FIGHTER_WAKE_TOKEN', 'PRIVATE KEY', 'api.render.com', 'eyJ'].some(value => data.includes(value))) return;
  const text = data.toString('utf8').replaceAll('\\/', '/');
  const privateValue = /sb_secret_[A-Za-z0-9_-]{20,}|afw_[a-f0-9]{64}|AI_FIGHTER_WAKE_TOKEN["'\s:=\\]+[a-f0-9]{64}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https:\/\/api\.render\.com\/deploy\/[^\s"'<>]*[?&]key=[A-Za-z0-9_-]+/;
  if (privateValue.test(text)) throw new Error(`Private credential found in artifact: ${path}`);
  for (const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
    let claims;
    try { claims = JSON.parse(/** @type {string} */ (/** @type {unknown} */ (Buffer.from(token.split('.')[1], 'base64url')))); } catch { continue; }
    if (claims.role === 'service_role') throw new Error(`Private credential found in artifact: ${path}`);
  }
}

// Reject source files, credentials and links before copying anything to the public branch.
/** @param {string} root @param {{ gitCheckout?: boolean }} [options] */
export async function fingerprint(root, { gitCheckout = false } = {}) {
  const hash = createHash('sha256');
  let files = 0, bytes = 0;
  /** @param {string} dir */
  async function visit(dir, prefix = '') {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = prefix + entry.name;
      // Only the publisher's freshly cloned checkout may contain its Git directory.
      if (gitCheckout && path === '.git' && entry.isDirectory()) continue;
      if (entry.isSymbolicLink() || /(^|\/)(\.git(?:hub|attributes|modules)?|\.env[^/]*|node_modules|\.secret|\.ssh)(\/|$)|\.(?:tsx?|map|pem|key)$/i.test(path)) {
        throw new Error(`Non-public artifact rejected: ${path}`);
      }
      if (entry.isDirectory()) await visit(join(dir, entry.name), path + '/');
      else if (entry.isFile()) {
        const data = await readFile(join(dir, entry.name));
        if (data.length >= 100 * 1024 * 1024) throw new Error(`Artifact exceeds GitHub's single-file limit: ${path}`);
        assertPublicContent(data, path);
        if (path === 'deployment.json') continue; // Inspect the marker, but do not hash itself.
        if (data.subarray(0, 42).toString().startsWith('version https://git-lfs.github.com/spec/v1')) {
          throw new Error(`Unresolved Git LFS asset: ${path}`);
        }
        bytes += data.length; files++;
        if (bytes > 950 * 1024 * 1024) throw new Error('Pages artifact exceeds the 950 MiB safety limit');
        hash.update(path + '\0' + createHash('sha256').update(data).digest('hex') + '\n');
      } else throw new Error(`Unsupported artifact: ${path}`);
    }
  }
  await visit(root);
  return { digest: hash.digest('hex'), files, bytes };
}

/** @param {string} root @param {{ gitCheckout?: boolean }} [options] */
export async function verifyArtifact(root, options) {
  for (const path of [...siteEntries, ...policyFiles, ...discoveryFiles, 'index.html', '.nojekyll', '.vite/manifest.json']) {
    if (!(await stat(join(root, path))).isFile()) throw new Error(`Missing site entry: ${path}`);
  }
  if (hosting.customDomain && (await readFile(join(root, 'CNAME'), 'utf8')).trim() !== hosting.customDomain) {
    throw new Error('Custom domain CNAME does not match the configured site');
  }
  const release = JSON.parse(await readFile(join(root, 'deployment.json'), 'utf8'));
  if (release.siteUrl !== hosting.siteUrl || release.dirty !== false ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(release.buildId ?? '') ||
      !Number.isFinite(Date.parse(release.builtAt)) ||
      !/^[a-f0-9]{40}$/.test(release.sourceCommit) || !/^[a-f0-9]{40}$/.test(release.hostingCommit)) {
    throw new Error('Artifact requires clean, committed sources and the configured site');
  }
  // The pages' module graph resolves and every file it names is in the build, before anything is pushed (2026-10-31: the graph was first
  // walked by the live check, so a page it could not follow — service.html — stopped the publication after the site was already live and
  // the game's later step, its creation context, did not run).
  for (const file of await publishedFiles(root)) {
    if (!(await stat(join(root, file)).catch(() => null))?.isFile()) throw new Error(`Missing built asset: ${file}`);
  }
  const measured = await fingerprint(root, options);
  if (measured.digest !== release.digest || measured.files !== release.files || measured.bytes !== release.bytes) {
    throw new Error('Artifact changed after build; rebuild before publishing');
  }
  return release;
}

/** A hiccup of the host, worth asking again: rate limiting and server errors. A missing file or wrong bytes are not one. */
const TRANSIENT = new Set([429, 500, 502, 503, 504]);
/** The waits before asking again after a hiccup (2026-10-30: one font's brief 503 stopped a publish after the build was live). */
const RETRY_WAITS_MS = [2000, 5000];

/**
 * A published file's 200 response; a hiccup (a status above, a failed connection or a timeout) is asked again after each wait.
 * @param {URL} url @param {string} file @param {typeof fetch} request @param {(ms: number) => Promise<unknown>} wait
 */
async function fetchPublished(url, file, request, wait) {
  for (let attempt = 0; ; attempt++) {
    const response = await request(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000) }).catch(error => error);
    const answered = typeof response?.status === 'number';
    if (answered && response.status === 200) return response;
    if (answered) await response.body?.cancel().catch(() => {});
    const status = answered ? response.status : response?.name ?? 'no-response';
    if ((answered && !TRANSIENT.has(status)) || attempt >= RETRY_WAITS_MS.length) throw new Error(`Published asset unavailable: ${file} (${status})`);
    await wait(RETRY_WAITS_MS[attempt]);
  }
}

/**
 * The files a published site serves from this build: the entry documents, policies and discovery files, and every module, style and asset
 * the pages reach through the Vite manifest. A page whose entry chunk Vite dropped (two documents sharing one module — the service
 * translations) is followed through the module tags it emitted. Both checks walk it: before the push every file must be in the build
 * (`verifyArtifact`), after it every file must be served with the built bytes (`verifyLiveSite`).
 * @param {string} root @param {string} [siteUrl]
 */
export async function publishedFiles(root, siteUrl = hosting.siteUrl) {
  const manifest = JSON.parse(await readFile(join(root, '.vite/manifest.json'), 'utf8'));
  const files = new Set(['index.html', ...siteEntries, ...policyFiles, ...discoveryFiles, ...(hosting.customDomain ? ['CNAME'] : [])]), visited = new Set();
  /** @param {string} key */
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const entry = manifest[key];
    if (!entry || typeof entry.file !== 'string') throw new Error(`Missing Vite entry: ${key}`);
    for (const file of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) files.add(file);
    for (const imported of [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]) visit(imported);
  }
  for (const page of siteEntries) {
    if (manifest[page]) { visit(page); continue; }
    // Vite can remove an HTML entry chunk when two documents share the same module (the service translations).
    // Follow the emitted module tags instead, still requiring their manifest graph and checking both HTML documents.
    const html = await readFile(join(root, page), 'utf8');
    let modules = 0;
    for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
      const attributes = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(match => [match[1], match[2]]));
      const module = /^<script\b/i.test(tag) && attributes.type === 'module';
      const stylesheet = /^<link\b/i.test(tag) && attributes.rel === 'stylesheet';
      if (!module && !stylesheet) continue;
      const reference = module ? attributes.src : attributes.href;
      if (!reference) throw new Error(`Missing emitted asset URL: ${page}`);
      const base = new URL('.', siteUrl), url = new URL(reference, new URL(page, base));
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.search || url.hash) {
        throw new Error(`Unsafe emitted asset URL: ${page}`);
      }
      const file = url.pathname.slice(base.pathname.length);
      files.add(file);
      if (module) {
        const key = Object.keys(manifest).find(key => manifest[key].file === file);
        if (!key) throw new Error(`Missing Vite module: ${page}: ${file}`);
        visit(key); modules++;
      }
    }
    if (!modules) throw new Error(`Missing Vite entry: ${page}`);
  }
  for (const file of await updatesPublishedFiles(root, siteUrl)) files.add(file);
  for (const file of files) {
    if (!file || /(^|\/)\.\.(\/|$)|[\\?#]/.test(file) || file.startsWith('/') || /^[a-z]+:/i.test(file)) {
      throw new Error('Unsafe manifest asset path');
    }
  }
  return files;
}

/**
 * Check the actual entry documents and manifest asset bytes, not just HTTP 200.
 * @param {string} root @param {{ siteUrl?: string, request?: typeof fetch, wait?: (ms: number) => Promise<unknown> }} [options]
 */
export async function verifyLiveSite(root, { siteUrl = hosting.siteUrl, request = fetch, wait = ms => new Promise(done => setTimeout(done, ms)) } = {}) {
  const files = await publishedFiles(root, siteUrl);
  for (const file of files) {
    const url = new URL(file, siteUrl);
    const response = await fetchPublished(url, file, request, wait);
    const mime = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css'
      : /\.(?:m?js)$/.test(file) ? /^(?:text|application)\/javascript$/
      : file.endsWith('.wasm') ? 'application/wasm'
      : file.endsWith('.webp') ? 'image/webp' : file.endsWith('.json') ? 'application/json'
      : file.endsWith('.xml') ? /^(?:application|text)\/xml$/ : file.endsWith('.txt') ? 'text/plain' : null;
    const actualMime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (mime && (typeof mime === 'string' ? actualMime !== mime : !mime.test(actualMime))) {
      throw new Error(`Incorrect published content type: ${file}`);
    }
    const expected = await readFile(join(root, file));
    const actual = createHash('sha256');
    let bytes = 0;
    for await (const chunk of response.body ?? []) {
      bytes += chunk.length;
      if (bytes > expected.length) throw new Error(`Published asset differs from build: ${file}`);
      actual.update(chunk);
    }
    if (bytes !== expected.length || actual.digest('hex') !== createHash('sha256').update(expected).digest('hex')) {
      throw new Error(`Published asset differs from build: ${file}`);
    }
  }
}

/** Capture before building and compare after: a later commit must not label earlier bytes. @param {string} source @param {string} hostingRoot */
export function buildRevision(source, hostingRoot) {
  if (git(source, 'status', '--porcelain', '--', '.', ':!tsconfig.tsbuildinfo') ||
      git(hostingRoot, 'status', '--porcelain')) throw new Error('Build requires clean source inputs and hosting checkout');
  return { sourceCommit: git(source, 'rev-parse', 'HEAD'), hostingCommit: git(hostingRoot, 'rev-parse', 'HEAD') };
}

/** @param {ReturnType<typeof buildRevision>} before @param {ReturnType<typeof buildRevision>} after */
export function assertSameRevision(before, after) {
  if (before.sourceCommit !== after.sourceCommit || before.hostingCommit !== after.hostingCommit) {
    throw new Error('Source revision changed during build; rebuild from a stable checkout');
  }
}

/** @param {string | URL} url @param {(body: any) => unknown} predicate @param {{ timeoutMs?: number, intervalMs?: number }} [options] */
export async function waitForJson(url, predicate, { timeoutMs = 15 * 60_000, intervalMs = 15_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(Math.min(30_000, deadline - Date.now())) });
      if (response.ok && predicate(await response.json())) return;
    } catch { /* A cold start or deploy may temporarily be unavailable. */ }
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
  }
  throw new Error('Deployment not confirmed before timeout; inspect the hosting dashboard before retrying');
}
