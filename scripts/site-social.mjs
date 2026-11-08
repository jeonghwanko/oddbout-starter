// @ts-check
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Public channel identity is configured once in deploy/creator-site.json.
// Newer sources draw their own brand icons from oddbout-community.json (YouTube among them): the plugin then adds nothing — no text link in
// the footer script nor in the pages' pre-mount footer HTML. Older sources keep the injected "YouTube" link.
/** @param {string | undefined} channelUrl @returns {import('./site-analytics.mjs').SitePlugin | null} */
export function youtubeChannelPlugin(channelUrl) {
  if (!channelUrl) return null;
  const url = new URL(channelUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'www.youtube.com' || !/^\/@[A-Za-z0-9_.-]+$/.test(url.pathname) || url.search || url.hash) {
    throw new Error('Expected the official public YouTube handle URL');
  }
  const href = url.href;
  let ownIcons = false;
  return {
    name: 'oddbout-youtube-channel',
    enforce: 'pre',
    configResolved(config) {
      ownIcons = sourceHasSocialIcons(config.root);
    },
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/creator/siteChrome.ts')) return null;
      if (ownIcons || code.includes('club-social')) return null;
      const anchor = 'element.append(logo, tagline, nav);';
      if (code.split(anchor).length !== 2) throw new Error('Review the ODDBOUT social footer hook');
      return code.replace(
        anchor,
        anchor +
          '\n  const youtube = document.createElement("a"); youtube.href = ' +
          JSON.stringify(href) +
          '; youtube.textContent = "YouTube"; youtube.target = "_blank"; youtube.rel = "noopener noreferrer"; nav.append(youtube);',
      );
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (ownIcons) return html;
        // Keep a usable public link in the homepage before its interactive footer mounts.
        return html.replace(
          /(<footer\b[^>]*>[\s\S]*?)(<\/nav>\s*<\/footer>)/,
          (_, content, end) => content + '<a href="' + href + '" target="_blank" rel="noopener noreferrer">YouTube</a>' + end,
        );
      },
    },
  };
}

/** The source's footer draws its own social icons (crashbang-heroes 51b594d7 onward). @param {string} root */
export function sourceHasSocialIcons(root) {
  try {
    return readFileSync(join(root, 'src', 'creator', 'siteChrome.ts'), 'utf8').includes('club-social');
  } catch {
    return false;
  }
}
