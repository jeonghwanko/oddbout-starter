// @ts-check
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeCliJson } from '../dots.mjs';
import { fetchCreationContext, reviewCreationProgress } from '../mcp/creation-context.mjs';
import { fileContextRequest, parseContextFileArgs } from './creation-context-file.mjs';

/** @param {string[]} argv */
export async function main(argv) {
  const { args, contextFile, contextReceipt } = parseContextFileArgs(argv);
  if (args.length > 1) throw Error('creation-context-file-arguments');
  const request = contextFile && contextReceipt ? await fileContextRequest(contextFile, contextReceipt) : undefined;
  const context = await fetchCreationContext({ request });
  return args[0] ? reviewCreationProgress(context, JSON.parse(await readFile(args[0], 'utf8'))) : context;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await main(process.argv.slice(2));
    await writeCliJson(1, result);
    if ('canAdvance' in result && !result.canAdvance) process.exitCode = 1;
  } catch (/** @type {any} */ error) {
    process.exitCode = 1;
    try { await writeCliJson(2, { ok: false, code: /^[a-z][a-z-]+$/.test(error.message) ? error.message : 'creation-context-command-failed' }); }
    catch { /* Preserve failure when stderr cannot deliver an error. */ }
  }
}
