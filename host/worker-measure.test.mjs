import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CALL_TOOLS, createTally, toolName, versionsEvent } from './generation-worker.mjs';
import { JUDGE, MODELS, VIDEO_REQUESTED } from './generation-stages.mjs';
import { entry } from './ledger-report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('a stage names each og command without its arguments', () => {
  assert.equal(toolName(['npm', 'run', 'sprite', '--', 'gen', '--provider', 'codex', '--prompt-file', 'p.txt']), 'sprite gen');
  assert.equal(toolName(['npm', 'run', 'fighter:gait', '--', 'loop-review', '--clip', 'walk']), 'fighter:gait loop-review');
  assert.equal(toolName(['npm', 'run', '--silent', 'sprite', '--', 'video-set']), 'sprite video-set');
  assert.equal(toolName(['codex', 'exec', '--output-schema', 's.json', '-']), 'codex');
});

test('calls are runs, failures and seconds per command, small enough for the finished event', () => {
  const tally = createTally();
  tally.add(['npm', 'run', 'sprite', '--', 'gen'], 0, 31_400);
  tally.add(['npm', 'run', 'sprite', '--', 'gen'], 1, 2_000);
  tally.add(['codex', 'exec'], 0, 9_600);
  assert.deepEqual(tally.value(), { 'sprite gen': [2, 1, 33], codex: [1, 0, 10] });

  // The finished event's data is capped at 2000 bytes, and a finish that does not fit is refused: the worst case stays well inside.
  const many = createTally();
  for (let i = 0; i < 40; i += 1) for (let r = 0; r < 50; r += 1) many.add(['npm', 'run', `long-script-${i}`, '--', `verb-${i}`], r % 2, 86_400_000);
  const calls = many.value();
  assert.equal(Object.keys(calls).length, CALL_TOOLS);
  assert.ok(calls.other);
  const event = { outcome: 'review', status: 'needs_review', code: 'motions-something-long-enough-to-fill-sixty-chars-of-code', calls, choice: 'a' };
  assert.ok(JSON.stringify(event).length < 1500, JSON.stringify(event).length);
});

test('the versions event names the kit, the engine and the models asked for, and a commit it cannot read is null', async () => {
  const seen = [];
  const event = await versionsEvent('/kit', async dir => { seen.push(dir); return dir === '/kit' ? 'a'.repeat(40) : null; });
  // Requested only (2026-11-05): what codex recorded comes with the stage's end, as its `models` event, never copied from these.
  assert.deepEqual(event, { kind: 'versions', kit: 'a'.repeat(40), engine: null,
    requested: { text: MODELS.text, imageAgent: MODELS.image, judge: JUDGE.model, judgeEffort: JUDGE.effort, video: VIDEO_REQUESTED } });
  assert.deepEqual(seen, ['/kit', path.join('/kit', 'vendor', 'sprite-gen')]);
  assert.ok(JSON.stringify(event).length < 2000);
});

test('og report --json is the summary as data', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ledger-json-')), file = path.join(dir, 'ledger.jsonl');
  try {
    const at = new Date('2026-10-29T05:00:00Z');
    const lines = [entry({ job: '20261029-gen-ab', kind: 'run', phase: 'start', run: '1', tool: 'npm run sprite gen', provider: 'codex' }, at),
      entry({ job: '20261029-gen-ab', kind: 'run', phase: 'end', run: '1', tool: 'npm run sprite gen', provider: 'codex', ms: 34000, exit: 0 }, at)];
    await writeFile(file, lines.map(line => JSON.stringify(line)).join('\n') + '\n{broken\n');
    const out = JSON.parse(execFileSync(process.execPath, [path.join(here, 'ledger-report.mjs'), file, '--json'], { encoding: 'utf8' }));
    assert.equal(out.skipped, 1);
    assert.deepEqual(out.jobs.map(j => [j.job, j.providers.codex.runs, j.providers.codex.ok, j.activeMs]), [['20261029-gen-ab', 1, 1, 34000]]);
    const none = JSON.parse(execFileSync(process.execPath, [path.join(here, 'ledger-report.mjs'), path.join(dir, 'missing.jsonl'), '--json'], { encoding: 'utf8' }));
    assert.deepEqual(none.jobs, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
