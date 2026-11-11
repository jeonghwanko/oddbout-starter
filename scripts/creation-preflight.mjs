#!/usr/bin/env node
// @ts-check
// Read-only preflight. Prints one JSON object. Does not install, fetch, generate or register.
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { preflightCreation } from '../mcp/creation-preflight.mjs';
import { createCreationStore } from '../mcp/creation-store.mjs';
import { createJobStore } from '../mcp/creation-jobs.mjs';
import { agentReply } from './cli-reply.mjs';

const USAGE =
  'npm run creation:preflight -- [--purpose connection|generation|registration] [--workspace <absolute dir>] [--session <id>] [--account gpt|grok|both|stop]';

/** @param {string[]} argv */
function flags(argv) {
  /** @type {Record<string, string | true>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') continue;
    if (!token.startsWith('--')) throw new Error('invalid-argument');
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

/**
 * @param {string[]} [argv]
 */
export async function runPreflight(argv = process.argv.slice(2)) {
  const parsed = flags(argv);
  if (parsed.help === true) return agentReply({ ok: true, usage: USAGE, next: USAGE });
  const purpose = typeof parsed.purpose === 'string' ? parsed.purpose : 'connection';
  if (!['connection', 'generation', 'registration'].includes(purpose)) throw new Error('invalid-readiness-purpose');
  /** @type {{ purpose: string, account?: string, sessionId?: string, store?: ReturnType<typeof createCreationStore>, jobs?: ReturnType<typeof createJobStore> }} */
  const options = { purpose };
  if (typeof parsed.account === 'string') options.account = parsed.account;
  if (typeof parsed.session === 'string') options.sessionId = parsed.session;
  if (typeof parsed.workspace === 'string') {
    if (!path.isAbsolute(parsed.workspace)) throw new Error('absolute-workspace-required');
    const root = await realpath(parsed.workspace);
    if (!(await stat(root)).isDirectory()) throw new Error('workspace-directory-required');
    const store = createCreationStore(root);
    options.store = store;
    options.jobs = createJobStore(store);
  } else if (parsed.session) throw new Error('absolute-workspace-required');
  return agentReply(await preflightCreation(options));
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  runPreflight().then(
    answer => {
      console.log(JSON.stringify(answer, null, 2));
      if (answer.ok === false) process.exitCode = 1;
    },
    error => {
      const code = error instanceof Error && /^[a-z][a-z0-9-]{0,80}$/.test(error.message) ? error.message : 'preflight-failed';
      console.log(JSON.stringify(agentReply({ ok: false, code, hint: USAGE }), null, 2));
      process.exitCode = 1;
    },
  );
}
