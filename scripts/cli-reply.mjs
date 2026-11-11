// @ts-check
// Fields an agent can follow without a stack trace. Existing fields stay.

/**
 * @template {Record<string, any>} T
 * @param {T} result
 * @param {{ dummyOrigin?: string }} [scope]
 * @returns {T & { say: string, next: string | null }}
 */
export function agentReply(result, { dummyOrigin } = {}) {
  const code = typeof result.code === 'string' ? result.code : undefined;
  let next = typeof result.next === 'string' ? result.next : typeof result.hint === 'string' ? result.hint : null;
  if (dummyOrigin && next && !next.includes(dummyOrigin)) next = `${next} Keep --dummy ${dummyOrigin}.`;
  if (dummyOrigin && !next) next = `Use only --dummy ${dummyOrigin}. Do not contact a live ODDBOUT host.`;
  const say =
    typeof result.say === 'string'
      ? result.say
      : result.ok
        ? 'Command finished. Read ok and the returned fields before reporting the outcome.'
        : `Command failed${code ? ` (${code})` : ''}.`;
  return /** @type {T & { say: string, next: string | null }} */ ({ ...result, say, next });
}
