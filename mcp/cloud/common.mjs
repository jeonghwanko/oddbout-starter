// @ts-check
// The cloud MCP's shared pieces: tool argument schemas and annotations, results as hosts read them, host file downloads and arena calls.
import { z } from 'zod';
import { Problem, readBody } from '../../api/http.mjs';
import { compactText } from '../tool-result.mjs';

/**
 * What cloud.mjs hands the tool families. `Identity` is the verified caller (authenticateCloud): null on a signed-out call, which
 * register lets reach only the public tools. `Register` is its `register`: each tool's `run` gets the arguments its inputSchema parsed
 * and the call's ToolContext.
 * @typedef {{ owner: string, email: string, claims: { client_id: string, session_id: string, [claim: string]: unknown } }} Identity
 * @typedef {{ url: string, key: string, fetcher?: typeof fetch, cupWaitMs?: number, pollMs?: number, pollTries?: number }} Arena
 * @typedef {{ pollMs?: number }} Hosted
 * @typedef {z.infer<typeof FILE>} HostFile
 * @typedef {(path: string, method?: string, body?: BodyInit, headers?: Record<string, string>) => Promise<any>} Invoke  Resolves to the API's JSON.
 * @typedef {(submissionId: string | undefined) => Promise<void>} RecordAgent
 * @typedef {{ content: { type: 'text', text: string }[], structuredContent: Record<string, unknown>, isError?: boolean }} ToolOutput
 * @typedef {{ write?: boolean, publish?: boolean, openWorld?: boolean, idempotent?: boolean, files?: string[], profile?: boolean,
 *   publicTool?: boolean, diagnostic?: boolean }} ToolOptions
 * @typedef {{ signal: AbortSignal, deadline: number }} ToolContext  The call's own: aborted when its client goes away; its answer is due by `deadline`.
 * @typedef {<S extends z.ZodRawShape>(name: string, title: string, description: string, inputSchema: S,
 *   run: (args: z.infer<z.ZodObject<S>>, context: ToolContext) => Record<string, unknown> | Promise<Record<string, unknown>>, options?: ToolOptions) => void} Register
 */

/**
 * How long one call may take, from its request's arrival (MCP 점검 2026-11-03). The answer is one JSON response, so the client and the
 * mcp.oddbout.com gateway see nothing until it is done: the gateway's header timeout, and a client's own, bound the whole call. enter_cup
 * once waited 25 seconds after an issue of up to 20, and the gateway's 502 left a cup made and a client told nothing. A tool that waits or
 * fetches stops by this deadline and says what to read next.
 */
export const CALL_BUDGET_MS = 25_000;
/** One database or Storage call's limit: supabase-js sets none, so a stalled call held its tool, and every call's sign-in check, until the Edge limit. */
export const DATABASE_TIMEOUT_MS = 15_000;
/** The time left before `deadline`, at most `cap`, at least 1 ms. @param {number} deadline @param {number} cap */
export const timeLeft = (deadline, cap) => Math.max(1, Math.min(cap, deadline - Date.now()));
/** `signal`, also aborted after `ms`. @param {AbortSignal | null | undefined} signal @param {number} ms */
export const within = (signal, ms) => signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
/** A wait that ends early when `signal` aborts. @param {number} ms @param {AbortSignal} signal @returns {Promise<void>} */
export const pause = (ms, signal) => new Promise(done => {
  if (signal.aborted) return done();
  const timer = setTimeout(() => { signal.removeEventListener('abort', stop); done(); }, ms), stop = () => { clearTimeout(timer); done(); };
  signal.addEventListener('abort', stop, { once: true });
});
/**
 * fetch with DATABASE_TIMEOUT_MS on every call: the Edge entry hands it to supabase-js. A caller's own signal still applies.
 * @param {number} [ms] @param {typeof fetch} [base]
 * @returns {typeof fetch}
 */
export const timedFetch = (ms = DATABASE_TIMEOUT_MS, base = fetch) => (input, init = {}) => base(input, { ...init, signal: within(init.signal, ms) });
/** A 5xx Problem that keeps what failed behind its code, for the call's log line. @param {string} code @param {unknown} cause */
export const unavailable = (code, cause) => Object.assign(new Problem(503, code), { cause });

export const FILE = z.object({ download_url: z.string().max(8192), file_id: z.string().min(1).max(256),
  mime_type: z.string().max(128).optional(), file_name: z.string().max(512).optional() }).strict();
/**
 * A UUID argument. zod's `uuid()` writes a 168-character pattern into every tool's schema (13 of them, 2.2 KB of each tools/list, every
 * conversation — MCP 점검 2026-10-27); the server checks the ids again (`api/http.mjs` UUID), so a short pattern is enough here.
 */
