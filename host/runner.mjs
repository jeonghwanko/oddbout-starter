#!/usr/bin/env node
// @ts-check
// npx oddbout-host (계획 1.3, 2026-11-07): one command on a creator's own Windows, macOS or Linux PC makes it a generation host for his
// SuperGrok (and, if he wants GPT pictures, his ChatGPT). The first run, in this order (each step said to the site in the heartbeat's
// `setup`, so his My PC card shows where it is):
//   1. connect   — the PC pairs with his oddbout.com account (api/host-pairing.mjs): a page opens, he presses 연결, the worker key comes
//                  back here and goes into og's worker.env without ever reaching the screen
//   2. kit       — the creator kit's ZIP (vendor/sprite-gen inside: no Git, no submodule), its Node packages
//   3. python    — a standalone Python 3.12, only when the PC has no 3.11-3.13 of its own
//   4. sprite    — sprite-gen's venv with img2webp and RIFE (the kit's sprite:setup)
//   5. ffmpeg    — a static ffmpeg and ffprobe (Linux keeps the system's when it has them)
//   6. grok      — the Grok CLI, then its device sign-in
//   7. codex     — optional: the Codex CLI and its sign-in, for GPT pictures
//   8. the worker, in front of him in this terminal (og.mjs worker run), until he closes it
// Every download is exactly what pins.json names (size and SHA-256; the CLIs by their npm lockfiles in cli/). A later run with a new
// version updates the install only while no job is open (openJobs): a half-made fighter finishes on the files it started with.
// The install: Windows %LOCALAPPDATA%\oddbout-host, macOS ~/Library/Application Support/oddbout-host, Linux ~/.local/share/oddbout-host
// (host/install.mjs defaultRoot). Only Node built-ins and host/'s own files: the npm package carries host/ alone (host/package.json).
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, readSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApi, parseEnv, spritePython } from './generation-worker.mjs';
import { checkSystem, codexHealthy, defaultRoot, healthy, hostEnv, installFiles, installed, openJobs, platformName, readHostEnv, signIn } from './install.mjs';
import { download, platformKey, readZip, untar, unzip, zipEntry } from './pinned.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** @type {any} */
export const PINS = JSON.parse(readFileSync(path.join(HERE, 'pins.json'), 'utf8'));
export const VERSION = String(JSON.parse(readFileSync(path.join(HERE, 'package.json'), 'utf8')).version);
/** A typed join code from the site (api/generations.mjs JOIN_CODE; runner.test.mjs keeps them equal): the way in without pairing. */
export const JOIN_CODE = /^ohj_[a-f0-9]{40}$/;
/** The heartbeat's `setup` values in order (api/host-pairing.mjs's note); a failure is `<stage>-failed`. */
export const STAGES = Object.freeze(['kit', 'python', 'sprite', 'ffmpeg', 'grok-login', 'codex-login', 'ready']);
const LOGIN = 'npx oddbout-host login';
const sha256 = (/** @type {Buffer | string} */ bytes) => createHash('sha256').update(bytes).digest('hex');

export const USAGE = `npx oddbout-host [--name <PC 이름>] [--codex | --no-codex] [--slots 2|3] [--root <폴더>]
  처음: 이 PC를 oddbout.com 계정에 연결하고(브라우저에서 "연결" 한 번), 생성기를 설치하고, Grok(SuperGrok)에 로그인한 뒤
        이 창에서 워커를 돌린다. 창을 닫으면 멈춘다. 다음부터는 같은 명령 한 줄로 다시 켠다.
  --codex       ChatGPT 구독도 쓴다: GPT 그림을 고를 수 있다(Codex CLI 약 500 MB). --no-codex 는 묻지 않는다.
  --join <코드> 사이트의 붙이기 코드(ohj_…)로 연결한다(코드 없는 연결이 안 될 때)
npx oddbout-host login grok|codex [--replace]   구독 로그인(--replace: 다른 계정으로)
npx oddbout-host status                          설치·로그인·작업
설치 폴더: Windows %LOCALAPPDATA%\\oddbout-host, macOS ~/Library/Application Support/oddbout-host,
          Linux ~/.local/share/oddbout-host (ODDBOUT_HOST_ROOT 로 바꾼다)`;

