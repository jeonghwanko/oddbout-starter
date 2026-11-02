import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { accountItem, checkKit, checkReadiness, creationProgress, elicitAccount, FETCH_INTERVAL_MS, FETCH_RECORD, KIT_BRANCH } from '../mcp/creation-readiness.mjs';
import { createServer } from '../mcp/server.mjs';
import { createEnvironmentStore } from '../mcp/creation-environment.mjs';

const installed = { source: true, environment: true }, kitRoot = fileURLToPath(new URL('../', import.meta.url));
const workingTools = { inspect: async () => ({ ffmpeg: { status: 'ok' }, ffprobe: { status: 'ok' }, img2webp: { status: 'ok' }, rife: { status: 'ok' } }) };

/** A scripted git: answers by the first arguments and records every call. */
function fakeGit({ branch = KIT_BRANCH, dirty = '', vendorDirty = '', fetch = 0, counts = '0\t3', merge = 0, changed = '' } = {}) {
  const calls = [];
  const git = async (args, { cwd } = {}) => {
    calls.push(args.join(' '));
    if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { code: 0, stdout: branch };
    if (args[0] === 'rev-parse') return { code: 0, stdout: 'before-sha' };
    if (args[0] === 'status') return { code: 0, stdout: path.basename(cwd ?? '') === 'sprite-gen' ? vendorDirty : dirty };
    if (args[0] === 'fetch') return { code: fetch, stdout: '' };
    if (args[0] === 'rev-list') return { code: 0, stdout: counts };
    if (args[0] === 'merge') return { code: merge, stdout: '' };
    if (args[0] === 'diff') return { code: 0, stdout: changed };
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  return { git, calls };
}
const engineState = motion => async () => ({ version: '3.4.0', motion });

test('before a character starts, a behind checkout fast-forwards and names slow installs', async () => {
  const { git, calls } = fakeGit({ changed: 'mcp/server.mjs\npackage-lock.json\ndocs/START-HERE.md' });
  const result = await checkKit({ progress: { inProgress: false }, installed, git, inspectEngine: engineState(true) });
  assert.equal(result.status, 'updated');
  assert.ok(calls.includes(`merge --ff-only origin/${KIT_BRANCH}`));
  assert.deepEqual(result.nextCommands, ['npm ci --ignore-scripts', 'npm run sprite:status']);
  assert.equal(result.restartRequired, true);
  // A moved sprite-gen pin needs the full setup.
  const pinned = await checkKit({ progress: { inProgress: false }, installed, git: fakeGit({ changed: 'vendor/sprite-gen' }).git,
    inspectEngine: engineState(true) });
  assert.deepEqual(pinned.nextCommands, ['npm run sprite:setup', 'npm run sprite:status']);
  // The forked validator (server/), spawned tools and startup JSON (deploy/) change what this process works with too.
  for (const file of ['server/ai-fighter-package.mjs', 'deploy/creation-context-source.json', 'tools/ai-fighter/gait.mjs'])
    assert.equal((await checkKit({ progress: { inProgress: false }, installed, git: fakeGit({ changed: file }).git, inspectEngine: engineState(true) })).restartRequired, true, file);
  assert.equal((await checkKit({ progress: { inProgress: false }, installed, git: fakeGit({ changed: 'docs/START-HERE.md' }).git,
    inspectEngine: engineState(true) })).restartRequired, false, 'a docs-only update needs no restart');
});

test('a character in progress, unknown progress, local edits, a wrong branch or divergence never update', async () => {
  for (const progress of [{ inProgress: true }, { inProgress: null }]) {
    const { git, calls } = fakeGit();
    const result = await checkKit({ progress, installed, git, inspectEngine: engineState(true) });
    assert.equal(result.status, 'deferred');
    assert.ok(!calls.some(call => call.startsWith('merge')));
  }
  const cases = [[{ dirty: ' M AGENTS.md' }, 'local-changes'], [{ branch: 'codex/creator-hosting' }, 'wrong-branch'], [{ counts: '1\t2' }, 'diverged-from-published-branch']];
  for (const [options, reason] of cases) {
    const { git, calls } = fakeGit(options);
    const result = await checkKit({ progress: { inProgress: false }, installed, git, inspectEngine: engineState(true) });
    assert.deepEqual([result.status, result.reason], ['blocked', reason]);
    assert.ok(!calls.some(call => call.startsWith('merge')));
  }
});

test('an up-to-date checkout on the pre-fork pin is sent to setup, engine edits block; a fresh workspace gets install commands', async () => {
  const old = await checkKit({ progress: { inProgress: false }, installed, git: fakeGit({ counts: '0\t0' }).git, inspectEngine: engineState(false) });
  assert.deepEqual([old.status, old.reason, old.nextCommands], ['action-required', 'motion-engine-missing', ['npm run sprite:setup', 'npm run sprite:status']]);
  const edited = await checkKit({ progress: { inProgress: false }, installed, git: fakeGit({ counts: '0\t0', vendorDirty: ' M sprite_gen/cli.py' }).git,
    inspectEngine: engineState(true) });
  assert.deepEqual([edited.status, edited.reason], ['blocked', 'vendor-local-changes']);
  const fresh = await checkKit({ progress: { inProgress: false }, installed: { source: false, environment: false }, git: fakeGit({ counts: '0\t0' }).git,
    inspectEngine: async () => assert.fail('nothing installed to inspect') });
  assert.deepEqual([fresh.status, fresh.reason], ['action-required', 'sprite-gen-not-installed']);
  assert.deepEqual(fresh.nextCommands, ['npm ci --ignore-scripts', 'npm run sprite:setup', 'npm run sprite:status']);
  const offline = await checkKit({ progress: { inProgress: false }, installed, git: fakeGit({ fetch: 1 }).git, inspectEngine: engineState(true) });
  assert.deepEqual([offline.status, offline.reason], ['ready', 'remote-unreachable-current-unknown']);
  // A packaged plugin runtime is not a git checkout: report the engine, never touch git further.
  const calls = [];
  const packaged = await checkKit({ progress: { inProgress: false }, installed, inspectEngine: engineState(true),
    git: async args => { calls.push(args[0]); return { code: 128, stdout: '' }; } });
  assert.deepEqual([packaged.status, packaged.reason, calls], ['ready', 'not-a-git-checkout', ['rev-parse']]);
});

test('the workspace keeps the last kit fetch: for five minutes after a failed one no call fetches, and one call fetches at a time', async t => {
  // Each creation:tool call is a fresh process (a fakeGit keeps no memory either): on a blocked network every call paid the 60 s fetch.
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'kit-fetch-')); t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const base = { progress: { inProgress: false }, installed, inspectEngine: engineState(true), workspaceRoot };
  const fetches = calls => calls.filter(call => call.startsWith('fetch')).length, record = path.join(workspaceRoot, FETCH_RECORD);
  const offline = fakeGit({ fetch: 1, counts: '0\t0' });
  const first = await checkKit({ ...base, git: offline.git });
  assert.deepEqual([first.remoteChecked, first.reason, first.remoteRetryAt], [false, 'remote-unreachable-current-unknown', undefined]);
  const kept = JSON.parse(await readFile(record, 'utf8'));
  assert.deepEqual([kept.schemaVersion, kept.ok, kept.kitRoot, kept.branch], [1, false, path.resolve(kitRoot), KIT_BRANCH]);
  const again = await checkKit({ ...base, git: offline.git });
  assert.equal(fetches(offline.calls), 1);
  assert.deepEqual([again.remoteChecked, again.reason], [false, 'remote-unreachable-current-unknown']);
  assert.equal(Date.parse(again.remoteRetryAt), Date.parse(kept.attemptedAt) + FETCH_INTERVAL_MS);
  // Five minutes on it fetches again. A success ends the wait and holds off no later call: a kit change published since still shows.
  await writeFile(record, JSON.stringify({ ...kept, attemptedAt: new Date(Date.now() - FETCH_INTERVAL_MS - 1000).toISOString() }));
  const online = fakeGit({ counts: '0\t0' });
  const checked = [await checkKit({ ...base, git: online.git }), await checkKit({ ...base, git: online.git })];
  assert.deepEqual(checked.map(result => [result.remoteChecked, result.reason, result.remoteRetryAt]), [[true, null, undefined], [true, null, undefined]]);
  assert.equal(fetches(online.calls), 2);
  assert.equal(JSON.parse(await readFile(record, 'utf8')).ok, true);
  // Another kit's failed attempt is not this kit's, and checkRemote false neither fetches nor writes.
  await writeFile(record, JSON.stringify(kept));
  assert.equal((await checkKit({ ...base, git: online.git })).remoteRetryAt, again.remoteRetryAt);
  const other = fakeGit({ counts: '0\t0' });
  await checkKit({ ...base, root: path.join(workspaceRoot, 'other-kit'), git: other.git });
  assert.equal(fetches(other.calls), 1);
  await rm(record);
  await checkKit({ ...base, fetchRemote: false, git: other.git });
  await assert.rejects(readFile(record), { code: 'ENOENT' });
  // Two calls at once: the second waits for the first's fetch and reuses its attempt instead of waiting out a fetch of its own.
  let release; const gate = new Promise(done => { release = done; });
  const blocked = fakeGit({ fetch: 1, counts: '0\t0' });
  const slow = async (args, options) => { if (args[0] === 'fetch') await gate; return blocked.git(args, options); };
  const both = Promise.all([checkKit({ ...base, git: slow }), checkKit({ ...base, git: slow })]);
  setTimeout(release, 50);
  assert.deepEqual((await both).map(result => result.remoteChecked), [false, false]);
  assert.equal(fetches(blocked.calls), 1);
});

