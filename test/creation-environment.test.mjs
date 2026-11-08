import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createEnvironmentStore, probeDestination } from '../mcp/creation-environment.mjs';
import { bundledProfiles, profileHash, canonical, verifyProfileEnvelope, fetchProfileEnvelope, publishEnvironmentProfiles } from '../mcp/environment-profiles.mjs';
import { inspectGenerationLogin, publicDeviceChallenge, runDeviceLogin } from '../mcp/generation-connection.mjs';
import { createServer } from '../mcp/server.mjs';
import { main as connect } from '../scripts/connect-generation.mjs';

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'fighter-environment-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [], store = createEnvironmentStore(root, { loginProbe: async () => ({ status: 'signed-in', accountIdentity: 'unknown', imageAccess: 'unknown' }),
    fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 204 }); }, ...options });
  const configured = await store.update(0, { type: 'configure', host: 'dots', account: 'gpt', conversationId: 'chat-1',
    confirmedAccess: ['gpt-image'], feedback: '내 GPT 이미지 기능을 사용할 수 있어요. 이 VM에서 연결해줘.' });
  return { root, calls, store, configured };
}
async function allow(store) {
  const view = await store.inspect();
  let result = await store.update(view.revision, { type: 'approve-network', planHash: view.plan.planHash, feedback: '표시된 주소를 이 환경에서 허용합니다.' });
  result = await store.update(result.revision, { type: 'report-host-network', planHash: result.plan.planHash,
    status: 'allowed', evidence: 'test-host-permission-receipt-1' });
  await store.update(result.revision, { type: 'check-network' });
}

test('consent, host application and reachability cannot substitute for one another or for delivery', async t => {
  const { store, calls } = await fixture(t);
  assert.equal((await store.inspect()).readyForGeneration, false);
  await assert.rejects(store.update(1, { type: 'check-network' }), /host-network-application-unverified/);
  assert.equal(calls.length, 0);
  const plan = (await store.inspect()).plan;
  await assert.rejects(store.update(1, { type: 'approve-network', planHash: '0'.repeat(64), feedback: '허용' }), /network-plan-changed/);
  await store.update(1, { type: 'approve-network', planHash: plan.planHash, feedback: '허용' });
  await assert.rejects(store.update(2, { type: 'check-network' }), /host-network-application-unverified/);
  assert.equal((await store.inspect()).network.application, 'unverified');
  await store.update(2, { type: 'report-host-network', planHash: plan.planHash, status: 'allowed', evidence: 'host-receipt' });
  await store.update(3, { type: 'check-network' });
  const view = await store.inspect();
  assert.equal(view.network.application, 'host-reported');
  assert.equal(view.network.reachability, 'bootstrap-hosts-reachable');
  assert.equal(view.readyForGeneration, false);
  assert.ok(view.blockers.includes('generation-and-delivery-preflight-required'));
  assert.ok(calls.every(c => c.init.method === 'HEAD' && c.init.redirect === 'manual' && !c.init.body));
});

test('restart restores choices; stale probes, another host, modified delivery and revocation block readiness', async t => {
  let time = Date.now();
  const { store, root } = await fixture(t, { now: () => time, hostId: 'host-a' });
  await allow(store);
  const state = await store.read();
  const record = { version: 1, environment: state.environmentId, conversationId: 'chat-1',
    generation: { status: 'ready', route: 'codex-image', evidence: 'test-tool-access' },
    delivery: { status: 'ready', route: 'host-attachment', evidence: 'test-host-capability', conversationId: 'chat-1', fullBody: true, faceCrop: true },
    previousGeneration: { status: 'none', evidence: 'no-attempts' } };
  await writeFile(path.join(root, 'delivery.json'), JSON.stringify(record));
  await store.update(state.revision, { type: 'delivery', path: 'delivery.json' });
  assert.equal((await store.inspect()).readyForGeneration, true);
  const resumed = createEnvironmentStore(root, { hostId: 'host-a', now: () => time, loginProbe: async () => ({ status: 'signed-in' }) });
  assert.equal((await resumed.inspect()).account, 'gpt');
  assert.equal((await resumed.inspect()).readyForGeneration, true);
  const moved = createEnvironmentStore(root, { hostId: 'host-b', loginProbe: async () => ({ status: 'sign-in-required' }) });
  await assert.rejects(moved.read(), /host-changed/);
  assert.equal((await moved.inspect()).status, 'host-changed-reconnect-required');
  time += 16 * 60 * 1000;
  assert.equal((await resumed.inspect()).readyForGeneration, false);
  time -= 16 * 60 * 1000;
  record.delivery.conversationId = 'another-chat';
  await writeFile(path.join(root, 'delivery.json'), JSON.stringify(record));
  assert.equal((await store.inspect()).delivery.status, 'stale');
  await store.update((await store.read()).revision, { type: 'revoke-network', feedback: '연결 해제' });
  assert.equal((await store.inspect()).network.approved, false);
  assert.equal((await store.read()).network.revocation.hostActionRequired, true);
  const old = await store.read();
  await moved.update(old.revision, { type: 'rebind', host: 'dots', conversationId: 'chat-2', feedback: '이 새 VM에서 이어서 연결해줘' });
  const rebound = await moved.inspect();
  assert.equal(rebound.account, 'gpt');
  assert.equal(rebound.network.approved, false);
  assert.deepEqual(rebound.confirmedAccess, []);
  assert.notEqual(rebound.environmentId, old.environmentId);
  assert.equal(JSON.parse(await readFile(path.join(root, 'delivery.json'), 'utf8')).environment, old.environmentId);
});

