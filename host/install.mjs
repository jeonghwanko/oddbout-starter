// @ts-check
// A community host's install, shared by `npm run host` (scripts/host.mjs: a Linux kit checkout, bash og, a systemd user service) and
// `npx oddbout-host` (runner.mjs, 2026-11-07: Windows, macOS or Linux, og.mjs, the worker in front). Only Node built-ins: the npm package
// oddbout-host ships this file beside the generator's (host/package.json), never the kit's api/ or scripts/.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, totalmem } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** What a host's install runs; tests and the operator's installer stay in the checkout. */
// style-anchor-front.webp (2026-10-31): the house front the looks take their colouring from (generation-stages.mjs STYLE_ANCHOR_FILE).
// codex-usage.mjs (2026-10-31): the subscription's meter the worker sends with its heartbeat.
export const HOST_FILES = Object.freeze(['og', 'generation-worker.mjs', 'generation-stages.mjs', 'codex-usage.mjs', 'sprite-outcome.mjs', 'ledger-report.mjs', 'motions.py',
  'style-anchor-front.webp']);
const SYSTEM_DIRS = new Set(['/usr/local/bin', '/usr/bin', '/bin']);

/** The OS as the API names it (host pairing, heartbeats). @param {NodeJS.Platform} [platform] */
export const platformName = (platform = process.platform) => platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux';

/**
 * Where a host's install lives: ODDBOUT_HOST_ROOT, else the OS's per-user data folder — Windows %LOCALAPPDATA%, macOS
 * ~/Library/Application Support, Linux $XDG_DATA_HOME or ~/.local/share (as before 2026-11-07).
 * @param {NodeJS.ProcessEnv} [env] @param {NodeJS.Platform} [platform] @param {string} [home]
 */
export function defaultRoot(env = process.env, platform = process.platform, home = homedir()) {
  if (env.ODDBOUT_HOST_ROOT) return env.ODDBOUT_HOST_ROOT;
  if (platform === 'win32') return path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), 'oddbout-host');
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'oddbout-host');
  return path.posix.join(env.XDG_DATA_HOME || path.posix.join(home, '.local', 'share'), 'oddbout-host');
}
/** An install with its og: bash `og` (npm run host) or `og.mjs` (oddbout-host). @type {(root: string, og?: string) => boolean} */
export const installed = (root, og = 'og') => existsSync(path.join(root, 'host.env')) && existsSync(path.join(root, 'bin', og));

/**
 * `KEY=value` lines og reads one key at a time (never sourced). Values are checked here: og puts some on PATH. On Windows (host/og.mjs)
 * a folder may also start with its drive (`C:\…`), and TOOL_PATH separates folders with `;`, as PATH does there.
 * @param {{ nodeBin: string, python?: string, toolPath?: string, slots?: number, memory?: string, platform?: NodeJS.Platform }} options
 */
export function hostEnv({ nodeBin, python = '', toolPath = '', slots = 3, memory = '8G', platform = process.platform }) {
  const posix = /^\/[^:\n=]*$/, windows = /^[A-Za-z]:[\\/][^:;\r\n=]*$/;
  /** @type {(d: string) => boolean} */
  const dir = d => posix.test(d) || (platform === 'win32' && windows.test(d));
  if (!dir(nodeBin) || (python && !dir(python)) || (toolPath && !toolPath.split(platform === 'win32' ? ';' : ':').every(dir))) throw new Error('host-env-path');
  if (![2, 3].includes(slots) || !/^([4-9]|[1-5][0-9]|6[0-4])G$/.test(memory)) throw new Error('host-env-limits');
  return ['# Written by npm run host:setup (scripts/host.mjs) or npx oddbout-host (host/runner.mjs). og reads these keys one by one; it never sources this file.',
    `NODE_BIN=${nodeBin}`, `PYTHON=${python}`, `TOOL_PATH=${toolPath}`, `SLOTS=${slots}`, `MEMORY=${memory}`, ''].join('\n');
}
/** @param {string} text */
export function readHostEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
}

