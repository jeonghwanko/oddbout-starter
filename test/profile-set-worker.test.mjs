import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { sha256 } from '../api/handler.mjs';
import { PROFILE_SET_VALIDATOR_VERSION, PROFILE_SET_VERSION } from '../api/profile-sets.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProfileSetWithConfig } from '../worker/profile-sets.mjs';

const url = 'https://abcdefghijklmnopqrst.supabase.co', config = { url, workerToken: `afw_${'a'.repeat(64)}` };
let realFetch;
before(() => { realFetch = globalThis.fetch; });
after(() => { globalThis.fetch = realFetch; });

async function painting() {
  const width = 1024, height = 1536, rgba = Buffer.alloc(width * height * 4);
  const paint = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) rgba.set([200, 120, 90, 255], (y * width + x) * 4); };
  paint(412, 110, 612, 310); paint(362, 300, 662, 1450);
  return sharp(rgba, { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toBuffer();
}

/** A claimed set served by a stub API: the claim, the signed download, the derived uploads, finish and release. */
async function serve(bytes, face = { x: 402, y: 108, side: 220 }, { download = true, claim = {} } = {}) {
  const text = JSON.stringify({ version: PROFILE_SET_VERSION,
    front: { path: 'front.webp', bytes: bytes.length, sha256: await sha256(bytes), width: 1024, height: 1536 }, face });
  const calls = { derived: {}, finish: null, release: null }, id = crypto.randomUUID(), lease = crypto.randomUUID();
  globalThis.fetch = async (target, init = {}) => {
    const route = String(target);
    if (route.endsWith('/worker/profile-sets/claim')) return Response.json({ ok: true, stage: 'validating', profileSetId: id, leaseToken: lease,
      manifestText: text, manifestSha256: await sha256(new TextEncoder().encode(text)), face,
      front: { ...JSON.parse(text).front, downloadUrl: `${url}/storage/v1/object/sign/ai-fighter-beta/o/profile-sets/${id}/front.webp?token=t` }, ...claim });
    if (route.includes(`/worker/profile-sets/${id}/derived/`)) {
      assert.equal(init.headers['x-profile-set-lease'], lease);
      const body = new Uint8Array(init.body), name = route.split('/').at(-1);
      calls.derived[name] = body;
      return Response.json({ ok: true, stage: 'uploaded', name, bytes: body.length, sha256: await sha256(body) });
    }
    if (route.endsWith('/worker/profile-sets/finish')) { calls.finish = JSON.parse(init.body); return Response.json({ ok: true, stage: calls.finish.passed ? 'review' : 'rejected' }); }
    if (route.endsWith('/worker/profile-sets/release')) { calls.release = JSON.parse(init.body); return Response.json({ ok: true, stage: 'requeued' }); }
    if (route.startsWith(`${url}/storage/v1/object/sign/`)) return download ? new Response(bytes) : Response.json({}, { status: 500 });
    throw new Error(`unexpected ${route}`);
  };
  return calls;
}

test('a passing painting: the card and face are stored under the lease, then finish carries their hashes', async () => {
  const calls = await serve(await painting());
  const result = await runProfileSetWithConfig(config);
  assert.equal(result.stage, 'review');
  assert.equal(calls.finish.passed, true);
  assert.deepEqual([calls.finish.result.validatorVersion, calls.finish.result.stage], [PROFILE_SET_VALIDATOR_VERSION, 'profile-set-full-decode']);
  const { card, face } = calls.finish.derived;
  assert.equal(card.sha256, await sha256(calls.derived.card)); assert.equal(card.bytes, calls.derived.card.length);
  assert.deepEqual([card.height, face.size, face.sha256], [600, 192, await sha256(calls.derived.face)]);
  assert.deepEqual((await sharp(Buffer.from(calls.derived.card)).metadata()).height, 600);
});

test('a failing painting is a verdict (rejected with the reasons); a failed download hands the set back', async () => {
  const misplaced = await serve(await painting(), { x: 402, y: 700, side: 220 });
  assert.equal((await runProfileSetWithConfig(config)).stage, 'rejected');
  assert.equal(misplaced.finish.passed, false); assert.deepEqual(misplaced.finish.result.errors, [{ code: 'FACE_POSITION', path: '/face' }]);
  assert.equal('derived' in misplaced.finish, false);
  const unreachable = await serve(await painting(), undefined, { download: false });
  const result = await runProfileSetWithConfig(config);
  assert.deepEqual([result.stage, result.code, unreachable.release.code, unreachable.finish], ['retry-later', 'download-failed', 'download-failed', null]);
});

test('an unexpected error hands the set back as worker-error instead of letting its lease spend an attempt (리뷰 2026-11-02)', async () => {
  const calls = await serve(await painting(), undefined, { claim: { front: null } });
  const result = await runProfileSetWithConfig(config);
  assert.deepEqual([result.stage, result.code, result.requeued, calls.finish], ['retry-later', 'worker-error', true, null]);
  assert.deepEqual([calls.release.code, calls.release.profileSetId], ['worker-error', result.profileSetId]);
});

test('an idle queue answers idle', async () => {
  globalThis.fetch = async () => Response.json({ ok: true, stage: 'idle' });
  assert.equal((await runProfileSetWithConfig(config)).stage, 'idle');
});

test('a check child that dies or runs out of time is the painting\'s verdict (rejected, with the reason), not a hand-back (리뷰 P2-6)', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'profile-set-child-'));
  try {
    const crash = path.join(directory, 'crash.mjs'), hang = path.join(directory, 'hang.mjs');
    await writeFile(crash, 'process.exit(1);\n'); await writeFile(hang, 'setInterval(() => {}, 1000);\n');
    for (const [childModule, code] of [[crash, 'CHECK_CRASHED'], [hang, 'CHECK_TIMEOUT']]) {
      const calls = await serve(await painting());
      assert.equal((await runProfileSetWithConfig(config, undefined, { childModule, timeoutMs: 300 })).stage, 'rejected');
      assert.equal(calls.finish.passed, false); assert.deepEqual(calls.finish.result.errors, [{ code, path: '' }]);
      assert.equal(calls.release, null);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
