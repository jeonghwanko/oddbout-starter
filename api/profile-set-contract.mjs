// @ts-check
// 선수 프로필 세트의 계약 (2026-10-31; 표정 시트 2026-11-03): the set file's version, limits, spec, colouring and sheet words, and its parse.
// No imports: the server API (profile-sets.mjs re-exports all of it), the Render validator's pixel check and the creator kit's
// `npm run fighter:profile-set` read the same rules, and the kit never ships the server API (scripts/build-plugin-bundle.mjs).
export const PROFILE_SET_VERSION = 'oddbout-profile-set-v1';
export const PROFILE_SET_LIMITS = Object.freeze({
  jsonBytes: 4000,
  frontBytes: 4000000,
  longSide: Object.freeze([1024, 2048]),
  shortSideMin: 512,
  faceMin: 16,
  derivedBytes: 1000000,
  cardHeight: 600,
  cardMaxWidth: 600,
  faceSize: 192,
  // The expression sheet (2026-11-03): the painted 3 × 2 sheet of 512-px cells, and the arena's runtime copy of 384-px cells (as the house
  // sheets: crashbang-heroes kaito_web/tools/art/import-arena-faces.mjs).
  expressionsBytes: 4000000,
  expressions: Object.freeze({ width: 1536, height: 1024, columns: 3, rows: 2 }),
  sheet: Object.freeze({ width: 1152, height: 768, cell: 384 }),
});
/** The sheet's cells, left to right and top to bottom: the game's ARENA_FACE_EXPRESSIONS (kaito_web/src/assets/ArenaFaceArtCatalog.ts). */
export const PROFILE_SET_EXPRESSIONS = Object.freeze(['default', 'hit', 'smug', 'danger', 'sideeye', 'ko']);
export const STYLE_ANCHOR_URL = 'https://oddbout.com/art/oddbout/style-anchor-front.webp';
/**
 * The house colouring every profile painting keeps (사용자 2026-10-31: "우리 아트스타일의 담백한 채색을 하도록 하는 것을 꼭 넣어줘"): the words
 * the house front concepts were generated with, and the style anchor attached as the last reference image.
 */
export const PROFILE_SET_STYLE = [
  'STYLE: clean painted 2D anime game illustration, the same rendering as the LAST image (the style anchor):',
  'warm dark line art (not pure black), restrained cel shading with soft painterly light, natural anatomy.',
  "COLOURING: OUR game's colouring, plain and restrained, exactly like the LAST image: flat clean cel colours with",
  'one soft shadow tone, warm dark line art (not pure black), a little soft painterly light.',
  'NOT semi-realistic, NOT heavy rendering, no glossy highlights, no dramatic lighting, no texture.',
  'Not pixel art, not chibi, not 3D, not photorealistic.',
  'The LAST image is the STYLE ANCHOR: match only its rendering, colouring, line weight, camera, framing and scale —',
  'do NOT copy its face, hair, body or costume.',
].join('\n');
/**
 * The expression sheet's request (사용자 2026-11-03: 무투장에서 패배했을 때 결과창의 표정): the words the house sheets were drawn with
 * (crashbang-heroes kaito_web/assets/art/arena-faces-20261023/*-prompt.txt), for any fighter. The approved front goes first, the style anchor last.
 */