test('Dots readiness verifies the immutable workspace pin without fetching or treating detached HEAD as a branch error', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dots-pinned-readiness-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'runtime'), workspaceRoot = path.join(dir, 'workspace');
  await mkdir(root); await mkdir(path.join(workspaceRoot, 'output'), { recursive: true });
  const marker = path.join(root, '.dots-runtime.json'), bindingFile = path.join(workspaceRoot, 'output/dots-workspace.json');
  await writeFile(marker, JSON.stringify({ schemaVersion: 1, host: 'dots' }));
  const binding = { schemaVersion: 1, runtime: root, provider: 'grok', version: '0.5.5', commit: 'a'.repeat(40) };
  await writeFile(bindingFile, JSON.stringify(binding));
  const report = { blockers: [], kit: { version: binding.version, distribution: 'source', commit: binding.commit } };
  const options = { root, workspaceRoot, installed, progress: { inProgress: false },
    git: () => assert.fail('pinned readiness never fetches, merges or switches a branch'), inspectEngine: engineState(true),
    inspectPinnedRuntime: async args => { assert.equal(args.runtime, root); assert.equal(args.workspace, workspaceRoot);
      assert.equal(args.provider, 'none'); assert.equal(args.checkAuth, undefined); return report; } };
  const ready = await checkKit(options);
  assert.deepEqual([ready.status, ready.commit, ready.nextCommands, ready.remoteChecked], ['ready', binding.commit, [], false]);
  assert.equal((await checkKit({ ...options, progress: { inProgress: true } })).status, 'ready');
  assert.equal((await checkKit({ ...options, workspaceRoot: undefined })).reason, 'dots-workspace-binding-required');
  for (const change of [{ runtime: dir }, { provider: 'codex' }, { commit: 'not-a-pin' }]) {
    await writeFile(bindingFile, JSON.stringify({ ...binding, ...change }));
    assert.equal((await checkKit({ ...options, inspectPinnedRuntime: () => assert.fail('invalid binding must stop before inspection') })).reason,
      'dots-workspace-binding-invalid');
  }
  await writeFile(bindingFile, JSON.stringify(binding));
  assert.equal((await checkKit({ ...options, inspectPinnedRuntime: async () => ({ ...report, kit: { ...report.kit, commit: 'b'.repeat(40) } }) })).reason,
    'dots-runtime-binding-mismatch');
  for (const reason of ['source-local-changes', 'vendor-pin-mismatch', 'vendor-local-changes', 'source-metadata-unavailable']) {
    const blocked = await checkKit({ ...options, inspectPinnedRuntime: async () => ({ ...report, blockers: [reason] }) });
    assert.deepEqual([blocked.status, blocked.reason, blocked.nextCommands], ['blocked', reason, []]);
  }
  const manifestSha256 = 'c'.repeat(64);
  await writeFile(bindingFile, JSON.stringify({ ...binding, commit: null, manifestSha256 }));
  assert.equal((await checkKit({ ...options, inspectPinnedRuntime: async args => {
    assert.equal(args.manifestSha256, manifestSha256);
    return { blockers: [], kit: { version: binding.version, distribution: 'bundle', manifestSha256 } };
  } })).status, 'ready');
  await writeFile(marker, JSON.stringify({ schemaVersion: 99, host: 'dots' }));
  assert.equal((await checkKit(options)).reason, 'dots-runtime-marker-invalid');
});

