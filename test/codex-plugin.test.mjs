import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
test('Git marketplace installs a portable skill without adding another MCP or authentication flow', async () => {
  const market = JSON.parse(await readFile(new URL('.agents/plugins/marketplace.json', root), 'utf8'));
  assert.equal(market.name, 'oddbout');
  assert.equal(market.plugins.length, 1);
  const entry = market.plugins[0];
  assert.equal(entry.source.path, './plugins/oddbout-codex');
  assert.equal(entry.policy.authentication, 'ON_USE');
  const plugin = new URL('plugins/oddbout-codex/', root);
  const manifest = JSON.parse(await readFile(new URL('plugin.json', plugin), 'utf8'));
  assert.equal(entry.name, manifest.name);
  assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.deepEqual((await readdir(plugin)).sort(), ['assets', 'plugin.json', 'skills']);
  assert.equal(manifest.apps, undefined);
  assert.equal(manifest.extensions['com.openai'].apps, undefined);
  const skill = await readFile(new URL('skills/create-fighter/SKILL.md', plugin), 'utf8');
  assert.match(skill, /name: create-fighter/);
  assert.match(skill, /does not authorize starting or resuming creation/);
  const workspace = await readFile(new URL('skills/create-fighter/references/workspace.md', plugin), 'utf8');
  assert.doesNotMatch(workspace, /node <plugin-root>/);
  assert.match(workspace, /contains skills only/);
});

test('Git plugin preserves the canonical creation rules and bundled references', () => {
  execFileSync(process.execPath, ['scripts/sync-codex-plugin.mjs', '--check'], { cwd: root, stdio: 'pipe' });
});
