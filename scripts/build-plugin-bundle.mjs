// @ts-check
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { localPath } from '../mcp/creation-store.mjs';
import { importClosure, packageName } from './import-graph.mjs';
import { bootstrapPython } from './bootstrap-python.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
/** @type {(value: Buffer) => string} */
const sha = value => createHash('sha256').update(value).digest('hex');
// Entry points, data and docs. Modules they import are added from the import graph (`runtimeFileList`),
// so a new relative import cannot be left out of the kit (0.5.0 shipped without tools/ai-fighter/projected-ground.mjs).
const runtimeFiles = [
  'LICENSE', 'AGENTS.md', 'README.md', 'README.ko.md', 'package-lock.json', 'api/client.mjs', 'api/connection-errors.mjs', 'api/runtime-fetch.mjs', 'server/ai-fighter-package.mjs',
  'deploy/creation-context-source.json', 'deploy/creator-site.json',
  'scripts/check-cloud-discovery.mjs', 'plugins/ai-fighter/mcp.json',
  'deploy/creation-environments.json', 'deploy/creation-environment-trust.json', 'scripts/connect-generation.mjs', 'docs/ENVIRONMENT-ONBOARDING.md',
  'scripts/sprite-gen.mjs', 'scripts/pack-fighter.mjs', 'scripts/run-creation-job.mjs', 'scripts/creation-tool.mjs',
  'scripts/sprite-tools.mjs',
  'scripts/dots-workspace.mjs', 'scripts/dots-start.mjs', 'scripts/dots-source.mjs',
  'docs/DOTS-QUICKSTART.md', 'docs/DOTS-START.md', 'docs/DOTS-VM-ARCHITECTURE.md', 'docs/DOTS-PRIVATE-SOURCES.md',
  'scripts/login.mjs', 'scripts/gait.mjs', 'scripts/contact.mjs', 'scripts/creation-context.mjs',
  'scripts/check-creation-delivery.mjs', 'scripts/check-connection.mjs', 'docs/DELIVERY.md',
  'tools/ai-fighter/gait.mjs', 'tools/ai-fighter/contact_evidence.py', 'tools/ai-fighter/validate-package.mjs',
  'docs/DOT-CREATION.md', 'docs/AUTHORING.md', 'docs/CREATION-UX.md', 'docs/GAIT-REVIEW.md',
  'docs/FOOT-EVIDENCE.md', 'docs/LOCAL-PLUGIN.md', 'docs/CODEX-PLUGIN.md', 'docs/GAME-CREATION-CONTEXT.md', 'docs/OPEN-REGISTRATION.md',
  'docs/EXECUTION-HOST.md', 'docs/CONNECTION-READINESS.md', 'docs/ODDBOUT-PLUGIN.md',
  'docs/README.md', 'docs/START-HERE.md', 'docs/CLOUD-MCP.md',
];
const runtimeDirectories = ['mcp', 'contracts/ai-fighter'];
// The cloud MCP (with its tool families in mcp/cloud/) and its file-input probe run only in the Edge function
// (supabase/functions/ai-fighter-mcp) and import the server API.
const edgeOnlyFiles = ['mcp/cloud.mjs', 'mcp/file-input-probe.mjs', 'mcp/creator-sources.mjs'];
/** @type {(file: string) => boolean} */
const edgeOnly = file => edgeOnlyFiles.includes(file) || file.startsWith('mcp/cloud/');
const runtimeScripts = ['start', 'login', 'logout', 'sprite:setup', 'sprite:status', 'sprite',
  'fighter:pack', 'fighter:gait', 'fighter:contact', 'validate', 'creation:context', 'creation:delivery', 'creation:check', 'creation:run', 'creation:tool',
  'dots:doctor', 'dots:bootstrap', 'dots:resume', 'dots:start', 'dots:source', 'mcp:check'];

// Presentation media in the upstream documentation is not runtime/package data.
// Keep all source, package assets, workflow text and licenses.
export const bundlePolicy = Object.freeze({ id: 'source-without-doc-media-v1', omittedVendorPrefixes: ['docs/assets/'] });
/** @type {(relative: string) => boolean} */
export const includeVendorFile = relative => !bundlePolicy.omittedVendorPrefixes.some(prefix => relative.startsWith(prefix));

