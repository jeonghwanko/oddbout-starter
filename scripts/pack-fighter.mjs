// @ts-check
// Build an AI Fighter package from a `sprite-gen game-pack` output. Deterministic: the same pack and plan give the same bytes.
// Pixels decide what they can measure: body scale, ground line, ground contacts, frame identity and the walk stride.
// The plan decides what pixels cannot: which animation is which motion, contact steps and landmarks.
// Never overwrites a folder. Writes nothing unless the whole package passes the contract.
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { z } from 'zod';
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { validateFighter } from '../contracts/ai-fighter/validate.mjs';
import { validateFighterPackage } from '../server/ai-fighter-package.mjs';
import { requireLoopReview, requireReview } from '../tools/ai-fighter/gait.mjs';
import { sheetLayout } from '../tools/ai-fighter/sheet-layout.mjs';
import { packageBudget, nextPackageScale } from '../tools/ai-fighter/package-budget.mjs';

/**
 * @typedef {{ width: number, height: number, data: Buffer }} Frame
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 * @typedef {{ left: number, top: number, right: number, bottom: number }} Bounds
 * @typedef {{ x: number, y: number, rx: number, ry: number }} Contact
 * @typedef {{ kind: string, loop: boolean, frames?: number, minFrames?: number, maxFrames?: number }} ClipSpec  A motion or optional clip of the spec.
 * @typedef {{ kind: string, version: number, textures: { image: string, frames?: Record<string, { frame: Rect, rotated?: boolean, trimmed?: boolean }> }[],
 *   animations: Record<string, { frames: string[], durations_ms: number[], anchor?: number[], loop?: boolean, events?: unknown[] }> }} GamePack
 *   sprite-gen game-pack.json, the fields read here.
 * @typedef {{ geometry: { groundY: number }, stridePixels: number, sequenceSha256: string }} GaitReview  As requireReview passed it.
 * @typedef {{ stridePixels: number | null, sequenceSha256: string, engine: unknown, judge: string }} LoopReview  As requireLoopReview passed it.
 * @typedef {{ keys: string[], frames: Frame[], durations: number[], sourceDurations: number[], anchor: { x: number, y: number }, loop?: boolean,
 *   events: unknown[], getUp?: Animation, gaitReview?: GaitReview, loopReview?: LoopReview, reviewDiagnostics?: object[] }} Animation
 * @typedef {{ frame: number, durationMs: number }} Step
 * @typedef {{ assetId: string, frameWidth: number, frameHeight: number, columns: number, rows: number, frames: number[],
 *   origins: { originX: number, originY: number, groundContacts: Contact[] }[], loop: boolean, durationMs?: number, stridePixels?: number,
 *   sequence?: Step[], hitSequenceIndices?: number[], landmarks?: Record<string, unknown>, skill?: Record<string, unknown>, pixelScale?: number }} Clip
 */

const BODY = spec.input.bodyHeight;
const ALPHA = 32;              // measurement threshold: ignores faint anti-aliasing and soft shadows
const MARGIN = 8;              // transparent pixels kept around the motion's union box
const SCALE_TOLERANCE = 0.02;  // a game pack within 2% of the body height is used without resampling
const MAX_COLUMNS = 8, MAX_SHEET = spec.limits.imageDimension, MAX_FRAME = 1024;
const MOTIONS = Object.keys(spec.motions);
// Optional clips (skill, entrance, victory): packed like the required actions when the plan names them.
const OPTIONAL_CLIPS = Object.keys(spec.optionalClips);
/** @type {(name: string) => ClipSpec} */
const clipSpec = name => /** @type {Record<string, ClipSpec>} */ (spec.motions)[name] ?? /** @type {Record<string, ClipSpec>} */ (spec.optionalClips)[name];
/** @type {(name: string) => string} */
const assetId = name => name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
/** @type {(value: number) => number} */
const round = value => Math.round(value * 100) / 100;

const crop = z.strictObject({ x: z.number().int().min(0), y: z.number().int().min(0), width: z.number().int().min(1), height: z.number().int().min(1) });
const motionPlan = z.strictObject({
  animation: z.string().min(1),
  getUpAnimation: z.string().min(1).optional(),
  frame: z.number().int().min(0).optional(),
  flipX: z.boolean().optional(),
  origin: z.strictObject({ x: z.number(), y: z.number() }).optional(),
  stridePixels: z.number().positive().optional(),
  gaitReview: z.string().min(1).optional(),
  // reviewPolicy engine-loop (hosted generation): the walk or run's loop review instead of a gait review.
  loopReview: z.string().min(1).optional(),
  hitSequenceIndices: z.array(z.number().int().min(0)).optional(),
  landmarks: z.record(z.string(), z.unknown()).optional(),
  // The skill clip's rule and marks, all playback steps: a run's { windupTo, recoverFrom, run?, launch?, struck? } or a stance's
  // { windowFrom, windowTo, strikeFrom, strikeTo }. The contract checks them.
  skill: z.record(z.string(), z.unknown()).optional(),
});
const planSchema = z.strictObject({
  gamePack: z.string().min(1), out: z.string().min(1), localId: z.string(),
  // language, concept, names, lines, moves, stats and style are optional; validateFighter below enforces their contract limits,
  // the stats budget and the style rules. stats and style become combat.stats and combat.style.
  profile: z.strictObject({ name: z.string(), description: z.string(), portraitCrop: crop.optional(), previewCrop: crop.optional(),
    language: z.string().optional(), concept: z.string().optional(), names: z.record(z.string(), z.string()).optional(),
    lines: z.record(z.string(), z.string()).optional(),
    moves: z.record(z.string(), z.strictObject({ name: z.string(), description: z.string() })).optional(),
    stats: z.record(z.string(), z.number()).optional(), style: z.record(z.string(), z.unknown()).optional() }),
  encoding: z.enum(['lossless', 'lossy']).default('lossless'),
  quality: z.number().int().min(1).max(100).default(92),
  resample: z.enum(['lanczos3', 'nearest']).default('lanczos3'),
  fitSheets: z.boolean().default(false),
  outputScale: z.number().min(spec.textureResolution.minScale).max(1).default(1),
  // Legacy policy names remain readable, but no quality report blocks file packaging.
  reviewPolicy: z.enum(['files-only', 'required', 'engine-loop', 'format-only']).default('files-only'),
  motions: /** @type {z.ZodType<Record<string, MotionPlan>>} */ (z.strictObject({ ...Object.fromEntries(MOTIONS.map(name => [name, motionPlan])),
    ...Object.fromEntries(OPTIONAL_CLIPS.map(name => [name, motionPlan.optional()])) })),
});
/** @typedef {z.infer<typeof motionPlan>} MotionPlan @typedef {z.infer<typeof planSchema>} Plan */

