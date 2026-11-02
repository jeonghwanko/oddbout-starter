import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSshDoctorArgs, doctorHost, loadHostConfig, quotePosix, validateHostConfig } from '../broadcast/hosts.mjs';
import { parseHostArgs, parseRemoteDoctorReport, runHostDoctor } from '../scripts/broadcast-host.mjs';

const host = { id: 'current-pc', transport: 'local', platform: 'win32', obsUrl: 'ws://127.0.0.1:4455', obsPasswordEnv: 'ODDBOUT_OBS_PASSWORD' };
const remote = { ...host, id: 'office-stable', transport: 'ssh', platform: 'linux', sshTarget: 'runner@office-stable', repoRoot: '/srv/oddbout starter' };
const options = { env: { ODDBOUT_OBS_PASSWORD: 'private-password' }, platform: 'win32', nodeVersion: '22.12.0' };

test('example config has three explicit unconfigured hosts, never ready from process alone', async () => {
  for (const id of ['current-pc', 'office-stable', 'svl-mac-01']) {
    const config = await loadHostConfig('deploy/broadcast-hosts.example.json', id);
    const report = await doctorHost(config, { env: {}, platform: config.platform });
    assert.equal(report.status, 'unconfigured'); assert.equal(report.broadcastVerified, false);
  }
  const report = await runHostDoctor(['--host', 'office-stable', '--config', 'deploy/broadcast-hosts.example.json']);
  assert.equal(report.status, 'unconfigured');
});

test('config rejects secrets, unknown fields, duplicate IDs and malicious SSH targets', async () => {
  for (const extra of [{ password: 'secret' }, { obsPassword: 'secret' }, { obsPasswordEnv: 'INVALID=VALUE' }, { obsUrl: 'ws://192.0.2.1:4455' }, { sshTarget: '-oProxyCommand=evil' }, { sshTarget: 'host;touch evil' }, { repoRoot: '/srv/path\nwhoami' }]) assert.throws(() => validateHostConfig({ ...remote, ...extra }));
  const dir = await mkdtemp(join(tmpdir(), 'broadcast-host-'));
  try {
    const file = join(dir, 'hosts.json');
    await writeFile(file, JSON.stringify({ version: 1, hosts: [host, host] }));
    await assert.rejects(loadHostConfig(file, host.id), /host_duplicate_id/);
    await writeFile(file, JSON.stringify({ version: 1, hosts: [host] }));
    assert.deepEqual(await loadHostConfig(file, host.id), host);
    await assert.rejects(loadHostConfig(file, 'unknown'), /host_not_found/);
  } finally { await rm(dir, { recursive: true }); }
});

test('SSH dispatch uses fixed doctor, strict host-key checking, batch mode and POSIX quoting', () => {
  const args = buildSshDoctorArgs(remote, 'deploy/broadcast-hosts.json');
  assert.deepEqual(args.slice(0, -1), ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'SendEnv=-*', '--', 'runner@office-stable']);
  assert.equal(args.at(-1), "cd '/srv/oddbout starter' && exec 'node' scripts/broadcast-host.mjs --remote-self --doctor --host 'office-stable' --config 'deploy/broadcast-hosts.json'");
  // The doctor reads the runner's env file, where the host keeps its OBS password.
  assert.equal(buildSshDoctorArgs({ ...remote, remoteEnvFile: '.env.broadcast.local' }, 'deploy/broadcast-hosts.json').at(-1),
    "cd '/srv/oddbout starter' && exec 'node' '--env-file=.env.broadcast.local' scripts/broadcast-host.mjs --remote-self --doctor --host 'office-stable' --config 'deploy/broadcast-hosts.json'");
  assert.match(buildSshDoctorArgs({ ...remote, nodeExecutable: '/opt/Node Runtime/bin/node' }, 'deploy/hosts.json').at(-1), /exec '\/opt\/Node Runtime\/bin\/node'/);
  assert.throws(() => buildSshDoctorArgs({ ...remote, nodeExecutable: 'node --eval evil' }, 'deploy/hosts.json'), /host_invalid_node_executable/);
  assert.equal(quotePosix("/srv/it's $(touch evil); `whoami`"), "'/srv/it'\"'\"'s $(touch evil); `whoami`'");
  assert.doesNotMatch(JSON.stringify(args), /private-password|StartStream/);
  for (const config of ['../private.json', '/etc/hosts', 'deploy\\hosts.json']) assert.throws(() => buildSshDoctorArgs(remote, config));
  assert.throws(() => buildSshDoctorArgs({ ...remote, platform: 'win32' }, 'deploy/hosts.json'), /host_ssh_platform_unsupported/);
  assert.throws(() => buildSshDoctorArgs({ ...remote, sshTarget: '' }, 'deploy/hosts.json'), /host_ssh_unconfigured/);
});

