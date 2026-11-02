// @ts-check
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathWithoutLinks, relativeParts } from '../plugins/ai-fighter/local-files.mjs';
import { forkWorker, serialQueue } from './serial-worker.mjs';

/**
 * A package check's verdict. The worker's (server/ai-fighter-package.mjs) carries more fields.
 * @typedef {{ ok: boolean, stage: string, errors: { code: string, path?: string }[], pending?: string[] }} PackageCheck
 */
/** @type {(code: string) => PackageCheck} */
const issue = code => ({ ok: false, stage: 'local-access', errors: [{ code, path: '/manifestPath' }] });
// A local trusted workspace only. Concurrent hostile filesystem replacement needs OS isolation.
/** @param {string} root @param {string} relative */
export async function resolveManifest(root, relative) {
  const parts = relativeParts(relative, /[\\:\0]/);
  if (!parts || !relative.endsWith('/fighter.json')) return null;
  // Every component must exist: a missing one throws (PACKAGE_UNAVAILABLE), a link is refused (PATH_NOT_ALLOWED).
  const canonicalRoot = await realpath(root), target = await pathWithoutLinks(canonicalRoot, parts, { allowMissing: false });
  if (!target) return null;
  const resolved = await realpath(target), within = path.relative(canonicalRoot, resolved);
  if (within.startsWith(`..${path.sep}`) || within === '..' || path.isAbsolute(within)) return null;
  return resolved;
}

/**
 * One decoder at a time: a queue the server shares with packaging, else its own. Two further calls wait their turn;
 * more return VALIDATOR_BUSY. Each run gets its own deadline from the moment it starts.
 * @param {string} root @param {{ timeoutMs?: number, queue?: import('./serial-worker.mjs').SerialQueue }} [options]
 * @returns {(relative: string) => Promise<PackageCheck>}
 */
export function makePackageValidator(root, { timeoutMs = 20000, queue = serialQueue() } = {}) {
  /** @type {(relative: string) => Promise<PackageCheck>} */
  const validateOnce = async relative => {
    try {
      const manifest = await resolveManifest(root, relative);
      if (!manifest) return issue('PATH_NOT_ALLOWED');
      const run = await forkWorker(new URL('./package-worker.mjs', import.meta.url), [manifest], { timeoutMs, heapMb: 128 });
      if (!run.started) return issue('WORKER_START_FAILED');
      return /** @type {PackageCheck | undefined} */ (run.message)
        ?? issue(run.timedOut ? 'VALIDATION_TIMEOUT' : run.code === 0 ? 'WORKER_NO_RESULT' : 'WORKER_FAILED');
    } catch { return issue('PACKAGE_UNAVAILABLE'); }
  };
  return relative => queue(() => validateOnce(relative), () => issue('VALIDATOR_BUSY'));
}
