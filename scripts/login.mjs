// @ts-check
// Google sign-in for Dot. Creates this user's own Supabase session file; nothing is shared with the browser.
// Usage: npm run login | npm run login -- --link | npm run login -- --replace | npm run logout
//        npm run login -- --device [--replace]  then  npm run login -- --device-wait [--timeout <seconds>]
//        npm run login -- --paste [--replace]  then  npm run login -- --finish   (address read from this terminal)
// --device is for a workspace the user's browser cannot reach (a bot VM): the user approves a public pairing code on
// the homepage while signed in, and this workspace redeems a one-use token. Nothing secret passes through chat.
// --link adds Google to the existing account in the session file (beta accounts made before Google sign-in).
// --replace allows a login to overwrite a session file that belongs to a different user.
// --paste / --finish is a manual callback exchange, not a secure delivery channel. The callback address carries an
// authorization code: it must reach --finish only through input the user controls on this workspace (its own
// terminal), never through chat or ordinary logs. Without such input, report the sign-in blocker instead.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { apiRequest, validProjectUrl, withSessionLock, writeSessionFile } from '../api/client.mjs';
import { isTransportCode, connectionAction } from '../api/connection-errors.mjs';
import { runtimeFetch } from '../api/runtime-fetch.mjs';
import { PUBLIC_CREATOR_PAGE, creatorPage } from '../mcp/creator-handoff.mjs';

export const DEFAULT_LOGIN_PORT = 47821;
export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
// A chat round trip is slower than a local browser redirect; the authorization code itself is still single-use.
export const PASTE_LOGIN_TTL_MS = 10 * 60 * 1000;
/**
 * @typedef {import('@supabase/supabase-js').SupabaseClient} SupabaseClient
 * @typedef {{ access_token: string, refresh_token: string, user: { id: string, email?: string } }} Session
 * @typedef {{ link?: boolean, linkedUser?: string | null, replace?: boolean, previousUser: string | null, sessionPath: string, url: string,
 *   publishableKey: string, log: (message: string) => void, request: typeof apiRequest }} SignIn  What saveSignIn needs besides the session.
 */
export const defaultSessionPath = () => process.env.AI_FIGHTER_CLIENT_CONFIG || path.join(homedir(), '.ai-fighter', 'client.json');
/** @param {string} sessionPath */
export const pendingLoginPath = sessionPath => path.join(path.dirname(sessionPath), 'pending-login.json');

/** Decoded JWT payload, or null. Used only to read `role`, `sub` and `exp`; the server verifies every token. @param {unknown} token */
export function jwtPayload(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
}
/** A publishable key (`sb_publishable_…`) or the legacy anon JWT. Never a secret or service_role key. @param {unknown} key */
export const isPublishableKey = key => typeof key === 'string'
  && (/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key) || (key.split('.').length === 3 && jwtPayload(key)?.role === 'anon'));

/**
 * Project URL and publishable key: flags, then environment, then the existing session file. All are public values.
 * @param {{ argv?: string[], env?: NodeJS.ProcessEnv, sessionPath?: string }} [options]
 * @returns {Promise<{ url: string, publishableKey: string, port: number }>} checked here
 */
export async function projectSettings({ argv = [], env = process.env, sessionPath = defaultSessionPath() } = {}) {
  /** @param {string} name */
  const flag = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  /** @type {any} */
  let saved = {}; // the parsed session file
  try { saved = JSON.parse(await readFile(sessionPath, 'utf8')); } catch { /* first login */ }
  const url = flag('--url') ?? env.AI_FIGHTER_SUPABASE_URL ?? saved.url;
  const publishableKey = flag('--key') ?? env.AI_FIGHTER_PUBLISHABLE_KEY ?? saved.publishableKey;
  if (!validProjectUrl(url)) throw new Error('project-url-required');
  // Never accept a secret key here: the file is readable by every process on this account.
  if (!isPublishableKey(publishableKey)) throw new Error('publishable-key-required');
  const portText = flag('--port') ?? env.AI_FIGHTER_LOGIN_PORT;
  const port = portText === undefined ? DEFAULT_LOGIN_PORT : Number(portText);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid-login-port');
  return { url, publishableKey, port };
}

/**
 * @param {Record<string, string>} [initial]
 * @returns {{ getItem: (key: string) => string | null, setItem: (key: string, value: string) => void, removeItem: (key: string) => void,
 *   snapshot: () => Record<string, string> }}
 */
function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return { getItem: key => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value); }, removeItem: key => { items.delete(key); },
    snapshot: () => Object.fromEntries(items) };
}

