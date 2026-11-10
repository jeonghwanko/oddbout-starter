// @ts-check
// Register a local fighter package with the owner's `npm run login` session.
// Hosts that cannot pass files to prepare_fighter_registration (no OpenAI fileParams) use this instead of inventing URLs.
// Usage:
//   npm run fighter:register -- --dir <package dir or fighter.json> [--fighter <uuid>] [--idempotency-key <uuid>] [--session <file>]
//   npm run fighter:register -- --dir <package> --submit
// Without --submit the command validates, saves the idempotency key and prints the requests. It does not contact the server.
import { createHash, randomUUID } from 'node:crypto';
import { constants, realpathSync } from 'node:fs';
import { lstat, open, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRemoteClient, transferTimeoutMs } from '../api/client.mjs';
import { parseFighterJson, validateFighter } from '../contracts/ai-fighter/validate.mjs';
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { validateFighterPackage } from '../server/ai-fighter-package.mjs';
import { lintBorrowedLandmarks } from '../tools/ai-fighter/landmark-lint.mjs';
import { withFileLock } from '../mcp/file-lock.mjs';
import { pathWithoutLinks, relativeParts, renameRetrying } from '../plugins/ai-fighter/local-files.mjs';
import { defaultSessionPath } from './login.mjs';
import { createDummyClient } from '../tools/flow/client.mjs';
import { assertDummyBase, DUMMY_LABEL, manifestSealed, sidecarSealed } from '../tools/flow/seal.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_FILE = '.oddbout-registration.json';
const POLL_LIMIT = 60;
const POLL_MS = 10_000;
/** @typedef {{ request: (route: string, options?: { method?: string, body?: any, headers?: Record<string, string>, timeoutMs?: number }) => Promise<any> }} Client */
/** @typedef {{ id: string, bytes: Buffer }} PackageFile */
/** @typedef {{ idempotencyKey: string, manifestSha256: string, fighterId: string | null, submissionId: string | null }} RegistrationAttempt */
/** @typedef {RegistrationAttempt & { version: 2, attempts: RegistrationAttempt[] }} RegistrationRecord */

export const USAGE = [
  'npm run fighter:register -- --dir <package dir or fighter.json> [--fighter <uuid>] [--idempotency-key <uuid>] [--session <file>]',
  'Add --submit to upload each asset, submit, and poll until registered or rejected. Without --submit this is a dry run.',
  'Idempotency keys are saved beside the package and reused for the same manifest bytes and fighter id, including restored versions.',
  'pending and pendingStages are pipeline stage names, never asset ids. This command uploads package files, or missingAssets when the server confirmed them.',
  '--dummy http://127.0.0.1:<port> submits only to a loopback ODDBOUT-DUMMY server. A package marked ODDBOUT-DUMMY is refused without it.',
].join('\n');

const sha256 = (/** @type {Uint8Array} */ bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {any} value @returns {boolean} */
function validAttempt(value) {
  return Boolean(
    value &&
    typeof value.idempotencyKey === 'string' &&
    UUID.test(value.idempotencyKey) &&
    typeof value.manifestSha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.manifestSha256) &&
    (value.fighterId === null || (typeof value.fighterId === 'string' && UUID.test(value.fighterId))) &&
    (value.submissionId === null || (typeof value.submissionId === 'string' && UUID.test(value.submissionId))),
  );
}

/** @param {RegistrationAttempt} value @returns {RegistrationAttempt} */
function normalizedAttempt(value) {
  return {
    idempotencyKey: value.idempotencyKey.toLowerCase(),
    manifestSha256: value.manifestSha256,
    fighterId: value.fighterId?.toLowerCase() ?? null,
    submissionId: value.submissionId?.toLowerCase() ?? null,
  };
}

