// @ts-check
// The file tools' forked workers (package validation, packaging). One server shares one queue, so they decode one at a time.
import { fork } from 'node:child_process';

/**
 * Runs one task at a time. Up to `maxWaiting` further calls wait their turn; more get `busy()` without running.
 * @param {{ maxWaiting?: number }} [options]
 */
export function serialQueue({ maxWaiting = 2 } = {}) {
  let pending = 0, tail = Promise.resolve();
  /** @template T @param {() => Promise<T>} task @param {() => T} busy @returns {Promise<T>} */
  return async (task, busy) => {
    if (pending > maxWaiting) return busy();
    pending++;
    const run = tail.then(task);
    tail = run.then(() => {}, () => {});
    try { return await run; } finally { pending--; }
  };
}
/** @typedef {ReturnType<typeof serialQueue>} SerialQueue */

/**
 * Forks `module` and settles once the child has closed: `close` follows the IPC channel, so a result sent just before
 * exit is never lost. Its deadline counts from the fork. On timeout SIGTERM, then SIGKILL after `graceMs`.
 * A message that arrived before the deadline wins, even if the child is slow to exit.
 * @param {URL} module @param {string[]} args @param {{ timeoutMs: number, heapMb: number, graceMs?: number }} options
 * @returns {Promise<{ started: boolean, timedOut: boolean, code: number | null, message?: unknown }>}
 */
export function forkWorker(module, args, { timeoutMs, heapMb, graceMs = 5000 }) {
  return new Promise(resolve => {
    const child = fork(module, args, { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [`--max-old-space-size=${heapMb}`],
      env: { ...process.env, VIPS_CONCURRENCY: '1' } });
    let started = false, timedOut = false, received = false;
    /** @type {unknown} */
    let message;
    /** @type {NodeJS.Timeout | undefined} */
    let kill;
    const timer = setTimeout(() => {
      timedOut = true; child.kill('SIGTERM');
      kill = setTimeout(() => child.kill('SIGKILL'), graceMs);
    }, timeoutMs);
    child.once('spawn', () => { started = true; });
    child.on('message', value => { if (!timedOut && !received) { received = true; message = value; } });
    // Before `spawn` this is a failed start, which may never close; afterwards `close` still follows.
    child.on('error', () => { if (!started) { clearTimeout(timer); resolve({ started, timedOut, code: null }); } });
    child.once('close', code => { clearTimeout(timer); clearTimeout(kill);
      resolve({ started, timedOut, code, ...(received ? { message } : {}) }); });
  });
}
