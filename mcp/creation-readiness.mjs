// @ts-check
// Separate workspace setup, ODDBOUT connection, provider choice, generation access and parent delivery.
// It never generates, never switches providers, and never proves that a preview was displayed.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectSpriteEngine } from '../scripts/sprite-gen.mjs';
import { checkTools } from '../scripts/sprite-tools.mjs';
import { unverifiedCreation } from './connection-readiness.mjs';
import { createEnvironmentStore } from './creation-environment.mjs';
import { doctor as inspectDotsRuntime } from '../scripts/dots-workspace.mjs';
import { readRecord, safePath } from '../scripts/dots-safety.mjs';
import { atomicJson, localPath, readJson } from './creation-store.mjs';
import { withFileLock } from './file-lock.mjs';

/**
 * @typedef {import('./creation-store.mjs').CreationStore} CreationStore
 * @typedef {import('./creation-jobs.mjs').JobStore} JobStore
 * @typedef {import('./creation-environment.mjs').EnvironmentStore} EnvironmentStore
 * @typedef {{ version: string | null, motion: boolean, error?: string }} Engine
 * @typedef {{ source: boolean, environment: boolean }} Installed
 * @typedef {{ progress: { inProgress: boolean | null }, installed?: Installed, root?: string, spriteRoot?: string, workspaceRoot?: string,
 *   fetchRemote?: boolean, git?: typeof runGit, inspectEngine?: (spriteRoot: string) => Promise<Engine>,
 *   inspectPinnedRuntime?: typeof inspectDotsRuntime }} KitOptions
 * @typedef {{ status: string, branch: string | null, behind: number | null, ahead: number | null, remoteChecked: boolean, engine: Engine | null,
 *   changedFiles: string[], nextCommands: string[], restartRequired: boolean, reason?: string | null, versionPolicy?: string,
 *   remoteRetryAt?: string }} KitResult  `remoteRetryAt`: a fetch failed within FETCH_INTERVAL_MS, so none ran; the next is due then.
 */

// codex/creator-hosting was the kit branch until 2026-10-29; it is frozen there and a checkout on it is told to move.
export const KIT_BRANCH = 'main';
const kitRoot = fileURLToPath(new URL('../', import.meta.url));

export const ACCOUNT_OPTIONS = [
  { id: 'gpt', label: '내 GPT(ChatGPT) 구독으로 진행', provider: 'codex' },
  { id: 'grok', label: '내 Grok 구독으로 진행', provider: 'grok' },
  { id: 'both', label: 'GPT 원화 + Grok 동작으로 진행', provider: 'codex' },
  { id: 'stop', label: '지금은 생성하지 않고 멈춤', provider: null },
];

/**
 * git without a shell. Resolves { code, stdout } and never throws for a non-zero exit.
 * @param {string[]} args @param {{ cwd?: string, timeout?: number }} [options] @returns {Promise<{ code: number, stdout: string }>}
 */
export function runGit(args, { cwd = kitRoot, timeout = 30000 } = {}) {
  return new Promise(resolve => execFile('git', args, { cwd, timeout, windowsHide: true, maxBuffer: 1 << 20 },
    (error, stdout) => resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout ?? '').trim() })));
}

/**
 * A character is in progress once any version or non-cancelled (or unreadable) job exists. Updating then would change the
 * engine under recorded attempts and reviews (docs/EXECUTION-HOST.md). Without a workspace it is unknown.
 * @param {{ store?: CreationStore, jobs?: JobStore, sessionId?: string }} [options]
 */
export async function creationProgress({ store, jobs, sessionId } = {}) {
  if (!store) return { known: false, inProgress: null, sessions: [] };
  const ids = sessionId ? [sessionId] : (await store.list()).map(s => s.sessionId);
  const active = [];
  for (const id of ids) {
    const state = await store.read(id);
    const versions = Object.values(state.items ?? {}).some(item => Object.keys(item.versions ?? {}).length);
    // An unreadable job record may be work in progress too. Jobs come with the store.
    const work = (await /** @type {JobStore} */ (jobs).list(id)).some(job => 'unreadable' in job || job.status !== 'cancelled');
    if (versions || work) active.push(id);
  }
  return { known: true, inProgress: active.length > 0, sessions: active };
}