/**
 * The install's generator files from host/ (this file's folder, or `from`), line endings made Unix (a Windows checkout writes CRLF).
 * `og`: og.mjs as well (oddbout-host's og; bash og's self-update never carries it, so it is not one of HOST_FILES).
 * @param {string} root @param {string} [from] @param {{ og?: boolean }} [options]
 */
export async function installFiles(root, from = HERE, { og = false } = {}) {
  await mkdir(path.join(root, 'bin'), { recursive: true, mode: 0o700 });
  for (const name of og ? [...HOST_FILES, 'og.mjs'] : HOST_FILES) {
    // A new file renamed into place: a worker's bash keeps reading the og it started with.
    const target = path.join(root, 'bin', name), mode = name === 'og' ? 0o700 : 0o600;
    await rm(`${target}.new`, { force: true });
    // The style anchor is a picture: its bytes as they are. The rest are text, written with Unix line endings.
    const source = path.join(from, name);
    await writeFile(`${target}.new`, name.endsWith('.webp') ? await readFile(source) : (await readFile(source, 'utf8')).replace(/\r$/gm, ''), { mode });
    await chmod(`${target}.new`, mode);
    await rename(`${target}.new`, target);
  }
}

/** Job folders without `.closed`: og setup refuses to change the kit under them, and so does an update. @param {string} root */
export function openJobs(root) {
  const output = path.join(root, 'kit', 'output');
  if (!existsSync(output)) return [];
  return readdirSync(output, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .filter(d => existsSync(path.join(output, d.name, 'request.json')) && !existsSync(path.join(output, d.name, '.closed'))).map(d => d.name);
}

/** One provider's line of `og health` says ok. @type {(output: string, provider: string) => boolean} */
const answered = (output, provider) => new RegExp(`^og: ${provider} ok\\b`, 'm').test(output);
/**
 * `og health` output → may this PC work (1.1, 2026-11-06)? Grok is the one it needs: it draws a job's pictures (unless the job asks for
 * GPT's) and films every walk and run. Codex is optional: GPT pictures, and the judges where they ask it (the worker judges with pixels
 * without it, host/generation-worker.mjs canWork). Until 2026-11-06 both had to answer. @type {(output: string) => boolean}
 */
export const healthy = output => answered(output, 'grok');
/** Whether codex answered too: this PC may then draw GPT pictures. @type {(output: string) => boolean} */
export const codexHealthy = output => answered(output, 'codex');
/** The line that says what codex adds, when it did not answer. `login`: this install's login command. @param {string} login */
export const codexOptional = login => `codex(ChatGPT)는 없어도 된다: 그림은 Grok으로 그리고 판정은 픽셀로 한다. GPT 그림도 고르려면: ${login} codex`;

/**
 * The subscriptions' sign-ins inside the install (`og login <p>` for each), then `og health` read: grok must answer, codex only when it was
 * signed in now. `login`: how this install's user signs in again (`npm run host:login --`, `npx oddbout-host login`).
 * @param {{ og: (args: string[], options?: { capture?: boolean }) => Promise<{ code: number, output: string }>, out: (line: string) => void,
 *   providers: string[], replace?: boolean, login: string }} options
 * @returns {Promise<number>}
 */
export async function signIn({ og, out, providers, replace = false, login }) {
  for (const p of providers) {
    out(`${p} 로그인 — 아래 주소를 브라우저에서 열고 코드를 넣는다. 이 호스트가 쓸 구독 계정으로 로그인한다.`);
    if ((await og(['login', p, ...(replace ? ['--replace'] : [])])).code !== 0) return 1;
  }
  const health = await og(['health'], { capture: true });
  out(health.output.trim());
  // An account with no subscription signs in but cannot make anything: say what to do now, not at the first job.
  if (!healthy(health.output)) { out(`grok이 ok여야 일한다. 유료 구독(SuperGrok) 계정으로 다시 로그인한다: ${login} --replace`); return 1; }
  if (providers.includes('codex') && !codexHealthy(health.output)) {
    out(`codex가 ok가 아니다: GPT 그림은 고를 수 없다(Grok 그림은 된다). 유료 구독(ChatGPT Plus·Pro) 계정으로 다시 로그인한다: ${login} codex --replace`);
    return 1;
  }
  if (!codexHealthy(health.output)) out(codexOptional(login));
  return 0;
}

/**
 * A program on PATH, as `command -v` finds it (with PATHEXT on Windows), or ''. No shell.
 * @param {string} name @param {{ env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} [options]
 */
export function which(name, { env = process.env, platform = process.platform } = {}) {
  const key = Object.keys(env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH';
  const extensions = platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : [''];
  for (const dir of (env[key] ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean))
    for (const extension of extensions) {
      const file = path.join(dir, name + extension);
      try { if (statSync(file).isFile()) { if (platform !== 'win32') accessSync(file, constants.X_OK); return file; } } catch { /* not here */ }
    }
  return '';
}
/** @type {(command: string, args: string[]) => boolean} */
const works = (command, args) => spawnSync(command, args, { encoding: 'utf8', timeout: 20_000, windowsHide: true }).status === 0;
/** A program's stdout, or null when it failed. @type {(command: string, args: string[]) => string | null} */
const answer = (command, args) => {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: 20_000, windowsHide: true });
  return r.status === 0 ? r.stdout : null;
};

