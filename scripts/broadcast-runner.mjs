#!/usr/bin/env node
// @ts-check
import { readFile, stat, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { loadHostConfig, buildSshRunnerArgs } from '../broadcast/hosts.mjs';
import { createObsClient } from '../broadcast/obs.mjs';
import { createBroadcastRunner } from '../broadcast/runner.mjs';

/** @param {string[]} argv */
export function parseRunnerArgs(argv) {
  let hostId = 'current-pc'; let configPath = 'deploy/broadcast-hosts.json';
  let statePath; let workerId; let once = false; let live = false; let remoteSelf = false;
  let remoteConfigPath = 'deploy/broadcast-hosts.json';
  const seen = new Set();
  for (let n = 0; n < argv.length; n++) {
    const key = argv[n];
    if (seen.has(key)) throw new Error('runner_invalid_arguments');
    seen.add(key);
    if (key === '--once') { once = true; continue; }
    if (key === '--live') { live = true; continue; }
    if (key === '--remote-self') { remoteSelf = true; continue; }
    if (!['--host', '--config', '--remote-config', '--state', '--worker-id'].includes(key)) throw new Error('runner_invalid_arguments');
    const value = argv[++n];
    if (!value || value.startsWith('--') || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('runner_invalid_arguments');
    if (key === '--host') hostId = value;
    else if (key === '--config') configPath = value;
    else if (key === '--remote-config') remoteConfigPath = value;
    else if (key === '--state') statePath = value;
    else workerId = value;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(hostId)) throw new Error('runner_invalid_arguments');
  if (workerId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(workerId)) throw new Error('runner_invalid_arguments');
  return { hostId, configPath, statePath: statePath ?? `.oddbout-broadcast/${hostId}.json`,
    workerId: workerId ?? `${hostId.slice(0,27)}-${randomUUID()}`, once, live, remoteSelf, remoteConfigPath };
}

const REMOTE_REASONS = new Set(['runner_stopped','runner_reconciliation_required','runner_live_channel_unverified',
  'runner_obs_unavailable','runner_claim_outcome_unknown','runner_invalid_claim','runner_checkpoint_failed',
  'runner_approval_expired','runner_lease_lost','runner_renderer_not_available','runner_graphical_session_required',
  'runner_renderer_setup_failed','runner_renderer_cleanup_unknown','runner_render_outcome_unknown','runner_completion_outcome_unknown',
  'runner_platform_mismatch','runner_environment_required','runner_state_locked','runner_configuration_or_connection_failed']);
/** Only trusted JSON status fields cross the SSH log boundary. Raw stdout/stderr and
 * unexpected properties may contain credentials, shell diagnostics or provider responses.
 * @param {string} line @param {import('../broadcast/hosts.mjs').BroadcastHost} host */
export function parseRemoteRunnerReport(line, host) {
  if (line.length > 64 * 1024) throw new Error('runner_remote_output_invalid');
  const value = JSON.parse(line);
  if (!value || value.hostId !== host.id || !['idle','completed','failed','unknown','unconfigured','stopped'].includes(value.status)
    || (value.reason !== undefined && !REMOTE_REASONS.has(value.reason))
    || (value.jobId !== undefined && (typeof value.jobId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.jobId)))
    || (['completed','failed'].includes(value.status) && !value.jobId)) throw new Error('runner_remote_output_invalid');
  const observation = value.observation;
  if (value.status === 'completed' && observation === undefined) throw new Error('runner_remote_output_invalid');
  if (observation !== undefined && (observation?.mode !== 'render-only' || observation.broadcastVerified !== false || observation.liveSeconds !== null)) throw new Error('runner_remote_output_invalid');
  return { hostId: host.id, status: value.status, ...(value.jobId ? { jobId: value.jobId } : {}),
    ...(value.reason ? { reason: value.reason } : {}), ...(observation ? { observation: { mode: 'render-only', broadcastVerified: false, liveSeconds: null } } : {}) };
}

/** Authentication uses the local SSH configuration/agent. App/provider/OBS credentials
 * are absent from the child environment; remote Node loads its own configured env file.
 * @param {Record<string,string|undefined>} env */
export function runnerSshEnvironment(env) {
  const keys = ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','HOME','USERPROFILE',
    'HOMEDRIVE','HOMEPATH','LANG','LC_ALL','SSH_AUTH_SOCK','SSH_AGENT_PID'];
  return Object.fromEntries(keys.filter(key => env[key] !== undefined).map(key => [key, env[key]]));
}