class PackError extends Error {
  /** @param {string} code @param {string} detail @param {unknown} [data] */
  constructor(code, detail, data) { super(code); this.detail = detail; this.data = data; }
}
/** @type {(code: string, detail: string, data?: unknown) => never} */
const fail = (code, detail, data) => { throw new PackError(code, detail, data); };

/** An RGBA frame. @type {(width: number, height: number, data?: Buffer) => Frame} */
const frameOf = (width, height, data = Buffer.alloc(width * height * 4)) => ({ width, height, data });
/** @param {Frame} page @param {Rect} rect */
function extract(page, rect) {
  const frame = frameOf(rect.w, rect.h);
  for (let y = 0; y < rect.h; y++)
    page.data.copy(frame.data, y * rect.w * 4, ((rect.y + y) * page.width + rect.x) * 4, ((rect.y + y) * page.width + rect.x + rect.w) * 4);
  return frame;
}
/** @param {Frame} frame */
function mirror(frame) {
  const out = frameOf(frame.width, frame.height);
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++)
    frame.data.copy(out.data, (y * frame.width + frame.width - 1 - x) * 4, (y * frame.width + x) * 4, (y * frame.width + x) * 4 + 4);
  return out;
}
/** @param {Frame} frame @param {number} ratio @param {Plan['resample']} kernel */
async function resize(frame, ratio, kernel) {
  const width = Math.max(1, Math.round(frame.width * ratio)), height = Math.max(1, Math.round(frame.height * ratio));
  const data = await sharp(frame.data, { raw: { width: frame.width, height: frame.height, channels: 4 } })
    .resize(width, height, { kernel, fit: 'fill' }).ensureAlpha().raw().toBuffer();
  return frameOf(width, height, data);
}
/** @type {(frame: Frame, x: number, y: number) => number} */
const alphaAt = (frame, x, y) => frame.data[(y * frame.width + x) * 4 + 3];
/** Opaque bounds as half-open rows/columns, or null for an empty frame. @param {Frame} frame @param {number} threshold @returns {Bounds | null} */
function bounds(frame, threshold) {
  let left = frame.width, top = frame.height, right = 0, bottom = 0;
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) if (alphaAt(frame, x, y) >= threshold) {
    if (x < left) left = x; if (x + 1 > right) right = x + 1; if (y < top) top = y; if (y + 1 > bottom) bottom = y + 1;
  }
  return right > left ? { left, top, right, bottom } : null;
}
/** Feet on the ground line: up to two runs of opaque columns in a thin band above it. @param {Frame} frame @param {number} groundY @returns {Contact[]} */
function measureContacts(frame, groundY) {
  const band = Math.max(2, Math.round(BODY * 0.02)), gap = Math.max(2, Math.round(BODY * 0.015)), minimum = Math.max(2, Math.round(BODY * 0.01));
  /** @type {{ start: number, end: number }[]} */
  const runs = [];
  for (let x = 0; x < frame.width; x++) {
    let ink = false;
    for (let y = Math.max(0, groundY - band); y < groundY && !ink; y++) ink = alphaAt(frame, x, y) >= ALPHA;
    if (!ink) continue;
    const last = runs.at(-1);
    if (last && x - last.end <= gap) last.end = x + 1; else runs.push({ start: x, end: x + 1 });
  }
  return runs.filter(r => r.end - r.start >= minimum).sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 2)
    .sort((a, b) => a.start - b.start)
    .map(r => ({ x: (r.start + r.end) / 2, y: groundY, rx: (r.end - r.start) / 2, ry: band / 2 }));
}
/** Backward travel of planted feet over one walk cycle: the distance the body must move so feet do not slide. @param {Contact[][]} contacts */
function measureStride(contacts) {
  const near = BODY * 0.12, steps = [];
  for (let i = 0; i < contacts.length; i++) {
    const from = contacts[i], to = contacts[(i + 1) % contacts.length], backward = [];
    for (const a of from) {
      const b = to.reduce((best, c) => Math.abs(c.x - a.x) < Math.abs((best?.x ?? Infinity) - a.x) ? c : best, /** @type {Contact | null} */ (null));
      if (b && Math.abs(b.x - a.x) <= near && b.x - a.x < -0.5) backward.push(b.x - a.x);
    }
    steps.push(backward.length ? median(backward) : null);
  }
  const measured = steps.filter(step => step !== null);
  if (measured.length * 2 < steps.length) return null;
  const typical = median(measured);
  return round(-steps.reduce((/** @type {number} */ sum, step) => sum + (step ?? typical), 0));
}
/** @param {number[]} values */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** @param {string} file */
async function loadPack(file) {
  /** @type {GamePack} */
  let pack;
  try { pack = JSON.parse(await readFile(file, 'utf8')); } catch { fail('GAME_PACK_UNREADABLE', file); }
  if (pack?.kind !== 'sprite-gen-game-pack' || ![1, 2].includes(pack.version) || !Array.isArray(pack.textures) || !pack.animations)
    fail('GAME_PACK_FORMAT', 'expected sprite-gen game-pack.json version 1 or 2');
  const directory = path.dirname(file), frames = /** @type {Map<string, { page: number, rect: Rect }>} */ (new Map()), pages = /** @type {Map<number, Frame>} */ (new Map());
  pack.textures.forEach((texture, page) => {
    for (const [key, entry] of Object.entries(texture.frames ?? {})) {
      if (entry.rotated || entry.trimmed) fail('GAME_PACK_FRAME', `${key}: rotated or trimmed frames are not supported`);
      frames.set(key, { page, rect: entry.frame });
    }
  });
  /** @type {(index: number) => Promise<Frame>} */
  const page = async index => {
    if (!pages.has(index)) {
      const image = path.resolve(directory, pack.textures[index].image);
      const { data, info } = await sharp(image, { limitInputPixels: MAX_SHEET * MAX_SHEET }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      pages.set(index, { width: info.width, height: info.height, data });
    }
    return /** @type {Frame} */ (pages.get(index));
  };
  // Decoded pages are only needed while frames are cut out; release them before packing.
  return { pack, frames, page, release: () => pages.clear() };
}

/** @typedef {Awaited<ReturnType<typeof loadPack>>} Source */
/**
 * Frames of one animation in playback order, and its durations, at the game pack's scale.
 * @param {Source} source @param {string} name @param {Pick<MotionPlan, 'animation' | 'flipX'>} motion @returns {Promise<Animation>}
 */
async function readAnimation(source, name, motion) {
  const animation = source.pack.animations[motion.animation];
  if (!animation) fail('ANIMATION_NOT_FOUND', `${name}: ${motion.animation}`);
  if (!Array.isArray(animation.frames) || !animation.frames.length || animation.durations_ms?.length !== animation.frames.length)
    fail('GAME_PACK_ANIMATION', `${name}: frames and durations_ms must match`);
  /** @type {Frame[]} */
  const frames = [];
  for (const key of animation.frames) {
    const location = source.frames.get(key);
    if (!location) fail('GAME_PACK_FRAME', `${name}: missing frame ${key}`);
    const page = await source.page(location.page), r = location.rect;
    if (r.x < 0 || r.y < 0 || r.x + r.w > page.width || r.y + r.h > page.height) fail('GAME_PACK_FRAME', `${name}: ${key} outside its page`);
    const frame = extract(page, r);
    frames.push(motion.flipX ? mirror(frame) : frame);
  }
  if (frames.some(f => f.width !== frames[0].width || f.height !== frames[0].height)) fail('GAME_PACK_FRAME', `${name}: frames differ in size`);
  const [ax, ay] = Array.isArray(animation.anchor) ? animation.anchor : [frames[0].width / 2, frames[0].height];
  // The package plays whole milliseconds; a gait review is bound to the game pack's own durations.
  return { keys: animation.frames, frames, durations: animation.durations_ms.map(ms => Math.max(1, Math.round(ms))), sourceDurations: animation.durations_ms,
    anchor: { x: motion.flipX ? frames[0].width - ax : ax, y: ay }, loop: animation.loop, events: animation.events ?? [] };
}

/** @param {string} name @param {MotionPlan} motion */
function checkPlanFields(name, motion) {
  const kind = clipSpec(name).kind;
  const misplaced = [
    name !== 'fall' && motion.getUpAnimation !== undefined && 'getUpAnimation',
    name !== 'idle' && motion.frame !== undefined && 'frame',
    name !== 'walk' && motion.stridePixels !== undefined && 'stridePixels',
    !['walk', 'run'].includes(name) && motion.gaitReview !== undefined && 'gaitReview',
    !['walk', 'run'].includes(name) && motion.loopReview !== undefined && 'loopReview',
    kind === 'gait' && motion.hitSequenceIndices !== undefined && 'hitSequenceIndices',
    kind === 'gait' && motion.landmarks !== undefined && 'landmarks',
    name !== 'skill' && motion.skill !== undefined && 'skill',
  ].filter(Boolean);
  if (misplaced.length) fail('PLAN_FIELD', `${name}: ${misplaced.join(', ')} not used by this motion`);
  if (motion.gaitReview !== undefined && motion.loopReview !== undefined) fail('PLAN_FIELD', `${name}: choose gaitReview or loopReview, not both`);
  if (motion.getUpAnimation !== undefined && motion.landmarks?.getUp !== undefined)
    fail('PLAN_FIELD', 'fall: choose getUpAnimation or landmarks.getUp, not both');
}

const PACK_CONCURRENCY = 4;
/**
 * `task` over `items`, at most `limit` at a time; results in item order, as Promise.allSettled reports them.
 * @template T, R
 * @param {T[]} items @param {number} limit @param {(item: T) => Promise<R>} task @returns {Promise<PromiseSettledResult<R>[]>}
 */
async function mapLimited(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = { status: 'fulfilled', value: await task(items[index]) }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  }));
  return results;
}