test('progress counts recorded versions and non-cancelled jobs only', async () => {
  const states = { fresh: { items: {} }, made: { items: { idle: { versions: { v1: {} } } } }, cancelled: { items: {} }, unreadable: { items: {} } };
  const jobLists = { fresh: [], made: [], cancelled: [{ status: 'cancelled' }],
    unreadable: [{ status: 'cancelled' }, { jobId: 'broken', unreadable: true, code: 'job-record-unreadable' }] };
  const store = { list: async () => Object.keys(states).map(sessionId => ({ sessionId })), read: async id => states[id] };
  const jobs = { list: async id => jobLists[id] };
  // A job record that cannot be read may be running work: the character counts as in progress.
  assert.deepEqual(await creationProgress({ store, jobs }), { known: true, inProgress: true, sessions: ['made', 'unreadable'] });
  assert.equal((await creationProgress({ store, jobs, sessionId: 'fresh' })).inProgress, false);
  assert.equal((await creationProgress({ store, jobs, sessionId: 'cancelled' })).inProgress, false);
  assert.deepEqual(await creationProgress({}), { known: false, inProgress: null, sessions: [] });
});

test('the account item offers fixed options, never infers, and does not claim display proof', async () => {
  const open = accountItem(undefined);
  assert.equal(open.status, 'choice-required');
  assert.deepEqual(open.options.map(o => o.id), ['gpt', 'grok', 'both', 'stop']);
  assert.match(open.verification, /creation:delivery는 기록의 누락·모순만 검사하며 표시를 증명하지 않는다/);
  const gpt = accountItem('gpt');
  assert.equal(gpt.status, 'chosen-unverified');
  assert.match(gpt.nextCommands[0], /--image-provider codex$/);
  assert.ok(!gpt.nextCommands.join(' ').includes('--confirmed-access'));
  assert.equal(accountItem('both').motionMethod, 'grok-video');
  assert.equal(accountItem('stop').status, 'stopped');
  assert.deepEqual(await elicitAccount(), { method: 'unsupported', choice: null });
  const answering = content => async () => content;
  assert.deepEqual(await elicitAccount(answering({ action: 'accept', content: { account: 'grok' } })), { method: 'elicited', choice: 'grok' });
  assert.deepEqual(await elicitAccount(answering({ action: 'accept', content: { account: 'openai-api' } })), { method: 'accept', choice: null });
  assert.deepEqual(await elicitAccount(answering({ action: 'decline' })), { method: 'decline', choice: null });
  // The SDK refuses before sending when the client declared no form elicitation, or on a 2026-07-28 request.
  assert.deepEqual(await elicitAccount(async () => { throw new Error('Client does not support form elicitation.'); }),
    { method: 'unsupported', choice: null });
});

