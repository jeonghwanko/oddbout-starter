// @ts-check
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { createHandler } from '../api/handler.mjs';
import { Problem, UUID, bearerToken, readBody } from '../api/http.mjs';
import { registerFileInputProbe } from './file-input-probe.mjs';
import { registerCreatorSources } from './creator-sources.mjs';
import { AUTH, FILE, READ, downloadHostFile, output } from './cloud/common.mjs';
import { registerRegistrationTools } from './cloud/registration-tools.mjs';
import { registerAgentTools } from './cloud/agent-tools.mjs';
import { registerProfileSetTools } from './cloud/profile-set-tools.mjs';
import { registerWorkshopTools } from './cloud/workshop-tools.mjs';
import { HOSTED_INSTRUCTIONS, registerHostedTools } from './cloud/hosted-tools.mjs';
import { DIRECTORY_DESCRIPTIONS, DIRECTORY_INSTRUCTIONS, DIRECTORY_TITLES } from './cloud/directory-edition.mjs';
// The cloud MCP's tool families live in ./cloud/ (Edge-only, as this file); these names are this module's as before.
export { allowedFileUrl, compactText, downloadHostFile } from './cloud/common.mjs';
export { STYLE_GUIDE } from './cloud/agent-tools.mjs';
export { HOSTED_WAIT_SECONDS, hostedNext } from './cloud/hosted-tools.mjs';
/**
 * @typedef {import('./cloud/common.mjs').Identity} Identity
 * @typedef {import('./cloud/common.mjs').Arena} Arena
 * @typedef {import('./cloud/common.mjs').Hosted} Hosted
 * @typedef {import('./cloud/common.mjs').Invoke} Invoke
 * @typedef {import('./cloud/common.mjs').RecordAgent} RecordAgent
 * @typedef {import('./cloud/common.mjs').Register} Register
 */

export const CLOUD_RESOURCE = 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter-mcp';
export const LEGACY_PUBLIC_RESOURCE = 'https://ai-fighter-validator.onrender.com/mcp';
export const PUBLIC_RESOURCE = 'https://mcp.oddbout.com/mcp';
/**
 * Sign-in first (2026-10-28): the same server at `<function>/signin` asks every request for a sign-in, not only the account tools. Grok's custom
 * connector has no option for it: it decides at its first request whether a server needs one. At mcp.oddbout.com the public tools answer signed
 * out (ChatGPT relies on that), so Grok connected without an account and never offered the sign-in. Its tokens carry the same audience.
 */
export const SIGN_IN_RESOURCE = `${CLOUD_RESOURCE}/signin`;
/**
 * The same sign-in-first address through mcp.oddbout.com (2026-11-01, worker/cloud-gateway.mjs). There the host root is ours, so a client that
 * looks for the metadata at `/.well-known/oauth-protected-resource/signin` (RFC 9728, as Cursor's Grok Bot does) finds it; at the Supabase
 * host it got a 401 and gave up its sign-in. The Supabase address keeps working for connectors already added with it.
 */
export const PUBLIC_SIGN_IN_RESOURCE = 'https://mcp.oddbout.com/signin';
/**
 * The Claude directory edition (2026-11-01, cloud/directory-edition.mjs): the same server at `<function>/claude` lists only the tools a
 * directory reviewer can run in Claude, signed out like the public address. Its tokens carry the same audience, as the sign-in-first ones do.
 */
