// @ts-check
import { randomUUID } from 'node:crypto';
import { lstat, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { atomicJson, digest, fail, localPath, readJson, unchanged } from './creation-store.mjs';
import { reviewCreationProgress } from './creation-context.mjs';
import { guardDotsExecution } from '../scripts/dots-provider.mjs';
import { judgeOutcome, outcomeReportPath, readOutcome } from '../host/sprite-outcome.mjs';

const generating = new Set(['gen', 'gen-set', 'video', 'video-set']);
const recovering = new Set(['video-resume']);
const spriteCommands = new Set([...generating, ...recovering, 'gen-motion', 'workflow', 'prepare', 'extract', 'compose-atlas', 'compose-gif',
  'game-pack', 'video-canvas', 'video-prompt', 'video-frames', 'video-loop', 'video-cycle-align', 'inspect-motion']);
/** Whether a sprite command may send a provider request. gen-motion does only with `--frame` and without `--reconcile`
 * (its other actions — prepare, measure, register, export, reconcile — read and write local files). @param {string[]} argv */
export function spends(argv) {
  if (generating.has(argv[0]) || recovering.has(argv[0])) return true;
  return argv[0] === 'gen-motion' && argv.some(a => a === '--frame' || a.startsWith('--frame=')) && !argv.includes('--reconcile');
}
const args = z.array(z.string().max(16000).refine(s => !s.includes('\0'))).min(1).max(128);
export const jobPlanSchema = z.object({
  engine: z.enum(['sprite', 'fighter-pack']), args,
  groupId: z.enum(['appearance', 'locomotion', 'attacks', 'defense', 'style', 'final']),
  targets: z.array(z.object({ item: z.string().min(1).max(64), version: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/) }).strict()).min(1).max(12),
  inputs: z.array(z.string().min(1).max(512)).max(64),
  outputs: z.array(z.string().min(1).max(512)).min(1).max(64),
  workflowArgs: args.optional(),
  // How long the runner lets the engine work before stopping it (default DEFAULT_TIMEOUT_MINUTES).
  timeoutMinutes: z.number().int().min(1).max(720).optional(),
}).strict();
// Generous so a long video run finishes; a hung provider no longer leaves a job running forever.
export const DEFAULT_TIMEOUT_MINUTES = 240;
const STOP_POLL_MS = 2000;
const jobIdSchema = z.string().uuid();
const terminal = new Set(['succeeded', 'failed', 'needs-input', 'resolved', 'cancelled']);

/**
 * A job record. A running job carries runnerPid; a finished one its stage, exit and, for a failed paid run, the engine's outcome.
 * @typedef {import('./creation-store.mjs').CreationStore} CreationStore
 * @typedef {import('./creation-store.mjs').FileRecord} FileRecord
 * @typedef {z.infer<typeof jobPlanSchema>} JobPlan
 * @typedef {'prepared' | 'running' | 'succeeded' | 'failed' | 'needs-input' | 'unknown' | 'resolved' | 'cancelled'} JobStatus
 * @typedef {{ jobId: string, sessionId: string, requestHash: string, plan: JobPlan, inputs: FileRecord[], sessionRevision: number,
 *   createdAt: string, updatedAt?: string, status: JobStatus, attempt: number, runnerPid?: number, runToken?: string, startedAt?: string,
 *   finishedAt?: string, stage?: string, exitCode?: number | null, signal?: string | null, reason?: string, outputs?: FileRecord[],
 *   outcome?: ReturnType<typeof judgeOutcome>,
 *   resolution?: { outcome: 'recovered' | 'not-started' | 'duplicate-risk-accepted', note: string, evidence: FileRecord[], source: string, at: string } }} Job
 * @typedef {{ code: number | null, signal?: NodeJS.Signals | null, notStarted?: boolean, stopped?: string }} EngineResult
 */

