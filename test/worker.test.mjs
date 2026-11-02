import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sha256 } from '../api/handler.mjs';
import { runOnce } from '../worker/run.mjs';

const url = 'https://abcdefghijklmnopqrst.supabase.co';
const manifestText = await readFile(new URL('../examples/sparring-bot/fighter.json', import.meta.url), 'utf8');
const manifest = JSON.parse(manifestText);
const assetBytes = new Map(await Promise.all(manifest.assets.map(async a => [a.id, await readFile(new URL(`../examples/sparring-bot/${a.path}`, import.meta.url))])));
let directory, config, realFetch;
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'fighter-worker-'));
  config = path.join(directory, 'worker.json');
  await writeFile(config, JSON.stringify({ url, workerToken: `afw_${'a'.repeat(64)}` }));
  realFetch = globalThis.fetch;
});
after(async () => { globalThis.fetch = realFetch; await rm(directory, { recursive: true, force: true }); });

/** A claimed job served by a stub API. `download(id)` returns the asset response or throws. */
async function serve(download, text = manifestText, { finishFailures = 0, release = 200, finishRefusal = null, claim = {} } = {}) {
  const calls = { finish: null, finishAttempts: 0, release: null, inFlight: 0, maxInFlight: 0 };
  const manifestSha256 = await sha256(new TextEncoder().encode(text));
  globalThis.fetch = async (target, init) => {
    const route = String(target);
    if (route.endsWith('/worker/claim')) return Response.json({ ok: true, stage: 'validating', submissionId: crypto.randomUUID(), leaseToken: crypto.randomUUID(),
      manifestText: text, manifestSha256, files: manifest.assets.map(a => ({ ...a, downloadUrl: `${url}/storage/v1/object/sign/ai-fighter-beta/${a.id}.webp?token=t` })), ...claim });
    if (route.endsWith('/worker/finish')) {
      if (calls.finishAttempts++ < finishFailures) return Response.json({ ok: false, code: 'service-unavailable' }, { status: 503 });
      if (finishRefusal) return Response.json({ ok: false, stage: 'api', code: finishRefusal.code }, { status: finishRefusal.status });
      calls.finish = JSON.parse(init.body); return Response.json({ ok: true, stage: calls.finish.passed ? 'registered' : 'rejected' });
    }
    if (route.endsWith('/worker/release')) { calls.release = JSON.parse(init.body); return Response.json({ ok: release === 200, stage: 'requeued' }, { status: release }); }
    const id = new URL(route).pathname.split('/').at(-1).replace('.webp', '');
    calls.inFlight++; calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight);
    try { await new Promise(resolve => setTimeout(resolve, 5)); return await download(id); }
    finally { calls.inFlight--; }
  };
  return calls;
}
const ok = id => new Response(assetBytes.get(id));

test('a valid package registers, with at most four downloads at once', async () => {
  const calls = await serve(ok);
  assert.equal((await runOnce(config)).stage, 'registered');
  assert.equal(calls.finish.passed, true);
  assert.equal(calls.finish.result.stage, 'bytes-hashes-and-full-decode');
  assert.ok(calls.maxInFlight > 1 && calls.maxInFlight <= 4, String(calls.maxInFlight));
});
test('infrastructure failures leave the job for a retry instead of rejecting the creator', async () => {
  for (const [download, expected] of [
    [id => { if (id === 'walk') throw new TypeError('fetch failed'); return ok(id); }, 'download-failed'],
    [id => id === 'walk' ? new Response('server error', { status: 500 }) : ok(id), 'download-failed'],
    [id => id === 'walk' ? new Response(Buffer.alloc(assetBytes.get('walk').length)) : ok(id), 'download-integrity'],
  ]) {
    const calls = await serve(download);
    const result = await runOnce(config);
    assert.deepEqual([result.stage, result.code, result.requeued], ['retry-later', expected, true]);
    assert.equal(calls.finish, null);
    // Handed back under its own lease, so the failure does not spend one of the package's attempts.
    assert.deepEqual([calls.release.code, calls.release.submissionId.length, calls.release.leaseToken.length], [expected, 36, 36]);
  }
});
test('an unexpected error hands the job back as worker-error instead of letting its lease spend an attempt (리뷰 2026-11-02)', async () => {
  // A claim the worker cannot read throws a plain TypeError, not RetryLater. Left to expire, three such leases rejected a valid package.
  const calls = await serve(ok, manifestText, { claim: { files: null } });
  const result = await runOnce(config);
  assert.deepEqual([result.stage, result.code, result.requeued], ['retry-later', 'worker-error', true]);
  assert.equal(calls.finish, null);
  assert.deepEqual([calls.release.code, calls.release.submissionId, calls.release.leaseToken.length], ['worker-error', result.submissionId, 36]);
});
test('if the hand-back fails, the job still waits for its lease to expire', async () => {
  const calls = await serve(id => id === 'walk' ? new Response('server error', { status: 500 }) : ok(id), manifestText, { release: 404 });
  const result = await runOnce(config);
  assert.deepEqual([result.stage, result.code, result.requeued], ['retry-later', 'download-failed', false]);
  assert.equal(calls.finish, null);
});
test('a brief API outage at finish is retried with backoff instead of discarding the validation', async () => {
  const calls = await serve(ok, manifestText, { finishFailures: 1 });
  const started = Date.now();
  assert.equal((await runOnce(config)).stage, 'registered');
  assert.equal(calls.finishAttempts, 2);
  assert.ok(Date.now() - started >= 900, 'waited before retrying');
});
test('a manifest that fails the contract is a verdict and is finished as rejected', async () => {
  const broken = JSON.stringify({ ...manifest, localId: 'Not Valid' });
  const calls = await serve(ok, broken);
  assert.equal((await runOnce(config)).stage, 'rejected');
  assert.deepEqual([calls.finish.passed, calls.finish.result.stage, calls.finish.result.errors[0].code], [false, 'server-manifest', 'invalid-server-manifest']);
});
test('the first failed download stops the others before the job folder is removed', async () => {
  let started = 0;
  await serve(async id => {
    started++;
    if (id === 'idle') throw new TypeError('fetch failed');
    await new Promise(resolve => setTimeout(resolve, 50));
    return ok(id);
  });
  const result = await runOnce(config);
  assert.equal(result.stage, 'retry-later');
  assert.ok(started < manifest.assets.length, `${started} of ${manifest.assets.length} downloads started`);
});
test('a finish the server refuses hands the job back instead of letting its lease spend an attempt (API 점검 2026-10-29)', async () => {
  // A validator version the server does not take refused every valid package's finish; each lease then expired into one of three attempts.
  let calls = await serve(ok, manifestText, { finishRefusal: { status: 400, code: 'validator-version' } });
  const result = await runOnce(config);
  assert.deepEqual([result.stage, result.code, result.requeued], ['retry-later', 'finish-refused-validator-version', true]);
  assert.equal(calls.finishAttempts, 1); assert.equal(calls.release.code, 'finish-refused-validator-version');
  // A lost lease is not this worker's to hand back, and a refused worker key stops the worker.
  for (const refusal of [{ status: 409, code: 'stale-validation' }, { status: 401, code: 'worker-required' }]) {
    calls = await serve(ok, manifestText, { finishRefusal: refusal });
    await assert.rejects(runOnce(config), new RegExp(refusal.code));
    assert.equal(calls.release, null);
  }
});
