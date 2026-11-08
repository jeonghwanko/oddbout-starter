// @ts-check
import { readFile } from 'node:fs/promises';
import { readRecord, safePath, sha256 } from './dots-safety.mjs';

// A source inspection can establish incompatibility, never establish a working image bridge.
// Future adapters need an audited, official output contract. No caller-supplied supportsImages flag.
/** @param {string} runtime @param {string} [provider] */
export async function inspectProvider(runtime, provider = 'codex') {
  if (!['codex', 'grok', 'none'].includes(provider)) throw Error('unsupported-provider-choice');
  if (provider === 'none') return { provider, status: 'not-selected', readyForGeneration: false };
  // Grok's own file/auth checks remain authoritative. Never inspect Codex to judge Grok.
  if (provider === 'grok')
    return {
      provider,
      status: 'unknown',
      reason: 'grok-generation-and-delivery-unverified',
      outputRoute: 'grok-provider-file',
      executionPolicy: 'existing-provider-checks',
      readyForGeneration: false,
    };
  const relative = `vendor/sprite-gen/sprite_gen/gen/${provider}_provider.py`;
  let source;
  try {
    source = await readFile(await safePath(relative, { root: runtime }), 'utf8');
  } catch {
    return { provider, status: 'unknown', reason: 'provider-source-unavailable', readyForGeneration: false };
  }
  const protectedAccess = provider === 'codex' && /_rollout_files|_resolve_rollout|_collect_inline_results|rollout-.*jsonl|["']sessions["']/.test(source);
  return {
    provider,
    sourceSha256: sha256(source),
    status: protectedAccess ? 'blocked' : 'unknown',
    reason: protectedAccess ? 'protected-session-output-contract' : 'official-host-file-bridge-unverified',
    readyForGeneration: false,
    nextAction: 'Use a verified official host output adapter; never inspect, relocate or delete protected sessions.',
  };
}
/** @param {string} runtime @param {string} workspace @param {NodeJS.ProcessEnv} [env] */
export async function isDotsWorkspace(runtime, workspace, env = process.env) {
  if (env.AI_FIGHTER_EXECUTION_HOST === 'dots') return true;
  for (const [root, file] of [
    [runtime, '.dots-runtime.json'],
    [workspace, 'output/creation-environment/environment.json'],
  ]) {
    try {
      if ((await readRecord(await safePath(file, { root }))).host === 'dots') return true;
    } catch (/** @type {any} */ e) {
      if (e.code !== 'ENOENT') throw Error('dots-host-record-invalid');
    }
  }
  return false;
}
const routed = new Set(['gen', 'gen-set', 'gen-motion', 'video', 'video-set', 'video-resume']);
const routeOptions = ['--provider', '--still-provider', '--walk-start', '--states', '--base', '--body-plan'];
/** @overload @param {string[]} args @param {string} key @param {{ repeat: true }} options @returns {string[]} */
/** @overload @param {string[]} args @param {string} key @returns {string | undefined} */
/** @param {string[]} args @param {string} key @param {{ repeat?: boolean }} [options] @returns {string[] | string | undefined} */
export function commandOption(args, key, { repeat = false } = {}) {
  const values = [];
  for (let i = 1; i < args.length; i++) {
    const token = args[i],
      name = token.split('=')[0];
    // Python argparse accepts abbreviated flags. Do not let an abbreviated override evade this guard.
    if (name.startsWith('--') && routeOptions.some(full => full !== name && full.startsWith(name))) throw Error('dots-use-complete-provider-route-options');
    if (name !== key) continue;
    const value = token.includes('=') ? token.slice(token.indexOf('=') + 1) : args[++i];
    if (!value || value.startsWith('-')) throw Error('dots-provider-route-option-value-required');
    values.push(value);
  }
  if (!repeat && values.length > 1) throw Error('duplicate-provider-option');
  return repeat ? values : values[0];
}
/** @param {string | undefined} value @param {NodeJS.ProcessEnv} env @param {string} [reason] */
function imageProvider(value, env, reason = 'dots-image-provider-required') {
  const selected = value ?? env.SPRITE_GEN_DEFAULT_PROVIDER?.trim();
  // No auth/default-choice lookup or fallback here. An ambiguous invocation must name its route.
  if (!selected) throw Error(reason);
  if (!['codex', 'grok'].includes(selected)) throw Error('dots-subscription-provider-required');
  return selected;
}
/**
 * @param {string[]} args @param {NodeJS.ProcessEnv} [env]
 * @returns {{ operation: string, provider: string | null, outputRoute?: string, imageProvider?: string }}
 */
export function commandRoute(args, env = process.env) {
  const command = args[0];
  if (!routed.has(command)) return { operation: 'other', provider: null };
  if (['gen', 'gen-set'].includes(command))
    return { operation: 'generate-image', provider: imageProvider(commandOption(args, '--provider'), env), outputRoute: 'provider-file' };
  if (command === 'gen-motion') return { operation: 'codex-motion', provider: 'codex', outputRoute: 'codex-image-file' };
  // These verbs have no selectable image provider. video-resume is GET/poll/download, not a new POST.
  if (command !== 'video-set')
    return { operation: command === 'video-resume' ? 'recover-video' : 'generate-video', provider: 'grok', outputRoute: 'grok-video-file' };
  const states = (commandOption(args, '--states') ?? 'idle,walk,run,jump,attack').split(',').map(s => s.trim());
  const bases = commandOption(args, '--base', { repeat: true });
  const body = commandOption(args, '--body-plan', { repeat: true });
  const walkStart = commandOption(args, '--walk-start') ?? 'redraw';
  if (!['redraw', 'as-given'].includes(walkStart)) throw Error('dots-video-walk-start-invalid');
  const still = commandOption(args, '--still-provider');
  const redraw =
    walkStart === 'redraw' &&
    states.includes('walk') &&
    bases.some(b => b.includes('=') && ['front', 'back'].includes(b.slice(0, b.indexOf('=')).trim().split('@')[0])) &&
    !(body.length === 1 && body[0] === 'legless');
  // Side facing uses Grok vision. Only front/back walk redraws can call the image provider.
  return {
    operation: 'generate-video-set',
    provider: 'grok',
    outputRoute: 'grok-video-file',
    ...(redraw ? { imageProvider: imageProvider(still, env, 'dots-video-set-still-provider-required') } : {}),
  };
}
/** @param {string} runtime @param {string} workspace @param {string[]} args @param {NodeJS.ProcessEnv} [env] @param {{ inspect?: typeof inspectProvider }} [options] */
export async function guardDotsExecution(runtime, workspace, args, env = process.env, { inspect = inspectProvider } = {}) {
  if (!routed.has(args[0]) || !(await isDotsWorkspace(runtime, workspace, env))) return;
  const route = commandRoute(args, env);
  if ((route.provider === 'grok' || route.imageProvider === 'grok') && env.XAI_API_KEY?.trim()) throw Error('dots-subscription-api-key-environment-blocked');
  if (route.provider !== 'codex' && route.imageProvider !== 'codex') return route;
  const capability = await inspect(runtime, 'codex');
  throw Error(capability.status === 'blocked' ? 'dots-protected-session-provider-blocked' : 'dots-generation-output-contract-unverified');
}
