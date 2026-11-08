// @ts-check
// 호스팅 생성 워커의 단계 (P1, 2026-10-27): what each stage of a hosted generation job does on the generation PC. Every provider call goes
// through `og run <job> -- …` (the pinned service accounts, the codex slots, the ledger); this file only builds the commands, reads their
// results and checks them. Node built-ins only: the service user's node runs it. The prompts, commands, schemas and checks it uses are in
// generation-prompts.mjs, the judgment archive in judge-archive.mjs (split 2026-11-08).
//
// brief: the request (words and the creator's pictures) → a safety verdict, the profile draft and an English look brief, by codex with
//   every tool turned off (the request is data; a model that could read files could put the service's logins into the profile).
// appearance: the look brief → two front-view candidates at once (선수 프로필 세트, 2026-10-31: sprite-gen `gen --direction front`, GPT
//   image, transparent, our plain cel colouring with the house style anchor as a reference), as WebP. The creator chooses the front: it is
//   his profile painting too. 맡기기 (a job its creator left to us): a look judge (codex, tools off) picks one, and the job goes on without him.
// motions (P2, 2026-10-28): first the side still (2026-10-31): the chosen front as the character reference → one side view facing right in
//   the same colouring, a judge comparing it with the front, at most SIDE_TAKES drawings, else an operator. Beside the motions, his expression
//   sheet (2026-11-03): six arena faces from the chosen front, one drawing, never a second; without it he still registers. Then the side still → six GPT
//   keypose rows (prepare → gen-set → extract, assembled by motions.py) and a Grok walk
//   and run (video-set → the engine's cut and cycle alignment, its retake reasons and a vision judge as the gate; a retake films from a relaxed,
//   depth-shaded still of the look, and one alignment runs at a time on the GPU; a run the gate refused is made from the walk that passed,
//   played faster, and its preview says so), the three at once, every
//   frame brought to the look's size (sprite-gen scale-check, measured by the head), packed with reviewPolicy engine-loop, one preview per clip. A creator's change to one clip remakes that clip only: an action clip's rows drawn
//   again with his words (its cells alone replace the first run's), a walk or run filmed again with them; idle is the look (an operator's).
//   A seventh, optional row (2026-10-28) draws the entrance and the victory beside the six; when it fails the fighter goes without them.
//   The action clips' previews go up as the rows finish (2026-10-30): gen-set's finished rows are extracted in a scratch run while it still draws the rest.
// submitting: the package the motions stage left in the job folder, with the profile the creator confirmed, submitted under his account;
//   before it, the chosen front (framed into a portrait card first when it is not one: Grok's are square) and its face square (measured here on
//   the uploaded WebP, `motions.py face-box`) and his expression sheet go to the job: the server
//   makes them his profile set when the package is registered.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, copyFile, cp, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASK_EXIT, NOT_STARTED_EXIT, judgeOutcome, readOutcome } from './sprite-outcome.mjs';
import {
  ALIGN_AGAIN,
  ALIGN_PAUSE_MS,
  appearanceCommand,
  appearancePrompt,
  ASKED,
  ASKS,
  beatLimit,
  BRIEF_SCHEMA,
  briefCommand,
  briefPrompt,
  characterPhrase,
  checkedBrief,
  checkedPixels,
  checkedVerdict,
  clipNotes,
  codexEntry,
  codexSessionId,
  createModelLog,
  CUT_TOOL_REFUSAL,
  cutFacts,
  EARLY_GRACE_MS,
  EARLY_POLL_MS,
  EVEN_BEAT,
  EXPRESSIONS_SIZE,
  expressionsCommand,
  expressionsName,
  expressionsPrompt,
  extOf,
  FRONT_CHECKS,
  FRONT_JUDGE_SCHEMA,
  frontCardName,
  frontJudgePrompt,
  frontVerdict,
  GAIT_FRAMES,
  GAIT_MOTION,
  GAIT_RETAKES,
  GAIT_STAGGER_MS,
  gaitChangeMotion,
  gaitEvent,
  gaitRanges,
  gaitStillCommand,
  gaitStillPrompt,
  GPT_IMAGE,
  GROK_DOWN,
  GROK_FRONT_RETAKES,
  GROK_LIMITED,
  hybridJudgeKey,
  imageEntry,
  imageFor,
  imageProviderArgs,
  JUDGE,
  JUDGE_KEY_VERSION,
  judgeCommand,
  judgeKey,
  judgeLabel,
  judgeRecord,
  judgesMode,
  LOOK_JUDGE_SCHEMA,
  lookJudgePrompt,
  lookNames,
  lookPick,
  LOOP_VISUAL,
  loopTaken,
  lowMarginFeet,
  MODELS,
  namedFeet,
  ONE_STRIDE_OF,
  PIXEL_JUDGE,
  pixelJudgeKey,
  PREVIEW_CLIPS,
  previewName,
  retakeReasons,
  reviewHash,
  RUN_FROM_WALK,
  RUN_FROM_WALK_FIRST,
  RUN_FROM_WALK_PACE,
  SCALE_ROUNDS,
  SCALE_WIDE,
  SIDE_CHECKS,
  SIDE_JUDGE_SCHEMA,
  SIDE_TAKES,
  sideCommand,
  sideJudgePrompt,
  sideLookNames,
  sideName,
  sidePassed,
  sidePrompt,
  sideStyleOnly,
  STYLE_ANCHOR_FILE,
  submissionOutcome,
  verdictKeyStatus,
  videoEntry,
  withProfile,
} from './generation-prompts.mjs';
import { verdictChecks } from './judge-archive.mjs';
// No OpenAI credentials or API calls on a generation host. Use its existing ODDBOUT worker identity.
/**
 * @typedef {import('./generation-prompts.mjs').Job} Job
 * @typedef {import('./generation-prompts.mjs').Api} Api
 * @typedef {import('./generation-prompts.mjs').Brief} Brief
 * @typedef {import('./generation-prompts.mjs').ImageProfile} ImageProfile
 * @typedef {import('./generation-prompts.mjs').Stop} Stop
 * @typedef {import('./generation-prompts.mjs').Ran} Ran
 */

// What a Windows virus scanner's brief hold on a just-written file makes a rename throw (as plugins/ai-fighter/local-files.mjs retries).
const SCANNER_HOLDS = ['EPERM', 'EACCES', 'EBUSY'];
/**
 * Writes a whole file or none: the bytes go to a temporary name beside it, synced, then renamed over it. A stage resumes from these files
 * (a picture that exists is not fetched again, `uploaded.json` means sent, `changes.json` holds every round's notes), so a crash or a
 * full disk mid-write must not leave a torn copy that a later run reads as done. The temporary file is removed when anything fails.
 * @param {string} file @param {string | Uint8Array} data
 * @param {{ move?: (from: string, to: string) => Promise<void>, platform?: string }} [options]  for tests
 */
