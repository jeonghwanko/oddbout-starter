// @ts-check
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createEnvironmentStore } from '../mcp/creation-environment.mjs';
import { runDeviceLogin } from '../mcp/generation-connection.mjs';

/**
 * @param {string[]} argv
 * @param {{ emit?: (event: object) => void, connect?: typeof runDeviceLogin, makeStore?: typeof createEnvironmentStore }} [options]
 */
export async function main(argv, { emit = item => console.log(JSON.stringify(item)), connect = runDeviceLogin, makeStore = createEnvironmentStore } = {}) {
  const [workspace, revision, ...extra] = argv;
  if (extra.length || !workspace || !path.isAbsolute(workspace) || !/^\d+$/.test(revision ?? '')) throw Error('invalid-connection-command');
  const root = await realpath(workspace),
    store = makeStore(root);
  // One login per workspace. A stale lock remains a blocker rather than starting an overlapping login.
  return store.locked(async () => {
    const state = await store.read();
    if (state?.revision !== Number(revision)) throw Error('environment-revision-conflict');
    const prepared = await store.prepareLogin();
    if (prepared.status === 'already-signed-in') {
      emit(prepared);
      return 0;
    }
    const result = await connect({ cwd: root, emit });
    emit(result);
    return result.status === 'signed-in' ? 0 : 1;
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (/** @type {any} */ error) {
    console.error(JSON.stringify({ status: 'blocked', code: /^[a-z][a-z0-9-]+$/.test(error.message) ? error.message : 'generation-connection-failed' }));
    process.exitCode = 1;
  }
}
