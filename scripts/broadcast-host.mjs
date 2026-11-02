#!/usr/bin/env node
// @ts-check
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { buildSshDoctorArgs, doctorHost, loadHostConfig } from '../broadcast/hosts.mjs';

/** @param {string[]} argv */
export function parseHostArgs(argv) {
  let hostId = 'current-pc'; let configPath = 'deploy/broadcast-hosts.json'; let remoteSelf = false;
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (seen.has(key)) throw new Error('host_invalid_arguments');
    seen.add(key);
    if (key === '--doctor') continue;
    if (key === '--remote-self') { remoteSelf = true; continue; }
    if (key === '--host' || key === '--config') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error('host_invalid_arguments');
      if (key === '--host') hostId = value; else configPath = value;
    } else throw new Error('host_invalid_arguments');
  }
  return { hostId, configPath, remoteSelf };
}

/** Validate evidence before reporting a remote process as an OBS connection.
 * @param {string} stdout @param {import('../broadcast/hosts.mjs').BroadcastHost} host */
export function parseRemoteDoctorReport(stdout, host) {
  const report = JSON.parse(stdout);
  if (!report || report.hostId !== host.id || !['ready', 'unconfigured', 'unreachable'].includes(report.status) || report.broadcastVerified !== false || typeof report.nodeVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(report.nodeVersion) || !['linux', 'darwin'].includes(report.platform) || (host.platform && report.platform !== host.platform)) throw new Error('host_invalid_remote_report');
  const base = { hostId: host.id, status: report.status, platform: report.platform, nodeVersion: report.nodeVersion, check: 'obs-read-only', broadcastVerified: false };
  if (report.status !== 'ready') {
    const allowed = ['node_22_required', 'platform_mismatch', 'obs_configuration_required', 'obs_check_failed'];
    return { ...base, reason: allowed.includes(report.reason) ? report.reason : 'remote_doctor_incomplete' };
  }
  if (Number(report.nodeVersion.split('.')[0]) < 22 || typeof report.obs?.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9._-]{1,64})?$/.test(report.obs.version) || typeof report.obs?.websocketVersion !== 'string' || !/^5\.\d+\.\d+(?:[-+][A-Za-z0-9._-]{1,64})?$/.test(report.obs.websocketVersion) || typeof report.obs?.outputActive !== 'boolean' || typeof report.obs?.outputReconnecting !== 'boolean') throw new Error('host_invalid_remote_report');
  return { ...base, obs: { version: report.obs.version, websocketVersion: report.obs.websocketVersion, outputActive: report.obs.outputActive, outputReconnecting: report.obs.outputReconnecting } };
}

/** @param {string[]} argv */
export async function runHostDoctor(argv) {
  let hostId = 'unknown';
  try {
    const args = parseHostArgs(argv); hostId = args.hostId;
    const host = await loadHostConfig(args.configPath, hostId);
    if (host.transport === 'local' || args.remoteSelf) return await doctorHost(host);
    if (!host.sshTarget || !host.repoRoot) return { hostId, status: 'unconfigured', reason: 'ssh_configuration_required', broadcastVerified: false };
    const sshArgs = buildSshDoctorArgs(host, args.configPath);
    try {
      let stdout;
      try {
        ({ stdout } = await promisify(execFile)('ssh', sshArgs, { timeout: 30_000, maxBuffer: 64 * 1024, windowsHide: true, encoding: 'utf8' }));
      } catch (/** @type {any} */ error) {
        // A valid doctor reports incomplete checks with exit 1. SSH failures,
        // shell output and authentication diagnostics remain redacted.
        if (error?.code !== 1 || error?.killed || typeof error?.stdout !== 'string') throw error;
        stdout = error.stdout;
      }
      return parseRemoteDoctorReport(stdout, host);
    } catch (/** @type {any} */ error) { return { hostId, status: 'unreachable', reason: error?.code === 127 ? 'remote_node_unavailable' : 'ssh_doctor_failed', broadcastVerified: false }; }
  } catch { return { hostId, status: 'unconfigured', reason: 'host_configuration_invalid', broadcastVerified: false }; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runHostDoctor(process.argv.slice(2));
  console.log(JSON.stringify(report));
  process.exitCode = report.status === 'ready' ? 0 : 1;
}
