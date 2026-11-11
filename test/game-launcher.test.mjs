import test from 'node:test';
import assert from 'node:assert/strict';
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
  });
  assert.equal(result.structuredContent, undefined);
  assert.doesNotMatch(JSON.stringify({ ok: result.ok, attemptId: result.attemptId }), /afg_[0-9a-f]{64}/);
});

test('iframe diagnostics refuse redirects and report enforced frame blockers', async () => {
  const deny = inspectFrameHeaders(new Headers({ 'x-frame-options': 'DENY' }));
  assert.equal(deny.findings.length, 1);
  const selfOnly = inspectFrameHeaders(new Headers({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'" }));
  assert.equal(selfOnly.findings.length, 1);
  let responseUrl;
  const result = await checkGameIframe(async (url, options) => {
    responseUrl = url;
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    return new Response('', { status: 302, headers: { location: 'https://oddbout.com/login' } });
  }, gameUrl);
  assert.equal(responseUrl, gameUrl);
  assert.equal(result.redirected, true);
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
  assert.doesNotMatch(JSON.stringify(called.result.content), /afg_[0-9a-f]{64}/);
  assert.doesNotMatch(JSON.stringify(called.result.structuredContent), /afg_[0-9a-f]{64}/);
});
