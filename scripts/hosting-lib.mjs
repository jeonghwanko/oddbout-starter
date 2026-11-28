// @ts-check
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { policyFiles } from './build-plugin-policy-site.mjs';
import { browserFightingFiles } from './build-browser-fighting-game.mjs';
import { discoveryFiles } from './site-discovery.mjs';
import { updatesPublishedFiles } from './site-updates.mjs';
import { CHATGPT_GAME_ENTRY, chatGptEmbedBuild } from './chatgpt-embed-site.mjs';

export const hosting = JSON.parse(await readFile(new URL('../deploy/creator-site.json', import.meta.url), 'utf8'));
const staticPages = [...policyFiles, ...browserFightingFiles];
const FILE_CHECK_CONCURRENCY = 4;

/** Keep input order and let all in-flight work settle before a caller cleans up.
 * @template T, R @param {T[]} items @param {(item: T) => Promise<R>} check */
export async function* fileCheckBatches(items, check) {
  for (let start = 0; start < items.length; start += FILE_CHECK_CONCURRENCY) {
    const batch = await Promise.allSettled(items.slice(start, start + FILE_CHECK_CONCURRENCY).map(check));
    yield batch.map(result => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
  }
}

/** @param {string} phase @param {number} start */
export function reportPublicationTiming(phase, start) {
  console.log(JSON.stringify({ status: 'publication-timing', phase, ms: Math.round(performance.now() - start) }));
}
/**
 * Node's default 1 MiB output buffer is too small for the site branch: `git ls-tree -r HEAD` of the Pages branch lists thousands of
 * art files (over 1 MiB on 2026-11-20) and failed with ENOBUFS before the Cloudflare upload.
 * @type {(cwd: string, ...args: string[]) => string}
 */
export const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).trim();
// Rewrite public site and homepage links while retaining repository documentation links.
/** @param {string} text @param {boolean} [preserveLeague] */
export function publicSiteText(text, preserveLeague = false) {
  const base = new URL('.', hosting.siteUrl).href;
  // The game's pages may still carry the repository's old name (ai-fighter-dots-starter) until they are re-saved.
  const normalized = text
    .replaceAll('https://jeonghwanko.github.io/ai-fighter-dots-starter/', base)
    .replaceAll('https://jeonghwanko.github.io/oddbout-starter/', base);
  if (preserveLeague) return normalized;
  return normalized
    .replaceAll(base + 'league.html', base)
    .replaceAll('./league.html', './')
    .replace(/((?:\\)?["'])league\.html(?=(?:\\)?["'])/g, '$1');
}
export const siteEntries = [
  'creator.html',
  'fighter.html',
  'league.html',
  'fighters.html',
  'about.html',
  'service.html',
  'service.ko.html',
  'docs.html',
  'privacy.html',
  'credits.html',
  'admin.html',
  'world.html',
];
/**
 * Pages the game moved under the Fight Club (2026-11-28): the old root file → its folder page. A build and its checks use whichever the
 * game source has, so this starter builds both older and newer game commits. The old addresses' 301s are deploy/site-redirects.json.
 * @type {Readonly<Record<string, string>>}
 */
export const movedSiteEntries = Object.freeze({
  'fighters.html': 'fight-club/fighters/index.html',
  'docs.html': 'fight-club/docs/index.html',
  'world.html': 'fight-club/world/index.html',
});
/**
 * `siteEntries` as a tree has them: a moved page at its folder when the tree has that and not the old file.
 * @param {(path: string) => boolean} has
 */
export function siteEntriesIn(has) {
  return siteEntries.map(page => (movedSiteEntries[page] && !has(page) && has(movedSiteEntries[page]) ? movedSiteEntries[page] : page));
}
// Earlier game revisions only ship the legacy entry. New builds also include the operator workspace.
export const adminWorkspaceEntry = 'admin/index.html';

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
  const privateValue =
    /sb_secret_[A-Za-z0-9_-]{20,}|afw_[a-f0-9]{64}|AI_FIGHTER_WAKE_TOKEN["'\s:=\\]+[a-f0-9]{64}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https:\/\/api\.render\.com\/deploy\/[^\s"'<>]*[?&]key=[A-Za-z0-9_-]+/;
  if (privateValue.test(text)) throw new Error(`Private credential found in artifact: ${path}`);
  for (const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
    let claims;
    try {
      claims = JSON.parse(/** @type {string} */ (/** @type {unknown} */ (Buffer.from(token.split('.')[1], 'base64url'))));
    } catch {
      continue;
    }
    if (claims.role === 'service_role') throw new Error(`Private credential found in artifact: ${path}`);
  }
}

// Reject source files, credentials and links before copying anything to the public branch.
/** @param {string} root @param {{ gitCheckout?: boolean }} [options] */
export async function fingerprint(root, { gitCheckout = false } = {}) {
  const hash = createHash('sha256');
  /** @type {string[]} */
  const paths = [];
  let files = 0,
    bytes = 0;
  /** @param {string} dir */
  async function visit(dir, prefix = '') {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = prefix + entry.name;
      // Only the publisher's freshly cloned checkout may contain its Git directory.
      if (gitCheckout && path === '.git' && entry.isDirectory()) continue;
      if (
        entry.isSymbolicLink() ||
        /(^|\/)(\.git(?:hub|attributes|modules)?|\.env[^/]*|node_modules|\.secret|\.ssh)(\/|$)|\.(?:tsx?|map|pem|key)$/i.test(path)
      ) {
        throw new Error(`Non-public artifact rejected: ${path}`);
      }
      if (entry.isDirectory()) await visit(join(dir, entry.name), path + '/');
      else if (entry.isFile()) paths.push(path);
      else throw new Error(`Unsupported artifact: ${path}`);
    }
  }
  await visit(root);
  for await (const batch of fileCheckBatches(paths, async path => {
    const data = await readFile(join(root, path));
    if (data.length >= 100 * 1024 * 1024) throw new Error(`Artifact exceeds GitHub's single-file limit: ${path}`);
    assertPublicContent(data, path);
    if (path === 'deployment.json') return null; // Inspect the marker, but do not hash itself.
    if (data.subarray(0, 42).toString().startsWith('version https://git-lfs.github.com/spec/v1')) {
      throw new Error(`Unresolved Git LFS asset: ${path}`);
    }
    return { path, size: data.length, digest: createHash('sha256').update(data).digest('hex') };
  })) {
    // The release digest still uses the same depth-first, sorted file order.
    for (const file of batch) {
      if (file) {
        bytes += file.size;
        files++;
        if (bytes > 950 * 1024 * 1024) throw new Error('Pages artifact exceeds the 950 MiB safety limit');
        hash.update(file.path + '\0' + file.digest + '\n');
      }
    }
  }
  return { digest: hash.digest('hex'), files, bytes };
}

/** @param {string} root @param {{ gitCheckout?: boolean }} [options] */
export async function verifyArtifact(root, options) {
  const entries = siteEntriesIn(path => existsSync(join(root, path)));
  for (const path of [...entries, ...staticPages, ...discoveryFiles, 'index.html', '.nojekyll', '.vite/manifest.json']) {
    if (!(await stat(join(root, path))).isFile()) throw new Error(`Missing site entry: ${path}`);
  }
  if (hosting.customDomain && (await readFile(join(root, 'CNAME'), 'utf8')).trim() !== hosting.customDomain) {
    throw new Error('Custom domain CNAME does not match the configured site');
  }
  const release = JSON.parse(await readFile(join(root, 'deployment.json'), 'utf8'));
  if (
    release.siteUrl !== hosting.siteUrl ||
    release.dirty !== false ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(release.buildId ?? '') ||
    !Number.isFinite(Date.parse(release.builtAt)) ||
    !/^[a-f0-9]{40}$/.test(release.sourceCommit) ||
    !/^[a-f0-9]{40}$/.test(release.hostingCommit)
  ) {
    throw new Error('Artifact requires clean, committed sources and the configured site');
  }
  // The pages' module graph resolves and every file it names is in the build, before anything is pushed (2026-10-31: the graph was first
  // walked by the live check, so a page it could not follow — service.html — stopped the publication after the site was already live and
  // the game's later step, its creation context, did not run).
  const requiredFiles = [...(await publishedFiles(root))];
  for await (const batch of fileCheckBatches(requiredFiles, async file => ({ file, entry: await stat(join(root, file)).catch(() => null) }))) {
    for (const { file, entry } of batch) if (!entry?.isFile()) throw new Error(`Missing built asset: ${file}`);
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
    const status = answered ? response.status : (response?.name ?? 'no-response');
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
  const chatgpt = chatGptEmbedBuild(hosting.chatgptEmbed);
  const chatgptEntry = await stat(join(root, CHATGPT_GAME_ENTRY)).catch(() => null);
  const includeChatgptEntry = chatgpt.enabled || Boolean(manifest[CHATGPT_GAME_ENTRY]) || chatgptEntry?.isFile() === true;
  if (chatgpt.enabled && !chatgptEntry?.isFile()) throw new Error(`Missing required ChatGPT game entry: ${CHATGPT_GAME_ENTRY}`);
  if (includeChatgptEntry) {
    const headers = await readFile(join(root, '_headers'), 'utf8').catch(() => '');
    if (!headers.includes(chatgpt.headers)) throw new Error('Missing or changed ChatGPT route headers');
  }
  const includeAdminWorkspace = Boolean(manifest[adminWorkspaceEntry]) || (await stat(join(root, adminWorkspaceEntry)).catch(() => null))?.isFile();
  const portal = (await stat(join(root, 'fight-club/index.html')).catch(() => null))?.isFile();
  const portalEntries = portal ? ['index.html', 'home/en/index.html', 'home/ja/index.html'] : [];
  const homes = portal ? ['fight-club/index.html', 'fight-club/ko/index.html', 'fight-club/ja/index.html', 'ko/index.html', 'ja/index.html'] : [];
  const entries = [
    ...siteEntriesIn(path => existsSync(join(root, path))),
    ...portalEntries,
    ...(includeAdminWorkspace ? [adminWorkspaceEntry] : []),
    ...(includeChatgptEntry ? [CHATGPT_GAME_ENTRY] : []),
  ];
  const files = new Set(['index.html', ...homes, ...entries, ...staticPages, ...discoveryFiles, ...(hosting.customDomain ? ['CNAME'] : [])]),
    visited = new Set();
  /** @param {string} key */
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const entry = manifest[key];
    if (!entry || typeof entry.file !== 'string') throw new Error(`Missing Vite entry: ${key}`);
    for (const file of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) files.add(file);
    for (const imported of [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]) visit(imported);
  }
  const base = new URL('.', siteUrl);
  for (const page of entries) {
    const entry = manifest[page];
    if (entry) visit(page);
    if (entry && !portalEntries.includes(page)) continue;
    // HTML images are independent of the module graph. Each translated portal can have its own image URLs.
    const html = await readFile(join(root, page), 'utf8');
    const documentUrl = new URL(page, base);
    const baseHref = /<base\s+href="([^"]+)"/i.exec(html)?.[1];
    const documentBase = baseHref ? new URL(baseHref, documentUrl) : documentUrl;
    if (portalEntries.includes(page)) {
      for (const [, src] of html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"/gi)) {
        const url = new URL(src, documentBase);
        if (url.origin === base.origin && url.pathname.startsWith(base.pathname)) files.add(url.pathname.slice(base.pathname.length));
      }
    }
    if (entry) continue;
    // Vite can merge module entries. Follow emitted tags for pages without their own manifest key.
    let modules = 0;
    for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
      const attributes = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(match => [match[1], match[2]]));
      const module = /^<script\b/i.test(tag) && attributes.type === 'module';
      const stylesheet = /^<link\b/i.test(tag) && attributes.rel === 'stylesheet';
      if (!module && !stylesheet) continue;
      const reference = module ? attributes.src : attributes.href;
      if (!reference) throw new Error(`Missing emitted asset URL: ${page}`);
      const url = new URL(reference, documentBase);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.search || url.hash) {
        throw new Error(`Unsafe emitted asset URL: ${page}`);
      }
      const file = url.pathname.slice(base.pathname.length);
      files.add(file);
      if (module) {
        const key = Object.keys(manifest).find(key => manifest[key].file === file);
        if (!key) throw new Error(`Missing Vite module: ${page}: ${file}`);
        visit(key);
        modules++;
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
  const rootDocument = files.has('fight-club/index.html') ? './' : 'index.html';
  await verifyServedFiles(root, files, { siteUrl, request, wait, rootDocument, concurrent: true });
}