/** Python ≥ 3.11 with venv and sqlite3 (sprite-gen's venv, og reading codex's session table); prints its own path. */
const PYTHON_PROBE = 'import sys, venv, sqlite3; ok = (3, 11) <= sys.version_info[:2] < (3, 14); print(sys.executable if ok else ""); sys.exit(0 if ok else 1)';

/**
 * What this PC lacks for the generator, and what only deserves a warning.
 * `npm run host` (runner false): Linux only — bash, flock, systemd and the tools from the system (sprite-gen's setup and og's own).
 * `npx oddbout-host` (runner true, 2026-11-07): Windows, macOS or Linux with Node 22.12+; Python and ffmpeg come from the system when it has
 * them (Python 3.11-3.13 with venv and sqlite3; ffmpeg on Linux only), else from the runner's pins (`python`/`ffmpeg` then '').
 * @param {{ find?: (name: string) => string, run?: (command: string, args: string[]) => boolean, ask?: (command: string, args: string[]) => string | null,
 *   platform?: NodeJS.Platform, arch?: string, node?: string, memory?: number, runner?: boolean, env?: NodeJS.ProcessEnv }} [options]
 * @returns {{ missing: string[], warnings: string[], python: string, toolPath: string, gpu?: boolean, ffmpeg?: string }}
 */
