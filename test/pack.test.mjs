import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { toDuelStyle } from '../contracts/ai-fighter/validate.mjs';
import { packFighter } from '../scripts/pack-fighter.mjs';
import { loadSequence, loopReview, sequenceHash } from '../tools/ai-fighter/gait.mjs';
import { creationTool } from '../scripts/creation-tool.mjs';
import { toSidePreviewPack } from '../contracts/ai-fighter/validate.mjs';

const fixture = fileURLToPath(new URL('../examples/sparring-bot/', import.meta.url));
let temporary;
before(async () => { temporary = await mkdtemp(path.join(tmpdir(), 'fighter-pack-')); });
after(async () => { await rm(temporary, { recursive: true, force: true }); });

/**
 * A `sprite-gen game-pack` output built from the sample bot: one page per animation, playback order with held
 * steps as separate cells, bottom-center anchors. Each source frame gets a torso mark so distinct frames stay
 * distinct (the sample's sine walk repeats poses).
 */
async function gamePack(name, { scale = 1, repeat, footEdge = false } = {}) {
  const directory = path.join(temporary, name);
  await mkdir(directory);
  const pack = { kind: 'sprite-gen-game-pack', version: 1, textures: [], animations: {} };
  for (const [motion, clip] of Object.entries(example.clips)) {
    const asset = example.assets.find(a => a.id === clip.assetId), sheet = path.join(fixture, asset.path);
    const order = clip.sequence ? clip.sequence.map(s => s.frame) : [...clip.frames];
    if (repeat === motion) order[1] = order[0];
    // footEdge: the canvas ends at the soles (the sample's feet reach row 440 of 512).
    const sourceHeight = footEdge ? 441 : clip.frameHeight;
    const width = Math.round(clip.frameWidth * scale), height = Math.round(sourceHeight * scale), tiles = [], frames = {}, keys = [];
    for (const [step, frame] of order.entries()) {
      const left = frame % clip.columns * clip.frameWidth, top = Math.floor(frame / clip.columns) * clip.frameHeight;
      const { data, info } = await sharp(sheet).extract({ left, top, width: clip.frameWidth, height: sourceHeight })
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let y = 226; y < 238; y++) for (let x = 120; x < 132; x++) data[(y * info.width + x) * 4] = 40 + frame * 12;
      const cell = await sharp(data, { raw: info }).resize(width, height).png().toBuffer();
      const key = `${motion}/${String(step).padStart(6, '0')}`, rect = { x: 1 + step * (width + 2), y: 1, w: width, h: height };
      tiles.push({ input: cell, left: rect.x, top: rect.y });
      frames[key] = { frame: rect, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: width, h: height }, sourceSize: { w: width, h: height } };
      keys.push(key);
    }
    const image = `atlas-${pack.textures.length}.png`;
    await sharp({ create: { width: order.length * (width + 2), height: height + 2, channels: 4, background: '#0000' } })
      .composite(tiles).png().toFile(path.join(directory, image));
    pack.textures.push({ image, frames });
    pack.animations[`bot/${motion}`] = { frames: keys, durations_ms: order.map(() => 90), loop: clip.loop, anchor: [width / 2, height],
      size: { w: width, h: height }, events: [] };
  }
  await writeFile(path.join(directory, 'game-pack.json'), JSON.stringify(pack));
  return directory;
}

/** Contact steps and landmarks come from the plan; borrowed cells name playback steps. */
function plan(directory, out, change = () => {}) {
  const motions = {};
  for (const [name, clip] of Object.entries(example.clips)) {
    motions[name] = { animation: `bot/${name}` };
    if (clip.hitSequenceIndices?.length) motions[name].hitSequenceIndices = clip.hitSequenceIndices;
    if (clip.landmarks) motions[name].landmarks = structuredClone(clip.landmarks);
  }
  motions.walk.stridePixels = 90;
  motions.dash.landmarks = { windup: { clip: 'fightIdle', step: 0 }, recover: { clip: 'fightIdle', step: 1 } };
  motions.fall.landmarks.getUp = [{ clip: 'hit', step: 4, durationMs: 90 }, { clip: 'fightIdle', step: 0, durationMs: 90 }];
  const value = { gamePack: 'game-pack.json', out, localId: 'packed-bot',
    reviewPolicy: 'files-only',
    profile: { name: 'Packed Bot', description: 'Packed from a sprite-gen game pack fixture.' }, motions };
  change(value);
  return value;
}
async function run(directory, value) {
  const file = path.join(directory, `plan-${value.out}.json`);
  await writeFile(file, JSON.stringify(value));
  return packFighter(file);
}

