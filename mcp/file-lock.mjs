// @ts-check
// Cross-process file locks for one workspace (creation sessions, the environment record).
// The holder refreshes the lock's mtime while it works, so a lock left by a killed process goes stale and is
// reclaimed instead of blocking that session forever. Callers in this process queue; other processes wait
// a bounded time and then get the caller's busy code. Locks are not re-entrant: never take the same lock inside it.
import { randomUUID } from 'node:crypto';
import { readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

/** @type {Map<string, Promise<unknown>>} */
const queues = new Map();
/** @type {(file: string) => Promise<number | null>} */
const age = async file => {
  const modified = await stat(file).then(
    info => info.mtimeMs,
    () => null,
  );
  return modified === null ? null : Date.now() - modified;
};
/** @type {(file: string, body: string) => Promise<boolean>} */
const create = (file, body) =>
  writeFile(file, body, { flag: 'wx', mode: 0o600 }).then(
    () => true,
    error => {
      if (error.code === 'EEXIST') return false;
      throw error;
    },
  );

/** Removes `file` if it is still stale. One reclaimer at a time, so a freshly acquired lock is never deleted. @param {string} file @param {number} staleMs */
async function reclaim(file, staleMs) {
  const first = await age(file);
  if (first === null) return true;
  if (first <= staleMs) return false;
  const reaper = `${file}.reap`;
  if (!(await create(reaper, String(process.pid)))) {
    // A reclaimer that was itself killed must not block reclamation forever.
    if (((await age(reaper)) ?? 0) > staleMs) await rm(reaper, { force: true });
    return false;
  }
  try {
    const again = await age(file);
    if (again !== null && again > staleMs) await rm(file, { force: true });
  } finally {
    await rm(reaper, { force: true });
  }
  return true;
}

/**
 * Runs `task` holding `file`. Throws Error(busy) if the lock is not free within `waitMs`.
 * `staleMs` must exceed the longest event-loop stall a holder can have; the heartbeat runs every `staleMs / 4`.
 * @template T
 * @param {string} file @param {() => Promise<T>} task @param {{ busy?: string, waitMs?: number, staleMs?: number }} [options]
 * @returns {Promise<T>}
 */
export async function withFileLock(file, task, { busy = 'lock-busy', waitMs = 10_000, staleMs = 60_000 } = {}) {
  const deadline = Date.now() + waitMs;
  const previous = queues.get(file) ?? Promise.resolve();
  /** @type {((value?: unknown) => void) | undefined} */
  let done;
  const turn = new Promise(resolve => {
      done = resolve;
    }),
    tail = previous.then(() => turn);
  queues.set(file, tail);
  try {
    const timer = new AbortController();
    const waited = await Promise.race([
      previous.then(() => true),
      delay(Math.max(0, deadline - Date.now()), false, { signal: timer.signal }).catch(() => false),
    ]);
    timer.abort();
    if (!waited) throw Error(busy);
    const token = randomUUID();
    for (;;) {
      if (await create(file, JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }))) break;
      if (await reclaim(file, staleMs)) continue;
      if (Date.now() >= deadline) throw Error(busy);
      await delay(100);
    }
    const beat = setInterval(
      () => {
        const now = new Date();
        utimes(file, now, now).catch(() => {});
      },
      Math.max(1, staleMs / 4),
    );
    beat.unref();
    try {
      return await task();
    } finally {
      clearInterval(beat);
      // Release only our own lock; after a reclaim the file may belong to another holder. A delete that fails (a Windows
      // scanner holding the file) must not fail the finished task: the beat has stopped, so the lock goes stale and is reclaimed.
      const held = await readFile(file, 'utf8').then(
        text => JSON.parse(text).token,
        () => null,
      );
      if (held === token) await rm(file, { force: true }).catch(() => {});
    }
  } finally {
    /** @type {() => void} */ (done)(); // set by the Promise executor above
    if (queues.get(file) === tail) queues.delete(file);
  }
}
