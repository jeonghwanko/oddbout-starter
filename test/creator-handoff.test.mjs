import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_CREATOR_PAGE, creatorPage } from '../mcp/creator-handoff.mjs';

const PUBLIC_ORIGIN = new URL(PUBLIC_CREATOR_PAGE).origin;

test('links open only the public creator homepage or a loopback development page', () => {
  assert.deepEqual(creatorPage(), { origin: PUBLIC_ORIGIN, href: PUBLIC_CREATOR_PAGE });
  assert.deepEqual(creatorPage('https://rupin.pryzm.gg/creator.html'), creatorPage());
  assert.deepEqual(creatorPage('https://jeonghwanko.github.io/oddbout-starter/creator.html'), creatorPage());
  assert.deepEqual(creatorPage('https://jeonghwanko.github.io/ai-fighter-dots-starter/creator.html'), creatorPage());
  assert.equal(creatorPage('http://127.0.0.1:5190/creator.html').origin, 'http://127.0.0.1:5190');
  for (const page of [
    'https://evil.example/creator.html',
    'http://rupin.pryzm.gg/creator.html',
    'https://rupin.pryzm.gg/index.html',
    'https://rupin.pryzm.gg/creator.html#x',
    'https://user@rupin.pryzm.gg/creator.html',
    'http://192.168.0.2:5190/creator.html',
    'https://jeonghwanko.github.io/another-project/creator.html',
    `${PUBLIC_CREATOR_PAGE}?redirect=evil`,
    `${PUBLIC_CREATOR_PAGE}#token`,
    'https://jeonghwanko.github.io.evil.example/oddbout-starter/creator.html',
  ])
    assert.throws(() => creatorPage(page), /creator-page-not-allowed/, page);
});