/** @param {string} title @param {string} body */
const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:16px/1.6 system-ui,sans-serif;max-width:32em;margin:15vh auto;padding:0 16px"><h1 style="font-size:22px">${title}</h1><p>${body}</p></body>`;

/**
 * Wait for one OAuth redirect to http://127.0.0.1:<port>/callback/<state>. Resolves with the authorization code.
 * Requests without this run's random state get 404 and do not end the wait, so another local page cannot cancel it.
 * @param {{ port: number, state: string, timeoutMs?: number, onListening?: () => void }} options @returns {Promise<string>}
 */
export function waitForCallback({ port, state, timeoutMs = LOGIN_TIMEOUT_MS, onListening }) {
  if (!/^[a-f0-9]{32}$/.test(state ?? '')) return Promise.reject(new Error('login-callback-failed'));
  return new Promise((resolve, reject) => {
    let settled = false;
    /** @param {Error | null} error @param {string} [code] */
    const finish = (error, code) => {
      if (settled) return; settled = true; clearTimeout(timer);
      server.close(); server.closeAllConnections?.();
      if (error) reject(error); else resolve(/** @type {string} */ (code)); // given with a null error
    };
    const server = createServer((request, response) => {
      const url = new URL(/** @type {string} */ (request.url), `http://127.0.0.1:${port}`); // always set on a server request
      if (request.method !== 'GET' || url.pathname !== `/callback/${state}`) { response.writeHead(404).end(); return; }
      const code = url.searchParams.get('code'), problem = url.searchParams.get('error_code') ?? url.searchParams.get('error');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      if (code && /^[A-Za-z0-9._~-]{8,512}$/.test(code)) {
        response.end(page('AI Fighter 로그인 완료', '터미널로 돌아가세요. 이 창은 닫아도 됩니다.'));
        finish(null, code);
      } else {
        response.end(page('AI Fighter 로그인 실패', '터미널의 안내를 확인하세요.'));
        finish(new Error(problem === 'identity_already_exists' ? 'identity-already-linked' : problem ? 'oauth-denied' : 'oauth-callback-invalid'));
      }
    });
    const timer = setTimeout(() => finish(new Error('login-timeout')), timeoutMs);
    server.once('error', error => finish(new Error(/** @type {NodeJS.ErrnoException} */ (error).code === 'EADDRINUSE' ? 'login-port-busy' : 'login-callback-failed')));
    server.listen(port, '127.0.0.1', () => onListening?.());
  });
}

/** @param {string} url */
function openBrowser(url) {
  // Arguments, never a shell string: the URL contains '&'.
  const [command, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* the URL is printed too */ }
}

/** @param {string} sessionPath */
async function readSession(sessionPath) {
  try { return JSON.parse(await readFile(sessionPath, 'utf8')); } catch { return null; }
}

/**
 * Load the existing session into `auth` for --link. A refresh it causes is saved at once: the old refresh token is spent.
 * @param {SupabaseClient} auth @param {string} sessionPath @param {string} url @param {string} publishableKey
 */
async function adoptExistingSession(auth, sessionPath, url, publishableKey) {
  if (!await readSession(sessionPath)) throw new Error('link-session-required');
  return withSessionLock(sessionPath, async () => {
    const saved = await readSession(sessionPath);
    if (!saved || saved.url !== url || typeof saved.accessToken !== 'string' || typeof saved.refreshToken !== 'string') throw new Error('link-session-required');
    const { data, error } = await auth.auth.setSession({ access_token: saved.accessToken, refresh_token: saved.refreshToken });
    if (error || !data?.session || !data.user?.id) throw new Error('client-sign-in-required');
    if (data.session.refresh_token !== saved.refreshToken)
      await writeSessionFile(sessionPath, { url, publishableKey, accessToken: data.session.access_token, refreshToken: data.session.refresh_token });
    return data.user.id;
  });
}

/**
 * @param {{ argv?: string[], log?: (message: string) => void, open?: (url: string) => void, createAuthClient?: typeof createClient,
 *   request?: typeof apiRequest }} [options]
 */
