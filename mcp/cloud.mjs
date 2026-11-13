// @ts-check
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createHandler } from '../api/handler.mjs';
import { Problem, UUID, bearerToken, failureDetail, logSkipped, readBody } from '../api/http.mjs';
import { registerFileInputProbe } from './file-input-probe.mjs';
import { registerCreatorSources } from './creator-sources.mjs';
import { AUTH, CALL_BUDGET_MS, FILE, READ, downloadHostFile, output } from './cloud/common.mjs';
import { registerRegistrationTools } from './cloud/registration-tools.mjs';
import { registerPackagingPreparation } from './cloud/packaging-tools.mjs';
import { registerAgentTools } from './cloud/agent-tools.mjs';
import { registerProfileSetTools } from './cloud/profile-set-tools.mjs';
import { registerWorkshopTools } from './cloud/workshop-tools.mjs';
import { HOSTED_INSTRUCTIONS, hostedCandidateImages, hostedMotionSheetImage, registerHostedTools } from './cloud/hosted-tools.mjs';
import { configuredGameLauncher, registerGameLauncherTools, registerGameLauncherUi } from './cloud/game-launcher-ui.mjs';
import { issueEmbedLaunchGrant } from '../api/embed.mjs';
import { LOOK_UI, registerLookUi } from './cloud/hosted-look-ui.mjs';
import { DIRECTORY_DESCRIPTIONS, DIRECTORY_INSTRUCTIONS, DIRECTORY_TITLES } from './cloud/directory-edition.mjs';
import { aliasCall, memberOf, mergingRegister, renameTools } from './cloud/merged-tools.mjs';
import { mcpServing } from './cloud/serve.mjs';
import {
  ALLOWED_ORIGINS,
  CLOUD_ISSUER,
  CLOUD_RESOURCE,
  DIRECTORY_DOCUMENTATION,
  DIRECTORY_RESOURCE,
  LEGACY_PUBLIC_RESOURCE,
  PUBLIC_DIRECTORY_RESOURCE,
  PUBLIC_RESOURCE,
  PUBLIC_SIGN_IN_RESOURCE,
  SIGN_IN_RESOURCE,
} from './cloud/resources.mjs';
// The cloud MCP's tool families live in ./cloud/ (Edge-only, as this file); these names are this module's as before.
export { CALL_BUDGET_MS, allowedFileUrl, compactText, downloadHostFile, timedFetch } from './cloud/common.mjs';
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

// The addresses live in ./cloud/resources.mjs, which the mcp.oddbout.com gateway shares; these names are this module's as before.
export {
  ARENA_URL,
  CLOUD_ISSUER,
  CLOUD_RESOURCE,
  DIRECTORY_DOCUMENTATION,
  DIRECTORY_RESOURCE,
  LEGACY_PUBLIC_RESOURCE,
  PUBLIC_DIRECTORY_RESOURCE,
  PUBLIC_RESOURCE,
  PUBLIC_SIGN_IN_RESOURCE,
  SIGN_IN_RESOURCE,
} from './cloud/resources.mjs';
/** @param {unknown} aud */
export function validCloudAudience(aud) {
  const current = [CLOUD_RESOURCE, LEGACY_PUBLIC_RESOURCE, PUBLIC_RESOURCE];
  if (typeof aud === 'string') return current.includes(aud);
  if (!Array.isArray(aud) || new Set(aud).size !== aud.length) return false;
  const expected = aud.length === 2 ? [CLOUD_RESOURCE, LEGACY_PUBLIC_RESOURCE] : current;
  return aud.length === expected.length && aud.every(value => expected.includes(value));
}
/**
 * Tools anyone may call without a connected account: the contract and ODDBOUT's public records. The agent tools (3단계, 2026-10-27) list only
 * while the arena key is configured (`ODDBOUT_ARENA_AGENT_KEY`), so a release of this code alone does not change the published tool list.
 */
export const PUBLIC_TOOLS = new Set([
  'get_fighter_spec',
  'get_style_guide',
  'list_fighters',
  'get_rankings',
  'get_fighter_record',
  'get_cup',
  'read_bout',
  'get_fighter_story',
  'get_world',
  'list_generation_hosts',
  'prepare_fighter_packaging',
  // The full edition's merged public reads (cloud/merged-tools.mjs); the names above still answer as their views.
  'browse_oddbout',
]);
/** Public tools (a merged tool's view counts as its member) that spend an arena budget: a signed-in caller's call counts on his owner (MCP 점검, 2026-10-27). */
export const OWNER_BUDGET_TOOLS = new Set(['read_bout']);
/**
 * A host's own anonymous user id (`_meta["openai/subject"]` — the Apps SDK sends it "for the purposes of rate limiting"), as a UUID-shaped key.
 * @param {unknown} subject
 */
async function subjectKey(subject) {
  if (typeof subject !== 'string' || !subject || subject.length > 200) return null;
  const hex = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`openai-subject:${subject}`))), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
/** @type {(value: unknown, status?: number, headers?: Record<string, string>) => Response} */
const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
  });

