// A stand-in for `claude`, `codex` and `gemini` on PATH (test/oddbout-connect.test.mjs). It logs every call to FAKE_AGENT_LOG and keeps
// each host's state the way the real one does: Claude Code's servers in $CLAUDE_CONFIG_DIR/.claude.json, Gemini CLI's in
// $GEMINI_CLI_HOME/.gemini/settings.json, the rest (sign-ins, Codex servers, plugins) in FAKE_AGENT_STATE. FAKE_AGENT_LOGIN picks how a
// sign-in ends: ok (default), fail or hang (never returns, as a browser sign-in nobody finishes).
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [host, ...args] = process.argv.slice(2);
const env = process.env;
appendFileSync(/** @type {string} */ (env.FAKE_AGENT_LOG), JSON.stringify({ host, args }) + '\n');
const command = args.join(' ');

/** @param {string} file */
const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; } };
/** @param {string} file @param {unknown} value */
const writeJson = (file, value) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value, null, 2)); };
const stateFile = /** @type {string} */ (env.FAKE_AGENT_STATE);
const state = { claude: { signedIn: [], marketplaces: [], plugins: [] }, codex: { servers: {}, marketplaces: [], plugins: [] }, ...readJson(stateFile) };
const save = () => writeJson(stateFile, state);
const out = (/** @type {unknown} */ value) => process.stdout.write(typeof value === 'string' ? value + '\n' : JSON.stringify(value) + '\n');
const exit = (/** @type {number} */ code) => process.exit(code);

/** @returns {Promise<boolean>} */
async function signIn() {
  if (env.FAKE_AGENT_LOGIN === 'hang') { await new Promise(() => setInterval(() => {}, 1000)); }
  return env.FAKE_AGENT_LOGIN !== 'fail';
}

if (host === 'claude') {
  const configFile = path.join(/** @type {string} */ (env.CLAUDE_CONFIG_DIR), '.claude.json');
  const config = readJson(configFile);
  config.mcpServers ??= {};
  if (command === 'plugin marketplace list --json') out(state.claude.marketplaces);
  else if (command === 'plugin list --json') out(state.claude.plugins);
  else if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') {
    state.claude.marketplaces.push({ name: 'oddbout', source: 'git', url: args[3] }); save(); out('✔ Successfully added marketplace: oddbout');
  } else if (args[0] === 'plugin' && args[1] === 'install') {
    state.claude.plugins.push({ id: args[2], version: '0.1.0', scope: 'user', enabled: true }); save(); out(`✔ Successfully installed plugin: ${args[2]}`);
  } else if (args[0] === 'mcp' && args[1] === 'add') {
    const [name, url] = args.slice(-2);
    if (config.mcpServers[name]) { process.stderr.write(`MCP server ${name} already exists in user config\n`); exit(1); }
    config.mcpServers[name] = { type: 'http', url }; writeJson(configFile, config); out(`Added HTTP MCP server ${name} with URL: ${url} to user config`);
  } else if (args[0] === 'mcp' && args[1] === 'get') {
    const entry = config.mcpServers[args[2]];
    if (!entry) { process.stderr.write(`No MCP server named "${args[2]}".\n`); exit(1); }
    const status = state.claude.signedIn.includes(args[2]) ? '✓ Connected' : '! Needs authentication';
    out(`${args[2]}:\n  Scope: User config (available in all your projects)\n  Status: ${status}\n  Type: http\n  URL: ${entry.url}`);
  } else if (command === 'mcp login --help') out('Usage: claude mcp login [options] <name>');
  else if (args[0] === 'mcp' && args[1] === 'login') {
    if (!(await signIn())) { process.stderr.write('Authentication failed\n'); exit(1); }
    state.claude.signedIn.push(args[2]); save(); out(`Authenticated with ${args[2]}.`);
  } else { process.stderr.write(`fake claude: unexpected ${command}\n`); exit(64); }
} else if (host === 'codex') {
  const servers = state.codex.servers;
  const list = () => Object.entries(servers).map(([name, server]) => ({ name, enabled: true, disabled_reason: null,
    transport: { type: 'streamable_http', url: server.url }, startup_timeout_sec: null, tool_timeout_sec: null, auth_status: server.auth }));
  if (command === 'mcp list --json') out(list());
  else if (command === 'plugin marketplace list --json') out({ marketplaces: state.codex.marketplaces });
  else if (command === 'plugin list --json') out({ installed: state.codex.plugins, available: [] });
  else if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') {
    state.codex.marketplaces.push({ name: 'oddbout', root: '/tmp/oddbout', marketplaceSource: { sourceType: 'git', source: `${args[3]}.git` } }); save();
  } else if (args[0] === 'plugin' && args[1] === 'add') {
    state.codex.plugins.push({ pluginId: args[2], name: 'oddbout', marketplaceName: 'oddbout', installed: true, enabled: true }); save();
  } else if (args[0] === 'mcp' && (args[1] === 'add' || args[1] === 'login')) {
    // As codex-rs: `add` saves the server first, then signs in at once when the server asks for OAuth.
    const name = args[2];
    if (args[1] === 'add') { servers[name] = { url: args[args.indexOf('--url') + 1], auth: 'not_logged_in' }; save(); }
    out(`Authorize \`${name}\` by opening this URL in your browser:\nhttps://ztfxxhtmtrvxvuxlqmgz.supabase.co/auth/v1/oauth/authorize?client_id=x&code_challenge=y&state=z\n`);
    if (!(await signIn())) { process.stderr.write('Error: OAuth login failed\n'); exit(1); }
    servers[name].auth = 'o_auth'; save(); out('Successfully logged in.');
  } else { process.stderr.write(`fake codex: unexpected ${command}\n`); exit(64); }
} else if (host === 'gemini') {
  const settingsFile = path.join(/** @type {string} */ (env.GEMINI_CLI_HOME), '.gemini', 'settings.json');
  if (args[0] === 'mcp' && args[1] === 'add') {
    // As Gemini CLI 0.67: a second add of the same name replaces it without asking.
    const settings = readJson(settingsFile);
    const [name, url] = args.slice(-2);
    settings.mcpServers = { ...settings.mcpServers, [name]: { url, type: 'http' } }; writeJson(settingsFile, settings);
    out(`MCP server "${name}" added to user settings. (http)`);
  } else { process.stderr.write(`fake gemini: unexpected ${command}\n`); exit(64); }
} else exit(64);
