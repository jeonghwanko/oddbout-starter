// @ts-check
// Trusted Node worker only (sharp). The pixel check of a profile set's front painting (api/profile-sets.mjs PROFILE_SET_SPEC) and its two
// derived files: the card (the character's area, 600 px high, with the face square in its pixels) and the face (192 × 192); and of his
// expression sheet, when he sent one, and its arena copy (1152 × 768). The worker runs it in a child process (profile-set-child.mjs), as it
// does the package decoder, so a hostile file cannot take the worker down.
import sharp from 'sharp';
import { PROFILE_SET_LIMITS } from '../api/profile-set-contract.mjs';

/** The decoder's pixel limit: the set file allows a 2048-px long side. */
export const PROFILE_SET_PIXELS = 2048 * 2048;
const INK = 16,
  BORDER = 2,
  BORDER_INK_SHARE = 0.005,
  FACE_TOLERANCE = 2;
export const CARD_HEIGHT = PROFILE_SET_LIMITS.cardHeight,
  CARD_MAX_WIDTH = PROFILE_SET_LIMITS.cardMaxWidth,
  FACE_SIZE = PROFILE_SET_LIMITS.faceSize;
// The house sheets (kaito_web/assets/art/arena-faces-20261023) run from clean to haloed: 54–93 % of each cell above INK, a halo up to the
// sheet's edge. So a sheet is checked only for real transparency and a figure in every cell, never for a clear border.
const SHEET_CLEAR_SHARE = 0.05,
  SHEET_CELL_INK_SHARE = 0.1;
/** @typedef {{ code: string, path: string }} CheckError */
/**
 * @typedef {{ ok: true, errors: [], card: Buffer, face: Buffer,
 *   derived: { card: { width: number, height: number, face: { x: number, y: number, side: number } }, face: { size: number } } }
 *   | { ok: false, errors: CheckError[] }} ProfileSetCheck
 */

/**
 * @param {Buffer} buffer  the front painting's bytes, already size- and hash-checked against the set file
 * @param {{ front: { width: number, height: number }, face: { x: number, y: number, side: number } }} set
 * @returns {Promise<ProfileSetCheck>}
 */
export async function checkProfileSet(buffer, set) {
  /** @type {(code: string, path?: string) => ProfileSetCheck} */
  const fail = (code, path = '/front') => ({ ok: false, errors: [{ code, path }] });
  // Reject other formats before handing the bytes to a decoder.
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return fail('FRONT_ENCODING');
  const source = () => sharp(buffer, { limitInputPixels: PROFILE_SET_PIXELS, failOn: 'warning' });
  let rgba, info;
  try {
    const metadata = await source().metadata();
    if (metadata.format !== 'webp' || (metadata.pages ?? 1) !== 1 || !metadata.hasAlpha) return fail('FRONT_ENCODING');
    if (metadata.width !== set.front.width || metadata.height !== set.front.height) return fail('FRONT_DIMENSIONS');
    if (!metadata.height || !metadata.width || metadata.height <= metadata.width) return fail('FRONT_ORIENTATION');
    // The header is not enough: decode every pixel.
    ({ data: rgba, info } = await source().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
  } catch {
    return fail('FRONT_DECODE');
  }
  const width = info.width,
    height = info.height,
    channels = info.channels;
  /** @type {(x: number, y: number) => number} */
  const alpha = (x, y) => rgba[(y * width + x) * channels + 3];
  /** @type {CheckError[]} */
  const errors = [];
  // A transparent background: the outer band holds almost no ink.
  let border = 0,
    borderInk = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (x >= BORDER && y >= BORDER && x < width - BORDER && y < height - BORDER) {
        x = width - BORDER - 1;
        continue;
      }
      border++;
      if (alpha(x, y) > INK) borderInk++;
    }
  if (borderInk > border * BORDER_INK_SHARE) errors.push({ code: 'FRONT_BACKGROUND', path: '/front' });
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (alpha(x, y) > INK) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  if (right < 0) return fail('FRONT_EMPTY');
  const figureHeight = bottom - top + 1,
    figureWidth = right - left + 1;
  if (figureHeight < height * 0.6) errors.push({ code: 'FIGURE_HEIGHT', path: '/front' });
  const face = set.face;
  if (
    face.x < left - FACE_TOLERANCE ||
    face.y < top - FACE_TOLERANCE ||
    face.x + face.side > right + 1 + FACE_TOLERANCE ||
    face.y + face.side > bottom + 1 + FACE_TOLERANCE
  )
    errors.push({ code: 'FACE_OUTSIDE_FIGURE', path: '/face' });
  if (face.side < figureHeight * 0.1 || face.side > figureHeight * 0.3) errors.push({ code: 'FACE_SIZE', path: '/face/side' });
  if (face.y + face.side / 2 - top > figureHeight * 0.4) errors.push({ code: 'FACE_POSITION', path: '/face' });
  const scale = CARD_HEIGHT / figureHeight,
    cardWidth = Math.max(1, Math.round(figureWidth * scale));
  // The card stands in a tall slot: a character wider than tall does not fit it.
  if (cardWidth > CARD_MAX_WIDTH) errors.push({ code: 'FIGURE_WIDTH', path: '/front' });
  if (errors.length) return { ok: false, errors };
  // Past the decode, a failure to cut or encode is still this painting's verdict, not the worker's.
  let card, faceImage;
  try {
    card = await source()
      .extract({ left, top, width: figureWidth, height: figureHeight })
      .resize({ width: cardWidth, height: CARD_HEIGHT, fit: 'fill' })
      .webp({ quality: 86, alphaQuality: 100, effort: 4 })
      .toBuffer();
    faceImage = await source()
      .extract({ left: face.x, top: face.y, width: face.side, height: face.side })
      .resize({ width: FACE_SIZE, height: FACE_SIZE, fit: 'fill' })
      .webp({ quality: 86, alphaQuality: 100, effort: 4 })
      .toBuffer();
  } catch {
    return fail('DERIVE_FAILED');
  }
  if (card.length > PROFILE_SET_LIMITS.derivedBytes || faceImage.length > PROFILE_SET_LIMITS.derivedBytes) return fail('DERIVED_TOO_LARGE');
  // The face square in the card's pixels, kept inside the card.
  const x = Math.min(Math.max(0, Math.round((face.x - left) * scale)), cardWidth - 1),
    y = Math.min(Math.max(0, Math.round((face.y - top) * scale)), CARD_HEIGHT - 1);
  const side = Math.max(1, Math.min(Math.round(face.side * scale), cardWidth - x, CARD_HEIGHT - y));
  return {
    ok: true,
    errors: [],
    card,
    face: faceImage,
    derived: { card: { width: cardWidth, height: CARD_HEIGHT, face: { x, y, side } }, face: { size: FACE_SIZE } },
  };
}

