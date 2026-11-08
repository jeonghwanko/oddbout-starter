// @ts-check
// Official CLI only; raw status/login output never leaves this module or reaches a log.
import { execFile, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

export async function codexCommand(env = process.env, platform = process.platform) {
  for (const dir of (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
    const exe = path.join(dir, platform === 'win32' ? 'codex.exe' : 'codex');
    if (
      await access(exe).then(
        () => true,
        () => false,
      )
    )
      return { command: exe, prefix: [] };
    if (platform === 'win32') {
      // Run the npm package with Node instead of interpreting a .cmd/.ps1 shim through a shell.
      const script = path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (
        await access(script).then(
          () => true,
          () => false,
        )
      )
        return { command: process.execPath, prefix: [script] };
    }
  }
  throw Error('codex-not-installed');
}

/**
 * @param {string} command @param {string[]} args @param {{ env?: NodeJS.ProcessEnv, cwd?: string, timeout?: number }} [options]
 * @returns {Promise<{ code: number | string, text: string }>}
 */
export function capture(command, args, { env = process.env, cwd, timeout = 15000 } = {}) {
  return new Promise(resolve =>
    execFile(command, args, { env, cwd, timeout, windowsHide: true, maxBuffer: 65536, encoding: 'utf8' }, (error, stdout, stderr) =>
      resolve({ code: error ? (error.code ?? 1) : 0, text: String(stdout ?? '') + String(stderr ?? '') }),
    ),
  );
}

/** @param {{ resolve?: typeof codexCommand, run?: typeof capture, env?: NodeJS.ProcessEnv, cwd?: string }} [options] */
export async function inspectGenerationLogin({ resolve = codexCommand, run = capture, env = process.env, cwd } = {}) {
  let cli;
  try {
    cli = await resolve(env);
  } catch {
    return { status: 'not-installed', provider: 'codex' };
  }
  const result = await run(cli.command, [...cli.prefix, 'login', 'status'], { env, cwd });
  let status = 'unknown';
  if (result.code === 0 && /chatgpt/i.test(result.text) && !/api[ -]?key/i.test(result.text)) status = 'signed-in';
  else if (/api[ -]?key/i.test(result.text)) status = 'api-billing-blocked';
  else if (result.code !== 0 && /not logged in|not signed in/i.test(result.text)) status = 'sign-in-required';
  return {
    status,
    provider: 'codex',
    billing: status === 'signed-in' ? 'subscription' : 'unknown',
    accountIdentity: 'unknown',
    imageAccess: 'unknown',
    quota: 'unknown',
    checkedAt: new Date().toISOString(),
  };
}

/** @param {string} raw */
export function publicDeviceChallenge(raw) {
  const text = raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  // No callback addresses, query parameters, bearer values, email addresses or arbitrary URLs.
  const url = text.match(/https:\/\/auth\.openai\.com\/codex\/device(?=[\s)\]>]|$)/)?.[0];
  const code = text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/)?.[0];
  return url && code
    ? {
        verificationUrl: url,
        userCode: code,
        instruction: '본인이 시작한 연결인지, 제공자 화면의 코드가 같은지 확인한 뒤 로그인하세요. 콜백 주소나 토큰은 대화에 보내지 마세요.',
      }
    : null;
}

/**
 * @typedef {{ cwd?: string, env?: NodeJS.ProcessEnv, emit: (event: object) => void, resolve?: typeof codexCommand, spawnImpl?: typeof spawn,
 *   inspect?: typeof inspectGenerationLogin, run?: typeof capture, timeoutMs?: number }} DeviceLoginOptions
 */
/** @param {DeviceLoginOptions} options */
export async function runDeviceLogin(
  {
    cwd,
    env = process.env,
    emit,
    resolve = codexCommand,
    spawnImpl = spawn,
    inspect = inspectGenerationLogin,
    run = capture,
    timeoutMs = 10 * 60 * 1000,
  } = /** @type {DeviceLoginOptions} */ ({}),
) {
  const cli = await resolve(env);
  // Check the installed CLI's capability before starting authentication.
  const help = await run(cli.command, [...cli.prefix, 'login', '--help'], { env, cwd });
  if (help.code !== 0 || !help.text.includes('--device-auth')) throw Error('device-login-not-supported');
  const exit = await new Promise(resolveResult => {
    const child = spawnImpl(cli.command, [...cli.prefix, 'login', '--device-auth'], {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let raw = '',
      shown = false,
      timedOut = false,
      interrupted = false;
    const pending = ['', ''];
    const stop = () => {
      // The npm launcher can own a native child. Kill only this spawned tree on Windows.
      if (process.platform === 'win32' && Number.isInteger(child.pid))
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      else child.kill();
    };
    const interrupt = () => {
      interrupted = true;
      stop();
    };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
      raw = '';
      pending.fill('');
    };
    /** @type {(stream: number, chunk: Buffer) => void} */
    const receive = (stream, chunk) => {
      // A chunk can end halfway through a valid-looking pairing code. Only parse
      // complete lines, keeping stdout/stderr fragments separate until then.
      pending[stream] = (pending[stream] + chunk.toString()).slice(-65536);
      const end = Math.max(pending[stream].lastIndexOf('\n'), pending[stream].lastIndexOf('\r'));
      if (end < 0) return;
      raw = (raw + pending[stream].slice(0, end + 1)).slice(-65536);
      pending[stream] = pending[stream].slice(end + 1);
      const challenge = publicDeviceChallenge(raw);
      if (!shown && challenge) {
        shown = true;
        emit({ status: 'awaiting-user', ...challenge });
      }
    };
    child.stdout.on('data', chunk => receive(0, chunk));
    child.stderr.on('data', chunk => receive(1, chunk));
    child.once('error', () => {
      cleanup();
      resolveResult({ status: 'login-start-failed' });
    });
    child.once('close', code => {
      cleanup();
      resolveResult({ status: timedOut ? 'login-timeout' : interrupted ? 'login-interrupted' : code === 0 ? 'completed' : 'login-failed' });
    });
  });
  if (exit.status !== 'completed') return exit;
  return inspect({ env, cwd, resolve });
}
