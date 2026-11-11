// The pixel judge's loop identity (host/motions.py pixel_judge_loop) on pictures built here: what floats apart from the body in the look
// (sparkles, holograms) may be left out of a walk — pixels leave it open — while something attached to the body that goes missing fails.
// Job 98a88093 (2026-11-11) stopped at walk-not-clean because three clean walks without the look's floating bubbles each failed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { checkedPixels } from './generation-prompts.mjs';

const script = path.join(import.meta.dirname, 'motions.py');
const python = ['python3', 'python'].find(cmd => spawnSync(cmd, ['-c', 'import sys; assert sys.version_info >= (3, 9); import PIL, numpy']).status === 0);

const W = 200,
  H = 440,
  FRAMES = 6;
const block = (width, height, colour, left, top) => ({ input: { create: { width, height, channels: 4, background: { ...colour, alpha: 1 } } }, left, top });
const GREY = { r: 120, g: 118, b: 122 },
  NAVY = { r: 30, g: 40, b: 80 },
  CYAN = { r: 110, g: 196, b: 234 };
// A body of two colours, 100 x 400, standing on the cell's floor.
const body = [block(100, 200, GREY, 50, 20), block(100, 200, NAVY, 50, 220)];
/** @param {object[]} layers */
const picture = (layers, width = W) =>
  sharp({ create: { width, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .png();

/** The pixel judge's answer for a look and a loop whose every frame is the plain body. @param {object[]} extra the look's layers beside the body */
async function judgeLoop(extra) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pixel-judge-loop-'));
  const look = path.join(dir, 'look.png'),
    strip = path.join(dir, 'walk.strip.json'),
    out = path.join(dir, 'pixels.json');
  await picture([...body, ...extra]).toFile(look);
  const cells = Array.from({ length: FRAMES }, (_, i) => body.map(layer => ({ ...layer, left: layer.left + i * W })));
  await picture(cells.flat(), W * FRAMES).toFile(path.join(dir, 'walk.strip.png'));
  await writeFile(strip, JSON.stringify({ w: W, h: H, frames: FRAMES, body_h: 400 }));
  const done = spawnSync(/** @type {string} */ (python), ['-I', script, 'pixel-judge', 'loop', look, strip, out], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONUTF8: '1' },
  });
  assert.equal(done.status, 0, done.stderr);
  return JSON.parse(await readFile(out, 'utf8'));
}

test('pixel judge, loop identity: an effect floating apart from the body in the look, left out of the loop, is left open', { skip: !python }, async () => {
  // 30 x 50 beside the body, not touching it: 3.6 % of the look.
  const answer = await judgeLoop([block(30, 50, CYAN, 165, 200)]);
  assert.equal(answer.identity, 'unknown');
  assert.match(answer.notes, /floats apart from the body/);
  const gone = answer.measures.regions.filter(region => region.look >= 0.02 && region.median < 0.2);
  assert.equal(gone.length, 1);
  assert.equal(gone[0].apart, 1);
  assert.equal(checkedPixels('loop', answer)?.checks.identity, 'unknown', 'the worker reads it as open: hybrid asks codex');
});

test('pixel judge, loop identity: the same thing touching the body (held or worn) and gone from the loop fails', { skip: !python }, async () => {
  const answer = await judgeLoop([block(30, 50, CYAN, 150, 200)]);
  assert.equal(answer.identity, 'fail');
  assert.match(answer.notes, /something the look shows is missing/);
  assert.equal(answer.measures.regions.find(region => region.look >= 0.02 && region.median < 0.2).apart, 0);
});

test('pixel judge, loop identity: a loop that shows all of the look passes', { skip: !python }, async () => {
  const answer = await judgeLoop([]);
  assert.equal(answer.identity, 'pass');
});
