// @ts-check
// Add exactly one reviewed kit release to the existing Pages tree. Never replace the site.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { localPath } from '../mcp/creation-store.mjs';
import { kitOrigin, releaseMetadata } from './prepare-creator-release.mjs';
import { bootstrapPython } from './bootstrap-python.mjs';
import { loadPublicationEnvironment, publicationConfig, publicationFetch, requestSitePublication } from './site-publication.mjs';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const repository = 'jeonghwanko/oddbout-starter';
const branch = 'codex/creator-pages';
const prefix = `repos/${repository}`;
/** Accept the current workflow publisher and the earlier branch publisher, with the same site target.
 * @param {{ cname?: string, source?: { branch?: string, path?: string }, build_type?: string }} pages */
export function assertPublicationTarget(pages) {
  if (
    pages.cname !== 'oddbout.com' ||
    pages.source?.branch !== branch ||
    pages.source?.path !== '/' ||
    !['legacy', 'workflow'].includes(pages.build_type ?? '')
  )
    throw Error('pages-target-changed');
}
/** @type {(bytes: Buffer) => string} */
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
/** @type {(bytes: Buffer) => string} */
export const gitBlobSha = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
/** @type {(value: unknown) => string} */
const json = value => JSON.stringify(value, null, 2) + '\n';
const proofPaths = [
  'index.html',
  'creator.html',
  'fighter.html',
  'league.html',
  'about.html',
  'docs.html',
  'privacy.html',
  'admin.html',
  'world.html',
  'deployment.json',
  'CNAME',
  '.vite/manifest.json',
];

/** @param {string} directory @param {string} [parent] @returns {Promise<string[]>} */
async function inventory(directory, parent = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = parent + entry.name;
    if (entry.isSymbolicLink()) throw Error('release-symlink-rejected');
    if (entry.isDirectory()) result.push(...(await inventory(path.join(directory, entry.name), relative + '/')));
    else if (entry.isFile()) result.push(relative);
    else throw Error('release-nonregular-file');
  }
  return result.sort();
}

/**
 * A Git tree entry as the GitHub API lists it.
 * @typedef {{ path: string, mode: string, type: string, sha: string }} TreeEntry
 */

/** @param {TreeEntry[]} before @param {TreeEntry[]} after @param {{ path: string, gitSha: string }[]} files */
export function auditAdditiveTree(before, after, files) {
  const old = new Map(before.map(entry => [entry.path, entry]));
  const next = new Map(after.map(entry => [entry.path, entry]));
  if (old.size !== before.length || next.size !== after.length) throw Error('duplicate-git-tree-path');
  const wanted = new Map(files.map(file => [file.path, file]));
  const parents = new Set(
    files.flatMap(file => {
      const parts = file.path.split('/');
      return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
    }),
  );
  for (const [name, previous] of old) {
    const current = next.get(name);
    if (
      !current ||
      current.type !== previous.type ||
      current.mode !== previous.mode ||
      (current.sha !== previous.sha && !(previous.type === 'tree' && parents.has(name)))
    )
      throw Error(`existing-site-entry-changed: ${name}`);
  }
  for (const [name, current] of next) {
    if (old.has(name)) continue;
    if (current.type === 'tree' && current.mode === '040000' && parents.has(name)) continue;
    const expected = wanted.get(name);
    if (!expected || current.type !== 'blob' || current.mode !== '100644' || current.sha !== expected.gitSha)
      throw Error(`unexpected-published-entry: ${name}`);
  }
  for (const file of files) {
    const current = next.get(file.path);
    if (current?.type !== 'blob' || current.mode !== '100644' || current.sha !== file.gitSha) throw Error(`release-path-conflict: ${file.path}`);
  }
  return {
    preservedExistingFiles: before.filter(entry => entry.type !== 'tree').length,
    addedFiles: files.filter(file => !old.has(file.path)).map(file => file.path),
    modifiedOrDeletedExistingFiles: 0,
  };
}

