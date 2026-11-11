import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X_LIMITS, canvasSize, checkX, gifAttempts, intentUrl } from '../scripts/social/budget.mjs';
import { cellRect, clipSteps, frameExtent, placeFrame, repeatsFor, resample, stageFor } from '../scripts/social/frames.mjs';
import { EXPRESSIONS, PRESETS, presetPose } from '../scripts/social/presets.mjs';
import { captions, parseBackground } from '../scripts/social-export.mjs';

const clip = {
  assetId: 'combo',
  frameWidth: 200,
  frameHeight: 400,
  columns: 3,
  frames: [0, 1, 2, 3],
  origins: [
    { originX: 100, originY: 390 },
    { originX: 80, originY: 390 },
    { originX: 120, originY: 380 },
    { originX: 100, originY: 390 },
  ],
  sequence: [
    { frame: 0, durationMs: 100 },
    { frame: 1, durationMs: 50 },
    { frame: 2, durationMs: 200 },
    { frame: 1, durationMs: 50 },
  ],
};

test('a clip plays its sequence, or each frame for durationMs, from its sheet cells row by row', () => {
  assert.deepEqual(clipSteps(clip).map(s => s.frame), [0, 1, 2, 1]);
  assert.deepEqual(clipSteps({ ...clip, sequence: undefined, durationMs: 80 }), clip.frames.map(frame => ({ frame, durationMs: 80 })));
  assert.deepEqual(cellRect(clip, 4), { left: 200, top: 400, width: 200, height: 400 });
});

test('constant-rate playback keeps each step for its time and repeats whole loops', () => {
  // 400 ms at 30 fps: 12 frames; the 50 ms steps (1.5 frames) are not skipped.
  const shown = resample(clip.sequence, 30);
  assert.equal(shown.length, 12);
  assert.deepEqual([...new Set(shown)], [0, 1, 2, 3]);
  assert.equal(shown.filter(i => i === 2).length, 6);
  assert.equal(resample(clip.sequence, 30, 3).length, 36);
  assert.deepEqual(resample(clip.sequence, 30, 2).slice(12), shown);
});

test('a post lasts a few seconds: loops repeat, one-shots play at least twice, never past the cap', () => {
  assert.equal(repeatsFor(400, true), 8);
  assert.equal(repeatsFor(2500, false), 2);
  assert.equal(repeatsFor(4000, true), 1);
  assert.equal(repeatsFor(8000, false), 1);
});

test("every frame stands on one ground line at one spot, scaled by the clip's drawn reach", () => {
  const ink = { left: 60, top: 40, right: 150, bottom: 395 };
  assert.deepEqual(frameExtent(clip, 0, ink), { left: 40, right: 50, up: 350, down: 5 });
  // A sheet packed at half density keeps its game size.
  assert.deepEqual(frameExtent({ ...clip, pixelScale: 0.5 }, 0, ink), { left: 80, right: 100, up: 700, down: 10 });
  const extents = clip.frames.map(frame => frameExtent(clip, frame));
  const stage = stageFor(extents, 720, 720);
  for (const frame of clip.frames) {
    const place = placeFrame(clip, frame, stage);
    const origin = clip.origins[frame];
    const s = place.height / clip.frameHeight;
    assert.ok(Math.abs(place.top + origin.originY * s - stage.groundY) <= 1, `frame ${frame} on the ground`);
    assert.ok(Math.abs(place.left + origin.originX * s - stage.centreX) <= 1, `frame ${frame} at the spot`);
    assert.ok(place.left >= -1 && place.left + place.width <= 721, `frame ${frame} inside the canvas`);
  }
});

test("canvas sizes stay inside X's video size and are even", () => {
  assert.deepEqual(canvasSize(720, '1:1'), { width: 720, height: 720 });
  assert.deepEqual(canvasSize(1024, '1:1'), { width: 1024, height: 1024 });
  assert.deepEqual(canvasSize(720, '16:9'), { width: 1280, height: 720 });
  for (const size of [canvasSize(1024, '1:1'), canvasSize(1024, '16:9')]) {
    assert.ok(size.width <= X_LIMITS.video.width && size.height <= X_LIMITS.video.height);
    assert.equal(size.width % 2 + size.height % 2, 0);
  }
});

