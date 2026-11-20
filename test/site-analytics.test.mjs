import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { analyticsSource, analyticsHtml, googleAnalyticsPlugin } from '../scripts/site-analytics.mjs';

function visit(
  href,
  {
    gpc = false,
    referrer = 'https://example.com/path?email=private#secret',
    apiBase = null,
    updates = false,
    lang = 'ko',
    slugs = [],
    baseURI = href,
    siteUrl = 'https://oddbout.com/creator.html',
    game = null,
  } = {},
) {
  const listeners = new Map(),
    scripts = [],
    location = new URL(href),
    window = { location, addEventListener: (name, fn) => listeners.set(name, fn), dispatchEvent: event => listeners.get(event.type)?.(event) };
  class Element {
    constructor(attributes = {}, parent = null) {
      this.attributes = attributes;
      this.parent = parent;
    }
    getAttribute(key) {
      return this.attributes[key] ?? null;
    }
    hasAttribute(key) {
      return Object.hasOwn(this.attributes, key);
    }
    closest(selector) {
      if (selector === 'a,button' && ['a', 'button'].includes(this.attributes.tag)) return this;
      if (selector === this.attributes.tag) return this;
      const key = selector.slice(1, -1);
      return this.hasAttribute(key) ? this : (this.parent?.closest(selector) ?? null);
    }
    contains(target) {
      return target === this || (!!target?.parent && this.contains(target.parent));
    }
  }
  class HTMLDetailsElement extends Element {
    open = false;
  }
  const body = new Element(updates ? { 'data-oddbout-updates': '' } : {}),
    documentListeners = new Map();
  const document = {
    baseURI,
    referrer,
    title: 'ODDBOUT',
    body,
    documentElement: { lang },
    createElement: () => ({}),
    head: { append: script => scripts.push(script) },
    addEventListener: (name, fn) => documentListeners.set(name, [...(documentListeners.get(name) ?? []), fn]),
  };
  const requests = [];
  const context = {
    window,
    document,
    Element,
    HTMLDetailsElement,
    setTimeout,
    clearTimeout,
    AbortSignal,
    fetch: async (url, init) => {
      requests.push({ url, ...init });
      return { ok: true };
    },
    navigator: { globalPrivacyControl: gpc },
    URL,
    URLSearchParams,
    CustomEvent: class {
      constructor(type, fields = {}) {
        this.type = type;
        Object.assign(this, fields);
      }
    },
  };
  const source = analyticsSource('G-ABC123DEF4', siteUrl, apiBase, slugs, { game });
  return {
    window,
    scripts,
    requests,
    body,
    Element,
    HTMLDetailsElement,
    fire: (name, target) =>
      documentListeners.get(name)?.forEach(fn => {
        fn({ target });
      }),
    run: () => runInNewContext(source, context),
  };
}

