import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runRegister } from '../scripts/register-fighter.mjs';
import { startDummyServer } from '../tools/flow/server.mjs';
import { createDummyStore } from '../tools/flow/store.mjs';
import { DUMMY_SIDECAR } from '../tools/flow/seal.mjs';

async function packageDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'flow-safety-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(fileURLToPath(new URL('../examples/sparring-bot/', import.meta.url)), dir, { recursive: true });
  return dir;
}

test('an explicitly empty --dummy URL cannot fall through to live registration', async t => {
  const dir = await packageDir(t);
  let connects = 0;
  const result = await runRegister({
    argv: ['--dir', dir, '--dummy', '', '--submit'],
    env: {},
    connect: async () => {
      connects++;
      throw new Error('live-connect');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'dummy-url-invalid');
  assert.equal(result.production, false);
  assert.equal(connects, 0);
});

test('sidecar markers fail closed without following links or opening a FIFO', async t => {
  for (const kind of ['incomplete-json', 'dangling-symlink', 'fifo']) {
    await t.test(kind, async t => {
      const dir = await packageDir(t);
      const sidecar = path.join(dir, DUMMY_SIDECAR);
      if (kind === 'incomplete-json') await writeFile(sidecar, '{}');
      else if (kind === 'dangling-symlink') await symlink(path.join(dir, 'missing-target'), sidecar);
      else await promisify(execFile)('mkfifo', [sidecar]);
      // A separate process lets the test kill a regression that opens the FIFO indefinitely.
      const script = fileURLToPath(new URL('../scripts/register-fighter.mjs', import.meta.url));
      let answer;
      try {
        await promisify(execFile)(process.execPath, [script, '--dir', dir], { timeout: 5000 });
        assert.fail('the dummy sidecar must refuse a live dry run');
      } catch (error) {
        assert.equal(error.killed, false);
        assert.equal(error.code, 1);
        answer = JSON.parse(error.stdout);
      }
      assert.equal(answer.code, 'dummy-package-refused');
      assert.equal(answer.production, false);
    });
  }
});

test('dummy registration preserves the live submission record and keeps its own retry key', async t => {
  const dir = await packageDir(t);
  const liveSubmission = '11111111-1111-4111-8111-111111111111';
  const live = await runRegister({
    argv: ['--dir', dir, '--submit'],
    env: {},
    connect: async () => ({ request: async () => ({ stage: 'registered', submissionId: liveSubmission }) }),
  });
  const originalRecord = await readFile(live.idempotencyKeyPath, 'utf8');
  const server = await startDummyServer(createDummyStore());
  t.after(() => server.close());
  let liveConnects = 0;
  const submitDummy = () =>
    runRegister({
      argv: ['--dir', dir, '--dummy', server.url, '--submit'],
      env: {},
      wait: async () => {},
      connect: async () => {
        liveConnects++;
        throw new Error('live-connect');
      },
    });
  const dummy = await submitDummy();
  const retry = await submitDummy();
  assert.equal(dummy.ok, true);
  assert.equal(dummy.mode, 'dummy');
  assert.equal(dummy.production, false);
  assert.notEqual(dummy.idempotencyKey, live.idempotencyKey);
  assert.notEqual(dummy.idempotencyKeyPath, live.idempotencyKeyPath);
  assert.notEqual(dummy.submissionId, liveSubmission);
  assert.equal(retry.submissionId, dummy.submissionId);
  assert.equal(retry.idempotencyKey, dummy.idempotencyKey);
  assert.equal(retry.idempotencyKeyReused, true);
  assert.equal(liveConnects, 0);
  assert.equal(await readFile(live.idempotencyKeyPath, 'utf8'), originalRecord);
  const liveDry = await runRegister({ argv: ['--dir', dir], env: {} });
  assert.equal(liveDry.submissionId, liveSubmission);
  assert.equal(liveDry.idempotencyKey, live.idempotencyKey);
});