export const DIRECTORY_RESOURCE = `${CLOUD_RESOURCE}/claude`;
/** The address the directory listing names, through mcp.oddbout.com (worker/cloud-gateway.mjs). */
export const PUBLIC_DIRECTORY_RESOURCE = 'https://mcp.oddbout.com/claude';
/** The page the directory edition's metadata points to: connecting ODDBOUT in Claude. */
export const DIRECTORY_DOCUMENTATION = 'https://oddbout.com/cloud-plugin/claude.html';
/** @param {unknown} aud */
export function validCloudAudience(aud) {
  const current = [CLOUD_RESOURCE, LEGACY_PUBLIC_RESOURCE, PUBLIC_RESOURCE];
  if (typeof aud === 'string') return current.includes(aud);
  if (!Array.isArray(aud) || new Set(aud).size !== aud.length) return false;
  const expected = aud.length === 2 ? [CLOUD_RESOURCE, LEGACY_PUBLIC_RESOURCE] : current;
  return aud.length === expected.length && aud.every(value => expected.includes(value));
}
export const CLOUD_ISSUER = 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/auth/v1';
/** ODDBOUT's arena function (the game's `oddbout-arena`): rankings, records, cups, bout records, and the agent calls behind its key. */
export const ARENA_URL = 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/oddbout-arena';
/**
 * Tools anyone may call without a connected account: the contract and ODDBOUT's public records. The agent tools (3단계, 2026-10-27) list only
 * while the arena key is configured (`ODDBOUT_ARENA_AGENT_KEY`), so a release of this code alone does not change the published tool list.
 */
export const PUBLIC_TOOLS = new Set(['get_fighter_spec', 'get_style_guide', 'list_fighters', 'get_rankings', 'get_fighter_record', 'get_cup', 'read_bout',
  'get_fighter_story', 'get_world', 'list_generation_hosts']);
/** Public tools that spend an arena budget: a signed-in caller's call counts on his owner (MCP 점검, 2026-10-27). */
export const OWNER_BUDGET_TOOLS = new Set(['read_bout']);
/**
 * A host's own anonymous user id (`_meta["openai/subject"]` — the Apps SDK sends it "for the purposes of rate limiting"), as a UUID-shaped key.
 * @param {unknown} subject
 */
async function subjectKey(subject) {
  if (typeof subject !== 'string' || !subject || subject.length > 200) return null;
  const hex = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`openai-subject:${subject}`))),
    byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
/** @type {(value: unknown, status?: number, headers?: Record<string, string>) => Response} */
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });

/**
 * How long past its expiry a connector token is still taken from Cursor's web agents (2026-10-31). Cursor's Grok Bot signed in at 02:21Z
 * and never refreshed, though it holds a refresh token (offline_access granted): from 03:21Z it sent that token with every call, got a
 * bare 401 and told its user ODDBOUT's login provider was down. af_mcp_expired_token_state decides: the connection live, the client
 * Cursor's (a cursor.com MCP callback, any other redirect a loopback one), and the session not refreshed since the token was issued.
 * Every other client gets the plain expiry, as the MCP spec asks:
 * the MCP SDKs refresh only on a 401, so a grace for them would only lengthen their tokens. Supabase Auth itself refuses every expired
 * token, so the grace reaches nothing beyond this server. Seven days is Supabase's longest token lifetime.
 */
export const EXPIRED_TOKEN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Why a call has no verified identity, as its 401 or 503 says (RFC 6750 error_description: ASCII without quotes, commas or semicolons,
 * which naive challenge parsers split on). Agents relay it to their user: a refused sign-in needs a renewal or a reconnect, which no
 * retry of the same call replaces; only the unavailable check is worth retrying.
 */