test('workspace MCP repairs 57 large skill frames without changing playback or other motions', async () => {
  const directory = await gamePack('large-skill');
  const baselineResult = await run(directory, plan(directory, 'baseline'));
  assert.equal(baselineResult.ok, true, JSON.stringify(baselineResult));
  const baseline = JSON.parse(await readFile(path.join(directory, 'baseline/fighter.json')));
  const packFile = path.join(directory, 'game-pack.json'), pack = JSON.parse(await readFile(packFile)), keys = [];
  for (let start = 0; start < 57; start += 35) {
    const count = Math.min(35, 57 - start), columns = 7, rows = Math.ceil(count / columns), frames = {}, tiles = [];
    for (let i = 0; i < count; i++) {
      const key = `skill/${start + i}`, rect = { x: i % columns * 534, y: Math.floor(i / columns) * 683, w: 534, h: 683 };
      const input = await sharp({ create: { width: 534, height: 683, channels: 4,
        background: { r: 80 + start + i, g: 100, b: 170, alpha: 1 } } }).png().toBuffer();
      tiles.push({ input, left: rect.x, top: rect.y }); frames[key] = { frame: rect }; keys.push(key);
    }
    const image = `skill-${start}.png`;
    await sharp({ create: { width: columns * 534, height: rows * 683, channels: 4, background: '#0000' } })
      .composite(tiles).png().toFile(path.join(directory, image));
    pack.textures.push({ image, frames });
  }
  pack.animations['bot/skill'] = { frames: keys, durations_ms: keys.map(() => 90), anchor: [267, 683], loop: false };
  await writeFile(packFile, JSON.stringify(pack));
  const originalPack = await readFile(packFile), originalImage = await readFile(path.join(directory, 'skill-0.png'));
  const value = plan(directory, 'unused', p => { p.motions.skill = { animation: 'bot/skill', hitSequenceIndices: [28], skill: { kind: 'pincer' } }; });
  await writeFile(path.join(directory, 'plan.json'), JSON.stringify(value));
  const args = { planPath: 'large-skill/plan.json', outputPath: 'output/velora-work/artifacts/fitted' };
  const blocked = await creationTool({ workspace: temporary, name: 'inspect_fighter_packaging', args });
  assert.equal(blocked.structuredContent.ok, false);
  const error = blocked.structuredContent.errors.find(error => error.code === 'SHEET_TOO_LARGE');
  assert.equal(error.data.frameWidth, 550); assert.equal(error.data.frameHeight, 699); assert.equal(error.data.frames, 57);
  assert.ok(error.data.repair.scale > .70 && error.data.repair.scale < .74);
  assert.equal(await stat(path.join(temporary, args.outputPath)).then(() => true, () => false), false);
  const repaired = await creationTool({ workspace: temporary, name: 'pack_fighter_package', args: { ...args, fitSheets: true } });
  assert.equal(repaired.structuredContent.ok, true, JSON.stringify(repaired));
  const output = path.join(temporary, args.outputPath), fighter = JSON.parse(await readFile(path.join(output, 'fighter.json')));
  assert.equal(fighter.clips.skill.frames.length, 57);
  assert.deepEqual(fighter.clips.skill.sequence, keys.map((_, frame) => ({ frame, durationMs: 90 })));
  assert.deepEqual(fighter.clips.skill.hitSequenceIndices, [28]);
  assert.ok(fighter.clips.skill.pixelScale > .70 && fighter.clips.skill.pixelScale < .74);
  assert.ok(fighter.assets.find(asset => asset.id === 'skill').height <= 4096);
  assert.equal(toSidePreviewPack(fighter).directions.side.skill.bodyHeight, 400 * fighter.clips.skill.pixelScale);
  for (const asset of baseline.assets) assert.equal(fighter.assets.find(item => item.id === asset.id).sha256, asset.sha256);
  assert.deepEqual(await readFile(packFile), originalPack);
  assert.deepEqual(await readFile(path.join(directory, 'skill-0.png')), originalImage);
  const retry = await creationTool({ workspace: temporary, name: 'pack_fighter_package', args: { ...args, fitSheets: true } });
  assert.equal(retry.structuredContent.errors[0].code, 'OUT_EXISTS');
});

test('workspace fitting measures and satisfies total byte/pixel and per-asset budgets without dropping frames', async () => {
  const directory = await gamePack('package-budget');
  assert.equal((await run(directory, plan(directory, 'baseline'))).ok, true);
  const baseline = JSON.parse(await readFile(path.join(directory, 'baseline/fighter.json')));
  const packFile = path.join(directory, 'game-pack.json'), pack = JSON.parse(await readFile(packFile)), keys = [];
  let seed = 127;
  // Deterministic synthetic texture noise: enough incompressible pixels to exercise actual byte limits too.
  for (let start = 0; start < 57; start += 35) {
    const count = Math.min(35, 57 - start), columns = 7, rows = Math.ceil(count / columns), frames = {}, tiles = [];
    for (let i = 0; i < count; i++) {
      const key = `budget/${start + i}`, rect = { x: i % columns * 534, y: Math.floor(i / columns) * 683, w: 534, h: 683 };
      const data = Buffer.alloc(534 * 683 * 4);
      for (let pixel = 0; pixel < 534 * 683; pixel++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        data[pixel * 4] = seed & 255; data[pixel * 4 + 1] = 100; data[pixel * 4 + 2] = 170; data[pixel * 4 + 3] = 255;
      }
      const input = await sharp(data, { raw: { width: 534, height: 683, channels: 4 } }).png().toBuffer();
      tiles.push({ input, left: rect.x, top: rect.y }); frames[key] = { frame: rect }; keys.push(key);
    }
    const image = `budget-${start}.png`;
    await sharp({ create: { width: columns * 534, height: rows * 683, channels: 4, background: '#0000' } })
      .composite(tiles).png().toFile(path.join(directory, image));
    pack.textures.push({ image, frames });
  }
  for (const name of ['skill', 'entrance', 'victory']) pack.animations[`bot/${name}`] = {
    frames: keys, durations_ms: keys.map(() => 90), anchor: [267, 683], loop: name === 'victory' };
  await writeFile(packFile, JSON.stringify(pack));
  const value = plan(directory, 'unused', p => {
    p.motions.skill = { animation: 'bot/skill', hitSequenceIndices: [28], skill: { kind: 'pincer' } };
    for (const name of ['entrance', 'victory']) p.motions[name] = { animation: `bot/${name}` };
    p.profile.portraitCrop = baseline.profile.portrait.crop;
    p.profile.previewCrop = baseline.profile.preview.crop;
  });
  await writeFile(path.join(directory, 'plan.json'), JSON.stringify(value));
  const sources = [packFile, ...pack.textures.map(t => path.join(directory, t.image))];
  const hashes = async () => Promise.all(sources.map(async file => createHash('sha256').update(await readFile(file)).digest('hex')));
  const before = await hashes();
  const result = await creationTool({ workspace: temporary, name: 'pack_fighter_package', args: {
    planPath: 'package-budget/plan.json', outputPath: 'output/budget-work/artifacts/fitted', fitSheets: true } });
  assert.equal(result.structuredContent.ok, true, JSON.stringify(result));
  const out = path.join(temporary, 'output/budget-work/artifacts/fitted');
  const fighter = JSON.parse(await readFile(path.join(out, 'fighter.json')));
  const report = JSON.parse(await readFile(path.join(out, 'pack-report.json')));
  assert.ok(report.budget.attempts.length > 1);
  assert.ok(report.budget.attempts[0].bytes > 10_000_000);
  assert.ok(report.budget.attempts[0].pixels > 33_554_432);
  assert.ok(report.budget.attempts[0].assets.some(asset => asset.bytes > 4_000_000));
  assert.equal(report.budget.encoding, 'lossless');
  assert.ok(report.budget.result.bytes <= 10_000_000);
  assert.ok(report.budget.result.pixels <= 33_554_432);
  assert.ok(fighter.assets.every(asset => asset.bytes <= 4_000_000));
  const density = report.budget.outputScale;
  assert.ok(density >= .25 && density < .7);
  for (const [name, clip] of Object.entries(fighter.clips)) {
    assert.equal(clip.pixelScale, density, name);
    assert.equal(toSidePreviewPack(fighter).directions.side[name].bodyHeight, 400 * density);
    if (baseline.clips[name]?.sequence) assert.deepEqual(clip.sequence, baseline.clips[name].sequence);
    if (baseline.clips[name]?.durationMs) assert.equal(clip.durationMs, baseline.clips[name].durationMs);
  }
  for (const name of ['skill', 'entrance', 'victory']) {
    assert.equal(fighter.clips[name].frames.length, 57);
    assert.deepEqual(fighter.clips[name].sequence, keys.map((_, frame) => ({ frame, durationMs: 90 })));
  }
  assert.deepEqual(fighter.clips.skill.hitSequenceIndices, [28]);
  assert.equal(fighter.clips.walk.stridePixels, 90 * density);
  assert.deepEqual(await hashes(), before);
});

