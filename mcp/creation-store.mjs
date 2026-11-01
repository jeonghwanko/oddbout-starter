// @ts-check
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, copyFile, lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { z } from 'zod';
import { fetchCreationContext, itemBlockers, reviewCreationProgress } from './creation-context.mjs';
import { makePackageValidator } from './package-access.mjs';
import { withFileLock } from './file-lock.mjs';
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { errorCode } from './error-code.mjs';
import { profileLimits } from '../contracts/ai-fighter/profile-limits.mjs';

/**
 * The session record. Each item's `review` and `packageReview` exist on the effective view only; save() sets updatedAt.
 * @typedef {import('./creation-context.mjs').CreationContext} CreationContext
 * @typedef {{ path: string, bytes: number, sha256: string }} FileRecord
 * @typedef {{ files: (FileRecord & { sourcePath: string })[], basis: Record<string, string | null>, note: string, createdAt: string, feedback?: string,
 *   review?: { verdict: 'passed' | 'failed' | 'hypothetical', evidence: FileRecord[], note: string, contextRevision: string, source: string } }} ItemVersion
 * @typedef {{ version: string, selectedVersion: string | null, versions: Record<string, ItemVersion>, review?: string, filesValid?: boolean }} SessionItem
 * @typedef {{ files: FileRecord[], basisHash: string, contextRevision: string, fileValidation: { stage: string, pending?: string[] },
 *   review?: { verdict: 'passed' | 'failed', evidence: FileRecord[], feedback: string, source: string } }} PackageRecord
 * @typedef {{ storeVersion: 1, sessionId: string, revision: number, brief: string, mode: 'creation' | 'dialogue-only', contextRevision: string,
 *   context: CreationContext, groupId: string, items: Record<string, SessionItem>, pendingEdits: string[], delegatedGroups: string[],
 *   profile: { selected?: boolean, [key: string]: unknown }, package?: PackageRecord, history: object[], updatedAt?: string, packageReview?: string, packageFilesValid?: boolean }} Session
 */

export const identifier = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const style = spec.combatStyle, range = (/** @type {{ min: number, max: number }} */ { min, max }) => z.number().int().min(min).max(max);
const styleSchema = z.object({
  mix: z.object(Object.fromEntries(style.actions.map(action => [action, range(style.mix)]))).strict()
    .refine(mix => style.actions.some(action => mix[action] > 0) && mix.fast <= mix.slam + mix.combo, 'style-mix').optional(),
  special: z.enum(style.actions).optional(), super: z.enum(style.supers).optional(), distance: range(style.grade).optional(),
  shockwave: z.literal(true).optional(), summon: z.enum(style.summons).optional(),
  temper: z.object(Object.fromEntries(style.temper.map(key => [key, range(style.grade).optional()]))).strict().optional(),
  exchanges: z.object(Object.fromEntries(style.exchanges.keys.map(key => [key, range(style.exchanges).optional()]))).strict().optional(),
}).strict();
const HISTORY_KEPT = 100;
const versionId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/);
const note = z.string().trim().min(1).max(4000);
const files = z.array(z.string().min(1).max(512)).min(1).max(64);
export const changeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('version'), item: versionId, version: versionId, files, note }).strict(),
  z.object({ type: z.literal('review'), item: versionId, version: versionId,
    verdict: z.enum(['passed', 'failed', 'hypothetical']), evidence: files, note }).strict(),
  z.object({ type: z.literal('select'), item: versionId, version: versionId, feedback: note }).strict(),
  z.object({ type: z.literal('restore'), item: versionId, version: versionId, feedback: note }).strict(),
  z.object({ type: z.literal('revision'), item: versionId, feedback: note }).strict(),
  z.object({ type: z.literal('delegate'), groups: z.array(z.string()).max(5), feedback: note }).strict(),
  // Concept, names, bout lines, move names, duel grades and fighting style are optional; their limits are the contract's
  // (spec.json profileExtras / profileLines / combatStats / combatStyle). The style's extras budget also counts the skill clip: the package check has it.
  z.object({ type: z.literal('profile'), name: z.string().min(1).max(profileLimits.name), description: z.string().max(profileLimits.description),
    language: z.enum(spec.profileExtras.languages).optional(), concept: z.string().trim().min(1).max(spec.profileExtras.conceptMaxLength).optional(),
    names: z.object(Object.fromEntries(spec.profileExtras.languages.map(language => [language, z.string().trim().min(1).max(spec.profileExtras.nameMaxLength).optional()])))
      .strict().refine(value => Object.keys(value).length > 0).optional(),
    lines: z.object(Object.fromEntries(spec.profileLines.keys.map(key => [key, z.string().trim().min(1).max(spec.profileLines.maxLength).optional()])))
      .strict().refine(value => Object.keys(value).length > 0).optional(),
    moves: z.object(Object.fromEntries(spec.profileExtras.namedMoves.map(move => [move, z.object({
      name: z.string().trim().min(1).max(spec.profileExtras.moveNameMaxLength),
      description: z.string().trim().min(1).max(spec.profileExtras.moveDescriptionMaxLength) }).strict()]))).strict().optional(),
    stats: z.object(Object.fromEntries(spec.combatStats.keys.map(key => [key, z.number().int().min(spec.combatStats.min).max(spec.combatStats.max)]))).strict()
      .refine(stats => Object.values(stats).reduce((sum, grade) => sum + grade, 0) === spec.combatStats.budget, 'stats-budget').optional(),
    style: styleSchema.optional(),
    feedback: note }).strict(),
  z.object({ type: z.literal('package'), files, note }).strict(),
  z.object({ type: z.literal('package-review'), verdict: z.enum(['passed', 'failed']), evidence: files, feedback: note }).strict(),
  z.object({ type: z.literal('advance') }).strict(),
  z.object({ type: z.literal('refresh-context'), note }).strict(),
]);
/** @typedef {z.infer<typeof changeSchema>} ChangeEvent */

