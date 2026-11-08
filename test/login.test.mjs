import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { finishPasteLogin, login, logout, parsePastedCallback, pendingDeviceLoginPath, pendingLoginPath, projectSettings, startDeviceLogin, startPasteLogin, waitDeviceLogin, waitForCallback } from '../scripts/login.mjs';

const URL_ = 'https://abcdefghijklmnopqrst.supabase.co', KEY = 'sb_publishable_fixtureFixtureFixture01';
const jwt = payload => `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
let directory, previous;
before(async () => { directory = await mkdtemp(path.join(tmpdir(), 'fighter-login-')); previous = process.env.AI_FIGHTER_CLIENT_CONFIG; });
after(async () => {
  if (previous === undefined) delete process.env.AI_FIGHTER_CLIENT_CONFIG; else process.env.AI_FIGHTER_CLIENT_CONFIG = previous;
  await rm(directory, { recursive: true, force: true });
});
const freePort = () => new Promise(resolve => { const server = createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
const saved = async file => JSON.parse(await readFile(file, 'utf8'));

/** A fake Supabase auth client. `open` follows the real redirect URL the script asked for. */
function fakeLogin({ user = 'user-1', calls = {} } = {}) {
  const createAuthClient = (url, key, options) => {
    calls.client = { url, key, flowType: options.auth.flowType };
    return { auth: {
      signInWithOAuth: async args => { calls.oauth = args; return { data: { url: 'https://accounts.example/authorize?x=1&y=2' } }; },
      exchangeCodeForSession: async code => { calls.code = code;
        return { data: { session: { access_token: jwt({ sub: user, exp: 9999999999 }), refresh_token: `refresh-${user}`, user: { id: user, email: 'player@example.com' } } } }; },
    } };
  };
  const open = async address => {
    calls.opened = address;
    // A request without this run's state must neither succeed nor end the wait.
    const port = new URL(calls.oauth.options.redirectTo).port;
    calls.stray = (await fetch(`http://127.0.0.1:${port}/callback?error=access_denied`)).status;
    const response = await fetch(`${calls.oauth.options.redirectTo}?code=fixture-code-123`);
    calls.page = await response.text();
  };
  return { createAuthClient, open, request: async (url, token, route) => { calls.request = { url, route }; return { ok: true, account: { invited: false } }; } };
}

test('project settings accept only a Supabase project URL and a publishable or anon key', async () => {
  const sessionPath = path.join(directory, 'none.json');
  await assert.rejects(projectSettings({ argv: [], env: {}, sessionPath }), /project-url-required/);
  await assert.rejects(projectSettings({ argv: ['--url', 'https://evil.example'], env: { AI_FIGHTER_PUBLISHABLE_KEY: KEY }, sessionPath }), /project-url-required/);
  for (const key of ['sb_secret_fixtureFixtureFixture01', jwt({ role: 'service_role' }), 'a.b.c'])
    await assert.rejects(projectSettings({ argv: ['--url', URL_, '--key', key], env: {}, sessionPath }), /publishable-key-required/, key);
  assert.equal((await projectSettings({ argv: ['--url', URL_, '--key', jwt({ role: 'anon' })], env: {}, sessionPath })).port, 47821);
  await assert.rejects(projectSettings({ argv: ['--url', URL_, '--key', KEY, '--port', '80'], env: {}, sessionPath }), /invalid-login-port/);
  assert.deepEqual(await projectSettings({ argv: ['--url', URL_, '--key', KEY], env: {}, sessionPath }), { url: URL_, publishableKey: KEY, port: 47821 });
  // A later login reuses the public values from the existing session file.
  const existing = path.join(directory, 'saved.json');
  await writeFile(existing, JSON.stringify({ url: URL_, publishableKey: KEY, accessToken: 'a', refreshToken: 'r' }));
  assert.equal((await projectSettings({ argv: [], env: { AI_FIGHTER_LOGIN_PORT: '50001' }, sessionPath: existing })).port, 50001);
});