/** @param {string} command @param {string[]} args @param {{ cwd?: string, capture?: boolean }} [options] @returns {Promise<string>} */
function run(command, args, { cwd = root, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] });
    let stdout = '', stderr = '';
    if (capture) { /** @type {import('node:stream').Readable} */ (child.stdout).on('data', chunk => stdout += chunk); /** @type {import('node:stream').Readable} */ (child.stderr).on('data', chunk => stderr += chunk); }
    child.once('error', reject);
    // 'close', not 'exit': captured output is complete only after the pipes close (git ls-files drives the file list).
    child.once('close', code => code === 0 ? resolve(stdout) : reject(Error(`${path.basename(command)} exited ${code}: ${stderr.trim()}`)));
  });
}
/** @param {string} directory @param {string} [prefix] @returns {Promise<string[]>} */
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw Error('Distribution must not contain symlinks');
    const relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await files(path.join(directory, entry.name), relative + '/'));
    else if (entry.isFile()) result.push(relative);
    else throw Error('Distribution must contain only regular files');
  }
  return result.sort();
}
/** @param {string} relative @param {string} sourceRoot @param {string} targetRoot */
async function copy(relative, sourceRoot, targetRoot) {
  const source = await localPath(sourceRoot, relative);
  if (!(await lstat(source)).isFile()) throw Error(`Expected a regular source file: ${relative}`);
  const target = path.join(targetRoot, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { errorOnExist: true, force: false });
}

/** Every repository file the runtime ships: the declared files and directories plus their import closure. */
export async function runtimeFileList({ sourceRoot = root } = {}) {
  const declared = [...runtimeFiles];
  // Tracked files only: editor leftovers and untracked experiments in these directories never ship.
  const tracked = await run('git', ['ls-files', '-z', '--', ...runtimeDirectories], { cwd: sourceRoot, capture: true });
  declared.push(...tracked.split('\0').filter(Boolean));
  const { files: closure } = await importClosure(sourceRoot, declared.filter(file => !edgeOnly(file)));
  const leaked = closure.filter(edgeOnly);
  if (leaked.length) throw Error(`The local runtime imports Edge-only modules: ${leaked.join(', ')}`);
  return closure;
}
/**
 * The kit must be reproducible from its recorded commit: refuse uncommitted, untracked or deleted shipped paths.
 * @param {string[]} paths @param {{ sourceRoot?: string }} [options]
 */
export async function assertCommitted(paths, { sourceRoot = root } = {}) {
  const dirty = (await run('git', ['status', '--porcelain', '--', ...paths], { cwd: sourceRoot, capture: true })).trimEnd();
  if (dirty) throw Error(`Commit runtime changes before bundling:\n${dirty}`);
}
/**
 * Fails unless every module in a built runtime resolves there: relative imports to bundled files,
 * bare imports to the runtime package.json dependencies. Runs on the copied files, so it checks what ships.
 * @param {string} runtime
 */
export async function checkRuntimeImports(runtime) {
  const { dependencies = {} } = JSON.parse(await readFile(path.join(runtime, 'package.json'), 'utf8'));
  const scripts = (await files(runtime)).filter(file => !file.startsWith('vendor/') && /\.(?:mjs|js)$/.test(file));
  const { bare } = await importClosure(runtime, scripts);
  const missing = bare.map(packageName).filter(name => name && !(name in dependencies));
  if (missing.length) throw Error(`Runtime imports packages it does not depend on: ${[...new Set(missing)].join(', ')}`);
}

