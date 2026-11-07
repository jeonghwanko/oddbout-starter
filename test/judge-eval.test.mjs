import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createJudgeArchive } from '../host/generation-stages.mjs';
import { evaluate, labelQueue, main, quantile, readArchive, readLabels, rerun } from '../scripts/judge-eval.mjs';

const pass5 = { whole: 'pass', side: 'pass', match: 'pass', style: 'pass', clean: 'pass' };
const side = (pixels, codex, { decidedBy = codex ? 'pixels+codex' : 'pixels', mode = 'hybrid', pms = 80, cms = 12_000 } = {}) => ({
  job: 'j', item: 'side-0-a/take-0', kind: 'side', mode, decidedBy, final: codex ?? pixels,
  pixels: { model: 'pixels-v1', observed: 'pixels-v1', checks: { ...pass5, side: 'unknown', ...pixels }, measures: { ms: pms }, ms: pms },
  codex: codex ? { checks: { ...pass5, ...codex }, model: 'gpt', effort: 'medium', observed: 'gpt', ms: cms } : null });

/** An archive the host's own writer made, with `entries` in order a minute apart. */
async function archiveOf(entries, imageDays = 0, files = []) {
  const dir = await mkdtemp(path.join(tmpdir(), 'judge-eval-'));
  let minute = 0;
  const archive = createJudgeArchive({ dir, imageDays, now: () => new Date(Date.UTC(2026, 10, 7, 10, minute++)) });
  const ids = [];
  for (const entry of entries) ids.push(await archive.note(entry, files));
  return { dir, ids };
}

test('evaluate: the pixel judge against codex or a label, per check; codex share and both judges\' times', async () => {
  const { dir, ids } = await archiveOf([
    side({ whole: 'fail' }, null, { decidedBy: 'pixels', pms: 50 }),          // decided alone: no reference
    side({ style: 'unknown' }, { side: 'fail' }, { cms: 10_000 }),            // codex failed the open side
    side({ match: 'fail' }, { match: 'pass' }, { mode: 'codex', decidedBy: 'codex', cms: 14_000 }),   // a shadow fail codex passed
    side({}, { side: 'pass' }, { pms: 120, cms: 12_000 }),
  ]);
  const { records, skipped } = readArchive(dir);
  assert.deepEqual([records.length, skipped], [4, 0]);
  const report = evaluate(records).side;
  assert.equal(report.lines, 4);
  assert.equal(report.codexShare, 0.75, 'codex judged three of the four (hybrid twice, codex mode once)');
  assert.deepEqual(report.decidedBy, { pixels: 1, 'pixels+codex': 2, codex: 1 });
  assert.deepEqual(report.pixelMs, { p50: 80, p95: 120 });
  assert.deepEqual(report.codexMs, { p50: 12_000, p95: 14_000 });
  // side: always open in pixels-v1 — nothing decided, codex's answers counted under unknown.
  assert.deepEqual(report.checks.side.matrix.unknown, { pass: 2, fail: 1, none: 1 });
  assert.equal(report.checks.side.decidedShare, 0);
  assert.equal(report.checks.side.agreement, null);
  // match: one pixel fail that codex passed, two passes that held, one pass with no reference.
  assert.deepEqual(report.checks.match.matrix.fail, { pass: 1, fail: 0, none: 0 });
  assert.deepEqual([report.checks.match.passHeld, report.checks.match.failHeld, report.checks.match.agreement], [1, 0, 0.667]);
  // A label outranks codex: the shadow fail was right after all.
  const labels = readLabels(`${JSON.stringify({ id: ids[2], checks: { match: 'fail', notes: 'x' } })}\nnot json\n`);
  assert.deepEqual(labels, { [ids[2]]: { match: 'fail' } });
  const labelled = evaluate(records, labels).side.checks.match;
  assert.deepEqual([labelled.failHeld, labelled.labelled, labelled.finalAgreement], [1, 1, 0]);
});

