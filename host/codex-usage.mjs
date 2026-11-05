// @ts-check
// 사용량으로 시작 (2026-10-31, 사용자: "지금 한도 방식은 문제가 있네" → "token 소모량으로 처리할 수는 없을까?"): the subscription's own meter.
// codex writes each session's token counts and the account's rate-limit windows into its rollout file
// (`<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*.jsonl`, a `token_count` event: `payload.rate_limits.{primary,secondary}` with
// `used_percent`, `window_minutes` and `resets_at` in epoch seconds, and `payload.info.total_token_usage`). The worker reads the newest and
// sends the rate-limit reading with its heartbeat (for the operator) and each stage's tokens with its result: the server starts a new request
// to ODDBOUT while the day's tokens are under its budget (af_generation_official_wait).
// A host installs host/'s files flat into one bin folder (og self-update, scripts/host.mjs HOST_FILES): this file imports nothing local.
import { open, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** How much of a rollout's end is read for its last `token_count` (a session's file grows with its turns). */
const TAIL_BYTES = 256 * 1024;

/**
 * The newest rollout files under `sessions`, newest first (their dated folders and names sort by time), at most `limit`.
 * @param {string} sessions
 * @param {number} [limit]
 * @returns {Promise<string[]>}
 */
export async function recentRollouts(sessions, limit = 12) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const dated = async dir => (await readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name)).map(entry => entry.name).sort().reverse();
  for (const year of await dated(sessions)) {
    for (const month of await dated(path.join(sessions, year))) {
      for (const day of await dated(path.join(sessions, year, month))) {
        const folder = path.join(sessions, year, month, day);
        const files = (await readdir(folder).catch(() => [])).filter(name => /^rollout-.*\.jsonl$/.test(name)).sort().reverse();
        for (const name of files) { out.push(path.join(folder, name)); if (out.length >= limit) return out; }
      }
    }
  }
  return out;
}

/**
 * Every rollout file in the dated folders from the day before `sinceMs` on (the folders' dates are codex's local day; a day's margin covers
 * any time zone), with no cap on their number: a stage's sessions are all counted (리뷰 2026-10-31 — 64 newest could leave some out).
 * @param {string} sessions
 * @param {number} sinceMs
 * @returns {Promise<string[]>}
 */
export async function rolloutsSince(sessions, sinceMs) {
  const from = new Date(sinceMs - 86_400_000), floor = from.getUTCFullYear() * 10_000 + (from.getUTCMonth() + 1) * 100 + from.getUTCDate();
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const dated = async dir => (await readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name)).map(entry => entry.name);
  for (const year of await dated(sessions)) {
    if (Number(year) * 10_000 + 1231 < floor) continue;
    for (const month of await dated(path.join(sessions, year))) {
      if (Number(year) * 10_000 + Number(month) * 100 + 31 < floor) continue;
      for (const day of await dated(path.join(sessions, year, month))) {
        if (Number(year) * 10_000 + Number(month) * 100 + Number(day) < floor) continue;
        const folder = path.join(sessions, year, month, day);
        for (const name of await readdir(folder).catch(() => [])) if (/^rollout-.*\.jsonl$/.test(name)) out.push(path.join(folder, name));
      }
    }
  }
  return out;
}

/**
 * A rollout's last `token_count` payload, or null (none yet, or the file cannot be read).
 * @param {string} file
 * @returns {Promise<any>}
 */
export async function lastTokenCount(file) {
  let text;
  try {
    const handle = await open(file, 'r');
    try {
      const { size } = await handle.stat(), start = Math.max(0, size - TAIL_BYTES), buffer = Buffer.alloc(size - start);
      await handle.read(buffer, 0, buffer.length, start);
      text = buffer.toString('utf8');
      if (start > 0) text = text.slice(text.indexOf('\n') + 1);   // the first line read may be cut
    } finally { await handle.close(); }
  } catch { return null; }
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].includes('"token_count"')) continue;
    try {
      const event = JSON.parse(lines[i]);
      if (event?.payload?.type === 'token_count') return event.payload;
    } catch { /* a line still being written */ }
  }
  return null;
}

/**
 * One rate-limit window as the server takes it, or null when it is malformed or has reset since (then it says nothing of now).
 * @param {any} window
 * @param {number} now
 * @returns {{ usedPercent: number, windowMinutes?: number, resetsAt?: string } | null}
 */
