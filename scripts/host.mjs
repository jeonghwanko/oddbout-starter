#!/usr/bin/env node
// @ts-check
// 커뮤니티 생성 호스트 (H2, 2026-10-28): a creator's own Linux PC and subscriptions make the fighters other creators ask of him.
// `npm run host -- <command>`; host:setup, host:login and host:start are shortcuts. The generator is host/ (og, the worker, its
// stages, motions.py) — the same files ODDBOUT's own PC runs. This file applies to host, installs the generator into its own
// folder (user mode: no service user, no sudo), signs its providers in there, gets a worker key without showing it, and starts
// the worker as a systemd user service. Guide: docs/GENERATION-HOST.md. The API decides which jobs a host gets (H1).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRemoteClient } from '../api/client.mjs';
import { JOIN_CODE } from '../api/generations.mjs';
import { readProject } from '../mcp/connection-readiness.mjs';
import { defaultSessionPath, login, startDeviceLogin, waitDeviceLogin } from './login.mjs';
import { HOST_FILES, checkSystem, codexHealthy, codexOptional, defaultRoot, healthy, hostEnv, installFiles, installed, openJobs, readHostEnv,
  signIn } from '../host/install.mjs';

// The install's pieces live in host/install.mjs (2026-11-07): npx oddbout-host (host/runner.mjs) installs the same way on Windows, macOS
// and Linux, from an npm package that carries host/ alone.
export { HOST_FILES, checkSystem, codexHealthy, defaultRoot, healthy, hostEnv, installFiles, installed, openJobs, readHostEnv };

/**
 * @typedef {{ code: number, output: string }} OgResult
 * @typedef {{ missing: string[], warnings: string[], python: string, toolPath: string, gpu?: boolean }} SystemCheck
 * @typedef {{ root: string, out: (line: string) => void, hostDir?: string, request: import('../api/client.mjs').RemoteClient['request'],
 *   apiBase: () => Promise<string>, og: (args: string[], options?: { stdin?: string, capture?: boolean }) => Promise<OgResult>,
 *   system: () => SystemCheck, linger: () => boolean, project: () => Promise<import('../mcp/connection-readiness.mjs').Project | null>,
 *   join: (code: string) => Promise<{ name: string, key: string, apiBase: string, approved: boolean }>,
 *   signin: { browser: (argv: string[]) => Promise<unknown>, startDevice: (argv: string[]) => Promise<unknown>, waitDevice: (replace: boolean) => Promise<unknown> } }} HostDeps
 */