test('CAS preserves decisions, changing provider clears permission, unsupported Grok never silently switches', async t => {
  const { store } = await fixture(t);
  await allow(store);
  const state = await store.read();
  await assert.rejects(store.update(0, { type: 'revoke-network', feedback: 'stale' }), /revision-conflict/);
  await store.update(state.revision, { type: 'configure', account: 'grok', host: 'dots', conversationId: 'chat-1',
    confirmedAccess: ['grok-image'], feedback: 'Grok으로 바꿔줘' });
  const view = await store.inspect();
  assert.equal(view.generation.status, 'adapter-unavailable');
  assert.equal(view.network.approved, false);
  assert.equal(view.readyForGeneration, false);
  await assert.rejects(store.prepareLogin(), /gpt-environment-required/);
});

test('changed remote content needs a trusted signature; rollback, wildcards, extra fields and redirects fail closed', async () => {
  const bundled = await bundledProfiles(), next = structuredClone(bundled);
  next.revision++;
  next.profiles[0].destinations.push({ host: 'files.oaiusercontent.com', port: 443, purpose: 'test-only-download', stage: 'download' });
  assert.equal(verifyProfileEnvelope({ profile: bundled }, { bundled }).trust, 'bundled-content');
  assert.throws(() => verifyProfileEnvelope({ profile: next }, { bundled }), /signature-required/);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const trustedKeys = { release: publicKey.export({ type: 'spki', format: 'pem' }) };
  const signature = sign(null, Buffer.from(canonical(next)), privateKey).toString('base64');
  assert.equal(verifyProfileEnvelope({ profile: next, keyId: 'release', signature }, { bundled, trustedKeys }).trust, 'signed-release');
  const altered = structuredClone(next); altered.profiles[0].destinations[0].host = 'different.org';
  assert.throws(() => verifyProfileEnvelope({ profile: altered, keyId: 'release', signature }, { bundled, trustedKeys }), /signature-invalid/);
  assert.throws(() => verifyProfileEnvelope({ profile: bundled }, { bundled, minimumRevision: 2 }), /rollback/);
  for (const host of ['*.openai.com', '127.0.0.1', 'x.localhost', 'x.internal', 'https://chatgpt.com']) {
    const invalid = structuredClone(bundled); invalid.profiles[0].destinations[0].host = host;
    assert.throws(() => profileHash(invalid));
  }
  assert.throws(() => profileHash({ ...bundled, command: 'execute-untrusted-text' }));
  await assert.rejects(fetchProfileEnvelope('https://profiles.oddbout.com/v1.json', { bundled,
    fetchImpl: async (_url, init) => { assert.equal(init.redirect, 'error'); throw Error('redirect'); } }));
  const denied = await probeDestination({ host: 'chatgpt.com' }, async () => new Response(null, { status: 403 }));
  assert.equal(denied.status, 'unverified');
});

test('profile updates invalidate approvals and the public export contains no workspace state', async t => {
  const { store, root } = await fixture(t);
  await allow(store);
  const output = path.join(root, 'public');
  const exported = await publishEnvironmentProfiles(output);
  const envelope = JSON.parse(await readFile(path.join(output, exported.path), 'utf8'));
  assert.equal(exported.hash, profileHash(envelope.profile));
  assert.ok(!JSON.stringify(envelope).includes((await store.read()).environmentId));
  const next = structuredClone(envelope.profile); next.revision++;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const update = { profile: next, keyId: 'release', signature: sign(null, Buffer.from(canonical(next)), privateKey).toString('base64') };
  const reader = createEnvironmentStore(root, { trustedKeys: { release: publicKey.export({ type: 'spki', format: 'pem' }) },
    fetchImpl: async () => new Response(JSON.stringify(update)), profileSource: 'https://oddbout.com/creation-environments/v1.json',
    loginProbe: async () => ({ status: 'signed-in' }) });
  await reader.update((await reader.read()).revision, { type: 'refresh-profile' });
  assert.equal((await reader.inspect()).network.approved, false);
});