test('explicit outputScale acts after 400px normalization and rejects values below the contract floor', async () => {
  const directory = await gamePack('explicit-density', { scale: .5 });
  await writeFile(path.join(directory, 'plan.json'), JSON.stringify(plan(directory, 'unused')));
  const result = await creationTool({ workspace: temporary, name: 'pack_fighter_package', args: {
    planPath: 'explicit-density/plan.json', outputPath: 'output/density-work/artifacts/half', outputScale: .5 } });
  assert.equal(result.structuredContent.ok, true, JSON.stringify(result));
  const fighter = JSON.parse(await readFile(path.join(temporary, 'output/density-work/artifacts/half/fighter.json')));
  assert.equal(fighter.appearance.bodyHeight, 400);
  for (const clip of Object.values(fighter.clips)) assert.equal(clip.pixelScale, .5);
  const invalid = await run(directory, plan(directory, 'invalid', p => { p.outputScale = .1; }));
  assert.equal(invalid.ok, false); assert.equal(invalid.errors[0].code, 'PLAN_SCHEMA');
});

// Only a format fixture: a lying hold, repeated recovery cell, then standing.
// Real characters must supply their own separate, visually reviewed get_up art.
async function addGetUp(directory, change = () => {}) {
  const file = path.join(directory, 'game-pack.json'), pack = JSON.parse(await readFile(file, 'utf8'));
  pack.animations['bot/get_up'] = { ...structuredClone(pack.animations['bot/fall']),
    frames: [pack.animations['bot/fall'].frames.at(-1), pack.animations['bot/hit'].frames[4],
      pack.animations['bot/hit'].frames[4], pack.animations['bot/fightIdle'].frames[0]],
    durations_ms: [120, 90, 150, 110], loop: false };
  change(pack.animations['bot/get_up'], pack);
  await writeFile(file, JSON.stringify(pack));
}
function useGetUp(value) {
  value.motions.fall.getUpAnimation = 'bot/get_up';
  delete value.motions.fall.landmarks.getUp;
}

// Format fixtures only: the skill replays the slam slower (its contact starts at 2 × skillMs), entrance and victory replay the guard.
async function addOptionalClips(directory, skillMs = 200) {
  const file = path.join(directory, 'game-pack.json'), pack = JSON.parse(await readFile(file, 'utf8'));
  const slam = pack.animations['bot/slam'], guard = pack.animations['bot/fightIdle'];
  pack.animations['bot/skill'] = { ...structuredClone(slam), durations_ms: slam.frames.map(() => skillMs) };
  pack.animations['bot/entrance'] = { ...structuredClone(guard), loop: false };
  pack.animations['bot/victory'] = structuredClone(guard);
  await writeFile(file, JSON.stringify(pack));
}
const style = { mix: { slam: 1, combo: 3, fast: 2 }, special: 'fast', super: 'dash', distance: 4, summon: 'crane',
  temper: { guard: 2, retreat: 4 }, exchanges: { cross: 3, rush: 1 } };
function useOptionalClips(value) {
  value.motions.skill = { animation: 'bot/skill', hitSequenceIndices: [2], skill: { kind: 'pincer' } };
  value.motions.entrance = { animation: 'bot/entrance' };
  value.motions.victory = { animation: 'bot/victory' };
}

