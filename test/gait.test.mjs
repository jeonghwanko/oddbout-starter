import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { alphaBounds, walkPlan, sequenceHash, validatePlan, inspectGeometry, combineReview, requireReview, commonGameRequest, loadSequence, loopReview, requireLoopReview, ENGINE_SEAM_MAX, scaleCheckRuns, scaleCheckEntries, scaleCheckConfigErrors, scalePer } from '../tools/ai-fighter/gait.mjs';
import { preview } from '../scripts/gait.mjs';

function frame(bottom = 70, mark = 0, height = 80) {
  const width = 64, data = Buffer.alloc(width * height * 4);
  for (let y = 10; y < bottom; y++) for (let x = 20; x < 40; x++) {
    const at = (y * width + x) * 4;
    data[at] = 100 + mark; data[at + 3] = 255;
  }
  return { width, height, data };
}
function sequence(count = 16) {
  const value = { frames: Array.from({ length: count }, (_, i) => frame(70, i)), durations: Array(count).fill(100) };
  value.sha256 = sequenceHash(value); return value;
}
function plan() {
  const value = walkPlan(); value.geometry = { width: 64, height: 80, groundY: 70, groundTolerance: 2 }; return value;
}
// Synthetic review fixtures only: these support labels/measurements are not observations of generated artwork.
function countedPlan(motion, count) {
  const value = plan(); value.motion = motion;
  value.phases = Array.from({ length: count }, (_, i) => ({ index: i, phase: i / count,
    pose: 'fixture stance', support: [i < Math.floor(count / 2) ? 'near' : 'far'] }));
  return value;
}
function annotations(seq) {
  const far = Math.floor(seq.frames.length / 2) + 1;
  return { sequenceSha256: seq.sha256, visual: { identity: 'pass', anatomy: 'pass', alternation: 'pass', loop: 'pass' },
    stances: [{ foot: 'near', start: 1, end: 3, box: [10, 60, 40, 10] }, { foot: 'far', start: far, end: far + 2, box: [10, 60, 40, 10] }] };
}
const reports = () => [0, 1].map(() => ({ stride_verified: true, foot_velocity_px_per_second: -10 }));

test('required gait review accepts every contract count, preserving pixels, timing and measured stride', () => {
  for (const [motion, min, max] of [['walk', 12, 32], ['run', 10, 16]]) for (let count = min; count <= max; count++) {
    const seq = sequence(count), before = sequenceHash(seq);
    const report = combineReview(seq, countedPlan(motion, count), annotations(seq), reports());
    assert.equal(report.status, 'pass', `${motion} ${count}: ${JSON.stringify(report)}`);
    assert.equal(report.frames.length, count);
    assert.equal(report.durationSeconds, count / 10);
    assert.equal(report.stridePixels, count);
    assert.equal(requireReview(report, seq, motion), report);
    assert.equal(sequenceHash(seq), before, 'review must not alter pixels or timing');
  }
});

test('gait plans reject out-of-range counts and must cover the exact sequence with ordered phases', () => {
  for (const [motion, count] of [['walk', 11], ['walk', 33], ['run', 9], ['run', 17]])
    assert.throws(() => validatePlan(countedPlan(motion, count)), /Invalid gait frame count/, `${motion} ${count}`);
  for (const [motion, count] of [['walk', 25], ['run', 11]]) {
    const seq = sequence(count), p = countedPlan(motion, count);
    for (const planned of [count - 1, count + 1])
      assert.throws(() => combineReview(seq, countedPlan(motion, planned), annotations(seq), reports()), /phase count does not match/);
    for (const change of [v => { v.phases.at(-1).index = 0; }, v => { v.phases.at(-1).phase = 1; },
      v => { v.phases[count - 1] = null; }, v => { v.phases[0].support = ['near', 'near']; },
      v => { v.phases.forEach(f => { f.support = ['near']; }); }]) {
      const malformed = structuredClone(p); change(malformed);
      assert.throws(() => validatePlan(malformed, seq), /Invalid gait phases|alternate support/);
    }
  }
});

