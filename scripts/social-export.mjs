// @ts-check
// A finished fighter as files to post on X (2026-11-12): his motions as MP4 and GIF loops, a showcase that ends on his card, his six faces as
// reaction loops and stickers, a four-picture post and the text to start it with. Only reads the package and the profile set and writes a
// new folder; nothing is generated, so no generation quota is spent and a submitted package is never touched. A Grok clip of a face is a
// separate, requested generation: `grok-face` prepares its still and prompt and prints the sprite-gen command without running it, and
// `--add-clip` brings the finished clip into an export.
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { PROFILE_SET_LIMITS } from '../api/profile-set-contract.mjs';
import { REPLY_LINK, X_LIMITS, canvasSize, checkX, intentUrl } from './social/budget.mjs';
import { EncodeFailure, encodeMp4, fitVideo, mp4ToGif, probe, toolsReady } from './social/encode.mjs';
import { cornerMark, endCard } from './social/endcard.mjs';
import { POSTABLE, SHOWCASE, clipSteps, cellRect, frameExtent, placeFrame, repeatsFor, resample, stageFor } from './social/frames.mjs';
import { EXPRESSIONS, PRESETS, presetPose } from './social/presets.mjs';

const FPS = 30;
const REACTION_SIZE = 512;
const END_CARD_MS = 1800;
// A reply GIF should load at once: the encoder tries a lower rate, then a smaller picture, before it settles for X's 15 MB.
const REACTION_GIF_BYTES = 3 * 1024 * 1024;
const HASHTAGS = ['ODDBOUT', 'ODDBOUTme'];
/** The house preview background and its night twin. */
const BACKGROUNDS = /** @type {const} */ ({ light: { r: 236, g: 240, b: 246 }, dark: { r: 22, g: 24, b: 30 } });

/** @typedef {import('./social/frames.mjs').Clip} Clip */
/** @typedef {{ r: number, g: number, b: number }} Colour */
/** @typedef {{ path: string, kind: 'video' | 'gif' | 'image', bytes: number, sha256: string, width: number, height: number, frames?: number,
 *   seconds?: number, fps?: number, x: { ok: boolean, problems: string[] } }} Written */

class SocialFailure extends Error {
  /** @param {string} code @param {string} [detail] */
  constructor(code, detail) {
    super(code);
    this.detail = detail;
  }
}

/** @param {Buffer} bytes */
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** @param {string} file */
const exists = file =>
  lstat(file).then(
    () => true,
    () => false,
  );