/**
 * Bring the kit and its pinned sprite-gen-agent engine current, but only before a character starts.
 * Fast-forward only, on the published branch, with no tracked local edits. Slow installs are returned as commands.
 * @param {KitOptions} [options] `progress` is needed unless this is a pinned Dots runtime.
 */
export async function checkKit({ installed, ...options } = /** @type {KitOptions} */ ({})) {
  const spriteRoot = options.spriteRoot ?? path.join(options.root ?? kitRoot, 'vendor', 'sprite-gen');
  const pinned = await checkPinnedDotsKit({ ...options, spriteRoot });
  if (pinned) return pinned;
  const present = installed ?? await installedSpriteGen(spriteRoot);
  const result = await checkKitCore({ ...options, spriteRoot, present });
  if (present.source && present.environment) return result;
  // First run in a fresh workspace: the agent installs; nothing here is a local-change problem.
  for (const command of ['npm ci --ignore-scripts', 'npm run sprite:setup', 'npm run sprite:status'])
    if (!result.nextCommands.includes(command)) result.nextCommands.push(command);
  return { ...result, status: result.status === 'blocked' ? 'blocked' : 'action-required', reason: result.reason ?? 'sprite-gen-not-installed' };
}

/** A Dots install keeps its workspace's immutable release; readiness must never fetch a moving branch. @param {KitOptions & { spriteRoot: string }} options */
async function checkPinnedDotsKit({ root = kitRoot, workspaceRoot, spriteRoot,
  inspectPinnedRuntime = inspectDotsRuntime, inspectEngine = inspectSpriteEngine }) {
  /** @type {KitResult} */
  const result = { status: 'blocked', branch: null, behind: null, ahead: null, remoteChecked: false,
    engine: null, changedFiles: [], nextCommands: [], restartRequired: false, versionPolicy: 'retain-workspace-pin' };
  let marker;
  try { marker = await readRecord(await safePath('.dots-runtime.json', { root })); }
  catch (/** @type {any} */ error) { return error.code === 'ENOENT' ? null : { ...result, reason: 'dots-runtime-marker-invalid' }; }
  if (marker?.schemaVersion !== 1 || marker.host !== 'dots') return { ...result, reason: 'dots-runtime-marker-invalid' };
  if (!workspaceRoot) return { ...result, reason: 'dots-workspace-binding-required' };
  let binding;
  try { binding = await readRecord(await safePath('output/dots-workspace.json', { root: workspaceRoot })); }
  catch { return { ...result, reason: 'dots-workspace-binding-required' }; }
  const sourcePin = /^[a-f0-9]{40}$/.test(binding?.commit ?? '');
  const bundlePin = !binding?.commit && /^[a-f0-9]{64}$/.test(binding?.manifestSha256 ?? '');
  if (binding?.schemaVersion !== 1 || binding.provider !== 'grok' || typeof binding.runtime !== 'string' || !path.isAbsolute(binding.runtime) ||
      path.resolve(binding.runtime) !== path.resolve(root) || (!sourcePin && !bundlePin))
    return { ...result, reason: 'dots-workspace-binding-invalid' };
  let report;
  try {
    report = await inspectPinnedRuntime({ runtime: root, workspace: workspaceRoot, provider: 'none',
      ...(bundlePin ? { manifestSha256: binding.manifestSha256 } : {}) });
  } catch { return { ...result, reason: 'dots-runtime-inspection-failed' }; }
  if (report.blockers?.length) return { ...result, reason: report.blockers[0] };
  if (!Array.isArray(report.blockers) || !report.kit || report.kit.version !== binding.version ||
      (sourcePin ? report.kit.distribution !== 'source' || report.kit.commit !== binding.commit
        : report.kit.distribution !== 'bundle' || report.kit.manifestSha256 !== binding.manifestSha256))
    return { ...result, reason: 'dots-runtime-binding-mismatch' };
  result.engine = await inspectEngine(spriteRoot);
  return { ...result, status: result.engine.motion ? 'ready' : 'action-required',
    reason: result.engine.motion ? null : 'motion-engine-missing', commit: report.kit.commit ?? null,
    manifestSha256: report.kit.manifestSha256 ?? null };
}

