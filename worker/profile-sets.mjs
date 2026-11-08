// @ts-check
// The validator's second queue (선수 프로필 세트, 2026-10-31): claim a submitted profile set, download its front painting (and expression
// sheet), check them in a child process (profile-set-check.mjs), store the derived card and face (and the arena's sheet) under the lease and finish. The same Render worker drains the package
// queue first (server.mjs). Both queues share the leased-job loop (leased-jobs.mjs): an infrastructure failure hands the set back without
// spending one of its attempts.
import { fork } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRequest, transferTimeoutMs, validProjectUrl } from '../api/client.mjs';
import { readBody, sha256 } from '../api/http.mjs';
import { PROFILE_SET_VALIDATOR_VERSION, parseProfileSet } from '../api/profile-sets.mjs';
import { RetryLater, runLeasedJob } from './leased-jobs.mjs';

const CHECK_TIMEOUT_MS = 30000;

/**
 * A set worker/profile-sets/claim leases (api/profile-sets.mjs).
 * @typedef {{ profileSetId: string, leaseToken: string, manifestText: string, manifestSha256: string,
 *   front: { bytes: number, sha256: string, width: number, height: number, downloadUrl: string }, face: { x: number, y: number, side: number },
 *   expressions?: { bytes: number, sha256: string, width: number, height: number, downloadUrl: string } }} ClaimedSet
 */
/** @typedef {{ ok: boolean, stage?: string, errors: { code: string, path: string }[], derived?: any, sheetErrors?: { code: string, path: string }[] }} ChildVerdict */

/**
 * Run the pixel check in a child process with its own deadline. A child that dies or runs out of time on this painting is its verdict
 * (rejected, with the reason): retrying would meet the same file. Only a child that cannot start is the worker's problem (RetryLater).
 * @param {string} directory @param {{ childModule?: string, timeoutMs?: number }} [options]  tests replace the child and its deadline
 * @returns {Promise<ChildVerdict>}
 */
export function checkInChild(
  directory,
  { childModule = fileURLToPath(new URL('./profile-set-child.mjs', import.meta.url)), timeoutMs = CHECK_TIMEOUT_MS } = {},
) {
  return new Promise((resolve, reject) => {
    const child = fork(childModule, [directory], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      execArgv: ['--max-old-space-size=256'],
      env: { ...process.env, VIPS_CONCURRENCY: '1' },
    });
    /** @type {ChildVerdict | undefined} */
    let result;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on('message', message => {
      if (!timedOut) result ??= /** @type {ChildVerdict} */ (message);
    });
    child.once('error', () => {
      clearTimeout(timer);
      reject(new RetryLater('check-start-failed'));
    });
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(result ?? { ok: false, stage: 'profile-set-check', errors: [{ code: timedOut ? 'CHECK_TIMEOUT' : 'CHECK_CRASHED', path: '' }] });
    });
  });
}

/**
 * Validate one queued profile set, or answer idle.
 * @param {{ url?: string, workerToken?: string }} config @param {string} [profileSetId]
 * @param {{ childModule?: string, timeoutMs?: number }} [check]  tests replace the check's child and deadline
 */
export async function runProfileSetWithConfig(config, profileSetId, check = {}) {
  if (!validProjectUrl(config.url) || !/^afw_[a-f0-9]{64}$/.test(config.workerToken ?? '')) throw new Error('invalid-worker-config');
  const project = /** @type {string} */ (config.url),
    token = /** @type {string} */ (config.workerToken);
  /** @type {(route: string, body: object) => Promise<any>} */
  const send = (route, body) =>
    apiRequest(project, token, route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return runLeasedJob({
    send,
    idKey: 'profileSetId',
    claim: profileSetId ? { profileSetId } : {},
    folder: 'profile-set-',
    routes: { claim: 'worker/profile-sets/claim', finish: 'worker/profile-sets/finish', release: 'worker/profile-sets/release' },
    /** @param {ClaimedSet} job @param {string} directory @param {AbortSignal} deadline */
    work: (job, directory, deadline) => validateProfileSet(project, token, job, directory, deadline, check),
  });
}

/**
 * Download one of a leased set's uploads (signed by the API on this project's private bucket) into its job folder, checked against the set
 * file. Any failure is the infrastructure's: upload already checked these bytes.
 * @param {string} project @param {{ bytes: number, sha256: string }} file @param {string} downloadUrl @param {string} target @param {AbortSignal} deadline
 */
async function download(project, file, downloadUrl, target, deadline) {
  const url = new URL(downloadUrl);
  if (url.origin !== project || !url.pathname.startsWith('/storage/v1/object/sign/ai-fighter-beta/')) throw new RetryLater('invalid-download-origin');
  let bytes;
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(transferTimeoutMs(file.bytes)), deadline]) });
    if (!response.ok) throw new RetryLater('download-failed');
    bytes = await readBody(response, file.bytes);
  } catch (error) {
    throw error instanceof RetryLater ? error : new RetryLater(deadline.aborted ? 'job-deadline' : 'download-failed');
  }
  // A mismatch now is a storage fault, not the creator's painting.
  if (bytes.length !== file.bytes || (await sha256(bytes)) !== file.sha256) throw new RetryLater('download-integrity');
  await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
}