export async function login({ argv = process.argv.slice(2), log = console.error, open = openBrowser, createAuthClient = createClient, request = apiRequest } = {}) {
  const sessionPath = defaultSessionPath(), link = argv.includes('--link'), replace = argv.includes('--replace');
  const { url, publishableKey, port } = await projectSettings({ argv, sessionPath });
  // The user already in the session file. An operator-issued beta session may be its only copy.
  const previousUser = jwtPayload((await readSession(sessionPath))?.accessToken)?.sub ?? null;
  const state = randomBytes(16).toString('hex'), redirectTo = `http://127.0.0.1:${port}/callback/${state}`;
  const auth = createAuthClient(url, publishableKey, { global: { fetch: runtimeFetch }, auth: { flowType: 'pkce', storage: memoryStorage(), persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } });
  const linkedUser = link ? await adoptExistingSession(auth, sessionPath, url, publishableKey) : null;
  const options = { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } };
  const { data, error } = link ? await auth.auth.linkIdentity({ provider: 'google', options })
    : await auth.auth.signInWithOAuth({ provider: 'google', options });
  if (error && /manual.?linking/i.test(`${error.code ?? ''} ${error.message ?? ''}`)) throw new Error('manual-linking-disabled');
  if (error || !data?.url) throw new Error('oauth-start-failed');
  const code = await waitForCallback({ port, state, onListening: () => {
    log('브라우저에서 Google 계정을 선택하세요. 홈페이지에서 쓸 계정과 같은 계정이어야 합니다.');
    log(`브라우저가 열리지 않으면 이 주소를 여세요:\n${data.url}`);
    open(data.url);
  } });
  return completeSignIn({ auth, code, link, linkedUser, replace, previousUser, sessionPath, url, publishableKey, log, request });
}

/** Exchange the code, refuse a different user unless asked, write the session file, and report account status. @param {SignIn & { auth: SupabaseClient, code: string }} options */
async function completeSignIn({ auth, code, ...rest }) {
  const exchanged = await auth.auth.exchangeCodeForSession(code);
  const session = exchanged.data?.session;
  if (exchanged.error || !session?.access_token || !session.refresh_token || !session.user?.id) throw new Error('oauth-exchange-failed');
  return saveSignIn({ session, ...rest });
}

/** Refuse a different user unless asked, write the session file, and report account status. @param {SignIn & { session: Session }} options */
async function saveSignIn({ session, link = false, linkedUser = null, replace, previousUser, sessionPath, url, publishableKey, log, request }) {
  // Linking must keep the same user, or the fighters it owns would no longer be this session's.
  if (link && session.user.id !== linkedUser) throw new Error('link-user-mismatch');
  if (!link && !replace && previousUser && previousUser !== session.user.id) throw new Error('session-user-differs');
  await mkdir(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
  await withSessionLock(sessionPath, () => writeSessionFile(sessionPath, { url, publishableKey, accessToken: session.access_token, refreshToken: session.refresh_token }));
  log(link ? `기존 계정에 Google을 연결했습니다: ${session.user.id}. 이제 홈페이지와 Dot 모두 Google로 로그인합니다.`
    : `로그인했습니다: ${session.user.email ?? session.user.id}`);
  log(`세션 파일: ${sessionPath}`);
  try {
    const result = await request(url, session.access_token, 'me');
    log(result.account?.invited ? '로그인이 확인되었습니다. 사전 승인 없이 선수를 제출할 수 있습니다.'
      : '이 계정은 현재 이용이 제한되어 있습니다. 홈페이지에서 계정 상태를 확인하세요.');
  } catch (/** @type {any} */ problem) {
    log(problem.message === 'route-not-found' ? '서버가 계정 상태 조회를 지원하지 않습니다. 제출할 때 다시 확인합니다.'
      : '계정 상태를 확인하지 못했습니다. 제출할 때 다시 확인합니다.');
  }
  log('이 컴퓨터의 ODDBOUT 명령(npm run host, npm run admin)이 이 세션을 씁니다. 대화에 연결한 ODDBOUT 도구의 계정과는 별개입니다.');
  return { sessionPath, userId: session.user.id };
}

/**
 * Step 1 of a pasted-address login. Starts PKCE with the same allow-listed loopback redirect, saves the verifier and
 * state to a 0600 file beside the session file, prints the Google address, and exits without waiting.
 * @param {{ argv?: string[], log?: (message: string) => void, createAuthClient?: typeof createClient }} [options]
 */
export async function startPasteLogin({ argv = [], log = console.error, createAuthClient = createClient } = {}) {
  if (argv.includes('--link')) throw new Error('paste-link-unsupported');
  const sessionPath = defaultSessionPath(), pendingPath = pendingLoginPath(sessionPath);
  const { url, publishableKey, port } = await projectSettings({ argv, sessionPath });
  const state = randomBytes(16).toString('hex'), redirectTo = `http://127.0.0.1:${port}/callback/${state}`;
  const storage = memoryStorage();
  const auth = createAuthClient(url, publishableKey, { global: { fetch: runtimeFetch }, auth: { flowType: 'pkce', storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await auth.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } } });
  if (error || !data?.url) throw new Error('oauth-start-failed');
  await mkdir(path.dirname(pendingPath), { recursive: true, mode: 0o700 });
  // A new start replaces an older pending login; its code could no longer be exchanged anyway.
  await writeSessionFile(pendingPath, { version: 1, url, publishableKey, port, state, replace: argv.includes('--replace'),
    createdAt: new Date().toISOString(), storage: storage.snapshot() });
  log('1. 아래 주소를 휴대폰이나 PC 브라우저에서 열고 Google 계정을 고르세요. 홈페이지에서 쓸 계정과 같은 계정이어야 합니다.');
  log(data.url);
  log(`2. 로그인 뒤 브라우저가 "연결할 수 없음" 같은 페이지(http://127.0.0.1:${port}/callback/…)로 갑니다. 정상입니다.`);
  log('3. 그 주소창 주소에는 인증 코드가 들어 있습니다. 대화·메시지·일반 로그에 붙여 넣지 마세요.');
  log('   이 작업 공간의 터미널에서 직접 npm run login -- --finish 를 실행하고, 주소를 입력하세요. 10분 안에 해야 합니다.');
  log('   이 작업 공간의 터미널에 직접 입력할 수 없다면 이 방식은 쓸 수 없습니다. 로그인이 막혔다고 알리세요.');
  return { pendingPath, authorizationUrl: data.url, redirectPrefix: `http://127.0.0.1:${port}/callback/`, expiresInMs: PASTE_LOGIN_TTL_MS };
}