test('login runs PKCE through a state-bound loopback callback and writes only this user\'s session', async () => {
  const sessionPath = path.join(directory, 'nested', 'client.json');
  process.env.AI_FIGHTER_CLIENT_CONFIG = sessionPath;
  const port = await freePort(), calls = {}, logs = [];
  const result = await login({ argv: ['--url', URL_, '--key', KEY, '--port', String(port)], log: line => logs.push(line), ...fakeLogin({ calls }) });
  assert.deepEqual(calls.client, { url: URL_, key: KEY, flowType: 'pkce' });
  assert.equal(calls.oauth.provider, 'google');
  assert.match(calls.oauth.options.redirectTo, new RegExp(`^http://127\\.0\\.0\\.1:${port}/callback/[a-f0-9]{32}$`));
  assert.equal(calls.oauth.options.skipBrowserRedirect, true);
  assert.equal(calls.oauth.options.queryParams.prompt, 'select_account');
  assert.equal(calls.opened, 'https://accounts.example/authorize?x=1&y=2');
  assert.equal(calls.stray, 404);
  assert.equal(calls.code, 'fixture-code-123');
  assert.match(calls.page, /로그인 완료/);
  assert.deepEqual(calls.request, { url: URL_, route: 'me' });
  const file = await saved(sessionPath);
  assert.deepEqual(Object.keys(file), ['url', 'publishableKey', 'accessToken', 'refreshToken']);
  assert.equal(file.refreshToken, 'refresh-user-1');
  assert.equal(result.userId, 'user-1');
  assert.ok(logs.some(line => line.includes('이용이 제한')));
  assert.ok(logs.every(line => !line.includes('초대를 요청')));
  assert.ok(logs.every(line => !line.includes('refresh-user-1') && !line.includes(file.accessToken)));

  // The same user may log in again; a different user would silently replace an operator-issued session.
  await login({ argv: ['--port', String(await freePort())], log: () => {}, ...fakeLogin() });
  await assert.rejects(login({ argv: ['--port', String(await freePort())], log: () => {}, ...fakeLogin({ user: 'user-2' }) }), /session-user-differs/);
  assert.equal((await saved(sessionPath)).refreshToken, 'refresh-user-1');
  await login({ argv: ['--replace', '--port', String(await freePort())], log: () => {}, ...fakeLogin({ user: 'user-2' }) });
  assert.equal((await saved(sessionPath)).refreshToken, 'refresh-user-2');
});

test('logout revokes the server session (refreshing an expired token first) and reports a failed revoke', async () => {
  const sessionPath = path.join(directory, 'logout', 'client.json');
  process.env.AI_FIGHTER_CLIENT_CONFIG = sessionPath;
  await mkdir(path.dirname(sessionPath), { recursive: true });
  const expired = { url: URL_, publishableKey: KEY, accessToken: jwt({ sub: 'u', exp: 1 }), refreshToken: 'old-refresh' };
  const calls = [], logs = [];
  const client = ({ signOutError = null } = {}) => () => ({ auth: {
    refreshSession: async ({ refresh_token }) => { calls.push(['refresh', refresh_token]); return { data: { session: { access_token: 'fresh.access.token' } } }; },
    admin: { signOut: async (token, scope) => { calls.push(['signOut', token, scope]); return { error: signOutError }; } },
  } });
  await writeFile(sessionPath, JSON.stringify(expired));
  await logout({ log: line => logs.push(line), createAuthClient: client() });
  assert.deepEqual(calls, [['refresh', 'old-refresh'], ['signOut', 'fresh.access.token', 'local']]);
  await assert.rejects(readFile(sessionPath, 'utf8'));
  assert.ok(logs.some(line => line.includes('서버의 세션도 끝냈습니다')));

  logs.length = 0;
  await writeFile(sessionPath, JSON.stringify({ ...expired, accessToken: jwt({ sub: 'u', exp: 9999999999 }) }));
  await logout({ log: line => logs.push(line), createAuthClient: client({ signOutError: { message: 'network' } }) });
  await assert.rejects(readFile(sessionPath, 'utf8'));
  assert.ok(logs.some(line => line.includes('끝내지 못했습니다')));
});

