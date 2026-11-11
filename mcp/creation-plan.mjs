// @ts-check
// A read-only list of what a session still has open. It does not prepare a job or call a provider.
import { fail } from './creation-store.mjs';

/**
 * @param {import('./creation-store.mjs').CreationStore} store
 * @param {import('./creation-jobs.mjs').JobStore} jobs
 * @param {string} sessionId
 */
export async function planCreation(store, jobs, sessionId) {
  const inspected = await store.inspect(sessionId);
  const state = inspected.state;
  const group = state.context.workflow.groups.find(item => item.id === state.groupId);
  if (!group) fail('unknown-group');
  const ids = [...group.motions, ...(group.auxiliaries ?? [])];
  /** @type {{ item: string, version: string }[]} */
  const kept = [];
  /** @type {{ item: string, reason: string }[]} */
  const open = [];
  for (const item of ids) {
    const row = state.items[item];
    if (row?.selectedVersion) kept.push({ item, version: row.selectedVersion });
    else open.push({ item, reason: row ? 'unselected' : 'not-started' });
  }
  const reuse = Object.entries(state.reuse ?? {}).map(([item, row]) => ({
    item,
    files: row.files.map(file => file.path),
    note: row.note,
  }));
  const listed = await jobs.list(sessionId);
  const jobsKnown = listed.map(job => ('unreadable' in job ? { jobId: job.jobId, status: 'unreadable' } : { jobId: job.jobId, status: job.status }));
  return {
    schema: 'oddbout.plan/1',
    ok: true,
    startedGeneration: false,
    executed: [],
    sessionId,
    groupId: state.groupId,
    kept,
    open,
    reuse,
    blockers: inspected.decision.blockers,
    jobs: jobsKnown,
    steps: [
      ...open.map(row => `Decide ${row.item} (${row.reason}) with the user before any new generation.`),
      ...reuse.map(row => `Keep the recorded files for ${row.item} unless the user asks to generate that item again.`),
    ],
    cost: { known: false, reason: 'This workspace has no priced generation total to report.' },
    next: 'This is a preview. Generation has not started.',
    say: `Group ${state.groupId}: ${open.length} open, ${kept.length} kept. No generation was started.`,
  };
}
