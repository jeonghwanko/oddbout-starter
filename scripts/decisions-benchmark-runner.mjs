// @ts-check
// Operator-side Linux runner. OpenAI credentials never leave the Edge function.
// node decisions-benchmark-runner.mjs <manifest.json> <worker.env> <results.json>
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BENCHMARK_BODY_BYTES } from '../api/sequence-benchmark.mjs';

/**
 * @typedef {{ caseId: string, label: string, requestSha256: string, status: 'request_started' | 'response_received' | 'transport_outcome_unknown',
 *   httpStatus?: number, report?: any, code?: string | null, wallSeconds?: number }} Call  report: the server's review JSON
 */

if (process.platform !== 'linux') throw new Error('Run on the authorized Linux server, not a creator PC');
const [manifestPath, workerEnvPath, resultPath] = process.argv.slice(2);
if (!manifestPath || !workerEnvPath || !resultPath) throw new Error('manifest, server worker.env and result paths required');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const env = Object.fromEntries(
  (await readFile(workerEnvPath, 'utf8'))
    .split('\n')
    .filter(s => /^[A-Z_]+=/.test(s))
    .map(s => {
      const at = s.indexOf('=');
      return [s.slice(0, at), s.slice(at + 1).trim()];
    }),
);
const base = new URL(env.ODDBOUT_GENERATION_API);
if (
  base.protocol !== 'https:' ||
  base.username ||
  base.password ||
  base.search ||
  base.hash ||
  !/^afw_[a-f0-9]{64}$/.test(env.ODDBOUT_GENERATION_WORKER_KEY ?? '')
)
  throw new Error('Invalid server worker configuration');
/** @type {{ startedAt: string, calls: Call[], finishedAt?: string }} */
const result = { startedAt: new Date().toISOString(), calls: [] };
// Exclusive creation prevents an accidental rerun after an unknown network outcome.
await writeFile(resultPath, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
for (const entry of manifest.cases) {
  if (!/^[a-f0-9-]{36}$/.test(entry.id)) throw new Error('Missing enrolled case id');
  const filename = path.resolve(path.dirname(manifestPath), entry.request);
  const raw = await readFile(filename);
  if (raw.length > BENCHMARK_BODY_BYTES || createHash('sha256').update(raw).digest('hex') !== entry.requestSha256) throw new Error('Request bytes changed');
  /** @type {Call} */
  const item = { caseId: entry.id, label: entry.label, requestSha256: entry.requestSha256, status: 'request_started' };
  result.calls.push(item);
  await writeFile(resultPath, JSON.stringify(result, null, 2), { mode: 0o600 });
  const start = performance.now();
  try {
    const response = await fetch(`${base.href.replace(/\/$/, '')}/generation-worker/decision-benchmarks/${entry.id}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.ODDBOUT_GENERATION_WORKER_KEY}`, 'content-type': 'application/json' },
      body: raw,
      redirect: 'error',
      signal: AbortSignal.timeout(135_000),
    });
    const reply = await response.json();
    Object.assign(item, { status: 'response_received', httpStatus: response.status, report: reply.review ?? null, code: reply.code ?? null });
  } catch {
    item.status = 'transport_outcome_unknown';
  }
  item.wallSeconds = (performance.now() - start) / 1000;
  await writeFile(resultPath, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(
    JSON.stringify({
      label: item.label,
      status: item.report?.status ?? item.status,
      wallSeconds: item.wallSeconds,
      httpStatus: item.httpStatus,
      providerHttpStatus: item.report?.providerHttpStatus,
      code: item.code,
    }),
  );
  // Stop on the first unknown/refused call. The operator inspects the server ledger before any further action.
  if (item.httpStatus !== 200 || item.report?.status !== 'completed') break;
}
result.finishedAt = new Date().toISOString();
await writeFile(resultPath, JSON.stringify(result, null, 2), { mode: 0o600 });
