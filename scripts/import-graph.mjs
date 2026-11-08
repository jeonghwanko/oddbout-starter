// @ts-check
// The plugin bundle's import graph. The specifier parser lives in edge-bundle.mjs, which must stay a standalone file
// (the game's Edge deploy stages it alone); both bundles share it so a file list cannot miss a module form.
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { importSpecifiers } from './edge-bundle.mjs';

const SCRIPT = /\.(?:mjs|js|ts)$/;

export { importSpecifiers };
/** The npm package a bare specifier names (`@scope/name/sub` → `@scope/name`), or null for `node:` builtins. @type {(specifier: string) => string | null} */
export const packageName = specifier =>
  specifier.startsWith('node:')
    ? null
    : specifier
        .split('/')
        .slice(0, specifier.startsWith('@') ? 2 : 1)
        .join('/');

/**
 * Every repository-relative file reachable from `entries` through relative imports, entries included.
 * Non-script entries (docs, JSON, Python) are kept as given. Returns the sorted closure and the bare specifiers seen.
 * A relative import that leaves `root` or names a missing file fails here, before anything is copied or deployed.
 * @param {string} root @param {string[]} entries
 */
export async function importClosure(root, entries) {
  const seen = new Set(),
    bare = new Set(),
    pending = [...entries];
  while (pending.length) {
    const file = /** @type {string} */ (pending.pop());
    if (seen.has(file)) continue;
    seen.add(file);
    if (!SCRIPT.test(file)) continue;
    for (const specifier of importSpecifiers(await readFile(path.join(root, file), 'utf8'))) {
      if (!specifier.startsWith('.')) {
        bare.add(specifier);
        continue;
      }
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      if (target.startsWith('../')) throw Error(`${file} imports ${specifier} from outside the bundle root`);
      await access(path.join(root, target)).catch(() => {
        throw Error(`${file} imports ${specifier}, which does not exist`);
      });
      pending.push(target);
    }
  }
  return { files: [...seen].sort(), bare: [...bare].sort() };
}
