#!/usr/bin/env node
// @ts-check
// Read-only plan for one creation session. Prints one JSON object. Does not generate.
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { planCreation } from '../mcp/creation-plan.mjs';
import { createCreationStore } from '../mcp/creation-store.mjs';
import { createJobStore } from '../mcp/creation-jobs.mjs';
import { agentReply } from './cli-reply.mjs';

const USAGE = 'npm run creation:plan -- --workspace <absolute dir> --session <id>';

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
export async function runPlan(argv = process.argv.slice(2)) {
  const parsed = flags(argv);
  if (parsed.help === true) return agentReply({ ok: true, usage: USAGE, next: USAGE });
  if (typeof parsed.workspace !== 'string' || typeof parsed.session !== 'string') throw new Error('missing-value');
  if (!path.isAbsolute(parsed.workspace)) throw new Error('absolute-workspace-required');
  const root = await realpath(parsed.workspace);
  if (!(await stat(root)).isDirectory()) throw new Error('workspace-directory-required');
  const store = createCreationStore(root);
  return agentReply(await planCreation(store, createJobStore(store), parsed.session));
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  runPlan().then(
    answer => {
      console.log(JSON.stringify(answer, null, 2));
      if (answer.ok === false) process.exitCode = 1;
    },
    error => {
      const code = error instanceof Error && /^[a-z][a-z0-9-]{0,80}$/.test(error.message) ? error.message : 'plan-failed';
      console.log(JSON.stringify(agentReply({ ok: false, code, hint: USAGE }), null, 2));
      process.exitCode = 1;
    },
  );
}
