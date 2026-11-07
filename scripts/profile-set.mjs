// @ts-check
// A profile set's files from the pictures the user chose (선수 프로필 세트, 2026-10-31; 표정 시트, 2026-11-03): the front painting framed for
// the card, its face square measured on its pixels (host/motions.py face-box, which hosted fighters use), the expression sheet at its size,
// profile-set.json with their sizes and hashes, and the previews to show the user. The server's parse and the validator's own pixel checks
// (worker/profile-set-check.mjs) run here too, so a set this writes passes them. The front is scaled uniformly and padded, a 3:2 sheet
// (within 1 %) fitted to 1536 × 1024; nothing is redrawn.
// Never overwrites a folder. Writes nothing unless the whole set passes.
import { createHash } from 'node:crypto';
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { PROFILE_SET_EXPRESSIONS, PROFILE_SET_LIMITS, PROFILE_SET_VERSION, parseProfileSet } from '../api/profile-set-contract.mjs';
import { checkExpressionSheet, checkProfileSet } from '../worker/profile-set-check.mjs';

const INK = 16;
// host/motions.py face-box: below 48 is the image model's halo; the face square's side is 17 % of the figure, centred on its top 12 %.
const FACE_ALPHA = 48, FACE_SIDE = 0.17, FACE_HEAD_SHARE = 0.12;
// The spec's framing: head to feet about 86 % of the height, a 2:3 card or wider canvas for a wide stance, a little room at the sides.
const FIGURE_SHARE = 0.86, CARD_RATIO = 2 / 3, SIDE_ROOM = 0.9;
const CUTOUT = 'npm run sprite -- cutout <picture> --out <picture>-cutout.png';

/** @typedef {{ code: string, path: string, detail?: string }} SetError */
/** @typedef {{ data: Buffer, width: number, height: number, channels: number }} Pixels */
/** @typedef {{ left: number, top: number, right: number, bottom: number }} Bounds */

class SetFailure extends Error {
  /** @param {string} code @param {string} where @param {string} [detail] */
  constructor(code, where, detail) { super(code); this.where = where; this.detail = detail; }
}

/** @param {Buffer} bytes */
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** Python's round (half to even), so the face square is face-box's to the pixel. @param {number} value */
const roundEven = value => { const down = Math.floor(value), part = value - down; return part > 0.5 || (part === 0.5 && down % 2 !== 0) ? down + 1 : down; };

/** The pixels where alpha is above `threshold`, as a box; null when there are none. @param {Pixels} image @param {number} threshold @returns {Bounds | null} */
function inkBounds({ data, width, height, channels }, threshold) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * channels + 3] > threshold) {
    if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
  }
  return right < 0 ? null : { left, top, right, bottom };
}

/**
 * The face square on a front painting, as host/motions.py face-box measures it: the head's square at the figure's top, its side 17 % of the
 * figure's height, centred on the solid pixels of the figure's top 12 %.
 * @param {Pixels} image @returns {{ x: number, y: number, side: number }}
 */
export function faceBox(image) {
  const solid = inkBounds(image, FACE_ALPHA - 1);
  if (!solid) throw new SetFailure('FRONT_EMPTY', '/front');
  const { data, width, channels } = image, height = solid.bottom - solid.top + 1, figureWidth = solid.right - solid.left + 1;
  let headLeft = width, headRight = -1;
  for (let y = solid.top; y < solid.top + Math.max(1, Math.floor(height * FACE_HEAD_SHARE)); y++) for (let x = 0; x < width; x++)
    if (data[(y * width + x) * channels + 3] >= FACE_ALPHA) { if (x < headLeft) headLeft = x; if (x > headRight) headRight = x; }
  const side = Math.max(16, Math.min(figureWidth, height, roundEven(height * FACE_SIDE)));
  const centre = (headLeft + headRight + 1) / 2;
  return { x: Math.max(solid.left, Math.min(solid.right + 1 - side, roundEven(centre - side / 2))), y: solid.top, side };
}