test("GIF attempts never pass X's frame and pixel limits, best first", () => {
  const attempts = gifAttempts({ width: 1024, height: 1024, seconds: 12, fps: 30 });
  assert.ok(attempts.length > 0);
  for (const a of attempts) {
    const frames = Math.ceil(12 * a.fps);
    assert.ok(frames <= X_LIMITS.gif.frames && a.width * a.height * frames <= X_LIMITS.gif.pixels && a.height <= X_LIMITS.gif.height);
  }
  assert.ok(attempts[0].width * attempts[0].fps >= attempts.at(-1).width * attempts.at(-1).fps);
  // 30 s at 10 fps is 300 frames; at 12 fps it would be 360 (over 350).
  assert.ok(gifAttempts({ width: 400, height: 400, seconds: 30, fps: 30 }).every(a => a.fps <= 10));
});

test("the export's X check names each limit a file breaks", () => {
  assert.equal(checkX('gif', { bytes: 1000, width: 512, height: 512, frames: 60 }).ok, true);
  assert.deepEqual(checkX('gif', { bytes: 16 * 1024 * 1024, width: 512, height: 512, frames: 400 }).problems.length, 2);
  assert.deepEqual(checkX('video', { bytes: 1, width: 1080, height: 1080, seconds: 3, fps: 30 }).problems, ['size 1080x1080 > 1280x1024']);
  assert.equal(checkX('video', { bytes: 1, width: 720, height: 720, seconds: 0.2, fps: 30 }).ok, false);
});

test("the post link fills X's composer with the caption and tags, and carries no link of its own", () => {
  const url = new URL(intentUrl('네라 — my fighter', ['#ODDBOUT', 'ODDBOUTme']));
  assert.equal(url.origin + url.pathname, 'https://x.com/intent/post');
  assert.equal(url.searchParams.get('text'), '네라 — my fighter');
  assert.equal(url.searchParams.get('hashtags'), 'ODDBOUT,ODDBOUTme');
  assert.equal(url.searchParams.get('url'), null);
  const [ko, en] = captions('네라', 'ko');
  assert.match(ko, /네라/);
  assert.match(en, /Meet 네라/);
});

test('each face has a preset loop that ends where it began', () => {
  assert.deepEqual(Object.keys(PRESETS).sort(), [...EXPRESSIONS].sort());
  for (const face of EXPRESSIONS) {
    const start = presetPose(face, 0),
      end = presetPose(face, 1);
    for (const key of /** @type {const} */ (['dx', 'dy', 'scale', 'rotate'])) assert.ok(Math.abs(start[key] - end[key]) < 1e-9, `${face} ${key}`);
  }
  assert.ok(presetPose('hit', 0.01).flash > 0);
  assert.ok(presetPose('sideeye', 0.5).scale > 1.2);
});

test('backgrounds: the named ones and #rrggbb', () => {
  assert.deepEqual(parseBackground('light'), { r: 236, g: 240, b: 246 });
  assert.deepEqual(parseBackground('#ff0080'), { r: 255, g: 0, b: 128 });
  assert.equal(parseBackground('blue'), null);
});

test('the end card warns when a Linux host has no font for the name, and never on Windows or macOS', async () => {
  const { nameFontWarning } = await import('../scripts/social/endcard.mjs');
  assert.equal(nameFontWarning('Sparring Bot', 'linux'), null);
  assert.equal(nameFontWarning('네라', 'win32'), null);
  assert.equal(nameFontWarning('네라', 'darwin'), null);
});

test("the card's name size counts Hangul as full width, so a Korean name fits its column", async () => {
  const { nameEms } = await import('../scripts/social/endcard.mjs');
  assert.ok(Math.abs(nameEms('야근왕 박과장') - (6 * 1.02 + 0.33)) < 1e-9);
  assert.ok(nameEms('Sparring Bot') < nameEms('야근왕 박과장 김대리'));
});
