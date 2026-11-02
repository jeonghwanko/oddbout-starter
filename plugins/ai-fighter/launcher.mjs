// Install only bundled bytes into a writable, per-user runtime. Never download or run setup here.
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// A sibling, not a runtime file: it ships beside this launcher, which runs before the runtime is unpacked.
import { absoluteParts, isProtected, pathWithoutLinks, relativeParts, renameRetrying } from './local-files.mjs';

const pluginRoot = fileURLToPath(new URL('./', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const exists = file => lstat(file).then(() => true, error => { if (error.code !== 'ENOENT') throw error; return false; });
function child(root, relative) {
  const parts = relativeParts(relative, /[\\:]/);
  if (!parts) throw Error('Invalid bundled path');
  return path.join(root, ...parts);
}

async function safeLocation(target, { source = false } = {}) {
  if (!path.isAbsolute(target)) throw Error('An absolute directory is required.');
  target = path.resolve(target);
  // Codex's code namespaces are not credential stores. Cache bytes are read-only;
  // only this launcher's own directory may use that exception, never caller paths.
  const own = path.relative(pluginRoot, target), ownSource = source && !own.startsWith('..') && !path.isAbsolute(own);
  const { base, parts } = absoluteParts(target);
  if (isProtected(parts, { pluginCache: ownSource })) throw Error('Protected location is not a kit directory.');
  if (!await pathWithoutLinks(base, parts)) throw Error('Kit paths must not contain symlinks.');
}
async function readMetadata(file) {
  await safeLocation(file, { source: true });
  const info = await lstat(file);
  if (!info.isFile() || info.size > 2 * 1024 * 1024) throw Error('Invalid kit metadata file.');
  return readFile(file);
}

/** Inspection never creates a directory, copies a file, installs, logs in or probes a network. */
export async function inspect({ base = process.env.AI_FIGHTER_CREATOR_HOME || path.join(homedir(), '.ai-fighter', 'creator'),
  workspace = process.env.AI_FIGHTER_ROOT, manifestSha256 } = {}) {
  await safeLocation(base);
  if (workspace) await safeLocation(workspace);
  if (await exists(path.join(pluginRoot, 'kit-location.json'))) {
    const location = JSON.parse(await readMetadata(path.join(pluginRoot, 'kit-location.json')));
    await safeLocation(location.runtime); await safeLocation(workspace || location.root);
    return { runtime: await realpath(location.runtime), root: await realpath(workspace || location.root),
      distribution: 'development', registration: 'oddbout-cloud', installed: true };
  }
  const bytes = await readMetadata(path.join(pluginRoot, 'runtime-manifest.json'));
  const digest = hash(bytes), manifest = JSON.parse(bytes);
  if (manifestSha256 !== undefined && (!/^[a-f0-9]{64}$/.test(manifestSha256) || manifestSha256 !== digest)) throw Error('Runtime manifest hash mismatch.');
  if (!manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) throw Error('Invalid runtime manifest.');
  if (manifest.distribution !== 'source' && (manifest.platform !== process.platform || manifest.arch !== process.arch)) throw Error('Unsupported bundle platform.');
  const runtime = path.join(base, 'runtimes', digest), root = workspace || path.join(base, 'workspace');
  await safeLocation(runtime);
  const installed = await exists(path.join(runtime, '.bundle-complete'));
  if (installed && String(await readMetadata(path.join(runtime, '.bundle-complete'))) !== digest) throw Error('Invalid runtime completion marker');
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const source = child(path.join(pluginRoot, 'runtime'), relative); await safeLocation(source, { source: true });
    if (!/^[a-f0-9]{64}$/.test(expected) || !(await lstat(source)).isFile() || hash(await readFile(source)) !== expected) throw Error('Bundle integrity check failed');
    if (installed) {
      const target = child(runtime, relative); await safeLocation(target);
      if (!(await lstat(target)).isFile() || hash(await readFile(target)) !== expected) throw Error('Installed runtime integrity check failed');
    }
  }
  return { runtime, root, distribution: manifest.distribution ?? 'desktop', manifestSha256: digest,
    installed, registration: 'oddbout-cloud', readyForGeneration: false };
}

// Large source bundles can still be held by Windows scanners after the last write.
// Retry the same atomic rename; never delete an existing runtime to make room.
export function commitRuntime(pending, runtime, marker, { move, wait, platform } = {}) {
  // A failure is no failure once another installer has completed the identical content-addressed runtime.
  return renameRetrying(pending, runtime, { stepMs: 100, done: () => exists(marker), move, wait, platform });
}

export async function initialize({ base = process.env.AI_FIGHTER_CREATOR_HOME || path.join(homedir(), '.ai-fighter', 'creator'),
  workspace = process.env.AI_FIGHTER_ROOT, manifestSha256 } = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 12) throw Error('ODDBOUT needs Node.js 22.12 or newer.');
  if (!path.isAbsolute(base)) throw Error('AI_FIGHTER_CREATOR_HOME must be an absolute directory.');
  await safeLocation(base);
  if (workspace) await safeLocation(workspace);
  // Developer installations are explicitly bound to this user's existing checkout, never distributable.
  if (await exists(path.join(pluginRoot, 'kit-location.json'))) {
    const location = JSON.parse(await readMetadata(path.join(pluginRoot, 'kit-location.json')));
    if (!path.isAbsolute(location.runtime) || !path.isAbsolute(workspace || location.root)) throw Error('Invalid development kit path');
    await safeLocation(location.runtime); await safeLocation(workspace || location.root);
    const runtime = await realpath(location.runtime), root = await realpath(workspace || location.root);
    if (!(await stat(runtime)).isDirectory() || !(await stat(root)).isDirectory()) throw Error('Kit directories unavailable');
    return { runtime, root, distribution: 'development', registration: 'oddbout-cloud' };
  }
  const bytes = await readMetadata(path.join(pluginRoot, 'runtime-manifest.json'));
  if (manifestSha256 !== undefined && (!/^[a-f0-9]{64}$/.test(manifestSha256) || hash(bytes) !== manifestSha256)) throw Error('Runtime manifest hash mismatch.');
  const manifest = JSON.parse(bytes);
  if (manifest.distribution !== 'source' && (manifest.platform !== process.platform || manifest.arch !== process.arch))
    throw Error(`This bundle requires ${manifest.platform}-${manifest.arch}; use a bundle built for this computer.`);
  const runtime = path.join(base, 'runtimes', hash(bytes));
  await safeLocation(runtime);
  const marker = path.join(runtime, '.bundle-complete');
  if (!await exists(marker)) {
    await mkdir(path.dirname(runtime), { recursive: true });
    const pending = `${runtime}.pending-${randomUUID()}`;
    await mkdir(pending);
    try {
      for (const [relative, expected] of Object.entries(manifest.files)) {
        const source = child(path.join(pluginRoot, 'runtime'), relative);
        await safeLocation(source, { source: true });
        if (!(await lstat(source)).isFile()) throw Error('Bundle contains a non-regular file');
        const data = await readFile(source);
        if (hash(data) !== expected) throw Error(`Bundle integrity check failed: ${relative}`);
        const target = child(pending, relative);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, data, { flag: 'wx' });
      }
      await writeFile(path.join(pending, '.bundle-manifest.json'), bytes, { flag: 'wx' });
      await writeFile(path.join(pending, '.bundle-complete'), hash(bytes), { flag: 'wx' });
      await commitRuntime(pending, runtime, marker);
    } finally { await rm(pending, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 }); }
  }
  if (String(await readMetadata(marker)) !== hash(bytes)) throw Error('Invalid runtime completion marker');
  await inspect({ base, workspace, manifestSha256 });
  const root = workspace || path.join(base, 'workspace');
  if (!path.isAbsolute(root)) throw Error('AI_FIGHTER_ROOT must be an absolute directory.');
  await mkdir(root, { recursive: true });
  return { root, runtime, platform: `${manifest.platform}-${manifest.arch}`, distribution: manifest.distribution ?? 'desktop',
    registration: 'oddbout-cloud' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [mode, flag, digest, ...extra] = process.argv.slice(2);
    if (!['--status', '--install'].includes(mode) || extra.length || flag && flag !== '--manifest-sha256' || flag && !digest)
      throw Error('Invalid launcher arguments');
    if (mode === '--install' && !/^[a-f0-9]{64}$/.test(digest ?? '')) throw Error('A reviewed runtime manifest hash is required for installation');
    console.log(JSON.stringify(await (mode === '--install' ? initialize : inspect)({ manifestSha256: digest }), null, 2));
  } catch { console.error('launcher-failed: use --status or --install --manifest-sha256 <reviewed-sha256>; check paths, manifest and source integrity'); process.exitCode = 1; }
}
