// @ts-check
// The prepared VM's single entry point: retain the chosen runtime and resume before any new work.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bootstrap, doctor, defaultRuntime, resume } from './dots-workspace.mjs';
import { readRecord, safePath } from './dots-safety.mjs';

/**
 * What start and nextAction read of a doctor or bootstrap report.
 * @typedef {{ status?: string, reason?: string, diagnostic?: { actor: string, reason: string, host: string }, blockers?: string[],
 *   recovery?: { blockers: string[], sessions: { sessionId: string }[] }, auth?: { status: string, reason?: string, storage?: { status: string, reason: string } },
 *   kit?: { version?: string, commit?: string, manifestSha256?: string } }} StartReport
 * @typedef {import('./dots-workspace.mjs').DotsOptions} DotsOptions
 * @typedef {{ workspace: string, runtime?: string, manifestSha256?: string, install?: boolean }} StartOptions
 */
const unobserved = new Set(['grok-generation-and-delivery-unverified']);
/** @param {StartReport} report */
export function nextAction(report) {
  if (report.status === 'blocked' && report.reason)
    return {
      actor: report.diagnostic?.actor ?? 'agent',
      action: 'repair-installation',
      reason: report.diagnostic?.reason ?? report.reason,
      ...(report.diagnostic?.host ? { host: report.diagnostic.host } : {}),
      dispatch: false,
    };
  const recovery = report.recovery;
  if (recovery?.blockers.length) return { actor: 'agent', action: 'recover-original-job', reason: recovery.blockers[0], dispatch: false };
  const installation = report.blockers?.filter(code => !unobserved.has(code)) ?? [];
  if (installation.length)
    return {
      actor: /ffmpeg|ffprobe|node-|python3|not-writable/.test(installation[0]) ? 'environment-preparer' : 'agent',
      action: 'repair-installation',
      reason: installation[0],
      dispatch: false,
    };
  if (report.auth?.reason === 'xai-api-key-environment')
    return { actor: 'environment-preparer', action: 'remove-api-key-from-vm-environment', reason: 'grok-subscription-only', dispatch: false };
  if (report.auth?.storage && report.auth.storage.status !== 'permission-available')
    return { actor: 'environment-preparer', action: 'prepare-private-grok-auth-storage', reason: report.auth.storage.reason, dispatch: false };
  if (report.auth?.status !== 'signed-in')
    return {
      actor: report.auth?.status === 'api-billing-blocked' ? 'user' : 'agent-and-user',
      action: 'connect-grok-subscription',
      reason: report.auth?.status ?? 'unknown',
      command: ['grok', 'login', '--device-auth'],
      dispatch: false,
    };
  if (recovery?.sessions.length)
    return {
      actor: 'agent',
      action: 'resume-creation-session',
      sessionId: recovery.sessions[0].sessionId,
      reason: 'read-current-version-and-review-group',
      dispatch: false,
    };
  return {
    actor: 'agent',
    action: 'prepare-requested-appearance',
    reason: 'verify-current-image-video-access-and-conversation-delivery-before-dispatch',
    dispatch: false,
  };
}
/**
 * @param {StartOptions} options
 * @param {{ inspect?: (options: DotsOptions) => Promise<StartReport>, install?: (options: DotsOptions) => Promise<StartReport>, recover?: typeof resume }} [deps]
 */
export async function start(options, { inspect = doctor, install = bootstrap, recover = resume } = {}) {
  const workspace = await safePath(options.workspace),
    runtime = await safePath(options.runtime ?? defaultRuntime);
  const recovery = await recover({ workspace });
  const bindingPath = await safePath('output/dots-workspace.json', { root: workspace });
  let binding;
  try {
    binding = await readRecord(bindingPath);
  } catch (/** @type {any} */ e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (binding && (binding.runtime !== runtime || binding.provider !== 'grok')) throw Error('workspace-runtime-or-provider-conflict');
  const params = {
    runtime,
    workspace,
    provider: 'grok',
    checkCli: true,
    checkAuth: true,
    ...(options.manifestSha256 ? { manifestSha256: options.manifestSha256 } : {}),
  };
  // A restart does not install over existing work. The same package is inspected and recovered.
  const report =
    options.install && !recovery.sessions.length && !recovery.blockers.length ? await install({ ...params, install: true }) : await inspect(params);
  if (!binding && report.kit?.version && !report.blockers?.some(c => /source-|bundle-|pin-|package-|runtime-contract/.test(c))) {
    binding = {
      schemaVersion: 1,
      runtime,
      provider: 'grok',
      version: report.kit.version,
      commit: report.kit.commit ?? null,
      manifestSha256: report.kit.manifestSha256 ?? null,
      createdAt: new Date().toISOString(),
    };
    await mkdir(path.dirname(bindingPath), { recursive: true, mode: 0o700 });
    await writeFile(bindingPath, JSON.stringify(binding, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  return {
    schemaVersion: 1,
    scope: 'dots-saved-vm-grok',
    binding,
    checks: report,
    nextAction: nextAction(report),
    automaticGeneration: false,
    e2eVerified: false,
  };
}
/** @param {string[]} argv */
export async function main(argv) {
  const options = /** @type {StartOptions & Record<string, string | boolean>} */ ({});
  for (let i = 0; i < argv.length; i++) {
    const key = /** @type {Record<string, string>} */ ({
      '--workspace': 'workspace',
      '--runtime': 'runtime',
      '--manifest-sha256': 'manifestSha256',
      '--install': 'install',
    })[argv[i]];
    if (!key || options[key] !== undefined) throw Error('invalid-arguments');
    options[key] = key === 'install' ? true : argv[++i];
    if (!options[key]) throw Error('invalid-arguments');
  }
  if (!options.workspace) throw Error('workspace-required');
  const result = await start(options);
  console.log(JSON.stringify(result, null, 2));
  return result.nextAction.action === 'repair-installation' ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (/** @type {any} */ e) {
    console.error(JSON.stringify({ ok: false, code: /^[a-z][a-z-]+$/.test(e.message) ? e.message : 'dots-start-failed' }));
    process.exitCode = 1;
  }
}