/** @type {(bytes: string | Uint8Array) => string} */
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
/** @param {string} code @returns {never} */
export function fail(code) { throw new Error(code); }
/** @param {unknown} id */
export function checkId(id) { return identifier.parse(id); }
const device = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;

/**
 * Workspace-local paths only. As with package-access, this is not an OS sandbox.
 * @param {string} root @param {string} relative @param {{ createParents?: boolean, directory?: boolean }} [options]
 */
export async function localPath(root, relative, { createParents = false, directory = false } = {}) {
  if (typeof relative !== 'string' || relative.length > 1024 || /[\\:\x00-\x1f]/.test(relative) || path.isAbsolute(relative) ||
      relative.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || device.test(p))) fail('path-not-allowed');
  const base = await realpath(root), parts = relative.split('/');
  let target = base;
  for (let i = 0; i < parts.length; i++) {
    target = path.join(target, parts[i]);
    let info = await lstat(target).catch(e => { if (e.code !== 'ENOENT') throw e; });
    const needsDirectory = i < parts.length - 1 || directory;
    if (!info && createParents && needsDirectory) {
      await mkdir(target).catch(e => { if (e.code !== 'EEXIST') throw e; });
      info = await lstat(target);
    }
    if (info?.isSymbolicLink() || (info && needsDirectory && !info.isDirectory())) fail('path-not-allowed');
  }
  return target;
}

/** @param {string} file @returns {Promise<any>} parsed JSON: callers check its fields */
export async function readJson(file) {
  const handle = await open(file, 'r');
  try {
    if ((await handle.stat()).size > 2 * 1024 * 1024) fail('record-too-large');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}
/** @param {string} file @param {unknown} data */
export async function atomicJson(file, data) {
  const temp = `${file}.${randomUUID()}.tmp`;
  const bytes = JSON.stringify(data, null, 2) + '\n';
  if (Buffer.byteLength(bytes) > 2 * 1024 * 1024) fail('record-too-large');
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try {
    // Windows virus scanners may briefly hold a just-written JSON file without delete sharing.
    // Retry the same atomic rename; never unlink the valid prior snapshot as a workaround.
    for (let attempt = 0; ; attempt++) {
      try { await rename(temp, file); break; }
      catch (/** @type {any} */ error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 6) throw error;
        await delay(25 * (attempt + 1));
      }
    }
  } finally { await rm(temp, { force: true }); }
}