/**
 * Lossy at effort 5. At effort 6 with alphaQuality 100, libwebp packs the alpha plane with its slowest lossless search: 12–15 s
 * per hosted fighter instead of 0.6–0.8 s, for 1 % fewer bytes and the same colour (two fighters, 2026-10-30). alphaQuality stays
 * 100: below it libwebp quantises alpha. Lossless has no such step and keeps 6.
 * @param {Frame} sheet @param {Plan} plan
 */
function encode(sheet, plan) {
  const image = sharp(sheet.data, { raw: { width: sheet.width, height: sheet.height, channels: 4 } });
  return (plan.encoding === 'lossless' ? image.webp({ lossless: true, effort: 6 })
    : image.webp({ quality: plan.quality, alphaQuality: 100, effort: 5 })).toBuffer();
}

/**
 * Pack one motion: dedupe by pixels, crop to the union box, measure origins and contacts, lay out the sheet.
 * @param {string} name @param {MotionPlan} motion @param {Animation} animation @param {Plan} plan
 */
async function packMotion(name, motion, animation, plan) {
  const motionSpec = clipSpec(name);
  let playback = animation.frames.map((frame, step) => ({ frame, durationMs: animation.durations[step], key: animation.keys[step] }));
  if (name === 'idle') {
    const index = motion.frame ?? 0;
    if (index >= playback.length) fail('PLAN_FIELD', `idle: frame ${index} outside ${playback.length} playback steps`);
    playback = [playback[index]];
  }
  const unique = /** @type {{ frame: Frame, key: string }[]} */ ([]), identity = /** @type {Map<string, number>} */ (new Map());
  /** @type {(step: { frame: Frame, durationMs: number, key: string }) => Step} */
  const include = step => {
    const hash = createHash('sha256').update(step.frame.data).digest('hex');
    if (!identity.has(hash)) { identity.set(hash, unique.length); unique.push({ frame: step.frame, key: step.key }); }
    return { frame: /** @type {number} */ (identity.get(hash)), durationMs: step.durationMs };
  };
  // Get-up cells share the fall sheet and deduplication, but never enter fall playback.
  const steps = playback.map(include);
  const getUp = animation.getUp?.frames.map((frame, step) => ({ clip: 'fall', ...include({ frame,
    durationMs: /** @type {Animation} */ (animation.getUp).durations[step], key: /** @type {Animation} */ (animation.getUp).keys[step] }) }));
  if (motionSpec.kind === 'gait') {
    // A gait keeps the frames it was filmed or drawn in, inside the contract's range (gait-frames-1); idle is one.
    const fewest = motionSpec.minFrames ?? motionSpec.frames ?? 1, most = motionSpec.maxFrames ?? motionSpec.frames ?? 1;
    if (unique.length < fewest || unique.length > most || steps.some((step, index) => step.frame !== index))
      fail('GAIT_FRAMES', `${name}: needs ${fewest === most ? fewest : `${fewest} to ${most}`} distinct frames played once in order; found ${unique.length} distinct in ${steps.length} steps`);
    if (new Set(steps.map(step => step.durationMs)).size !== 1) fail('GAIT_TIMING', `${name}: every gait frame needs the same duration`);
  }
  /** @param {typeof unique} cells */
  const geometry = cells => {
    let groundY = 0, union = null;
    for (const { frame } of cells) {
      const solid = bounds(frame, ALPHA), any = /** @type {Bounds} */ (bounds(frame, 1)); // not null when solid is not
      if (!solid) fail('EMPTY_FRAME', `${name}: a frame has no visible pixels`);
      groundY = Math.max(groundY, solid.bottom);
      union = union ? { left: Math.min(union.left, any.left), top: Math.min(union.top, any.top), right: Math.max(union.right, any.right), bottom: Math.max(union.bottom, any.bottom) } : any;
    }
    return { groundY, union: /** @type {Bounds} */ (union) };
  };
  const measured = geometry(unique);
  let origin = { x: motion.origin?.x ?? animation.anchor.x, y: animation.gaitReview?.geometry.groundY ?? motion.origin?.y ?? measured.groundY };
  // The box may extend past the source canvas: feet drawn on its bottom edge still get room for contact ellipses.
  // union: set above, as unique is never empty
  /** @param {Bounds} union */
  const cropBox = union => ({ left: Math.min(union.left, Math.floor(origin.x)) - MARGIN, top: union.top - MARGIN,
    right: Math.max(union.right, Math.ceil(origin.x)) + MARGIN, bottom: Math.max(union.bottom, Math.ceil(origin.y)) + MARGIN });
  let box = cropBox(measured.union), pixelScale = plan.outputScale;
  const originalBox = { ...box };
  const layoutLimits = { dimension: MAX_SHEET, grid: MAX_COLUMNS, frame: MAX_FRAME, margin: MARGIN, minScale: spec.textureResolution.minScale };
  const originalLayout = sheetLayout(unique.length, box.right - box.left, box.bottom - box.top, layoutLimits);
  if (!originalLayout.fits && plan.fitSheets && originalLayout.repair) {
    pixelScale = Math.min(pixelScale, originalLayout.repair.scale);
  }
  if (pixelScale !== 1) {
    origin = { x: origin.x * pixelScale, y: origin.y * pixelScale };
    // Keep original frame identities and playback steps. Never deduplicate again after resampling.
    for (const item of unique) item.frame = await resize(item.frame, pixelScale, plan.resample);
    box = cropBox(geometry(unique).union);
  }
  const frameWidth = box.right - box.left, frameHeight = box.bottom - box.top;
  const layout = sheetLayout(unique.length, frameWidth, frameHeight, layoutLimits);
  if (!layout.fits) fail(frameWidth > MAX_FRAME || frameHeight > MAX_FRAME ? 'FRAME_TOO_LARGE' : 'SHEET_TOO_LARGE', `${name}: ${unique.length} frames of ${frameWidth}x${frameHeight} exceed the supported sheet layout`,
    { motion: name, ...layout, requiredFeature: 'texture-resolution-1', next: layout.repair ? 'fit-sheets' : 'contract-limit' });
  const { columns, rows } = layout, { width: canvasWidth, height: canvasHeight } = unique[0].frame;
  const sheet = frameOf(columns * frameWidth, rows * frameHeight), contacts = /** @type {Contact[][]} */ ([]);
  unique.forEach(({ frame }, index) => {
    const left = index % columns * frameWidth, top = Math.floor(index / columns) * frameHeight;
    const fromX = Math.max(0, box.left), toX = Math.min(canvasWidth, box.right);
    for (let y = 0; y < frameHeight; y++) {
      const sourceY = box.top + y;
      if (sourceY < 0 || sourceY >= canvasHeight) continue;
      frame.data.copy(sheet.data, ((top + y) * sheet.width + left + fromX - box.left) * 4, (sourceY * canvasWidth + fromX) * 4, (sourceY * canvasWidth + toX) * 4);
    }
    contacts.push(measureContacts(frame, Math.round(origin.y)));
  });
  /** @type {(value: number, offset: number) => number} */
  const local = (value, offset) => round(value - offset);
  const origins = contacts.map(list => ({ originX: local(origin.x, box.left), originY: local(origin.y, box.top),
    groundContacts: list.map(c => ({ x: local(c.x, box.left), y: local(c.y, box.top), rx: round(c.rx), ry: round(c.ry) })) }));
  const bytes = await encode(sheet, plan);
  const id = assetId(name);
  const asset = { id, path: `assets/${id}.webp`, mediaType: 'image/webp', sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length, width: sheet.width, height: sheet.height };
  /** @type {Clip} */
  const clip = { assetId: id, frameWidth, frameHeight, columns, rows, frames: unique.map((_, i) => i), origins, loop: motionSpec.loop };
  if (pixelScale !== 1) clip.pixelScale = pixelScale;
  if (motionSpec.kind === 'gait') {
    clip.durationMs = steps[0].durationMs;
    if (name === 'walk') {
      const measured = /** @type {number} */ (measureStride(contacts)); // null (unmeasured) fails measured >= 1
      const supplied = animation.gaitReview?.stridePixels ?? animation.loopReview?.stridePixels ?? motion.stridePixels;
      clip.stridePixels = supplied === undefined ? (measured >= 1 ? measured : fail('WALK_TRAVEL_REQUIRED', 'walk: set stridePixels (1–1600) as nominal game travel; no gait review or regeneration is required')) : supplied * pixelScale;
    }
  } else {
    clip.sequence = steps;
    clip.hitSequenceIndices = motion.hitSequenceIndices ?? [];
    if (motion.landmarks) clip.landmarks = structuredClone(motion.landmarks);
    if (getUp) clip.landmarks = { ...clip.landmarks, getUp };
    // Skill marks are playback steps like the contacts; deduplication keeps one sequence step per playback step.
    if (motion.skill) clip.skill = structuredClone(motion.skill);
  }
  const report = { animation: motion.animation, playbackSteps: steps.length, distinctFrames: unique.length, frameSize: [frameWidth, frameHeight],
    resolution: { pixelScale, sourceFrameSize: [originalLayout.frameWidth, originalLayout.frameHeight],
      resampled: pixelScale === 1 ? false : plan.resample, apparentBodyHeight: BODY, frameCountPreserved: true, timingPreserved: true },
    origin: { x: round(origin.x), y: round(origin.y), source: motion.origin ? 'plan' : 'anchor-x, measured ground line' },
    contactsPerFrame: contacts.map(list => list.length), frameKeys: unique.map(u => u.key), events: animation.events,
    ...(animation.loop !== undefined && animation.loop !== motionSpec.loop ? { loopOverridden: { gamePack: animation.loop, contract: motionSpec.loop } } : {}),
    ...(animation.reviewDiagnostics?.length ? { qualityDiagnostics: animation.reviewDiagnostics } : {}),
    ...(animation.gaitReview ? { gaitReview: { status: 'pass', sequenceSha256: animation.gaitReview.sequenceSha256 } } : {}),
    ...(animation.loopReview ? { loopReview: { status: 'pass', sequenceSha256: animation.loopReview.sequenceSha256, engine: animation.loopReview.engine,
      judge: animation.loopReview.judge } } : {}),
    ...(getUp ? { getUp: { animation: motion.getUpAnimation, playbackSteps: getUp.length,
      frames: getUp.map(step => step.frame), frameKeys: /** @type {Animation} */ (animation.getUp).keys, events: /** @type {Animation} */ (animation.getUp).events } } : {}),
    ...(name === 'walk' ? { stride: { used: clip.stridePixels, measured: measureStride(contacts),
      source: animation.gaitReview ? 'same-foot-review' : animation.loopReview ? 'loop-review' : motion.stridePixels ? 'plan' : 'silhouette-estimate',
      estimateWarning: 'Nearest silhouette matching may exchange feet and fills missing steps with a median; it is not verified contact.' } } : {}) };
  return { asset, bytes, clip, report, sheet, steps,
    cropTransform: { scale: pixelScale, x: originalBox.left * pixelScale - box.left,
      y: originalBox.top * pixelScale - box.top, width: originalLayout.frameWidth, height: originalLayout.frameHeight } };
}

