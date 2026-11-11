// Real ffmpeg encodes of the geometric fixture (heavy: scripts/test-suite.mjs). The fixture is a test package, not a generated character.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildProfileSet } from '../scripts/profile-set.mjs';
import { exportSocial, prepareGrokFace } from '../scripts/social-export.mjs';
import { probe } from '../scripts/social/encode.mjs';

const fixture = fileURLToPath(new URL('../examples/sparring-bot/', import.meta.url));

/** A transparent picture with filled rectangles [x0, y0, x1, y1] (inclusive). */
async function picture(file, width, height, rects) {
  const data = Buffer.alloc(width * height * 4);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data.set([200, 120, 90, 255], (y * width + x) * 4);
  await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(file);
}

/** A profile set the kit's own builder accepts: a front and a six-face sheet. */
async function profileSet(dir) {
  const front = path.join(dir, 'front.png'),
    sheet = path.join(dir, 'sheet.png');
  await picture(front, 1024, 1536, [
    [440, 140, 580, 280],
    [380, 280, 640, 1400],
  ]);
  await picture(sheet, 1536, 1024, [0, 1, 2, 3, 4, 5].map(c => [(c % 3) * 512 + 100, Math.floor(c / 3) * 512 + 60, (c % 3) * 512 + 420, Math.floor(c / 3) * 512 + 511]));
  const out = path.join(dir, 'set');
  const built = await buildProfileSet({ front, expressions: sheet, out });
  assert.equal(built.ok, true, JSON.stringify(built));
  return out;
}

test('fighter:social writes MP4 and GIF loops, reactions, a showcase and a four-picture post that X takes, and records them', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'social-'));
  try {
    const set = await profileSet(dir);
    const out = path.join(dir, 'x');
    const result = await exportSocial({ packageDir: fixture, profileSetDir: set, out, clips: ['fightIdle', 'combo'] });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.faces, 'sheet');
    assert.equal(result.xLimitsChecked, true);
    assert.deepEqual((await readdir(path.join(out, 'clips'))).sort(), ['combo.gif', 'combo.mp4', 'fightIdle.gif', 'fightIdle.mp4']);
    assert.equal((await readdir(path.join(out, 'reactions'))).length, 18);
    assert.deepEqual((await readdir(path.join(out, 'post-set'))).sort(), ['1.png', '2.png', '3.png', '4.png']);

    const video = await probe(path.join(out, 'clips', 'combo.mp4'));
    assert.deepEqual([video.codec, video.width, video.height, Math.round(video.fps), video.audio], ['h264', 720, 720, 30, false]);
    assert.ok(video.seconds >= 2.5 && video.seconds <= 6.5, `combo lasts ${video.seconds}s`);
    const gif = await probe(path.join(out, 'reactions', 'ko.gif'));
    assert.ok(gif.bytes <= 15 * 1024 * 1024 && gif.frames <= 350);
    const showcase = await probe(path.join(out, 'showcase.mp4'));
    assert.ok(showcase.seconds > 1.8, 'the showcase holds the end card');

    const record = JSON.parse(await readFile(path.join(out, 'social.json'), 'utf8'));
    assert.equal(record.generated, false);
    assert.equal(record.fighter.name, 'Sparring Bot');
    assert.ok(record.files.every(f => !path.isAbsolute(f.path) && f.sha256.length === 64));
    const guide = await readFile(path.join(out, 'POST.md'), 'utf8');
    assert.match(guide, /x\.com\/intent\/post\?text=/);
    assert.match(guide, /oddbout\.com\/\?ref=x/);
    assert.doesNotMatch(guide, /\b(him|his|her)\b/);

    // Never over a folder, never inside the package.
    assert.deepEqual((await exportSocial({ packageDir: fixture, profileSetDir: set, out })).errors.map(e => e.code), ['OUTPUT_EXISTS']);
    assert.deepEqual(
      (await exportSocial({ packageDir: fixture, out: path.join(fixture, 'social-out') })).errors.map(e => e.code),
      ['OUTPUT_INSIDE_SOURCE'],
    );
    assert.deepEqual((await exportSocial({ packageDir: fixture, out: path.join(dir, 'y'), clips: ['victory'] })).errors.map(e => e.code), ['CLIP_MISSING']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fighter:social refuses a package whose sheet no longer matches its fighter.json', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'social-'));
  try {
    const copy = path.join(dir, 'package');
    await cp(fixture, copy, { recursive: true });
    await writeFile(path.join(copy, 'assets', 'combo.webp'), await sharp({ create: { width: 8, height: 8, channels: 4, background: '#000' } }).webp().toBuffer());
    const result = await exportSocial({ packageDir: copy, out: path.join(dir, 'x') });
    assert.deepEqual(result.errors.map(e => e.code), ['ASSET_CHANGED']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('grok-face prepares a looping still, prompt and command without generating; --add-clip brings a finished clip in', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'social-'));
  try {
    const set = await profileSet(dir);
    const prepared = await prepareGrokFace({ profileSetDir: set, face: 'sideeye', out: path.join(dir, 'grok') });
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    assert.equal(prepared.generated, false);
    assert.deepEqual(prepared.command.slice(0, 5), ['npm', 'run', 'sprite', '--', 'video']);
    // The still opens and closes the clip, so it loops.
    assert.equal(prepared.command[prepared.command.indexOf('--image') + 1], prepared.command[prepared.command.indexOf('--last-frame') + 1]);
    assert.deepEqual((await readdir(path.join(dir, 'grok'))).sort(), ['sideeye-prompt.txt', 'sideeye-still.png']);
    assert.deepEqual((await prepareGrokFace({ profileSetDir: set, face: 'wink', out: path.join(dir, 'g2') })).errors.map(e => e.code), ['FACE_UNKNOWN']);

    // A stand-in for the finished clip (ffmpeg's test pattern), never a generation.
    const clip = path.join(dir, 'sideeye-grok.mp4');
    const made = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x640:rate=24:duration=2', '-pix_fmt', 'yuv420p', clip]);
    assert.equal(made.status, 0);
    const out = path.join(dir, 'x');
    const result = await exportSocial({ packageDir: fixture, out, clips: ['fightIdle'], addClips: [clip] });
    assert.equal(result.ok, true, JSON.stringify(result));
    const added = await probe(path.join(out, 'clips', 'added-sideeye-grok.mp4'));
    assert.deepEqual([added.width, added.height], [720, 720]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
