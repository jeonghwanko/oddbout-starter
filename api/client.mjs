// @ts-check
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { transportCode } from './connection-errors.mjs';
import { runtimeFetch } from './runtime-fetch.mjs';
import { withFileLock } from '../mcp/file-lock.mjs';
import { renameRetrying } from '../plugins/ai-fighter/local-files.mjs';
/**
 * @typedef {{ method?: string, body?: any, headers?: Record<string, string>, timeoutMs?: number }} RequestOptions
 * @typedef {{ request: (route: string, options?: RequestOptions) => Promise<any> }} RemoteClient  `request` resolves to the API's JSON object; callers check its fields.
 */

/** @param {unknown} url */
export function validProjectUrl(url) {
  return typeof url === 'string' && /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url);
}
/** 30 s plus one second per 64 KiB: a 4 MB asset still finishes on a ~0.5 Mbit/s link. */
/** @type {(bytes: number) => number} */
export const transferTimeoutMs = bytes => 30000 + Math.ceil(Math.max(0, bytes || 0) / 65536) * 1000;
/** @type {(body: string | { byteLength?: number } | null | undefined) => number} */
const bodyBytes = body => body == null ? 0 : typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength ?? 0;

/**
 * @param {string} url @param {string} token @param {string} route
 * @param {RequestOptions} [options]
 */
export async function apiRequest(url, token, route, { method = 'GET', body, headers = {}, timeoutMs = transferTimeoutMs(bodyBytes(body)) } = {}) {
  let response;
  try { response = await runtimeFetch(`${url}/functions/v1/ai-fighter/${route}`, { method, body, headers: { authorization: `Bearer ${token}`, ...headers }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) { throw new Error(transportCode(error)); }
  let result;
  try { result = await response.json(); } catch {
    const error = /** @type {Error & { status?: number }} */ (new Error(response.ok ? 'invalid-api-response' : `api-http-${response.status}`));
    error.status = response.status; throw error;
  }
  if (!response.ok) { const error = /** @type {Error & { status?: number }} */ (new Error(result?.code ?? `api-http-${response.status}`)); error.status = response.status; throw error; }
  if (!result || typeof result !== 'object') throw new Error('invalid-api-response');
  return result;
}

/** Expiry time in milliseconds from the JWT payload, or 0. Only decides when to refresh; the server verifies the token. */
/** @param {string} token */
function accessTokenExpiry(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).exp * 1000 || 0; }
  catch { return 0; }
}
/** @param {string} token */
function tokenSubject(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub ?? null; }
  catch { return null; }
}
const REFRESH_MARGIN_MS = 60000, LOCK_STALE_MS = 30000, LOCK_WAIT_MS = 15000;

/**
 * Run `task` while holding `<configPath>.lock`. Only one process refreshes or replaces a session file at a time.
 * The same lock as creation sessions (mcp/file-lock.mjs): queued in this process, a killed holder's lock reclaimed once stale.
 */
/** @type {<T>(configPath: string, task: () => Promise<T>) => Promise<T>} */
export const withSessionLock = (configPath, task) =>
  withFileLock(`${configPath}.lock`, task, { busy: 'session-refresh-busy', waitMs: LOCK_WAIT_MS, staleMs: LOCK_STALE_MS });
/**
 * Replace the session file atomically: a partial write would lose the only valid session. Call under withSessionLock.
 * @param {string} configPath
 * @param {object} config  Any JSON object: a session, or a pending sign-in (scripts/login.mjs).
 */
export async function writeSessionFile(configPath, config) {
  const temporary = `${configPath}.${process.pid}.tmp`;
  try {
    await rm(temporary, { force: true });
    await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    // Windows virus scanners can briefly hold the just-written file; retry the same rename. Giving up here after a
    // token refresh would lose the rotated refresh token, the only valid one.
    await renameRetrying(temporary, configPath);
  } catch (error) { await rm(temporary, { force: true }); throw error; }
}

/**
 * Several MCP processes may share one session file (desktop app, CLI, IDE). Supabase rotates the refresh
 * token on every refresh and ends the whole session when a token two rotations old is used. So a process
 * first adopts a newer session another process saved, and refreshes only under a lock file.
 * @param {string} configPath
 * @param {{ createAuthClient?: typeof createClient }} [options]
 * @returns {Promise<RemoteClient>}
 */
export async function createRemoteClient(configPath, { createAuthClient = createClient } = {}) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (!validProjectUrl(config.url) || !config.publishableKey || !config.accessToken || !config.refreshToken) throw new Error('invalid-client-config');
  const auth = createAuthClient(config.url, config.publishableKey, { global: { fetch: runtimeFetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const fresh = () => accessTokenExpiry(config.accessToken) - Date.now() > REFRESH_MARGIN_MS;
  async function adoptSaved() {
    let saved;
    try { saved = JSON.parse(await readFile(configPath, 'utf8')); }
    catch (/** @type {any} */ error) { throw new Error(error.code === 'ENOENT' ? 'client-sign-in-required' : 'invalid-client-config'); }
    if (!saved.accessToken || typeof saved.accessToken !== 'string' || !saved.refreshToken || typeof saved.refreshToken !== 'string')
      throw new Error('invalid-client-config');
    // Never keep using a logged-out account, or change the owner halfway through an upload.
    if (saved.url !== config.url || saved.publishableKey !== config.publishableKey
      || tokenSubject(saved.accessToken) !== tokenSubject(config.accessToken)) throw new Error('client-account-changed');
    config.accessToken = saved.accessToken; config.refreshToken = saved.refreshToken;
  }
  let pendingAuth;
  async function token() {
    // Serialize disk adoption with refresh, including calls that arrive during an atomic session save.
    pendingAuth ??= (async () => {
      await adoptSaved();
      if (fresh()) return config.accessToken;
      return withSessionLock(configPath, async () => {
        await adoptSaved(); // Another process may have refreshed while this one waited.
        if (fresh()) return config.accessToken;
        const { data, error } = await auth.auth.refreshSession({ refresh_token: config.refreshToken });
        if (error || !data.session) {
          // A network failure during refresh is not evidence of a revoked account.
          const code = transportCode(error);
          if (code !== 'api-unreachable' || ['AuthRetryableFetchError', 'TypeError'].includes(error?.name ?? '') || (error?.status ?? 0) >= 500)
            throw new Error(code);
          throw new Error('client-sign-in-required');
        }
        config.accessToken = data.session.access_token; config.refreshToken = data.session.refresh_token;
        await writeSessionFile(configPath, config); // The old refresh token is now spent.
        return config.accessToken;
      });
    })().finally(() => { pendingAuth = undefined; });
    return pendingAuth;
  }
  return {
    request: async (route, options) => apiRequest(config.url, await token(), route, options),
  };
}

/**
 * A stable MCP tool catalog can start before login. Resolve the user's session on first use, without a restart.
 * @param {string} configPath
 * @param {{ createAuthClient?: typeof createClient }} [options]
 * @returns {RemoteClient}
 */
export function createLazyRemoteClient(configPath, options = {}) {
  let client;
  return { request: async (route, requestOptions) => {
    try {
      client ??= createRemoteClient(configPath, options).catch(error => { client = undefined; throw error; });
      return await (await client).request(route, requestOptions);
    } catch (/** @type {any} */ error) {
      if (error.code === 'ENOENT') throw new Error('client-sign-in-required');
      throw error;
    }
  } };
}