export const UUID_ARG = () => z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const AUTH = [{ type: 'oauth2', scopes: ['openid', 'email', 'profile'] }];
/**
 * `compact`: a host that reads the structured content (ChatGPT) gets compactText; other hosts read only the text and keep the whole JSON.
 * @type {(value: Record<string, unknown>, compact?: boolean) => ToolOutput}
 */
export const output = (value, compact = false) => ({ content: [{ type: 'text', text: compact ? compactText(value) : JSON.stringify(value) }], structuredContent: value,
  ...(value.ok === false ? { isError: true } : {}) });
export { compactText };

// Files come from the host's fileParams capability, never arbitrary URLs or VM paths.
// Do not follow redirects: even an allowed origin must not redirect to a private network or another service.
/**
 * The two Azure origins the ChatGPT Library hands its files from (observed 2026-10-26, docs/research/FILE-INPUT-PROOF.md). Exact hosts
 * only: never another Azure tenant or an inferred name. The file probe, the private source store and the hosted fighter request take them
 * (the request since 2026-10-30, the user's decision); registration keeps the host's own file origins.
 */
export const LIBRARY_FILE_HOSTS = Object.freeze(['oaisdmntprnznorth.blob.core.windows.net', 'oaisdmntprwestus.blob.core.windows.net']);
/** @param {string} value @param {readonly string[]} [additionalHosts] */
export function allowedFileUrl(value, additionalHosts = []) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash &&
      (u.hostname === 'files.oaiusercontent.com' || u.hostname.endsWith('.oaiusercontent.com') ||
        u.hostname === 'files.openai.com' || additionalHosts.includes(u.hostname));
  } catch { return false; }
}
/**
 * @param {HostFile} file @param {number} maximum @param {typeof fetch} [fetcher] @param {readonly string[]} [additionalHosts]
 * @param {AbortSignal} [signal]  the download's own limit (default 20 seconds); a caller with a deadline passes what is left of it
 */
export async function downloadHostFile(file, maximum, fetcher = fetch, additionalHosts = [], signal = AbortSignal.timeout(20000)) {
  if (!allowedFileUrl(file.download_url, additionalHosts)) throw new Problem(400, 'unsupported-file-origin');
  // A network failure or the limit, before the answer or during its body, is the host's file being unavailable, not a fault of this server.
  // Only the error's name is kept: Deno's fetch errors quote the signed download URL.
  /** @type {(error: any) => Problem} */
  const lost = error => error instanceof Problem ? error : unavailable('file-download-unavailable', { name: String(error?.name ?? 'Error') });
  let response;
  try { response = await fetcher(file.download_url, { redirect: 'error', signal, credentials: 'omit' }); }
  catch (error) { throw lost(error); }
  if (!response.ok) throw new Problem(400, 'file-download-unavailable');
  try { return await readBody(response, maximum); }
  catch (error) { throw lost(error); }
}

/** One arena call: a GET, or a POST with the agent key. A network failure or a body that is not JSON is `arena-unavailable`. */
export const CUP_WAIT_MS = 25_000;
/**
 * @param {Arena} arena @param {string} path @param {object} [body] @param {string} [owner] @param {number} [timeoutMs]
 * @param {{ signedOut?: boolean, signal?: AbortSignal }} [options]  `signal`: a read that stops with its call (a poll)
 * @returns {Promise<any>} The arena's JSON object; callers check its fields.
 */
export async function arenaCall(arena, path, body, owner, timeoutMs = 20000, { signedOut = false, signal } = {}) {
  // A read made for someone (`owner`: the connected owner, or `public`) carries the key: the arena counts it against that owner, not this
  // function's one address (MCP 점검 2026-10-27 — every agent together had six reads a minute). `signedOut`: the owner is a host's anonymous
  // user id, which its caller chooses — the arena counts the read on every signed-out agent's pool as well (2026-10-30).
  /** @type {Record<string, string>} */
  const headers = body !== undefined ? { 'content-type': 'application/json', 'x-arena-agent': arena.key }
    : owner !== undefined ? { 'x-arena-agent': arena.key, 'x-arena-owner': owner, ...(signedOut ? { 'x-arena-signed-out': '1' } : {}) } : {};
  let response;
  try {
    response = await (arena.fetcher ?? fetch)(`${arena.url}/${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      signal: within(signal, timeoutMs), headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch (error) { throw unavailable('arena-unavailable', error); }
  let value;
  try { value = await response.json(); } catch (error) { throw unavailable('arena-unavailable', error); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable('arena-unavailable', { message: `arena answered ${response.status} without a JSON object` });
  return value;
}
