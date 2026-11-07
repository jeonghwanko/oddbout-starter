#!/usr/bin/env node
// @ts-check
// The judges measured (2026-11-07): reads a generation host's judgment archive (host/generation-stages.mjs createJudgeArchive,
// `<host root>/judge-archive`, copied here) and, optionally, labels an operator gave, and says per check how far the pixel judge agrees with
// the reference — the label where there is one, else codex's verdict — how often codex was asked, and how long each judge took. It also
// lists the items to label first (where the pixels and codex disagree), and with `--rerun` judges the archived pictures again with this
// checkout's pixel judge, so a new pixel judge is measured on the same items before it ships. It never connects to anything; the archive
// holds no requester text.
//
//   node scripts/judge-eval.mjs <archive-dir> [--labels labels.jsonl] [--json] [--queue N] [--rerun --python <python>]
//
// A label line: {"id":"<archive line id>","checks":{"side":"fail"}} — only the checks it names are labelled (pass or fail).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKS = Object.freeze({ side: ['whole', 'side', 'match', 'style', 'clean'], loop: ['identity', 'anatomy', 'loop'] });
const STATES = /** @type {const} */ (['pass', 'fail', 'unknown']);
const ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * @typedef {Record<string, string>} Checks
 * @typedef {{ id: string, at: string, job: string | null, item: string | null, kind: 'side' | 'loop', mode: string, decidedBy: string,
 *   final: Checks | null, pixels: { model: string, observed: string, checks: Checks | null, measures?: any, ms: number | null } | null,
 *   codex: { checks: Checks | null, model: string, ms: number | null } | null, shadow?: boolean, images?: string[] }} Line
 * @typedef {Record<string, Record<string, string>>} Labels
 * @typedef {{ pass: number, fail: number, none: number }} Row
 * @typedef {{ id: string, item: string | null, kind: string, check: string, pixels: string, codex: string | null, why: string, at: string }} Queued
 */

/** Lines from JSON-lines text: a torn line (a crash mid-write) is counted and skipped, as the ledger does. @param {string} text */
export function parseLines(text) {
  /** @type {any[]} */ const lines = []; let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { lines.push(JSON.parse(line)); } catch { skipped += 1; }
  }
  return { lines, skipped };
}

/** Every archive line in `dir` (judgments-*.jsonl), oldest file first; a line of another version or kind is skipped. @param {string} dir */
export function readArchive(dir) {
  /** @type {Line[]} */ const records = []; let skipped = 0;
  for (const name of readdirSync(dir).filter(n => /^judgments-.*\.jsonl$/.test(n)).sort()) {
    const parsed = parseLines(readFileSync(path.join(dir, name), 'utf8'));
    skipped += parsed.skipped;
    for (const line of parsed.lines) {
      if (line?.v === 1 && typeof line.id === 'string' && (line.kind === 'side' || line.kind === 'loop')) records.push(line);
      else skipped += 1;
    }
  }
  return { records, skipped };
}

/** Labels by archive id, `{ id: { check: 'pass' | 'fail' } }`; a later line for an id wins check by check. @param {string} text */
export function readLabels(text) {
  /** @type {Labels} */ const labels = {};
  for (const line of parseLines(text).lines) {
    if (typeof line?.id !== 'string' || !line.checks || typeof line.checks !== 'object') continue;
    for (const [check, value] of Object.entries(line.checks)) if (value === 'pass' || value === 'fail') (labels[line.id] ??= {})[check] = value;
  }
  return labels;
}

/** The value at fraction `q` of `values` sorted (nearest rank), or null for none. @param {number[]} values @param {number} q */
export const quantile = (values, q) => {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] : null;
};
/** @param {number} part @param {number} whole */
const share = (part, whole) => whole ? Math.round((part / whole) * 1000) / 1000 : null;

/**
 * The reference for one check of one line: the label, else codex's verdict, else none; and where it came from.
 * @param {Line} line @param {string} check @param {Labels} labels @returns {{ value: 'pass' | 'fail', from: 'label' | 'codex' } | null}
 */
export function reference(line, check, labels) {
  const label = labels[line.id]?.[check];
  if (label === 'pass' || label === 'fail') return { value: label, from: 'label' };
  const codex = line.codex?.checks?.[check];
  return codex === 'pass' || codex === 'fail' ? { value: codex, from: 'codex' } : null;
}

/**
 * Per kind and check: the pixel judge's answers against the reference (`matrix[pixel][reference]`, `none` where there is no reference), how
 * often it decided, how often a decision it made agreed (a pass that held, a fail that held), and how often the final verdict agreed with
 * the labels. Per kind: lines, who decided, how often codex was asked (decidedBy names codex), and each judge's time (p50, p95).
 * @param {Line[]} records @param {Labels} [labels]
 */
