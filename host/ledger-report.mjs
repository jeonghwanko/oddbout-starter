// @ts-check
// P0 measurement ledger for hosted fighter generation (JSON lines, see README.md). `og run` writes a start line and,
// from its exit path or signal trap, an end line, so a killed run still shows up as unfinished.
// `--append <ledger> --job … --kind … [--key value …]` writes a line; `<ledger> [job]` prints the summary that sets the
// P1 numbers. No line carries prompt, path or requester text: `tool` is the command's leading words only.
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TEXT = new Set(['job', 'kind', 'phase', 'run', 'tool', 'provider', 'account']);
const NUMBER = new Set(['ms', 'waitMs', 'exit', 'codexSessions', 'bytes']);
const KINDS = new Set(['new', 'run', 'deliver', 'close', 'purge', 'health']);

/** @param {Record<string, unknown>} fields @param {Date} [at] */
export function entry(fields, at = new Date()) {
  if (!fields.job || !KINDS.has(/** @type {string} */ (fields.kind))) throw new Error('ledger: job and a known kind are required');
  /** @type {Record<string, string | number>} */
  const line = { at: at.toISOString() };
  for (const [key, value] of Object.entries(fields)) {
    if (TEXT.has(key)) line[key] = String(value).slice(0, 80);
    else if (NUMBER.has(key)) {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`ledger: ${key} is not a number`);
      line[key] = n;
    } else throw new Error(`ledger: unknown field ${key}`);
  }
  return line;
}

/** Bad lines (a crash mid-write, a full disk) are counted and skipped, not fatal. @param {string} text @returns {{ entries: any[], skipped: number }} */
export function parse(text) {
  const entries = []; let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { skipped += 1; }
  }
  return { entries, skipped };
}

/** @param {number} exit @returns {'ok' | 'needsInput' | 'notStarted' | 'timeout' | 'interrupted' | 'failed'} */
export function outcome(exit) {
  if (exit === 0) return 'ok';
  if (exit === 2 || exit === 75) return 'needsInput';   // sprite-gen asked a question; nothing generated
  if (exit === 3) return 'notStarted';   // sprite-gen failed before any provider request: nothing generated, nothing billed
  if (exit === 124 || exit === 137) return 'timeout';
  if (exit === 129 || exit === 130 || exit === 143) return 'interrupted';
  return 'failed';
}

