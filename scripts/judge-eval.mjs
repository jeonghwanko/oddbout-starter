#!/usr/bin/env node
// @ts-check
// The judges measured (2026-11-07): reads a generation host's judgment archive (host/judge-archive.mjs createJudgeArchive,
// `<host root>/judge-archive`, copied here — its salt file stays on the host) and, optionally, labels an operator gave. Per judges mode and
// check it says how the pixel judge's answers stand against codex's verdicts, how often codex judged, how often hybrid would ask it, how
// long each judge took and how often the pixel judge gave no answer; and, apart, what the labels say about each judge. It lists the items to
// label first, and with `--rerun` judges the archived pictures again with this checkout's pixel judge and compares the two pixel judges on
// the same items. It never connects to anything; the archive holds no requester text.
//
// Read the modes apart. Only codex mode asks codex on every judgment (the pixel judge runs beside it, `shadow`), so its lines are the
// comparison that does not depend on the pixels' own answer. Hybrid asks codex only where the pixels failed nothing and left a check open:
// there a pixel fail never meets codex, and a pixel pass meets it only on a take with no other fail. Pixels mode never asks codex.
//
// Labels are read by stratum, never pooled: the queue picks disagreements first, so a pooled accuracy over labelled items would say more
// about the queue than about the judges. Where the pixels and codex agreed, the label says whether both were right (the queue mixes in a
// random sample of these); where they disagreed, which one was; where codex said nothing, whether the pixels were right.
//
//   node scripts/judge-eval.mjs <archive-dir> [--labels labels.jsonl] [--json] [--queue N] [--sample N] [--rerun --python <python> [--judge <script>]]
//
// `--judge` names another script with motions.py's `pixel-judge` command (host/side_models.py: the pixel judge with the side take's `side`
// from local models, run with that tier's own venv python); without it, host/motions.py.
//
// A label line: {"id":"<archive line id>","checks":{"side":"fail"}} — only the checks it names are labelled (pass or fail).
import { createHash } from 'node:crypto';
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
// An archive line's id (createJudgeArchive: 8 random bytes in hex), its time and a picture's name (`<index>-<basename>`): checked before
// any becomes part of a path, so an edited archive copy cannot point outside its folder.
const ID = /^[0-9a-f]{16}$/,
  AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
  IMAGE = /^\d+-[A-Za-z0-9._-]+$/;

/**
 * @typedef {Record<string, string>} Checks
 * @typedef {{ id: string, at: string, jobKey?: string | null, item: string | null, kind: 'side' | 'loop', mode: string, decidedBy: string,
 *   final: Checks | null, pixels: { model: string, observed?: string, checks: Checks | null, measures?: any, ms?: number | null, wallMs?: number | null,
 *   error?: string } | null, codex: { checks: Checks | null, model: string, wallMs: number | null, reused?: boolean } | null, shadow?: boolean,
 *   recovered?: boolean, images?: string[] }} Line
 * @typedef {Record<string, Record<string, string>>} Labels
 * @typedef {{ pass: number, fail: number, none: number }} Row
 * @typedef {{ id: string, item: string | null, kind: string, mode: string, check: string, pixels: string, codex: string | null, why: string, at: string }} Queued
 */

/** Lines from JSON-lines text: a torn line (a crash mid-write) is counted and skipped, as the ledger does. @param {string} text */
export function parseLines(text) {
  /** @type {any[]} */ const lines = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      skipped += 1;
    }
  }
  return { lines, skipped };
}

/** An archive line as judge-eval reads it, or null: version 1 or 2, a kind, an id and a time; pictures only with names it can trust. @param {any} line */
export function checkedLine(line) {
  if (
    (line?.v !== 1 && line?.v !== 2) ||
    (line.kind !== 'side' && line.kind !== 'loop') ||
    typeof line.id !== 'string' ||
    !ID.test(line.id) ||
    typeof line.at !== 'string' ||
    !AT.test(line.at) ||
    typeof line.mode !== 'string' ||
    typeof line.decidedBy !== 'string'
  )
    return null;
  const images =
    Array.isArray(line.images) && line.images.every((/** @type {unknown} */ name) => typeof name === 'string' && IMAGE.test(name)) ? line.images : undefined;
  return { ...line, images };
}