/** @param {CreationStore} store */
export function createJobStore(store) {
  /** @type {(id: string, jobId: string) => Promise<string>} */
  const jobFile = (id, jobId) => { jobIdSchema.parse(jobId); return store.fileFor(id, `jobs/${jobId}.json`); };
  /** @param {string} id @param {string} jobId @returns {Promise<Job>} */
  async function read(id, jobId) { return readJson(await jobFile(id, jobId)); }
  /** @param {string} id @param {Job} job */
  async function write(id, job) { job.updatedAt = new Date().toISOString(); await atomicJson(await jobFile(id, job.jobId), job); return job; }
  /** @param {string} id */
  async function list(id) {
    await store.read(id);
    const dir = await store.fileFor(id, 'jobs');
    const names = await readdir(dir).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    const jobs = [];
    for (const name of names) if (name.endsWith('.json') && jobIdSchema.safeParse(name.slice(0, -5)).success)
      jobs.push(await read(id, name.slice(0, -5)));
    return jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  /** @param {JobPlan} plan */
  function validatePlan(plan) {
    if (plan.engine === 'sprite') {
      if (!spriteCommands.has(plan.args[0])) fail('unsupported-sprite-command');
      if (spends(plan.args)) {
        if (!plan.workflowArgs || plan.workflowArgs[0] !== 'workflow' || plan.workflowArgs.includes('--stage')) fail('generation-needs-workflow-preflight');
        /** @type {(argv: string[], key: string) => string | undefined} */
        const option = (argv, key) => {
          const matches = argv.flatMap((value, index) => value === key || value.startsWith(`${key}=`) ? [index] : []);
          if (matches.length > 1) fail('duplicate-provider-option');
          const index = matches[0];
          if (index === undefined) return undefined;
          return argv[index].includes('=') ? argv[index].slice(key.length + 1) : argv[index + 1];
        };
        const kind = option(plan.workflowArgs, '--kind');
        const provider = option(plan.args, '--provider');
        if (['gen', 'gen-set'].includes(plan.args[0]) && !provider) fail('explicit-provider-required');
        if (!/** @type {(string | undefined)[]} */ (['image', 'sprite']).includes(kind)) fail('workflow-kind-required');
        if (plan.args[0] === 'gen' && option(plan.args, '--provider') !== option(plan.workflowArgs, '--image-provider')) fail('provider-preflight-mismatch');
        if (plan.args[0] === 'gen-set') {
          const matched = provider === 'codex' ? kind === 'sprite' && option(plan.workflowArgs, '--motion-method') === 'gpt-rows'
            : provider === 'grok' && kind === 'image' && option(plan.workflowArgs, '--image-provider') === 'grok';
          if (!matched) fail('provider-preflight-mismatch');
        }
        if (['video', 'video-set', 'video-resume'].includes(plan.args[0]) &&
            (kind !== 'sprite' || option(plan.workflowArgs, '--motion-method') !== 'grok-video')) fail('provider-preflight-mismatch');
        // gen-motion runs codex only (it names no --provider): the preflight must have chosen the pose-plan method.
        if (plan.args[0] === 'gen-motion' && (kind !== 'sprite' || option(plan.workflowArgs, '--motion-method') !== 'pose-plan'))
          fail('provider-preflight-mismatch');
      }
    } else if (plan.args.length !== 1 || plan.args[0].startsWith('-') || plan.groupId !== 'final') fail('invalid-pack-plan');
    if (plan.workflowArgs && (plan.workflowArgs[0] !== 'workflow' || plan.engine !== 'sprite')) fail('invalid-workflow-preflight');
  }
  /** @param {import('./creation-store.mjs').Session} state @param {JobPlan} plan */
  async function gate(state, plan) {
    validatePlan(jobPlanSchema.parse(plan));
    if (plan.engine === 'sprite') await guardDotsExecution(fileURLToPath(new URL('../', import.meta.url)), store.root, plan.args);
    if (state.mode !== 'creation') fail('dialogue-only-no-execution');
    const context = await store.latestContext();
    if (context.revision !== state.contextRevision) fail('context-changed');
    if (state.groupId !== plan.groupId) fail('job-group-not-current');
    const index = context.workflow.groups.findIndex(g => g.id === plan.groupId), group = context.workflow.groups[index];
    // Final may rework any clip, including the optional ones the user took.
    const allowed = plan.groupId === 'final' ? [...Object.keys(context.contract.motions), ...Object.keys(context.contract.optionalMotions ?? {})]
      : [...group.motions, ...(group.auxiliaries ?? [])];
    if (plan.targets.some(t => !allowed.includes(t.item))) fail('job-target-outside-group');
    if (new Set(plan.targets.map(t => t.item)).size !== plan.targets.length) fail('duplicate-job-target');
    const { view } = await store.effective(state);
    if (index > 0 && !reviewCreationProgress(context, { ...view, groupId: context.workflow.groups[index - 1].id }).canAdvance)
      fail('previous-group-pending');
    if (plan.engine === 'fighter-pack') {
      const planPath = await localPath(store.root, plan.args[0]);
      const packPlan = await readJson(planPath);
      if (packPlan.reviewPolicy && !['files-only', 'required', 'engine-loop'].includes(packPlan.reviewPolicy)) fail('format-fixture-not-creation');
      const out = path.relative(store.root, path.resolve(path.dirname(planPath), packPlan.out)).split(path.sep).join('/');
      if (!out.startsWith(`${store.prefix(state.sessionId)}/artifacts/`)) fail('engine-output-outside-session');
      await localPath(store.root, out);
    } else {
      // Check every occurrence, including --flag=value, so a later override cannot escape the workspace.
      const outputFlags = new Set(['--out', '--out-dir', '--run-dir', '--out-root']);
      for (let i = 1; i < plan.args.length; i++) {
        const token = plan.args[i], key = token.split('=')[0];
        if (!outputFlags.has(key)) continue;
        const value = token.includes('=') ? token.slice(token.indexOf('=') + 1) : plan.args[++i];
        if (!value || path.isAbsolute(value) || value.includes('\\')) fail('engine-output-use-workspace-relative-path');
        if (!value.startsWith(`${store.prefix(state.sessionId)}/artifacts/`)) fail('engine-output-outside-session');
        await localPath(store.root, value);
      }
    }
    return context;
  }
  /** @param {string} id @param {number} revision @param {string} jobId @param {unknown} input */
  async function prepare(id, revision, jobId, input) {
    jobIdSchema.parse(jobId);
    const plan = jobPlanSchema.parse(input); validatePlan(plan);
    const requestHash = digest(JSON.stringify(plan));
    return store.lock(id, async () => {
      const jobs = await list(id), existing = jobs.find(j => j.jobId === jobId);
      if (existing) { if (existing.requestHash !== requestHash) fail('job-key-conflict'); return existing; }
      const state = await store.read(id);
      if (state.revision !== revision) fail('session-revision-conflict');
      await gate(state, plan);
      if (jobs.some(j => !terminal.has(j.status) && plan.targets.some(t => j.plan.targets.some(x => x.item === t.item))))
        fail('existing-job-needs-inspection');
      for (const target of plan.targets) if (state.items[target.item]?.versions[target.version] && plan.engine !== 'fighter-pack')
        fail('target-version-already-exists');
      for (const output of plan.outputs) {
        if (!output.startsWith(`${store.prefix(id)}/artifacts/`)) fail('output-outside-session-artifacts');
        const destination = await localPath(store.root, output);
        if (await lstat(destination).then(() => true, e => { if (e.code !== 'ENOENT') throw e; return false; })) fail('output-already-exists');
      }
      const inputs = await store.snapshots(plan.inputs);
      await localPath(store.root, `${store.prefix(id)}/jobs`, { createParents: true, directory: true });
      return write(id, { jobId, sessionId: id, requestHash, plan, inputs, sessionRevision: revision,
        createdAt: new Date().toISOString(), status: 'prepared', attempt: 0 });
    });
  }
  /** @param {string} id @param {string} jobId */
  async function inspect(id, jobId) {
    const job = await read(id, jobId);
    /** @type {string} */
    let observedStatus = job.status;
    if (job.status === 'running') {
      try { process.kill(/** @type {number} */ (job.runnerPid), 0); } catch { observedStatus = 'unknown'; }
    }
    if (job.status === 'succeeded' && !await unchanged(store.root, job.outputs)) observedStatus = 'outputs-changed';
    return { ...job, observedStatus, canExecute: job.status === 'prepared', nextAction: nextAction(job, observedStatus) };
  }
  /**
   * @param {string} id @param {string} jobId
   * @param {{ outcome: 'recovered' | 'not-started' | 'duplicate-risk-accepted', evidence: string[], note: string }} resolution
   */
  async function resolve(id, jobId, { outcome, evidence, note }) {
    z.enum(['recovered', 'not-started', 'duplicate-risk-accepted']).parse(outcome);
    z.string().trim().min(1).max(4000).parse(note);
    return store.lock(id, async () => {
      const job = await inspect(id, jobId);
      if (job.observedStatus !== 'unknown') fail('only-unknown-job-can-be-resolved');
      // A live runner may still finish. Never release its reservation from under it.
      if (job.status === 'running') { try { process.kill(/** @type {number} */ (job.runnerPid), 0); fail('runner-still-alive'); } catch (/** @type {any} */ e) { if (e.message === 'runner-still-alive' || e.code !== 'ESRCH') throw e; } }
      const records = await store.snapshots(z.array(z.string()).min(1).max(32).parse(evidence));
      const saved = await read(id, jobId);
      saved.status = 'resolved'; saved.resolution = { outcome, note, evidence: records, source: 'agent-reported', at: new Date().toISOString() };
      return write(id, saved);
    });
  }
  // An unstarted job is cancelled. A running one gets a stop request its runner acts on within STOP_POLL_MS; the job then
  // ends `failed` when the engine's report says no provider request left (or packing, preflight), else `unknown` (a
  // generation may have been billed), never as a confirmed non-run without that report.
  /** @param {string} id @param {string} jobId */
  async function cancel(id, jobId) {
    return store.lock(id, async () => {
      const job = await read(id, jobId);
      if (job.status === 'cancelled') return job;
      if (job.status === 'running') {
        try { process.kill(/** @type {number} */ (job.runnerPid), 0); } catch { fail('runner-not-running-inspect-job'); }
        await writeFile(await stopFile(id, jobId), JSON.stringify({ requestedAt: new Date().toISOString() }), { mode: 0o600 });
        return { ...job, stopRequested: true };
      }
      if (job.status !== 'prepared') fail('only-unstarted-or-running-job-can-be-cancelled');
      job.status = 'cancelled'; return write(id, job);
    });
  }
  /** @type {(id: string, jobId: string) => Promise<string>} */
  const stopFile = (id, jobId) => { jobIdSchema.parse(jobId); return store.fileFor(id, `jobs/${jobId}.stop`); };
  return { read, list, prepare, inspect, resolve, cancel, gate, write, stopFile };
}
/** @typedef {ReturnType<typeof createJobStore>} JobStore */

/** A workspace-relative engine path as a file under `root`, or null when it is not one the store allows. @param {string} root @param {string | null} relative */
async function engineFile(root, relative) {
  if (!relative) return null;
  try { return await localPath(root, relative.split(path.sep).join('/')); } catch { return null; }
}

/** What to do with a job: for an `unknown` one, inspect before anything runs again, or resume the video request it names. @param {Job} job @param {string} observedStatus */
function nextAction(job, observedStatus) {
  if (observedStatus !== 'unknown') return job.outcome?.next === 'retry' && job.status === 'failed'
    ? 'Every error the engine reported says the same command may succeed: prepare the job again.' : undefined;
  if (job.plan?.args?.[0] === 'gen-motion') return 'gen-motion keeps the attempt: inspect its gen.log and provider records, then run the same '
    + 'gen-motion command with --reconcile (no new generation); never repeat this job.';
  if (job.outcome?.next === 'resume') return `xAI took the video request${job.outcome.requestIds.length ? ` ${job.outcome.requestIds.join(', ')}` : ''}: `
    + "ask for it again with sprite-gen video-resume --request-id <id> (a video-set item's clip.report.json names it); never repeat this job.";
  return 'Inspect original provider records and outputs; never repeat this job.';
}

/** Stops the engine with the processes it started (sprite-gen runs Python under a Node wrapper). @param {import('node:child_process').ChildProcess} child */
function stopTree(child) {
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).once('error', () => child.kill());
  else { try { process.kill(-/** @type {number} */ (child.pid), 'SIGTERM'); } catch { child.kill('SIGTERM'); } } // no pid: kill throws
}
/**
 * No shell, provider fallback, retry, or credential mutation. Run through the host's normal execution approval.
 * `signal` stops the engine and everything it started; the result then carries `stopped`.
 * @param {string} root @param {JobPlan['engine']} engine @param {string[]} argv @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<EngineResult>}
 */