/** Foreground SSH, one attempt. The open stdin channel is a control-lifetime signal:
 * remote --remote-self aborts on EOF/SIGHUP; no user input or credential is sent.
 * @param {import('../broadcast/hosts.mjs').BroadcastHost} host
 * @param {{configPath:string,statePath:string,workerId:string,once?:boolean,live?:boolean}} args
 * @param {{signal?:AbortSignal,onResult?:(result:any)=>void,env?:Record<string,string|undefined>,spawnImpl?:typeof spawn}} [options] */
export async function runRemoteRunner(host, args, { signal, onResult = () => {}, env = process.env, spawnImpl = spawn } = {}) {
  const sshArgs = buildSshRunnerArgs(host, args);
  if (signal?.aborted) return { hostId: host.id, status: 'unknown', reason: 'runner_remote_stopped_unknown' };
  return new Promise(resolveResult => {
    /** @type {import('node:child_process').ChildProcess} */ let child;
    try { child = spawnImpl('ssh', sshArgs, { stdio: ['pipe','pipe','pipe'], windowsHide: true, env: runnerSshEnvironment(env) }); }
    catch { resolveResult({ hostId: host.id, status: 'unknown', reason: 'runner_remote_connection_failed' }); return; }
    let buffer = ''; let done = false; let abortReason = ''; let lastKey = '';
    /** @type {ReturnType<typeof parseRemoteRunnerReport>|undefined} */ let last;
    /** @type {ReturnType<typeof setTimeout>|undefined} */ let terminateTimer;
    /** @type {ReturnType<typeof setTimeout>|undefined} */ let killTimer;
    /** @type {ReturnType<typeof setTimeout>|undefined} */ let settleTimer;
    /** @param {any} report */
    function settle(report) {
      if (done) return; done = true;
      signal?.removeEventListener('abort', abort);
      clearTimeout(terminateTimer); clearTimeout(killTimer); clearTimeout(settleTimer);
      resolveResult(report);
    }
    function stopChild() {
      try { child.stdin?.end(); } catch { /* A disconnected channel is already uncertain. */ }
      terminateTimer ??= setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, 5000);
      killTimer ??= setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 7000);
      settleTimer ??= setTimeout(() => settle({ hostId: host.id, status: 'unknown', reason: abortReason || 'runner_remote_connection_lost' }), 8000);
    }
    const abort = () => { abortReason ||= 'runner_remote_stopped_unknown'; stopChild(); };
    /** @param {string} line */
    function accept(line) {
      if (done || abortReason || !line.trim()) return;
      try {
        const report = parseRemoteRunnerReport(line.trim(), host);
        last = report; const key = JSON.stringify(report);
        if (key !== lastKey) { lastKey = key; onResult(report); }
      } catch { abortReason = 'runner_remote_output_invalid'; stopChild(); }
    }
    child.stdout?.on('data', chunk => {
      if (done || abortReason) return;
      buffer += String(chunk);
      if (buffer.length > 64 * 1024 && !buffer.includes('\n')) { abortReason = 'runner_remote_output_invalid'; stopChild(); return; }
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) { accept(buffer.slice(0,index)); buffer = buffer.slice(index+1); }
    });
    child.stderr?.on('data', () => {}); // Deliberately drain and discard unstructured diagnostics.
    child.stdin?.on('error', () => {});
    const connectionError = () => { abortReason ||= 'runner_remote_connection_failed'; stopChild(); };
    child.once('error', connectionError);
    child.stdout?.once('error', connectionError); child.stderr?.once('error', connectionError);
    child.once('close', code => {
      if (buffer) accept(buffer);
      if (abortReason) { settle({ hostId: host.id, status: 'unknown', reason: abortReason }); return; }
      if (last && ((code === 0 && ['completed','idle','stopped'].includes(last.status))
        || (code === 1 && ['unknown','failed','unconfigured'].includes(last.status)))) settle(last);
      else settle({ hostId: host.id, status: 'unknown', reason: 'runner_remote_connection_lost' });
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/** A pending claim/completion is a reconciliation barrier, including across process restarts.
 * Credentials are deliberately absent. Nothing automatically clears an uncertain record.
 * @param {string} path @returns {Promise<import('../broadcast/runner.mjs').RunnerCheckpoint|null>} */
async function readCheckpoint(path) {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error();
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (!value || value.schemaVersion !== 1 || typeof value.status !== 'string' || value.status.length > 64) throw new Error();
    return value;
  } catch (/** @type {any} */ error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error('runner_checkpoint_invalid');
  }
}

/** Atomic replacement on the same filesystem. @param {string} path @param {import('../broadcast/runner.mjs').RunnerCheckpoint|null} record */
async function writeCheckpoint(path, record) {
  if (record === null) { await rm(path, { force: true }); return; }
  const temporary = `${path}.${process.pid}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(record)); await file.sync(); }
  finally { await file.close(); }
  await rename(temporary, path);
}

/** Dispatch SSH hosts in the foreground, or execute locally in the selected machine's
 * graphical session. --remote-self is the fixed remote endpoint and never recurses.
 * @param {string[]} argv
 * @param {{env?:Record<string,string|undefined>,platform?:string,onResult?:(result:any)=>void,spawnImpl?:typeof spawn}} [options] */
export async function runBroadcastRunner(argv, { env = process.env, platform = process.platform, onResult = () => {}, spawnImpl = spawn } = {}) {
  /** @type {import('../broadcast/obs.mjs').ObsClient|undefined} */ let obs;
  /** @type {import('node:fs/promises').FileHandle|undefined} */ let lock;
  let lockPath;
  let hostId = 'unknown'; let remoteInput = false;
  /** @param {any} value */ const report = value => ({ ...value, hostId });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  process.once('SIGHUP', stop);
  try {
    const args = parseRunnerArgs(argv); hostId = args.hostId;
    const host = await loadHostConfig(args.configPath, args.hostId);
    if (args.live) return report({ status: 'unconfigured', reason: 'runner_live_channel_unverified' });
    if (host.transport === 'ssh' && !args.remoteSelf) return await runRemoteRunner(host, {
      configPath: args.remoteConfigPath, statePath: args.statePath, workerId: args.workerId, once: args.once,
    }, { signal: controller.signal, onResult, env, spawnImpl });
    if (args.remoteSelf) { remoteInput = true; process.stdin.once('end', stop); process.stdin.once('close', stop); process.stdin.once('error', stop); process.stdin.resume(); }
    if (host.platform && host.platform !== platform) return report({ status: 'unconfigured', reason: 'runner_platform_mismatch' });
    if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return report({ status: 'unconfigured', reason: 'runner_graphical_session_required' });
    if (!host.obsUrl || !host.obsPasswordEnv || !env[host.obsPasswordEnv]
      || !env.ODDBOUT_BROADCAST_API_ORIGIN || !env.ODDBOUT_BROADCAST_WORKER_TOKEN || !env.ODDBOUT_BROADCAST_ARENA_URL)
      return report({ status: 'unconfigured', reason: 'runner_environment_required' });
    const statePath = resolve(args.statePath);
    await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
    lockPath = `${statePath}.lock`;
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch { return report({ status: 'unconfigured', reason: 'runner_state_locked' }); }
    await lock.writeFile(JSON.stringify({ hostId: host.id, pid: process.pid, startedAt: new Date().toISOString() }));
    // A checkpoint left by a lost reply or a crash is settled with the server by the runner before it claims anything.
    const pending = await readCheckpoint(statePath);
    obs = await createObsClient({ url: host.obsUrl, password: env[host.obsPasswordEnv] });
    const runner = createBroadcastRunner({ hostId: host.id, workerId: args.workerId,
      apiOrigin: env.ODDBOUT_BROADCAST_API_ORIGIN, workerToken: env.ODDBOUT_BROADCAST_WORKER_TOKEN,
      arenaUrl: env.ODDBOUT_BROADCAST_ARENA_URL, obs, pending,
      checkpoint: record => writeCheckpoint(statePath, record) });
    return report(args.once ? await runner.runOnce({ signal: controller.signal }) : await runner.run({ signal: controller.signal, onResult: value => onResult(report(value)) }));
  } catch { return report({ status: 'unconfigured', reason: 'runner_configuration_or_connection_failed' }); }
  finally {
    controller.abort(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    process.removeListener('SIGHUP', stop);
    if (remoteInput) { process.stdin.removeListener('end', stop); process.stdin.removeListener('close', stop); process.stdin.removeListener('error', stop); process.stdin.pause(); }
    obs?.close();
    if (lock) { await lock.close().catch(() => {}); if (lockPath) await rm(lockPath, { force: true }).catch(() => {}); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runBroadcastRunner(process.argv.slice(2), { onResult: result => console.log(JSON.stringify(result)) });
  console.log(JSON.stringify(report));
  process.exitCode = ['completed', 'idle', 'stopped'].includes(report.status) ? 0 : 1;
}