/** @param {string} recordPath @returns {Promise<RegistrationRecord | null>} */
async function readRegistrationRecord(recordPath) {
  let text;
  try {
    text = await readFile(recordPath, 'utf8');
  } catch (/** @type {any} */ error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('registration-record-unreadable');
  }
  try {
    const saved = JSON.parse(text);
    if (!validAttempt(saved)) throw new Error('invalid-record');
    const current = normalizedAttempt(saved);
    if (saved.version === undefined && saved.attempts === undefined) return { ...current, version: /** @type {const} */ (2), attempts: [current] };
    if (saved.version !== 2 || !Array.isArray(saved.attempts) || !saved.attempts.length || !saved.attempts.every(validAttempt))
      throw new Error('invalid-record');
    const attempts = /** @type {RegistrationAttempt[]} */ (saved.attempts).map(normalizedAttempt);
    if (new Set(attempts.map(attempt => attempt.idempotencyKey)).size !== attempts.length) throw new Error('invalid-record');
    const selected = attempts.find(attempt => attempt.idempotencyKey === current.idempotencyKey);
    if (!selected || JSON.stringify(selected) !== JSON.stringify(current)) throw new Error('invalid-record');
    return { ...current, version: /** @type {const} */ (2), attempts };
  } catch {
    throw new Error('registration-record-invalid');
  }
}

/** Replace the sidecar only after the complete new record is written. Call under its lock.
 * @param {string} recordPath @param {object} record
 */
