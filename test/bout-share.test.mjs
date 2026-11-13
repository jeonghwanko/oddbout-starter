// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachBoutShare, boutCaption, boutPlaybackUrl, highlightWindow } from '../api/bout-share.mjs';

const A = 'f600611b-ae49-4c9c-ae81-8a9b4a1cb9d9';
const B = 'b3dfcb95-0cb5-440c-8047-e17f7f54a4e0';

test('a playback link names both registered fighters, the seed and the digest, and not the club', () => {
  const page = boutPlaybackUrl({ a: A, b: B, seed: 3403579054, rules: 42, digest: '0123abcd' });
  const url = new URL(/** @type {string} */ (page));
  assert.equal(url.origin + url.pathname, 'https://oddbout.com/fighter.html');
  assert.equal(url.searchParams.get('play'), '1');
  assert.equal(url.searchParams.get('fighter'), A);
  assert.equal(url.searchParams.get('opponent'), B);
  assert.equal(url.searchParams.get('bout'), '3403579054');
  assert.equal(url.searchParams.get('rules'), '42');
  assert.equal(url.searchParams.get('d'), '0123abcd');
  assert.equal(url.searchParams.get('club'), null);
  assert.equal(boutPlaybackUrl({ a: A, b: A, seed: 1 }), null);
  assert.equal(
    boutPlaybackUrl({ a: 'kuma', b: 'yume', seed: 104, rules: 42, digest: 'abcdef01', locale: 'en' })?.includes('fighter=kuma&opponent=yume&bout=104'),
    true,
  );
});

test('a withheld arena page is filled, and a page the arena already returned is kept', () => {
  const filled = attachBoutShare({
    ok: true,
    a: A,
    b: B,
    seed: 7,
    rules: 42,
    page: null,
    fighters: [{ name: '칩대장' }, { name: '만년주석' }],
    record: { winner: 0, how: 'ko', ms: 43500, digest: '0123abcd' },
  });
  assert.match(filled.page, /play=1/);
  assert.match(filled.page, new RegExp(`fighter=${A}`));
  assert.equal(filled.share.postsToX, false);
  assert.equal(filled.share.caption, '칩대장 대 만년주석. 칩대장이 43.5초 KO로 이겼다.');
  assert.match(filled.share.intent, /^https:\/\/x\.com\/intent\/post\?/);
  assert.equal(filled.share.reply, filled.page);
  const kept = attachBoutShare({
    ok: true,
    a: 'kuma',
    b: 'yume',
    seed: 1,
    rules: 1,
    page: 'https://oddbout.com/vs/kuma-vs-yume.ko.html?bout=1',
    fighters: [],
    record: {},
  });
  assert.equal(kept.page, 'https://oddbout.com/vs/kuma-vs-yume.ko.html?bout=1');
  assert.equal(attachBoutShare({ ok: false, code: 'fighter-not-admitted' }).page, undefined);
});

test('the caption names the winner and a highlight window uses the record clock', () => {
  assert.equal(boutCaption(['만년주석', '칩대장'], { winner: 1, how: 'decision', ms: 12.5 }), '만년주석 대 칩대장. 칩대장이 12.5초 판정으로 이겼다.');
  assert.deepEqual(highlightWindow({ ms: 43500, highlights: [{ ms: 12000 }, { ms: 40000 }] }), { startMs: 11000, endMs: 45000 });
  assert.equal(highlightWindow({ ms: 10, highlights: [] }), null);
});
