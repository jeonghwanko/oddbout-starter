// 정면 판정 (2026-11-03): the worker's check of an owner's front painting — its own og folder, codex with every tool off, only a verdict sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeFrontFolders, createFrontCheck } from './generation-worker.mjs';
import { ASKS, CODEX_TOOLS_OFF } from './generation-stages.mjs';

const BYTES = new Uint8Array([1, 2, 3, 4]);
const SET = { id: '0123abcd-0000-4000-8000-0123456789ab', leaseToken: 'lease',
  front: { bytes: 4, sha256: createHash('sha256').update(BYTES).digest('hex'), downloadUrl: 'https://storage.test/front.webp?token=t' } };
const PASS = { checks: { whole: 'pass', front: 'pass', single: 'pass' }, notes: 'One boxer, whole, facing the viewer.' };
const FOLDER = '20261103-front-0123abcd0000400080000123456789ab';

/** A check against a fake API and fake runs: `og` is the judge's exit code and what it writes as its verdict. */
async function harness({ claim = { ok: true, profileSet: SET }, bytes = BYTES, og = { code: 0, verdict: PASS }, kit } = {}) {
  kit ??= await mkdtemp(path.join(tmpdir(), 'front-check-'));
  const lines = [], finished = [], released = [], runs = [], down = [], worked = [];
  const api = { frontClaim: async () => claim, frontRelease: async set => { released.push(set.id); return { ok: true } },
    frontFinish: async (set, verdict) => { finished.push({ set, verdict }); return { ok: true, frontCheck: { status: 'pass' } }; } };
  const runner = async (command, args, options) => {
    runs.push({ command, args, stdin: options.stdin });
    if (command === 'python') { await writeFile(args.at(-1), 'png'); return 0; }
    if (og.verdict !== undefined) await writeFile(args[args.indexOf('-o') + 1], typeof og.verdict === 'string' ? og.verdict : JSON.stringify(og.verdict));
    return og.code;
  };
  const check = createFrontCheck({ api, og: 'og', python: 'python', kit, say: async line => { lines.push(line); }, fetcher: async () => new Response(bytes), runner,
    providerDown: async code => { down.push(code); return true; }, worked: () => worked.push(true), now: () => new Date('2026-11-03T12:00:00Z') });
  return { kit, check, lines, finished, released, runs, down, worked, folder: path.join(kit, 'output', FOLDER) };
}

test('a claimed front is judged in its own og folder by codex with every tool off, and only its verdict is sent', async () => {
  const h = await harness();
  try {
    assert.equal(await h.check(), 'judged');
    assert.deepEqual(h.finished, [{ set: SET, verdict: PASS }]);
    const judge = h.runs.find(run => run.command === 'og');
    assert.deepEqual(judge.args.slice(0, 3), ['run', FOLDER, '--']);
    assert.equal(judge.args[3], 'codex');
    for (const feature of CODEX_TOOLS_OFF) assert.ok(judge.args.includes(feature), feature);
    assert.deepEqual(judge.args.slice(judge.args.indexOf('-i'), judge.args.indexOf('-i') + 2), ['-i', path.join(h.folder, 'front.png')]);
    assert.match(judge.stdin, /front painting a player uploaded/);
    assert.equal(JSON.parse(await readFile(path.join(h.folder, 'request.json'), 'utf8')).api.profileSetId, SET.id);
    assert.ok(existsSync(path.join(h.folder, '.closed')), 'the folder is closed after, so og setup is not held');
    assert.deepEqual(h.worked, [true], 'a verdict ends a limited streak of codex');
    // The same set taken again the same day (its finish was lost): the saved verdict goes, codex is not asked again.
    const again = await harness({ kit: h.kit });
    assert.equal(await again.check(), 'judged');
    assert.deepEqual([again.runs, again.finished.map(f => f.verdict)], [[], [PASS]]);
  } finally { await rm(h.kit, { recursive: true, force: true }); }
});

test('a take the PC could not run is given back; no verdict, other bytes or a broken answer fail without a verdict', async () => {
  for (const [og, given] of [[{ code: 75 }, true], [{ code: 3 }, true], [{ code: 1 }, false], [{ code: 0, verdict: '{"checks": ' }, false],
    [{ code: 0, verdict: { ...PASS, checks: { whole: 'pass', front: 'maybe', single: 'pass' } } }, false]]) {
    const h = await harness({ og });
    try {
      assert.equal(await h.check(), 'failed', JSON.stringify(og));
      assert.deepEqual(h.finished, []);
      assert.deepEqual(h.released, given ? [SET.id] : [], JSON.stringify(og));
      assert.deepEqual(h.down, og.code === 75 ? [ASKS] : []);
      assert.ok(existsSync(path.join(h.folder, '.closed')));
    } finally { await rm(h.kit, { recursive: true, force: true }); }
  }
  const other = await harness({ bytes: new Uint8Array([4, 3, 2, 1]) });
  try { assert.equal(await other.check(), 'failed'); assert.deepEqual(other.runs, []); assert.match(other.lines.at(-1), /not its bytes/); }
  finally { await rm(other.kit, { recursive: true, force: true }); }
});

test('an empty queue is idle, a host that checks none is off, a refused claim fails', async () => {
  for (const [claim, outcome] of [[{ ok: true, stage: 'idle' }, 'idle'], [{ ok: true, stage: 'idle', frontChecks: false }, 'off'],
    [{ ok: false, code: 'route-not-found' }, 'failed']]) {
    const h = await harness({ claim });
    try { assert.equal(await h.check(), outcome); assert.deepEqual(h.runs, []); }
    finally { await rm(h.kit, { recursive: true, force: true }); }
  }
});

test('a front folder a stopped worker left open is closed when no check runs; other folders are not touched', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'front-folders-'));
  try {
    for (const name of [FOLDER, '20261102-front-ffffffff0000400080000123456789ab', '20261103-gen-0123abcd0000400080000123456789ab'])
      await mkdir(path.join(output, name));
    await writeFile(path.join(output, '20261102-front-ffffffff0000400080000123456789ab', '.closed'), '');
    assert.deepEqual(await closeFrontFolders(output), [FOLDER]);
    assert.equal(existsSync(path.join(output, '20261103-gen-0123abcd0000400080000123456789ab', '.closed')), false);
  } finally { await rm(output, { recursive: true, force: true }); }
});