export const SIGN_IN_PROBLEMS = Object.freeze({
  'authentication-required': 'Sign in to ODDBOUT through this connector.',
  'token-expired': 'The ODDBOUT sign-in of this connector expired and must be renewed. '
    + 'An agent that cannot renew it needs ODDBOUT reconnected in the connector settings. Retrying the same call later does not help.',
  'token-superseded': 'This ODDBOUT sign-in was replaced by a newer one. Use the newer sign-in or reconnect ODDBOUT in the connector settings.',
  'connection-ended': 'This ODDBOUT connection was signed out or disconnected (My agents). Reconnect ODDBOUT in the connector settings.',
  'invalid-token': 'This is not an ODDBOUT connector sign-in. Reconnect ODDBOUT in the connector settings.',
  'sign-in-check-unavailable': 'ODDBOUT could not check the sign-in just now (a temporary server problem). Retry in a minute.',
});
/** auth-js errors that mean the check could not run (network, a 5xx, a body that is not JSON), not that the token is bad. */
const UNAVAILABLE_AUTH_ERRORS = new Set(['AuthRetryableFetchError', 'AuthUnknownError']);
/** What af_mcp_expired_token_state's answers mean for the caller ('usable' lets the call through). */
const EXPIRED_TOKEN_PROBLEMS = Object.freeze({ strict: 'token-expired', refreshed: 'token-superseded', ended: 'connection-ended' });
/** @typedef {{ identity: Identity, problem?: undefined } | { identity: null, problem: keyof typeof SIGN_IN_PROBLEMS }} SignIn */

/**
 * The verified connector identity of a request, or why there is none. A signed OAuth token is still insufficient without the
 * dedicated audience, role and server-managed permission.
 * @param {any} db @param {Request} request @param {() => number} [now]
 * @returns {Promise<SignIn>}
 */
export async function authenticateCloud(db, request, now = Date.now) {
  const token = bearerToken(request);
  if (!token) return { identity: null, problem: 'authentication-required' };
  // The signature is verified either way; the expiry, with its grace, is checked below. auth-js throws, rather than returns, for some
  // malformed tokens (a payload that is not JSON, an algorithm the key does not have): those are bad tokens, not a server fault.
  let checked;
  try { checked = await db.auth.getClaims(token, { allowExpired: true }); }
  catch { return { identity: null, problem: 'invalid-token' }; }
  const { data, error } = checked;
  if (error) {
    const unavailable = UNAVAILABLE_AUTH_ERRORS.has(error.name) || error.status === 429 || (Number.isFinite(error.status) && error.status >= 500);
    return { identity: null, problem: unavailable ? 'sign-in-check-unavailable' : 'invalid-token' };
  }
  const c = data?.claims;
  if (!c || c.iss !== CLOUD_ISSUER || !validCloudAudience(c.aud) || c.role !== 'af_mcp' ||
    !UUID.test(c.sub ?? '') || !UUID.test(c.client_id ?? '') || !UUID.test(c.session_id ?? '') ||
    c.is_anonymous !== false || !Number.isFinite(c.exp) ||
    (c.nbf !== undefined && (!Number.isFinite(c.nbf) || c.nbf * 1000 > now())) || c.af_mcp !== 'registration-v1') {
    return { identity: null, problem: 'invalid-token' };
  }
  const expired = c.exp * 1000 <= now();
  if (expired && (c.exp * 1000 + EXPIRED_TOKEN_GRACE_MS <= now() || !Number.isFinite(c.iat))) return { identity: null, problem: 'token-expired' };
  // Revoked OAuth grants and signed-out sessions stop writes immediately, not merely when the JWT expires. af_mcp_session_active answers
  // true or false; for an expired token af_mcp_expired_token_state answers 'usable' or why not (EXPIRED_TOKEN_PROBLEMS).
  const session = { p_owner: c.sub, p_session: c.session_id, p_client: c.client_id };
  const { data: live, error: checkError } = expired
    ? await db.rpc('af_mcp_expired_token_state', { ...session, p_issued_at: Math.floor(c.iat) })
    : await db.rpc('af_mcp_session_active', session);
  if (checkError) return { identity: null, problem: 'sign-in-check-unavailable' };
  if (live === true || live === 'usable') return { identity: { owner: c.sub, email: c.email ?? '', claims: c } };
  const problem = Object.hasOwn(EXPIRED_TOKEN_PROBLEMS, live) ? EXPIRED_TOKEN_PROBLEMS[/** @type {keyof typeof EXPIRED_TOKEN_PROBLEMS} */ (live)] : null;
  return { identity: null, problem: problem ?? 'connection-ended' };
}