test('--link adds Google to the existing user, saves a refresh at once and never switches users', async () => {
  const sessionPath = path.join(directory, 'link', 'client.json');
  process.env.AI_FIGHTER_CLIENT_CONFIG = sessionPath;
  const argv = ['--link', '--url', URL_, '--key', KEY];
  await assert.rejects(login({ argv: [...argv, '--port', String(await freePort())], log: () => {} }), /link-session-required/);
  await mkdir(path.dirname(sessionPath), { recursive: true });
  const original = { url: URL_, publishableKey: KEY, accessToken: 'old.access.token', refreshToken: 'old-refresh' };
  const client = ({ exchangedUser = 'beta-user', linkError = null, seen = {} } = {}) => () => ({ auth: {
    setSession: async ({ refresh_token }) => { assert.equal(refresh_token, 'old-refresh');
      return { data: { session: { access_token: 'mid.access.token', refresh_token: 'mid-refresh' }, user: { id: 'beta-user' } } }; },
    linkIdentity: async args => { seen.args = args; return linkError ? { data: null, error: linkError } : { data: { url: 'https://accounts.example/link' } }; },
    signInWithOAuth: async () => { throw new Error('link mode must not start a new sign-in'); },
    exchangeCodeForSession: async () => ({ data: { session: { access_token: 'new.access.token', refresh_token: 'new-refresh', user: { id: exchangedUser } } } }),
  } });
  const run = async (options = {}, callback = 'code=fixture-code-123') => {
    const seen = {};
    return login({ argv: [...argv, '--port', String(await freePort())], log: () => {}, request: async () => ({ account: { invited: true } }),
      open: () => { fetch(`${seen.args.options.redirectTo}?${callback}`).catch(() => {}); }, createAuthClient: client({ ...options, seen }) });
  };

  await writeFile(sessionPath, JSON.stringify(original));
  assert.equal((await run()).userId, 'beta-user');
  assert.deepEqual(await saved(sessionPath), { url: URL_, publishableKey: KEY, accessToken: 'new.access.token', refreshToken: 'new-refresh' });

  // A different user after the callback: the refreshed session is kept, the foreign one is not written.
  await writeFile(sessionPath, JSON.stringify(original));
  await assert.rejects(run({ exchangedUser: 'someone-else' }), /link-user-mismatch/);
  assert.equal((await saved(sessionPath)).refreshToken, 'mid-refresh');

  await writeFile(sessionPath, JSON.stringify(original));
  await assert.rejects(run({ linkError: { code: 'manual_linking_disabled', message: 'Manual linking is disabled' } }), /manual-linking-disabled/);
  await writeFile(sessionPath, JSON.stringify(original));
  await assert.rejects(run({}, 'error=server_error&error_code=identity_already_exists'), /identity-already-linked/);
});

test('the callback rejects a denied login, a bad code, a busy port, a timeout and a missing state', async () => {
  const port = await freePort(), state = 'a'.repeat(32), at = `http://127.0.0.1:${port}/callback/${state}`;
  await assert.rejects(waitForCallback({ port, state: 'short', timeoutMs: 5000 }), /login-callback-failed/);
  await assert.rejects(waitForCallback({ port, state, timeoutMs: 5000, onListening: () => { fetch(`${at}?error=access_denied`).catch(() => {}); } }), /oauth-denied/);
  await assert.rejects(waitForCallback({ port, state, timeoutMs: 5000, onListening: () => { fetch(`${at}?code=%3Cscript%3E`).catch(() => {}); } }), /oauth-callback-invalid/);
  const blocker = createServer().listen(port, '127.0.0.1');
  await new Promise(resolve => blocker.once('listening', resolve));
  try { await assert.rejects(waitForCallback({ port, state, timeoutMs: 5000 }), /login-port-busy/); }
  finally { await new Promise(resolve => blocker.close(resolve)); }
  await assert.rejects(waitForCallback({ port, state, timeoutMs: 50 }), /login-timeout/);
});