/** Every archive line in `dir` (judgments-*.jsonl), oldest file first; a line judge-eval cannot read is counted and skipped. @param {string} dir */
export function readArchive(dir) {
  /** @type {Line[]} */ const records = [];
  let skipped = 0;
  for (const name of readdirSync(dir)
    .filter(n => /^judgments-.*\.jsonl$/.test(n))
    .sort()) {
    const parsed = parseLines(readFileSync(path.join(dir, name), 'utf8'));
    skipped += parsed.skipped;
    for (const line of parsed.lines) {
      const checked = checkedLine(line);
      if (checked) records.push(checked);
      else skipped += 1;
    }
  }
  return { records, skipped };
}

/** Labels by archive id, `{ id: { check: 'pass' | 'fail' } }`; a later line for an id wins check by check; ids not shaped like one are skipped. @param {string} text */
export function readLabels(text) {
  /** @type {Labels} */ const labels = Object.create(null);
  for (const line of parseLines(text).lines) {
    if (typeof line?.id !== 'string' || !ID.test(line.id) || !line.checks || typeof line.checks !== 'object') continue;
    for (const [check, value] of Object.entries(line.checks))
      if (value === 'pass' || value === 'fail') (labels[line.id] ??= Object.create(null))[check] = value;
  }
  return labels;
}

/** The value at fraction `q` of `values` sorted (nearest rank), or null for none. @param {number[]} values @param {number} q */
export const quantile = (values, q) => {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] : null;
};
/** @param {number} part @param {number} whole */
const share = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 1000 : null);
/** @param {(number | null | undefined)[]} values */
const times = values => {
  const known = values.map(v => (typeof v === 'number' ? v : NaN));
  return { n: known.filter(Number.isFinite).length, p50: quantile(known, 0.5), p95: quantile(known, 0.95) };
};
/** @param {unknown} value @returns {value is 'pass' | 'fail'} */
const decided = value => value === 'pass' || value === 'fail';

/** Whether hybrid would ask codex on this line's pixel answer: no check failed and one left open. @param {Line} line */
export const hybridWouldAsk = line => {
  const states = Object.values(line.pixels?.checks ?? {});
  return states.length > 0 && !states.includes('fail') && states.includes('unknown');
};

/**
 * What the labels of one check say, by stratum (see the header): `agreed` (pixels and codex gave the same answer: how often both were
 * right), `disagreed` (which was right), `pixelsAlone` (the pixels decided with no codex verdict), `codexAlone` (codex decided, the pixels
 * left it open). Each: n labelled and the shares right.
 * @param {Line[]} lines @param {string} check @param {Labels} labels
 */
export function labelStrata(lines, check, labels) {
  const strata = {
    agreed: { n: 0, bothRight: 0 },
    disagreed: { n: 0, pixelsRight: 0, codexRight: 0 },
    pixelsAlone: { n: 0, pixelsRight: 0 },
    codexAlone: { n: 0, codexRight: 0 },
  };
  for (const line of lines) {
    const label = labels[line.id]?.[check];
    if (!decided(label)) continue;
    const pixel = line.pixels?.checks?.[check],
      codex = line.codex?.checks?.[check];
    if (decided(pixel) && decided(codex)) {
      if (pixel === codex) {
        strata.agreed.n += 1;
        if (pixel === label) strata.agreed.bothRight += 1;
      } else {
        strata.disagreed.n += 1;
        if (pixel === label) strata.disagreed.pixelsRight += 1;
        else strata.disagreed.codexRight += 1;
      }
    } else if (decided(pixel)) {
      strata.pixelsAlone.n += 1;
      if (pixel === label) strata.pixelsAlone.pixelsRight += 1;
    } else if (decided(codex)) {
      strata.codexAlone.n += 1;
      if (codex === label) strata.codexAlone.codexRight += 1;
    }
  }
  return {
    agreed: { n: strata.agreed.n, bothRight: share(strata.agreed.bothRight, strata.agreed.n) },
    disagreed: {
      n: strata.disagreed.n,
      pixelsRight: share(strata.disagreed.pixelsRight, strata.disagreed.n),
      codexRight: share(strata.disagreed.codexRight, strata.disagreed.n),
    },
    pixelsAlone: { n: strata.pixelsAlone.n, pixelsRight: share(strata.pixelsAlone.pixelsRight, strata.pixelsAlone.n) },
    codexAlone: { n: strata.codexAlone.n, codexRight: share(strata.codexAlone.codexRight, strata.codexAlone.n) },
  };
}