// Inspecting a session re-checks every version, evidence and output file. A file whose size, mtime, ctime and inode are
// all unchanged has the same bytes, so its hash is reused; rewriting a file changes its ctime even if mtime is restored.
const HASH_CACHE_LIMIT = 5000, hashCache = /** @type {Map<string, { stamp: string, sha256: string }>} */ (new Map());
/** @param {string} root @param {string} relative @returns {Promise<FileRecord>} */
export async function fingerprint(root, relative) {
  const file = await localPath(root, relative);
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 256 * 1024 * 1024) fail('asset-not-regular-or-too-large');
    const stamp = `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}`, cached = hashCache.get(file);
    if (cached?.stamp === stamp) return { path: relative, bytes: info.size, sha256: cached.sha256 };
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const sha256 = hash.digest('hex');
    hashCache.delete(file); hashCache.set(file, { stamp, sha256 });
    if (hashCache.size > HASH_CACHE_LIMIT) hashCache.delete(/** @type {string} */ (hashCache.keys().next().value)); // not empty
    return { path: relative, bytes: info.size, sha256 };
  } finally { await handle.close(); }
}
/** @param {string} root @param {{ path: string, sha256: string }[]} [records] */
export async function unchanged(root, records) {
  for (const record of records ?? []) {
    try { if ((await fingerprint(root, record.path)).sha256 !== record.sha256) return false; }
    catch { return false; }
  }
  return true;
}