/** @type {Record<string, string>} */
const MESSAGES = {
  'pairing-expired': '연결 코드가 10분 안에 승인되지 않아 만료됐다. 같은 명령을 다시 실행해 새 코드를 받는다.',
  'pairing-consumed': '이 연결 코드는 이미 쓰였다. 같은 명령을 다시 실행해 새 코드를 받는다.',
  'join-code-invalid': '붙이기 코드가 만료됐거나 이미 쓰였다. oddbout.com 내 선수의 "내 PC로 만들기"에서 새 코드를 받는다.',
  'invalid-join-code': '붙이기 코드 모양이 아니다(ohj_ 로 시작한다). 사이트에 보인 코드를 그대로 붙여 넣는다.',
  'rate-limit': '연결 요청이 너무 많다. 몇 분 뒤 다시 한다.',
  'invalid-pc': 'PC 이름이 맞지 않는다: --name <1~40자> 로 다시 한다.',
  'host-key-limit': '살아 있는 워커 열쇠가 이미 둘이다. oddbout.com 내 PC에서 열쇠를 끄고 다시 한다.',
  'host-env-path': 'node·Python·도구 경로에 쓸 수 없는 글자(쌍점·줄바꿈·=)가 있다. ODDBOUT_HOST_ROOT 로 다른 설치 폴더를 쓴다.',
  'host-env-limits': '--slots 는 2 또는 3 이다.',
  'pin-mismatch': '받은 파일이 고정한 SHA-256과 다르다. 쓰지 않고 멈췄다(네트워크가 바꿨거나 배포처가 바뀌었다). 같은 명령을 다시 하고, 또 그러면 알려 준다.',
  'download-failed': '내려받지 못했다. 인터넷 연결(프록시·방화벽)을 확인하고 같은 명령을 다시 한다. 받은 만큼은 남아 있다.',
  'download-size': '받은 파일 크기가 고정한 크기와 다르다. 같은 명령을 다시 한다.',
  'zip-invalid': '받은 압축 파일을 풀 수 없다. 같은 명령을 다시 한다.',
  'untar-failed': 'Python 압축을 풀지 못했다(tar). 같은 명령을 다시 한다.',
  'kit-invalid': '키트가 고정한 내용과 다르다. 쓰지 않고 멈췄다.',
  'npm-failed': 'npm 설치가 끝나지 않았다. 인터넷 연결을 확인하고 같은 명령을 다시 한다.',
};
/** @param {string | undefined} code */
const explain = code => (code && MESSAGES[code]) ?? `실패: ${code ?? '알 수 없음'}`;
/** @param {string} code @param {string} [detail] */
const fail = (code, detail) => Object.assign(new Error(detail ? `${code}: ${detail}` : code), { code });

/**
 * @typedef {{ main: (argv: string[], io?: { out?: (t: any) => void, err?: (t: string) => void, stdin?: () => Promise<string> }) => Promise<{ code: number }>,
 *   health: () => Promise<string>, setupStep: (name: 'kit' | 'engine' | 'slice', io: { out: (t: any) => void, err: (t: string) => void }) => Promise<void>,
 *   stopAll: (code?: number) => Promise<unknown>, running: number }} Og
 * @typedef {{
 *   root: string, out: (line: string) => void, write: (text: string) => void, platform: NodeJS.Platform, arch: string, env: NodeJS.ProcessEnv,
 *   nodeBin: string, fetcher: typeof fetch, now: () => number, sleep: (ms: number) => Promise<void>, hostname: () => string,
 *   system: () => ReturnType<typeof checkSystem>, serviceActive: () => boolean, openUrl: (url: string) => void, ask: (question: string) => Promise<string | null>,
 *   loadOg: (root: string, about: Record<string, string> | null) => Promise<Og>,
 *   npm: (args: string[], options: { cwd: string, log: string }) => Promise<number>,
 *   progress?: (label: string, received: number, total: number) => void, tail?: (file: string) => () => void, onWorker?: (og: Og) => void,
 *   pins?: any, here?: string, pid?: number, alive?: (pid: number) => boolean,
 *   readonly ogModule?: any }} RunnerDeps  ogModule: the loaded og.mjs, for stopping its children on exit
 * @typedef {{ command: string, root?: string, name?: string, codex?: boolean, slots?: number, join?: string, replace: boolean, provider?: string, once: boolean }} Options
 */

