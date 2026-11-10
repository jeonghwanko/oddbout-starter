import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GAME_LAUNCHER_UI,
  GAME_URL,
  gameLauncherHtml,
  gameLauncherMeta,
  registerGameLauncherUi,
  registerGameLauncherTool,
} from '../mcp/cloud/game-launcher-ui.mjs';

test('launcher embeds only ODDBOUT and exposes the required iframe policy', () => {
  assert.equal(GAME_URL, 'https://oddbout.com/fighter.html');
  assert.deepEqual(gameLauncherMeta.ui.csp.frameDomains, ['https://oddbout.com']);
  assert.deepEqual(gameLauncherMeta['openai/widgetCSP'].frame_domains, ['https://oddbout.com']);
  assert.match(gameLauncherHtml, /<iframe\s+id="game"/);
  assert.match(gameLauncherHtml, /ui\/initialize/);
  assert.match(gameLauncherHtml, /requestDisplayMode/);
  assert.match(gameLauncherHtml, /frame\.removeAttribute\('src'\)/);
  assert.doesNotMatch(gameLauncherHtml, /access_token=|refresh_token=|Bearer\s+\$\{/i);
});
test('launcher resource is an MCP Apps HTML template', async () => {
  let called;
  registerGameLauncherUi({
    registerResource(...args) { called = args; },
  });
  assert.equal(called[0], 'oddbout-game-launcher');
  assert.equal(called[1], GAME_LAUNCHER_UI);
  assert.equal(called[2].mimeType, 'text/html;profile=mcp-app');
  const response = await called[3]();
  assert.equal(response.contents[0].uri, GAME_LAUNCHER_UI);
  assert.equal(response.contents[0].text, gameLauncherHtml);
  assert.deepEqual(response.contents[0]._meta.ui.csp.frameDomains, ['https://oddbout.com']);
});
test('launcher tool is read-only and requires a connected account via the cloud wrapper', async () => {
  let args;
  registerGameLauncherTool((...received) => { args = received; });
  assert.equal(args[0], 'open_game_launcher');
  assert.deepEqual(args[3], {});
  assert.deepEqual(args[5], { openWorld: false });
  const output = await args[4]();
  assert.equal(output.ok, true);
  assert.equal(output.launchMode, 'embedded-iframe');
  assert.equal(output.gameUrl, GAME_URL);
});
