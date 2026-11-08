// @ts-check
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiRequest, transferTimeoutMs, validProjectUrl } from '../api/client.mjs';
import { readBody, sha256 } from '../api/http.mjs';
import { VALIDATOR_VERSION } from '../api/submissions.mjs';
import { parseFighterJson, validateFighter } from '../contracts/ai-fighter/validate.mjs';
import { makePackageValidator } from '../mcp/package-access.mjs';
import { createBackoff, RetryLater, runLeasedJob } from './leased-jobs.mjs';

const DOWNLOADS_AT_ONCE = 4;

/**
 * A job worker/claim leases (api/handler.mjs): its files carry signed download URLs.
 * @typedef {{ submissionId: string, leaseToken: string, manifestText: string, manifestSha256: string,
 *   files: { id: string, downloadUrl: string }[] }} ClaimedJob
 */

/**
 * Run `task` over items, `limit` at a time. The first failure cancels the rest; returns after every task stopped.
 * @template T
 * @param {T[]} items @param {number} limit @param {AbortController} cancel @param {(item: T) => Promise<void>} task
 */
async function eachLimited(items, limit, cancel, task) {
  let next = 0;
  /** @type {unknown} */
  let failure;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && !failure) {
        try {
          await task(items[next++]);
        } catch (error) {
          failure ??= error;
          cancel.abort();
        }
      }
    }),
  );
  if (failure) throw failure;
}

/** @param {string} configPath @param {string} [submissionId] */
export async function runOnce(configPath, submissionId) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  return runWithConfig(config, submissionId);
}

/**
 * Environment-backed web services need no credential file on their ephemeral disk.
 * @param {{ url?: string, workerToken?: string }} config checked here: an unset environment variable arrives as undefined
 * @param {string} [submissionId]
 */
export async function runWithConfig(config, submissionId) {
  if (!validProjectUrl(config.url) || !/^afw_[a-f0-9]{64}$/.test(config.workerToken ?? '')) throw new Error('invalid-worker-config');
  const project = /** @type {string} */ (config.url),
    token = /** @type {string} */ (config.workerToken); // both checked just above
  /** @type {(route: string, body: object) => Promise<any>} */
  const send = (route, body) =>
    apiRequest(project, token, route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return runLeasedJob({
    send,
    routes: { claim: 'worker/claim', finish: 'worker/finish', release: 'worker/release' },
    idKey: 'submissionId',
    claim: submissionId ? { submissionId } : {},
    folder: 'job-',
    /** @param {ClaimedJob} job @param {string} directory @param {AbortSignal} deadline */
    work: (job, directory, deadline) => validatePackage(project, job, directory, deadline),
  });
}

/**
 * Download a leased package into its job folder and validate it. Returns the verdict; an infrastructure failure throws RetryLater.
 * @param {string} project @param {ClaimedJob} job @param {string} directory @param {AbortSignal} deadline
 */
async function validatePackage(project, job, directory, deadline) {
  const cancel = new AbortController();
  /** @type {{ ok: boolean, stage: string, errors: { code: string, path?: string }[] }} */
  let result;
  if ((await sha256(new TextEncoder().encode(job.manifestText))) !== job.manifestSha256) throw new RetryLater('server-manifest-hash');
  const parsed = parseFighterJson(job.manifestText);
  if (!parsed.ok || !validateFighter(parsed.data).ok) {
    // A verdict: this manifest fails the worker's contract.
    result = { ok: false, stage: 'server-manifest', errors: [{ code: 'invalid-server-manifest' }] };
  } else {
    if (job.files.length !== parsed.data.assets.length) throw new RetryLater('invalid-server-files');
    await mkdir(path.join(directory, 'assets'));
    await eachLimited(parsed.data.assets, DOWNLOADS_AT_ONCE, cancel, async asset => {
      const file = job.files.find(f => f.id === asset.id);
      if (!file) throw new RetryLater('invalid-server-files');
      const url = new URL(file.downloadUrl);
      if (url.origin !== project || !url.pathname.startsWith('/storage/v1/object/sign/ai-fighter-beta/')) throw new RetryLater('invalid-download-origin');
      let bytes;
      try {
        const response = await fetch(url, {
          redirect: 'error',
          signal: AbortSignal.any([AbortSignal.timeout(transferTimeoutMs(asset.bytes)), deadline, cancel.signal]),
        });
        if (!response.ok) throw new RetryLater('download-failed');
        bytes = await readBody(response, asset.bytes);
      } catch (error) {
        throw error instanceof RetryLater ? error : new RetryLater(deadline.aborted ? 'job-deadline' : 'download-failed');
      }
      // Upload already checked these bytes; a mismatch now is a storage fault, not the creator's package.
      if (bytes.length !== asset.bytes || (await sha256(bytes)) !== asset.sha256) throw new RetryLater('download-integrity');
      await writeFile(path.join(directory, asset.path), bytes, { flag: 'wx', mode: 0o600 });
    });
    if (deadline.aborted) throw new RetryLater('job-deadline');
    await writeFile(path.join(directory, 'fighter.json'), job.manifestText, { flag: 'wx', mode: 0o600 });
    result = await makePackageValidator(path.dirname(directory))(`${path.basename(directory)}/fighter.json`);
    // Timeouts, crashes and a busy validator are the worker's problem, not a package verdict.
    if (result.stage === 'local-access' || result.stage === 'worker')
      throw new RetryLater(
        String(result.errors?.[0]?.code ?? 'validator-unavailable')
          .toLowerCase()
          .replaceAll('_', '-'),
      );
  }
  return {
    passed: result.ok,
    result: {
      validatorVersion: VALIDATOR_VERSION,
      stage: result.stage,
      errors: result.errors.slice(0, 20).map(e => ({ code: e.code, path: e.path ?? '' })),
      checkedAssetCount: job.files.length,
      manifestSha256: job.manifestSha256,
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const config = process.env.AI_FIGHTER_WORKER_CONFIG;
  if (!config) throw new Error('Set AI_FIGHTER_WORKER_CONFIG to a private worker config file');
  const watch = process.argv.includes('--watch');
  const backoff = createBackoff();
  do {
    // Drain the queue: claim again at once after a finished job. Back off only while idle or failing.
    let waitMs = 0;
    try {
      const result = await runOnce(
        config,
        process.argv.find(arg => /^[a-f0-9-]{36}$/.test(arg)),
      );
      if (!watch || result.stage !== 'idle') console.log(JSON.stringify(result));
      // Idle or an infrastructure failure: back off. A finished job: claim the next at once.
      if (result.stage === 'idle' || result.stage === 'retry-later') waitMs = backoff.next();
      else backoff.reset();
    } catch (/** @type {any} */ error) {
      if (!watch || error.status === 401 || error.status === 403) throw error;
      console.error(JSON.stringify({ stage: 'retry-wait', code: 'worker-api-unavailable' }));
      waitMs = backoff.next();
    }
    if (!watch) break;
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    // biome-ignore lint/correctness/noConstantCondition: the loop ends at `break` (one pass without --watch) or by a throw
  } while (true);
}