test('labelQueue: disagreements first (pixel fails before passes), then what the pixels decided alone; labelled checks left out', async () => {
  const { dir, ids } = await archiveOf([
    side({ whole: 'fail' }, null, { decidedBy: 'pixels' }),
    side({}, { match: 'fail' }),
    side({ clean: 'fail' }, { clean: 'pass' }, { mode: 'codex', decidedBy: 'codex' }),
  ]);
  const { records } = readArchive(dir);
  const queue = labelQueue(records);
  assert.deepEqual(queue.slice(0, 2).map(q => [q.id, q.check, q.pixels, q.codex, q.why]),
    [[ids[2], 'clean', 'fail', 'pass', 'disagree'], [ids[1], 'match', 'pass', 'fail', 'disagree']]);
  assert.deepEqual(queue[2].why === 'pixels-alone' && [queue[2].id, queue[2].check, queue[2].pixels], [ids[0], 'whole', 'fail']);
  assert.ok(queue.slice(3).every(q => q.why === 'pixels-alone' && q.pixels === 'pass'));
  assert.equal(labelQueue(records, { [ids[2]]: { clean: 'fail' } }).some(q => q.id === ids[2] && q.check === 'clean'), false);
});

test('rerun: the archived pictures judged again, lines without pictures left out; the CLI says it in text or JSON', async () => {
  const pics = await mkdtemp(path.join(tmpdir(), 'judge-eval-pics-'));
  await writeFile(path.join(pics, 'front.png'), 'f'); await writeFile(path.join(pics, 'take-0.png'), 't');
  const { dir } = await archiveOf([side({}, { side: 'fail' })], 30, [path.join(pics, 'front.png'), path.join(pics, 'take-0.png')]);
  // One line without pictures beside it, and a torn line.
  const { dir: other } = await archiveOf([side({}, null, { decidedBy: 'pixels' })]);
  const { records } = readArchive(other);
  await writeFile(path.join(dir, 'judgments-2026-10.jsonl'), `${JSON.stringify({ ...records[0] })}\n{"v":1,"id"`);
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    writeFileSync(args.at(-1), JSON.stringify({ kind: 'side', model: 'pixels-v2', checks: { ...pass5, side: 'fail' }, notes: 'n', measures: { ms: 300 } }));
    return { status: 0 };
  };
  const all = readArchive(dir);
  assert.deepEqual([all.records.length, all.skipped], [2, 1]);
  const again = rerun(all.records, dir, { python: 'py', motions: 'motions.py', run });
  assert.deepEqual([again.records.length, again.failed], [1, 0]);
  assert.deepEqual(calls[0].slice(0, 5), ['py', '-I', 'motions.py', 'pixel-judge', 'side']);
  assert.match(calls[0][5], /images[\\/]2026-11-07[\\/][0-9a-f]{16}[\\/]0-front\.png$/);
  assert.deepEqual([again.records[0].pixels.model, again.records[0].pixels.checks.side, again.records[0].pixels.ms], ['pixels-v2', 'fail', 300]);
  // The new judge decides side, and agrees with codex on it.
  assert.equal(evaluate(again.records).side.checks.side.failHeld, 1);

  const lines = [];
  assert.equal(main([dir], { out: line => lines.push(line) }), 0);
  assert.match(lines.join('\n'), /2 judgments \(1 unreadable lines skipped\), 0 labelled/);
  assert.match(lines.join('\n'), /side: 2 judgments, codex asked on 50\.0%/);
  const json = [];
  assert.equal(main([dir, '--json', '--queue', '1'], { out: line => json.push(line) }), 0);
  const parsed = JSON.parse(json.join('\n'));
  assert.deepEqual([parsed.lines, parsed.queue.length, parsed.report.side.lines], [2, 1, 2]);
  assert.equal(main([dir, '--rerun'], { out: () => {} }), 2, '--rerun needs --python');
  assert.equal(main([path.join(dir, 'missing')], { out: () => {} }), 2);
  assert.equal(quantile([], 0.5), null);
  await mkdir(path.join(dir, 'empty'), { recursive: true });
});