test('kit success never verifies generation or parent display, and existing work survives recovery', async () => {
  const state = { items: { idle: { versions: { v1: {} } } } }, work = [{ status: 'unknown' }];
  const result = await checkReadiness({ store: { list: async () => [{ sessionId: 'existing' }], read: async () => state },
    jobs: { list: async () => work }, account: 'gpt',
    kit: { installed, git: fakeGit({ counts: '0\t0' }).git, inspectEngine: engineState(true) },
    tools: workingTools });
  assert.equal(result.readyForRegistration, false); assert.equal(result.kitAndAccountReady, true);
  assert.equal(result.readyForGeneration, false); assert.equal(result.items.generation.status, 'unverified');
  assert.equal(result.items.delivery.parentDisplay, 'unverified');
  assert.equal(result.items.login.status, 'connector-verification-required');
  assert.deepEqual(result.resume.sessionIds, ['existing']); assert.equal(result.resume.automaticGeneration, false);
  assert.deepEqual(work, [{ status: 'unknown' }]); assert.ok(state.items.idle.versions.v1);
});

test('a missing required system tool keeps generation from being ready and names who installs it', async () => {
  const result = await checkReadiness({ account: 'gpt',
    kit: { installed, git: fakeGit({ counts: '0\t0' }).git, inspectEngine: engineState(true), fetchRemote: false },
    tools: { inspect: async () => ({ ffmpeg: { status: 'missing', install: { actor: 'user', command: 'sudo apt install ffmpeg' } },
      ffprobe: { status: 'missing', install: { actor: 'user', command: 'sudo apt install ffmpeg' } },
      img2webp: { status: 'broken', install: { actor: 'agent', command: 'npm run sprite:setup' } }, rife: { status: 'ok' } }) } });
  assert.equal(result.kitAndAccountReady, false);
  assert.deepEqual([result.items.tools.status, result.items.tools.missing], ['action-required', ['ffmpeg', 'ffprobe', 'img2webp']]);
  assert.deepEqual(result.items.tools.nextCommands, ['npm run sprite:setup']);
  assert.deepEqual([result.items.tools.nextAction.actor, result.items.tools.nextAction.commands], ['user', ['sudo apt install ffmpeg']]);
  const connection = await checkReadiness({ purpose: 'connection', tools: { inspect: () => assert.fail('no tool probe') } });
  assert.equal(connection.items.tools.status, 'not-required');
});