/** @param {string} directory @param {string} expectedManifestHash */
export async function validateCandidate(directory, expectedManifestHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedManifestHash)) throw Error('reviewed-manifest-sha256-required');
  const candidate = path.resolve(directory),
    publicRoot = path.join(candidate, 'public');
  const report = JSON.parse(await readFile(path.join(candidate, 'release-report.json'), 'utf8'));
  if (!/^creator-kit\/(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\/[a-f0-9]{64}\/$/.test(report.relative)) throw Error('invalid-release-path');
  const release = await localPath(publicRoot, report.relative.slice(0, -1), { directory: true });
  const manifestBytes = await readFile(path.join(release, 'release.json'));
  if (sha(manifestBytes) !== expectedManifestHash) throw Error('reviewed-release-changed');
  const manifest = JSON.parse(/** @type {string} */ (/** @type {unknown} */ (manifestBytes))),
    version = report.relative.split('/')[1];
  const archiveFile = path.join(release, `oddbout-${version}.zip`);
  if (!(await lstat(archiveFile)).isFile()) throw Error('archive-not-regular');
  const { stdout } = await execute(bootstrapPython(), [path.join(root, 'scripts/fetch-creator-kit.py'), 'inspect', archiveFile], {
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 1024 * 1024,
  });
  const archive = JSON.parse(stdout),
    helper = await readFile(path.join(release, 'fetch-creator-kit.py'));
  const derived = releaseMetadata(archive, helper);
  assert.equal(derived.relative, report.relative, 'release-path-changed');
  assert.deepEqual(manifest, derived.manifest, 'release-files-changed');
  const names = ['release.json', 'fetch-creator-kit.py', `oddbout-${version}.zip`];
  assert.deepEqual(await inventory(publicRoot), names.map(name => report.relative + name).sort(), 'unexpected-public-file');
  const files = [];
  for (const name of names) {
    const bytes = await readFile(path.join(release, name));
    files.push({ path: report.relative + name, bytes, sha256: sha(bytes), gitSha: gitBlobSha(bytes) });
  }
  return { manifest, manifestUrl: derived.manifestUrl, files };
}

