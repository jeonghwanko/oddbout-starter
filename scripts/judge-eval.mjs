#!/usr/bin/env node
// @ts-check
// The judges measured (2026-11-07): reads a generation host's judgment archive (host/generation-stages.mjs createJudgeArchive,
// `<host root>/judge-archive`, copied here) and, optionally, labels an operator gave, and says per judges mode and check how far the pixel
// judge agrees with the reference — the label where there is one, else codex's verdict — how often codex was asked, how often hybrid would
// ask it, and how long each judge took. It also lists the items to label first (where the pixels and codex disagree), and with `--rerun`
// judges the archived pictures again with this checkout's pixel judge, so a new pixel judge is measured on the same items before it ships.
// It never connects to anything; the archive holds no requester text.
//
// Read the modes apart. Only codex mode asks codex on every judgment (the pixel judge runs beside it, `shadow`), so its lines are the
// comparison that does not depend on the pixels' own answer. Hybrid asks codex only where the pixels failed nothing and left a check open:
// there a pixel fail never meets codex, and a pixel pass meets it only on a take with no other fail. Pixels mode asks codex never.
//
//   node scripts/judge-eval.mjs <archive-dir> [--labels labels.jsonl] [--json] [--queue N] [--rerun --python <python>]
//
// A label line: {"id":"<archive line id>","checks":{"side":"fail"}} — only the checks it names are labelled (pass or fail).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKS = Object.freeze({ side: ['whole', 'side', 'match', 'style', 'clean'], loop: ['identity', 'anatomy', 'loop'] });
/** The modes in the order they are reported: codex first, the one comparison the pixels' answers do not select. */
export const MODES = Object.freeze(['codex', 'hybrid', 'pixels']);
const STATES = /** @type {const} */ (['pass', 'fail', 'unknown']);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
// An archive line's id (createJudgeArchive: 8 random bytes in hex) and a picture's name (`<index>-<basename>`): checked before either
// becomes part of a path, so an edited archive copy cannot point outside its folder.
const ID = /^[0-9a-f]{16}$/, IMAGE = /^\d+-[A-Za-z0-9._-]+$/;

/**
 * @typedef {Record<string, string>} Checks
 * @typedef {{ id: string, at: string, job: string | null, item: string | null, kind: 'side' | 'loop', mode: string, decidedBy: string,
 *   final: Checks | null, pixels: { model: string, observed: string, checks: Checks | null, measures?: any, ms: number | null, wallMs?: number | null } | null,
 *   codex: { checks: Checks | null, model: string, wallMs: number | null, reused?: boolean } | null, shadow?: boolean, images?: string[] }} Line
 * @typedef {Record<string, Record<string, string>>} Labels
 * @typedef {{ pass: number, fail: number, none: number }} Row
 * @typedef {{ id: string, item: string | null, kind: string, mode: string, check: string, pixels: string, codex: string | null, why: string, at: string }} Queued
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

/** An archive line as judge-eval reads it, or null: version 1, a kind, an id and a time; pictures only with names it can trust. @param {any} line */
export function checkedLine(line) {
  if (line?.v !== 1 || (line.kind !== 'side' && line.kind !== 'loop') || typeof line.id !== 'string' || !ID.test(line.id)
    || typeof line.at !== 'string' || !Number.isFinite(Date.parse(line.at)) || typeof line.mode !== 'string' || typeof line.decidedBy !== 'string') return null;
  const images = Array.isArray(line.images) && line.images.every((/** @type {unknown} */ name) => typeof name === 'string' && IMAGE.test(name)) ? line.images : undefined;
  return { ...line, images };
}