/**
 * Each file, served under `siteUrl`, has the built bytes and its type's content type (the game sites check every file they publish).
 * @param {string} root @param {Iterable<string>} files
 * @param {{ siteUrl: string, request?: typeof fetch, wait?: (ms: number) => Promise<unknown>, rootDocument?: string, concurrent?: boolean }} options
 */
export async function verifyServedFiles(
  root,
  files,
  { siteUrl, request = fetch, wait = ms => new Promise(done => setTimeout(done, ms)), rootDocument = 'index.html', concurrent = false },
) {
  /** @param {string} file */
  async function verify(file) {
    const url = new URL(file === 'index.html' ? rootDocument : file, siteUrl);
    const response = await fetchPublished(url, file, request, wait);
    const mime = file.endsWith('.html')
      ? 'text/html'
      : file.endsWith('.css')
        ? 'text/css'
        : /\.(?:m?js)$/.test(file)
          ? /^(?:text|application)\/javascript$/
          : file.endsWith('.wasm')
            ? 'application/wasm'
            : file.endsWith('.webp')
              ? 'image/webp'
              : file.endsWith('.json')
                ? 'application/json'
                : file.endsWith('.xml')
                  ? /^(?:application|text)\/xml$/
                  : file.endsWith('.txt')
                    ? 'text/plain'
                    : null;
    const actualMime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (mime && (typeof mime === 'string' ? actualMime !== mime : !mime.test(actualMime))) {
      await response.body?.cancel();
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
  if (concurrent) {
    for await (const _batch of fileCheckBatches([...files], verify)) {
      // Each completed batch has verified the response bytes and content types.
    }
  } else {
    for (const file of files) await verify(file);
  }
}

/** Capture before building and compare after: a later commit must not label earlier bytes. @param {string} source @param {string} hostingRoot */
export function buildRevision(source, hostingRoot) {
  if (git(source, 'status', '--porcelain', '--', '.', ':!tsconfig.tsbuildinfo') || git(hostingRoot, 'status', '--porcelain'))
    throw new Error('Build requires clean source inputs and hosting checkout');
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
    } catch {
      /* A cold start or deploy may temporarily be unavailable. */
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
  }
  throw new Error('Deployment not confirmed before timeout; inspect the hosting dashboard before retrying');
}
