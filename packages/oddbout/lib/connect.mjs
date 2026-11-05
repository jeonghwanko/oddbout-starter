// @ts-check
/**
 * `npx -y oddbout@latest connect` connects a terminal agent (Claude Code, Codex, Gemini CLI) to ODDBOUT's hosted MCP in one command, the way
 * ElevenLabs' agent onboarding does: the agent runs it and follows the one JSON reply it prints on stdout ({ status, next, say, run, rules,
 * verify, details }). The host's own CLI adds the server and runs the OAuth sign-in (dynamic client registration + PKCE against ODDBOUT's
 * Supabase Auth), so this tool never sees, receives or writes a token. It reads the hosts' config files only to find an ODDBOUT server that
 * is already there, and changes them only through the hosts' own commands. It never removes or edits a server that is already there.
 */
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const VERSION = /** @type {string} */ (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
export const SERVER_NAME = 'oddbout';
/**
 * The sign-in-first address (oddbout-starter `mcp/cloud/resources.mjs` PUBLIC_SIGN_IN_RESOURCE, a test keeps the two equal). Every request
 * without a sign-in gets a 401 with `WWW-Authenticate`, so each terminal client knows to sign in; its protected-resource metadata sits at
 * our host's root too (RFC 9728), and the Cloudflare gateway in front of it sends MCP requests straight to the Supabase function.
 */
export const SIGN_IN_URL = 'https://mcp.oddbout.com/signin';
export const COMMAND = 'npx -y oddbout@latest';
const SUPABASE_FUNCTION = 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter-mcp';
const REPOSITORY = 'jeonghwanko/oddbout-starter';
const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;
const DOCS = `${REPOSITORY_URL}/blob/main/docs/CLOUD-MCP.md#한-줄로-연결하기-2026-11-05`;
/** The skills-only package Codex and Claude Code install from this repository (plugins/oddbout-codex); it declares no MCP server. */
const PLUGIN = 'oddbout@oddbout';

/** @typedef {'claude-code' | 'codex' | 'gemini-cli'} Host */
/** @typedef {'sign-in-first' | 'public' | 'directory'} AddressKind */
/** @typedef {'signed-in' | 'not-signed-in' | 'unknown'} Auth */
/** @typedef {{ name: string, url: string, scope: string, auth: Auth }} Server */
/** @typedef {Record<string, string | undefined>} Env */
/** @typedef {'done' | 'not-needed' | 'needed' | 'timed-out' | 'failed' | 'remote' | 'in-session' | 'unsupported' | 'skipped' | 'unknown'} SignIn */
/**
 * @typedef {{ state: 'present' | 'added' | 'would-add' | 'conflict' | 'failed', server: Server | null, others: Server[], signIn: SignIn,
 *   error?: string }} ServerResult
 */
/** @typedef {{ code: number | null, stdout: string, stderr: string, timedOut: boolean, seconds: number, error?: string }} RunResult */
/** @typedef {{ command: string, exitCode: number | null, seconds: number, timedOut?: boolean, output?: string, terminal?: boolean }} Action */
/**
 * @typedef {{ state: 'present' | 'installed' | 'would-install' | 'skipped' | 'not-offered' | 'other-marketplace' | 'failed', plugin?: string,
 *   reason?: string }} SkillResult
 */

/** @type {Readonly<Record<Host, { bin: string, label: string }>>} */
export const HOSTS = {
  'claude-code': { bin: 'claude', label: 'Claude Code' },
  codex: { bin: 'codex', label: 'Codex' },
  'gemini-cli': { bin: 'gemini', label: 'Gemini CLI' },
};
/** @type {Readonly<Record<string, Host>>} */
const HOST_NAMES = { claude: 'claude-code', 'claude-code': 'claude-code', codex: 'codex', gemini: 'gemini-cli', 'gemini-cli': 'gemini-cli' };
/** Set in the commands Codex runs (codex-rs: thread, tool call and sandbox variables; the npm launcher's own marker). */
const CODEX_MARKERS = ['CODEX_THREAD_ID', 'CODEX_TOOL_CALL_ID', 'CODEX_SESSION_ID', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED',
  'CODEX_MANAGED_BY_NPM'];

/** ODDBOUT's MCP addresses: the sign-in-first and public ones are the full server; the directory edition cannot make fighters. */
/** @type {ReadonlyMap<string, AddressKind>} */
const ADDRESSES = new Map([
  [SIGN_IN_URL, 'sign-in-first'], [`${SUPABASE_FUNCTION}/signin`, 'sign-in-first'],
  ['https://mcp.oddbout.com/mcp', 'public'], [SUPABASE_FUNCTION, 'public'], ['https://ai-fighter-validator.onrender.com/mcp', 'public'],
  ['https://mcp.oddbout.com/claude', 'directory'], [`${SUPABASE_FUNCTION}/claude`, 'directory'],
]);
/** @param {unknown} url @returns {AddressKind | null} */
export function addressKind(url) {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    return ADDRESSES.get(`${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`) ?? null;
  } catch { return null; }
}

/** @param {Env} env @returns {{ host: Host | null, markers: Host[] }} */
export function detectHost(env) {
  /** @type {Host[]} */
  const markers = [];
  if (env.CLAUDECODE === '1') markers.push('claude-code');
  if (CODEX_MARKERS.some(name => env[name])) markers.push('codex');
  if (env.GEMINI_CLI === '1') markers.push('gemini-cli');
  return { host: markers.length === 1 ? markers[0] : null, markers };
}

/**
 * Whether a browser here can reach this machine's loopback sign-in callback. Over SSH, in a container or on a Linux machine with no display
 * it cannot, unless an editor forwards it (VS Code Remote and Codespaces set BROWSER to a helper that opens the local browser and forward
 * the callback port).
 * @param {Env} env @param {NodeJS.Platform} platform @param {(file: string) => boolean} exists
 * @returns {{ remote: boolean, reasons: string[] }}
 */