/**
 * @param {{ db: any, identity: Identity | null, fetcher?: typeof fetch, arena?: Arena | null, hosted?: Hosted | null,
 *   host?: { compact?: boolean, caller?: string | null }, edition?: 'full' | 'directory' }} options
 */
export function cloudServer({ db, identity, fetcher = fetch, arena = null, hosted = null, host = {}, edition = 'full' }) {
  const directory = edition === 'directory';
  const server = new McpServer({ name: 'oddbout-cloud', version: '1.0.0' }, {
    instructions: directory ? DIRECTORY_INSTRUCTIONS : (hosted ? HOSTED_INSTRUCTIONS : '') + 'For creation in the user’s workspace, use the user’s own generation account. '
      + 'Verify get_profile matches the intended registration account, especially after adding or switching connected accounts. '
      + 'Call this cloud connector’s check_creation_readiness before first generation, '
      + 'after a workspace restart and before registration. It checks account access; '
      + 'generation and display still require actual host evidence. '
      + 'Do not run local stdio login or ask for a PC to authenticate cloud registration. Do not generate merely to test access. '
      + 'Require the user’s final registration request and preserve motion review boundaries. '
      + 'Use host file attachments for fighter.json and WebP assets. '
      + 'When file inputs are exposed as paths, pass existing absolute workspace paths; the host uploads them. '
      + 'For existing Library or Page files use the host’s supported file materialization or original-byte read tools and verify '
      + 'size and SHA-256 before submission. Never substitute rendered previews or invent file IDs, URLs or hashes. '
      + 'A VM direct-network denial does not establish failure of the native connector; '
      + 'use the supported host file route without bypassing network policy. Never ask for tokens or callback URLs in chat. '
      + 'A refused ODDBOUT sign-in (401 invalid_token) states its reason: tell the user that reason; it is not an outage, and when it asks '
      + 'to reconnect ODDBOUT in the connector settings, scheduled retries cannot fix it. Only a 503 asks for a retry. '
      + 'A queued submission is not registered; inspect its status. Reuse one UUID for retries of identical bytes.' });
  // The existing API runs in-process with an identity bound to this verified request. The shim cannot be
  // selected from tool inputs and never receives/returns a privileged credential or another user's identity.
  const scoped = identity ? new Proxy(db, { get(target, key) {
    if (key === 'auth') return { getClaims: async () => ({ data: { claims: { sub: identity.owner, is_anonymous: false, role: 'authenticated' } }, error: null }) };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } }) : null;
  // The workshop labels what this client writes (made with); the in-process API takes its OAuth client from the verified token only.
  const api = createHandler({ db: scoped ?? db, agentClient: identity?.claims.client_id ?? null });
  /** @type {Invoke} */
  const invoke = async (path, method = 'GET', body, headers = {}) => {
    const response = await api(new Request(`https://internal.invalid/ai-fighter/${path}`, {
      method, headers: { authorization: 'Bearer internal-request-identity', ...headers }, ...(body === undefined ? {} : { body }) }));
    return response.json();
  };
  // Which agent made a submission (`af_record_submission_agent`, 2026-10-27): the roster shows a fighter's maker. Never fails the call.
  /** @type {RecordAgent} */
  const recordAgent = async submissionId => {
    if (!identity || !UUID.test(submissionId ?? '')) return;
    try { await db.rpc('af_record_submission_agent', { p_owner: identity.owner, p_submission: submissionId, p_client: identity.claims.client_id }); }
    catch { /* the maker is a label, not a gate */ }
  };
  // A write states whether repeating it with the same arguments is safe (idempotentHint). It once defaulted to yes, and three tools that
  // make something new on every call told retrying clients they could repeat them (MCP 점검 2026-10-29).
  /** @type {Register} */
  const registerTool = (name, title, description, inputSchema, run, { write = false, publish = false, openWorld = false,
    idempotent = write ? undefined : true, files = [], profile = false, publicTool = false, diagnostic = false } = {}) => {
    if (typeof idempotent !== 'boolean') throw Error(`${name}: a write tool states idempotent`);
    // Register types each tool's args; the SDK parses them with inputSchema before run sees them.
    server.registerTool(name, { title, description, inputSchema: /** @type {z.ZodRawShape} */ (inputSchema),
      ...(profile ? { outputSchema: z.object({ id: z.string().min(1), email: z.string().optional(), nickname: z.string().optional() }).strict() } : {}),
      // The directory edition repeats the title among the annotations, where Anthropic's tool checklist looks for it with the hints.
      annotations: { ...(directory ? { title } : {}), ...READ, readOnlyHint: !write, openWorldHint: openWorld, destructiveHint: publish, idempotentHint: idempotent },
      _meta: { securitySchemes: publicTool ? [{ type: 'noauth' }] : AUTH,
        ...(files.length ? { 'openai/fileParams': files } : {}), ...(profile ? { 'openai/profile': true } : {}) } }, async (/** @type {Record<string, unknown>} */ args) => {
      if (!publicTool && !identity) return { ...output({ ok: false, code: 'authentication-required' }),
        _meta: { 'mcp/www_authenticate': [`Bearer resource_metadata="${CLOUD_RESOURCE}/.well-known/oauth-protected-resource"`] } };
      try {
        const result = output(await run(/** @type {Parameters<typeof run>[0]} */ (args)), host.compact === true);
        // A diagnostic failure is useful data; keep it readable by hosts that throw away tool errors.
        return diagnostic ? { ...result, isError: false } : result;
      }
      catch (error) { return output({ ok: false, code: error instanceof Problem ? error.message : 'cloud-operation-unavailable' }); }
    });
  };
  // The directory edition registers only its tools, under their titles there; any other is unknown to it, not refused.
  /** @type {Register} */
  const register = directory ? (name, title, description, inputSchema, run, options) => {
    const directoryTitle = DIRECTORY_TITLES.get(name);
    if (directoryTitle) registerTool(name, directoryTitle, DIRECTORY_DESCRIPTIONS.get(name) ?? description, inputSchema, run, options);
  } : registerTool;
  registerRegistrationTools({ register, db, identity, invoke, fetcher, recordAgent });
  registerProfileSetTools({ register, db, identity, invoke, fetcher });
  // 에이전트 도구 (3단계, 2026-10-27): read ODDBOUT's records, spar, enter cups and tune the fighting style. Listed only with the arena key.
  if (arena?.url && arena?.key) {
    registerAgentTools({ register, arena, db, identity, invoke, recordAgent, caller: host.caller ?? null });
    registerWorkshopTools({ register, arena, invoke });
  }
  if (hosted && !directory) registerHostedTools({ register, db, identity, invoke, fetcher, hosted });
  registerFileInputProbe({ register, fileSchema: FILE, identity, downloadFile: downloadHostFile, fetcher });
  registerCreatorSources({ register, fileSchema: FILE, identity, db, downloadFile: downloadHostFile, fetcher });
  return server;
}