/** @typedef {{ ok: true, errors: [], sheet: Buffer, derived: { width: number, height: number, cell: number } } | { ok: false, errors: CheckError[] }} SheetCheck */
/**
 * His expression sheet: a single-frame WebP with alpha at exactly the set file's size, every pixel decoded, some of it clear and a figure
 * in each of its cells; then the arena's copy (the house sheets' size and encoding, import-arena-faces.mjs).
 * @param {Buffer} buffer  the sheet's bytes, already size- and hash-checked against the set file
 * @returns {Promise<SheetCheck>}
 */
export async function checkExpressionSheet(buffer) {
  const limits = PROFILE_SET_LIMITS.expressions,
    out = PROFILE_SET_LIMITS.sheet;
  /** @type {(code: string) => SheetCheck} */
  const fail = code => ({ ok: false, errors: [{ code, path: '/expressions' }] });
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return fail('EXPRESSIONS_ENCODING');
  const source = () => sharp(buffer, { limitInputPixels: PROFILE_SET_PIXELS, failOn: 'warning' });
  let rgba, info;
  try {
    const metadata = await source().metadata();
    if (metadata.format !== 'webp' || (metadata.pages ?? 1) !== 1 || !metadata.hasAlpha) return fail('EXPRESSIONS_ENCODING');
    if (metadata.width !== limits.width || metadata.height !== limits.height) return fail('EXPRESSIONS_DIMENSIONS');
    ({ data: rgba, info } = await source().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
  } catch {
    return fail('EXPRESSIONS_DECODE');
  }
  const width = info.width,
    channels = info.channels,
    cell = width / limits.columns;
  let clear = 0;
  /** @type {number[]} */
  const ink = new Array(limits.columns * limits.rows).fill(0);
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * channels + 3] > INK) ink[Math.floor(y / cell) * limits.columns + Math.floor(x / cell)]++;
      else clear++;
    }
  if (clear < width * info.height * SHEET_CLEAR_SHARE) return fail('EXPRESSIONS_BACKGROUND');
  if (ink.some(count => count < cell * cell * SHEET_CELL_INK_SHARE)) return fail('EXPRESSIONS_EMPTY_CELL');
  let sheet;
  try {
    sheet = await source()
      .resize({ width: out.width, height: out.height, kernel: 'lanczos3', fit: 'fill' })
      .webp({ quality: 88, alphaQuality: 100, effort: 4 })
      .toBuffer();
  } catch {
    return fail('DERIVE_FAILED');
  }
  if (sheet.length > PROFILE_SET_LIMITS.derivedBytes) return fail('DERIVED_TOO_LARGE');
  return { ok: true, errors: [], sheet, derived: { width: out.width, height: out.height, cell: out.cell } };
}