/** A picture's RGBA pixels; a picture without transparency is refused with the cutout step. @param {string} file @param {string} where */
async function readPicture(file, where) {
  let metadata, raw;
  try {
    metadata = await sharp(file).metadata();
    raw = await sharp(file).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch { throw new SetFailure('PICTURE_UNREADABLE', where, file); }
  if ((metadata.pages ?? 1) !== 1) throw new SetFailure('PICTURE_ANIMATED', where, file);
  if (!metadata.hasAlpha) throw new SetFailure('PICTURE_NO_ALPHA', where, `No transparent background: ${CUTOUT}, then use the cutout.`);
  return { data: raw.data, width: raw.info.width, height: raw.info.height, channels: raw.info.channels };
}

/**
 * The front painting framed for the card: its figure (the pixels above the faintest ink) scaled uniformly to about 86 % of a portrait canvas
 * whose long side is 1024–2048 (unscaled when the figure already fits that), centred, with transparent room round it.
 * @param {Pixels} image @returns {Promise<Buffer>} a PNG
 */
async function frameFront(image) {
  const box = inkBounds(image, INK);
  if (!box) throw new SetFailure('FRONT_EMPTY', '/front');
  const figureWidth = box.right - box.left + 1, figureHeight = box.bottom - box.top + 1;
  // A background left in the picture fills it edge to edge: there is no figure to frame.
  if (box.left === 0 && box.top === 0 && box.right === image.width - 1 && box.bottom === image.height - 1)
    throw new SetFailure('FRONT_BACKGROUND', '/front', `The picture has no clear background: ${CUTOUT}, then use the cutout.`);
  if (figureWidth > figureHeight) throw new SetFailure('FIGURE_WIDTH', '/front', 'The character is wider than tall: draw him with the arms closer to the body.');
  const [low, high] = PROFILE_SET_LIMITS.longSide, natural = Math.round(figureHeight / FIGURE_SHARE);
  const height = Math.min(high, Math.max(low, natural)), scale = height === natural ? 1 : (height * FIGURE_SHARE) / figureHeight;
  const drawnWidth = Math.max(1, Math.round(figureWidth * scale)), drawnHeight = Math.max(1, Math.round(figureHeight * scale));
  const width = Math.max(Math.ceil(height * CARD_RATIO), Math.ceil(drawnWidth / SIDE_ROOM));
  if (width >= height) throw new SetFailure('FIGURE_WIDTH', '/front', 'The character is too wide for a tall card: draw him with the arms closer to the body.');
  const figure = await sharp(image.data, { raw: { width: image.width, height: image.height, channels: /** @type {4} */ (image.channels) } })
    .extract({ left: box.left, top: box.top, width: figureWidth, height: figureHeight })
    .resize({ width: drawnWidth, height: drawnHeight, fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: figure, left: Math.floor((width - drawnWidth) / 2), top: Math.floor((height - drawnHeight) / 2) }]).png().toBuffer();
}