/** Browser calls are taken from the agents that connect (ChatGPT, Grok, Cursor, Claude) and ODDBOUT's own site; a call with no origin is not a browser's. */
const ALLOWED_ORIGINS = new Set(['https://chatgpt.com', 'https://chat.openai.com', 'https://platform.openai.com', 'https://oddbout.com',
  'https://grok.com', 'https://www.grok.com', 'https://cursor.com', 'https://www.cursor.com', 'https://claude.ai', 'https://claude.com']);

/**
 * Where a request goes: its route under the function, whether it came to the sign-in-first address, its edition, and the resource its OAuth
 * metadata names (the sign-in-first or directory address, the public address the gateway says it came through, or the function's own).
 * @param {Request} request
 * @returns {{ route: string, signInFirst: boolean, edition: 'full' | 'directory', resource: string }}
 */
function routeOf(request) {
  // The Edge gateway may strip /functions/v1 and replace the origin before forwarding.
  const segments = new URL(request.url).pathname.split('/').filter(Boolean), prefix = segments.indexOf('ai-fighter-mcp');
  const path = prefix < 0 ? segments : segments.slice(prefix + 1), signInFirst = path[0] === 'signin', directory = path[0] === 'claude';
  const requestedResource = request.headers.get('x-oddbout-public-resource') ?? '';
  const resource = signInFirst ? (requestedResource === PUBLIC_SIGN_IN_RESOURCE ? PUBLIC_SIGN_IN_RESOURCE : SIGN_IN_RESOURCE)
    : directory ? (requestedResource === PUBLIC_DIRECTORY_RESOURCE ? PUBLIC_DIRECTORY_RESOURCE : DIRECTORY_RESOURCE)
    : [PUBLIC_RESOURCE, LEGACY_PUBLIC_RESOURCE].includes(requestedResource) ? requestedResource : CLOUD_RESOURCE;
  return { route: (signInFirst || directory ? path.slice(1) : path).join('/'), signInFirst, edition: directory ? 'directory' : 'full', resource };
}