test('production visits send one pageview with sanitized addresses and no advertising signals', () => {
  const page = visit('https://oddbout.com/league.html?lang=ko&email=private#fighters');
  page.run();
  page.run();
  assert.equal(page.scripts.length, 1);
  assert.equal(page.scripts[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4');
  const calls = page.window.dataLayer.map(args => Array.from(args));
  const config = calls.find(args => args[0] === 'config')[2];
  assert.equal(config.send_page_view, false);
  assert.equal(config.allow_google_signals, false);
  assert.equal(config.allow_ad_personalization_signals, false);
  const views = calls.filter(args => args[0] === 'event' && args[1] === 'page_view');
  assert.equal(views.length, 1);
  assert.equal(views[0][2].page_location, 'https://oddbout.com/');
  assert.equal(views[0][2].page_referrer, 'https://example.com/');
  assert.ok(!JSON.stringify(calls).includes('private'));
});

test('current navigation records fixed menu and position, without text or private destinations', () => {
  const page = visit('https://oddbout.com/ko/', { baseURI: 'https://oddbout.com/' });
  page.run();
  const header = new page.Element({ tag: 'header' }, page.body);
  const anchor = new page.Element({ tag: 'a', href: './pudding?email=private' }, header);
  page.fire('click', new page.Element({}, anchor));
  page.fire('click', new page.Element({ tag: 'button', 'data-club-link': 'contact' }, page.body));
  page.fire('click', new page.Element({ tag: 'a', href: 'https://other.example/pudding' }, header));
  page.fire('click', new page.Element({ tag: 'a', href: '/unknown?token=private' }, header));
  const events = page.window.dataLayer.map(args => Array.from(args)).filter(args => args[1] === 'navigation_click');
  assert.equal(events.length, 2);
  assert.equal(events[0][2].menu_id, 'pudding');
  assert.equal(events[0][2].link_position, 'header');
  assert.equal(events[1][2].menu_id, 'contact');
  assert.equal(events[1][2].link_position, 'content');
  assert.ok(!JSON.stringify(events).includes('private'));
  page.window['ga-disable-G-ABC123DEF4'] = true;
  page.fire('click', anchor);
  assert.equal(page.window.dataLayer.map(args => Array.from(args)).filter(args => args[1] === 'navigation_click').length, 2);
});

test('pudding and club milestones preserve only bounded metrics and approved values', () => {
  const page = visit('https://oddbout.com/pudding');
  page.run();
  const emit = (name, parameters) => page.window.dispatchEvent({ type: 'oddbout:milestone', detail: { name, parameters } });
  emit('pudding_run_end', { distance_m: 123.9, duration_seconds: 45.8, pudding_form: 2, result: 'new_best', email: 'private' });
  emit('pudding_transform', { pudding_form: Infinity, distance_m: -1, duration_seconds: NaN, result: 'private' });
  emit('club_opening_end', { via: 'skip', email: 'private' });
  emit('club_signup_done', { method: 'one_tap' });
  emit('unknown', { email: 'private' });
  const events = page.window.dataLayer
    .map(args => Array.from(args))
    .filter(args => args[0] === 'event')
    .slice(1);
  assert.equal(events.length, 4);
  assert.equal(events[0][2].game_id, 'pudding');
  assert.equal(events[0][2].distance_m, 123);
  assert.equal(events[0][2].duration_seconds, 45);
  assert.equal(events[0][2].pudding_form, 2);
  assert.equal(events[1][2].pudding_form, undefined);
  assert.equal(events[1][2].distance_m, undefined);
  assert.equal(events[2][2].via, 'skip');
  assert.equal(events[3][2].method, 'one_tap');
  assert.ok(!JSON.stringify(events).includes('private'));
});

test('pudding funnel milestones keep only approved enums and bounded integers', () => {
  const page = visit('https://oddbout.com/pudding');
  page.run();
  const emit = (name, parameters) => page.window.dispatchEvent({ type: 'oddbout:milestone', detail: { name, parameters } });
  emit('pudding_run_start', { mode: 'retry', run_number: 3.7, jelly: 'ninjacat', email: 'private' });
  emit('pudding_run_end', {
    distance_m: 400,
    duration_seconds: 21,
    pudding_form: 1,
    result: 'finished',
    run_number: 3,
    perfects: 2,
    splats: -1,
    tip: 'uphill',
  });
  emit('pudding_tutorial_done', { seconds: 6.4, how: 'idle' });
  emit('pudding_continue', { method: 'gold', count: 4 });
  emit('pudding_purchase', { kind: 'look', gold: 200, note: 'private' });
  emit('pudding_purchase', { kind: 'card', gold: 1000 });
  emit('pudding_merge', { from: 'forge', jelly: 'mecha', new_jelly: 'yes', note: 'private' });
  emit('pudding_merge', { from: 'private', jelly: 'private', new_jelly: 'maybe' });
  emit('pudding_run_end', { tip: 'private' });
  emit('pudding_purchase', { kind: 'unlock', gold: 60000 });
  const events = page.window.dataLayer
    .map(args => Array.from(args))
    .filter(args => args[0] === 'event')
    .slice(1);
  assert.equal(
    JSON.stringify(events.map(e => e[1])),
    JSON.stringify([
      'pudding_run_start',
      'pudding_run_end',
      'pudding_tutorial_done',
      'pudding_continue',
      'pudding_purchase',
      'pudding_purchase',
      'pudding_merge',
      'pudding_merge',
      'pudding_run_end',
      'pudding_purchase',
    ]),
  );
  assert.ok(events.every(e => e[2].game_id === 'pudding'));
  assert.equal(events[0][2].mode, 'retry');
  assert.equal(events[0][2].run_number, 3);
  assert.equal(events[0][2].jelly, 'ninjacat');
  assert.equal(events[1][2].perfects, 2);
  assert.equal(events[1][2].splats, undefined);
  assert.equal(events[1][2].tip, 'uphill');
  assert.equal(events[2][2].seconds, 6);
  assert.equal(events[2][2].how, 'idle');
  assert.equal(events[3][2].method, 'gold');
  assert.equal(events[3][2].count, undefined);
  assert.equal(events[4][2].kind, 'look');
  assert.equal(events[4][2].gold, 200);
  assert.equal(events[5][2].kind, 'card');
  assert.equal(events[5][2].gold, 1000);
  assert.equal(events[6][2].from, 'forge');
  assert.equal(events[6][2].jelly, 'mecha');
  assert.equal(events[6][2].new_jelly, 'yes');
  assert.equal(events[7][2].from, undefined);
  assert.equal(events[7][2].jelly, undefined);
  assert.equal(events[7][2].new_jelly, undefined);
  assert.equal(events[8][2].tip, undefined);
  assert.equal(events[9][2].kind, 'unlock');
  assert.equal(events[9][2].gold, 60000);
  assert.ok(!JSON.stringify(events).includes('private'));
});

test('forge board, free-tap and restoration milestones pass their bounded values', () => {
  const page = visit('https://oddbout.com/forge');
  page.run();
  const emit = (name, parameters) => page.window.dispatchEvent({ type: 'oddbout:milestone', detail: { name, parameters } });
  emit('forge_block_break', { kind: 'iron', open: 20, note: 'private' });
  emit('forge_block_break', { kind: 'stone', open: 99 });
  emit('forge_free_tap', { level: 3 });
  emit('forge_restore', { chapter: 1, task: 2 });
  emit('forge_story_skip', { chapter: 2, task: 7 });
  emit('forge_chapter_done', { chapter: 3, minutes: 250 });
  emit('forge_energy_empty', { level: 4, minutes: 12 });
  emit('forge_expand', { kind: 'board', level: 2 });
  emit('forge_ad', { placement: 'energy', result: 'free' });
  emit('forge_error', { kind: 'image', message: 'private' });
  emit('forge_boot', { seconds: 3.6 });
  emit('forge_save', { state: 'higher' });
  const events = page.window.dataLayer
    .map(args => Array.from(args))
    .filter(args => args[0] === 'event')
    .slice(1);
  const byName = name => events.filter(e => e[1] === name).map(e => e[2]);
  assert.equal(byName('forge_block_break')[0].kind, 'iron');
  assert.equal(byName('forge_block_break')[0].open, 20);
  assert.equal(byName('forge_block_break')[1].kind, undefined);
  assert.equal(byName('forge_block_break')[1].open, undefined);
  assert.equal(byName('forge_free_tap')[0].level, 3);
  assert.equal(byName('forge_restore')[0].task, 2);
  assert.equal(byName('forge_story_skip')[0].task, undefined);
  assert.equal(byName('forge_chapter_done')[0].minutes, 250);
  assert.equal(byName('forge_energy_empty')[0].minutes, 12);
  assert.equal(byName('forge_expand')[0].kind, undefined);
  assert.equal(byName('forge_ad')[0].result, 'free');
  assert.equal(byName('forge_error')[0].kind, 'image');
  assert.equal(byName('forge_error')[0].message, undefined);
  assert.equal(byName('forge_boot')[0].seconds, 3);
  assert.equal(byName('forge_save')[0].state, 'higher');
  assert.ok(!JSON.stringify(events).includes('private'));
});

test('forge milestones keep only approved enums and bounded integers', () => {
  const page = visit('https://oddbout.com/forge');
  page.run();
  const emit = (name, parameters) => page.window.dispatchEvent({ type: 'oddbout:milestone', detail: { name, parameters } });
  emit('forge_start', { mode: 'first', email: 'private' });
  emit('forge_delivery', { rank: 'S', level: 7.9, note: 'private' });
  emit('forge_ad', { placement: 'energy', result: 'nope' });
  emit('forge_session', { active_seconds: 95.4, merges: -1, deliveries: Infinity });
  emit('forge_tutorial_step', { step: 9 });
  emit('forge_unknown', { email: 'private' });
  const events = page.window.dataLayer
    .map(args => Array.from(args))
    .filter(args => args[0] === 'event')
    .slice(1);
  assert.equal(events.length, 5);
  assert.equal(JSON.stringify(events.map(e => e[1])), JSON.stringify(['forge_start', 'forge_delivery', 'forge_ad', 'forge_session', 'forge_tutorial_step']));
  assert.equal(events[0][2].game_id, 'forge');
  assert.equal(events[0][2].mode, 'first');
  assert.equal(events[1][2].rank, 'S');
  assert.equal(events[1][2].level, 7);
  assert.equal(events[2][2].placement, 'energy');
  assert.equal(events[2][2].result, undefined);
  assert.equal(events[3][2].active_seconds, 95);
  assert.equal(events[3][2].merges, undefined);
  assert.equal(events[3][2].deliveries, undefined);
  assert.equal(events[4][2].step, undefined);
  assert.ok(!JSON.stringify(events).includes('private'));
});

test('campaign attribution is retained while unrelated query values are removed', () => {
  const page = visit('https://oddbout.com/?utm_source=instagram&utm_medium=social&utm_campaign=launch&email=private#fighters');
  page.run();
  const view = page.window.dataLayer.map(args => Array.from(args)).find(args => args[0] === 'event');
  assert.equal(view[2].page_location, 'https://oddbout.com/?utm_source=instagram&utm_medium=social&utm_campaign=launch');
});

test('all profile campaign values survive exactly while sign-in tokens prevent tracking', () => {
  for (const platform of ['youtube', 'x', 'threads', 'instagram', 'tiktok']) {
    const page = visit(`https://oddbout.com/updates.en.html?utm_source=${platform}&utm_medium=social&utm_campaign=profile&email=private@example.com#private`, {
      updates: true,
      lang: 'en',
    });
    page.run();
    const view = page.window.dataLayer.map(args => Array.from(args)).find(args => args[1] === 'page_view');
    assert.equal(view[2].page_location, `https://oddbout.com/updates.en.html?utm_source=${platform}&utm_medium=social&utm_campaign=profile`);
    assert.equal(view[2].page_referrer, 'https://example.com/');
    assert.ok(!JSON.stringify(page.window.dataLayer).includes('private'));
  }
  for (const suffix of ['?token=private', '#access_token=private']) {
    const page = visit('https://oddbout.com/updates.ko.html' + suffix, { updates: true });
    page.run();
    page.fire('click', new page.Element({ 'data-analytics-action': 'start' }, page.body));
    assert.equal(page.scripts.length, 0);
    assert.equal(page.window.dataLayer, undefined);
  }
});

test('updates clicks and entry opens emit only scoped, allowlisted fields without changing navigation', () => {
  const slug = '2026-11-03-vice-arrives';
  const page = visit('https://oddbout.com/updates.en.html?utm_source=x&utm_medium=social&utm_campaign=profile&email=private#private', {
    updates: true,
    lang: 'en',
    slugs: [slug],
  });
  page.run();
  page.run();
  const click = (action, attributes = {}, parent = page.body) => {
    const anchor = new page.Element(
      { 'data-analytics-action': action, href: 'https://private.example/?token=secret', 'data-email': 'private', ...attributes },
      parent,
    );
    page.fire('click', new page.Element({}, anchor)); // click a nested label, as real links do
  };
  click('start');
  click('start', { 'data-start-destination': 'follower-cup' });
  click('follower_cup');
  click('world');
  click('read_update', { 'data-update-slug': slug });
  click('social', { 'data-social-platform': 'youtube' });
  click('social', { 'data-social-platform': 'private' });
  click('private');
  click('read_update', { 'data-update-slug': 'private' });
  click('start', {}, null);
  const details = new page.HTMLDetailsElement({ 'data-update-slug': slug }, page.body);
  details.open = true;
  page.fire('toggle', details);
  details.open = false;
  page.fire('toggle', details);
  details.open = true;
  page.fire('toggle', details);
  const events = page.window.dataLayer.map(args => Array.from(args)).filter(args => args[0] === 'event');
  assert.deepEqual(
    Array.from(events, args => args[1]),
    [
      'page_view',
      'landing_start_click',
      'landing_start_click',
      'follower_cup_entry_click',
      'follower_cup_entry_click',
      'world_link_click',
      'update_detail_click',
      'social_link_click',
      'update_open',
    ],
  );
  for (const [, name, parameters] of events.slice(1)) {
    assert.equal(parameters.lang, 'en');
    assert.equal(parameters.page_location, 'https://oddbout.com/updates.en.html?utm_source=x&utm_medium=social&utm_campaign=profile');
    assert.equal(parameters.page_referrer, 'https://example.com/');
    assert.deepEqual(
      Object.keys(parameters).sort(),
      [
        'lang',
        'page_location',
        'page_referrer',
        'send_to',
        ...(name === 'social_link_click' ? ['platform'] : name.startsWith('update_') ? ['slug'] : []),
      ].sort(),
    );
  }
  assert.ok(!JSON.stringify(events).includes('private'));
  page.window['ga-disable-G-ABC123DEF4'] = true;
  click('start');
  assert.equal(page.window.dataLayer.length, events.length + 3);
});

test('follower cup reports milestones after the OAuth address is scrubbed and drops identifying parameters', () => {
  for (const gpc of [false, true]) {
    const page = visit('https://life.oddbout.com/meme/?code=private&followers=1&to=private', {
      siteUrl: 'https://life.oddbout.com',
      gpc,
    });
    page.run();
    assert.equal(page.scripts.length, 0);
    page.window.location.searchParams.delete('code');
    page.window.dispatchEvent({ type: 'oddbout:follower-cup-auth-ready' });
    for (const name of ['follower_cup_x_connected', 'follower_cup_start']) {
      page.window.dispatchEvent({ type: 'oddbout:milestone', detail: { name, parameters: { id: 'private' } } });
    }
    const events = (page.window.dataLayer ?? []).map(args => Array.from(args)).filter(args => args[0] === 'event');
    assert.deepEqual(
      Array.from(events, args => args[1]),
      gpc ? [] : ['page_view', 'follower_cup_x_connected', 'follower_cup_start'],
    );
    for (const [, , parameters] of events) {
      assert.equal(parameters.page_location, 'https://life.oddbout.com/meme/');
      assert.ok(!JSON.stringify(parameters).includes('private'));
    }
  }
});

test('updates listeners stay off ordinary pages, opted-out visits and unsupported languages', () => {
  for (const options of [{}, { updates: true, gpc: true }, { updates: true, lang: 'private' }]) {
    const page = visit('https://oddbout.com/updates.ko.html', options);
    page.run();
    page.fire('click', new page.Element({ 'data-analytics-action': 'start' }, page.body));
    const events = (page.window.dataLayer ?? []).map(args => Array.from(args)).filter(args => args[0] === 'event');
    assert.ok(events.every(args => args[1] === 'page_view'));
  }
});

test('neutral updates redirect bypasses the Vite Analytics transform', () => {
  const plugin = googleAnalyticsPlugin('G-ABC123DEF4', 'https://oddbout.com/');
  const html = '<html><head></head><body>Redirecting</body></html>';
  assert.equal(plugin.transformIndexHtml.handler(html, { filename: 'C:\\site\\updates.html' }), html);
  assert.match(plugin.transformIndexHtml.handler(html, { filename: '/site/creator.html' }), /virtual:oddbout-analytics/);
});

test('development, admin, privacy opt-out and incoming sign-in secrets do not load Analytics', () => {
  for (const href of [
    'http://127.0.0.1:5198/',
    'https://other.example/',
    'http://oddbout.com/',
    'https://oddbout.com/admin.html',
    'https://oddbout.com/admin/',
    'https://oddbout.com/admin',
    'https://oddbout.com/admin/index.html',
    'https://oddbout.com/creator.html?code=secret',
    'https://oddbout.com/creator.html#handoff=secret',
    'https://oddbout.com/creator.html#dot=secret&port=1234',
  ]) {
    const page = visit(href);
    page.run();
    assert.equal(page.scripts.length, 0, href);
  }
  const optedOut = visit('https://oddbout.com/', { gpc: true });
  optedOut.run();
  assert.equal(optedOut.scripts.length, 0);
  assert.throws(() => analyticsSource('bad-id', 'https://oddbout.com/'), /measurement ID/);
});

test('Analytics is included through the build graph and the privacy page explains its use', () => {
  const html =
    '<html><head></head><body><h3>Technical information</h3><strong>Google</strong> — account sign-in. Google may use its own cookies during sign-in.</body></html>';
  const tagged = analyticsHtml(html, true);
  assert.ok(tagged.includes('import "virtual:oddbout-analytics"'));
  assert.ok(tagged.includes('Website analytics'));
  assert.ok(tagged.includes('website usage analytics'));
  assert.ok(tagged.includes('Google Analytics opt-out'));
  assert.throws(() => analyticsHtml('<head></head>', true), /privacy notice/);
});

test('milestones discard personal parameters and never allow browser registration success events', () => {
  const page = visit('https://oddbout.com/fighter.html');
  page.run();
  const fire = (name, parameters) => page.window.dispatchEvent({ type: 'oddbout:milestone', detail: { name, parameters } });
  fire('game_start', { mode: 'play', email: 'private@email.example', fighterId: 'private-id' });
  fire('match_complete', { result: 'ko', token: 'private-token' });
  fire('creation_start', { method: 'private-text' });
  fire('character_registered', {});
  fire('hosted_request', { delegate: true, queued: 'private-text', description: 'private words' });
  fire('hosted_ready', { name: 'private-name' }); // not forwarded
  fire('fighter_entered', { fighterId: 'private-id' });
  fire('extra_generation_interest', {});
  const events = page.window.dataLayer.map(args => Array.from(args)).filter(args => args[0] === 'event');
  assert.deepEqual(
    Array.from(events, args => args[1]),
    ['page_view', 'game_start', 'match_complete', 'creation_start', 'hosted_request', 'fighter_entered', 'extra_generation_interest'],
  );
  const hosted = events.find(args => args[1] === 'hosted_request')[2];
  assert.equal(hosted.delegate, 'yes');
  assert.equal(hosted.queued, 'no');
  assert.ok(!JSON.stringify(events).includes('private'));
});

test('authenticated binding sends actual tag identifiers only to the configured API and opt-out deletes the link', async () => {
  const apiBase = 'https://backend.example/functions/v1/ai-fighter';
  const page = visit('https://oddbout.com/creator.html', { apiBase });
  page.run();
  page.window.gtag = (command, id, field, done) => done(field === 'client_id' ? '12345.67890' : 1729600000);
  await page.window.oddboutBindAnalytics('https://untrusted.example', 'existing-auth-token', 'publishable-key');
  assert.equal(page.requests.length, 0);
  await page.window.oddboutBindAnalytics(apiBase, 'existing-auth-token', 'publishable-key');
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].url, apiBase + '/analytics/context');
  assert.deepEqual(JSON.parse(page.requests[0].body), { enabled: true, clientId: '12345.67890', sessionId: '1729600000' });
  assert.equal(page.requests[0].headers.authorization, 'Bearer existing-auth-token');
  const opted = visit('https://oddbout.com/creator.html', { apiBase, gpc: true });
  opted.run();
  await opted.window.oddboutBindAnalytics(apiBase, 'existing-auth-token', 'publishable-key');
  assert.deepEqual(JSON.parse(opted.requests[0].body), { enabled: false });
  assert.equal(opted.scripts.length, 0);
});

