import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { homepageEntries } from '../scripts/homepage-entry.mjs';
import { publicSiteText, hosting } from '../scripts/hosting-lib.mjs';

function navigate(html, search = '', hash = '', pathname = '/') {
  const result = {};
  const location = {
    pathname,
    search,
    hash,
    replace: value => {
      result.redirect = value;
    },
  };
  const history = {
    replaceState: (_, __, value) => {
      result.address = value;
    },
  };
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], { location, history, URLSearchParams });
  return result;
}

test('homepage is served directly, with language and public anchors preserved', () => {
  const body = '<main id="main"><h1>ODDBOUT</h1><a href="./fighter.html">PLAY</a></main>';
  const entries = homepageEntries('<html><head><title>ODDBOUT</title></head><body>' + body + '</body></html>');
  assert.ok(entries['index.html'].includes(body));
  assert.deepEqual(navigate(entries['index.html']), {});
  assert.deepEqual(navigate(entries['index.html'], '?utm_source=instagram&utm_campaign=launch'), {});
  assert.deepEqual(navigate(entries['index.html'], '', '', '/index.html'), { address: './' });
  for (const hash of ['', '#main', '#fighters', '#match', '#join']) {
    assert.deepEqual(navigate(entries['index.html'], '?lang=ko', hash), {});
    assert.deepEqual(navigate(entries['league.html'], '?lang=ko', hash, '/league.html'), { address: './?lang=ko' + hash });
    assert.ok(entries['league.html'].includes(body));
  }
  for (const [search, hash] of [
    ['', '#handoff=token'],
    ['', '#dot=code&port=1234'],
    ['', '#view=rankings'],
    ['?lang=en&apply=founding-league', ''],
    ['?code=oauth', ''],
  ]) {
    assert.equal(navigate(entries['index.html'], search, hash).redirect, './creator.html' + search + hash);
  }
});

test('public home links and canonical metadata use the root without rewriting repository links', () => {
  const base = new URL('.', hosting.siteUrl).href;
  for (const old of ['https://jeonghwanko.github.io/oddbout-starter/', 'https://jeonghwanko.github.io/ai-fighter-dots-starter/'])
    assert.equal(publicSiteText(`<link rel="canonical" href="${old}league.html">`), `<link rel="canonical" href="${base}">`);
  assert.equal(
    publicSiteText('<a href="./league.html?lang=ko#fighters" data-destination="league.html">'),
    '<a href="./?lang=ko#fighters" data-destination="">',
  );
  assert.equal(publicSiteText('home: ["league.html", ""]'), 'home: ["", ""]');
  assert.equal(publicSiteText('data-destination=\\"league.html\\"'), 'data-destination=\\"\\"');
  const sourceLink = 'https://github.com/jeonghwanko/crashbang-heroes/blob/main/kaito_web/league.html';
  assert.equal(publicSiteText(sourceLink), sourceLink);
});
