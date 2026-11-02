// @ts-check
// Local file helpers for the kit, its workspace tools and this plugin's launcher: confined paths, renames that outlast a
// Windows scanner's hold, and file hashes. Node built-ins only, beside launcher.mjs: the launcher imports it before the
// kit is unpacked, and the Dots scripts before npm has installed anything. Each caller keeps its own path policy and
// error codes; only the shared core is here.
import { createHash } from 'node:crypto';
import { lstat, open, rename } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * The components of a '/'-separated relative path, or null when it is not a string, is empty or absolute, has an empty,
 * '.' or '..' component, or contains a character `forbidden` matches (each caller names the characters it refuses).
 * @param {unknown} value @param {RegExp} forbidden
 */
export function relativeParts(value, forbidden) {
  if (typeof value !== 'string' || !value || forbidden.test(value) || path.isAbsolute(value)) return null;
  const parts = value.split('/');
  return parts.some(part => !part || part === '.' || part === '..') ? null : parts;
}

/** An absolute path as its filesystem root and the components below it. @param {string} target */
export function absoluteParts(target) {
  const base = path.parse(target).root;
  return { base, parts: target.slice(base.length).split(path.sep) };
}

// Credential and session stores (Codex, Grok, AWS, SSH, the ODDBOUT sign-in) that a kit path never enters.
export const PROTECTED_PART = /^(?:\.codex|\.grok|\.aws|\.ssh|sessions|auth\.json|client\.json|pending-login\.json)$/i;
/**
 * Whether a component of `parts` is a credential or session store. A Codex worktree (.codex/worktrees/<task>/<checkout>)
 * holds code, not credentials; `pluginCache` also admits a plugin's read-only .codex/plugins/cache/<plugin>/… copy.
 * Anything protected inside those is still protected.
 * @param {string[]} parts @param {{ pluginCache?: boolean }} [options]
 */
export function isProtected(parts, { pluginCache = false } = {}) {
  return parts.some((part, index) => PROTECTED_PART.test(part) && !(part.toLowerCase() === '.codex' &&
    (parts[index + 1] === 'worktrees' && parts.length > index + 3 ||
      pluginCache && parts[index + 1] === 'plugins' && parts[index + 2] === 'cache' && parts.length > index + 3)));
}

/**
 * `parts` joined below `base`, looking at each component in turn with lstat, which never follows a link: null at the
 * first link. A missing component is passed over, so are the ones after it; `allowMissing: false` throws its ENOENT.
 * `visit` sees each component's lstat (null when missing) before the link check: it may create the component and
 * return its new lstat, or throw to refuse it. This is no OS sandbox: a concurrent hostile rename needs OS isolation.
 * @param {string} base @param {string[]} parts
 * @param {{ allowMissing?: boolean,
 *   visit?: (target: string, info: import('node:fs').Stats | null, index: number) => Promise<import('node:fs').Stats | null> }} [options]
 * @returns {Promise<string | null>}
 */
export async function pathWithoutLinks(base, parts, { allowMissing = true, visit } = {}) {
  let target = base;
  for (const [index, part] of parts.entries()) {
    target = path.join(target, part);
    let info = await lstat(target).catch(/** @param {any} error */ error => {
      if (error.code !== 'ENOENT' || !allowMissing) throw error;
      return null;
    });
    if (visit) info = await visit(target, info, index);
    if (info?.isSymbolicLink()) return null;
  }
  return target;
}

// What a Windows virus scanner's brief hold on a just-written file makes a rename throw.
const SCANNER_HOLDS = ['EPERM', 'EACCES', 'EBUSY'];
/**
 * Renames `from` to `to`, retrying while a Windows virus scanner briefly holds a just-written file: up to six retries,
 * each waiting `stepMs` longer than the last. Any other error, a seventh hold, or any error off Windows is thrown.
 * It retries the same atomic rename and never removes `to` to make room: what is there is the only valid copy.
 * @param {string} from @param {string} to
 * @param {{ stepMs?: number, done?: () => Promise<boolean>, move?: (from: string, to: string) => Promise<void>,
 *   wait?: (ms: number) => Promise<unknown>, platform?: string }} [options]
 *   `done`, asked after each failure, is true when another process has already completed the same rename
 */
export async function renameRetrying(from, to, { stepMs = 25, done, move = rename, wait = delay, platform = process.platform } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { await move(from, to); return; }
    catch (/** @type {any} */ error) {
      if (await done?.()) return;
      if (platform !== 'win32' || !SCANNER_HOLDS.includes(error.code) || attempt >= 6) throw error;
      await wait(stepMs * (attempt + 1));
    }
  }
}

/**
 * The SHA-256 of a file's bytes, streamed so that a large file is never held in memory.
 * @param {string | import('node:fs/promises').FileHandle} file a path, or an open handle: read from its position and left open
 */
export async function fileSha256(file) {
  const handle = typeof file === 'string' ? await open(file, 'r') : file;
  try {
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    return hash.digest('hex');
  } finally { if (handle !== file) await handle.close(); }
}
