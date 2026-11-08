// @ts-check
// The judgment archive of a generation host (split out of generation-stages.mjs 2026-11-08, no change in what it does): the stages note
// every side and loop judgment here; scripts/judge-eval.mjs reads it. Node built-ins only, from the same flat bin folder as the stages.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, chmod, copyFile, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { known, LOOP_VISUAL, PIXEL_STATES, SIDE_CHECKS } from './generation-prompts.mjs';
/**
 * The judgment archive (2026-11-07): every side and loop judgment this host makes, one JSON line each in `<root>/judge-archive/
 * judgments-<YYYY-MM>.jsonl`, outside the job folders og prune removes, so the judges can be measured against each other and against
 * labels later (scripts/judge-eval.mjs). A line holds checks, numbers (the pixel judge's measures, the character's palette colours among
 * them), models and timings — no notes, prompt, brief or path, and no job id: `jobKey` groups one job's lines by a hash salted with a
 * file beside the archive folder (JUDGE_ARCHIVE_SALT), so a copy of the folder cannot be traced back to a job or its requester. Month
 * files go once their month ended JUDGE_ARCHIVE_DAYS ago (worker.env ODDBOUT_GENERATION_JUDGE_ARCHIVE: days 1-730, or `off` to write
 * none — nor run the shadow below). In codex mode the pixel judge runs beside codex (`shadow`: a motions.py call, about a second with
 * Python's start, never deciding), so every codex verdict has the pixels' answer to compare. The pictures the pixel judge read are copied
 * beside the line only when worker.env asks (ODDBOUT_GENERATION_JUDGE_IMAGES, days 1-365; none by default: the pictures come from the
 * requester's character), and go after those days or with their job's folder (og purge, og prune), whichever is first. A failed write
 * never changes a judgment.
 */
export const JUDGE_ARCHIVE_DIR = 'judge-archive';
export const JUDGE_ARCHIVE_SALT = 'judge-archive.salt';
export const JUDGE_ARCHIVE_VERSION = 2;
export const JUDGE_ARCHIVE_DAYS = 180;
/** Days the archive keeps its lines (worker.env ODDBOUT_GENERATION_JUDGE_ARCHIVE, 1-730; JUDGE_ARCHIVE_DAYS unset), or 0: `off`, none written.
 * @param {unknown} value */
export const judgeArchiveDays = value => {
  if (value === undefined || value === '') return JUDGE_ARCHIVE_DAYS;
  if (/^(off|0)$/i.test(String(value).trim())) return 0;
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 730 ? days : JUDGE_ARCHIVE_DAYS;
};
/** Days the archive keeps the pictures it copies (worker.env ODDBOUT_GENERATION_JUDGE_IMAGES, 1-365), or 0: none copied. @param {unknown} value */
export const judgeImageDays = value => {
  const days = Number(value ?? 0);
  return Number.isInteger(days) && days >= 1 && days <= 365 ? days : 0;
};
/** One job's key in the archive: its id hashed with the host's salt (16 hex), or null without either.
 * @param {string | null} salt @param {string | null | undefined} jobId */
export const archiveJobKey = (salt, jobId) => (salt && jobId ? createHash('sha256').update(`${salt}\n${jobId}`).digest('hex').slice(0, 16) : null);
/** A pixel judge's measures with every string dropped (its notes' numbers are all there; no text goes to the archive).
 * @param {unknown} value @returns {any} */
