import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { launch } from '../dots.mjs';
import { nextAction, start } from '../scripts/dots-start.mjs';
import { guardDotsExecution } from '../scripts/dots-provider.mjs';

async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), 'oddbout-start-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const workspace = path.join(base, 'workspace'),
    runtime = path.join(base, 'runtime');
  await mkdir(runtime);
  await mkdir(workspace);
  return { base, workspace, runtime };
}
const report = () => ({
  kit: { version: '0.5.5', commit: 'a'.repeat(40) },
  blockers: ['grok-generation-and-delivery-unverified'],
  auth: { status: 'signed-in' },
  recovery: { blockers: [], sessions: [] },
});
test('startup returns one concrete action without treating login or mock evidence as generation', async t => {
  const f = await fixture(t);
  let installs = 0;
  const deps = {
    recover: async () => report().recovery,
    inspect: async () => report(),
    install: async () => {
      installs++;
      return report();
    },
  };
  const first = await start({ ...f, install: true }, deps);
  assert.equal(installs, 1);
  assert.equal(first.nextAction.action, 'prepare-requested-appearance');
  assert.equal(first.e2eVerified, false);
  assert.equal(first.automaticGeneration, false);
  const pending = { blockers: ['pending-or-unknown-job'], sessions: [{ sessionId: 'existing' }] };
  await start({ ...f, install: true }, { ...deps, recover: async () => pending, inspect: async () => ({ ...report(), recovery: pending }) });
  assert.equal(installs, 1);
  await assert.rejects(start({ ...f, runtime: f.base }, deps), /workspace-runtime-or-provider-conflict/);
  assert.equal(nextAction({ status: 'blocked', reason: 'sprite-installation-failed' }).reason, 'sprite-installation-failed');
  assert.equal(nextAction({ ...report(), auth: { status: 'sign-in-required' } }).action, 'connect-grok-subscription');
  assert.equal(nextAction({ ...report(), recovery: pending }).action, 'recover-original-job');
  assert.equal(
    nextAction({
      status: 'blocked',
      reason: 'sprite-installation-failed',
      diagnostic: { actor: 'environment-preparer', reason: 'network-connect-forbidden', host: 'storage.googleapis.com' },
    }).actor,
    'environment-preparer',
  );
  assert.equal(
    nextAction({ ...report(), auth: { status: 'api-billing-blocked', reason: 'xai-api-key-environment' } }).action,
    'remove-api-key-from-vm-environment',
  );
});
test('front door fetches exact commit, preserves a workspace binding and returns actionable failures', async t => {
  const f = await fixture(t),
    releasePath = path.join(f.base, 'release.json'),
    commit = 'b'.repeat(40),
    calls = [];
  await writeFile(
    releasePath,
    JSON.stringify({ schemaVersion: 1, repository: 'https://github.com/jeonghwanko/oddbout-starter.git', provider: 'grok', commit, version: '0.5.5' }),
  );
  const run = async (cmd, args) => {
    calls.push([cmd, args]);
    assert.equal(cmd, 'git');
    return { stdout: args[0] === 'rev-parse' ? commit : '' };
  };
  const loadRuntime = async url => {
    assert.ok(url.endsWith('/scripts/dots-start.mjs'));
    return {
      start: async options => {
        assert.equal(options.install, true);
        assert.equal(options.workspace, f.workspace);
        return { nextAction: { action: 'repair-installation' } };
      },
    };
  };
  const result = await launch(['--workspace', f.workspace, '--runtime-home', path.join(f.base, 'runtimes'), '--install'], { releasePath, run, loadRuntime });
  assert.equal(result.nextAction.action, 'repair-installation');
  assert.ok(calls.some(([, args]) => args[0] === 'fetch' && args.at(-1) === commit));
  await mkdir(path.join(f.workspace, 'output'));
  await writeFile(
    path.join(f.workspace, 'output/dots-workspace.json'),
    JSON.stringify({ schemaVersion: 1, provider: 'grok', commit: 'c'.repeat(40), runtime: f.runtime }),
  );
  calls.length = 0;
  await assert.rejects(launch(['--workspace', f.workspace], { releasePath, run }), /runtime-commit-mismatch/);
  assert.equal(calls.length, 1); // Never fetch/pull over a bound workspace.
});
test('fixed Grok VM route rejects API-key billing before dispatch, including video', async () => {
  for (const args of [['gen', '--provider', 'grok'], ['video'], ['video-resume']])
    await assert.rejects(
      guardDotsExecution('', '', args, { AI_FIGHTER_EXECUTION_HOST: 'dots', XAI_API_KEY: 'never-print' }),
      /subscription-api-key-environment-blocked/,
    );
});

test('front door CLI returns a failing exit code while preserving its actionable JSON', async t => {
  const f = await fixture(t);
  await assert.rejects(
    promisify(execFile)(process.execPath, [
      fileURLToPath(new URL('../dots.mjs', import.meta.url)),
      '--workspace',
      f.workspace,
      '--runtime-home',
      path.join(f.base, 'not-installed'),
    ]),
    error => {
      assert.equal(error.code, 1);
      assert.equal(JSON.parse(error.stdout).action, 'install-reviewed-release');
      return true;
    },
  );
});

test('front door imports the bound runtime without relying on child Node stdout', async t => {
  const f = await fixture(t),
    commit = 'd'.repeat(40),
    releasePath = path.join(f.base, 'release.json');
  await writeFile(
    releasePath,
    JSON.stringify({
      schemaVersion: 1,
      repository: 'https://github.com/jeonghwanko/oddbout-starter.git',
      provider: 'grok',
      commit: 'e'.repeat(40),
      version: '0.5.5',
    }),
  );
  await mkdir(path.join(f.workspace, 'output'));
  await writeFile(path.join(f.workspace, 'output/dots-workspace.json'), JSON.stringify({ schemaVersion: 1, provider: 'grok', commit, runtime: f.runtime }));
  await mkdir(path.join(f.runtime, 'scripts'));
  await writeFile(
    path.join(f.runtime, 'scripts/dots-start.mjs'),
    `export async function start(options) {
    return { schemaVersion: 1, received: options, automaticGeneration: false,
      nextAction: { action: 'connect-grok-subscription' } };
  }`,
  );
  const calls = [],
    run = async (cmd, args) => {
      calls.push([cmd, args]);
      assert.equal(cmd, 'git');
      assert.deepEqual(args, ['rev-parse', 'HEAD']);
      return { stdout: commit };
    };
  const result = await launch(['--workspace', f.workspace], { releasePath, run });
  assert.deepEqual(result.received, { runtime: f.runtime, workspace: f.workspace, install: false });
  assert.equal(result.nextAction.action, 'connect-grok-subscription');
  assert.equal(result.automaticGeneration, false);
  assert.equal(calls.length, 1); // No fetch, install or child Node after a workspace is bound.
  await assert.rejects(launch(['--workspace', f.workspace], { releasePath, run, loadRuntime: async () => ({}) }), /runtime-start-contract-missing/);
});