export function evaluate(records, labels = {}) {
  /** @type {Record<string, any>} */ const report = {};
  for (const kind of /** @type {const} */ (['side', 'loop'])) {
    const lines = records.filter(r => r.kind === kind);
    if (!lines.length) continue;
    /** @type {Record<string, any>} */ const checks = {};
    for (const check of CHECKS[kind]) {
      /** @type {Record<string, Row>} */ const matrix = Object.fromEntries(STATES.map(s => [s, { pass: 0, fail: 0, none: 0 }]));
      let finalAgree = 0, finalLabelled = 0, labelled = 0;
      for (const line of lines) {
        const pixel = line.pixels?.checks?.[check], ref = reference(line, check, labels);
        if (pixel && matrix[pixel]) matrix[pixel][ref?.value ?? 'none'] += 1;
        if (ref?.from === 'label') {
          labelled += 1;
          const final = line.final?.[check];
          if (final === 'pass' || final === 'fail') { finalLabelled += 1; if (final === ref.value) finalAgree += 1; }
        }
      }
      const answered = STATES.reduce((n, s) => n + matrix[s].pass + matrix[s].fail + matrix[s].none, 0);
      const open = matrix.unknown.pass + matrix.unknown.fail + matrix.unknown.none;
      const decided = matrix.pass.pass + matrix.pass.fail + matrix.fail.pass + matrix.fail.fail;
      checks[check] = {
        matrix, answered, labelled, decidedShare: share(answered - open, answered),
        agreement: share(matrix.pass.pass + matrix.fail.fail, decided),
        passHeld: share(matrix.pass.pass, matrix.pass.pass + matrix.pass.fail),
        failHeld: share(matrix.fail.fail, matrix.fail.fail + matrix.fail.pass),
        finalAgreement: share(finalAgree, finalLabelled),
      };
    }
    const asked = lines.filter(r => /codex/.test(r.decidedBy)).length;
    const pixelMs = lines.map(r => r.pixels?.ms ?? NaN), codexMs = lines.map(r => r.codex?.ms ?? NaN);
    report[kind] = {
      lines: lines.length, modes: countBy(lines, r => r.mode), decidedBy: countBy(lines, r => r.decidedBy), codexShare: share(asked, lines.length),
      pixelMs: { p50: quantile(pixelMs, 0.5), p95: quantile(pixelMs, 0.95) }, codexMs: { p50: quantile(codexMs, 0.5), p95: quantile(codexMs, 0.95) },
      checks,
    };
  }
  return report;
}
/** @param {Line[]} items @param {(item: Line) => string} key @returns {Record<string, number>} */
const countBy = (items, key) => {
  /** @type {Record<string, number>} */ const counts = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
};

/**
 * The items to label first: a check the pixels decided and codex answered otherwise (either may be wrong, and a pixel decision ends a take
 * in hybrid), then a check the pixels decided with no codex to compare (decided alone: only a label can say). Labelled checks are left out.
 * The pixels' fails come before their passes (each fail bought a take), newest first within each.
 * @param {Line[]} records @param {Labels} [labels] @returns {Queued[]}
 */
export function labelQueue(records, labels = {}) {
  /** @type {Queued[]} */ const queue = [];
  for (const line of records) for (const check of CHECKS[line.kind]) {
    if (labels[line.id]?.[check]) continue;
    const pixel = line.pixels?.checks?.[check], codex = line.codex?.checks?.[check];
    if (pixel !== 'pass' && pixel !== 'fail') continue;
    const base = { id: line.id, item: line.item, kind: line.kind, check, pixels: pixel, at: line.at };
    if (codex === 'pass' || codex === 'fail') { if (codex !== pixel) queue.push({ ...base, codex, why: 'disagree' }); }
    else if (line.decidedBy === 'pixels') queue.push({ ...base, codex: null, why: 'pixels-alone' });
  }
  /** @param {Queued} q */
  const rank = q => (q.why === 'disagree' ? 0 : 2) + (q.pixels === 'fail' ? 0 : 1);
  return queue.sort((a, b) => rank(a) - rank(b) || b.at.localeCompare(a.at));
}

/**
 * The archived pictures judged again by this checkout's pixel judge (`python -I host/motions.py pixel-judge`): the lines that kept their
 * pictures, each with its `pixels` replaced by the new answer. Lines without pictures are left out; a run that gives no answer is counted.
 * @param {Line[]} records @param {string} dir
 * @param {{ python: string, motions?: string, run?: (command: string, args: string[], options: object) => { status: number | null } }} options
 */