/** @param {number[]} sorted @param {number} p */
function percentile(sorted, p) {
  return sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** @param {any[]} entries @param {string} [onlyJob] */
export function summarize(entries, onlyJob) {
  /** @type {Map<string, any>} */
  const jobs = new Map();
  /** @type {Map<string, number[]>} */
  const durations = new Map();
  /** @type {Map<string, any>} */
  const started = new Map();
  const ended = new Set(), warnings = /** @type {string[]} */ ([]);
  /** @param {string} id @returns {any} */
  const jobOf = id => jobs.get(id) ?? jobs.set(id, { job: id, first: null, last: null, state: 'open', codexSessions: 0, codexSessionsExact: null,
    activeMs: 0, waitMs: 0, unfinished: 0, personalRuns: 0, providers: {} }).get(id);
  for (const e of entries) {
    if (e.job === '_health' || (onlyJob && e.job !== onlyJob)) continue;
    const job = jobOf(e.job);
    if (!job.first || e.at < job.first) job.first = e.at;
    if (!job.last || e.at > job.last) job.last = e.at;
    if (e.kind === 'deliver') {
      if (job.state === 'open') job.state = 'delivered';
      if (Number.isFinite(e.codexSessions)) job.codexSessionsExact = e.codexSessions;   // per-job total at delivery
    }
    if (e.kind === 'close') job.state = 'closed';
    if (e.kind === 'purge') job.state = 'purged';
    if (e.kind !== 'run') continue;
    if (e.phase === 'start') { started.set(e.run, e); continue; }
    ended.add(e.run);
    const p = job.providers[e.provider] ??= { runs: 0, ok: 0, failed: 0, notStarted: 0, needsInput: 0, timeout: 0, interrupted: 0, ms: 0 };
    p.runs += 1; p[outcome(e.exit)] += 1; p.ms += e.ms ?? 0;
    if (e.account === 'personal') job.personalRuns += 1;   // the operator's own subscription, allowed explicitly
    job.activeMs += e.ms ?? 0; job.waitMs += e.waitMs ?? 0; job.codexSessions += e.codexSessions ?? 0;
    if (e.provider !== 'codex' && (e.codexSessions ?? 0) > 0) warnings.push(`${e.job}: '${e.tool}' (${e.provider}) started ${e.codexSessions} codex session(s)`);
    if (e.provider !== 'local' && !['needsInput', 'notStarted'].includes(outcome(e.exit))) (durations.get(e.provider) ?? /** @type {number[]} */ (durations.set(e.provider, []).get(e.provider))).push(e.ms ?? 0);
  }
  for (const [run, e] of started) if (!ended.has(run) && jobs.has(e.job)) jobs.get(e.job).unfinished += 1;
  const perProvider = Object.fromEntries([...durations].map(([p, list]) => {
    const sorted = [...list].sort((a, b) => a - b);
    return [p, { runs: sorted.length, p50Ms: percentile(sorted, 50), p95Ms: percentile(sorted, 95) }];
  }));
  return { jobs: [...jobs.values()], providers: perProvider, warnings };
}

/** @param {number | null} ms */
function fmt(ms) { return ms === null ? '—' : ms >= 3600000 ? `${(ms / 3600000).toFixed(1)}h` : ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`; }
/** @type {Record<string, string>} */
const STATE = { open: '진행 중', delivered: '전달함', closed: '등록 확인', purged: '삭제함' };

/** @param {ReturnType<typeof summarize>} summary @param {number} [skipped] */
export function render(summary, skipped = 0) {
  const lines = [];
  for (const j of summary.jobs) {
    const parts = Object.entries(j.providers).filter(([p]) => p !== 'local').map(([p, v]) =>
      `${p} 실행 ${v.runs}회(실패 ${v.failed}·요청 전 실패 ${v.notStarted ?? 0}·시간초과 ${v.timeout}·중단 ${v.interrupted}·질문 ${v.needsInput})`);
    const span = j.first && j.last ? Date.parse(j.last) - Date.parse(j.first) : 0;
    const sessions = j.codexSessionsExact ?? `약 ${j.codexSessions}(실행 합 — 겹친 실행은 중복)`;
    lines.push(`${j.job}  ${STATE[j.state]}  codex 세션 ${sessions}  작업 ${fmt(j.activeMs)}  칸 대기 ${fmt(j.waitMs)}  ` +
      `달력 경과 ${fmt(span)}(신청자 대기 포함)${j.unfinished ? `  끝나지 않은 실행 ${j.unfinished}` : ''}` +
      `${j.personalRuns ? `  개인 계정 실행 ${j.personalRuns}` : ''}  ${parts.join('  ')}`);
  }
  for (const [p, v] of Object.entries(summary.providers)) lines.push(`[${p}] 실행 ${v.runs}회  p50 ${fmt(v.p50Ms)}  p95 ${fmt(v.p95Ms)}`);
  for (const w of summary.warnings) lines.push(`주의: ${w}`);
  if (skipped) lines.push(`주의: 읽지 못한 줄 ${skipped}개를 건너뛰었다`);
  return lines.join('\n') || '기록 없음';
}

/** One line per finished (or unfinished) run, oldest first: what failed, how, and how long it took.
 * @param {any[]} entries @param {string} [onlyJob] */
export function renderRuns(entries, onlyJob) {
  const ends = new Map(entries.filter(e => e.kind === 'run' && e.phase === 'end').map(e => [e.run, e]));
  const lines = entries.filter(e => e.kind === 'run' && e.phase === 'start' && (!onlyJob || e.job === onlyJob)).map(s => {
    const e = ends.get(s.run);
    const result = e ? `${outcome(e.exit)}(${e.exit})` : '끝나지 않음';
    return `${s.at.slice(5, 19).replace('T', ' ')}  ${s.provider.padEnd(5)}  ${result.padEnd(16)}  ${e ? fmt(e.ms ?? 0).padStart(6) : '     —'}  codex ${e?.codexSessions ?? '—'}  ${s.tool}`;
  });
  return lines.join('\n') || '기록 없음';
}

/** @param {string[]} argv */
function main(argv) {
  if (argv[0] === '--append') {
    /** @type {Record<string, string>} */
    const fields = {};
    for (let i = 2; i < argv.length; i += 2) {
      if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`ledger: bad argument ${argv[i]}`);
      fields[argv[i].slice(2)] = argv[i + 1];
    }
    appendFileSync(argv[1], JSON.stringify(entry(fields)) + '\n', { mode: 0o600 });
    return 0;
  }
  // --json: the summary as data, for scripts/measure-export.mjs (docs/MEASUREMENT.md).
  const runsOnly = argv.includes('--runs'), asJson = argv.includes('--json'), [file, job] = argv.filter(a => a !== '--runs' && a !== '--json');
  if (!file) { console.error('usage: ledger-report.mjs <ledger> [job] [--runs | --json]'); return 2; }
  if (!existsSync(file)) { console.log(asJson ? JSON.stringify({ jobs: [], providers: {}, warnings: [], skipped: 0 }) : '기록 없음'); return 0; }
  const { entries, skipped } = parse(readFileSync(file, 'utf8'));
  if (asJson) { console.log(JSON.stringify({ ...summarize(entries, job), skipped })); return 0; }
  console.log(runsOnly ? renderRuns(entries, job) : render(summarize(entries, job), skipped));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (/** @type {any} */ error) { console.error(error.message); process.exitCode = 1; }
}