test('a game site reports its entry as / and forwards its milestones without the save handoff fragment', () => {
  const site = { siteUrl: 'https://forge.oddbout.com/', game: 'forge' };
  for (const href of [
    'https://forge.oddbout.com/forge.html?utm_source=x&email=private#oddbout-import=private',
    'https://forge.oddbout.com/forge?lang=ko',
    'https://forge.oddbout.com/index.html',
    'https://forge.oddbout.com/',
  ]) {
    const page = visit(href, { ...site, referrer: 'https://oddbout.com/forge?email=private' });
    page.run();
    const view = page.window.dataLayer.map(args => Array.from(args)).find(args => args[1] === 'page_view');
    assert.equal(view[2].page_location, href.includes('utm_source') ? 'https://forge.oddbout.com/?utm_source=x' : 'https://forge.oddbout.com/', href);
    assert.equal(view[2].page_referrer, 'https://oddbout.com/');
    assert.ok(!JSON.stringify(page.window.dataLayer).includes('private'), href);
  }
  const page = visit('https://forge.oddbout.com/', site);
  page.run();
  page.window.dispatchEvent({ type: 'oddbout:milestone', detail: { name: 'forge_start', parameters: { mode: 'return' } } });
  const event = page.window.dataLayer.map(args => Array.from(args)).find(args => args[1] === 'forge_start');
  assert.equal(event[2].game_id, 'forge');
  assert.equal(event[2].mode, 'return');
  assert.equal(event[2].page_location, 'https://forge.oddbout.com/');
  const pudding = visit('https://pudding.oddbout.com/pudding.html', { siteUrl: 'https://pudding.oddbout.com/', game: 'pudding' });
  pudding.run();
  pudding.window.dispatchEvent({ type: 'oddbout:milestone', detail: { name: 'pudding_run_start', parameters: { mode: 'first' } } });
  const events = pudding.window.dataLayer.map(args => Array.from(args)).filter(args => args[0] === 'event');
  assert.equal(
    JSON.stringify(events.map(args => [args[1], args[2].page_location])),
    JSON.stringify([
      ['page_view', 'https://pudding.oddbout.com/'],
      ['pudding_run_start', 'https://pudding.oddbout.com/'],
    ]),
  );
});

