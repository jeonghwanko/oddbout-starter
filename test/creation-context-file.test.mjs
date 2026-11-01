import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fileContextRequest, parseContextFileArgs } from '../scripts/creation-context-file.mjs';
import { main as contextMain } from '../scripts/creation-context.mjs';
import { main as toolMain } from '../scripts/creation-tool.mjs';
import { fetchCreationContext } from '../mcp/creation-context.mjs';
import { runtimeFileList } from '../scripts/build-plugin-bundle.mjs';
import source from '../deploy/creation-context-source.json' with { type: 'json' };
import gameContext from './fixtures/game-creation-context.json' with { type: 'json' };

const exec = promisify(execFile);
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'context-handoff-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const contextFile = path.join(root, 'context.json'), contextReceipt = path.join(root, 'receipt.json');
  const save = async (bytes = Buffer.from(JSON.stringify(gameContext)), override = {}) => {
    const receipt = { schemaVersion: 1, sourceUrl: source.url,
      gitBlobSha1: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
      sha256: createHash('sha256').update(bytes).digest('hex'), retrievedAt: new Date().toISOString(), ...override };
    await writeFile(contextFile, bytes); await writeFile(contextReceipt, JSON.stringify(receipt));
    return receipt;
  };
  await save();
  const flags = ['--context-file', contextFile, '--context-receipt', contextReceipt];
  const call = async (name, args) => {
    const input = path.join(root, 'args.json'); await writeFile(input, JSON.stringify(args));
    return toolMain(['call', root, name, input, ...flags]);
  };
  return { root, contextFile, contextReceipt, save, flags, call };
}

test('original bytes reach the normal validator and scoped tools, without another network route', async t => {
  const f = await fixture(t), request = await fileContextRequest(f.contextFile, f.contextReceipt);
  const bytes = await readFile(f.contextFile);
  assert.deepEqual(Buffer.from(await (await request(source.url)).arrayBuffer()), bytes);
  assert.deepEqual(await contextMain(f.flags), gameContext);
  const data = (await f.call('get_fighter_spec', { section: 'context', group: 'attacks' })).structuredContent;
  assert.equal(data.ok, true);
  assert.deepEqual(Object.keys(data.data.contract.motions), ['combo', 'slam', 'dash']);
  await assert.rejects(request('https://example.invalid/'), /creation-context-file-source/);
  const wrong = structuredClone(gameContext); delete wrong.contract.motions.walk;
  await f.save(Buffer.from(JSON.stringify(wrong)));
  await assert.rejects(fetchCreationContext({ request }), /creation-context-motions/);
});

test('each request rereads integrity and freshness; stale or future metadata fails closed', async t => {
  const f = await fixture(t);
  const fetchedAt = Date.now(); let currentTime = fetchedAt;
  t.mock.method(Date, 'now', () => currentTime);
  const receipt = await f.save(undefined, { retrievedAt: new Date(fetchedAt).toISOString() });
  const request = await fileContextRequest(f.contextFile, f.contextReceipt);
  currentTime = fetchedAt + 15 * 60 * 1000;
  assert.deepEqual(await fetchCreationContext({ request }), gameContext);
  currentTime = fetchedAt + 15 * 60 * 1000 + 1;
  await assert.rejects(request(source.url), /receipt-expired/);
  await assert.rejects(fileContextRequest(f.contextFile, f.contextReceipt), /receipt-expired/);
  currentTime = fetchedAt - 1;
  await assert.rejects(request(source.url), /receipt-expired/);
  currentTime = fetchedAt;
  await writeFile(f.contextFile, Buffer.from(JSON.stringify(gameContext) + '\n'));
  await assert.rejects(request(source.url), /file-integrity/);
  // Updating only one hash never authenticates a different byte sequence.
  await f.save(undefined, { ...receipt, gitBlobSha1: '0'.repeat(40) });
  await assert.rejects(request(source.url), /file-integrity/);
  await f.save(undefined, { ...receipt, sha256: '0'.repeat(64) });
  await assert.rejects(request(source.url), /file-integrity/);
});

test('receipt source, schema, strict UTC date, UTF-8 and bounded regular files are required', async t => {
  const f = await fixture(t);
  for (const override of [
    { sourceUrl: source.gameEndpoint }, { sourceUrl: 'file:///context.json' }, { schemaVersion: 2 },
    { retrievedAt: '2026-02-30T00:00:00.000Z' }, { retrievedAt: new Date().toISOString().replace('Z', '+00:00') },
    { retrievedAt: 0 }, { gitBlobSha1: 'a'.repeat(39) }, { sha256: 'a'.repeat(63) },
  ]) {
    await f.save(undefined, override);
    await assert.rejects(fileContextRequest(f.contextFile, f.contextReceipt), /receipt-invalid/);
  }
  await f.save(Buffer.from([0xff]));
  await assert.rejects(fileContextRequest(f.contextFile, f.contextReceipt), /file-utf8/);
  await f.save(Buffer.alloc(128 * 1024 + 1));
  await assert.rejects(fileContextRequest(f.contextFile, f.contextReceipt), /file-too-large/);
  await f.save(); await writeFile(f.contextReceipt, Buffer.alloc(4 * 1024 + 1));
  await assert.rejects(fileContextRequest(f.contextFile, f.contextReceipt), /file-too-large/);
  await writeFile(f.contextReceipt, Buffer.from([0xff]));
  await assert.rejects(fileContextRequest(f.contextFile, f.contextReceipt), /receipt-invalid/);
  await f.save();
  await assert.rejects(fileContextRequest(f.root, f.contextReceipt), /file-regular-required/);
  await assert.rejects(fileContextRequest(path.join(f.root, 'missing'), f.contextReceipt), /file-unreadable/);
});