export function detectRemote(env, platform, exists) {
  const reasons = [];
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) reasons.push('ssh');
  if (env.CODESPACES === 'true' || env.REMOTE_CONTAINERS || env.GITPOD_WORKSPACE_ID || exists('/.dockerenv') || exists('/run/.containerenv')) {
    reasons.push('container');
  }
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY && !env.WSL_DISTRO_NAME && !env.BROWSER) reasons.push('no-display');
  const bridged = /vscode|code-server|helpers[\\/]browser/i.test(env.BROWSER ?? '');
  return { remote: reasons.length > 0 && !bridged, reasons };
}

/**
 * Which server to use: an ODDBOUT server of the full edition already there (any name, the sign-in-first address first), else a new one
 * under `name`, unless another server already has that name.
 * @param {Server[]} servers @param {string} name
 * @returns {{ action: 'reuse' | 'add' | 'conflict', server: Server | null, others: Server[] }}
 */
export function planServer(servers, name) {
  const rank = (/** @type {Server} */ server) => (addressKind(server.url) === 'sign-in-first' ? 0 : 2) + (server.name === name ? 0 : 1);
  const full = servers.filter(server => ['sign-in-first', 'public'].includes(addressKind(server.url) ?? '')).sort((a, b) => rank(a) - rank(b));
  const chosen = full[0] ?? servers.find(server => server.name === name) ?? null;
  const others = servers.filter(server => server !== chosen && addressKind(server.url));
  if (full[0]) return { action: 'reuse', server: full[0], others };
  return chosen ? { action: 'conflict', server: chosen, others } : { action: 'add', server: null, others };
}

/** Comments are allowed in Gemini CLI's settings.json. @param {string} text */
export function stripJsonComments(text) {
  let out = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (quoted) {
      out += c;
      if (c === '\\') { out += next ?? ''; i++; } else if (c === '"') quoted = false;
    } else if (c === '"') { quoted = true; out += c; } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else out += c;
  }
  return out;
}

/** @param {string} file */
function isFile(file) {
  try { return statSync(file).isFile(); } catch { return false; }
}
/** @param {string} file @param {boolean} [comments] @returns {{ value: any, error: string | null }} */
function readJson(file, comments = false) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (/** @type {any} */ error) {
    return error?.code === 'ENOENT' ? { value: {}, error: null } : { value: {}, error: `${file}: ${error?.message ?? error}` };
  }
  if (!text.trim()) return { value: {}, error: null };
  try { return { value: JSON.parse(comments ? stripJsonComments(text) : text), error: null }; } catch (/** @type {any} */ error) {
    return { value: {}, error: `${file}: ${error?.message ?? error}` };
  }
}
/** @param {unknown} map @param {string} scope @returns {Server[]} */
function configServers(map, scope) {
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map).flatMap(([name, entry]) => {
    const url = entry && typeof entry === 'object' ? entry.url ?? entry.httpUrl ?? entry.serverUrl : null;
    return typeof url === 'string' ? [{ name, url, scope, auth: /** @type {Auth} */ ('unknown') }] : [];
  });
}
/** @param {string} a @param {string} b */
function samePath(a, b) {
  const norm = (/** @type {string} */ value) => {
    const resolved = path.resolve(value).replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return norm(a) === norm(b);
}

/** @param {string} name @param {Env} env @param {NodeJS.Platform} platform @returns {string | null} */
export function findExecutable(name, env, platform) {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const extensions = platform === 'win32' ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const dir of dirs) for (const extension of extensions) {
    const file = path.join(dir, name + extension.toLowerCase());
    if (isFile(file)) return file;
    if (extension && isFile(path.join(dir, name + extension))) return path.join(dir, name + extension);
  }
  return null;
}

/** Arguments reach cmd.exe on Windows (npm installs the hosts as .cmd shims), so only plain characters are passed. */
const SAFE_ARG = /^[A-Za-z0-9_@:/.=#,+-]+$/;
const OUTPUT_LIMIT = 8 * 1024 * 1024;
/**
 * A host command's stdio. `terminal` hands it this process's terminal: stdin as it is, and its output straight to our stderr, so stdout
 * keeps only the JSON reply. Claude Code's `mcp login` refuses to start without a terminal on stdin ("stdin isn't a terminal", 2.1.283,
 * reproduced 2026-11-05), even in its browser mode; every other command runs detached from the terminal with its output captured.
 * @param {boolean} terminal @returns {import('node:child_process').StdioOptions}
 */
export function spawnStdio(terminal) {
  return terminal ? ['inherit', 2, 2] : ['ignore', 'pipe', 'pipe'];
}

/**
 * @param {string} file @param {string[]} args
 * @param {{ env: Env, cwd: string, timeoutMs: number, echo?: boolean, terminal?: boolean }} options
 * @returns {Promise<RunResult>}
 */
export function runCommand(file, args, { env, cwd, timeoutMs, echo = false, terminal = false }) {
  for (const arg of args) if (!SAFE_ARG.test(arg)) throw new Error(`Refusing an argument with special characters: ${arg}`);
  const windows = process.platform === 'win32', started = Date.now();
  return new Promise(resolve => {
    let stdout = '', stderr = '', timedOut = false, done = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    /** @param {number | null} code @param {string} [error] */
    const finish = (code, error) => {
      if (done) return;
      done = true; clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, seconds: Math.round((Date.now() - started) / 100) / 10, ...(error ? { error } : {}) });
    };
    /** @type {import('node:child_process').ChildProcess} */
    let child;
    try {
      child = spawn(windows ? `"${file}"` : file, args, { cwd, env, shell: windows, windowsHide: true, stdio: spawnStdio(terminal) });
    } catch (/** @type {any} */ error) { finish(null, String(error?.message ?? error)); return; }
    timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    child.stdout?.on('data', chunk => { if (stdout.length < OUTPUT_LIMIT) stdout += chunk; if (echo) process.stderr.write(chunk); });
    child.stderr?.on('data', chunk => { if (stderr.length < OUTPUT_LIMIT) stderr += chunk; if (echo) process.stderr.write(chunk); });
    child.on('error', error => finish(null, error.message));
    child.on('close', code => finish(code));
  });
}
/** A Windows shim runs the host under cmd.exe: end the whole tree, or a login keeps its callback port. @param {import('node:child_process').ChildProcess} child */
function killTree(child) {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
  } else child.kill('SIGTERM');
}

