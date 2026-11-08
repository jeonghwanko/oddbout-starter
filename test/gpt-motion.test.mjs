import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { init, bindKeyposes } from '../scripts/gait.mjs';
import { spriteRoot, spritePython, requireMotionContract, inspectSpriteEngine } from '../scripts/sprite-gen.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
async function directory(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'gpt-motion-node-'));
  t.after(async () => {
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('initializer creates gated requests and binding rejects an incomplete review', async t => {
  const dir = await directory(t),
    out = path.join(dir, 'walk');
  await init(out);
  const sequence = JSON.parse(await readFile(path.join(out, 'sprite-request.json'), 'utf8'));
  const keys = JSON.parse(await readFile(path.join(out, 'keyposes-request.json'), 'utf8'));
  assert.equal(sequence.fit.ground_frames, false);
  assert.equal(sequence.states.walk.frames, 16);
  assert.equal(keys.states.walk.frames, 4);
  assert.equal(keys.states.walk.motion.stage, 'keyposes');
  const ref = sequence.states.walk.motion.references[0];
  assert.equal(ref.sha256, hash(await readFile(ref.file)));
  await assert.rejects(bindKeyposes(path.join(out, 'sprite-request.json'), ref.file, path.join(out, 'keyposes-review.json')), /Unverified/);
  const bare = path.join(dir, 'bare');
  await mkdir(bare);
  await writeFile(path.join(bare, 'sprite-request.json'), JSON.stringify({ states: { walk: { frames: 16 }, idle: { frames: 4 } } }));
  await assert.rejects(requireMotionContract(['gen-set', '--run-dir', bare], dir), /MOTION_CONTRACT_REQUIRED/);
  await assert.rejects(requireMotionContract(['gen-set', '--run-dir', bare, '--states', ''], dir), /MOTION_CONTRACT_REQUIRED/);
  await assert.rejects(requireMotionContract(['gen-set', '--run-dir', bare, '--run-dir', out], dir), /Duplicate option/);
  await requireMotionContract(['gen-set', '--run-dir', bare, '--states', 'idle'], dir);
  await requireMotionContract(['gen-set', '--run-dir', out], dir);
  sequence.states.walk.frames = 8;
  await writeFile(path.join(out, 'sprite-request.json'), JSON.stringify(sequence));
  await assert.rejects(requireMotionContract(['gen-set', '--run-dir', out], dir), /needs 16 frames/);
});

const installed = await access(spritePython).then(
  () => true,
  () => false,
);
test('pose route requires full AI Fighter frame plans while allowing internal diagnostic generation', async t => {
  const dir = await directory(t),
    plan = path.join(dir, 'pose.json');
  await writeFile(plan, JSON.stringify({ version: 2, motion: 'walk', frames: Array(16).fill({}) }));
  await requireMotionContract(['gen-motion', '--plan', plan, '--frame', 'contact-a'], dir);
  await writeFile(plan, JSON.stringify({ motion: 'walk', frames: Array(4).fill({}) }));
  await assert.rejects(requireMotionContract(['gen-motion', '--plan', plan, '--export'], dir), /needs 16 frames/);
  await writeFile(plan, JSON.stringify({ motion: 'run', frames: Array(12).fill({}) }));
  await requireMotionContract(['gen-motion', '--plan', plan, '--prepare-only'], dir);
});
test('v5 blocks new uncalibrated calls without blocking legacy recovery', async t => {
  const dir = await directory(t),
    plan = path.join(dir, 'pose.json');
  await writeFile(plan, JSON.stringify({ version: 1, motion: 'walk', frames: Array(16).fill({}) }));
  await assert.rejects(requireMotionContract(['gen-motion', '--plan', plan, '--frame', 'contact-a'], dir), /BODY_CALIBRATION_REQUIRED/);
  await requireMotionContract(['gen-motion', '--plan', plan, '--frame', 'contact-a', '--reconcile'], dir);
  await requireMotionContract(['gen-motion', '--plan', plan, '--prepare-only'], dir);
  await requireMotionContract(['gen-motion', '--plan', plan, '--export'], dir);
});
test('real sprite-gen-agent engine preserves flight and enforces reference gates without generation', { skip: !installed }, async () => {
  assert.equal((await inspectSpriteEngine(spriteRoot)).motion, true);
  const result = spawnSync(spritePython, ['test/gpt_motion_cases.py'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
    env: { ...process.env, PYTHONUTF8: '1' },
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stderr, /Ran 13 tests/);
});