test('variable counts retain contact, visual, duplicate and stale-evidence gates', () => {
  for (const [motion, count] of [['walk', 25], ['run', 11]]) {
    const seq = sequence(count), p = countedPlan(motion, count), a = annotations(seq);
    assert.equal(combineReview(seq, p, null).status, 'unverified');
    assert.equal(combineReview(seq, p, a).status, 'unverified');
    for (const key of ['identity', 'anatomy', 'alternation', 'loop']) {
      const fail = structuredClone(a); fail.visual[key] = 'fail';
      assert.equal(combineReview(seq, p, fail, reports()).status, 'fail');
      fail.visual[key] = 'unverified';
      assert.equal(combineReview(seq, p, fail, reports()).status, 'unverified');
    }
    const incomplete = reports(); incomplete[1].stride_verified = false;
    assert.equal(combineReview(seq, p, a, incomplete).status, 'unverified');
    const wrongStance = structuredClone(a); wrongStance.stances[0].start = count - 3; wrongStance.stances[0].end = count - 1;
    assert.ok(combineReview(seq, p, wrongStance, reports()).errors.some(e => e.code === 'STANCE_PLAN_MISMATCH'));
    const pass = combineReview(seq, p, a, reports());
    seq.durations[count - 1] += 0.2;
    assert.throws(() => requireReview(pass, seq, motion), /STALE/);
    seq.durations[count - 1] -= 0.2;
    seq.frames[count - 1] = frame(53, count - 1);
    assert.throws(() => requireReview(pass, seq, motion), /STALE/);
    assert.ok(inspectGeometry(seq, p).errors.some(e => e.code === 'GROUND_OFFSET' && e.frame === count - 1));
    seq.frames[count - 1] = seq.frames[0];
    assert.ok(inspectGeometry(seq, p).errors.some(e => e.code === 'DUPLICATE_FRAME'));
  }
});

test('the alternating 17 px baseline regression is caught before packaging', () => {
  const seq = sequence(); seq.frames[1] = frame(53, 1); seq.sha256 = sequenceHash(seq);
  const report = combineReview(seq, plan(), null);
  assert.equal(report.status, 'fail');
  assert.ok(report.errors.some(e => e.code === 'GROUND_OFFSET' && e.frame === 1 && e.measured === 53));
  assert.equal(report.stridePixels, null);
});
test('a clean silhouette and visual pass cannot replace two measured same-foot stances', () => {
  const seq = sequence(), a = annotations(seq);
  assert.equal(combineReview(seq, plan(), null).status, 'unverified');
  assert.equal(combineReview(seq, plan(), a).status, 'unverified');
  a.stances.pop();
  assert.equal(combineReview(seq, plan(), a, reports().slice(0, 1)).status, 'unverified');
});
test('speed is converted from px/s to px/cycle; disagreeing or forward-moving feet fail', () => {
  const seq = sequence(), a = annotations(seq);
  const valid = combineReview(seq, plan(), a, reports());
  assert.equal(valid.status, 'pass'); assert.equal(valid.durationSeconds, 1.6); assert.equal(valid.stridePixels, 16);
  const different = reports(); different[1].foot_velocity_px_per_second = -30;
  assert.equal(combineReview(seq, plan(), a, different).status, 'fail');
  const forward = reports(); forward[0].foot_velocity_px_per_second = 10;
  assert.equal(combineReview(seq, plan(), a, forward).status, 'fail');
});
test('evidence expires after a pixel or timing change and cannot be reused for another motion', () => {
  const seq = sequence(), report = combineReview(seq, plan(), annotations(seq), reports());
  assert.equal(requireReview(report, seq, 'walk'), report);
  seq.durations[0] = 101;
  assert.throws(() => requireReview(report, seq, 'walk'), /STALE/);
  seq.durations[0] = 100; seq.frames[0].data[0] = 1;
  assert.throws(() => requireReview(report, seq, 'walk'), /STALE/);
  assert.throws(() => requireReview(report, seq, 'run'), /REQUIRED/);
});
test('unknown visual anatomy and mismatched support phases are not passed', () => {
  const seq = sequence(), a = annotations(seq);
  a.visual.anatomy = 'unverified';
  assert.equal(combineReview(seq, plan(), a, reports()).status, 'unverified');
  a.stances[0].start = 9; a.stances[0].end = 11;
  assert.equal(combineReview(seq, plan(), a, reports()).status, 'fail');
});
test('a repeated pixel frame cannot pass as an extra drawing', () => {
  const seq = sequence(); seq.frames[1] = seq.frames[0];
  assert.ok(inspectGeometry(seq, plan()).errors.some(e => e.code === 'DUPLICATE_FRAME'));
});
async function temporary(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'gait-review-'));
  try { return await fn(dir); } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
}
async function manifest(dir, name, value) {
  await sharp(value.data, { raw: { width: value.width, height: value.height, channels: 4 } }).png().toFile(path.join(dir, name + '.png'));
  const data = { sprite_sheet_alpha: name + '.png', frame_layout: { rows: { idle: [{ x: 0, y: 0, w: value.width, h: value.height }] } }, animation: { rows: { idle: { durations_ms: [100] } } } };
  await writeFile(path.join(dir, name + '.json'), JSON.stringify(data));
  return { file: name + '.json', state: 'idle' };
}