export const PROFILE_SET_EXPRESSIONS_PROMPT = [
  "Expression sheet for a fighting-game HUD portrait. The FIRST image is this fighter's approved front painting: the same character, face,",
  'hair, outfit, accessories, colours and proportions. Do not redesign him.',
  'Layout: one 1536 x 1024 image, 3 columns x 2 rows, six equal square cells. Each cell holds the same head-and-shoulders bust, same size and',
  'same framing (the head fills about 70% of the cell height), turned to the right in a three-quarter view (he faces the right edge).',
  'Fully transparent background, no cell borders, no text, no numbers, no speech bubbles, no extra effects.',
  'Cells, left to right, top to bottom:',
  '1. Confident default: calm, cocky half smile.',
  '2. Just got hit: face squished sideways by an impact, eyes squeezed shut, cheek pushed in, mouth twisted in pain.',
  '3. Smug while comboing: big toothy grin, eyebrows raised, eyes narrowed with glee.',
  '4. In danger: heavy sweat drops, worried eyebrows, wide nervous eyes, clenched teeth.',
  '5. Winning side-eye: eyes looking sideways toward the viewer, smug and unimpressed (the meme side-eye).',
  '6. Knocked out: dizzy spiral eyes, tongue hanging out, slumped.',
].join('\n');
export const PROFILE_SET_SPEC = Object.freeze({
  version: PROFILE_SET_VERSION,
  purpose:
    "A registered fighter's front painting, face square and expression sheet: his profile, roster card, home face and the arena's faces. " +
    'The home lists a fighter only with an approved set. It is not part of the duel package: changing it never changes the package.',
  file: {
    name: 'profile-set.json',
    maxBytes: PROFILE_SET_LIMITS.jsonBytes,
    example: {
      version: PROFILE_SET_VERSION,
      front: { path: 'front.webp', bytes: 812345, sha256: '<64 hex>', width: 1024, height: 1536 },
      face: { x: 402, y: 96, side: 228 },
      expressions: { path: 'expressions.webp', bytes: 1234567, sha256: '<64 hex>', width: 1536, height: 1024 },
    },
  },
  build:
    'npm run fighter:profile-set -- --front <chosen front> [--expressions <sheet>] --out <folder>: frames the front, measures the face ' +
    'square, checks the sheet and writes front.webp, expressions.webp, profile-set.json and the previews to show (face-preview.png, ' +
    'ko-preview.png). Never type the sizes, hashes or the face square by hand.',
  front: {
    format: 'static WebP with a real alpha channel (transparent background)',
    maxBytes: PROFILE_SET_LIMITS.frontBytes,
    orientation: 'portrait: height greater than width',
    longSide: PROFILE_SET_LIMITS.longSide,
    shortSideMin: PROFILE_SET_LIMITS.shortSideMin,
    cardMaxWidth: PROFILE_SET_LIMITS.cardMaxWidth,
    framing: [
      'One character only, full body from head to feet.',
      'Front view: chest, face and toes toward the viewer; symmetric, not three-quarter.',
      "Camera at chest height looking straight ahead; no top-down tilt, no worm's-eye.",
      'Feet flat on one invisible ground line; head to feet about 86 percent of the image height, empty margin above the head and below the feet.',
      'Arms close to the body: the silhouette fits a tall narrow card (the character no wider than tall).',
      'No background, floor, cast shadow, scenery, frame, text, logo or other character. An item he always carries may stay.',
      'The same character, costume and colours as his side-view motions.',
    ],
  },
  face: {
    shape: "a square { x, y, side } in the front painting's pixels, holding the whole head and a little of the hair",
    rules: [
      'inside the painting and inside the character',
      "side 10–30 % of the character's height (head to feet)",
      'its centre in the top 40 % of the character',
    ],
  },
  expressions: {
    required: false,
    purpose:
      "His six arena faces. The face beside his HP bar changes with the bout (hit, combo, danger), and the KO card shows the loser's " +
      "ko face and the winner's side-eye. Without a sheet the arena shows his face square for every mood, his defeat included.",
    format: 'static WebP with a real alpha channel (transparent background)',
    maxBytes: PROFILE_SET_LIMITS.expressionsBytes,
    width: PROFILE_SET_LIMITS.expressions.width,
    height: PROFILE_SET_LIMITS.expressions.height,
    grid: { columns: PROFILE_SET_LIMITS.expressions.columns, rows: PROFILE_SET_LIMITS.expressions.rows, cell: 512 },
    order: PROFILE_SET_EXPRESSIONS,
    prompt: PROFILE_SET_EXPRESSIONS_PROMPT,
    references: 'The approved front painting FIRST, the style anchor LAST, with the colouring text: one generation for the six faces.',
  },
  style: {
    colouring: PROFILE_SET_STYLE,
    anchor: {
      url: STYLE_ANCHOR_URL,
      use:
        'Attach it as the LAST reference image of every generation (front candidates, the expression sheet, the side still, later edits). ' +
        "Follow only its rendering, colouring, line weight, camera, framing and scale. The user's reference pictures give the character, " +
        'costume and colours, never the colouring style.',
    },
  },
  order: [
    'brief',
    'two front candidates; the user picks or asks for a change',
    'the face square, shown to the user as a round crop',
    'the expression sheet from the chosen front, shown to the user with its ko face (his defeat face in the arena)',
    'one side still from the chosen front (same colouring)',
    'motions',
    'register the package',
    'prepare_profile_set → upload_profile_set_asset (front, then expressions) → submit_profile_set with the front and sheet the user chose',
    'enter after the motion review',
  ],
  later: 'A registered fighter without a sheet gets one with a new set: the same front, its face square and the new sheet.',
  review:
    "The validator decodes the files and makes a 600-px card, a 192-px face and the arena's 1152 × 768 sheet; an operator approves " +
    'the set before the roster shows it.',
});

