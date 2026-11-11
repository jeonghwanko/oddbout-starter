// @ts-check
// Explicit public build settings. An absent configuration always ships the embed disabled.
// No runtime secrets or inferred ChatGPT sandbox origins belong in this file.
export const CHATGPT_GAME_ENTRY = 'embed/chatgpt/index.html';

/** @param {unknown} value @param {string} label */
function origins(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new Error(`Invalid ${label}`);
  return [
    ...new Set(
      value.map(item => {
        if (typeof item !== 'string') throw new Error(`Invalid ${label}`);
        const url = new URL(item);
        if (url.protocol !== 'https:' || item !== url.origin || item.includes('*')) throw new Error(`Invalid ${label}`);
        return item;
      }),
    ),
  ];
}

/**
 * @param {{ enabled?: boolean, apiBase?: string, parentOrigins?: string[], ancestorOrigins?: string[] } | undefined} value
 * @returns {{ enabled: boolean, define: Record<string, string>, headers: string }}
 */
export function chatGptEmbedBuild(value) {
  const enabled = value?.enabled === true;
  let apiBase = '',
    parents = /** @type {string[]} */ ([]),
    ancestors = /** @type {string[]} */ ([]);
  if (enabled) {
    parents = origins(value.parentOrigins, 'ChatGPT parent origins');
    ancestors = origins(value.ancestorOrigins, 'ChatGPT ancestor origins');
    if (parents.some(origin => !ancestors.includes(origin))) throw new Error('Every parent origin must also be a permitted ancestor');
    const api = new URL(value.apiBase ?? '');
    if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash || api.href.includes('*'))
      throw new Error('Invalid ChatGPT API base');
    apiBase = api.href.replace(/\/$/, '');
  }
  const policy = `frame-ancestors ${enabled ? ancestors.join(' ') : "'none'"}; object-src 'none'; base-uri 'self'`;
  // Cloudflare Pages matches the canonical directory and index document; the normal web policy is untouched.
  // See https://developers.cloudflare.com/pages/configuration/headers/ (header detachment syntax).
  const headers = ['/embed/chatgpt', '/embed/chatgpt/*']
    .map(
      path =>
        `${path}\n` +
        `  Content-Security-Policy: ${policy}\n` +
        (enabled ? '  ! X-Frame-Options\n' : '  X-Frame-Options: DENY\n') +
        '  Cache-Control: no-store\n  Referrer-Policy: no-referrer\n  X-Robots-Tag: noindex, nofollow\n',
    )
    .join('\n');
  return {
    enabled,
    headers,
    define: {
      'import.meta.env.VITE_CHATGPT_EMBED_ENABLED': JSON.stringify(String(enabled)),
      'import.meta.env.VITE_CHATGPT_EMBED_API_BASE': JSON.stringify(apiBase),
      'import.meta.env.VITE_CHATGPT_EMBED_PARENT_ORIGINS': JSON.stringify(JSON.stringify(parents)),
    },
  };
}