test('the MCP tool asks the account through a host form when the client supports elicitation', async t => {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createServer({}).connect(serverSide);
  const client = new Client({ name: 'readiness-test', version: '1' }, { capabilities: { elicitation: { form: {} } } });
  let asked;
  client.setRequestHandler('elicitation/create', request => { asked = request.params; return { action: 'accept', content: { account: 'gpt' } }; });
  await client.connect(clientSide); t.after(() => client.close());
  const result = (await client.callTool({ name: 'check_creation_readiness', arguments: { checkRemote: false } })).structuredContent;
  assert.equal(result.ok, true);
  assert.deepEqual(asked.requestedSchema.properties.account.oneOf.map(o => o.const), ['gpt', 'grok', 'both', 'stop']);
  assert.equal(result.data.elicitation, 'elicited');
  assert.equal(result.data.items.account.choice, 'gpt');
  // Without a workspace, progress is unknown: the kit is reported, never changed.
  assert.equal(result.data.progress.known, false);
  assert.ok(['ready', 'deferred', 'action-required', 'blocked'].includes(result.data.items.kit.status));
  const stated = (await client.callTool({ name: 'check_creation_readiness', arguments: { account: 'stop', checkRemote: false } })).structuredContent;
  assert.deepEqual([stated.data.elicitation, stated.data.items.account.status, stated.data.readyForGeneration], ['not-needed', 'stopped', false]);
});