const KIT = fileURLToPath(new URL('../', import.meta.url));
/** How a user of this command signs in again (host/install.mjs signIn). */
const LOGIN = 'npm run host:login --';
const CODEX_OPTIONAL = codexOptional(LOGIN);
export const TERMS_DOC = 'docs/GENERATION-HOST.md#호스트-약속';
/** @type {(args: string[], name: string) => string | undefined} */
const flag = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
/** @type {Record<string, string>} */
const MESSAGES = {
  'client-sign-in-required': 'ODDBOUT 로그인이 필요하다: npm run host -- signin (브라우저가 없으면 --device)',
  // The device sign-in's ends, in this command's words (the kit's own say npm run login).
  'device-login-expired': '승인 링크가 10분 안에 승인되지 않아 만료됐다. npm run host -- signin --device 로 새 링크를 받는다.',
  'device-login-pending': '아직 승인되지 않았다. 링크를 승인한 뒤 npm run host -- signin --device 를 다시 실행하면 이어서 마친다.',
  'device-login-consumed': '이 승인 요청은 이미 쓰였다. npm run host -- signin --device 로 새 링크를 받는다.',
  'device-login-not-found': '서버에 이 승인 요청이 없다. npm run host -- signin --device 로 새 링크를 받는다.',
  'device-login-redeem-failed': '승인된 로그인을 마치지 못했다. npm run host -- signin --device 로 새 링크를 받는다.',
  'device-login-redeem-retry': '승인은 받았지만 서버에 닿지 못했다. 연결을 확인하고 npm run host -- signin --device 를 다시 실행한다(다시 승인하지 않는다).',
  'device-login-rate-limit': '승인 요청이 너무 많다. 몇 분 뒤 npm run host -- signin --device 를 다시 실행한다.',
  'device-login-start-failed': '승인 링크를 만들지 못했다. 잠시 뒤 npm run host -- signin --device 를 다시 실행한다.',
  'host-terms-required': `호스트 약속에 동의해야 신청된다(${TERMS_DOC}).`,
  'host-not-approved': '아직 승인되지 않았다. 승인되면 다시 한다(npm run host -- status).',
  'host-not-found': '호스트 신청이 없다: oddbout.com 내 선수의 "내 PC로 만들기"나 npm run host -- apply --name <이름> --accept-terms',
  'join-code-invalid': '붙이기 코드가 만료됐거나 이미 쓰였다. oddbout.com 내 선수의 "내 PC로 만들기"에서 새 코드를 받는다(30분 유효, 한 번).',
  'invalid-join-code': '붙이기 코드 모양이 아니다(ohj_ 로 시작한다). 사이트에 보인 명령을 그대로 붙여 넣는다.',
  'host-key-limit': '살아 있는 워커 열쇠가 이미 둘이다. npm run host -- revoke 로 끄고 다시 한다.',
  'invalid-host': '이름(2~40자)·과금(subscription|api-key)·하루 한도(0~50)를 확인한다.',
  'not-found': '호스트 신청이 없다: npm run host -- apply …',
  'host-env-limits': '--slots 는 2 또는 3, --memory 는 4G~64G 다.',
  'host-env-path': 'node·Python·도구 경로에 쌍점(:)이나 줄바꿈이 있다. 다른 곳에 설치된 것을 쓴다.',
};
/** @type {(error: Error) => string} */
const explain = error => MESSAGES[error.message] ?? `요청 실패: ${error.message}`;

export const USAGE = `npm run host -- <명령>   (커뮤니티 생성 호스트, docs/GENERATION-HOST.md)
  signin [--device] [--replace]   ODDBOUT 로그인(브라우저가 없는 PC는 --device: 다른 기기에서 코드 승인)
  apply --name <이름> [--billing subscription|api-key] --accept-terms   호스트 신청(이름·과금 바꾸기도 같다)
  status                          신청·승인·켜짐·오늘 남은 수·열쇠와 이 PC의 설치·워커
  setup [--slots 2|3] [--memory <n>G] [--rife torch|ncnn]   이 PC에 생성기 설치·갱신 (npm run host:setup). torch: NVIDIA GPU로 고리 정렬 약 2배
  login [grok|codex] [--replace]  설치 폴더 안의 구독 로그인: 기본은 grok(필수), codex는 GPT 그림용(선택) (npm run host:login)
  health                          구독마다 아주 작은 실제 호출
  join <코드> [setup 옵션]        사이트(내 선수 → 내 PC로 만들기)의 코드 하나로: 설치·구독 로그인(없으면)·워커. ODDBOUT 로그인 없이
  start                           열쇠가 없으면 로그인한 계정으로 받아 넣고 워커를 켠다 (npm run host:start)
  stop | restart | log [n]        워커
  pause | resume                  새 신청 받기 끄기·켜기(서버 스위치)
  any on|off                      "아무 호스트" 신청 받기
  limit <0-50>                    하루 한도
  revoke                          모든 워커 열쇠를 끄고 워커를 멈춘다
  remove --yes                    워커·열쇠·설치 폴더(신청 글·그림 포함)를 지운다
설치 폴더: --root <폴더>, 또는 ODDBOUT_HOST_ROOT (기본 ~/.local/share/oddbout-host)`;

/**
 * One command. deps: root, out(line), request(route, { method, body }) (the creator's API session, throws Error(code)),
 * apiBase() (the session's https …/functions/v1/ai-fighter), og(args, { stdin, capture }) → { code, output }, system() (checkSystem),
 * linger() → boolean, project() (deploy/creator-site.json, readProject), signin { browser(argv), startDevice(argv), waitDevice(replace) }.
 * @param {string[]} argv @param {HostDeps} deps @returns {Promise<number>}
 */
