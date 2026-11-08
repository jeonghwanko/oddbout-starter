import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createJudgeArchive } from '../host/judge-archive.mjs';
import { checkedLine, evaluate, evaluateByMode, labelQueue, main, quantile, readArchive, readLabels, rerun } from '../scripts/judge-eval.mjs';

const pass5 = { whole: 'pass', side: 'pass', match: 'pass', style: 'pass', clean: 'pass' };
const side = (
  pixels,
  codex,
  { decidedBy = codex ? 'pixels+codex' : 'pixels', mode = 'hybrid', pms = 80, pwall = 900, cwall = 12_000, reused = false } = {},
) => ({
  jobId: 'j',
  item: 'side-0-a/take-0',
  kind: 'side',
  mode,
  decidedBy,
  final: codex ?? pixels,
  pixels: { model: 'pixels-v1', observed: 'pixels-v1', checks: { ...pass5, side: 'unknown', ...pixels }, measures: { ms: pms }, ms: pms, wallMs: pwall },
  codex: codex ? { checks: { ...pass5, ...codex }, model: 'gpt', effort: 'medium', observed: 'gpt', wallMs: reused ? null : cwall, reused } : null,
});
const noAnswer = (mode = 'hybrid') => ({
  jobId: 'j',
  item: 'side-0-a/take-1',
  kind: 'side',
  mode,
  decidedBy: 'none',
  final: null,
  pixels: { model: 'pixels-v1', error: 1, wallMs: 600 },
});

/** An archive the host's own writer made, with `entries` in order a minute apart. */
async function archiveOf(entries, imageDays = 0, files = []) {
  const root = await mkdtemp(path.join(tmpdir(), 'judge-eval-')),
    dir = path.join(root, 'judge-archive');
  let minute = 0;
  const archive = createJudgeArchive({ dir, saltFile: path.join(root, 'salt'), imageDays, now: () => new Date(Date.UTC(2026, 10, 7, 10, minute++)) });
  const ids = [];
  for (const entry of entries) ids.push(await archive.note(entry, files));
  return { dir, ids };
}

test("evaluate per mode: the pixels against codex only, no-answers counted, what hybrid would ask, both judges' times", async () => {
  const { dir } = await archiveOf([
    side({ match: 'fail' }, { match: 'pass' }, { mode: 'codex', decidedBy: 'codex', cwall: 14_000 }), // a shadow fail codex passed
    side({}, { side: 'fail' }, { mode: 'codex', decidedBy: 'codex', pms: 120, pwall: 1500, cwall: 10_000 }),
    side({ whole: 'fail' }, null, { decidedBy: 'pixels', pms: 50 }), // hybrid: a pixel fail, no codex
    side({ style: 'unknown' }, { side: 'pass' }, { cwall: 11_000 }),
    side({}, { side: 'pass' }, { reused: true }), // a codex verdict reused
    noAnswer(),
  ]);
  const { records, skipped } = readArchive(dir);
  assert.deepEqual([records.length, skipped], [6, 0]);
  const byMode = evaluateByMode(records);
  assert.deepEqual(Object.keys(byMode), ['codex', 'hybrid'], 'codex first');
  const codex = byMode.codex.side,
    hybrid = byMode.hybrid.side;
  assert.deepEqual(
    [codex.lines, codex.codexShare, codex.hybridWouldAsk, codex.pixelNoAnswer],
    [2, 1, 0.5, 0],
    'hybrid would have asked on the take whose pixels failed nothing',
  );
  assert.deepEqual(codex.checks.match.matrix.fail, { pass: 1, fail: 0, none: 0 });
  assert.deepEqual([codex.checks.match.passHeld, codex.checks.match.failHeld, codex.checks.match.agreement, codex.checks.match.answered], [1, 0, 0.5, 2]);
  assert.deepEqual(codex.checks.side.matrix.unknown, { pass: 1, fail: 1, none: 0 });
  assert.equal(codex.checks.side.decidedShare, 0);
  assert.deepEqual(codex.pixelMs, { n: 2, p50: 80, p95: 120 });
  assert.deepEqual(codex.pixelWallMs, { n: 2, p50: 900, p95: 1500 });
  assert.deepEqual(codex.codexWallMs, { n: 2, p50: 10_000, p95: 14_000 });
  // hybrid: the no-answer is counted apart and judged nothing; the reused verdict counts as codex's but brings no time.
  assert.deepEqual([hybrid.lines, hybrid.pixelNoAnswer, hybrid.codexShare, hybrid.decidedBy], [4, 1, 0.667, { pixels: 1, 'pixels+codex': 2, none: 1 }]);
  assert.equal(hybrid.checks.whole.answered, 3);
  assert.deepEqual(hybrid.codexWallMs, { n: 1, p50: 11_000, p95: 11_000 });
  assert.deepEqual(hybrid.pixelWallMs, { n: 4, p50: 900, p95: 900 });
  assert.deepEqual(hybrid.checks.whole.matrix.fail, { pass: 0, fail: 0, none: 1 }, 'a hybrid pixel fail never meets codex');
});

