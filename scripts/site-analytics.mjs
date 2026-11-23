// @ts-check
/// <reference path="./site-globals.d.ts" />
const virtualId = 'virtual:oddbout-analytics';
const resolvedId = '\0oddbout-analytics';

/**
 * The Vite plugin hooks the site build uses (also site-milestones.mjs and site-social.mjs).
 * @typedef {{ name: string, enforce?: 'pre', configResolved?: (config: { root: string }) => void,
 *   resolveId?: (id: string) => string | undefined, load?: (id: string) => string | undefined,
 *   transform?: (code: string, id: string) => string | null,
 *   transformIndexHtml?: { order: 'pre', handler: (html: string, context: { filename: string }) => string } }} SitePlugin
 */

/**
 * @param {string} measurementId @param {string} hostname @param {string | null} apiBase @param {string[]} updateSlugs
 * @param {string | null} game A game site's game (`forge` on forge.oddbout.com) whose entry page is its home; null on the ODDBOUT site and on a game site with an intro home (bounce).
 */
function startAnalytics(measurementId, hostname, apiBase, updateSlugs, game) {
  if (
    window.location.hostname !== hostname ||
    window.location.protocol !== 'https:' ||
    /\/admin(?:\.html|\/(?:index\.html)?)?$/.test(window.location.pathname) ||
    window.oddboutAnalyticsStarted
  )
    return;
  const current = new URL(window.location.href);
  const fragment = new URLSearchParams(current.hash.slice(1));
  const privateKeys = ['code', 'state', 'handoff', 'dot', 'token', 'access_token', 'refresh_token', 'id_token', 'error_description'];
  const followerCup = hostname === 'life.oddbout.com' && ['/meme/', '/meme/life-cup.html'].includes(current.pathname);
  if (privateKeys.some(key => current.searchParams.has(key) || fragment.has(key))) {
    if (followerCup)
      window.addEventListener(
        'oddbout:follower-cup-auth-ready',
        () => {
          startAnalytics(measurementId, hostname, apiBase, updateSlugs, game);
        },
        { once: true },
      );
    return;
  }
  const campaign = new URLSearchParams();
  for (const key of ['utm_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    const value = current.searchParams.get(key);
    if (value && value.length <= 100 && !value.includes('@')) campaign.set(key, value);
  }
  current.search = campaign.toString();
  current.hash = '';
  if (/\/(?:index|league)\.html$/.test(current.pathname)) current.pathname = current.pathname.replace(/[^/]+$/, '');
  // A game site serves its game at / and at its entry page (/forge.html, clean /forge): one page, reported as /.
  if (game && ['/' + game, '/' + game + '.html'].includes(current.pathname)) current.pathname = '/';
  let referrer = '';
  try {
    const source = new URL(document.referrer);
    if (['http:', 'https:'].includes(source.protocol)) referrer = source.origin + '/';
  } catch {}
  const permitted = () => navigator.globalPrivacyControl !== true && !window[/** @type {`ga-disable-${string}`} */ ('ga-disable-' + measurementId)];
  window.oddboutBindAnalytics = async (api, token, key) => {
    if (!apiBase || api !== apiBase || typeof token !== 'string') return;
    try {
      /** @type {{ enabled: boolean, clientId?: string, sessionId?: string }} */
      let body = { enabled: false };
      if (permitted()) {
        /** @type {(field: string) => Promise<any>} */
        const get = field =>
          new Promise(resolve => {
            const timer = setTimeout(() => resolve(null), 2500);
            window.gtag('get', measurementId, field, value => {
              clearTimeout(timer);
              resolve(value);
            });
          });
        const [clientId, sessionId] = await Promise.all([get('client_id'), get('session_id')]);
        if (!/^\d{1,20}\.\d{1,20}$/.test(clientId ?? '') || !/^\d{1,20}$/.test(String(sessionId ?? '')) || !permitted()) return;
        body = { enabled: true, clientId, sessionId: String(sessionId) };
      }
      await fetch(apiBase + '/analytics/context', {
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        keepalive: true,
        headers: { authorization: 'Bearer ' + token, apikey: key, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      /* Measurement does not affect sign-in or creation. */
    }
  };
  if (!permitted()) {
    window.dispatchEvent(new CustomEvent('oddbout:analytics-ready'));
    return;
  }
  window.oddboutAnalyticsStarted = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  const page = { page_location: current.href, page_referrer: referrer };
  window.gtag('js', new Date());
  window.gtag('set', { ...page, allow_google_signals: false, allow_ad_personalization_signals: false });
  window.gtag('config', measurementId, { ...page, send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
  window.addEventListener('oddbout:milestone', event => {
    if (!permitted()) return;
    const { name, parameters = {} } = event.detail ?? {};
    if (followerCup && ['follower_cup_draw_click', 'follower_cup_x_connected', 'follower_cup_start'].includes(name)) {
      window.gtag('event', name, { ...page, send_to: measurementId });
      return;
    }
    // 첫 선수 무료 (2026-10-30): the hosted request, the entry and the wish for one more fighter (the finished motions are counted from the
    // database, measure-export's freeFunnel).
    const club = {
      club_opening_start: {},
      club_opening_knock: {},
      club_opening_end: { via: ['play', 'skip'] },
      club_trial_end: { result: ['win', 'loss'], skip: ['yes', 'no'] },
      club_contract_start: {},
      club_sign_tap: {},
      club_signup_done: { method: ['one_tap', 'button', 'redirect'] },
      club_signup_miss: { reason: ['no_client', 'in_app', 'no_gis', 'no_button', 'one_tap_miss', 'refused', 'keys'] },
      club_found: {},
      club_turf_first_end: { result: ['win', 'loss'] },
    };
    // Pudding Escape (/pudding) sends these from the game itself (`src/pudding/analytics.ts` PUDDING_EVENTS): enum values and bounded integers only.
    const puddingTips = ['uphill', 'steep', 'flat', 'caramel', 'transform', 'dive', 'charge', 'fever', 'bomb', 'speed'];
    // Themes (2026-11-23): daytime kitchen and midnight showcase. The game's list is `WORLDS` in src/sim/pudding/terrain.ts.
    const puddingWorlds = ['custard', 'showcase'];
    const puddingJellies = ['bear', 'bunny', 'worm', 'penguin', 'frog', 'cola', 'ninjacat', 'dragon', 'jellyfish', 'ghost', 'mecha'];
    const pudding = {
      pudding_run_start: { mode: ['first', 'retry'], run_number: 100000, jelly: puddingJellies, world: puddingWorlds },
      pudding_run_end: {
        distance_m: 1000000,
        duration_seconds: 86400,
        pudding_form: 14,
        result: ['new_best', 'finished'],
        run_number: 100000,
        perfects: 10000,
        splats: 10000,
        tip: puddingTips,
        world: puddingWorlds,
      },
      pudding_transform: { pudding_form: 14 },
      pudding_share: { method: ['native', 'x', 'clipboard'] },
      pudding_tutorial_done: { seconds: 86400, how: ['perfect', 'tries', 'idle'] },
      pudding_continue: { method: ['ad', 'gold'], count: 3 },
      pudding_purchase: { kind: ['look', 'item', 'card', 'unlock'], gold: 100000 },
      pudding_merge: { from: ['basic', 'rare', 'epic', 'forge'], jelly: puddingJellies, new_jelly: ['yes', 'no'] },
    };
    // Legendary Forge (/forge) sends these from the game itself: enum values and bounded integers only.
    const forge = {
      forge_start: { mode: ['first', 'return'] },
      forge_tutorial_step: { step: 4 },
      forge_tutorial_done: { seconds: 86400 },
      forge_goal_done: { goal: 50 },
      forge_delivery: { rank: ['F', 'C', 'A', 'S'], level: 999 },
      forge_level_up: { level: 999 },
      forge_unlock: { family: ['weapon', 'bow', 'armor', 'jewel'] },
      forge_board_full: {},
      forge_ad: { placement: ['energy', 'bubble', 'storage'], result: ['finished', 'error', 'free'] },
      forge_daily: { kind: ['attendance', 'request'], day: 7 },
      forge_expand: { kind: ['storage'], level: 99 },
      forge_session: { active_seconds: 86400, merges: 100000, deliveries: 100000 },
      forge_energy_empty: { level: 999, minutes: 525600 },
      forge_block_break: { kind: ['rubble', 'iron', 'star', 'pick'], open: 63 },
      forge_free_tap: { level: 999 },
      forge_restore: { chapter: 4, task: 6 },
      forge_story_skip: { chapter: 4, task: 6 },
      forge_chapter_done: { chapter: 4, minutes: 525600 },
      forge_error: { kind: ['script', 'promise', 'image', 'load', 'boot'] },
      forge_boot: { seconds: 600 },
      forge_save: { state: ['higher', 'corrupt', 'blocked', 'tablock'] },
      forge_screen: { screen: ['home', 'board', 'event'], via: ['boot', 'button', 'back', 'goal'] },
      forge_event_open: { theme: ['mine', 'forest', 'hunt', 'gem'], day: 7 },
      forge_event_step: { theme: ['mine', 'forest', 'hunt', 'gem'], step: 6, day: 7 },
      forge_event_end: { theme: ['mine', 'forest', 'hunt', 'gem'], step: 6 },
    };
    if (
      ![
        'game_start',
        'match_complete',
        'creation_start',
        'hosted_request',
        'fighter_entered',
        'extra_generation_interest',
        ...Object.keys(club),
        ...Object.keys(pudding),
        ...Object.keys(forge),
      ].includes(name)
    )
      return;
    /** @type {Record<string, string>} */
    const safe = { ...page, send_to: measurementId };
    if (Object.hasOwn(club, name)) {
      const fields = /** @type {Record<string, Record<string, string[]>>} */ (club)[name];
      for (const [key, values] of Object.entries(fields)) if (values.includes(parameters[key])) safe[key] = parameters[key];
      window.gtag('event', name, safe);
      return;
    }
    const game = Object.hasOwn(forge, name) ? 'forge' : Object.hasOwn(pudding, name) ? 'pudding' : null;
    if (game) {
      const values = /** @type {Record<string, string | number>} */ ({ ...safe, game_id: game });
      const fields = /** @type {Record<string, Record<string, string[] | number>>} */ (game === 'forge' ? forge : pudding)[name];
      for (const [key, rule] of Object.entries(fields)) {
        const value = parameters[key];
        if (Array.isArray(rule)) {
          if (rule.includes(value)) values[key] = value;
        } else if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= rule) values[key] = Math.floor(value);
      }
      // Legendary Forge's energy A/B: every forge event may carry the device's group (crashbang-heroes src/forge/analytics.ts
      // `ENERGY_TAGS`: control, c, or qa for the ?energy= switch). Nothing else passes; other games never carry it.
      if (game === 'forge' && typeof parameters.energy === 'string' && ['control', 'c', 'qa'].includes(parameters.energy)) values.energy = parameters.energy;
      window.gtag('event', name, values);
      return;
    }
    if (['play', 'watch', 'tournament', 'exhibition'].includes(parameters.mode)) safe.mode = parameters.mode;
    if (['ko', 'decision', 'forfeit', 'timeout', 'win', 'loss'].includes(parameters.result)) safe.result = parameters.result;
    if (name === 'creation_start') safe.method = 'request_copy';
    // The request's two choices as yes or no; nothing the creator wrote.
    if (name === 'hosted_request') {
      safe.delegate = parameters.delegate === true ? 'yes' : 'no';
      safe.queued = parameters.queued === true ? 'yes' : 'no';
    }
    window.gtag('event', name, safe);
  });
  // Track fixed menu identities, never link text, account data or destination query strings.
  document.addEventListener?.('click', event => {
    if (!permitted() || !(event.target instanceof Element)) return;
    const target = event.target.closest('a,button');
    if (!target || !document.body?.contains(target)) return;
    const menus = [
      'home',
      'service',
      'fighters',
      'worlds',
      'rank',
      'docs',
      'about',
      'updates',
      'contact',
      'privacy',
      'credits',
      'shop',
      'create',
      'youtube',
      'discord',
      'x',
      'threads',
      'instagram',
      'tiktok',
    ];
    let menu = target.getAttribute('data-club-link');
    if (!menus.includes(menu ?? '')) {
      const destination = target.getAttribute('href') ?? target.getAttribute('data-destination');
      if (!destination) return;
      try {
        const url = new URL(destination, document.baseURI ?? window.location.href);
        if (url.origin !== current.origin) return;
        const path = url.pathname.replace(/\/$/, '').replace(/\.html$/, '');
        const routes = {
          '': 'home',
          '/ko': 'home',
          '/ja': 'home',
          '/league': 'home',
          '/index': 'home',
          '/pudding': 'pudding',
          '/forge': 'forge',
          '/fighter': 'play',
          '/fighters': 'fighters',
          '/world': 'worlds',
          '/creator': 'create',
          '/about': 'about',
          '/docs': 'docs',
          '/updates': 'updates',
          '/shop': 'shop',
          '/service': 'service',
          '/privacy': 'privacy',
          '/credits': 'credits',
        };
        menu = /** @type {Record<string, string>} */ (routes)[path] ?? null;
      } catch {
        return;
      }
    }
    if (!menu) return;
    const link_position = target.closest('header') ? 'header' : target.closest('footer') ? 'footer' : 'content';
    window.gtag('event', 'navigation_click', { ...page, send_to: measurementId, menu_id: menu, link_position });
  });
  // The static updates pages have no application module. Read only their explicit action markers;
  // labels, arbitrary attributes and destination addresses never become event parameters.
  if (document.body?.hasAttribute('data-oddbout-updates')) {
    const lang = document.documentElement.lang;
    const opened = new Set();
    /** @param {string} name @param {Record<string, string>} [parameters] */
    const send = (name, parameters = {}) => {
      if (!permitted() || !['ko', 'en', 'ja'].includes(lang)) return;
      window.gtag('event', name, { ...page, send_to: measurementId, lang, ...parameters });
    };
    /** @param {Element} target */
    const slugFor = target => {
      const slug = target.closest('[data-update-slug]')?.getAttribute('data-update-slug');
      return slug && updateSlugs.includes(slug) ? slug : null;
    };
    document.addEventListener('click', event => {
      if (!(event.target instanceof Element)) return;
      const target = event.target.closest('[data-analytics-action]');
      if (!target || !document.body.contains(target)) return;
      const action = target.getAttribute('data-analytics-action');
      if (action === 'start') send('landing_start_click');
      if (action === 'follower_cup' || (action === 'start' && target.getAttribute('data-start-destination') === 'follower-cup')) {
        send('follower_cup_entry_click');
      }
      if (action === 'world') send('world_link_click');
      if (action === 'read_update') {
        const slug = slugFor(target);
        if (slug) send('update_detail_click', { slug });
      }
      if (action === 'social') {
        const platform = target.getAttribute('data-social-platform');
        if (platform && ['youtube', 'discord', 'x', 'threads', 'instagram', 'tiktok'].includes(platform)) send('social_link_click', { platform });
      }
    });
    document.addEventListener(
      'toggle',
      event => {
        if (!(event.target instanceof HTMLDetailsElement) || !event.target.open || !document.body.contains(event.target)) return;
        const slug = slugFor(event.target);
        if (!slug || opened.has(slug) || !permitted()) return;
        opened.add(slug);
        send('update_open', { slug });
      },
      true,
    );
  }
  window.dispatchEvent(new CustomEvent('oddbout:analytics-ready'));
  window.gtag('event', 'page_view', { ...page, page_title: document.title });
  const script = document.createElement('script');
  script.async = true;
  script.referrerPolicy = 'no-referrer';
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
  document.head.append(script);
}

/**
 * @param {string} measurementId @param {string} siteUrl @param {string | null} [apiBase] @param {string[]} [updateSlugs]
 * @param {{ game?: string | null }} [options] `game`: the game a game site serves (scripts/build-game-site.mjs); its entry page counts as /.
 */
export function analyticsSource(measurementId, siteUrl, apiBase = null, updateSlugs = [], { game = null } = {}) {
  if (!/^G-[A-Z0-9]{6,20}$/.test(measurementId ?? '')) throw new Error('Invalid GA4 measurement ID');
  const site = new URL(siteUrl);
  if (site.protocol !== 'https:') throw new Error('Analytics requires the HTTPS public site');
  if (updateSlugs.some(slug => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))) throw new Error('Invalid update Analytics slug');
  if (game !== null && !/^[a-z]+$/.test(game)) throw new Error('Invalid Analytics game');
  return `(${startAnalytics.toString()})(${JSON.stringify(measurementId)}, ${JSON.stringify(site.hostname)}, ${JSON.stringify(apiBase)}, ${JSON.stringify(updateSlugs)}, ${JSON.stringify(game)});`;
}

/** @param {string} html @param {boolean} [privacy] */
export function analyticsHtml(html, privacy = false) {
  if (privacy) {
    const anchor = '<h3>Technical information</h3>';
    if (!html.includes(anchor)) throw new Error('Review the analytics privacy notice after source changes');
    html = html
      .replace(
        anchor,
        '<h3>Website analytics</h3><p>We use Google Analytics to measure visits, page views, game starts, match completions, copying a creation request and interactions with updates pages. We also measure menu clicks, first-session game steps, and Pudding Escape runs, retries, transformations, completed shares, distance and play time. We do not collect shared text or images. For visitors who allow Analytics and sign in, we link the Analytics browser identifier to their account within our backend so that a successful server-validated fighter registration can be counted. This link is retained for at most 30 days and is not sent to Google as an account identifier. Google Analytics uses cookies and browser or device information to produce usage reports. We do not send account emails, sign-in tokens, fighter uploads or account identifiers to Analytics. Our tag keeps only standard campaign tags in page addresses, excludes other query parameters and URL fragments, and reduces referral addresses to website origins. Advertising personalization and Google signals are disabled. <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">How Google uses information from sites that use its services ↗</a></p>' +
          anchor,
      )
      .replace('<strong>Google</strong> — account sign-in.', '<strong>Google</strong> — account sign-in and website usage analytics.')
      .replace(
        'Google may use its own cookies during sign-in.',
        'Google may use its own cookies during sign-in and for Analytics. You can block Analytics with browser privacy tools or the <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer">Google Analytics opt-out browser add-on</a>. Our tag also respects Global Privacy Control.',
      );
  }
  if (!html.includes('</head>')) throw new Error('Missing HTML head');
  return html.replace('</head>', `<script type="module">import ${JSON.stringify(virtualId)};</script>\n</head>`);
}

/**
 * @param {string | undefined} measurementId @param {string} siteUrl @param {string | null} [apiBase]
 * @param {{ game?: string | null }} [options] @returns {SitePlugin | null}
 */
export function googleAnalyticsPlugin(measurementId, siteUrl, apiBase = null, { game = null } = {}) {
  if (!measurementId) return null;
  const source = analyticsSource(measurementId, siteUrl, apiBase, [], { game });
  return {
    name: 'oddbout-google-analytics',
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    load(id) {
      if (id === resolvedId) return source;
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        // This page only chooses a language. Its destination sends the single page view.
        const filename = context.filename.replaceAll('\\', '/');
        if (filename.endsWith('/updates.html') || /\/admin(?:\.html|\/index\.html)$/.test(filename)) return html;
        return analyticsHtml(html, context.filename.replaceAll('\\', '/').endsWith('/privacy.html'));
      },
    },
  };
}