export async function runHost(argv, deps) {
  const { root, out, og } = deps;
  const [command = 'help', ...args] = argv;
  /** @param {string} route @param {string} [method] @param {object} [body] */
  const api = async (route, method = 'GET', body) => deps.request(route, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });
  const needInstall = () => { if (installed(root)) return true; out(`이 PC에 설치가 없다(${root}): npm run host:setup`); return false; };
  // Grok answered (codex too, or not: healthy), then the user unit. Approval is not needed: not approved, the worker makes its owner's
  // own requests.
  async function startWorker() {
    const health = await og(['health'], { capture: true });
    out(health.output.trim());
    if (!healthy(health.output)) { out('grok(SuperGrok)이 ok여야 켠다: npm run host:login 뒤 npm run host:start'); return 1; }
    if (!codexHealthy(health.output)) out(CODEX_OPTIONAL);
    if (!deps.linger()) out(`참고: 로그아웃하면 워커도 멈춘다. 계속 돌리려면 한 번: sudo loginctl enable-linger ${userInfo().username}`);
    if ((await og(['worker', 'install'])).code !== 0) return 1;
    out('워커가 켜졌다. 1분 안에 사이트의 내 호스트가 온라인이 된다. 내 선수 신청에서 "내 PC"를 고를 수 있다.');
    return 0;
  }
  /** @param {any} host  The API's host record, or none. */
  const showHost = host => out(host
    ? `호스트 ${host.name} (${host.id}) — ${host.approved ? '승인됨' : '승인 대기'}, ${host.enabled ? '켜짐' : '꺼짐(pause)'}, 아무 호스트 신청 ${host.acceptsAny ? '받음' : '안 받음'}, `
      + `하루 한도 ${host.dailyLimit}${host.todayLeft != null ? `·오늘 남은 ${host.todayLeft}` : ''}, ${host.online ? '온라인' : '오프라인'}, 과금 ${host.billing}`
      + `${host.keys ? `, 워커 열쇠 ${host.keys.length}개` : ''}`
    : '호스트 신청이 없다: npm run host -- apply --name <이름> --accept-terms');
  try {
    switch (command) {
      case 'signin': {
        // The kit's own login (scripts/login.mjs) with this kit's project, so a new host needs no URL or key.
        const project = await deps.project();
        if (!project) { out('deploy/creator-site.json 을 읽지 못했다 — 이 체크아웃을 확인한다.'); return 1; }
        const flags = ['--url', project.origin, '--key', project.publishableKey];
        if (args.includes('--device')) {
          // A link made before (this command stopped, the terminal closed) is waited on again, not replaced: it may be approved already.
          try { await deps.signin.startDevice(flags); }
          catch (/** @type {any} */ error) { if (error.message !== 'device-login-already-pending') throw error; out('앞서 만든 승인 링크(10분 유효)를 이어서 기다린다.'); }
          await deps.signin.waitDevice(args.includes('--replace'));
        }
        else await deps.signin.browser([...flags, ...args.filter(a => a === '--replace')]);
        out('ODDBOUT에 로그인했다. 다음: npm run host -- apply --name <이름> --accept-terms');
        return 0;
      }
      case 'apply': {
        const name = flag(args, '--name'), billing = flag(args, '--billing') ?? 'subscription';
        if (!name || !args.includes('--accept-terms')) {
          out('호스트 약속(요약 — 전문: ' + TERMS_DOC + '):');
          out('  1. 내 구독(또는 API 키)으로 다른 사람의 선수를 만든다. 그 제공자 약관이 이것을 허락하는지 내가 확인했고, 책임은 나에게 있다.');
          out('  2. 신청 글과 그림은 그 선수를 만드는 데만 쓴다. 보관·공유·재사용하지 않는다(생성기가 끝난 작업을 7일 뒤 지운다).');
          out('  3. 생성기의 안전 설정(codex 기능 끄기, 계정 고정, 메모리 상한)을 끄거나 돌아가지 않는다.');
          out('  4. ODDBOUT은 언제든 승인을 거두고 열쇠를 끌 수 있다.');
          out('동의하면: npm run host -- apply --name <이름> [--billing subscription|api-key] --accept-terms');
          return 1;
        }
        const { host } = await api('generations/host', 'POST', { name, billing, termsAccepted: true });
        showHost(host);
        if (!host.approved) out('다른 사람의 신청은 운영자 승인을 기다린다. 승인 전에도 내 신청은 내 PC로 만든다: npm run host:setup → npm run host:login → npm run host:start');
        return 0;
      }
      case 'status': {
        try { showHost((await api('generations/host')).host); } catch (/** @type {any} */ error) { out(explain(error)); }
        if (installed(root)) {
          out((await og(['status'], { capture: true })).output.trim());
          out((await og(['worker', 'status'], { capture: true })).output.split('\n').slice(0, 3).join('\n').trim());
        } else out(`이 PC에는 아직 설치가 없다(${root}).`);
        return 0;
      }
      case 'setup': case 'update': {
        const previous = installed(root) ? readHostEnv(await readFile(path.join(root, 'host.env'), 'utf8')) : {};
        const slots = Number(flag(args, '--slots') ?? previous.SLOTS ?? 3), memory = flag(args, '--memory') ?? previous.MEMORY ?? '8G';
        const rife = flag(args, '--rife');
        if (rife !== undefined && !['torch', 'ncnn'].includes(rife)) { out('--rife torch|ncnn'); return 1; }
        const open = openJobs(root);
        if (open.length) { out(`진행 중인 작업이 있어 바꾸지 않는다: ${open.join(', ')}. npm run host -- pause 로 새 신청을 막고 끝나기를 기다린다.`); return 1; }
        const system = deps.system();
        for (const line of system.warnings) out(`주의: ${line}`);
        if (system.missing.length) { out(`이 PC에 없는 것: ${system.missing.join(', ')}`); return 1; }
        const env = hostEnv({ nodeBin: path.dirname(process.execPath), python: system.python, toolPath: system.toolPath, slots, memory });
        await mkdir(root, { recursive: true, mode: 0o700 }); await chmod(root, 0o700);
        const wasRunning = installed(root) && /Active: active/.test((await og(['worker', 'status'], { capture: true })).output);
        if (wasRunning) await og(['worker', 'stop']);
        await writeFile(path.join(root, 'host.env'), env, { mode: 0o600 });
        await installFiles(root, deps.hostDir);
        out(`생성기 파일을 ${path.join(root, 'bin')} 에 두었다. 키트·codex·grok·sprite-gen 을 준비한다(처음은 오래 걸린다).`);
        if ((await og(['setup'])).code !== 0) return 1;
        if ((await og(['harden'])).code !== 0) return 1;
        // PyTorch is about 3 GB: only when asked. A GPU without it gets the hint.
        if (rife && (await og(['rife', rife])).code !== 0) return 1;
        if (!rife && system.gpu) out('참고: NVIDIA GPU가 있다. npm run host:setup -- --rife torch 로 고리 정렬이 약 2배 빨라진다(PyTorch 약 3 GB).');
        if (wasRunning) await og(['worker', 'start']);
        out('다음: npm run host:login (grok 로그인, GPT 그림도 쓰려면 codex도) → 사이트의 붙이기 코드로 npm run host -- join <코드>');
        return 0;
      }
      case 'login': {
        if (!needInstall()) return 1;
        // Grok unless one is named: codex is GPT pictures' only (1.1, 2026-11-06), signed in on its own (`login codex`).
        const providers = ['codex', 'grok'].includes(args[0]) ? [args[0]] : ['grok'];
        return signIn({ og, out, providers, replace: args.includes('--replace'), login: LOGIN });
      }
      case 'health': return needInstall() ? (await og(['health'])).code : 1;
      case 'join': {
        // 내 PC 붙이기 (2026-10-28): the code from the site becomes this PC's worker key; the PC keeps no account session.
        // One command from the site (2026-10-28): the code first — it lives thirty minutes and setup can take longer — then this PC's
        // install and the subscriptions' sign-ins when they are missing, then the worker. The key waits in this process, never on disk or
        // screen, until og takes it; a setup that fails needs a new code (a third key retires the oldest).
        const code = args[0] ?? '';
        if (!JOIN_CODE.test(code)) { out(MESSAGES['invalid-join-code']); return 1; }
        const joined = await deps.join(code);
        out(`호스트 ${joined.name}의 코드를 받았다.`);
        if (!installed(root)) {
          out('이 PC에 생성기를 설치한다(처음은 오래 걸린다).');
          if (await runHost(['setup', ...args.slice(1)], deps) !== 0) { out('설치가 끝나지 않았다. 알려 준 것을 고친 뒤 사이트에서 새 코드를 받아 다시 한다.'); return 1; }
        }
        // The key goes straight from the API reply into og's worker.env (stdin, mode 600): never on screen, in argv or a log.
        const wrote = await og(['worker', 'key', joined.apiBase], { stdin: `${joined.key}\n`, capture: true });
        if (wrote.code !== 0) { out(wrote.output.trim()); return 1; }
        // Grok, when this install has not signed in to it (or it does not answer): signed in now, one device code. Codex is not asked for:
        // it adds GPT pictures only (1.1, 2026-11-06), and startWorker says how to add it.
        const before = await og(['health'], { capture: true });
        if (!healthy(before.output) && await runHost(['login', 'grok'], deps) !== 0) {
          out('grok 로그인이 끝나지 않았다: npm run host:login 뒤 npm run host:start'); return 1;
        }
        out(`이 PC를 호스트 ${joined.name}에 붙였다(워커 열쇠는 화면에 보이지 않는다, 90일). ${joined.approved
          ? '승인된 호스트라 다른 사람의 신청도 받는다.' : '승인 전에는 내 신청만 이 PC로 만든다.'}`);
        return startWorker();
      }
      case 'start': {
        if (!needInstall()) return 1;
        if (!existsSync(path.join(root, 'worker.env'))) {
          // Without a join code: the key from the signed-in account (npm run host -- signin).
          const { host } = await api('generations/host');
          if (!host) { showHost(host); return 1; }
          if (host.billing === 'api-key') out('참고: 이 꾸러미는 지금 구독 로그인(codex·grok)만 쓴다. API 키로 내려면 그 키로 로그인한 계정을 쓴다.');
          // The key goes straight from the API reply into og's worker.env (stdin, mode 600): never on screen, in argv or a log.
          const { key } = await api('generations/host/keys', 'POST');
          const wrote = await og(['worker', 'key', await deps.apiBase()], { stdin: `${key}\n`, capture: true });
          if (wrote.code !== 0) { out(wrote.output.trim()); return 1; }
          out('워커 열쇠를 받아 설치 폴더에 넣었다(화면에 보이지 않는다, 90일).');
        }
        return startWorker();
      }
      case 'stop': case 'restart': return needInstall() ? (await og(['worker', command])).code : 1;
      case 'log': return needInstall() ? (await og(['worker', 'log', String(Number(args[0]) || 40)])).code : 1;
      case 'pause': case 'resume': showHost((await api('generations/host', 'PATCH', { enabled: command === 'resume' })).host); return 0;
      case 'any': {
        if (!['on', 'off'].includes(args[0])) { out('npm run host -- any on|off'); return 1; }
        showHost((await api('generations/host', 'PATCH', { acceptsAny: args[0] === 'on' })).host); return 0;
      }
      case 'limit': {
        const limit = Number(args[0]);
        if (!Number.isInteger(limit) || limit < 0 || limit > 50) { out('npm run host -- limit <0-50>'); return 1; }
        showHost((await api('generations/host', 'PATCH', { dailyLimit: limit })).host); return 0;
      }
      case 'revoke': {
        const { revoked } = await api('generations/host/keys', 'DELETE');
        if (installed(root)) { await og(['worker', 'stop'], { capture: true }); await rm(path.join(root, 'worker.env'), { force: true }); }
        out(`워커 열쇠 ${revoked}개를 껐다. 다시 켜려면 npm run host:start (새 열쇠를 받는다).`);
        return 0;
      }
      case 'remove': {
        if (!args.includes('--yes')) {
          out(`지울 것: 워커 서비스, 이 호스트의 워커 열쇠, 설치 폴더 ${root}(구독 로그인·키트·신청 글과 그림 전부). 서버의 호스트 신청은 꺼짐으로 남는다.`);
          out('정말 지우려면: npm run host -- remove --yes');
          return 1;
        }
        if (installed(root)) await og(['worker', 'uninstall'], { capture: true });
        try { await api('generations/host/keys', 'DELETE'); await api('generations/host', 'PATCH', { enabled: false }); }
        catch (/** @type {any} */ error) { out(`서버 쪽은 하지 못했다(${explain(error)}) — 열쇠는 90일 뒤 저절로 끝난다.`); }
        await rm(root, { recursive: true, force: true });
        out(`${root} 를 지웠다.`);
        return 0;
      }
      default: out(USAGE); return command === 'help' ? 0 : 1;
    }
  } catch (/** @type {any} */ error) { out(explain(error)); return 1; }
}