/** @param {string} destination */
export async function buildPluginBundle(destination) {
  if (!destination.startsWith('output/')) throw Error('plugin-output-must-be-under-output');
  const out = await localPath(root, destination);
  if (await lstat(out).then(() => true, error => { if (error.code !== 'ENOENT') throw error; return false; })) throw Error('plugin-output-exists');
  // Read the pinned tree; never include the checkout venv, credentials, caches or untracked outputs.
  const pinned = /** @type {RegExpMatchArray} */ ((await run('git', ['ls-tree', 'HEAD', 'vendor/sprite-gen'], { capture: true })).match(/^160000 commit ([a-f0-9]{40})\s/))[1];
  const vendor = path.join(root, 'vendor', 'sprite-gen');
  const spriteGenSource = (await run('git', ['config', '-f', '.gitmodules', 'submodule.vendor/sprite-gen.url'], { capture: true })).trim();
  if ((await run('git', ['rev-parse', 'HEAD'], { cwd: vendor, capture: true })).trim() !== pinned)
    throw Error('Check out the pinned sprite-gen-agent commit (npm run sprite:setup) before bundling.');
  if ((await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: vendor, capture: true })).trim())
    throw Error('Local sprite-gen edits cannot be bundled; commit them to sprite-gen-agent and move the pin.');
  const vendorFiles = (await run('git', ['ls-files', '-z'], { cwd: vendor, capture: true })).split('\0').filter(Boolean);
  if (!vendorFiles.includes('LICENSE') || !vendorFiles.includes('NOTICE')) throw Error('Missing upstream license or notice');
  const shipped = await runtimeFileList();
  await assertCommitted([...shipped, 'package.json', 'plugins/ai-fighter']);
  const sourceCommit = (await run('git', ['rev-parse', 'HEAD'], { capture: true })).trim();
  const plugin = path.join(out, 'plugins', 'ai-fighter');
  await mkdir(path.dirname(plugin), { recursive: true });
  await cp(path.join(root, 'plugins', 'ai-fighter'), plugin, { recursive: true, force: false, errorOnExist: true });
  const runtime = path.join(plugin, 'runtime'); await mkdir(runtime);
  for (const file of shipped) await copy(file, root, runtime);
  const omittedVendorFiles = [];
  for (const file of vendorFiles) {
    if (includeVendorFile(file)) await copy(file, vendor, path.join(runtime, 'vendor', 'sprite-gen'));
    else {
      const data = await readFile(await localPath(vendor, file));
      omittedVendorFiles.push({ path: file, bytes: data.length, sha256: sha(data) });
    }
  }
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  pkg.scripts = Object.fromEntries(runtimeScripts.map(key => [key, pkg.scripts[key]]));
  // The runtime reports the kit's version (plugin.json), not a separate package number.
  pkg.version = JSON.parse(await readFile(path.join(root, 'plugins', 'ai-fighter', 'plugin.json'), 'utf8')).version;
  await writeFile(path.join(runtime, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', { flag: 'wx' });
  await checkRuntimeImports(runtime);
  // Source-only: native Node packages are installed in the user's writable runtime on that host.
  // Bundling Windows node_modules would break Dots/Linux and make the plugin desktop-only again.
  const hashes = /** @type {Record<string, string>} */ ({});
  for (const file of await files(runtime)) hashes[file] = sha(await readFile(path.join(runtime, file)));
  await writeFile(path.join(plugin, 'runtime-manifest.json'), JSON.stringify({ schemaVersion: 1,
    distribution: 'source', platform: 'any', arch: 'any', spriteGenCommit: pinned, spriteGenSource,
    bundlePolicy, files: hashes }, null, 2) + '\n');
  const metadata = JSON.parse(await readFile(path.join(plugin, 'plugin.json'), 'utf8'));
  const marketDir = path.join(out, '.agents', 'plugins'); await mkdir(marketDir, { recursive: true });
  await writeFile(path.join(marketDir, 'marketplace.json'), JSON.stringify({ name: 'ai-fighter-local',
    interface: { displayName: 'ODDBOUT' }, plugins: [{ name: metadata.name,
      source: { source: 'local', path: './plugins/ai-fighter' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] }, null, 2) + '\n');
  const zip = path.join(out, `${metadata.name}-${metadata.version}.zip`);
  const python = bootstrapPython();
  await run(python, [path.join(root, 'scripts', 'zip-plugin.py'), plugin, zip]);
  const zipBytes = await readFile(zip);
  if (zipBytes.length > 20_000_000) throw Error('Source bundle exceeds the 20 MB distribution budget; review contents before publishing.');
  const report = { version: metadata.version, distribution: 'source', builtOn: `${process.platform}-${process.arch}`, plugin, marketplace: out,
    zip, bytes: zipBytes.length, sha256: sha(zipBytes), runtimeFiles: Object.keys(hashes).length, sourceCommit, spriteGenCommit: pinned, spriteGenSource,
    bundlePolicy, omittedVendorFiles,
    listingURLs: Object.fromEntries(['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']
      .map(key => [key, metadata.extensions['com.openai'].interface[key]])),
    publicSubmissionReady: false, pending: ['Public With MCP submission using the ODDBOUT HTTPS server; private app mappings are not public submissions',
      'Verified developer identity', 'Executed PC and hosted Dots creation/delivery review cases', 'Reviewer-accessible demo video'],
    credentials: 'Only allowlisted source is bundled; no home, session, venv, node_modules or output directories.',
    runtime: 'Node.js 22.12+ and Python 3.11+ in a per-user PC or Dots workspace. Install locked dependencies and sprite-gen explicitly in the writable runtime. Registration uses the connected ODDBOUT account.' };
  await writeFile(path.join(out, 'build-report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 3) throw Error('Usage: npm run plugin:bundle -- [output/new-distribution]');
    console.log(JSON.stringify(await buildPluginBundle(process.argv[2] || 'output/ai-fighter-portable'), null, 2));
  } catch (/** @type {any} */ error) { console.error(error.message); process.exitCode = 1; }
}