/** @param {string} sessionPath */
export const pendingDeviceLoginPath = sessionPath => path.join(path.dirname(sessionPath), 'pending-device-login.json');
const DEVICE_CODE = /^afd_[a-f0-9]{64}$/, USER_CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

/**
 * An unauthenticated JSON POST to the AI Fighter API (device routes only; no user token exists yet).
 * @param {string} url @param {string} publishableKey @param {string} route @param {object} [body]
 */
const devicePost = (url, publishableKey, route, body) => apiRequest(url, publishableKey, route,
  { method: 'POST', body: JSON.stringify(body ?? {}), headers: { apikey: publishableKey, 'content-type': 'application/json' } });

/**
 * Device-connection sign-in, step 1: for a workspace whose 127.0.0.1 callback the user's browser cannot reach.
 * The secret device code stays in a 0600 file here; the printed link carries only the public pairing code.
 * @param {{ argv?: string[], log?: (message: string) => void, post?: typeof devicePost, page?: string, sessionPath?: string, next?: string }} [options]
 */
export async function startDeviceLogin({ argv = [], log = console.error, post = devicePost, page = PUBLIC_CREATOR_PAGE,
  sessionPath = defaultSessionPath(), next = '승인한 뒤에는 이 작업 공간에서 npm run login -- --device-wait 를 실행합니다.' } = {}) {
  if (argv.includes('--link')) throw new Error('device-link-unsupported');
  const pendingPath = pendingDeviceLoginPath(sessionPath);
  // A second start must not replace the only copy of a request that may already be approved.
  let existing;
  try { existing = JSON.parse(await readFile(pendingPath, 'utf8')); }
  catch (/** @type {any} */ error) { if (error.code !== 'ENOENT') throw new Error('pending-device-login-invalid'); }
  if (existing !== undefined) {
    if (existing?.version !== 1 || !Number.isFinite(Date.parse(existing.expiresAt))) throw new Error('pending-device-login-invalid');
    // An approved or redeemed request outlives the pairing code: finish it with --device-wait instead of a new approval.
    if (Date.parse(existing.expiresAt) > Date.now() || existing.tokenHash || existing.session) throw new Error('device-login-already-pending');
  }
  const { url, publishableKey } = await projectSettings({ argv, sessionPath });
  let started;
  try { started = await post(url, publishableKey, 'device-logins'); }
  catch (/** @type {any} */ error) {
    // A server without the route predates device login: report it, never fall back to pasting a callback.
    if (error.status === 404 || ['not-found', 'route-not-found'].includes(error.message)) throw new Error('device-login-unavailable');
    if (isTransportCode(error.message)) throw error;
    throw new Error(error.message === 'rate-limit' ? 'device-login-rate-limit' : 'device-login-start-failed');
  }
  if (!DEVICE_CODE.test(started?.deviceCode ?? '') || !USER_CODE.test(started?.userCode ?? '') || !Number.isFinite(Date.parse(started?.expiresAt))
    || !Number.isInteger(started?.interval) || started.interval < 1 || started.interval > 60) throw new Error('invalid-api-response');
  await mkdir(path.dirname(pendingPath), { recursive: true, mode: 0o700 });
  await writeSessionFile(pendingPath, { version: 1, url, publishableKey, deviceCode: started.deviceCode, userCode: started.userCode,
    expiresAt: started.expiresAt, interval: started.interval, replace: argv.includes('--replace') });
  const verificationUrl = `${creatorPage(page).href}#device=${started.userCode}`;
  log('아래 링크를 휴대폰이나 PC 브라우저에서 열고, 홈페이지에서 쓸 Google 계정으로 로그인하세요.');
  log(verificationUrl);
  // Times are UTC everywhere (사용자 결정 2026-10-31), so the deadline reads the same on every machine.
  const until = `${new Date(started.expiresAt).toISOString().slice(11, 16)} UTC`;
  log(`화면에 표시된 코드가 ${started.userCode} 와 같은지 확인한 뒤 승인하세요. 10분 안(${until}까지)에 해야 합니다.`);
  // Signing in on the way could drop the code from the address on an older site (2026-10-28): the link itself brings the approval back.
  log('Google 로그인 뒤 승인 화면이 보이지 않으면 같은 링크를 다시 여세요.');
  log('이 링크와 코드는 비밀번호가 아닙니다. 승인에는 본인의 Google 로그인이 필요합니다. 본인이 시작하지 않은 요청이면 승인하지 마세요.');
  log(next);
  return { userCode: started.userCode, verificationUrl, expiresAt: started.expiresAt };
}

