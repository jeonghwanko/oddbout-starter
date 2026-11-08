#!/usr/bin/env node
// @ts-check
// ODDBOUT hosted fighter generation: `og` for a community host's PC on Windows, macOS or Linux (2026-11-05, step 1.2 of the plan for
// subscription creators). bash `og` beside it stays the tool of ODDBOUT's own PC (the service install) and of the Linux hosts installed
// with it; this file is bash og's user mode in Node, so a host needs no bash, flock, timeout(1) or systemd:
// - the codex slots are one semaphore in this process. The worker runs og here (`og worker run` → generation-worker.mjs main with
//   createOg's runner), so every stage's runs share it; there are no slot files and no flock.
// - a run's time limit is a timer that stops the command's whole tree: its process group, or `taskkill /T /F` on Windows (the way of
//   mcp/generation-connection.mjs), which has neither groups nor SIGTERM.
// - the memory cap is the systemd slice on Linux only. Elsewhere there is none: two codex slots by default, and a warning on a small PC.
// - `npm run <script>` runs the node command the kit's package.json names (`node scripts/sprite-gen.mjs` for `sprite`), and codex and grok
//   run as their npm packages' scripts (codexCommand's way): Windows starts no npm.cmd or codex.cmd without a shell.
// The rest is bash og's user mode: the pinned accounts, the grok token refresh, harden, health, prune and the ledger (ledger-report.mjs).
// og-node.test.mjs keeps the tool lists and defaults here equal to bash og's. Runbook: README.md beside this file.
import { spawn, spawnSync } from 'node:child_process';
import {
  accessSync,
  appendFileSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTPUT_DRAIN_MS, main as workerMain, run as runChild, spritePython, stopTree } from './generation-worker.mjs';
import { entry } from './ledger-report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---- the same values as bash og (og-node.test.mjs reads them from it).
export const KIT_URL = 'https://github.com/jeonghwanko/oddbout-starter.git';
export const KIT_REF = 'ec976c69e380f1d0d0c6241272bccfa9cc069490';
export const CODEX_VERSION = '0.165.0';
export const GROK_VERSION = '1.0.52';
export const RUN_TIMEOUT = 5400;
export const SLOT_WAIT = 1800;
export const CODEX_MODEL = 'gpt-6.1-sol';
/** bash og LOCAL_TOOLS: sprite-gen-agent tools that never reach a provider. */
export const LOCAL_TOOLS = Object.freeze(
  `defaults workflow prepare gait-motion extract unpack-atlas slice-sheet ui-kit cutout anchor game-pack
  compose-atlas compose-cycle compose-gif export-pngs export-aseprite background-tile shadow recolor recolor-palette breathe rife gait-guide
  scene-render scene-inspect inspect-motion preview handed-check inspect score scale-check curation compose video-canvas video-prompt
  video-frames video-loop video-loop-compare video-source-manifest video-loop-repair video-cycle-align video-sway video-sway-inspect
  video-follow video-follow-inspect video-set-sheet video-stop video-face face-bake migrate-breathe migrate-request`.split(/\s+/),
);
/** bash og GROK_TOOLS: the Grok video and audio tools. */
export const GROK_TOOLS = Object.freeze(['video', 'video-set', 'video-resume', 'video-extend', 'video-edit', 'sound']);
/** bash og REFUSED_TOOLS: tools that reach a provider P0 does not use. */
export const REFUSED_TOOLS = Object.freeze(['pixel-draw']);
/** bash og CODEX_OFF / CODEX_KEEP_ON (og harden). */
export const CODEX_OFF = Object.freeze([
  'shell_tool',
  'unified_exec',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'apps',
  'multi_agent',
  'hooks',
  'plugins',
  'remote_plugin',
]);
export const CODEX_KEEP_ON = Object.freeze(['code_mode_host', 'image_generation']);
export const HARDEN_MARK = '# og harden:';
export const DOCS_MARK = '# og harden (project docs):';
export const SLICE = 'oddbout-host.slice';
export const WORKER_UNIT = 'oddbout-host-worker.service';
/** timeout --kill-after=30: a stopped command that is still there 30 s after SIGTERM gets SIGKILL. */
export const KILL_AFTER_MS = 30_000;
/** Off Linux there is no memory cap: two codex slots unless host.env says otherwise, and a warning under this much memory. */
export const UNCAPPED_SLOTS = 2;
export const LOW_MEMORY_BYTES = 12 * 2 ** 30;

const PROVIDER_PACKAGES = Object.freeze({ codex: '@openai/codex', grok: '@xai-official/grok' });
// What Windows programs need from the environment (Python fails without SystemRoot); everything else is the install's own, as env -i is.
const WINDOWS_KEEP = Object.freeze([
  'SystemRoot',
  'SystemDrive',
  'windir',
  'ComSpec',
  'PATHEXT',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'PROCESSOR_LEVEL',
  'PROCESSOR_REVISION',
  'OS',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'CommonProgramFiles',
  'CommonProgramFiles(x86)',
  'CommonProgramW6432',
  'ALLUSERSPROFILE',
  'PUBLIC',
  'DriverData',
]);
const OK_PROMPT = 'Reply with the single word ok.';
const SERVICE_ONLY = "is the official host's manual flow — a community host's PC runs the worker only (npm run host -- …)";

/** A refusal: bash og's `die` (its message without the `og: `, and the exit code). */
export class OgError extends Error {
  /** @param {string} message @param {number} [exit] */
  constructor(message, exit = 1) {
    super(message);
    this.exit = exit;
  }
}
/** @param {string} message @param {number} [exit] @returns {never} */
function die(message, exit = 1) {
  throw new OgError(message, exit);
}

/**
 * The signed-in account of a login file (bash og emails_of), from one known field only: codex = the id_token's `email`, grok = each
 * `https://auth.x.ai::<id>` entry's `email`. `describe`: also the plan and the workspace id's tail. No token is returned.
 * @param {string} file @param {boolean} [describe] @returns {string[]}
 */
export function emailsOf(file, describe = false) {
  const out = [];
  try {
    const a = JSON.parse(readFileSync(file, 'utf8'));
    if (a?.tokens?.id_token) {
      const p = JSON.parse(Buffer.from(a.tokens.id_token.split('.')[1], 'base64url').toString());
      const auth = p['https://api.openai.com/auth'] ?? {};
      if (p.email)
        out.push(describe ? `${p.email} (plan ${auth.chatgpt_plan_type ?? '?'}, workspace …${String(auth.chatgpt_account_id ?? '').slice(-6)})` : p.email);
    } else {
      for (const [k, v] of Object.entries(a ?? {}))
        if (k.startsWith('https://auth.x.ai::') && typeof v?.email === 'string')
          out.push(describe ? `${v.email} (grok user …${String(v.user_id ?? '').slice(-6)})` : v.email);
    }
  } catch {
    /* no file, or not one of these: no account */
  }
  return [...new Set(out.map(e => (describe ? e : e.toLowerCase())))];
}

// ---- what a command will bill (bash og sprite_tool, explicit_provider, option_value, classify, tool_label).
/** @param {string[]} args */
export function spriteTool(args) {
  let prev = '';
  for (const a of args) {
    if (a === '--') continue;
    if (prev === 'sprite' || prev === 'sprite-gen' || prev.endsWith('/sprite-gen')) return a;
    prev = a;
  }
  return '';
}
/** @param {string} name @param {string[]} args */
export function optionValue(name, args) {
  let prev = '';
  for (const a of args) {
    if (prev === name) return a;
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
    prev = a;
  }
  return '';
}
/**
 * The provider a command bills and the codex slots it takes.
 * @param {string[]} args @param {number} slots @returns {{ provider: 'codex' | 'grok' | 'local', slots: number }}
 */
export function classify(args, slots) {
  const tool = spriteTool(args),
    explicit = optionValue('--provider', args);
  if (explicit && explicit !== 'codex' && explicit !== 'grok')
    die(`provider '${explicit}' is not allowed — P0 uses only the GPT (codex) and Grok subscriptions`);
  /** @type {'codex' | 'grok' | 'local'} */ let provider;
  if (tool) {
    if (REFUSED_TOOLS.includes(tool)) die(`sprite tool '${tool}' reaches a provider P0 does not use — only the GPT (codex) and Grok subscriptions`);
    provider = LOCAL_TOOLS.includes(tool) ? 'local' : GROK_TOOLS.includes(tool) ? 'grok' : /** @type {'codex' | 'grok'} */ (explicit || 'codex');
  } else provider = args[0] === 'codex' || args[0] === 'grok' ? args[0] : 'local';
  let k = 0;
  if (provider === 'codex') {
    k = 1;
    if (tool === 'gen-set') {
      const value = optionValue('--concurrency', args);
      if (!/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > slots)
        die(`codex gen-set must name --concurrency 1..${slots} (its default 6 is past this PC's codex memory limit)`);
      k = Number(value);
    }
  }
  return { provider, slots: k };
}
/** Tool words only — never prompts, paths or requester text. @param {string[]} args */
export function toolLabel(args) {
  const out = [];
  let after = false;
  for (const a of args) {
    if (a.startsWith('-')) continue;
    if (!/^[A-Za-z][A-Za-z0-9:._-]{0,30}$/.test(a)) break;
    out.push(a);
    if (after) break;
    if (['sprite', 'sprite-gen', 'codex', 'grok'].includes(a)) after = true;
    if (out.length >= 4) break;
  }
  return out.join(' ');
}

