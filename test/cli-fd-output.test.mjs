import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm, readFile, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCliJson } from '../dots.mjs';

const execute = promisify(execFile);
const exec = (file, args, options = {}) => execute(file, args, { timeout: 30000, windowsHide: true, ...options });
const cli = fileURLToPath(new URL('../dots.mjs', import.meta.url));

test('short writes and interruptions preserve exact UTF-8 bytes and trailing newline', async () => {
  const value = { text: '한글🙂\r\n다음 줄\n' }, chunks = [];
  let attempts = 0, waits = 0;
  await writeCliJson(1, value, {
    wait: async () => { waits++; },
    write(fd, bytes, offset, length) {
      attempts++;
      if (attempts === 1) throw Object.assign(Error('fixture'), { code: 'EINTR' });
      if (attempts === 2) throw Object.assign(Error('fixture'), { code: 'EAGAIN' });
      if (attempts === 3) throw Object.assign(Error('fixture'), { code: 'EWOULDBLOCK' });
      const count = Math.min(length, 3);
      chunks.push(Buffer.from(bytes.subarray(offset, offset + count)));
      return count;
    },
  });
  assert.equal(waits, 2);
  assert.equal(Buffer.concat(chunks).toString(), JSON.stringify(value, null, 2) + '\n');
});

test('zero progress, broken pipe and persistent backpressure fail without claiming delivery', async () => {
  await assert.rejects(writeCliJson(1, {}, { write: () => 0 }), /front-door-output-write-failed/);
  await assert.rejects(writeCliJson(1, {}, { write: () => {
    throw Object.assign(Error('fixture-broken-pipe'), { code: 'EPIPE' });
  } }), { code: 'EPIPE' });
  await assert.rejects(writeCliJson(1, {}, { timeout: 0 }), /front-door-output-timeout/);
  await assert.rejects(writeCliJson(1, {}, { timeout: 25, write: () => {
    throw Object.assign(Error('fixture-backpressure'), { code: 'EAGAIN' });
  } }), /front-door-output-timeout/);
});

test('real child default execFile captures large Unicode JSON on both fds and exit zero', async () => {
  const text = '한글🙂\r\n'.repeat(100000);
  const url = new URL('../dots.mjs', import.meta.url).href;
  const code = 'import {writeCliJson} from ' + JSON.stringify(url) +
    ';const v={text:"한글🙂\\r\\n".repeat(100000)};' +
    'await writeCliJson(1,v);await writeCliJson(2,{kind:"stderr",text:v.text});';
  const { stdout, stderr } = await exec(process.execPath, ['--input-type=module', '-e', code], {
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(stdout, JSON.stringify({ text }, null, 2) + '\n');
  assert.equal(stderr, JSON.stringify({ kind: 'stderr', text }, null, 2) + '\n');
});

test('actual CLI validation error preserves stderr JSON, empty stdout and exit one', async () => {
  await assert.rejects(exec(process.execPath, [cli, '--invalid-fixture-argument']), error => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.deepEqual(JSON.parse(error.stderr), { ok: false, code: 'invalid-arguments' });
    return true;
  });
});

test('actual CLI startup preserves exit zero, but unwritable stdout makes it fail', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'oddbout-cli-fd-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = path.join(root, 'runtime'), workspace = path.join(root, 'workspace');
  const emptyHooks = path.join(root, 'empty-hooks');
  await mkdir(emptyHooks);
  await mkdir(path.join(runtime, 'scripts'), { recursive: true });
  await mkdir(path.join(workspace, 'output'), { recursive: true });
  // Synthetic startup return only: no provider, creation or authentication code runs.
  const value = { fixture: '한글🙂\n', automaticGeneration: false,
    nextAction: { action: 'connect-grok-subscription', dispatch: false } };
  await writeFile(path.join(runtime, 'scripts/dots-start.mjs'),
    'export async function start(){return ' + JSON.stringify(value) + '}');
  await exec('git', ['init', '--quiet'], { cwd: runtime });
  await exec('git', ['add', 'scripts/dots-start.mjs'], { cwd: runtime });
  await exec('git', ['-c', 'user.name=Local Fixture', '-c', 'user.email=fixture@invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + emptyHooks,
    'commit', '--quiet', '-m', 'local synthetic fixture'], { cwd: runtime });
  const commit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: runtime })).stdout.trim();
  await writeFile(path.join(workspace, 'output/dots-workspace.json'),
    JSON.stringify({ schemaVersion: 1, provider: 'grok', runtime, commit }));
  const { stdout, stderr } = await exec(process.execPath, [cli, '--workspace', workspace]);
  assert.deepEqual(JSON.parse(stdout), value);
  assert.equal(stderr, '');
  const destination = path.join(root, 'readonly-output');
  await writeFile(destination, '');
  const handle = await open(destination, 'r');
  try {
    const failed = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, '--workspace', workspace], {
        stdio: ['ignore', handle.fd, 'pipe'], timeout: 30000, windowsHide: true,
      });
      let errorText = '';
      child.stderr.on('data', chunk => { errorText += chunk; });
      child.once('error', reject);
      child.once('close', code => resolve({ code, errorText }));
    });
    assert.equal(failed.code, 1);
    assert.equal(JSON.parse(failed.errorText).ok, false);
    assert.equal(await readFile(destination, 'utf8'), '');
  } finally { await handle.close(); }
});

test('concurrent default execFile calls preserve separate actual CLI error responses', async () => {
  await Promise.all(Array.from({ length: 8 }, () =>
    assert.rejects(exec(process.execPath, [cli, '--invalid-fixture-argument']), error => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, '');
      assert.equal(JSON.parse(error.stderr).code, 'invalid-arguments');
      return true;
    })));
});
