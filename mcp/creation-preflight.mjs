// @ts-check
// One read-only summary of the existing readiness checks. It does not install, fetch, elicit, generate or register.
import { checkReadiness } from './creation-readiness.mjs';

const PASS = new Set(['ready', 'updated', 'chosen-unverified', 'connector-verification-required', 'stopped']);
const FAIL = new Set(['blocked', 'action-required', 'choice-required', 'workspace-required']);

const NOT_DONE = {
  connection: ['generation-engine', 'generation-subscription', 'kit-fetch', 'kit-install', 'registration-submit', 'image-generation'],
  registration: ['generation-engine', 'generation-subscription', 'kit-fetch', 'kit-install', 'image-generation'],
  generation: ['registration-submit', 'image-generation', 'kit-fetch', 'kit-install'],
};

/**
 * @param {string} id
 * @param {any} item
 */
function checkFromItem(id, item) {
  const statusName = typeof item?.status === 'string' ? item.status : 'unknown';
  /** @type {'pass' | 'fail' | 'skip' | 'info'} */
  let status = 'info';
  if (statusName === 'not-required') status = 'skip';
  else if (FAIL.has(statusName)) status = 'fail';
  else if (PASS.has(statusName)) status = 'pass';
  /** @type {string[]} */
  const commands = [];
  if (Array.isArray(item?.nextCommands)) {
    for (const command of item.nextCommands) if (typeof command === 'string') commands.push(command);
  }
  return {
    id,
    status,
    code: typeof item?.reason === 'string' ? item.reason : statusName,
    ...(commands.length && status === 'fail' ? { nextCommands: commands } : {}),
  };
}

/**
 * @param {Awaited<ReturnType<typeof checkReadiness>>} readiness
 */
export function summarizeReadiness(readiness) {
  const checks = Object.entries(readiness.items ?? {}).map(([id, item]) => checkFromItem(id, item));
  const ok = checks.every(check => check.status !== 'fail');
  const nextCommands = [...new Set(checks.flatMap(check => check.nextCommands ?? []))];
  const purpose = readiness.purpose === 'registration' || readiness.purpose === 'generation' ? readiness.purpose : 'connection';
  const notDone = NOT_DONE[purpose];
  const failing = checks.find(check => check.status === 'fail');
  const next = failing
    ? (nextCommands[0] ?? `Resolve ${failing.id} (${failing.code}). Preflight did not run it.`)
    : 'No preflight failure. This did not generate, register, install or sign in.';
  return {
    schema: 'oddbout.preflight/1',
    ok,
    purpose,
    startedGeneration: false,
    executed: [],
    mutated: false,
    readyForGeneration: false,
    checks,
    notDone,
    nextCommands,
    next,
    say: ok
      ? `Preflight ${purpose} passed. Nothing was installed or generated.`
      : `Preflight ${purpose} failed on ${failing?.id ?? 'a check'}. Nothing was installed or generated.`,
  };
}

/**
 * Same inputs as checkReadiness, except remote fetch and account elicitation are forced off.
 * @param {Parameters<typeof checkReadiness>[0]} [options]
 */
export async function preflightCreation(options = {}) {
  const purpose = options.purpose ?? 'connection';
  const readiness = await checkReadiness({
    ...options,
    purpose,
    elicitInput: undefined,
    kit: { ...options.kit, fetchRemote: false },
  });
  return summarizeReadiness(readiness);
}
