// @ts-check
// The leased-job loop both of the Render validator's queues share: packages (run.mjs) and profile sets (profile-sets.mjs). Claim a job,
// work on it in its own folder under output/worker-jobs/, then finish it with the verdict or hand it back under its lease.
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// The server lease is five minutes. Downloads stop at four, so the check (20 or 30 s) and the finish fit inside it.
const JOB_DEADLINE_MS = 4 * 60 * 1000;
const FINISH_RETRY_MS = [1000, 3000];

/**
 * An infrastructure failure: a download, the deadline or a checking process. It says nothing about the job, so the worker does not
 * finish it. It hands the job back (release): the attempt is refunded and counted as an infrastructure failure, which the server limits
 * separately. If the hand-back fails, the lease expires and the claim retries it, counting the attempt (three, then worker-attempt-limit).
 */
export class RetryLater extends Error {}

/**
 * Claim one job and finish it, or answer idle. Any other error while working (a bug, a full disk) is not a verdict either: the job is
 * handed back as `worker-error`. Left to expire, each lease spent one of the job's three attempts and a valid package was rejected as
 * worker-attempt-limit (리뷰 2026-11-02).
 * @template {{ leaseToken: string, manifestSha256: string }} Job
 * @param {{ send: (route: string, body: object) => Promise<any>, routes: { claim: string, finish: string, release: string },
 *   idKey: 'submissionId' | 'profileSetId', claim: object, folder: string,
 *   work: (job: Job, directory: string, deadline: AbortSignal) => Promise<{ passed: boolean, result: object }> }} queue
 *   `work` returns the verdict fields of the finish body; `folder` prefixes the job's folder name.
 */
export async function runLeasedJob({ send, routes, idKey, claim, folder, work }) {
  const answer = await send(routes.claim, claim);
  if (answer.stage === 'idle') return answer;
  /** @type {Job} */
  const job = answer;
  /** @type {string} */
  const id = answer[idKey];
  const lease = { [idKey]: id, leaseToken: job.leaseToken };
  /** Best effort: an older API or an outage leaves the lease to expire as before. @param {string} code */
  const release = async code => ({ ok: false, stage: 'retry-later', [idKey]: id, code,
    requeued: await send(routes.release, { ...lease, code }).then(() => true, () => false) });
  const deadline = AbortSignal.timeout(JOB_DEADLINE_MS);
  const base = fileURLToPath(new URL('../output/worker-jobs/', import.meta.url));
  /** @type {string | undefined} */
  let directory;
  let verdict;
  try {
    await mkdir(base, { recursive: true });
    directory = await mkdtemp(path.join(base, folder));
    verdict = await work(job, directory, deadline);
  } catch (error) {
    return await release(error instanceof RetryLater ? error.message : 'worker-error');
  } finally {
    if (directory !== undefined) {
      const relative = path.relative(base, directory);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('unsafe-cleanup');
      await rm(directory, { recursive: true, force: true });
    }
  }
  const finish = { ...lease, manifestSha256: job.manifestSha256, ...verdict };
  // Same lease receipt is retryable; a stale lease can never finalize a new worker's job.
  // Back off (1 s, then 3 s) so a brief outage does not discard a finished check; both fit inside the lease.
  for (let attempt = 0; ; attempt++) {
    try { return { ...(await send(routes.finish, finish)), [idKey]: id }; }
    catch (/** @type {any} */ error) {
      // A finish the server refuses (a validator version it does not take, …) says nothing about the job: hand it back, as for an
      // infrastructure failure (API 점검 2026-10-29). A lost lease is not this worker's to hand back, and a refused worker key stops the worker.
      if (error.status >= 400 && error.status < 500) {
        if (error.status === 401 || error.status === 403 || error.message === 'stale-validation') throw error;
        return release(`finish-refused-${error.message.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`.slice(0, 64));
      }
      if (attempt >= 2) throw error;
    }
    await delay(FINISH_RETRY_MS[attempt]);
  }
}
