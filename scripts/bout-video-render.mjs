// @ts-check
// Film one playback page and cut an X-ready MP4 (2026-11-13). The page must expose window.oddboutBout
// ({ protocolVersion: 1, played }) and resolve it with the engine digest. A club lobby has no hook, so it is
// not filmed. Cards and the corner mark match fighter:social. This file does not post to X or call the arena.
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { highlightWindow } from '../api/bout-share.mjs';
import { cornerMark, endCard } from './social/endcard.mjs';
import { EncodeFailure, encodeMp4 } from './social/encode.mjs';

const FPS = 30;
const INTRO_S = 1.5;
const END_S = 1.8;
const INK = { r: 20, g: 16, b: 32 };

/** @param {string} code */
export function boutError(code) {
  const error = /** @type {Error & { code: string }} */ (new Error(code));
  error.code = code;
  return error;
}

/**
 * The hook's result is this bout, or a refusal. A missing hook is the club lobby or a game that cannot play the pair.
 * @param {any} played @param {string} expectedDigest
 */
export function acceptPlayed(played, expectedDigest) {
  if (!played || played.missing === true || played.protocolVersion === 0) throw boutError('playback-unavailable');
  if (typeof played.digest !== 'string' || played.digest !== expectedDigest) throw boutError('digest-mismatch');
  return played;
}

/**
 * Highlight trim in seconds, or null when the record has no highlight times (the whole bout is kept).
 * @param {any} record
 * @returns {{ start: number, end: number } | null}
 */
export function trimSeconds(record) {
  const window = highlightWindow(record);
  if (!window) return null;
  const scale = typeof record?.ms === 'number' && record.ms >= 1000 ? 1000 : 1;
  const start = window.startMs / scale;
  const end = window.endMs / scale;
  return end - start >= 0.5 ? { start, end } : null;
}

/** @param {string} text */
const xml = text => text.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] ?? c);

/**
 * The opening card: both names, one second and a half.
 * @param {number} width @param {number} height @param {string} left @param {string} right
 */
