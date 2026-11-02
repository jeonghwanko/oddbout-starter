import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { analyticsSource, analyticsHtml, googleAnalyticsPlugin } from '../scripts/site-analytics.mjs';

function visit(href, { gpc = false, referrer = 'https://example.com/path?email=private#secret', apiBase = null, updates = false, lang = 'ko', slugs = [] } = {}) {
  const listeners = new Map(), scripts = [], location = new URL(href), window = { location,
    addEventListener: (name, fn) => listeners.set(name, fn), dispatchEvent: event => listeners.get(event.type)?.(event) };
  class Element {
    constructor(attributes = {}, parent = null) { this.attributes = attributes; this.parent = parent; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    hasAttribute(key) { return Object.hasOwn(this.attributes, key); }
    closest(selector) { const key = selector.slice(1, -1); return this.hasAttribute(key) ? this : this.parent?.closest(selector) ?? null; }
    contains(target) { return target === this || !!target?.parent && this.contains(target.parent); }
  }
  class HTMLDetailsElement extends Element { open = false; }
  const body = new Element(updates ? { 'data-oddbout-updates': '' } : {}), documentListeners = new Map();
  const document = { referrer, title: 'ODDBOUT', body, documentElement: { lang }, createElement: () => ({}), head: { append: script => scripts.push(script) },
    addEventListener: (name, fn) => documentListeners.set(name, fn) };
  const requests = [];
  const context = { window, document, Element, HTMLDetailsElement, setTimeout, clearTimeout, AbortSignal, fetch: async (url, init) => { requests.push({url, ...init}); return {ok:true}; }, navigator: { globalPrivacyControl: gpc }, URL, URLSearchParams, CustomEvent: class { constructor(type, fields = {}) { this.type = type; Object.assign(this, fields); } } };
  const source = analyticsSource('G-ABC123DEF4', 'https://oddbout.com/creator.html', apiBase, slugs);
  return { window, scripts, requests, body, Element, HTMLDetailsElement, fire: (name, target) => documentListeners.get(name)?.({ target }), run: () => runInNewContext(source, context) };
}

test('production visits send one pageview with sanitized addresses and no advertising signals', () => {
  const page = visit('https://oddbout.com/league.html?lang=ko&email=private#fighters');
  page.run(); page.run();
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

test('campaign attribution is retained while unrelated query values are removed', () => {
  const page = visit('https://oddbout.com/?utm_source=instagram&utm_medium=social&utm_campaign=launch&email=private#fighters');
  page.run();
  const view = page.window.dataLayer.map(args => Array.from(args)).find(args => args[0] === 'event');
  assert.equal(view[2].page_location, 'https://oddbout.com/?utm_source=instagram&utm_medium=social&utm_campaign=launch');
});

test('all profile campaign values survive exactly while sign-in tokens prevent tracking', () => {
  for (const platform of ['youtube', 'x', 'threads', 'instagram', 'tiktok']) {
    const page = visit(`https://oddbout.com/updates.en.html?utm_source=${platform}&utm_medium=social&utm_campaign=profile&email=private@example.com#private`, { updates: true, lang: 'en' });
    page.run();
    const view = page.window.dataLayer.map(args => Array.from(args)).find(args => args[1] === 'page_view');
    assert.equal(view[2].page_location, `https://oddbout.com/updates.en.html?utm_source=${platform}&utm_medium=social&utm_campaign=profile`);
    assert.equal(view[2].page_referrer, 'https://example.com/');
    assert.ok(!JSON.stringify(page.window.dataLayer).includes('private'));
  }
  for (const suffix of ['?token=private', '#access_token=private']) {
    const page = visit('https://oddbout.com/updates.ko.html' + suffix, { updates: true });
    page.run(); page.fire('click', new page.Element({ 'data-analytics-action': 'start' }, page.body));
    assert.equal(page.scripts.length, 0); assert.equal(page.window.dataLayer, undefined);
  }
});

test('updates clicks and entry opens emit only scoped, allowlisted fields without changing navigation', () => {
  const slug = '2026-11-03-vice-arrives';
  const page = visit('https://oddbout.com/updates.en.html?utm_source=x&utm_medium=social&utm_campaign=profile&email=private#private', { updates: true, lang: 'en', slugs: [slug] });
  page.run(); page.run();
  const click = (action, attributes = {}, parent = page.body) => {
    const anchor = new page.Element({ 'data-analytics-action': action, href: 'https://private.example/?token=secret', 'data-email': 'private', ...attributes }, parent);
    page.fire('click', new page.Element({}, anchor)); // click a nested label, as real links do
  };
  click('start'); click('world'); click('read_update', { 'data-update-slug': slug });
  click('social', { 'data-social-platform': 'youtube' });
  click('social', { 'data-social-platform': 'private' }); click('private');
  click('read_update', { 'data-update-slug': 'private' }); click('start', {}, null);
  const details = new page.HTMLDetailsElement({ 'data-update-slug': slug }, page.body);
  details.open = true; page.fire('toggle', details);
  details.open = false; page.fire('toggle', details);
  details.open = true; page.fire('toggle', details);
  const events = page.window.dataLayer.map(args => Array.from(args)).filter(args => args[0] === 'event');
  assert.deepEqual(Array.from(events, args => args[1]), ['page_view', 'landing_start_click', 'world_link_click', 'update_detail_click', 'social_link_click', 'update_open']);
  for (const [, name, parameters] of events.slice(1)) {
    assert.equal(parameters.lang, 'en');
    assert.equal(parameters.page_location, 'https://oddbout.com/updates.en.html?utm_source=x&utm_medium=social&utm_campaign=profile');
    assert.equal(parameters.page_referrer, 'https://example.com/');
    assert.deepEqual(Object.keys(parameters).sort(), ['lang', 'page_location', 'page_referrer', 'send_to', ...(name === 'social_link_click' ? ['platform'] : name.startsWith('update_') ? ['slug'] : [])].sort());
  }
  assert.ok(!JSON.stringify(events).includes('private'));
  page.window['ga-disable-G-ABC123DEF4'] = true; click('start');
  assert.equal(page.window.dataLayer.length, events.length + 3);
});

test('updates listeners stay off ordinary pages, opted-out visits and unsupported languages', () => {
  for (const options of [{}, { updates: true, gpc: true }, { updates: true, lang: 'private' }]) {
    const page = visit('https://oddbout.com/updates.ko.html', options); page.run();
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
  for (const href of ['http://127.0.0.1:5198/', 'https://other.example/', 'http://oddbout.com/',
    'https://oddbout.com/admin.html', 'https://oddbout.com/creator.html?code=secret',
    'https://oddbout.com/creator.html#handoff=secret', 'https://oddbout.com/creator.html#dot=secret&port=1234']) {
    const page = visit(href); page.run(); assert.equal(page.scripts.length, 0, href);
  }
  const optedOut = visit('https://oddbout.com/', { gpc: true }); optedOut.run(); assert.equal(optedOut.scripts.length, 0);
  assert.throws(() => analyticsSource('bad-id', 'https://oddbout.com/'), /measurement ID/);
});

test('Analytics is included through the build graph and the privacy page explains its use', () => {
  const html = '<html><head></head><body><h3>Technical information</h3><strong>Google</strong> — account sign-in. Google may use its own cookies during sign-in.</body></html>';
  const tagged = analyticsHtml(html, true);
  assert.ok(tagged.includes('import "virtual:oddbout-analytics"'));
  assert.ok(tagged.includes('Website analytics'));
  assert.ok(tagged.includes('website usage analytics'));
  assert.ok(tagged.includes('Google Analytics opt-out'));
  assert.throws(() => analyticsHtml('<head></head>', true), /privacy notice/);
});

test('milestones discard personal parameters and never allow browser registration success events', () => {
 const page=visit('https://oddbout.com/fighter.html');page.run();
 const fire=(name,parameters)=>page.window.dispatchEvent({type:'oddbout:milestone',detail:{name,parameters}});
 fire('game_start',{mode:'play',email:'private@email.example',fighterId:'private-id'});
 fire('match_complete',{result:'ko',token:'private-token'});fire('creation_start',{method:'private-text'});
 fire('character_registered',{});
 fire('hosted_request',{delegate:true,queued:'private-text',description:'private words'});fire('hosted_ready',{name:'private-name'});// not forwarded
 fire('fighter_entered',{fighterId:'private-id'});fire('extra_generation_interest',{});
 const events=page.window.dataLayer.map(args=>Array.from(args)).filter(args=>args[0]==='event');
 assert.deepEqual(Array.from(events,args=>args[1]),['page_view','game_start','match_complete','creation_start','hosted_request','fighter_entered','extra_generation_interest']);
 const hosted=events.find(args=>args[1]==='hosted_request')[2];
 assert.equal(hosted.delegate,'yes'); assert.equal(hosted.queued,'no');
 assert.ok(!JSON.stringify(events).includes('private'));
});

test('authenticated binding sends actual tag identifiers only to the configured API and opt-out deletes the link', async () => {
 const apiBase='https://backend.example/functions/v1/ai-fighter';
 const page=visit('https://oddbout.com/creator.html',{apiBase}); page.run();
 page.window.gtag=(command,id,field,done)=>done(field==='client_id'?'12345.67890':1729600000);
 await page.window.oddboutBindAnalytics('https://untrusted.example','existing-auth-token','publishable-key');
 assert.equal(page.requests.length,0);
 await page.window.oddboutBindAnalytics(apiBase,'existing-auth-token','publishable-key');
 assert.equal(page.requests.length,1);
 assert.equal(page.requests[0].url,apiBase+'/analytics/context');
 assert.deepEqual(JSON.parse(page.requests[0].body),{enabled:true,clientId:'12345.67890',sessionId:'1729600000'});
 assert.equal(page.requests[0].headers.authorization,'Bearer existing-auth-token');
 const opted=visit('https://oddbout.com/creator.html',{apiBase,gpc:true});opted.run();
 await opted.window.oddboutBindAnalytics(apiBase,'existing-auth-token','publishable-key');
 assert.deepEqual(JSON.parse(opted.requests[0].body),{enabled:false});
 assert.equal(opted.scripts.length,0);
});
