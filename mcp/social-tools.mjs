// @ts-check
// X (social) exports behind MCP and creation:tool: a finished package and profile set as MP4/GIF loops, reaction faces and a four-picture
// post, and the still and command for a Grok clip of a face. Reads workspace files and writes a new output folder only: no generation,
// login, registration, posting or shell command.
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { localPath } from './creation-store.mjs';
import { forkWorker, serialQueue } from './serial-worker.mjs';

/** @typedef {import('./serial-worker.mjs').SerialQueue} SerialQueue */

/** A new folder under output/, never a selected version. @param {string} root @param {string} relative */
async function newOutput(root, relative) {
  const out = await localPath(root, relative);
  const inside = path.relative(root, out).split(path.sep).join('/');
  if (!/^output\/.+/.test(inside) || /(^|\/)versions(\/|$)/.test(inside)) throw Error('social-output-must-be-under-output');
  if (
    await lstat(out).then(
      () => true,
      () => false,
    )
  )
    throw Error('social-output-exists');
  return out;
}

/** @param {string} root @param {string} relative */
async function folder(root, relative) {
  const dir = await localPath(root, relative);
  if (!(await lstat(dir)).isDirectory()) throw Error('social-input-not-folder');
  return dir;
}

/** @param {import('@modelcontextprotocol/server').McpServer} server
 * @param {{ root: string, respond: import('./server.mjs').Respond, queue?: SerialQueue }} options */
export function registerSocialTools(server, { root, respond, queue = serialQueue() }) {
  /** @param {'export' | 'grok-face'} mode @param {Record<string, unknown>} options */
  const run = (mode, options) =>
    queue(
      async () => {
        try {
          const base = await realpath(root);
          const resolved = {
            ...options,
            packageDir: typeof options.packagePath === 'string' ? await folder(base, options.packagePath) : undefined,
            profileSetDir: typeof options.profileSetPath === 'string' ? await folder(base, options.profileSetPath) : null,
            addClips: await Promise.all(/** @type {string[]} */ (options.addClips ?? []).map(file => localPath(base, file))),
            out: await newOutput(base, /** @type {string} */ (options.outputPath)),
          };
          const result = await forkWorker(new URL('./social-worker.mjs', import.meta.url), [mode, JSON.stringify(resolved)], {
            timeoutMs: 900_000,
            heapMb: 512,
          });
          if (!result.started) return { ok: false, stage: 'social-export', code: 'social-worker-start-failed' };
          return (
            /** @type {any} */ (result.message) ?? {
              ok: false,
              stage: 'social-export',
              code: result.timedOut ? 'social-export-timeout' : 'social-export-failed',
              next: 'Nothing was generated or posted. A .partial folder beside the output may be removed before a retry.',
            }
          );
        } catch (/** @type {any} */ error) {
          return { ok: false, stage: 'social-export', code: /^[a-z][a-z-]+$/.test(error.message) ? error.message : 'social-input-unavailable' };
        }
      },
      () => ({ ok: false, stage: 'social-export', code: 'social-export-busy' }),
    );

  server.registerTool(
    'export_social_media',
    {
      description:
        "Turn a finished fighter package (and its profile set, for faces) into files to post on X: each motion as an MP4 and GIF loop, a showcase MP4 ending on the fighter's card, " +
        'six reaction faces (transparent PNG stickers plus MP4/GIF loops), a four-picture post set, POST.md with caption links and social.json with X limit checks. ' +
        'Reads only; writes one new folder under output/. Generates nothing and spends no generation quota. Never posts: the user posts from their own X account. ' +
        'Offer it once after registration or when the user asks to share the fighter. Show the showcase and two reactions as actual media, then point to POST.md. Runs up to a few minutes.',
      inputSchema: z.object({
        packagePath: z.string().min(1).max(512).describe('Folder holding fighter.json, relative to the workspace'),
        profileSetPath: z.string().min(1).max(512).optional().describe('Folder holding profile-set.json; without it there are no faces'),
        outputPath: z.string().min(1).max(512).describe('New folder under output/'),
        size: z.union([z.literal(720), z.literal(1024)]).default(720),
        aspect: z.enum(['1:1', '16:9']).default('1:1'),
        background: z.enum(['light', 'dark']).default('light'),
        endcard: z.boolean().default(true).describe('The ODDBOUT end card and corner mark; false only when the user asks'),
        clips: z.array(z.string().min(1).max(32)).max(16).optional(),
        gif: z.boolean().default(true),
        addClips: z.array(z.string().min(1).max(512)).max(6).optional().describe('Finished MP4s (a requested Grok face clip) to fit to the canvas'),
      }),
      outputSchema: z.object({ ok: z.boolean(), stage: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async args => respond(/** @type {import('./server.mjs').ToolResult} */ (await run('export', args))),
  );

  server.registerTool(
    'prepare_grok_face_clip',
    {
      description:
        "Prepare, without generating, a Grok image-to-video clip of one of the fighter's six faces: a square still, a prompt and the exact `npm run sprite -- video` command (the still opens and closes the clip, so it loops). " +
        "Run that command only when the user explicitly asks for this Grok clip: it uses the user's own Grok sign-in and quota. If its outcome is unknown, recover it with video-resume; never send it again. " +
        'Then export_social_media with addClips brings the finished clip in.',
      inputSchema: z.object({
        profileSetPath: z.string().min(1).max(512),
        face: z.enum(['default', 'hit', 'smug', 'danger', 'sideeye', 'ko']),
        outputPath: z.string().min(1).max(512).describe('New folder under output/'),
        background: z.enum(['light', 'dark']).default('light'),
        seconds: z.number().int().min(1).max(15).default(6),
      }),
      outputSchema: z.object({ ok: z.boolean(), stage: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async args => respond(/** @type {import('./server.mjs').ToolResult} */ (await run('grok-face', args))),
  );
}
