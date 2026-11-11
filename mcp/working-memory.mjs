// @ts-check
// A short resume summary beside a creation session. The session JSON remains the record.

const SECRET = /(?:https?:\/\/\S+|bearer\s+\S+|token=\S+|eyJ[A-Za-z0-9_-]{8,})/gi;

/**
 * The fields the summary reads. The session record is wider; this file does not import it.
 * @typedef {{ sessionId: string, mode: string, brief: string, revision?: number, updatedAt?: string, groupId?: string,
 *   delegatedGroups?: string[], pendingEdits?: string[],
 *   items?: Record<string, { selectedVersion?: string | null, version?: string }>,
 *   memory?: { route?: string | null, accountId?: string | null, accountEmail?: string | null, hostedJobId?: string | null, next?: string },
 *   reuse?: Record<string, { files: { path: string }[], note: string }> }} SummaryState
 */

/** @param {string} text */
export function containsSecret(text) {
  SECRET.lastIndex = 0;
  return SECRET.test(text);
}

/** @param {string} text */
export function redactSecrets(text) {
  return text.replace(SECRET, '[omitted]');
}

/** @param {SummaryState} state */
export function briefDocument(state) {
  const memory = state.memory;
  const lines = [
    '# Brief',
    '',
    'Summary of the creation session. get_creation_session is the record. Do not treat this file as approval, registration, or a generation result.',
    '',
    `- Session: ${state.sessionId}`,
    `- Mode: ${state.mode}`,
    `- Goal: ${redactSecrets(state.brief)}`,
    `- Route: ${memory?.route ?? 'not recorded'}`,
    `- Delegated groups: ${state.delegatedGroups?.length ? state.delegatedGroups.join(', ') : 'none'}`,
    `- Account id: ${memory?.accountId ?? 'not recorded'}`,
    `- Account email: ${memory?.accountEmail ?? 'not recorded'}`,
    `- Hosted job: ${memory?.hostedJobId ?? 'none'}`,
    '',
    memory?.hostedJobId ? 'Read that hosted job with get_hosted_fighter. This file is not the job.' : 'No hosted job id is recorded on the session.',
    '',
  ];
  return lines.join('\n');
}

/** @param {SummaryState} state */
export function progressDocument(state) {
  const selected = Object.entries(state.items ?? {}).map(
    ([item, row]) => `- ${item}: selected ${row.selectedVersion ?? 'none'}, current ${row.version ?? 'none'}`,
  );
  const reuse = Object.entries(state.reuse ?? {}).map(([item, row]) => `- ${item}: ${row.files.map(file => file.path).join(', ')} (${row.note})`);
  const lines = [
    '# Progress',
    '',
    'Summary only. Versions, blockers and job outcomes come from get_creation_session and get_creation_job. A hosted job comes from get_hosted_fighter.',
    '',
    `- Revision: ${state.revision}`,
    `- Updated: ${state.updatedAt ?? 'unknown'}`,
    `- Group: ${state.groupId}`,
    `- Pending edits: ${state.pendingEdits?.length ? state.pendingEdits.join(', ') : 'none'}`,
    `- Next note: ${state.memory?.next ? redactSecrets(state.memory.next) : 'none'}`,
    '',
    '## Selected versions',
    '',
    ...(selected.length ? selected : ['- none']),
    '',
    '## Reuse',
    '',
    ...(reuse.length ? reuse : ['- none']),
    '',
    'Reuse lists files the user asked to keep. It does not generate, and it does not replace a selected version.',
    'Checkpoints are files beside the job record. Reading one does not run the job.',
    '',
  ];
  return lines.join('\n');
}
