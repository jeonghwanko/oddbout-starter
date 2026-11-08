import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSshRunnerArgs, quotePosix, validateHostConfig } from '../broadcast/hosts.mjs';
import { parseRunnerArgs, parseRemoteRunnerReport, runRemoteRunner, runnerSshEnvironment, runBroadcastRunner } from '../scripts/broadcast-runner.mjs';

const host = {
  id: 'office-stable',
  transport: 'ssh',
  platform: 'linux',
  sshTarget: 'runner@office-stable',
  repoRoot: '/srv/oddbout starter',
  nodeExecutable: '/opt/node 22/bin/node',
  remoteEnvFile: '.env.broadcast.local',
  obsUrl: '',
  obsPasswordEnv: 'ODDBOUT_OBS_PASSWORD',
};
const args = { configPath: 'deploy/remote-hosts.json', statePath: '.oddbout-broadcast/office-stable.json', workerId: 'office-worker', once: true };
const record = (extra = {}) => ({ hostId: host.id, status: 'idle', ...extra });
function spawning(action) {
  const calls = [];
  const kills = [];
  const spawnImpl = (command, argv, options) => {
    calls.push({ command, argv, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = signal => {
      kills.push(signal);
      queueMicrotask(() => child.emit('close', null, signal));
      return true;
    };
    child.stdin.once('finish', () => queueMicrotask(() => child.emit('close', 0)));
    queueMicrotask(() => action(child));
    return child;
  };
  return { calls, kills, spawnImpl };
}

test('remote command uses fixed script, explicit Node/env-file, quoted POSIX paths and strict foreground SSH', () => {
  const argv = buildSshRunnerArgs(host, args);
  const command = argv.at(-1);
  assert.equal(argv[0], '-T');
  assert.ok(argv.includes('BatchMode=yes'));
  assert.ok(argv.includes('StrictHostKeyChecking=yes'));
  assert.ok(argv.includes('ForwardAgent=no'));
  assert.ok(argv.includes('SendEnv=-*'));
  assert.ok(argv.includes('ServerAliveCountMax=2'));
  assert.equal(argv.at(-2), 'runner@office-stable');
  assert.equal(
    command,
    "cd '/srv/oddbout starter' && exec '/opt/node 22/bin/node' '--env-file=.env.broadcast.local' scripts/broadcast-runner.mjs --remote-self --host 'office-stable' --config 'deploy/remote-hosts.json' --state '.oddbout-broadcast/office-stable.json' --worker-id 'office-worker' --once",
  );
  const tricky = ".env's $(touch sentinel); `whoami`";
  assert.ok(
    buildSshRunnerArgs({ ...host, remoteEnvFile: tricky }, args)
      .at(-1)
      .includes(quotePosix(`--env-file=${tricky}`)),
  );
  assert.ok(
    buildSshRunnerArgs({ ...host, platform: 'darwin' }, { ...args, statePath: '/var/lib/oddbout/runner.json' })
      .at(-1)
      .includes("--state '/var/lib/oddbout/runner.json'"),
  );
  assert.throws(() => buildSshRunnerArgs({ ...host, nodeExecutable: undefined }, args), /host_ssh_unconfigured/);
  assert.throws(() => buildSshRunnerArgs({ ...host, platform: 'win32' }, args), /host_ssh_platform_unsupported/);
  for (const configPath of ['C:\\local\\hosts.json', 'C:/local/hosts.json', '/etc/hosts', '../hosts.json', '--eval'])
    assert.throws(() => buildSshRunnerArgs(host, { ...args, configPath }));
  for (const statePath of ['C:\\local\\state.json', 'C:/local/state.json', '../state.json', '--once'])
    assert.throws(() => buildSshRunnerArgs(host, { ...args, statePath }));
  assert.throws(() => buildSshRunnerArgs(host, { ...args, workerId: '--eval' }));
  assert.throws(() => validateHostConfig({ ...host, remoteEnvFile: '--eval' }));
});

test('SSH child environment excludes local application/provider credentials and no credential enters argv', async () => {
  const local = {
    PATH: '/usr/bin',
    HOME: '/home/user',
    ODDBOUT_BROADCAST_WORKER_TOKEN: 'worker-private',
    ODDBOUT_OBS_PASSWORD: 'obs-private',
    OPENAI_API_KEY: 'api-private',
  };
  assert.deepEqual(runnerSshEnvironment(local), { PATH: '/usr/bin', HOME: '/home/user' });
  const fake = spawning(child => {
    child.stdout.write(JSON.stringify(record()) + '\n');
    child.emit('close', 0);
  });
  const report = await runRemoteRunner(host, args, { env: local, spawnImpl: fake.spawnImpl });
  assert.equal(report.status, 'idle');
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0].options.env, { PATH: '/usr/bin', HOME: '/home/user' });
  assert.equal(fake.calls[0].options.windowsHide, true);
  assert.deepEqual(fake.calls[0].options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.doesNotMatch(JSON.stringify(fake.calls), /worker-private|obs-private|api-private/);
});

test('only allowlisted remote JSON is forwarded; extra fields and raw stderr never leak', async () => {
  const forwarded = [];
  const fake = spawning(child => {
    child.stderr.write('private-password SSH diagnostic');
    child.stdout.write(JSON.stringify(record({ arbitrary: 'private-password' })) + '\n');
    child.emit('close', 0);
  });
  const result = await runRemoteRunner(host, args, { spawnImpl: fake.spawnImpl, onResult: value => forwarded.push(value) });
  assert.equal(result.status, 'idle');
  assert.equal(forwarded.length, 1);
  assert.doesNotMatch(JSON.stringify({ result, forwarded }), /private-password|arbitrary/);
  const completed = parseRemoteRunnerReport(
    JSON.stringify(
      record({
        status: 'completed',
        jobId: '11111111-1111-4111-8111-111111111111',
        observation: { mode: 'render-only', broadcastVerified: false, liveSeconds: null, secret: 'private' },
      }),
    ),
    host,
  );
  assert.equal(completed.status, 'completed');
  assert.equal(completed.observation.liveSeconds, null);
  assert.doesNotMatch(JSON.stringify(completed), /secret|private/);
  for (const change of [
    { hostId: 'other' },
    { status: 'running' },
    { reason: 'private-password' },
    { status: 'completed' },
    { status: 'completed', jobId: '11111111-1111-4111-8111-111111111111' },
    { observation: { mode: 'live', broadcastVerified: true, liveSeconds: 24 * 3600 } },
  ])
    assert.throws(() => parseRemoteRunnerReport(JSON.stringify(record(change)), host));
});

test('connection loss, malformed stdout and local stop never restart or imply successful completion', async () => {
  const lost = spawning(child => {
    child.stderr.write('private-password');
    child.emit('close', 255);
  });
  const lostReport = await runRemoteRunner(host, args, { spawnImpl: lost.spawnImpl });
  assert.equal(lostReport.reason, 'runner_remote_connection_lost');
  assert.equal(lost.calls.length, 1);
  const invalid = spawning(child => {
    child.stdout.write('private-password plain diagnostic\n');
  });
  const invalidReport = await runRemoteRunner(host, args, { spawnImpl: invalid.spawnImpl });
  assert.equal(invalidReport.reason, 'runner_remote_output_invalid');
  assert.doesNotMatch(JSON.stringify(invalidReport), /private-password/);
  assert.equal(invalid.calls.length, 1);
  const controller = new AbortController();
  const stopped = spawning(() => controller.abort());
  const stoppedReport = await runRemoteRunner(host, args, { spawnImpl: stopped.spawnImpl, signal: controller.signal });
  assert.equal(stoppedReport.status, 'unknown');
  assert.equal(stoppedReport.reason, 'runner_remote_stopped_unknown');
  assert.equal(stopped.calls.length, 1);
});

test('Windows controller selects SSH before remote platform/env checks and never forwards local config path', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'broadcast-runner-dispatch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = join(dir, 'local-hosts.json');
  await writeFile(config, JSON.stringify({ version: 1, hosts: [host] }));
  const fake = spawning(child => {
    child.stdout.write(JSON.stringify(record()) + '\n');
    child.emit('close', 0);
  });
  const result = await runBroadcastRunner(['--host', host.id, '--config', config, '--remote-config', 'deploy/remote-hosts.json', '--once'], {
    platform: 'win32',
    env: {},
    spawnImpl: fake.spawnImpl,
  });
  assert.equal(result.status, 'idle');
  assert.equal(fake.calls.length, 1);
  const remoteCommand = fake.calls[0].argv.at(-1);
  assert.ok(remoteCommand.includes("--config 'deploy/remote-hosts.json'"));
  assert.equal(remoteCommand.includes(config), false);
  const direct = await runBroadcastRunner(['--host', host.id, '--config', config, '--remote-self', '--once'], {
    platform: 'win32',
    env: {},
    spawnImpl: fake.spawnImpl,
  });
  assert.equal(direct.reason, 'runner_platform_mismatch');
  assert.equal(fake.calls.length, 1);
  const live = await runBroadcastRunner(['--host', host.id, '--config', config, '--live'], { platform: 'win32', env: {}, spawnImpl: fake.spawnImpl });
  assert.equal(live.reason, 'runner_live_channel_unverified');
  assert.equal(fake.calls.length, 1);
  const parsed = parseRunnerArgs(['--config', 'C:\\local\\hosts.json', '--host', host.id]);
  assert.equal(parsed.remoteConfigPath, 'deploy/broadcast-hosts.json');
  assert.equal(parsed.remoteSelf, false);
});