export function executeEngine(root, engine, argv, { signal } = {}) {
  if (signal?.aborted) return Promise.resolve({ code: null, notStarted: true, stopped: signal.reason ?? 'stopped' });
  const entry = fileURLToPath(new URL(engine === 'sprite' ? '../scripts/sprite-gen.mjs' : '../scripts/pack-fighter.mjs', import.meta.url));
  return new Promise(resolve => {
    // Its own process group off Windows, so a stop reaches the engine's children too.
    const child = spawn(process.execPath, [entry, ...argv], { cwd: root, shell: false, windowsHide: true, detached: process.platform !== 'win32',
      stdio: 'inherit', env: { ...process.env, INIT_CWD: root } });
    /** @type {string | null} */
    let stopped = null;
    const stop = () => { if (!stopped) { stopped = signal?.reason ?? 'stopped'; stopTree(child); } };
    // The runner's own interrupt (Ctrl-C) must not orphan a detached engine.
    const interrupted = () => stop();
    signal?.addEventListener('abort', stop, { once: true });
    process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
    /** @type {(value: EngineResult) => void} */
    const done = value => {
      signal?.removeEventListener('abort', stop); process.off('SIGINT', interrupted); process.off('SIGTERM', interrupted);
      resolve(stopped ? { ...value, stopped } : value);
    };
    child.once('error', () => done({ code: null, notStarted: true }));
    child.once('exit', (code, exitSignal) => done({ code, signal: exitSignal }));
  });
}

