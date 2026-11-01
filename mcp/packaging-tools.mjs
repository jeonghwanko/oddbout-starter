// @ts-check
// Workspace execution behind MCP and creation:tool. No generation, login, registration or shell commands.
import { fork } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { localPath, readJson } from './creation-store.mjs';

/** @param {string} root @param {string} file */
async function confined(root, file) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  return localPath(root, relative);
}

/** Inspect every path the packer can read before starting the child; inputs remain in a trusted local workspace.
 * @param {string} root @param {{ planPath: string, outputPath?: string, fitSheets?: boolean, outputScale?: number }} args */
export async function packagingInputs(root, args) {
  root = await realpath(root);
  const planFile = await localPath(root, args.planPath), plan = await readJson(planFile), base = path.dirname(planFile);
  if (typeof plan.gamePack !== 'string' || !plan.motions || typeof plan.motions !== 'object') throw Error('invalid-packaging-plan');
  const packFile = await confined(root, path.resolve(base, plan.gamePack)), pack = await readJson(packFile);
  if (!Array.isArray(pack.textures) || pack.textures.length > 128 || !pack.animations) throw Error('invalid-game-pack');
  let bytes = 0;
  const frames = new Map();
  for (const texture of pack.textures) {
    if (typeof texture.image !== 'string') throw Error('invalid-game-pack');
    const file = await confined(root, path.resolve(path.dirname(packFile), texture.image)), info = await lstat(file);
    if (!info.isFile()) throw Error('packaging-input-not-file');
    bytes += info.size;
    for (const [key, entry] of Object.entries(texture.frames ?? {})) frames.set(key, /** @type {any} */ (entry).frame);
  }
  if (bytes > 200_000_000) throw Error('packaging-input-byte-limit');
  let pixels = 0;
  for (const motion of Object.values(plan.motions)) {
    for (const name of [motion.animation, motion.getUpAnimation].filter(Boolean)) {
      const animation = pack.animations[name];
      if (!Array.isArray(animation?.frames) || animation.frames.length > 128) throw Error('packaging-input-frame-limit');
      for (const key of animation.frames) {
        const rect = frames.get(key);
        if (!rect || !Number.isSafeInteger(rect.w) || !Number.isSafeInteger(rect.h) || rect.w < 1 || rect.h < 1)
          throw Error('invalid-game-pack-frame');
        pixels += rect.w * rect.h;
      }
    }
    for (const field of ['gaitReview', 'loopReview']) if (motion[field] !== undefined)
      await confined(root, path.resolve(base, motion[field]));
  }
  if (pixels > 128_000_000) throw Error('packaging-input-pixel-limit');
  const out = args.outputPath === undefined ? await confined(root, path.resolve(base, plan.out)) : await localPath(root, args.outputPath);
  // The new output is confined to the ordinary artifact area, never a selected version or a source directory.
  const outputRelative = path.relative(root, out).split(path.sep).join('/');
  if (!/^output\/[a-z][a-z0-9-]*-work\/artifacts\/.+/.test(outputRelative) || /(^|\/)versions(\/|$)/.test(outputRelative))
    throw Error('packaging-output-must-be-new-artifact');
  return { root, planFile, out, inputBytes: bytes, inputPixels: pixels };
}

/** @param {string} root @param {{ timeoutMs?: number }} [options] */
export function makePackagingRunner(root, { timeoutMs } = {}) {
  let busy = false;
  /** @param {{ planPath: string, outputPath?: string, fitSheets?: boolean, outputScale?: number }} args @param {boolean} inspectOnly */
  return async (args, inspectOnly) => {
    if (busy) return { ok: false, stage: 'packaging', code: 'packaging-busy' };
    busy = true;
    try {
      const input = await packagingInputs(root, args);
      return await new Promise(resolve => {
        const child = fork(fileURLToPath(new URL('./packaging-worker.mjs', import.meta.url)),
          [input.planFile, JSON.stringify({ inspectOnly, fitSheets: args.fitSheets ?? false, outputScale: args.outputScale, out: input.out })],
          { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: ['--max-old-space-size=256'],
            env: { ...process.env, VIPS_CONCURRENCY: '1' } });
        /** @type {any} */
        let result;
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs ?? (args.fitSheets ? 600_000 : 120_000));
        child.on('message', message => { if (!timedOut) result ??= message; });
        child.once('error', () => { clearTimeout(timer); resolve({ ok: false, stage: 'packaging', code: 'packaging-worker-start-failed' }); });
        child.once('exit', () => { clearTimeout(timer); resolve(result ?? { ok: false, stage: 'packaging',
          code: timedOut ? 'packaging-timeout' : 'packaging-worker-failed',
          next: 'Inspect the new output directory before retrying. No generation was dispatched.' }); });
      });
    } catch (/** @type {any} */ error) {
      return { ok: false, stage: 'packaging', code: /^[a-z][a-z-]+$/.test(error.message) ? error.message : 'packaging-input-unavailable' };
    } finally { busy = false; }
  };
}

/** @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ root: string, respond: import('./server.mjs').Respond }} options */
export function registerPackagingTools(server, { root, respond }) {
  const run = makePackagingRunner(root);
  const inputSchema = { planPath: z.string().min(1).max(512), outputPath: z.string().min(1).max(512).optional(),
    fitSheets: z.boolean().default(false), outputScale: z.number().min(.25).max(1).optional() };
  for (const inspectOnly of [true, false]) {
    const name = inspectOnly ? 'inspect_fighter_packaging' : 'pack_fighter_package';
    server.registerTool(name, {
      description: inspectOnly
        ? 'Measure and encode existing game-pack inputs without writing files. Return sheet, byte and pixel budgets. fitSheets also fits total package and per-asset budgets using measured bounded trials; outputScale sets an optional maximum density after body normalization. Preserve all frames, timing and game size; never generate.'
        : 'Build and fully validate a new package from existing files. fitSheets fits sheet dimensions AND total/per-asset byte and pixel budgets without changing encoding or removing frames. Optional outputScale (.25–1) caps density after normalization. Requires texture-resolution-1; preserves game size and originals. Never generate, register or request quality approval. Output must be a new output/<session>-work/artifacts/ directory.',
      inputSchema, outputSchema: { ok: z.boolean(), stage: z.string() },
      annotations: { readOnlyHint: inspectOnly, destructiveHint: false, idempotentHint: inspectOnly, openWorldHint: false },
    }, async args => respond(/** @type {import('./server.mjs').ToolResult} */ (await run(args, inspectOnly))));
  }
}