export const numbersOnly = value =>
  Array.isArray(value)
    ? value.map(numbersOnly).filter(v => v !== undefined)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .map(([k, v]) => [k, numbersOnly(v)])
            .filter(([, v]) => v !== undefined),
        )
      : (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean' || value === null
        ? value
        : undefined;
/** A verdict's checks of its kind (side: under `checks`; loop: at the top), each as it says (pass, fail or unknown), or null.
 * @param {string} kind @param {any} value */
export const verdictChecks = (kind, value) => {
  const keys = kind === 'side' ? SIDE_CHECKS : LOOP_VISUAL,
    checks = kind === 'side' ? value?.checks : value;
  return checks && typeof checks === 'object'
    ? Object.fromEntries(keys.filter(key => PIXEL_STATES.includes(checks[key])).map(key => [key, checks[key]]))
    : null;
};
/** @param {any} value */
const ms = value => (Number.isFinite(value) && value >= 0 ? Math.round(value) : null);
/** The checks of a part (side: flat in the entry, nested in a verdict), as verdictChecks reads them. @param {string} kind @param {any} checks */
const partChecks = (kind, checks) => verdictChecks(kind, kind === 'side' ? { checks } : checks);
/**
 * One archive line, every field checked (`at` a Date). `decidedBy` 'none' with `pixels.error`: the pixel judge gave no answer (the stage
 * tries the take again later; that judgment is a line of its own). `recovered`: a verdict made in an earlier run of the stage whose line
 * was never written (a stop between the verdict and the line), archived when the stage reuses it.
 * @param {{ id: string, at: Date, jobKey?: string | null, item?: string | null, kind: string, mode: string, decidedBy: string, final: any,
 *   pixels?: any, codex?: any, shadow?: boolean, recovered?: boolean, images?: string[] | null }} entry
 */
export function judgmentLine({
  id,
  at,
  jobKey = null,
  item,
  kind,
  mode,
  decidedBy,
  final,
  pixels = null,
  codex = null,
  shadow = false,
  recovered = false,
  images = null,
}) {
  return {
    v: JUDGE_ARCHIVE_VERSION,
    id,
    at: at.toISOString(),
    jobKey: typeof jobKey === 'string' && /^[0-9a-f]{16}$/.test(jobKey) ? jobKey : null,
    item: String(item ?? '').slice(0, 160) || null,
    kind,
    mode,
    decidedBy,
    final: partChecks(kind, final),
    // pixels.ms: the judge's own time (its measures); wallMs: the whole motions.py call, the interpreter's start and imports included —
    // what a judgment costs (in codex mode, what the shadow adds); null for an answer an earlier run left.
    pixels: !pixels
      ? null
      : pixels.error !== undefined
        ? { model: known(pixels.model), error: String(pixels.error).slice(0, 40), checks: null, wallMs: ms(pixels.wallMs) }
        : {
            model: known(pixels.model),
            observed: known(pixels.observed),
            checks: partChecks(kind, pixels.checks),
            measures: numbersOnly(pixels.measures ?? {}),
            ms: ms(pixels.ms),
            wallMs: ms(pixels.wallMs),
          },
    // codex.wallMs: the whole judge call, og's wait for a free codex slot included (walk and run are judged at once); null for a verdict
    // codex made in an earlier run of the stage and reused here (`reused`, its checks still the reference).
    codex: codex
      ? {
          checks: partChecks(kind, codex.checks),
          model: known(codex.model),
          effort: known(codex.effort),
          observed: known(codex.observed),
          wallMs: ms(codex.wallMs),
          ...(codex.reused ? { reused: true } : {}),
        }
      : null,
    ...(shadow ? { shadow: true } : {}),
    ...(recovered ? { recovered: true } : {}),
    ...(images?.length ? { images } : {}),
  };
}
/** A job folder's name as the archive keeps it beside a picture folder (`.job`): one plain path part, or null. @param {unknown} name */
const folderName = name => (typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(name) ? name : null);
/**
 * The archive in `dir` (`<root>/judge-archive`; its salt in `saltFile`, made on first use). `note(entry, files)` appends a judgmentLine —
 * `entry.jobId` becomes its jobKey — and, with `imageDays`, copies `files` (the pixel judge's pictures; a strip's .png beside its .json)
 * into `images/<day>/<id>/`, named `<index>-<basename>` so the pixel judge can read them again, with a `.job` file naming the job's folder
 * (`entry.jobFolder`) and the folder's time set to the line's. Pictures that cannot be copied leave none and the line goes in without them.
 * `prune({ jobGone })` removes each picture folder whose time is `imageDays` old (all of them at 0) or whose job folder is gone
 * (`jobGone(name)`), the emptied days, and each month file whose month ended `lineDays` ago; it resolves `{ pictures, lines }` removed. It
 * runs with the worker's daily prune (and at its start), so a picture goes within a day after its days are up or its job was purged.
 * @param {{ dir: string, saltFile?: string | null, lineDays?: number, imageDays?: number, now?: () => Date }} options
 */
export function createJudgeArchive({ dir, saltFile = null, lineDays = JUDGE_ARCHIVE_DAYS, imageDays = 0, now = () => new Date() }) {
  const day = (/** @type {Date} */ at) => at.toISOString().slice(0, 10);
  /** @type {string | null} */
  let salt = null;
  /** The host's salt: read, or made once (32 random bytes, owner-only). */
  async function saltOf() {
    if (salt || !saltFile) return salt;
    const read = (await readFile(saltFile, 'utf8').catch(() => '')).trim();
    if (/^[0-9a-f]{64}$/.test(read)) return (salt = read);
    const made = randomBytes(32).toString('hex');
    await writeFile(saltFile, `${made}\n`, { mode: 0o600, flag: 'wx' }).catch(() => {});
    const kept = (await readFile(saltFile, 'utf8').catch(() => '')).trim();
    return (salt = /^[0-9a-f]{64}$/.test(kept) ? kept : null);
  }
  /**
   * One picture copied, readable by the archive's group (0640, as its month files are): copyFile keeps the source's mode, and a matted take
   * is owner-only (0600), so an operator in the service group could read the lines but not the pictures they were copied for (2026-11-07).
   */
  const copyReadable = async (/** @type {string} */ from, /** @type {string} */ to) => {
    await copyFile(from, to);
    await chmod(to, 0o640);
  };
  /** The pictures copied into `into`, or null (none left behind) when any could not be.
   * @param {string} into @param {string[]} files @param {Date} at @param {string | null} jobFolder */
  async function copied(into, files, at, jobFolder) {
    try {
      await mkdir(into, { recursive: true });
      const images = [];
      for (const [index, file] of files.entries()) {
        const name = `${index}-${path.basename(file)}`;
        await copyReadable(file, path.join(into, name));
        images.push(name);
        const png = file.replace(/\.json$/, '.png');
        if (png !== file && existsSync(png)) await copyReadable(png, path.join(into, `${index}-${path.basename(png)}`));
      }
      if (folderName(jobFolder)) await writeFile(path.join(into, '.job'), `${jobFolder}\n`);
      await utimes(into, at, at);
      return images;
    } catch {
      await rm(into, { recursive: true, force: true }).catch(() => {});
      return null;
    }
  }
  return {
    /** @param {any} entry @param {string[]} [files] */
    async note({ jobId = null, jobFolder = null, ...entry }, files = []) {
      try {
        const at = now(),
          id = randomBytes(8).toString('hex'),
          jobKey = archiveJobKey(await saltOf(), jobId);
        const images = imageDays && files.length ? await copied(path.join(dir, 'images', day(at), id), files, at, jobFolder) : null;
        await mkdir(dir, { recursive: true });
        // One appendFile per line: a line is written whole or, on a crash, read back as a bad line and skipped (scripts/judge-eval.mjs).
        await appendFile(path.join(dir, `judgments-${day(at).slice(0, 7)}.jsonl`), JSON.stringify(judgmentLine({ ...entry, id, at, jobKey, images })) + '\n');
        return id;
      } catch {
        return null;
      }
    },
    /** @param {{ jobGone?: (name: string) => boolean }} [options] */
    async prune({ jobGone = () => false } = {}) {
      const nowMs = now().getTime(),
        cutoff = nowMs - imageDays * 86_400_000,
        folder = path.join(dir, 'images');
      let pictures = 0,
        lines = 0;
      for (const name of await readdir(folder).catch(() => [])) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;
        const days = path.join(folder, name);
        for (const id of await readdir(days).catch(() => [])) {
          const at = imageDays
            ? await stat(path.join(days, id)).then(
                s => s.mtimeMs,
                () => -Infinity,
              )
            : -Infinity;
          const job = folderName((await readFile(path.join(days, id, '.job'), 'utf8').catch(() => '')).trim());
          if (at <= cutoff || (job && jobGone(job))) {
            await rm(path.join(days, id), { recursive: true, force: true });
            pictures += 1;
          }
        }
        if (!(await readdir(days).catch(() => [])).length) await rm(days, { recursive: true, force: true });
      }
      // A month file goes once its month's last day is lineDays old (a line stays lineDays to lineDays + a month).
      for (const name of await readdir(dir).catch(() => [])) {
        const month = /^judgments-(\d{4})-(\d{2})\.jsonl$/.exec(name);
        if (month && Date.UTC(Number(month[1]), Number(month[2]), 1) + lineDays * 86_400_000 <= nowMs) {
          await rm(path.join(dir, name), { force: true });
          lines += 1;
        }
      }
      return { pictures, lines };
    },
  };
}
