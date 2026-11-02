// @ts-check
import { readFile } from 'node:fs/promises';
import { createObsClient, validateObsUrl } from './obs.mjs';

/** @typedef {{id:string,transport:'local'|'ssh',sshTarget?:string,repoRoot?:string,nodeExecutable?:string,remoteEnvFile?:string,obsUrl:string,obsPasswordEnv:string,scene?:string,platform?:'win32'|'linux'|'darwin'}} BroadcastHost */
/** @param {string} code */
function configError(code) { return new Error(code); }
/** @param {unknown} value @param {boolean} [empty] @returns {value is string} */
function safeString(value, empty = false) { return typeof value === 'string' && (empty || value.length > 0) && value.length <= 4096 && !/[\u0000-\u001f\u007f]/u.test(value); }
/** @param {unknown} value @returns {BroadcastHost} */
export function validateHostConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw configError('host_invalid_config');
  const host = /** @type {Record<string,any>} */ (value);
  const allowed = new Set(['id', 'transport', 'sshTarget', 'repoRoot', 'nodeExecutable', 'remoteEnvFile', 'obsUrl', 'obsPasswordEnv', 'scene', 'platform']);
  if (Object.keys(host).some(key => !allowed.has(key)) || !safeString(host.id) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(host.id) || !['local', 'ssh'].includes(host.transport)) throw configError('host_invalid_config');
  if (!safeString(host.obsUrl, true) || !safeString(host.obsPasswordEnv, true) || (host.obsPasswordEnv && !/^[A-Z_][A-Z0-9_]{0,127}$/.test(host.obsPasswordEnv))) throw configError('host_invalid_config');
  if (host.obsUrl) validateObsUrl(host.obsUrl);
  if (host.platform !== undefined && !['win32', 'linux', 'darwin'].includes(host.platform)) throw configError('host_invalid_platform');
  for (const key of ['sshTarget', 'repoRoot', 'scene']) if (host[key] !== undefined && !safeString(host[key], true)) throw configError('host_invalid_config');
  if (host.nodeExecutable !== undefined && (!safeString(host.nodeExecutable) || (host.nodeExecutable !== 'node' && !host.nodeExecutable.startsWith('/')))) throw configError('host_invalid_node_executable');
  if (host.remoteEnvFile !== undefined) remotePath(host.remoteEnvFile);
  if (host.sshTarget && !/^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(host.sshTarget)) throw configError('host_invalid_ssh_target');
  if (host.transport === 'local' && host.sshTarget) throw configError('host_invalid_config');
  return /** @type {BroadcastHost} */ ({ ...host });
}

/** Public configuration only. Secrets and unknown fields are rejected.
 * @param {string} path @param {string} hostId */
export async function loadHostConfig(path, hostId) {
  const stat = await import('node:fs/promises').then(fs => fs.stat(path));
  if (!stat.isFile() || stat.size > 64 * 1024) throw configError('host_invalid_config');
  let config;
  try { config = JSON.parse(await readFile(path, 'utf8')); } catch { throw configError('host_invalid_config'); }
  if (!config || config.version !== 1 || Object.keys(config).some(key => !['version', 'hosts'].includes(key)) || !Array.isArray(config.hosts) || config.hosts.length > 64) throw configError('host_invalid_config');
  /** @type {BroadcastHost[]} */
  const hosts = config.hosts.map(validateHostConfig);
  if (new Set(hosts.map(host => host.id)).size !== hosts.length) throw configError('host_duplicate_id');
  const host = hosts.find(host => host.id === hostId);
  if (!host) throw configError('host_not_found');
  return host;
}