/**
 * Per kind and check, over `records` (one judges mode at a time: see the header): the pixel judge's answers against codex's verdicts
 * (`matrix[pixel][codex]`, `none` where codex gave none; labels never enter it), how many lines the pixel judge answered, how often it
 * decided, how often a decision it made agreed with codex (a pass that held, a fail that held), and the labels by stratum. Per kind: lines,
 * the pixel judge's no-answers, who decided, how often codex judged, how often hybrid would ask it on these pixel answers, and the times
 * (p50, p95): the pixel judge's own and its whole call, and codex's call with its wait for a free slot (none for a verdict reused).
 * @param {Line[]} records @param {Labels} [labels]
 */
export function evaluate(records, labels = Object.create(null)) {
  /** @type {Record<string, any>} */ const report = {};
  for (const kind of /** @type {const} */ (['side', 'loop'])) {
    const all = records.filter(r => r.kind === kind);
    if (!all.length) continue;
    const lines = all.filter(r => r.decidedBy !== 'none');
    /** @type {Record<string, any>} */ const checks = {};
    for (const check of CHECKS[kind]) {
      /** @type {Record<string, Row>} */ const matrix = Object.fromEntries(STATES.map(s => [s, { pass: 0, fail: 0, none: 0 }]));
      for (const line of lines) {
        const pixel = line.pixels?.checks?.[check],
          codex = line.codex?.checks?.[check];
        if (pixel && matrix[pixel]) matrix[pixel][decided(codex) ? codex : 'none'] += 1;
      }
      const answered = STATES.reduce((n, s) => n + matrix[s].pass + matrix[s].fail + matrix[s].none, 0);
      const open = matrix.unknown.pass + matrix.unknown.fail + matrix.unknown.none;
      const compared = matrix.pass.pass + matrix.pass.fail + matrix.fail.pass + matrix.fail.fail;
      checks[check] = {
        matrix,
        answered,
        decidedShare: share(answered - open, answered),
        agreement: share(matrix.pass.pass + matrix.fail.fail, compared),
        passHeld: share(matrix.pass.pass, matrix.pass.pass + matrix.pass.fail),
        failHeld: share(matrix.fail.fail, matrix.fail.fail + matrix.fail.pass),
        labels: labelStrata(lines, check, labels),
      };
    }
    const withPixels = lines.filter(r => r.pixels?.checks);
    report[kind] = {
      lines: all.length,
      pixelNoAnswer: all.filter(r => r.pixels?.error !== undefined).length,
      recovered: all.filter(r => r.recovered).length,
      decidedBy: countBy(all, r => r.decidedBy),
      codexShare: share(lines.filter(r => r.codex?.checks).length, lines.length),
      hybridWouldAsk: share(withPixels.filter(hybridWouldAsk).length, withPixels.length),
      pixelMs: times(all.map(r => r.pixels?.ms)),
      pixelWallMs: times(all.map(r => r.pixels?.wallMs)),
      codexWallMs: times(lines.map(r => r.codex?.wallMs)),
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
export function evaluateByMode(records, labels = Object.create(null)) {
  const modes = [...MODES, ...new Set(records.map(r => r.mode).filter(m => !MODES.includes(m)))];
  /** @type {Record<string, any>} */ const byMode = {};
  for (const mode of modes) {
    const lines = records.filter(r => r.mode === mode);
    if (lines.length) byMode[mode] = evaluate(lines, labels);
  }
  return byMode;
}

/** A stable pseudo-random rank for a check of a line (the same archive, the same sample). @param {string} id @param {string} check */
const draw = (id, check) => createHash('sha256').update(`${id}:${check}`).digest().readUInt32BE(0);

/**
 * The items to label first: a check the pixels decided and codex answered otherwise (`disagree`; either may be wrong, and a pixel decision
 * ends a take in hybrid); then `sample` agreements drawn at random (`agree-sample`: the only way to find both judges wrong); then a check
 * the pixels decided with no codex verdict (`pixels-alone`). Labelled checks are left out. Within each, the pixels' fails come before their
 * passes (each fail bought a take), newest first.
 * @param {Line[]} records @param {Labels} [labels] @param {{ sample?: number }} [options] @returns {Queued[]}
 */
export function labelQueue(records, labels = Object.create(null), { sample = 5 } = {}) {
  /** @type {Queued[]} */ const queue = [];
  /** @type {Queued[]} */ const agreed = [];
  for (const line of records)
    for (const check of CHECKS[line.kind]) {
      if (line.decidedBy === 'none' || labels[line.id]?.[check]) continue;
      const pixel = line.pixels?.checks?.[check],
        codex = line.codex?.checks?.[check];
      if (!decided(pixel)) continue;
      const base = { id: line.id, item: line.item, kind: line.kind, mode: line.mode, check, pixels: pixel, at: line.at };
      if (decided(codex)) (codex !== pixel ? queue : agreed).push({ ...base, codex, why: codex !== pixel ? 'disagree' : 'agree-sample' });
      else queue.push({ ...base, codex: null, why: 'pixels-alone' });
    }
  queue.push(...agreed.sort((a, b) => draw(a.id, a.check) - draw(b.id, b.check)).slice(0, sample));
  /** @param {Queued} q */
  const rank = q => ({ disagree: 0, 'agree-sample': 2, 'pixels-alone': 4 })[q.why] ?? 6;
  /** @param {Queued} q */
  const within = q => (q.why === 'agree-sample' ? 0 : q.pixels === 'fail' ? 0 : 1);
  return queue.sort((a, b) => rank(a) - rank(b) || within(a) - within(b) || b.at.localeCompare(a.at));
}

/**
 * The archived pictures judged again by this checkout's pixel judge (`python -I host/motions.py pixel-judge`, or the `--judge` script): the lines that kept their
 * pictures, each with its `pixels` replaced by the new answer, and the same lines as archived (`before`), so the two pixel judges are
 * compared on the same items. A run that gives no usable answer is counted in `failed` and left out of both.
 * @param {Line[]} records @param {string} dir
 * @param {{ python: string, motions?: string, run?: (command: string, args: string[], options: object) => { status: number | null } }} options
 */
export function rerun(records, dir, { python, motions = path.join(ROOT, 'host', 'motions.py'), run = spawnSync }) {
  const work = mkdtempSync(path.join(tmpdir(), 'judge-eval-'));
  /** @type {Line[]} */ const judged = [],
    before = [];
  let failed = 0;
  try {
    for (const line of records) {
      const names = line.images ?? [];
      if (names.length !== 2 || !ID.test(line.id) || !AT.test(line.at) || line.decidedBy === 'none') continue;
      const folder = path.join(dir, 'images', line.at.slice(0, 10), line.id),
        out = path.join(work, `${line.id}.json`);
      const args = names.map(name => path.join(folder, name));
      if (!args.every(file => existsSync(file))) continue;
      const started = Date.now(),
        done = run(python, ['-I', motions, 'pixel-judge', line.kind, ...args, out], { encoding: 'utf8' }),
        wallMs = Date.now() - started;
      /** @type {any} */ let answer = null;
      try {
        answer = done.status === 0 ? JSON.parse(readFileSync(out, 'utf8')) : null;
      } catch {
        answer = null;
      }
      const checks = answer?.kind === line.kind ? (line.kind === 'side' ? answer.checks : answer) : null;
      if (!checks || typeof checks !== 'object') {
        failed += 1;
        continue;
      }
      before.push(line);
      judged.push({
        ...line,
        pixels: {
          model: String(answer.model),
          observed: String(answer.model),
          checks: Object.fromEntries(CHECKS[line.kind].map(check => [check, checks[check]])),
          measures: answer.measures,
          ms: answer.measures?.ms ?? null,
          wallMs,
        },
      });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return { records: judged, before, failed };
}

/** @param {number | null | undefined} value */
const pct = value => (value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`);
/** @param {{ n: number, p50: number | null, p95: number | null }} t */
const msText = t => (t.n ? `${t.p50} / ${t.p95} ms (n ${t.n})` : '—');
const ABOUT = /** @type {Record<string, string>} */ ({
  codex: "codex judged every line, the pixel judge beside it: the comparison the pixels' answers do not select",
  hybrid: 'codex only where the pixels failed nothing and left a check open: pixel fails never meet codex',
  pixels: 'no codex: only labels can say how the pixels did',
});
/** @param {any} s */
const strataText = s =>
  [
    s.agreed.n ? `agreed ${s.agreed.n}: both right ${pct(s.agreed.bothRight)}` : '',
    s.disagreed.n ? `disagreed ${s.disagreed.n}: pixels right ${pct(s.disagreed.pixelsRight)}, codex right ${pct(s.disagreed.codexRight)}` : '',
    s.pixelsAlone.n ? `pixels alone ${s.pixelsAlone.n}: right ${pct(s.pixelsAlone.pixelsRight)}` : '',
    s.codexAlone.n ? `codex alone ${s.codexAlone.n}: right ${pct(s.codexAlone.codexRight)}` : '',
  ]
    .filter(Boolean)
    .join('; ');

/** The per-mode report as text: per mode and kind its totals, a line per check, then the labels by stratum. @param {Record<string, any>} byMode @param {string} title */
export function render(byMode, title) {
  const out = [title];
  for (const [mode, report] of Object.entries(byMode)) {
    out.push('', `== ${mode} mode — ${ABOUT[mode] ?? 'an unknown mode'}`);
    for (const [kind, k] of Object.entries(report)) {
      const by = Object.entries(/** @type {Record<string, number>} */ (k.decidedBy))
        .map(([who, n]) => `${who} ${n}`)
        .join(', ');
      out.push(
        '',
        `${kind}: ${k.lines} lines (${by}); pixel judge no answer ${k.pixelNoAnswer}; recovered ${k.recovered}; ` +
          `codex verdicts on ${pct(k.codexShare)}; hybrid would ask codex on ${pct(k.hybridWouldAsk)}`,
        `  time p50 / p95: pixel judge ${msText(k.pixelMs)}, its whole call ${msText(k.pixelWallMs)}, codex call with its slot wait ${msText(k.codexWallMs)}`,
        '  check      answered  decided   agree  pass held  fail held  pixel pass | fail | unknown → codex pass/fail/none',
      );
      const labelled = [];
      for (const [check, c] of Object.entries(/** @type {Record<string, any>} */ (k.checks))) {
        const cells = STATES.map(s => `${c.matrix[s].pass}/${c.matrix[s].fail}/${c.matrix[s].none}`).join(' | ');
        out.push(
          `  ${check.padEnd(10)} ${String(c.answered).padStart(8)}  ${pct(c.decidedShare).padStart(7)}  ${pct(c.agreement).padStart(6)}` +
            `  ${pct(c.passHeld).padStart(9)}  ${pct(c.failHeld).padStart(9)}  ${cells}`,
        );
        const said = strataText(c.labels);
        if (said) labelled.push(`  ${check.padEnd(10)} ${said}`);
      }
      if (labelled.length) out.push('  labels by stratum (never pooled):', ...labelled);
    }
  }
  return out.join('\n');
}

const USAGE =
  'usage: node scripts/judge-eval.mjs <archive-dir> [--labels labels.jsonl] [--json] [--queue N] [--sample N] [--rerun --python <python> [--judge <script>]]';
const VALUED = new Set(['--labels', '--queue', '--sample', '--python', '--judge']);
/** @param {string} file */
const isDir = file => {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
};

/** @param {string[]} argv @param {{ out?: (line: string) => void }} [io] */
export function main(
  argv,
  {
    out = line => {
      process.stdout.write(`${line}\n`);
    },
  } = {},
) {
  /** @param {string} name */
  const flag = name => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const dir = argv.find((arg, i) => !arg.startsWith('--') && !VALUED.has(argv[i - 1] ?? ''));
  if (!dir || !isDir(dir)) {
    out(USAGE);
    return 2;
  }
  const python = flag('--python'),
    labelsFile = flag('--labels'),
    queueSize = Number(flag('--queue') ?? 20),
    sample = Number(flag('--sample') ?? 5);
  if (argv.includes('--rerun') && !python) {
    out('--rerun needs --python <the sprite-gen venv python>');
    return 2;
  }
  const judge = flag('--judge');
  if (judge !== undefined && (!argv.includes('--rerun') || !existsSync(judge))) {
    out(`--judge needs --rerun and an existing script (${judge})`);
    return 2;
  }
  if (labelsFile !== undefined && !existsSync(labelsFile)) {
    out(`no labels file at ${labelsFile}`);
    return 2;
  }
  if (![queueSize, sample].every(n => Number.isInteger(n) && n >= 0)) {
    out('--queue and --sample take a whole number');
    return 2;
  }
  const { records, skipped } = readArchive(dir);
  const labels = labelsFile ? readLabels(readFileSync(labelsFile, 'utf8')) : Object.create(null);
  const ids = new Set(records.map(r => r.id)),
    labelled = Object.keys(labels).filter(id => ids.has(id)).length;
  const byMode = evaluateByMode(records, labels),
    queue = labelQueue(records, labels, { sample }).slice(0, queueSize);
  /** @type {any} */ const result = { lines: records.length, skipped, labelled, unmatchedLabels: Object.keys(labels).length - labelled, byMode, queue };
  if (argv.includes('--rerun') && python) {
    const again = rerun(records, dir, { python, ...(judge ? { motions: judge } : {}) });
    result.rerun = {
      lines: again.records.length,
      failed: again.failed,
      before: evaluateByMode(again.before, labels),
      after: evaluateByMode(again.records, labels),
    };
  }
  if (argv.includes('--json')) {
    out(JSON.stringify(result, null, 1));
    return 0;
  }
  out(
    `${records.length} lines (${skipped} unreadable skipped), ${labelled} labelled` +
      (result.unmatchedLabels ? ` (${result.unmatchedLabels} label ids not in this archive)` : ''),
  );
  out(render(byMode, '\nAs archived'));
  if (result.rerun) {
    const about = `${result.rerun.lines} lines with pictures, ${result.rerun.failed} gave no answer`;
    out(render(result.rerun.before, `\nThe same items as archived (${about})`));
    out(render(result.rerun.after, `\nThe same items judged again by this checkout's pixel judge (${about})`));
  }
  out('\nLabel first:');
  for (const q of queue) out(`  ${q.id}  ${q.mode} ${q.kind} ${q.check.padEnd(9)} pixels ${q.pixels}, codex ${q.codex ?? '—'} (${q.why})  ${q.item ?? ''}`);
  if (!queue.length) out('  nothing');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2));