async function writeRegistrationRecord(recordPath, record) {
  const temporary = `${recordPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(record, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await renameRetrying(temporary, recordPath);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {string[]} */
  const positional = [];
  /** @type {Record<string, string | true>} */
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (!['submit', 'dry-run', 'help', 'dir', 'fighter', 'idempotency-key', 'session', 'dummy'].includes(name)) throw new Error(`invalid-flag:--${name}`);
    if (Object.hasOwn(flags, name)) throw new Error(`invalid-args:duplicate--${name}`);
    if (['submit', 'dry-run', 'help'].includes(name)) flags[name] = true;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[name] = argv[++i];
    else throw new Error(`missing-value:--${name}`);
  }
  if (flags.submit === true && flags['dry-run'] === true) throw new Error('invalid-args:--submit');
  if (positional.length > 1 || (flags.dir !== undefined && positional.length)) throw new Error('invalid-args:--dir');
  return { positional, flags };
}

/** @param {string | undefined} value @param {string} what */
function id(value, what) {
  if (value === undefined) return undefined;
  if (!UUID.test(value)) throw new Error(`invalid-id:${what}`);
  return value.toLowerCase();
}

/** Read regular files only, retaining at most the declared limit in memory.
 * @param {string} file @param {number} limit @param {string} code
 */
async function readBoundedFile(file, limit, code) {
  const entry = await lstat(file);
  if (!entry.isFile() || entry.size > limit) throw new Error(code);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new Error(code);
    const chunks = [];
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length;
      if (size > limit) throw new Error(code);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  } finally {
    await handle.close();
  }
}

/**
 * A package on disk as the contract checks it, with every asset's bytes matching the manifest.
 * Throws `package-invalid` or `asset-mismatch:<id>` or `asset-escape:<id>`.
 * @param {string} where
 */
export async function readFighterPackage(where) {
  const manifestPath = (await stat(where)).isDirectory() ? path.join(where, 'fighter.json') : where;
  const root = await realpath(path.dirname(path.resolve(manifestPath)));
  if (!(await pathWithoutLinks(root, [path.basename(manifestPath)], { allowMissing: false }))) throw new Error('package-symlink');
  const text = (await readBoundedFile(manifestPath, spec.limits.jsonBytes, 'package-invalid')).toString('utf8');
  const parsed = parseFighterJson(text);
  const checked = parsed.ok ? validateFighter(parsed.data) : parsed;
  if (!parsed.ok || !checked.ok) throw Object.assign(new Error('package-invalid'), { errors: (checked.errors ?? []).slice(0, 10) });
  /** @type {{ id: string, path: string, bytes: number, sha256: string }[]} */
  const assets = parsed.data.assets;
  /** @type {PackageFile[]} */
  const files = [];
  for (const asset of assets) {
    const parts = relativeParts(asset.path, /[\\\0]/);
    const file = parts && (await pathWithoutLinks(root, parts, { allowMissing: false }));
    if (!file) throw new Error(`asset-escape:${asset.id}`);
    const bytes = await readBoundedFile(file, asset.bytes, `asset-mismatch:${asset.id}`);
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) throw new Error(`asset-mismatch:${asset.id}`);
    files.push({ id: asset.id, bytes });
  }
  const fileCheck = await validateFighterPackage(manifestPath);
  if (!fileCheck.ok) throw Object.assign(new Error('package-invalid'), { errors: (fileCheck.errors ?? []).slice(0, 10) });
  return { text, sha: sha256(Buffer.from(text, 'utf8')), name: parsed.data.profile?.name ?? '', files, data: parsed.data, directory: root };
}

/**
 * Which local files to PUT. `pending` is never read as asset ids: it holds stage names on this API.
 * A confirmed `missingAssets` list uploads only those ids. Otherwise every local asset is sent (identical bytes retry).
 * @param {any} state
 * @param {PackageFile[]} files
 */
export function assetsToUpload(state, files) {
  if (state?.stage !== 'uploading' || state?.code === 'upload-expired') return [];
  if (state.assetUploadState === 'confirmed' && Array.isArray(state.missingAssets)) {
    const ids = new Set(state.missingAssets.map((/** @type {any} */ asset) => (typeof asset === 'string' ? asset : asset?.id)).filter(Boolean));
    return files.filter(file => ids.has(file.id));
  }
  return files;
}

/**
 * @param {string} directory
 * @param {{ manifestSha256: string, fighterId: string | null, explicit?: string }} identity
 */
async function idempotencyKey(directory, { manifestSha256, fighterId, explicit }) {
  const recordPath = path.join(directory, KEY_FILE);
  return withFileLock(
    `${recordPath}.lock`,
    async () => {
      const saved = await readRegistrationRecord(recordPath);
      const attempts = saved?.attempts ?? [];
      const reusable = explicit
        ? attempts.find(attempt => attempt.idempotencyKey === explicit)
        : attempts.findLast(attempt => attempt.manifestSha256 === manifestSha256 && attempt.fighterId === fighterId);
      if (reusable && (reusable.manifestSha256 !== manifestSha256 || reusable.fighterId !== fighterId)) throw new Error('idempotency-conflict');
      const key = explicit ?? reusable?.idempotencyKey ?? randomUUID();
      const selected = {
        idempotencyKey: key,
        manifestSha256,
        fighterId,
        submissionId: reusable?.submissionId ?? null,
      };
      // Keep every key; selection order makes an explicitly chosen older key the default for its tuple again.
      const record = { ...selected, version: 2, attempts: [...attempts.filter(attempt => attempt.idempotencyKey !== key), selected] };
      await writeRegistrationRecord(recordPath, record);
      return { key, recordPath, reused: Boolean(reusable), submissionId: selected.submissionId };
    },
    { busy: 'registration-record-busy' },
  );
}

/** @param {string} recordPath @param {string} key @param {string} submissionId */
async function rememberSubmission(recordPath, key, submissionId) {
  try {
    await withFileLock(
      `${recordPath}.lock`,
      async () => {
        const saved = await readRegistrationRecord(recordPath);
        const attempt = saved?.attempts.find(attempt => attempt.idempotencyKey === key);
        if (!saved || !attempt || !UUID.test(submissionId)) return;
        attempt.submissionId = submissionId.toLowerCase();
        if (saved.idempotencyKey === key) saved.submissionId = attempt.submissionId;
        await writeRegistrationRecord(recordPath, saved);
      },
      { busy: 'registration-record-busy' },
    );
  } catch {
    /* the key file is a convenience; the server still resumes from the idempotency key */
  }
}

/**
 * @param {{ argv?: string[], env?: NodeJS.ProcessEnv, connect?: (sessionPath: string) => Promise<Client>, wait?: (ms: number) => Promise<unknown> }} [options]
 */
export async function runRegister({
  argv = process.argv.slice(2),
  env = process.env,
  connect = createRemoteClient,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const { positional, flags } = parseArgs(argv);
  if (flags.help === true) return { ok: true, usage: USAGE };
  const where = typeof flags.dir === 'string' ? flags.dir : positional[0];
  if (!where || positional.length > 1) throw new Error('missing-value:--dir');
  const fighterId = id(typeof flags.fighter === 'string' ? flags.fighter : undefined, 'fighter') ?? null;
  const explicitKey = id(typeof flags['idempotency-key'] === 'string' ? flags['idempotency-key'] : undefined, 'idempotency-key');
  const pkg = await readFighterPackage(where);
  const dummyBase = typeof flags.dummy === 'string' ? flags.dummy : undefined;
  /** @type {URL | undefined} */
  let dummyUrl;
  if (dummyBase) {
    try {
      dummyUrl = assertDummyBase(dummyBase);
    } catch (/** @type {any} */ error) {
      const code = error instanceof Error ? error.message : String(error);
      return { ok: false, code, name: pkg.name, manifestSha256: pkg.sha, production: false, hint: HINTS[code] ?? HINTS['dummy-url-not-loopback'] };
    }
  }
  if ((manifestSealed(pkg.data) || (await sidecarSealed(pkg.directory))) && !dummyUrl) {
    return {
      ok: false,
      code: 'dummy-package-refused',
      name: pkg.name,
      manifestSha256: pkg.sha,
      production: false,
      label: DUMMY_LABEL,
      hint: HINTS['dummy-package-refused'],
    };
  }
  const warnings = lintBorrowedLandmarks(pkg.data);
  const stored = await idempotencyKey(pkg.directory, { manifestSha256: pkg.sha, fighterId, explicit: explicitKey });
  const route = fighterId ? `submissions?fighter=${encodeURIComponent(fighterId)}` : 'submissions';
  const request = { method: 'POST', route, idempotencyKey: stored.key };
  const summary = {
    fighterId,
    name: pkg.name,
    manifestSha256: pkg.sha,
    assets: pkg.files.map(file => ({ id: file.id, bytes: file.bytes.length })),
    ...(warnings.length ? { warnings } : {}),
    idempotencyKey: stored.key,
    idempotencyKeyReused: stored.reused,
    idempotencyKeyPath: stored.recordPath,
    ...(stored.submissionId ? { submissionId: stored.submissionId } : {}),
    request,
  };
  if (flags.submit !== true) {
    return {
      ok: true,
      dryRun: true,
      ...summary,
      ...(dummyUrl ? { mode: 'dummy', production: false, label: DUMMY_LABEL, dummyBase: dummyUrl.origin } : {}),
      next: dummyUrl
        ? 'Dry run only: the package was checked locally and the server was not contacted. --submit with this --dummy URL talks only to that loopback ODDBOUT-DUMMY server.'
        : 'Dry run only: the package was checked locally and the server was not contacted. Re-run with --submit after the user asks to register.',
    };
  }
  const sessionPath = typeof flags.session === 'string' ? flags.session : env.AI_FIGHTER_CLIENT_CONFIG || defaultSessionPath();
  let client;
  try {
    client = dummyUrl ? await createDummyClient(dummyUrl) : await connect(sessionPath);
  } catch (/** @type {any} */ error) {
    const code = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: code === 'ENOENT' || code.includes('ENOENT') ? 'client-sign-in-required' : code,
      ...summary,
      hint: HINTS[code] ?? HINTS['client-sign-in-required'],
    };
  }
  /** @param {string} called @param {{ method?: string, body?: any, headers?: Record<string, string>, timeoutMs?: number }} [options] */
  const call = async (called, options) => {
    try {
      return await client.request(called, options);
    } catch (/** @type {any} */ error) {
      const code = error instanceof Error ? error.message : String(error);
      throw Object.assign(new Error(code), { status: error?.status });
    }
  };
  let state;
  try {
    state = await call(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': stored.key },
      body: pkg.text,
      timeoutMs: transferTimeoutMs(Buffer.byteLength(pkg.text)),
    });
  } catch (/** @type {any} */ error) {
    const code = error instanceof Error ? error.message : String(error);
    return { ok: false, code, ...summary, hint: HINTS[code] };
  }
  if (state?.submissionId) await rememberSubmission(stored.recordPath, stored.key, state.submissionId);
  const uploaded = [];
  try {
    if (state?.stage === 'uploading' && state.code !== 'upload-expired') {
      for (const file of assetsToUpload(state, pkg.files)) {
        await call(`submissions/${state.submissionId}/assets/${file.id}`, {
          method: 'PUT',
          headers: { 'content-type': 'image/webp' },
          body: file.bytes,
          timeoutMs: transferTimeoutMs(file.bytes.length),
        });
        uploaded.push(file.id);
      }
      state = await call(`submissions/${state.submissionId}/submit`, { method: 'POST' });
    }
  } catch (/** @type {any} */ error) {
    const code = error instanceof Error ? error.message : String(error);
    return { ok: false, code, ...summary, submissionId: state?.submissionId, uploadedAssets: uploaded, hint: HINTS[code] };
  }
  let polls = 0;
  try {
    for (; state && !['registered', 'rejected'].includes(state.stage) && state.code !== 'upload-expired' && polls < POLL_LIMIT; polls++) {
      await wait(POLL_MS);
      state = await call(`submissions/${state.submissionId}`);
    }
  } catch (/** @type {any} */ error) {
    const failed = error instanceof Error ? error.message : String(error);
    return { ok: false, code: failed, ...summary, submissionId: state?.submissionId, uploadedAssets: uploaded, polls, hint: HINTS[failed] };
  }
  const finished = ['registered', 'rejected'].includes(state?.stage) || state?.code === 'upload-expired';
  const code =
    state?.stage === 'registered'
      ? undefined
      : state?.code === 'upload-expired'
        ? 'upload-expired'
        : state?.stage === 'rejected'
          ? 'validation-rejected'
          : 'validation-timeout';
  return {
    ...state,
    ok: state?.stage === 'registered',
    ...(code ? { code } : {}),
    ...(code && HINTS[code] ? { hint: HINTS[code] } : {}),
    uploadedAssets: uploaded,
    polls,
    idempotencyKey: stored.key,
    idempotencyKeyReused: stored.reused,
    idempotencyKeyPath: stored.recordPath,
    ...(warnings.length ? { warnings } : {}),
    ...(finished
      ? {}
      : { next: 'Validation did not finish in time. Poll the same submission again. Reuse this idempotency key; do not mint a new one for the same bytes.' }),
  };
}

const HINTS = /** @type {Record<string, string>} */ ({
  'registration-record-invalid':
    'The saved registration record is damaged. Recover its original idempotency key from the previous result or server before retrying; do not replace it with a new key.',
  'registration-record-unreadable': 'The saved registration record could not be read. Restore access to it before retrying; do not replace it with a new key.',
  'registration-record-busy': 'Another command is updating the registration record. Retry the same command after it finishes.',
  'package-invalid': 'The package failed the contract check (errors). Fix it and run npm run validate before --submit.',
  'client-sign-in-required': 'No owner session. Run npm run login (on a VM, npm run login -- --device, then --device-wait).',
  'invalid-client-config': 'The session file is missing a project URL, publishable key or token. Run npm run login.',
  'assets-incomplete': 'The server still wants WebP bytes. pending is stage names, not asset ids. Re-run --submit with the same idempotency key.',
  'idempotency-conflict': 'This key already names a different package. Pass a new --idempotency-key.',
  'validation-rejected': 'The server rejected the package (validation). Do not regenerate art that was not asked for.',
  'validation-timeout': 'Registration did not finish while polling. Read the same submission again with the same key.',
  'upload-expired':
    'The server confirmed that this upload window closed. Submit again with a new --idempotency-key UUID; preserve the registration record and its earlier keys.',
  'fighter-quota': "This account is at its fighter limit (default 3, or that account's fighter_limit). Revise with --fighter instead of registering another.",
  'dummy-package-refused':
    'This package is marked ODDBOUT-DUMMY. fighter:register will not send it to the live server. Use --dummy http://127.0.0.1:<port> for the loopback dummy server.',
  'dummy-url-not-loopback': 'Pass --dummy as http://127.0.0.1:<port> with no path. Other hosts are refused before any request.',
  'dummy-url-refused': 'That URL looks like a live service. --dummy only accepts a loopback ODDBOUT-DUMMY server.',
  'dummy-handshake-failed': 'The loopback server did not identify itself as ODDBOUT-DUMMY. Nothing was submitted.',
  'dummy-response-unlabelled': 'A response was missing the dummy label. The client stopped before treating it as ODDBOUT.',
  'dummy-unreachable': 'The loopback dummy server did not answer. No other host was tried.',
});

function isEntry() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) {
  runRegister().then(
    answer => {
      console.log(JSON.stringify(answer, null, 2));
      if (answer.ok === false) process.exitCode = 1;
    },
    error => {
      const code = error instanceof Error ? error.message : String(error);
      const errors = /** @type {any} */ (error)?.errors;
      const hint = HINTS[code] ?? HINTS[code.split(':')[0]] ?? (code.startsWith('missing-value') || code.startsWith('invalid-') ? USAGE : undefined);
      console.log(JSON.stringify({ ok: false, code, ...(errors ? { errors } : {}), ...(hint ? { hint } : {}) }, null, 2));
      process.exitCode = 1;
    },
  );
}
