import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addressKind, claudeSurface, detectHost, detectRemote, main, planServer, SIGN_IN_URL, spawnStdio, stripJsonComments }
  from '../packages/oddbout/lib/connect.mjs';
import { CLOUD_RESOURCE, DIRECTORY_RESOURCE, LEGACY_PUBLIC_RESOURCE, PUBLIC_DIRECTORY_RESOURCE, PUBLIC_RESOURCE, PUBLIC_SIGN_IN_RESOURCE,
  SIGN_IN_RESOURCE } from '../mcp/cloud/resources.mjs';

// `npx -y oddbout@latest connect` (packages/oddbout, 2026-11-05): the agent hosts are fakes on PATH that log each call, so these check the
// exact commands, that a second run changes nothing, and that an existing server is never replaced.
const root = fileURLToPath(new URL('../', import.meta.url));
const bin = path.join(root, 'packages/oddbout/bin/oddbout.mjs');
const fake = path.join(root, 'test/helpers/fake-agent-cli.mjs');
const windows = process.platform === 'win32';

async function sandbox() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'oddbout-connect-'));
  const fakeBin = path.join(dir, 'bin');
  await mkdir(fakeBin);
  for (const host of ['claude', 'codex', 'gemini']) {
    if (windows) await writeFile(path.join(fakeBin, `${host}.cmd`), `@"${process.execPath}" "${fake}" ${host} %*\r\n`);
    else { await writeFile(path.join(fakeBin, host), `#!/bin/sh\nexec "${process.execPath}" "${fake}" ${host} "$@"\n`); await chmod(path.join(fakeBin, host), 0o755); }
  }
  const home = path.join(dir, 'home'), cwd = path.join(dir, 'project');
  await mkdir(home); await mkdir(cwd);
  const keep = windows ? Object.fromEntries(['SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'windir'].flatMap(name => process.env[name] ? [[name, process.env[name]]] : [])) : {};
  const system = windows ? [path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')] : ['/usr/bin', '/bin'];
  const base = {
    ...keep, PATH: [fakeBin, path.dirname(process.execPath), ...system].join(path.delimiter), HOME: home, USERPROFILE: home,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'), GEMINI_CLI_HOME: home, CODEX_HOME: path.join(home, '.codex'),
    FAKE_AGENT_LOG: path.join(dir, 'calls.jsonl'), FAKE_AGENT_STATE: path.join(dir, 'state.json'),
    // A Linux CI runner has no display; these tests are about the local sign-in unless they say otherwise.
    DISPLAY: ':0',
  };
  await mkdir(base.CLAUDE_CONFIG_DIR);
  const calls = async () => {
    const text = await readFile(base.FAKE_AGENT_LOG, 'utf8').catch(() => '');
    return text.split('\n').filter(Boolean).map(line => { const { host, args } = JSON.parse(line); return `${host} ${args.join(' ')}`; });
  };
  /** @param {string[]} args @param {Record<string, string>} [env] @returns {Promise<{ code: number, reply: any, stderr: string, calls: string[] }>} */
  const run = async (args, env = {}) => {
    const before = (await calls()).length;
    const { code, stdout, stderr } = await new Promise(resolve => execFile(process.execPath, [bin, ...args], { cwd, env: { ...base, ...env }, timeout: 60_000 },
      (error, stdout, stderr) => resolve({ code: error ? /** @type {any} */ (error).code ?? 1 : 0, stdout, stderr })));
    let reply;
    try { reply = JSON.parse(stdout); } catch { assert.fail(`not one JSON reply:\n${stdout}\n${stderr}`); }
    return { code, reply, stderr, calls: (await calls()).slice(before) };
  };
  /**
   * As someone running it in their own terminal: `main` in this process with `interactive` set, since a test cannot open a terminal.
   * The fake's FAKE_AGENT_TERMINAL=1 stands in for the terminal the CLI hands Claude Code's login.
   * @param {string[]} args @param {Record<string, string>} [env] @returns {Promise<{ code: number, reply: any, calls: string[] }>}
   */
  const runInTerminal = async (args, env = {}) => {
    const before = (await calls()).length;
    let stdout = '';
    const code = await main(args, { env: { ...base, FAKE_AGENT_TERMINAL: '1', ...env }, cwd, interactive: true, write: text => { stdout += text; } });
    return { code, reply: JSON.parse(stdout), calls: (await calls()).slice(before) };
  };
  return { dir, home, cwd, base, run, runInTerminal, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const MUTATING = /\b(mcp add|mcp login [^-]|mcp remove|marketplace add|plugin install|plugin add)\b/;

test('the CLI names the same sign-in address as the server, and knows every ODDBOUT address', () => {
  assert.equal(SIGN_IN_URL, PUBLIC_SIGN_IN_RESOURCE);
  for (const url of [PUBLIC_SIGN_IN_RESOURCE, SIGN_IN_RESOURCE, `${SIGN_IN_RESOURCE}/`]) assert.equal(addressKind(url), 'sign-in-first');
  for (const url of [PUBLIC_RESOURCE, CLOUD_RESOURCE, LEGACY_PUBLIC_RESOURCE]) assert.equal(addressKind(url), 'public');
  for (const url of [PUBLIC_DIRECTORY_RESOURCE, DIRECTORY_RESOURCE]) assert.equal(addressKind(url), 'directory');
  assert.equal(addressKind('https://mcp.oddbout.com.evil.test/signin'), null);
  assert.equal(addressKind('not a url'), null);
});

test('which server to use: an ODDBOUT one already there wins, a foreign server under the name is a conflict', () => {
  const server = (/** @type {string} */ name, /** @type {string} */ url) => ({ name, url, scope: 'user', auth: /** @type {const} */ ('unknown') });
  assert.equal(planServer([], 'oddbout').action, 'add');
  const legacy = server('oddbout-mcp', PUBLIC_RESOURCE), signIn = server('mine', SIGN_IN_RESOURCE);
  assert.deepEqual(planServer([legacy], 'oddbout').server, legacy);
  assert.deepEqual(planServer([legacy, signIn], 'oddbout').server, signIn);
  const foreign = server('oddbout', 'https://example.com/mcp');
  assert.equal(planServer([foreign], 'oddbout').action, 'conflict');
  assert.equal(planServer([foreign, legacy], 'oddbout').action, 'reuse');
  // The directory edition cannot make fighters: it is reported, and the full server is added beside it under another name.
  const directory = server('claude-directory', PUBLIC_DIRECTORY_RESOURCE);
  assert.equal(planServer([directory], 'oddbout').action, 'add');
  assert.deepEqual(planServer([directory], 'oddbout').others, [directory]);
});

test('host and browser detection', () => {
  assert.equal(detectHost({ CLAUDECODE: '1' }).host, 'claude-code');
  assert.equal(detectHost({ CODEX_THREAD_ID: 't' }).host, 'codex');
  assert.equal(detectHost({ GEMINI_CLI: '1' }).host, 'gemini-cli');
  assert.equal(detectHost({}).host, null);
  assert.deepEqual(detectHost({ CLAUDECODE: '1', GEMINI_CLI: '1' }), { host: null, markers: ['claude-code', 'gemini-cli'] });
  const none = () => false;
  assert.equal(detectRemote({ SSH_CONNECTION: '1 2 3 4' }, 'darwin', none).remote, true);
  assert.equal(detectRemote({ SSH_CONNECTION: '1 2 3 4', BROWSER: '/home/u/.vscode-server/bin/x/bin/helpers/browser.sh' }, 'linux', none).remote, false);
  assert.equal(detectRemote({}, 'linux', none).remote, true);
  assert.equal(detectRemote({ WSL_DISTRO_NAME: 'Ubuntu' }, 'linux', none).remote, false);
  assert.equal(detectRemote({}, 'win32', none).remote, false);
  assert.equal(detectRemote({ DISPLAY: ':0' }, 'linux', file => file === '/.dockerenv').remote, true);
  assert.equal(JSON.parse(stripJsonComments('{"a": "x // y", /* c */ "b": 1 // d\n}')).a, 'x // y');
});

test('Claude Code from an agent: adds the server and the skill, leaves the sign-in to /mcp; a second run changes nothing', async () => {
  // An agent's command tool gives no terminal, and Claude Code's `mcp login` refuses without one (2.1.283; the fake does the same).
  // 0.1.0 ran it anyway: it failed in 2 s and opened no browser (user report, 2026-11-05).
  const box = await sandbox();
  try {
    const first = await box.run(['connect'], { CLAUDECODE: '1' });
    assert.equal(first.code, 0, first.stderr);
    assert.deepEqual(first.calls, [
      'claude plugin marketplace list --json',
      'claude plugin marketplace add https://github.com/jeonghwanko/oddbout-starter.git --sparse .claude-plugin plugins/oddbout-codex',
      'claude plugin install oddbout@oddbout --scope user',
      'claude mcp add --transport http --scope user oddbout https://mcp.oddbout.com/signin',
      'claude mcp get oddbout',
    ]);
    assert.equal(first.reply.status, 'sign-in-needed');
    assert.equal(first.reply.next, 'user-signs-in');
    assert.equal(first.reply.details.signIn, 'in-session');
    assert.equal(first.reply.verify.tool, 'get_profile');
    assert.equal(first.reply.run, null);
    assert.equal(first.reply.details.skill.state, 'installed');
    assert.deepEqual(first.reply.details.server, { name: 'oddbout', url: SIGN_IN_URL, scope: 'user', auth: 'not-signed-in', kind: 'sign-in-first', state: 'added' });
    assert.match(first.reply.say, /Type \/mcp, choose oddbout, then Authenticate/);
    assert.match(first.reply.say, /only you can do it/);
    assert.ok(first.reply.rules.some((/** @type {string} */ rule) => /callback\/redirect URL in chat/.test(rule)));
    const config = JSON.parse(await readFile(path.join(box.base.CLAUDE_CONFIG_DIR, '.claude.json'), 'utf8'));
    assert.deepEqual(config.mcpServers, { oddbout: { type: 'http', url: SIGN_IN_URL } });

    const second = await box.run(['connect'], { CLAUDECODE: '1' });
    assert.deepEqual(second.calls, ['claude plugin marketplace list --json', 'claude plugin list --json', 'claude mcp get oddbout']);
    assert.equal(second.reply.status, 'sign-in-needed');
    assert.equal(second.reply.details.server.state, 'present');
    assert.equal(second.reply.details.skill.state, 'present');
    assert.deepEqual(second.reply.details.actions, []);
  } finally { await box.cleanup(); }
});

test('Claude Code in a terminal: the login gets the terminal, then the run is connected and idempotent', async () => {
  const box = await sandbox();
  try {
    const first = await box.runInTerminal(['connect', '--no-skill'], { CLAUDECODE: '1' });
    assert.deepEqual(first.calls, [
      'claude mcp add --transport http --scope user oddbout https://mcp.oddbout.com/signin',
      'claude mcp get oddbout',
      'claude mcp login --help',
      'claude mcp login oddbout',
      'claude mcp get oddbout',
    ]);
    assert.equal(first.reply.status, 'connected');
    assert.equal(first.reply.details.signIn, 'done');
    assert.deepEqual(first.reply.details.actions.at(-1), { command: 'claude mcp login oddbout', exitCode: 0, seconds: first.reply.details.actions.at(-1).seconds, terminal: true });
    const second = await box.runInTerminal(['connect', '--no-skill'], { CLAUDECODE: '1' });
    assert.deepEqual(second.calls, ['claude mcp get oddbout']);
    assert.equal(second.reply.status, 'connected');
  } finally { await box.cleanup(); }
});

test('only a login handed the terminal inherits stdin; its output goes to stderr so stdout keeps the reply', () => {
  assert.deepEqual(spawnStdio(true), ['inherit', 2, 2]);
  assert.deepEqual(spawnStdio(false), ['ignore', 'pipe', 'pipe']);
});

test('the Claude desktop app gets its own steps: quit and reopen it, a new session, then /mcp → Connect', async () => {
  // In the desktop app (Code tab) a running session cannot reconnect a server added from outside, its /mcp window does not list it, and it
  // has no `claude --continue` (2026-11-05, Windows); the terminal CLI's steps do not work there.
  assert.equal(claudeSurface({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' }), 'desktop');
  assert.equal(claudeSurface({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' }), 'terminal');
  assert.equal(claudeSurface({}), 'unknown');
  const box = await sandbox();
  try {
    const desktop = await box.run(['connect'], { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' });
    assert.equal(desktop.reply.status, 'sign-in-needed');
    assert.equal(desktop.reply.details.surface, 'desktop');
    assert.match(desktop.reply.say, /Quit the Claude app completely \(not just this window\), reopen it and start a new session; then open \/mcp, choose oddbout, choose Connect/);
    assert.match(desktop.reply.say, /it loads in the new session/);
    assert.doesNotMatch(desktop.reply.say, /claude --continue|reconnect|reload-plugins/);
    assert.match(desktop.reply.verify.ifToolsMissing, /desktop app.*\/mcp reconnect is not available/);
    assert.match(desktop.reply.verify.ifToolsMissing, /does not carry this conversation/);

    // Run by hand with --host claude, the surface is unknown: both ways are given.
    const byHand = await box.run(['connect', '--host', 'claude']);
    assert.equal(byHand.reply.details.surface, 'unknown');
    assert.match(byHand.reply.say, /Authenticate \(Connect in the desktop app\)/);
    assert.match(byHand.reply.say, /in the desktop app, quit the Claude app completely/);
  } finally { await box.cleanup(); }
});

test('Codex: the add signs in by itself; the skill comes from the repository marketplace; a second run changes nothing', async () => {
  const box = await sandbox();
  try {
    const first = await box.run(['connect'], { CODEX_THREAD_ID: 'thread' });
    assert.equal(first.code, 0, first.stderr);
    assert.deepEqual(first.calls, [
      'codex plugin marketplace list --json',
      'codex plugin marketplace add https://github.com/jeonghwanko/oddbout-starter --ref main --sparse .agents/plugins --sparse plugins/oddbout-codex',
      'codex plugin add oddbout@oddbout',
      'codex mcp list --json',
      'codex mcp add oddbout --url https://mcp.oddbout.com/signin',
      'codex mcp list --json',
    ]);
    assert.equal(first.reply.status, 'connected');
    assert.equal(first.reply.details.signIn, 'done');
    assert.match(first.reply.say, /codex resume --last/);
    // The authorization link Codex prints reaches the user on stderr; the reply keeps no query string.
    assert.match(first.stderr, /Authorize `oddbout`/);
    assert.doesNotMatch(JSON.stringify(first.reply), /code_challenge|state=/);

    const second = await box.run(['connect'], { CODEX_THREAD_ID: 'thread' });
    assert.deepEqual(second.calls, ['codex plugin marketplace list --json', 'codex plugin list --json', 'codex mcp list --json']);
    assert.equal(second.reply.status, 'connected');
    assert.equal(second.calls.filter(call => MUTATING.test(call)).length, 0);
  } finally { await box.cleanup(); }
});

test('Codex: a server already at the public address under another name is reused, not doubled', async () => {
  const box = await sandbox();
  try {
    await writeFile(box.base.FAKE_AGENT_STATE, JSON.stringify({ codex: { servers: { 'oddbout-mcp': { url: PUBLIC_RESOURCE, auth: 'o_auth' } }, marketplaces: [], plugins: [] } }));
    const { reply, calls } = await box.run(['connect', '--no-skill'], { CODEX_THREAD_ID: 'thread' });
    assert.deepEqual(calls, ['codex mcp list --json']);
    assert.equal(reply.status, 'connected');
    assert.equal(reply.details.server.name, 'oddbout-mcp');
    assert.match(reply.say, /`oddbout-mcp`/);
  } finally { await box.cleanup(); }
});

test('Codex: a server saved but never signed in gets the login, not a second add', async () => {
  const box = await sandbox();
  try {
    await writeFile(box.base.FAKE_AGENT_STATE, JSON.stringify({ codex: { servers: { oddbout: { url: SIGN_IN_URL, auth: 'not_logged_in' } }, marketplaces: [], plugins: [] } }));
    const { reply, calls } = await box.run(['connect', '--no-skill'], { CODEX_THREAD_ID: 'thread' });
    assert.deepEqual(calls, ['codex mcp list --json', 'codex mcp login oddbout', 'codex mcp list --json']);
    assert.equal(reply.status, 'connected');
  } finally { await box.cleanup(); }
});

test('a different server already named oddbout is reported and left alone', async () => {
  const box = await sandbox();
  try {
    const configFile = path.join(box.base.CLAUDE_CONFIG_DIR, '.claude.json');
    const original = JSON.stringify({ mcpServers: { oddbout: { type: 'http', url: 'https://example.com/mcp' } } });
    await writeFile(configFile, original);
    const { reply, calls } = await box.run(['connect', '--no-skill'], { CLAUDECODE: '1' });
    assert.deepEqual(calls, []);
    assert.equal(reply.status, 'conflict');
    assert.equal(reply.next, 'ask-user');
    assert.equal(reply.run, 'npx -y oddbout@latest connect --host claude --name oddbout-signin');
    assert.match(reply.say, /example\.com/);
    assert.equal(await readFile(configFile, 'utf8'), original);
  } finally { await box.cleanup(); }
});

test('Gemini CLI: added once, signed in from the session; a second run does not re-add (its add would overwrite)', async () => {
  const box = await sandbox();
  try {
    const first = await box.run(['connect'], { GEMINI_CLI: '1' });
    assert.deepEqual(first.calls, ['gemini mcp add --transport http --scope user oddbout https://mcp.oddbout.com/signin']);
    assert.equal(first.reply.status, 'sign-in-needed');
    assert.equal(first.reply.next, 'user-signs-in');
    assert.match(first.reply.say, /\/mcp auth oddbout/);
    assert.equal(first.reply.details.skill.state, 'not-offered');
    const second = await box.run(['connect'], { GEMINI_CLI: '1' });
    assert.deepEqual(second.calls, []);
    assert.equal(second.reply.details.server.state, 'present');
  } finally { await box.cleanup(); }
});

test('over SSH the server is added but no browser sign-in is started, and the reply keeps the callback address out of chat', async () => {
  const box = await sandbox();
  try {
    const { reply, calls } = await box.run(['connect', '--no-skill'], { CLAUDECODE: '1', SSH_CONNECTION: '10.0.0.2 50000 10.0.0.3 22' });
    assert.deepEqual(calls, ['claude mcp add --transport http --scope user oddbout https://mcp.oddbout.com/signin', 'claude mcp get oddbout']);
    assert.equal(reply.status, 'sign-in-needed');
    assert.match(reply.say, /claude mcp login oddbout --no-browser/);
    assert.match(reply.say, /never into this chat/);
  } finally { await box.cleanup(); }
});

test('Codex over SSH: the add is given only the time to save the server, and the login is left to a terminal there', async () => {
  const box = await sandbox();
  try {
    const { reply, calls } = await box.run(['connect', '--no-skill', '--wait', '5'], { CODEX_THREAD_ID: 't', SSH_CONNECTION: '1 2 3 4', FAKE_AGENT_LOGIN: 'hang' });
    assert.deepEqual(calls, ['codex mcp list --json', 'codex mcp add oddbout --url https://mcp.oddbout.com/signin', 'codex mcp list --json']);
    assert.equal(reply.status, 'sign-in-needed');
    assert.equal(reply.details.server.state, 'added');
    assert.match(reply.say, /codex mcp login oddbout --no-browser/);
  } finally { await box.cleanup(); }
});

test('a browser sign-in that never finishes ends at --wait with the same command to resume', async () => {
  const box = await sandbox();
  try {
    const { reply, calls } = await box.runInTerminal(['connect', '--no-skill', '--wait', '5'], { CLAUDECODE: '1', FAKE_AGENT_LOGIN: 'hang' });
    assert.equal(calls.at(-1), 'claude mcp login oddbout');
    assert.equal(reply.status, 'sign-in-pending');
    assert.equal(reply.next, 'rerun');
    assert.equal(reply.run, 'npx -y oddbout@latest connect --host claude');
    assert.equal(reply.details.actions.at(-1).timedOut, true);
  } finally { await box.cleanup(); }
});

test('check changes nothing; an unknown host and a sandboxed Codex run nothing', async () => {
  const box = await sandbox();
  try {
    const check = await box.run(['check'], { CLAUDECODE: '1' });
    assert.deepEqual(check.calls, ['claude plugin marketplace list --json']);
    assert.equal(check.reply.status, 'not-connected');
    assert.equal(check.reply.run, 'npx -y oddbout@latest connect --host claude');
    const unknown = await box.run(['connect']);
    assert.deepEqual(unknown.calls, []);
    assert.equal(unknown.reply.status, 'choose-host');
    assert.deepEqual(unknown.reply.choices.map((/** @type {any} */ choice) => choice.run), ['claude', 'codex', 'gemini'].map(host => `npx -y oddbout@latest connect --host ${host}`));
    const sandboxed = await box.run(['connect'], { CODEX_THREAD_ID: 't', CODEX_SANDBOX: 'seatbelt' });
    assert.deepEqual(sandboxed.calls, []);
    assert.equal(sandboxed.reply.status, 'needs-permission');
    const usage = await box.run(['connect', '--name', 'bad name']);
    assert.equal(usage.code, 2);
  } finally { await box.cleanup(); }
});