test('labels are read by stratum and never change the codex comparison; a crafted labels file is harmless', async () => {
  const { dir, ids } = await archiveOf([
    side({ match: 'fail' }, { match: 'pass' }, { mode: 'codex', decidedBy: 'codex' }), // disagreed: the label sides with the pixels
    side({}, { side: 'pass' }, { mode: 'codex', decidedBy: 'codex' }), // agreed on match, both wrong
    side({ whole: 'fail' }, null, { mode: 'codex', decidedBy: 'codex' }), // no codex verdict here (a test's shape): pixels alone
  ]);
  const { records } = readArchive(dir);
  const labels = readLabels(
    [
      JSON.stringify({ id: ids[0], checks: { match: 'fail', notes: 'x' } }),
      JSON.stringify({ id: ids[1], checks: { match: 'fail', side: 'pass' } }),
      JSON.stringify({ id: ids[2], checks: { whole: 'pass' } }),
      JSON.stringify({ id: '__proto__', checks: { side: 'fail' } }),
      JSON.stringify({ id: '../x', checks: { side: 'fail' } }),
      'not json',
    ].join('\n'),
  );
  assert.deepEqual(Object.keys(labels).sort(), [...ids].sort());
  assert.equal(/** @type {any} */ ({}).side, undefined, 'Object.prototype untouched');
  const plain = evaluate(records).side.checks.match,
    labelled = evaluate(records, labels).side.checks;
  assert.deepEqual(labelled.match.matrix, plain.matrix, 'labels never enter the codex comparison');
  assert.deepEqual(labelled.match.labels.disagreed, { n: 1, pixelsRight: 1, codexRight: 0 });
  assert.deepEqual(labelled.match.labels.agreed, { n: 1, bothRight: 0 });
  assert.deepEqual(labelled.side.labels.codexAlone, { n: 1, codexRight: 1 });
  assert.deepEqual(labelled.whole.labels.pixelsAlone, { n: 1, pixelsRight: 0 });
});

test('labelQueue: disagreements, then a stable random sample of agreements, then what no codex verdict checked', async () => {
  const { dir, ids } = await archiveOf([
    side({ whole: 'fail' }, null, { decidedBy: 'pixels' }),
    side({}, { match: 'fail' }),
    side({ clean: 'fail' }, { clean: 'pass' }, { mode: 'codex', decidedBy: 'codex' }),
    noAnswer(),
  ]);
  const { records } = readArchive(dir);
  const queue = labelQueue(records, undefined, { sample: 2 });
  assert.deepEqual(
    queue.slice(0, 2).map(q => [q.id, q.mode, q.check, q.pixels, q.codex, q.why]),
    [
      [ids[2], 'codex', 'clean', 'fail', 'pass', 'disagree'],
      [ids[1], 'hybrid', 'match', 'pass', 'fail', 'disagree'],
    ],
  );
  assert.deepEqual(
    queue.slice(2, 4).map(q => q.why),
    ['agree-sample', 'agree-sample'],
  );
  assert.ok(queue.slice(2, 4).every(q => q.pixels === q.codex));
  assert.deepEqual(labelQueue(records, undefined, { sample: 2 }).slice(2, 4), queue.slice(2, 4), 'the same sample every time');
  assert.deepEqual([queue[4].why, queue[4].id, queue[4].check, queue[4].pixels], ['pixels-alone', ids[0], 'whole', 'fail']);
  assert.ok(queue.slice(5).every(q => q.why === 'pixels-alone' && q.pixels === 'pass'));
  assert.ok(!queue.some(q => q.id === ids[3]), 'a no-answer has nothing to label');
  assert.equal(
    labelQueue(records, { [ids[2]]: { clean: 'fail' } }).some(q => q.id === ids[2] && q.check === 'clean'),
    false,
  );
});

test('checkedLine: an id, a strict time and picture names judge-eval can trust, or the line (or its pictures) left out', () => {
  const good = {
    v: 2,
    id: '0123456789abcdef',
    at: '2026-11-07T10:00:00.000Z',
    kind: 'side',
    mode: 'hybrid',
    decidedBy: 'pixels',
    images: ['0-front.png', '1-take-0.png'],
  };
  assert.deepEqual(checkedLine(good), good);
  assert.ok(checkedLine({ ...good, v: 1 }), 'version 1 lines still read');
  for (const bad of [
    { id: '../x' },
    { id: 'ABC' },
    { at: undefined },
    { at: 'yesterday' },
    { at: '../../../x 2026' },
    { at: '2026-11-07' },
    { kind: 'front' },
    { v: 3 },
    { mode: 1 },
  ])
    assert.equal(checkedLine({ ...good, ...bad }), null, JSON.stringify(bad));
  assert.equal(checkedLine({ ...good, images: ['0-../../x.png', '1-take.png'] }).images, undefined);
  assert.equal(checkedLine({ ...good, images: ['front.png'] }).images, undefined);
});