/** The last lines of a command's output, with URL queries (codes, states) and anything token-like hidden. @param {RunResult} result */
function outputTail(result) {
  return `${result.stdout}\n${result.stderr}${result.error ? `\n${result.error}` : ''}`.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .slice(-6).join('\n').replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, '$1?…').replace(/\b(eyJ[\w-]{10,}|[A-Za-z0-9_-]{40,})\b/g, '…');
}

/**
 * @typedef {{
 *   host: Host, bin: string, env: Env, cwd: string, mutate: boolean, remote: boolean, interactive: boolean, waitMs: number,
 *   actions: Action[], notes: string[],
 *   run: (args: string[], options?: { timeoutMs?: number, echo?: boolean, terminal?: boolean, record?: boolean }) => Promise<RunResult>
 * }} Context
 */

/** @param {RunResult} result @returns {any} */
function parseJson(result) {
  if (result.code !== 0) return null;
  try { return JSON.parse(result.stdout); } catch {
    const start = result.stdout.search(/[[{]/);
    try { return start < 0 ? null : JSON.parse(result.stdout.slice(start)); } catch { return null; }
  }
}

// ---- Listing what is already there -------------------------------------------------------------------------------------------------

/** @param {Context} ctx @returns {Promise<{ servers: Server[], error?: string }>} */
async function listServers(ctx) {
  if (ctx.host === 'codex') {
    const result = await ctx.run(['mcp', 'list', '--json'], { timeoutMs: 30_000 });
    const list = parseJson(result);
    if (!Array.isArray(list)) return { servers: [], error: `codex mcp list --json failed: ${outputTail(result) || 'no JSON'}` };
    return { servers: list.flatMap(entry => {
      const url = entry?.transport?.url;
      if (typeof url !== 'string' || typeof entry.name !== 'string') return [];
      /** @type {Auth} */
      const auth = entry.auth_status === 'o_auth' ? 'signed-in' : entry.auth_status === 'not_logged_in' ? 'not-signed-in' : 'unknown';
      return [{ name: entry.name, url, scope: entry.enabled === false ? 'user (disabled)' : 'user', auth }];
    }) };
  }
  if (ctx.host === 'claude-code') {
    const file = path.join(ctx.env.CLAUDE_CONFIG_DIR || homedir(), '.claude.json');
    const config = readJson(file);
    if (config.error) return { servers: [], error: `could not read ${config.error}` };
    const servers = configServers(config.value.mcpServers, 'user');
    for (const [key, project] of Object.entries(config.value.projects ?? {})) {
      if (samePath(key, ctx.cwd)) servers.push(...configServers(project?.mcpServers, 'local'));
    }
    servers.push(...configServers(readJson(path.join(ctx.cwd, '.mcp.json')).value.mcpServers, 'project'));
    return { servers };
  }
  const user = readJson(path.join(ctx.env.GEMINI_CLI_HOME || homedir(), '.gemini', 'settings.json'), true);
  // `gemini mcp add` replaces a server of the same name without asking, so an unreadable settings file stops the step.
  if (user.error) return { servers: [], error: `could not read ${user.error}` };
  const project = readJson(path.join(ctx.cwd, '.gemini', 'settings.json'), true);
  return { servers: [...configServers(user.value.mcpServers, 'user'), ...configServers(project.value.mcpServers, 'project')] };
}

/** Claude Code's own health check: `claude mcp get` connects with the stored sign-in. @param {Context} ctx @param {Server} server @returns {Promise<Auth>} */
async function claudeAuth(ctx, server) {
  const status = /Status:\s*(.+)/i.exec((await ctx.run(['mcp', 'get', server.name], { timeoutMs: 45_000 })).stdout)?.[1] ?? '';
  if (/needs authentication/i.test(status)) return 'not-signed-in';
  // The public address answers signed out, so a connection there says nothing about the sign-in.
  if (/connected/i.test(status) && !/fail|not connected/i.test(status)) return addressKind(server.url) === 'sign-in-first' ? 'signed-in' : 'unknown';
  return 'unknown';
}

// ---- The creation skill --------------------------------------------------------------------------------------------------------------

/** @param {unknown} source */
function isOurRepository(source) {
  return typeof source === 'string' && /^(?:https:\/\/github\.com\/|git@github\.com:)?jeonghwanko\/oddbout-starter(?:\.git)?\/?(?:[#@].*)?$/i.test(source.trim());
}

/** @param {Context} ctx @returns {Promise<SkillResult>} */
async function ensureSkill(ctx) {
  if (ctx.host === 'gemini-cli') return { state: 'not-offered', reason: 'The kit offers its create-fighter skill to Codex and Claude Code only.' };
  const codex = ctx.host === 'codex';
  // Both hosts answer these in JSON: Codex { marketplaces: [{ name, marketplaceSource: { source } }] } and { installed: [{ pluginId }] },
  // Claude Code [{ name, repo | url }] and [{ id, scope, projectPath, enabled }].
  const markets = parseJson(await ctx.run(['plugin', 'marketplace', 'list', '--json'], { timeoutMs: 30_000 }));
  const list = Array.isArray(markets) ? markets : markets?.marketplaces;
  if (!Array.isArray(list)) return { state: 'failed', reason: `${HOSTS[ctx.host].bin} could not list plugin marketplaces (it may be too old for plugins).` };
  const market = list.find(entry => entry?.name === 'oddbout');
  const source = codex ? market?.marketplaceSource?.source : market?.repo ?? market?.url;
  if (market && !isOurRepository(source)) {
    return { state: 'other-marketplace', reason: `A plugin marketplace named "oddbout" already points to ${source ?? market.root ?? 'another source'}; left as it is.` };
  }
  const installed = async () => {
    const plugins = parseJson(await ctx.run(['plugin', 'list', '--json'], { timeoutMs: 30_000 }));
    const rows = codex ? plugins?.installed : plugins;
    // A Claude Code install scoped to another project does not load here.
    const here = (/** @type {any} */ row) => !['project', 'local'].includes(row?.scope) || (typeof row?.projectPath === 'string' && samePath(row.projectPath, ctx.cwd));
    return Array.isArray(rows) && rows.some(row => (codex ? row?.pluginId : row?.id) === PLUGIN && row?.enabled !== false && (codex || here(row)));
  };
  if (market && await installed()) return { state: 'present', plugin: PLUGIN };
  if (!ctx.mutate) return { state: 'would-install', plugin: PLUGIN };
  if (!market) {
    // Sparse and shallow: only the marketplace file and the skills package, not the whole repository.
    const add = codex
      ? ['plugin', 'marketplace', 'add', REPOSITORY_URL, '--ref', 'main', '--sparse', '.agents/plugins', '--sparse', 'plugins/oddbout-codex']
      : ['plugin', 'marketplace', 'add', `${REPOSITORY_URL}.git`, '--sparse', '.claude-plugin', 'plugins/oddbout-codex'];
    const result = await ctx.run(add, { timeoutMs: 180_000, record: true });
    if (result.code !== 0) return { state: 'failed', plugin: PLUGIN, reason: outputTail(result) };
  }
  const result = await ctx.run(codex ? ['plugin', 'add', PLUGIN] : ['plugin', 'install', PLUGIN, '--scope', 'user'], { timeoutMs: 120_000, record: true });
  if (result.code !== 0) return { state: 'failed', plugin: PLUGIN, reason: outputTail(result) };
  return { state: 'installed', plugin: PLUGIN };
}

// ---- The server and its sign-in ------------------------------------------------------------------------------------------------------

/** @param {Host} host @param {string} name */
function addArgs(host, name) {
  if (host === 'codex') return ['mcp', 'add', name, '--url', SIGN_IN_URL];
  return ['mcp', 'add', '--transport', 'http', '--scope', 'user', name, SIGN_IN_URL];
}

/**
 * @param {Context} ctx @param {string} name
 * @returns {Promise<ServerResult>}
 */
async function ensureServer(ctx, name) {
  const listed = await listServers(ctx);
  if (listed.error) return { state: 'failed', server: null, others: [], signIn: 'skipped', error: listed.error };
  const plan = planServer(listed.servers, name);
  if (plan.action === 'conflict') return { state: 'conflict', server: plan.server, others: plan.others, signIn: 'skipped' };
  let server = plan.server, state = /** @type {'present' | 'added' | 'would-add'} */ (plan.action === 'reuse' ? 'present' : 'would-add');
  /** @type {SignIn} */
  let signIn = 'unknown';
  let loginTried = false;

  if (!server && ctx.mutate) {
    // Codex signs in right after adding (codex-rs mcp_cmd: the server is saved first, then the OAuth flow waits for the browser). Where no
    // browser can return to this machine, the add is given only the time to save it.
    const codexAdd = ctx.host === 'codex';
    if (codexAdd && !ctx.remote) process.stderr.write(`Opening your browser to sign in to ODDBOUT (waiting up to ${Math.round(ctx.waitMs / 1000)}s)…\n`);
    const result = await ctx.run(addArgs(ctx.host, name), { timeoutMs: codexAdd ? (ctx.remote ? Math.min(20_000, ctx.waitMs) : ctx.waitMs) : 60_000, echo: codexAdd, record: true });
    loginTried = codexAdd && !ctx.remote;
    const again = await listServers(ctx);
    server = again.servers.find(entry => entry.name === name && addressKind(entry.url) === 'sign-in-first') ?? null;
    if (!server) {
      const error = result.code === 0 && !result.timedOut
        ? `\`${addArgs(ctx.host, name).join(' ')}\` said it worked, but ${HOSTS[ctx.host].label}'s settings${again.error ? '' : ' that I can read'} don't list \`${name}\`${again.error ? ` (${again.error})` : ''}`
        : outputTail(result) || 'the server was not saved';
      return { state: 'failed', server: null, others: plan.others, signIn: 'skipped', error };
    }
    state = 'added';
    if (codexAdd && result.timedOut && !ctx.remote) signIn = 'timed-out';
    else if (codexAdd && result.code !== 0 && !ctx.remote) signIn = 'failed';
  }
  if (!server) return { state, server: { name, url: SIGN_IN_URL, scope: 'user', auth: 'not-signed-in' }, others: plan.others, signIn: 'skipped' };

  if (ctx.host === 'claude-code') server = { ...server, auth: await claudeAuth(ctx, server) };
  if (server.auth === 'signed-in') return { state, server, others: plan.others, signIn: loginTried ? 'done' : 'not-needed' };
  if (signIn === 'timed-out' || signIn === 'failed') return { state, server, others: plan.others, signIn };
  if (ctx.host === 'gemini-cli') return { state, server, others: plan.others, signIn: 'in-session' };
  if (ctx.remote) return { state, server, others: plan.others, signIn: 'remote' };
  // A public-address server answers signed out, so whether it is signed in is unknown: get_profile tells, and its error names the fix.
  if (server.auth === 'unknown') return { state, server, others: plan.others, signIn: loginTried ? 'failed' : 'unknown' };
  if (loginTried) return { state, server, others: plan.others, signIn: 'failed' };
  // Claude Code's login needs a terminal on stdin. Run by an agent's command tool there is none, and Claude Code's own /mcp panel signs in.
  if (ctx.host === 'claude-code' && !ctx.interactive) return { state, server, others: plan.others, signIn: 'in-session' };
  if (!ctx.mutate) return { state, server, others: plan.others, signIn: 'needed' };

  if (ctx.host === 'claude-code' && (await ctx.run(['mcp', 'login', '--help'], { timeoutMs: 20_000 })).code !== 0) {
    return { state, server, others: plan.others, signIn: 'unsupported' };
  }
  process.stderr.write(`Opening your browser to sign in to ODDBOUT (waiting up to ${Math.round(ctx.waitMs / 1000)}s)…\n`);
  // Codex signs in through its browser callback with no terminal (codex-rs perform_oauth_login), so its output stays captured.
  const terminal = ctx.host === 'claude-code';
  const login = await ctx.run(['mcp', 'login', server.name], { timeoutMs: ctx.waitMs, echo: !terminal, terminal, record: true });
  if (login.timedOut) return { state, server, others: plan.others, signIn: 'timed-out' };
  if (ctx.host === 'codex') {
    const again = (await listServers(ctx)).servers.find(entry => entry.name === server?.name);
    if (again) server = again;
  } else server = { ...server, auth: await claudeAuth(ctx, server) };
  return { state, server, others: plan.others, signIn: server.auth === 'signed-in' ? 'done' : login.code === 0 ? 'unknown' : 'failed' };
}

// ---- The reply -----------------------------------------------------------------------------------------------------------------------

export const RULES = [
  'Tell the user what `say` says, in their language and your own words. Do not paste this JSON to them.',
  'Never ask the user for, accept or repeat a token, authorization code, API key or callback/redirect URL in chat. Sign-in happens only in their browser and in the agent\'s own sign-in prompt.',
  'Do not remove, rename or change an MCP server that is already configured unless the user explicitly asks you to.',
  'Run `run` only when `next` is "rerun", and only after the user agrees when `say` asks them something.',
  'The connection is confirmed only when ODDBOUT\'s get_profile returns the user\'s account in a conversation that has ODDBOUT\'s tools. A sign-in success, a tool listing or this reply is not that confirmation.',
  'Connecting does not ask you to create, generate or register a fighter. Wait for the user to ask.',
];

/** @typedef {'terminal' | 'desktop' | 'unknown'} ClaudeSurface */
/**
 * Where Claude Code runs: its terminal CLI or the Claude desktop app (Code tab). Both read ~/.claude.json and its sign-ins, but a desktop
 * session cannot take in a server added from outside ("Reconnect, enable, and disable aren't available in this session") and has no
 * `claude --continue`; a new session does, with no restart of the app (2026-11-05/06, Windows). The app's own /mcp → Connect signs in with
 * the redirect `claude://claude.ai/mcp-auth-callback/sdk` (app 4.16336.0.0, Windows), an app scheme ODDBOUT's consent page refuses
 * (`web/cloud-connect/connect.mjs` agentOf), so desktop users sign in once from a terminal. Unknown when someone runs this by hand.
 * @param {Env} env @returns {ClaudeSurface}
 */
export function claudeSurface(env) {
  if (env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop' || env.CLAUDE_CODE_DESKTOP_APP_VERSION) return 'desktop';
  return env.CLAUDECODE === '1' ? 'terminal' : 'unknown';
}

/** @param {string} name */
const terminalSignIn = name => `sign in once from a terminal (PowerShell or Terminal, not this chat): run \`claude mcp login ${name}\`, or \`${COMMAND} connect\`, and approve in your browser with Google`;
/**
 * How Claude Code takes in the new server: `load` and `signIn` for the user, `agent` for the agent.
 * @param {ClaudeSurface} surface @param {string} name
 */
function claudeSteps(surface, name) {
  const terminalLoad = `type /mcp and reconnect ${name}; if it isn't listed there, exit and run \`claude --continue\` to come back here`;
  if (surface === 'desktop') {
    return {
      load: 'The Claude app takes in a new connection in a new session: start one (no need to restart the app).',
      signIn: `${terminalSignIn(name)[0].toUpperCase()}${terminalSignIn(name).slice(1)}. Then start a new session in the Claude app (no need to restart it). The app's own /mcp → Connect does not work with ODDBOUT yet.`,
      agent: `This is the Claude desktop app: a running session cannot take in a server added from outside (/mcp reconnect is not available) and there is no \`claude --continue\`, but a new session does, without restarting the app. If ODDBOUT's tools are not available to you, ask the user to start a new session. If ${name} is not signed in, do not send them to /mcp → Connect: the app's claude:// sign-in is refused by ODDBOUT's consent page. Ask them to ${terminalSignIn(name)}, then start a new session. The new session does not carry this conversation, so tell the user to ask it to check their ODDBOUT account.`,
    };
  }
  if (surface === 'terminal') {
    return {
      load: `If I can't see ODDBOUT yet, ${terminalLoad}.`,
      signIn: `Type /mcp, choose ${name}, then Authenticate, and approve in your browser with Google. If ${name} isn't in the /mcp list yet, exit and run \`claude --continue\` first.`,
      agent: `If ODDBOUT's tools are not available to you yet, ask the user to type /mcp and reconnect ${name} there (or choose Authenticate if it asks); if ${name} is not listed, to exit and run \`claude --continue\` to reopen this conversation.`,
    };
  }
  return {
    load: 'Claude Code takes in a new connection in a new session: in a terminal, start `claude` again (`claude --continue` reopens the last conversation); in the Claude desktop app, start a new session.',
    signIn: `In the Claude Code terminal, type /mcp, choose ${name}, then Authenticate, and approve in your browser with Google (start a new session first if ${name} isn't listed). For the Claude desktop app, ${terminalSignIn(name)}, then start a new session there: the app's own /mcp → Connect does not work with ODDBOUT yet.`,
    agent: `If ODDBOUT's tools are not available to you, ask the user to start a new session (in a terminal, \`claude --continue\`). If ${name} is not signed in: in the terminal CLI, /mcp → ${name} → Authenticate; in the Claude desktop app, ${terminalSignIn(name)} (the app's own Connect is refused by ODDBOUT's consent page), then a new session.`,
  };
}

/** How the running session gets the new server and skill. @param {Host} host @param {string} name @param {ClaudeSurface} surface */
function loadHint(host, name, surface) {
  if (host === 'claude-code') return claudeSteps(surface, name).agent;
  if (host === 'codex') return 'Codex loads MCP servers and skills when a session starts: if ODDBOUT\'s tools are not available to you, ask the user to exit and run `codex resume --last` to continue this conversation with them.';
  return 'Gemini CLI loads MCP servers when it starts: if ODDBOUT\'s tools are not available to you, ask the user to restart Gemini CLI in a trusted folder.';
}

/** @param {Host} host @param {string} name @param {ClaudeSurface} surface */
function userLoad(host, name, surface) {
  if (host === 'claude-code') return claudeSteps(surface, name).load;
  if (host === 'codex') return 'Codex picks up new connections in a new session: exit and run `codex resume --last` to come back to this conversation.';
  return 'Restart Gemini CLI so it loads the connection.';
}

/** @param {SkillResult} skill @param {Host} host @param {ClaudeSurface} surface */
function skillLine(skill, host, surface) {
  if (skill.state === 'installed') {
    if (host !== 'claude-code') return 'I also installed the create-fighter skill.';
    return surface === 'desktop' ? 'I also installed the create-fighter skill; it loads in the new session.' : 'I also installed the create-fighter skill (type /reload-plugins to load it now).';
  }
  if (skill.state === 'present') return 'The create-fighter skill was already installed.';
  if (skill.state === 'failed') return 'The create-fighter skill could not be installed; the connection works without it.';
  return '';
}

/** @param {Host} host @param {string} name */
function remoteSignIn(host, name) {
  if (host === 'gemini-cli') {
    return 'This session runs on another machine (SSH or a container), and Gemini CLI signs in through a browser on the same machine. Sign in by running Gemini CLI on the computer with your browser, then type /mcp auth ' + name + '.';
  }
  const command = host === 'codex' ? `codex mcp login ${name} --no-browser` : `claude mcp login ${name} --no-browser`;
  return `This session runs on another machine (SSH or a container), so your browser can't hand the sign-in back to it. In a terminal on that machine (for SSH, \`ssh -t\`), run \`${command}\`, open the link it prints on your computer and sign in. It then asks for the address your browser ends on: paste it only into that terminal prompt, never into this chat.`;
}

/**
 * @param {{ host: Host, name: string, mode: 'connect' | 'check', remote: { remote: boolean, reasons: string[] },
 *   server: ServerResult, skill: SkillResult, ctx: Pick<Context, 'actions' | 'notes'>, binary: string, hostSource: string,
 *   surface?: ClaudeSurface }} input
 */
export function compose({ host, name, mode, remote, server, skill, ctx, binary, hostSource, surface = 'unknown' }) {
  const label = HOSTS[host].label;
  const used = server.server?.name ?? name;
  const details = {
    host, hostSource, binary, ...(host === 'claude-code' ? { surface } : {}), remote: remote.remote, remoteReasons: remote.reasons,
    server: server.server ? { ...server.server, kind: addressKind(server.server.url), state: server.state } : null,
    otherOddboutServers: server.others.map(other => ({ name: other.name, url: other.url, scope: other.scope, kind: addressKind(other.url) })),
    signIn: server.signIn, skill, actions: ctx.actions, notes: ctx.notes, docs: DOCS,
  };
  const base = { oddbout: mode, version: VERSION, host, rules: RULES, details };
  const again = `${COMMAND} connect --host ${HOSTS[host].bin}${name === SERVER_NAME ? '' : ` --name ${name}`}`;
  const verify = { tool: 'get_profile', arguments: {}, show: 'only the user\'s ODDBOUT nickname and that the connection works', ifToolsMissing: loadHint(host, used, surface) };
  const extra = [skillLine(skill, host, surface), details.otherOddboutServers.length ? `You also have ${details.otherOddboutServers.map(other => `\`${other.name}\` (${other.url})`).join(', ')}; I left ${details.otherOddboutServers.length > 1 ? 'them' : 'it'} as ${details.otherOddboutServers.length > 1 ? 'they are' : 'it is'}.` : '']
    .filter(Boolean).join(' ');
  const join = (/** @type {string[]} */ parts) => parts.filter(Boolean).join(' ');

  if (server.state === 'failed') {
    return { ...base, status: 'failed', next: 'stop', run: null, verify: null,
      say: join([`I couldn't connect ODDBOUT to ${label}: ${server.error ?? 'unknown error'}.`, 'Nothing else was changed.', extra]) };
  }
  if (server.state === 'conflict') {
    const other = server.server;
    return { ...base, status: 'conflict', next: 'ask-user', run: `${COMMAND} connect --host ${HOSTS[host].bin} --name ${name}-signin`, verify: null,
      say: join([`${label} already has an MCP server named \`${other?.name}\` that points to ${other?.url}, which is not ODDBOUT's full server, so I left it as it is.`,
        `I can add ODDBOUT next to it as \`${name}-signin\` — shall I? Or you can change or remove that entry yourself and I'll run this again.`, extra]) };
  }
  if (mode === 'check' && server.state === 'would-add') {
    return { ...base, status: 'not-connected', next: 'rerun', run: again, verify: null,
      say: join([`ODDBOUT isn't connected to ${label} yet. Running \`${again}\` adds it and opens your browser to sign in with Google.`]) };
  }
  if (server.signIn === 'needed') {
    return { ...base, status: 'sign-in-needed', next: 'rerun', run: again, verify: null,
      say: join([`ODDBOUT is added to ${label} as \`${used}\` but not signed in. Running \`${again}\` opens your browser to sign in with Google.`]) };
  }
  // A session loads servers and skills when it starts: the user reloads only when this run changed something.
  const changed = server.state === 'added' || server.signIn === 'done' || skill.state === 'installed';
  if (server.signIn === 'not-needed' || server.signIn === 'done') {
    return { ...base, status: 'connected', next: 'verify', run: null, verify,
      say: join([`ODDBOUT is connected to ${label} as \`${used}\` and signed in.`, extra, changed ? userLoad(host, used, surface) : '',
        changed ? 'Then I\'ll check your account with get_profile.' : 'I\'ll check your account with get_profile.']) };
  }
  if (server.signIn === 'timed-out') {
    return { ...base, status: 'sign-in-pending', next: 'rerun', run: again, verify: null,
      say: join([`ODDBOUT is added to ${label} as \`${used}\`, but the browser sign-in didn't finish in time.`, 'Tell me when you\'re ready and I\'ll open the sign-in again.', extra]) };
  }
  if (server.signIn === 'remote') {
    return { ...base, status: 'sign-in-needed', next: 'user-signs-in', run: null, verify,
      say: join([`ODDBOUT is added to ${label} as \`${used}\`.`, remoteSignIn(host, used), extra, 'Tell me when you\'ve signed in and I\'ll check your account.']) };
  }
  if (server.signIn === 'in-session' && host === 'claude-code') {
    // Run from an agent's command tool, which has no terminal: Claude Code's login cannot start there. The terminal CLI signs in from its own
    // /mcp panel; the desktop app's panel is refused by ODDBOUT's consent page, so it signs in from a terminal.
    const why = surface === 'terminal' ? 'Claude Code signs in from its own screen.' : surface === 'desktop' ? 'The sign-in has to come from a terminal.' : '';
    return { ...base, status: 'sign-in-needed', next: 'user-signs-in', run: null, verify,
      say: join([`ODDBOUT is added to Claude Code as \`${used}\`.`, extra,
        `One step is left, and only you can do it.${why ? ` ${why}` : ''}`, claudeSteps(surface, used).signIn,
        surface === 'desktop' ? 'In the new session, ask me to check your ODDBOUT account.' : 'Then I\'ll check your account with get_profile.']) };
  }
  if (server.signIn === 'in-session') {
    return { ...base, status: 'sign-in-needed', next: 'user-signs-in', run: null, verify,
      say: join([`ODDBOUT is added to Gemini CLI as \`${used}\`.`, 'Restart Gemini CLI (it loads servers when it starts; Gemini skips them in a folder you haven\'t trusted), then type',
        `/mcp auth ${used} and approve in your browser with Google.`, extra, 'Then I\'ll check your account with get_profile.']) };
  }
  if (server.signIn === 'failed' || server.signIn === 'unsupported') {
    const how = host === 'codex' ? `To sign in, run \`codex mcp login ${used}\` and approve in your browser with Google.` : claudeSteps(surface, used).signIn;
    return { ...base, status: 'sign-in-needed', next: 'user-signs-in', run: null, verify,
      say: join([`ODDBOUT is added to ${label} as \`${used}\`, but the sign-in didn't complete.`, how, extra]) };
  }
  // Signed in or not is unknown (a public-address server, or `check`): get_profile settles it.
  const fix = host === 'codex' ? `run \`codex mcp login ${used}\` and approve in the browser` : host === 'claude-code' ? `follow these steps: ${claudeSteps(surface, used).signIn}`
    : `type \`/mcp auth ${used}\` and approve in the browser`;
  return { ...base, status: 'registered', next: 'verify', run: null,
    verify: { ...verify, ifSignInRequired: `If get_profile says ODDBOUT needs a sign-in (authentication-required), ask the user to ${fix}` },
    say: join([`ODDBOUT is set up in ${label} as \`${used}\`.`, extra, changed ? userLoad(host, used, surface) : '',
      `${changed ? 'Then I' : 'I'}'ll check your account with get_profile; if it asks for a sign-in, you'll approve it in your browser.`]) };
}

// ---- Command line --------------------------------------------------------------------------------------------------------------------

const USAGE = `Usage: ${COMMAND} <connect|check> [options]

  connect   Add ODDBOUT's MCP to the agent you run this from, sign in through
            your browser and install the create-fighter skill. Safe to repeat.
  check     Report what connect would do, changing nothing.

Options:
  --host claude|codex|gemini   The agent (detected when run from one)
  --name <name>                Server name (default: ${SERVER_NAME})
  --no-skill                   Do not install the create-fighter skill
  --wait <seconds>             How long to wait for the browser sign-in (default: 110)
  --local / --remote           Override whether a browser here can finish the sign-in

Prints one JSON reply on stdout for the agent: status, next, say, run, rules, verify, details.
Never writes a token: the agent's own MCP client signs in.`;

/**
 * @param {string[]} argv
 * `interactive`: whether this runs in a terminal someone types in (stdin is one), not in an agent's command tool.
 * @param {{ env?: Env, cwd?: string, platform?: NodeJS.Platform, write?: (text: string) => void, interactive?: boolean }} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, io = {}) {
  const env = io.env ?? process.env, cwd = io.cwd ?? process.cwd(), platform = io.platform ?? process.platform;
  const interactive = io.interactive ?? Boolean(process.stdin.isTTY);
  const write = io.write ?? (text => process.stdout.write(text));
  const reply = (/** @type {object} */ value, code = 0) => { write(JSON.stringify(value, null, 2) + '\n'); return code; };
  const fail = (/** @type {string} */ say, code = 1, extra = {}) => reply({ oddbout: 'error', version: VERSION, status: 'failed', next: 'stop', say, run: null, rules: RULES, ...extra }, code);

  /** @type {{ command: string | null, host: string | null, name: string, skill: boolean, wait: number, local: boolean | null }} */
  const options = { command: null, host: null, name: SERVER_NAME, skill: true, wait: 110, local: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i], value = () => argv[++i] ?? '';
    if (arg === '--help' || arg === '-h' || arg === 'help') { write(USAGE + '\n'); return 0; }
    if (arg === '--version' || arg === '-v') { write(VERSION + '\n'); return 0; }
    if (arg === '--host') options.host = value();
    else if (arg.startsWith('--host=')) options.host = arg.slice(7);
    else if (arg === '--name') options.name = value();
    else if (arg.startsWith('--name=')) options.name = arg.slice(7);
    else if (arg === '--no-skill') options.skill = false;
    else if (arg === '--wait') options.wait = Number(value());
    else if (arg.startsWith('--wait=')) options.wait = Number(arg.slice(7));
    else if (arg === '--local') options.local = true;
    else if (arg === '--remote') options.local = false;
    else if (!arg.startsWith('-') && !options.command) options.command = arg;
    else return fail(`Unknown argument: ${arg}\n\n${USAGE}`, 2);
  }
  const mode = options.command ?? 'connect';
  if (mode !== 'connect' && mode !== 'check') return fail(`Unknown command: ${mode}\n\n${USAGE}`, 2);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.name)) return fail('--name takes letters, digits, "-" and "_" only.', 2);
  if (!Number.isFinite(options.wait) || options.wait < 5 || options.wait > 900) return fail('--wait takes 5 to 900 seconds.', 2);

  const detected = detectHost(env);
  const host = options.host ? HOST_NAMES[options.host.toLowerCase()] ?? null : detected.host;
  if (options.host && !host) return fail(`Unknown --host ${options.host}: use claude, codex or gemini.`, 2);
  if (!host) {
    return reply({ oddbout: mode, version: VERSION, status: 'choose-host', next: 'rerun', run: null, rules: RULES,
      say: 'Which agent is this — Claude Code, Codex or Gemini CLI? (For claude.ai, ChatGPT or Grok in a browser, connect from My agents on oddbout.com instead.)',
      choices: Object.entries({ claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' }).map(([flag, label]) => ({ host: label, run: `${COMMAND} ${mode} --host ${flag}` })),
      agent: 'If you are one of these agents yourself, rerun with your own --host without asking the user.',
      details: { markers: detected.markers, docs: DOCS } });
  }
  const binary = findExecutable(HOSTS[host].bin, env, platform)
    ?? (host === 'claude-code' && env.CLAUDE_CODE_EXECPATH && isFile(env.CLAUDE_CODE_EXECPATH) ? env.CLAUDE_CODE_EXECPATH : null);
  if (!binary) {
    return fail(`The \`${HOSTS[host].bin}\` command isn't on this machine's PATH, so I can't add ODDBOUT to ${HOSTS[host].label} from here. Install the ${HOSTS[host].label} command line, or add the server by hand: ${DOCS}`,
      1, { host, details: { docs: DOCS } });
  }
  // Codex runs commands in a sandbox by default: this one writes ~/.codex/config.toml, fetches the skill and opens the browser.
  if (host === 'codex' && mode === 'connect' && (env.CODEX_SANDBOX || env.CODEX_SANDBOX_NETWORK_DISABLED)) {
    return reply({ oddbout: mode, version: VERSION, host, status: 'needs-permission', next: 'rerun', run: `${COMMAND} connect --host codex`, rules: RULES,
      say: 'Connecting needs to run outside Codex\'s sandbox: it saves the server in your Codex settings, downloads the create-fighter skill and opens your browser to sign in. Approve running it with full access when Codex asks.',
      agent: 'Rerun `run` with escalated permissions (outside the sandbox).', details: { docs: DOCS } });
  }

  const remote = options.local === null ? detectRemote(env, platform, isFile) : { remote: !options.local, reasons: [options.local ? 'flag --local' : 'flag --remote'] };
  /** @type {Context} */
  const ctx = {
    host, bin: binary, env, cwd, mutate: mode === 'connect', remote: remote.remote, interactive, waitMs: options.wait * 1000, actions: [], notes: [],
    async run(args, { timeoutMs = 60_000, echo = false, terminal = false, record = false } = {}) {
      const result = await runCommand(binary, args, { env, cwd, timeoutMs, echo, terminal });
      if (record) {
        // A command given the terminal wrote to it directly, so there is no output to keep.
        ctx.actions.push({ command: [HOSTS[host].bin, ...args].join(' '), exitCode: result.code, seconds: result.seconds,
          ...(result.timedOut ? { timedOut: true } : {}), ...(terminal ? { terminal: true } : result.code !== 0 ? { output: outputTail(result) } : {}) });
      }
      return result;
    },
  };
  if (host === 'claude-code') ctx.notes.push('Connectors added on claude.ai are not checked here; if one is ODDBOUT, Claude Code may list its tools twice.');
  process.stderr.write(`oddbout ${VERSION}: ${mode} for ${HOSTS[host].label}${remote.remote ? ` (remote: ${remote.reasons.join(', ')})` : ''}\n`);

  /** @type {SkillResult} */
  const skill = options.skill ? await ensureSkill(ctx) : { state: 'skipped' };
  const server = await ensureServer(ctx, options.name);
  const result = compose({ host, name: options.name, mode, remote, server, skill, ctx, binary, hostSource: options.host ? 'flag' : 'environment',
    surface: claudeSurface(env) });
  return reply(result, result.status === 'failed' ? 1 : 0);
}
