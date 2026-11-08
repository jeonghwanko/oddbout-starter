// @ts-check
import { cp, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { localPath } from '../mcp/creation-store.mjs';

const kitRoot = fileURLToPath(new URL('../', import.meta.url));
/**
 * One ODDBOUT plugin with the existing cloud account and a workspace CLI, not a second stdio plugin.
 * @param {string} destination @param {{ root?: string, workspace?: string }} [options]
 */
export async function buildLocalPlugin(destination, { root = kitRoot, workspace = root } = {}) {
  const canonicalRoot = await realpath(root),
    canonicalWorkspace = await realpath(workspace);
  if (!destination.startsWith('output/')) throw new Error('plugin-output-must-be-under-output');
  const out = await localPath(canonicalRoot, destination);
  if (
    await lstat(out).then(
      () => true,
      e => {
        if (e.code !== 'ENOENT') throw e;
        return false;
      },
    )
  )
    throw new Error('plugin-output-exists');
  const template = path.join(kitRoot, 'plugins', 'ai-fighter');
  const metadata = JSON.parse(await readFile(path.join(template, 'plugin.json'), 'utf8'));
  const plugin = path.join(out, 'plugins', 'ai-fighter');
  await localPath(canonicalRoot, `${destination}/plugins`, { createParents: true, directory: true });
  await cp(template, plugin, { recursive: true, errorOnExist: true, force: false });
  await writeFile(path.join(plugin, 'kit-location.json'), JSON.stringify({ runtime: canonicalRoot, root: canonicalWorkspace }, null, 2) + '\n', { flag: 'wx' });
  const marketDir = path.join(out, '.agents', 'plugins');
  await mkdir(marketDir, { recursive: true });
  await writeFile(
    path.join(marketDir, 'marketplace.json'),
    JSON.stringify(
      {
        name: 'ai-fighter-local',
        interface: { displayName: 'ODDBOUT' },
        plugins: [
          {
            name: metadata.name,
            source: { source: 'local', path: './plugins/ai-fighter' },
            policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
            category: 'Productivity',
          },
        ],
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  return {
    marketplace: out,
    plugin,
    version: metadata.version,
    kitRoot: canonicalRoot,
    workspace: canonicalWorkspace,
    install: { command: 'codex', args: ['plugin', 'marketplace', 'add', out] },
    next: 'Install oddbout@ai-fighter-local in place of ai-fighter-creator@ai-fighter-local. Keep the existing ODDBOUT cloud account connection. Open a new chat for updated skills.',
    portability: 'Local paths belong to this user. Rebuild on each computer; do not publish this generated directory.',
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1) throw new Error('Usage: npm run plugin:build -- [output/new-marketplace]');
    console.log(JSON.stringify(await buildLocalPlugin(args[0] ?? 'output/ai-fighter-marketplace'), null, 2));
  } catch (/** @type {any} */ error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