/** @param {string[]} argv @returns {Options} */
export function parseArgs(argv) {
  /** @type {Options} */
  const options = { command: 'start', replace: false, once: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    /** @param {string} name */
    const value = name => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${name} 다음에 값이 필요하다`); return v; };
    if (a === '--root') options.root = path.resolve(value(a));
    else if (a === '--name') options.name = value(a);
    else if (a === '--join') options.join = value(a);
    else if (a === '--slots') { options.slots = Number(value(a)); if (![2, 3].includes(options.slots)) throw new Error('--slots 는 2 또는 3'); }
    else if (a === '--codex') options.codex = true;
    else if (a === '--no-codex') options.codex = false;
    else if (a === '--replace') options.replace = true;
    else if (a === '--once') options.once = true;
    else if (a === '-h' || a === '--help') options.command = 'help';
    else if (a.startsWith('-')) throw new Error(`모르는 옵션 ${a}`);
    else positional.push(a);
  }
  if (options.command !== 'help' && positional.length) {
    const [command, ...rest] = positional;
    if (!['start', 'login', 'status', 'help'].includes(command)) throw new Error(`모르는 명령 ${command}`);
    options.command = command;
    if (command === 'login') {
      if (rest.length > 1 || (rest[0] && !['grok', 'codex'].includes(rest[0]))) throw new Error('login grok|codex');
      options.provider = rest[0] ?? 'grok';
    } else if (rest.length) throw new Error(`${command} 뒤에 남는 말: ${rest.join(' ')}`);
  }
  return options;
}

/** The PC's name as the site shows it: one line, 1-40 characters. @param {string} name */
export const pcName = name => String(name ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 40).trim() || 'My PC';

/**
 * This root for one runner at a time (the worker in front holds it): the release function, or null while another live runner has it.
 * @param {string} root @param {number} pid @param {(pid: number) => boolean} alive
 */
export function takeLock(root, pid, alive) {
  const file = path.join(root, 'runner.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx', 0o600);
      writeSync(fd, String(pid)); closeSync(fd);
      return () => { try { if (readFileSync(file, 'utf8').trim() === String(pid)) unlinkSync(file); } catch { /* gone */ } };
    } catch (/** @type {any} */ error) {
      if (error.code !== 'EEXIST') throw error;
      const other = Number(readFileSync(file, 'utf8').trim());
      if (Number.isInteger(other) && other > 0 && other !== pid && alive(other)) return null;
      rmSync(file, { force: true });
    }
  }
  return null;
}

/** What this install holds (runner.json): each part's pin, so a later run redoes only what changed. @param {string} root @returns {Record<string, any>} */
const readRecord = root => { try { return JSON.parse(readFileSync(path.join(root, 'runner.json'), 'utf8')); } catch { return {}; } };
/** @param {string} root @param {Record<string, any>} record */
const writeRecord = (root, record) => writeFileSync(path.join(root, 'runner.json'), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });

/** A folder renamed into place (Windows may hold a file a moment after its last reader: three tries). @param {string} from @param {string} to */
async function moveInto(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { await rm(to, { recursive: true, force: true }); await rename(from, to); return; }
    catch (/** @type {any} */ error) { if (attempt >= 2) throw error; await new Promise(resolve => setTimeout(resolve, 1000)); }
  }
}

/**
 * The pinned kit ZIP into <root>/kit: its runtime/ files, each checked against the release's runtime-manifest.json (itself pinned), with
 * the jobs folder of the kit before it moved over. Writes <kit>/.oddbout-kit.json, which og.mjs reads as "a ZIP kit: no Git".
 * @param {string} root @param {any} pin @param {RunnerDeps} deps
 */
export async function installKit(root, pin, deps) {
  const file = await download(pin, path.join(root, 'downloads'), { fetcher: deps.fetcher, onProgress: (n, total) => deps.progress?.('kit', n, total) });
  const zip = await readFile(file), entries = readZip(zip);
  const manifestEntry = entries.find(e => e.name === 'runtime-manifest.json');
  if (!manifestEntry) throw fail('kit-invalid', 'no runtime-manifest.json');
  const manifestBytes = zipEntry(zip, manifestEntry);
  if (sha256(manifestBytes) !== pin.runtimeManifestSha256) throw fail('kit-invalid', 'runtime manifest');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.spriteGenCommit !== pin.spriteGenCommit) throw fail('kit-invalid', 'engine commit');
  /** @type {Record<string, string>} */
  const files = manifest.files ?? {};
  const fresh = path.join(root, 'kit.new'), kit = path.join(root, 'kit');
  await rm(fresh, { recursive: true, force: true });
  const written = new Set();
  for (const entry of entries) {
    if (entry.directory || !entry.name.startsWith(pin.runtime)) continue;
    const relative = entry.name.slice(pin.runtime.length), bytes = zipEntry(zip, entry);
    if (files[relative] !== sha256(bytes)) throw fail('kit-invalid', relative);
    const target = path.join(fresh, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    written.add(relative);
  }
  const lacking = Object.keys(files).filter(name => !written.has(name));
  if (lacking.length) throw fail('kit-invalid', `missing ${lacking.slice(0, 3).join(', ')}`);
  await writeFile(path.join(fresh, '.oddbout-kit.json'), JSON.stringify({ version: pin.version, sha256: pin.sha256, spriteGenCommit: pin.spriteGenCommit }, null, 2) + '\n');
  // The jobs (closed ones wait for their prune) stay with the install, not with a kit.
  if (existsSync(path.join(kit, 'output'))) await rename(path.join(kit, 'output'), path.join(fresh, 'output'));
  await moveInto(fresh, kit);
  await rm(file, { force: true });
}

/** The pinned standalone Python into <root>/python. @param {string} root @param {any} pin @param {RunnerDeps} deps */
export async function installPython(root, pin, deps) {
  const file = await download(pin, path.join(root, 'downloads'), { fetcher: deps.fetcher, onProgress: (n, total) => deps.progress?.('python', n, total) });
  const fresh = path.join(root, 'python.new');
  await rm(fresh, { recursive: true, force: true });
  await untar(file, fresh, { platform: deps.platform, env: deps.env });
  if (!existsSync(path.join(fresh, ...pin.exe.split('/')))) throw fail('untar-failed', `no ${pin.exe}`);
  await moveInto(path.join(fresh, pin.exe.split('/')[0]), path.join(root, pin.exe.split('/')[0]));
  await rm(fresh, { recursive: true, force: true });
  await rm(file, { force: true });
}

/** The pinned ffmpeg and ffprobe into `dir`. @param {string} dir @param {any[]} archives @param {RunnerDeps} deps @param {string} downloads */
export async function installFfmpeg(dir, archives, deps, downloads) {
  const fresh = `${dir}.new`;
  await rm(fresh, { recursive: true, force: true });
  for (const pin of archives) {
    const file = await download(pin, downloads, { fetcher: deps.fetcher, onProgress: (n, total) => deps.progress?.('ffmpeg', n, total) });
    /** @type {[string, string][]} */
    const wanted = Object.entries(pin.files);
    const got = await unzip(file, fresh, name => wanted.find(([, from]) => from === name)?.[0] ?? null, { executable: () => true });
    if (got.length !== wanted.length) throw fail('zip-invalid', `ffmpeg archive lacks ${wanted.map(([n]) => n).filter(n => !got.includes(n)).join(', ')}`);
    await rm(file, { force: true });
  }
  await moveInto(fresh, dir);
}

/**
 * One CLI from its pinned lockfile (cli/<name>: package.json and lock.json) into <root>/<folder>, with npm ci and no install scripts — the
 * Grok CLI's would copy its binary into the person's own ~/.grok; its launcher unpacks it into the install's HOME on first use instead.
 * @param {string} root @param {string} folder @param {any} pin @param {RunnerDeps} deps @param {string} log
 */
export async function installCli(root, folder, pin, deps, log) {
  const from = path.join(deps.here ?? HERE, pin.lock), dir = path.join(root, folder);
  const lock = JSON.parse(await readFile(path.join(from, 'lock.json'), 'utf8'));
  const top = lock.packages?.[`node_modules/${pin.package}`];
  if (top?.version !== pin.version || top?.integrity !== pin.integrity) throw fail('kit-invalid', `${pin.package} lock`);
  await mkdir(dir, { recursive: true });
  await copyFile(path.join(from, 'package.json'), path.join(dir, 'package.json'));
  await copyFile(path.join(from, 'lock.json'), path.join(dir, 'package-lock.json'));
  if (await deps.npm(['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, log }) !== 0) throw fail('npm-failed', pin.package);
  const installedVersion = JSON.parse(await readFile(path.join(dir, 'node_modules', ...pin.package.split('/'), 'package.json'), 'utf8')).version;
  if (installedVersion !== pin.version) throw fail('npm-failed', `${pin.package}@${installedVersion}`);
}
/** @param {string} root @param {string} folder @param {any} pin */
const cliReady = (root, folder, pin) => {
  try { return JSON.parse(readFileSync(path.join(root, folder, 'node_modules', ...pin.package.split('/'), 'package.json'), 'utf8')).version === pin.version; }
  catch { return false; }
};

/** og's command line as signIn and the rest call it: its output to the terminal, or read back (`capture`). @param {Og} og @param {RunnerDeps} deps @param {{ health: string }} seen */
const ogCall = (og, deps, seen) => async (/** @type {string[]} */ args, /** @type {{ capture?: boolean }} */ { capture = false } = {}) => {
  let output = '';
  /** @param {any} text */
  const sink = text => { if (capture) output += String(text); else deps.write(String(text)); };
  const { code } = await og.main(args, { out: sink, err: sink });
  if (args[0] === 'health') seen.health = output;
  return { code, output };
};

/**
 * The PC's link to its owner's account: pairing with no code to copy (api/host-pairing.mjs), or a join code typed from the site. The worker
 * key goes from the API's reply into og's worker.env on stdin, never to the screen, argv or a file of this runner.
 * @param {Options} opts @param {RunnerDeps} deps @param {Og} og @returns {Promise<number>}
 */
async function connect(opts, deps, og) {
  const { out } = deps, pins = deps.pins ?? PINS, base = pins.service.apiBase;
  /** @param {string} route @param {object} [body] */
  const call = async (route, body) => {
    const response = await deps.fetcher(`${base}/${route}`, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { apikey: pins.service.publishableKey, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: /** @type {any} */ (await response.json().catch(() => null)) };
  };
  let key = '', hostName = '';
  if (opts.join) {
    if (!JOIN_CODE.test(opts.join)) { out(MESSAGES['invalid-join-code']); return 1; }
    const reply = await call('generations/host/join', { code: opts.join });
    if (reply.body?.ok !== true || typeof reply.body.key !== 'string') { out(explain(reply.body?.code ?? `api-http-${reply.status}`)); return 1; }
    ({ key, name: hostName } = reply.body);
  } else {
    const spec = await call('spec');
    if (spec.body?.data?.registration?.hostPairing !== 'v1') {
      out('서버가 아직 코드 없는 연결을 받지 않는다. oddbout.com 내 선수 → "내 PC로 만들기"의 붙이기 코드로: npx oddbout-host --join <코드>');
      return 1;
    }
    const name = pcName(opts.name ?? deps.hostname());
    const started = await call('generations/host/pairings', { name, platform: platformName(deps.platform) });
    if (started.body?.ok !== true) { out(explain(started.body?.code ?? `api-http-${started.status}`)); return 1; }
    const { pairingCode, userCode, url } = started.body;
    let interval = Number(started.body.interval) || 5;
    out('');
    out(`이 PC(${name})를 oddbout.com 계정에 연결한다. 브라우저에서 로그인한 계정으로 "연결"을 누른다:`);
    out(`  ${url}`);
    out(`  사이트에 코드 ${userCode} 와 이 PC 이름이 보이는지 확인한다(10분 유효). 브라우저가 안 열리면 위 주소를 직접 연다.`);
    deps.openUrl(url);
    const until = Math.min(Date.parse(started.body.expiresAt) || Infinity, deps.now() + 11 * 60_000);
    for (;;) {
      await deps.sleep(interval * 1000);
      if (deps.now() > until) { out(MESSAGES['pairing-expired']); return 1; }
      let reply;
      try { reply = await call('generations/host/pairings/token', { pairingCode }); } catch { continue; }   // a dropped connection: ask again
      if (reply.status === 429) { interval += 5; continue; }
      if (reply.body?.ok === true && reply.body.status === 'pending') continue;
      if (reply.body?.ok === true && reply.body.status === 'approved' && typeof reply.body.key === 'string') { ({ key, name: hostName } = reply.body); break; }
      if (reply.status >= 500) continue;
      out(explain(reply.body?.code ?? `api-http-${reply.status}`)); return 1;
    }
  }
  /** @type {string[]} */ const said = [];
  const wrote = await og.main(['worker', 'key', base], { out: () => {}, err: text => { said.push(String(text)); }, stdin: async () => `${key}\n` });
  if (wrote.code !== 0) { out(said.join('').trim()); return 1; }
  out(`연결했다: 호스트 ${hostName}. 워커 열쇠는 이 PC의 설치 폴더에만 있다(화면에 보이지 않는다, 90일).`);
  return 0;
}

/**
 * Heartbeats while the runner installs (the worker sends its own once it runs): `setup` says the step, the logins say not ready yet.
 * Resolves the API's reply (null when it could not be reached): 403 `worker-required` is a key the site turned off, or one past its 90 days.
 * @param {string} root @param {RunnerDeps} deps @returns {Promise<(stage: string) => Promise<any>>}
 */
async function heartbeater(root, deps) {
  const env = parseEnv(await readFile(path.join(root, 'worker.env'), 'utf8'));
  const api = createApi({ base: String(env.ODDBOUT_GENERATION_API).replace(/\/$/, ''), key: env.ODDBOUT_GENERATION_WORKER_KEY, fetcher: deps.fetcher });
  return stage => api.heartbeat({ ok: false, codex: false, grok: false, images: [], at: new Date(deps.now()).toISOString(), setup: stage,
    platform: platformName(deps.platform), runner: VERSION }).catch(() => null);
}

/**
 * One command. Resolves the exit code; the worker (the default command, once ready) resolves only when it stops.
 * @param {string[]} argv @param {RunnerDeps} deps @returns {Promise<number>}
 */
export async function runRunner(argv, deps) {
  /** @type {Options} */ let opts;
  try { opts = parseArgs(argv); } catch (/** @type {any} */ error) { deps.out(error.message); deps.out(USAGE); return 2; }
  const root = opts.root ?? deps.root;
  if (opts.command === 'help') { deps.out(USAGE); return 0; }
  if (opts.command === 'status') return status(root, deps);
  const system = deps.system();
  for (const line of system.warnings) deps.out(`주의: ${line}`);
  if (system.missing.length) { deps.out(`이 PC에 없는 것: ${system.missing.join(', ')}`); return 1; }
  if (deps.serviceActive()) { deps.out('이 PC는 서비스 워커(npm run host)로 돈다. 두 워커가 한 설치를 나눠 쓰지 않도록, 먼저: npm run host -- stop'); return 1; }
  await mkdir(root, { recursive: true, mode: 0o700 });
  const release = takeLock(root, deps.pid ?? process.pid, deps.alive ?? (() => true));
  if (!release) { deps.out(`이 설치 폴더(${root})는 다른 oddbout-host 창이 쓰고 있다. 그 창에서 Ctrl-C로 끝내고 다시 한다.`); return 1; }
  try {
    return opts.command === 'login' ? await login(root, opts, deps) : await start(root, opts, deps, system);
  } catch (/** @type {any} */ error) {
    // A known failure in its words (and what it was about); another, as it said itself (og's refusals: "sprite:setup failed (exit 1)").
    deps.out(error?.code && MESSAGES[error.code] ? MESSAGES[error.code] : `실패: ${error?.message ?? error}`);
    if (error?.code && MESSAGES[error.code] && error.message !== error.code) deps.out(`  (${error.message})`);
    const log = path.join(root, 'setup.log');
    if (existsSync(log)) deps.out(`설치 기록: ${log}\n${readFileSync(log, 'utf8').trimEnd().split('\n').slice(-15).join('\n')}`);
    return 1;
  } finally { release(); }
}

/** @param {string} root @param {Options} opts @param {RunnerDeps} deps @param {ReturnType<typeof checkSystem>} system */
async function start(root, opts, deps, system) {
  const { out, platform } = deps, pins = deps.pins ?? PINS, key = platformKey(platform, deps.arch);
  const pythonPin = pins.python.builds[key];
  const ffmpegPins = pins.ffmpeg.builds[key] ?? pins.ffmpeg.builds[pins.ffmpeg.fallback?.[key]];
  if (!system.python && !pythonPin) { out(`이 PC(${key})에 맞는 Python이 없다: Python 3.12를 설치한 뒤 다시 한다.`); return 1; }
  if (!system.ffmpeg && !ffmpegPins) { out(`이 PC(${key})에 맞는 ffmpeg가 없다: ffmpeg·ffprobe를 설치한 뒤 다시 한다.`); return 1; }
  if (platform === 'win32' && root.length > 80) out(`주의: 설치 폴더 경로가 길다(${root.length}자). Windows 경로 260자 한도에 걸릴 수 있다: ODDBOUT_HOST_ROOT=C:\\oddbout 처럼 짧게.`);
  const record = readRecord(root), open = openJobs(root), was = installed(root, 'og.mjs');
  // A new version (or kit) waits while a job is open: it finishes on the files it started with.
  const frozen = was && open.length > 0 && (record.runner !== VERSION || record.kit !== pins.kit.sha256);
  if (frozen) out(`열린 작업 ${open.length}개(${open.join(', ')})가 끝날 때까지 이 PC의 설치(${record.runner ?? '?'})를 ${VERSION}으로 올리지 않는다. 끝나면 같은 명령을 다시 한다.`);
  if (!was) out(`처음 설치: ${root} 에 1 GB 넘게 받는다(키트·Python·sprite-gen·RIFE·ffmpeg·Grok CLI). 10~30분 걸린다.`);
  const log = path.join(root, 'setup.log'), logIo = { out: (/** @type {any} */ t) => appendFileSync(log, String(t)), err: (/** @type {string} */ t) => appendFileSync(log, t) };
  const python = system.python || path.join(root, ...pythonPin.exe.split('/'));
  const ffmpegDir = system.ffmpeg || path.join(root, `ffmpeg-${pins.ffmpeg.version}`), codexBin = path.join(root, 'codex', 'node_modules', '.bin');
  const previous = was ? readHostEnv(await readFile(path.join(root, 'host.env'), 'utf8')) : {};
  const slots = opts.slots ?? (Number(previous.SLOTS) || (platform === 'linux' ? 3 : 2));
  const writeEnv = () => writeFile(path.join(root, 'host.env'), hostEnv({ nodeBin: deps.nodeBin, python, platform, slots, memory: previous.MEMORY || '8G',
    toolPath: [ffmpegDir, ...(cliReady(root, 'codex', pins.cli.codex) ? [codexBin] : [])].join(platform === 'win32' ? ';' : ':') }), { mode: 0o600 });
  if (!frozen) {
    await installFiles(root, deps.here ?? HERE, { og: true });
    await writeEnv();
  }
  let og = await deps.loadOg(root, null);
  const paired = existsSync(path.join(root, 'worker.env'));
  if (!paired && await connect(opts, deps, og) !== 0) return 1;
  let beat = await heartbeater(root, deps);
  // A key from before that the API no longer takes (turned off on the site, past 90 days): this PC pairs again, nothing else changes.
  if (paired && (await beat(record.runner ? 'ready' : STAGES[0]))?.code === 'worker-required') {
    out('이 PC의 워커 열쇠가 꺼졌거나 만료됐다. 다시 연결한다.');
    await rm(path.join(root, 'worker.env'), { force: true });
    if (await connect(opts, deps, og) !== 0) return 1;
    beat = await heartbeater(root, deps);
  }
  /** @param {string} name @param {string} label @param {() => Promise<void>} work */
  const stage = async (name, label, work) => {
    out(`· ${label}`);
    appendFileSync(log, `\n== ${new Date(deps.now()).toISOString()} ${name}\n`);
    await beat(name);
    try { await work(); } catch (error) { await beat(`${name}-failed`); throw error; }
  };
  const pythonId = system.python ? `system:${system.python}` : pythonPin.sha256;
  if (!frozen) {
    if (record.kit !== pins.kit.sha256 || !existsSync(path.join(root, 'kit', '.oddbout-kit.json'))) {
      await stage('kit', `키트 ${pins.kit.version} 받기`, async () => {
        await installKit(root, pins.kit, deps);
        delete record.engine; delete record.kit; writeRecord(root, record);
        await og.setupStep('kit', logIo);
        record.kit = pins.kit.sha256; writeRecord(root, record);
      });
    }
    if (!system.python && (record.python !== pythonId || !existsSync(python))) {
      await stage('python', `Python ${pins.python.version} 받기(이 PC에 3.11~3.13이 없다)`, async () => {
        await installPython(root, pythonPin, deps);
        record.python = pythonId; writeRecord(root, record);
      });
    }
    const engineId = `${pins.kit.sha256}|${pythonId}`;
    if (record.engine !== engineId || !existsSync(spritePython(path.join(root, 'kit'), platform))) {
      await stage('sprite', 'sprite-gen·img2webp·RIFE 준비(가장 오래 걸린다)', async () => {
        // Another Python made the venv before: a venv belongs to the Python that made it.
        if (record.engine && record.engine !== engineId) await rm(path.join(root, 'kit', 'vendor', 'sprite-gen', '.venv'), { recursive: true, force: true });
        await og.setupStep('engine', logIo);
        await og.setupStep('slice', logIo);
        record.python = pythonId; record.engine = engineId; writeRecord(root, record);
      });
    }
    const ffmpegId = system.ffmpeg ? `system:${system.ffmpeg}` : ffmpegPins.map((/** @type {any} */ p) => p.sha256).join(',');
    const exe = platform === 'win32' ? '.exe' : '';
    if (!system.ffmpeg && (record.ffmpeg !== ffmpegId || !['ffmpeg', 'ffprobe'].every(n => existsSync(path.join(ffmpegDir, n + exe))))) {
      await stage('ffmpeg', `ffmpeg ${pins.ffmpeg.version} 받기`, async () => {
        await installFfmpeg(ffmpegDir, ffmpegPins, deps, path.join(root, 'downloads'));
        record.ffmpeg = ffmpegId; writeRecord(root, record);
      });
    }
    if (record.grok !== pins.cli.grok.integrity || !cliReady(root, 'tools', pins.cli.grok)) {
      await stage('grok-login', `Grok CLI ${pins.cli.grok.version} 설치`, async () => {
        await installCli(root, 'tools', pins.cli.grok, deps, log);
        record.grok = pins.cli.grok.integrity; writeRecord(root, record);
      });
    }
  }
  const seen = { health: '' }, call = ogCall(og, deps, seen);
  // Who signed in before stays (og pins the account): a health check, and a sign-in only when grok does not answer.
  seen.health = await og.health();
  if (!healthy(seen.health)) {
    await beat('grok-login');
    out('');
    out('Grok(SuperGrok) 로그인: 아래 주소를 브라우저에서 열고 코드를 넣는다. 이 PC가 쓸 SuperGrok 계정으로 로그인한다.');
    if (await signIn({ og: call, out, providers: ['grok'], replace: opts.replace, login: LOGIN }) !== 0) { await beat('grok-login-failed'); return 1; }
  }
  // Codex adds GPT pictures only (1.1): asked once, or named with --codex / --no-codex.
  if (!codexHealthy(seen.health)) {
    let want = opts.codex;
    if (want === undefined && !record.codexAsked) {
      // Asked once, at a terminal (null: no one to ask, as from a script). "No" is remembered; --codex or login codex later adds it.
      const answer = await deps.ask('ChatGPT(Plus·Pro) 구독도 있으면 그림을 GPT로도 그릴 수 있다. Codex CLI(약 500 MB)를 설치하고 로그인할까? [y/N] ');
      if (answer !== null) {
        want = /^(y|yes|ㅇ|예|네)$/i.test(answer.trim());
        record.codexAsked = true; if (!frozen) writeRecord(root, record);
        if (!want) out(`GPT 그림을 더하려면 나중에: ${LOGIN} codex`);
      }
    }
    if (want && frozen && !cliReady(root, 'codex', pins.cli.codex)) out('열린 작업이 끝난 뒤 codex를 더한다: npx oddbout-host login codex');
    else if (want) {
      await beat('codex-login');
      if (record.codex !== pins.cli.codex.integrity || !cliReady(root, 'codex', pins.cli.codex)) {
        out(`· Codex CLI ${pins.cli.codex.version} 설치`);
        await installCli(root, 'codex', pins.cli.codex, deps, log);
        record.codex = pins.cli.codex.integrity; writeRecord(root, record);
        await writeEnv();
        og = await deps.loadOg(root, null);
      }
      out('');
      if (await signIn({ og: ogCall(og, deps, seen), out, providers: ['codex'], replace: opts.replace, login: LOGIN }) !== 0) {
        await beat('codex-login-failed');
        out('codex 없이 계속한다: 그림은 Grok으로 그리고 판정은 픽셀로 한다.');
      }
    }
  }
  // The worker refuses to run until codex's shell, file and plugin features are off (og harden), codex or not.
  const hardened = await call(['harden'], { capture: true });
  if (hardened.code !== 0) { out(hardened.output.trim()); return 1; }
  if (!frozen) { record.runner = VERSION; writeRecord(root, record); }
  await beat('ready');
  out('');
  out('준비됐다. 이 창이 열려 있는 동안 이 PC가 내 선수를 만든다: oddbout.com 신청에서 "내 PC"를 고른다.');
  out('창을 닫거나 PC가 잠들면 멈춘다(맡은 단계는 다시 켜면 이어서 한다). 끝내려면 Ctrl-C.');
  og = await deps.loadOg(root, { platform: platformName(platform), runner: frozen ? String(record.runner ?? '?') : VERSION, setup: 'ready' });
  deps.onWorker?.(og);
  const stopTail = deps.tail?.(path.join(root, 'worker.log'));
  try {
    const { code } = await og.main(['worker', 'run', ...(opts.once ? ['--once'] : [])], { out: t => deps.write(String(t)), err: t => deps.write(String(t)) });
    return code;
  } finally { stopTail?.(); }
}

/** `login grok|codex`: a sign-in with this install's og, the Codex CLI first when it is not there. @param {string} root @param {Options} opts @param {RunnerDeps} deps */
async function login(root, opts, deps) {
  const pins = deps.pins ?? PINS, provider = opts.provider ?? 'grok';
  if (!installed(root, 'og.mjs')) { deps.out(`이 PC에는 아직 설치가 없다(${root}). 먼저: npx oddbout-host`); return 1; }
  const record = readRecord(root);
  if (!cliReady(root, provider === 'codex' ? 'codex' : 'tools', pins.cli[provider])) {
    deps.out(`· ${provider === 'codex' ? 'Codex' : 'Grok'} CLI ${pins.cli[provider].version} 설치`);
    await installCli(root, provider === 'codex' ? 'codex' : 'tools', pins.cli[provider], deps, path.join(root, 'setup.log'));
    record[provider] = pins.cli[provider].integrity; writeRecord(root, record);
    if (provider === 'codex') {
      // og finds codex through host.env's TOOL_PATH.
      const env = readHostEnv(await readFile(path.join(root, 'host.env'), 'utf8')), sep = deps.platform === 'win32' ? ';' : ':';
      const codexBin = path.join(root, 'codex', 'node_modules', '.bin'), toolPath = (env.TOOL_PATH || '').split(sep).filter(Boolean);
      if (!toolPath.includes(codexBin)) await writeFile(path.join(root, 'host.env'), hostEnv({ nodeBin: env.NODE_BIN || deps.nodeBin, python: env.PYTHON,
        toolPath: [...toolPath, codexBin].join(sep), slots: Number(env.SLOTS) || 2, memory: env.MEMORY || '8G', platform: deps.platform }), { mode: 0o600 });
    }
  }
  const og = await deps.loadOg(root, null);
  const code = await signIn({ og: ogCall(og, deps, { health: '' }), out: deps.out, providers: [provider], replace: opts.replace, login: LOGIN });
  if (code === 0) deps.out('워커가 켜져 있었다면 그 창에서 Ctrl-C 뒤 npx oddbout-host 로 다시 켠다.');
  return code;
}

/** @param {string} root @param {RunnerDeps} deps */
async function status(root, deps) {
  if (!installed(root, 'og.mjs')) { deps.out(`이 PC에는 아직 설치가 없다(${root}). 설치: npx oddbout-host`); return 0; }
  const record = readRecord(root);
  deps.out(`oddbout-host ${record.runner ?? '?'} 설치(${root}), 이 명령 ${VERSION}`);
  deps.out(`ODDBOUT 연결: ${existsSync(path.join(root, 'worker.env')) ? '됨' : '안 됨 — npx oddbout-host 로 연결한다'}`);
  const og = await deps.loadOg(root, null);
  return (await og.main(['status'], { out: t => deps.write(String(t)), err: t => deps.write(String(t)) })).code;
}

/** npm's own CLI script, run with this node (no npm.cmd, no shell): npx's, else the one beside node. @param {NodeJS.ProcessEnv} env */
function npmCli(env = process.env) {
  const node = process.execPath, from = env.npm_execpath ? path.dirname(env.npm_execpath) : '';
  return [from && path.join(from, 'npm-cli.js'), path.join(path.dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(node), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].find(file => file && existsSync(file)) ?? '';
}

/** @returns {RunnerDeps} */
function realDeps() {
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  /** @type {any} */ let ogModule = null;
  let shown = '';
  return {
    root: defaultRoot(), out: line => console.log(line), write: text => process.stdout.write(text),
    platform: process.platform, arch: process.arch, env: process.env, nodeBin: path.dirname(process.execPath),
    fetcher: fetch, now: Date.now, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), hostname: () => os.hostname(),
    system: () => checkSystem({ runner: true }),
    serviceActive: () => process.platform === 'linux' && spawnSync('systemctl', ['--user', 'is-active', '--quiet', 'oddbout-host-worker.service'], { stdio: 'ignore' }).status === 0,
    openUrl: url => {
      const [command, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
      if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return;
      try { const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }); child.on('error', () => {}); child.unref(); } catch { /* the address is on screen */ }
    },
    ask: async question => {
      if (!tty) return null;
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { return await rl.question(question); } finally { rl.close(); }
    },
    loadOg: async (root, about) => {
      ogModule = await import(pathToFileURL(path.join(root, 'bin', 'og.mjs')).href);
      return ogModule.createOg({ root, about });
    },
    npm: (args, { cwd, log }) => new Promise(resolve => {
      const cli = npmCli();
      if (!cli) { appendFileSync(log, `npm not found beside ${process.execPath}\n`); resolve(127); return; }
      const fd = openSync(log, 'a');
      const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, npm_config_update_notifier: 'false' }, stdio: ['ignore', fd, fd], windowsHide: true });
      child.on('error', () => { closeSync(fd); resolve(127); });
      child.on('close', code => { closeSync(fd); resolve(code ?? 1); });
    }),
    progress: (label, received, total) => {
      if (!tty) return;
      const line = `  ${label} ${(received / 2 ** 20).toFixed(0)}/${(total / 2 ** 20).toFixed(0)} MB`;
      if (line !== shown) { process.stdout.write(`\r${line}${received >= total ? '\n' : ''}`); shown = line; }
    },
    // The worker writes worker.log; its lines come to this window as they are written.
    tail: file => {
      let at = existsSync(file) ? statSync(file).size : 0;
      const timer = setInterval(() => {
        try {
          const size = statSync(file).size;
          if (size < at) at = 0;
          if (size === at) return;
          const fd = openSync(file, 'r'), buffer = Buffer.alloc(size - at);
          try { readSyncAll(fd, buffer, at); } finally { closeSync(fd); }
          at = size;
          process.stdout.write(buffer.toString('utf8'));
        } catch { /* not yet written */ }
      }, 2000);
      return () => clearInterval(timer);
    },
    onWorker: og => { worker = og; },
    pid: process.pid,
    alive: pid => { try { process.kill(pid, 0); return true; } catch (/** @type {any} */ error) { return error.code === 'EPERM'; } },
    get ogModule() { return ogModule; },
  };
}
/** @param {number} fd @param {Buffer} buffer @param {number} position */
function readSyncAll(fd, buffer, position) {
  let done = 0;
  while (done < buffer.length) {
    const n = readSync(fd, buffer, done, buffer.length - done, position + done);
    if (!n) break;
    done += n;
  }
}

/** @type {Og | null} */ let worker = null;

/** Whether this module is the one node was started with (npx starts the bin's link; a Windows path may differ in case). */
const isMain = () => {
  if (!process.argv[1]) return false;
  try {
    const a = realpathSync(process.argv[1]), b = realpathSync(fileURLToPath(import.meta.url));
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch { return false; }
};

if (isMain()) {
  const deps = realDeps();
  let stopping = 0;
  // Ctrl-C (or the window closing) ends the runs under way first, so their ledger lines close and the job goes back for another try.
  for (const [name, code] of /** @type {const} */ ([['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]])) {
    if (process.platform === 'win32' && name === 'SIGHUP') continue;
    process.on(name, () => {
      if (stopping) process.exit(stopping);
      stopping = code;
      deps.ogModule?.stopChildren?.();
      if (!worker) process.exit(code);
      process.stderr.write(`\n멈추는 중 — 실행 중인 단계 ${worker.running}개를 먼저 끝낸다(한 번 더 누르면 바로 끝낸다)\n`);
      worker.stopAll(code).then(() => process.exit(code));
      setTimeout(() => process.exit(code), 40_000).unref();
    });
  }
  runRunner(process.argv.slice(2), deps).then(code => process.exit(stopping || code), error => { console.error(error?.stack ?? error); process.exit(1); });
}