/**
 * Step 2: poll until the user approves, then redeem the one-use magic-link token into a normal session file.
 * Stops at `timeoutSeconds` while still pending (the request stays open for another wait), or at expiry.
 * @param {{ timeoutSeconds?: number, log?: (message: string) => void, post?: typeof devicePost, request?: typeof apiRequest, sessionPath?: string,
 *   replace?: boolean, createAuthClient?: typeof createClient, now?: () => number, sleep?: (ms: number) => Promise<unknown> }} [options]
 */
export async function waitDeviceLogin({ timeoutSeconds = 600, log = console.error, post = devicePost, request = apiRequest,
  sessionPath = defaultSessionPath(), replace = false,
  createAuthClient = createClient, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const pendingPath = pendingDeviceLoginPath(sessionPath);
  const pending = await readSession(pendingPath);
  if (pending?.version !== 1 || !DEVICE_CODE.test(pending.deviceCode ?? '') || !validProjectUrl(pending.url)
    || !isPublishableKey(pending.publishableKey)) throw new Error('pending-device-login-missing');
  const close = () => rm(pendingPath, { force: true });
  // Each step after approval is saved here before the next one runs. The server answers the token only once, so a
  // network failure, or a sign-in that needs --replace, resumes from the saved step instead of a new approval.
  /** @param {object} change */
  const record = async change => { Object.assign(pending, change); await writeSessionFile(pendingPath, pending); };
  if (pending.session) return finishDeviceLogin({ pending, replace, close, sessionPath, log, request });
  const expiry = Date.parse(pending.expiresAt), deadline = Math.min(expiry, now() + timeoutSeconds * 1000);
  let interval = pending.interval * 1000, answer = pending.tokenHash ? { tokenHash: pending.tokenHash } : null;
  while (!answer) {
    if (now() >= expiry) { await close(); throw new Error('device-login-expired'); }
    try {
      const reply = await post(pending.url, pending.publishableKey, 'device-logins/token', { deviceCode: pending.deviceCode });
      if (reply?.status === 'approved') answer = reply;
      else if (reply?.status !== 'pending') throw new Error('invalid-api-response');
    } catch (/** @type {any} */ error) {
      if (['device-login-expired', 'device-login-consumed', 'device-login-not-found'].includes(error.message)) { await close(); throw new Error(error.message); }
      if (error.message === 'slow-down') interval += 5000;
      else throw error; // Keep the pending file; connectivity recovery resumes this request, never a new login.
    }
    if (answer) break;
    if (now() + interval > deadline) {
      const error = /** @type {Error & { retryAfterSeconds?: number }} */ (new Error(now() + interval > expiry ? 'device-login-expired' : 'device-login-pending'));
      error.retryAfterSeconds = Math.ceil(interval / 1000);
      throw error;
    }
    await sleep(interval);
  }
  if (typeof answer.tokenHash !== 'string' || !/^[a-f0-9]{40,128}$/.test(answer.tokenHash)) { await close(); throw new Error('invalid-api-response'); }
  if (!pending.tokenHash) await record({ tokenHash: answer.tokenHash }); // the approval is spent on the server now
  const auth = createAuthClient(pending.url, pending.publishableKey, { global: { fetch: runtimeFetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  let verified;
  try { verified = await auth.auth.verifyOtp({ type: 'email', token_hash: answer.tokenHash }); }
  catch { throw new Error('device-login-redeem-retry'); }
  // Unreachable Auth (status 0 or 5xx) keeps the token for another try; a refused token cannot be used again.
  if (verified.error) {
    if (verified.error.name === 'AuthRetryableFetchError' || !(/** @type {number} */ (verified.error.status) >= 400 && /** @type {number} */ (verified.error.status) < 500)) throw new Error('device-login-redeem-retry'); // no status: retry
    await close(); throw new Error('device-login-redeem-failed');
  }
  const session = verified.data?.session;
  if (!session?.access_token || !session.refresh_token || !session.user?.id) { await close(); throw new Error('device-login-redeem-failed'); }
  await record({ tokenHash: undefined, session: { access_token: session.access_token, refresh_token: session.refresh_token,
    user: { id: session.user.id, ...(session.user.email ? { email: session.user.email } : {}) } } });
  return finishDeviceLogin({ pending, replace, close, sessionPath, log, request });
}
/**
 * The redeemed session becomes the session file; only then does the pending request go. `--replace` may resume it.
 * @param {{ pending: any, replace: boolean, close: () => Promise<void>, sessionPath: string, log: (message: string) => void, request: typeof apiRequest }} options
 *   `pending` is the parsed pending-login file, checked by waitDeviceLogin.
 */
async function finishDeviceLogin({ pending, replace, close, sessionPath, log, request }) {
  const previousUser = jwtPayload((await readSession(sessionPath))?.accessToken)?.sub ?? null;
  const result = await saveSignIn({ session: pending.session, replace: pending.replace || replace, previousUser, sessionPath, url: pending.url, publishableKey: pending.publishableKey, log, request });
  await close();
  return result;
}

/** The loopback callback address inside pasted text, bound to the pending state and port; never a bare code. @param {unknown} text @param {{ port: number, state: string }} pending */
export function parsePastedCallback(text, { port, state }) {
  const found = String(text ?? '').match(/https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/callback\/[^\s"'<>]*/);
  if (!found) throw new Error('pasted-address-invalid');
  let address;
  try { address = new URL(found[0]); } catch { throw new Error('pasted-address-invalid'); }
  if (Number(address.port) !== port || address.pathname !== `/callback/${state}`) throw new Error('pasted-address-mismatch');
  const code = address.searchParams.get('code'), problem = address.searchParams.get('error_code') ?? address.searchParams.get('error');
  if (problem) throw new Error(problem === 'identity_already_exists' ? 'identity-already-linked' : 'oauth-denied');
  if (!code || !/^[A-Za-z0-9._~-]{8,512}$/.test(code)) throw new Error('pasted-address-invalid');
  return code;
}

/**
 * Step 2: exchange the pasted address with the saved verifier, then write the session exactly as a normal login.
 * @param {{ pasted?: string, log?: (message: string) => void, createAuthClient?: typeof createClient, request?: typeof apiRequest, now?: () => number }} [options]
 */
export async function finishPasteLogin({ pasted, log = console.error, createAuthClient = createClient, request = apiRequest, now = Date.now } = {}) {
  const sessionPath = defaultSessionPath(), pendingPath = pendingLoginPath(sessionPath);
  const pending = await readSession(pendingPath);
  if (pending?.version !== 1 || typeof pending.state !== 'string' || typeof pending.storage !== 'object') throw new Error('pending-login-missing');
  if (now() - Date.parse(pending.createdAt) > PASTE_LOGIN_TTL_MS) {
    await rm(pendingPath, { force: true });
    throw new Error('pending-login-expired');
  }
  if (!validProjectUrl(pending.url) || !isPublishableKey(pending.publishableKey)) throw new Error('pending-login-missing');
  // A wrong paste keeps the pending login so the user can paste the right address.
  const code = parsePastedCallback(pasted, pending);
  const auth = createAuthClient(pending.url, pending.publishableKey, { global: { fetch: runtimeFetch }, auth: { flowType: 'pkce', storage: memoryStorage(pending.storage),
    persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } });
  const previousUser = jwtPayload((await readSession(sessionPath))?.accessToken)?.sub ?? null;
  try {
    return await completeSignIn({ auth, code, replace: pending.replace, previousUser, sessionPath,
      url: pending.url, publishableKey: pending.publishableKey, log, request });
  } finally {
    await rm(pendingPath, { force: true }); // the code is spent either way
  }
}

/**
 * End this session on the server, then delete the file. A running process still holds the refresh token in
 * memory; revoking the session on the server is what stops it from refreshing and writing the file back.
 * @param {{ log?: (message: string) => void, createAuthClient?: typeof createClient }} [options]
 */
export async function logout({ log = console.error, createAuthClient = createClient } = {}) {
  const sessionPath = defaultSessionPath();
  if (!await readSession(sessionPath)) { log('로그인된 세션이 없습니다.'); return; }
  const revoked = await withSessionLock(sessionPath, async () => {
    const saved = await readSession(sessionPath);
    let ended = false;
    if (saved && validProjectUrl(saved.url) && isPublishableKey(saved.publishableKey) && typeof saved.accessToken === 'string') {
      try {
        const auth = createAuthClient(saved.url, saved.publishableKey, { global: { fetch: runtimeFetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
        let token = saved.accessToken;
        if ((jwtPayload(token)?.exp ?? 0) * 1000 <= Date.now() + 5000 && typeof saved.refreshToken === 'string') {
          const refreshed = await auth.auth.refreshSession({ refresh_token: saved.refreshToken });
          token = refreshed.data?.session?.access_token ?? null;
        }
        if (token) ended = !(await auth.auth.admin.signOut(token, 'local'))?.error;
      } catch { /* reported below */ }
    }
    await rm(sessionPath, { force: true });
    return ended;
  });
  log(`${sessionPath}를 지웠습니다.`);
  log(revoked ? '서버의 세션도 끝냈습니다. 다음 요청부터 로그아웃이 반영됩니다.'
    : '서버의 세션을 끝내지 못했습니다. 로컬 연결은 해제했으며 다음 요청부터 로그인이 필요합니다.');
}

/** @type {Record<string, string>} */
const messages = {
  'project-url-required': 'Supabase 프로젝트 주소가 필요합니다. AI_FIGHTER_SUPABASE_URL 또는 --url 로 지정하세요.',
  'publishable-key-required': '공개(publishable 또는 anon) 키가 필요합니다. AI_FIGHTER_PUBLISHABLE_KEY 또는 --key 로 지정하세요. 비밀 키와 service_role 키는 받지 않습니다.',
  'invalid-login-port': '--port 는 1024~65535 사이여야 합니다.',
  'login-port-busy': '로그인 콜백 포트가 이미 쓰이고 있습니다. 다른 로그인 창을 닫거나 --port 로 바꾸세요. 바꾼 포트는 Supabase 리다이렉트 허용 목록에도 있어야 합니다.',
  'login-callback-failed': '로그인 콜백 서버를 열지 못했습니다. 다시 실행하세요.',
  'login-timeout': '5분 안에 로그인이 끝나지 않았습니다. 다시 실행하세요.',
  'oauth-denied': 'Google 로그인이 취소되었거나 거부되었습니다. 테스트 모드에서는 등록된 테스트 사용자만 로그인할 수 있습니다.',
  'oauth-start-failed': 'Google 로그인을 시작하지 못했습니다. 프로젝트 주소와 공개 키를 확인하세요.',
  'oauth-exchange-failed': '로그인 코드를 세션으로 바꾸지 못했습니다. 다시 실행하세요.',
  'session-refresh-busy': '다른 프로세스가 세션 파일을 쓰고 있습니다. 잠시 후 다시 실행하세요.',
  'session-user-differs': '세션 파일에 다른 사용자의 세션이 있어 바꾸지 않았습니다. 기존 베타 계정이면 --link 로 Google을 연결하세요. 정말 바꾸려면 --replace 를 붙이세요.',
  'link-session-required': '--link 는 기존 계정의 세션 파일이 필요합니다. AI_FIGHTER_CLIENT_CONFIG 로 그 파일을 지정하세요.',
  'client-sign-in-required': '기존 세션이 끝났습니다. 운영자에게 새 세션 파일을 받은 뒤 --link 를 다시 실행하세요.',
  'manual-linking-disabled': 'Supabase Auth에서 수동 계정 연결(manual linking)이 꺼져 있습니다. 운영자가 켠 뒤 다시 실행하세요.',
  'identity-already-linked': '이 Google 계정은 이미 다른 사용자에 연결되어 있습니다. 그 Google 계정으로 먼저 로그인해 생긴 사용자를 운영자가 정리해야 합니다.',
  'link-user-mismatch': '연결 결과가 기존 사용자와 다릅니다. 세션 파일을 바꾸지 않았습니다.',
  'paste-link-unsupported': '--paste 는 --link 와 함께 쓸 수 없습니다. 기존 베타 계정 연결은 브라우저가 있는 PC에서 실행하세요.',
  'device-link-unsupported': '--device 는 --link 와 함께 쓸 수 없습니다. 기존 베타 계정 연결은 브라우저가 있는 PC에서 실행하세요.',
  'device-login-unavailable': '서버가 기기 연결 로그인을 아직 지원하지 않습니다. 로그인이 막혔다고 알리세요. 콜백 주소를 대화로 옮기는 방식으로 대신하지 않습니다.',
  'device-login-rate-limit': '기기 연결 요청이 너무 많습니다. 몇 분 뒤 다시 시작하세요.',
  'device-login-start-failed': '기기 연결 로그인을 시작하지 못했습니다. 잠시 후 다시 실행하세요.',
  'device-login-already-pending': '기존 기기 연결 요청이 남아 있습니다. 새 요청을 만들지 말고 사용자가 승인한 뒤 npm run login -- --device-wait 로 이어가세요.',
  'pending-device-login-invalid': '기존 기기 연결 기록을 판독할 수 없어 보존했습니다. 기록과 서버 상태를 확인하기 전에는 새 로그인 요청을 만들지 않습니다.',
  'pending-device-login-missing': '진행 중인 기기 연결 로그인이 없습니다. npm run login -- --device 부터 다시 실행하세요.',
  'device-login-pending': '아직 승인되지 않았습니다. 사용자가 승인한 뒤 npm run login -- --device-wait 를 다시 실행하세요.',
  'device-login-expired': '기기 연결 요청이 만료되었습니다. npm run login -- --device 부터 다시 실행하세요.',
  'device-login-consumed': '이 기기 연결 요청은 이미 사용되었습니다. npm run login -- --device 부터 다시 실행하세요.',
  'device-login-not-found': '서버에서 이 기기 연결 요청을 찾지 못했습니다. npm run login -- --device 부터 다시 실행하세요.',
  'device-login-redeem-failed': '승인된 로그인을 세션으로 바꾸지 못했습니다. npm run login -- --device 부터 다시 실행하세요.',
  'device-login-redeem-retry': '승인은 받았지만 로그인 서버에 닿지 못했습니다. 승인을 다시 받지 말고 연결을 확인한 뒤 npm run login -- --device-wait 를 다시 실행하세요.',
  'invalid-api-response': '서버 응답을 이해하지 못했습니다. 잠시 후 다시 실행하세요.',
  'pending-login-missing': '진행 중인 로그인이 없습니다. npm run login -- --paste 부터 다시 실행하세요.',
  'pending-login-expired': '로그인 시작 후 10분이 지났습니다. npm run login -- --paste 부터 다시 실행하세요.',
  'pasted-address-invalid': '입력한 내용에서 로그인 주소(http://127.0.0.1:…/callback/…)를 찾지 못했습니다. 이 터미널에서 주소창 주소 전체를 다시 입력하세요.',
  'pasted-address-mismatch': '입력한 주소가 이번 로그인과 맞지 않습니다. 가장 최근에 받은 링크로 로그인한 뒤의 주소를 이 터미널에서 입력하세요.',
};

/** One line typed into this process's own terminal, so the address stays out of argv and shell history. @param {string} prompt @returns {Promise<string>} */
function readTerminalLine(prompt) {
  return new Promise(resolve => {
    const lines = createInterface({ input: process.stdin, output: process.stderr });
    lines.question(prompt, answer => { lines.close(); resolve(answer); });
  });
}

/** True when this file is the entry script, also when it is run through a symlink or junction. */
function isEntry() {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isEntry()) {
  const argv = process.argv.slice(2), finish = argv.indexOf('--finish');
  const timeout = argv.indexOf('--timeout');
  const run = argv[0] === 'logout' ? logout()
    : argv.includes('--device-wait') ? waitDeviceLogin({ timeoutSeconds: timeout >= 0 ? Number(argv[timeout + 1]) || 600 : 600, replace: argv.includes('--replace') })
    : argv.includes('--device') ? startDeviceLogin({ argv })
    : finish >= 0 ? (argv.length > finish + 1 ? Promise.resolve(argv.slice(finish + 1).join(' ')) : readTerminalLine('로그인 후 주소창 주소: '))
      .then(pasted => finishPasteLogin({ pasted }))
    : argv.includes('--paste') ? startPasteLogin({ argv }) : login({ argv });
  run.catch(error => { console.error(isTransportCode(error.message) ? connectionAction(error.message).message
    : messages[error.message] ?? `로그인 실패: ${error.message}`); process.exitCode = 1; });
}