/**
 * A request's sign-in; a check that throws is a server fault, not a refused token.
 * @param {any} db @param {Request} request
 * @returns {Promise<SignIn>}
 */
const signInOf = (db, request) => authenticateCloud(db, request).catch(() => ({ identity: null, problem: 'sign-in-check-unavailable' }));

/**
 * The verified identity a call runs as: needed at the sign-in-first address and for account tools (with the problem when there is none),
 * tried for a public tool whose budget is the caller's (a valid token counts it on its owner, anything else on every signed-out agent),
 * else none — and none for a tool the directory edition does not have.
 * @param {any} db @param {Request} request @param {any} body @param {boolean} signInFirst @param {'full' | 'directory'} edition
 * @returns {Promise<SignIn | { identity: Identity | null, problem?: undefined }>}
 */
async function identityFor(db, request, body, signInFirst, edition) {
  const tool = body.method === 'tools/call' ? body.params?.name : null;
  // A tool the directory edition does not list is unknown there, signed in or not: no sign-in to reach a "not found".
  if (edition === 'directory' && tool !== null && !DIRECTORY_TITLES.has(tool)) return { identity: null };
  if (signInFirst || (tool !== null && !PUBLIC_TOOLS.has(tool))) return signInOf(db, request);
  if (OWNER_BUDGET_TOOLS.has(tool) && request.headers.has('authorization')) return { identity: (await signInOf(db, request)).identity };
  return { identity: null };
}

/**
 * ChatGPT's calls carry its own `_meta` (`openai/locale`, `openai/subject`, …): it reads the structured result, so the text can be short,
 * and its anonymous user is a read budget.
 * @param {any} body
 */
async function hostOf(body) {
  const meta = body.params?._meta && typeof body.params._meta === 'object' ? body.params._meta : {};
  return { compact: Object.keys(meta).some(key => key.startsWith('openai/')), caller: await subjectKey(meta['openai/subject']) };
}

/**
 * The tool list as hosts read it. SDK 1.32 serializes custom auth metadata only in _meta: publish the current host's top-level contract too.
 * Every schema names its JSON Schema draft (1.1 KB of each list, every conversation); hosts do not need it.
 * @param {any} result
 */
function publishedToolList(result) {
  for (const tool of result.result?.tools ?? []) {
    tool.securitySchemes = tool._meta.securitySchemes;
    delete tool.inputSchema?.$schema; delete tool.outputSchema?.$schema;
  }
  return result;
}

