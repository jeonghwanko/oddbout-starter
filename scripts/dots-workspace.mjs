// @ts-check
// Offline by default. Installation, CLI/auth probes, public network probes and report writes are explicit.
import { execFile } from 'node:child_process';
import { access, lstat, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { INSTALL_OUTCOME_UNKNOWN, directoryEntries, fail, fingerprint, readRecord, safePath, sha256, writableDirectory } from './dots-safety.mjs';
import { inspectProvider } from './dots-provider.mjs';
import { inspectGrokAuthStorage } from './dots-auth-storage.mjs';

/**
 * @typedef {{ runtime?: string, workspace: string, cache?: string, provider?: string, evidence?: string, report?: string, manifestSha256?: string,
 *   install?: boolean, checkCli?: boolean, checkAuth?: boolean, checkNetwork?: boolean }} DotsOptions
 * @typedef {{ run?: typeof runCommand, find?: typeof findBinary, now?: number, env?: NodeJS.ProcessEnv, fetchPublic?: typeof fetch }} DoctorDeps
 * @typedef {{ distribution: string, manifestSha256?: string, vendorPin?: string | null, verifiedFiles?: number, commit?: string, dirty?: boolean,
 *   publishedBranch?: boolean, versionPolicy?: string, vendorMatchesPin?: boolean | null, vendorDirty?: boolean }} KitSource
 * @typedef {{ host: string, httpStatus?: number, status: string }} ProbeResult
 * @typedef {Awaited<ReturnType<typeof evidenceReport>>} Evidence
 * @typedef {{ schemaVersion: number, checkedAt: string, environmentId: string, host: { kind: string, os: string, arch: string, node: string, identity: string },
 *   runtime: string, workspace: string, cache: string, network: { status: string, coverage?: string, reason?: string, results?: ProbeResult[] },
 *   auth: { status: string, reason?: string, scope?: string, accountIdentity?: string, imageAccess?: string, videoAccess?: string,
 *     storage?: Awaited<ReturnType<typeof inspectGrokAuthStorage>> },
 *   readyForGeneration: boolean, generationVerified: boolean, automaticDispatch: boolean,
 *   kit?: Partial<KitSource> & { status?: string, version?: string, lockSha256?: string, dependenciesPresent?: boolean },
 *   paths?: Record<string, Awaited<ReturnType<typeof writableDirectory>>>,
 *   tools?: Record<string, { status: string, actor?: string, required?: boolean, nextAction?: string }>,
 *   provider?: Awaited<ReturnType<typeof inspectProvider>>, delivery?: Evidence['delivery'], registration?: Evidence['registration'], reason?: string,
 *   recovery?: Awaited<ReturnType<typeof resume>>, blockers?: string[], status?: string }} DoctorReport
 */
export const defaultRuntime = fileURLToPath(new URL('../', import.meta.url));
const identifier = /^[a-z][a-z0-9-]{0,63}$/;
const jobId = /^[a-f0-9-]{36}$/i;
const statuses = new Set(['prepared', 'running', 'succeeded', 'failed', 'needs-input', 'unknown', 'resolved', 'cancelled']);
/** @param {string} value */
const nodeOkay = value => {
  const [major, minor] = value.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 12);
};
/**
 * @param {string} command @param {string[]} args @param {{ cwd?: string, env?: NodeJS.ProcessEnv, timeout?: number }} [options]
 * @returns {Promise<{ code: number, uncertain: boolean, text: string }>}
 */