/** @param {string | undefined} resourceUri @param {('model' | 'app')[] | undefined} visibility */
export function componentToolMetadata(resourceUri, visibility) {
  if (!resourceUri && !visibility) return {};
  return {
    ui: { ...(resourceUri ? { resourceUri } : {}), ...(visibility ? { visibility } : {}) },
    ...(resourceUri ? { 'openai/outputTemplate': resourceUri } : {}),
    ...(visibility?.includes('app') ? { 'openai/widgetAccessible': true } : {}),
    ...(visibility?.length === 1 && visibility[0] === 'app' ? { 'openai/visibility': 'private' } : {}),
  };
}

/**
 * An expired connector token is still taken from Cursor's web agents (2026-10-31). Cursor's Grok Bot signed in at 02:21Z and never
 * refreshed, though it holds a refresh token (offline_access granted): from 03:21Z it sent that token with every call, got a bare 401 and
 * told its user ODDBOUT's login provider was down. af_mcp_expired_token_state decides: the connection live, the client Cursor's (a
 * cursor.com MCP callback, any other redirect a loopback one), and the session not refreshed since the token was issued. Every other
 * client gets the plain expiry, as the MCP spec asks: the MCP SDKs refresh only on a 401, so a grace for them would only lengthen their
 * tokens. Supabase Auth itself refuses every expired token, so the grace reaches nothing beyond this server.
 * How long: until 7 days after the session's last use (af_mcp_session_state, 2026-11-02 user: the bot stays signed in while it is used),
 * at first 7 days after the token's expiry whatever the bot did. A sign-out or a revoked grant still ends it at once.
 * Past it the 401 says to sign in again and names this page: My agents with Grok's sheet open, after the site's own sign-in.
 */
export const GROK_RECONNECT_PAGE = 'https://oddbout.com/creator.html#view=agents&agent=grok';
/**
 * Why a call has no verified identity, as its 401 or 503 says (RFC 6750 error_description: ASCII without quotes, commas or semicolons,
 * which naive challenge parsers split on). Agents relay it to their user: a refused sign-in needs a renewal or a reconnect, which no
 * retry of the same call replaces; only the unavailable check is worth retrying.
 */
export const SIGN_IN_PROBLEMS = Object.freeze({
  'authentication-required': 'Sign in to ODDBOUT through this connector.',
  'token-expired':
    'The ODDBOUT sign-in of this connector expired and must be renewed. ' +
    'An agent that cannot renew it needs ODDBOUT reconnected in the connector settings. Retrying the same call later does not help.',
  'token-superseded': 'This ODDBOUT sign-in was replaced by a newer one. Use the newer sign-in or reconnect ODDBOUT in the connector settings.',
  'connection-ended': 'This ODDBOUT connection was signed out or disconnected (My agents). Reconnect ODDBOUT in the connector settings.',
  'invalid-token': 'This is not an ODDBOUT connector sign-in. Reconnect ODDBOUT in the connector settings.',
  'other-address': 'This ODDBOUT sign-in was made for another ODDBOUT connector address. Reconnect ODDBOUT in the connector settings.',
  'sign-in-lapsed':
    "This ODDBOUT sign-in ended after 7 days without use. Sign in again: reconnect ODDBOUT in this agent's connector " +
    `settings. How: ${GROK_RECONNECT_PAGE}`,
  'sign-in-check-unavailable': 'ODDBOUT could not check the sign-in just now (a temporary server problem). Retry in a minute.',
});
/** auth-js errors that mean the check could not run (network, a 5xx, a body that is not JSON), not that the token is bad. */
const UNAVAILABLE_AUTH_ERRORS = new Set(['AuthRetryableFetchError', 'AuthUnknownError']);
/** What af_mcp_session_state's answers mean for the caller ('usable' lets the call through). */
const SESSION_STATE_PROBLEMS = Object.freeze({
  strict: 'token-expired',
  refreshed: 'token-superseded',
  ended: 'connection-ended',
  'other-edition': 'other-address',
  lapsed: 'sign-in-lapsed',
});
/** Where a refused sign-in's user reconnects from: its 401 names the page (RFC 6750 error_uri) beside the reason. */
const RECONNECT_PAGES = Object.freeze(/** @type {Partial<Record<keyof typeof SIGN_IN_PROBLEMS, string>>} */ ({ 'sign-in-lapsed': GROK_RECONNECT_PAGE }));
/** @typedef {{ identity: Identity, problem?: undefined } | { identity: null, problem: keyof typeof SIGN_IN_PROBLEMS }} SignIn */

/**
 * The verified connector identity of a request, or why there is none. A signed OAuth token is still insufficient without the
 * dedicated audience, role and server-managed permission, and at the edition its session is bound to (`edition`: where the call came).
 * @param {any} db @param {Request} request @param {() => number} [now] @param {'full' | 'directory'} [edition]
 * @returns {Promise<SignIn>}
 */