export function rerun(records, dir, { python, motions = path.join(ROOT, 'host', 'motions.py'), run = spawnSync }) {
  const work = mkdtempSync(path.join(tmpdir(), 'judge-eval-'));
  /** @type {Line[]} */ const judged = []; let failed = 0;
  try {
    for (const line of records) {
      const names = line.images ?? [];
      if (names.length !== 2) continue;
      const folder = path.join(dir, 'images', line.at.slice(0, 10), line.id), out = path.join(work, `${line.id}.json`);
      const args = names.map(name => path.join(folder, name));
      if (!args.every(file => existsSync(file))) continue;
      const done = run(python, ['-I', motions, 'pixel-judge', line.kind, ...args, out], { encoding: 'utf8' });
      /** @type {any} */ const answer = done.status === 0 && existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
      const checks = answer && (line.kind === 'side' ? answer.checks : answer);
      if (!checks) { failed += 1; continue; }
      judged.push({ ...line, pixels: { model: String(answer.model), observed: String(answer.model),
        checks: Object.fromEntries(CHECKS[line.kind].map(check => [check, checks[check]])), measures: answer.measures, ms: answer.measures?.ms ?? null } });
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
  return { records: judged, failed };
}

/** @param {number | null | undefined} value */
const pct = value => value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;
/** @param {number | null | undefined} value */
const msText = value => value === null || value === undefined ? '—' : `${value} ms`;

/** The report as text: per kind its totals, then a line per check. @param {Record<string, any>} report @param {string} title */
export function render(report, title) {
  const out = [title];
  for (const [kind, k] of Object.entries(report)) {
    const by = Object.entries(/** @type {Record<string, number>} */ (k.decidedBy)).map(([who, n]) => `${who} ${n}`).join(', ');
    out.push('', `${kind}: ${k.lines} judgments, codex asked on ${pct(k.codexShare)} (${by})`,
      `  pixels ${msText(k.pixelMs.p50)} p50 / ${msText(k.pixelMs.p95)} p95, codex ${msText(k.codexMs.p50)} p50 / ${msText(k.codexMs.p95)} p95`,
      '  check      decided   agree  pass held  fail held  final(label)  labelled  pixel pass | fail | unknown → ref pass/fail/none');
    for (const [check, c] of Object.entries(/** @type {Record<string, any>} */ (k.checks))) {
      const cells = STATES.map(s => `${c.matrix[s].pass}/${c.matrix[s].fail}/${c.matrix[s].none}`).join(' | ');
      out.push(`  ${check.padEnd(10)} ${pct(c.decidedShare).padStart(7)}  ${pct(c.agreement).padStart(6)}  ${pct(c.passHeld).padStart(9)}  ${pct(c.failHeld).padStart(9)}`
        + `  ${pct(c.finalAgreement).padStart(12)}  ${String(c.labelled).padStart(8)}  ${cells}`);
    }
  }
  return out.join('\n');
}

const USAGE = 'usage: node scripts/judge-eval.mjs <archive-dir> [--labels labels.jsonl] [--json] [--queue N] [--rerun --python <python>]';
const VALUED = new Set(['--labels', '--queue', '--python']);

/** @param {string[]} argv @param {{ out?: (line: string) => void }} [io] */
export function main(argv, { out = line => { process.stdout.write(`${line}\n`); } } = {}) {
  /** @param {string} name */
  const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const dir = argv.find((arg, i) => !arg.startsWith('--') && !VALUED.has(argv[i - 1] ?? ''));
  if (!dir || !existsSync(dir)) { out(USAGE); return 2; }
  const python = flag('--python');
  if (argv.includes('--rerun') && !python) { out('--rerun needs --python <the sprite-gen venv python>'); return 2; }
  const { records, skipped } = readArchive(dir);
  const labelsFile = flag('--labels'), labels = labelsFile ? readLabels(readFileSync(labelsFile, 'utf8')) : {};
  const report = evaluate(records, labels), queue = labelQueue(records, labels).slice(0, Number(flag('--queue') ?? 20));
  /** @type {any} */ const result = { lines: records.length, skipped, labelled: Object.keys(labels).length, report, queue };
  if (argv.includes('--rerun') && python) {
    const again = rerun(records, dir, { python });
    result.rerun = { lines: again.records.length, failed: again.failed, report: evaluate(again.records, labels) };
  }
  if (argv.includes('--json')) { out(JSON.stringify(result, null, 1)); return 0; }
  out(`${records.length} judgments (${skipped} unreadable lines skipped), ${result.labelled} labelled`);
  out(render(report, '\nAs archived'));
  if (result.rerun) out(render(result.rerun.report,
    `\nJudged again by this checkout's pixel judge (${result.rerun.lines} with pictures, ${result.rerun.failed} gave no answer)`));
  out('\nLabel first:');
  for (const q of queue) out(`  ${q.id}  ${q.kind} ${q.check.padEnd(9)} pixels ${q.pixels}, codex ${q.codex ?? '—'} (${q.why})  ${q.item ?? ''}`);
  if (!queue.length) out('  nothing');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2));