test('the review CLI inspects variable source cycles without generation, resampling or approving missing evidence', async () => temporary(async dir => {
  const cli = fileURLToPath(new URL('../scripts/gait.mjs', import.meta.url));
  for (const [motion, count] of [['walk', 25], ['run', 11]]) {
    const seq = sequence(count), p = countedPlan(motion, count), tiles = [], cells = [];
    for (const [i, f] of seq.frames.entries()) {
      tiles.push({ input: await sharp(f.data, { raw: { width: f.width, height: f.height, channels: 4 } }).png().toBuffer(), left: i * 64, top: 0 });
      cells.push({ x: i * 64, y: 0, w: 64, h: 80 });
    }
    const sheet = path.join(dir, `${motion}.png`), metadata = path.join(dir, `${motion}.json`);
    await sharp({ create: { width: count * 64, height: 80, channels: 4, background: '#0000' } }).composite(tiles).png().toFile(sheet);
    await writeFile(metadata, JSON.stringify({ sprite_sheet_alpha: `${motion}.png`, frame_layout: { rows: { [motion]: cells } },
      animation: { rows: { [motion]: { durations_ms: Array(count).fill(1000 / 24) } } } }));
    p.source = { file: `${motion}.json`, state: motion };
    const planFile = path.join(dir, `${motion}-plan.json`), out = path.join(dir, `${motion}-review`);
    await writeFile(planFile, JSON.stringify(p));
    const before = await Promise.all([readFile(sheet), readFile(metadata), readFile(planFile)]);
    // No annotations => no contact engine invocation; missing evidence must remain unverified.
    const result = spawnSync(process.execPath, [cli, 'review', planFile, out], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    const report = JSON.parse(await readFile(path.join(out, 'review.json'), 'utf8'));
    assert.equal(report.status, 'unverified');
    assert.equal(report.frames.length, count);
    assert.deepEqual(report.errors, []);
    const descriptor = JSON.parse(await readFile(path.join(out, 'measurement/sequence.json'), 'utf8'));
    assert.equal(descriptor.frames.length, count);
    assert.ok(descriptor.frames.every(f => f.duration === (1000 / 24) / 1000));
    for (const [i, f] of seq.frames.entries()) {
      const pixels = await sharp(path.join(out, 'measurement', `${i}.png`)).ensureAlpha().raw().toBuffer();
      assert.ok(pixels.equals(f.data), `${motion} frame ${i} changed`);
    }
    const after = await Promise.all([readFile(sheet), readFile(metadata), readFile(planFile)]);
    after.forEach((bytes, i) => assert.ok(bytes.equals(before[i]), 'source file changed'));
  }
}));

test('a crouched pose uses the neutral reference scale instead of being inflated to standing height', async () => temporary(async dir => {
  const reference = await manifest(dir, 'standing', frame(70)), crouch = await manifest(dir, 'crouch', frame(40));
  const value = await commonGameRequest({ reference, assets: [{ id: 'idle', source: reference }, { id: 'crouch', source: crouch }] }, dir);
  assert.equal(value.referenceBodyHeight, 60);
  assert.deepEqual(value.request.assets.map(a => a.source_body_height), [60, 60]);
  const mismatch = await manifest(dir, 'different-canvas', frame(40, 0, 81));
  await assert.rejects(commonGameRequest({ reference, assets: [{ id: 'wrong', source: mismatch }] }, dir), /Coordinate space/);
  assert.equal(alphaBounds((await loadSequence(crouch, dir)).frames[0]).bottom, 40);
}));
test('failed review still creates a self-contained preview and escapes annotation text', async () => temporary(async dir => {
  const seq = sequence(), a = annotations(seq); a.visual.anatomy = 'fail'; a.visual.notes = '</script><script>unexpected()</script>';
  const report = combineReview(seq, plan(), a, reports());
  await preview(seq, plan(), report, dir);
  const html = await readFile(path.join(dir, 'preview.html'), 'utf8');
  assert.ok(html.includes('data:image/png;base64,'));
  assert.ok(!html.includes('</script><script>unexpected()'));
  assert.ok(html.includes('\\u003c/script>'));
  assert.ok((await readFile(path.join(dir, 'contact-sheet.png'))).length > 100);
}));

test('a game-pack sequence decodes each sheet once and keeps the exact per-cell pixels', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gait-decode-'));
  try {
    // RGB (alpha added by ensureAlpha) and RGBA pages, cells in a 3x2 grid, one cell reused across both animations.
    const pixels = (w, h, channels, seed) => Buffer.from(Array.from({ length: w * h * channels }, (_, i) => (i * 37 + seed * 11) % 251));
    await sharp(pixels(96, 64, 3, 1), { raw: { width: 96, height: 64, channels: 3 } }).png().toFile(path.join(dir, 'rgb.png'));
    await sharp(pixels(96, 64, 4, 2), { raw: { width: 96, height: 64, channels: 4 } }).png().toFile(path.join(dir, 'rgba.png'));
    const frames = (prefix, image) => Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`${prefix}/${i}`, { frame: { x: i % 3 * 32, y: Math.floor(i / 3) * 32, w: 32, h: 32 },
      rotated: false, trimmed: false }]));
    const pack = { kind: 'sprite-gen-game-pack', version: 1, textures: [{ image: 'rgb.png', frames: frames('a', 'rgb.png') }, { image: 'rgba.png', frames: frames('b', 'rgba.png') }],
      animations: { mix: { frames: ['a/0', 'b/1', 'a/5', 'b/4', 'a/0'], durations_ms: [90, 90, 90, 90, 90] } } };
    await writeFile(path.join(dir, 'game-pack.json'), JSON.stringify(pack));
    const sequence = await loadSequence({ file: 'game-pack.json', animation: 'mix' }, dir);
    for (const [index, key] of pack.animations.mix.frames.entries()) {
      const texture = pack.textures.find(t => t.frames[key]), cell = texture.frames[key].frame;
      const expected = await sharp(path.join(dir, texture.image)).extract({ left: cell.x, top: cell.y, width: cell.w, height: cell.h }).ensureAlpha().raw().toBuffer();
      assert.ok(sequence.frames[index].data.equals(expected), `frame ${index} (${key})`);
      assert.deepEqual([sequence.frames[index].width, sequence.frames[index].height], [32, 32]);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a loop review fails on an engine retake reason, unnamed feet, a failing verdict or an unmeasured walk stride, and binds to the frames', () => {
  const seq = sequence(), verdicts = { identity: 'pass', anatomy: 'pass', loop: 'pass', notes: 'Clean loop.' };
  const aligned = { from: 27, strikes: [0, 8], foot: { feet: ['left', 'right'], margin: 0.13 } };
  const pass = loopReview({ motion: 'walk', sequence: seq, strip: { cycle_align: aligned }, visual: verdicts, judge: 'test', stridePixels: 90 });
  assert.equal(pass.status, 'pass', JSON.stringify(pass.errors));
  assert.deepEqual(pass.engine.feet, ['left', 'right']);
  assert.equal(requireLoopReview(pass, seq, 'walk'), pass);
  const retake = loopReview({ motion: 'walk', sequence: seq, strip: { cycle_align: { ...aligned, retake: { reason: 'broken-beat', reasons: ['broken-beat'] } } },
    visual: verdicts, judge: 'test', stridePixels: 90 });
  assert.deepEqual(retake.errors.map(e => e.code), ['ENGINE_RETAKE']);
  // The alignment could not tell the feet apart (a low shade margin), or named one foot twice.
  for (const foot of [undefined, { feet: [null, null] }, { feet: ['left', 'left'] }])
    assert.deepEqual(loopReview({ motion: 'run', sequence: { ...seq, frames: seq.frames.slice(0, 12), durations: seq.durations.slice(0, 12) },
      strip: { cycle_align: { ...aligned, foot } }, visual: verdicts, judge: 'test' }).errors.map(e => e.code), ['ENGINE_FEET_UNNAMED']);
  // A side view whose shade follows the step but whose strikes are too alike to name (2026-11-01): taken, and the review says how.
  const low = { cue: 'shade', feet: null, margin: 0.0174, rhythm: 0.278, why: 'low-margin: the two strikes differ by 0.0174 in shade, under the 0.025 it takes to name a foot' };
  const lowTaken = loopReview({ motion: 'walk', sequence: seq, strip: { cycle_align: { ...aligned, foot: low } }, visual: verdicts, judge: 'test', stridePixels: 90 });
  assert.equal(lowTaken.status, 'pass', JSON.stringify(lowTaken.errors));
  assert.deepEqual([lowTaken.engine.feet, lowTaken.engine.feetBy, lowTaken.engine.feetRhythm], [null, 'low-margin', 0.278]);
  assert.match(lowTaken.scope, /which foot is which is not named/);
  assert.equal(requireLoopReview(lowTaken, seq, 'walk'), lowTaken);
  assert.equal(pass.engine.feetBy, undefined);
  // Not taken: a cue that does not follow the step, a rhythm under the engine's, the depth cue (front/back views), no reason given.
  for (const foot of [{ ...low, why: 'the shade does not follow the step (rhythm 0.12)', rhythm: 0.12 }, { ...low, rhythm: 0.2 },
    { ...low, cue: 'depth' }, { ...low, why: undefined }, { ...low, rhythm: undefined }])
    assert.deepEqual(loopReview({ motion: 'walk', sequence: seq, strip: { cycle_align: { ...aligned, foot } }, visual: verdicts, judge: 'test',
      stridePixels: 90 }).errors.map(e => e.code), ['ENGINE_FEET_UNNAMED'], JSON.stringify(foot));
  // fighter:pack re-checks the record it is given: a low-margin claim without the rhythm that earns it is refused.
  for (const engine of [{ ...lowTaken.engine, feetRhythm: 0.1 }, { ...lowTaken.engine, feetBy: undefined }, { ...lowTaken.engine, feet: ['left'] }])
    assert.throws(() => requireLoopReview({ ...lowTaken, engine }, seq, 'walk'), /LOOP_REVIEW_INCOMPLETE/);
  const judged = loopReview({ motion: 'walk', sequence: seq, strip: { cycle_align: aligned }, visual: { ...verdicts, anatomy: 'fail' }, judge: 'test' });
  assert.deepEqual(judged.errors.map(e => e.code), ['VISUAL_ANATOMY', 'STRIDE_UNMEASURED']);
  assert.throws(() => requireLoopReview(judged, seq, 'walk'), /LOOP_REVIEW_REQUIRED/);
  const changed = { ...seq, durations: seq.durations.map((ms, i) => i ? ms : ms + 1) };
  assert.throws(() => requireLoopReview(pass, changed, 'walk'), /LOOP_REVIEW_STALE/);
  // The judge's loop alone (2026-10-30): a seam the engine measured inside its gate takes the cut, and the review says so; one past the
  // gate, or none measured, still fails on it.
  const seamed = ratio => loopReview({ motion: 'walk', sequence: seq, strip: { cycle_align: { ...aligned, ...(ratio === undefined ? {} : { seam_ratio: ratio }) } },
    visual: { ...verdicts, loop: 'fail' }, judge: 'test', stridePixels: 90 });
  const taken = seamed(1.41);
  assert.equal(taken.status, 'pass', JSON.stringify(taken.errors));
  assert.equal(taken.loopBy, 'engine-seam');
  assert.equal(requireLoopReview(taken, seq, 'walk'), taken);
  for (const ratio of [ENGINE_SEAM_MAX + 0.3, undefined]) assert.deepEqual(seamed(ratio).errors.map(e => e.code), ['VISUAL_LOOP'], String(ratio));
  assert.equal(pass.loopBy, undefined);
});
test('a loop review takes a gait at the frames it was filmed in, inside the contract range (gait-frames-1)', () => {
  const verdicts = { identity: 'pass', anatomy: 'pass', loop: 'pass', notes: 'Clean loop.' };
  const aligned = { from: 27, strikes: [0, 8], foot: { feet: ['left', 'right'], margin: 0.13 } };
  const counted = (motion, n) => loopReview({ motion, sequence: { frames: Array.from({ length: n }, (_, i) => frame(70, i)), durations: Array(n).fill(100) },
    strip: { cycle_align: aligned }, visual: verdicts, judge: 'test', stridePixels: 90 }).errors.map(e => e.code);
  for (const [motion, n] of [['walk', 12], ['walk', 24], ['walk', 32], ['run', 10], ['run', 14], ['run', 16]])
    assert.deepEqual(counted(motion, n), [], `${motion} ${n}`);
  for (const [motion, n] of [['walk', 11], ['walk', 33], ['run', 9], ['run', 17]])
    assert.deepEqual(counted(motion, n), ['FRAME_COUNT'], `${motion} ${n}`);
});
test('a common request carries each asset scale check, and none when not asked', async () => temporary(async dir => {
  const reference = await manifest(dir, 'standing', frame(70)), crouch = await manifest(dir, 'crouch', frame(40));
  const config = { reference, assets: [{ id: 'idle', source: reference }, { id: 'crouch', source: crouch }] };
  const scaleChecks = { idle: { report: 'game.scale-check-1.json', per: 'frame' }, crouch: { report: 'game.scale-check-2.json', per: 'frame', fix: { 'idle/0': 1 } } };
  const value = await commonGameRequest(config, dir, { scaleChecks });
  assert.deepEqual(value.request.assets.map(a => a.scale_check), [scaleChecks.idle, scaleChecks.crouch]);
  assert.ok((await commonGameRequest(config, dir)).request.assets.every(a => a.scale_check === undefined));
}));
test('scale-check measures each file only for the states taken from it, and searches lying states wide', () => {
  const config = { reference: { file: 'pack/manifest.json', state: 'idle' }, assets: [
    { id: 'idle', source: { file: 'pack/manifest.json', state: 'idle' } }, { id: 'ko', source: { file: 'pack/manifest.json', state: 'koLie' } },
    { id: 'cool', source: { file: 'pack/manifest.json', state: 'cooldown' } }, { id: 'walk', source: { file: 'walk/manifest.json', state: 'walk' } }],
    scaleCheck: { wideStates: ['walk'] } };
  const runs = scaleCheckRuns(config, '/kit', '/kit/out/game.json');
  const values = (args, flag) => args.flatMap((v, i) => v === flag ? [args[i + 1]] : []);
  assert.deepEqual(runs.map(run => run.file), [path.resolve('/kit', 'pack/manifest.json'), path.resolve('/kit', 'walk/manifest.json')]);
  assert.deepEqual(runs.map(run => values(run.args, '--state')), [['idle', 'koLie', 'cooldown'], ['walk']]);
  // koLie is a lying state by its words; cooldown is not "down"; wideStates adds to the words, never replaces them
  assert.deepEqual(runs.map(run => values(run.args, '--wide-state')), [['koLie'], ['walk']]);
  assert.deepEqual(runs.map(run => path.basename(run.report)), ['game.scale-check-1.json', 'game.scale-check-2.json']);
  assert.equal(path.basename(scaleCheckRuns({ ...config, assets: config.assets.slice(0, 2) }, '/kit', '/kit/game.json')[0].board), 'game.scale-check.png');
});
test('a cycle is one scale and any other clip frame by frame, by the words of its state', () => {
  const per = state => scalePer({ id: 'x', source: { state } }, {});
  assert.deepEqual(['walk', 'Walk', 'walkCycle', 'run_fast', 'jog', 'sprint-left'].map(per), Array(6).fill('state'));
  assert.deepEqual(['combo', 'fightIdle', 'rerun', 'brunch', 'groggy'].map(per), Array(5).fill('frame'));
  assert.equal(scalePer({ id: 'runAttack', source: { state: 'runAttack' } }, { scaleCheck: { per: { runAttack: 'frame' } } }), 'frame');
});
test('fixes name an asset of the request with a correction game-pack accepts, before anything is measured', () => {
  const config = { reference: { file: 'a.json', state: 'walk' }, assets: [{ id: 'walk', source: { file: 'a.json', state: 'walk' } }, { id: 'combo', source: { file: 'a.json', state: 'combo' } }] };
  const errors = fix => scaleCheckConfigErrors({ ...config, scaleCheck: { fix } });
  assert.deepEqual(errors({ walk: 1.02, combo: 1, 'combo/2': 0.97 }), []);
  assert.match(errors({ 'cmobo/1': 1 })[0], /names no asset/);
  assert.match(errors({ 'walk/1': 1.3 })[0], /walk is packed at one scale; fix it by its id/);
  assert.match(errors({ 'combo/2': null })[0], /must be a number from 0.5 to 2/);
  assert.match(errors({ combo: 3 })[0], /must be a number/);
  assert.match(scaleCheckConfigErrors({ ...config, scaleCheck: { wideStates: 'fall' } })[0], /wideStates must be a list/);
});
test('each asset reads its own file\'s report, and only a fix of its own settles its frames', () => {
  const config = { reference: { file: 'a.json', state: 'idle' }, assets: [
    { id: 'combo', source: { file: 'a.json', state: 'combo' } }, { id: 'combo-b', source: { file: 'b.json', state: 'combo' } },
    { id: 'walk', source: { file: 'a.json', state: 'walk' } }], scaleCheck: { fix: { 'combo-b/1': 1.05 } } };
  const runs = scaleCheckRuns(config, '/kit', '/kit/game.json');
  const frame = (how, correction) => ({ how, correction });
  const reports = [
    { assets: [{ identity: { state: 'combo' }, frames: [frame('head', 1), frame('head', 0.9)], state_correction: 0.95 },
      { identity: { state: 'walk' }, frames: [frame('check', null), frame('head', 1.1)], state_correction: null }] },
    { assets: [{ identity: { state: 'combo' }, frames: [frame('head', 1), frame('check', null)], state_correction: null }] }];
  let result = scaleCheckEntries(config, '/kit', runs, reports, '/kit');
  // a.json's combo is measured; b.json's unmeasured combo/1 is settled by its own fix, not by a.json's measurement
  assert.deepEqual(result.unsettled, ['walk']);
  assert.deepEqual(result.entries['combo'], { report: 'game.scale-check-1.json', per: 'frame' });
  assert.deepEqual(result.entries['combo-b'], { report: 'game.scale-check-2.json', per: 'frame', fix: { 'combo/1': 1.05 } });
  result = scaleCheckEntries({ ...config, scaleCheck: { fix: { walk: 1.04, 'combo/7': 1 } } }, '/kit', runs, reports, '/kit');
  assert.deepEqual(result.entries.walk, { report: 'game.scale-check-1.json', per: 'state', fix: { walk: 1.04 } });
  assert.deepEqual(result.errors, ['scaleCheck.fix.combo/7: combo has 2 frames']);
  assert.deepEqual(result.unsettled, ['combo-b/1']);
});
test('a scale-checked request must pack its reference', () => {
  const config = { reference: { file: './rows.json', state: 'idle' }, assets: [{ id: 'walk', source: { file: 'rows.json', state: 'walk' } }] };
  assert.match(scaleCheckConfigErrors(config)[0], /reference .* must also be one of the assets/);
  assert.deepEqual(scaleCheckConfigErrors({ ...config, assets: [...config.assets, { id: 'idle', source: { file: 'rows.json', state: 'idle' } }] }), []);
});
