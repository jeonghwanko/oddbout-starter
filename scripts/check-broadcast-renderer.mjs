#!/usr/bin/env node
// @ts-check
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPlaywrightRenderer, validateCupResult } from '../broadcast/runner.mjs';

/** One local exhibition only: no worker claim, wallet, model, OBS or Twitch calls.
 * The normal renderer and result validator check three actual bouts.
 * @param {string[]} argv */
export async function checkBroadcastRenderer(argv) {
  if (argv.length !== 1) throw new Error('usage: npm run broadcast:check-renderer -- <arena-origin>/broadcast.html');
  const arena = new URL(argv[0]);
  if (arena.search) throw new Error('renderer-check-query-not-allowed');
  const renderer = createPlaywrightRenderer({ arenaUrl: arena.href });
  const startedAt = new Date().toISOString();
  const job = {
    id: `render-check-${randomUUID()}`,
    broadcastId: 'local-check',
    hostId: 'local-check',
    workerId: 'local-check',
    channelId: 'not-connected',
    seed: 123,
    leaseToken: 1,
    fighterIds: ['kuma', 'yume', 'bravow', 'beotim'],
    endsAt: new Date(Date.now() + 480_000).toISOString(),
  };
  const path = resolve('output', `${job.id}.json`);
  await mkdir(resolve('output'), { recursive: true });
  const base = {
    schemaVersion: 1,
    mode: 'render-only',
    arenaUrl: arena.href,
    startedAt,
    job,
    paypalVerified: false,
    modelVerified: false,
    broadcastVerified: false,
    liveSeconds: null,
  };
  // Preserve a dispatch record even if the process dies. Never retry automatically.
  await writeFile(path, JSON.stringify({ ...base, status: 'prepared' }, null, 2) + '\n', { flag: 'wx' });
  const abort = new AbortController();
  const stop = () => abort.abort();
  const timeout = setTimeout(stop, 480_000);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const result = validateCupResult(await renderer.runCup(job, { signal: abort.signal }), job);
    const endedAt = new Date().toISOString();
    await writeFile(
      path,
      JSON.stringify({ ...base, status: 'completed', endedAt, elapsedSeconds: (Date.parse(endedAt) - Date.parse(startedAt)) / 1000, result }, null, 2) + '\n',
    );
    return { status: 'completed', bouts: result.bouts.length, winnerId: result.winnerId, report: path, broadcastVerified: false };
  } catch (/** @type {any} */ error) {
    const code = /^runner_[a-z_]+$/.test(error?.message ?? '') ? error.message : 'renderer_check_incomplete';
    await writeFile(path, JSON.stringify({ ...base, status: 'incomplete', code, endedAt: new Date().toISOString() }, null, 2) + '\n');
    throw new Error(`${code}; inspect ${path} before another run`);
  } finally {
    clearTimeout(timeout);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await renderer.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(await checkBroadcastRenderer(process.argv.slice(2))));
  } catch (/** @type {any} */ error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
