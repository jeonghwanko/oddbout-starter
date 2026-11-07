// @ts-check
import { access, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectTools, inspectRife, installImg2webp, toolEnv, toolsItem } from './sprite-tools.mjs';
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { guardDotsExecution } from './dots-provider.mjs';
import { INSTALL_OUTCOME_UNKNOWN } from './dots-safety.mjs';

/** @typedef {import('./sprite-tools.mjs').Install} Install */

export const kitRoot = fileURLToPath(new URL('../', import.meta.url));
export const spriteRoot = path.join(kitRoot, 'vendor', 'sprite-gen');
export const spritePython = path.join(spriteRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
/** @param {string} file */
const exists = async file => { try { await access(file); return true; } catch { return false; } };

// The motion engine ships in sprite-gen-agent's own history; a checkout of an older upstream pin lacks it.
export async function inspectSpriteEngine(root = spriteRoot) {
  const metadata = await readFile(path.join(root, 'pyproject.toml'), 'utf8').catch(() => null);
  if (metadata === null) return { version: null, motion: false, error: 'sprite-gen-not-installed' };
  return { version: metadata.match(/^version = "([^"]+)"/m)?.[1] ?? null,
    motion: await exists(path.join(root, 'sprite_gen', 'gen', 'gen_motion.py')) };
}

export async function spriteStatus({ tools = true } = {}) {
  const sourcePresent = await exists(path.join(spriteRoot, 'SKILL.md'));
  const engine = await inspectSpriteEngine();
  return {
    sourcePresent, version: engine.version, motionEngine: engine.motion,
    environmentPresent: await exists(spritePython), repositoryRoot: kitRoot, sourceRoot: spriteRoot,
    skillPath: path.join(spriteRoot, 'SKILL.md'), pythonPath: spritePython,
    setupCommand: 'npm run sprite:setup', runCommand: 'npm run sprite --', packCommand: 'npm run fighter:pack -- <plan.json>',
    gaitCommand: 'npm run fighter:gait -- review <gait-plan.json> <review-directory> [annotations.json]',
    gaitGuidePath: path.join(kitRoot, 'docs', 'GAIT-REVIEW.md'),
    poseCommand: 'npm run sprite -- gen-motion --plan <pose-plan.json> --run-dir <new-run> --frame <pose-id>',
    poseGuidePath: path.join(spriteRoot, 'docs', 'pose-motion.md'),
    authentication: 'Each creator uses their own generation account. Presence of a venv does not verify login, quota, or generation quality.',
    // ffmpeg, ffprobe, img2webp (-exact) and RIFE as sprite-gen finds them; ready means the required three work.
    ...(tools ? { tools: toolsItem(await inspectTools({ spriteRoot, python: spritePython })) } : {}),
  };
}

// Setup steps that can hang on a network or proxy get a bound; generation commands keep none (a video run takes minutes).
const SETUP_TIMEOUT_MS = { git: 10 * 60_000, venv: 5 * 60_000, pip: 20 * 60_000, check: 60_000 };
// A stop (SIGTERM, SIGHUP) reaches sprite-gen, which writes its report and exits 128 + the signal; until then this wrapper
// waits for it instead of dying first, so whoever stopped the run reads a finished report (vendor/sprite-gen docs/gen.md
// "Outcome"). A stop sent to this process alone is passed on; one sent to the process group reaches sprite-gen itself, and
// it acts on the first only. Ctrl-C (SIGINT) reaches the whole terminal group and is not passed on.
/** @type {NodeJS.Signals[]} */
const FORWARDED = ['SIGTERM', 'SIGHUP'];
/** @type {NodeJS.Signals[]} */
const WAITED = [...FORWARDED, 'SIGINT'];
/** @param {string} command @param {string[]} args @param {{ cwd?: string, timeout?: number }} [options] @returns {Promise<number>} */
export function run(command, args, { cwd = kitRoot, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false, windowsHide: true, timeout,
      env: { ...toolEnv(spriteRoot), PYTHONUTF8: '1', SPRITE_GEN_ROOT: spriteRoot } });
    // Setup steps keep their bound and the default stop; a generation command (no timeout) is waited for.
    const handlers = timeout ? [] : WAITED.filter(name => process.platform !== 'win32' || name !== 'SIGHUP').map(/** @returns {[NodeJS.Signals, () => void]} */ name => {
      const handler = () => { if (FORWARDED.includes(name)) { try { child.kill(name); } catch {} } };
      process.on(name, handler);
      return [name, handler];
    });
    const done = () => { for (const [name, handler] of handlers) process.off(name, handler); };
    child.once('error', error => { done(); reject(error); });
    child.once('exit', (code, signal) => {
      done();
      if (signal && timeout) console.error(`${path.basename(command)} was interrupted; inspect the original install before retrying.`);
      // A child the signal itself ended exits 128 + its number, as a shell reports it (og's ledger reads 143 as interrupted).
      resolve(signal && timeout ? INSTALL_OUTCOME_UNKNOWN : signal ? 128 + (os.constants.signals[signal] ?? 0) : code ?? 1);
    });
  });
}