test('SSH child or output-stream errors stop the owned child rather than leaving it detached', async () => {
  for (const source of ['child', 'stdout', 'stderr']) {
    let closed = false;
    const fake = spawning(child => {
      child.stdin.once('finish', () => {
        closed = true;
      });
      (source === 'child' ? child : child[source]).emit('error', new Error('private diagnostic'));
    });
    const report = await runRemoteRunner(host, args, { spawnImpl: fake.spawnImpl });
    assert.equal(report.status, 'unknown');
    assert.equal(report.reason, 'runner_remote_connection_failed');
    assert.equal(closed, true);
  }
});

test('unresponsive owned SSH child receives bounded TERM/KILL escalation and never a success report', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  const killed = [];
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = signal => {
      killed.push(signal);
      return true;
    };
    return child;
  };
  const pending = runRemoteRunner(host, args, { signal: controller.signal, spawnImpl });
  controller.abort();
  t.mock.timers.tick(5000);
  assert.deepEqual(killed, ['SIGTERM']);
  t.mock.timers.tick(2000);
  assert.deepEqual(killed, ['SIGTERM', 'SIGKILL']);
  t.mock.timers.tick(1000);
  const report = await pending;
  assert.equal(report.status, 'unknown');
  assert.equal(report.reason, 'runner_remote_stopped_unknown');
});
