// @ts-check
import { fork } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathWithoutLinks, relativeParts } from '../plugins/ai-fighter/local-files.mjs';

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
 * One decoder at a time. Up to `maxWaiting` further calls wait their turn; more return VALIDATOR_BUSY.
 * Each run gets its own deadline from the moment it starts.
 * @param {string} root @param {{ timeoutMs?: number, maxWaiting?: number }} [options]
 * @returns {(relative: string) => Promise<PackageCheck>}
 */
export function makePackageValidator(root, { timeoutMs = 20000, maxWaiting = 2 } = {}) {
  /** @type {(relative: string) => Promise<PackageCheck>} */
  const validateOnce = async relative => {
    try {
      const manifest = await resolveManifest(root, relative);
      if (!manifest) return issue('PATH_NOT_ALLOWED');
      return await new Promise(resolve => {
        const child = fork(fileURLToPath(new URL('./package-worker.mjs', import.meta.url)), [manifest], {
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: ['--max-old-space-size=128'],
          env: { ...process.env, VIPS_CONCURRENCY: '1' },
        });
        // A result that arrived before the deadline wins, even if the child is slow to exit.
        /** @type {PackageCheck | undefined} */
        let result, timedOut = false;
        const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
        child.on('message', message => { if (!timedOut) result ??= /** @type {PackageCheck} */ (message); });
        child.once('error', () => { clearTimeout(timer); resolve(issue('WORKER_START_FAILED')); });
        child.once('exit', code => { clearTimeout(timer);
          resolve(result ?? issue(timedOut ? 'VALIDATION_TIMEOUT' : code === 0 ? 'WORKER_NO_RESULT' : 'WORKER_FAILED')); });
      });
    } catch { return issue('PACKAGE_UNAVAILABLE'); }
  };
  let pending = 0, tail = Promise.resolve();
  return async relative => {
    if (pending > maxWaiting) return issue('VALIDATOR_BUSY');
    pending++;
    const run = tail.then(() => validateOnce(relative));
    tail = run.then(() => {}, () => {});
    try { return await run; } finally { pending--; }
  };
}