/**
 * `npm run <script> [-- args]` as the arguments of the node command the kit's package.json names for that script: what npm would run,
 * without npm (Windows starts no npm.cmd without a shell, and a shell would read the requester's words in the arguments).
 * @param {string[]} args @param {Record<string, string> | undefined} scripts @returns {string[]}
 */
export function npmScript(args, scripts) {
  let i = 1;
  while (i < args.length && args[i].startsWith('-')) i += 1;
  if (args[i] !== 'run' && args[i] !== 'run-script') die(`og runs npm only as npm run <script> (got npm ${args.slice(1, 3).join(' ')})`, 127);
  i += 1;
  while (i < args.length && args[i].startsWith('-') && args[i] !== '--') i += 1;
  const name = args[i],
    rest = args.slice(i + 1);
  if (rest[0] === '--') rest.shift();
  const script = scripts?.[name];
  if (typeof script !== 'string' || !/^node( [A-Za-z0-9_./:@=-]+)+$/.test(script))
    die(`npm script '${name}' is not a plain node command og can run without a shell`, 127);
  return [...script.split(' ').slice(1), ...rest];
}

/** @param {string} file */
const isFile = file => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
};
/** @param {string} file */
const isExecutable = file => {
  try {
    accessSync(file, constants.X_OK);
    return isFile(file);
  } catch {
    return false;
  }
};
/** @param {string} file */
const firstLine = file => {
  try {
    return readFileSync(file, 'utf8').slice(0, 200).split('\n', 1)[0];
  } catch {
    return '';
  }
};

/**
 * Where a CLI runs from on a PATH: a native program, or an npm package's own script run with node — mcp/generation-connection.mjs
 * codexCommand's way, which a host's install cannot import (its bin folder is flat), and also for a package installed with --prefix,
 * whose shims sit in node_modules/.bin beside the package rather than above it. Null when none is found.
 * @param {string} name @param {{ PATH?: string, platform?: NodeJS.Platform, node?: string }} [options]
 * @returns {{ command: string, prefix: string[] } | null}
 */
