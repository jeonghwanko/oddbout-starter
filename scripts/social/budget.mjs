// @ts-check
// X's media limits for what an export writes, and the post a user starts from. The limits are X's published upload rules
// (docs.x.com/x-api/media, read 2026-11-12); the export checks its own files against them and says which passed, but only an actual
// upload proves X accepted one.

export const X_LIMITS = Object.freeze({
  gif: { bytes: 15 * 1024 * 1024, width: 1280, height: 1080, frames: 350, pixels: 300_000_000 },
  // maxSeconds is this export's own cap (its longest file is about 10 s), not X's limit: X allows far longer videos.
  video: { width: 1280, height: 1024, minSeconds: 0.5, maxSeconds: 140, maxFps: 60 },
  image: { bytes: 5 * 1024 * 1024 },
  imagesPerPost: 4,
});

/** Canvas sizes by aspect: 1024 is the largest square under X's 1024 video height. @param {number} size @param {'1:1' | '16:9'} aspect */
export function canvasSize(size, aspect) {
  const even = (/** @type {number} */ n) => Math.max(2, Math.round(n / 2) * 2);
  return aspect === '16:9' ? { width: even(Math.min(1280, (size * 16) / 9)), height: even(Math.min(720, size)) } : { width: even(size), height: even(size) };
}

/**
 * The GIF attempts from best to smallest for a clip of `frames` at `fps`, each within X's frame and pixel limits before its bytes are known:
 * fewer frames per second first, then a smaller picture.
 * @param {{ width: number, height: number, seconds: number, fps: number }} clip
 * @returns {{ width: number, height: number, fps: number }[]}
 */
export function gifAttempts({ width, height, seconds, fps }) {
  const { gif } = X_LIMITS;
  /** @type {{ width: number, height: number, fps: number }[]} */
  const attempts = [];
  for (const scale of [1, 0.75, 0.5, 0.375])
    for (const rate of [Math.min(fps, 25), 15, 12, 10]) {
      const w = Math.min(gif.width, Math.round((width * scale) / 2) * 2),
        h = Math.min(gif.height, Math.round((height * scale) / 2) * 2);
      const frames = Math.ceil(seconds * rate);
      if (frames > gif.frames || w * h * frames > gif.pixels) continue;
      if (!attempts.some(a => a.width === w && a.height === h && a.fps === rate)) attempts.push({ width: w, height: h, fps: rate });
    }
  return attempts;
}

/**
 * Which of X's limits a written file meets, from its measured facts. `ok` is the export's own check, not X's acceptance.
 * @param {'gif' | 'video' | 'image'} kind @param {{ bytes: number, width: number, height: number, frames?: number, seconds?: number, fps?: number }} file
 */
export function checkX(kind, file) {
  /** @type {string[]} */
  const problems = [];
  if (kind === 'gif') {
    const { gif } = X_LIMITS;
    if (file.bytes > gif.bytes) problems.push(`bytes ${file.bytes} > ${gif.bytes}`);
    if (file.width > gif.width || file.height > gif.height) problems.push(`size ${file.width}x${file.height} > ${gif.width}x${gif.height}`);
    if ((file.frames ?? 0) > gif.frames) problems.push(`frames ${file.frames} > ${gif.frames}`);
    if (file.width * file.height * (file.frames ?? 0) > gif.pixels) problems.push('pixels over 300M');
  } else if (kind === 'video') {
    const { video } = X_LIMITS;
    if (file.width > video.width || file.height > video.height) problems.push(`size ${file.width}x${file.height} > ${video.width}x${video.height}`);
    if (file.width % 2 || file.height % 2) problems.push('odd dimension');
    if ((file.seconds ?? 0) < video.minSeconds || (file.seconds ?? 0) > video.maxSeconds) problems.push(`length ${file.seconds}s`);
    if ((file.fps ?? 0) > video.maxFps) problems.push(`fps ${file.fps}`);
  } else if (file.bytes > X_LIMITS.image.bytes) problems.push(`bytes ${file.bytes} > ${X_LIMITS.image.bytes}`);
  return { ok: problems.length === 0, problems };
}

/**
 * X's post composer with `text` filled in (x.com/intent/post). The text is the fighter's name and the export's caption only; the link goes
 * in a reply, so it is not part of the text.
 * @param {string} text @param {string[]} [hashtags]
 */
export function intentUrl(text, hashtags = []) {
  const params = new URLSearchParams({ text });
  if (hashtags.length) params.set('hashtags', hashtags.map(tag => tag.replace(/^#/, '')).join(','));
  return `https://x.com/intent/post?${params}`;
}

/** The link a post's first reply carries, marked as coming from X so sign-ups from a post can be counted. */
export const REPLY_LINK = 'https://oddbout.com/?ref=x';