/** @param {string} relative @param {number} [limit] */
async function readPublic(relative, limit = 4_000_000) {
  const response = await publicationFetch()(`${kitOrigin}/${relative}`, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (response.status !== 200) throw Error(`public-http-${response.status}: ${relative}`);
  const chunks = [];
  let length = 0;
  for await (const chunk of /** @type {ReadableStream<Uint8Array>} */ (response.body)) {
    length += chunk.length;
    if (length > limit) throw Error(`public-size-limit: ${relative}`);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  return { path: relative, status: response.status, bytes: bytes.length, sha256: sha(bytes), gitSha: gitBlobSha(bytes) };
}

/**
 * What publication-result.json records as the publication proceeds.
 * @typedef {Awaited<ReturnType<typeof readPublic>>} PublicFile
 * @typedef {{ status: string, repository: string, branch: string, releaseManifestSha256: string, manifestUrl: string,
 *   files: { path: string, sha256: string, gitSha: string, bytes: number }[], baseCommit?: string, baseTree?: string,
 *   baseline?: PublicFile[], preservation?: ReturnType<typeof auditAdditiveTree>, preparedCommit?: string, refUpdateAttempted?: boolean,
 *   commit?: string, liveFiles?: PublicFile[], siteAfter?: PublicFile[], branchHeadAfterVerification?: string, verifiedAt?: string,
 *   error?: string }} PublicationSummary
 */

/** @param {string} directory @param {string} attemptDirectory @param {string} expectedManifestHash @param {{ publish?: boolean }} [options] */
export async function publishCreatorKit(directory, attemptDirectory, expectedManifestHash, { publish = false } = {}) {
  await loadPublicationEnvironment();
  publicationConfig();
  if (!attemptDirectory.startsWith('output/')) throw Error('attempt-must-be-under-output');
  const attempt = await localPath(root, attemptDirectory);
  const { manifest, manifestUrl, files } = await validateCandidate(directory, expectedManifestHash);
  await mkdir(attempt); // Preserve request bodies and results; never overwrite an earlier attempt.
  await mkdir(path.join(attempt, 'requests'));
  let requestNumber = 0;
  /** @type {(endpoint: string, method?: string, body?: unknown) => Promise<any>} */
  const api = async (endpoint, method = 'GET', body) => {
    const args = ['api', endpoint, '--method', method];
    if (body !== undefined) {
      const file = path.join(attempt, 'requests', `${++requestNumber}.json`);
      await writeFile(file, json(body), { flag: 'wx' });
      args.push('--input', file);
    }
    const { stdout } = await execute('gh', args, { windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    return JSON.parse(stdout);
  };
  const getHead = async () => (await api(`${prefix}/git/ref/heads/${branch}`)).object.sha;
  /** @type {(tree: string) => Promise<TreeEntry[]>} */
  const getTree = async tree => {
    const result = await api(`${prefix}/git/trees/${tree}?recursive=1`);
    if (result.truncated || !Array.isArray(result.tree)) throw Error('incomplete-git-tree');
    return result.tree;
  };
  /** @type {PublicationSummary} */
  const summary = {
    status: 'validating',
    repository,
    branch,
    releaseManifestSha256: expectedManifestHash,
    manifestUrl,
    files: files.map(({ bytes, ...item }) => ({ ...item, bytes: bytes.length })),
  };
  const save = async () => writeFile(path.join(attempt, 'publication-result.json'), json(summary));
  await save();
  try {
    const pages = await api(`${prefix}/pages`);
    assertPublicationTarget(pages);
    const base = await getHead(),
      commit = await api(`${prefix}/git/commits/${base}`);
    const before = await getTree(commit.tree.sha),
      existing = new Map(before.map(entry => [entry.path, entry]));
    summary.baseCommit = base;
    summary.baseTree = commit.tree.sha;
    await writeFile(path.join(attempt, 'tree-before.json'), json(before), { flag: 'wx' });
    summary.baseline = await Promise.all(
      proofPaths.map(async name => {
        const observed = await readPublic(name);
        if (existing.get(name)?.sha !== observed.gitSha) throw Error(`live-site-not-at-current-branch: ${name}`);
        return observed;
      }),
    );
    for (const file of files) {
      const previous = existing.get(file.path);
      if (previous && (previous.sha !== file.gitSha || previous.type !== 'blob' || previous.mode !== '100644'))
        throw Error(`immutable-release-already-exists-with-different-content: ${file.path}`);
    }
    summary.status = 'validated-dry-run';
    await save();
    if (!publish) return summary;
    const additions = files.filter(file => !existing.has(file.path));
    let head = base;
    if (additions.length) {
      const entries = [];
      for (const file of additions) {
        const blob = await api(`${prefix}/git/blobs`, 'POST', { encoding: 'base64', content: file.bytes.toString('base64') });
        if (blob.sha !== file.gitSha) throw Error('uploaded-blob-mismatch');
        entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const tree = await api(`${prefix}/git/trees`, 'POST', { base_tree: commit.tree.sha, tree: entries });
      const after = await getTree(tree.sha);
      summary.preservation = auditAdditiveTree(before, after, files);
      await writeFile(path.join(attempt, 'tree-after.json'), json(after), { flag: 'wx' });
      const created = await api(`${prefix}/git/commits`, 'POST', {
        message: `Add reviewed ODDBOUT ${manifest.version} creator kit without changing the site`,
        tree: tree.sha,
        parents: [base],
      });
      summary.preparedCommit = created.sha;
      await save();
      if ((await getHead()) !== base) throw Error('branch-head-changed-before-publication');
      // A concurrent sibling commit is rejected by GitHub's fast-forward check. Never force.
      summary.status = 'publishing-ref';
      summary.refUpdateAttempted = true;
      await save();
      const updated = await api(`${prefix}/git/refs/heads/${branch}`, 'PATCH', { sha: created.sha, force: false });
      if (updated.object.sha !== created.sha) throw Error('publication-ref-unconfirmed');
      head = created.sha;
    } else summary.preservation = auditAdditiveTree(before, before, files);
    summary.commit = head;
    if (publish) await requestSitePublication(head);
    summary.status = 'published-awaiting-https';
    await save();
    console.log(json({ status: summary.status, commit: head, preservation: summary.preservation }));
    const deadline = Date.now() + 10 * 60_000;
    let lastError;
    while (Date.now() < deadline) {
      try {
        const observed = await Promise.all(
          files.map(async file => {
            const actual = await readPublic(file.path, file.bytes.length);
            if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes.length) throw Error(`public-content-mismatch: ${file.path}`);
            return actual;
          }),
        );
        summary.liveFiles = observed;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
      await delay(15_000);
    }
    if (lastError) throw lastError;
    summary.siteAfter = await Promise.all(proofPaths.map(name => readPublic(name)));
    assert.deepEqual(summary.siteAfter, summary.baseline, 'site-content-changed-during-release');
    summary.branchHeadAfterVerification = await getHead();
    summary.status = 'live-verified';
    summary.verifiedAt = new Date().toISOString();
    await save();
    return summary;
  } catch (/** @type {any} */ error) {
    summary.status = summary.commit
      ? 'published-verification-incomplete'
      : summary.refUpdateAttempted
        ? 'publication-outcome-unknown'
        : 'stopped-before-publication';
    summary.error = error.message;
    await save();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [directory, attempt, hash, option, ...extra] = process.argv.slice(2);
    if (!directory || !attempt || !hash || extra.length || (option && option !== '--publish'))
      throw Error('Usage: node scripts/publish-creator-kit.mjs <release-directory> <output/new-attempt> <reviewed-manifest-sha256> [--publish]');
    console.log(json(await publishCreatorKit(directory, attempt, hash, { publish: option === '--publish' })));
  } catch (/** @type {any} */ error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