/**
 * Keep optional integrations typed at the TypeScript Edge entry boundary: a null default alone
 * makes Deno infer that only null is accepted, even when the integration is configured.
 * @param {object} options
 * @param {import('@supabase/supabase-js').SupabaseClient} options.db
 * @param {typeof fetch} [options.fetcher]
 * @param {{url: string, key: string, fetcher?: typeof fetch, cupWaitMs?: number, pollMs?: number, pollTries?: number} | null} [options.arena]
 * @param {{pollMs?: number} | null} [options.hosted]
 * @returns {(request: Request) => Promise<Response>}
 */
export function createCloudHandler({ db, fetcher = fetch, arena = null, hosted = null }) {
  return async request => {
    const { route, signInFirst, edition, resource } = routeOf(request);
    if (route === '.well-known/oauth-protected-resource' && request.method === 'GET') return json({ resource,
      authorization_servers: [CLOUD_ISSUER], scopes_supported: ['openid', 'email', 'profile'],
      ...(edition === 'directory' ? { resource_name: 'ODDBOUT', resource_documentation: DIRECTORY_DOCUMENTATION }
        : { resource_name: 'ODDBOUT character registration', resource_documentation: 'https://oddbout.com/docs.html' }) });
    if (route) return json({ error: 'not_found' }, 404);
    const origin = request.headers.get('origin');
    if (origin !== null && !ALLOWED_ORIGINS.has(origin)) return json({ error: 'origin_not_allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
      'access-control-allow-origin': origin ?? 'https://chatgpt.com',
      'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type, MCP-Protocol-Version',
      'access-control-expose-headers': 'WWW-Authenticate' } });
    /**
     * A call without a sign-in says why (RFC 6750): a token it refused is named `invalid_token` with the reason, so the agent can tell its
     * user instead of guessing at an outage (Grok Bot, 2026-10-31); a call with no token is only asked to sign in. The challenge keeps
     * its earlier start for clients that read it by prefix. A check that could not run is a 503 to retry, never a 401 that sends the
     * client back to its sign-in.
     * @param {keyof typeof SIGN_IN_PROBLEMS} problem
     */
    const signInProblem = problem => {
      const error_description = SIGN_IN_PROBLEMS[problem];
      if (problem === 'sign-in-check-unavailable') {
        return json({ error: 'temporarily_unavailable', code: problem, error_description }, 503, { 'retry-after': '30' });
      }
      const refused = problem === 'authentication-required' ? '' : `, error="invalid_token", error_description="${error_description}"`;
      return json({ error: 'invalid_token', code: problem, error_description }, 401, { 'www-authenticate':
        `Bearer resource_metadata="${resource}/.well-known/oauth-protected-resource", scope="openid email profile"${refused}` });
    };
    if (request.method !== 'POST') {
      // A client that probes the sign-in-first address with GET, or HEAD as Gemini CLI does first (2026-10-29), learns there that it needs a sign-in.
      if (signInFirst && ['GET', 'HEAD'].includes(request.method)) {
        const { problem } = await signInOf(db, request);
        if (problem) return signInProblem(problem);
      }
      return json({ error: 'method_not_allowed' }, 405, { allow: 'POST, OPTIONS' });
    }
    let body;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 65536))); }
    catch { return json({ error: 'invalid_request' }, 400); }
    if (!body || Array.isArray(body) || typeof body.method !== 'string') return json({ error: 'invalid_request' }, 400);
    const { identity, problem } = await identityFor(db, request, body, signInFirst, edition);
    if (problem) return signInProblem(problem);
    // A server per request on purpose: its tools close over this request's verified identity, so no state can carry one
    // user's identity into another's call. Measured 2026-10-28: building it with all tools and answering tools/list
    // takes about 1.8 ms, small beside the network hop, so sharing a server is not worth that guarantee.
    const server = cloudServer({ db, identity, fetcher, arena, hosted, host: await hostOf(body), edition });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request, { parsedBody: body });
      if (body.method === 'tools/list' && response.status === 200) return json(publishedToolList(await response.json()));
      return response;
    } catch { return json({ error: 'mcp_unavailable' }, 503); }
    finally { await server.close(); }
  };
}