/** @param {Plan} plan @param {Awaited<ReturnType<typeof packMotion>>} idle */
function profileCrops(plan, idle) {
  const { clip, sheet } = idle;
  const transform = idle.cropTransform;
  /** @param {{ x: number, y: number, width: number, height: number }} crop */
  const scaledCrop = crop => {
    if (crop.x + crop.width > transform.width || crop.y + crop.height > transform.height)
      fail('PLAN_PROFILE_CROP', 'Profile crop is outside the unscaled idle sheet');
    if (transform.scale === 1) return crop;
    const x = Math.floor(crop.x * transform.scale + transform.x), y = Math.floor(crop.y * transform.scale + transform.y);
    return { x, y, width: Math.ceil((crop.x + crop.width) * transform.scale + transform.x) - x,
      height: Math.ceil((crop.y + crop.height) * transform.scale + transform.y) - y };
  };
  const preview = plan.profile.previewCrop ? scaledCrop(plan.profile.previewCrop) : { x: 0, y: 0, width: clip.frameWidth, height: clip.frameHeight };
  if (plan.profile.portraitCrop) return { portrait: scaledCrop(plan.profile.portraitCrop), preview };
  // Head square: the top of the body, centered on the top band's opaque pixels.
  const bodyHeight = BODY * (clip.pixelScale ?? 1);
  const solid = /** @type {Bounds} */ (bounds(sheet, ALPHA)), size = Math.min(clip.frameWidth, clip.frameHeight, Math.round(bodyHeight * 0.3)); // packMotion refused empty frames
  let sum = 0, count = 0;
  for (let y = solid.top; y < Math.min(solid.bottom, solid.top + Math.round(bodyHeight * 0.15)); y++)
    for (let x = solid.left; x < solid.right; x++) if (alphaAt(sheet, x, y) >= ALPHA) { sum += x; count++; }
  const x = Math.min(clip.frameWidth - size, Math.max(0, Math.round(sum / count - size / 2)));
  const y = Math.min(clip.frameHeight - size, Math.max(0, solid.top - Math.round(bodyHeight * 0.02)));
  return { portrait: { x, y, width: size, height: size }, preview };
}

