import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
  GAME_LAUNCHER_UI,
  GAME_URL,
  gameLauncherHtml,
  gameLauncherMeta,
  registerGameLauncherUi,
  registerGameLauncherTool,
} from '../mcp/cloud/game-launcher-ui.mjs';
import { checkGameIframe, inspectFrameHeaders } from '../scripts/check-chatgpt-iframe.mjs';

function mountWidget() {
  const buttons = ['game', 'stage', 'start', 'back', 'full', 'message'];
  const elements = Object.fromEntries(buttons.map(id => {
    const handlers = new Map();
    return [id, {
      id, style: {}, hidden: id === 'back', textContent: '',
      handlers,
      addEventListener(name, fn) { handlers.set(name, fn); },
      removeAttribute(name) { if (name === 'src') delete this.src; },
      emit(name) { handlers.get(name)?.(); },
    }];
  }));
  const frameMessages = [];
  elements.game.contentWindow = {
    postMessage(message, origin) { frameMessages.push({ message, origin }); },
  };
  const hostMessages = [];
  const parent = { postMessage(message, origin) { hostMessages.push({ message, origin }); } };
  const windowHandlers = new Map();
  const fullscreenCalls = [];
  const window = {
    openai: { requestDisplayMode: args => { fullscreenCalls.push(args); return Promise.resolve(args); } },
    addEventListener(name, fn) { windowHandlers.set(name, fn); },
  };
  let nextTimer = 1;
  const timers = new Map();
  const script = gameLauncherHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'MCP resource must include an inline launcher program');
  runInNewContext(script, {
    window, document: { body: { scrollHeight: 450 }, documentElement: { lang: 'ko' }, getElementById: id => elements[id] },
    parent, crypto: { getRandomValues: array => array.fill(0x23) },
    Uint8Array, URL, Promise,
    ResizeObserver: class { observe() {} },
    setTimeout(fn, ms) { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  }, { timeout: 1000 });
  return {
    elements, parent, hostMessages, frameMessages, fullscreenCalls, windowHandlers,
    fireMessage(event) { windowHandlers.get('message')?.(event); },
    fireTimers() { for (const [id, value] of timers) { timers.delete(id); value.fn(); } },
  };
}