test('workspace readiness does not read or suggest a local registration account', async t => {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createServer({}).connect(serverSide);
  const client = new Client({ name: 'cloud-readiness-test', version: '1' });
  await client.connect(clientSide); t.after(() => client.close());
  const result = (await client.callTool({ name: 'check_creation_readiness', arguments: { account: 'stop', checkRemote: false } })).structuredContent;
  assert.equal(result.ok, true);
  assert.equal(result.data.items.login.status, 'connector-verification-required');
  assert.equal(result.data.items.login.userId, null);
  assert.equal(result.data.items.login.routes, undefined);
  assert.equal(result.data.readyForRegistration, false);
  assert.deepEqual(result.data.items.login.nextTools, ['get_profile', 'check_creation_readiness']);
  assert.deepEqual(result.data.items.infrastructure, { status: 'not-required', reason: 'cloud-registration-route' });
  // A client without elicitation gets the numbered choices, not a form.
  const unstated = (await client.callTool({ name: 'check_creation_readiness', arguments: { checkRemote: false } })).structuredContent;
  assert.deepEqual([unstated.data.elicitation, unstated.data.items.account.status], ['unsupported', 'choice-required']);
});

test('a saved environment keeps the stated provider and reports its preconditions without certifying generation', async () => {
  const kit = { installed, git: fakeGit({ counts: '0\t0' }).git, inspectEngine: engineState(true) };
  const base = { account: 'gpt', kit, tools: workingTools };
  const noEnvironment = await checkReadiness(base);
  assert.equal(noEnvironment.readyForGeneration, false);
  assert.equal(noEnvironment.items.environment.status, 'workspace-required');
  const environment = { read: async () => ({ account: 'gpt' }), inspect: async () => ({ status: 'preconditions-recorded', account: 'gpt', readyForGeneration: true }) };
  const saved = await checkReadiness({ ...base, account: undefined, environment,
    elicitInput: () => assert.fail('must reuse the stated choice') });
  assert.equal(saved.elicitation, 'saved-environment');
  assert.equal(saved.items.account.choice, 'gpt');
  assert.equal(saved.items.environment.status, 'preconditions-recorded');
  assert.equal(saved.items.environment.matchesChoice, true);
  assert.equal(saved.readyForGeneration, false);
  const other = await checkReadiness({ ...base, account: 'grok', environment });
  assert.equal(other.items.environment.matchesChoice, false);
});

test('a workspace moved to another host keeps its stated provider and reports the rebind instead of failing readiness', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'fighter-moved-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const loginProbe = async () => ({ status: 'signed-in' });
  await createEnvironmentStore(root, { hostId: 'host-a', loginProbe }).update(0, { type: 'configure', host: 'dots', account: 'gpt', conversationId: 'chat-1',
    confirmedAccess: ['gpt-image'], feedback: '내 GPT 이미지 기능을 사용할 수 있어요. 이 VM에서 연결해줘.' });
  const moved = createEnvironmentStore(root, { hostId: 'host-b', loginProbe });
  const result = await checkReadiness({ kit: { installed, git: fakeGit({ counts: '0\t0' }).git, inspectEngine: engineState(true) }, tools: workingTools,
    environment: moved, elicitInput: () => assert.fail('must reuse the stated choice') });
  assert.equal(result.items.account.choice, 'gpt');
  assert.equal(result.items.environment.status, 'host-changed-reconnect-required');
  assert.equal(result.readyForGeneration, false);
});

test('connection and registration never ask generation questions or touch the engine', async () => {
  for (const purpose of ['connection', 'registration']) {
    const result = await checkReadiness({ purpose,
      elicitInput: () => assert.fail('no generation prompt'),
      kit: { git: () => assert.fail('no git or install'), inspectEngine: () => assert.fail('no engine read') } });
    assert.equal(result.purpose, purpose); assert.equal(result.readyForRegistration, false);
    assert.equal(result.items.login.status, 'connector-verification-required');
    assert.equal(result.elicitation, 'not-needed'); assert.equal(result.items.account.status, 'not-required');
    assert.equal(result.items.kit.status, 'not-required'); assert.equal(result.readyForGeneration, false);
  }
});