/** @param {string} root @param {{ contextRequest?: typeof fetch, validatePackage?: ReturnType<typeof makePackageValidator> }} [options] */
export function createCreationStore(root, { contextRequest, validatePackage = makePackageValidator(root) } = {}) {
  /** @type {(id: string) => string} */
  const prefix = id => `output/${checkId(id)}-work`;
  /** @type {(id: string, file: string) => Promise<string>} */
  const fileFor = (id, file) => localPath(root, `${prefix(id)}/${file}`);
  const latestContext = () => fetchCreationContext({ request: contextRequest });
  // Parallel tool calls on one session queue here; a lock left by a killed process is reclaimed once stale.
  /** @template T @param {string} id @param {() => Promise<T>} action @param {{ waitMs?: number }} [options] @returns {Promise<T>} */
  async function lock(id, action, { waitMs } = {}) {
    return withFileLock(await fileFor(id, 'creation.lock'), action, { busy: 'session-busy-or-interrupted-lock', waitMs });
  }
  /** @param {string} id @returns {Promise<Session>} */
  async function read(id) {
    const state = await readJson(await fileFor(id, 'creation-session.json'));
    if (state.storeVersion !== 1 || state.sessionId !== id) fail('session-incompatible');
    return state;
  }
  /** @param {string} id @param {Session} state */
  async function save(id, state) {
    state.updatedAt = new Date().toISOString();
    await atomicJson(await fileFor(id, 'creation-session.json'), state);
  }
  /** @param {Session} state @param {string} item */
  function itemGroup(state, item) {
    const group = state.context.workflow.groups.find(g => [...g.motions, ...(g.auxiliaries ?? [])].includes(item));
    if (!group) fail('unknown-item');
    return group;
  }
  /** @param {Session} state @param {string} item */
  function basisFor(state, item) {
    const groups = state.context.workflow.groups, index = groups.findIndex(g => g.id === itemGroup(state, item).id);
    return Object.fromEntries(groups.slice(0, index).flatMap(g => [...g.motions, ...(g.auxiliaries ?? [])])
      .map(key => [key, state.items[key]?.version ?? null]));
  }
  /** @param {Session} state */
  async function effective(state) {
    const view = structuredClone(state);
    /** @type {{ item: string, reason: string }[]} */
    const problems = [];
    const itemIds = state.context.workflow.groups.flatMap(g => [...g.motions, ...(g.auxiliaries ?? [])]);
    for (const id of itemIds) {
      const item = view.items[id];
      if (!item) continue;
      const version = item.versions[item.version];
      const currentBasis = basisFor(state, id);
      // A stale review of an earlier item is that item's to redo; the items made on its unchanged files stand.
      const basisValid = Object.entries(version.basis).every(([key, value]) => currentBasis[key] === value &&
        !problems.some(p => p.item === key && p.reason !== 'review-stale'));
      const valid = basisValid && await unchanged(root, version.files);
      item.filesValid = valid;
      const reviewed = version.review?.contextRevision === state.contextRevision && await unchanged(root, version.review?.evidence);
      item.review = valid && reviewed ? version.review?.verdict ?? 'unverified' : 'unverified';
      if (!valid) { item.selectedVersion = null; problems.push({ item: id, reason: basisValid ? 'files-changed-or-missing' : 'basis-changed' }); }
      if (version.review && !reviewed) problems.push({ item: id, reason: 'review-stale' });
    }
    view.profile = { ...state.profile, selected: Boolean(state.profile?.selected) };
    view.packageFilesValid = Boolean(state.package?.fileValidation && state.package.contextRevision === state.contextRevision &&
      state.package.basisHash === packageBasis(state) && await unchanged(root, state.package.files));
    view.packageReview = state.package?.review?.verdict === 'passed' &&
      state.package.contextRevision === state.contextRevision &&
      state.package.basisHash === packageBasis(state) &&
      await unchanged(root, state.package.files) && await unchanged(root, state.package.review.evidence) ? 'passed' : 'unverified';
    return { view, problems };
  }
  /** @type {(state: Session) => string} */
  const packageBasis = state => digest(JSON.stringify({ profile: state.profile,
    items: Object.fromEntries(Object.entries(state.items).map(([k, v]) => [k, v.version])) }));
  /** @param {string} id */
  async function inspect(id) {
    const state = await read(id), { view, problems } = await effective(state);
    let decision, contextError;
    try { decision = reviewCreationProgress(await latestContext(), view); }
    catch (error) { contextError = errorCode(error, 'creation-context-unavailable', { prefix: 'creation-context-' }); }
    return { state, effectiveItems: Object.fromEntries(Object.entries(view.items).map(([k, v]) => [k,
      { version: v.version, selectedVersion: v.selectedVersion, review: v.review, filesValid: v.filesValid }])), problems,
      decision: decision ?? { canAdvance: false, blockers: [contextError], nextGroup: null, registrationAuthorized: false } };
  }
  /** @param {{ sessionId: string, brief: string, mode?: 'creation' | 'dialogue-only' }} options */
  async function create({ sessionId, brief, mode = 'creation' }) {
    checkId(sessionId); note.parse(brief); z.enum(['creation', 'dialogue-only']).parse(mode);
    const context = await latestContext();
    await localPath(root, prefix(sessionId), { createParents: true, directory: true });
    return lock(sessionId, async () => {
      const filename = await fileFor(sessionId, 'creation-session.json');
      if (await lstat(filename).then(() => true, e => { if (e.code !== 'ENOENT') throw e; return false; })) fail('session-exists');
      /** @type {Session} */
      const state = { storeVersion: 1, sessionId, revision: 1, brief, mode, contextRevision: context.revision, context,
        groupId: 'appearance', items: {}, pendingEdits: [], delegatedGroups: [], profile: {}, history: [] };
      await save(sessionId, state); return state;
    });
  }
  /** @param {string[]} paths */
  async function snapshots(paths) { return Promise.all([...new Set(paths)].map(p => fingerprint(root, p))); }
  /** @param {Session} state @param {string} item @param {string} version */
  function current(state, item, version) {
    itemGroup(state, item);
    if (state.items[item]?.version !== version) fail('version-is-not-current');
    return state.items[item].versions[version];
  }
  /** @param {string} id @param {number} revision @param {unknown} input */
  async function change(id, revision, input) {
    const event = changeSchema.parse(input);
    return lock(id, async () => {
      const state = await read(id);
      if (state.revision !== revision) fail('session-revision-conflict');
      const context = await latestContext();
      if (event.type !== 'refresh-context' && context.revision !== state.contextRevision) fail('context-changed');
      // One handler per changeSchema type; changeSchema.parse above has rejected any other.
      /** @type {{ [T in ChangeEvent['type']]: (event: Extract<ChangeEvent, { type: T }>) => Promise<void> }} */
      const apply = {
        version: async event => {
          const group = itemGroup(state, event.item), item = state.items[event.item] ?? /** @type {SessionItem} */ ({ selectedVersion: null, versions: {} }); // version set below
          if (Object.hasOwn(item.versions, event.version)) fail('version-already-exists');
          const groupIndex = context.workflow.groups.findIndex(g => g.id === group.id);
          const { view } = await effective(state);
          if (groupIndex > 0) {
            const decision = reviewCreationProgress(context, { ...view, groupId: context.workflow.groups[groupIndex - 1].id });
            if (!decision.canAdvance) fail('previous-group-pending');
          }
          const source = await snapshots(event.files), recorded = [];
          // This version is not recorded, so a folder for it is what an interrupted copy left: start it over. A failed
          // copy removes its partial files too, so the same version can be retried instead of failing on EEXIST.
          const versionFolder = `${prefix(id)}/versions/${event.item}/${event.version}`;
          const clear = async () => rm(await localPath(root, versionFolder), { recursive: true, force: true });
          await clear();
          try {
            for (const file of source) {
              // Keep relative layout between declared metadata and assets; never rewrite their bytes.
              const relative = `${versionFolder}/files/${file.path}`;
              const destination = await localPath(root, relative, { createParents: true });
              await copyFile(await localPath(root, file.path), destination, constants.COPYFILE_EXCL);
              const copied = await fingerprint(root, relative);
              if (copied.sha256 !== file.sha256) fail('source-changed-during-snapshot');
              recorded.push({ ...copied, sourcePath: file.path });
            }
          } catch (error) { await clear(); throw error; }
          item.versions[event.version] = { files: recorded, basis: basisFor(state, event.item), note: event.note,
            createdAt: new Date().toISOString() };
          item.version = event.version; state.items[event.item] = item;
          state.pendingEdits = state.pendingEdits.filter(key => key !== event.item);
          if (groupIndex < context.workflow.groups.findIndex(g => g.id === state.groupId)) state.groupId = group.id;
        },
        review: async event => {
          const version = current(state, event.item, event.version);
          if ((state.mode === 'dialogue-only') !== (event.verdict === 'hypothetical')) {
            if (state.mode === 'dialogue-only' || event.verdict === 'hypothetical') fail('review-mode-mismatch');
          }
          if (!await unchanged(root, version.files)) fail('version-files-changed');
          version.review = { verdict: event.verdict, evidence: await snapshots(event.evidence), note: event.note,
            contextRevision: state.contextRevision, source: 'agent-observation' };
        },
        select: async event => {
          const version = current(state, event.item, event.version);
          if (!await unchanged(root, version.files)) fail('version-files-changed');
          state.items[event.item].selectedVersion = event.version;
          version.feedback = event.feedback;
        },
        restore: async event => {
          const group = itemGroup(state, event.item), item = state.items[event.item];
          const version = item?.versions[event.version];
          if (!version || !await unchanged(root, version.files)) fail('stored-version-unavailable');
          item.version = event.version; item.selectedVersion = event.version; version.feedback = event.feedback;
          state.pendingEdits = state.pendingEdits.filter(key => key !== event.item);
          state.groupId = group.id;
        },
        revision: async event => {
          const group = itemGroup(state, event.item);
          if (!state.pendingEdits.includes(event.item)) state.pendingEdits.push(event.item);
          if (context.workflow.groups.findIndex(g => g.id === group.id) < context.workflow.groups.findIndex(g => g.id === state.groupId))
            state.groupId = group.id;
        },
        delegate: async event => {
          if (event.groups.some(g => !context.workflow.groups.some(group => group.id === g))) fail('unknown-group');
          state.delegatedGroups = [...new Set(event.groups)];
        },
        profile: async event => {
          const { type, feedback, ...profile } = event;
          state.profile = { ...profile, selected: true };
        },
        package: async event => {
          const manifests = event.files.filter(p => p.endsWith('/fighter.json'));
          if (manifests.length !== 1) fail('package-manifest-required');
          const validation = await validatePackage(manifests[0]);
          if (!validation.ok) fail('package-file-validation-failed');
          /** @type {{ profile: Record<string, unknown>, combat: { stats?: object, style?: object }, clips: Record<string, object>, assets: { path: string }[] }} */
          const manifest = await readJson(await localPath(root, manifests[0])); // its file validation passed above
          // The package carries exactly the recorded profile: an extra absent from one side is a mismatch too.
          /** @type {(value: unknown) => string} */
          const canonical = value => JSON.stringify(value ?? null, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
            ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v);
          /** @type {(a: unknown, b: unknown) => boolean} */
          const same = (a, b) => canonical(a) === canonical(b);
          if (['name', 'description', 'language', 'concept', 'moves', 'names', 'lines'].some(key => !same(manifest.profile[key], state.profile[key]))
            || !same(manifest.combat.stats, state.profile.stats) || !same(manifest.combat.style, state.profile.style)) fail('package-profile-mismatch');
          // Optional clips never block a group, so the package is where they are held: each one it carries is a tracked, accepted item.
          const { view } = await effective(state);
          for (const id of Object.keys(spec.optionalClips).filter(id => Object.hasOwn(manifest.clips, id))) {
            const group = state.context.workflow.groups.find(g => g.motions.includes(id));
            if (!group || itemBlockers(view, group, id).length) fail('package-optional-clip-unselected-or-invalid');
          }
          const base = path.posix.dirname(manifests[0]);
          const allFiles = [...event.files, ...manifest.assets.map(asset => `${base}/${asset.path}`)];
          state.package = { files: await snapshots(allFiles), basisHash: packageBasis(state), contextRevision: state.contextRevision,
            fileValidation: { stage: validation.stage, pending: validation.pending } };
        },
        'package-review': async event => {
          if (!state.package || !await unchanged(root, state.package.files) || state.package.basisHash !== packageBasis(state)) fail('package-stale');
          state.package.review = { verdict: event.verdict, evidence: await snapshots(event.evidence), feedback: event.feedback,
            source: 'agent-observation' };
        },
        advance: async () => {
          const { view } = await effective(state), decision = reviewCreationProgress(context, view);
          if (!decision.canAdvance) fail('group-review-pending');
          if (!decision.nextGroup) fail('already-final-group');
          state.groupId = decision.nextGroup;
        },
        'refresh-context': async () => {
          state.context = context; state.contextRevision = context.revision;
        },
      };
      await /** @type {(event: ChangeEvent) => Promise<void>} */ (apply[event.type])(event);
      const entry = { ...event, at: new Date().toISOString(), revision: ++state.revision };
      // The full trail is append-only beside the session; the session keeps recent entries so it stays under the 2 MB read limit.
      await appendFile(await fileFor(id, 'creation-history.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 });
      state.history = [...state.history, entry].slice(-HISTORY_KEPT);
      await save(id, state); return state;
    });
  }
  async function list() {
    const dir = await localPath(root, 'output');
    const entries = await readdir(dir, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    const sessions = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.endsWith('-work')) continue;
      const id = entry.name.slice(0, -5);
      if (!identifier.safeParse(id).success) continue;
      try { const s = await read(id); sessions.push({ sessionId: id, revision: s.revision, groupId: s.groupId, updatedAt: /** @type {string} */ (s.updatedAt), brief: s.brief }); } // save() sets it
      catch { /* Other legacy work directories are not sessions. */ }
    }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return { root, prefix, fileFor, read, create, change, inspect, effective, latestContext, lock, list, snapshots };
}
/** @typedef {ReturnType<typeof createCreationStore>} CreationStore */