/** A fake PKCE client: sign-in stores a verifier in the given storage; exchange requires that same verifier. */
function fakePaste({ user = 'user-1', calls = {} } = {}) {
  const createAuthClient = (url, key, options) => ({ auth: {
    signInWithOAuth: async args => { calls.oauth = args; options.auth.storage.setItem('sb-fixture-auth-token-code-verifier', 'verifier-xyz');
      return { data: { url: 'https://accounts.example/authorize?x=1&y=2' } }; },
    exchangeCodeForSession: async code => { calls.code = code; calls.verifier = options.auth.storage.getItem('sb-fixture-auth-token-code-verifier');
      if (calls.verifier !== 'verifier-xyz') return { error: { message: 'missing verifier' } };
      return { data: { session: { access_token: jwt({ sub: user, exp: 9999999999 }), refresh_token: `refresh-${user}`, user: { id: user, email: 'player@example.com' } } } }; },
  } });
  return { createAuthClient, request: async () => ({ ok: true, account: { invited: true } }) };
}

test('paste login keeps the PKCE verifier on this host and completes from the pasted loopback address', async () => {
  const sessionPath = path.join(directory, 'paste', 'client.json');
  process.env.AI_FIGHTER_CLIENT_CONFIG = sessionPath;
  const calls = {}, logs = [], fake = fakePaste({ calls });
  const started = await startPasteLogin({ argv: ['--url', URL_, '--key', KEY], log: line => logs.push(line), createAuthClient: fake.createAuthClient });
  assert.equal(started.authorizationUrl, 'https://accounts.example/authorize?x=1&y=2');
  const pending = await saved(pendingLoginPath(sessionPath));
  assert.equal(pending.storage['sb-fixture-auth-token-code-verifier'], 'verifier-xyz');
  assert.match(calls.oauth.options.redirectTo, new RegExp(`^http://127\\.0\\.0\\.1:47821/callback/${pending.state}$`));
  if (process.platform !== 'win32') assert.equal((await import('node:fs/promises').then(f => f.stat(pendingLoginPath(sessionPath)))).mode & 0o777, 0o600);
  // The address carries an authorization code: entry goes only through this workspace's own terminal, never chat.
  assert.ok(logs.some(line => line.includes('대화·메시지·일반 로그에 붙여 넣지 마세요')));
  assert.ok(logs.some(line => line.includes('로그인이 막혔다고 알리세요')));
  assert.ok(!logs.some(line => /대화에 붙여 넣으세요|안전/.test(line)));
  // A wrong address keeps the pending login for a correct paste; nothing is exchanged.
  await assert.rejects(finishPasteLogin({ pasted: 'no address here', ...fake }), /pasted-address-invalid/);
  await assert.rejects(finishPasteLogin({ pasted: `http://127.0.0.1:47821/callback/${'b'.repeat(32)}?code=fixture-code-123`, ...fake }), /pasted-address-mismatch/);
  await assert.rejects(finishPasteLogin({ pasted: `http://127.0.0.1:1234/callback/${pending.state}?code=fixture-code-123`, ...fake }), /pasted-address-mismatch/);
  assert.equal(calls.code, undefined);
  const result = await finishPasteLogin({ pasted: `붙여넣기: "http://127.0.0.1:47821/callback/${pending.state}?code=fixture-code-123" 입니다`, log: () => {}, ...fake });
  assert.equal(calls.code, 'fixture-code-123');
  assert.equal(calls.verifier, 'verifier-xyz');
  assert.equal(result.userId, 'user-1');
  assert.equal((await saved(sessionPath)).refreshToken, 'refresh-user-1');
  await assert.rejects(saved(pendingLoginPath(sessionPath)), /ENOENT/);
  await assert.rejects(finishPasteLogin({ pasted: 'anything', ...fake }), /pending-login-missing/);
});

