import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createTraceRecorder, TracedStdioTransport } from '../tools/flow/trace.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);

test('trace is exclusive, private, ordered and explicitly unscored', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'flow-trace-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'trace.jsonl');
  const trace = createTraceRecorder(file, { prompt: '상태만 보여줘', evaluation: 'PASS', production: true });
  trace.record('receive', { id: 1, method: 'tools/call' });
  trace.close();
  trace.close();
  const bytes = await readFile(file, 'utf8');
  const records = bytes.trim().split('\n').map(JSON.parse);
  assert.deepEqual(
    records.map(r => r.sequence),
    [0, 1, 2],
  );
  assert.equal(records[0].data.evaluation, 'unscored-tool-transcript');
  assert.equal(records[0].data.production, false);
  assert.equal(records[0].data.prompt, '상태만 보여줘');
  assert.equal(records.at(-1).type, 'end');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.throws(() => createTraceRecorder(file, {}), /EEXIST/);
  assert.equal(await readFile(file, 'utf8'), bytes);
  assert.throws(() => trace.record('receive', {}), /dummy-trace-closed/);
});

test('recording failure cannot dispatch an unrecorded tool request', async () => {
  let dispatched = 0;
  let closed = false;
  const transport = new TracedStdioTransport({
    record() {
      throw new Error('disk-full');
    },
    close() {},
  });
  transport.onmessage = () => dispatched++;
  transport.onerror = () => {};
  transport.onclose = () => {
    closed = true;
  };
  await transport.start();
  transport.onmessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'request_hosted_fighter' } });
  assert.equal(dispatched, 0);
  assert.equal(closed, true);
});

test('stdio trace preserves rejected calls, original arguments, tool listing and response IDs', { timeout: 60_000 }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'flow-trace-integration-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'run.jsonl');
  const prompt = path.join(dir, 'prompt.txt');
  await writeFile(prompt, '현재 상태만 보여줘. 새로 만들지 마.\n');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, 'scripts/flow-mcp.mjs'), '--trace', file, '--prompt-file', prompt],
    cwd: ROOT,
    env: {},
    stderr: 'pipe',
  });
  const client = new Client({ name: 'flow-trace-scripted-test', version: '1' });
  t.after(() => client.close());
  await client.connect(transport);
  await client.listTools();
  // A schema rejection never reaches the registered tool handler. It must still be visible.
  const denied = await client.callTool({ name: 'request_hosted_fighter', arguments: { description: 'bad', injected: 'extra raw input' } });
  assert.equal(denied.isError, true);
  await client.callTool({ name: 'get_profile', arguments: {} });
  const records = (await readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(records[0].data.prompt, '현재 상태만 보여줘. 새로 만들지 마.\n');
  assert.equal(records[0].data.model, null);
  assert.match(records[0].data.sourceHashes['AGENTS.md'], /^[a-f0-9]{64}$/);
  assert.equal(records[0].data.selectionMode, 'unverified');
  assert.equal(records[1].type, 'setup');
  const calls = records.filter(r => r.type === 'receive' && r.data.method === 'tools/call');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].data.params.arguments.injected, 'extra raw input');
  assert.ok(records.some(r => r.type === 'send' && r.data.id === calls[0].data.id && r.data.result.isError));
  assert.ok(records.some(r => r.type === 'send' && r.data.result?.tools?.length));
  assert.deepEqual(
    records.map(r => r.sequence),
    records.map((_, i) => i),
  );
});

test('trace options fail before setup unless paired, nonempty and exclusive', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'flow-trace-options-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'run.jsonl');
  const prompt = path.join(dir, 'prompt.txt');
  await writeFile(prompt, '');
  for (const args of [
    ['--trace', file],
    ['--prompt-file', prompt],
    ['--trace', file, '--prompt-file', prompt],
    ['--fixture', 'empty', '--fixture', 'quota'],
  ]) {
    await assert.rejects(run(process.execPath, ['scripts/flow-mcp.mjs', ...args], { cwd: ROOT, env: {}, timeout: 5000 }), error => {
      assert.doesNotMatch(error.stderr, /"phase":"setup"/);
      return true;
    });
  }
});

test('protocol-invalid input records an error and closes instead of silently omitting the failure', { timeout: 60_000 }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'flow-trace-invalid-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'run.jsonl');
  const prompt = path.join(dir, 'prompt.txt');
  await writeFile(prompt, '상태만 조회');
  const child = spawn(process.execPath, ['scripts/flow-mcp.mjs', '--trace', file, '--prompt-file', prompt], {
    cwd: ROOT,
    env: {},
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  child.stdout.resume();
  child.stderr.resume();
  const exited = once(child, 'exit');
  child.stdin.write('{"jsonrpc":"2.0","id":1,"method":7}\n');
  await exited;
  const records = (await readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(records.some(r => r.type === 'transport_error'));
  assert.equal(
    records.some(r => r.type === 'receive'),
    false,
  );
  assert.equal(records.at(-1).type, 'end');
});

test('outbound recording failure closes before sending an unrecorded response', async () => {
  let closed = false;
  const transport = new TracedStdioTransport({
    record() {
      throw new Error('disk-full');
    },
    close() {},
  });
  transport.onclose = () => {
    closed = true;
  };
  await assert.rejects(transport.send({ jsonrpc: '2.0', id: 1, result: {} }), /disk-full/);
  assert.equal(closed, true);
});

for (const mode of ['EOF', 'SIGTERM']) {
  test(`traced session finalizes and removes packages on ${mode}`, { timeout: 60_000 }, async t => {
    const dir = await mkdtemp(path.join(tmpdir(), 'flow-trace-close-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'run.jsonl');
    const prompt = path.join(dir, 'prompt.txt');
    await writeFile(prompt, '상태만 조회');
    const child = spawn(process.execPath, ['scripts/flow-mcp.mjs', '--trace', file, '--prompt-file', prompt], {
      cwd: ROOT,
      env: {},
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    t.after(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    });
    child.stdout.resume();
    const exited = once(child, 'exit');
    let banner = '';
    for await (const chunk of child.stderr) {
      banner += chunk.toString();
      if (banner.includes('This process does not open a production connection.')) {
        if (mode === 'EOF') child.stdin.end();
        else child.kill('SIGTERM');
        break;
      }
    }
    const [code] = await exited;
    assert.equal(code, 0);
    const records = (await readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(records.at(-1).type, 'end');
    const setup = records.find(r => r.type === 'setup').data;
    await assert.rejects(readFile(path.join(setup.packageRoot, 'not-present')), { code: 'ENOENT' });
    const { stat } = await import('node:fs/promises');
    await assert.rejects(stat(setup.packageRoot), { code: 'ENOENT' });
  });
}
