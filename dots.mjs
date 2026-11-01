// Small, dependency-free front door. main can carry this without copying the service runtime.
import { execFile } from 'node:child_process';
import { writeSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, lstat, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const repository = 'https://github.com/jeonghwanko/oddbout-starter.git';
async function plainDirectory(value) {
  if (!path.isAbsolute(value)) throw Error('absolute-path-required');
  const target = path.resolve(value), parsed = path.parse(target);
  let current = parsed.root;
  for (const part of target.slice(parsed.root.length).split(path.sep)) {
    if (/^(?:\.codex|\.grok|\.ssh|\.aws|sessions)$/i.test(part)) throw Error('private-location-not-allowed');
    current = path.join(current, part);
    const info = await lstat(current).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    if (info?.isSymbolicLink()) throw Error('symlink-not-allowed');
  }
  return target;
}
export async function launch(argv, { run = exec, loadRuntime = url => import(url),
  releasePath = new URL('./deploy/dots-release.json', import.meta.url) } = {}) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = { '--workspace': 'workspace', '--runtime-home': 'runtimeHome', '--install': 'install' }[argv[i]];
    if (!key || options[key] !== undefined) throw Error('invalid-arguments');
    options[key] = key === 'install' ? true : argv[++i];
    if (!options[key]) throw Error('invalid-arguments');
  }
  const workspace = await plainDirectory(options.workspace ?? process.env.AI_FIGHTER_ROOT ?? path.join(homedir(), '.oddbout', 'workspace'));
  let binding;
  try { binding = JSON.parse(await readFile(await plainDirectory(path.join(workspace, 'output/dots-workspace.json')), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (binding && (binding.schemaVersion !== 1 || binding.provider !== 'grok' || !/^[a-f0-9]{40}$/.test(binding.commit ?? ''))) throw Error('invalid-workspace-binding');
  const release = JSON.parse(await readFile(releasePath, 'utf8'));
  if (release.schemaVersion !== 1 || release.repository !== repository || !/^[a-f0-9]{40}$/.test(release.commit) || release.provider !== 'grok') throw Error('invalid-release');
  const runtimeHome = await plainDirectory(options.runtimeHome ?? process.env.ODDBOUT_RUNTIME_HOME ?? path.join(homedir(), '.oddbout', 'runtimes'));
  const runtime = await plainDirectory(binding?.runtime ?? path.join(runtimeHome, release.commit));
  const expected = binding?.commit ?? release.commit;
  if (!/^[a-f0-9]{40}$/.test(expected)) throw Error('pinned-source-commit-required');
  const exists = await lstat(runtime).then(() => true, e => { if (e.code !== 'ENOENT') throw e; return false; });
  if (!exists) {
    if (binding) throw Error('bound-runtime-missing-restore-original-release');
    if (!options.install) return { ok: false, action: 'install-reviewed-release', version: release.version, commit: release.commit };
    await mkdir(runtimeHome, { recursive: true }); await mkdir(runtime);
    // A failed clone remains present for inspection; never delete or blindly retry an unknown install.
    const cfg = { cwd: runtime, windowsHide: true, timeout: 600000, maxBuffer: 1024 * 1024 };
    await run('git', ['init', '--quiet'], cfg);
    await run('git', ['remote', 'add', 'origin', repository], cfg);
    await run('git', ['fetch', '--no-tags', '--depth=1', 'origin', expected], cfg);
    await run('git', ['checkout', '--detach', expected], cfg);
  }
  const cfg = { cwd: runtime, windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 };
  const head = await run('git', ['rev-parse', 'HEAD'], cfg);
  if (head.stdout.trim() !== expected) throw Error('runtime-commit-mismatch');
  const runner = await plainDirectory(path.join(runtime, 'scripts/dots-start.mjs'));
  // Some managed VMs lose Node-to-Node pipe output even for console.log. Keep the
  // pinned runtime's typed result in this process instead of parsing a child CLI.
  // start explicitly selects Grok; bootstrap writes the Dots marker before setup.
  const entry = await loadRuntime(pathToFileURL(runner).href);
  if (typeof entry.start !== 'function') throw Error('runtime-start-contract-missing');
  return entry.start({ runtime, workspace, install: Boolean(options.install) });
}
// Write this CLI's JSON through its inherited fd. Some managed hosts classify
// Node's socket-backed stdout/stderr as UNKNOWN and silently discard stream writes.
// Keep byte offsets across short writes; do not replace process-global streams.
export async function writeCliJson(fd, value, { write = writeSync, wait = () => delay(1), timeout = 15000 } = {}) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const deadline = performance.now() + timeout;
  for (let offset = 0; offset < bytes.length;) {
    if (performance.now() >= deadline) throw Error('front-door-output-timeout');
    let count;
    try { count = write(fd, bytes, offset, bytes.length - offset); }
    catch (error) {
      if (error.code === 'EINTR') continue;
      if (error.code === 'EAGAIN' || error.code === 'EWOULDBLOCK') { await wait(); continue; }
      throw error;
    }
    if (!Number.isInteger(count) || count <= 0 || count > bytes.length - offset) throw Error('front-door-output-write-failed');
    offset += count;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await launch(process.argv.slice(2));
    await writeCliJson(1, result);
    if (result.ok === false || result.nextAction?.action === 'repair-installation') process.exitCode = 1;
  }
  catch (e) {
    process.exitCode = 1;
    try { await writeCliJson(2, { ok: false, code: /^[a-z][a-z-]+$/.test(e.message) ? e.message : 'front-door-failed-inspect-existing-runtime' }); }
    catch { /* A broken stderr cannot deliver an error; preserve failure exit. */ }
  }
}
