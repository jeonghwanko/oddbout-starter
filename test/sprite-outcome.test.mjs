import assert from 'node:assert/strict';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { judgeOutcome, outcomeReportPath, readOutcome } from '../host/sprite-outcome.mjs';

const error = (code, retryable, extra = {}) => ({ state: null, code, retryable, message: code, ...extra });
const report = (submitted, errors, extra = {}) => ({ ok: false, provider_submitted: submitted, errors, ...extra });

test('where each generating command leaves its outcome report', () => {
  assert.equal(outcomeReportPath(['gen', '--provider', 'codex', '--report', 'a/r.json']), 'a/r.json');
  assert.equal(outcomeReportPath(['video-resume', '--request-id', 'x', '--report=b/c.json']), 'b/c.json');
  assert.equal(outcomeReportPath(['gen-set', '--run-dir', 'runs/r1']), 'runs/r1/reports/gen-set/set.report.json');
  assert.equal(outcomeReportPath(['video-set', '--out-dir', 'clips']), 'clips/set.report.json');
  assert.equal(outcomeReportPath(['gen', '--prompt', 'x']), null);
});

test('exit 3, or a report that says nothing left, is not charged', () => {
  assert.deepEqual(judgeOutcome({ code: 3, report: null }), { charge: 'not-charged', next: 'fix', codes: [], requestIds: [] });
  const refused = judgeOutcome({ code: 3, report: report(false, [error('preflight', false)]) });
  assert.deepEqual([refused.charge, refused.next], ['not-charged', 'fix']);
  const stoppedFirst = judgeOutcome({ code: 143, report: report(false, [error('interrupted', true)]) });
  assert.deepEqual([stoppedFirst.charge, stoppedFirst.next], ['not-charged', 'retry']);
});

test('a request that left is retried only when every error says so', () => {
  const limited = judgeOutcome({ code: 1, report: report(true, [error('provider-rate-limited', true)]) });
  assert.deepEqual([limited.charge, limited.next], ['request-sent', 'retry']);
  assert.equal(judgeOutcome({ code: 1, report: report(true, [error('provider-refused', false)]) }).next, 'fix');
  // retryable alone never reruns a request whose outcome cannot be told, or one stopped after it left
  assert.equal(judgeOutcome({ code: 1, report: report(true, [error('outcome-unknown', false)]) }).next, 'inspect');
  assert.equal(judgeOutcome({ code: 1, report: report(true, [error('provider-timeout', true), error('outcome-unknown', false)]) }).next, 'inspect');
  // A codex timeout was stopped after its request left (sprite-gen: retryable false since it may have made a paid image).
  assert.equal(judgeOutcome({ code: 1, report: report(true, [error('provider-timeout', false)]) }).next, 'inspect');
  assert.equal(judgeOutcome({ code: 143, report: report(true, [error('interrupted', true)]) }).next, 'inspect');
});

test('a video request xAI took is resumed, never generated again', () => {
  const stopped = judgeOutcome({ code: 143, report: report(true, [error('interrupted', false, { request_id: 'req-1' })], { request_id: 'req-1' }) });
  assert.deepEqual([stopped.next, stopped.requestIds], ['resume', ['req-1']]);
  const unfinished = judgeOutcome({ code: 1, report: report(true, [error('generation-unfinished', false)], { request_id: 'req-2' }) });
  assert.deepEqual([unfinished.next, unfinished.requestIds], ['resume', ['req-2']]);
  // a video-set item: the set's error names the code, the item's clip report names the request
  assert.equal(judgeOutcome({ code: 1, report: report(true, [error('generation-unfinished', false, { item: 'side-walk' })]) }).next, 'resume');
});

test('no report is unknown and inspected; the codex question is answered', () => {
  assert.deepEqual(judgeOutcome({ code: 1, report: null }), { charge: 'unknown', next: 'inspect', codes: [], requestIds: [] });
  assert.equal(judgeOutcome({ code: 75, report: report(true, [error('provider-asks', false)]) }).next, 'answer');
});

test('a report is read only when this run wrote it and it carries the outcome keys', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sprite-outcome-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'r.json');
  await writeFile(file, JSON.stringify(report(false, [error('preflight', false)])));
  assert.equal((await readOutcome(file, { since: Date.now() - 5000 })).provider_submitted, false);
  const old = new Date(Date.now() - 3600_000);
  await utimes(file, old, old);
  assert.equal(await readOutcome(file, { since: Date.now() }), null, "an earlier run's report never answers for this one");
  await writeFile(file, JSON.stringify({ provider: 'codex' })); // a report from before sprite-gen wrote outcomes
  assert.equal(await readOutcome(file), null);
  assert.equal(await readOutcome(path.join(dir, 'none.json')), null);
  assert.equal(await readOutcome(null), null);
});

test(
  'the kit wrapper passes a stop on and waits for sprite-gen to write its report',
  { skip: process.platform === 'win32' && 'Windows ends a process on SIGTERM without a handler' },
  async () => {
    const { spawn } = await import('node:child_process');
    const { readFile: read } = await import('node:fs/promises');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sprite-wrapper-'));
    const done = path.join(dir, 'report.json');
    // A stand-in for sprite-gen: on SIGTERM it takes a moment to write its report, then exits 143.
    const engine =
      `process.on('SIGTERM', () => setTimeout(() => { require('fs').writeFileSync(${JSON.stringify(done)}, 'written'); process.exit(143); }, 300));` +
      ' console.log("ready"); setInterval(() => {}, 1000);';
    const wrapper =
      `import { run } from ${JSON.stringify(new URL('../scripts/sprite-gen.mjs', import.meta.url).href)};` +
      ` process.exitCode = await run(process.execPath, ['-e', ${JSON.stringify(engine)}]);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', wrapper], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise(resolve => child.stdout.once('data', resolve));
    child.kill('SIGTERM'); // the wrapper alone, as a stop sent to one process
    const code = await new Promise(resolve => child.once('exit', resolve));
    assert.equal(code, 143);
    assert.equal(await read(done, 'utf8'), 'written', 'the wrapper ended after sprite-gen wrote its report');
    await rm(dir, { recursive: true, force: true });
  },
);

test('an error whose code is not a string is an outcome nobody can read: never retried, whatever its retryable says', () => {
  for (const odd of [503, null, { status: 503 }]) {
    const verdict = judgeOutcome({ code: 1, report: report(true, [error(odd, true)]) });
    assert.deepEqual([verdict.next, verdict.codes], ['inspect', ['outcome-unknown']], JSON.stringify(odd));
  }
  // Beside a retryable error it still wins: one unreadable error is enough to look first.
  assert.equal(judgeOutcome({ code: 1, report: report(true, [error('provider-unavailable', true), error(429, true)]) }).next, 'inspect');
  assert.equal(judgeOutcome({ code: 1, report: { ...report(true, []), errors: 'not a list' } }).next, 'inspect');
});
