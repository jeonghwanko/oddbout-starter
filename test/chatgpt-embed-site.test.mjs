import test from 'node:test';
import assert from 'node:assert/strict';
import { chatGptEmbedBuild } from '../scripts/chatgpt-embed-site.mjs';

const settings = {
  enabled: true,
  apiBase: 'https://api.example.test/functions/v1/ai-fighter',
  parentOrigins: ['https://widget.example.test'],
  ancestorOrigins: ['https://widget.example.test', 'https://host.example.test'],
};

test('an ordinary site build never activates ChatGPT from ambient settings', () => {
  const result = chatGptEmbedBuild(undefined);
  assert.equal(result.enabled, false);
  assert.equal(result.define['import.meta.env.VITE_CHATGPT_EMBED_ENABLED'], '"false"');
  assert.match(result.headers, /frame-ancestors 'none'/);
  assert.match(result.headers, /X-Frame-Options: DENY/);
  assert.doesNotMatch(result.headers, /^\/\*/m);
});

test('only the embed path permits the explicitly supplied ancestors', () => {
  const result = chatGptEmbedBuild(settings);
  assert.equal(result.enabled, true);
  assert.match(result.headers, /frame-ancestors https:\/\/widget.example.test https:\/\/host.example.test/);
  assert.match(result.headers, /! X-Frame-Options/);
  assert.doesNotMatch(result.headers, /fighter\.html|^\/\*/m);
  assert.deepEqual(JSON.parse(JSON.parse(result.define['import.meta.env.VITE_CHATGPT_EMBED_PARENT_ORIGINS'])), settings.parentOrigins);
});

test('unsafe or incomplete frame and API settings fail the build', () => {
  for (const origin of [
    '*',
    'null',
    'https://*.example.test',
    'https://widget.example.test/path',
    'http://widget.example.test',
    'https://user:pass@widget.example.test',
  ])
    assert.throws(() => chatGptEmbedBuild({ ...settings, parentOrigins: [origin] }));
  assert.throws(() => chatGptEmbedBuild({ ...settings, ancestorOrigins: ['https://host.example.test'] }));
  assert.throws(() => chatGptEmbedBuild({ ...settings, apiBase: 'https://api.example.test/?token=private' }));
  assert.throws(() => chatGptEmbedBuild({ enabled: true }));
});