/** Returns { ok, stage, out?, errors?, report? }.
 * @param {string} planFile @param {{ inspectOnly?: boolean, fitSheets?: boolean, outputScale?: number, out?: string }} [options] */
export async function packFighter(planFile, options = {}) {
  let plan;
  try {
    const input = JSON.parse(await readFile(planFile, 'utf8'));
    if (options.outputScale !== undefined) input.outputScale = options.outputScale;
    const parsed = planSchema.safeParse(input);
    if (!parsed.success) return { ok: false, stage: 'plan', errors: parsed.error.issues.map(i => ({ code: 'PLAN_SCHEMA', path: `/${i.path.join('/')}`, message: i.message })) };
    plan = parsed.data;
    if (options.fitSheets !== undefined) plan.fitSheets = options.fitSheets;
    if (options.out !== undefined) plan.out = options.out;
  } catch { return { ok: false, stage: 'plan', errors: [{ code: 'PLAN_UNREADABLE', path: '' }] }; }
  const base = path.dirname(path.resolve(planFile)), out = path.resolve(base, plan.out), gamePack = path.resolve(base, plan.gamePack);
  try {
    if (!options.inspectOnly && await lstat(out).then(() => true, () => false)) fail('OUT_EXISTS', `${out} exists; choose a new folder`);
    for (const [name, motion] of Object.entries(plan.motions)) checkPlanFields(name, motion);
    const clips = [...MOTIONS, ...OPTIONAL_CLIPS.filter(name => plan.motions[name])];
    const source = await loadPack(gamePack);
    /** @type {Record<string, Animation>} */
    const animations = {};
    for (const name of clips) animations[name] = await readAnimation(source, name, plan.motions[name]);
    if (plan.motions.fall.getUpAnimation !== undefined) {
      const fall = animations.fall, getUp = await readAnimation(source, 'fall.getUp', {
        animation: plan.motions.fall.getUpAnimation, flipX: plan.motions.fall.flipX,
      });
      if (getUp.frames.length < 2 || getUp.frames.length > 8)
        fail('PLAN_FIELD', 'fall.getUpAnimation: needs 2–8 playback steps');
      if (getUp.frames[0].width !== fall.frames[0].width || getUp.frames[0].height !== fall.frames[0].height ||
        Math.abs(getUp.anchor.x - fall.anchor.x) > 1e-6 || Math.abs(getUp.anchor.y - fall.anchor.y) > 1e-6)
        fail('GET_UP_GEOMETRY', 'fall and getUpAnimation must share the same canvas and anchor');
      fall.getUp = getUp;
    }
    source.release();
    for (const name of ['walk', 'run']) {
      const motion = plan.motions[name], animation = animations[name];
      animation.reviewDiagnostics = [];
      // Reviews are optional diagnostics. Only fresh, passing evidence may supply measured geometry/stride.
      // Missing, failed or stale quality evidence is kept in the report and never requests another generation.
      for (const kind of /** @type {const} */ (['gaitReview', 'loopReview'])) {
        const filename = motion[kind];
        if (!filename) continue;
        let evidence;
        try {
          evidence = JSON.parse(await readFile(path.resolve(base, filename), 'utf8'));
          const sequence = { frames: animation.frames, durations: animation.sourceDurations };
          const checked = kind === 'gaitReview' ? requireReview(evidence, sequence, name) : requireLoopReview(evidence, sequence, name);
          if (motion.stridePixels !== undefined || (kind === 'gaitReview' && motion.origin && motion.origin.y !== checked.geometry.groundY)) {
            animation.reviewDiagnostics.push({ kind, file: filename, status: 'deferred', code: 'PLAN_VALUES_PRESERVED', report: evidence });
            continue;
          }
          animation[kind] = structuredClone(checked);
          animation.reviewDiagnostics.push({ kind, file: filename, status: 'usable-measurement', report: evidence });
        } catch (/** @type {any} */ error) {
          animation.reviewDiagnostics.push({ kind, file: filename, status: 'deferred',
            code: String(error.message).split(':')[0], ...(evidence === undefined ? {} : { report: evidence }) });
        }
      }
    }
    // One scale for every motion, from the idle body: the game draws a sprite at actor height / bodyHeight.
    const idleFrame = animations.idle.frames[plan.motions.idle.frame ?? 0];
    if (!idleFrame) fail('PLAN_FIELD', 'idle: frame outside its animation');
    const body = bounds(idleFrame, ALPHA) ?? fail('EMPTY_FRAME', 'idle: no visible pixels');
    const measured = body.bottom - body.top, ratio = BODY / measured, resized = Math.abs(ratio - 1) > SCALE_TOLERANCE;
    if (resized) for (const name of clips) {
      const animation = animations[name];
      animation.frames = await Promise.all(animation.frames.map(frame => resize(frame, ratio, plan.resample)));
      animation.anchor = { x: animation.anchor.x * ratio, y: animation.anchor.y * ratio };
      if (animation.getUp) {
        animation.getUp.frames = await Promise.all(animation.getUp.frames.map(frame => resize(frame, ratio, plan.resample)));
        animation.getUp.anchor = { x: animation.getUp.anchor.x * ratio, y: animation.getUp.anchor.y * ratio };
      }
      if (plan.motions[name].origin) plan.motions[name].origin = { x: plan.motions[name].origin.x * ratio, y: plan.motions[name].origin.y * ratio };
      if (animation.gaitReview) {
        animation.gaitReview.geometry.groundY *= ratio;
        animation.gaitReview.stridePixels *= ratio;
      }
      if (animation.loopReview?.stridePixels) animation.loopReview.stridePixels *= ratio;
    }
    // Clips pack independently, and most of the time is libvips WebP encoding off the main thread: run a few at once.
    // Every clip finishes before the first failure in clip order is thrown, so the reported error stays the same.
    const requestedOutputScale = plan.outputScale;
    /** @type {Record<string, Awaited<ReturnType<typeof packMotion>>>} */
    let packed = {};
    /** @type {(ReturnType<typeof packageBudget> & { outputScale: number })[]} */
    const budgetAttempts = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      const settled = await mapLimited(clips, PACK_CONCURRENCY, name => packMotion(name, plan.motions[name], animations[name], plan));
      if (options.inspectOnly && settled.some(item => item.status === 'rejected')) return { ok: false, stage: 'pack-inspection',
        errors: settled.flatMap((item, index) => item.status === 'rejected' ? [{ code: item.reason instanceof PackError ? item.reason.message : 'PACK_FAILED',
          path: `/motions/${clips[index]}`, ...(item.reason instanceof PackError ? { detail: item.reason.detail, data: item.reason.data } : {}) }] : []),
        motions: Object.fromEntries(settled.flatMap((item, index) => item.status === 'fulfilled' ? [[clips[index], item.value.report]] : [])) };
      const failed = settled.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      packed = Object.fromEntries(clips.map((name, index) => [name, /** @type {PromiseFulfilledResult<Awaited<ReturnType<typeof packMotion>>>} */ (settled[index]).value])); // none rejected
      const budget = packageBudget(clips.map(name => packed[name].asset), spec.limits);
      budgetAttempts.push({ outputScale: plan.outputScale, ...budget });
      const next = plan.fitSheets ? nextPackageScale(plan.outputScale, budget.pressure, spec.textureResolution.minScale) : null;
      if (next === null || attempt === 7) break;
      // Release prior sheets before the next pass. Every trial resamples normalized originals, never a previous trial.
      for (const item of Object.values(packed)) { item.sheet.data = Buffer.alloc(0); item.bytes = Buffer.alloc(0); }
      plan.outputScale = attempt === 6 ? spec.textureResolution.minScale : next;
    }
    // Borrowed cells may name a playback step ({ clip, step }); deduplication decides its frame index.
    /** @type {(cell: any, at: string) => unknown} */
    const borrow = (cell, at) => {
      if (!cell || typeof cell !== 'object' || cell.step === undefined) return cell;
      const { step, ...rest } = cell, steps = packed[cell.clip]?.steps;
      if (!steps || cell.frame !== undefined || !Number.isInteger(step) || step < 0 || step >= steps.length)
        fail('PLAN_FIELD', `${at}: step ${step} is not a playback step of ${cell.clip}`);
      return { ...rest, frame: steps[step].frame };
    };
    for (const [name, keys] of /** @type {[string, string[]][]} */ ([['dash', ['windup', 'recover']], ['fall', ['getUp']]])) {
      const landmarks = packed[name].clip.landmarks;
      if (!landmarks) continue;
      for (const key of keys) landmarks[key] = Array.isArray(landmarks[key])
        ? landmarks[key].map((cell, index) => borrow(cell, `${name}.landmarks.${key}[${index}]`)) : borrow(landmarks[key], `${name}.landmarks.${key}`);
    }
    const crops = profileCrops(plan, packed.idle);
    const fighter = {
      schemaVersion: spec.schemaVersion, specVersion: spec.specVersion, localId: plan.localId,
      profile: { name: plan.profile.name, description: plan.profile.description,
        ...Object.fromEntries(/** @type {const} */ (['language', 'concept', 'moves', 'names', 'lines']).filter(key => plan.profile[key] !== undefined).map(key => [key, plan.profile[key]])),
        portrait: { assetId: packed.idle.asset.id, crop: crops.portrait }, preview: { assetId: packed.idle.asset.id, crop: crops.preview } },
      combat: { kitId: 'standard-duel', ...(plan.profile.stats ? { stats: plan.profile.stats } : {}), ...(plan.profile.style ? { style: plan.profile.style } : {}) },
      appearance: { projection: 'orthographic', elevationDegrees: spec.input.cameraElevationDegrees, sourceFacing: 'right', leftFacing: 'mirror', bodyHeight: BODY, bodyScale: 1 },
      assets: clips.map(name => packed[name].asset),
      clips: Object.fromEntries(clips.map(name => [name, packed[name].clip])),
    };
    const contract = validateFighter(fighter);
    const report = { generator: 'oddbout-starter pack-fighter', gamePackSha256: createHash('sha256').update(await readFile(gamePack)).digest('hex'),
      scale: { measuredBodyHeight: measured, targetBodyHeight: BODY, ratio: round(ratio), resampled: resized ? plan.resample : false },
      motions: Object.fromEntries(clips.map(name => [name, packed[name].report])),
      budget: { enabled: plan.fitSheets, requestedOutputScale, outputScale: plan.outputScale,
        encoding: plan.encoding, minimumScale: spec.textureResolution.minScale, attempts: budgetAttempts,
        result: budgetAttempts.at(-1), exhausted: plan.fitSheets && !budgetAttempts.at(-1)?.fits },
      reviewPolicy: 'files-only', requestedReviewPolicy: plan.reviewPolicy,
      qualityReview: 'deferred',
      review: 'Required file and contract checks only. Animation quality is deferred; optional gait/loop reports are diagnostics, not packaging or registration gates. Usable measurements do not certify visual quality.' };
    if (!contract.ok) return { ok: false, stage: contract.stage, errors: contract.errors, report };
    if (options.inspectOnly) return { ok: true, stage: 'pack-inspection', report,
      pending: ['full-file-validation', 'server-registration'], data: { assetBytes: budgetAttempts.at(-1)?.bytes, pixels: budgetAttempts.at(-1)?.pixels } };
    // Stage beside the target, validate the staged files (decoded pixels, crops, alpha), then publish with one rename.
    // A failing package never reaches `out`, so a corrected plan can retry into the same folder.
    const staging = path.join(path.dirname(out), `.${path.basename(out)}.pack-${process.pid}`);
    await rm(staging, { recursive: true, force: true });
    let checked;
    try {
      await mkdir(path.join(staging, 'assets'), { recursive: true });
      for (const name of clips) await writeFile(path.join(staging, packed[name].asset.path), packed[name].bytes, { flag: 'wx' });
      await writeFile(path.join(staging, 'fighter.json'), JSON.stringify(fighter, null, 2) + '\n', { flag: 'wx' });
      await writeFile(path.join(staging, 'pack-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
      checked = await validateFighterPackage(path.join(staging, 'fighter.json'));
      if (!checked.ok) { await rm(staging, { recursive: true, force: true }); return { ...checked, report }; }
      if (await lstat(out).then(() => true, () => false)) fail('OUT_EXISTS', `${out} exists; choose a new folder`);
      await rename(staging, out);
    } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
    return { ...checked, out, report: path.join(out, 'pack-report.json') };
  } catch (error) {
    if (error instanceof PackError) return { ok: false, stage: 'pack', errors: [{ code: error.message, path: '', detail: error.detail, ...(error.data ? { data: error.data } : {}) }] };
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith('-')) {
    console.error('Usage: npm run fighter:pack -- <plan.json>');
    process.exitCode = 2;
  } else {
    const result = await packFighter(args[0]);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  }
}
