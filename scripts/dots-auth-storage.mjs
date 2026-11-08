// @ts-check
// Inspect directory metadata only. Never reads, creates, moves or removes credentials.
import { access, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** @param {{ env?: NodeJS.ProcessEnv, home?: string }} [options] @param {{ metadata?: typeof lstat, checkAccess?: typeof access }} [deps] */
export async function inspectGrokAuthStorage(
  { env = process.env, home = (process.platform === 'win32' ? env.USERPROFILE : env.HOME) ?? homedir() } = {},
  { metadata = lstat, checkAccess = access } = {},
) {
  /** @param {string} status @param {string} reason */
  const result = (status, reason) => ({ status, reason, scope: 'directory-metadata-only', loginSaveVerified: false });
  const configured = env.GROK_HOME;
  const target = configured === undefined ? path.join(home, '.grok') : configured;
  // Do not guess a blank/relative override, follow symlinks, or inspect other credential stores.
  if (typeof target !== 'string' || !target.trim() || !path.isAbsolute(target) || /[\x00-\x1f]/.test(target))
    return result('blocked', 'grok-auth-storage-path-invalid');
  const resolved = path.resolve(target),
    root = path.parse(resolved).root;
  const parts = resolved.slice(root.length).split(path.sep).filter(Boolean);
  if (parts.some(p => /^(?:\.codex|\.aws|\.ssh)$/i.test(p))) return result('blocked', 'grok-auth-storage-path-unsupported');
  let current = root,
    nearest = null,
    missing = false;
  try {
    for (const part of ['', ...parts]) {
      if (part) current = path.join(current, part);
      let info;
      try {
        info = await metadata(current);
      } catch (/** @type {any} */ error) {
        if (error.code === 'ENOENT') {
          missing = true;
          break;
        }
        throw error;
      }
      if (info.isSymbolicLink() || !info.isDirectory()) return result('blocked', 'grok-auth-storage-path-unsafe');
      nearest = { directory: current, mode: info.mode };
    }
    if (!nearest) return result('unknown', 'grok-auth-storage-unavailable');
    if (!(nearest.mode & 0o222)) return result('blocked', 'grok-auth-storage-not-writable');
    await checkAccess(nearest.directory, constants.W_OK | constants.X_OK);
    return result('permission-available', missing ? 'grok-auth-storage-creatable' : 'grok-auth-storage-present');
  } catch (/** @type {any} */ error) {
    return result(
      ['EROFS', 'EACCES', 'EPERM'].includes(error.code) ? 'blocked' : 'unknown',
      ['EROFS', 'EACCES', 'EPERM'].includes(error.code) ? 'grok-auth-storage-not-writable' : 'grok-auth-storage-unavailable',
    );
  }
}