test('doctor checks only OBS version and stream status, closes client and redacts secret', async () => {
  const calls = []; let closed = false;
  const report = await doctorHost(host, { ...options, obsFactory: async input => {
    assert.equal(input.password, 'private-password');
    return { request: async type => {
      calls.push(type);
      return type === 'GetVersion' ? { obsVersion: '32.0.0', obsWebSocketVersion: '5.6.0', extra: 'private-password' } : { outputActive: false, outputReconnecting: false, extra: 'private-password' };
    }, close() { closed = true; } };
  } });
  assert.deepEqual(calls, ['GetVersion', 'GetStreamStatus']); assert.equal(closed, true);
  assert.equal(report.status, 'ready'); assert.equal(report.broadcastVerified, false);
  assert.equal(report.obs.outputActive, false);
  assert.doesNotMatch(JSON.stringify(report), /private-password|extra/);
});

test('doctor distinguishes missing configuration, platform/node mismatch and unreachable or malformed OBS', async () => {
  assert.equal((await doctorHost(host, { ...options, env: {} })).status, 'unconfigured');
  assert.equal((await doctorHost(host, { ...options, nodeVersion: '20.0.0' })).reason, 'node_22_required');
  assert.equal((await doctorHost(host, { ...options, platform: 'darwin' })).reason, 'platform_mismatch');
  for (const obsFactory of [async () => { throw new Error('private-password'); }, async () => ({ request: async () => ({}), close() {} })]) {
    const report = await doctorHost(host, { ...options, obsFactory });
    assert.equal(report.status, 'unreachable'); assert.doesNotMatch(JSON.stringify(report), /private-password/);
  }
});

test('CLI defaults to read-only doctor and rejects mutations/password flags', () => {
  assert.deepEqual(parseHostArgs([]), { hostId: 'current-pc', configPath: 'deploy/broadcast-hosts.json', remoteSelf: false });
  assert.equal(parseHostArgs(['--doctor', '--remote-self', '--host', 'svl-mac-01']).remoteSelf, true);
  for (const args of [['--start'], ['--password', 'secret'], ['--host'], ['--doctor', '--doctor']]) assert.throws(() => parseHostArgs(args), /host_invalid_arguments/);
});

test('remote readiness requires version and stream evidence; report fields and errors are allowlisted', () => {
  const report = { hostId: remote.id, status: 'ready', platform: 'linux', nodeVersion: '22.12.0', broadcastVerified: false, obs: { version: '32.0.0', websocketVersion: '5.6.0', outputActive: false, outputReconnecting: false }, arbitrary: 'private-password' };
  assert.equal(parseRemoteDoctorReport(JSON.stringify(report), remote).status, 'ready');
  assert.doesNotMatch(JSON.stringify(parseRemoteDoctorReport(JSON.stringify(report), remote)), /private-password/);
  for (const change of [{ obs: {} }, { obs: { ...report.obs, outputActive: undefined } }, { hostId: 'wrong' }, { platform: 'win32' }, { nodeVersion: '20.0.0' }, { broadcastVerified: true }]) assert.throws(() => parseRemoteDoctorReport(JSON.stringify({ ...report, ...change }), remote));
  const incomplete = parseRemoteDoctorReport(JSON.stringify({ ...report, status: 'unconfigured', reason: 'obs_configuration_required' }), remote);
  assert.equal(incomplete.status, 'unconfigured'); assert.equal(incomplete.reason, 'obs_configuration_required');
});
