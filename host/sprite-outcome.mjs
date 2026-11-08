// @ts-check
// What a sprite-gen generation run ended with, read from its report rather than guessed from its exit code
// (vendor/sprite-gen docs/gen.md "Outcome"). sprite-gen writes `ok`, `errors` ({state, code, retryable, message})
// and `provider_submitted` on success, failure, the codex question and SIGTERM alike; exit 3 means it failed before
// any provider request. Used by the hosted worker (generation-stages.mjs) and the creation jobs (mcp/creation-jobs.mjs). It lives
// in host/ because a host installs host/'s files flat into one bin folder (og self-update, scripts/host.mjs HOST_FILES): the
// worker can import only its neighbours. The plugin bundle takes it through mcp/'s import closure.
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';

export const NOT_STARTED_EXIT = 3;
export const ASK_EXIT = 75;
// Codes after which the same command must not simply run again: the request may have been taken and billed.
// A codex timeout (`provider-timeout`) was stopped after its request left, so it may have made a paid image.
const UNSEEN = new Set(['outcome-unknown', 'internal-error', 'provider-timeout']);

/** @param {string[]} argv @param {string} key @returns {string | undefined} */
const option = (argv, key) => {
  const index = argv.findIndex(value => value === key || value.startsWith(`${key}=`));
  if (index < 0) return undefined;
  return argv[index].includes('=') ? argv[index].slice(key.length + 1) : argv[index + 1];
};

/** Where a sprite-gen command leaves its outcome report, as the path its arguments give (relative paths stay relative):
 * `--report` for gen / video / video-extend / video-edit / video-resume, the set report for gen-set and video-set.
 * @param {string[]} args @returns {string | null} */
export function outcomeReportPath(args) {
  const [verb] = args;
  if (verb === 'gen-set') { const run = option(args, '--run-dir'); return run ? path.posix.join(run, 'reports/gen-set/set.report.json') : null; }
  if (verb === 'video-set') { const out = option(args, '--out-dir'); return out ? path.posix.join(out, 'set.report.json') : null; }
  return option(args, '--report') ?? null;
}

/** The report at `file` when this run wrote it (modified at or after `since`, ms) and it carries the outcome keys; else null.
 * @param {string | null | undefined} file @param {{ since?: number }} [options] @returns {Promise<any>} */
export async function readOutcome(file, { since = 0 } = {}) {
  if (!file) return null;
  try {
    if ((await stat(file)).mtimeMs + 1000 < since) return null;   // an earlier run's report never answers for this one
    const report = JSON.parse(await readFile(file, 'utf8'));
    return typeof report?.provider_submitted === 'boolean' && Array.isArray(report.errors) ? report : null;
  } catch { return null; }
}

/**
 * The verdict on a run that did not succeed: `charge` is `not-charged` (exit 3 or 2, or the report says no request
 * left), `request-sent` (the report says one did: it may have been billed) or `unknown` (no report this run wrote);
 * `next` is what to do — `answer` the codex question, `resume` a video request xAI took (by `requestIds`), `inspect`
 * before anything runs again (no report, a request whose outcome cannot be told, a run stopped after its request left),
 * `retry` (every error says the same command may succeed) or `fix` the command or its input.
 * @param {{ code: number | null, report: any }} run
 */
export function judgeOutcome({ code, report }) {
  // sprite-gen's codes are strings. An error with any other code is one no documented writer made: it still counts, but as an outcome
  // nobody can read — its `retryable` is not trusted, so it never sends a paid request again (2026-10-30 review).
  const errors = (/** @type {any[]} */ (Array.isArray(report?.errors) ? report.errors : [])).filter(e => e && typeof e === 'object' && 'code' in e)
    .map(e => typeof e.code === 'string' ? e : { ...e, code: 'outcome-unknown', retryable: false, written: String(e.code).slice(0, 40) });
  const charge = code === NOT_STARTED_EXIT || code === 2 ? 'not-charged'
    : report ? (report.provider_submitted ? 'request-sent' : 'not-charged') : 'unknown';
  const requestIds = [...new Set([report?.request_id, ...errors.map(e => e.request_id)].filter(id => typeof id === 'string' && id))];
  const codes = [...new Set(errors.map(e => e.code))];
  let next;
  if (code === ASK_EXIT || codes.includes('provider-asks')) next = 'answer';
  // A video-set item's unfinished clip names its request in the item's own clip.report.json, not in the set's errors.
  else if (requestIds.length || codes.includes('generation-unfinished')) next = 'resume';
  else if (charge === 'unknown' || codes.some(c => UNSEEN.has(c))
    || (charge === 'request-sent' && codes.includes('interrupted'))) next = 'inspect';
  else if (errors.length && errors.every(e => e.retryable === true)) next = 'retry';
  else next = errors.length || charge === 'not-charged' ? 'fix' : 'inspect';
  return { charge, next, codes, requestIds,
    ...(errors.length ? { errors: errors.slice(0, 8).map(({ state, code: c, retryable, item }) => ({ state, code: c, retryable, ...(item ? { item } : {}) })) } : {}) };
}