async function introFrames(width, height, left, right) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<text x="${width / 2}" y="${height * 0.42}" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(height * 0.08)}" font-weight="800" fill="#f4f5f8">${xml(left)}</text>
<text x="${width / 2}" y="${height * 0.54}" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(height * 0.045)}" font-weight="700" fill="#eaff50">VS</text>
<text x="${width / 2}" y="${height * 0.66}" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(height * 0.08)}" font-weight="800" fill="#f4f5f8">${xml(right)}</text>
</svg>`;
  const frame = await sharp({ create: { width, height, channels: 3, background: INK } })
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
    .removeAlpha()
    .raw()
    .toBuffer();
  const count = Math.round(INTRO_S * FPS);
  return { frame, count };
}

/** @param {Buffer} frame @param {number} count */
async function* repeat(frame, count) {
  for (let i = 0; i < count; i++) yield frame;
}

/**
 * @param {{ boutPath: string, out: string, width: number, height: number, left: string, right: string, winner?: string | null,
 *   trim?: { start: number, end: number } | null }} cut
 */
export async function composeBoutFile(cut) {
  const missing = ['ffmpeg'].filter(tool => spawnSync(tool, ['-version'], { stdio: 'ignore' }).status !== 0);
  if (missing.length) throw new EncodeFailure('FFMPEG_MISSING', missing.join(', '));
  const dir = await mkdtemp(path.join(tmpdir(), 'bout-video-'));
  try {
    const intro = path.join(dir, 'intro.mp4');
    const ending = path.join(dir, 'end.mp4');
    const bout = path.join(dir, 'bout.mp4');
    const mark = path.join(dir, 'mark.png');
    const opened = await introFrames(cut.width, cut.height, cut.left, cut.right);
    await encodeMp4(repeat(opened.frame, opened.count), { width: cut.width, height: cut.height, fps: FPS, out: intro });
    const card = await endCard({ width: cut.width, height: cut.height, background: INK, name: cut.winner || `${cut.left} vs ${cut.right}` });
    await encodeMp4(repeat(card, Math.round(END_S * FPS)), { width: cut.width, height: cut.height, fps: FPS, out: ending });
    await writeFile(mark, await cornerMark(cut.width, cut.height, INK));
    const trim = cut.trim ? ['-ss', String(cut.trim.start), '-to', String(cut.trim.end)] : [];
    const scaled = spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        ...trim,
        '-i',
        cut.boutPath,
        '-i',
        mark,
        '-filter_complex',
        `[0:v]scale=${cut.width}:${cut.height}:force_original_aspect_ratio=decrease,pad=${cut.width}:${cut.height}:(ow-iw)/2:(oh-ih)/2,fps=${FPS}[b];[b][1:v]overlay=0:0`,
        '-an',
        '-c:v',
        'libx264',
        '-profile:v',
        'high',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        bout,
      ],
      { encoding: 'utf8' },
    );
    if (scaled.status !== 0) throw new EncodeFailure('ENCODE_FAILED', (scaled.stderr || '').trim().slice(-800));
    const list = path.join(dir, 'list.txt');
    await writeFile(list, `file '${intro}'\nfile '${bout}'\nfile '${ending}'\n`);
    const joined = spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        list,
        '-c:v',
        'libx264',
        '-profile:v',
        'high',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        cut.out,
      ],
      { encoding: 'utf8' },
    );
    if (joined.status !== 0) throw new EncodeFailure('ENCODE_FAILED', (joined.stderr || '').trim().slice(-800));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Open the playback page with a browser and wait until its hook reports this digest.
 * `open` is the browser. Tests pass a fake; the command line passes Playwright.
 * @param {{ open: (size: { width: number, height: number, url?: string }) => Promise<{ url: () => string, played: (timeoutMs: number) => Promise<any>, close: () => Promise<void> }>,
 *   url: string, expectedDigest: string, width: number, height: number, timeoutMs: number }} session
 */
export async function filmBout(session) {
  const page = await session.open({ width: session.width, height: session.height, url: session.url });
  try {
    const landed = new URL(page.url());
    if (landed.searchParams.get('play') !== '1' || landed.searchParams.get('club') === '1') throw boutError('playback-unavailable');
    return acceptPlayed(await page.played(session.timeoutMs), session.expectedDigest);
  } finally {
    await page.close();
  }
}

/**
 * Playwright's visible Chromium, matching the broadcast renderer: a Linux host needs a graphical session
 * unless ODDBOUT_BOUT_VIDEO_HEADLESS=1. The page's hook is the only proof the bout played.
 * @param {{ url: string, expectedDigest: string, width: number, height: number, timeoutMs: number, playwright?: any,
 *   platform?: string, env?: Record<string, string | undefined>, signal?: AbortSignal }} options
 */
export async function recordBoutPage(options) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const headless = env.ODDBOUT_BOUT_VIDEO_HEADLESS === '1';
  if (platform === 'linux' && !headless && !env.DISPLAY && !env.WAYLAND_DISPLAY) throw boutError('playback-display');
  const playwright = options.playwright ?? (await import('playwright'));
  const browser = await playwright.chromium.launch({ headless });
  const dir = await mkdtemp(path.join(tmpdir(), 'bout-page-'));
  try {
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      recordVideo: { dir, size: { width: options.width, height: options.height } },
    });
    const page = await context.newPage();
    const played = await filmBout({
      url: options.url,
      expectedDigest: options.expectedDigest,
      width: options.width,
      height: options.height,
      timeoutMs: options.timeoutMs,
      open: async () => {
        await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        return {
          url: () => page.url(),
          played: timeoutMs =>
            page.evaluate(async (/** @type {number} */ limit) => {
              const hook = /** @type {any} */ (window).oddboutBout;
              if (hook?.protocolVersion !== 1 || !hook.played) return { missing: true };
              return await Promise.race([hook.played, new Promise(resolve => setTimeout(() => resolve({ missing: true }), limit))]);
            }, timeoutMs),
          close: async () => {},
        };
      },
    });
    const video = page.video();
    await context.close();
    const recorded = video ? await video.path() : null;
    if (!recorded) throw boutError('playback-unavailable');
    const bytes = await readFile(recorded);
    return { played, bytes, recorded };
  } finally {
    await browser.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
}
