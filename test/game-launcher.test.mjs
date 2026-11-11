import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import {
  GAME_LAUNCHER_UI,
  configuredGameLauncher,
  gameLauncherHtmlFor,
  gameLauncherMetadata,
  registerGameLauncherTools,
  registerGameLauncherUi,
} from '../mcp/cloud/game-launcher-ui.mjs';
import { checkGameIframe, inspectFrameHeaders } from '../scripts/check-chatgpt-iframe.mjs';
import { CLOUD_ISSUER, CLOUD_RESOURCE, componentToolMetadata, createCloudHandler } from '../mcp/cloud.mjs';

const gameUrl = 'https://oddbout.com/embed/chatgpt/';
const game = { url: gameUrl, origin: 'https://oddbout.com' };
const connectorToken = 'signed-connector-token-for-test';

function launcherHarness() {
  const ids = new Map(),
    windowListeners = new Map(),
    postedToGame = [],
    pendingCalls = [],
    timers = new Map();
  let timerId = 0,
    frameId = 0;
  class Element {
    constructor() {
      this.hidden = false;
      this.style = {};
      this.listeners = new Map();
      this.children = [];
      this.contentWindow = { postMessage: (data, targetOrigin) => postedToGame.push({ data, targetOrigin }) };
    }
    addEventListener(type, callback) {
      this.listeners.set(type, callback);
    }
    trigger(type) {
      this.listeners.get(type)?.();
    }
    click() {
      this.trigger('click');
    }
    append(child) {
      this.children.push(child);
    }
    replaceChildren() {
      this.children = [];
    }
    removeAttribute() {}
    remove() {}
  }
  for (const id of ['stage', 'start', 'reload', 'back', 'full', 'message']) ids.set(id, new Element());
  ids.get('stage').style.display = 'none';
  const parent = { postMessage() {} };
  const document = {
    body: { scrollHeight: 0 },
    documentElement: { lang: 'en' },
    getElementById: id => ids.get(id),
    createElement: () => {
      const frame = new Element();
      frame.id = ++frameId;
      return frame;
    },
  };
  const openai = {
    locale: 'en',
    toolResponseMetadata: null,
    callTool(name, args) {
      const call = { name, args, resolve: null };
      const promise = new Promise(resolve => (call.resolve = resolve));
      pendingCalls.push(call);
      return promise;
    },
  };
  const window = {
    openai,
    addEventListener: (type, callback) => windowListeners.set(type, callback),
  };
  const script = gameLauncherHtmlFor(game).match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  runInNewContext(script, {
    window,
    document,
    parent,
    crypto: {
      randomUUID: () => `123e4567-e89b-42d3-a456-${String(frameId).padStart(12, '0')}`,
      getRandomValues: bytes => bytes.fill(7),
    },
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
  });
  return {
    ids,
    windowListeners,
    postedToGame,
    pendingCalls,
    timers,
    openai,
    start: () => ids.get('start').click(),
    load: () => ids.get('stage').children[0].trigger('load'),
    gameMessage(type, extra = {}) {
      const hello = postedToGame.findLast(message => message.data.type === 'launcher:hello')?.data;
      assert.ok(hello, 'launcher hello must be sent before a game response');
      windowListeners.get('message')({
        source: ids.get('stage').children[0].contentWindow,
        origin: game.origin,
        data: { channel: 'oddbout-launcher-v2', type, nonce: hello.nonce, attemptId: hello.attemptId, ...extra },
      });
      return hello;
    },
    expireWatchdog() {
      const [id, timer] = [...timers].find(([, value]) => value.delay === 20_000) ?? [];
      assert.ok(timer, 'a watchdog must be armed');
      timers.delete(id);
      timer.callback();
    },
  };
}

test('launcher requires explicit opt-in and the exact HTTPS embed route', () => {
  assert.equal(configuredGameLauncher(undefined), null);
  assert.equal(configuredGameLauncher({ enabled: false, gameUrl }), null);
  assert.deepEqual(configuredGameLauncher({ enabled: true, gameUrl }), game);
  for (const invalid of [
    'http://oddbout.com/embed/chatgpt/',
    'https://oddbout.com/fighter.html',
    'https://oddbout.com/embed/chatgpt/?token=x',
    'https://oddbout.com/embed/chatgpt/?',
    'https://oddbout.com/embed/chatgpt/#',
    'https://user@oddbout.com/embed/chatgpt/',
    'https://oddbout.com/embed/chatgpt',
  ])
    assert.equal(configuredGameLauncher({ enabled: true, gameUrl: invalid }), null);
});

