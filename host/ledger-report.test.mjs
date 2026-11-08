import assert from 'node:assert/strict';
import test from 'node:test';
import { entry, outcome, parse, render, renderRuns, summarize } from './ledger-report.mjs';

const at = s => new Date(`2026-10-26T10:${s}Z`);
const run = (job, id, provider, end, s) => [
  entry({ job, kind: 'run', phase: 'start', run: id, tool: 'npm run sprite gen-set', provider }, at(s)),
  ...(end ? [entry({ job, kind: 'run', phase: 'end', run: id, tool: 'npm run sprite gen-set', provider, ...end }, at(s))] : []),
];

test('entry keeps known fields only and caps text', () => {
  const e = entry({ job: 'j', kind: 'run', tool: 'x'.repeat(200), ms: '1200', exit: '0' }, at('00:00'));
  assert.equal(e.ms, 1200);
  assert.equal(e.tool.length, 80);
  assert.throws(() => entry({ job: 'j', kind: 'run', cmd: 'prompt text' }), /unknown field cmd/);
  assert.throws(() => entry({ job: 'j', kind: 'run', ms: 'n' }), /not a number/);
  assert.throws(() => entry({ job: 'j', kind: 'nope' }));
});

test('outcome separates questions, timeouts and interrupts from failures', () => {
  assert.deepEqual([0, 75, 2, 3, 124, 137, 130, 129, 143, 1].map(outcome),
    ['ok', 'needsInput', 'needsInput', 'notStarted', 'timeout', 'timeout', 'interrupted', 'interrupted', 'interrupted', 'failed']);
});

test('summary counts real codex sessions, wait and unfinished runs per job', () => {
  const lines = [
    entry({ job: '_health', kind: 'health', provider: 'codex', ms: 900, exit: 0 }, at('00:00')),
    entry({ job: 'a', kind: 'new' }, at('00:00')),
    ...run('a', '1', 'codex', { ms: 60000, waitMs: 5000, exit: 0, codexSessions: 3, account: 'personal' }, '01:00'),
    ...run('a', '2', 'codex', { ms: 120000, waitMs: 0, exit: 1, codexSessions: 1 }, '03:00'),
    ...run('a', '3', 'codex', { ms: 1000, waitMs: 0, exit: 75, codexSessions: 0 }, '03:30'),
    ...run('a', '4', 'grok', { ms: 30000, waitMs: 0, exit: 0, codexSessions: 0 }, '04:00'),
    ...run('a', '5', 'local', { ms: 5000, waitMs: 0, exit: 0, codexSessions: 2 }, '05:00'),
    ...run('a', '6', 'codex', null, '06:00'),
    entry({ job: 'a', kind: 'deliver', bytes: 100, codexSessions: 4 }, at('09:00')),
    entry({ job: 'a', kind: 'close' }, at('10:00')),
    ...run('b', '7', 'codex', { ms: 90000, waitMs: 0, exit: 0, codexSessions: 1 }, '02:00'),
  ];
  const s = summarize(lines);
  const a = s.jobs.find(j => j.job === 'a');
  assert.equal(a.codexSessions, 6);
  assert.equal(a.codexSessionsExact, 4);
  assert.equal(a.waitMs, 5000);
  assert.equal(a.activeMs, 216000);
  assert.equal(a.unfinished, 1);
  assert.equal(a.personalRuns, 1);
  assert.equal(a.state, 'closed');
  assert.deepEqual(a.providers.codex, { runs: 3, ok: 1, failed: 1, notStarted: 0, needsInput: 1, timeout: 0, interrupted: 0, ms: 181000 });
  assert.equal(s.jobs.some(j => j.job === '_health'), false);
  // Questions are not provider calls: codex durations are the 60 s, 120 s and 90 s runs only.
  assert.deepEqual(s.providers.codex, { runs: 3, p50Ms: 90000, p95Ms: 120000 });
  assert.match(s.warnings.join('\n'), /\(local\) started 2 codex/);
  assert.equal(summarize(lines, 'b').jobs.length, 1);
  assert.match(render(s), /끝나지 않은 실행 1 {2}개인 계정 실행 1/);
  assert.match(render(s), /a {2}등록 확인 {2}codex 세션 4 /);
  assert.match(render(summarize(lines, 'b')), /codex 세션 약 1\(/);
});

test('parse skips broken lines and the report says so', () => {
  const { entries, skipped } = parse('{"job":"a","kind":"new","at":"2026-10-26T10:00:00Z"}\n{"job":"a","ki\n');
  assert.equal(entries.length, 1);
  assert.equal(skipped, 1);
  assert.match(render(summarize(entries), skipped), /읽지 못한 줄 1개/);
});

test('runs view lists each run of a job with its result, time and codex sessions', () => {
  const lines = [
    ...run('a', '1', 'codex', { ms: 60000, exit: 0, codexSessions: 2 }, '01:00'),
    ...run('b', '2', 'grok', { ms: 1000, exit: 0 }, '02:00'),
    ...run('a', '3', 'codex', { ms: 5000, exit: 1, codexSessions: 0 }, '03:00'),
    ...run('a', '4', 'local', null, '04:00'),
  ];
  const rows = renderRuns(lines, 'a').split('\n');
  assert.equal(rows.length, 3);
  assert.match(rows[0], /^10-26 10:01:00 {2}codex {2}ok\(0\) .* codex 2 {2}npm run sprite gen-set$/);
  assert.match(rows[1], /failed\(1\)/);
  assert.match(rows[2], /local {2}끝나지 않음 .* — +codex —/);
  assert.equal(renderRuns(lines).split('\n').length, 4);
  assert.equal(renderRuns([], 'a'), '기록 없음');
});