/** @param {string[]} args */
export async function main(args) {
  if (args[0] === 'status') { console.log(JSON.stringify(await spriteStatus(), null, 2)); return 0; }
  if (args[0] === 'setup') {
    if (args.length !== 1 && !(args.length === 2 && args[1] === '--skip-rife')) throw new Error('Usage: npm run sprite:setup -- [--skip-rife]');
    if (await exists(path.join(kitRoot, '.git'))) {
      // Follow a moved pin or URL. History is not needed to run the pinned commit; depth 1 skips the download.
      // Git refuses, and setup stops, when the checkout has local edits the pinned commit would overwrite.
      const synced = await run('git', ['submodule', 'sync', '--', 'vendor/sprite-gen'], { timeout: SETUP_TIMEOUT_MS.git });
      if (synced) return synced;
      const result = await run('git', ['submodule', 'update', '--init', '--depth', '1', '--', 'vendor/sprite-gen'], { timeout: SETUP_TIMEOUT_MS.git });
      if (result) return result;
    } else if (!(await exists(path.join(spriteRoot, 'SKILL.md')))) throw new Error('sprite-gen source missing and this folder is not a Git checkout. Clone AI Fighter with git; GitHub ZIP archives do not include submodules.');
    if (!(await exists(path.join(spriteRoot, 'SKILL.md')))) throw new Error('sprite-gen source missing. Clone AI Fighter with --recurse-submodules. GitHub ZIP archives do not include submodules.');
    if (!(await exists(spritePython))) {
      // A global Python is used only to create this repository's isolated environment.
      /** @type {[string, string[]][]} */
      const candidates = process.env.AI_FIGHTER_BOOTSTRAP_PYTHON ? [[process.env.AI_FIGHTER_BOOTSTRAP_PYTHON, []]]
        : process.platform === 'win32' ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]];
      /** @type {[string, string[]] | undefined} */
      let bootstrap;
      for (const [command, prefix] of candidates) {
        try {
          if (await run(command, [...prefix, '-c', 'import sys,venv; sys.exit(0 if sys.version_info >= (3,11) else 1)'], { timeout: 10000 }) === 0) {
            bootstrap = [command, prefix]; break;
          }
        } catch (/** @type {any} */ error) { if (error.code !== 'ENOENT') throw error; }
      }
      if (!bootstrap) throw new Error('Python 3.11+ with venv support is required. Set AI_FIGHTER_BOOTSTRAP_PYTHON to its executable.');
      const created = await run(bootstrap[0], [...bootstrap[1], '-m', 'venv', path.join(spriteRoot, '.venv')], { timeout: SETUP_TIMEOUT_MS.venv });
      if (created) return created;
    }
    const installed = await run(spritePython, ['-m', 'pip', 'install', '-e', spriteRoot], { timeout: SETUP_TIMEOUT_MS.pip });
    if (installed) return installed;
    const help = await run(spritePython, ['-m', 'sprite_gen.cli', '--help'], { timeout: SETUP_TIMEOUT_MS.check });
    if (help) return help;
    return setupTools({ includeRife: !args.includes('--skip-rife') });
  }
  if (!args.length) throw new Error('Pass a sprite-gen command, for example: npm run sprite -- workflow --kind sprite');
  await guardDotsExecution(kitRoot, process.env.INIT_CWD || process.cwd(), args);
  if (!(await exists(spritePython))) throw new Error('Run npm run sprite:setup first. No fallback to a global sprite-gen installation.');
  if (!(await inspectSpriteEngine()).motion) throw new Error('vendor/sprite-gen predates sprite-gen-agent (no motion engine). Run npm run sprite:setup.');
  await requireMotionContract(args, process.env.INIT_CWD || process.cwd());
  // Use only the bundled source and its venv. Preserve upstream arguments and exit codes (2: questions, 75: choice needed).
  // Relative paths resolve from where the user ran npm, not from inside the submodule.
  return run(spritePython, ['-m', 'sprite_gen.cli', ...args], { cwd: process.env.INIT_CWD || process.cwd() });
}

/**
 * After sprite-gen: the tools a run needs that the kit can fetch without sudo (img2webp with -exact, RIFE), then a report
 * of what the person preparing the workspace must still install. Exit 1 only when a kit download failed for a required tool.
 * @param {{ includeRife?: boolean, inspect?: typeof inspectTools, inspectOptional?: typeof inspectRife, installWebp?: typeof installImg2webp,
 *   execute?: typeof run, log?: (message: string) => void }} [options]
 */
