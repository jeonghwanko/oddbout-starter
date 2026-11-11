// @ts-check
// ffmpeg for social files: rendered RGB frames to an H.264 MP4 X plays (yuv420p, even size, faststart), the MP4 to a looping GIF that fits
// X's GIF limits, and ffprobe's measurements of what was written. Nothing here reads or writes a package.
import { spawn, spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { checkX, gifAttempts } from './budget.mjs';

export class EncodeFailure extends Error {
  /** @param {string} code @param {string} [detail] */
  constructor(code, detail) {
    super(code);
    this.detail = detail;
  }
}

/** Whether ffmpeg and ffprobe run; the export needs both. */
export function toolsReady() {
  return ['ffmpeg', 'ffprobe'].filter(tool => spawnSync(tool, ['-version'], { stdio: 'ignore' }).status !== 0);
}

/**
 * Encode `frames` (each `width` × `height` × 3 bytes of RGB) at `fps` to an MP4. `silentAudio` adds a silent AAC track for an uploader that
 * wants one; X's own upload takes a video without sound.
 * @param {Iterable<Buffer> | AsyncIterable<Buffer>} frames @param {{ width: number, height: number, fps: number, out: string, silentAudio?: boolean, crf?: number }} options
 */
export async function encodeMp4(frames, { width, height, fps, out, silentAudio = false, crf = 18 }) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0'];
  if (silentAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', '-shortest', '-c:a', 'aac', '-b:a', '64k');
  args.push('-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out);
  const child = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let errors = '';
  child.stderr.on('data', chunk => (errors += chunk));
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve(undefined) : reject(new EncodeFailure('ENCODE_FAILED', errors.trim().slice(-800)))));
  });
  for await (const frame of frames)
    if (!child.stdin.write(frame)) await new Promise(resolve => child.stdin.once('drain', resolve));
  child.stdin.end();
  await done;
}

/** @param {string[]} args */
function run(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new EncodeFailure('ENCODE_FAILED', (result.stderr || '').trim().slice(-800));
}

/**
 * What ffprobe measures in a written file: its size, frame count, rate and length.
 * @param {string} file @returns {Promise<{ bytes: number, width: number, height: number, frames: number, fps: number, seconds: number, codec: string, audio: boolean }>}
 */
export async function probe(file) {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,width,height,nb_read_frames,r_frame_rate:format=duration', '-of', 'json', file],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new EncodeFailure('PROBE_FAILED', (result.stderr || '').trim());
  const data = JSON.parse(result.stdout);
  const video = data.streams.find((/** @type {any} */ s) => s.codec_type === 'video');
  const [num, den] = String(video.r_frame_rate).split('/').map(Number);
  return {
    bytes: (await stat(file)).size,
    width: video.width,
    height: video.height,
    frames: Number(video.nb_read_frames),
    fps: den ? num / den : num,
    seconds: Number(data.format.duration),
    codec: video.codec_name,
    audio: data.streams.some((/** @type {any} */ s) => s.codec_type === 'audio'),
  };
}

/**
 * The MP4 as a looping GIF within X's GIF limits: the first attempt within `targetBytes` (a reply GIF should load at once), trying fewer
 * frames per second, then a smaller picture; failing that, the first within X's own limits. Opaque only: a transparent GIF's edge shows on
 * one of X's light and dark themes.
 * @param {string} mp4 @param {string} out @param {{ width: number, height: number, seconds: number, fps: number }} clip @param {number} [targetBytes]
 */
export async function mp4ToGif(mp4, out, clip, targetBytes = Infinity) {
  /** @type {{ width: number, height: number, fps: number } | null} */
  let fallback = null;
  for (const attempt of gifAttempts(clip)) {
    gif(mp4, out, attempt);
    const measured = await probe(out);
    if (!checkX('gif', measured).ok) continue;
    if (measured.bytes <= targetBytes) return { ...measured, attempt };
    fallback ??= attempt;
  }
  if (fallback) {
    gif(mp4, out, fallback);
    return { ...(await probe(out)), attempt: fallback };
  }
  throw new EncodeFailure('GIF_TOO_LARGE', `${mp4} does not fit X's GIF limits at any tried size`);
}

/** @param {string} mp4 @param {string} out @param {{ width: number, height: number, fps: number }} attempt */
function gif(mp4, out, attempt) {
  run([
    '-i',
    mp4,
    '-vf',
    `fps=${attempt.fps},scale=${attempt.width}:${attempt.height}:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    '-loop',
    '0',
    out,
  ]);
}

/**
 * A finished video re-encoded onto the export's canvas (scaled to fit, centred on `background`), for a clip made elsewhere — a requested
 * Grok clip of a face. The source file is only read.
 * @param {string} source @param {string} out @param {{ width: number, height: number, background: string, overlay?: string | null }} options
 */
export function fitVideo(source, out, { width, height, background, overlay = null }) {
  const fit = `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${background}`;
  const args = ['-i', source];
  if (overlay) args.push('-i', overlay, '-filter_complex', `[0:v]${fit}[v];[v][1:v]overlay=0:0`);
  else args.push('-vf', fit);
  args.push('-an', '-r', '30', '-c:v', 'libx264', '-profile:v', 'high', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out);
  run(args);
}