export function cliCommand(name, { PATH = '', platform = process.platform, node = process.execPath } = {}) {
  if (path.isAbsolute(name)) return /\.[cm]?js$/.test(name) ? { command: node, prefix: [name] } : { command: name, prefix: [] };
  const pkg = PROVIDER_PACKAGES[/** @type {keyof typeof PROVIDER_PACKAGES} */ (name)];
  for (const dir of PATH.split(platform === 'win32' ? ';' : ':').filter(Boolean)) {
    if (platform === 'win32') {
      for (const ext of ['.exe', '.com']) if (isFile(path.join(dir, name + ext))) return { command: path.join(dir, name + ext), prefix: [] };
    } else if (isExecutable(path.join(dir, name))) return { command: path.join(dir, name), prefix: [] };
    if (!pkg) continue;
    for (const at of [path.join(dir, 'node_modules', pkg), path.basename(dir) === '.bin' ? path.join(path.dirname(dir), pkg) : '']) {
      if (!at) continue;
      let bin;
      try {
        bin = JSON.parse(readFileSync(path.join(at, 'package.json'), 'utf8')).bin;
      } catch {
        continue;
      }
      const rel = typeof bin === 'string' ? bin : bin?.[name];
      if (typeof rel !== 'string') continue;
      const file = path.join(at, rel);
      if (isFile(file) && (/\.[cm]?js$/.test(file) || /^#!.*\bnode\b/.test(firstLine(file)))) return { command: node, prefix: [file] };
    }
  }
  return null;
}

/**
 * Codex slots: all or nothing, granted in turn (bash og took any free slot files every 4 s, so a run needing two could wait behind runs
 * needing one; past SLOT_WAIT it failed). One pool per install root in this process.
 * @param {number} total
 */
export function createSlots(total) {
  let free = total;
  /** @type {{ k: number, grant: () => void }[]} */
  const queue = [];
  const pump = () => {
    while (queue.length && queue[0].k <= free) {
      const waiter = /** @type {{ k: number, grant: () => void }} */ (queue.shift());
      free -= waiter.k;
      waiter.grant();
    }
  };
  return {
    total,
    get free() {
      return free;
    },
    /** @param {number} k @param {number} waitMs @param {AbortSignal} [signal] @returns {Promise<boolean>} */
    acquire(k, waitMs, signal) {
      if (k <= 0) return Promise.resolve(true);
      if (k > total) return Promise.reject(new OgError(`needs ${k} codex slots, only ${total} exist`));
      return new Promise(resolve => {
        /** @type {NodeJS.Timeout | undefined} */ let timer;
        const cleanup = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', giveUp);
        };
        const waiter = {
          k,
          grant: () => {
            cleanup();
            resolve(true);
          },
        };
        function giveUp() {
          const at = queue.indexOf(waiter);
          if (at < 0) return;
          queue.splice(at, 1);
          cleanup();
          resolve(false);
          pump();
        }
        timer = setTimeout(giveUp, waitMs);
        signal?.addEventListener('abort', giveUp, { once: true });
        queue.push(waiter);
        pump();
        if (signal?.aborted) giveUp();
      });
    },
    /** @param {number} k */
    release(k) {
      if (k > 0) {
        free = Math.min(total, free + k);
        pump();
      }
    },
  };
}
/** @type {Map<string, ReturnType<typeof createSlots>>} */
const POOLS = new Map();
/** capture's children under way: a stop of the command line ends them too (they sit in process groups of their own). */
const CHILDREN = new Set();
/** @param {NodeJS.Signals} [sig] */
export const stopChildren = (sig = 'SIGTERM') => {
  for (const child of CHILDREN) stopTree(child, sig);
};

/**
 * A command's stdout and stderr, its tree stopped at `limitMs` (SIGTERM to its group, SIGKILL `graceMs` later; at once on Windows).
 * A stopped one resolves 124 (137 when SIGKILL ended it), as timeout(1) exits. One that cannot start resolves 127.
 * @param {string} command @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string, limitMs?: number, graceMs?: number, stdin?: string | null, onOutput?: ((chunk: string) => void) | null }} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function capture(command, args, { env, cwd, limitMs = 0, graceMs = KILL_AFTER_MS, stdin = null, onOutput = null } = {}) {
  return new Promise(resolve => {
    let stdout = '',
      stderr = '',
      timedOut = false,
      ended = false;
    /** @type {NodeJS.Timeout | undefined} */ let limit;
    /** @type {NodeJS.Timeout | undefined} */ let kill;
    /** @type {NodeJS.Timeout | undefined} */ let drain;
    /** @type {import('node:child_process').ChildProcess} */ let child;
    try {
      child = spawn(command, args, {
        env,
        cwd,
        stdio: [stdin == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch (/** @type {any} */ error) {
      resolve({ code: 127, stdout, stderr: String(error?.message ?? error) });
      return;
    }
    CHILDREN.add(child);
    /** @param {number} code */
    const end = code => {
      if (ended) return;
      ended = true;
      clearTimeout(limit);
      clearTimeout(kill);
      clearTimeout(drain);
      CHILDREN.delete(child);
      resolve({ code, stdout, stderr });
    };
    child.stdout?.on('data', d => {
      stdout += d;
      try {
        onOutput?.(String(d));
      } catch {}
    });
    child.stderr?.on('data', d => {
      stderr += d;
      try {
        onOutput?.(String(d));
      } catch {}
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(stdin ?? '');
    if (limitMs > 0)
      limit = setTimeout(() => {
        timedOut = true;
        stopTree(child, 'SIGTERM');
        kill = setTimeout(() => stopTree(child, 'SIGKILL'), graceMs);
      }, limitMs);
    /** @param {number | null} code @param {NodeJS.Signals | null} sig */
    const codeOf = (code, sig) => (timedOut ? (sig === 'SIGKILL' || code === 137 ? 137 : 124) : (code ?? 128 + (sig === 'SIGKILL' ? 9 : 15)));
    child.on('exit', (code, sig) => {
      drain = setTimeout(() => end(codeOf(code, sig)), OUTPUT_DRAIN_MS);
    });
    child.on('close', (code, sig) => end(codeOf(code, sig)));
    child.on('error', error => {
      stderr += error.message;
      end(127);
    });
  });
}

/** @param {NodeJS.ProcessEnv} env @param {string} name */
const envValue = (env, name) => env[name] ?? Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];

/** `KEY=value` lines (scripts/host.mjs hostEnv), never sourced. @param {string} text */
const readHostEnv = text =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter(line => /^[A-Z_]+=/.test(line))
      .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );

/**
 * og for a community host's install at `root` (<root>/host.env, <root>/bin/og.mjs). `run`, `health` and `prune` are what the worker calls
 * (generation-worker.mjs ogClient); `main` is the command line.
 * `about`: what the worker's heartbeats say of this PC beside the logins (oddbout-host: `platform`, `runner`, `setup`).
 * @param {{ root: string, env?: NodeJS.ProcessEnv, memory?: number, about?: Record<string, string> | null }} options
 */
export function createOg({ root, env = process.env, memory = os.totalmem(), about = null }) {
  const G = path.resolve(root),
    platform = process.platform;
  const hostFile = path.join(G, 'host.env');
  if (!existsSync(hostFile)) die(`no host.env in ${G} — og.mjs runs a community host's install (the official host runs bash og)`);
  const host = readHostEnv(readFileSync(hostFile, 'utf8'));
  const user = os.userInfo().username;
  const NODE_BIN = env.OG_NODE_BIN || host.NODE_BIN || path.dirname(process.execPath);
  const TOOL_PATH = (host.TOOL_PATH || '').split(path.delimiter).filter(Boolean);
  const BOOTSTRAP_PYTHON = host.PYTHON || '';
  const SLICE_MEMORY = env.OG_SLICE_MEMORY || host.MEMORY || '8G';
  const SLOTS = Number(env.CODEX_SLOTS || host.SLOTS || (platform === 'linux' ? 3 : UNCAPPED_SLOTS));
  const KIT = path.join(G, 'kit'),
    ENGINE = path.join(KIT, 'vendor', 'sprite-gen');
  const KIT_REF_PIN = env.OG_KIT_REF || KIT_REF;
  const RUN_TIMEOUT_S = Number(env.OG_RUN_TIMEOUT || RUN_TIMEOUT),
    SLOT_WAIT_S = Number(env.OG_SLOT_WAIT || SLOT_WAIT);
  const MODEL = env.OG_CODEX_MODEL || CODEX_MODEL;
  const LEDGER = path.join(G, 'ledger.jsonl'),
    PINS = path.join(G, 'accounts.json'),
    RIFE_FILE = path.join(G, 'rife.backend');
  const UNIT_DIR = env.OG_UNIT_DIR || path.join(os.homedir(), '.config', 'systemd', 'user');
  const CONFIG = path.join(G, '.codex', 'config.toml');
  const poolKey = `${G}\0${SLOTS}`;
  const pool = POOLS.get(poolKey) ?? /** @type {ReturnType<typeof createSlots>} */ (POOLS.set(poolKey, createSlots(SLOTS)).get(poolKey));
  /** Runs under way: the command line's stop (Ctrl-C on a foreground worker) ends them first. */
  const active = new Map();
  /** @param {string | Buffer} text */
  const toStdout = text => {
    process.stdout.write(text);
  };
  /** @param {string | Buffer} text */
  const toStderr = text => {
    process.stderr.write(text);
  };

  const nodeExe = () => {
    const at = path.join(NODE_BIN, platform === 'win32' ? 'node.exe' : 'node');
    return isFile(at) ? at : process.execPath;
  };
  const systemDirs = () => {
    if (platform === 'win32') {
      const sys = envValue(env, 'SystemRoot') || 'C:\\Windows';
      return [path.join(sys, 'System32'), sys, path.join(sys, 'System32', 'Wbem'), path.join(sys, 'System32', 'WindowsPowerShell', 'v1.0')];
    }
    return platform === 'darwin' ? ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'] : ['/usr/local/bin', '/usr/bin', '/bin'];
  };
  const rifeBackend = () => {
    try {
      return readFileSync(RIFE_FILE, 'utf8').trim();
    } catch {
      return '';
    }
  };
  /** @param {string} dir */
  const tmpEnv = dir => (platform === 'win32' ? { TMPDIR: dir, TEMP: dir, TMP: dir } : { TMPDIR: dir });
  /**
   * Nothing from the caller's environment (bash og `env -i`): the providers sign in inside the root (HOME, and on Windows USERPROFILE and
   * the AppData folders), so the host's own ~/.codex — its MCP servers, plugins and shell tools — never sees a requester's text.
   * @returns {NodeJS.ProcessEnv}
   */
  const svcEnv = () => {
    /** @type {NodeJS.ProcessEnv} */
    const out = {
      HOME: G,
      USER: user,
      LANG: platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8',
      LC_ALL: platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8',
      TERM: env.TERM || 'dumb',
      PATH: [path.join(G, 'tools', 'node_modules', '.bin'), NODE_BIN, ...TOOL_PATH, ...systemDirs()].join(path.delimiter),
      AI_FIGHTER_ROOT: KIT,
      SPRITE_GEN_CODEX_UNAVAILABLE: 'ask',
      CODEX_HOME: path.join(G, '.codex'),
    };
    if (BOOTSTRAP_PYTHON) out.AI_FIGHTER_BOOTSTRAP_PYTHON = BOOTSTRAP_PYTHON;
    if (rifeBackend() === 'torch') out.SPRITE_GEN_RIFE_BACKEND = 'torch';
    if (platform !== 'linux') out.PYTHONUTF8 = '1';
    if (platform === 'win32') {
      for (const name of WINDOWS_KEEP) {
        const value = envValue(env, name);
        if (value) out[name] = value;
      }
      const tmp = path.join(G, 'tmp');
      mkdirSync(tmp, { recursive: true });
      Object.assign(out, {
        USERPROFILE: G,
        USERNAME: user,
        APPDATA: path.join(G, 'AppData', 'Roaming'),
        LOCALAPPDATA: path.join(G, 'AppData', 'Local'),
        ...tmpEnv(tmp),
      });
    }
    return out;
  };
  const uid = () => (typeof process.getuid === 'function' ? process.getuid() : 0);
  /** systemctl and systemd-run reach the user's manager through these (bash og exports them). */
  const systemdEnv = () => ({ ...env, XDG_RUNTIME_DIR: `/run/user/${uid()}`, DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid()}/bus` });
  const systemdReachable = () => spawnSync('systemctl', ['--user', 'show-environment'], { env: systemdEnv(), stdio: 'ignore' }).status === 0;

  /**
   * A command og runs, ready to spawn: npm scripts as their node command, codex and grok as their packages, and on Linux under the memory
   * slice (bash og in_slice: refused without it unless OG_ALLOW_NO_SLICE=1).
   * @param {string[]} args @param {{ jobDir?: string | null, slice?: boolean, note?: (text: string) => void }} [options]
   * @returns {{ command: string, args: string[], env: NodeJS.ProcessEnv }}
   */
  function commandFor(args, { jobDir = null, slice = true, note = toStderr } = {}) {
    /** @type {NodeJS.ProcessEnv} */
    const runEnv = { ...svcEnv(), ...(jobDir ? tmpEnv(path.join(jobDir, '.tmp')) : {}) };
    let command, rest;
    if (args[0] === 'npm') {
      let scripts;
      try {
        scripts = JSON.parse(readFileSync(path.join(KIT, 'package.json'), 'utf8')).scripts;
      } catch {
        scripts = undefined;
      }
      command = nodeExe();
      rest = npmScript(args, scripts);
      // npm puts the kit's own bin folder first on a script's PATH.
      runEnv.PATH = [path.join(KIT, 'node_modules', '.bin'), runEnv.PATH].join(path.delimiter);
    } else {
      const cli = cliCommand(args[0], { PATH: runEnv.PATH, platform, node: nodeExe() });
      if (!cli) die(`${args[0]} is not on this host's PATH (og setup installs codex and grok)`, 127);
      command = cli.command;
      rest = [...cli.prefix, ...args.slice(1)];
    }
    if (!slice || platform !== 'linux') return { command, args: rest, env: runEnv };
    if (systemdReachable())
      return {
        command: 'systemd-run',
        env: systemdEnv(),
        args: [
          '--user',
          '--scope',
          '--quiet',
          '--collect',
          `--slice=${SLICE}`,
          '--',
          '/usr/bin/env',
          '-i',
          ...Object.entries(runEnv).map(([key, value]) => `${key}=${value}`),
          command,
          ...rest,
        ],
      };
    if (env.OG_ALLOW_NO_SLICE === '1') {
      note('og: user systemd unreachable — running WITHOUT the memory cap (OG_ALLOW_NO_SLICE=1)\n');
      return { command, args: rest, env: runEnv };
    }
    return die(`user systemd for ${user} is unreachable (linger? loginctl enable-linger ${user}) — refusing to run without the ${SLICE} memory cap`, 3);
  }
  /**
   * A provider or kit command outside `og run` (health, logins, versions, setup), its output read.
   * @param {string[]} args @param {{ limitMs?: number, cwd?: string, slice?: boolean, onOutput?: ((chunk: string) => void) | null, extraEnv?: NodeJS.ProcessEnv }} [options]
   */
  async function execCommand(args, { limitMs = 0, cwd = G, slice = false, onOutput = null, extraEnv = {} } = {}) {
    let spec;
    try {
      spec = commandFor(args, { slice });
    } catch (/** @type {any} */ error) {
      if (!(error instanceof OgError)) throw error;
      return { code: error.exit, stdout: '', stderr: `og: ${error.message}\n` };
    }
    return capture(spec.command, spec.args, { env: { ...spec.env, ...extraEnv }, cwd, limitMs, onOutput });
  }

  // ---- the ledger (ledger-report.mjs: no prompt, path or requester text).
  /** @param {Record<string, string | number>} fields @param {(text: string) => void} [note] */
  const ledger = (fields, note = toStderr) => {
    try {
      appendFileSync(LEDGER, JSON.stringify(entry(fields)) + '\n', { mode: 0o600 });
    } catch {
      note('og: ledger write failed\n');
    }
  };

  // ---- identities: pinned at `og login`, required before every provider run.
  /** @returns {Record<string, any>} */
  const pins = () => {
    try {
      return JSON.parse(readFileSync(PINS, 'utf8'));
    } catch {
      return {};
    }
  };
  /** @param {string} p */
  const pinned = p => String(pins()[p] ?? '');
  /** @param {string} p */
  const authFile = p => path.join(G, `.${p}`, 'auth.json');
  /** @param {string} p */
  const current = p => emailsOf(authFile(p))[0] ?? '';
  /** A community host generates on his own subscription by design (host terms); the pin only keeps the account from changing. @param {string} p */
  function guardAccount(p) {
    const pin = pinned(p),
      cur = current(p);
    if (!cur) die(`${p} is not signed in for ${user} (or its identity is unreadable) — og login ${p}`);
    if (!pin) die(`${p} identity was never pinned — og login ${p}`);
    if (cur !== pin) die(`${p} login is ${cur} but the pinned service account is ${pin}`);
    return 'host';
  }

  // Sprite-gen reads the grok token without refreshing it (it lives about 6 h); the CLI refreshes on use. One refresh at a time (the walk
  // and the run film at once), and the second finds the token fresh.
  let grokTurn = Promise.resolve();
  /** @param {(text: string) => void} note */
  function refreshGrok(note) {
    const turn = grokTurn.then(async () => {
      let left = -1;
      try {
        const a = JSON.parse(readFileSync(authFile('grok'), 'utf8'));
        const ends = Object.values(a)
          .map(v => Date.parse(v?.expires_at))
          .filter(Number.isFinite);
        if (ends.length) left = Math.round((Math.max(...ends) - Date.now()) / 60000);
      } catch {
        /* unreadable: refresh */
      }
      if (left >= 45) return;
      note(`og: grok token has ${left} min left — refreshing through the CLI\n`);
      if ((await execCommand(['grok', '-p', OK_PROMPT, '--output-format', 'plain'], { limitMs: 120_000 })).code !== 0)
        die('grok refresh failed — og login grok', 75);
    });
    grokTurn = turn.catch(() => {});
    return turn;
  }

  /** @param {string} job */
  function jobDir(job) {
    if (!/^[0-9]{8}-[a-z0-9][a-z0-9-]{1,40}$/.test(job ?? '')) die(`job id looks like 20261026-red-cat, got '${job ?? ''}'`);
    const dir = path.join(KIT, 'output', job);
    if (!isFile(path.join(dir, 'request.json'))) die(`no job ${job} (og new first)`);
    return dir;
  }
  const openJobs = () => {
    const output = path.join(KIT, 'output');
    let names = [];
    try {
      names = readdirSync(output);
    } catch {
      return [];
    }
    return names.filter(name => isFile(path.join(output, name, 'request.json')) && !existsSync(path.join(output, name, '.closed')));
  };

  /**
   * Codex sessions this job started since `sinceMs`: sessions whose working directory lies under the job folder (bash og codex_sessions).
   * codex 0.157+ keeps them in ~/.codex/state_<n>.sqlite (read with the kit's Python, as bash og reads it with python3); older codex wrote
   * one rollout-*.jsonl per session with the cwd in its first line.
   * @param {string} dir @param {number} [sinceMs]
   */
  async function codexSessions(dir, sinceMs = 0) {
    const codexDir = path.join(G, '.codex');
    const dbs = (await readdir(codexDir).catch(() => []))
      .filter(name => /^state_\d+\.sqlite$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
    if (dbs.length) {
      const python = [spritePython(KIT), BOOTSTRAP_PYTHON].find(p => p && isFile(p)) ?? (platform === 'win32' ? 'python' : 'python3');
      const script = [
        'import os, sqlite3, sys',
        'db, jobdir, since = sys.argv[1], sys.argv[2], int(sys.argv[3])',
        'norm = lambda p: os.path.normcase(os.path.normpath(p)).rstrip("/\\\\") + os.sep',
        'prefixes = {norm(jobdir), norm(os.path.realpath(jobdir))}',
        'con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=10)',
        'rows = con.execute("select cwd from threads where created_at >= ?", (since,)).fetchall()',
        'print(sum(any(norm(cwd).startswith(p) for p in prefixes) for (cwd,) in rows))',
      ].join('\n');
      const result = await capture(
        python,
        ['-I', '-c', script, path.join(codexDir, /** @type {string} */ (dbs.at(-1))), dir, String(Math.floor(sinceMs / 1000))],
        { env: { ...env, PYTHONUTF8: '1' }, limitMs: 60_000 },
      );
      return result.code === 0 && /^\d+\s*$/.test(result.stdout) ? Number(result.stdout) : 0;
    }
    /** @param {string} p */
    const norm = p => {
      const n = path.resolve(p).replace(/[\\/]+$/, '') + path.sep;
      return platform === 'win32' ? n.toLowerCase() : n;
    };
    let real = dir;
    try {
      real = realpathSync(dir);
    } catch {}
    const prefixes = [norm(dir), norm(real)];
    let n = 0;
    for (const file of await filesUnder(path.join(codexDir, 'sessions'))) {
      if (!/^rollout-.*\.jsonl$/.test(path.basename(file))) continue;
      try {
        if (sinceMs && (await stat(file)).mtimeMs <= sinceMs) continue;
        const cwd = JSON.parse((await readFile(file, 'utf8')).split('\n', 1)[0])?.payload?.cwd ?? '';
        if (cwd && prefixes.some(p => norm(cwd).startsWith(p))) n += 1;
      } catch {}
    }
    return n;
  }

  /**
   * One generation step (bash og cmd_run): the job's folder and the command's provider checked, its account guarded (75 when it refuses),
   * its codex slots taken (3 when none came within OG_SLOT_WAIT), then the command in the kit with the install's environment, its output
   * to the job's log, stopped at OG_RUN_TIMEOUT (124) or when `signal` aborts (143, or the abort's numeric reason). The ledger gets a start
   * and an end line. Resolves the exit code; never throws.
   * @param {string} job @param {string[]} argv
   * @param {{ log?: string, stdin?: string, signal?: AbortSignal, onOutput?: ((chunk: string) => void) | null, note?: (text: string) => void, cwd?: string }} [options]
   * @returns {Promise<number>}
   */
  async function run(job, argv, { log, stdin, signal, onOutput = null, note } = {}) {
    /** @param {string} text */
    const say =
      note ??
      (text => {
        if (log) {
          try {
            appendFileSync(log, text);
          } catch {}
        }
        try {
          onOutput?.(text);
        } catch {}
      });
    const args = argv[0] === '--' ? argv.slice(1) : argv;
    if (!args.length) {
      say('og: usage: og run <job> -- <command...>\n');
      return 1;
    }
    // A refusal from here until the command starts exits 3, sprite-gen's own "nothing was sent"; the account's refusal exits 75.
    let dir,
      provider,
      k,
      account = 'none';
    try {
      dir = jobDir(job);
      ({ provider, slots: k } = classify(args, SLOTS));
    } catch (/** @type {any} */ error) {
      say(`og: ${error?.message ?? error}\n`);
      return 3;
    }
    try {
      if (provider !== 'local') account = guardAccount(provider);
      if (provider === 'grok') await refreshGrok(say);
    } catch (/** @type {any} */ error) {
      say(`og: ${error?.message ?? error}\n`);
      return error instanceof OgError ? 75 : 3;
    }
    const stop = new AbortController(),
      forward = () => stop.abort(signal?.reason);
    signal?.addEventListener('abort', forward, { once: true });
    if (signal?.aborted) forward();
    const ended = (async () => {
      const runId = `${Date.now()}${String(process.hrtime.bigint() % 1_000_000n).padStart(6, '0')}`,
        tool = toolLabel(args),
        mark = Date.now();
      rmSync(path.join(dir, '.delivered'), { force: true }); // the package may change; deliver again
      mkdirSync(path.join(dir, '.tmp'), { recursive: true }); // scratch dirs stay inside the job: purge removes them, and their codex sessions count
      ledger({ job, kind: 'run', phase: 'start', run: runId, tool, provider, account }, say);
      let held = 0,
        waitMs = 0,
        /** @type {number | null} */ t0 = null;
      /** @param {number} rc */
      const finish = async rc => {
        pool.release(held);
        held = 0;
        const ms = t0 === null ? 0 : Date.now() - t0,
          sessions = await codexSessions(dir, mark);
        ledger({ job, kind: 'run', phase: 'end', run: runId, tool, provider, account, ms, waitMs, exit: rc, codexSessions: sessions }, say);
        if (provider !== 'codex' && sessions > 0)
          say(
            `og: WARNING — '${tool}' was classified ${provider} but ${sessions} codex session(s) started in this job meanwhile (it, or a run overlapping it)\n`,
          );
        return rc;
      };
      const stoppedCode = () => (typeof stop.signal.reason === 'number' ? stop.signal.reason : 143);
      const t1 = Date.now();
      let got;
      try {
        got = await pool.acquire(k, SLOT_WAIT_S * 1000, stop.signal);
      } catch (/** @type {any} */ error) {
        say(`og: ${error.message}\n`);
        return finish(3);
      }
      waitMs = Date.now() - t1;
      if (got) held = k;
      if (stop.signal.aborted) return finish(stoppedCode());
      if (!got) {
        const rc = await finish(3);
        say(`og: no ${k} free codex slot(s) within ${SLOT_WAIT_S}s — not started\n`);
        return rc;
      }
      t0 = Date.now();
      let spec;
      try {
        spec = commandFor(args, { jobDir: dir, note: say });
      } catch (/** @type {any} */ error) {
        say(`og: ${error?.message ?? error}\n`);
        return finish(error instanceof OgError ? error.exit : 127);
      }
      let timedOut = false;
      const limit = new AbortController(),
        timer = setTimeout(() => {
          timedOut = true;
          limit.abort();
        }, RUN_TIMEOUT_S * 1000);
      const onStop = () => limit.abort();
      stop.signal.addEventListener('abort', onStop, { once: true });
      if (stop.signal.aborted) onStop();
      const code = await runChild(spec.command, spec.args, { cwd: KIT, log, stdin, signal: limit.signal, graceMs: KILL_AFTER_MS, onOutput, env: spec.env });
      clearTimeout(timer);
      stop.signal.removeEventListener('abort', onStop);
      return finish(stop.signal.aborted ? stoppedCode() : timedOut ? (code === 137 ? 137 : 124) : code);
    })();
    active.set(stop, ended);
    try {
      return await ended;
    } finally {
      active.delete(stop);
      signal?.removeEventListener('abort', forward);
    }
  }

  // ---- commands (bash og cmd_*). Each writes through `io` and returns its exit code, or throws OgError.
  /** @typedef {{ out: (text: string | Buffer) => void, err: (text: string) => void, stdin?: () => Promise<string> }} Io */

  /** @param {Io} io */
  async function cmdHealth(io) {
    for (const p of /** @type {const} */ (['codex', 'grok'])) {
      try {
        guardAccount(p);
      } catch (/** @type {any} */ error) {
        if (!(error instanceof OgError)) throw error;
        io.out(`og: ${p} NOT READY — ${error.message}\n`);
        continue;
      }
      const t = Date.now();
      if (p === 'codex' && !(await pool.acquire(1, SLOT_WAIT_S * 1000))) {
        io.out(`og: codex NOT READY — no free codex slot within ${SLOT_WAIT_S}s\n`);
        continue;
      }
      let result;
      try {
        result = await execCommand(
          p === 'codex'
            ? ['codex', 'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-m', MODEL, OK_PROMPT]
            : ['grok', '-p', OK_PROMPT, '--output-format', 'plain'],
          { limitMs: 180_000, slice: true },
        );
      } finally {
        if (p === 'codex') pool.release(1);
      }
      ledger({ job: '_health', kind: 'health', provider: p, ms: Date.now() - t, exit: result.code }, io.err);
      const last = result.stdout.trimEnd().split('\n').at(-1) ?? '';
      if (result.code === 0 && last.replace(/[\s!-/:-@[-`{-~]/g, '').toLowerCase() === 'ok') io.out(`og: ${p} ok (${pinned(p)})\n`);
      else io.out(`og: ${p} FAILED (exit ${result.code})\n${result.stderr.trimEnd().split('\n').slice(-5).join('\n')}\n`);
    }
    return 0;
  }

  /** @param {Io} io @param {string[]} args */
  async function cmdLogin(io, [p, ...options]) {
    if (p !== 'codex' && p !== 'grok') die('usage: og login codex|grok [--replace]');
    let replace = false;
    for (const option of options) {
      if (option === '--replace') replace = true;
      else if (option === '--allow-personal') die(`--allow-personal needs the operator's personal ${p} login readable on the operator side`);
      else die(`unknown option ${option}`);
    }
    // The device code must reach the person signing in: the provider's own output, as it comes.
    await execCommand([p, 'login', '--device-auth'], { limitMs: 20 * 60_000, onOutput: chunk => io.out(chunk) });
    const cur = current(p),
      pin = pinned(p);
    // A refused login must not stay behind: its tokens would sit in the install's HOME.
    if (!cur) {
      await cmdLogout({ out: () => {}, err: io.err }, [p]).catch(() => {});
      die(`${p} login left no readable identity in ${authFile(p)} — signed out, not pinning`);
    }
    if (pin && pin !== cur && !replace) {
      await cmdLogout({ out: () => {}, err: io.err }, [p]).catch(() => {});
      die(`${p} signed in as ${cur} but ${pin} is pinned — signed out; og login ${p} --replace to change the account`);
    }
    const next = pins();
    next[p] = cur;
    next.personal ??= {};
    delete next.personal[p];
    writeFileSync(PINS, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    const described = emailsOf(authFile(p), true).join('\n');
    // A ChatGPT login on the free plan signs in but cannot make the pictures: say so at once, not at the first job.
    if (p === 'codex' && described.includes('(plan free'))
      io.err('og: WARNING this ChatGPT account is on the free plan — hosting needs a paid plan (Plus, Pro, Team): og login codex --replace\n');
    io.out(`og: ${p} pinned: ${described} — this host's own subscription; og health next\n`);
    return 0;
  }

  /** @param {Io} io @param {string[]} args */
  async function cmdLogout(io, [p]) {
    if (p !== 'codex' && p !== 'grok') die('usage: og logout codex|grok');
    await execCommand([p, 'logout'], { limitMs: 60_000 });
    rmSync(authFile(p), { force: true });
    if (current(p)) die(`${p} is still signed in for ${user}`);
    io.out(`og: ${p} signed out for ${user}\n`);
    return 0;
  }

  /** @param {Io} io @param {string[]} args */
  function cmdExplain(io, args) {
    const command = args[0] === '--' ? args.slice(1) : args,
      c = classify(command, SLOTS);
    io.out(`provider ${c.provider}  codex-slots ${c.slots}  ledger "${toolLabel(command)}"\n`);
    return 0;
  }

  /** @param {Io} io @param {string[]} args */
  function cmdPurge(io, [job, flag]) {
    const dir = jobDir(job);
    if (!existsSync(path.join(dir, '.closed')) && flag !== '--cancelled') die(`${job} is not closed — og purge ${job} --cancelled for an abandoned request`);
    rmSync(dir, { recursive: true, force: true });
    rmSync(path.join(G, 'deliveries', `${job}.zip`), { force: true });
    ledger({ job, kind: 'purge' }, io.err);
    io.out(`og: ${job} purged\n`);
    return 0;
  }

  /** find -mtime +days: whole days of age, rounded down, past `days`. @param {number} mtimeMs @param {number} days */
  const olderThan = (mtimeMs, days) => Math.floor((Date.now() - mtimeMs) / 86_400_000) > days;
  /** @param {Io} io @param {string[]} args */
  async function cmdPrune(io, [daysArg = '30']) {
    if (!/^[0-9]+$/.test(daysArg)) die('usage: og prune [days]');
    const days = Number(daysArg);
    for (const dir of ['sessions', 'generated_images'])
      for (const file of await filesUnder(path.join(G, '.codex', dir))) {
        try {
          if (olderThan((await stat(file)).mtimeMs, days)) rmSync(file, { force: true });
        } catch {}
      }
    const output = path.join(KIT, 'output');
    /** @type {string[]} */
    let names = [];
    try {
      names = readdirSync(output);
    } catch {}
    for (const name of names) {
      const closed = path.join(output, name, '.closed');
      try {
        if (isFile(closed) && olderThan(statSync(closed).mtimeMs, days)) cmdPurge(io, [name]);
      } catch (/** @type {any} */ error) {
        if (!(error instanceof OgError)) throw error;
        io.err(`og: ${error.message}\n`);
      }
    }
    // A worker job the API cancelled or expired never gets .closed (the worker only learns it lost the lease). No file of it changed in 14
    // days (or `days`, when longer) — past the 7-day wait for its creator — means it is over: its request text and pictures go.
    const idle = Math.max(days, 14),
      since = Date.now() - idle * 86_400_000;
    for (const name of names.filter(name => name.includes('-gen-'))) {
      const dir = path.join(output, name);
      if (!isFile(path.join(dir, 'request.json')) || existsSync(path.join(dir, '.closed'))) continue;
      if (await newerUnder(dir, since)) continue;
      try {
        cmdPurge(io, [name, '--cancelled']);
      } catch (/** @type {any} */ error) {
        if (!(error instanceof OgError)) throw error;
        io.err(`og: ${error.message}\n`);
      }
    }
    io.out(`og: provider sessions and closed jobs older than ${days} days removed, idle worker jobs older than ${idle}\n`);
    return 0;
  }

  /** One file of a job to stdout, for the host to look at. @param {Io} io @param {string[]} args */
  function cmdCat(io, [job, rel = '']) {
    const dir = jobDir(job);
    if (!/^[A-Za-z0-9._/-]+$/.test(rel) || rel.includes('..')) die('usage: og cat <job> <path inside the job> > file');
    /** @type {string} */
    let real;
    try {
      real = realpathSync(path.join(dir, rel));
    } catch {
      die(`no ${rel} in ${job}`);
    }
    if (!real.startsWith(realpathSync(dir) + path.sep) || !isFile(real)) die(`${rel} is not a file inside ${job}`);
    io.out(readFileSync(real));
    return 0;
  }

  const memoryNote = () => {
    if (platform === 'linux') return '';
    const gb = Math.round(memory / 2 ** 30);
    return memory < LOW_MEMORY_BYTES
      ? `og: WARNING this PC has ${gb} GB of memory and no memory cap off Linux — ${SLOTS} codex slot(s); keep --slots ${UNCAPPED_SLOTS} and close other heavy programs while it generates\n`
      : '';
  };

  /** @param {Io} io */
  async function cmdStatus(io) {
    const head = spawnSync('git', ['-C', KIT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', windowsHide: true });
    /** @param {'codex' | 'grok'} p */
    const version = async p => {
      const r = await execCommand([p, '--version'], { limitMs: 30_000 });
      return r.code === 0 ? r.stdout.trim().split('\n')[0] : 'missing';
    };
    io.out(`root    ${G} (user ${user}, user install)\n`);
    const zip = zipKit();
    io.out(
      zip
        ? `kit     ${zip.version} (zip ${zip.sha256.slice(0, 12)}, oddbout-host)\n`
        : `kit     ${head.status === 0 ? head.stdout.trim() : 'missing'} (pinned ${KIT_REF_PIN.slice(0, 7)})\n`,
    );
    io.out(`codex   ${await version('codex')}   pinned: ${pinned('codex')}\n`);
    io.out(`grok    ${await version('grok')}   pinned: ${pinned('grok')}\n`);
    if (platform === 'linux') {
      const max = spawnSync('systemctl', ['--user', 'show', '-p', 'MemoryMax', '--value', SLICE], { env: systemdEnv(), encoding: 'utf8' });
      io.out(`slice   ${SLICE} MemoryMax=${max.status === 0 ? max.stdout.trim() : '?'}\n`);
    } else io.out(`memory  no cap on ${platform} — ${SLOTS} codex slot(s), ${Math.round(memory / 2 ** 30)} GB\n`);
    io.err(memoryNote());
    await cmdRife(io, ['status']);
    for (const name of (() => {
      try {
        return readdirSync(path.join(KIT, 'output')).sort();
      } catch {
        return [];
      }
    })()) {
      const dir = path.join(KIT, 'output', name);
      if (!isFile(path.join(dir, 'request.json'))) continue;
      io.out(`job     ${name} ${existsSync(path.join(dir, '.closed')) ? 'closed' : existsSync(path.join(dir, '.delivered')) ? 'delivered' : 'open'}\n`);
    }
    return 0;
  }

  /** @param {Io} io @param {string[]} args */
  async function cmdReport(io, args) {
    const result = await capture(nodeExe(), [path.join(HERE, 'ledger-report.mjs'), LEDGER, ...args], { env });
    io.out(result.stdout);
    io.err(result.stderr);
    return result.code;
  }

  // og rife torch|ncnn|status — which RIFE the alignment runs. torch needs an NVIDIA GPU (CUDA) and about 3 GB for PyTorch in the engine's venv.
  const venvTool = (/** @type {string} */ name) => path.join(path.dirname(spritePython(KIT)), platform === 'win32' ? `${name}.exe` : name);
  async function rifeTorchInstall() {
    if ((await capture('nvidia-smi', ['-L'], { env, limitMs: 30_000 })).code !== 0) die('no NVIDIA GPU here — keep the binary (og rife ncnn)');
    const python = spritePython(KIT),
      svc = svcEnv();
    if (
      (await capture(python, ['-I', '-c', 'import torch'], { env: svc })).code !== 0 &&
      (await capture(venvTool('pip'), ['install', '--quiet', '--progress-bar', 'off', 'torch>=2.13.0,<3'], { env: svc })).code !== 0
    )
      die('PyTorch did not install');
    if ((await capture(python, ['-I', '-c', 'import torch, sys; sys.exit(0 if torch.cuda.is_available() else 1)'], { env: svc })).code !== 0)
      die('PyTorch sees no CUDA device — keep the binary (og rife ncnn)');
    if (
      (await capture(venvTool('sprite-gen'), ['rife', 'install', '--backend', 'torch'], { env: { ...svc, SPRITE_GEN_RIFE_BACKEND: 'torch' }, cwd: ENGINE }))
        .code !== 0
    )
      die('the torch model did not install');
  }
  /** @param {Io} io @param {string[]} args */
  async function cmdRife(io, [which = 'status']) {
    if (which === 'torch' || which === 'ncnn') {
      const open = openJobs();
      if (open.length)
        die(
          which === 'torch' ? `jobs still open — a loop half aligned one way would finish the other: ${open.join(' ')}` : `jobs still open: ${open.join(' ')}`,
        );
    }
    if (which === 'torch') {
      await rifeTorchInstall();
      writeFileSync(RIFE_FILE, 'torch\n');
      io.out('og: RIFE runs on PyTorch (CUDA)\n');
    } else if (which === 'ncnn') {
      rmSync(RIFE_FILE, { force: true });
      io.out('og: RIFE runs the ncnn binary\n');
    } else if (which === 'status') io.out(`rife    ${rifeBackend() || 'ncnn'}\n`);
    else die('usage: og rife torch|ncnn|status');
    return 0;
  }

  // ---- codex reaches only what generation needs (bash og harden; README.md beside this file says why each is off).
  /** @param {string} [text] */
  const configText = text =>
    text ??
    (() => {
      try {
        return readFileSync(CONFIG, 'utf8');
      } catch {
        return null;
      }
    })();
  const codexFeaturesOff = () => {
    const text = configText();
    if (text === null || !/^\[features\]/m.test(text)) return false;
    const off = (/** @type {string} */ k) => new RegExp(`^[ \\t]*${k}[ \\t]*=[ \\t]*false`, 'm').test(text);
    return CODEX_OFF.every(off) && !CODEX_KEEP_ON.some(off);
  };
  /** Whether a top-level line before the first table sets project_doc_max_bytes (`any`: to anything; else to 0). @param {boolean} [any] */
  const codexDocsLine = (any = false) => {
    const text = configText();
    if (text === null) return false;
    const value = new RegExp(`^[ \\t]*project_doc_max_bytes[ \\t]*=[ \\t]*${any ? '' : '0[ \\t]*(#.*)?$'}`);
    for (const line of text.split(/\r?\n/)) {
      if (/^[ \t]*\[/.test(line)) return false;
      if (value.test(line)) return true;
    }
    return false;
  };
  /** @param {Io} io */
  function hardenDocs(io) {
    if (codexDocsLine()) return;
    if (codexDocsLine(true)) die(`${CONFIG} sets project_doc_max_bytes — set it to 0 there by hand (codex would read the kit's AGENTS.md)`);
    mkdirSync(path.dirname(CONFIG), { recursive: true });
    writeFileSync(
      CONFIG,
      `${DOCS_MARK} codex reads no project's AGENTS.md (og runs every command in the kit).\nproject_doc_max_bytes = 0\n\n${configText() ?? ''}`,
    );
    io.out('og: codex project instructions off (project_doc_max_bytes = 0)\n');
  }
  /** @param {Io} io */
  function cmdHarden(io) {
    if (codexFeaturesOff() && codexDocsLine()) {
      io.out('og: codex features and project instructions already off\n');
      return 0;
    }
    mkdirSync(path.dirname(CONFIG), { recursive: true });
    hardenDocs(io);
    if (codexFeaturesOff()) return 0;
    // The block an earlier og harden appended is written again; any other [features] table is the host's to edit.
    let text = configText() ?? '';
    if (text.split('\n').some(line => line.startsWith(HARDEN_MARK))) {
      let skip = false;
      const kept = [];
      for (const line of text.replace(/\n$/, '').split('\n')) {
        if (line.startsWith(HARDEN_MARK)) {
          skip = true;
          continue;
        }
        if (skip && (line === '[features]' || /^[a-z_]+ = (true|false)$/.test(line) || /^\s*$/.test(line))) continue;
        skip = false;
        kept.push(line);
      }
      text = kept.length ? `${kept.join('\n')}\n` : '';
      writeFileSync(CONFIG, text);
    }
    if (/^\[features\]/m.test(text)) die(`${CONFIG} already has a [features] table — set ${CODEX_OFF.join(' ')} to false there by hand`);
    appendFileSync(
      CONFIG,
      `\n${HARDEN_MARK} the service codex reaches no shell, files, browser, computer, plugins or sub-agents.\n[features]\n${CODEX_OFF.map(k => `${k} = false\n`).join('')}`,
    );
    io.out(`og: codex features off: ${CODEX_OFF.join(' ')}\n`);
    return 0;
  }

  /**
   * The kit oddbout-host unpacked from its pinned ZIP (runner.mjs, 2026-11-07): `<kit>/.oddbout-kit.json`, and no Git checkout. setup then
   * leaves the kit as it is (no clone, no fetch) and only installs what runs it.
   * @returns {{ version: string, sha256: string } | null}
   */
  const zipKit = () => {
    if (existsSync(path.join(KIT, '.git'))) return null;
    try {
      const k = JSON.parse(readFileSync(path.join(KIT, '.oddbout-kit.json'), 'utf8'));
      return typeof k?.sha256 === 'string' ? k : null;
    } catch {
      return null;
    }
  };
  const npmCli = () => {
    const node = nodeExe();
    return (
      [
        path.join(path.dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(path.dirname(node), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ].find(isFile) ?? die(`npm not found beside ${node}`)
    );
  };
  /** One setup step's command, its output to `io.err`; a failure dies with `what`. @param {Io} io */
  const stepper = io => {
    const callerEnv = { ...env, PATH: [NODE_BIN, envValue(env, 'PATH') ?? ''].join(path.delimiter) };
    /** @param {string} what @param {string} command @param {string[]} args @param {{ env?: NodeJS.ProcessEnv, cwd?: string }} [options] */
    return async (what, command, args, options = {}) => {
      const r = await capture(command, args, { env: options.env ?? callerEnv, cwd: options.cwd ?? G, onOutput: chunk => io.err(chunk) });
      if (r.code !== 0) die(`${what} failed (exit ${r.code})`);
      return r.stdout;
    };
  };
  /**
   * setup's steps one at a time, for oddbout-host's first run (runner.mjs reports each to the site): `kit` the kit's Node packages,
   * `engine` sprite-gen's venv with img2webp and RIFE (sprite:setup), `slice` the Linux memory cap. The kit itself and the CLIs are the
   * runner's (its pins.json); `og setup` runs every step after its own.
   * @param {'kit' | 'engine' | 'slice'} name @param {Io} io
   */
  async function setupStep(name, io) {
    const step = stepper(io);
    if (name === 'kit')
      await step('installing the kit', nodeExe(), [npmCli(), 'ci', '--ignore-scripts', '--no-fund', '--no-audit', '--loglevel=error'], {
        env: svcEnv(),
        cwd: KIT,
      });
    else if (name === 'engine') {
      for (const script of ['sprite:setup', 'sprite:status']) {
        const spec = commandFor(['npm', 'run', script], { slice: false });
        await step(script, spec.command, spec.args, { env: spec.env, cwd: KIT });
      }
      // A torch backend chosen before stays: a new venv gets PyTorch and the model again.
      if (rifeBackend() === 'torch') await rifeTorchInstall();
    } else if (name === 'slice') {
      if (platform !== 'linux') return;
      mkdirSync(UNIT_DIR, { recursive: true });
      writeFileSync(
        path.join(UNIT_DIR, SLICE),
        `[Unit]\nDescription=ODDBOUT hosted fighter generation (memory cap)\n\n[Slice]\nMemoryMax=${SLICE_MEMORY}\nMemorySwapMax=0\n`,
      );
      spawnSync('systemctl', ['--user', 'daemon-reload'], { env: systemdEnv(), stdio: 'ignore' });
    } else die(`no setup step ${name}`);
  }

  /** The kit and the provider CLIs (bash og cmd_setup), with npm run as node and npm-cli.js. @param {Io} io */
  async function cmdSetup(io) {
    const open = openJobs();
    if (open.length) die(`jobs still open — setup changes the kit and CLIs under them: ${open.join(' ')}`);
    mkdirSync(path.join(G, 'tools'), { recursive: true });
    mkdirSync(path.join(G, 'deliveries'), { recursive: true });
    const node = nodeExe(),
      step = stepper(io);
    await step('installing the provider CLIs', node, [
      npmCli(),
      'install',
      '--prefix',
      path.join(G, 'tools'),
      '--no-fund',
      '--no-audit',
      '--loglevel=error',
      `@openai/codex@${CODEX_VERSION}`,
      `@xai-official/grok@${GROK_VERSION}`,
    ]);
    // A kit oddbout-host unpacked from its pinned ZIP has no Git: it changes only with the runner's next pin.
    if (!zipKit()) await setupKitGit(step);
    for (const name of /** @type {const} */ (['kit', 'engine', 'slice'])) await setupStep(name, io);
    return cmdStatus(io);
  }
  /** The kit's Git checkout at KIT_REF and its engine submodule (bash og cmd_setup). @param {ReturnType<typeof stepper>} step */
  async function setupKitGit(step) {
    if (!existsSync(path.join(KIT, '.git'))) await step('cloning the kit', 'git', ['clone', '--quiet', '--branch', 'main', KIT_URL, KIT]);
    if ((await step('reading the kit', 'git', ['-C', KIT, 'rev-parse', 'HEAD'])).trim() !== KIT_REF_PIN) {
      // sprite:setup patches the submodule's tracked files; drop the patch (not the venv) so the new gitlink checks out.
      await step('resetting the engine', 'git', ['-C', KIT, 'submodule', 'foreach', '--quiet', '--recursive', 'git checkout --quiet -- .']);
      if ((await step('reading the kit', 'git', ['-C', KIT, 'status', '--porcelain', '--untracked-files=no', '--ignore-submodules=dirty'])).trim())
        die('kit has local changes');
      await step('fetching the kit', 'git', ['-C', KIT, 'fetch', '--quiet', '--no-recurse-submodules', 'origin', 'main']);
      await step('checking out the kit', 'git', ['-C', KIT, 'checkout', '--quiet', '--detach', KIT_REF_PIN]);
    }
    await step('syncing the engine', 'git', ['-C', KIT, 'submodule', 'sync', '--recursive', '--quiet']);
    for (const line of (await step('reading the engine', 'git', ['-C', KIT, 'submodule', 'status', '--recursive'])).split('\n')) {
      const at = line.trim().split(/\s+/)[1];
      if (!line.startsWith('+') || !at) continue;
      await step('resetting the engine', 'git', ['-C', path.join(KIT, at), 'checkout', '--quiet', '--', '.']);
      await step('resetting the engine', 'git', ['-C', path.join(KIT, at), 'clean', '-fdq']);
    }
    await step('checking out the engine', 'git', ['-C', KIT, 'submodule', 'update', '--init', '--recursive', '--quiet']);
  }

  /**
   * worker.env written whole (mode 600, renamed into place): the lines it has that `keep` keeps, then `lines` (bash og's `worker key`
   * and `worker judges` the same).
   * @param {(line: string) => boolean} keep @param {string[]} lines
   */
  function writeWorkerEnv(keep, lines) {
    const file = path.join(G, 'worker.env');
    /** @type {string[]} */
    let kept = [];
    try {
      kept = readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter(line => line && keep(line));
    } catch {}
    writeFileSync(`${file}.new`, [...kept, ...lines].map(line => `${line}\n`).join(''), { mode: 0o600 });
    renameSync(`${file}.new`, file);
  }

  /** The hosted generation worker: in this process, with this og (bash og ran generation-worker.mjs as its own process). @param {Io} io @param {string[]} args */
  async function cmdWorker(io, [what, ...rest]) {
    switch (what) {
      case 'run':
        if (!codexFeaturesOff()) die('og harden first — the worker runs player text through codex');
        // A host whose files were updated before og harden ran again takes the project-docs line here: a restriction og owns.
        hardenDocs({ out: /** @type {Io['out']} */ (io.err), err: io.err });
        io.err(memoryNote());
        await workerMain({ once: rest.includes('--once'), root: G, og: api, python: spritePython(KIT), about });
        return 0;
      case 'key': {
        // The API base on the command line, the worker key (afw_…, scope generation) on stdin — never in argv or the ledger.
        const base = rest[0] ?? '';
        if (!/^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._/-]*)?$/.test(base)) die('usage: og worker key <https://…/functions/v1/ai-fighter> < key-file');
        const key = (await (io.stdin?.() ?? Promise.resolve(''))).replace(/\s/g, '');
        if (!/^afw_[a-f0-9]{64}$/.test(key)) die('the key on stdin must be afw_ and 64 hex');
        // The other settings (ODDBOUT_GENERATION_KEEP_DAYS, ODDBOUT_GENERATION_JUDGES) stay: a new key never resets them (2026-11-06).
        writeWorkerEnv(
          line => !/^ODDBOUT_GENERATION_(API|WORKER_KEY)=/.test(line),
          [`ODDBOUT_GENERATION_API=${base.replace(/\/$/, '')}`, `ODDBOUT_GENERATION_WORKER_KEY=${key}`],
        );
        io.out('og: worker.env written\n');
        return 0;
      }
      case 'judges': {
        // Who judges the side takes and the walk and run loops (generation-stages JUDGE_MODES), read when the worker starts (2026-11-06).
        const mode = rest[0] ?? '';
        if (!['codex', 'pixels', 'hybrid'].includes(mode)) die('usage: og worker judges codex|pixels|hybrid');
        if (!existsSync(path.join(G, 'worker.env'))) die('og worker key first');
        writeWorkerEnv(line => !line.startsWith('ODDBOUT_GENERATION_JUDGES='), [`ODDBOUT_GENERATION_JUDGES=${mode}`]);
        io.out(`og: judges ${mode} — restart the worker to take it\n`);
        return 0;
      }
      case 'log': {
        const n = Number(rest[0] ?? 40) || 40;
        /** @type {string[]} */
        let lines = [];
        try {
          lines = readFileSync(path.join(G, 'worker.log'), 'utf8').replace(/\n$/, '').split('\n');
        } catch {}
        io.out(lines.slice(-n).join('\n') + (lines.length ? '\n' : ''));
        return 0;
      }
      case 'install':
      case 'uninstall':
      case 'start':
      case 'stop':
      case 'restart':
      case 'status': {
        if (platform !== 'linux') die(`no background service on ${platform} — keep og worker run going in a terminal (it stops with that terminal)`);
        const systemctl = (/** @type {string[]} */ ...args) => spawnSync('systemctl', ['--user', ...args], { env: systemdEnv(), encoding: 'utf8' });
        if (what === 'install') {
          if (!existsSync(path.join(G, 'worker.env'))) die('og worker key first');
          mkdirSync(UNIT_DIR, { recursive: true });
          writeFileSync(
            path.join(UNIT_DIR, WORKER_UNIT),
            [
              '[Unit]',
              'Description=ODDBOUT hosted fighter generation worker',
              'After=network-online.target',
              '',
              '[Service]',
              `ExecStart=${nodeExe()} ${path.join(G, 'bin', 'og.mjs')} worker run`,
              'Restart=always',
              'RestartSec=30',
              `Slice=${SLICE}`,
              '',
              '[Install]',
              'WantedBy=default.target',
              '',
            ].join('\n'),
          );
          if (systemctl('daemon-reload').status !== 0 || systemctl('enable', '--now', WORKER_UNIT).status !== 0) return 1;
          io.out('og: worker installed and started\n');
          return 0;
        }
        if (what === 'uninstall') {
          systemctl('disable', '--now', WORKER_UNIT);
          rmSync(path.join(UNIT_DIR, WORKER_UNIT), { force: true });
          rmSync(path.join(UNIT_DIR, SLICE), { force: true }); // a host's memory slice is this install's alone
          systemctl('daemon-reload');
          io.out('og: worker stopped and its unit removed\n');
          return 0;
        }
        const r = systemctl(what, WORKER_UNIT, '--no-pager');
        io.out(r.stdout ?? '');
        io.err(r.stderr ?? '');
        return r.status ?? 1;
      }
      default:
        die(
          'usage: og worker run [--once] | key <api-base> < key | judges codex|pixels|hybrid | log [n] (Linux: install | uninstall | start | stop | restart | status)',
        );
    }
  }

  const USAGE = `og.mjs setup | login codex|grok [--replace] | logout codex|grok | health | status | report [job]
og.mjs explain -- <command...>          what a command bills, its codex slots and ledger label
og.mjs run <job> -- <command...>        every generation step goes through this
og.mjs purge <job> [--cancelled] | prune [days]
og.mjs cat <job> <path> > file          read one file of a job
og.mjs harden                           turn off codex's shell, file, browser and plugin features and its reading of AGENTS.md (the worker needs it)
og.mjs rife torch|ncnn|status           the loop alignment's RIFE: PyTorch on an NVIDIA GPU (fast) or the ncnn binary (default)
og.mjs worker key <api-base> < key | judges codex|pixels|hybrid | run [--once] | log [n]; on Linux also install | uninstall | start | stop | restart | status
A community host's og on Windows, macOS or Linux (bash og is the official host's). new, deliver, close and self-update are the official host's only.
`;

  /**
   * The command line: `og.mjs <command> …` as bash og's user mode. Resolves { code }; output goes through `io`.
   * @param {string[]} argv @param {Partial<Io> & { signal?: AbortSignal }} [options]
   */
  async function main(argv, { out = toStdout, err = toStderr, stdin, signal } = {}) {
    const io = { out, err, stdin };
    const [command, ...args] = argv;
    try {
      switch (command) {
        case 'setup':
          return { code: await cmdSetup(io) };
        case 'login':
          return { code: await cmdLogin(io, args) };
        case 'logout':
          return { code: await cmdLogout(io, args) };
        case 'health':
          return { code: await cmdHealth(io) };
        case 'explain':
          return { code: cmdExplain(io, args) };
        case 'run': {
          const [job, ...rest] = args;
          return { code: await run(job, rest, { stdin: await (stdin?.() ?? Promise.resolve('')), signal, onOutput: out, note: err }) };
        }
        case 'purge':
          return { code: cmdPurge(io, args) };
        case 'prune':
          return { code: await cmdPrune(io, args) };
        case 'cat':
          return { code: cmdCat(io, args) };
        case 'status':
          return { code: await cmdStatus(io) };
        case 'report':
          return { code: await cmdReport(io, args) };
        case 'harden':
          return { code: cmdHarden(io) };
        case 'rife':
          return { code: await cmdRife(io, args) };
        case 'worker':
          return { code: await cmdWorker(io, args) };
        case 'new':
        case 'deliver':
        case 'close':
          return die(`${command} ${SERVICE_ONLY}`);
        case 'self-update':
          return die('a community host updates with npm run host -- update (from the kit checkout)');
        default:
          out(USAGE);
          return { code: 2 };
      }
    } catch (/** @type {any} */ error) {
      if (!(error instanceof OgError)) throw error;
      err(`og: ${error.message}\n`);
      return { code: error.exit };
    }
  }

  /** @param {(io: Io) => Promise<unknown> | unknown} command */
  async function said(command) {
    let text = '';
    const io = {
      out: (/** @type {string | Buffer} */ t) => {
        text += t;
      },
      err: (/** @type {string} */ t) => {
        text += t;
      },
    };
    try {
      await command(io);
    } catch (/** @type {any} */ error) {
      if (!(error instanceof OgError)) throw error;
      text += `og: ${error.message}\n`;
    }
    return text;
  }

  const api = {
    root: G,
    slots: SLOTS,
    pool,
    run,
    /** One of setup's steps (oddbout-host's first run). Throws OgError. @param {'kit' | 'engine' | 'slice'} name @param {Io} io */
    setupStep: (/** @type {'kit' | 'engine' | 'slice'} */ name, /** @type {Io} */ io) => setupStep(name, io),
    /** `og health`'s lines (generation-worker.mjs parseHealth). */
    health: () => said(io => cmdHealth(io)),
    /** `og prune <days>`'s lines. @param {number | string} days */
    prune: days => said(io => cmdPrune(io, [String(days)])),
    main,
    /** Ends every run under way (as a signal to bash og would) and resolves when they have ended. @param {number} [code] */
    stopAll(code = 143) {
      const ending = [...active.values()];
      for (const controller of active.keys()) controller.abort(code);
      return Promise.allSettled(ending);
    },
    get running() {
      return active.size;
    },
  };
  return api;
}

/** Every file under `dir` (none when it is missing). @param {string} dir @returns {Promise<string[]>} */
async function filesUnder(dir) {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const at = path.join(dir, item.name);
    if (item.isDirectory()) files.push(...(await filesUnder(at)));
    else if (item.isFile()) files.push(at);
  }
  return files;
}
/** Whether `dir` itself or anything under it changed after `sinceMs` (find -newermt). @param {string} dir @param {number} sinceMs */
async function newerUnder(dir, sinceMs) {
  try {
    if ((await stat(dir)).mtimeMs > sinceMs) return true;
  } catch {
    return false;
  }
  for (const item of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const at = path.join(dir, item.name);
    if (item.isDirectory() ? await newerUnder(at, sinceMs) : ((await stat(at).catch(() => null))?.mtimeMs ?? -Infinity) > sinceMs) return true;
  }
  return false;
}

/** Whether this module is the one node was started with (a Windows path may differ from the URL's in case). */
const isMain = () => {
  if (!process.argv[1]) return false;
  try {
    const a = realpathSync(process.argv[1]),
      b = realpathSync(fileURLToPath(import.meta.url));
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
};

if (isMain()) {
  // <root>/bin/og.mjs beside <root>/host.env (scripts/host.mjs installs both).
  const argv = process.argv.slice(2);
  /** @type {ReturnType<typeof createOg>} */ let og;
  try {
    og = createOg({ root: path.dirname(HERE) });
  } catch (/** @type {any} */ error) {
    console.error(`og: ${error.message}`);
    process.exit(1);
  }
  const stop = new AbortController();
  let stopping = 0;
  // A stop (Ctrl-C, the terminal closing, a service stop) ends the runs under way first, so the ledger closes after their commands.
  for (const [name, code] of /** @type {const} */ ([
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ])) {
    if (process.platform === 'win32' && name === 'SIGHUP') continue;
    process.on(name, () => {
      if (stopping) process.exit(stopping);
      stopping = code;
      stopChildren();
      // A run (or the worker's runs) ends its command first and closes its ledger line; anything else (a login, a health check) ends now.
      if (argv[0] !== 'run' && argv[0] !== 'worker') process.exit(code);
      stop.abort(code);
      if (argv[0] === 'worker') {
        process.stderr.write(`og: stopping — ${og.running} run(s) end first\n`);
        og.stopAll(code).then(() => process.exit(code));
        setTimeout(() => process.exit(code), KILL_AFTER_MS + 10_000).unref();
      }
    });
  }
  const stdin = () =>
    process.stdin.isTTY
      ? Promise.resolve('')
      : new Promise(resolve => {
          let text = '';
          process.stdin.setEncoding('utf8');
          process.stdin.on('data', chunk => {
            text += chunk;
          });
          process.stdin.on('end', () => resolve(text));
          process.stdin.on('error', () => resolve(text));
        });
  og.main(argv, { stdin, signal: stop.signal }).then(
    ({ code }) => {
      process.exitCode = stopping || code;
    },
    error => {
      console.error(`og: ${error?.stack ?? error}`);
      process.exitCode = 1;
    },
  );
}