/** Every archive line in `dir` (judgments-*.jsonl), oldest file first; a line judge-eval cannot read is counted and skipped. @param {string} dir */
export function readArchive(dir) {
  /** @type {Line[]} */ const records = []; let skipped = 0;
  for (const name of readdirSync(dir).filter(n => /^judgments-.*\.jsonl$/.test(n)).sort()) {
    const parsed = parseLines(readFileSync(path.join(dir, name), 'utf8'));
    skipped += parsed.skipped;
    for (const line of parsed.lines) {
      const checked = checkedLine(line);
      if (checked) records.push(checked); else skipped += 1;
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
/** @param {(number | null | undefined)[]} values */
const times = values => {
  const known = values.map(v => typeof v === 'number' ? v : NaN);
  return { n: known.filter(Number.isFinite).length, p50: quantile(known, 0.5), p95: quantile(known, 0.95) };
};

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

/** Whether hybrid would ask codex on this line's pixel answer: no check failed and one left open. @param {Line} line */
export const hybridWouldAsk = line => {
  const states = Object.values(line.pixels?.checks ?? {});
  return states.length > 0 && !states.includes('fail') && states.includes('unknown');
};

/**
 * Per kind and check, over `records` (one judges mode at a time: see the header): the pixel judge's answers against the reference
 * (`matrix[pixel][reference]`, `none` where there is no reference), how often it decided, how often a decision it made agreed (a pass that
 * held, a fail that held), and how often the final verdict agreed with the labels. Per kind: lines, who decided, how often codex judged,
 * how often hybrid would ask it on these pixel answers, the pixel judge's own and whole-call time, and codex's call time (p50, p95; codex's
 * includes the wait for a free codex slot, and a verdict reused from an earlier stage run has none).
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
    const withPixels = lines.filter(r => r.pixels?.checks);
    report[kind] = {
      lines: lines.length, decidedBy: countBy(lines, r => r.decidedBy),
      codexShare: share(lines.filter(r => r.codex?.checks).length, lines.length),
      hybridWouldAsk: share(withPixels.filter(hybridWouldAsk).length, withPixels.length),
      pixelMs: times(lines.map(r => r.pixels?.ms)), pixelWallMs: times(lines.map(r => r.pixels?.wallMs)), codexWallMs: times(lines.map(r => r.codex?.wallMs)),
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
/** `evaluate` per judges mode, in MODES order (a mode no line has is left out; an unknown one comes last). @param {Line[]} records @param {Labels} [labels] */
export function evaluateByMode(records, labels = {}) {
  const modes = [...MODES, ...new Set(records.map(r => r.mode).filter(m => !MODES.includes(m)))];
  /** @type {Record<string, any>} */ const byMode = {};
  for (const mode of modes) {
    const lines = records.filter(r => r.mode === mode);
    if (lines.length) byMode[mode] = evaluate(lines, labels);
  }
  return byMode;
}

/**
 * The items to label first: a check the pixels decided and codex answered otherwise (either may be wrong, and a pixel decision ends a take
 * in hybrid), then a check the pixels decided with no codex verdict to compare (only a label can say). Labelled checks are left out. The
 * pixels' fails come before their passes (each fail bought a take), newest first within each.
 * @param {Line[]} records @param {Labels} [labels] @returns {Queued[]}
 */
export function labelQueue(records, labels = {}) {
  /** @type {Queued[]} */ const queue = [];
  for (const line of records) for (const check of CHECKS[line.kind]) {
    if (labels[line.id]?.[check]) continue;
    const pixel = line.pixels?.checks?.[check], codex = line.codex?.checks?.[check];
    if (pixel !== 'pass' && pixel !== 'fail') continue;
    const base = { id: line.id, item: line.item, kind: line.kind, mode: line.mode, check, pixels: pixel, at: line.at };
    if (codex === 'pass' || codex === 'fail') { if (codex !== pixel) queue.push({ ...base, codex, why: 'disagree' }); }
    else queue.push({ ...base, codex: null, why: 'pixels-alone' });
  }
  /** @param {Queued} q */
  const rank = q => (q.why === 'disagree' ? 0 : 2) + (q.pixels === 'fail' ? 0 : 1);
  return queue.sort((a, b) => rank(a) - rank(b) || b.at.localeCompare(a.at));
}

/**
 * The archived pictures judged again by this checkout's pixel judge (`python -I host/motions.py pixel-judge`): the lines that kept their
 * pictures, each with its `pixels` replaced by the new answer. Lines without pictures are left out; a run that gives no usable answer is
 * counted in `failed`. The new answers are read per mode like the old ones: they do not change which lines codex judged.
 * @param {Line[]} records @param {string} dir
 * @param {{ python: string, motions?: string, run?: (command: string, args: string[], options: object) => { status: number | null } }} options
 */
export function rerun(records, dir, { python, motions = path.join(ROOT, 'host', 'motions.py'), run = spawnSync }) {
  const work = mkdtempSync(path.join(tmpdir(), 'judge-eval-'));
  /** @type {Line[]} */ const judged = []; let failed = 0;
  try {
    for (const line of records) {
      const names = line.images ?? [];
      if (names.length !== 2 || !ID.test(line.id)) continue;
      const folder = path.join(dir, 'images', line.at.slice(0, 10), line.id), out = path.join(work, `${line.id}.json`);
      const args = names.map(name => path.join(folder, name));
      if (!args.every(file => existsSync(file))) continue;
      const started = Date.now(), done = run(python, ['-I', motions, 'pixel-judge', line.kind, ...args, out], { encoding: 'utf8' }), wallMs = Date.now() - started;
      /** @type {any} */ let answer = null;
      try { answer = done.status === 0 ? JSON.parse(readFileSync(out, 'utf8')) : null; } catch { answer = null; }
      const checks = answer?.kind === line.kind ? (line.kind === 'side' ? answer.checks : answer) : null;
      if (!checks || typeof checks !== 'object') { failed += 1; continue; }
      judged.push({ ...line, pixels: { model: String(answer.model), observed: String(answer.model),
        checks: Object.fromEntries(CHECKS[line.kind].map(check => [check, checks[check]])), measures: answer.measures, ms: answer.measures?.ms ?? null, wallMs } });
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
  return { records: judged, failed };
}

/** @param {number | null | undefined} value */
const pct = value => value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;
/** @param {{ n: number, p50: number | null, p95: number | null }} t */
const msText = t => t.n ? `${t.p50} / ${t.p95} ms (n ${t.n})` : '—';
const ABOUT = /** @type {Record<string, string>} */ ({
  codex: 'codex judged every line, the pixel judge beside it: the comparison the pixels\' answers do not select',
  hybrid: 'codex only where the pixels failed nothing and left a check open: pixel fails never meet codex',
  pixels: 'no codex: only labels can say how the pixels did',
});

/** The per-mode report as text: per mode and kind its totals, then a line per check. @param {Record<string, any>} byMode @param {string} title */
export function render(byMode, title) {
  const out = [title];
  for (const [mode, report] of Object.entries(byMode)) {
    out.push('', `== ${mode} mode — ${ABOUT[mode] ?? 'an unknown mode'}`);
    for (const [kind, k] of Object.entries(report)) {
      const by = Object.entries(/** @type {Record<string, number>} */ (k.decidedBy)).map(([who, n]) => `${who} ${n}`).join(', ');
      out.push('', `${kind}: ${k.lines} judgments (${by}); codex verdicts on ${pct(k.codexShare)}; hybrid would ask codex on ${pct(k.hybridWouldAsk)}`,
        `  time p50 / p95: pixel judge ${msText(k.pixelMs)}, its whole call ${msText(k.pixelWallMs)}, codex call with its slot wait ${msText(k.codexWallMs)}`,
        '  check      decided   agree  pass held  fail held  final(label)  labelled  pixel pass | fail | unknown → ref pass/fail/none');
      for (const [check, c] of Object.entries(/** @type {Record<string, any>} */ (k.checks))) {
        const cells = STATES.map(s => `${c.matrix[s].pass}/${c.matrix[s].fail}/${c.matrix[s].none}`).join(' | ');
        out.push(`  ${check.padEnd(10)} ${pct(c.decidedShare).padStart(7)}  ${pct(c.agreement).padStart(6)}  ${pct(c.passHeld).padStart(9)}  ${pct(c.failHeld).padStart(9)}`
          + `  ${pct(c.finalAgreement).padStart(12)}  ${String(c.labelled).padStart(8)}  ${cells}`);
      }
    }
  }
  return out.join('\n');
}

const USAGE = 'usage: node scripts/judge-eval.mjs <archive-dir> [--labels labels.jsonl] [--json] [--queue N] [--rerun --python <python>]';
const VALUED = new Set(['--labels', '--queue', '--python']);
/** @param {string} file */
const isDir = file => { try { return statSync(file).isDirectory(); } catch { return false; } };

/** @param {string[]} argv @param {{ out?: (line: string) => void }} [io] */
export function main(argv, { out = line => { process.stdout.write(`${line}\n`); } } = {}) {
  /** @param {string} name */
  const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const dir = argv.find((arg, i) => !arg.startsWith('--') && !VALUED.has(argv[i - 1] ?? ''));
  if (!dir || !isDir(dir)) { out(USAGE); return 2; }
  const python = flag('--python'), labelsFile = flag('--labels'), queueSize = Number(flag('--queue') ?? 20);
  if (argv.includes('--rerun') && !python) { out('--rerun needs --python <the sprite-gen venv python>'); return 2; }
  if (labelsFile !== undefined && !existsSync(labelsFile)) { out(`no labels file at ${labelsFile}`); return 2; }
  if (!Number.isInteger(queueSize) || queueSize < 0) { out('--queue takes a whole number'); return 2; }
  const { records, skipped } = readArchive(dir);
  const labels = labelsFile ? readLabels(readFileSync(labelsFile, 'utf8')) : {};
  const ids = new Set(records.map(r => r.id)), labelled = Object.keys(labels).filter(id => ids.has(id)).length;
  const byMode = evaluateByMode(records, labels), queue = labelQueue(records, labels).slice(0, queueSize);
  /** @type {any} */ const result = { lines: records.length, skipped, labelled, unmatchedLabels: Object.keys(labels).length - labelled, byMode, queue };
  if (argv.includes('--rerun') && python) {
    const again = rerun(records, dir, { python });
    result.rerun = { lines: again.records.length, failed: again.failed, byMode: evaluateByMode(again.records, labels) };
  }
  if (argv.includes('--json')) { out(JSON.stringify(result, null, 1)); return 0; }
  out(`${records.length} judgments (${skipped} unreadable lines skipped), ${labelled} labelled`
    + (result.unmatchedLabels ? ` (${result.unmatchedLabels} label ids not in this archive)` : ''));
  out(render(byMode, '\nAs archived'));
  if (result.rerun) out(render(result.rerun.byMode,
    `\nJudged again by this checkout's pixel judge (${result.rerun.lines} with pictures, ${result.rerun.failed} gave no answer)`));
  out('\nLabel first:');
  for (const q of queue) out(`  ${q.id}  ${q.mode} ${q.kind} ${q.check.padEnd(9)} pixels ${q.pixels}, codex ${q.codex ?? '—'} (${q.why})  ${q.item ?? ''}`);
  if (!queue.length) out('  nothing');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2));