/** @param {string} value */
export function quotePosix(value) {
  if (!safeString(value)) throw configError('host_invalid_path');
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Never interpret a local Windows path or a path as an option on a POSIX host.
 * @param {unknown} value @param {boolean} [relativeOnly] @returns {string} */
function remotePath(value, relativeOnly = false) {
  if (!safeString(value) || value.includes('\\') || /^[A-Za-z]:/.test(value) || value.startsWith('-') || value.startsWith('~')
    || (relativeOnly && value.startsWith('/')) || value.split('/').some((part,index) => part === '..' || (!part && index > 0))) throw configError('host_invalid_remote_path');
  return value;
}

/** Fixed foreground runner command. The only shell text is quoted paths/identifiers from
 * public configuration. No local environment values or credentials enter these arguments.
 * @param {BroadcastHost} value
 * @param {{configPath:string,statePath:string,workerId:string,once?:boolean,live?:boolean}} options */
export function buildSshRunnerArgs(value, { configPath, statePath, workerId, once = false, live = false }) {
  const host = validateHostConfig(value);
  if (host.transport !== 'ssh' || !host.sshTarget || !host.repoRoot?.startsWith('/') || !host.nodeExecutable) throw configError('host_ssh_unconfigured');
  if (!['linux','darwin'].includes(host.platform ?? '')) throw configError('host_ssh_platform_unsupported');
  remotePath(host.repoRoot); remotePath(configPath,true); remotePath(statePath);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(workerId)) throw configError('host_invalid_worker_id');
  const envFile = host.remoteEnvFile ? ` ${quotePosix(`--env-file=${host.remoteEnvFile}`)}` : '';
  const command = `cd ${quotePosix(host.repoRoot)} && exec ${quotePosix(host.nodeExecutable)}${envFile} scripts/broadcast-runner.mjs --remote-self --host ${quotePosix(host.id)} --config ${quotePosix(configPath)} --state ${quotePosix(statePath)} --worker-id ${quotePosix(workerId)}${once ? ' --once' : ''}${live ? ' --live' : ''}`;
  return ['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10',
    '-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2','-o','ForwardAgent=no','-o','ClearAllForwardings=yes',
    '-o','SendEnv=-*','--',host.sshTarget,command];
}

/** No shell locally. Remote SSH command is restricted to a fixed Node doctor.
 * Windows SSH shells are deliberately unsupported until verified.
 * @param {BroadcastHost} value @param {string} configPath */
export function buildSshDoctorArgs(value, configPath) {
  const host = validateHostConfig(value);
  if (host.transport !== 'ssh' || !host.sshTarget || !host.repoRoot || !host.repoRoot.startsWith('/')) throw configError('host_ssh_unconfigured');
  if (!['linux', 'darwin'].includes(host.platform ?? '')) throw configError('host_ssh_platform_unsupported');
  if (!safeString(configPath) || configPath.startsWith('/') || configPath.includes('\\') || configPath.split('/').some(part => part === '..' || !part)) throw configError('host_invalid_remote_config_path');
  // The doctor reads the same env file the runner does, or it reports OBS unconfigured on a host whose runner works.
  const envFile = host.remoteEnvFile ? ` ${quotePosix(`--env-file=${host.remoteEnvFile}`)}` : '';
  const command = `cd ${quotePosix(host.repoRoot)} && exec ${quotePosix(host.nodeExecutable ?? 'node')}${envFile} scripts/broadcast-host.mjs --remote-self --doctor --host ${quotePosix(host.id)} --config ${quotePosix(configPath)}`;
  return ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'SendEnv=-*', '--', host.sshTarget, command];
}

/** This runs ON the selected host. Read-only checks do not establish render,
 * Twitch ingest, stream-key, scene, or continuous-broadcast readiness.
 * @param {BroadcastHost} value
 * @param {{env?:Record<string,string|undefined>,platform?:string,nodeVersion?:string,obsFactory?:typeof createObsClient}} [options] */
export async function doctorHost(value, { env = process.env, platform = process.platform, nodeVersion = process.versions.node, obsFactory = createObsClient } = {}) {
  const host = validateHostConfig(value);
  const base = { hostId: host.id, platform, nodeVersion, check: 'obs-read-only', broadcastVerified: false };
  if (!/^\d+\.\d+\.\d+$/.test(nodeVersion) || Number(nodeVersion.split('.')[0]) < 22) return { ...base, status: 'unconfigured', reason: 'node_22_required' };
  if (host.platform && host.platform !== platform) return { ...base, status: 'unconfigured', reason: 'platform_mismatch' };
  if (!host.obsUrl || !host.obsPasswordEnv || !env[host.obsPasswordEnv]) return { ...base, status: 'unconfigured', reason: 'obs_configuration_required' };
  /** @type {import('./obs.mjs').ObsClient|undefined} */
  let obs;
  try {
    obs = await obsFactory({ url: host.obsUrl, password: env[host.obsPasswordEnv] });
    const version = await obs.request('GetVersion');
    const stream = await obs.request('GetStreamStatus');
    if (typeof version.obsVersion !== 'string' || !/^\d+\./.test(version.obsVersion) || typeof version.obsWebSocketVersion !== 'string' || !/^5\./.test(version.obsWebSocketVersion) || typeof stream.outputActive !== 'boolean' || typeof stream.outputReconnecting !== 'boolean') throw new Error();
    return { ...base, status: 'ready', obs: { version: version.obsVersion, websocketVersion: version.obsWebSocketVersion, outputActive: stream.outputActive, outputReconnecting: stream.outputReconnecting } };
  } catch { return { ...base, status: 'unreachable', reason: 'obs_check_failed' }; }
  finally { obs?.close(); }
}