test('separate get-up cells share fall storage without entering fall playback, including dedupe', async () => {
  const directory = await gamePack('get-up');
  const sourceFile = path.join(directory, 'game-pack.json'), source = JSON.parse(await readFile(sourceFile, 'utf8'));
  source.animations['bot/fall'].frames.push(source.animations['bot/fall'].frames.at(-1));
  source.animations['bot/fall'].durations_ms.push(130);
  await writeFile(sourceFile, JSON.stringify(source));
  assert.equal((await run(directory, plan(directory, 'baseline'))).ok, true);
  await addGetUp(directory);
  const result = await run(directory, plan(directory, 'auxiliary', useGetUp));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const baseline = JSON.parse(await readFile(path.join(directory, 'baseline/fighter.json'), 'utf8'));
  const fighter = JSON.parse(await readFile(path.join(directory, 'auxiliary/fighter.json'), 'utf8'));
  const fall = fighter.clips.fall, before = baseline.clips.fall;
  assert.equal(fall.sequence.length, 6);
  assert.deepEqual(fall.sequence, before.sequence);
  assert.deepEqual(fall.hitSequenceIndices, before.hitSequenceIndices);
  assert.equal(fall.sequence.at(-1).frame, fall.sequence[fall.landmarks.lieSequenceIndex].frame);
  const n = before.frames.length;
  assert.deepEqual(fall.landmarks.getUp, [
    { clip: 'fall', frame: fall.sequence.at(-1).frame, durationMs: 120 },
    { clip: 'fall', frame: n, durationMs: 90 }, { clip: 'fall', frame: n, durationMs: 150 },
    { clip: 'fall', frame: fall.sequence[0].frame, durationMs: 110 },
  ]);
  assert.equal(fall.frames.length, n + 1);
  assert.ok(fall.sequence.every(step => step.frame < n));
  assert.deepEqual(fighter.clips.dash.landmarks, baseline.clips.dash.landmarks);
  for (const asset of fighter.assets.filter(asset => asset.id !== 'fall')) {
    assert.equal(asset.sha256, baseline.assets.find(before => before.id === asset.id).sha256);
  }
  for (const [name, clip] of Object.entries(fighter.clips)) if (name !== 'fall') assert.deepEqual(clip, baseline.clips[name]);
  const report = JSON.parse(await readFile(result.report, 'utf8'));
  assert.equal(report.motions.fall.playbackSteps, before.sequence.length);
  assert.deepEqual(report.motions.fall.getUp.frames, fall.landmarks.getUp.map(step => step.frame));
  const repeat = await run(directory, plan(directory, 'auxiliary-repeat', useGetUp));
  assert.equal(repeat.ok, true);
  for (const file of ['fighter.json', 'assets/fall.webp']) assert.deepEqual(
    await readFile(path.join(directory, 'auxiliary', file)), await readFile(path.join(directory, 'auxiliary-repeat', file)));
});

test('get-up shares fall mirroring and body resampling; borrowed steps still refer only to playback', async () => {
  const directory = await gamePack('get-up-scaled', { scale: .5 });
  await addGetUp(directory);
  const value = plan(directory, 'fighter', p => {
    useGetUp(p); p.motions.fall.flipX = true;
    p.motions.dash.landmarks.windup = { clip: 'fall', step: 0 };
  });
  const result = await run(directory, value);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const fighter = JSON.parse(await readFile(path.join(directory, 'fighter/fighter.json'), 'utf8'));
  const fall = fighter.clips.fall;
  assert.equal(fall.landmarks.getUp[0].frame, fall.sequence.at(-1).frame);
  assert.equal(fall.landmarks.getUp[1].frame, fall.landmarks.getUp[2].frame);
  assert.deepEqual(fighter.clips.dash.landmarks.windup, { clip: 'fall', frame: fall.sequence[0].frame });
  assert.equal(JSON.parse(await readFile(result.report, 'utf8')).scale.resampled, 'lanczos3');
  value.out = 'bad-borrow'; value.motions.dash.landmarks.windup.step = fall.sequence.length;
  const bad = await run(directory, value);
  assert.equal(bad.errors[0].code, 'PLAN_FIELD');
  assert.equal(await stat(path.join(directory, value.out)).then(() => true, () => false), false);
});

test('get-up rejects conflicting plans, mismatched coordinates and invalid contracts without output', async () => {
  const directory = await gamePack('get-up-invalid');
  for (const [label, change, mutate, code] of [
    ['misplaced', p => { p.motions.walk.getUpAnimation = 'bot/get_up'; }, () => {}, 'PLAN_FIELD'],
    ['conflict', p => { p.motions.fall.landmarks.getUp = [{ clip: 'hit', step: 4, durationMs: 90 }]; }, () => {}, 'PLAN_FIELD'],
    ['missing', p => { p.motions.fall.getUpAnimation = 'missing'; }, () => {}, 'ANIMATION_NOT_FOUND'],
    ['anchor', () => {}, a => { a.anchor[1] -= 1; }, 'GET_UP_GEOMETRY'],
    ['canvas', () => {}, (a, p) => {
      a.frames = a.frames.map((key, i) => {
        const texture = p.textures.find(t => t.frames[key]), copy = structuredClone(texture.frames[key]);
        copy.frame.w -= 1; texture.frames[`aux-${i}`] = copy; return `aux-${i}`;
      });
    }, 'GET_UP_GEOMETRY'],
    ['count', () => {}, a => { a.frames = Array(9).fill(a.frames[0]); a.durations_ms = Array(9).fill(100); }, 'PLAN_FIELD'],
    ['duration', () => {}, a => { a.frames = Array(6).fill(a.frames[0]); a.durations_ms = Array(6).fill(2000); }, 'GET_UP_DURATION_LIMIT'],
    ['lying', p => { p.motions.fall.landmarks.lieSequenceIndex = 2; }, () => {}, 'FALL_END_POSE'],
  ]) {
    await addGetUp(directory, mutate);
    const result = await run(directory, plan(directory, label, p => { useGetUp(p); change(p); }));
    assert.equal(result.ok, false, label);
    assert.ok(result.errors.some(e => e.code === code), label + JSON.stringify(result.errors));
    assert.equal(await stat(path.join(directory, label)).then(() => true, () => false), false);
  }
});