export async function setupTools({ includeRife = true, inspect = inspectTools, inspectOptional = inspectRife,
  installWebp = installImg2webp, execute = run, log = console.error } = {}) {
  const options = { spriteRoot, python: spritePython };
  let tools = await inspect({ ...options, rife: false });
  let failed = 0;
  if (tools.img2webp.status !== 'ok' && /** @type {Install} */ (tools.img2webp.install).actor === 'agent') { // set unless ok
    try { log(`img2webp: installed ${await installWebp(options)}`); }
    catch (/** @type {any} */ error) { log(error.message); failed = 1; }
  }
  // RIFE: sprite-gen's own installer. A finished install is only checked again; a failed check frame (no Vulkan) is a warning.
  // It also puts the resident binary beside the binary, so a RIFE installed before it existed is run through it once more.
  /** @type {import('./sprite-tools.mjs').Tool} */
  let rife = { status: 'not-checked', required: false };
  if (includeRife) {
    rife = await inspectOptional({ ...options, env: toolEnv(spriteRoot) });
    if (rife.status === 'missing' || rife.serve?.status === 'missing') {
      if (await execute(spritePython, ['-m', 'sprite_gen.cli', 'rife', 'install'])) log('rife: sprite-gen rife install did not finish; see the message above.');
      rife = await inspectOptional({ ...options, env: toolEnv(spriteRoot) });
    }
  }
  tools = { ...(await inspect({ ...options, rife: false })), rife };
  const item = toolsItem(tools);
  log('\nsprite-gen tools:');
  for (const name of ['ffmpeg', 'ffprobe', 'img2webp', 'rife']) {
    const tool = item[name];
    log(`  ${name.padEnd(10)} ${tool.status.padEnd(8)} ${tool.path ?? ''}${tool.version ? ` (${tool.version})` : ''}${tool.reason ? ` — ${tool.reason}` : ''}`);
  }
  const serve = item.rife.serve; // the resident binary, for a RIFE that works
  if (serve) log(`  ${'rife-serve'.padEnd(10)} ${serve.status.padEnd(8)} ${serve.path ?? ''}${serve.reason ? ` — ${serve.reason}` : ''}`
    + (serve.status === 'missing' ? `— ${serve.effectWhenMissing}` : ''));
  for (const warning of item.warnings) log(`  warning: rife ${warning.status} — ${warning.message}. Next: ${warning.command}`);
  if (item.nextAction) log(`  action required (${item.nextAction.actor}): ${item.nextAction.commands.join('  |  ')}`);
  return failed;
}

/** @param {string[]} args @param {string} cwd */
export async function requireMotionContract(args, cwd) {
  if (!['gen-set', 'gen-motion'].includes(args[0])) return;
  /** @param {string} key */
  const option = key => {
    const matches = args.flatMap((value, index) => value === key || value.startsWith(key + '=') ? [index] : []);
    if (matches.length > 1) throw Error(`Duplicate option: ${key}`);
    const index = matches[0] ?? -1;
    return index < 0 ? undefined : args[index].includes('=') ? args[index].slice(key.length + 1) : args[index + 1];
  };
  if (args[0] === 'gen-motion') {
    if (!option('--plan')) return; // the engine owns CLI errors/help
    const plan = JSON.parse(await readFile(path.resolve(cwd, /** @type {string} */ (option('--plan'))), 'utf8')); // present: checked above
    const expected = ['walk', 'run'].includes(plan.motion) ? spec.motions[/** @type {'walk' | 'run'} */ (plan.motion)].frames : null;
    if (expected === null || plan.frames?.length !== expected)
      throw Error(`AI Fighter pose plan needs ${expected ?? `${spec.motions.walk.frames} walk / ${spec.motions.run.frames} run`} frames; diagnostic poses belong to that full plan`);
    if (option('--frame') && !args.includes('--reconcile') && plan.version !== 2)
      throw Error('POSE_BODY_CALIBRATION_REQUIRED: v5 generation needs a version 2 plan with observed original body landmarks; legacy runs remain available for inspection/reconciliation/export, not repeated uncalibrated generation');
    return;
  }
  if (!option('--run-dir')) return; // the engine owns CLI errors
  const request = JSON.parse(await readFile(path.resolve(cwd, /** @type {string} */ (option('--run-dir')), 'sprite-request.json'), 'utf8')); // present: checked above
  const selected = option('--states')?.split(',').map(value => value.trim()).filter(Boolean) ?? [];
  for (const [state, entry] of Object.entries(request.states ?? {})) {
    if (selected.length && !selected.includes(state)) continue;
    const locomotion = state.match(/(^|[-_])(walk|walking|run|running)($|[-_])/);
    if (locomotion && !entry.motion)
      throw Error(`MOTION_CONTRACT_REQUIRED: ${state}; use fighter:gait init and review key poses before a full GPT sequence`);
    if (locomotion && entry.motion.kind !== (locomotion[2].startsWith('walk') ? 'walk' : 'run'))
      throw Error(`Motion kind does not match state: ${state}`);
    const sequenceFrames = spec.motions[entry.motion?.kind === 'walk' ? 'walk' : 'run'].frames;
    if (entry.motion?.stage === 'sequence' && entry.frames !== sequenceFrames)
      throw Error(`AI Fighter full sequence needs ${sequenceFrames} frames: ${state}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (/** @type {any} */ error) { console.error(error.code === 'ENOENT' ? 'Required executable not found. Install Git and Python 3.11+, or set AI_FIGHTER_BOOTSTRAP_PYTHON to your Python executable.' : error.message); process.exitCode = 1; }
}