test('login diagnostics and public challenge never return credentials, callback URLs or unknown success', async () => {
  const resolve = async () => ({ command: 'test-codex', prefix: [] });
  for (const [result, expected] of [[{ code: 0, text: 'Logged in using ChatGPT' }, 'signed-in'],
    [{ code: 0, text: 'Logged in using API key sk-test-secret' }, 'api-billing-blocked'],
    [{ code: 0, text: 'unexpected new output' }, 'unknown'], [{ code: 1, text: 'Not logged in' }, 'sign-in-required']]) {
    const view = await inspectGenerationLogin({ resolve, run: async () => result });
    assert.equal(view.status, expected);
    assert.ok(!JSON.stringify(view).includes('sk-test-secret'));
    assert.equal(view.imageAccess, 'unknown');
  }
  assert.equal(publicDeviceChallenge('https://auth.openai.com/callback?code=SECRET ABCD-12345'), null);
  assert.equal(publicDeviceChallenge('https://auth.openai.com/codex/device?token=SECRET ABCD-12345'), null);
  const safe = publicDeviceChallenge('\u001b[32mhttps://auth.openai.com/codex/device\nABCD-12345\nrefresh_token=SECRET');
  assert.equal(safe.userCode, 'ABCD-12345');
  assert.ok(!JSON.stringify(safe).includes('SECRET'));
});

test('device flow streams only the public challenge and rechecks official login status', async () => {
  const output = [], invocations = [];
  const result = await runDeviceLogin({ emit: item => output.push(item), resolve: async () => ({ command: 'test-cli', prefix: [] }),
    run: async () => ({ code: 0, text: '--device-auth' }), inspect: async () => ({ status: 'signed-in', imageAccess: 'unknown' }),
    spawnImpl: (command, args, options) => {
      invocations.push({ command, args, options });
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      queueMicrotask(() => {
        child.stdout.write('https://auth.openai.com/codex/');
        child.stdout.write('device\nABCD-12345\n'); child.stderr.write('token=PRIVATE'); child.emit('close', 0);
      });
      return child;
    } });
  assert.equal(result.status, 'signed-in');
  assert.equal(output.length, 1);
  assert.ok(!JSON.stringify(output).includes('PRIVATE'));
  assert.deepEqual(invocations[0].args, ['login', '--device-auth']);
  assert.equal(invocations[0].options.shell, false);
  assert.equal(invocations[0].options.windowsHide, true);
});

test('device flow waits for the complete code line across chunks and interleaved stderr', async () => {
  const output = [];
  let emittedBeforeComplete;
  const result = await runDeviceLogin({ emit: item => output.push(item), resolve: async () => ({ command: 'test-cli', prefix: [] }),
    run: async () => ({ code: 0, text: '--device-auth' }), inspect: async () => ({ status: 'signed-in' }),
    spawnImpl: () => {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      queueMicrotask(() => {
        child.stdout.write('https://auth.openai.com/codex/device\nABCD-1234');
        child.stderr.write('PRIVATE diagnostic\n');
        emittedBeforeComplete = output.length;
        child.stdout.write('56\n'); child.emit('close', 0);
      });
      return child;
    } });
  assert.equal(emittedBeforeComplete, 0);
  assert.equal(result.status, 'signed-in');
  assert.equal(output.length, 1);
  assert.equal(output[0].userCode, 'ABCD-123456');
  assert.ok(!JSON.stringify(output).includes('PRIVATE'));
});

test('device flow never combines separate streams into a synthetic pairing code', async () => {
  const output = [];
  const result = await runDeviceLogin({ emit: item => output.push(item), resolve: async () => ({ command: 'test-cli', prefix: [] }),
    run: async () => ({ code: 0, text: '--device-auth' }),
    spawnImpl: () => {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      queueMicrotask(() => {
        child.stdout.write('https://auth.openai.com/codex/device\nABCD-');
        child.stderr.write('12345\n'); child.stdout.write('\n'); child.emit('close', 1);
      });
      return child;
    } });
  assert.equal(result.status, 'login-failed');
  assert.deepEqual(output, []);
});

test('prepared connection command is revision-bound and executes no generation', async t => {
  const { root, store } = await fixture(t, { loginProbe: async () => ({ status: 'sign-in-required' }) });
  await allow(store);
  const prepared = await store.prepareLogin();
  const output = []; let calls = 0;
  assert.equal(prepared.execution.cwd, root);
  assert.ok(prepared.execution.args[0].endsWith('connect-generation.mjs'));
  await assert.rejects(connect([root, '0'], { makeStore: () => store, connect: async () => { calls++; } }), /revision-conflict/);
  assert.equal(calls, 0);
  assert.equal(await connect([root, String(prepared.revision)], { makeStore: () => store, emit: item => output.push(item),
    connect: async () => { calls++; return { status: 'signed-in' }; } }), 0);
  assert.equal(calls, 1);
  assert.equal(output[0].status, 'signed-in');
});

test('MCP connection tools are discoverable and configure without logging in or granting a permission', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'fighter-environment-mcp-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const server = createServer({ root });
  const client = new Client({ name: 'environment-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  const call = async (name, args = {}) => (await client.callTool({ name, arguments: args })).structuredContent;
  assert.equal((await call('get_creation_environment')).data.status, 'not-configured');
  const result = await call('update_creation_environment', { expectedRevision: 0, change: { type: 'configure',
    account: 'stop', host: 'dots', conversationId: 'this-chat', feedback: '지금 생성하지 않음' } });
  assert.equal(result.ok, true);
  const view = (await call('get_creation_environment')).data;
  assert.equal(view.generation.status, 'stopped');
  assert.equal(view.readyForGeneration, false);
  assert.equal((await call('prepare_generation_login')).ok, false);
});
