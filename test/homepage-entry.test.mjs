import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { homepageEntries } from '../scripts/homepage-entry.mjs';
import { publicSiteText, hosting } from '../scripts/hosting-lib.mjs';

function navigate(html, search = '', hash = '', pathname = '/', signInPage = null) {
  const result = {};
  const sessionStorage = { getItem: key => (key === 'kaito_web.oddboutSignInPage.v1' ? signInPage : null) };
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
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], { location, history, URLSearchParams, sessionStorage });
  return result;
}

test('homepage is served directly, with language and public anchors preserved', () => {
  const body = '<main id="main"><h1>ODDBOUT</h1><a href="./fighter.html">PLAY</a></main>';
  const entries = homepageEntries('<html><head><title>ODDBOUT</title></head><body>' + body + '</body></html>');
  assert.ok(entries['index.html'].includes(body));
  assert.deepEqual(navigate(entries['index.html']), {});
  assert.deepEqual(navigate(entries['index.html'], '?utm_source=instagram&utm_campaign=launch'), {});
  assert.deepEqual(navigate(entries['index.html'], '', '', '/index.html'), { address: './' });
  for (const hash of ['', '#main', '#featured', '#cup', '#faq', '#fighters', '#match', '#join']) {
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

test('the entry script follows the charset declaration, which stays in the first 1024 bytes', () => {
  const head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width">';
  const entries = homepageEntries('<!doctype html><html><head>' + head + '<title>ODDBOUT</title></head><body><main id="main"></main></body></html>');
  const html = entries['index.html'];
  assert.ok(html.indexOf('<meta charset="utf-8">') < 1024);
  assert.ok(html.indexOf('<script>') > html.indexOf('<meta charset="utf-8">'));
  assert.equal(navigate(html, '', '#faq').redirect, undefined);
});

test('a sign-in the home started finishes on the home; any other sign-in answer still goes to the creator page', () => {
  const entries = homepageEntries('<html><head><title>ODDBOUT</title></head><body><main id="main"></main></body></html>');
  for (const search of ['?code=oauth', '?error=access_denied&error_description=no', '?lang=en&code=oauth']) {
    assert.deepEqual(navigate(entries['index.html'], search, '', '/', '/'), {});
    assert.equal(navigate(entries['index.html'], search, '', '/', '/creator.html').redirect, './creator.html' + search);
    assert.equal(navigate(entries['index.html'], search, '', '/', null).redirect, './creator.html' + search);
  }
  // A creator hand-off (apply) and creator hash routes go on whatever the tab recorded.
  assert.equal(navigate(entries['index.html'], '?apply=founding-league&code=oauth', '', '/', '/').redirect, './creator.html?apply=founding-league&code=oauth');
  assert.equal(navigate(entries['index.html'], '', '#view=rankings', '/', '/').redirect, './creator.html#view=rankings');
  // No sessionStorage (blocked): the old behaviour.
  const blocked = {};
  runInNewContext(entries['index.html'].match(/<script>([\s\S]*?)<\/script>/)[1], {
    location: { pathname: '/', search: '?code=oauth', hash: '', replace: value => { blocked.redirect = value; } },
    history: { replaceState: () => {} }, URLSearchParams,
    sessionStorage: { getItem: () => { throw new Error('blocked'); } },
  });
  assert.equal(blocked.redirect, './creator.html?code=oauth');
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