test('a game pack becomes a package that passes full file validation', async () => {
  const directory = await gamePack('valid');
  const result = await run(directory, plan(directory, 'fighter'));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.stage, 'bytes-hashes-and-full-decode');
  const fighter = JSON.parse(await readFile(path.join(directory, 'fighter', 'fighter.json'), 'utf8'));
  assert.equal(fighter.clips.walk.frames.length, 16); assert.equal(fighter.clips.run.frames.length, 12);
  // A held step reuses its frame, so the fall still ends on the lying pose.
  assert.equal(fighter.clips.fall.frames.length, 4);
  assert.equal(fighter.clips.fall.sequence.at(-1).frame, fighter.clips.fall.sequence[fighter.clips.fall.landmarks.lieSequenceIndex].frame);
  assert.deepEqual(fighter.clips.dash.landmarks.windup, { clip: 'fightIdle', frame: 0 });
  assert.deepEqual(fighter.clips.fall.landmarks.getUp[0], { clip: 'hit', frame: 4, durationMs: 90 });
  // One ground line per motion; standing frames have feet on it.
  const idle = fighter.clips.idle.origins[0];
  assert.equal(idle.groundContacts.length, 2);
  assert.ok(idle.groundContacts.every(c => c.y === idle.originY));
  assert.ok(fighter.clips.walk.origins.every(o => o.originY === fighter.clips.walk.origins[0].originY));
  const report = JSON.parse(await readFile(result.report, 'utf8'));
  assert.equal(report.scale.resampled, false);
  assert.equal(typeof report.motions.walk.stride.measured, 'number');
  assert.equal(report.motions.walk.stride.source, 'plan');
});
test('optional clips, names, bout lines, grades and fighting style pass through to fighter.json', async () => {
  const directory = await gamePack('optional');
  await addOptionalClips(directory);
  const names = { ko: '포장 로봇', en: 'Packed Bot' }, lines = { challenge: 'Ready.', win: 'Format kept.', lose: 'Recalibrating.' };
  const stats = { power: 4, toughness: 2, speed: 3 };
  const result = await run(directory, plan(directory, 'fighter', value => {
    useOptionalClips(value); Object.assign(value.profile, { names, lines, stats, style });
  }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.stage, 'bytes-hashes-and-full-decode');
  const fighter = JSON.parse(await readFile(path.join(directory, 'fighter', 'fighter.json'), 'utf8'));
  assert.deepEqual(fighter.profile.names, names); assert.deepEqual(fighter.profile.lines, lines);
  assert.deepEqual(fighter.combat, { kitId: 'standard-duel', stats, style });
  // The skill marks are playback steps, carried as given; the sheet, origins and hashes are measured like every action.
  const { skill, entrance, victory } = fighter.clips;
  assert.deepEqual(skill.skill, { kind: 'pincer' }); assert.deepEqual(skill.hitSequenceIndices, [2]);
  assert.ok(skill.sequence.every(step => step.durationMs === 200));
  assert.equal(entrance.loop, false); assert.equal(victory.loop, true);
  assert.deepEqual(entrance.hitSequenceIndices, []); assert.equal(victory.landmarks, undefined);
  for (const name of ['skill', 'entrance', 'victory']) assert.ok(fighter.assets.some(asset => asset.id === fighter.clips[name].assetId), name);
  assert.equal(fighter.assets.length, 14);
  assert.deepEqual(toDuelStyle(fighter), { ...style, skill: 'pincer' });
  const report = JSON.parse(await readFile(result.report, 'utf8'));
  assert.deepEqual(Object.keys(report.motions).slice(-3), ['skill', 'entrance', 'victory']);
  // A stance skill carries its window and strike marks the same way.
  const stance = { kind: 'counter', windowFrom: 1, windowTo: 2, strikeFrom: 2, strikeTo: 3 };
  const countered = await run(directory, plan(directory, 'counter', value => { useOptionalClips(value); value.motions.skill.skill = stance; }));
  assert.equal(countered.ok, true, JSON.stringify(countered.errors));
  const counter = JSON.parse(await readFile(path.join(directory, 'counter', 'fighter.json'), 'utf8'));
  assert.deepEqual(counter.clips.skill.skill, stance); assert.equal(toDuelStyle(counter).skill, 'counter');
  // Without the optional fields the package is the one it always was.
  const plain = await run(directory, plan(directory, 'plain'));
  assert.equal(plain.ok, true, JSON.stringify(plain.errors));
  const baseline = JSON.parse(await readFile(path.join(directory, 'plain', 'fighter.json'), 'utf8'));
  assert.deepEqual(Object.keys(baseline.clips), Object.keys(example.clips));
  assert.deepEqual(baseline.combat, { kitId: 'standard-duel' }); assert.equal(toDuelStyle(baseline), null);
});
test('optional clips are checked by the plan and by the contract before anything is written', async () => {
  const directory = await gamePack('optional-invalid');
  await addOptionalClips(directory);
  // A stance whose 1200 ms window (one step) outlasts the bout's rhythm.
  const packFile = path.join(directory, 'game-pack.json'), source = JSON.parse(await readFile(packFile, 'utf8'));
  source.animations['bot/skill-long'] = { ...source.animations['bot/skill'], durations_ms: [200, 1200, 200, 200] };
  await writeFile(packFile, JSON.stringify(source));
  for (const [label, change, code] of [
    ['skill-on-slam', p => { p.motions.slam.skill = { kind: 'pincer' }; }, 'PLAN_FIELD'],
    ['unknown-clip', p => { p.motions.taunt = { animation: 'bot/fightIdle' }; }, 'PLAN_SCHEMA'],
    ['missing-animation', p => { p.motions.victory.animation = 'bot/missing'; }, 'ANIMATION_NOT_FOUND'],
    ['no-kind', p => { delete p.motions.skill.skill; }, 'SCHEMA_REQUIRED'],
    ['no-contact', p => { p.motions.skill.hitSequenceIndices = []; }, 'SKILL_CONTACT'],
    ['run-marks', p => { p.motions.skill = { animation: 'bot/skill', skill: { kind: 'flight', windupTo: 3, recoverFrom: 1 } }; }, 'SKILL_RUN_MARKS'],
    ['stance-marks', p => { p.motions.skill.skill = { kind: 'counter', windowFrom: 1, windowTo: 3, strikeFrom: 3, strikeTo: 3 }; }, 'SKILL_STANCE_MARKS'],
    ['stance-window', p => { p.motions.skill.skill = { kind: 'brace', windowFrom: 1, windowTo: 2, strikeFrom: 2, strikeTo: 3 };
      p.motions.skill.animation = 'bot/skill-long'; }, 'SKILL_WINDOW'],
    ['mix', p => { p.profile.style = { mix: { slam: 0, combo: 1, fast: 2 } }; }, 'STYLE_MIX'],
    ['extras', p => { p.profile.style = { summon: 'bolt', shockwave: true }; }, 'STYLE_EXTRAS'],
    ['long-line', p => { p.profile.lines = { win: 'x'.repeat(41) }; }, 'SCHEMA_MAXLENGTH'],
  ]) {
    const result = await run(directory, plan(directory, label, p => { useOptionalClips(p); change(p); }));
    assert.equal(result.ok, false, label);
    assert.ok(result.errors.some(e => e.code === code), label + JSON.stringify(result.errors));
    assert.equal(await stat(path.join(directory, label)).then(() => true, () => false), false, label);
  }
  // A contact sooner than the tell floor (two 90 ms steps) is too fast to read.
  const quick = await gamePack('optional-quick');
  await addOptionalClips(quick, 90);
  const tell = await run(quick, plan(quick, 'fighter', useOptionalClips));
  assert.ok(tell.errors.some(e => e.code === 'SKILL_TELL' && e.path === '/clips/skill/hitSequenceIndices/0'), JSON.stringify(tell.errors));
});
test('packing is deterministic, never overwrites and writes nothing for an invalid plan', async () => {
  const directory = await gamePack('repeat-run');
  for (const out of ['first', 'second']) assert.equal((await run(directory, plan(directory, out))).ok, true);
  for (const file of ['fighter.json', ...example.assets.map(a => a.path)])
    assert.ok((await readFile(path.join(directory, 'first', file))).equals(await readFile(path.join(directory, 'second', file))), file);
  const again = await run(directory, plan(directory, 'first'));
  assert.equal(again.errors[0].code, 'OUT_EXISTS');
  const missingHits = await run(directory, plan(directory, 'invalid', value => { delete value.motions.combo.hitSequenceIndices; }));
  assert.equal(missingHits.ok, false);
  assert.ok(missingHits.errors.some(e => e.path === '/clips/combo/hitSequenceIndices'), JSON.stringify(missingHits.errors));
  assert.deepEqual((await readdir(directory)).filter(name => name.includes('invalid')), ['plan-invalid.json']);
});
test('lossy packing (the hosted plan) keeps every alpha value exact and is deterministic', async () => {
  const directory = await gamePack('lossy');
  for (const [out, encoding] of [['exact', 'lossless'], ['lossy', 'lossy'], ['lossy-again', 'lossy']])
    assert.equal((await run(directory, plan(directory, out, value => { value.encoding = encoding; value.quality = 90; }))).ok, true, out);
  const alpha = async file => (await sharp(file).ensureAlpha().extractChannel(3).raw().toBuffer());
  let edge = 0;
  for (const file of example.assets.map(a => a.path)) {
    const lossy = await readFile(path.join(directory, 'lossy', file));
    assert.ok(lossy.equals(await readFile(path.join(directory, 'lossy-again', file))), `${file}: same bytes on a second run`);
    const exact = await alpha(path.join(directory, 'exact', file));
    assert.ok((await alpha(lossy)).equals(exact), `${file}: alpha differs from the lossless pack`);
    edge += exact.filter(a => a > 0 && a < 255).length;
  }
  assert.ok(edge > 0, 'the fixture has anti-aliased edges, so quantised alpha would show');
});
test('a package that fails file validation is never published, so the corrected plan can reuse the folder', async () => {
  const directory = await gamePack('pixel-check');
  // In bounds for the contract, but over transparent pixels: only the decoded-pixel check can reject it.
  const empty = await run(directory, plan(directory, 'pixel', value => { value.profile.portraitCrop = { x: 0, y: 0, width: 16, height: 16 }; }));
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.some(e => e.code === 'EMPTY_PROFILE_CROP'), JSON.stringify(empty.errors));
  assert.deepEqual((await readdir(directory)).filter(name => name.includes('pixel')), ['plan-pixel.json'], 'no package or staging folder is left');
  assert.equal((await run(directory, plan(directory, 'pixel'))).ok, true);
});
test('a walk that repeats a frame is refused instead of padded', async () => {
  const directory = await gamePack('repeated-walk', { repeat: 'walk' });
  const result = await run(directory, plan(directory, 'fighter'));
  assert.equal(result.errors[0].code, 'GAIT_FRAMES');
});
test('a game pack at the wrong body scale is resampled to the 400 px body', async () => {
  const directory = await gamePack('half', { scale: 0.5 });
  const result = await run(directory, plan(directory, 'fighter'));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const report = JSON.parse(await readFile(result.report, 'utf8'));
  assert.equal(report.scale.resampled, 'lanczos3');
  assert.ok(Math.abs(report.scale.measuredBodyHeight - 202) <= 3, String(report.scale.measuredBodyHeight));
  const fighter = JSON.parse(await readFile(path.join(directory, 'fighter', 'fighter.json'), 'utf8'));
  const idle = fighter.assets.find(a => a.id === 'idle');
  assert.ok(idle.height > 400 && idle.height < 440, String(idle.height));
});
test('plan fields are checked against the motion they belong to', async () => {
  const directory = await gamePack('plan-checks');
  const misplaced = await run(directory, plan(directory, 'a', value => { value.motions.run.stridePixels = 120; }));
  assert.equal(misplaced.errors[0].code, 'PLAN_FIELD');
  const unknown = await run(directory, plan(directory, 'b', value => { value.motions.idle.hp = 999; }));
  assert.equal(unknown.errors[0].code, 'PLAN_SCHEMA');
  const badStep = await run(directory, plan(directory, 'c', value => { value.motions.dash.landmarks.windup.step = 40; }));
  assert.equal(badStep.errors[0].code, 'PLAN_FIELD');
  const misplacedReview = await run(directory, plan(directory, 'd', value => { value.motions.idle.gaitReview = 'walk-review.json'; }));
  assert.equal(misplacedReview.errors[0].code, 'PLAN_FIELD');
  assert.equal(await stat(path.join(directory, 'a')).then(() => true, () => false), false);
});
test('feet on the canvas edge still get transparent room for their contacts', async () => {
  const directory = await gamePack('foot-edge', { footEdge: true });
  const result = await run(directory, plan(directory, 'fighter'));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const fighter = JSON.parse(await readFile(path.join(directory, 'fighter', 'fighter.json'), 'utf8'));
  const idle = fighter.clips.idle;
  assert.equal(idle.origins[0].groundContacts.length, 2);
  assert.ok(idle.frameHeight - idle.origins[0].originY >= 8);
});