export async function authenticateCloud(db, request, now = Date.now, edition = 'full') {
  const token = bearerToken(request);
  if (!token) return { identity: null, problem: 'authentication-required' };
  // The signature is verified either way; the expiry, with its grace, is checked below. auth-js throws, rather than returns, for some
  // malformed tokens (a payload that is not JSON, an algorithm the key does not have): those are bad tokens, not a server fault.
  let checked;
  try {
    checked = await db.auth.getClaims(token, { allowExpired: true });
  } catch {
    return { identity: null, problem: 'invalid-token' };
  }
  const { data, error } = checked;
  if (error) {
    const unavailable = UNAVAILABLE_AUTH_ERRORS.has(error.name) || error.status === 429 || (Number.isFinite(error.status) && error.status >= 500);
    return { identity: null, problem: unavailable ? 'sign-in-check-unavailable' : 'invalid-token' };
  }
  const c = data?.claims;
  if (
    !c ||
    c.iss !== CLOUD_ISSUER ||
    !validCloudAudience(c.aud) ||
    c.role !== 'af_mcp' ||
    !UUID.test(c.sub ?? '') ||
    !UUID.test(c.client_id ?? '') ||
    !UUID.test(c.session_id ?? '') ||
    c.is_anonymous !== false ||
    !Number.isFinite(c.exp) ||
    (c.nbf !== undefined && (!Number.isFinite(c.nbf) || c.nbf * 1000 > now())) ||
    c.af_mcp !== 'registration-v1'
  ) {
    return { identity: null, problem: 'invalid-token' };
  }
  const expired = c.exp * 1000 <= now();
  if (expired && !Number.isFinite(c.iat)) return { identity: null, problem: 'token-expired' };
  // Revoked OAuth grants and signed-out sessions stop writes immediately, not merely when the JWT expires. af_mcp_session_state answers
  // 'usable' or why not (SESSION_STATE_PROBLEMS), in one call: the connection (for an expired token, with its grace) and the edition its
  // session is bound to. The token says nothing of the address it was made for (Supabase Auth keeps no RFC 8707 resource), so the first
  // signed-in call binds the session to its edition and the other edition refuses it (2026-11-01).
  const { data: live, error: checkError } = await db.rpc('af_mcp_session_state', {
    p_owner: c.sub,
    p_session: c.session_id,
    p_client: c.client_id,
    p_edition: edition,
    ...(expired ? { p_issued_at: Math.floor(c.iat), p_expires_at: Math.floor(c.exp) } : {}),
  });
  if (checkError) return { identity: null, problem: 'sign-in-check-unavailable' };
  if (live === 'usable') return { identity: { owner: c.sub, email: c.email ?? '', claims: c } };
  const problem = Object.hasOwn(SESSION_STATE_PROBLEMS, live) ? SESSION_STATE_PROBLEMS[/** @type {keyof typeof SESSION_STATE_PROBLEMS} */ (live)] : null;
  return { identity: null, problem: problem ?? 'connection-ended' };
}

/**
 * One request's call, for its tools and its log line: `requestId` (the gateway's, else this function's), the client's `protocol` version,
 * the request's `signal` (aborted when the client goes away) and the `deadline` its answer is due by (CALL_BUDGET_MS from its arrival).
 * @typedef {{ requestId?: string, protocol?: string | null, signal?: AbortSignal, deadline?: number, legacy?: boolean }} Call  `legacy`: called by a
 *   name no longer listed (cloud/merged-tools.mjs `aliasCall`), so its results keep the old names
 */
/**
 * One MCP request as its log line names it (createCloudHandler): `route`, the address it came to (/mcp and /signin are both the full edition).
 * @typedef {{ route: 'mcp' | 'signin' | 'claude', edition: 'full' | 'directory', method: string | null, tool: string | null, compact: boolean }} RequestLine
 */

/**
 * One JSON line per tool call (MCP 점검 2026-11-03: a failed call left no trace, and nothing said which tools agents use or which protocol
 * version they speak — the 2026-07-28 move waits on that). Only ODDBOUT's own names and codes, never arguments, tokens, URLs or the owner.
 * A failure of the server's (a bug, or a 5xx with what failed behind it) goes to the error log with failureDetail.
 * @param {{ tool: string, via?: string, edition: string, client: string | null, call: Call, started: number, value: Record<string, unknown>, failure?: unknown }} line
 */
function logCall({ tool, via, edition, client, call, started, value, failure }) {
  const code = typeof value.code === 'string' ? value.code.slice(0, 80) : undefined;
  const fault = failure !== undefined && !(failure instanceof Problem && failure.status < 500);
  // A merged tool's call is logged under its view's member (the name the logs always had), `via` the tool the host called.
  (fault ? console.error : console.log)(
    JSON.stringify({
      stage: 'mcp-call',
      tool,
      ...(via && via !== tool ? { via } : {}),
      edition,
      client,
      protocol: call.protocol ?? null,
      requestId: call.requestId ?? null,
      ms: Date.now() - started,
      ok: value.ok !== false,
      ...(code ? { code } : {}),
      ...(fault ? failureDetail(failure) : {}),
    }),
  );
}