/**
 * og in the install, its output to the terminal or captured; stdin only when given.
 * @param {string} root @param {string[]} args @param {{ stdin?: string, capture?: boolean }} [options] @returns {Promise<OgResult>}
 */
function runOg(root, args, { stdin, capture = false } = {}) {
  return new Promise(resolve => {
    // Its streams are used only where piped.
    const child = /** @type {import('node:child_process').ChildProcessWithoutNullStreams} */ (spawn(path.join(root, 'bin', 'og'), args, { stdio: [stdin === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'] }));
    let output = '';
    if (capture) { child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; }); }
    if (stdin !== undefined) child.stdin.end(stdin);
    child.on('close', code => resolve({ code: code ?? 1, output }));
    child.on('error', error => resolve({ code: 127, output: error.message }));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), at = argv.indexOf('--root');
  const root = path.resolve(at >= 0 ? argv[at + 1] : defaultRoot());
  if (at >= 0) argv.splice(at, 2);
  const sessionPath = defaultSessionPath();
  /** @type {import('../api/client.mjs').RemoteClient | undefined} */
  let remote;
  runHost(argv, {
    root, out: line => console.log(line), hostDir: path.join(KIT, 'host'),
    request: async (route, options) => (remote ??= await createRemoteClient(sessionPath).catch(error => {
      throw new Error(error.code === 'ENOENT' ? 'client-sign-in-required' : error.message); })).request(route, options),
    apiBase: async () => `${JSON.parse(await readFile(sessionPath, 'utf8')).url}/functions/v1/ai-fighter`,
    og: (args, options) => runOg(root, args, options),
    system: () => checkSystem(),
    linger: () => spawnSync('loginctl', ['show-user', userInfo().username, '--property=Linger', '--value'], { encoding: 'utf8' }).stdout?.trim() === 'yes',
    project: () => readProject(KIT),
    // A join code needs no session: the kit's project and its publishable key reach the public route.
    join: async code => {
      const project = await readProject(KIT);
      if (!project) throw new Error('kit-project-missing');
      const apiBase = `${project.origin}/functions/v1/ai-fighter`;
      const response = await fetch(`${apiBase}/generations/host/join`, { method: 'POST', body: JSON.stringify({ code }), redirect: 'error',
        headers: { apikey: project.publishableKey, 'content-type': 'application/json' }, signal: AbortSignal.timeout(30_000) });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok !== true) throw new Error(result?.code ?? `api-http-${response.status}`);
      return { ...result, apiBase };
    },
    signin: { browser: argv => login({ argv }), startDevice: argv => startDeviceLogin({ argv, next: '승인하면 이 명령이 이어서 로그인을 마친다. 이 창을 닫지 않는다.' }), waitDevice: replace => waitDeviceLogin({ replace }) },
  }).then(code => { process.exitCode = code; });
}