/** `inner` is `outer` or inside it. @param {string} outer @param {string} inner */
const within = (outer, inner) => {
  const relative = path.relative(outer, inner);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

/** `light`, `dark` or a #rrggbb colour. @param {string} value @returns {Colour | null} */
export function parseBackground(value) {
  if (value === 'light' || value === 'dark') return { ...BACKGROUNDS[value] };
  const hex = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!hex) return null;
  const n = parseInt(hex[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
/** @param {Colour} c */
const hexOf = c => '0x' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');

/**
 * The package's fighter.json and its sheets, each checked against the hash the package declares: an export of a changed package would
 * show something other than what was submitted.
 * @param {string} dir
 */
async function readPackage(dir) {
  let fighter;
  try {
    fighter = JSON.parse(await readFile(path.join(dir, 'fighter.json'), 'utf8'));
  } catch {
    throw new SocialFailure('PACKAGE_UNREADABLE', path.join(dir, 'fighter.json'));
  }
  if (!fighter?.clips || !Array.isArray(fighter.assets)) throw new SocialFailure('PACKAGE_UNREADABLE', 'fighter.json has no clips or assets');
  /** @type {Map<string, Buffer>} */
  const sheets = new Map();
  for (const asset of fighter.assets) {
    const file = path.join(dir, asset.path);
    if (!within(dir, file)) throw new SocialFailure('ASSET_PATH', asset.path);
    let bytes;
    try {
      bytes = await readFile(file);
    } catch {
      throw new SocialFailure('ASSET_MISSING', asset.path);
    }
    if (asset.sha256 && sha256(bytes) !== asset.sha256) throw new SocialFailure('ASSET_CHANGED', `${asset.path} does not match its sha256 in fighter.json`);
    sheets.set(asset.id, bytes);
  }
  return { fighter, sheets };
}

/** The profile set's front, face square and expression sheet (optional), as their bytes. @param {string} dir */
async function readProfileSet(dir) {
  let set;
  try {
    set = JSON.parse(await readFile(path.join(dir, 'profile-set.json'), 'utf8'));
  } catch {
    throw new SocialFailure('PROFILE_SET_UNREADABLE', path.join(dir, 'profile-set.json'));
  }
  /** @param {{ path: string, sha256?: string } | undefined} entry */
  const load = async entry => {
    if (!entry) return null;
    const file = path.join(dir, entry.path);
    if (!within(dir, file)) throw new SocialFailure('ASSET_PATH', entry.path);
    const bytes = await readFile(file).catch(() => {
      throw new SocialFailure('ASSET_MISSING', entry.path);
    });
    if (entry.sha256 && sha256(bytes) !== entry.sha256) throw new SocialFailure('ASSET_CHANGED', `${entry.path} does not match profile-set.json`);
    return bytes;
  };
  return { set, front: await load(set.front), expressions: await load(set.expressions) };
}

/**
 * The six faces as transparent PNGs: the sheet's cells when the set has one, else the front's face square for each (the arena does the
 * same without a sheet).
 * @param {{ set: any, front: Buffer | null, expressions: Buffer | null }} profile
 * @returns {Promise<{ source: 'sheet' | 'face-square', faces: Map<string, Buffer> }>}
 */
export async function faceCells(profile) {
  /** @type {Map<string, Buffer>} */
  const faces = new Map();
  if (profile.expressions) {
    const meta = await sharp(profile.expressions).metadata();
    const { columns, rows } = PROFILE_SET_LIMITS.expressions;
    const cellWidth = Math.floor((meta.width ?? 0) / columns),
      cellHeight = Math.floor((meta.height ?? 0) / rows);
    for (const [i, face] of EXPRESSIONS.entries()) {
      const cell = await sharp(profile.expressions)
        .extract({ left: (i % columns) * cellWidth, top: Math.floor(i / columns) * cellHeight, width: cellWidth, height: cellHeight })
        .resize({ width: REACTION_SIZE, height: REACTION_SIZE, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      faces.set(face, cell);
    }
    return { source: 'sheet', faces };
  }
  if (!profile.front || !profile.set?.face) throw new SocialFailure('NO_FACES', 'The profile set has neither an expression sheet nor a front with a face square');
  const { x, y, side } = profile.set.face;
  const square = await sharp(profile.front).extract({ left: x, top: y, width: side, height: side }).resize(REACTION_SIZE, REACTION_SIZE).png().toBuffer();
  for (const face of EXPRESSIONS) faces.set(face, square);
  return { source: 'face-square', faces };
}

/**
 * How far each of a clip's frames reaches from its origin, measured on its drawn pixels (the cells carry transparent room).
 * @param {Clip} clip @param {Buffer} sheet
 */
async function clipReach(clip, sheet) {
  const extents = [];
  for (const frame of new Set(clipSteps(clip).map(step => step.frame))) {
    const { data, info } = await sharp(sheet).extract(cellRect(clip, frame)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let left = info.width,
      top = info.height,
      right = 0,
      bottom = 0;
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++)
        if (data[(y * info.width + x) * info.channels + 3] > 16) {
          if (x < left) left = x;
          if (x >= right) right = x + 1;
          if (y < top) top = y;
          if (y >= bottom) bottom = y + 1;
        }
    extents.push(frameExtent(clip, frame, right > left ? { left, top, right, bottom } : null));
  }
  return extents;
}

/**
 * A clip's frames on the stage, each as the canvas's RGB pixels, one per distinct cell (a sequence that shows a frame twice reuses it).
 * @param {Clip} clip @param {Buffer} sheet @param {import('./social/frames.mjs').Stage} stage
 * @param {{ width: number, height: number, background: Colour, mark: Buffer | null }} canvas
 */
async function stageFrames(clip, sheet, stage, { width, height, background, mark }) {
  /** @type {Map<number, Buffer>} */
  const frames = new Map();
  for (const frame of new Set(clipSteps(clip).map(step => step.frame))) {
    const place = placeFrame(clip, frame, stage);
    const cell = await sharp(sheet).extract(cellRect(clip, frame)).resize(place.width, place.height, { kernel: 'lanczos3' }).png().toBuffer();
    // A cell larger than the canvas at its place is cropped to the part that shows.
    const left = Math.max(0, -place.left),
      top = Math.max(0, -place.top);
    const visible = await sharp(cell)
      .extract({ left, top, width: Math.min(place.width - left, width - Math.max(0, place.left)), height: Math.min(place.height - top, height - Math.max(0, place.top)) })
      .toBuffer();
    /** @type {import('sharp').OverlayOptions[]} */
    const layers = [{ input: visible, left: Math.max(0, place.left), top: Math.max(0, place.top) }];
    if (mark) layers.push({ input: mark, left: 0, top: 0 });
    frames.set(frame, await sharp({ create: { width, height, channels: 3, background } }).composite(layers).removeAlpha().raw().toBuffer());
  }
  return frames;
}

/** A face's reaction loop as RGB frames on `size` square: its preset moved over the painted cell. @param {string} face @param {Buffer} cell @param {number} size @param {Colour} background @param {Buffer | null} mark */
async function reactionFrames(face, cell, size, background, mark) {
  const preset = PRESETS[/** @type {keyof typeof PRESETS} */ (face)] ?? PRESETS.default;
  const count = Math.round((preset.ms / 1000) * FPS);
  const base = Math.round(size * 0.84);
  /** @type {Buffer[]} */
  const frames = [];
  for (let i = 0; i < count; i++) {
    const pose = presetPose(face, i / count);
    const side = Math.max(2, Math.round(base * pose.scale));
    let moved = sharp(await sharp(cell).resize(side, side, { kernel: 'lanczos3' }).png().toBuffer());
    if (pose.rotate) moved = moved.rotate(pose.rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    const picture = await moved.png().toBuffer();
    const meta = await sharp(picture).metadata();
    const w = meta.width ?? side,
      h = meta.height ?? side;
    const left = Math.round((size - w) / 2 + pose.dx * size),
      top = Math.round((size - h) / 2 + pose.dy * size + size * 0.03);
    // Crop what falls outside the square (a push-in or a sway), then lay it on the background.
    const cropLeft = Math.max(0, -left),
      cropTop = Math.max(0, -top);
    const shown = await sharp(picture)
      .extract({ left: cropLeft, top: cropTop, width: Math.min(w - cropLeft, size - Math.max(0, left)), height: Math.min(h - cropTop, size - Math.max(0, top)) })
      .toBuffer();
    /** @type {import('sharp').OverlayOptions[]} */
    const layers = [{ input: shown, left: Math.max(0, left), top: Math.max(0, top) }];
    if (pose.flash > 0)
      layers.push({ input: { create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: pose.flash } } }, left: 0, top: 0 });
    if (mark) layers.push({ input: mark, left: 0, top: 0 });
    frames.push(await sharp({ create: { width: size, height: size, channels: 3, background } }).composite(layers).removeAlpha().raw().toBuffer());
  }
  return frames;
}

/**
 * Write a video and its GIF from RGB frames, and measure both.
 * @param {Buffer[]} frames @param {{ width: number, height: number, folder: string, name: string, gif: boolean, silentAudio: boolean, gifBytes?: number }} options
 * @returns {Promise<Written[]>}
 */
async function writeMotion(frames, { width, height, folder, name, gif, silentAudio, gifBytes = 8 * 1024 * 1024 }) {
  const mp4 = path.join(folder, `${name}.mp4`);
  await encodeMp4(frames, { width, height, fps: FPS, out: mp4, silentAudio });
  const video = await probe(mp4);
  /** @type {Written[]} */
  const written = [await describe(mp4, 'video', video)];
  if (gif) {
    const out = path.join(folder, `${name}.gif`);
    const measured = await mp4ToGif(mp4, out, { width, height, seconds: frames.length / FPS, fps: FPS }, gifBytes);
    written.push(await describe(out, 'gif', measured));
  }
  return written;
}

/** @param {string} file @param {'video' | 'gif' | 'image'} kind @param {{ bytes: number, width: number, height: number, frames?: number, seconds?: number, fps?: number }} facts @returns {Promise<Written>} */
async function describe(file, kind, facts) {
  const bytes = await readFile(file);
  const { width, height, frames, seconds, fps } = facts;
  return {
    path: file,
    kind,
    bytes: bytes.length,
    sha256: sha256(bytes),
    width,
    height,
    ...(frames !== undefined ? { frames } : {}),
    ...(seconds !== undefined ? { seconds: Math.round(seconds * 1000) / 1000 } : {}),
    ...(fps !== undefined ? { fps: Math.round(fps * 100) / 100 } : {}),
    x: checkX(kind, { ...facts, bytes: bytes.length }),
  };
}

/** The suggested post text, in the fighter's language and English. @param {string} name @param {string} language */
export function captions(name, language) {
  const ko = `${name}, 내가 만든 캐릭터가 싸운다 🥊 ODDBOUT에서 내 선수로 데뷔`;
  const en = `Meet ${name} — my own character, now a fighter 🥊 Made in ODDBOUT`;
  return language === 'ko' ? [ko, en] : [en, ko];
}

/** POST.md: what each file is for, the post links, and where the link goes. @param {{ name: string, language: string, files: Written[], out: string, faceSource: string | null }} options */
function postGuide({ name, language, files, out, faceSource }) {
  const [first, second] = captions(name, language);
  const rel = (/** @type {string} */ file) => path.relative(out, file).replaceAll('\\', '/');
  const list = (/** @type {string} */ dir) =>
    files
      .filter(f => rel(f.path).startsWith(dir))
      .map(f => `- \`${rel(f.path)}\` — ${f.kind}, ${f.width}×${f.height}, ${(f.bytes / 1024).toFixed(0)} KB${f.seconds ? `, ${f.seconds}s` : ''}${f.x.ok ? '' : ` (over X's limits: ${f.x.problems.join('; ')})`}`)
      .join('\n');
  return `# ${name} on X

Post from your own account. Attach the file yourself; the links below only fill in the text.

## 1. Introduce your fighter — four pictures

Attach \`post-set/1.png\` … \`post-set/4.png\` (X takes four pictures in one post).

- ${language === 'ko' ? '한국어' : 'English'}: [${first}](${intentUrl(first, HASHTAGS)})
- ${language === 'ko' ? 'English' : '한국어'}: [${second}](${intentUrl(second, HASHTAGS)})

Put the link in your first reply, not in the post: ${REPLY_LINK}

## 2. Show the moves — one video

\`showcase.mp4\` (ends on the fighter's card). Each motion is in \`clips/\` too:

${list('clips/')}

## 3. Reply with a face — reaction GIFs

${
  faceSource
    ? `X has no custom stickers; reply with a face as a GIF${faceSource === 'face-square' ? ' (this set has no expression sheet: every face is the face square of the front painting, each with its own move)' : ''}:

${list('reactions/')}

The transparent PNGs (\`reactions/<face>.png\`) are stickers for apps that take them.`
    : 'No profile set was given, so there are no faces. Export again with `--profile-set <folder>` for the reaction GIFs.'
}

## Before you post

- X's limits were checked on these files; only an upload shows X took them.
- This is your own character. Do not post another person's character as yours.
`;
}

/**
 * Export a finished fighter for X. `out` must not exist and must not be inside the package or the profile set.
 * @param {{ packageDir: string, profileSetDir?: string | null, out: string, size?: number, aspect?: '1:1' | '16:9', background?: Colour,
 *   endcard?: boolean, clips?: string[] | null, gif?: boolean, silentAudio?: boolean, addClips?: string[] }} options
 */
export async function exportSocial({
  packageDir,
  profileSetDir = null,
  out,
  size = 720,
  aspect = '1:1',
  background = { ...BACKGROUNDS.light },
  endcard = true,
  clips: only = null,
  gif = true,
  silentAudio = false,
  addClips = [],
}) {
  try {
    if (await exists(out)) throw new SocialFailure('OUTPUT_EXISTS', out);
    for (const source of [packageDir, profileSetDir]) if (source && within(source, out)) throw new SocialFailure('OUTPUT_INSIDE_SOURCE', out);
    const missing = toolsReady();
    if (missing.length) throw new SocialFailure('TOOL_MISSING', `${missing.join(', ')} not found; npm run sprite:status says how to install them`);
    const { fighter, sheets } = await readPackage(packageDir);
    const profile = profileSetDir ? await readProfileSet(profileSetDir) : null;
    const name = String(fighter.profile?.name ?? fighter.localId ?? 'fighter');
    const language = String(fighter.profile?.language ?? 'en');
    const { width, height } = canvasSize(size, aspect);
    if (width > X_LIMITS.video.width || height > X_LIMITS.video.height) throw new SocialFailure('SIZE', `${width}x${height} is over X's video size`);

    /** @type {[string, Clip][]} */
    const chosen = POSTABLE.filter(clip => fighter.clips[clip] && (!only || only.includes(clip))).map(clip => [clip, fighter.clips[clip]]);
    if (only) for (const clip of only) if (!fighter.clips[clip]) throw new SocialFailure('CLIP_MISSING', clip);
    const showcase = SHOWCASE.filter(clip => fighter.clips[clip]);
    const mark = endcard ? await cornerMark(width, height, background) : null;
    /** @param {string} clipName */
    const sheetOf = clipName => {
      const sheet = sheets.get(fighter.clips[clipName].assetId);
      if (!sheet) throw new SocialFailure('ASSET_MISSING', fighter.clips[clipName].assetId);
      return sheet;
    };
    // How far each clip's drawn pixels reach from its origins: a clip on its own fills the canvas, the showcase shares one stage.
    /** @type {Map<string, import('./social/frames.mjs').Extent[]>} */
    const reach = new Map();
    for (const clipName of new Set([...chosen.map(([clipName]) => clipName), ...showcase]))
      reach.set(clipName, await clipReach(fighter.clips[clipName], sheetOf(clipName)));
    const showStage = stageFor(showcase.flatMap(clipName => reach.get(clipName) ?? []), width, height);
    /** @param {string} clipName @param {import('./social/frames.mjs').Stage} stage */
    const framesOf = async (clipName, stage) => ({
      frames: await stageFrames(fighter.clips[clipName], sheetOf(clipName), stage, { width, height, background, mark }),
      steps: clipSteps(fighter.clips[clipName]),
    });

    const temporary = `${out}.partial-${process.pid}`;
    await rm(temporary, { recursive: true, force: true });
    for (const dir of ['clips', 'reactions', 'post-set']) await mkdir(path.join(temporary, dir), { recursive: true });
    /** @type {Written[]} */
    const files = [];

    // Each motion on its own, repeated to a few seconds.
    for (const [clipName, clip] of chosen) {
      const { frames, steps } = await framesOf(clipName, stageFor(reach.get(clipName) ?? [], width, height));
      const total = steps.reduce((sum, step) => sum + step.durationMs, 0);
      const order = resample(steps, FPS, repeatsFor(total, Boolean(clip.loop)));
      files.push(...(await writeMotion(order.map(i => /** @type {Buffer} */ (frames.get(steps[i].frame))), { width, height, folder: path.join(temporary, 'clips'), name: clipName, gif, silentAudio })));
    }

    // The faces, when the export has a profile set.
    const faces = profile ? await faceCells(profile) : null;
    const reactionMark = endcard ? await cornerMark(REACTION_SIZE, REACTION_SIZE, background) : null;
    if (faces) {
      for (const [face, cell] of faces.faces) {
        await writeFile(path.join(temporary, 'reactions', `${face}.png`), cell);
        files.push(await describe(path.join(temporary, 'reactions', `${face}.png`), 'image', { bytes: cell.length, width: REACTION_SIZE, height: REACTION_SIZE }));
        const frames = await reactionFrames(face, cell, REACTION_SIZE, background, reactionMark);
        files.push(...(await writeMotion(frames, { width: REACTION_SIZE, height: REACTION_SIZE, folder: path.join(temporary, 'reactions'), name: face, gif, silentAudio, gifBytes: REACTION_GIF_BYTES })));
      }
    }

    // The showcase: his idle stance, his attacks, then his card.
    /** @type {Buffer[]} */
    const reel = [];
    for (const clipName of showcase) {
      const { frames, steps } = await framesOf(clipName, showStage);
      const total = steps.reduce((sum, step) => sum + step.durationMs, 0);
      const repeats = clipName === 'fightIdle' || clipName === 'victory' ? Math.max(1, Math.ceil(1200 / Math.max(1, total))) : 1;
      for (const i of resample(steps, FPS, repeats)) reel.push(/** @type {Buffer} */ (frames.get(steps[i].frame)));
    }
    if (endcard && reel.length) {
      const card = await endCard({ width, height, background, name, front: profile?.front ?? null, faces: faces ? [...new Set(faces.faces.values())] : [] });
      for (let i = 0; i < Math.round((END_CARD_MS / 1000) * FPS); i++) reel.push(card);
    }
    if (reel.length) files.push(...(await writeMotion(reel, { width, height, folder: temporary, name: 'showcase', gif: false, silentAudio })));

    // Four pictures: the front, then three faces (his attacks' key frames when he has no sheet).
    const still = async (/** @type {Buffer} */ picture, /** @type {number} */ index) => {
      const side = 1200;
      const fitted = await sharp(picture).resize({ width: Math.round(side * 0.88), height: Math.round(side * 0.88), fit: 'inside' }).png().toBuffer();
      const meta = await sharp(fitted).metadata();
      const file = path.join(temporary, 'post-set', `${index}.png`);
      const bytes = await sharp({ create: { width: side, height: side, channels: 3, background } })
        .composite([{ input: fitted, left: Math.round((side - (meta.width ?? side)) / 2), top: Math.round((side - (meta.height ?? side)) / 2) }])
        .png({ compressionLevel: 9 })
        .toBuffer();
      await writeFile(file, bytes);
      files.push(await describe(file, 'image', { bytes: bytes.length, width: side, height: side }));
    };
    /** @type {Buffer[]} */
    const pictures = [];
    if (profile?.front) pictures.push(profile.front);
    if (faces?.source === 'sheet') for (const face of ['smug', 'sideeye', 'ko']) pictures.push(/** @type {Buffer} */ (faces.faces.get(face)));
    for (const clipName of ['combo', 'slam', 'dash', 'skill', 'fightIdle', 'victory']) {
      if (pictures.length >= X_LIMITS.imagesPerPost || !fighter.clips[clipName]) continue;
      const clip = fighter.clips[clipName];
      const steps = clipSteps(clip);
      const key = clip.hitSequenceIndices?.[0] ?? Math.floor(steps.length / 2);
      const cell = await sharp(/** @type {Buffer} */ (sheets.get(clip.assetId))).extract(cellRect(clip, steps[key]?.frame ?? 0)).png().toBuffer();
      // Clips may share a sheet and a key frame: the same picture twice would waste one of the post's four.
      if (!pictures.some(known => known.equals(cell))) pictures.push(cell);
    }
    for (const [i, picture] of pictures.slice(0, X_LIMITS.imagesPerPost).entries()) await still(picture, i + 1);

    // Finished clips from elsewhere (a requested Grok clip of a face), fitted to the canvas with the same mark.
    for (const source of addClips) {
      const base = path.basename(source, path.extname(source)).replace(/[^\w.-]+/g, '-');
      const markFile = mark ? path.join(temporary, `.mark-${process.pid}.png`) : null;
      if (markFile && mark) await writeFile(markFile, mark);
      const mp4 = path.join(temporary, 'clips', `added-${base}.mp4`);
      fitVideo(source, mp4, { width, height, background: hexOf(background), overlay: markFile });
      if (markFile) await rm(markFile, { force: true });
      const measured = await probe(mp4);
      files.push(await describe(mp4, 'video', measured));
      if (gif) {
        const out = path.join(temporary, 'clips', `added-${base}.gif`);
        files.push(await describe(out, 'gif', await mp4ToGif(mp4, out, { width, height, seconds: measured.seconds, fps: measured.fps })));
      }
    }

    // The record, with each file's path inside the folder it ends in.
    const final = files.map(f => ({ ...f, path: path.relative(temporary, f.path).replaceAll('\\', '/') }));
    const record = {
      version: 'oddbout-social-export-v1',
      fighter: { name, localId: fighter.localId ?? null, language },
      source: { package: packageDir, profileSet: profileSetDir, faces: faces?.source ?? null },
      canvas: { width, height, fps: FPS, background, endcard },
      generated: false,
      files: final,
      xLimitsChecked: final.every(f => f.x.ok),
      note: "X's limits were checked on the files; only an upload shows X accepted them.",
    };
    await writeFile(path.join(temporary, 'social.json'), JSON.stringify(record, null, 2) + '\n');
    await writeFile(path.join(temporary, 'POST.md'), postGuide({ name, language, files, out: temporary, faceSource: faces?.source ?? null }));
    // A folder the export left empty (no faces without a profile set) is not part of it.
    for (const dir of ['clips', 'reactions', 'post-set'])
      if (!(await readdir(path.join(temporary, dir))).length) await rm(path.join(temporary, dir), { recursive: true });
    await rename(temporary, out);
    return {
      ok: true,
      stage: 'social-export-ready',
      folder: out,
      fighter: name,
      faces: faces?.source ?? null,
      files: final.map(f => ({ path: f.path, kind: f.kind, bytes: f.bytes, ...(f.seconds ? { seconds: f.seconds } : {}), xOk: f.x.ok })),
      xLimitsChecked: record.xLimitsChecked,
      show: ['showcase.mp4', ...(faces ? ['reactions/sideeye.gif', 'reactions/ko.gif'] : []), 'post-set/1.png'].map(f => path.join(out, f)),
      next: 'Show the showcase and two reactions to the user, then point them at POST.md. The user posts from their own X account.',
    };
  } catch (error) {
    if (error instanceof SocialFailure || error instanceof EncodeFailure)
      return { ok: false, stage: 'social-export', errors: [{ code: error.message, ...(error.detail ? { detail: error.detail } : {}) }] };
    throw error;
  }
}

/** The motion a Grok clip of each face asks for; the still opens and closes it, so the clip loops. */
export const GROK_FACE_MOTION = /** @type {const} */ ({
  default: 'a relaxed breath and a small confident nod, a slight smirk',
  hit: 'flinches back from an off-screen blow, wincing, then recovers',
  smug: 'a smug grin widens, chin lifts, a little shoulder shrug',
  danger: 'a nervous gulp, a bead of sweat runs down, eyes dart',
  sideeye: 'eyes slide slowly to the side in a judging side-eye, then hold',
  ko: 'dizzy, head wobbles in a small circle, eyes spinning',
});

/**
 * Prepare a Grok image-to-video clip of one face, without generating: the face on a flat square still, the prompt, and the sprite-gen command
 * the user's own Grok sign-in runs when they ask for it. Opening and closing on the same still makes the clip loop.
 * @param {{ profileSetDir: string, face: string, out: string, background?: Colour, seconds?: number }} options
 */
export async function prepareGrokFace({ profileSetDir, face, out, background = { ...BACKGROUNDS.light }, seconds = 6 }) {
  try {
    if (!(EXPRESSIONS).includes(face)) throw new SocialFailure('FACE_UNKNOWN', `${face}; one of ${EXPRESSIONS.join(', ')}`);
    if (await exists(out)) throw new SocialFailure('OUTPUT_EXISTS', out);
    if (within(profileSetDir, out)) throw new SocialFailure('OUTPUT_INSIDE_SOURCE', out);
    const profile = await readProfileSet(profileSetDir);
    const faces = await faceCells(profile);
    const cell = /** @type {Buffer} */ (faces.faces.get(face));
    const side = 1024;
    const still = await sharp({ create: { width: side, height: side, channels: 3, background } })
      .composite([{ input: await sharp(cell).resize(Math.round(side * 0.8), Math.round(side * 0.8)).png().toBuffer(), gravity: 'centre' }])
      .png()
      .toBuffer();
    const prompt = [
      `Camera locked, framing unchanged. The character ${GROK_FACE_MOTION[/** @type {keyof typeof GROK_FACE_MOTION} */ (face)]}.`,
      'Keep the exact character design, colours and flat cel shading of the image; no new objects, no text, plain background unchanged.',
      'End on the same pose and framing as the first frame so the clip loops.',
    ].join(' ');
    const temporary = `${out}.partial-${process.pid}`;
    await rm(temporary, { recursive: true, force: true });
    await mkdir(temporary, { recursive: true });
    await writeFile(path.join(temporary, `${face}-still.png`), still);
    await writeFile(path.join(temporary, `${face}-prompt.txt`), prompt + '\n');
    await rename(temporary, out);
    const stillPath = path.join(out, `${face}-still.png`);
    const clip = path.join(out, `${face}-grok.mp4`);
    const report = path.join(out, `${face}-grok.report.json`);
    const command = [
      'npm', 'run', 'sprite', '--', 'video',
      '--image', stillPath, '--last-frame', stillPath,
      '--prompt-file', path.join(out, `${face}-prompt.txt`),
      '--aspect-ratio', '1:1', '--duration', String(seconds), '--resolution', '720p', '--no-audio',
      '--out', clip, '--report', report,
    ];
    return {
      ok: true,
      stage: 'grok-face-prepared',
      generated: false,
      folder: out,
      still: stillPath,
      faces: faces.source,
      command,
      then: ['npm', 'run', 'fighter:social', '--', '--package', '<package>', '--profile-set', profileSetDir, '--add-clip', clip, '--out', '<new folder>'],
      note:
        'Nothing was generated. Run the command only when the user asks for this Grok clip: it uses their own Grok sign-in and quota. If its outcome is unknown, ' +
        'recover it with `npm run sprite -- video-resume` from the report; never send it again.',
    };
  } catch (error) {
    if (error instanceof SocialFailure) return { ok: false, stage: 'grok-face', errors: [{ code: error.message, ...(error.detail ? { detail: error.detail } : {}) }] };
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const usage = [
    'Usage: npm run fighter:social -- --package <folder with fighter.json> [--profile-set <folder>] --out <new folder>',
    '         [--size 720|1024] [--aspect 1:1|16:9] [--bg light|dark|#rrggbb] [--no-endcard] [--clips combo,slam] [--no-gif] [--silent-audio]',
    '         [--add-clip <finished mp4>]...',
    '       npm run fighter:social -- grok-face --profile-set <folder> --face <default|hit|smug|danger|sideeye|ko> --out <new folder>',
  ].join('\n');
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        package: { type: 'string' },
        'profile-set': { type: 'string' },
        out: { type: 'string' },
        size: { type: 'string', default: '720' },
        aspect: { type: 'string', default: '1:1' },
        bg: { type: 'string', default: 'light' },
        'no-endcard': { type: 'boolean', default: false },
        clips: { type: 'string' },
        'no-gif': { type: 'boolean', default: false },
        'silent-audio': { type: 'boolean', default: false },
        'add-clip': { type: 'string', multiple: true },
        face: { type: 'string' },
        seconds: { type: 'string', default: '6' },
      },
      strict: true,
    });
  } catch {
    parsed = null;
  }
  const here = process.env.INIT_CWD || process.cwd();
  /** @param {string | undefined} value */
  const at = value => (value ? path.resolve(here, value) : null);
  const values = parsed?.values;
  const background = values ? parseBackground(values.bg) : null;
  const size = Number(values?.size);
  const command = parsed?.positionals[0];
  if (!values || !background || !values.out || (command && command !== 'grok-face')) {
    console.error(usage);
    process.exitCode = 2;
  } else if (command === 'grok-face') {
    const seconds = Number(values.seconds);
    if (!values['profile-set'] || !values.face || !Number.isInteger(seconds) || seconds < 1 || seconds > 15) {
      console.error(usage);
      process.exitCode = 2;
    } else {
      const result = await prepareGrokFace({ profileSetDir: /** @type {string} */ (at(values['profile-set'])), face: values.face, out: /** @type {string} */ (at(values.out)), background, seconds });
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? 0 : 1;
    }
  } else if (!values.package || ![720, 1024].includes(size) || !['1:1', '16:9'].includes(values.aspect)) {
    console.error(usage);
    process.exitCode = 2;
  } else {
    const result = await exportSocial({
      packageDir: /** @type {string} */ (at(values.package)),
      profileSetDir: at(values['profile-set']),
      out: /** @type {string} */ (at(values.out)),
      size,
      aspect: /** @type {'1:1' | '16:9'} */ (values.aspect),
      background,
      endcard: !values['no-endcard'],
      clips: values.clips ? values.clips.split(',').map(c => c.trim()).filter(Boolean) : null,
      gif: !values['no-gif'],
      silentAudio: values['silent-audio'],
      addClips: (values['add-clip'] ?? []).map(file => /** @type {string} */ (at(file))),
    });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  }
}