/** @param {CreationStore} store @param {string} id @param {string} jobId @param {{ execute?: typeof executeEngine, timeoutMs?: number }} [options] */
export async function runCreationJob(store, id, jobId, { execute = executeEngine, timeoutMs } = {}) {
  const jobs = createJobStore(store);
  let job = await store.lock(id, async () => {
    const current = await jobs.read(id, jobId);
    if (current.status !== 'prepared') return current;
    if (digest(JSON.stringify(current.plan)) !== current.requestHash) fail('job-plan-changed');
    const state = await store.read(id);
    if (state.revision !== current.sessionRevision) fail('session-changed-reprepare-job');
    await jobs.gate(state, current.plan);
    if (!await unchanged(store.root, current.inputs)) fail('job-inputs-changed');
    for (const output of current.plan.outputs) {
      const filename = await localPath(store.root, output, { createParents: true });
      if (await lstat(filename).then(() => true, e => { if (e.code !== 'ENOENT') throw e; return false; })) fail('output-already-exists');
    }
    current.status = 'running'; current.runnerPid = process.pid; current.attempt = 1;
    current.runToken = randomUUID(); current.startedAt = new Date().toISOString();
    return jobs.write(id, current);
  });
  if (job.status !== 'running' || job.runnerPid !== process.pid || job.startedAt === undefined) return job;
  // Claim separately: a repeated invocation in the same process must also execute at most once.
  const claimFile = await store.fileFor(id, `jobs/${jobId}.claimed`);
  const { open } = await import('node:fs/promises');
  try { const claim = await open(claimFile, 'wx', 0o600); await claim.close(); }
  catch (/** @type {any} */ e) { if (e.code === 'EEXIST') return jobs.read(id, jobId); throw e; }
  let result, stage = 'execute';
  // A time limit and a stop request (cancel_creation_job on a running job) both stop the engine through this signal.
  const control = new AbortController(), stopPath = await jobs.stopFile(id, jobId);
  const timer = setTimeout(() => control.abort('runner-timeout'), timeoutMs ?? (job.plan.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES) * 60_000);
  const poll = setInterval(() => lstat(stopPath).then(() => control.abort('stopped-by-request'), () => {}), STOP_POLL_MS);
  const options = { signal: control.signal };
  /** @type {typeof executeEngine} */
  const dispatch = (root, engine, argv, options) => control.signal.aborted
    ? Promise.resolve({ code: null, notStarted: true, stopped: control.signal.reason ?? 'stopped' })
    : execute(root, engine, argv, options);
  try {
    if (job.plan.workflowArgs) {
      stage = 'preflight'; result = await dispatch(store.root, 'sprite', job.plan.workflowArgs, options);
      // A stopped preflight generated nothing: it failed, it is not a choice waiting for the user.
      if (result.code !== 0) job.status = result.notStarted || result.stopped ? 'failed' : 'needs-input';
    }
    if (job.status === 'running') {
      // The user may revise or stop the agreed work while access checks are running.
      const state = await store.read(id);
      if (state.revision !== job.sessionRevision || !await unchanged(store.root, job.inputs)) {
        job.status = 'needs-input'; job.reason = 'session-or-input-changed-before-execution';
      }
    }
    if (job.status === 'running') {
      stage = 'execute';
      const since = Date.now();
      result = await dispatch(store.root, job.plan.engine, job.plan.args, options);
      const spending = job.plan.engine === 'sprite' && spends(job.plan.args);
      job.status = result.notStarted ? 'failed' : result.code === 75 ? 'needs-input'
        : result.code === 0 ? 'succeeded' : spending ? 'unknown' : 'failed';
      if (spending && !result.notStarted && result.code !== 0) {
        // What the engine's own report says (exit 3, `provider_submitted`, the error codes), stopped runs included: a run
        // that sent nothing failed and cost nothing; one whose request left and failed for a reason the report names is
        // failed too; anything else stays `unknown` (it may have been billed: inspect, or resume a video request).
        job.outcome = judgeOutcome({ code: result.code, report: await readOutcome(await engineFile(store.root, outcomeReportPath(job.plan.args)), { since }) });
        if (job.status === 'unknown' && (job.outcome.charge === 'not-charged'
            || (job.outcome.charge === 'request-sent' && ['retry', 'fix'].includes(job.outcome.next)))) job.status = 'failed';
      }
      if (job.status === 'succeeded') {
        try { job.outputs = await store.snapshots(job.plan.outputs); }
        catch { job.status = 'unknown'; job.reason = 'declared-output-missing'; }
      }
    }
  } catch { job.status = 'unknown'; job.reason = 'runner-interrupted-or-unexpected-error'; }
  finally { clearTimeout(timer); clearInterval(poll); await rm(stopPath, { force: true }); }
  if (result?.stopped && job.status !== 'succeeded') job.reason = result.stopped;
  job.stage = stage; job.exitCode = result?.code ?? null; job.signal = result?.signal ?? null;
  job.finishedAt = new Date().toISOString();
  // A finished (possibly paid) run must not be lost to a concurrent tool call: wait for the lock instead of failing.
  return store.lock(id, async () => jobs.write(id, job), { waitMs: 10 * 60_000 });
}