/** @typedef {{ path: string, bytes: number, sha256: string, width: number, height: number }} FrontFile */
/** @typedef {{ x: number, y: number, side: number }} FaceSquare */
/** @typedef {{ version: string, front: FrontFile, face: FaceSquare, expressions?: FrontFile }} ProfileSetFile */

/** @type {(value: unknown) => boolean} */
const int = value => Number.isSafeInteger(value);
/** @param {unknown} value @returns {value is Record<string, any>} */
function object(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
/** @type {(value: Record<string, any>, keys: string[]) => boolean} */
const exactKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/**
 * A profile-set.json, checked: its shape, the painting's byte and size limits and the face square inside the painting. The validator
 * checks the decoded pixels later.
 * @param {string} text
 * @returns {{ ok: true, data: ProfileSetFile } | { ok: false, errors: { code: string, path: string }[] }}
 */
export function parseProfileSet(text) {
  /** @type {{ code: string, path: string }[]} */
  const errors = [];
  /** @type {(code: string, path: string) => { ok: false, errors: { code: string, path: string }[] }} */
  const fail = (code, path) => ({ ok: false, errors: [...errors, { code, path }] });
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return fail('INVALID_JSON', '');
  }
  if (!object(value) || !exactKeys(value, ['version', 'front', 'face', ...(Object.hasOwn(value, 'expressions') ? ['expressions'] : [])]))
    return fail('PROFILE_SET_KEYS', '');
  if (value.version !== PROFILE_SET_VERSION) return fail('PROFILE_SET_VERSION', '/version');
  const { front, face, expressions } = value;
  if (expressions !== undefined) {
    const limits = PROFILE_SET_LIMITS.expressions;
    if (!object(expressions) || !exactKeys(expressions, ['path', 'bytes', 'sha256', 'width', 'height'])) return fail('EXPRESSIONS_KEYS', '/expressions');
    if (
      typeof expressions.path !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,39}\.webp$/.test(expressions.path) ||
      (object(front) && expressions.path === front.path)
    )
      errors.push({ code: 'EXPRESSIONS_PATH', path: '/expressions/path' });
    if (!int(expressions.bytes) || expressions.bytes < 1 || expressions.bytes > PROFILE_SET_LIMITS.expressionsBytes)
      errors.push({ code: 'EXPRESSIONS_BYTES', path: '/expressions/bytes' });
    if (typeof expressions.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expressions.sha256))
      errors.push({ code: 'EXPRESSIONS_SHA256', path: '/expressions/sha256' });
    if (expressions.width !== limits.width || expressions.height !== limits.height) errors.push({ code: 'EXPRESSIONS_DIMENSIONS', path: '/expressions' });
  }
  if (!object(front) || !exactKeys(front, ['path', 'bytes', 'sha256', 'width', 'height'])) return fail('FRONT_KEYS', '/front');
  if (typeof front.path !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}\.webp$/.test(front.path)) errors.push({ code: 'FRONT_PATH', path: '/front/path' });
  if (!int(front.bytes) || front.bytes < 1 || front.bytes > PROFILE_SET_LIMITS.frontBytes) errors.push({ code: 'FRONT_BYTES', path: '/front/bytes' });
  if (typeof front.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(front.sha256)) errors.push({ code: 'FRONT_SHA256', path: '/front/sha256' });
  if (!int(front.width) || !int(front.height)) return fail('FRONT_DIMENSIONS', '/front');
  const long = Math.max(front.width, front.height),
    short = Math.min(front.width, front.height);
  if (long < PROFILE_SET_LIMITS.longSide[0] || long > PROFILE_SET_LIMITS.longSide[1] || short < PROFILE_SET_LIMITS.shortSideMin)
    errors.push({ code: 'FRONT_DIMENSIONS', path: '/front' });
  // A card stands tall: a landscape painting cannot hold a full-body front view at the roster's height.
  if (front.height <= front.width) errors.push({ code: 'FRONT_ORIENTATION', path: '/front' });
  if (!object(face) || !exactKeys(face, ['x', 'y', 'side']) || ![face.x, face.y, face.side].every(int)) return fail('FACE_KEYS', '/face');
  if (face.x < 0 || face.y < 0 || face.side < PROFILE_SET_LIMITS.faceMin || face.x + face.side > front.width || face.y + face.side > front.height)
    errors.push({ code: 'FACE_OUTSIDE', path: '/face' });
  if (errors.length) return { ok: false, errors };
  return { ok: true, data: /** @type {ProfileSetFile} */ (value) };
}

/** The files an owner uploads: the front painting, and the expression sheet when his set file names one. */
export const PROFILE_SET_ASSETS = Object.freeze(['front', 'expressions']);
