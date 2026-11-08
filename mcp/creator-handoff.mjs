// @ts-check
/** The public AI Fighter creator homepage on free GitHub Pages. */
export const PUBLIC_CREATOR_PAGE = 'https://oddbout.com/creator.html';
const LEGACY_CREATOR_PAGES = new Set([
  'https://rupin.pryzm.gg/creator.html',
  'https://jeonghwanko.github.io/ai-fighter-dots-starter/creator.html', // the repository's name before it became oddbout-starter
  'https://jeonghwanko.github.io/oddbout-starter/creator.html',
]);

/** The page a link opens: the public homepage, or a loopback HTTP homepage for local development. */
export function creatorPage(value = PUBLIC_CREATOR_PAGE) {
  const url = new URL(value);
  // Upgrade saved pre-migration settings before attaching a sign-in token.
  if (LEGACY_CREATOR_PAGES.has(url.href)) return creatorPage(PUBLIC_CREATOR_PAGE);
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  const allowed = loopback ? url.pathname === '/creator.html' : url.href === PUBLIC_CREATOR_PAGE;
  if (!allowed || url.username || url.password || url.search || url.hash) throw new Error('creator-page-not-allowed');
  return { origin: url.origin, href: url.href };
}