test('component uses exact origin CSP and v2 challenge protocol without a URL credential', async () => {
  const metadata = gameLauncherMetadata(game.origin);
  const html = gameLauncherHtmlFor(game);
  assert.deepEqual(metadata.ui.csp.frameDomains, [game.origin]);
  assert.deepEqual(metadata['openai/widgetCSP'].frame_domains, [game.origin]);
  assert.deepEqual(metadata['openai/ui'].availableDisplayModes, ['inline', 'fullscreen']);
  assert.match(html, /oddbout-launcher-v2/);
  assert.match(html, /launcher:hello/);
  assert.match(html, /game:auth-required/);
  assert.match(html, /launcher:grant/);
  assert.match(html, /issue_game_launch_grant/);
  assert.match(html, /game:authenticated/);
  assert.match(html, /game:ready/);
  assert.match(html, /game:error/);
  assert.match(html, /if\(!validBase64url43\(data\.challenge\)\)\{\s*failAttempt\(/);
  assert.match(html, /game:close/);
  assert.match(html, /function repeatHello\(expectedAttempt\)/);
  assert.match(html, /setTimeout\(\(\)=>repeatHello\(expectedAttempt\),500\)/);
  assert.match(html, /helloCount>=40/);
  assert.doesNotMatch(html, /function armWatchdog\(\)[\s\S]{0,100}armWatchdog\(\)/);
  assert.doesNotMatch(html, /access_token|refresh_token|Bearer\s+\$\{/i);
  assert.doesNotMatch(html, /grant[=:]["']\s*\+|[?&]grant=/i);

  let registered;
  registerGameLauncherUi(
    {
      registerResource(...args) {
        registered = args;
      },
    },
    game,
  );
  assert.equal(registered[1], GAME_LAUNCHER_UI);
  assert.equal(registered[2].mimeType, 'text/html;profile=mcp-app');
  const result = await registered[3]();
  assert.equal(result.contents[0].text, html);
  assert.deepEqual(result.contents[0]._meta.ui.csp.frameDomains, [game.origin]);
});

test('grant tool is component-only and keeps the grant in private metadata', async () => {
  const tools = new Map();
  registerGameLauncherTools(
    (name, ...args) => tools.set(name, args),
    game,
    async () => ({ grant: `afg_${'a'.repeat(64)}`, expiresAt: '2026-11-11T00:00:00.000Z' }),
  );
  const launcher = tools.get('open_game_launcher');
  assert.ok(launcher);
  assert.deepEqual(launcher[2], {});
  const preview = await launcher[3]();
  assert.equal(preview.ok, true);
  assert.equal(preview.launchMode, 'embedded-iframe');
  assert.match(preview.note, /No game session/);
  assert.equal(launcher[4].uiResourceUri, GAME_LAUNCHER_UI);

  const grant = tools.get('issue_game_launch_grant');
  assert.ok(grant);
  assert.equal(grant[4].write, true);
  assert.equal(grant[4].idempotent, false);
  assert.deepEqual(grant[4].uiVisibility, ['app']);
  const metadata = componentToolMetadata(undefined, grant[4].uiVisibility);
  assert.deepEqual(metadata.ui.visibility, ['app']);
  assert.equal(metadata.ui.resourceUri, undefined);
  assert.equal(metadata['openai/visibility'], 'private');
  assert.equal(metadata['openai/widgetAccessible'], true);
  const result = await grant[3]({ nonce: '1'.repeat(32), attemptId: '123e4567-e89b-42d3-a456-426614174000', challenge: 'A'.repeat(43) });
  assert.deepEqual(result._uiMeta, {
    gameLaunchGrant: `afg_${'a'.repeat(64)}`,
    gameLaunchGrantExpiresAt: '2026-11-11T00:00:00.000Z',
    attemptId: '123e4567-e89b-42d3-a456-426614174000',
    nonce: '1'.repeat(32),
    challenge: 'A'.repeat(43),
  });
  assert.equal(result.structuredContent, undefined);
  assert.doesNotMatch(JSON.stringify({ ok: result.ok, attemptId: result.attemptId }), /afg_[0-9a-f]{64}/);
});

test('a timed-out grant call cannot win a reconnect race or reuse stale host metadata', async () => {
  const harness = launcherHarness();
  harness.start();
  harness.load();
  const attempt = harness.gameMessage('game:auth-required', { challenge: 'A'.repeat(43) });
  assert.equal(harness.pendingCalls.length, 1);

  harness.expireWatchdog();
  harness.gameMessage('game:auth-required', { challenge: 'B'.repeat(43) });
  assert.equal(harness.pendingCalls.length, 2);

  harness.pendingCalls[0].resolve({
    _meta: {
      gameLaunchGrant: `afg_${'a'.repeat(64)}`,
      attemptId: attempt.attemptId,
      nonce: attempt.nonce,
      challenge: 'A'.repeat(43),
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(
    harness.postedToGame.some(message => message.data.type === 'launcher:grant'),
    false,
  );

  harness.openai.toolResponseMetadata = {
    gameLaunchGrant: `afg_${'b'.repeat(64)}`,
    attemptId: attempt.attemptId,
    nonce: attempt.nonce,
    challenge: 'A'.repeat(43),
  };
  harness.pendingCalls[1].resolve({});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(
    harness.postedToGame.some(message => message.data.type === 'launcher:grant'),
    false,
  );

  harness.gameMessage('game:auth-required', { challenge: 'C'.repeat(43) });
  assert.equal(harness.pendingCalls.length, 3);
  harness.openai.toolResponseMetadata = {
    gameLaunchGrant: `afg_${'c'.repeat(64)}`,
    attemptId: attempt.attemptId,
    nonce: attempt.nonce,
    challenge: 'C'.repeat(43),
  };
  harness.pendingCalls[2].resolve({});
  await new Promise(resolve => setImmediate(resolve));
  const grants = harness.postedToGame.filter(message => message.data.type === 'launcher:grant');
  assert.equal(grants.length, 1);
  assert.equal(grants[0].data.grant, `afg_${'c'.repeat(64)}`);
});

test('iframe diagnostics require the configured exact ancestor chain in every enforced CSP policy', async () => {
  const expected = ['https://chat.example', 'https://widget.example'];
  const valid = inspectFrameHeaders(new Headers({ 'content-security-policy': `default-src 'self'; frame-ancestors ${expected.join(' ')}` }), expected);
  assert.deepEqual(valid.findings, []);

  const absent = inspectFrameHeaders(new Headers(), expected);
  assert.ok(absent.findings.some(finding => /Content-Security-Policy is missing/.test(finding)));

  const selfOnly = inspectFrameHeaders(new Headers({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'" }), expected);
  assert.ok(selfOnly.findings.some(finding => /exact HTTPS origins/.test(finding)));

  for (const unsafe of ['*', 'https://*.example', 'null', "'none'", "'self'"]) {
    const result = inspectFrameHeaders(new Headers({ 'content-security-policy': `frame-ancestors ${unsafe}` }), expected);
    assert.ok(
      result.findings.some(finding => /exact HTTPS origins/.test(finding)),
      unsafe,
    );
  }

  const duplicate = inspectFrameHeaders(
    new Headers({ 'content-security-policy': `frame-ancestors ${expected.join(' ')}; frame-ancestors ${expected.join(' ')}` }),
    expected,
  );
  assert.ok(duplicate.findings.some(finding => /exactly one frame-ancestors/.test(finding)));

  const intersected = inspectFrameHeaders(
    new Headers([
      ['content-security-policy', `frame-ancestors ${expected.join(' ')}`],
      ['content-security-policy', `frame-ancestors ${expected[0]}`],
    ]),
    expected,
  );
  assert.ok(intersected.findings.some(finding => /does not exactly match/.test(finding)));

  for (const invalid of ['*', 'https://*.example']) {
    const invalidInput = inspectFrameHeaders(new Headers(), [invalid]);
    assert.ok(
      invalidInput.findings.some(finding => /exact HTTPS origins/.test(finding)),
      invalid,
    );
    await assert.rejects(
      checkGameIframe(async () => assert.fail('fetch must not run'), gameUrl, [invalid]),
      /exact HTTPS origins/,
    );
  }
  const emptyInput = inspectFrameHeaders(new Headers(), []);
  assert.ok(emptyInput.findings.some(finding => /JSON array/.test(finding)));
  await assert.rejects(
    checkGameIframe(async () => assert.fail('fetch must not run'), gameUrl, []),
    /JSON array/,
  );
});

test('iframe diagnostics flag redirects and non-HTML routes', async () => {
  let responseUrl;
  const redirect = await checkGameIframe(
    async (url, options) => {
      responseUrl = url;
      assert.equal(options.redirect, 'manual');
      assert.equal(options.credentials, 'omit');
      return new Response('<html>redirect</html>', {
        status: 302,
        headers: { location: 'https://oddbout.com/login', 'content-type': 'text/html' },
      });
    },
    gameUrl,
    ['https://chat.example'],
  );
  assert.equal(responseUrl, gameUrl);
  assert.equal(redirect.redirected, true);
  assert.ok(redirect.findings.some(finding => /redirected/.test(finding)));

  const nonHtml = await checkGameIframe(
    async () =>
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-security-policy': 'frame-ancestors https://chat.example' },
      }),
    gameUrl,
    ['https://chat.example'],
  );
  assert.ok(nonHtml.findings.some(finding => /text\/html/.test(finding)));
});

test('Cloud exposes the grant only to the app and only in result metadata', async () => {
  const owner = '123e4567-e89b-42d3-a456-426614174000';
  const client = '123e4567-e89b-42d3-a456-426614174001';
  const session = '123e4567-e89b-42d3-a456-426614174002';
  const claims = {
    iss: CLOUD_ISSUER,
    aud: CLOUD_RESOURCE,
    sub: owner,
    client_id: client,
    session_id: session,
    is_anonymous: false,
    exp: Math.floor(Date.now() / 1000) + 3600,
    af_mcp: 'registration-v1',
    role: 'af_mcp',
  };
  const db = {
    auth: {
      async getClaims() {
        return { data: { claims }, error: null };
      },
    },
    async rpc(name) {
      if (name === 'af_mcp_session_state') return { data: 'usable', error: null };
      if (name === 'af_embed_issue_grant') return { data: { expiresAt: '2026-11-11T00:00:00.000Z' }, error: null };
      throw Error(`unexpected RPC: ${name}`);
    },
  };
  const handle = createCloudHandler({ db, gameLauncherConfig: { enabled: true, gameUrl }, log() {} });
  const request = body =>
    handle(
      new Request(CLOUD_RESOURCE, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${connectorToken}`,
          origin: 'https://chatgpt.com',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }),
      }),
    );
  const listResponse = await request({ method: 'tools/list', params: {} });
  const listText = await listResponse.text();
  assert.equal(listResponse.status, 200, `tools/list response: ${listText}`);
  const listed = JSON.parse(listText);
  const grantTool = listed.result.tools.find(tool => tool.name === 'issue_game_launch_grant');
  assert.deepEqual(grantTool._meta.ui.visibility, ['app']);
  assert.equal(grantTool._meta.ui.resourceUri, undefined);
  assert.equal(grantTool._meta['openai/visibility'], 'private');
  assert.equal(grantTool._meta['openai/widgetAccessible'], true);

  const callResponse = await request({
    method: 'tools/call',
    params: {
      name: 'issue_game_launch_grant',
      arguments: { nonce: '2'.repeat(32), attemptId: '123e4567-e89b-42d3-a456-426614174003', challenge: 'B'.repeat(43) },
      _meta: { 'openai/component-call': true },
    },
  });
  const callText = await callResponse.text();
  assert.equal(callResponse.status, 200, `tools/call response: ${callText}`);
  const called = JSON.parse(callText);
  const grant = called.result._meta.gameLaunchGrant;
  assert.match(grant, /^afg_[0-9a-f]{64}$/);
  assert.equal(called.result._meta.attemptId, '123e4567-e89b-42d3-a456-426614174003');
  assert.equal(called.result._meta.nonce, '2'.repeat(32));
  assert.equal(called.result._meta.challenge, 'B'.repeat(43));
  assert.doesNotMatch(JSON.stringify(called.result.content), /afg_[0-9a-f]{64}/);
  assert.doesNotMatch(JSON.stringify(called.result.structuredContent), /afg_[0-9a-f]{64}/);
});