export function runCommand(command, args, { cwd, env = process.env, timeout = 15000 } = {}) {
  if (command === 'npm' && process.platform === 'win32') {
    args = [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args];
    command = process.execPath;
  }
  return new Promise(resolve =>
    execFile(command, args, { cwd, env, timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) =>
      resolve({
        code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
        uncertain: Boolean(error?.killed || error?.signal),
        // Kept in memory for typed parsers; never copy raw child output into reports/errors.
        text: String(stdout ?? '') + String(stderr ?? ''),
      }),
    ),
  );
}
/** @param {string} name @param {NodeJS.ProcessEnv} [env] */
export async function findBinary(name, env = process.env) {
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)) {
    for (const suffix of process.platform === 'win32' ? ['', '.exe', '.cmd'] : ['']) {
      const candidate = path.join(dir, name + suffix);
      try {
        if ((await stat(candidate)).isFile()) {
          await access(candidate, constants.X_OK);
          return candidate;
        }
      } catch {
        /* unavailable */
      }
    }
  }
  return null;
}
/** @param {string} runtime @param {typeof runCommand} run @param {string} [expectedManifestSha256] */
async function metadata(runtime, run, expectedManifestSha256) {
  const pkg = await readRecord(await safePath('package.json', { root: runtime }));
  const lockBytes = await readFile(await safePath('package-lock.json', { root: runtime }));
  const lock = JSON.parse(/** @type {string} */ (/** @type {unknown} */ (lockBytes))),
    locked = lock.packages?.['']; // JSON.parse reads a Buffer as its text
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(pkg.version)) fail('invalid-kit-version');
  if (!locked || locked.version !== pkg.version || Object.entries(pkg.dependencies ?? {}).some(([name, version]) => locked.dependencies?.[name] !== version))
    fail('package-lock-mismatch');
  // Old main and pre-bootstrap bundles do not enforce the Dots dispatch boundary. Never install them
  // through this entry point merely because their package version/lockfile agree.
  if (pkg.scripts?.['dots:doctor'] !== 'node scripts/dots-workspace.mjs doctor') fail('dots-runtime-contract-missing');
  for (const file of ['scripts/dots-workspace.mjs', 'scripts/dots-provider.mjs', 'scripts/sprite-gen.mjs', 'mcp/creation-jobs.mjs']) {
    let source;
    try {
      source = await readFile(await safePath(file, { root: runtime }), 'utf8');
    } catch {
      fail('dots-runtime-contract-missing');
    }
    if (['scripts/sprite-gen.mjs', 'mcp/creation-jobs.mjs'].includes(file) && !source.includes('await guardDotsExecution('))
      fail('dots-runtime-contract-missing');
  }
  let bundle;
  try {
    bundle = await readRecord(await safePath('.bundle-manifest.json', { root: runtime }));
  } catch (/** @type {any} */ e) {
    if (e.code !== 'ENOENT') throw e;
  }
  /** @type {KitSource} */
  let source;
  if (bundle) {
    const manifestBytes = await readFile(await safePath('.bundle-manifest.json', { root: runtime }));
    const digest = sha256(manifestBytes);
    if (!/^[a-f0-9]{64}$/.test(expectedManifestSha256 ?? '')) fail('bundle-trust-anchor-required');
    if (expectedManifestSha256 !== digest) fail('bundle-integrity-invalid');
    const marker = await readFile(await safePath('.bundle-complete', { root: runtime }), 'utf8');
    if (marker !== digest || !bundle.files || bundle.distribution !== 'source') fail('bundle-integrity-invalid');
    for (const [relative, expected] of Object.entries(bundle.files)) {
      const file = await safePath(relative, { root: runtime });
      if (!/^[a-f0-9]{64}$/.test(expected) || !(await lstat(file)).isFile() || sha256(await readFile(file)) !== expected) fail('bundle-integrity-invalid');
    }
    source = { distribution: 'bundle', manifestSha256: digest, vendorPin: bundle.spriteGenCommit ?? null, verifiedFiles: Object.keys(bundle.files).length };
  } else {
    // A plugin directory or an old runtime missing provenance never falls back to installing as a checkout.
    const head = await run('git', ['rev-parse', '--show-toplevel'], { cwd: runtime });
    if (head.code || path.resolve(head.text.trim()) !== runtime) fail('source-or-bundle-layout-required');
    const commit = await run('git', ['rev-parse', 'HEAD'], { cwd: runtime });
    const pin = await run('git', ['ls-tree', 'HEAD', 'vendor/sprite-gen'], { cwd: runtime });
    const dirty = await run('git', ['status', '--porcelain', '--untracked-files=no', '--ignore-submodules=dirty'], { cwd: runtime });
    const branch = await run('git', ['branch', '--show-current'], { cwd: runtime });
    const vendorPin = pin.text.match(/^160000 commit ([a-f0-9]{40})\s/)?.[1];
    if (commit.code || !/^[a-f0-9]{40}$/.test(commit.text.trim()) || !vendorPin || dirty.code || branch.code) fail('source-metadata-unavailable');
    source = {
      distribution: 'source',
      commit: commit.text.trim(),
      vendorPin,
      dirty: Boolean(dirty.text.trim()),
      publishedBranch: branch.text.trim() === 'main',
      versionPolicy: 'retain-this-commit-during-creation',
    };
    const vendorDir = await safePath('vendor/sprite-gen', { root: runtime });
    const installed = await run('git', ['rev-parse', '--show-toplevel'], { cwd: vendorDir });
    if (!installed.code && path.resolve(installed.text.trim()) === vendorDir) {
      const actual = await run('git', ['rev-parse', 'HEAD'], { cwd: vendorDir });
      source.vendorMatchesPin = !actual.code && actual.text.trim() === vendorPin;
      const edits = await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: vendorDir });
      source.vendorDirty = edits.code !== 0 || Boolean(edits.text.trim());
    } else source.vendorMatchesPin = null;
  }
  const key = sha256(
    JSON.stringify({
      lock: sha256(lockBytes),
      version: pkg.version,
      commit: source.commit,
      manifest: source.manifestSha256,
      vendorPin: source.vendorPin,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    }),
  );
  return { pkg, source, key, lockSha256: sha256(lockBytes) };
}
/** @param {string} runtime @param {Awaited<ReturnType<typeof metadata>>} meta */
async function dependencies(runtime, meta) {
  for (const [name, version] of Object.entries(meta.pkg.dependencies ?? {})) {
    try {
      if ((await readRecord(await safePath(`node_modules/${name}/package.json`, { root: runtime }))).version !== version) return false;
    } catch {
      return false;
    }
  }
  return true;
}
/** @param {{ workspace: string }} options */
export async function resume({ workspace }) {
  workspace = await safePath(workspace);
  const sessions = [],
    problems = [];
  for (const entry of await directoryEntries(workspace, 'output')) {
    if (!entry.name.endsWith('-work')) continue;
    const id = entry.name.slice(0, -5);
    if (!identifier.test(id) || !entry.isDirectory()) {
      problems.push('unsafe-session-entry');
      continue;
    }
    const base = `output/${entry.name}`;
    try {
      const state = await readRecord(await safePath(`${base}/creation-session.json`, { root: workspace }));
      if (state.storeVersion !== 1 || state.sessionId !== id || !Number.isSafeInteger(state.revision)) fail('invalid-session');
      const evidence = [];
      for (const item of Object.values(state.items ?? {}))
        for (const version of Object.values(item.versions ?? {})) for (const file of version.files ?? []) evidence.push(await fingerprint(workspace, file));
      const jobs = [];
      for (const entry of await directoryEntries(workspace, `${base}/jobs`)) {
        if (!entry.name.endsWith('.json')) continue;
        if (!entry.isFile() || !jobId.test(entry.name.slice(0, -5))) {
          problems.push('unsafe-job-entry');
          continue;
        }
        const record = await readRecord(await safePath(`${base}/jobs/${entry.name}`, { root: workspace }));
        if (record.sessionId !== id || record.jobId !== entry.name.slice(0, -5) || !statuses.has(record.status)) fail('invalid-job');
        const inputs = await Promise.all((record.inputs ?? []).map(/** @param {any} file */ file => fingerprint(workspace, file)));
        const outputs = await Promise.all((record.outputs ?? []).map(/** @param {any} file */ file => fingerprint(workspace, file)));
        const unresolved = ['running', 'unknown'].includes(record.status);
        jobs.push({
          jobId: record.jobId,
          status: record.status,
          inputs,
          outputs,
          automaticDispatch: false,
          nextAction: unresolved ? 'inspect-original-run-no-retry' : 'inspect-with-get_creation_job',
        });
        if (unresolved) problems.push('pending-or-unknown-job');
        if (record.status === 'succeeded' && (!outputs.length || outputs.some(f => f.status !== 'verified-bytes'))) problems.push('job-output-unverified');
        if (inputs.some(f => f.status !== 'verified-bytes')) problems.push('job-input-changed');
      }
      if (evidence.some(f => f.status !== 'verified-bytes')) problems.push('session-files-unverified');
      sessions.push({ sessionId: id, revision: state.revision, evidence, jobs });
    } catch {
      problems.push('session-record-unreadable-or-invalid');
    }
  }
  return {
    schemaVersion: 1,
    scope: 'recovery-inventory-no-execution',
    sessions,
    blockers: [...new Set(problems)],
    automaticDispatch: false,
    generationVerified: false,
    persistence: 'host-storage-not-certified',
  };
}
/** @param {any} record read from disk: checked here @param {number} now */
function freshness(record, now) {
  const at = Date.parse(record?.checkedAt);
  const expiry = record?.expiresAt === undefined ? Infinity : Date.parse(record.expiresAt);
  return Number.isFinite(at) && now >= at && now - at < 15 * 60_000 && expiry > now;
}
/** @param {string} workspace @param {string | undefined} relative @param {string} environmentId @param {number} now */
async function evidenceReport(workspace, relative, environmentId, now) {
  const unknown = {
    auth: { status: 'unknown' },
    delivery: { status: 'unknown', displayedVerified: false },
    registration: { status: 'unknown', nextAction: 'connected-ODDBOUT-get_profile-and-readiness' },
  };
  if (!relative) return unknown;
  const record = await readRecord(await safePath(relative, { root: workspace }));
  if (record.schemaVersion !== 1 || record.environmentId !== environmentId) return { ...unknown, reason: 'evidence-environment-mismatch' };
  const receipt = record.delivery?.file ? await fingerprint(workspace, record.delivery.file) : null;
  return {
    auth: { status: freshness(record.auth, now) ? 'reported-unverified' : 'stale-or-unknown', accountIdentity: 'unknown', imageAccess: 'unknown' },
    delivery: {
      status: receipt?.status === 'verified-bytes' ? 'bytes-verified-display-unverified' : 'blocked',
      file: receipt,
      decode: 'not-checked',
      displayedVerified: false,
      reason: 'a-receipt-does-not-prove-parent-display',
    },
    registration: {
      status: freshness(record.registration, now) ? 'reported-unverified' : 'stale-or-unknown',
      nextAction: 'connected-ODDBOUT-get_profile-and-readiness',
    },
  };
}
/** @param {DotsOptions} options @param {DoctorDeps} [deps] */
export async function doctor(options, { run = runCommand, find = findBinary, now = Date.now(), env = process.env, fetchPublic } = {}) {
  await validateOptions(options);
  const runtime = await safePath(options.runtime ?? defaultRuntime),
    workspace = await safePath(options.workspace);
  const cache = await safePath(options.cache ?? path.join(workspace, '.cache', 'oddbout'));
  const environmentId = sha256(JSON.stringify({ host: hostname(), platform: process.platform, runtime, workspace }));
  const blockers = [],
    report = /** @type {DoctorReport} */ ({
      schemaVersion: 1,
      checkedAt: new Date(now).toISOString(),
      environmentId,
      host: { kind: 'dots', os: process.platform, arch: process.arch, node: process.versions.node, identity: 'local-binding-hash' },
      runtime,
      workspace,
      cache,
      network: { status: 'not-probed' },
      auth: { status: 'unknown' },
      readyForGeneration: false,
      generationVerified: false,
      automaticDispatch: false,
    });
  if (!nodeOkay(process.versions.node)) blockers.push('node-22-12-required');
  let meta;
  try {
    meta = await metadata(runtime, run, options.manifestSha256);
    report.kit = { version: meta.pkg.version, ...meta.source, lockSha256: meta.lockSha256, dependenciesPresent: await dependencies(runtime, meta) };
    if (!report.kit.dependenciesPresent) blockers.push('npm-dependencies-missing-or-mismatched');
    if (meta.source.vendorMatchesPin === false) blockers.push('vendor-pin-mismatch');
    if (meta.source.vendorMatchesPin === null) blockers.push('vendor-source-missing');
    if (meta.source.vendorDirty) blockers.push('vendor-local-changes');
    if (meta.source.dirty) blockers.push('source-local-changes');
  } catch (error) {
    report.kit = { status: 'blocked' };
    blockers.push(safeError(error));
  }
  report.paths = {};
  for (const [name, target] of Object.entries({ runtime, workspace, cache })) {
    report.paths[name] = await writableDirectory(target);
    if (report.paths[name].status === 'blocked') blockers.push(`${name}-not-writable`);
  }
  const toolEnv = {
    ...env,
    PATH: [path.join(runtime, 'vendor/sprite-gen/.venv', process.platform === 'win32' ? 'Scripts' : 'bin'), env.PATH ?? ''].join(path.delimiter),
  };
  report.tools = {};
  const names = ['git', 'python3', 'ffmpeg', 'ffprobe', 'img2webp', ...(options.provider === 'none' ? [] : [options.provider === 'grok' ? 'grok' : 'codex'])];
  for (const name of names) {
    const binary = await find(name, toolEnv);
    const item = { status: binary ? 'present-unprobed' : 'missing', actor: ['ffmpeg', 'ffprobe'].includes(name) ? 'environment-preparer' : 'agent' };
    if (!binary) blockers.push(`${name}-missing`);
    if (binary && options.checkCli) {
      const args = name === 'img2webp' ? ['-h'] : ['ffmpeg', 'ffprobe'].includes(name) ? ['-version'] : ['--version'];
      const probe = await run(binary, args, { cwd: runtime, env: toolEnv });
      item.status = probe.code === 0 ? 'responded' : 'broken';
      if (name === 'img2webp' && !probe.text.includes('-exact')) item.status = 'broken';
      if (name === 'python3' && !/Python 3\.(?:1[1-9]|[2-9][0-9])\./.test(probe.text)) item.status = 'broken';
      if (item.status === 'broken') blockers.push(`${name}-capability-unavailable`);
    }
    report.tools[name] = item;
  }
  report.tools.rife = { status: 'not-probed', required: false };
  const venvDir = await safePath('vendor/sprite-gen/.venv', { root: runtime });
  report.tools.spritePython = {
    status: await access(path.join(venvDir, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), constants.X_OK).then(
      () => 'present-unprobed',
      () => 'missing',
    ),
    nextAction: 'bootstrap --install before starting a character',
  };
  if (report.tools.spritePython.status === 'missing') blockers.push('sprite-python-environment-missing');
  report.provider = await inspectProvider(runtime, options.provider ?? 'codex');
  if (report.provider.status !== 'not-selected') blockers.push(/** @type {string} */ (report.provider.reason)); // set for every selected provider
  Object.assign(report, await evidenceReport(workspace, options.evidence, environmentId, now));
  if (options.checkAuth) {
    if (options.provider === 'grok') {
      // The pinned engine's shared reader is authoritative for image/video credential precedence.
      // No file contents, account claims, raw errors or token strings leave this subprocess.
      const python = path.join(venvDir, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      const storage = await inspectGrokAuthStorage({ env: toolEnv });
      const probe =
        storage.status !== 'permission-available'
          ? { code: 1, text: '' }
          : await run(
              python,
              ['-c', 'import json; from sprite_gen.api import probe_access; s=probe_access("grok"); print(json.dumps({k:s[k] for k in ("login","billing")}))'],
              { cwd: workspace, env: toolEnv },
            );
      let state;
      try {
        state = JSON.parse(probe.text);
      } catch {
        /* redacted unknown */
      }
      report.auth = {
        status:
          env.XAI_API_KEY?.trim() || state?.billing === 'api-credit'
            ? 'api-billing-blocked'
            : probe.code
              ? 'unknown'
              : state?.login === 'ready'
                ? 'signed-in'
                : state?.login === 'unavailable'
                  ? 'sign-in-required'
                  : 'unknown',
        ...(env.XAI_API_KEY?.trim() ? { reason: 'xai-api-key-environment' } : {}),
        scope: storage.status === 'permission-available' ? 'pinned-engine-credential-probe' : 'directory-metadata-only',
        accountIdentity: 'unknown',
        imageAccess: 'unknown',
        videoAccess: 'unknown',
        storage,
      };
    } else if ((options.provider ?? 'codex') !== 'codex') report.auth = { status: 'unknown', reason: 'official-status-adapter-unavailable' };
    else {
      const binary = await find('codex', env);
      const result = binary ? await run(binary, ['login', 'status'], { cwd: runtime, env }) : null;
      const text = result?.text ?? '';
      report.auth = {
        status: !result
          ? 'not-installed'
          : /api[ -]?key/i.test(text)
            ? 'api-billing-blocked'
            : result.code === 0 && /chatgpt/i.test(text)
              ? 'signed-in'
              : /expired|not logged in|not signed in/i.test(text)
                ? 'sign-in-required'
                : 'unknown',
        scope: 'official-cli-status-only',
        accountIdentity: 'unknown',
        imageAccess: 'unknown',
      };
    }
  }
  if (options.checkNetwork) {
    // Explicit public HEAD only; no cookies, credentials, private endpoints, redirects or direct fallback.
    const targets = ['https://oddbout.com/', ...((options.provider ?? 'codex') === 'codex' ? ['https://auth.openai.com/', 'https://chatgpt.com/'] : [])];
    report.network = { status: 'public-probe', coverage: 'bootstrap-only', results: [] };
    let fetcher = fetchPublic;
    if (!fetcher) {
      try {
        fetcher = (await import('../api/runtime-fetch.mjs')).runtimeFetch;
      } catch {
        report.network = { status: 'blocked', reason: 'proxy-aware-transport-unavailable' };
      }
    }
    if (fetcher)
      for (const url of targets) {
        try {
          const response = await fetcher(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(10000) });
          /** @type {ProbeResult[]} */ (report.network.results).push({
            host: new URL(url).hostname,
            httpStatus: response.status,
            status: 'http-response-not-capability-proof',
          }); // set above
        } catch {
          /** @type {ProbeResult[]} */ (report.network.results).push({ host: new URL(url).hostname, status: 'unavailable' });
        }
      }
  }
  report.recovery = await resume({ workspace });
  blockers.push(...report.recovery.blockers);
  report.blockers = [...new Set(blockers)];
  report.status = report.blockers.length ? 'action-required' : 'inspected';
  return report;
}
/** @param {DotsOptions} options @param {DoctorDeps} [deps] */
export async function bootstrap(options, { run = runCommand, ...deps } = {}) {
  await validateOptions(options);
  if (!options.install) return { ...(await doctor(options, { run, ...deps })), installation: 'not-requested', nextAction: 'bootstrap --install' };
  const runtime = await safePath(options.runtime ?? defaultRuntime),
    workspace = await safePath(options.workspace);
  const cache = await safePath(options.cache ?? path.join(workspace, '.cache', 'oddbout'));
  const recovery = await resume({ workspace });
  if (recovery.sessions.length || recovery.blockers.length) fail('existing-work-preserved-install-blocked');
  const npmCache = await safePath('npm', { root: cache }),
    pipCache = await safePath('pip', { root: cache });
  for (const target of [runtime, workspace, cache, npmCache, pipCache])
    if ((await writableDirectory(target)).status === 'blocked') fail('installation-path-not-writable');
  const meta = await metadata(runtime, run, options.manifestSha256);
  if (meta.source.dirty || meta.source.vendorDirty) fail('local-changes-install-blocked');
  if (meta.source.vendorMatchesPin === false) fail('vendor-pin-mismatch');
  if (!nodeOkay(process.versions.node)) fail('node-22-12-required');
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const lock = await safePath('.dots-bootstrap.lock', { root: runtime });
  // Never reclaim automatically: an interrupted install requires inspection before removing this lock.
  await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 }).catch(() => fail('bootstrap-busy-or-interrupted'));
  const steps = [];
  let preserveLock = false;
  try {
    const env = { ...process.env, npm_config_cache: npmCache, PIP_CACHE_DIR: pipCache };
    const receiptPath = await safePath('.dots-install.json', { root: runtime });
    let receipt;
    try {
      receipt = await readRecord(receiptPath);
    } catch (/** @type {any} */ e) {
      if (e.code !== 'ENOENT') fail('install-receipt-invalid');
    }
    const npmReady = receipt?.key === meta.key && receipt.npm === true && (await dependencies(runtime, meta));
    // venv executables normally link to the system Python. Never read their target as an artifact.
    const venv = await safePath('vendor/sprite-gen/.venv', { root: runtime });
    const python = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const pythonPresent = await access(python, constants.X_OK).then(
      () => true,
      () => false,
    );
    const pythonReady = pythonPresent && (await run(python, ['-c', 'import sprite_gen, PIL, numpy'], { cwd: runtime, env, timeout: 15000 })).code === 0;
    const commands = /** @type {[string, string[]][]} */ (
      [
        !npmReady && ['npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']],
        !(receipt?.key === meta.key && receipt.sprite === true && pythonReady) && [
          process.execPath,
          [path.join(runtime, 'scripts/sprite-gen.mjs'), 'setup', '--skip-rife'],
        ],
      ].filter(Boolean)
    ); // filter(Boolean) drops the false entries
    await writeFile(await safePath('.dots-runtime.json', { root: runtime }), JSON.stringify({ schemaVersion: 1, host: 'dots' }) + '\n', { mode: 0o600 });
    for (const [command, args] of commands) {
      let result;
      try {
        result = await run(command, args, { cwd: runtime, env, timeout: 30 * 60_000 });
      } catch {
        preserveLock = true;
        fail('installation-outcome-unknown');
      }
      const step = command === 'npm' ? 'npm' : 'sprite';
      steps.push({ step, exitCode: result.code });
      if (result.uncertain || (step === 'sprite' && result.code === INSTALL_OUTCOME_UNKNOWN)) {
        preserveLock = true;
        return { status: 'blocked', reason: 'installation-outcome-unknown', steps, automaticRetry: false };
      }
      if (result.code) {
        // Recognize only the installer's fixed diagnostic. Never expose arbitrary child output or URLs.
        const network = result.text?.match(
          /^img2webp: network (network-connect-forbidden|network-timeout|network-dns-failed|api-unreachable) host=storage\.googleapis\.com$/m,
        );
        return {
          status: 'blocked',
          reason: `${step}-installation-failed`,
          steps,
          ...(network ? { diagnostic: { actor: 'environment-preparer', reason: network[1], host: 'storage.googleapis.com' } } : {}),
          automaticRetry: false,
          generationVerified: false,
        };
      }
      receipt = { ...(receipt?.key === meta.key ? receipt : {}), schemaVersion: 1, key: meta.key, [step]: true };
      await writeFile(receiptPath, JSON.stringify(receipt) + '\n', { mode: 0o600 });
    }
    return { ...(await doctor({ ...options, checkCli: true }, { run, ...deps })), installation: commands.length ? 'commands-completed' : 'reused', steps };
  } finally {
    if (!preserveLock) await rm(lock);
  }
}
const safeCodes = new Set([
  'path-not-allowed',
  'absolute-path-required',
  'protected-path-not-allowed',
  'symlink-not-allowed',
  'invalid-record',
  'invalid-kit-version',
  'package-lock-mismatch',
  'dots-runtime-contract-missing',
  'bundle-trust-anchor-required',
  'bundle-integrity-invalid',
  'source-or-bundle-layout-required',
  'source-metadata-unavailable',
  'unsupported-provider-choice',
  'existing-work-preserved-install-blocked',
  'installation-path-not-writable',
  'local-changes-install-blocked',
  'vendor-pin-mismatch',
  'node-22-12-required',
  'bootstrap-busy-or-interrupted',
  'installation-outcome-unknown',
  'install-receipt-invalid',
  'invalid-arguments',
  'report-already-exists',
]);
/** @param {any} error a caught value */
export const safeError = error => (safeCodes.has(error.message) ? error.message : 'workspace-inspection-failed');
/** @param {DotsOptions} options */
async function validateOptions(options) {
  if (options.provider !== undefined && !['codex', 'grok', 'none'].includes(options.provider)) fail('unsupported-provider-choice');
  const workspace = await safePath(options.workspace);
  if (options.evidence) await readRecord(await safePath(options.evidence, { root: workspace }));
  if (options.report) {
    if (!options.report.startsWith('output/')) fail('path-not-allowed');
    const target = await safePath(options.report, { root: workspace });
    if (
      await lstat(target).then(
        () => true,
        e => {
          if (e.code !== 'ENOENT') throw e;
          return false;
        },
      )
    )
      fail('report-already-exists');
  }
}
/** @param {string[]} argv */
export async function main(argv) {
  const [mode, ...rest] = argv;
  if (!['doctor', 'bootstrap', 'resume'].includes(mode)) fail('invalid-arguments');
  const options = /** @type {DotsOptions & Record<string, string | boolean>} */ ({}),
    flags = /** @type {Record<string, string>} */ ({
      '--install': 'install',
      '--check-cli': 'checkCli',
      '--check-auth': 'checkAuth',
      '--check-network': 'checkNetwork',
    });
  /** @type {Record<string, string>} */
  const values = {
    '--runtime': 'runtime',
    '--workspace': 'workspace',
    '--cache': 'cache',
    '--provider': 'provider',
    '--evidence': 'evidence',
    '--report': 'report',
    '--manifest-sha256': 'manifestSha256',
  };
  for (let i = 0; i < rest.length; i++) {
    const key = flags[rest[i]] ?? values[rest[i]];
    if (!key || Object.hasOwn(options, key)) fail('invalid-arguments');
    options[key] = flags[rest[i]] ? true : rest[++i];
    if (options[key] === undefined) fail('invalid-arguments');
  }
  if (
    !options.workspace ||
    (mode !== 'bootstrap' && options.install) ||
    (mode === 'resume' && Object.keys(options).some(k => !['workspace', 'report'].includes(k)))
  )
    fail('invalid-arguments');
  await validateOptions(options);
  // A resume inventory has no status; a blocked installation has no blockers.
  const result = /** @type {{ status?: string, blockers?: string[] }} */ (
    await (mode === 'resume' ? resume(options) : mode === 'bootstrap' ? bootstrap(options) : doctor(options))
  );
  if (options.report) {
    const target = await safePath(options.report, { root: await safePath(options.workspace) });
    if (!options.report.startsWith('output/')) fail('path-not-allowed');
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  console.log(JSON.stringify(result, null, 2));
  return result.status === 'blocked' || result.blockers?.length ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: safeError(error) }));
    process.exitCode = 2;
  }
}