/** @param {string} spriteRoot */
async function installedSpriteGen(spriteRoot) {
  /** @type {(file: string) => Promise<boolean>} */
  const exists = file => access(file).then(() => true, () => false);
  return { source: await exists(path.join(spriteRoot, 'SKILL.md')),
    environment: await exists(path.join(spriteRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')) };
}

/**
 * A kit fetch's last attempt. Each creation:tool call is a fresh process, so a cache in memory alone never held: on a blocked network
 * every readiness call waited out the 60-second fetch again (MCP 점검 2026-11-03). The workspace keeps the attempt next to its other
 * records; within FETCH_INTERVAL_MS of a failed one the kit is not fetched again. A success ends that wait but holds off no other
 * process's fetch: a kit change published a minute ago still shows.
 * @typedef {{ at: number, ok: boolean }} FetchAttempt
 */
export const FETCH_INTERVAL_MS = 5 * 60_000, FETCH_RECORD = 'output/kit-fetch.json';
const lastFetch = /** @type {Map<string, FetchAttempt>} */ (new Map());
/** @param {string | undefined} workspaceRoot @param {string} root @returns {Promise<FetchAttempt | null>} */
async function recordedFetch(workspaceRoot, root) {
  if (!workspaceRoot) return null;
  try {
    const record = await readJson(await localPath(workspaceRoot, FETCH_RECORD));
    const at = Date.parse(record?.attemptedAt);
    return record?.schemaVersion === 1 && record.kitRoot === path.resolve(root) && record.branch === KIT_BRANCH && Number.isFinite(at)
      && typeof record.ok === 'boolean' ? { at, ok: record.ok } : null;
  } catch { return null; }
}
/** A record that cannot be written costs the next call a fetch, never this check. @param {string | undefined} workspaceRoot @param {string} root @param {FetchAttempt} attempt */
async function recordFetch(workspaceRoot, root, attempt) {
  if (!workspaceRoot) return;
  try {
    await atomicJson(await localPath(workspaceRoot, FETCH_RECORD, { createParents: true }), { schemaVersion: 1, kitRoot: path.resolve(root),
      branch: KIT_BRANCH, attemptedAt: new Date(attempt.at).toISOString(), ok: attempt.ok });
  } catch { /* the next call fetches */ }
}
/**
 * One kit's git work at a time across processes: two readiness calls fetching or fast-forwarding the same checkout collide on git's own
 * locks, and the second can wait for the first's fetch and then reuse its recorded attempt. Keyed by the kit, in the temporary directory,
 * so the checkout gains no file.
 * @param {string} root
 */
const kitLock = root => path.join(tmpdir(), `oddbout-kit-${createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16)}.lock`);
// A fetch and a fast-forward take up to 60 seconds each.
const KIT_LOCK_WAIT_MS = 150_000;

/** @param {KitOptions & { spriteRoot: string, present: Installed }} options */
async function checkKitCore(options) {
  return withFileLock(kitLock(options.root ?? kitRoot), () => checkKitLocked(options), { busy: 'kit-update-busy', waitMs: KIT_LOCK_WAIT_MS });
}
/** @param {KitOptions & { spriteRoot: string, present: Installed }} options */
async function checkKitLocked({ progress, present, fetchRemote = true, git = runGit, root = kitRoot, spriteRoot, workspaceRoot,
  inspectEngine = inspectSpriteEngine }) {
  /** @type {KitResult} */
  const result = { status: 'ready', branch: null, behind: null, ahead: null, remoteChecked: false, engine: null,
    changedFiles: [], nextCommands: [], restartRequired: false, reason: null };
  const readEngine = async () => !present.source ? { version: null, motion: false, error: 'sprite-gen-not-installed' }
    : inspectEngine(spriteRoot);
  const head = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root });
  result.branch = head.stdout;
  result.engine = await readEngine();
  // A packaged plugin runtime is not a checkout: its version comes with the package, so report only.
  if (head.code !== 0) return { ...result, status: result.engine.motion ? 'ready' : 'action-required', reason: 'not-a-git-checkout' };
  if (result.branch !== KIT_BRANCH) return { ...result, status: 'blocked', reason: 'wrong-branch', expectedBranch: KIT_BRANCH };
  // Edits inside the submodule are checked below; here only tracked edits in this checkout or a moved gitlink count.
  const dirty = (await git(['status', '--porcelain', '--untracked-files=no', '--ignore-submodules=dirty'], { cwd: root })).stdout;
  if (fetchRemote) {
    // The workspace's last attempt and this process's own (real git only, as a long-running MCP process keeps it).
    const recorded = await recordedFetch(workspaceRoot, root), seen = git === runGit ? lastFetch.get(root) : undefined;
    const latest = [recorded, seen].reduce((newest, attempt) => attempt && (!newest || attempt.at > newest.at) ? attempt : newest, null);
    /** @type {(attempt: FetchAttempt) => boolean} */
    const recent = attempt => Date.now() - attempt.at >= 0 && Date.now() - attempt.at < FETCH_INTERVAL_MS;
    if (latest && recent(latest) && !latest.ok) result.remoteRetryAt = new Date(latest.at + FETCH_INTERVAL_MS).toISOString();
    else if (seen && recent(seen) && seen.ok) result.remoteChecked = true;
    else {
      result.remoteChecked = (await git(['fetch', '--quiet', 'origin', KIT_BRANCH], { cwd: root, timeout: 60000 })).code === 0;
      /** @type {FetchAttempt} */
      const attempt = { at: Date.now(), ok: result.remoteChecked };
      if (git === runGit) lastFetch.set(root, attempt);
      await recordFetch(workspaceRoot, root, attempt);
    }
  }
  if (result.remoteChecked) {
    const counts = (await git(['rev-list', '--left-right', '--count', `HEAD...origin/${KIT_BRANCH}`], { cwd: root })).stdout.split(/\s+/).map(Number);
    [result.ahead, result.behind] = counts.length === 2 && counts.every(Number.isInteger) ? counts : [null, null];
  }
  if (progress.inProgress !== false) {
    // In progress, or unknown without a workspace: report only, change nothing.
    const reason = progress.inProgress === null ? 'progress-unknown-no-workspace' : 'character-in-progress';
    if (/** @type {number} */ (result.behind) > 0) return { ...result, status: 'deferred', reason }; // null (unchecked) is not > 0
    return { ...result, status: result.engine.motion ? 'ready' : 'action-required', reason: result.engine.motion ? null : reason };
  }
  if (dirty) return { ...result, status: 'blocked', reason: 'local-changes' };
  if (/** @type {number} */ (result.ahead) > 0) return { ...result, status: 'blocked', reason: 'diverged-from-published-branch' };
  if (/** @type {number} */ (result.behind) > 0) {
    const before = (await git(['rev-parse', 'HEAD'], { cwd: root })).stdout;
    if ((await git(['merge', '--ff-only', `origin/${KIT_BRANCH}`], { cwd: root, timeout: 60000 })).code !== 0)
      return { ...result, status: 'blocked', reason: 'fast-forward-failed' };
    result.changedFiles = (await git(['diff', '--name-only', before, 'HEAD'], { cwd: root })).stdout.split('\n').filter(Boolean);
    /** @type {(file: string) => boolean} */
    const changed = file => result.changedFiles.includes(file);
    if (changed('package.json') || changed('package-lock.json')) result.nextCommands.push('npm ci --ignore-scripts');
    if (changed('vendor/sprite-gen') || !present.source) result.nextCommands.push('npm run sprite:setup');
    result.nextCommands.push('npm run sprite:status');
    // This MCP process still runs the code it started with, while what it forks or spawns (server/ validator, tools/
    // gait, scripts) loads the new code: restart so both sides agree. deploy/ JSON is read once at startup.
    result.restartRequired = result.changedFiles.some(f => /^(mcp|api|contracts|scripts|server|deploy|tools)\//.test(f) || /^package(-lock)?\.json$/.test(f));
    return { ...result, status: 'updated' };
  }
  if (!present.source) return result; // checkKit adds the install commands
  // Recorded attempts name the pinned engine; an edited one is not that engine.
  if ((await git(['status', '--porcelain', '--untracked-files=no'], { cwd: spriteRoot })).stdout)
    return { ...result, status: 'blocked', reason: 'vendor-local-changes' };
  if (!result.engine.motion) // a checkout still on the pre-fork upstream pin
    return { ...result, status: 'action-required', reason: 'motion-engine-missing', nextCommands: ['npm run sprite:setup', 'npm run sprite:status'] };
  return { ...result, reason: result.remoteChecked ? null : 'remote-unreachable-current-unknown' };
}

/** The generation-account choice: options to show; the user's stated or elicited answer only. Never inferred. @param {string | null} [choice] */
export function accountItem(choice) {
  const option = ACCOUNT_OPTIONS.find(o => o.id === choice);
  const verification = 'sprite-gen workflow는 사용자가 전달한 선택·접근 조건을 확인하며 구독·한도·실제 생성 성공을 보증하지 않는다.'
    + ' 결과 표시는 이 대화에 실제 이미지를 보여준 것으로만 확인한다. creation:delivery는 기록의 누락·모순만 검사하며 표시를 증명하지 않는다.';
  if (!option) return { status: 'choice-required', options: ACCOUNT_OPTIONS.map(({ id, label }) => ({ id, label })), verification };
  if (option.id === 'stop') return { status: 'stopped', choice: option.id, verification };
  return { status: 'chosen-unverified', choice: option.id, provider: option.provider, verification,
    imageProvider: option.provider, motionMethod: choice === 'gpt' ? 'gpt-rows' : 'grok-video',
    // Choosing a provider is not a statement that its image/video entitlement was checked.
    nextCommands: [`npm run sprite -- workflow --kind image --image-provider ${option.provider}`,
      'npm run creation:delivery -- preflight output/<sessionId>-work/delivery-check.json <현재-대화-ID>'] };
}

/**
 * Ask for the account through a host form when the client supports elicitation. Any failure means "ask in text": the request's
 * `elicitInput` refuses before sending when the client declared no form elicitation, or when the request is on the 2026-07-28 era.
 * @param {import('@modelcontextprotocol/server').ServerContext['mcpReq']['elicitInput']} [elicitInput] @returns {Promise<{ method: string, choice: string | null }>}
 */
export async function elicitAccount(elicitInput) {
  if (!elicitInput) return { method: 'unsupported', choice: null };
  try {
    const answer = await elicitInput({
      message: '이번 캐릭터 생성에 쓸 본인 구독을 골라 주세요. 다른 서비스나 유료 API로 자동 전환하지 않습니다.',
      requestedSchema: { type: 'object', required: ['account'], properties: { account: { type: 'string', title: '생성 계정',
        oneOf: ACCOUNT_OPTIONS.map(({ id, label }) => ({ const: id, title: label })) } } },
    }, { timeout: 5 * 60 * 1000 });
    return answer.action === 'accept' && ACCOUNT_OPTIONS.some(o => o.id === answer.content?.account)
      ? { method: 'elicited', choice: /** @type {{ account: string }} */ (answer.content).account } : { method: answer.action ?? 'declined', choice: null };
  } catch { return { method: 'unsupported', choice: null }; }
}

/**
 * @param {{ store?: CreationStore, jobs?: JobStore, sessionId?: string, account?: string, purpose?: string,
 *   elicitInput?: import('@modelcontextprotocol/server').ServerContext['mcpReq']['elicitInput'], kit?: Omit<KitOptions, 'progress'>,
 *   tools?: Parameters<typeof checkTools>[0], environment?: EnvironmentStore }} [options]
 */
export async function checkReadiness({ store, jobs, sessionId, account, purpose = 'generation', elicitInput, kit = {}, tools = {}, environment } = {}) {
  if (!['generation', 'connection', 'registration'].includes(purpose)) throw new Error('invalid-readiness-purpose');
  const needsGeneration = purpose === 'generation';
  const progress = await creationProgress({ store, jobs, sessionId });
  // A generation environment configured in this workspace keeps the provider the user stated there.
  const workspace = needsGeneration ? environment ?? (store?.root ? createEnvironmentStore(store.root) : null) : null;
  // A workspace moved to another host still names its provider; its inspection below reports the rebind instead of failing this check.
  const saved = workspace ? await workspace.read({ allowMoved: true }) : null;
  const savedChoice = ACCOUNT_OPTIONS.some(o => o.id === saved?.account) ? /** @type {NonNullable<typeof saved>} */ (saved).account : null;
  let choice = account ?? savedChoice, elicitation = savedChoice && !account ? 'saved-environment' : 'not-needed';
  if (needsGeneration && !choice) ({ method: elicitation, choice } = await elicitAccount(elicitInput));
  const notRequired = { status: 'not-required', reason: 'no-generation-in-this-step', nextCommands: [] };
  // The workspace registers through the connected ODDBOUT tools; it never reads or offers a local account.
  const infrastructure = { status: 'not-required', reason: 'cloud-registration-route' };
  const login = { status: 'connector-verification-required', userId: null, route: 'oddbout-cloud', nextTools: ['get_profile', 'check_creation_readiness'],
    note: 'Use the connected ODDBOUT tools in this conversation. Verify its account and readiness there. Do not run workspace login or transfer credentials. This result does not verify that connection.' };
  const spriteRoot = kit.spriteRoot ?? path.join(kit.root ?? kitRoot, 'vendor', 'sprite-gen');
  // The kit, its tools and the workspace record are independent checks: run them together.
  const [kitItem, toolsItem, environmentItem] = await Promise.all([
    needsGeneration ? checkKit({ progress, workspaceRoot: store?.root, ...kit }) : notRequired,
    // ffmpeg, ffprobe and img2webp -exact are required; RIFE only warns (loops cut as filmed).
    needsGeneration ? checkTools({ spriteRoot, python: path.join(spriteRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), ...tools }) : notRequired,
    // Recorded environment preconditions are reported for the agent to resolve; they do not make generation ready here.
    !needsGeneration ? notRequired : workspace
      ? workspace.inspect().then(found => ({ ...found, matchesChoice: saved?.account === choice, certifiesGeneration: false }))
      : { status: 'workspace-required', readyForGeneration: false, certifiesGeneration: false },
  ]);
  const items = { kit: kitItem, tools: toolsItem, infrastructure, login,
    account: needsGeneration ? accountItem(choice) : notRequired, ...unverifiedCreation(choice), environment: environmentItem };
  const ready = ['ready', 'updated'].includes(items.kit.status) && !/** @type {KitResult} */ (items.kit).restartRequired && items.kit.nextCommands.length === 0 // a kit status
    && items.tools.status === 'ready' && items.account.status === 'chosen-unverified';
  return { purpose, kitAndAccountReady: ready, readyForGeneration: false,
    readyForRegistration: false, progress, elicitation, items, // the connected ODDBOUT tools check registration access
    resume: { preserveWorkspace: true, sessionIds: progress.sessions, automaticGeneration: false, automaticSubmission: false,
      nextAction: { actor: 'agent', code: 'resume-existing-work', message: '연결 복구 뒤 같은 작업 공간에서 check_creation_readiness를 다시 호출하고 get_creation_session·get_creation_job으로 기존 버전·선택·pending/unknown 결과를 회수한다. 새 폴더·재생성·재등록으로 우회하지 않는다.' } },
    meaning: 'kitAndAccountReady covers the kit, its required system tools (ffmpeg, ffprobe, img2webp with -exact) and provider choice only. Generation and parent display remain unverified by this tool; readyForGeneration stays false. Registration readiness means authenticated API access, not package approval or submission authorization.' };
}