test('explicit invocation arguments reject incomplete, duplicate, unknown and ambiguous options', async t => {
  const f = await fixture(t);
  for (const flags of [
    ['--context-file', f.contextFile], ['--context-receipt', f.contextReceipt],
    [...f.flags, '--context-file', f.contextFile], [...f.flags, '--context-receipt', f.contextReceipt],
    ['--context-file', '--context-receipt', f.contextReceipt], ['--context-file=x'], ['--unknown'],
  ]) {
    assert.throws(() => parseContextFileArgs(flags), /file-arguments/);
    await assert.rejects(contextMain(flags), /file-arguments/);
    await assert.rejects(toolMain(['list', f.root, ...flags]), /file-arguments/);
  }
  await assert.rejects(contextMain(['one', 'two', ...f.flags]), /file-arguments/);
  await assert.rejects(toolMain(['list', f.root, 'extra', ...f.flags]), /usage:/);
  assert.deepEqual(parseContextFileArgs([]), { args: [], contextFile: undefined, contextReceipt: undefined });
});

test('file transport defers quality reviews while preserving missing-file, context and revision guards', async t => {
  const f = await fixture(t);
  const state = { mode: 'creation', contextRevision: gameContext.revision, groupId: 'locomotion', items: {
    idle: { version: 'v1', selectedVersion: 'v1', review: 'failed' },
    fightIdle: { version: 'v1', selectedVersion: 'v1', review: 'passed' },
    run: { version: 'v1', selectedVersion: 'v1', review: 'passed' },
  } };
  const stateFile = path.join(f.root, 'state.json'); await writeFile(stateFile, JSON.stringify(state));
  const decision = await contextMain([stateFile, ...f.flags]);
  assert.equal(decision.canAdvance, false);
  assert.deepEqual(decision.blockers, ['missing:walk']);
  const changed = structuredClone(gameContext); changed.revision = 'b'.repeat(64);
  await f.save(Buffer.from(JSON.stringify(changed)));
  const review = (await f.call('review_creation_progress', { stateJson: JSON.stringify(state) })).structuredContent;
  assert.equal(review.data.canAdvance, false);
  assert.ok(review.data.blockers.includes('context-changed'));
  await f.save();
  assert.equal((await f.call('create_creation_session', { sessionId: 'test', brief: 'Fixture only', mode: 'creation' })).structuredContent.ok, true);
  const update = (expectedRevision, change) => f.call('update_creation_session', { sessionId: 'test', expectedRevision, change });
  assert.equal((await update(1, { type: 'advance' })).structuredContent.code, 'group-review-pending');
  assert.equal((await update(1, { type: 'profile', name: 'Fixture', description: 'Synthetic test', feedback: 'Test choice' })).structuredContent.ok, true);
  assert.equal((await update(1, { type: 'advance' })).structuredContent.code, 'session-revision-conflict');
  await f.save(Buffer.from(JSON.stringify(changed)));
  assert.equal((await update(2, { type: 'advance' })).structuredContent.code, 'context-changed');
});

test('actual CLIs preserve large Unicode JSON and sanitized failure/blocked exit codes on inherited fds', async t => {
  const f = await fixture(t);
  const large = { ...gameContext, handoffTest: '한글🙂'.repeat(8000) };
  await f.save(Buffer.from(JSON.stringify(large)));
  const cli = file => fileURLToPath(new URL(`../scripts/${file}.mjs`, import.meta.url));
  const options = { timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 };
  const result = await exec(process.execPath, [cli('creation-context'), ...f.flags], options);
  assert.deepEqual(JSON.parse(result.stdout), large); assert.equal(result.stderr, '');
  const argsFile = path.join(f.root, 'args.json'); await writeFile(argsFile, JSON.stringify({ section: 'context' }));
  const tool = await exec(process.execPath, [cli('creation-tool'), 'call', f.root, 'get_fighter_spec', argsFile, ...f.flags], options);
  assert.deepEqual(JSON.parse(tool.stdout).structuredContent.data, large); assert.equal(tool.stderr, '');
  const stateFile = path.join(f.root, 'state.json');
  await writeFile(stateFile, JSON.stringify({ mode: 'creation', contextRevision: large.revision, groupId: 'appearance' }));
  await assert.rejects(exec(process.execPath, [cli('creation-context'), stateFile, ...f.flags], options), error => {
    assert.equal(error.code, 1); assert.equal(error.stderr, '');
    assert.deepEqual(JSON.parse(error.stdout).blockers, ['missing:idle']); return true;
  });
  await writeFile(f.contextFile, 'secret-test-string');
  for (const [name, args] of [['creation-context', []], ['creation-tool', ['list', f.root]]]) {
    await assert.rejects(exec(process.execPath, [cli(name), ...args, ...f.flags], options), error => {
      assert.equal(error.code, 1); assert.equal(error.stdout, '');
      assert.deepEqual(JSON.parse(error.stderr), { ok: false, code: 'creation-context-file-integrity' });
      assert.ok(!error.stderr.includes(f.root)); assert.ok(!error.stderr.includes('secret-test-string')); return true;
    });
  }
});

test('the creator kit import closure contains the transport and fd writer', async () => {
  const files = await runtimeFileList();
  for (const file of ['scripts/creation-context-file.mjs', 'dots.mjs']) assert.ok(files.includes(file), file);
});