test('metadata uses fixed first-party game origin and MCP Apps resource', async () => {
  assert.equal(GAME_URL, 'https://oddbout.com/fighter.html');
  assert.deepEqual(gameLauncherMeta.ui.csp.frameDomains, ['https://oddbout.com']);
  assert.deepEqual(gameLauncherMeta['openai/widgetCSP'].frame_domains, ['https://oddbout.com']);
  assert.deepEqual(gameLauncherMeta['openai/ui'].availableDisplayModes, ['inline', 'fullscreen']);
  assert.match(gameLauncherHtml, /<iframe\s+id="game"/);
  assert.doesNotMatch(gameLauncherHtml, /access_token=|refresh_token=|Bearer\s+\$\{/i);
  let called;
  registerGameLauncherUi({ registerResource(...args) { called = args; } });
  assert.equal(called[0], 'oddbout-game-launcher');
  assert.equal(called[1], GAME_LAUNCHER_UI);
  assert.equal(called[2].mimeType, 'text/html;profile=mcp-app');
  const response = await called[3]();
  assert.equal(response.contents[0].text, gameLauncherHtml);
  assert.deepEqual(response.contents[0]._meta.ui.csp.frameDomains, ['https://oddbout.com']);
});

test('tool only returns a launcher descriptor and does not perform game actions', async () => {
  let args;
  registerGameLauncherTool((...received) => { args = received; });
  assert.equal(args[0], 'open_game_launcher');
  assert.deepEqual(args[3], {});
  const result = await args[4]();
  assert.equal(result.ok, true);
  assert.equal(result.launchMode, 'embedded-iframe');
  assert.match(result.note, /No game session/);
  assert.deepEqual(args[5], { openWorld: false });
});

test('widget launch remains unverified until a correct-origin game readiness signal', () => {
  const host = mountWidget();
  const { elements, frameMessages } = host;
  assert.equal(host.hostMessages[0].message.method, 'ui/initialize');
  assert.deepEqual(Array.from(host.hostMessages[0].message.params.appCapabilities.availableDisplayModes), ['inline', 'fullscreen']);
  host.fireMessage({
    source: host.parent, origin: 'https://chatgpt.com',
    data: { jsonrpc: '2.0', id: 1, result: { hostContext: { availableDisplayModes: ['inline', 'fullscreen'] } } },
  });
  assert.equal(elements.start.hidden, false);
  elements.start.emit('click');
  assert.equal(elements.game.src, GAME_URL);
  assert.equal(elements.start.hidden, true);
  assert.equal(elements.back.hidden, false);
  assert.equal(host.fullscreenCalls.length, 1);
  elements.game.emit('load');
  assert.match(elements.message.textContent, /아직 확인되지/);
  assert.equal(frameMessages.length, 1);
  assert.equal(frameMessages[0].origin, 'https://oddbout.com');
  const nonce = frameMessages[0].message.nonce;
  assert.match(nonce, /^[a-f0-9]{32}$/);

  host.fireMessage({
    source: elements.game.contentWindow,
    origin: 'https://attacker.example',
    data: { channel: 'oddbout-launcher-v1', type: 'game:ready', nonce },
  });
  assert.match(elements.message.textContent, /아직 확인되지/);
  host.fireMessage({
    source: elements.game.contentWindow,
    origin: 'https://oddbout.com',
    data: { channel: 'oddbout-launcher-v1', type: 'game:ready', nonce: 'wrong' },
  });
  assert.match(elements.message.textContent, /아직 확인되지/);

  host.fireMessage({
    source: elements.game.contentWindow,
    origin: 'https://oddbout.com',
    data: { channel: 'oddbout-launcher-v1', type: 'game:ready', nonce },
  });
  assert.match(elements.message.textContent, /Phaser 실행 준비 신호/);
  elements.back.emit('click');
  assert.equal(elements.game.src, undefined);
  assert.equal(elements.stage.style.display, 'none');
  assert.equal(elements.start.hidden, false);
  elements.game.emit('load'); // about:blank after removing src must not report success
  assert.match(elements.message.textContent, /런처로 돌아왔습니다/);
  host.fireMessage({
    source: elements.game.contentWindow,
    origin: 'https://oddbout.com',
    data: { channel: 'oddbout-launcher-v1', type: 'game:ready', nonce },
  });
  assert.match(elements.message.textContent, /런처로 돌아왔습니다/);
});

test('fullscreen requests require explicit host capability advertisement', () => {
  const host = mountWidget();
  host.elements.full.emit('click');
  assert.equal(host.fullscreenCalls.length, 0);
  assert.match(host.elements.message.textContent, /전체화면 지원을 확인하지 않았습니다/);
  host.fireMessage({
    source: host.parent, origin: 'https://chatgpt.com',
    data: { jsonrpc: '2.0', id: 1, result: { hostContext: { availableDisplayModes: ['inline'] } } },
  });
  host.elements.full.emit('click');
  assert.equal(host.fullscreenCalls.length, 0);
  host.fireMessage({
    source: host.parent, origin: 'https://chatgpt.com',
    data: { jsonrpc: '2.0', method: 'ui/notifications/host-context-changed',
      params: { availableDisplayModes: ['inline', 'fullscreen'] } },
  });
  host.elements.full.emit('click');
  assert.equal(host.fullscreenCalls.length, 1);
});

test('timeout does not falsely certify a loaded or blocked iframe', () => {
  const host = mountWidget();
  host.elements.start.emit('click');
  host.elements.game.emit('load');
  host.fireTimers();
  assert.match(host.elements.message.textContent, /실행을 확인하지 못했습니다/);
});

test('MCP host initialization is limited to the parent window', () => {
  const host = mountWidget();
  const before = host.hostMessages.length;
  host.fireMessage({ source: host.elements.game.contentWindow, origin: 'https://oddbout.com',
    data: { jsonrpc: '2.0', id: 1, result: { hostContext: { locale: 'xx' } } } });
  assert.equal(host.hostMessages.length, before);
  host.fireMessage({ source: host.parent, origin: 'https://chatgpt.com',
    data: { jsonrpc: '2.0', id: 1, result: { hostContext: { locale: 'ko-KR' } } } });
  assert.equal(host.hostMessages[before].message.method, 'ui/notifications/initialized');
});

test('read-only iframe probe refuses redirects and analyzes restrictive headers', async () => {
  const deny = inspectFrameHeaders(new Headers({ 'x-frame-options': 'DENY' }));
  assert.equal(deny.findings.length, 1);
  const restrictive = inspectFrameHeaders(new Headers({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'" }));
  assert.equal(restrictive.findings.length, 1);
  const mixedAllow = inspectFrameHeaders(new Headers({
    'content-security-policy': "frame-ancestors 'self' https://chatgpt.com",
  }));
  assert.equal(mixedAllow.findings.length, 0);
  const redirect = await checkGameIframe(async (url, options) => {
    assert.equal(url, GAME_URL);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    return new Response(null, { status: 302, headers: { location: 'https://other.example' } });
  });
  assert.equal(redirect.redirected, true);
  assert.equal(redirect.status, 302);
});

test('cloud MCP binds the launcher tool to its resource without publishing to the limited directory edition', async () => {
  const source = await readFile(new URL('../mcp/cloud.mjs', import.meta.url), 'utf8');
  assert.match(source, /name === 'open_game_launcher'[\s\S]*?resourceUri: GAME_LAUNCHER_UI/);
  assert.match(source, /if \(launcherEnabled && !directory\) \{[\s\S]*?registerGameLauncherUi\(server\);[\s\S]*?registerGameLauncherTool\(registerTool\);/);
  assert.match(source, /launcherEnabled = false/);
  const entry = await readFile(new URL('../supabase/functions/ai-fighter-mcp/index.ts', import.meta.url), 'utf8');
  assert.match(entry, /Deno\.env\.get\('ODDBOUT_CHATGPT_GAME_LAUNCHER'\) === '1'/);
});