/**
 * Download a leased set's front painting (and expression sheet) into its job folder, check them and store the derived files under the lease.
 * Returns the verdict; an infrastructure failure throws RetryLater.
 * @param {string} project @param {string} token @param {ClaimedSet} job @param {string} directory @param {AbortSignal} deadline
 * @param {{ childModule?: string, timeoutMs?: number }} check
 */
async function validateProfileSet(project, token, job, directory, deadline, check) {
  /** @type {ChildVerdict} */
  let verdict;
  /** @type {any} */
  let derived = null;
  if ((await sha256(new TextEncoder().encode(job.manifestText))) !== job.manifestSha256) throw new RetryLater('server-manifest-hash');
  const parsed = parseProfileSet(job.manifestText);
  if (!parsed.ok) verdict = { ok: false, stage: 'server-manifest', errors: [{ code: 'invalid-server-manifest', path: '' }] };
  else {
    const { front, expressions } = parsed.data;
    await download(project, front, job.front.downloadUrl, path.join(directory, 'front.webp'), deadline);
    if (expressions) {
      if (typeof job.expressions?.downloadUrl !== 'string') throw new RetryLater('server-expressions-link');
      await download(project, expressions, job.expressions.downloadUrl, path.join(directory, 'expressions.webp'), deadline);
    }
    await writeFile(path.join(directory, 'set.json'), JSON.stringify(parsed.data), { flag: 'wx', mode: 0o600 });
    verdict = await checkInChild(directory, check);
    if (deadline.aborted) throw new RetryLater('job-deadline');
    if (verdict.ok) {
      /** @type {Record<string, { sha256: string, bytes: number }>} */
      const stored = {};
      for (const name of ['card', 'face', ...(verdict.derived.sheet ? ['sheet'] : [])]) {
        const file = await readFile(path.join(directory, `${name}.webp`)),
          hash = await sha256(file);
        let answer;
        try {
          answer = await apiRequest(project, token, `worker/profile-sets/${job.profileSetId}/derived/${name}`, {
            method: 'PUT',
            headers: { 'content-type': 'image/webp', 'x-profile-set-lease': job.leaseToken },
            body: file,
          });
        } catch {
          throw new RetryLater('derived-upload-failed');
        }
        if (answer.sha256 !== hash || answer.bytes !== file.length) throw new RetryLater('derived-upload-integrity');
        stored[name] = { sha256: hash, bytes: file.length };
      }
      derived = {
        card: { ...stored.card, ...verdict.derived.card },
        face: { ...stored.face, ...verdict.derived.face },
        ...(stored.sheet ? { sheet: { ...stored.sheet, ...verdict.derived.sheet } } : {}),
      };
    }
  }
  /** @type {(errors: { code: string, path?: string }[]) => { code: string, path: string }[]} */
  const listed = errors => errors.slice(0, 20).map(e => ({ code: e.code, path: e.path ?? '' }));
  // A sheet that failed is left out of a passing set; its errors say why (af_profile_set_finish takes a set without its sheet only so).
  const result = {
    validatorVersion: PROFILE_SET_VALIDATOR_VERSION,
    stage: verdict.ok ? 'profile-set-full-decode' : (verdict.stage ?? 'profile-set-check'),
    errors: listed(verdict.errors),
    manifestSha256: job.manifestSha256,
    ...(verdict.ok && verdict.sheetErrors?.length ? { sheetErrors: listed(verdict.sheetErrors) } : {}),
  };
  return { passed: verdict.ok, result, ...(verdict.ok ? { derived } : {}) };
}
