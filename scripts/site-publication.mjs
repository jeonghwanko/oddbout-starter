// @ts-check
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { requestPagesPublication } from './pages-publication.mjs';

const keys = ['ODDBOUT_SITE_PROVIDER', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'ODDBOUT_CLOUDFLARE_PROJECT', 'ODDBOUT_CLOUDFLARE_BRANCH'];
/** Load only deployment settings, never the application's public/build environment. Existing shell values win.
 * @param {NodeJS.ProcessEnv} [env] @param {string} [file] */
export async function loadPublicationEnvironment(env = process.env, file = env.ODDBOUT_DEPLOY_ENV_FILE ?? fileURLToPath(new URL('../.env', import.meta.url))) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (/** @type {any} */ error) {
    if (error.code === 'ENOENT' && !env.ODDBOUT_DEPLOY_ENV_FILE) return;
    throw error;
  }
  const values = parseEnv(text);
  for (const key of keys) if (env[key] === undefined && values[key] !== undefined) env[key] = values[key];
}
/** @param {NodeJS.ProcessEnv} [env] */
export function publicationConfig(env = process.env) {
  const provider = env.ODDBOUT_SITE_PROVIDER ?? 'github-pages';
  if (!['github-pages', 'cloudflare-pages'].includes(provider)) throw Error('Unsupported ODDBOUT_SITE_PROVIDER');
  const project = env.ODDBOUT_CLOUDFLARE_PROJECT ?? '';
  const account = env.CLOUDFLARE_ACCOUNT_ID ?? '';
  const branch = env.ODDBOUT_CLOUDFLARE_BRANCH ?? 'main';
  if (
    provider === 'cloudflare-pages' &&
    (!/^[a-f0-9]{32}$/.test(account) || !/^[a-z0-9][a-z0-9-]{0,57}[a-z0-9]$/.test(project) || !/^[a-zA-Z0-9/_-]+$/.test(branch))
  ) {
    throw Error('Cloudflare requires CLOUDFLARE_ACCOUNT_ID, ODDBOUT_CLOUDFLARE_PROJECT and a valid production branch');
  }
  return { provider, project, account, branch };
}

/** Follow only Cloudflare's documented same-origin HTML canonicalization. All other redirects remain errors.
 * @param {typeof fetch} [request] @returns {typeof fetch} */
export function cloudflareFetch(request = fetch) {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const response = await request(input, { ...init, redirect: 'manual' });
    if (![301, 302, 307, 308].includes(response.status)) return response;
    const target = new URL(response.headers.get('location') ?? '', url);
    const canonical = url.pathname.endsWith('/index.html') ? url.pathname.slice(0, -10) : url.pathname.replace(/\.html$/, '');
    await response.body?.cancel();
    if (!url.pathname.endsWith('.html') || target.origin !== url.origin || target.pathname !== canonical || target.search !== url.search) {
      throw Error('Unexpected published asset redirect');
    }
    return request(target, { ...init, redirect: 'error' });
  };
}

/** @returns {typeof fetch} */
export function publicationFetch() {
  return publicationConfig().provider === 'cloudflare-pages' ? cloudflareFetch() : fetch;
}

/** Publish the current verified Git tree, preserving the existing GitHub route by default.
 * @param {string} sha @param {{preview?: boolean}} [options] */
export async function requestSitePublication(sha, options = {}) {
  await loadPublicationEnvironment();
  const config = publicationConfig();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('Site publication requires a full commit SHA');
  if (config.provider === 'github-pages') {
    if (options.preview) throw Error('Preview requires cloudflare-pages');
    requestPagesPublication(sha);
    return;
  }
  const { publishCloudflare } = await import('./cloudflare-publication.mjs');
  return publishCloudflare(sha, config, options);
}