test('each site measures only its own host, and the ODDBOUT site keeps /forge and /pudding as pages', () => {
  for (const [href, options] of [
    ['https://oddbout.com/forge', { siteUrl: 'https://forge.oddbout.com/', game: 'forge' }],
    ['https://pudding.oddbout.com/', { siteUrl: 'https://forge.oddbout.com/', game: 'forge' }],
    ['https://forge.oddbout.com/', {}],
  ]) {
    const page = visit(href, options);
    page.run();
    assert.equal(page.scripts.length, 0, href);
  }
  for (const path of ['/forge', '/forge.html', '/pudding']) {
    const page = visit('https://oddbout.com' + path);
    page.run();
    const view = page.window.dataLayer.map(args => Array.from(args)).find(args => args[1] === 'page_view');
    assert.equal(view[2].page_location, 'https://oddbout.com' + path);
  }
  assert.throws(() => analyticsSource('G-ABC123DEF4', 'https://forge.oddbout.com/', null, [], { game: '../forge' }), /Analytics game/);
  const plugin = googleAnalyticsPlugin('G-ABC123DEF4', 'https://forge.oddbout.com/', null, { game: 'forge' });
  assert.match(plugin.load('\0oddbout-analytics'), /"forge\.oddbout\.com", null, \[\], "forge"\);$/);
});