test('rerun: the two pixel judges on the same items, a bad answer counted; the CLI says it in text or JSON and refuses bad arguments', async () => {
  const pics = await mkdtemp(path.join(tmpdir(), 'judge-eval-pics-'));
  await writeFile(path.join(pics, 'front.png'), 'f');
  await writeFile(path.join(pics, 'take-0.png'), 't');
  const { dir, ids } = await archiveOf([side({}, { side: 'fail' }), side({ match: 'fail' }, { side: 'pass' })], 30, [
    path.join(pics, 'front.png'),
    path.join(pics, 'take-0.png'),
  ]);
  // One line without pictures beside them, and a torn line.
  const { dir: other } = await archiveOf([side({}, null, { decidedBy: 'pixels' })]);
  const { records } = readArchive(other);
  await writeFile(path.join(dir, 'judgments-2026-10.jsonl'), `${JSON.stringify({ ...records[0] })}\n{"v":2,"id"`);
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    // The second picture set gives an answer that is not JSON: counted, and left out of both sides.
    writeFileSync(
      args.at(-1),
      calls.length === 1 ? JSON.stringify({ kind: 'side', model: 'pixels-v2', checks: { ...pass5, side: 'fail' }, notes: 'n', measures: { ms: 300 } }) : '{',
    );
    return { status: 0 };
  };
  const all = readArchive(dir);
  assert.deepEqual([all.records.length, all.skipped], [3, 1]);
  const again = rerun(all.records, dir, { python: 'py', motions: 'motions.py', run });
  assert.deepEqual([again.records.length, again.before.length, again.failed], [1, 1, 1]);
  assert.equal(again.before[0].id, again.records[0].id, 'the same item on both sides');
  assert.deepEqual(calls[0].slice(0, 5), ['py', '-I', 'motions.py', 'pixel-judge', 'side']);
  assert.equal(calls[0][5], path.join(dir, 'images', '2026-11-07', ids[0], '0-front.png'));
  assert.deepEqual([again.records[0].pixels.model, again.records[0].pixels.checks.side, again.records[0].pixels.ms], ['pixels-v2', 'fail', 300]);
  assert.equal(typeof again.records[0].pixels.wallMs, 'number');
  // The old judge left side open on this item; the new one decides it, and agrees with codex.
  assert.deepEqual([evaluate(again.before).side.checks.side.decidedShare, evaluate(again.records).side.checks.side.failHeld], [0, 1]);

  const lines = [];
  assert.equal(main([dir], { out: line => lines.push(line) }), 0);
  const text = lines.join('\n');
  assert.match(text, /3 lines \(1 unreadable skipped\), 0 labelled/);
  assert.match(text, /== hybrid mode — codex only where/);
  assert.match(
    text,
    /side: 3 lines \(pixels 1, pixels\+codex 2\); pixel judge no answer 0; recovered 0; codex verdicts on 66\.7%; hybrid would ask codex on 66\.7%/,
  );
  const labelsFile = path.join(pics, 'labels.jsonl');
  await writeFile(
    labelsFile,
    `${JSON.stringify({ id: ids[0], checks: { side: 'fail' } })}\n${JSON.stringify({ id: 'feedfeedfeedfeed', checks: { side: 'pass' } })}\n`,
  );
  const json = [];
  assert.equal(main([dir, '--json', '--queue', '1', '--labels', labelsFile], { out: line => json.push(line) }), 0);
  const parsed = JSON.parse(json.join('\n'));
  assert.deepEqual([parsed.lines, parsed.labelled, parsed.unmatchedLabels, parsed.queue.length, parsed.byMode.hybrid.side.lines], [3, 1, 1, 1, 3]);
  assert.deepEqual(parsed.byMode.hybrid.side.checks.side.labels.codexAlone, { n: 1, codexRight: 1 });
  const said = [];
  const refused = args => {
    said.length = 0;
    return [main(args, { out: line => said.push(line) }), said.join(' ')];
  };
  assert.deepEqual(refused([dir, '--rerun'])[0], 2);
  assert.match(refused([dir, '--labels', path.join(pics, 'none.jsonl')])[1], /no labels file/);
  assert.match(refused([dir, '--queue', 'abc'])[1], /whole number/);
  assert.match(refused([dir, '--sample', '-1'])[1], /whole number/);
  assert.equal(refused([path.join(dir, 'missing')])[0], 2);
  assert.equal(refused([labelsFile])[0], 2, 'a file is not an archive folder');
  // --judge: another pixel-judge script (host/side_models.py), only with --rerun and only one that exists; its value is never the archive.
  assert.match(refused([dir, '--judge', labelsFile])[1], /--judge needs --rerun/);
  assert.match(refused([dir, '--rerun', '--python', 'py', '--judge', path.join(pics, 'none.py')])[1], /--judge needs --rerun and an existing script/);
  assert.match(refused(['--judge', dir])[1], /^usage:/, 'the folder after --judge is its value, not the archive');
  assert.equal(quantile([], 0.5), null);
});