export async function writeWhole(file, data, { move = rename, platform = process.platform } = {}) {
  const temp = `${file}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
  try {
    const handle = await open(temp, 'wx');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await move(temp, file);
        return;
      } catch (/** @type {any} */ error) {
        if (platform !== 'win32' || !SCANNER_HOLDS.includes(error.code) || attempt >= 6) throw error;
        await new Promise(done => setTimeout(done, 25 * (attempt + 1)));
      }
    }
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
/** @param {Job} job @param {Api} api */
export const serverReviewEnabled = (job, api) => job.decisionsReview?.mode === 'shadow' && typeof api.decisions === 'function';
/** What the server takes for one review image (api/decisions-review.mjs DECISIONS): its bytes and its longest side. */
export const EVIDENCE_LIMIT = Object.freeze({ bytes: 2 * 1024 * 1024, side: 2048 });
/** A PNG's width and height from its header, or null for anything else. @param {Buffer} bytes */
export function pngSize(bytes) {
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
/** A WebP's width and height from its header (VP8X, VP8 or VP8L, as api/image-probe.mjs reads them), or null for anything else. @param {Buffer} bytes */
export function webpSize(bytes) {
  if (bytes.length < 30 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') return null;
  const chunk = bytes.toString('latin1', 12, 16);
  if (chunk === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}
/** Whether an image is sent as it is: a PNG within both limits. Anything else (a reference JPEG or WebP, a large look) is fitted first. @param {Buffer} bytes */
export const fitsAsIs = bytes => {
  const size = pngSize(bytes);
  return bytes.length <= EVIDENCE_LIMIT.bytes && size !== null && Math.max(size.width, size.height) <= EVIDENCE_LIMIT.side;
};

/**
 * @param {{ api: Api, job: Job, dir: string, stage: string, scope: string, images: { file: string, role: string, durationMs?: number }[],
 *   fit?: ((from: string, to: string) => Promise<unknown>) | null }} options
 */
export async function reviewOnServer({ api, job, dir, stage, scope, images, fit }) {
  if (!serverReviewEnabled(job, api)) return null;
  let body, fingerprint, out;
  try {
    const encoded = [];
    for (const image of images) {
      let file = image.file,
        bytes = await readFile(file);
      // An image past the server's limits used to end the review as unverified; it is fitted (lossless) when the worker can.
      if (fit && !fitsAsIs(bytes)) {
        const fitted = path.join(dir, 'decisions', 'evidence', `${reviewHash(bytes).slice(0, 24)}.webp`);
        if (!existsSync(fitted)) {
          await mkdir(path.dirname(fitted), { recursive: true });
          await fit(file, fitted);
        }
        file = fitted;
        bytes = await readFile(file);
      }
      if (bytes.length > EVIDENCE_LIMIT.bytes) throw Error('evidence-limit');
      const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(file).toLowerCase()];
      if (!type) throw Error('evidence-type');
      encoded.push({
        role: image.role,
        sha256: reviewHash(bytes),
        dataUrl: `data:${type};base64,${bytes.toString('base64')}`,
        ...(image.durationMs === undefined ? {} : { durationMs: image.durationMs }),
      });
    }
    body = { stage, scope, images: encoded };
    const raw = JSON.stringify(body);
    if (Buffer.byteLength(raw) > 8 * 1024 * 1024) throw Error('evidence-limit');
    // Local fingerprints include server-owned design revisions too; server recomputes its own binding.
    fingerprint = reviewHash(
      JSON.stringify({ body, brief: job.brief, description: job.description, appearanceNote: job.appearanceNote ?? null, motionNote: job.motionNote ?? null }),
    );
    const folder = path.join(dir, 'decisions');
    await mkdir(folder, { recursive: true });
    out = path.join(folder, `${stage}-${scope}-${fingerprint}.json`);
    const record = { status: 'request_started', advisory: true, visualApproval: false, stage, scope, fingerprint };
    try {
      await writeFile(out, JSON.stringify(record) + '\n', { flag: 'wx' });
    } catch (/** @type {any} */ error) {
      if (error.code === 'EEXIST') return JSON.parse(await readFile(out, 'utf8'));
      throw error;
    }
    const reply = await api.decisions(job, body);
    // The server's daily or per-job review limit is not an outage: it is named, so the numbers can tell them apart.
    const report =
      reply.ok && reply.review
        ? reply.review
        : { ...record, status: 'unverified', errorCode: reply.code === 'review-limit' ? 'review-limit' : 'server-review-unavailable' };
    await writeWhole(out, JSON.stringify(report) + '\n');
    return report;
  } catch {
    // Advisory failure never retries generation or passes a failed existing gate. Unknown requests stay started on disk/server.
    return { status: 'unverified', advisory: true, visualApproval: false, stage, scope, errorCode: 'server-review-unavailable' };
  }
}

/**
 * A row the image model drew with a cell missing stops `sprite extract` (2026-10-30, the first free fighter's test: stance-a's cell 3 held
 * 10 pixels), and `gen-set` takes a finished row as it is, so an operator's retry met the same image and stopped again. Each row the failed
 * extract names (`extract-failure.json`, its errors `<state>: …`) is drawn once more and the run extracted again, at most EXTRACT_REDRAWS
 * times; an extract that names no row of the request, or still fails, goes to an operator as before (`rows-extract`).
 */
export const EXTRACT_REDRAWS = 2;
/** The request's rows a failed extract names, in its order, or none. @param {string} run @returns {Promise<string[]>} */
export async function extractFailedRows(run) {
  const read = async (/** @type {string} */ name) => JSON.parse(await readFile(path.join(run, name), 'utf8'));
  const [failure, request] = await Promise.all([read('extract-failure.json').catch(() => null), read('sprite-request.json').catch(() => null)]);
  const states = new Set(Object.keys(request?.states ?? {}));
  const named = (Array.isArray(failure?.errors) ? failure.errors : []).map((/** @type {unknown} */ error) => /^([^\s:]+):/.exec(String(error))?.[1]);
  return /** @type {string[]} */ ([...new Set(named.filter((/** @type {string | undefined} */ state) => state && states.has(state)))]);
}

/**
 * The stages, given the worker's tools: `og(args, { stdin })` runs `og run <job> -- …` in the kit and resolves `{ code }`; `api` is the
 * worker's API client; `fetchBytes(url)`; `toWebp(png, webp)` re-encodes a still (at most 1024 px); `motionsPy(args)` runs motions.py
 * on the kit's sprite-gen venv (pixels only, no provider) and resolves `{ code }`. Calls may overlap: `og` waits for a free codex slot.
 * `og(args, { capture: true })` also resolves the run's output (its start: codex exec's header names its session), and
 * `codexSession(id, sinceMs)` what codex recorded for that session ({ model, effort, cliVersion }), or null. `codexCwd`: the folder outside
 * the kit the brief and the judges run in (`briefCommand` `cwd`; the worker's `<root>/codex-cwd`), made before each run; null runs them in
 * og's folder, the kit, as before 2026-11-05 (and their verdicts' keys say so: `isolated` false). `judges`: who judges the side takes and
 * the walk and run loops (JUDGE_MODES), codex unless the worker says otherwise (judgesFor). `codex`: whether codex runs on this host (1.1,
 * 2026-11-06): on a SuperGrok-only PC it does not, and the look judge (맡기기) is not asked — the creator chooses his look, as when the judge
 * picks none. The worker then judges with pixels (judgesFor).
 * @typedef {{ verdict?: any, record?: any, status?: string, fresh?: boolean, code?: number, pixelCode?: number | string, by?: string,
 *   open?: string[] }} Judged  A judge's end: its verdict, or the exit (`code`, `pixelCode`) of the judge that gave none.
 * @typedef {Stop & { strip?: string, verdict?: string, take?: number | null, tried?: any[], note?: string,
 *   judged?: { status?: string, label: string } }} Loop  A walk or run: its strip and verdict, or why there is none.
 * @param {{ og: (args: string[], options?: { stdin?: string, capture?: boolean }) => Promise<Ran>, api: Api,
 *   fetchBytes: (url: string) => Promise<Uint8Array>, toWebp: (png: string, webp: string, size?: string) => Promise<unknown>,
 *   fitImage?: ((from: string, to: string) => Promise<unknown>) | null, motionsPy?: (args: string[]) => Promise<Ran>, gaitStaggerMs?: number,
 *   alignPauseMs?: number, earlyPollMs?: number, earlyGraceMs?: number, signal?: AbortSignal | null, lowMarginFeetTaken?: boolean,
 *   codexSession?: (id: string, sinceMs: number) => Promise<any>, codexCwd?: string | null, styleAnchor?: string, judges?: string,
 *   codex?: boolean, archive?: ReturnType<typeof import('./judge-archive.mjs').createJudgeArchive> | null }} tools
 */
export function createStages({
  og,
  api,
  fetchBytes,
  toWebp,
  fitImage,
  motionsPy = async () => ({ code: 127 }),
  gaitStaggerMs = GAIT_STAGGER_MS,
  alignPauseMs = ALIGN_PAUSE_MS,
  earlyPollMs = EARLY_POLL_MS,
  earlyGraceMs = EARLY_GRACE_MS,
  signal = null,
  lowMarginFeetTaken = true,
  codexSession = async () => null,
  codexCwd = null,
  styleAnchor = path.join(path.dirname(fileURLToPath(import.meta.url)), STYLE_ANCHOR_FILE),
  judges = 'codex',
  codex = true,
  archive = null,
}) {
  judges = judgesMode(judges);
  // The job the running stage works on and its folder (`observed`), for each archived judgment (createJudgeArchive; `archive` null keeps
  // none): the job id becomes the line's salted jobKey, and the folder's name goes beside its pictures so they leave with it.
  /** @type {Job} */
  let current = null;
  /** @type {string | null} */
  let currentFolder = null;
  // The models this stage run asked for and observed (`createModelLog`), sent as its `models` event when it ends (`observed`).
  let models = createModelLog();
  // The job's pictures (imageFor): set when each stage starts (`observed`), so one stages object serves any job.
  let image = GPT_IMAGE;
  /** An image run the provider refused here now (exit 75): codex's question (gpt), or Grok's account or allowance (grok). */
  /** @returns {Stop} */
  const imageDown = () => (image.provider === 'grok' ? GROK_DOWN : ASKED);
  /** The folder a codex text run starts in, there when it starts (a host's cleanup may have removed it). */
  const codexDir = async () => {
    if (codexCwd) await mkdir(codexCwd, { recursive: true });
    return codexCwd;
  };
  const isolated = Boolean(codexCwd);
  /** What codex recorded for the run whose output this is (`codexSessionId`, `codexSession`), or null: no session named. */
  const observeCodex = async (/** @type {unknown} */ output, /** @type {number} */ since) => {
    const session = codexSessionId(output);
    if (!session) return null;
    return { ...((await Promise.resolve(codexSession(session, since)).catch(() => null)) ?? {}), session };
  };
  // A report this run wrote (one kept from an earlier stage run made nothing now); mtime's coarse clocks get two seconds.
  const fresh = async (/** @type {string} */ file, /** @type {number} */ since) => {
    try {
      return (await stat(file)).mtimeMs >= since - 2000;
    } catch {
      return false;
    }
  };
  /** An image run's sprite-gen report, noted for the `models` event. @param {string} report @param {number} since */
  const noteImage = async (report, since) => {
    if (!(await fresh(report, since))) return;
    const read = await readFile(report, 'utf8').then(JSON.parse, () => null);
    if (read?.provider) models.note(imageEntry(read, image.model));
  };
  /** Every row gen-set drew in this run (its per-row reports are `gen` reports). @param {string} run @param {number} since */
  const noteRows = async (run, since) => {
    const folder = path.join(run, 'reports', 'gen-set');
    for (const name of (await readdir(folder).catch(() => [])).sort())
      if (name.endsWith('.json') && name !== 'set.report.json' && !name.endsWith('.attempt.json')) await noteImage(path.join(folder, name), since);
  };
  /** A clip video-set filmed in this run (its item's `clip.report.json`): the model xAI named, else unknown (`videoEntry`).
   * @param {string} item @param {number} since */
  const noteVideo = async (item, since) => {
    const report = path.join(item, 'clip.report.json');
    if (await fresh(report, since)) models.note(videoEntry(await readFile(report, 'utf8').then(JSON.parse, () => null)));
  };
  /** A stage's model observations go up as one event when it ends (a courtesy: one that fails never changes its outcome).
   * @param {string} name @param {(job: Job, dir: string) => Promise<any>} stage @returns {(job: Job, dir: string) => Promise<any>} */
  const observed = (name, stage) => async (job, dir) => {
    models = createModelLog();
    image = imageFor(job);
    current = job;
    currentFolder = path.basename(dir);
    try {
      return await stage(job, dir);
    } finally {
      const event = models.event(name);
      if (event) await Promise.resolve(api.progress?.(job, undefined, event)).catch(() => {});
    }
  };
  /**
   * One judge (JUDGE_CACHE_RULE). `parse` reads an answer (null: not a verdict). The verdict in `verdictFile` is reused whatever its key, with
   * its standing (`verdictKeyStatus`); else codex answers into `answerFile` (any earlier answer removed first, so it never speaks for this
   * run) and the verdict is written with its `judge` record. `cached: false` judges every time (the look judge keeps nothing). Resolves
   * `{ verdict, record, status }`, or `{ code }` when codex gave no verdict (its exit; 0 with an answer that is not one).
   * @param {{ verdictFile: string, answerFile: string, schemaFile: string, prompt: string, refs: string[], parse: (value: any) => any,
   *   cached?: boolean }} args
   * @returns {Promise<Judged>}
   */
  async function judge({ verdictFile, answerFile, schemaFile, prompt, refs, parse, cached = true }) {
    const schema = await readFile(schemaFile, 'utf8').catch(() => ''),
      key = judgeKey({ prompt, schema, isolated });
    if (cached) {
      const saved = await readFile(verdictFile, 'utf8').then(JSON.parse, () => null),
        verdict = parse(saved);
      if (verdict) return { verdict, record: saved, status: verdictKeyStatus(saved, key) };
    }
    await rm(answerFile, { force: true });
    const cwd = await codexDir(),
      since = Date.now();
    const { code, output } = await og(judgeCommand({ schema: schemaFile, out: answerFile, refs, cwd }), { stdin: prompt, capture: true });
    if (code !== 0) return { code };
    const facts = await observeCodex(output, since);
    models.note(codexEntry('judge', JUDGE.model, JUDGE.effort, facts));
    const answer = await readFile(answerFile, 'utf8').then(JSON.parse, () => null),
      verdict = parse(answer);
    if (!verdict) return { code: 0 };
    const record = { ...answer, judge: judgeRecord({ prompt, schema, facts, isolated }) };
    // Whole or not at all (writeWhole): a torn verdict would read as none and pay for the judge again.
    await writeWhole(verdictFile, JSON.stringify(record));
    return { verdict, record, status: 'keyed', fresh: true };
  }
  /** Who decided a verdict the job folder holds: its record's `judge.kind`, codex when it names none. @param {any} record */
  const decidedBy = record =>
    record?.judge?.kind === 'pixels' ? 'pixels' : record?.judge?.kind === 'hybrid' ? (record.judge.codex ? 'pixels+codex' : 'pixels') : 'codex';
  /**
   * One side or loop judgment as the judges mode makes it (JUDGE_MODES). codex: `judge` as before. pixels and hybrid: a verdict in
   * `verdictFile` is reused whatever made it (JUDGE_CACHE_RULE, its standing against this mode's key); else the pixel judge answers into
   * `pixelFile` (`pixelArgs`: its two pictures), and in hybrid mode with a check left open and none failed codex judges the same pictures as
   * in codex mode (`codex`: judge()'s arguments), its verdict kept in `codexFile` so a stage run again never pays for it twice. The verdict
   * written has the codex verdict's shape, every check pass or fail. Resolves like `judge`, with `by` (pixels, pixels+codex or codex) and
   * `open` (the checks the pixels left open), or `{ pixelCode }` when the pixel judge gave no answer.
   * @param {{ kind: string, item: string, verdictFile: string, pixelFile: string, pixelArgs: string[], codexFile: string,
   *   codex: { answerFile: string, schemaFile: string, prompt: string, refs: string[], parse: (value: any) => any } }} args
   * @returns {Promise<Judged>}
   */
  async function judged({ kind, item, verdictFile, pixelFile, pixelArgs, codexFile, codex }) {
    if (judges === 'codex') {
      const started = Date.now(),
        made = await judge({ verdictFile, ...codex });
      if (archive && made.fresh) {
        const took = Date.now() - started,
          shadow = await pixelsOn(kind, pixelArgs, pixelFile);
        await archived(
          verdictFile,
          {
            item,
            kind,
            mode: judges,
            decidedBy: 'codex',
            final: verdictChecks(kind, made.verdict),
            pixels: shadow,
            codex: codexPart(kind, made, took),
            shadow: true,
          },
          pixelArgs,
        );
      } else if (made.verdict) await recover({ kind, item, verdictFile, pixelFile, pixelArgs, codexFile, codex, kept: made.verdict, saved: made.record });
      return { ...made, by: decidedBy(made.record) };
    }
    const keys = kind === 'side' ? SIDE_CHECKS : LOOP_VISUAL;
    const schema = await readFile(codex.schemaFile, 'utf8').catch(() => '');
    const pixelKey = pixelJudgeKey(kind),
      key = judges === 'pixels' ? pixelKey : hybridJudgeKey(pixelKey, judgeKey({ prompt: codex.prompt, schema, isolated }));
    const saved = await readFile(verdictFile, 'utf8').then(JSON.parse, () => null),
      kept = codex.parse(saved);
    if (kept) {
      await recover({ kind, item, verdictFile, pixelFile, pixelArgs, codexFile, codex, kept, saved });
      return { verdict: kept, record: saved, status: verdictKeyStatus(saved, key), by: decidedBy(saved) };
    }
    await rm(pixelFile, { force: true });
    const pixelStarted = Date.now(),
      ran = await motionsPy(['pixel-judge', kind, ...pixelArgs, pixelFile]),
      pixelWall = Date.now() - pixelStarted;
    const raw = ran.code === 0 ? await readFile(pixelFile, 'utf8').then(JSON.parse, () => null) : null;
    const pixels = raw ? checkedPixels(kind, raw) : null;
    if (!pixels) {
      const pixelCode = ran.code === 0 ? 'invalid' : ran.code;
      // No answer: the stage tries the take again later. The line says so (no marker: the judgment it will make is a line of its own).
      await archive?.note({
        jobId: current?.id,
        jobFolder: currentFolder,
        item,
        kind,
        mode: judges,
        decidedBy: 'none',
        final: null,
        pixels: { model: PIXEL_JUDGE.model, error: pixelCode, wallMs: pixelWall },
      });
      return { pixelCode };
    }
    models.note({ role: 'pixel-judge', requested: PIXEL_JUDGE.model, observed: pixels.model });
    const open = keys.filter(check => pixels.checks[check] === 'unknown'),
      failed = keys.filter(check => pixels.checks[check] === 'fail');
    /** @type {{ judge: Record<string, any> } & Record<string, any>} */
    const record = {
      judge: { kind: judges, key, keyVersion: JUDGE_KEY_VERSION, pixels: { model: PIXEL_JUDGE.model, observed: pixels.model, checks: pixels.checks } },
    };
    let checks,
      notes,
      status = 'keyed',
      by = 'pixels',
      asked = null,
      took = 0;
    if (judges === 'pixels' || failed.length || !open.length) {
      checks = Object.fromEntries(keys.map(check => [check, pixels.checks[check] === 'fail' ? 'fail' : 'pass']));
      // An open check counts as a pass only in pixels mode (in hybrid a pixel fail ends the take whatever the open ones say): said first, never cut.
      const counted = judges === 'pixels' && open.length ? `Not judged by pixels, counted as pass: ${open.join(', ')}. ` : '';
      notes = clipNotes(`${counted}${pixels.notes}`);
      if (judges === 'pixels') record.judge.unknownAsPass = open;
    } else {
      const started = Date.now();
      asked = await judge({ verdictFile: codexFile, ...codex });
      took = Date.now() - started;
      if (!asked.verdict) return asked;
      const theirs = kind === 'side' ? (asked.verdict.checks ?? {}) : asked.verdict;
      // No pixel check failed here: a check fails when codex failed it, the pixels' passes included.
      checks = Object.fromEntries(keys.map(check => [check, theirs[check] === 'pass' ? 'pass' : 'fail']));
      notes = clipNotes(`${String(asked.verdict.notes ?? '').trim()} Pixels (left ${open.join(', ')} open): ${pixels.notes}`);
      record.judge.codex = asked.record?.judge ?? null;
      status = /** @type {string} */ (asked.status);
      by = 'pixels+codex';
    }
    record.judge.decidedBy = by;
    Object.assign(record, kind === 'side' ? { checks, notes } : { ...checks, notes });
    const verdict = codex.parse(record);
    if (!verdict) return { pixelCode: 'invalid' };
    await writeWhole(verdictFile, JSON.stringify(record));
    // A codex verdict an earlier run of this stage saved (it stopped before the verdict above was written) is reused: its checks still go in.
    await archived(
      verdictFile,
      {
        item,
        kind,
        mode: judges,
        decidedBy: by,
        final: checks,
        pixels: pixelPart(raw, pixels, pixelWall),
        codex: asked ? codexPart(kind, asked, asked.fresh ? took : null) : null,
      },
      pixelArgs,
    );
    return { verdict, record, status, by, open };
  }
  /** The marker beside a verdict whose line the archive holds (createJudgeArchive): in the job folder, so it leaves with the verdict. */
  const archivedMark = (/** @type {string} */ verdictFile) => `${verdictFile}.archived`;
  /** One judgment's line, then its marker, so a stage run again knows the line is there (and `recover` adds it when it is not).
   * @param {string} verdictFile @param {any} entry @param {string[]} files */
  async function archived(verdictFile, entry, files) {
    if (!archive) return;
    const id = await archive.note({ jobId: current?.id, jobFolder: currentFolder, ...entry }, files);
    if (id) await writeFile(archivedMark(verdictFile), `${id}\n`).catch(() => {});
  }
  /**
   * A verdict the stage reuses (JUDGE_CACHE_RULE) whose line was never written — the stage stopped between the verdict and the line, or the
   * verdict is older than the archive — archived from what the job folder holds: the mode that made it, its checks, the pixel answer beside
   * it and codex's verdict (codex mode: the verdict itself; hybrid: its saved codex verdict), every time unknown, marked `recovered`.
   * @param {{ kind: string, item: string, verdictFile: string, pixelFile: string, pixelArgs: string[], codexFile: string,
   *   codex: { parse: (value: any) => any }, kept: any, saved: any }} args
   */
  async function recover({ kind, item, verdictFile, pixelFile, pixelArgs, codexFile, codex, kept, saved }) {
    if (!archive || existsSync(archivedMark(verdictFile))) return;
    const mode = saved?.judge?.kind === 'pixels' || saved?.judge?.kind === 'hybrid' ? saved.judge.kind : 'codex';
    const raw = await readFile(pixelFile, 'utf8').then(JSON.parse, () => null),
      pixels = raw ? checkedPixels(kind, raw) : null;
    let codexVerdict = null;
    if (mode === 'codex') codexVerdict = codexPart(kind, { verdict: kept, record: saved }, null);
    else if (saved?.judge?.codex) {
      const theirs = await readFile(codexFile, 'utf8').then(JSON.parse, () => null),
        parsed = codex.parse(theirs);
      if (parsed) codexVerdict = codexPart(kind, { verdict: parsed, record: theirs }, null);
    }
    await archived(
      verdictFile,
      {
        item,
        kind,
        mode,
        decidedBy: decidedBy(saved),
        final: verdictChecks(kind, kept),
        pixels: pixels ? pixelPart(raw, pixels, null) : null,
        codex: codexVerdict,
        shadow: mode === 'codex' && Boolean(pixels),
        recovered: true,
      },
      pixelArgs,
    );
  }
  /** The archive's pixel part: the checked answer, its measures (numbers only), its own time and the whole call's.
   * @param {any} raw @param {any} pixels @param {number | null} wallMs */
  const pixelPart = (raw, pixels, wallMs) => ({
    model: PIXEL_JUDGE.model,
    observed: pixels.model,
    checks: pixels.checks,
    measures: raw?.measures,
    ms: raw?.measures?.ms,
    wallMs,
  });
  /** The archive's codex part: its checks, the model asked and observed, and the call's time (null: a verdict reused, not made now).
   * @param {string} kind @param {any} made @param {number | null} wallMs */
  const codexPart = (kind, made, wallMs) => ({
    checks: verdictChecks(kind, made.verdict),
    model: made.record?.judge?.model,
    effort: made.record?.judge?.effort,
    observed: made.record?.judge?.observed?.model,
    wallMs,
    reused: wallMs === null,
  });
  /** The pixel judge beside codex (codex mode, an archive kept): its answer for the archive, or its error. It never decides anything.
   * @param {string} kind @param {string[]} pixelArgs @param {string} pixelFile */
  async function pixelsOn(kind, pixelArgs, pixelFile) {
    const started = Date.now();
    try {
      await rm(pixelFile, { force: true });
      const ran = await motionsPy(['pixel-judge', kind, ...pixelArgs, pixelFile]),
        wallMs = Date.now() - started;
      if (ran.code !== 0) return { model: PIXEL_JUDGE.model, error: ran.code, wallMs };
      const raw = await readFile(pixelFile, 'utf8').then(JSON.parse, () => null),
        pixels = raw ? checkedPixels(kind, raw) : null;
      return pixels ? pixelPart(raw, pixels, wallMs) : { model: PIXEL_JUDGE.model, error: 'invalid', wallMs };
    } catch (/** @type {any} */ error) {
      return { model: PIXEL_JUDGE.model, error: error?.code ?? 'error', wallMs: Date.now() - started };
    }
  }
  /** A verdict the pixels had a hand in, as a `tried` entry or an event marks it: who decided, and the checks they left open.
   * @param {Judged} judgedNow @param {boolean} [withOpen] */
  const byMark = (judgedNow, withOpen = false) =>
    !judgedNow.by || judgedNow.by === 'codex' ? {} : { judgeBy: judgedNow.by, ...(withOpen && judgedNow.open?.length ? { open: judgedNow.open } : {}) };
  /** A reused verdict that is not the current judge's, as a `tried` entry or an event marks it. @param {Judged} judged */
  const keyMark = judged => (judged.status && judged.status !== 'keyed' ? { judgeKey: judged.status } : {});
  /** Any JSON object is a side or look verdict here: their checks are read where they are used (`sidePassed`, `lookPick`). @param {any} value */
  const anObject = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);
  // One loop alignment at a time on this worker: RIFE on the GPU takes about 4 GB, and a walk and a run aligning at once (or two jobs) ran
  // an 8 GB card out of memory (2026-10-28).
  /** @type {Promise<unknown>} */
  let aligning = Promise.resolve();
  // A low-margin cut goes to the judge only when the kit's loop review takes it too (`lowMarginFeetTaken`, the worker reads the kit tree):
  // an og self-update without `og setup` would otherwise judge a cut whose loop review then fails.
  const alternate = (/** @type {any} */ strip) => namedFeet(strip) || (lowMarginFeetTaken && lowMarginFeet(strip));
  /** @param {string[]} command @returns {Promise<Ran>} */
  const align = command => {
    const run = aligning.then(() => og(command));
    aligning = run.catch(() => {});
    return run;
  };
  // A wait ends early when the stage is stopped: the next run is refused then, and the stage ends at once instead of after the wait.
  /** @param {number} ms @returns {Promise<void>} */
  const pause = ms =>
    new Promise(done => {
      if (signal?.aborted) return done();
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', stop);
        done();
      }, ms);
      const stop = () => {
        clearTimeout(timer);
        done();
      };
      signal?.addEventListener('abort', stop, { once: true });
    });
  /**
   * A generating run that failed: tried again later only when its own report (written by this run, after `since`) says the
   * same command may succeed, or when og refused it before it started (exit 3 and no report). A run that ended without a
   * report any other way (killed, out of memory, a crash) may have sent a paid request, so it is never run again unseen. A
   * report that says the request's outcome cannot be told, names a video request xAI took (resume it, never film again),
   * asks the codex question, or names an error the same command will meet again goes to an operator too (host/README.md).
   * @param {string} prefix @param {number} code @param {string} report @param {number} since @param {string | null} [limited]
   * @returns {Promise<Stop>}
   */
  async function failedRun(prefix, code, report, since, limited = null) {
    const said = await readOutcome(report, { since });
    const verdict = judgeOutcome({ code, report: said });
    // `limited`: the code a run of a provider that answers 429 for its allowance returns instead of a plain retry (only when every error
    // said the same command may succeed, so a request the provider took, or any error read another way, still goes to an operator).
    if (limited && verdict.next === 'retry' && verdict.codes.includes('provider-rate-limited')) return { retry: limited };
    if (verdict.next === 'retry' || (!said && code === NOT_STARTED_EXIT)) return { retry: `${prefix}-exit-${code}` };
    // og's account refusal (75 and no report from this run) is the refused command's provider: grok's on a video run.
    if (verdict.next === 'answer') return limited && !said && code === ASK_EXIT ? { retry: limited } : ASKED;
    const review =
      { resume: `${prefix}-unfinished`, inspect: `${prefix}-outcome-unknown` }[verdict.next] ??
      (code === 3 ? `${prefix}-not-started` : `${prefix}-${verdict.codes[0] ?? `exit-${code}`}`);
    return { review, ...(verdict.requestIds.length ? { requestIds: verdict.requestIds } : {}) };
  }
  // Decisions screening only annotates (it never gates, selects or retries), so it runs beside the stage's own work instead of before
  // it. The stage waits for it only before it returns: the review route needs the stage's lease, which ends with the stage.
  /** @type {Promise<unknown>[]} */
  let screening = [];
  // A stopped stage (`signal`: its time limit, a cancelled job) asks the server for no more reviews.
  const screen = (/** @type {any} */ args) => {
    if (signal?.aborted) return;
    screening.push(
      Promise.resolve()
        .then(() => reviewOnServer({ api, fit: fitImage, ...args }))
        .catch(() => null),
    );
  };
  /** @param {(job: Job, dir: string) => Promise<any>} stage @returns {(job: Job, dir: string) => Promise<any>} */
  const screened = stage => async (job, dir) => {
    screening = [];
    try {
      return await stage(job, dir);
    } finally {
      await Promise.allSettled(screening);
      screening = [];
    }
  };
  const asOutcome = (/** @type {Stop} */ r) =>
    r.retry
      ? { outcome: 'retry', result: { code: r.retry } }
      : { outcome: 'review', result: { code: r.review, ...(r.requestIds ? { requestIds: r.requestIds } : {}) } };
  /** @param {Job} job @param {string} dir */
  async function brief(job, dir) {
    /** @type {string[]} */
    const refs = [];
    for (const [i, ref] of job.refs.entries()) {
      if (!ref.url) throw Object.assign(new Error('ref-unavailable'), { code: 'ref-unavailable' });
      const file = path.join(dir, 'refs', `ref-${i + 1}.${extOf(ref.contentType)}`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, await fetchBytes(ref.url));
      refs.push(file);
    }
    const schema = path.join(dir, 'brief-schema.json'),
      out = path.join(dir, 'brief.json');
    await writeFile(schema, JSON.stringify(BRIEF_SCHEMA));
    const cwd = await codexDir(),
      since = Date.now();
    const { code, output } = await og(briefCommand({ schema, out, refs, cwd }), { stdin: briefPrompt(job, refs.length), capture: true });
    // The brief names no effort (the host's codex config chooses): what its session recorded is noted beside the model asked for.
    if (code === 0) models.note(codexEntry('brief', MODELS.text, 'config', await observeCodex(output, since)));
    if (code === ASK_EXIT) return asOutcome(ASKED);
    if (code !== 0 || !existsSync(out)) return { outcome: 'retry', result: { code: `brief-exit-${code}` } };
    let parsed;
    try {
      parsed = checkedBrief(JSON.parse(await readFile(out, 'utf8')));
    } catch (/** @type {any} */ error) {
      return { outcome: error.code === 'brief-secret' ? 'review' : 'retry', result: { code: error.code ?? 'brief-invalid' } };
    }
    if (parsed.verdict === 'reject') return { outcome: 'rejected', result: { code: parsed.rejectCode } };
    return { outcome: 'ok', result: { brief: { profile: parsed.profile, look: parsed.look, motion: parsed.motion } } };
  }

  /** @param {Job} job @param {string} dir */
  async function appearance(job, dir) {
    const round = job.appearanceRound,
      names = lookNames(round),
      note = job.appearanceNote;
    /** @type {string[]} */
    const refs = [];
    for (const [i, ref] of job.refs.entries()) {
      const file = path.join(dir, 'refs', `ref-${i + 1}.${extOf(ref.contentType)}`);
      if (!existsSync(file)) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeWhole(file, await fetchBytes(ref.url));
      }
      refs.push(file);
    }
    // A revision starts from the look the creator saw first (candidate a of the round before).
    if (note && job.candidates[0]?.url) {
      const before = path.join(dir, 'looks', `previous-${round}.webp`);
      await mkdir(path.dirname(before), { recursive: true });
      await writeFile(before, await fetchBytes(job.candidates[0].url));
      refs.unshift(before);
    }
    // One prompt per take (`FRONT_TAKES`): the two candidates are two proposals.
    const promptOf = /** @param {'a' | 'b'} take */ take => path.join(dir, 'looks', `prompt-${round}-${take}.txt`);
    await mkdir(path.join(dir, 'looks'), { recursive: true });
    for (const take of /** @type {const} */ (['a', 'b'])) await writeFile(promptOf(take), appearancePrompt(job.brief, note, take, image));
    screen({ job, dir, stage: 'input', scope: 'design', images: refs.slice(0, 3).map(file => ({ file, role: 'reference' })) });
    // Both looks at once (one codex slot each; og waits for a free one, and the engine finds each run's picture by its own session).
    const since = Date.now();
    const made = await Promise.all(
      names.map(async (name, index) => {
        const png = path.join(dir, 'looks', `${name}.png`),
          report = path.join(dir, 'looks', `${name}.report.json`);
        // A look this round already made (the stage runs again because the other one failed) is kept: making it again pays twice.
        if (existsSync(png) && (await finishedLook(report))) return { name, png, report, code: 0 };
        const { code } = await og(appearanceCommand({ promptFile: promptOf(index === 0 ? 'a' : 'b'), out: png, report, refs, anchor: styleAnchor, image }));
        if (code === 0) await noteImage(report, since);
        return { name, png, report, code };
      }),
    );
    // Every failed look is read (2026-10-30): only the first was, so a look whose request may have been taken went out again when the
    // other one asked the codex question or may be retried. An operator's look wins, then the question, then a retry.
    const failed = made.filter(look => look.code !== 0 || !existsSync(look.png));
    if (failed.length) {
      const said = /** @type {Stop[]} */ (
        await Promise.all(
          failed.map(look =>
            look.code === 0 ? { review: 'look-no-output' } : look.code === 75 ? imageDown() : failedRun('look', look.code, look.report, since, image.limited),
          ),
        )
      );
      return asOutcome(said.find(r => r.review) ?? said.find(r => r.retry === ASKS || r.retry === GROK_LIMITED) ?? said[0]);
    }
    // Grok's fronts go through ODDBOUT's own front check before anyone sees them (2026-11-07): the one entry asks of his profile painting.
    if (image.provider === 'grok' && codex) await Promise.all(made.map((look, index) => frontChecked(job, dir, look, index === 0 ? 'a' : 'b', refs)));
    for (const [index, { name, png }] of made.entries()) {
      const webp = png.replace(/\.png$/, '.webp');
      await toWebp(png, webp);
      await api.artifact(job, name, await readFile(webp));
      screen({
        job,
        dir,
        stage: 'pose',
        scope: index === 0 ? 'look-a' : 'look-b',
        images: [...refs.slice(0, 3).map(file => ({ file, role: 'reference' })), { file: png, role: 'candidate', durationMs: 100 }],
      });
    }
    // 맡기기: the first round is ours to pick. Once the creator wrote a change, the look is his to choose.
    const choice = job.delegate && !note ? await pickLook(job, dir, made) : null;
    return { outcome: 'ok', result: { candidates: names, ...(choice ? { choice } : {}) } };
  }

  /**
   * ODDBOUT's front check on a Grok front candidate (2026-11-07, 깔깔이: two re-drawn fronts failed it as "slight three-quarter" views after he
   * was registered, when it was too late to pick another look): the check his profile painting must pass to enter (frontJudgePrompt, codex
   * with every tool off). A candidate it fails is drawn once more (GROK_FRONT_RETAKES) with GROK_FRONT_RETAKE, and that drawing becomes the
   * candidate when it passes. When neither passes, or the check or the drawing cannot be made, the first drawing stays: the creator still
   * chooses, and nothing stops the stage. Everything stays in `looks/<name>-front/`: a stage run again judges or draws only what is missing,
   * never a paid drawing twice. Each candidate's end goes up as a `front-check` event.
   * @param {Job} job @param {string} dir @param {{ name: string, png: string }} look @param {'a' | 'b'} take @param {string[]} refs
   */
  async function frontChecked(job, dir, look, take, refs) {
    const folder = path.join(dir, 'looks', `${look.name}-front`),
      done = path.join(folder, 'done.json');
    /** @param {Record<string, unknown>} event */
    const end = async event => {
      await writeWhole(done, JSON.stringify(event)).catch(() => {});
      await Promise.resolve(api.progress?.(job, undefined, { kind: 'front-check', look: look.name, ...event })).catch(() => {});
    };
    try {
      if (existsSync(done)) return;
      await mkdir(folder, { recursive: true });
      const schemaFile = path.join(folder, 'schema.json');
      await writeFile(schemaFile, JSON.stringify(FRONT_JUDGE_SCHEMA));
      const check = (/** @type {number} */ n, /** @type {string} */ png) =>
        judge({
          verdictFile: path.join(folder, `verdict-${n}.json`),
          answerFile: path.join(folder, `answer-${n}.json`),
          schemaFile,
          prompt: frontJudgePrompt(),
          refs: [png],
          parse: frontVerdict,
        });
      const failing = (/** @type {any} */ verdict) => FRONT_CHECKS.filter(name => verdict.checks[name] !== 'pass');
      const first = await check(0, look.png);
      if (!first.verdict) return await end({ outcome: 'unverified', code: `judge-exit-${first.code}` });
      const failed = failing(first.verdict);
      if (!failed.length) return await end({ outcome: 'pass' });
      const retake = path.join(folder, `retake-${GROK_FRONT_RETAKES}.png`),
        report = path.join(folder, `retake-${GROK_FRONT_RETAKES}.report.json`);
      if (!(existsSync(retake) && (await finishedLook(report)))) {
        // A retake that ran before and did not finish is never run again unseen (it may have been paid for): the first drawing stays.
        if (existsSync(report)) return await end({ outcome: 'fail', failed, retake: 'unfinished' });
        const promptFile = path.join(folder, `retake-${GROK_FRONT_RETAKES}.txt`);
        await writeFile(promptFile, appearancePrompt(job.brief, job.appearanceNote ?? null, take, image, true));
        const since = Date.now();
        const { code } = await og(appearanceCommand({ promptFile, out: retake, report, refs, anchor: styleAnchor, image }));
        if (code === 0) await noteImage(report, since);
        if (code !== 0 || !existsSync(retake)) return await end({ outcome: 'fail', failed, retake: `exit-${code}` });
      }
      const second = await check(GROK_FRONT_RETAKES, retake);
      if (!second.verdict || failing(second.verdict).length) return await end({ outcome: 'fail', failed, retake: second.verdict ? 'fail' : 'unverified' });
      // The first drawing is kept beside it (once: a stage run again after the copy never takes the retake for it).
      const first0 = path.join(folder, 'take-0.png');
      if (!existsSync(first0)) await copyFile(look.png, first0);
      await copyFile(retake, look.png);
      return await end({ outcome: 'retake-pass', failed });
    } catch (/** @type {any} */ error) {
      await end({ outcome: 'unverified', code: typeof error?.code === 'string' ? error.code : 'error' });
    }
  }

  /** Whether `gen` said it finished this look: its report's `ok`. A report that is missing or unreadable is not finished. @param {string} report */
  async function finishedLook(report) {
    try {
      return JSON.parse(await readFile(report, 'utf8')).ok === true;
    } catch {
      return false;
    }
  }

  /** 맡기기: the look judge's pick of the two candidates, or null when it picked none or could not answer (the creator is asked).
   * @param {Job} job @param {string} dir @param {{ png: string }[]} made */
  async function pickLook(job, dir, made) {
    if (!codex) return null;
    const folder = path.join(dir, 'looks', `judge-${job.appearanceRound}`);
    await mkdir(folder, { recursive: true });
    const schemaFile = path.join(folder, 'schema.json');
    await writeFile(schemaFile, JSON.stringify(LOOK_JUDGE_SCHEMA));
    // Judged every time the stage runs (it keeps nothing), its verdict written with its judge's record.
    const judged = await judge({
      verdictFile: path.join(folder, 'verdict.json'),
      answerFile: path.join(folder, 'answer.json'),
      schemaFile,
      prompt: lookJudgePrompt(job.brief),
      refs: [...made.map(look => look.png), styleAnchor],
      parse: anObject,
      cached: false,
    });
    return judged.verdict ? lookPick(judged.verdict) : null;
  }

  const sprite = (/** @type {string[]} */ ...args) => ['npm', 'run', 'sprite', '--', ...args];
  const readJson = async (/** @type {string} */ file) => JSON.parse(await readFile(file, 'utf8'));
  /** `sprite extract` on a run of rows, the rows it failed drawn again first (EXTRACT_REDRAWS): null when it passed, else the stage's end.
   * @param {string} run @param {string} concurrency @returns {Promise<Stop | null>} */
  async function extractRows(run, concurrency) {
    for (let redraws = 0; ; redraws += 1) {
      if ((await og(sprite('extract', '--run-dir', run))).code === 0) return null;
      const rows = redraws < EXTRACT_REDRAWS ? await extractFailedRows(run) : [];
      if (!rows.length) return { review: 'rows-extract' };
      const since = Date.now();
      const { code } = await og(
        sprite('gen-set', '--run-dir', run, '--states', rows.join(','), '--force', ...imageProviderArgs(image), '--concurrency', concurrency),
      );
      if (code === 75) return imageDown();
      if (code !== 0) return failedRun('rows', code, path.join(run, 'reports', 'gen-set', 'set.report.json'), since, image.limited);
      await noteRows(run, since);
    }
  }

  /**
   * The look the creator chose, as the appearance stage left it (or its uploaded WebP): `front` when it is a front candidate (2026-10-31),
   * false for a side look drawn before (that job's motions are made from it as they were). Null when it cannot be found.
   * @param {Job} job @param {string} dir @returns {Promise<{ file: string, front: boolean, name: string } | null>}
   */
  async function chosenLook(job, dir) {
    const index = job.choice === 'b' ? 1 : 0;
    for (const [names, front] of /** @type {[string[], boolean][]} */ ([
      [lookNames(job.appearanceRound), true],
      [sideLookNames(job.appearanceRound), false],
    ])) {
      const png = path.join(dir, 'looks', `${names[index]}.png`);
      if (existsSync(png)) return { file: png, front, name: names[index] };
    }
    const chosen = job.candidates.find((/** @type {any} */ c) => c.key === job.choice);
    if (!chosen?.url) return null;
    const known = typeof chosen.name === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/.test(chosen.name) ? chosen.name : null;
    const name = known ?? sideLookNames(job.appearanceRound)[index],
      front = name.startsWith('front-');
    const webp = path.join(dir, 'looks', `${name}.chosen.webp`);
    await mkdir(path.dirname(webp), { recursive: true });
    if (!existsSync(webp)) await writeWhole(webp, await fetchBytes(chosen.url));
    return { file: webp, front, name };
  }

  /**
   * The side still the motions are made from (2026-10-31): drawn from the chosen front, judged against it, at most SIDE_TAKES drawings. A
   * drawing and its verdict stay in the job folder (`looks/side-<round>-<choice>/take-<n>`): a stage run again judges or draws only what is
   * missing, never a paid drawing twice. The passing still goes up as an artifact and a `side` event for the creator.
   * @param {Job} job @param {string} dir @param {string} front @returns {Promise<Stop & { still?: string }>}
   */
  async function sideStill(job, dir, front) {
    const folder = path.join(dir, 'looks', sideName(job.appearanceRound, job.choice));
    await mkdir(folder, { recursive: true });
    const promptFile = path.join(folder, 'prompt.txt'),
      schema = path.join(folder, 'judge-schema.json');
    await writeFile(promptFile, sidePrompt(job.brief, image));
    await writeFile(schema, JSON.stringify(SIDE_JUDGE_SCHEMA));
    /** The first take that missed the colouring only (`sideStyleOnly`): the fighter goes on from it when no take passes all five.
     * @type {{ png: string, take: number } | null} */
    let styleOnly = null;
    for (let take = 0; take < SIDE_TAKES; take += 1) {
      const png = path.join(folder, `take-${take}.png`),
        report = path.join(folder, `take-${take}.report.json`),
        verdictFile = path.join(folder, `take-${take}.verdict.json`);
      if (!existsSync(png) || !(await finishedLook(report))) {
        const since = Date.now();
        const { code } = await og(sideCommand({ promptFile, out: png, report, front, anchor: styleAnchor, image }));
        if (code === 75) return imageDown();
        if (code !== 0) return failedRun('side', code, report, since, image.limited);
        if (!existsSync(png)) return { review: 'side-no-output' };
        await noteImage(report, since);
      }
      // A take's verdict is kept in the job folder (JUDGE_CACHE_RULE): a stage run again judges only a take it has none for.
      const judgedTake = await judged({
        kind: 'side',
        item: `${path.basename(folder)}/take-${take}`,
        verdictFile,
        pixelFile: path.join(folder, `take-${take}.pixels.json`),
        pixelArgs: [front, png],
        codexFile: path.join(folder, `take-${take}.codex-verdict.json`),
        codex: {
          answerFile: path.join(folder, `take-${take}.judge.json`),
          schemaFile: schema,
          prompt: sideJudgePrompt(job.brief),
          refs: [front, png, styleAnchor],
          parse: anObject,
        },
      });
      if (!judgedTake.verdict)
        return judgedTake.code === ASK_EXIT
          ? ASKED
          : {
              retry:
                judgedTake.pixelCode !== undefined
                  ? `side-pixel-judge-${judgedTake.pixelCode}`
                  : judgedTake.code
                    ? `side-judge-exit-${judgedTake.code}`
                    : 'side-judge-invalid',
            };
      const verdict = judgedTake.verdict,
        passed = sidePassed(verdict);
      await Promise.resolve(
        api.progress?.(job, undefined, {
          kind: 'side',
          take,
          outcome: passed ? 'pass' : 'fail',
          failed: SIDE_CHECKS.filter(check => verdict?.checks?.[check] !== 'pass'),
          ...keyMark(judgedTake),
          ...byMark(judgedTake, true),
        }),
      ).catch(() => {});
      if (!passed) {
        if (styleOnly === null && sideStyleOnly(verdict)) styleOnly = { png, take };
        continue;
      }
      return chooseSide(job, folder, png, take, false);
    }
    // A judge's strict eye on the colouring of an in-between drawing does not hold the fighter for an operator (2026-10-31): the front the
    // creator chose is his profile painting; this still only feeds the motions. The event says the colouring was let go.
    if (styleOnly) return chooseSide(job, folder, styleOnly.png, styleOnly.take, true);
    return { review: 'side-look' };
  }
  /** The side still chosen: uploaded for the creator's view (a courtesy — the motions go on without it) and named in a `side` event.
   * @param {Job} job @param {string} folder @param {string} png @param {number} take @param {boolean} styleWaived */
  async function chooseSide(job, folder, png, take, styleWaived) {
    const name = sideName(job.appearanceRound, job.choice),
      webp = path.join(folder, `${name}.webp`);
    try {
      if (!existsSync(webp)) await toWebp(png, webp);
      await api.artifact(job, name, await readFile(webp));
      await Promise.resolve(
        api.progress?.(job, undefined, { kind: 'side', artifact: name, outcome: 'chosen', take, ...(styleWaived ? { styleWaived: true } : {}) }),
      ).catch(() => {});
    } catch {
      /* the creator's view of it is a courtesy; the motions go on */
    }
    return { still: png };
  }

  /**
   * His expression sheet (2026-11-03): six arena faces drawn once from the chosen front, beside the motions. A drawing that was started and
   * did not finish is never drawn again (it may have been paid for): he then registers without a sheet, and the arena shows his face square
   * for every mood. The sheet goes up as an artifact (`expressionsName`) and an `expressions` event for the creator; `uploaded.json` tells
   * the submitting stage to send it with his front. Never throws: a sheet is a courtesy here.
   * @param {Job} job @param {string} dir @param {string} front
   */
  async function expressionSheet(job, dir, front) {
    const name = expressionsName(job.appearanceRound, job.choice),
      folder = path.join(dir, 'looks', name);
    const event = (/** @type {Record<string, unknown>} */ data) =>
      Promise.resolve(api.progress?.(job, undefined, { kind: 'expressions', ...data })).catch(() => {});
    const started = path.join(folder, 'started');
    try {
      await mkdir(folder, { recursive: true });
      const png = path.join(folder, 'sheet.png'),
        report = path.join(folder, 'sheet.report.json');
      const webp = path.join(folder, `${name}.webp`),
        uploaded = path.join(folder, 'uploaded.json');
      if (existsSync(uploaded)) return;
      if (!existsSync(png) || !(await finishedLook(report))) {
        if (existsSync(started)) return event({ outcome: 'failed', code: 'expressions-unfinished' });
        await writeFile(started, new Date().toISOString());
        const promptFile = path.join(folder, 'prompt.txt');
        await writeFile(promptFile, expressionsPrompt(job.brief, image));
        const since = Date.now();
        const { code } = await og(expressionsCommand({ promptFile, out: png, report, front, anchor: styleAnchor, image }));
        if (code === 0) await noteImage(report, since);
        // Nothing was sent (its own report says so, og found no slot, or the account's allowance stopped it before it ran: 75 and no report
        // of this run): a later run may draw it (리뷰 2026-11-03). Anything else may have been paid for and is never drawn again.
        const said = code === 0 ? null : await readOutcome(report, { since });
        if (code !== 0 && (judgeOutcome({ code, report: said }).charge === 'not-charged' || (code === ASK_EXIT && !said))) {
          await rm(started, { force: true });
          return event({ outcome: 'failed', code: `expressions-not-started-${code}` });
        }
        if (code !== 0 || !existsSync(png)) return event({ outcome: 'failed', code: `expressions-exit-${code}` });
      }
      // codex sizes the picture itself (`--aspect-ratio` reaches grok and openai only): a 3:2 sheet is fitted to the set's exact size, any
      // other shape goes without (no drawing again).
      const size = pngSize(await readFile(png));
      if (!size || Math.abs(size.width / size.height - EXPRESSIONS_SIZE.width / EXPRESSIONS_SIZE.height) > 0.01)
        return event({ outcome: 'failed', code: 'expressions-size' });
      if (!existsSync(webp)) await toWebp(png, webp, `${EXPRESSIONS_SIZE.width}x${EXPRESSIONS_SIZE.height}`);
      await api.artifact(job, name, await readFile(webp));
      await writeWhole(uploaded, JSON.stringify({ artifact: name }));
      await event({ outcome: 'chosen', artifact: name });
    } catch (/** @type {any} */ error) {
      // A stopped stage refuses the run before og starts it: nothing was sent.
      if (error?.code === 'stage-stopped') await rm(started, { force: true }).catch(() => {});
      await event({ outcome: 'failed', code: 'expressions-error' });
    }
  }

  /** One loop (walk or run) the engine cut without a retake reason and the judge passed, or the reason none was. */
  /** RUN_FROM_WALK: the walk's cut (before its alignment) aligned to the run's frames and judged as a run, or null. Its folder names the
   * walk's strip, so a walk made again makes the run again; a stage run again with the same walk reuses the alignment and the verdict.
   * @param {any} walkLoop  A walk that passed (its `strip`) @param {string} look @param {string} m @returns {Promise<Loop | null>} */
  async function runFromWalk(walkLoop, look, m) {
    // The walk's cut as the engine made it: its aligned folder less the alignment's suffix (`-16`, or at its own length `-own`, `-own1`).
    // Only `-16` was taken off (2026-10-30): at its own length the walk's aligned folder was copied, its judge's verdict with it, and the
    // run took the walk's verdict for its own — never judged as a run. The folder's name hashes the cut too, so a folder made so is not reused.
    const cut = path.dirname(walkLoop.strip).replace(/-(?:\d+|own1?)$/, '');
    const folder = path.join(m, `run-from-walk-${createHash('sha256').update(`${walkLoop.strip}\n${cut}`).digest('hex').slice(0, 8)}`);
    const strip = path.join(folder, path.basename(walkLoop.strip));
    // A walk that passed as one stride of a two-stride cut (`-own1`): the run takes that one stride out as well, or both strides were
    // squeezed into the run's 12 frames and played at twice its pace (2026-10-30 review).
    const oneStride = path.dirname(walkLoop.strip).endsWith('-own1');
    const kept = (await readJson(strip).catch(() => null))?.cycle_align;
    if (kept?.to !== GAIT_FRAMES.run || (oneStride && kept.cycles_given !== ONE_STRIDE_OF)) {
      await rm(folder, { recursive: true, force: true });
      await cp(cut, folder, { recursive: true });
      await rm(path.join(folder, 'judge'), { recursive: true, force: true }); // a verdict is the run's own, never one copied with the cut
      const args = [
        'video-cycle-align',
        '--loop-dir',
        folder,
        '--length',
        String(GAIT_FRAMES.run),
        '--view',
        'side@right',
        '--start-foot',
        'left',
        ...(oneStride ? ['--cycles', `${folder}=${ONE_STRIDE_OF}`] : []),
        ...beatLimit('run'),
      ];
      if ((await align(sprite(...args))).code !== 0) await align(sprite(...args, '--multi-cycle', 'warn'));
    }
    const meta = await readJson(strip).catch(() => null);
    if (!meta || meta.frames !== GAIT_FRAMES.run || retakeReasons(meta).length || !alternate(meta)) return null;
    const judgeDir = path.join(folder, 'judge');
    if ((await motionsPy(['judge-request', 'run', judgeDir])).code !== 0 || (await motionsPy(['sheet', strip, path.join(judgeDir, 'sheet.png')])).code !== 0)
      return null;
    const verdictFile = path.join(judgeDir, 'verdict.json');
    const judgedRun = await judged({
      kind: 'loop',
      item: `run-from-walk/${path.basename(folder)}`,
      verdictFile,
      pixelFile: path.join(judgeDir, 'pixels.json'),
      pixelArgs: [look, strip],
      codexFile: path.join(judgeDir, 'codex-verdict.json'),
      codex: {
        answerFile: path.join(judgeDir, 'answer.json'),
        schemaFile: path.join(judgeDir, 'judge-schema.json'),
        prompt: await readFile(path.join(judgeDir, 'judge-prompt.txt'), 'utf8'),
        refs: [look, path.join(judgeDir, 'sheet.png')],
        parse: checkedVerdict,
      },
    });
    return judgedRun.verdict && loopTaken(judgedRun.verdict, meta)
      ? { strip, verdict: verdictFile, note: RUN_FROM_WALK, judged: { status: judgedRun.status, label: judgeLabel(judgedRun.record, judgedRun.status) } }
      : null;
  }

  /** `change`: the creator's latest change to this gait ({ round, note }) — its takes film the change, quoted, and nothing else is tried.
   * `early()`: a loop to take instead of the retakes when the first take's beat broke (RUN_FROM_WALK_FIRST), or null. `range`: the server
   * takes this gait at its own frame count inside it (GAIT_OWN_FEATURE), or null for the standard GAIT_FRAMES. `showTake(take, strip)`:
   * told of each take's first cut before its alignment, and with no strip as soon as that take did not pass.
   * @param {string} gait @param {string} look @param {(take: number) => Promise<any>} stills @param {string} character @param {string} m
   * @param {{ round: number, note: string } | null} [change] @param {(() => Promise<Loop | null>) | null} [early]
   * @param {{ min: number, max: number } | null} [range] @param {((take: number, strip: string | null) => unknown) | null} [showTake]
   * @returns {Promise<Loop>} */
  async function gaitLoop(gait, look, stills, character, m, change = null, early = null, range = null, showTake = null) {
    /** @type {any[]} */
    const tried = [];
    for (let take = 0; take <= GAIT_RETAKES; take++) {
      // A retake films from the relaxed still and asks for an even beat. Its folder names its input (`-s<take>-<words' hash>`): a clip filmed
      // from other words or the look is never reused for it, and a stage run again with the same words reuses its clip.
      const words = (change ? gaitChangeMotion(gait, change.note, take) : GAIT_MOTION[gait][take]) + (take ? EVEN_BEAT : '');
      const base = change ? `video-${gait}-r${change.round}` : `video-${gait}`;
      const folder = take ? `${base}-s${take}-${createHash('sha256').update(words).digest('hex').slice(0, 8)}` : `${base}-0`;
      const clip = path.join(m, folder),
        item = path.join(clip, `side-${gait}`);
      const input = await stills(take);
      if (input.retry || input.review) return input;
      const motion = ['--motion', `${gait}=${words}`];
      // A finished clip is kept (no --force): a stage run again reuses it. `--anchor none` keeps video-set's own cut as it was before
      // sprite-gen's gait witness (2026-11-01), where a walk/run cut defaults to motion-auto — the cut cutsOf() makes only as a fallback.
      const since = Date.now();
      const { code } = await og(
        sprite(
          'video-set',
          '--base',
          `side@right=${input.still}`,
          '--facing',
          'right',
          '--states',
          gait,
          '--key',
          input.key,
          '--anchor',
          'none',
          '--out-dir',
          clip,
          '--character',
          character,
          '--concurrency',
          '1',
          '--model',
          MODELS.video,
          ...motion,
        ),
      );
      await noteVideo(item, since);
      // 75: sprite-gen's codex question (its report says so — codex is down) or og refusing grok's account (no report — grok is down).
      if (code === ASK_EXIT) return failedRun('video', code, path.join(clip, 'set.report.json'), since, GROK_LIMITED);
      // No clip at all (a limit, an outage): try the stage later rather than film again with other words, unless the set report
      // says a request xAI took is unfinished (resume it), its outcome cannot be told, or the same run would fail again.
      if (code !== 0 && !existsSync(path.join(item, 'frames', 'keyed')) && !existsSync(path.join(item, 'loop')))
        return failedRun('video', code, path.join(clip, 'set.report.json'), since, GROK_LIMITED);
      const keyed = path.join(item, 'frames', 'keyed'),
        auto = path.join(clip, 'cut-auto');
      const autoCut = async () => {
        if (!existsSync(keyed)) return null;
        if (!existsSync(path.join(auto, `side-${gait}.strip.json`))) {
          // A refusal an earlier cut wrote never speaks for this one: a cut that stops now (no report) must not read as refused.
          await rm(path.join(auto, `side-${gait}.loop.report.json`), { force: true });
          const fps = (await readJson(path.join(item, 'frames.report.json')).catch(() => ({}))).fps ?? 24;
          // In line with the alignments: the cut repairs a walk's or run's jumps with RIFE on the GPU too.
          await align(
            sprite(
              'video-loop',
              '--frames-dir',
              keyed,
              '--out-dir',
              auto,
              '--fps',
              String(fps),
              '--state',
              gait,
              '--anchor',
              'motion-auto',
              '--facing',
              'right',
              '--name',
              `side-${gait}`,
            ),
          );
        }
        return existsSync(path.join(auto, `side-${gait}.strip.json`)) ? auto : null;
      };
      // video-set's own cut comes first; the motion-auto cut of the same keyed frames is made only when there is no such cut or it
      // did not reach the judge (2026-11-01: it was made on every take, a full video-loop on the GPU, and read only when the first failed).
      let autoTried = false;
      const cutsOf = async () => {
        if (existsSync(path.join(item, 'loop', `side-${gait}.strip.json`))) return [path.join(item, 'loop')];
        autoTried = true;
        const cut = await autoCut();
        return cut ? [cut] : [];
      };
      let cuts = await cutsOf();
      const seen = tried.length;
      // A clip filmed (and paid for) of which no cut came (2026-10-30). The engine refused it — its report says why, no cycle in the frames:
      // another take films other words, as before. The engine stopped — no report (out of memory, a crash) or no frames: the same clip is
      // cut again ALIGN_AGAIN times, ALIGN_PAUSE_MS apart, then an operator. Filming another take there bought a second clip for one the
      // engine never read.
      for (let again = 0; !cuts.length; again++) {
        const refused = await readJson(path.join(auto, `side-${gait}.loop.report.json`)).catch(() => null);
        // A refusal that names this PC, not the clip (RIFE or img2webp missing, a WebP that failed its check): another take meets it too.
        if (refused?.status === 'failed' && CUT_TOOL_REFUSAL.test(String(refused.error ?? ''))) {
          tried.push({ take, cut: 'cut-auto', reasons: ['cut-tool'] });
          return { review: `${gait}-cut`, tried };
        }
        if (refused?.status === 'failed') {
          tried.push({ take, cut: 'cut-auto', reasons: ['not-cut'] });
          break;
        }
        if (again >= ALIGN_AGAIN || !existsSync(keyed)) return { review: `${gait}-cut`, tried };
        await pause(alignPauseMs);
        cuts = await cutsOf();
      }
      if (cuts.length) await showTake?.(take, path.join(cuts[0], `side-${gait}.strip.json`));
      for (let pass = 0; ; pass++) {
        let unaligned = 0;
        for (let next = 0; ; next++) {
          if (next === cuts.length) {
            if (autoTried) break;
            autoTried = true;
            const cut = await autoCut();
            if (!cut) {
              // Stopped with no word (out of memory right after the first cut's alignment stopped the same way, a crash): the next pass,
              // ALIGN_PAUSE_MS later, cuts it again, as it aligned the cut made before the alignments. Refused: the clip has no other cut.
              if (existsSync(keyed) && (await readJson(path.join(auto, `side-${gait}.loop.report.json`)).catch(() => null))?.status !== 'failed')
                autoTried = false;
              break;
            }
            cuts.push(cut);
          }
          const cut = cuts[next];
          // The contract's frame count, starting as a foot lands; a cut the engine reads as two cycles is aligned as it is (the judge sees it).
          // A cut aligned by an earlier run of this stage is kept (the cut never changes: its clip and frames are kept too).
          // At its own length (GAIT_OWN_FEATURE) the alignment only turns the cut to start as a foot lands: no --length, nothing resampled.
          let aligned = `${cut}-${range ? 'own' : GAIT_FRAMES[gait]}`,
            strip = path.join(aligned, `side-${gait}.strip.json`),
            cutName = path.basename(cut);
          const kept = (await readJson(strip).catch(() => null))?.cycle_align;
          if (!kept || (!range && kept.to !== GAIT_FRAMES[gait])) {
            await rm(aligned, { recursive: true, force: true });
            await cp(cut, aligned, { recursive: true });
            const args = [
              'video-cycle-align',
              '--loop-dir',
              aligned,
              ...(range ? [] : ['--length', String(GAIT_FRAMES[gait])]),
              '--view',
              'side@right',
              '--start-foot',
              'left',
              ...beatLimit(gait),
            ];
            if ((await align(sprite(...args))).code !== 0) await align(sprite(...args, '--multi-cycle', 'warn'));
          }
          let meta = await readJson(strip).catch(() => null);
          // No alignment at all (the engine stopped: out of memory, a crash) says nothing about the clip.
          if (meta && !meta.cycle_align) {
            unaligned += 1;
            tried.push({ take, cut: path.basename(cut), reasons: ['not-aligned'] });
            continue;
          }
          const refusals = (/** @type {any} */ meta) => {
            const reasons = meta ? retakeReasons(meta) : ['unreadable'];
            if (meta && (range ? meta.frames < range.min || meta.frames > range.max : meta.frames !== GAIT_FRAMES[gait])) reasons.push(`frames-${meta.frames}`);
            if (meta && !alternate(meta)) reasons.push('feet-unnamed');
            return reasons;
          };
          let reasons = refusals(meta);
          // ONE_STRIDE: a cut of two strides, over the range at its own length, is aligned again as the one stride it holds.
          const half = meta && range && meta.frames > range.max ? Math.round(meta.frames / ONE_STRIDE_OF) : 0;
          if (half >= (range?.min ?? Infinity) && half <= (range?.max ?? 0)) {
            tried.push({ take, cut: cutName, reasons, ...cutFacts(meta) });
            const one = `${cut}-own1`,
              oneStrip = path.join(one, `side-${gait}.strip.json`);
            if ((await readJson(oneStrip).catch(() => null))?.cycle_align?.cycles_given !== ONE_STRIDE_OF) {
              await rm(one, { recursive: true, force: true });
              await cp(cut, one, { recursive: true });
              await align(
                sprite(
                  'video-cycle-align',
                  '--loop-dir',
                  one,
                  '--cycles',
                  `${one}=${ONE_STRIDE_OF}`,
                  '--view',
                  'side@right',
                  '--start-foot',
                  'left',
                  ...beatLimit(gait),
                ),
              );
            }
            const taken = await readJson(oneStrip).catch(() => null);
            if (taken?.cycle_align) {
              aligned = one;
              strip = oneStrip;
              meta = taken;
              cutName = `${cutName}-one-stride`;
              reasons = refusals(taken);
            } else {
              tried.push({ take, cut: `${cutName}-one-stride`, reasons: ['not-aligned'] });
              continue;
            }
          }
          if (reasons.length) {
            tried.push({ take, cut: cutName, reasons, ...cutFacts(meta) });
            continue;
          }
          // The judge: codex with every tool off sees the look and the loop's frames.
          const judgeDir = path.join(aligned, 'judge');
          if (
            (await motionsPy(['judge-request', gait, judgeDir])).code !== 0 ||
            (await motionsPy(['sheet', strip, path.join(judgeDir, 'sheet.png')])).code !== 0
          )
            return { retry: 'judge-input' };
          const verdictFile = path.join(judgeDir, 'verdict.json');
          // A verdict an earlier run of this stage got on this cut is kept (JUDGE_CACHE_RULE: no second codex call for the same picture).
          const cutJudged = await judged({
            kind: 'loop',
            item: `${gait}/take-${take}/${cutName}`,
            verdictFile,
            pixelFile: path.join(judgeDir, 'pixels.json'),
            pixelArgs: [look, strip],
            codexFile: path.join(judgeDir, 'codex-verdict.json'),
            codex: {
              answerFile: path.join(judgeDir, 'answer.json'),
              schemaFile: path.join(judgeDir, 'judge-schema.json'),
              prompt: await readFile(path.join(judgeDir, 'judge-prompt.txt'), 'utf8'),
              refs: [look, path.join(judgeDir, 'sheet.png')],
              parse: checkedVerdict,
            },
          });
          const verdict = cutJudged.verdict;
          if (!verdict)
            return cutJudged.code === ASK_EXIT
              ? ASKED
              : { retry: cutJudged.pixelCode !== undefined ? `pixel-judge-${cutJudged.pixelCode}` : `judge-exit-${cutJudged.code}` };
          if (loopTaken(verdict, meta)) {
            tried.push({
              take,
              cut: cutName,
              passed: true,
              ...(verdict.loop === 'pass' ? {} : { loopBy: 'engine-seam' }),
              ...keyMark(cutJudged),
              ...byMark(cutJudged),
              ...cutFacts(meta),
            });
            return { strip, verdict: verdictFile, take, tried, judged: { status: cutJudged.status, label: judgeLabel(cutJudged.record, cutJudged.status) } };
          }
          tried.push({
            take,
            cut: cutName,
            judge: LOOP_VISUAL.filter(key => verdict[key] !== 'pass'),
            ...keyMark(cutJudged),
            ...byMark(cutJudged),
            ...cutFacts(meta),
          });
          break; // the judge saw this take: another cut of it would show the same motion
        }
        if (!cuts.length || unaligned < cuts.length) break;
        // Not one cut of this clip aligned. The engine stops when the GPU is out of memory (2026-10-28: every alignment of the 냥잽 cat's
        // first two stage runs, the clips sound), so the cuts are aligned once more after ALIGN_PAUSE_MS (no provider call); still none:
        // stop rather than film another take (the stopped stage keeps its clips for an operator's retry).
        if (pass >= ALIGN_AGAIN) return { review: `${gait}-align`, tried };
        await pause(alignPauseMs);
      }
      // This take did not pass: its preview says so now, not after the walk a run may wait for (below) or the last take's end.
      await showTake?.(take, null);
      // RUN_FROM_WALK_FIRST: the first take's beat broke and no judge saw it: another take films the same kind of cycle again.
      const first = tried.slice(seen);
      if (!take && early && !change && first.length && first.every(t => t.reasons) && first.some(t => t.reasons.includes('broken-beat'))) {
        const made = await early();
        if (made) return { ...made, tried };
      }
    }
    return { review: `${gait}-not-clean`, tried };
  }

  /** A creator's change to one action clip: its rows made again with the note (one prepare run per row and round), its cells to take.
   * @param {{ round: number, clip: string, note: string }} change @param {string} brief @param {string} look @param {string} m
   * @returns {Promise<Stop & { overrides?: any[] }>} */
  async function remadeRows(change, brief, look, m) {
    const planFile = path.join(m, `revise-r${change.round}.json`);
    const rowsOf = (await motionsPy(['revise-rows', change.clip, planFile])).code === 0 ? await readJson(planFile).catch(() => null) : null;
    if (!rowsOf) return { review: `revise-${change.clip}` };
    const overrides = [];
    for (const [row, cells] of Object.entries(rowsOf)) {
      const run = path.join(m, `rows-r${change.round}-${row}`);
      if (!existsSync(path.join(run, 'sprite-request.json'))) {
        const note = path.join(m, `note-r${change.round}.txt`),
          requestFile = path.join(m, `rows-request-r${change.round}-${row}.json`);
        await writeFile(note, change.note);
        if ((await motionsPy(['request', brief, requestFile, row, note])).code !== 0) return { retry: 'motion-request' };
        const { request, description } = await readJson(requestFile);
        await writeFile(`${requestFile}.prepare.json`, JSON.stringify(request));
        const { code } = await og(
          sprite(
            'prepare',
            '--out-dir',
            run,
            '--character-id',
            'fighter',
            '--base-image',
            look,
            '--description',
            description,
            '--request',
            `${requestFile}.prepare.json`,
          ),
        );
        if (code !== 0) return { retry: `prepare-exit-${code}` };
      }
      const since = Date.now();
      const { code } = await og(sprite('gen-set', '--run-dir', run, ...imageProviderArgs(image), '--concurrency', '1'));
      if (code === 75) return imageDown();
      if (code !== 0) return failedRun('rows', code, path.join(run, 'reports', 'gen-set', 'set.report.json'), since, image.limited);
      await noteRows(run, since);
      const extracted = await extractRows(run, '1');
      if (extracted) return extracted;
      overrides.push({ run, row, cells });
    }
    return { overrides };
  }

  /**
   * Every clip of the assembly measured against the look (idle) and fitted: `{ fit }` once no canvas had to grow (the request's
   * assets then carry `scale_check`), or `{ review }`. A frame scale-check left for an eye check takes a measured median (motions.py
   * scale_priors, scale_policy: its GPT row's measured median, else its clip's, else every action frame's); `fit.guessed` names them.
   * @param {string} asm
   */
  async function scaleChecked(asm) {
    const ids = /** @type {string[]} */ ((await readJson(path.join(asm, 'game-request.json'))).assets.map((/** @type {any} */ asset) => asset.id));
    const clip = (/** @type {string} */ id) => path.join(asm, 'clips', `${id}.json`),
      folder = path.join(asm, 'scale'),
      fitFile = path.join(folder, 'fit.json');
    /** @type {[string, string[], string[]][]} */
    const groups = [
      ['check', ids.filter(id => !SCALE_WIDE.includes(id)), []],
      ['check-wide', ids.filter(id => SCALE_WIDE.includes(id)), ['--angle', '90']],
    ];
    await mkdir(folder, { recursive: true });
    for (let round = 0; round < SCALE_ROUNDS; round++) {
      const reports = [];
      for (const [name, group, extra] of groups.filter(([, group]) => group.length)) {
        const out = path.join(folder, `${name}.json`);
        await rm(out, { force: true }); // an earlier round's report must never stand in for this one
        const { code } = await og(
          sprite(
            'scale-check',
            '--reference',
            clip('idle'),
            ...group.flatMap(id => ['--asset', clip(id)]),
            ...extra,
            '--out',
            out,
            '--board',
            path.join(folder, `${name}.png`),
          ),
        );
        // 1 with a report: measured, some frames left for an eye check (the policy takes them); anything else: the engine refused.
        if (![0, 1].includes(code) || !existsSync(out)) return { review: 'scale-check' };
        reports.push(out);
      }
      if ((await motionsPy(['scale-fit', asm, fitFile, ...reports])).code !== 0) return { review: 'scale-fit' };
      const fit = await readJson(fitFile);
      if (!Object.keys(fit.grown).length) return { fit };
    }
    return { review: 'scale-fit' };
  }

  /** @param {Job} job @param {string} dir */
  async function motions(job, dir) {
    const m = path.join(dir, 'motion'),
      rows = path.join(m, 'rows'),
      asm = path.join(m, 'assembled'),
      showRows = path.join(m, 'show-rows');
    await mkdir(m, { recursive: true });
    const chosen = await chosenLook(job, dir);
    if (!chosen || !job.brief?.look) return { outcome: 'review', result: { code: 'look-missing' } };
    // A front (2026-10-31) is the profile painting: the motions are made from the side still drawn from it.
    const side = chosen.front ? await sideStill(job, dir, chosen.file) : { still: chosen.file };
    if (!side.still) return asOutcome(side);
    // His expression sheet is drawn beside the motions; the stage waits for it before it ends (`screened`), whatever its outcome.
    if (chosen.front) screening.push(expressionSheet(job, dir, chosen.file));
    const look = side.still;
    const brief = path.join(m, 'brief.json');
    await writeFile(brief, JSON.stringify({ language: job.language, ...job.brief }));
    // The creator's changes, every round kept (a later change never undoes an earlier one): this round's is added once.
    const changesFile = path.join(m, 'changes.json');
    // None yet is a first round. One that cannot be read is an operator's to look at: reading it as none would rewrite it with this
    // round's note alone, and the motions made again would drop every earlier round's change.
    const changes = existsSync(changesFile) ? await readJson(changesFile).catch(() => null) : [];
    if (!Array.isArray(changes)) return { outcome: 'review', result: { code: 'motion-changes-unreadable' } };
    if (job.motionNote && !changes.some(c => c.round === job.motionRound)) {
      const { clip, note } = job.motionNote;
      // idle is the look itself: a change to it is a new look (the appearance stage), not a motion.
      if (clip === 'idle' || typeof note !== 'string' || !note.trim()) return { outcome: 'review', result: { code: 'motion-revision-idle' } };
      changes.push({ round: job.motionRound, clip, note: note.trim() });
      await writeWhole(changesFile, JSON.stringify(changes));
    }
    const report = (/** @type {number} */ progress) => Promise.resolve(api.progress?.(job, progress)).catch(() => {});
    // Previews as the branches pass (2026-10-28): the creator watches the action clips while the walk and run still film (the stage
    // took about 20 minutes). Each goes up as an artifact and the list as a progress event; the package's previews replace them at the end.
    // A preview is a courtesy: one that fails never stops the stage.
    /** @type {{ clip: string, name: string, state?: string }[]} */
    const drafted = [],
      draftDir = path.join(m, `drafts-${job.motionRound}`);
    // The list goes up as a `drafts` event; the API shows the one with the highest `seq` (a send that timed out here and landed late never
    // wins over a later list), and `seq` grows across this stage's runs (the clock). Sends go one after another, each with the list as it
    // stands when it leaves; a list still waiting takes every change made before it leaves (one send, not one per change).
    let sending = Promise.resolve(),
      waiting = null,
      seq = 0;
    const postDrafts = () =>
      (waiting ??= sending =
        sending
          .then(() => {
            waiting = null;
            seq = Math.max(seq + 1, Date.now());
            return api.progress?.(job, undefined, { kind: 'drafts', seq, clips: drafted.map(d => ({ ...d })) });
          })
          .catch(() => {}));
    /** `<clip>.webp`, or a gait's take `<gait>-t<take>.webp` shown before its gate with a state ('checking', then 'retaking' — the API's
     * DRAFT_STATES): a name of its own (a new take is a new picture). The clip's entry is replaced where it stands (the page keeps its order).
     * @param {string[]} files @param {string | null} [state] */
    async function draft(files, state = null) {
      try {
        for (const file of files) {
          const shown = path.basename(file, '.webp'),
            clip = shown.replace(/-t\d+$/, ''),
            name = `draft-${shown.toLowerCase()}-${job.motionRound}`;
          await api.artifact(job, name, await readFile(file));
          const entry = { clip, name, ...(state ? { state } : {}) },
            at = drafted.findIndex(d => d.clip === clip);
          if (at < 0) drafted.push(entry);
          else drafted[at] = entry;
        }
        if (files.length) await postDrafts();
      } catch {
        /* the stage goes on */
      }
    }
    /** A gait's take its gate refused (nothing uploaded): marked `retaking` while another take films or the walk may make the run, or, with
     * `drop`, taken off — nothing will replace it (the stage stops for an operator or to try again). A passed picture is never touched.
     * @param {string} clip @param {boolean} [drop] */
    async function unshown(clip, drop = false) {
      const at = drafted.findIndex(d => d.clip === clip);
      if (at < 0 || !drafted[at].state || (!drop && drafted[at].state === 'retaking')) return;
      if (drop) drafted.splice(at, 1);
      else drafted[at] = { ...drafted[at], state: 'retaking' };
      await postDrafts();
    }
    /**
     * 1a. Drafts while gen-set draws the rows (2026-10-30; EARLY_POLL_MS). The finished rows are extracted in a scratch run (`rows-early`: the
     * rows' own run is gen-set's until it ends), and `motions.py early-drafts` makes the clips whose cells all lie in them as `assemble` will (the
     * same scale, canvas and beats): a combo waits for both its rows. A step that fails ends the watching (the normal path does it all again
     * after gen-set; a row the scratch extract refused is the rows' extract's to redraw), the cause kept in `early-drafts.log`. Never a stop.
     * `stop()` after gen-set: `{ taken, uploaded }` (the raw image of each row drawn from, the clips that went up), or null when a step was still
     * running past EARLY_GRACE_MS (nothing then is taken as already drafted).
     */
    function earlyDrafts() {
      const scratch = path.join(m, 'rows-early'),
        out = path.join(m, `drafts-early-${job.motionRound}`),
        note = path.join(m, 'early-drafts.log');
      const taken = new Map(),
        tried = new Set(),
        uploaded = new Set();
      let ending = false,
        wake = () => {};
      const nap = () =>
        /** @type {Promise<void>} */ (
          new Promise(done => {
            const timer = setTimeout(done, earlyPollMs);
            wake = () => {
              clearTimeout(timer);
              done();
            };
          })
        );
      const log = (/** @type {string} */ text) => appendFile(note, `${new Date().toISOString()} ${text}\n`).catch(() => {});
      /** A row is drawn when gen-set's report of it (written last, removed when the row fails) names its provider and says it did not fail. */
      const finished = async (/** @type {string} */ state) => {
        try {
          const report = await readJson(path.join(rows, 'reports', 'gen-set', `${state}.json`));
          return Boolean(report?.provider) && report.ok !== false && existsSync(path.join(rows, 'raw', `${state}.png`));
        } catch {
          return false;
        }
      };
      /** `sprite extract` in the scratch run on these rows; a batch it refused is tried row by row (one bad row costs only itself).
       * @param {string[]} fresh */
      async function extract(fresh) {
        const run = (/** @type {string[]} */ states) => og(sprite('extract', '--run-dir', scratch, '--states', states.join(',')));
        if ((await run(fresh)).code === 0) return fresh;
        /** @type {string[]} */
        const passed = [];
        for (const state of fresh.length > 1 ? fresh : []) if ((await run([state])).code === 0) passed.push(state);
        await log(`extract refused ${fresh.filter(state => !passed.includes(state)).join(',')}`);
        return passed;
      }
      const watching = (async () => {
        try {
          const states = Object.keys((await readJson(path.join(rows, 'sprite-request.json'))).states ?? {});
          await rm(scratch, { recursive: true, force: true });
          await rm(out, { recursive: true, force: true });
          while (!ending) {
            await nap();
            if (ending) break;
            const drawn = [];
            for (const state of states) if (await finished(state)) drawn.push(state);
            const fresh = drawn.filter(state => !tried.has(state));
            // All six drawn: gen-set ends in a moment and the normal path drafts them all.
            if (!fresh.length || drawn.length === states.length) continue;
            await mkdir(path.join(scratch, 'raw'), { recursive: true });
            await copyFile(path.join(rows, 'sprite-request.json'), path.join(scratch, 'sprite-request.json'));
            const hashes = new Map();
            for (const state of fresh) {
              await copyFile(path.join(rows, 'raw', `${state}.png`), path.join(scratch, 'raw', `${state}.png`));
              hashes.set(state, reviewHash(await readFile(path.join(scratch, 'raw', `${state}.png`))));
              tried.add(state);
            }
            for (const state of await extract(fresh)) taken.set(state, hashes.get(state));
            if (ending || !taken.size) continue;
            if ((await motionsPy(['early-drafts', scratch, look, out])).code !== 0) {
              await log('early-drafts failed');
              break;
            }
            const files = (await readdir(out).catch(() => [])).filter(f => f.endsWith('.webp') && !uploaded.has(path.basename(f, '.webp')));
            await draft(files.map(f => path.join(out, f)));
            for (const f of files) if (drafted.some(d => d.clip === path.basename(f, '.webp'))) uploaded.add(path.basename(f, '.webp'));
          }
        } catch (/** @type {any} */ error) {
          await log(`stopped: ${error?.message ?? error}`);
        }
      })();
      return {
        async stop() {
          ending = true;
          wake();
          let timer;
          const late = new Promise(done => {
            timer = setTimeout(() => done(false), earlyGraceMs);
          });
          const ended = await Promise.race([watching.then(() => true), late]);
          clearTimeout(timer);
          if (!ended) {
            await log('still running when gen-set ended: nothing is taken as drafted');
            return null;
          }
          return { taken, uploaded };
        },
      };
    }
    /**
     * The clips the early drafts may stand for (2026-10-30): none when a creator's change remade cells, or a row's image is not the one the
     * early drafts were drawn from (a row drawn again by the extract's redraw); else every clip that went up early, which the final drafts skip.
     * @param {{ taken: Map<string, string>, uploaded: Set<string> } | null} early @param {any[]} overrides
     */
    async function draftedEarly(early, overrides) {
      if (!early || overrides.length) return [];
      try {
        for (const [state, hash] of early.taken) if (reviewHash(await readFile(path.join(rows, 'raw', `${state}.png`))) !== hash) return [];
        return [...early.uploaded];
      } catch {
        return [];
      }
    }
    /**
     * 1b. The show row (2026-10-28): the optional entrance and victory, one GPT row of its own drawn beside the six (one image at a time).
     * Never a stop — a show row that fails leaves the fighter without those clips. Drawn once: a stage tried again keeps its cells.
     * A run whose request may have been taken (its outcome unknown, stopped after it left: what failedRun gives an operator) is left out
     * for good (`show-left-out.json`, 2026-10-30): gen-set removes a failed row, so the next stage run sent it again unseen.
     */
    const showLeftOut = path.join(m, 'show-left-out.json');
    async function showRow() {
      try {
        if (existsSync(showLeftOut)) return null;
        if (!existsSync(path.join(showRows, 'sprite-request.json'))) {
          const requestFile = path.join(m, 'show-request.json');
          if ((await motionsPy(['request-show', brief, requestFile])).code !== 0) return null;
          const { request, description } = await readJson(requestFile);
          await writeFile(path.join(m, 'show-prepare-request.json'), JSON.stringify(request));
          if (
            (
              await og(
                sprite(
                  'prepare',
                  '--out-dir',
                  showRows,
                  '--character-id',
                  'fighter',
                  '--base-image',
                  look,
                  '--description',
                  description,
                  '--request',
                  path.join(m, 'show-prepare-request.json'),
                ),
              )
            ).code !== 0
          )
            return null;
        }
        if (!existsSync(path.join(showRows, 'frames', 'frames-manifest.json'))) {
          const since = Date.now();
          const { code } = await og(sprite('gen-set', '--run-dir', showRows, ...imageProviderArgs(image), '--concurrency', '1'));
          if (code !== 0) {
            const setReport = path.join(showRows, 'reports', 'gen-set', 'set.report.json');
            const said = code === 75 ? imageDown() : await failedRun('show', code, setReport, since, image.limited);
            // Left out only when a request may have left: a run refused before any (a preflight) is tried again on the next stage run.
            const { charge } = judgeOutcome({ code, report: await readOutcome(setReport, { since }) });
            if (said.review && charge !== 'not-charged') await writeWhole(showLeftOut, JSON.stringify(said) + '\n');
            return null;
          }
          await noteRows(showRows, since);
          if ((await og(sprite('extract', '--run-dir', showRows))).code !== 0) return null;
        }
        return showRows;
      } catch {
        return null;
      }
    }
    /** 1. The six keypose rows (GPT), extracted and assembled at one scale (with the show row's, if drawn): `{}`, or `{ retry }`·`{ review }`.
     * @returns {Promise<Stop>} */
    async function actionRows() {
      // The show row draws meanwhile; the branch waits for it either way (no folder left being written).
      const showing = showRow();
      try {
        return await keyposeRows(showing);
      } finally {
        await showing;
      }
    }
    /** @param {Promise<string | null>} showing @returns {Promise<Stop>} */
    async function keyposeRows(showing) {
      if (!existsSync(path.join(rows, 'sprite-request.json'))) {
        const requestFile = path.join(m, 'rows-request.json');
        if ((await motionsPy(['request', brief, requestFile])).code !== 0) return { retry: 'motion-request' };
        const { request, description } = await readJson(requestFile);
        await writeFile(path.join(m, 'prepare-request.json'), JSON.stringify(request));
        const { code } = await og(
          sprite(
            'prepare',
            '--out-dir',
            rows,
            '--character-id',
            'fighter',
            '--base-image',
            look,
            '--description',
            description,
            '--request',
            path.join(m, 'prepare-request.json'),
          ),
        );
        if (code !== 0) return { retry: `prepare-exit-${code}` };
      }
      const since = Date.now();
      const watching = earlyDrafts();
      let genSet,
        early = null;
      try {
        genSet = await og(sprite('gen-set', '--run-dir', rows, ...imageProviderArgs(image), '--concurrency', '2'));
      } finally {
        early = await watching.stop();
      }
      const { code } = genSet;
      if (code === 75) return imageDown();
      if (code !== 0) return failedRun('rows', code, path.join(rows, 'reports', 'gen-set', 'set.report.json'), since, image.limited);
      await noteRows(rows, since);
      const extracted = await extractRows(rows, '2');
      if (extracted) return extracted;
      // The creator's changes to action clips, in order: each remade row's named cells replace the first run's.
      const overrides = [];
      for (const change of changes.filter((/** @type {any} */ c) => !GAIT_FRAMES[c.clip])) {
        const made = await remadeRows(change, brief, look, m);
        if (made.retry || made.review) return made;
        overrides.push(.../** @type {any[]} */ (made.overrides));
      }
      const overridesFile = path.join(m, 'overrides.json');
      await writeFile(overridesFile, JSON.stringify(overrides));
      await rm(asm, { recursive: true, force: true });
      const show = await showing;
      if ((await motionsPy(['assemble', rows, look, asm, overridesFile, show ?? ''])).code !== 0) return { review: 'rows-assemble' };
      // The clips already drafted early are not made again (their cells are the assembly's: the same bytes); without them, all of them are.
      const skip = await draftedEarly(early, overrides);
      // Its own folder (the gaits' previews are written into `draftDir` meanwhile), emptied: a retried stage's old previews are not the skipped ones.
      const rowsDrafts = path.join(m, `drafts-rows-${job.motionRound}`);
      await rm(rowsDrafts, { recursive: true, force: true });
      if ((await motionsPy(['drafts', asm, rowsDrafts, ...(skip.length ? [skip.join(',')] : [])])).code === 0)
        await draft((await readdir(rowsDrafts).catch(() => [])).filter(f => f.endsWith('.webp')).map(f => path.join(rowsDrafts, f)));
      return {};
    }
    // 2. Walk and run (Grok): a clean cut the judge passed, or an operator. Both film from one still.
    const still = path.join(m, 'video-still.png'),
      character = characterPhrase(job.brief);
    const stillReady = (async () => {
      if ((await motionsPy(['video-still', look, still])).code !== 0) return { retry: 'video-still' };
      return readJson(still.replace(/\.png$/, '.json')).catch(() => ({ key: 'magenta' }));
    })();
    // Awaited only later: a stage stopped meanwhile rejects it first, and an unhandled rejection would end the worker's process.
    stillReady.catch(() => {});
    // The retakes' relaxed still: drawn once for the walk and the run, kept for a stage run again.
    const relaxed = path.join(m, 'gait-still.png'),
      relaxedLook = path.join(m, 'gait-still-look.png');
    let relaxedReady = null;
    const relaxedStill = () =>
      (relaxedReady ??= (async () => {
        if (!existsSync(relaxedLook)) {
          const promptFile = path.join(m, 'gait-still-prompt.txt');
          await writeFile(promptFile, gaitStillPrompt(job.brief, image));
          const since = Date.now(),
            report = path.join(m, 'gait-still-look.report.json');
          const { code } = await og(gaitStillCommand({ promptFile, out: relaxedLook, report, look, image }));
          if (code === 75) return imageDown();
          if (code !== 0) return failedRun('gait-still', code, report, since, image.limited);
          // gen said it finished and its picture is not there: a paid image may be somewhere — an operator looks, nothing is sent again.
          if (!existsSync(relaxedLook)) return { review: 'gait-still-no-output' };
          await noteImage(report, since);
        }
        if ((await motionsPy(['video-still', relaxedLook, relaxed])).code !== 0) return { retry: 'gait-still' };
        const { key } = await readJson(relaxed.replace(/\.png$/, '.json')).catch(() => ({ key: 'magenta' }));
        return { still: relaxed, key };
      })());
    const stills = async (/** @type {number} */ take) => {
      if (take) return relaxedStill();
      const input = await stillReady;
      return input.retry ? input : { still, key: input.key };
    };
    const ranges = await gaitRanges(api);
    // A run the gate refused (or could not align or cut) is made from the walk when the walk passes. Never for a creator who asked for the run
    // again (2026-10-30): the walk's run ignores his words, and when it had been his run already (RUN_FROM_WALK, the same walk) he got back
    // the very clip he asked to change. His takes passed or an operator looks.
    const runChanged = changes.some(c => c.clip === 'run');
    const runFallback = (/** @type {any} */ review) => !runChanged && ['run-not-clean', 'run-align', 'run-cut'].includes(review);
    /** @param {'walk' | 'run'} gait @param {number} delayMs @param {(() => Promise<Loop | null>) | null} [early] @returns {() => Promise<Loop>} */
    const gaitBranch =
      (gait, delayMs, early = null) =>
      async () => {
        const input = await stillReady;
        if (input.retry) return input;
        if (delayMs) await pause(delayMs);
        const loop = await gaitLoop(
          gait,
          look,
          stills,
          character,
          m,
          changes.filter(c => c.clip === gait).at(-1) ?? null,
          early,
          ranges?.[gait] ?? null,
          showTake(gait),
        );
        await shownTakes[gait];
        if (loop.strip && !loop.retry && !loop.review) await gaitDraft(gait, loop.strip);
        // Not passed: a run the walk may still make keeps its refused take marked; any other comes off.
        else await unshown(gait, !(gait === 'run' && runFallback(loop.review)));
        await Promise.resolve(api.progress?.(job, undefined, gaitEvent(gait, loop))).catch(() => {});
        return loop;
      };
    const gaitDraft = async (/** @type {string} */ gait, /** @type {string} */ strip) => {
      const file = path.join(draftDir, `${gait}.webp`);
      await mkdir(draftDir, { recursive: true });
      if ((await motionsPy(['strip-preview', strip, file])).code === 0) await draft([file]);
    };
    // A gait's take as soon as it is cut (2026-11-01): the creator sees the walk and the run a minute after they film, while the alignment
    // and the judge (minutes on the GPU) still run. The take that passes replaces it (gaitDraft); one refused is marked at once. A gait's
    // previews go up on its own chain, which the filming never waits for (a slow API must not hold the alignment); its branch waits for the
    // chain before the passed take's preview, so the order holds.
    const shownTakes = { walk: Promise.resolve(), run: Promise.resolve() };
    /** @param {'walk' | 'run'} gait @returns {(take: number, strip: string | null) => void} */
    const showTake = gait => (take, strip) => {
      shownTakes[gait] = shownTakes[gait]
        .then(async () => {
          if (!strip) return unshown(gait);
          const file = path.join(draftDir, `${gait}-t${take}.webp`);
          await mkdir(draftDir, { recursive: true });
          if ((await motionsPy(['strip-preview', strip, file])).code === 0) await draft([file], 'checking');
        })
        .catch(() => {
          /* a preview never stops the stage */
        });
    };
    // The rows, the walk and the run need nothing of each other, so they run at once (2026-10-28 — one after another the stage took
    // about 8 to 15 minutes). The run films a few seconds after the walk (the xAI quota counts starts per second). The stage waits for
    // every branch before it answers, so a stage tried again never finds a branch still writing its folders; an operator's look wins
    // over another try.
    await report(5);
    let ended = 0;
    /** @param {() => Promise<Loop>} branch @returns {Promise<Loop>} */
    const settle = branch =>
      branch()
        .catch((/** @type {any} */ error) => ({ retry: String(error.code ?? 'stage-error').slice(0, 60) }))
        .finally(() => report(5 + 20 * ++ended));
    const walking = settle(gaitBranch('walk', 0));
    // RUN_FROM_WALK_FIRST: a run whose first take's beat broke waits for the walk, and takes the run made from it before any retake.
    const fromWalk = RUN_FROM_WALK_FIRST
      ? async () => {
          const walked = await walking;
          return walked.strip && !walked.retry && !walked.review ? runFromWalk(walked, look, m) : null;
        }
      : null;
    const [actions, walk, filmed] = await Promise.all([settle(actionRows), walking, settle(gaitBranch('run', gaitStaggerMs, fromWalk))]);
    // A run the gate refused (or could not align or cut) while the walk passed: the walk makes it (RUN_FROM_WALK, runFallback); otherwise the
    // stage stops as before.
    let run = filmed;
    if (runFallback(filmed.review) && walk.strip && !actions.review && !actions.retry) {
      const made = await runFromWalk(walk, look, m);
      if (made) {
        run = made;
        await gaitDraft('run', /** @type {string} */ (made.strip));
        await Promise.resolve(api.progress?.(job, undefined, gaitEvent('run', { ...made, tried: filmed.tried }))).catch(() => {});
      }
    }
    const branches = [actions, walk, run],
      stopped = branches.find(b => b.review) ?? branches.find(b => b.retry);
    if (stopped)
      return stopped.review
        ? { outcome: 'review', result: { code: stopped.review, ...(stopped.requestIds ? { requestIds: stopped.requestIds } : {}) } }
        : { outcome: 'retry', result: { code: stopped.retry } };
    /** @type {Record<string, Loop>} */
    const loops = { walk, run };
    for (const gait of ['walk', 'run']) {
      const pace = loops[gait].note === RUN_FROM_WALK ? [String(RUN_FROM_WALK_PACE)] : [];
      if ((await motionsPy(['add-gait', asm, gait, /** @type {string} */ (loops[gait].strip), ...pace])).code !== 0)
        return { outcome: 'review', result: { code: `${gait}-add` } };
    }
    // 3. Every frame at the look's size, the game pack, the loop reviews bound to its (corrected) frames, the package, the previews.
    await report(80);
    const scaled = await scaleChecked(asm);
    if (scaled.review) return { outcome: 'review', result: { code: scaled.review } };
    // The frames the policy guessed are kept where an operator reads them (the job's events; the motions result keeps only its preview).
    const scaleCheck = {
      corrected: scaled.fit.corrected,
      frames: scaled.fit.frames,
      guessed: scaled.fit.guessed.slice(0, 60),
      ...(scaled.fit.guessed.length > 60 ? { more: scaled.fit.guessed.length - 60 } : {}),
    };
    await Promise.resolve(api.progress?.(job, undefined, { kind: 'scale-check', ...scaleCheck })).catch(() => {});
    if ((await og(sprite('game-pack', '--request', path.join(asm, 'game-request.json'), '--out-dir', path.join(asm, 'pack')))).code !== 0)
      return { outcome: 'review', result: { code: 'game-pack' } };
    const strideFile = path.join(asm, 'walk-stride.json');
    if ((await motionsPy(['stride', path.join(asm, 'pack', 'game-pack.json'), path.join(asm, 'walk-strikes.json'), strideFile])).code !== 0)
      return { outcome: 'review', result: { code: 'walk-stride' } };
    const { stridePixels } = await readJson(strideFile);
    if (!(stridePixels > 0)) return { outcome: 'review', result: { code: 'walk-stride' } };
    for (const gait of ['walk', 'run']) {
      const folder = path.join(asm, 'loop', gait),
        config = path.join(folder, 'config.json');
      await mkdir(folder, { recursive: true });
      // Who judged, as the verdict records it (never the model asked for now: a kept verdict may be an earlier judge's — JUDGE_CACHE_RULE).
      const judged = loops[gait].judged ?? { status: 'unkeyed', label: judgeLabel(null, 'unkeyed') };
      await writeFile(
        config,
        JSON.stringify({
          motion: gait,
          source: { file: path.join(asm, 'pack', 'game-pack.json'), animation: gait },
          strip: loops[gait].strip,
          verdict: loops[gait].verdict,
          judge: `${judged.label}${loops[gait].note === RUN_FROM_WALK ? "; the run is the walk's cut aligned to its frames" : ''}`,
          judgeKey: judged.status,
          ...(gait === 'walk' ? { stridePixels } : {}),
        }),
      );
      if ((await og(['npm', 'run', 'fighter:gait', '--', 'loop-review', config, path.join(folder, 'review.json')])).code !== 0)
        return { outcome: 'review', result: { code: `${gait}-loop-review` } };
      if (serverReviewEnabled(job, api)) {
        // Review final game-pack frames at their actual durations, after all existing gait gates passed.
        // This comparison cannot select a version, retry generation, or waive a gate.
        try {
          const evidenceDir = path.join(asm, 'decisions-evidence', gait);
          const made = await motionsPy(['decision-frames', path.join(asm, 'pack', 'game-pack.json'), gait, evidenceDir]);
          if (made.code !== 0) throw Error('evidence-unavailable');
          const durations = await readJson(path.join(evidenceDir, 'durations.json'));
          screen({
            job,
            dir,
            stage: 'sequence',
            scope: gait,
            images: [
              { file: path.join(evidenceDir, 'identity.png'), role: 'reference' },
              ...durations.map((/** @type {number} */ durationMs, /** @type {number} */ i) => ({
                file: path.join(evidenceDir, `frame-${i}.png`),
                role: 'candidate',
                durationMs,
              })),
            ],
          });
        } catch {
          await Promise.resolve(api.progress?.(job, undefined, { kind: 'decisions-review', scope: gait, status: 'unverified' })).catch(() => {});
        }
      }
    }
    const pkg = path.join(dir, 'package');
    await rm(pkg, { recursive: true, force: true });
    if ((await motionsPy(['pack-plan', asm, brief, `gen-${job.id.slice(0, 8)}`, path.relative(asm, pkg)])).code !== 0)
      return { outcome: 'review', result: { code: 'pack-plan' } };
    if ((await og(['npm', 'run', 'fighter:pack', '--', path.join(asm, 'pack-plan.json')])).code !== 0 || !existsSync(path.join(pkg, 'fighter.json')))
      return { outcome: 'review', result: { code: 'pack' } };
    const previews = path.join(m, `preview-${job.motionRound}`);
    if ((await motionsPy(['preview', pkg, previews])).code !== 0) return { outcome: 'review', result: { code: 'preview' } };
    const preview = [];
    for (const clip of PREVIEW_CLIPS) {
      const file = path.join(previews, `${clip}.webp`);
      if (!existsSync(file)) return { outcome: 'review', result: { code: `preview-${clip}` } };
      const name = previewName(clip, job.motionRound);
      await api.artifact(job, name, await readFile(file));
      preview.push({ clip, name, ...(clip === 'run' && run.note ? { note: run.note } : {}) });
    }
    return { outcome: 'ok', result: { preview, scaleCheck } };
  }

  /**
   * His profile set (선수 프로필 세트, 2026-10-31): the chosen front and its face square, measured on its pixels (`motions.py face-box`), and
   * his expression sheet when the motions stage made one (2026-11-03), go to the job before the package does, so the server has them when the
   * validator registers him and makes them his set. A front that cannot be measured or that the server refuses leaves him without a set (his
   * owner can upload one); it never stops his registration.
   * @param {Job} job @param {string} dir
   */
  async function profileFront(job, dir) {
    // Every way he goes without a set is said in a `profile-front` event (2026-11-07, 깔깔이: a square front was refused and only the bare
    // code `invalid-profile-set` said so): what happened (`outcome`), its code and the server's own error codes. The job's read shows the
    // last one (api/generations.mjs `profileFront`), its next says it, and the operator's detail lists it.
    /** @param {string} outcome @param {string | number | null} [code] @param {Record<string, unknown>} [extra] */
    const said = (outcome, code = null, extra = {}) =>
      Promise.resolve(
        api.progress?.(job, undefined, { kind: 'profile-front', outcome, ...(code === null ? {} : { code: String(code).slice(0, 60) }), ...extra }),
      ).catch(() => {});
    try {
      const chosen = await chosenLook(job, dir);
      if (!chosen?.front || typeof api.profileFront !== 'function') return;
      // Measured on the WebP the server holds (the artifact the appearance stage made and uploaded, its long side 1024), never on the PNG it
      // was made from: the square goes into that WebP's set as it is (2026-11-03, 레온: measured on the 1024 × 1536 PNG it lay 1.5 times
      // too far right and too large, and the validator refused his set — FACE_OUTSIDE_FIGURE). A new name: a square measured before is not reused.
      const webp = chosen.file.endsWith('.webp') ? chosen.file : chosen.file.replace(/\.png$/, '.webp');
      if (!existsSync(webp)) await toWebp(chosen.file, webp);
      let artifact = chosen.name,
        posted = webp,
        framed = false;
      // A front that is not a portrait (Grok's are square since 2026-11-07, #362) is framed into the card the set takes (`frame-front`, the
      // kit's own framing: uniform scale and transparent room, never redrawn) and goes up as an artifact of its own, `<front>-card`; the
      // face square is measured on that card. The server refused the square as it was (FRONT_ORIENTATION) and he went without a set.
      const size = webpSize(await readFile(webp));
      if (size && size.height <= size.width) {
        artifact = frontCardName(chosen.name);
        posted = path.join(dir, 'looks', `${artifact}.webp`);
        if (!existsSync(posted)) {
          const card = path.join(dir, 'looks', `${artifact}.png`);
          const made = await motionsPy(['frame-front', chosen.file, card]);
          if (made.code !== 0 || !existsSync(card)) {
            await said('unframed', `frame-front-exit-${made.code}`, { width: size.width, height: size.height });
            return;
          }
          await toWebp(card, posted);
        }
        // Sent each time (the server keeps the last): a stage run again finds it there.
        await api.artifact(job, artifact, await readFile(posted));
        framed = true;
      }
      const out = path.join(dir, 'looks', `${artifact}.artifact.face.json`);
      if (!existsSync(out)) {
        const measured = await motionsPy(['face-box', posted, out]);
        if (measured.code !== 0) {
          await said('unmeasured', `face-box-exit-${measured.code}`);
          return;
        }
      }
      const sheet = await readJson(path.join(dir, 'looks', expressionsName(job.appearanceRound, job.choice), 'uploaded.json')).catch(() => null);
      const front = { artifact, face: await readJson(out) };
      let reply = await api.profileFront(job, { ...front, ...(typeof sheet?.artifact === 'string' ? { expressions: sheet.artifact } : {}) });
      // An API from before the sheet refuses the field (`invalid-body`): the front goes alone (리뷰 2026-11-03, a host updated first).
      if (!reply?.ok && reply?.code === 'invalid-body' && typeof sheet?.artifact === 'string') reply = await api.profileFront(job, front);
      if (reply?.ok)
        await said('ok', null, {
          ...(framed ? { framed: true } : {}),
          ...(reply.expressionsRefused ? { expressionsRefused: String(reply.expressionsRefused).slice(0, 60) } : {}),
        });
      else
        await said('refused', reply?.code ?? 'refused', {
          ...(framed ? { framed: true } : {}),
          ...(Array.isArray(reply?.errors) && reply.errors.length
            ? { errors: reply.errors.slice(0, 5).map((/** @type {any} */ e) => String(e?.code ?? e).slice(0, 40)) }
            : {}),
        });
    } catch (/** @type {any} */ error) {
      // A set is a courtesy here: his registration goes on. What stopped it is said all the same.
      await said('error', typeof error?.code === 'string' ? error.code : 'error');
    }
  }

  /** @param {Job} job @param {string} dir */
  async function submitting(job, dir) {
    const pkg = path.join(dir, 'package'),
      file = path.join(pkg, 'fighter.json');
    if (!existsSync(file)) return { outcome: 'review', result: { code: 'package-missing' } };
    await profileFront(job, dir);
    const manifest = withProfile(JSON.parse(await readFile(file, 'utf8')), job.profile, job.brief);
    const text = JSON.stringify(manifest, null, 2) + '\n';
    const created = await api.submission(job, text);
    if (!created.ok) return { outcome: submissionOutcome(created), result: { code: created.code ?? 'submission-refused' } };
    // Sent again after a finish that never arrived: the package is in already — nothing left to upload.
    if (created.stage !== 'uploading') return { outcome: 'ok', result: { submissionId: created.submissionId } };
    for (const asset of manifest.assets) {
      const bytes = await readFile(path.join(pkg, asset.path));
      if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) return { outcome: 'review', result: { code: 'asset-hash' } };
      const put = await api.asset(job, asset.id, bytes);
      if (!put.ok) return { outcome: submissionOutcome(put), result: { code: put.code ?? 'asset-refused' } };
    }
    const submitted = await api.submit(job);
    if (!submitted.ok) return { outcome: submissionOutcome(submitted), result: { code: submitted.code ?? 'submit-refused' } };
    return { outcome: 'ok', result: { submissionId: created.submissionId } };
  }

  return {
    queued: observed('queued', brief),
    appearance: observed('appearance', screened(appearance)),
    motions: observed('motions', screened(motions)),
    submitting,
  };
}

/** Files in a job folder, for a log line (never their contents). @param {string} dir */

export async function listed(dir) {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}