test('normal authoring packages files without a gait or visual review', async () => {
  const directory = await gamePack('review-required');
  await addGetUp(directory);
  const result = await run(directory, plan(directory, 'fighter', value => { useGetUp(value); delete value.reviewPolicy; }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const report = JSON.parse(await readFile(result.report, 'utf8'));
  assert.equal(report.reviewPolicy, 'files-only');
  assert.equal(report.qualityReview, 'deferred');
});

test('reviewed variable-length input keeps its count, uses fresh measurements and defers stale quality evidence', async () => {
  const directory = await gamePack('review-bound');
  await addGetUp(directory);
  // Video frame times are rarely whole milliseconds (24 fps = 41.66… ms). The review binds these exact values.
  const sourceFile = path.join(directory, 'game-pack.json'), source = JSON.parse(await readFile(sourceFile, 'utf8'));
  for (const [motion, count] of [['walk', 12], ['run', 10]]) {
    const animation = source.animations[`bot/${motion}`];
    animation.frames = animation.frames.slice(0, count);
    animation.durations_ms = Array(count).fill(1000 / 24);
  }
  await writeFile(sourceFile, JSON.stringify(source));
  const value = plan(directory, 'fighter', p => { useGetUp(p); delete p.reviewPolicy; delete p.motions.walk.stridePixels; });
  for (const motion of ['walk', 'run']) {
    const sequence = await loadSequence({ file: 'game-pack.json', animation: `bot/${motion}` }, directory);
    // Fixture evidence exercises binding/packaging only, not a claim that the sample bot walks well.
    const review = { kind: 'ai-fighter-gait-review', version: 1, motion, status: 'pass', sequenceSha256: sequenceHash(sequence),
      errors: [], missing: [], stridePixels: 123, geometry: { width: sequence.frames[0].width, height: sequence.frames[0].height, groundY: 441 },
      visual: { identity: 'pass', anatomy: 'pass', alternation: 'pass', loop: 'pass' },
      stances: [{ foot: 'near' }, { foot: 'far' }], stanceReports: [{ stride_verified: true }, { stride_verified: true }] };
    await writeFile(path.join(directory, `${motion}-review.json`), JSON.stringify(review));
    value.motions[motion].gaitReview = `${motion}-review.json`;
  }
  const first = await run(directory, value);
  assert.equal(first.ok, true, JSON.stringify(first.errors));
  const fighter = JSON.parse(await readFile(path.join(directory, 'fighter/fighter.json'), 'utf8'));
  assert.equal(fighter.clips.walk.stridePixels, 123);
  assert.equal(fighter.clips.walk.frames.length, 12);
  assert.equal(fighter.clips.run.frames.length, 10);
  assert.equal(fighter.clips.walk.durationMs, 42);
  const packFile = path.join(directory, 'game-pack.json'), pack = JSON.parse(await readFile(packFile, 'utf8'));
  // Still stale when the change disappears in whole-millisecond rounding.
  pack.animations['bot/walk'].durations_ms[0] += 0.2;
  await writeFile(packFile, JSON.stringify(pack));
  value.out = 'changed';
  const stale = await run(directory, value);
  assert.equal(stale.ok, true, JSON.stringify(stale.errors));
  const deferred = JSON.parse(await readFile(stale.report, 'utf8'));
  assert.equal(deferred.motions.walk.qualityDiagnostics[0].code, 'GAIT_REVIEW_STALE');
  assert.equal(deferred.motions.walk.stride.source, 'silhouette-estimate');
});

test('hosted loops pack with loop reviews: engine checks, judge verdicts and the measured stride, bound to the pixels', async () => {
  const directory = await gamePack('loop-review');
  await addGetUp(directory);
  const value = plan(directory, 'fighter', p => { useGetUp(p); p.reviewPolicy = 'engine-loop'; delete p.motions.walk.stridePixels; });
  const missing = await run(directory, { ...value, out: 'missing' });
  assert.equal(missing.ok, true, JSON.stringify(missing.errors));
  for (const motion of ['walk', 'run']) {
    const sequence = await loadSequence({ file: 'game-pack.json', animation: `bot/${motion}` }, directory);
    // Fixture evidence exercises binding and packaging only, not a claim that the sample bot walks well.
    const review = loopReview({ motion, sequence, strip: { kind: 'periodic', cycle_align: { from: 27, seam_ratio: 0.9, beat: { jolt: 0.2 },
      strikes: [0, 8], foot: { feet: ['left', 'right'], margin: 0.13 } } },
      visual: { identity: 'pass', anatomy: 'pass', loop: 'pass', notes: 'Fixture verdicts.' }, judge: 'fixture',
      stridePixels: 111 });
    assert.equal(review.status, 'pass', JSON.stringify(review.errors));
    await writeFile(path.join(directory, `${motion}-loop.json`), JSON.stringify(review));
    value.motions[motion].loopReview = `${motion}-loop.json`;
  }
  const mixed = await run(directory, { ...value, out: 'mixed', reviewPolicy: 'required' });
  assert.equal(mixed.ok, true, JSON.stringify(mixed.errors));
  const packed = await run(directory, value);
  assert.equal(packed.ok, true, JSON.stringify(packed.errors));
  const fighter = JSON.parse(await readFile(path.join(directory, 'fighter/fighter.json'), 'utf8'));
  const report = JSON.parse(await readFile(path.join(directory, 'fighter/pack-report.json'), 'utf8'));
  assert.equal(fighter.clips.walk.stridePixels, 111);
  assert.equal(report.motions.walk.stride.source, 'loop-review');
  assert.equal(report.qualityReview, 'deferred');
  const packFile = path.join(directory, 'game-pack.json'), pack = JSON.parse(await readFile(packFile, 'utf8'));
  pack.animations['bot/run'].durations_ms = pack.animations['bot/run'].durations_ms.map(ms => ms + 5);
  await writeFile(packFile, JSON.stringify(pack));
  const stale = await run(directory, { ...value, out: 'stale' });
  assert.equal(stale.ok, true, JSON.stringify(stale.errors));
  const deferred = JSON.parse(await readFile(stale.report, 'utf8'));
  assert.equal(deferred.motions.run.qualityDiagnostics[0].code, 'LOOP_REVIEW_STALE');
});


test('Velora-style unverified diagnostics and legacy policies never block or alter package pixels', async () => {
  const directory = await gamePack('deferred-quality');
  const diagnostic = { kind: 'ai-fighter-gait-review', version: 1, motion: 'walk', status: 'unverified', errors: [],
    missing: ['Visual review: anatomy', 'Visual review: alternation', 'Visual review: loop', 'Unverified stance: 0', 'Unverified stance: 1'] };
  await writeFile(path.join(directory, 'walk-review.json'), JSON.stringify(diagnostic));
  const baseline = await run(directory, plan(directory, 'baseline'));
  assert.equal(baseline.ok, true, JSON.stringify(baseline.errors));
  for (const policy of ['files-only', 'required', 'engine-loop']) {
    const result = await run(directory, plan(directory, policy, p => {
      p.reviewPolicy = policy; p.motions.walk.gaitReview = 'walk-review.json'; p.motions.run.loopReview = 'missing.json';
    }));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const audit = JSON.parse(await readFile(result.report, 'utf8'));
    assert.equal(audit.reviewPolicy, 'files-only'); assert.equal(audit.qualityReview, 'deferred');
    assert.deepEqual(audit.motions.walk.qualityDiagnostics[0].report, diagnostic);
    assert.equal(audit.motions.walk.qualityDiagnostics[0].status, 'deferred');
    assert.equal(audit.motions.run.qualityDiagnostics[0].status, 'deferred');
    for (const file of ['fighter.json', ...example.assets.map(a => a.path)])
      assert.ok((await readFile(path.join(directory, 'baseline', file))).equals(await readFile(path.join(directory, policy, file))), file);
  }
  const invalid = await run(directory, plan(directory, 'invalid-duration', p => { p.motions.walk.durationMs = 0; }));
  assert.equal(invalid.ok, false);
  assert.equal(await stat(path.join(directory, 'invalid-duration')).then(() => true, () => false), false);
});


test('WebP-only game-pack textures produce the same final fighter bytes as PNG textures', async () => {
  const directory = await gamePack('webp-input');
  const original = await run(directory, plan(directory, 'from-png'));
  assert.equal(original.ok, true, JSON.stringify(original.errors));
  const file = path.join(directory, 'game-pack.json'), source = JSON.parse(await readFile(file, 'utf8'));
  const before = await loadSequence({ file: 'game-pack.json', animation: 'bot/walk' }, directory);
  for (const texture of source.textures) {
    const webp = texture.image.replace(/\.png$/, '.webp');
    await sharp(path.join(directory, texture.image)).webp({ lossless: true }).toFile(path.join(directory, webp));
    texture.image = texture.webp = webp;
  }
  await writeFile(file, JSON.stringify(source));
  const after = await loadSequence({ file: 'game-pack.json', animation: 'bot/walk' }, directory);
  assert.equal(sequenceHash(after), sequenceHash(before));
  const packed = await run(directory, plan(directory, 'from-webp'));
  assert.equal(packed.ok, true, JSON.stringify(packed.errors));
  for (const name of ['fighter.json', ...example.assets.map(a => a.path)])
    assert.ok((await readFile(path.join(directory, 'from-png', name))).equals(await readFile(path.join(directory, 'from-webp', name))), name);
});