/** The expression sheet at its size: a 3:2 sheet is scaled to 1536 × 1024, any other shape is refused. @param {Pixels} image */
async function fitSheet(image) {
  const { width, height } = PROFILE_SET_LIMITS.expressions;
  if (Math.abs(image.width / image.height - width / height) > 0.01)
    throw new SetFailure('EXPRESSIONS_DIMENSIONS', '/expressions', `Draw the sheet ${width} x ${height} (3 x 2 cells); this one is ${image.width} x ${image.height}.`);
  return sharp(image.data, { raw: { width: image.width, height: image.height, channels: /** @type {4} */ (image.channels) } })
    .resize({ width, height, fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
}

/** A WebP with its alpha, lossless when that fits the limit. @param {Buffer} png @param {number} limit @param {string} where */
async function encode(png, limit, where) {
  const lossless = await sharp(png).webp({ lossless: true, effort: 4 }).toBuffer();
  if (lossless.length <= limit) return lossless;
  const lossy = await sharp(png).webp({ quality: 92, alphaQuality: 100, effort: 4 }).toBuffer();
  if (lossy.length > limit) throw new SetFailure('PICTURE_TOO_LARGE', where);
  return lossy;
}

/**
 * Build a profile set's folder. `front` is the painting the user chose; `expressions` his sheet (optional: without it the arena shows his face
 * square for every mood). `face`: a square the user approved in place of the measured one, in the framed front's pixels (the `face` a build
 * without it printed is in the same pixels) — for a figure face-box misreads, as a big round head whose face sits low (2026-11-07, 깔깔이: the
 * measured square held his forehead and back bumps). It goes through the same set and pixel checks as a measured one. Returns the files and the
 * face square, or the errors; writes `out` only on a pass.
 * @param {{ front: string, expressions?: string | null, out: string, face?: { x: number, y: number, side: number } | null }} options
 */
export async function buildProfileSet({ front, expressions = null, out, face: approved = null }) {
  try {
    if (await lstat(out).then(() => true, () => false)) throw new SetFailure('OUTPUT_EXISTS', '', out);
    const framed = await frameFront(await readPicture(front, '/front'));
    const frontBytes = await encode(framed, PROFILE_SET_LIMITS.frontBytes, '/front');
    const decoded = await sharp(frontBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const face = approved ?? faceBox({ data: decoded.data, width: decoded.info.width, height: decoded.info.height, channels: decoded.info.channels });
    const sheetBytes = expressions ? await encode(await fitSheet(await readPicture(expressions, '/expressions')), PROFILE_SET_LIMITS.expressionsBytes, '/expressions') : null;
    /** @type {(bytes: Buffer, name: string, width: number, height: number) => { path: string, bytes: number, sha256: string, width: number, height: number }} */
    const file = (bytes, name, width, height) => ({ path: name, bytes: bytes.length, sha256: sha256(bytes), width, height });
    const set = { version: PROFILE_SET_VERSION, front: file(frontBytes, 'front.webp', decoded.info.width, decoded.info.height), face,
      ...(sheetBytes ? { expressions: file(sheetBytes, 'expressions.webp', PROFILE_SET_LIMITS.expressions.width, PROFILE_SET_LIMITS.expressions.height) } : {}) };
    const text = JSON.stringify(set, null, 2) + '\n';
    // The server's checks, in its order: the set file, then the validator's pixels.
    const parsed = parseProfileSet(text);
    if (!parsed.ok) return { ok: false, stage: 'profile-set-file', errors: parsed.errors };
    const checked = await checkProfileSet(frontBytes, set);
    const sheet = sheetBytes ? await checkExpressionSheet(sheetBytes) : null;
    /** @type {SetError[]} */
    const errors = [...checked.errors, ...(sheet?.errors ?? [])];
    if (!checked.ok || (sheet && !sheet.ok)) return { ok: false, stage: 'profile-set-check', errors };
    // The previews to show the user: his face as the home's round crop, and the face he makes when he is knocked out.
    const round = Buffer.from(`<svg width="${PROFILE_SET_LIMITS.faceSize}" height="${PROFILE_SET_LIMITS.faceSize}"><circle cx="96" cy="96" r="96"/></svg>`);
    const facePreview = await sharp(checked.face).composite([{ input: round, blend: 'dest-in' }]).png().toBuffer();
    const cell = PROFILE_SET_LIMITS.expressions.width / PROFILE_SET_LIMITS.expressions.columns, ko = PROFILE_SET_EXPRESSIONS.indexOf('ko');
    const koPreview = sheetBytes ? await sharp(sheetBytes).extract({ left: (ko % PROFILE_SET_LIMITS.expressions.columns) * cell,
      top: Math.floor(ko / PROFILE_SET_LIMITS.expressions.columns) * cell, width: cell, height: cell }).png().toBuffer() : null;
    const temporary = `${out}.partial-${process.pid}`;
    await rm(temporary, { recursive: true, force: true });
    await mkdir(temporary, { recursive: true });
    await writeFile(path.join(temporary, 'front.webp'), frontBytes);
    if (sheetBytes) await writeFile(path.join(temporary, 'expressions.webp'), sheetBytes);
    await writeFile(path.join(temporary, 'face-preview.png'), facePreview);
    if (koPreview) await writeFile(path.join(temporary, 'ko-preview.png'), koPreview);
    await writeFile(path.join(temporary, 'profile-set.json'), text);
    await rename(temporary, out);
    return { ok: true, stage: 'profile-set-ready', folder: out, set,
      previews: { face: path.join(out, 'face-preview.png'), ...(koPreview ? { ko: path.join(out, 'ko-preview.png') } : {}),
        ...(sheetBytes ? { expressions: path.join(out, 'expressions.webp') } : {}) },
      upload: ['prepare_profile_set: manifest profile-set.json', 'upload_profile_set_asset: assetId front, file front.webp',
        ...(sheetBytes ? ['upload_profile_set_asset: assetId expressions, file expressions.webp'] : []), 'submit_profile_set'],
      ...(sheetBytes ? {} : { note: 'No expression sheet: the arena shows his face square for every mood, his KO included.' }) };
  } catch (error) {
    if (error instanceof SetFailure) return { ok: false, stage: 'profile-set-build', errors: [{ code: error.message, path: error.where, ...(error.detail ? { detail: error.detail } : {}) }] };
    throw error;
  }
}

/**
 * `--face x,y,side` as a square, null when it is not given, false when it is not three whole numbers (the side at least the contract's least).
 * @param {string | undefined} value @returns {{ x: number, y: number, side: number } | null | false}
 */
export function parseFace(value) {
  if (value === undefined) return null;
  const parts = /^(\d{1,5}),(\d{1,5}),(\d{1,5})$/.exec(value.trim());
  if (!parts) return false;
  const [x, y, side] = parts.slice(1).map(Number);
  return side >= PROFILE_SET_LIMITS.faceMin ? { x, y, side } : false;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const usage = 'Usage: npm run fighter:profile-set -- --front <chosen front> [--expressions <sheet>] [--face <x>,<y>,<side>] --out <new folder>';
  let values;
  try { ({ values } = parseArgs({ options: { front: { type: 'string' }, expressions: { type: 'string' }, face: { type: 'string' }, out: { type: 'string' } }, strict: true })); }
  catch { values = null; }
  const face = parseFace(values?.face);
  if (!values?.front || !values.out || face === false) {
    console.error(usage);
    process.exitCode = 2;
  } else {
    // npm runs scripts in the kit's folder; the paths are the caller's.
    const here = process.env.INIT_CWD || process.cwd();
    const result = await buildProfileSet({ front: path.resolve(here, values.front), expressions: values.expressions ? path.resolve(here, values.expressions) : null,
      out: path.resolve(here, values.out), face });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  }
}
