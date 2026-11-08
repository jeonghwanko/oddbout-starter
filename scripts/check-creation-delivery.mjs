// @ts-check
// Offline evidence-record check only: no generation, upload, tool discovery or retry.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** @param {unknown} value */
const text = value => typeof value === 'string' && value.trim().length > 0;
const limitation =
  'Checks record consistency only; does not authenticate evidence references or verify live generation, model support, account identity, display, pixels or user feedback.';
const scope = { evidenceScope: 'record-only', limitation };

/** @param {any} record read from disk: checked here @param {{ phase: string, conversationId: string }} options */
export function checkCreationDelivery(record, { phase, conversationId }) {
  if (!['preflight', 'review'].includes(phase) || !text(conversationId)) throw Error('Phase and current conversation ID are required');
  const blockers = [];
  if (record?.version !== 1 || !text(record?.environment)) blockers.push('invalid-record');
  if (record?.conversationId !== conversationId) blockers.push('record-other-conversation');
  if (phase === 'preflight') {
    // A capability listed in the model context is not proof that the chosen helper can use it.
    for (const key of ['generation', 'delivery']) {
      const check = record?.[key];
      if (check?.status !== 'ready') blockers.push(`${key}:${check?.status ?? 'unknown'}`);
      if (!text(check?.route) || !text(check?.evidence)) blockers.push(`${key}:missing-evidence`);
    }
    if (record?.delivery?.conversationId !== conversationId) blockers.push('delivery-other-conversation');
    if (record?.delivery?.fullBody !== true || record?.delivery?.faceCrop !== true) blockers.push('appearance-delivery-incomplete');
    const previous = record?.previousGeneration;
    if (!['none', 'not-started', 'completed', 'failed', 'pending', 'unknown'].includes(previous?.status) || !text(previous?.evidence))
      blockers.push('previous-generation-unchecked');
    if (['pending', 'unknown'].includes(previous?.status)) blockers.push('inspect-existing-generation');
    if (['completed', 'failed'].includes(previous?.status) && !text(record?.newGenerationRequest)) blockers.push('recover-existing-before-generation');
    return { check: 'offline-delivery-preflight', ready: blockers.length === 0, blockers, ...scope };
  }
  const result = record?.result;
  if (result?.generation !== 'completed' || !text(result?.version)) blockers.push('generation-incomplete');
  // Requested CLI models, login records and tool listings are not completed image calls.
  // These are references for human/agent inspection, not a live capability certificate.
  const evidence = result?.generationEvidence;
  if (evidence?.status !== 'completed' || !['tool', 'invocationRef', 'completionRef', 'outputRef'].every(key => text(evidence?.[key])))
    blockers.push('generation:missing-call-evidence');
  if (!text(evidence?.environment) || evidence.environment !== record?.environment || !text(evidence?.version) || evidence.version !== result?.version)
    blockers.push('generation:evidence-scope-mismatch');
  for (const key of ['fullBody', 'faceCrop']) {
    const preview = result?.previews?.[key];
    if (preview?.status !== 'displayed' || preview?.conversationId !== conversationId || preview?.version !== result?.version || !text(preview?.evidence))
      blockers.push(`preview-not-displayed:${key}`);
  }
  const canRequestFeedback = blockers.length === 0;
  if (result?.review !== 'passed') blockers.push('appearance-unchecked');
  if (!text(result?.version) || result?.selection?.version !== result.version || !text(result?.selection?.feedback)) blockers.push('appearance-unselected');
  return { check: 'offline-delivery-review', canRequestFeedback, canAdvanceAppearance: blockers.length === 0, blockers, ...scope };
}

/** @param {string[]} args */
export async function main(args) {
  if (args.length !== 3) throw Error('Usage: npm run creation:delivery -- <preflight|review> <record.json> <current-conversation-id>');
  const [phase, file, conversationId] = args;
  const result = checkCreationDelivery(JSON.parse(await readFile(file, 'utf8')), { phase, conversationId });
  console.log(JSON.stringify(result, null, 2));
  return (
    phase === 'preflight' ? /** @type {{ ready: boolean }} */ (result).ready : /** @type {{ canAdvanceAppearance: boolean }} */ (result).canAdvanceAppearance
  )
    ? 0
    : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (/** @type {any} */ error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
