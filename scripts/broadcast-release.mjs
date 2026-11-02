// @ts-check
// Operator only: close an `unknown` broadcast job without charging it, which frees its host slot and allocation.
// Run it after checking the host (was a cup on screen, is the runner stopped?), with the Sandbox project's service key.
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { UUID } from '../api/http.mjs';
import { createCommerceStore } from '../api/commerce/store.mjs';

/** @param {string[]} argv */
export function parseReleaseArgs(argv) {
  let jobId; let note;
  for (let i = 0; i < argv.length; i += 2) {
    const [name, value] = [argv[i], argv[i + 1]];
    if (name === '--job' && value !== undefined) jobId = value;
    else if (name === '--note' && value !== undefined) note = value;
    else throw new Error('release_invalid_arguments');
  }
  if (!jobId || !UUID.test(jobId) || !note || note.length > 500) throw new Error('release_invalid_arguments');
  return { jobId: jobId.toLowerCase(), note };
}

/** @param {string[]} argv @param {{env?:Record<string,string|undefined>,store?:ReturnType<typeof createCommerceStore>}} [options] */
export async function releaseJob(argv, { env = process.env, store } = {}) {
  const { jobId, note } = parseReleaseArgs(argv);
  if (!store) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('release_environment_required');
    store = createCommerceStore(createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }));
  }
  const job = await store.releaseJob(jobId, note);
  return { id: job.id, status: job.status, broadcastId: job.broadcastId, hostId: job.hostId, reason: job.result?.reason };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await releaseJob(process.argv.slice(2)))); }
  catch (/** @type {any} */ error) {
    console.error(JSON.stringify({ ok: false, code: error?.message ?? 'release_failed' }));
    console.error('Usage: node --env-file=.env scripts/broadcast-release.mjs --job <unknown job UUID> --note "<what you checked>"');
    process.exitCode = 1;
  }
}
