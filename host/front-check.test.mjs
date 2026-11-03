// 정면 판정 (2026-11-03): the worker's check of an owner's front painting — its own og folder, codex with every tool off, only a verdict sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFrontCheck } from './generation-worker.mjs';
import { ASKS, CODEX_TOOLS_OFF } from './generation-stages.mjs';

const SET = { id: '0123abcd-0000-4000-8000-0123456789ab', leaseToken: 'lease', front: { bytes: 4, downloadUrl: 'https://storage.test/front.webp?token=t' } };
const PASS = { checks: { whole: 'pass', front: 'pass', single: 'pass' }, notes: 'One boxer, whole, facing the viewer.' };

/** A check against a fake API and fake runs: `og` is the judge's exit code and what it writes as its verdict. */
async function harness({ claim = { ok: true, profileSet: SET }, bytes = new Uint8Array([1, 2, 3, 4]), og = { code: 0, verdict: PASS } } = {}) {
  const kit = await mkdtemp(path.join(tmpdir(), 'front-check-')), lines = [], finished = [], runs = [], down = [];
  const api = { frontClaim: async () => claim, frontFinish: async (set, verdict) => { finished.push({ set, verdict }); return { ok: true, frontCheck: { status: 'pass' } }; } };
  const runner = async (command, args, options) => {
    runs.push({ command, args, stdin: options.stdin });
    if (command === 'python') { await writeFile(args.at(-1), 'png'); return 0; }
    if (og.verdict !== undefined) await writeFile(args[args.indexOf('-o') + 1], typeof og.verdict === 'string' ? og.verdict : JSON.stringify(og.verdict));
    return og.code;
  };
  const fetcher = async () => new Response(bytes);
  const check = createFrontCheck({ api, og: 'og', python: 'python', kit, say: async line => { lines.push(line); }, fetcher, runner,
    providerDown: async code => { down.push(code); return true; }, now: () => new Date('2026-11-03T12:00:00Z') });
  return { kit, check, lines, finished, runs, down, folder: path.join(kit, 'output', '20261103-front-0123abcd000040008000' + '0123456789ab') };
}

test('a claimed front is judged in its own og folder by codex with every tool off, and only its verdict is sent', async () => {
  const h = await harness();
  try {
    assert.equal(await h.check(), true);
    assert.deepEqual(h.finished, [{ set: SET, verdict: PASS }]);
    const judge = h.runs.find(run => run.command === 'og');
    assert.deepEqual(judge.args.slice(0, 3), ['run', path.basename(h.folder), '--']);
    assert.equal(judge.args[3], 'codex');
    for (const feature of CODEX_TOOLS_OFF) assert.ok(judge.args.includes(feature), feature);
    assert.deepEqual(judge.args.slice(judge.args.indexOf('-i'), judge.args.indexOf('-i') + 2), ['-i', path.join(h.folder, 'front.png')]);
    assert.match(judge.stdin, /front painting a player uploaded/);
    assert.equal(JSON.parse(await readFile(path.join(h.folder, 'request.json'), 'utf8')).api.profileSetId, SET.id);
    assert.ok(existsSync(path.join(h.folder, '.closed')), 'the folder is closed after, so og setup is not held');
    assert.match(h.lines.at(-1), /→ pass/);
  } finally { await rm(h.kit, { recursive: true, force: true }); }
});

test('codex that cannot run here stops the claims; no verdict, a wrong download or an idle queue sends nothing', async () => {
  const asked = await harness({ og: { code: 75 } });
  try { await asked.check(); assert.deepEqual(asked.down, [ASKS]); assert.deepEqual(asked.finished, []); }
  finally { await rm(asked.kit, { recursive: true, force: true }); }
  const broken = await harness({ og: { code: 0, verdict: { ...PASS, checks: { whole: 'pass', front: 'maybe', single: 'pass' } } } });
  try { await broken.check(); assert.deepEqual(broken.finished, []); assert.match(broken.lines.at(-1), /no verdict \(exit 0\)/); }
  finally { await rm(broken.kit, { recursive: true, force: true }); }
  const short = await harness({ bytes: new Uint8Array([1, 2]) });
  try { await short.check(); assert.deepEqual(short.runs, []); assert.deepEqual(short.finished, []); assert.ok(existsSync(path.join(short.folder, '.closed'))); }
  finally { await rm(short.kit, { recursive: true, force: true }); }
  const idle = await harness({ claim: { ok: true, stage: 'idle' } });
  try { assert.equal(await idle.check(), false); assert.deepEqual([idle.runs, idle.lines], [[], []]); }
  finally { await rm(idle.kit, { recursive: true, force: true }); }
});
