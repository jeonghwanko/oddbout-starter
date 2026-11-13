// @ts-check
// Film a seeded bout to an X-ready MP4 (2026-11-13).
// `npm run bout:video -- --url <playback> --digest <8 hex> --out <file>` records one page on this machine.
// `npm run bout:video-worker` claims jobs from the API with AI_FIGHTER_PROJECT_URL and AI_FIGHTER_WORKER_TOKEN
// (the validation worker token, a separate process from the package validator). It does not post to X.
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { apiRequest } from '../api/client.mjs';
import { sha256 } from '../api/http.mjs';
import { composeBoutFile, recordBoutPage, trimSeconds } from './bout-video-render.mjs';

/** @param {string} url @param {Uint8Array} bytes */
export async function uploadSigned(url, bytes) {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'video/mp4', 'cache-control': 'max-age=3600' },
    body: Buffer.from(bytes),
    redirect: 'error',
  });
  if (!response.ok) {
    const error = /** @type {Error & { code: string }} */ (new Error('upload-failed'));
    error.code = 'upload-failed';
    throw error;
  }
}

/**
 * One claim. Idle when the queue is empty. A film that refuses (no hook, wrong digest) fails the job
 * so the assistant hears the code instead of a club-lobby video.
 * @param {{ send: (route: string, body: object) => Promise<any>, render: (job: any) => Promise<{ bytes: Uint8Array, sha256: string, width: number, height: number, trimApplied: string }>,
 *   upload?: (url: string, bytes: Uint8Array) => Promise<void> }} worker
 */
export async function runBoutVideoOnce(worker) {
  const claimed = await worker.send('worker/bout-video/claim', {});
  if (!claimed || claimed.stage === 'idle' || !claimed.job) return 'idle';
  const job = claimed.job;
  const upload = worker.upload ?? uploadSigned;
  try {
    const rendered = await worker.render(job);
    await upload(job.upload.url, rendered.bytes);
    await worker.send('worker/bout-video/finish', {
      id: job.id,
      leaseToken: job.leaseToken,
      sha256: rendered.sha256,
      width: rendered.width,
      height: rendered.height,
      trimApplied: rendered.trimApplied,
    });
    return 'ready';
  } catch (/** @type {any} */ error) {
    const code = typeof error?.code === 'string' && /^[a-z0-9-]{1,64}$/.test(error.code) ? error.code : 'render-failed';
    await worker.send('worker/bout-video/fail', { id: job.id, leaseToken: job.leaseToken, code });
    return 'failed';
  }
}

/**
 * Film `job.page` and compose the cards. The digest must be the one the page reports.
 * @param {any} job
 */
export async function renderClaimedJob(job) {
  const ms = typeof job.record?.ms === 'number' ? job.record.ms : 60_000;
  const timeoutMs = (ms >= 1000 ? ms : ms * 1000) + 60_000;
  const filmed = await recordBoutPage({
    url: job.page,
    expectedDigest: job.digest,
    width: job.width,
    height: job.height,
    timeoutMs,
  });
  const dir = await mkdtemp(path.join(tmpdir(), 'bout-job-'));
  try {
    const raw = path.join(dir, 'bout.webm');
    const out = path.join(dir, 'bout.mp4');
    await writeFile(raw, filmed.bytes);
    const names = Array.isArray(job.fighters) ? job.fighters : [];
    const left = names[0]?.name || job.a || 'A';
    const right = names[1]?.name || job.b || 'B';
    const span = job.trim === 'highlights' ? trimSeconds(job.record) : null;
    const winner = job.record?.winner === 0 ? left : job.record?.winner === 1 ? right : null;
    await composeBoutFile({
      boutPath: raw,
      out,
      width: job.width,
      height: job.height,
      left: String(left),
      right: String(right),
      winner,
      trim: span,
    });
    const bytes = new Uint8Array(await readFile(out));
    return { bytes, sha256: await sha256(bytes), width: job.width, height: job.height, trimApplied: span ? 'highlights' : 'full' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** @param {string[]} argv */
export async function main(argv) {
  const worker = argv[0] === '--worker' || argv[0] === 'worker';
  if (worker) {
    const project = process.env.AI_FIGHTER_PROJECT_URL;
    const token = process.env.AI_FIGHTER_WORKER_TOKEN;
    if (!project || !token) {
      console.error('Set AI_FIGHTER_PROJECT_URL and AI_FIGHTER_WORKER_TOKEN. This process only claims bout videos.');
      process.exitCode = 1;
      return;
    }
    /** @param {string} route @param {object} body */
    const send = (route, body) =>
      apiRequest(project, token, route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    for (;;) {
      const outcome = await runBoutVideoOnce({ send, render: renderClaimedJob });
      if (outcome === 'idle') await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: 'string' },
      digest: { type: 'string' },
      out: { type: 'string' },
      width: { type: 'string', default: '1280' },
      height: { type: 'string', default: '720' },
    },
  });
  if (!values.url || !values.digest || !values.out || !/^[a-f0-9]{8}$/.test(values.digest)) {
    console.error('Usage: npm run bout:video -- --url <playback page> --digest <8 hex> --out <file.mp4>');
    console.error('       npm run bout:video-worker');
    process.exitCode = 1;
    return;
  }
  const width = Number(values.width);
  const height = Number(values.height);
  const filmed = await recordBoutPage({ url: values.url, expectedDigest: values.digest, width, height, timeoutMs: 180_000 });
  const dir = await mkdtemp(path.join(tmpdir(), 'bout-local-'));
  try {
    const raw = path.join(dir, 'bout.webm');
    await writeFile(raw, filmed.bytes);
    await composeBoutFile({ boutPath: raw, out: path.resolve(values.out), width, height, left: 'A', right: 'B', winner: null, trim: null });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const bytes = await readFile(path.resolve(values.out));
  console.log(
    JSON.stringify({ out: path.resolve(values.out), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), postsToX: false }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main(process.argv.slice(2));
