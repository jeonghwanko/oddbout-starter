// @ts-check
import { runtimeFetch } from '../api/runtime-fetch.mjs';
import source from '../deploy/creation-context-source.json' with { type: 'json' };
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };

/**
 * The game's context as validateCreationContext checks it; its other fields pass through unread.
 * @typedef {{ id: string, motions: string[], auxiliaries?: string[], optional?: boolean }} WorkflowGroup
 * @typedef {{ contextVersion: 1, owner: 'game', specVersion: string, revision: string,
 *   contract: { motions: Record<string, object>, optionalMotions?: Record<string, object> },
 *   workflow: { groups: WorkflowGroup[], gates: object, currentGroup?: WorkflowGroup }, controls: { actions: object }, timing: { clocks: object } }} CreationContext
 */
/**
 * A session's effective view, or a state the agent supplies: checked here, never trusted.
 * @typedef {{ version?: string, selectedVersion?: string | null, review?: string }} ProgressItem
 * @typedef {{ mode: string, contextRevision?: string, groupId?: string, items?: Record<string, ProgressItem>, delegatedGroups?: string[],
 *   pendingEdits?: string[], profile?: { selected?: boolean }, packageReview?: string }} ProgressState
 */

const groups = ['appearance', 'locomotion', 'attacks', 'defense', 'final'];
/** An optional group (`optional: true`, 2026-10-27: style — skill, entrance, victory) may be skipped as a whole and never blocks.
 * @type {(group: WorkflowGroup) => boolean} */
export const isOptionalGroup = group => group?.optional === true;
/** @param {any} data unchecked JSON: this checks it @returns {CreationContext} */
export function validateCreationContext(data) {
  if (data?.contextVersion !== 1 || data.owner !== 'game' || data.specVersion !== spec.specVersion ||
      !/^[a-f0-9]{64}$/.test(data.revision ?? '')) throw new Error('creation-context-incompatible');
  // The required groups keep their order; optional groups may sit between them, never after final.
  /** @type {WorkflowGroup[]} */
  const sequence = Array.isArray(data.workflow?.groups) ? data.workflow.groups : [];
  if (sequence.filter(g => !isOptionalGroup(g)).map(g => g.id).join(',') !== groups.join(',') || sequence.at(-1)?.id !== 'final' ||
      new Set(sequence.map(g => g.id)).size !== sequence.length) throw new Error('creation-context-groups');
  const motions = sequence.filter(g => !isOptionalGroup(g)).flatMap(g => g.motions);
  const required = Object.keys(data.contract?.motions ?? {});
  if (new Set(motions).size !== motions.length || [...motions].sort().join(',') !== required.sort().join(',') ||
      required.sort().join(',') !== Object.keys(spec.motions).sort().join(',')) throw new Error('creation-context-motions');
  // Optional groups hold only the contract's optional clips, each once.
  const extras = sequence.filter(isOptionalGroup).flatMap(g => g.motions), offered = data.contract.optionalMotions ?? {};
  if (new Set(extras).size !== extras.length || extras.some(id => !Object.hasOwn(offered, id) || !Object.hasOwn(spec.optionalClips, id)))
    throw new Error('creation-context-motions');
  if (!data.controls?.actions || !data.timing?.clocks || !data.workflow.gates) throw new Error('creation-context-incomplete');
  return data;
}

/** @param {{ request?: typeof fetch, group?: string }} [options] */
export async function fetchCreationContext({ request = runtimeFetch, group } = {}) {
  const response = await request(source.url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('creation-context-unavailable');
  const reader = /** @type {ReadableStream<Uint8Array>} */ (response.body).getReader(); let size = 0; const chunks = [];
  try { while (true) { const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > 128 * 1024) { await reader.cancel(); throw new Error('creation-context-too-large'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const data = validateCreationContext(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (!group) return data;
  const current = data.workflow.groups.find(item => item.id === group);
  if (!current) throw new Error('creation-context-group');
  /** @type {(table: Record<string, object>) => Record<string, object>} */
  const scoped = table => Object.fromEntries(current.motions.filter(id => Object.hasOwn(table, id)).map(id => [id, table[id]]));
  return { ...data, contract: { ...data.contract, motions: scoped(data.contract.motions),
    ...(data.contract.optionalMotions ? { optionalMotions: scoped(data.contract.optionalMotions) } : {}) },
    workflow: { ...data.workflow, currentGroup: current } };
}

/**
 * Why one tracked item is not accepted yet: missing, unselected (unless its group was delegated), unchecked or pending an edit.
 * @param {ProgressState} state @param {WorkflowGroup} group @param {string} id
 */
export function itemBlockers(state, group, id) {
  const item = state.items?.[id];
  if (!item || typeof item.version !== 'string' || !item.version) return [`missing:${id}`];
  const blockers = [];
  if (item.selectedVersion !== item.version && !(state.delegatedGroups ?? []).includes(group.id)) blockers.push(`unselected:${id}`);
  /** @type {(string | undefined)[]} */
  const acceptedReview = state.mode === 'dialogue-only' ? ['hypothetical'] : ['passed'];
  if (!acceptedReview.includes(item.review)) blockers.push(`unchecked:${id}`);
  if ((state.pendingEdits ?? []).includes(id)) blockers.push(`pending-edit:${id}`);
  return blockers;
}

/**
 * Pure boundary check. Feedback interpretation is the agent's job; this never invents user acceptance.
 * An optional group never blocks: the items the user took are reported in optionalPending, and the package
 * check (creation-store) requires review of each one the package actually carries.
 * @param {CreationContext} context @param {ProgressState} state
 */
export function reviewCreationProgress(context, state) {
  validateCreationContext(context);
  const blockers = [], sequence = context.workflow.groups;
  if (!['creation', 'dialogue-only'].includes(state.mode)) blockers.push('invalid-mode');
  if (state.contextRevision !== context.revision) blockers.push('context-changed');
  const index = sequence.findIndex(group => group.id === state.groupId);
  if (index < 0) return { canAdvance: false, blockers: [...blockers, 'unknown-group'], nextGroup: null };
  const allowed = new Set(sequence.flatMap(g => [...g.motions, ...(g.auxiliaries ?? [])]));
  for (const id of Object.keys(state.items ?? {})) if (!allowed.has(id)) blockers.push(`unknown-item:${id}`);
  for (const id of state.delegatedGroups ?? []) if (!sequence.some(g => g.id === id)) blockers.push(`unknown-delegation:${id}`);
  for (const group of sequence.slice(0, index + 1).filter(group => !isOptionalGroup(group)))
    for (const id of [...group.motions, ...(group.auxiliaries ?? [])]) blockers.push(...itemBlockers(state, group, id));
  const optionalPending = sequence.filter(isOptionalGroup).flatMap(group => [...group.motions, ...(group.auxiliaries ?? [])]
    .filter(id => state.items?.[id]).flatMap(id => itemBlockers(state, group, id)));
  for (const id of state.pendingEdits ?? []) if (!allowed.has(id)) blockers.push(`unknown-edit:${id}`);
  if (state.groupId === 'final') {
    if (!state.profile?.selected) blockers.push('profile-unselected');
    if (state.mode === 'creation' && state.packageReview !== 'passed') blockers.push('package-unchecked');
  }
  return { canAdvance: blockers.length === 0, blockers, nextGroup: blockers.length ? null : sequence[index + 1]?.id ?? null,
    optionalPending, registrationAuthorized: false, mode: state.mode, contextRevision: context.revision };
}