/**
 * The database the in-process API sees for one verified request: its sign-in is `owner`'s. The shim cannot be selected from tool inputs
 * and never receives/returns a privileged credential or another user's identity.
 * Each signed-in route checks the account (`af_authorize`: a disabled account, the per-minute budget), so one tool call checked it once
 * per invoke (three for request_hosted_fighter with a picture, MCP 점검 2026-11-03) and spent that much of the budget. The request's first
 * answer stands for its other routes; a failed check is asked again, as before.
 * @param {any} db @param {string} owner
 */
export function scopedDatabase(db, owner) {
  /** @type {Promise<any> | undefined} */
  let authorized;
  const forget = () => {
    authorized = undefined;
  };
  /** @type {(name: string, args?: any, ...rest: unknown[]) => any} */
  const rpc = (name, args, ...rest) => {
    if (name !== 'af_authorize' || rest.length || !args || Object.keys(args).length !== 1 || args.p_owner !== owner) return db.rpc(name, args, ...rest);
    authorized ??= Promise.resolve(db.rpc(name, args)).then(
      answer => {
        if (answer?.error) forget();
        return answer;
      },
      error => {
        forget();
        throw error;
      },
    );
    return authorized;
  };
  return new Proxy(db, {
    get(target, key) {
      if (key === 'auth') return { getClaims: async () => ({ data: { claims: { sub: owner, is_anonymous: false, role: 'authenticated' } }, error: null }) };
      if (key === 'rpc') return rpc;
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** @type {{ ttlMs: number, cacheScope: 'private' }} */
const LIST_CACHE = { ttlMs: 300_000, cacheScope: 'private' };

/**
 * The full edition serves /mcp and /signin alike: the same tools, metadata and texts (MCP 리뷰 2026-11-05). Codex connects at /signin
 * (docs/CLOUD-MCP.md) and its native file input reaches the upload tools through OpenAI's file hosts, so /signin keeps them.
 * @param {{ db: any, identity: Identity | null, fetcher?: typeof fetch, arena?: Arena | null, hosted?: Hosted | null,
 *   gameLauncherConfig?: {enabled?: boolean, gameUrl?: string} | null,
 *   host?: { compact?: boolean, caller?: string | null }, edition?: 'full' | 'directory', call?: Call }} options
 */
export function cloudServer({ db, identity, fetcher = fetch, arena = null, hosted = null, gameLauncherConfig = null, host = {}, edition = 'full', call = {} }) {
  const directory = edition === 'directory';
  // Hosts with OpenAI's file host (ChatGPT, Codex) attach the files the upload tools take, and read OpenAI's tool metadata (securitySchemes,
  // openai/fileParams, openai/profile). The directory edition lists neither, and its texts name no upload tool (`uploads`).
  const fileHost = !directory,
    openaiMeta = fileHost;
  const server = new McpServer(
    { name: 'oddbout-cloud', version: '1.0.0' },
    {
      // The full edition's texts name merged tools by their views (cloud/merged-tools.mjs).
      instructions: directory
        ? DIRECTORY_INSTRUCTIONS
        : renameTools(
            (hosted ? HOSTED_INSTRUCTIONS : '') +
              'For creation in the user’s workspace, use the user’s own generation account. ' +
              'Verify get_profile matches the intended registration account, especially after adding or switching connected accounts. ' +
              'Call this cloud connector’s check_creation_readiness before first generation, ' +
              'after a workspace restart and before registration. It checks account access; ' +
              'generation and display still require actual host evidence. ' +
              'Do not run local stdio login or ask for a PC to authenticate cloud registration. Do not generate merely to test access. ' +
              'Require the user’s final registration request and preserve motion review boundaries. ' +
              'Use host file attachments for fighter.json and WebP assets. ' +
              'When file inputs are exposed as paths, pass existing absolute workspace paths; the host uploads them. ' +
              'For existing Library or Page files use the host’s supported file materialization or original-byte read tools and verify ' +
              'size and SHA-256 before submission. Never substitute rendered previews or invent file IDs, URLs or hashes. ' +
              'A VM direct-network denial does not establish failure of the native connector; ' +
              'use the supported host file route without bypassing network policy. Never ask for tokens or callback URLs in chat. ' +
              'A refused ODDBOUT sign-in (401 invalid_token) states its reason: tell the user that reason; it is not an outage, and when it asks ' +
              'to reconnect ODDBOUT in the connector settings, scheduled retries cannot fix it. Only a 503 asks for a retry. ' +
              'A queued submission is not registered; inspect its status. Reuse one UUID for retries of identical bytes.',
          ),
      // A 2026-07-28 client may keep the list and the discovery answer for five minutes (the SDK's default is 0: ask every time). At an
      // address the list is the same for every caller, signed in or not, and changes only with a deploy; private, since editions differ by address.
      cacheHints: { 'tools/list': LIST_CACHE, 'server/discover': LIST_CACHE },
    },
  );
  // The existing API runs in-process with an identity bound to this verified request.
  const scoped = identity ? scopedDatabase(db, identity.owner) : null;
  const gameLauncher = directory ? null : configuredGameLauncher(gameLauncherConfig);
  // The workshop labels what this client writes (made with); the in-process API takes its OAuth client from the verified token only.
  const api = createHandler({
    db: scoped ?? db,
    agentClient: identity?.claims.client_id ?? null,
    embed: { enabled: Boolean(gameLauncher), ...(gameLauncher ? { gameOrigin: gameLauncher.origin } : {}) },
  });
  /** @type {Invoke} */
  const invoke = async (path, method = 'GET', body, headers = {}) => {
    // The request id rides along, so an API failure's line (logFailure) names the call that made it.
    const response = await api(
      new Request(`https://internal.invalid/ai-fighter/${path}`, {
        method,
        headers: {
          authorization: 'Bearer internal-request-identity',
          ...(call.requestId ? { 'x-request-id': call.requestId } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body }),
      }),
    );
    return response.json();
  };
  // Which agent made a submission (`af_record_submission_agent`, 2026-10-27): the roster shows a fighter's maker. Never fails the call.
  /** @type {RecordAgent} */
  const recordAgent = async submissionId => {
    if (!identity || !UUID.test(submissionId ?? '')) return;
    // The maker is a label, not a gate: a failure (an `{ error }` answer, or a throw) leaves one log line and the call goes on.
    const recorded = await Promise.resolve()
      .then(() => db.rpc('af_record_submission_agent', { p_owner: identity.owner, p_submission: submissionId, p_client: identity.claims.client_id }))
      .catch(caught => ({ error: caught }));
    if (recorded?.error) logSkipped('mcp', 'record-agent', recorded.error);
  };
  // A write states whether repeating it with the same arguments is safe (idempotentHint). It once defaulted to yes, and three tools that
  // make something new on every call told retrying clients they could repeat them (MCP 점검 2026-10-29).
  /** @type {Register} */
  const registerTool = (
    name,
    title,
    description,
    inputSchema,
    run,
    {
      write = false,
      publish = false,
      openWorld = false,
      idempotent = write ? undefined : true,
      files = [],
      profile = false,
      publicTool = false,
      diagnostic = false,
      logAs,
      uiResourceUri,
      uiVisibility,
    } = {},
  ) => {
    if (typeof idempotent !== 'boolean') throw Error(`${name}: a write tool states idempotent`);
    // Register types each tool's args; the SDK parses them with inputSchema before run sees them.
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: z.object(/** @type {z.ZodRawShape} */ (inputSchema)),
        ...(profile ? { outputSchema: z.object({ id: z.string().min(1), email: z.string().optional(), nickname: z.string().optional() }).strict() } : {}),
        // The directory edition repeats the title among the annotations, where Anthropic's tool checklist looks for it with the hints.
        annotations: {
          ...(directory ? { title } : {}),
          ...READ,
          readOnlyHint: !write,
          openWorldHint: openWorld,
          destructiveHint: publish,
          idempotentHint: idempotent,
        },
        ...(openaiMeta
          ? {
              _meta: {
                securitySchemes: publicTool ? [{ type: 'noauth' }] : AUTH,
                ...componentToolMetadata(uiResourceUri, uiVisibility),
                ...(name === 'get_hosted_fighter' && hosted ? { ui: { resourceUri: LOOK_UI }, 'openai/outputTemplate': LOOK_UI } : {}),
                ...(files.length ? { 'openai/fileParams': files } : {}),
                ...(profile ? { 'openai/profile': true } : {}),
              },
            }
          : {}),
      },
      async (/** @type {Record<string, unknown>} */ args, /** @type {import('@modelcontextprotocol/server').ServerContext | undefined} */ ctx) => {
        /**
         * The result as this host reads it. A host other than ChatGPT reads the text, which holds the whole JSON: the same value again as
         * structuredContent doubled every result it got (MCP 최적화 2026-11-05). ChatGPT reads the structured result beside its short text, and
         * a tool with an outputSchema (get_profile) must send it.
         * @param {Record<string, unknown>} value @param {boolean} [short]  compactText, for ChatGPT's answer
         */
        const reply = (value, short = false) => {
          const result = output(value, short);
          return host.compact === true || profile ? result : { content: result.content, ...(result.isError ? { isError: true } : {}) };
        };
        if (!publicTool && !identity)
          return {
            ...reply({ ok: false, code: 'authentication-required' }),
            _meta: { 'mcp/www_authenticate': [`Bearer resource_metadata="${CLOUD_RESOURCE}/.well-known/oauth-protected-resource"`] },
          };
        const started = Date.now(),
          signals = [ctx?.mcpReq?.signal, call.signal].filter(signal => signal !== undefined);
        // The SDK's signal ends with a cancellation; the request's, when the client goes away (2026-07-28 reads a closed stream as one).
        /** @type {import('./cloud/common.mjs').ToolContext} */
        const context = {
          signal: signals.length ? AbortSignal.any(signals) : new AbortController().signal,
          deadline: call.deadline ?? started + CALL_BUDGET_MS,
          ...(call.legacy ? { legacy: true } : {}),
        };
        /** @type {Record<string, unknown>} */
        let value;
        /** @type {unknown} */
        let failure;
        try {
          value = await run(/** @type {Parameters<typeof run>[0]} */ (args), context);
        } catch (error) {
          failure = error;
          value = { ok: false, code: error instanceof Problem ? error.message : 'cloud-operation-unavailable' };
        }
        const uiMeta = typeof value._uiMeta === 'object' && value._uiMeta !== null ? value._uiMeta : null;
        if (uiMeta) {
          value = { ...value };
          delete value._uiMeta;
        }
        logCall({ tool: logAs ? logAs(args) : name, via: name, edition, client: identity?.claims.client_id ?? null, call, started, value, failure });
        if (failure !== undefined) return reply(value);
        if (name === 'get_hosted_fighter' && identity && value.ok === true) {
          const looks = await hostedCandidateImages(/** @type {Parameters<typeof hostedCandidateImages>[0]} */ (value.job), fetcher, context);
          const sheet = await hostedMotionSheetImage(/** @type {Parameters<typeof hostedMotionSheetImage>[0]} */ (value), fetcher, context);
          const motionSheet = value.motionSheet;
          if (motionSheet && Object.prototype.hasOwnProperty.call(motionSheet, 'attach')) {
            const { attach, ...rest } = /** @type {{ attach?: boolean }} */ (motionSheet);
            void attach;
            value = { ...value, motionSheet: rest };
          }
          if (looks.length || sheet.length) {
            const answer = reply(
              {
                ...value,
                ...(looks.length ? { previewPair: true } : {}),
                ...(sheet.length ? { motionSheetInline: true } : {}),
                next:
                  (looks.length
                    ? 'The read-only comparison shows the original fronts A and B in hosts with app UI. ' +
                      'Do not claim the user saw them solely because the tool returned images. '
                    : '') + String(value.next ?? ''),
              },
              host.compact === true,
            );
            return { ...answer, content: [...answer.content, ...looks, ...sheet] };
          }
        }
        const result = reply(value, host.compact === true);
        // A diagnostic failure is useful data; keep it readable by hosts that throw away tool errors.
        const withUiMeta = uiMeta ? { ...result, _meta: uiMeta } : result;
        return (typeof diagnostic === 'function' ? diagnostic(args) : diagnostic) ? { ...withUiMeta, isError: false } : withUiMeta;
      },
    );
  };
  // The directory edition registers only its tools, under their titles there; any other is unknown to it, not refused. The full edition
  // merges read tools of one kind into one tool with a view (cloud/merged-tools.mjs), registered once every family has registered.
  const merging = directory ? null : mergingRegister(/** @type {import('./cloud/merged-tools.mjs').RegisterAny} */ (/** @type {unknown} */ (registerTool)));
  /** @type {Register} */
  const register = merging
    ? merging.register
    : (name, title, description, inputSchema, run, options) => {
        const directoryTitle = DIRECTORY_TITLES.get(name);
        if (directoryTitle) registerTool(name, directoryTitle, DIRECTORY_DESCRIPTIONS.get(name) ?? description, inputSchema, run, options);
      };
  registerRegistrationTools({ register, db, identity, invoke, fetcher, recordAgent, hosted: Boolean(hosted) && !directory, directory, uploads: fileHost });
  registerPackagingPreparation({ register, invoke });
  registerProfileSetTools({ register, db, identity, invoke, fetcher });
  // 에이전트 도구 (3단계, 2026-10-27): read ODDBOUT's records, spar, enter cups and tune the fighting style. Listed only with the arena key.
  if (arena?.url && arena?.key) {
    registerAgentTools({ register, arena, db, identity, invoke, recordAgent, caller: host.caller ?? null, directory, uploads: fileHost });
    registerWorkshopTools({ register, arena, invoke, separateWrites: directory });
  }
  if (hosted && !directory) {
    registerLookUi(server);
    registerHostedTools({ register, db, identity, invoke, fetcher, hosted, uploads: fileHost });
  }
  if (gameLauncher) {
    registerGameLauncherUi(server, gameLauncher);
    registerGameLauncherTools(register, gameLauncher, args => {
      if (!identity) throw new Problem(401, 'authentication-required');
      return issueEmbedLaunchGrant({
        db: scoped ?? db,
        identity,
        attemptId: args.attemptId,
        challenge: args.challenge,
        gameOrigin: gameLauncher.origin,
        enabled: true,
      });
    });
  }
  registerFileInputProbe({ register, fileSchema: FILE, identity, downloadFile: downloadHostFile, fetcher });
  registerCreatorSources({ register, fileSchema: FILE, identity, db, downloadFile: downloadHostFile, fetcher });
  merging?.finish();
  return server;
}

/**
 * Where a request goes: its route under the function, whether it came to the sign-in-first address, its edition, and the resource its OAuth
 * metadata names (the sign-in-first or directory address, the public address the gateway says it came through, or the function's own).
 * @param {Request} request
 * @returns {{ route: string, signInFirst: boolean, edition: 'full' | 'directory', resource: string }}
 */
function routeOf(request) {
  // The Edge gateway may strip /functions/v1 and replace the origin before forwarding.
  const segments = new URL(request.url).pathname.split('/').filter(Boolean),
    prefix = segments.indexOf('ai-fighter-mcp');
  const path = prefix < 0 ? segments : segments.slice(prefix + 1),
    signInFirst = path[0] === 'signin',
    directory = path[0] === 'claude';
  const requestedResource = request.headers.get('x-oddbout-public-resource') ?? '';
  const resource = signInFirst
    ? requestedResource === PUBLIC_SIGN_IN_RESOURCE
      ? PUBLIC_SIGN_IN_RESOURCE
      : SIGN_IN_RESOURCE
    : directory
      ? requestedResource === PUBLIC_DIRECTORY_RESOURCE
        ? PUBLIC_DIRECTORY_RESOURCE
        : DIRECTORY_RESOURCE
      : [PUBLIC_RESOURCE, LEGACY_PUBLIC_RESOURCE].includes(requestedResource)
        ? requestedResource
        : CLOUD_RESOURCE;
  return { route: (signInFirst || directory ? path.slice(1) : path).join('/'), signInFirst, edition: directory ? 'directory' : 'full', resource };
}

/**
 * A request's sign-in at its edition; a check that throws is a server fault, not a refused token.
 * @param {any} db @param {Request} request @param {'full' | 'directory'} edition
 * @returns {Promise<SignIn>}
 */
const signInOf = (db, request, edition) =>
  authenticateCloud(db, request, Date.now, edition).catch(() => ({ identity: null, problem: 'sign-in-check-unavailable' }));

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
  if (signInFirst || (tool !== null && !PUBLIC_TOOLS.has(tool))) return signInOf(db, request, edition);
  if (OWNER_BUDGET_TOOLS.has(/** @type {string} */ (memberOf(tool, body.params?.arguments))) && request.headers.has('authorization')) {
    return { identity: (await signInOf(db, request, edition)).identity };
  }
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
 * The tool list as hosts read it. The SDK serializes custom auth metadata only in _meta: publish the current host's top-level contract too
 * (OpenAI's, so only where the tools carry it: the full edition, /mcp and /signin).
 * Every schema names its JSON Schema draft (1.1 KB of each list, every conversation); hosts do not need it.
 * @param {any} result
 */
function publishedToolList(result) {
  for (const tool of result.result?.tools ?? []) {
    if (tool._meta?.securitySchemes) tool.securitySchemes = tool._meta.securitySchemes;
    delete tool.inputSchema?.$schema;
    delete tool.outputSchema?.$schema;
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
 * @param {{enabled?: boolean, gameUrl?: string} | null} [options.gameLauncherConfig]
 * @param {number} [options.budgetMs]  one call's budget from its arrival (CALL_BUDGET_MS; shorter in tests)
 * @param {(line: string) => void} [options.log]  where each MCP request's line goes (console.log)
 * @returns {(request: Request) => Promise<Response>}
 */
export function createCloudHandler({
  db,
  fetcher = fetch,
  arena = null,
  hosted = null,
  gameLauncherConfig = null,
  budgetMs = CALL_BUDGET_MS,
  log = console.log,
}) {
  const serve = mcpServing(65536);
  /**
   * One line per MCP request (MCP 최적화 2026-11-05): the address it came to, its method, tool and edition, whether the host got ChatGPT's
   * short text, and the status, bytes and time of the answer — the bytes are what the hosts' polling costs. Never the token, the account,
   * the arguments or a URL. Every POST at an MCP address leaves one, a refused origin's too (MCP 리뷰 2026-11-05); a request that is no MCP
   * message (the metadata, a preflight, a probe, an unknown path) leaves none; a stream, which no tool sends, is passed on uncounted.
   */
  return async request => {
    const started = Date.now(),
      seen = /** @type {{ line?: RequestLine }} */ ({});
    const response = await respond(request, started, seen);
    if (!seen.line) return response;
    const counted =
      response.body === null
        ? new Uint8Array()
        : (response.headers.get('content-type') ?? '').startsWith('application/json')
          ? new Uint8Array(await response.arrayBuffer())
          : null;
    log(JSON.stringify({ mcp: 1, ...seen.line, status: response.status, bytes: counted?.length ?? null, ms: Date.now() - started }));
    return counted === null || response.body === null
      ? response
      : new Response(counted.length ? counted : null, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  /**
   * The request path.
   * @param {Request} request @param {number} started @param {{ line?: RequestLine }} seen  filled in for a POST at an MCP address
   * @returns {Promise<Response>}
   */
  async function respond(request, started, seen) {
    const { route, signInFirst, edition, resource } = routeOf(request);
    if (route === '.well-known/oauth-protected-resource' && request.method === 'GET')
      return json({
        resource,
        authorization_servers: [CLOUD_ISSUER],
        scopes_supported: ['openid', 'email', 'profile'],
        ...(edition === 'directory'
          ? { resource_name: 'ODDBOUT', resource_documentation: DIRECTORY_DOCUMENTATION }
          : { resource_name: 'ODDBOUT character registration', resource_documentation: 'https://oddbout.com/docs.html' }),
      });
    if (route) return json({ error: 'not_found' }, 404);
    /** @type {RequestLine} */
    const line = { route: signInFirst ? 'signin' : edition === 'directory' ? 'claude' : 'mcp', edition, method: null, tool: null, compact: false };
    if (request.method === 'POST') seen.line = line;
    const origin = request.headers.get('origin');
    if (origin !== null && !ALLOWED_ORIGINS.has(origin)) return json({ error: 'origin_not_allowed' }, 403);
    if (request.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': origin ?? 'https://chatgpt.com',
          'access-control-allow-methods': 'POST, GET, OPTIONS',
          // Mcp-Method and Mcp-Name: every 2026-07-28 request carries them.
          'access-control-allow-headers': 'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name',
          'access-control-expose-headers': 'WWW-Authenticate',
        },
      });
    /**
     * A call without a sign-in says why (RFC 6750): a token it refused is named `invalid_token` with the reason, so the agent can tell its
     * user instead of guessing at an outage (Grok Bot, 2026-10-31); a call with no token is only asked to sign in. The challenge keeps
     * its earlier start for clients that read it by prefix. A check that could not run is a 503 to retry, never a 401 that sends the
     * client back to its sign-in. A lapsed sign-in also names the page its user reconnects from (`error_uri`, and `reconnect_url`).
     * @param {keyof typeof SIGN_IN_PROBLEMS} problem
     */
    const signInProblem = problem => {
      const error_description = SIGN_IN_PROBLEMS[problem],
        page = RECONNECT_PAGES[problem];
      if (problem === 'sign-in-check-unavailable') {
        return json({ error: 'temporarily_unavailable', code: problem, error_description }, 503, { 'retry-after': '30' });
      }
      const refused =
        problem === 'authentication-required' ? '' : `, error="invalid_token", error_description="${error_description}"${page ? `, error_uri="${page}"` : ''}`;
      return json({ error: 'invalid_token', code: problem, error_description, ...(page ? { reconnect_url: page } : {}) }, 401, {
        'www-authenticate': `Bearer resource_metadata="${resource}/.well-known/oauth-protected-resource", scope="openid email profile"${refused}`,
      });
    };
    if (request.method !== 'POST') {
      // A client that probes the sign-in-first address with GET, or HEAD as Gemini CLI does first (2026-10-29), learns there that it needs a sign-in.
      if (signInFirst && ['GET', 'HEAD'].includes(request.method)) {
        const { problem } = await signInOf(db, request, edition);
        if (problem) return signInProblem(problem);
      }
      return json({ error: 'method_not_allowed' }, 405, { allow: 'POST, OPTIONS' });
    }
    let body;
    try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 65536)));
    } catch {
      return json({ error: 'invalid_request' }, 400);
    }
    if (!body || Array.isArray(body) || typeof body.method !== 'string') return json({ error: 'invalid_request' }, 400);
    line.method = body.method.slice(0, 80);
    if (body.method === 'tools/call' && typeof body.params?.name === 'string') line.tool = body.params.name.slice(0, 80);
    // A merged-away tool's own name (a host's older list) is its merged tool's view; the request line keeps the name the host called.
    const aliased = edition === 'full' ? aliasCall(body) : body,
      legacy = aliased !== body;
    body = aliased;
    // Whether the host is ChatGPT is the body's to say, not the sign-in's: its refused calls are named so too (MCP 리뷰 2026-11-05).
    const host = await hostOf(body);
    line.compact = host.compact;
    const { identity, problem } = await identityFor(db, request, body, signInFirst, edition);
    if (problem) return signInProblem(problem);
    // A server per request on purpose: its tools close over this request's verified identity, so no state can carry one
    // user's identity into another's call. Measured 2026-10-28: building it with all tools and answering tools/list
    // takes about 1.8 ms, small beside the network hop, so sharing a server is not worth that guarantee.
    // A UUID request id (the gateway makes one per call; a caller at the function's own address may send its own: it only joins log lines),
    // else one of our own. The version a client says it speaks, as a date only.
    const given = request.headers.get('x-request-id') ?? '',
      version = request.headers.get('mcp-protocol-version') ?? '';
    /** @type {Call} */
    const call = {
      requestId: UUID.test(given) ? given.toLowerCase() : crypto.randomUUID(),
      protocol: /^\d{4}-\d{2}-\d{2}$/.test(version) ? version : null,
      signal: request.signal,
      deadline: started + budgetMs,
      ...(legacy ? { legacy } : {}),
    };
    /** @type {Parameters<typeof cloudServer>[0]} */
    const options = { db, identity, fetcher, arena, hosted, gameLauncherConfig, host, edition, call };
    try {
      const response = await serve(cloudServer(options), request, body);
      if (body.method === 'tools/list' && response.status === 200) return json(publishedToolList(await response.json()));
      return response;
    } catch (error) {
      console.error(
        JSON.stringify({
          stage: 'mcp-call',
          method: String(body.method).slice(0, 80),
          edition,
          protocol: call.protocol,
          requestId: call.requestId,
          ms: Date.now() - started,
          ok: false,
          code: 'mcp_unavailable',
          ...failureDetail(error),
        }),
      );
      return json({ error: 'mcp_unavailable' }, 503);
    }
  }
}
