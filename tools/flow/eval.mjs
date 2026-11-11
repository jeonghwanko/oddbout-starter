// @ts-check
// Scored dummy-only checks. No production URL and no live ODDBOUT MCP.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import spec from '../../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { createJobStore } from '../../mcp/creation-jobs.mjs';
import { createCreationStore, localPath } from '../../mcp/creation-store.mjs';
import { decidePermission } from '../../mcp/tool-permissions.mjs';
import { createConnector } from './connector.mjs';
import { checkDocs, checkFixtures } from './prompts.mjs';
import { createDummyStore } from './store.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const KEY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

/** @typedef {{ id: string, kind: string, ok: boolean, detail: string }} EvalCheck */

/**
 * @param {EvalCheck[]} checks
 * @param {string} id
 * @param {string} kind
 * @param {boolean} ok
 * @param {string} detail
 */
function add(checks, id, kind, ok, detail) {
  checks.push({ id, kind, ok, detail });
}

/** @returns {Promise<{ schema: string, ok: boolean, passed: number, failed: number, checks: EvalCheck[] }>} */
export async function runFlowEval() {
  /** @type {EvalCheck[]} */
  const checks = [];
  const docs = await checkDocs(ROOT);
  add(checks, 'policy-phrases', 'policy', docs.ok, docs.problems.join('; ') || 'skill and AGENTS.md keep the locked phrases');
  const fixtures = checkFixtures();
  add(checks, 'prompt-recognition', 'prompt-recognition', fixtures.ok, fixtures.problems.join('; ') || 'fixed prompts match one scenario');

  const bypass = decidePermission('enter_fighter', { confirmed: true, yolo: true, confirmAll: true });
  add(checks, 'no-yolo', 'policy', bypass.allow === false && bypass.code === 'permission-forbidden' && bypass.bypassIgnored === true, bypass.code ?? 'allowed');
  const unconfirmed = decidePermission('prepare_fighter_registration', { yolo: true });
  add(checks, 'mutate-needs-confirmation', 'policy', unconfirmed.allow === false && unconfirmed.code === 'permission-required', unconfirmed.code ?? 'allowed');
  const read = decidePermission('get_profile', {});
  add(checks, 'read-auto', 'policy', read.allow === true && read.tier === 'read', read.tier);

  const store = createDummyStore();
  const raw = createConnector(store, { roots: [ROOT], packageRoot: ROOT });
  const refused = await raw.call('update_fighter', { kind: 'style', fighterId: KEY, style: null, idempotencyKey: KEY });
  add(
    checks,
    'dummy-mutate-blocked',
    'forbidden-tool',
    refused.ok === false && refused.code === 'permission-required' && refused.executed === false,
    String(refused.code),
  );
  const entered = await raw.call('enter_fighter', {
    fighterId: KEY,
    expectedManifestSha256: 'a'.repeat(64),
    reviewedClips: ['idle'],
    confirmed: true,
    yolo: true,
  });
  const deleted = await raw.call('delete_fighter', { fighterId: KEY, confirmed: true, yolo: true });
  add(
    checks,
    'dummy-forbidden-tools',
    'forbidden-tool',
    entered.code === 'permission-forbidden' && entered.executed === false && deleted.code === 'permission-forbidden' && deleted.executed === false,
    `${entered.code}, ${deleted.code}`,
  );

  const hostedKey = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const created = await raw.call('request_hosted_fighter', {
    description: '흰 고양이 복서',
    language: 'ko',
    idempotencyKey: hostedKey,
    confirmed: true,
  });
  const observed = await raw.call('get_hosted_fighter', { jobId: created.job?.id, observe: true });
  const replay = await raw.call('request_hosted_fighter', {
    description: '흰 고양이 복서',
    language: 'ko',
    idempotencyKey: hostedKey,
    confirmed: true,
  });
  add(
    checks,
    'observe-does-not-execute',
    'checkpoint',
    created.ok === true &&
      observed.executed === false &&
      observed.job?.drafts?.length === created.job?.drafts?.length &&
      observed.checkpoint?.idempotencyKey === hostedKey,
    `executed ${observed.executed}, drafts ${observed.job?.drafts?.length}`,
  );
  add(
    checks,
    'idempotency-reused',
    'idempotency',
    replay.ok === true && replay.job?.id === created.job?.id && replay.idempotencyKeyReused === true && replay.executed === false,
    `same job ${replay.job?.id === created.job?.id}, reused ${replay.idempotencyKeyReused}`,
  );
  add(
    checks,
    'dummy-labels',
    'labels',
    created.mode === 'dummy' && created.production === false && typeof created.label === 'string' && created.label.includes('ODDBOUT-DUMMY'),
    String(created.mode),
  );

  const root = await mkdtemp(path.join(tmpdir(), 'oddbout-flow-eval-'));
  try {
    const context = {
      owner: 'game',
      contextVersion: 1,
      specVersion: spec.specVersion,
      revision: 'a'.repeat(64),
      contract: { motions: spec.motions },
      controls: { actions: [] },
      timing: { clocks: {} },
      workflow: {
        gates: {},
        groups: [
          { id: 'appearance', motions: ['idle'] },
          { id: 'locomotion', motions: ['fightIdle', 'walk', 'run'] },
          { id: 'attacks', motions: ['combo', 'slam', 'dash'] },
          { id: 'defense', motions: ['block', 'hit', 'groggy', 'fall'], auxiliaries: ['getUp'] },
          { id: 'final', motions: [] },
        ],
      },
    };
    const sessions = createCreationStore(root, { contextRequest: async () => new Response(JSON.stringify(context)) });
    const jobs = createJobStore(sessions);
    await sessions.create({ sessionId: 'eval-fighter', brief: 'Eval fixture only', mode: 'creation' });
    const file = await localPath(root, 'input/idle.txt', { createParents: true });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, 'eval');
    const jobId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
    await jobs.prepare('eval-fighter', 1, jobId, {
      engine: 'sprite',
      args: ['gen', '--provider', 'codex', '--prompt', 'fixture'],
      workflowArgs: ['workflow', '--kind', 'image', '--image-provider', 'codex', '--confirmed-access', 'codex'],
      groupId: 'appearance',
      targets: [{ item: 'idle', version: 'v1' }],
      inputs: [],
      outputs: ['output/eval-fighter-work/artifacts/idle/v1/image.png'],
      registrationKey: hostedKey,
    });
    const first = await jobs.resume('eval-fighter', jobId);
    const second = await jobs.resume('eval-fighter', jobId);
    const after = await jobs.inspect('eval-fighter', jobId);
    add(
      checks,
      'checkpoint-resume',
      'checkpoint',
      first.executed === false &&
        second.executed === false &&
        first.idempotencyKey === hostedKey &&
        second.idempotencyKey === hostedKey &&
        first.idempotencyKeyReused === true &&
        after.status === 'prepared' &&
        after.executedByThisCall === false,
      `status ${after.status}, key reused ${second.idempotencyKeyReused}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const failed = checks.filter(check => !check.ok).length;
  return { schema: 'oddbout.flow-eval/1', ok: failed === 0, passed: checks.length - failed, failed, checks };
}