function windowOf(window, now) {
  if (!window || typeof window.used_percent !== 'number' || !Number.isFinite(window.used_percent)) return null;
  const resetsAt = Number.isFinite(window.resets_at) && window.resets_at > 0 ? new Date(window.resets_at * 1000) : null;
  if (resetsAt && resetsAt.getTime() <= now) return null;
  return { usedPercent: Math.round(Math.min(100, Math.max(0, window.used_percent)) * 10) / 10,
    ...(Number.isInteger(window.window_minutes) && window.window_minutes > 0 ? { windowMinutes: window.window_minutes } : {}),
    ...(resetsAt ? { resetsAt: resetsAt.toISOString() } : {}) };
}

/**
 * The subscription's usage as the newest session that reported it states it: the fuller of its windows, or null (no session has, or
 * its windows have reset since). The newest report is the account's latest state: any use since would have written a newer one.
 * @param {string} sessions
 * @param {number} [now]
 */
export async function codexUsage(sessions, now = Date.now()) {
  for (const file of await recentRollouts(sessions)) {
    const limits = (await lastTokenCount(file))?.rate_limits;
    if (!limits) continue;                  // a session that has not answered yet
    const windows = [windowOf(limits.primary, now), windowOf(limits.secondary, now)].filter(w => w !== null);
    if (!windows.length) return null;
    return windows.reduce((a, b) => (b.usedPercent > a.usedPercent ? b : a));
  }
  return null;
}

/**
 * A stage's codex tokens (2026-10-31 — the server's daily budget counts them): the final totals of the codex sessions written since
 * `sinceMs`. The worker takes one stage at a time and only it uses this account's codex, so the sessions written while a stage ran are
 * that stage's (their working folders are the host's, not the job's: the time window is what ties them to it).
 * @param {string} sessions
 * @param {number} sinceMs
 * @returns {Promise<{ total: number, input: number, cachedInput: number, output: number, reasoning: number }>}
 */
export async function codexTokensSince(sessions, sinceMs) {
  const sum = { total: 0, input: 0, cachedInput: 0, output: 0, reasoning: 0 };
  /** @param {unknown} n */
  const whole = n => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
  for (const file of await rolloutsSince(sessions, sinceMs)) {
    const written = await stat(file).catch(() => null);
    if (!written || written.mtimeMs < sinceMs) continue;
    const usage = (await lastTokenCount(file))?.info?.total_token_usage;
    if (!usage) continue;
    sum.total += whole(usage.total_tokens); sum.input += whole(usage.input_tokens); sum.cachedInput += whole(usage.cached_input_tokens);
    sum.output += whole(usage.output_tokens); sum.reasoning += whole(usage.reasoning_output_tokens);
  }
  return sum;
}

/** A codex session id as codex names its rollouts (`rollout-<time>-<id>.jsonl`). */
const SESSION_ID = /^[0-9a-f][0-9a-f-]{7,63}$/i;
/**
 * What codex recorded for one session (모델 드리프트, 2026-11-05): `model` and `effort` from its rollout's last `turn_context` record, its
 * `cli_version` and `model_provider` from its `session_meta` record — the keys the pinned sprite-gen reads for its image runs
 * (`codex_provider._session_facts`, checked there against rollouts of codex 0.153.4 and 0.165.0). What codex recorded it ran the turn with,
 * not a copy of `-m`; a key it did not write stays null. Null when no rollout of that session was written since the day before `sinceMs`
 * (a codex that keeps no rollout, an id that is not one), or it cannot be read.
 * @param {string} sessions
 * @param {string} id
 * @param {number} [sinceMs]
 * @returns {Promise<{ model: string | null, effort: string | null, cliVersion: string | null, modelProvider: string | null } | null>}
 */
export async function codexSessionFacts(sessions, id, sinceMs = Date.now()) {
  if (typeof id !== 'string' || !SESSION_ID.test(id)) return null;
  const file = (await rolloutsSince(sessions, sinceMs)).find(name => path.basename(name).endsWith(`-${id}.jsonl`));
  const text = file ? await readFile(file, 'utf8').catch(() => null) : null;
  if (text === null) return null;
  /** @type {Record<string, string>} */
  const facts = {};
  /** @type {Record<string, string[]>} */
  const keys = { turn_context: ['model', 'effort'], session_meta: ['cli_version', 'model_provider'] };
  for (const line of text.split('\n')) {
    if (!line.includes('"turn_context"') && !line.includes('"session_meta"')) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const payload = record?.payload;
    if (!payload || typeof payload !== 'object') continue;
    for (const key of keys[record.type] ?? []) if (typeof payload[key] === 'string' && payload[key]) facts[key] = payload[key];
  }
  return { model: facts.model ?? null, effort: facts.effort ?? null, cliVersion: facts.cli_version ?? null, modelProvider: facts.model_provider ?? null };
}
