// @ts-check
// Edge deploy payload: the entry point, its import map and lock, and every relative module it imports.
// The file list comes from the import graph, so a new import cannot be left out of the deploy.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The game's Edge deploy (crashbang-heroes `npm run fighter:edge`) stages this file alone, so it imports no other
// repository module; scripts/import-graph.mjs reuses this parser for the plugin bundle (test/edge-bundle.test.mjs).
const SPECIFIER = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
/** Module specifiers a source imports: static, re-exported, side-effect and literal dynamic imports. @type {(source: string) => string[]} */
export const importSpecifiers = source => [...source.matchAll(SPECIFIER)].map(match => match[1] ?? match[2] ?? match[3]);

const REPOSITORY = fileURLToPath(new URL('../', import.meta.url));
const ENTRY = 'supabase/functions/ai-fighter/index.ts';
const IMPORT_MAP = 'supabase/functions/ai-fighter/deno.json',
  LOCK = 'supabase/functions/ai-fighter/deno.lock';

/**
 * Repository-relative files reachable from the Edge entry. A bare specifier must be in the Deno import map:
 * Node-only modules (sharp, node:fs) fail here instead of at deploy time.
 */
export async function edgeFiles({ root = REPOSITORY, entry = ENTRY, importMap = IMPORT_MAP, lock = LOCK } = {}) {
  const mapped = JSON.parse(await readFile(path.join(root, importMap), 'utf8')).imports ?? {};
  const seen = new Set(),
    pending = [entry];
  while (pending.length) {
    const file = /** @type {string} */ (pending.pop());
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith('.json')) continue;
    for (const specifier of importSpecifiers(await readFile(path.join(root, file), 'utf8'))) {
      if (!specifier.startsWith('.')) {
        if (!(specifier in mapped)) throw new Error(`${file} imports ${specifier}, which the Edge import map does not provide`);
        continue;
      }
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      if (target.startsWith('../')) throw new Error(`${file} imports ${specifier} from outside the repository`);
      pending.push(target);
    }
  }
  return [entry, importMap, lock, ...[...seen].filter(file => file !== entry).sort()];
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  // This checkout carries a null duel engine. Emitting an upload payload here let a handler-only change
  // erase the live game's engine. Only the game's planner may combine sources, engines and a live version.
  if (process.argv.length !== 3 || process.argv[2] !== '--list') {
    console.error(
      'Direct Edge deploy payloads are disabled. Use the game repository: npm run fighter:edge -- plan, then deploy --plan <id>. Use --list only to inspect source paths.',
    );
    process.exitCode = 1;
  } else console.log(JSON.stringify(await edgeFiles()));
}
