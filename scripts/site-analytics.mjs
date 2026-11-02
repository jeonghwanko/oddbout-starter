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

/** @param {string} measurementId @param {string} hostname @param {string | null} apiBase @param {string[]} updateSlugs */
function startAnalytics(measurementId, hostname, apiBase, updateSlugs) {
  if (window.location.hostname !== hostname || window.location.protocol !== 'https:' ||
      window.location.pathname.endsWith('/admin.html') || window.oddboutAnalyticsStarted) return;
  const current = new URL(window.location.href);
  const fragment = new URLSearchParams(current.hash.slice(1));
  const privateKeys = ['code', 'state', 'handoff', 'dot', 'token', 'access_token', 'refresh_token', 'id_token', 'error_description'];
  if (privateKeys.some(key => current.searchParams.has(key) || fragment.has(key))) return;
  const campaign = new URLSearchParams();
  for (const key of ['utm_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    const value = current.searchParams.get(key);
    if (value && value.length <= 100 && !value.includes('@')) campaign.set(key, value);
  }
  current.search = campaign.toString(); current.hash = '';
  if (/\/(?:index|league)\.html$/.test(current.pathname)) current.pathname = current.pathname.replace(/[^/]+$/, '');
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
        const get = field => new Promise(resolve => {
          const timer = setTimeout(() => resolve(null), 2500);
          window.gtag('get', measurementId, field, value => { clearTimeout(timer); resolve(value); });
        });
        const [clientId, sessionId] = await Promise.all([get('client_id'), get('session_id')]);
        if (!/^\d{1,20}\.\d{1,20}$/.test(clientId ?? '') || !/^\d{1,20}$/.test(String(sessionId ?? '')) || !permitted()) return;
        body = { enabled: true, clientId, sessionId: String(sessionId) };
      }
      await fetch(apiBase + '/analytics/context', { method: 'POST', credentials: 'omit', redirect: 'error', keepalive: true,
        headers: { authorization: 'Bearer ' + token, apikey: key, 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(3000) });
    } catch { /* Measurement does not affect sign-in or creation. */ }
  };
  if (!permitted()) {
    window.dispatchEvent(new CustomEvent('oddbout:analytics-ready'));
    return;
  }
  window.oddboutAnalyticsStarted = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  const page = { page_location: current.href, page_referrer: referrer };
  window.gtag('js', new Date());
  window.gtag('set', { ...page, allow_google_signals: false, allow_ad_personalization_signals: false });
  window.gtag('config', measurementId, { ...page, send_page_view: false,
    allow_google_signals: false, allow_ad_personalization_signals: false });
  window.addEventListener('oddbout:milestone', event => {
    if (!permitted()) return;
    const { name, parameters = {} } = event.detail ?? {};
    // 첫 선수 무료 (2026-10-30): the hosted request, the entry and the wish for one more fighter (the finished motions are counted from the
    // database, measure-export's freeFunnel).
    if (!['game_start', 'match_complete', 'creation_start', 'hosted_request', 'fighter_entered', 'extra_generation_interest'].includes(name)) return;
    /** @type {Record<string, string>} */
    const safe = { ...page, send_to: measurementId };
    if (['play', 'watch', 'tournament', 'exhibition'].includes(parameters.mode)) safe.mode = parameters.mode;
    if (['ko', 'decision', 'forfeit', 'timeout', 'win', 'loss'].includes(parameters.result)) safe.result = parameters.result;
    if (name === 'creation_start') safe.method = 'request_copy';
    // The request's two choices as yes or no; nothing the creator wrote.
    if (name === 'hosted_request') { safe.delegate = parameters.delegate === true ? 'yes' : 'no'; safe.queued = parameters.queued === true ? 'yes' : 'no'; }
    window.gtag('event', name, safe);
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
    document.addEventListener('toggle', event => {
      if (!(event.target instanceof HTMLDetailsElement) || !event.target.open || !document.body.contains(event.target)) return;
      const slug = slugFor(event.target);
      if (!slug || opened.has(slug) || !permitted()) return;
      opened.add(slug);
      send('update_open', { slug });
    }, true);
  }
  window.dispatchEvent(new CustomEvent('oddbout:analytics-ready'));
  window.gtag('event', 'page_view', { ...page, page_title: document.title });
  const script = document.createElement('script');
  script.async = true; script.referrerPolicy = 'no-referrer';
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
  document.head.append(script);
}

/** @param {string} measurementId @param {string} siteUrl @param {string | null} [apiBase] @param {string[]} [updateSlugs] */
export function analyticsSource(measurementId, siteUrl, apiBase = null, updateSlugs = []) {
  if (!/^G-[A-Z0-9]{6,20}$/.test(measurementId ?? '')) throw new Error('Invalid GA4 measurement ID');
  const site = new URL(siteUrl);
  if (site.protocol !== 'https:') throw new Error('Analytics requires the HTTPS public site');
  if (updateSlugs.some(slug => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))) throw new Error('Invalid update Analytics slug');
  return `(${startAnalytics.toString()})(${JSON.stringify(measurementId)}, ${JSON.stringify(site.hostname)}, ${JSON.stringify(apiBase)}, ${JSON.stringify(updateSlugs)});`;
}

/** @param {string} html @param {boolean} [privacy] */
export function analyticsHtml(html, privacy = false) {
  if (privacy) {
    const anchor = '<h3>Technical information</h3>';
    if (!html.includes(anchor)) throw new Error('Review the analytics privacy notice after source changes');
    html = html.replace(anchor, '<h3>Website analytics</h3><p>We use Google Analytics to measure visits, page views, game starts, match completions, copying a creation request and interactions with updates pages. For visitors who allow Analytics and sign in, we link the Analytics browser identifier to their account within our backend so that a successful server-validated fighter registration can be counted. This link is retained for at most 30 days and is not sent to Google as an account identifier. Google Analytics uses cookies and browser or device information to produce usage reports. We do not send account emails, sign-in tokens, fighter uploads or account identifiers to Analytics. Our tag keeps only standard campaign tags in page addresses, excludes other query parameters and URL fragments, and reduces referral addresses to website origins. Advertising personalization and Google signals are disabled. <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">How Google uses information from sites that use its services ↗</a></p>' + anchor)
      .replace('<strong>Google</strong> — account sign-in.', '<strong>Google</strong> — account sign-in and website usage analytics.')
      .replace('Google may use its own cookies during sign-in.', 'Google may use its own cookies during sign-in and for Analytics. You can block Analytics with browser privacy tools or the <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer">Google Analytics opt-out browser add-on</a>. Our tag also respects Global Privacy Control.');
  }
  if (!html.includes('</head>')) throw new Error('Missing HTML head');
  return html.replace('</head>', `<script type="module">import ${JSON.stringify(virtualId)};</script>\n</head>`);
}

/** @param {string | undefined} measurementId @param {string} siteUrl @param {string | null} [apiBase] @returns {SitePlugin | null} */
export function googleAnalyticsPlugin(measurementId, siteUrl, apiBase = null) {
  if (!measurementId) return null;
  const source = analyticsSource(measurementId, siteUrl, apiBase);
  return {
    name: 'oddbout-google-analytics',
    resolveId(id) { if (id === virtualId) return resolvedId; },
    load(id) { if (id === resolvedId) return source; },
    transformIndexHtml: { order: 'pre', handler(html, context) {
      // This page only chooses a language. Its destination sends the single page view.
      if (context.filename.replaceAll('\\', '/').endsWith('/updates.html')) return html;
      return analyticsHtml(html, context.filename.replaceAll('\\', '/').endsWith('/privacy.html'));
    } },
  };
}