test('paste login refuses --link, an expired start, a denied login and a different user without --replace', async () => {
  const sessionPath = path.join(directory, 'paste-2', 'client.json');
  process.env.AI_FIGHTER_CLIENT_CONFIG = sessionPath;
  await assert.rejects(startPasteLogin({ argv: ['--url', URL_, '--key', KEY, '--link'], log: () => {}, ...fakePaste() }), /paste-link-unsupported/);
  await startPasteLogin({ argv: ['--url', URL_, '--key', KEY], log: () => {}, ...fakePaste() });
  let state = (await saved(pendingLoginPath(sessionPath))).state;
  await assert.rejects(finishPasteLogin({ pasted: `http://127.0.0.1:47821/callback/${state}?code=fixture-code-123`, now: () => Date.now() + 11 * 60 * 1000, ...fakePaste() }), /pending-login-expired/);
  await assert.rejects(saved(pendingLoginPath(sessionPath)), /ENOENT/);
  assert.throws(() => parsePastedCallback(`http://127.0.0.1:47821/callback/${state}?error=access_denied`, { port: 47821, state }), /oauth-denied/);
  assert.throws(() => parsePastedCallback('fixture-code-123', { port: 47821, state }), /pasted-address-invalid/);
  await writeFile(sessionPath, JSON.stringify({ url: URL_, publishableKey: KEY, accessToken: jwt({ sub: 'someone-else', exp: 9999999999 }), refreshToken: 'r' }));
  await startPasteLogin({ argv: ['--url', URL_, '--key', KEY], log: () => {}, ...fakePaste() });
  state = (await saved(pendingLoginPath(sessionPath))).state;
  await assert.rejects(finishPasteLogin({ pasted: `http://127.0.0.1:47821/callback/${state}?code=fixture-code-123`, log: () => {}, ...fakePaste() }), /session-user-differs/);
  assert.equal(jwtSub(await saved(sessionPath)), 'someone-else');
  await assert.rejects(saved(pendingLoginPath(sessionPath)), /ENOENT/); // the code is spent either way
});
const jwtSub = file => JSON.parse(Buffer.from(file.accessToken.split('.')[1], 'base64url').toString()).sub;

const DEVICE = 'afd_' + 'c'.repeat(64), HASH = 'f'.repeat(56);
/** A scripted device API: start, then the given poll answers in order (an Error is thrown as the API would). */
function deviceApi(answers, calls = []) {
  return async (url, key, route, body) => {
    calls.push({ url, key, route, body });
    if (route === 'device-logins') return { ok: true, deviceCode: DEVICE, userCode: 'BCDF-GHJK', expiresAt: new Date(Date.now() + 600000).toISOString(), interval: 5 };
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer;
  };
}

test('device login keeps the secret here, prints only a public pairing link, and redeems one approval', async () => {
  const sessionPath = path.join(directory, 'device', 'client.json');
  process.env.AI_FIGHTER_CLIENT_CONFIG = sessionPath;
  const calls = [], logs = [];
  const started = await startDeviceLogin({ argv: ['--url', URL_, '--key', KEY], log: line => logs.push(line), post: deviceApi([], calls) });
  assert.equal(started.verificationUrl, 'https://oddbout.com/creator.html#device=BCDF-GHJK');
  assert.equal((await saved(pendingDeviceLoginPath(sessionPath))).deviceCode, DEVICE);
  // The chat-facing output carries the link and pairing code, never the device secret.
  assert.ok(logs.some(line => line.includes('#device=BCDF-GHJK')) && !logs.some(line => line.includes(DEVICE)));
  assert.ok(logs.some(line => line.includes('본인이 시작하지 않은 요청이면 승인하지 마세요')));
  // Where to go when the approval screen does not come up, and until when the link lives.
  // The deadline is UTC (UTC로 통일, 2026-10-31), the link's own expiry minute.
  const deadline = `${(await saved(pendingDeviceLoginPath(sessionPath))).expiresAt.slice(11, 16)} UTC까지`;
  assert.ok(logs.some(line => line.includes('같은 링크를 다시 여세요')) && logs.some(line => line.includes(deadline)), deadline);
  assert.equal(logs.at(-1), '승인한 뒤에는 이 작업 공간에서 npm run login -- --device-wait 를 실행합니다.');
  const slow = Object.assign(new Error('slow-down'), { status: 429 }), slept = [], verified = [];
  const createAuthClient = () => ({ auth: { verifyOtp: async args => { verified.push(args);
    return { data: { session: { access_token: jwt({ sub: 'user-7', exp: 9999999999 }), refresh_token: 'refresh-user-7', user: { id: 'user-7', email: 'p@example.com' } } } }; } } });
  const result = await waitDeviceLogin({ post: deviceApi([{ ok: true, status: 'pending' }, slow, { ok: true, status: 'approved', tokenHash: HASH }], calls),
    createAuthClient, request: async () => ({ ok: true, account: { invited: true } }), sleep: async ms => { slept.push(ms); }, log: () => {} });
  assert.equal(result.userId, 'user-7');
  assert.deepEqual(slept, [5000, 10000]); // slow-down widens the interval
  assert.deepEqual(verified, [{ type: 'email', token_hash: HASH }]);
  assert.ok(calls.filter(c => c.route === 'device-logins/token').every(c => c.body.deviceCode === DEVICE));
  assert.equal((await saved(sessionPath)).refreshToken, 'refresh-user-7');
  await assert.rejects(saved(pendingDeviceLoginPath(sessionPath)), /ENOENT/);
  await assert.rejects(waitDeviceLogin({ post: deviceApi([]) }), /pending-device-login-missing/);
});