export function checkSystem({ find = name => which(name), run = works, ask = answer, platform = process.platform, arch = process.arch,
  node = process.versions.node, memory = totalmem(), runner = false, env = process.env } = {}) {
  const missing = /** @type {string[]} */ ([]), warnings = /** @type {string[]} */ ([]);
  const [major, minor] = node.split('.').map(Number);
  if (runner) {
    if (!['win32', 'darwin', 'linux'].includes(platform)) return { missing: [`Windows·macOS·Linux (지금 ${platform})`], warnings, python: '', toolPath: '' };
    if (major < 22 || (major === 22 && minor < 12)) missing.push(`Node 22.12 이상(지금 ${node})`);
    // Python's standalone build comes as .tar.gz: Windows 10 1803+ and macOS have bsdtar, Linux GNU tar.
    const tar = platform === 'win32' ? path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : find('tar');
    if (!tar || (platform === 'win32' && !existsSync(tar))) missing.push(platform === 'win32' ? 'tar.exe (Windows 10 1803 이상에 들어 있다)' : 'tar');
    if (platform === 'linux' && !run('systemctl', ['--user', 'show-environment']))
      missing.push('systemd 사용자 관리자(og.mjs는 메모리 상한 없이 생성하지 않는다). 로그인 세션에서 다시 하거나 loginctl enable-linger를 켠다');
    if (platform === 'win32' && arch !== 'x64') warnings.push(`이 PC는 ${arch}다. ffmpeg와 고리 정렬의 RIFE는 x64용을 에뮬레이션으로 돌린다(느리거나 안 될 수 있다).`);
    let python = '';
    /** @type {[string, string[]][]} */
    const candidates = platform === 'win32' ? [['py', ['-3.12']], ['py', ['-3.13']], ['py', ['-3.11']], ['python', []]]
      : [['python3.12', []], ['python3.13', []], ['python3.11', []], ['python3', []]];
    for (const [name, prefix] of candidates) {
      const at = find(name);
      // Windows' store alias (WindowsApps\python.exe) opens the store instead of running.
      if (!at || /[\\/]WindowsApps[\\/]/i.test(at)) continue;
      const exe = ask(at, [...prefix, '-c', PYTHON_PROBE])?.trim();
      if (exe && path.isAbsolute(exe)) { python = exe; break; }
    }
    let ffmpeg = '';
    if (platform === 'linux') {
      const [mpeg, probe] = [find('ffmpeg'), find('ffprobe')];
      if (mpeg && probe && path.dirname(mpeg) === path.dirname(probe) && run(mpeg, ['-version']) && run(probe, ['-version'])) ffmpeg = path.dirname(mpeg);
    }
    if (memory < 12 * 2 ** 30) warnings.push(`메모리가 ${Math.round(memory / 2 ** 30)} GB다. 생성 중에는 다른 무거운 프로그램을 닫는다(codex 칸 2개).`);
    const smi = find('nvidia-smi');
    return { missing, warnings, python, toolPath: '', gpu: Boolean(smi) && run(smi, ['-L']), ffmpeg };
  }
  if (platform !== 'linux') return { missing: ['Linux (npm run host 는 Linux 전용이다 — systemd 사용자 서비스와 flock을 쓴다. Windows·macOS는 npx oddbout-host)'], warnings, python: '', toolPath: '' };
  if (major < 22) missing.push(`Node 22 이상(지금 ${node})`);
  /** @type {Record<string, string>} */
  const tools = {};
  for (const name of ['bash', 'git', 'zip', 'unzip', 'flock', 'timeout', 'systemd-run', 'systemctl', 'ffmpeg', 'ffprobe', 'img2webp']) {
    tools[name] = find(name);
    if (!tools[name]) missing.push(name === 'img2webp' ? 'img2webp (libwebp 도구 — 예: apt install webp)' : name);
  }
  // sprite-gen wants Python 3.11+ with venv; og reads codex's session table with sqlite3.
  let python = '';
  for (const name of ['python3.13', 'python3.12', 'python3.11', 'python3']) {
    const at = find(name);
    if (at && run(at, ['-c', 'import sys, venv, sqlite3; sys.exit(0 if sys.version_info >= (3, 11) else 1)'])) { python = at; break; }
  }
  if (!python) missing.push('Python 3.11 이상(venv·sqlite3 포함)');
  if (tools.systemctl && !run(tools.systemctl, ['--user', 'show-environment']))
    warnings.push('systemd 사용자 관리자에 닿지 못했다. 워커는 메모리 상한(systemd 슬라이스) 없이는 돌지 않는다. 로그인 세션에서 다시 하거나 loginctl enable-linger를 켠다.');
  if (memory < 12 * 2 ** 30) warnings.push(`메모리가 ${Math.round(memory / 2 ** 30)} GB다. --slots 2 --memory 6G 로 설치하기를 권한다.`);
  // An NVIDIA GPU runs the loop alignment's RIFE on PyTorch (`--rife torch`): about twice as fast, the same frames (2026-10-28).
  const gpu = Boolean(find('nvidia-smi')) && run(find('nvidia-smi'), ['-L']);
  const toolPath = [...new Set(['ffmpeg', 'ffprobe', 'img2webp', 'zip', 'unzip', 'git'].map(name => tools[name]).filter(Boolean).map(p => path.dirname(p))
    .filter(d => !SYSTEM_DIRS.has(d) && d !== path.dirname(process.execPath)))].join(':');
  return { missing, warnings, python, toolPath, gpu };
}
