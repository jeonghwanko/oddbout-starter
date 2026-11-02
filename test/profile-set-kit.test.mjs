import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { parseProfileSet } from '../api/profile-set-contract.mjs';
import { buildProfileSet, faceBox } from '../scripts/profile-set.mjs';

/** RGBA pixels `width` × `height` with filled rectangles [x0, y0, x1, y1] (inclusive). */
function pixels(width, height, rects, background = null) {
  const data = Buffer.alloc(width * height * 4);
  if (background) for (let i = 0; i < width * height; i++) data.set(background, i * 4);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data.set([200, 120, 90, 255], (y * width + x) * 4);
  return { data, width, height, channels: 4 };
}
const png = ({ data, width, height }, channels = 4) => sharp(data, { raw: { width, height, channels: 4 } })
  .toColourspace('srgb')[channels === 3 ? 'removeAlpha' : 'ensureAlpha']().png().toBuffer();

test('faceBox measures as host/motions.py face-box does: the head\'s square, 17 % of the figure, at its top', () => {
  // The host test's figure (generation-stages.test.mjs) with a square head: 801 px tall from y 100, the head over x 150–249.
  assert.deepEqual(faceBox(pixels(400, 1000, [[150, 100, 249, 199], [100, 200, 300, 900]])), { x: 132, y: 100, side: 136 });
  // The host test's own ellipse head (x 150-250, centre 200.5): 132.5 rounds to even, as Python's round does.
  assert.deepEqual(faceBox(pixels(400, 1000, [[150, 100, 250, 199], [100, 200, 300, 900]])), { x: 132, y: 100, side: 136 });
});

test('fighter:profile-set frames the chosen front, measures its face, fits the sheet and writes a set the server and validator accept', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'profile-set-'));
  try {
    // A landscape picture with a small figure off-centre (what an image model may hand back), and a 3:2 sheet at the arena's size.
    const front = path.join(dir, 'front.png'), sheet = path.join(dir, 'sheet.png');
    await sharp(await png(pixels(1600, 1200, [[260, 100, 359, 199], [220, 200, 400, 1000]]))).toFile(front);
    const cells = [0, 1, 2, 3, 4, 5].map(c => [(c % 3) * 384 + 60, Math.floor(c / 3) * 384 + 40, (c % 3) * 384 + 320, Math.floor(c / 3) * 384 + 383]);
    await sharp(await png(pixels(1152, 768, cells))).toFile(sheet);
    const out = path.join(dir, 'set');
    const result = await buildProfileSet({ front, expressions: sheet, out });
    assert.equal(result.ok, true, JSON.stringify(result));
    const manifest = await readFile(path.join(out, 'profile-set.json'), 'utf8');
    assert.equal(parseProfileSet(manifest).ok, true);
    const set = JSON.parse(manifest);
    // The 901-px figure fits unscaled: 86 % of a 1048-px portrait canvas.
    assert.deepEqual([set.front.width, set.front.height], [699, 1048]);
    const meta = await sharp(path.join(out, 'front.webp')).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height, meta.hasAlpha], ['webp', 699, 1048, true]);
    assert.deepEqual([set.expressions.width, set.expressions.height], [1536, 1024]);
    assert.equal(set.face.side, Math.round(901 * 0.17));
    assert.deepEqual((await sharp(path.join(out, 'ko-preview.png')).metadata()).width, 512);
    assert.deepEqual((await sharp(path.join(out, 'face-preview.png')).metadata()).width, 192);
    assert.deepEqual(result.upload, ['prepare_profile_set: manifest profile-set.json', 'upload_profile_set_asset: assetId front, file front.webp',
      'upload_profile_set_asset: assetId expressions, file expressions.webp', 'submit_profile_set']);
    // Never over an existing folder.
    assert.deepEqual((await buildProfileSet({ front, expressions: sheet, out })).errors.map(e => e.code), ['OUTPUT_EXISTS']);
    // Without a sheet the set is still valid, and says what the arena then shows.
    const plain = await buildProfileSet({ front, out: path.join(dir, 'plain') });
    assert.equal(plain.ok, true); assert.match(plain.note, /face square for every mood/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('fighter:profile-set refuses what the server would: no transparency (with the cutout step), a sheet of another shape, a wide figure', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'profile-set-'));
  try {
    const opaque = path.join(dir, 'opaque.png'), wide = path.join(dir, 'wide.png'), good = path.join(dir, 'good.png'), square = path.join(dir, 'square.png');
    await sharp(await png(pixels(1024, 1536, [[400, 200, 600, 1300]], [255, 255, 255, 255]), 3)).toFile(opaque);
    await sharp(await png(pixels(1536, 1024, [[100, 300, 1400, 900]]))).toFile(wide);
    await sharp(await png(pixels(1024, 1536, [[450, 100, 549, 199], [400, 200, 600, 1300]]))).toFile(good);
    await sharp(await png(pixels(1024, 1024, [[100, 100, 900, 900]]))).toFile(square);
    const codes = async options => (await buildProfileSet({ out: path.join(dir, `out-${Math.random()}`), ...options })).errors?.map(e => e.code);
    const noAlpha = await buildProfileSet({ front: opaque, out: path.join(dir, 'x') });
    assert.deepEqual(noAlpha.errors.map(e => e.code), ['PICTURE_NO_ALPHA']);
    assert.match(noAlpha.errors[0].detail, /npm run sprite -- cutout/);
    assert.deepEqual(await codes({ front: wide }), ['FIGURE_WIDTH']);
    assert.deepEqual(await codes({ front: good, expressions: square }), ['EXPRESSIONS_DIMENSIONS']);
    assert.deepEqual(await codes({ front: good, expressions: opaque }), ['PICTURE_NO_ALPHA']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