test('device login stops while pending without losing the request, and ends on expiry or an old server', async () => {
  const sessionPath = path.join(directory, 'device-2', 'client.json');
  process.env.AI_FIGHTER_CLIENT_CONFIG = sessionPath;
  await startDeviceLogin({ argv: ['--url', URL_, '--key', KEY], log: () => {}, post: deviceApi([]) });
  let clock = Date.now();
  const tick = { now: () => clock, sleep: async ms => { clock += ms; } };
  await assert.rejects(waitDeviceLogin({ timeoutSeconds: 7, post: deviceApi([{ status: 'pending' }, { status: 'pending' }]), ...tick }), /device-login-pending/);
  assert.equal((await saved(pendingDeviceLoginPath(sessionPath))).deviceCode, DEVICE);
  const gone = Object.assign(new Error('device-login-expired'), { status: 410 });
  await assert.rejects(waitDeviceLogin({ post: deviceApi([gone]), ...tick }), /device-login-expired/);
  await assert.rejects(saved(pendingDeviceLoginPath(sessionPath)), /ENOENT/);
  // A server without the route is reported as unavailable; nothing falls back to a pasted callback.
  const old = async () => { throw Object.assign(new Error('route-not-found'), { status: 404 }); };
  await assert.rejects(startDeviceLogin({ argv: ['--url', URL_, '--key', KEY], log: () => {}, post: old }), /device-login-unavailable/);
  await assert.rejects(startDeviceLogin({ argv: ['--url', URL_, '--key', KEY, '--link'], log: () => {}, post: deviceApi([]) }), /device-link-unsupported/);
});

test('device connection transport failure preserves the pending request and recovery never starts a second login', async () => {
  const sessionPath = path.join(directory, 'device-recovery', 'client.json');
  process.env.AI_FIGHTER_CLIENT_CONFIG = sessionPath;
  const calls = [];
  const post = deviceApi([], calls);
  await startDeviceLogin({ argv: ['--url', URL_, '--key', KEY], log: () => {}, post });
  const pendingPath = pendingDeviceLoginPath(sessionPath), original = await readFile(pendingPath, 'utf8');
  await assert.rejects(startDeviceLogin({ argv: ['--url', URL_, '--key', KEY], log: () => {}, post }), /device-login-already-pending/);
  assert.equal(calls.length, 1);
  for (const reason of ['network-connect-forbidden', 'network-timeout', 'api-unreachable']) {
    await assert.rejects(waitDeviceLogin({ post: deviceApi([new Error(reason)], calls),
      sleep: async () => assert.fail('do not loop on connection failure'), log: () => {} }), { message: reason });
    assert.equal(await readFile(pendingPath, 'utf8'), original);
  }
  await assert.rejects(waitDeviceLogin({ timeoutSeconds: 0, post: deviceApi([{ status: 'pending' }], calls), log: () => {} }), /device-login-pending/);
  assert.equal(calls.filter(call => call.route === 'device-logins').length, 1);
  assert.equal(await readFile(pendingPath, 'utf8'), original);
});

test('an approved device login survives a failed redeem or a needed --replace without a second approval', async () => {
  const sessionPath = path.join(directory, 'device-resume', 'client.json');
  process.env.AI_FIGHTER_CLIENT_CONFIG = sessionPath;
  await startDeviceLogin({ argv: ['--url', URL_, '--key', KEY], log: () => {}, post: deviceApi([]) });
  const pendingPath = pendingDeviceLoginPath(sessionPath), calls = [], verified = [];
  const session = user => ({ data: { session: { access_token: jwt({ sub: user, exp: 9999999999 }), refresh_token: `refresh-${user}`, user: { id: user } } } });
  const auth = answer => () => ({ auth: { verifyOtp: async args => { verified.push(args); return answer(); } } });
  const options = { request: async () => ({ ok: true, account: { invited: true } }), sleep: async () => {}, log: () => {} };
  // Auth unreachable after approval: the token is kept, and the server is not asked again.
  const offline = Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError', status: 0 });
  await assert.rejects(waitDeviceLogin({ ...options, post: deviceApi([{ ok: true, status: 'approved', tokenHash: HASH }], calls), createAuthClient: auth(() => ({ error: offline })) }),
    /device-login-redeem-retry/);
  assert.equal((await saved(pendingPath)).tokenHash, HASH);
  await assert.rejects(startDeviceLogin({ argv: ['--url', URL_, '--key', KEY], log: () => {}, post: deviceApi([]) }), /device-login-already-pending/);
  // Another user's session is in the file: the redeemed session waits in the pending file for --replace.
  await writeFile(sessionPath, JSON.stringify({ url: URL_, publishableKey: KEY, accessToken: jwt({ sub: 'someone-else', exp: 9999999999 }), refreshToken: 'r' }));
  await assert.rejects(waitDeviceLogin({ ...options, post: deviceApi([], calls), createAuthClient: auth(() => session('user-9')) }), /session-user-differs/);
  assert.equal((await saved(pendingPath)).session.user.id, 'user-9');
  assert.equal((await saved(pendingPath)).tokenHash, undefined, 'the spent token is not kept');
  const result = await waitDeviceLogin({ ...options, replace: true, post: deviceApi([], calls), createAuthClient: auth(() => assert.fail('never redeemed twice')) });
  assert.equal(result.userId, 'user-9');
  assert.equal((await saved(sessionPath)).refreshToken, 'refresh-user-9');
  await assert.rejects(saved(pendingPath), /ENOENT/);
  assert.equal(verified.length, 2, 'one failed and one successful redeem, no third');
  assert.equal(calls.filter(call => call.route === 'device-logins/token').length, 1, 'the approval was polled once');
});

test('a refused device-login token ends the request so a new approval can start', async () => {
  const sessionPath = path.join(directory, 'device-refused', 'client.json');
  process.env.AI_FIGHTER_CLIENT_CONFIG = sessionPath;
  await startDeviceLogin({ argv: ['--url', URL_, '--key', KEY], log: () => {}, post: deviceApi([]) });
  const refused = Object.assign(new Error('Token has expired or is invalid'), { name: 'AuthApiError', status: 403 });
  await assert.rejects(waitDeviceLogin({ post: deviceApi([{ ok: true, status: 'approved', tokenHash: HASH }]), sleep: async () => {}, log: () => {},
    createAuthClient: () => ({ auth: { verifyOtp: async () => ({ error: refused }) } }) }), /device-login-redeem-failed/);
  await assert.rejects(saved(pendingDeviceLoginPath(sessionPath)), /ENOENT/);
});
