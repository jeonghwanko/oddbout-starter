// Authoring evidence around sprite-gen. No generation, image repair or atlas assembly here.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { inspectProjectedGround } from './projected-ground.mjs';
import spec from '../../contracts/ai-fighter/v1/spec.json' with { type: 'json' };

export const digest = value => createHash('sha256').update(value).digest('hex');
export const round = n => Math.round(n * 1000) / 1000;
const positive = n => Number.isFinite(n) && n > 0;
export function sequenceHash(sequence) {
  return digest(JSON.stringify({ dimensions: sequence.frames.map(f => [f.width, f.height]),
    pixels: sequence.frames.map(f => digest(f.data)), durations: sequence.durations }));
}
export function alphaBounds(frame, threshold = 32) {
  let left = frame.width, top = frame.height, right = 0, bottom = 0;
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
    if (frame.data[(y * frame.width + x) * 4 + 3] < threshold) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  }
  return right ? { left, top, right, bottom } : null;
}
export async function loadSequence(source, base = '.') {
  const file = path.resolve(base, source.file), metadata = JSON.parse(await readFile(file, 'utf8'));
  let cells, durations;
  if (metadata.kind === 'sprite-gen-game-pack') {
    const animation = metadata.animations?.[source.animation];
    if (!animation) throw Error('Animation not found: ' + source.animation);
    cells = animation.frames.map(key => {
      const page = metadata.textures.find(t => t.frames[key]);
      const entry = page?.frames[key];
      if (!entry || entry.rotated || entry.trimmed) throw Error('Unsupported game-pack frame: ' + key);
      return { image: page.image, ...entry.frame };
    });
    durations = animation.durations_ms;
  } else {
    const state = metadata.animation?.rows?.[source.state];
    cells = metadata.frame_layout?.rows?.[source.state]?.map(r => ({ image: metadata.sprite_sheet_alpha, ...r }));
    if (!state || !cells) throw Error('Expected sprite-gen manifest.frame_layout for ' + source.state);
    durations = state.durations_ms ?? cells.map(() => Math.round(1000 / state.fps));
  }
  if (!cells.length || durations?.length !== cells.length || !durations.every(positive)) throw Error('Invalid frame timing');
  // Decode each sheet once and copy cells out of it (a 16-frame walk used to decode its sheet 16 times). The bytes are
  // the same as a per-cell extract, so reviews bound to sequenceHash still verify; other pixel formats keep the extract.
  const pages = new Map(), frames = [];
  const page = image => {
    if (!pages.has(image)) pages.set(image, sharp(path.resolve(path.dirname(file), image)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
    return pages.get(image);
  };
  for (const cell of cells) {
    const { data: sheet, info: sheetInfo } = await page(cell.image);
    const inside = cell.x >= 0 && cell.y >= 0 && cell.x + cell.w <= sheetInfo.width && cell.y + cell.h <= sheetInfo.height;
    if (sheetInfo.channels === 4 && sheet.length === sheetInfo.width * sheetInfo.height * 4 && inside) {
      const data = Buffer.allocUnsafe(cell.w * cell.h * 4);
      for (let y = 0; y < cell.h; y++) sheet.copy(data, y * cell.w * 4, ((cell.y + y) * sheetInfo.width + cell.x) * 4, ((cell.y + y) * sheetInfo.width + cell.x + cell.w) * 4);
      frames.push({ width: cell.w, height: cell.h, data });
      continue;
    }
    const { data, info } = await sharp(path.resolve(path.dirname(file), cell.image))
      .extract({ left: cell.x, top: cell.y, width: cell.w, height: cell.h }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    frames.push({ width: info.width, height: info.height, data });
  }
  const sequence = { file, frames, durations, metadata, source };
  sequence.sha256 = sequenceHash(sequence);
  return sequence;
}

export function walkPlan() {
  const names = ['contact', 'loading', 'down', 'stance', 'passing', 'rising', 'push-off', 'pre-contact'];
  return {
    version: 1, motion: 'walk', facing: 'right',
    source: { file: 'sprites/manifest.json', state: 'walk' },
    geometry: { width: 512, height: 512, safeMarginX: 52, safeMarginY: 52, groundY: 460, groundTolerance: 3 },
    footIdentity: { near: 'The same camera-facing leg throughout; never choose by screen x.', far: 'The same farther leg throughout.' },
    phases: Array.from({ length: 16 }, (_, index) => ({ index, phase: index / 16,
      pose: names[index % 8], support: index % 8 === 0 ? ['near', 'far'] : [index < 8 ? 'near' : 'far'],
      leadingFoot: index < 8 ? 'near' : 'far' })),
  };
}
export function validatePlan(plan, sequence) {
  if (plan.version !== 1 || !['walk', 'run'].includes(plan.motion) || !['right', 'left'].includes(plan.facing)) throw Error('Invalid gait plan');
  const { frames: standard, minFrames = standard, maxFrames = standard } = spec.motions[plan.motion];
  const count = plan.phases?.length;
  if (!Array.isArray(plan.phases) || count < minFrames || count > maxFrames) throw Error('Invalid gait frame count');
  // Every source frame needs its own phase; a shorter plan must not leave the tail's contacts unchecked.
  if (sequence && sequence.frames.length !== count) throw Error('Gait phase count does not match sequence frames');
  if (plan.phases.some((p, i) => !p ||
    p.index !== i || p.phase !== i / count || !Array.isArray(p.support) || new Set(p.support).size !== p.support.length ||
    p.support.some(f => !['near', 'far'].includes(f)) || (plan.motion === 'walk' && !p.support.length))) throw Error('Invalid gait phases');
  if (!['near', 'far'].every(foot => plan.phases.some(p => p.support.length === 1 && p.support[0] === foot))) throw Error('Plan must alternate support between both feet');
  const g = plan.geometry;
  if (!g || !Number.isInteger(g.width) || !Number.isInteger(g.height) || !positive(g.width) || !positive(g.height) ||
    !positive(g.groundTolerance) || !positive(g.groundY) || g.groundY > g.height) throw Error('Invalid common geometry');
  if (sequence && sequence.frames.some(f => f.width !== g.width || f.height !== g.height)) throw Error('Frame canvas differs from the common geometry');
}

export function inspectGeometry(sequence, plan) {
  validatePlan(plan, sequence);
  const errors = [], warnings = [], frames = sequence.frames.map((frame, index) => ({ index, bounds: alphaBounds(frame), sha256: digest(frame.data) }));
  // validatePlan checks the contract range and exact phase coverage without resampling the sequence.
  if (new Set(frames.map(f => f.sha256)).size !== frames.length) errors.push({ code: 'DUPLICATE_FRAME' });
  for (const frame of frames) {
    if (!frame.bounds) { errors.push({ code: 'EMPTY_FRAME', frame: frame.index }); continue; }
    // A silhouette on the baseline is only a geometry check, never proof of a planted foot.
    if (plan.phases[frame.index]?.support.length && Math.abs(frame.bounds.bottom - plan.geometry.groundY) > plan.geometry.groundTolerance)
      errors.push({ code: 'GROUND_OFFSET', frame: frame.index, measured: frame.bounds.bottom, expected: plan.geometry.groundY });
    if (frame.bounds.left === 0 || frame.bounds.top === 0 || frame.bounds.right === plan.geometry.width || frame.bounds.bottom === plan.geometry.height)
      errors.push({ code: 'CLIPPED_EDGE', frame: frame.index });
  }
  warnings.push('Baseline alignment does not prove foot identity or ground contact. Visual judgements and isolated same-foot measurements are still required.');
  return { errors, warnings, frames };
}

// A declared exception requires the matching explicit evidence engine. No silent
// fallback to ordinary geometry or a hand-written stride value.
function contactEvidenceMatches(report, stance, sequence, facing) {
  const extended = report?.measurement_engine;
  if (stance.footEvidence === undefined && extended === undefined) return true;
  const version = { 'ai-fighter-foot-evidence-v1': 1, 'ai-fighter-foot-evidence-v2': 2 }[extended];
  if (typeof stance.footEvidence !== 'string' || !stance.footEvidence.trim() || !version) return false;
  const proof = report.foot_evidence, binding = proof?.sequence;
  const expected = { foot: stance.foot, start: stance.start, end: stance.end, box: stance.box, facing };
  return proof?.status === 'verified' && proof.issues?.length === 0 &&
    Object.entries(expected).every(([key, value]) => JSON.stringify(proof.stance?.[key]) === JSON.stringify(value)) &&
    binding?.rgbaSha256?.length === sequence.frames.length && binding.rgbaSha256.every((hash, i) => hash === digest(sequence.frames[i].data)) &&
    binding?.durationsSeconds?.length === sequence.durations.length && binding.durationsSeconds.every((duration, i) => duration === sequence.durations[i] / 1000) &&
    binding?.size?.[0] === sequence.frames[0].width && binding?.size?.[1] === sequence.frames[0].height &&
    proof.observations?.length === stance.end - stance.start + 1 &&
    proof.observations.every((observation, i) => observation.frame === stance.start + i && observation.issues?.length === 0) &&
    proof.declaration?.kind === 'ai-fighter-foot-evidence' && proof.declaration.version === version &&
    proof.declaration.frames?.length === proof.observations.length && report.upstream_report !== undefined;
}

export function combineReview(sequence, plan, annotations, stanceReports = []) {
  const geometry = inspectGeometry(sequence, plan), errors = [...geometry.errors], missing = [];
  if (!annotations || annotations.sequenceSha256 !== sequence.sha256) missing.push('Current-sequence annotations');
  const current = annotations?.sequenceSha256 === sequence.sha256 ? annotations : null;
  for (const item of ['identity', 'anatomy', 'alternation', 'loop']) {
    const verdict = current?.visual?.[item];
    if (verdict === 'fail') errors.push({ code: 'VISUAL_' + item.toUpperCase(), notes: current.visual.notes ?? '' });
    else if (verdict !== 'pass') missing.push('Visual review: ' + item);
  }
  const stances = current?.stances ?? [];
  const projectedGround = current?.projectedGround === undefined ? null
    : inspectProjectedGround(sequence, plan, current.projectedGround, stances);
  if (projectedGround) {
    // Retain the scalar diagnostic verbatim; replace only its known perspective assumption.
    if (projectedGround.status === 'pass') {
      for (let i = errors.length - 1; i >= 0; i--) if (errors[i].code === 'GROUND_OFFSET') errors.splice(i, 1);
    }
    errors.push(...projectedGround.errors); missing.push(...projectedGround.missing);
  }
  for (const foot of ['near', 'far']) if (!stances.some(s => s.foot === foot)) missing.push('Isolated stance: ' + foot);
  if (!stances.length || stanceReports.length !== stances.length) missing.push('Fresh sprite-gen contact measurements');
  const speeds = [];
  for (const [i, stance] of stances.entries()) {
    if (!['near', 'far'].includes(stance.foot) || !Number.isInteger(stance.start) || !Number.isInteger(stance.end) ||
      stance.start < 0 || stance.end < stance.start + 2 || stance.end >= sequence.frames.length ||
      plan.phases.slice(stance.start, stance.end + 1).some(p => !p.support.includes(stance.foot))) {
      errors.push({ code: 'STANCE_PLAN_MISMATCH', stance: i }); continue;
    }
    const report = stanceReports[i];
    if (!contactEvidenceMatches(report, stance, sequence, plan.facing)) { missing.push('Matching explicit foot evidence: ' + i); continue; }
    if (!report?.stride_verified) { missing.push('Unverified stance: ' + i); continue; }
    const speed = report.foot_velocity_px_per_second;
    if (!Number.isFinite(speed) || (plan.facing === 'right' ? speed >= 0 : speed <= 0)) errors.push({ code: 'FOOT_DIRECTION', stance: i });
    else speeds.push(Math.abs(speed));
  }
  if (speeds.length > 1 && Math.max(...speeds) > Math.min(...speeds) * 1.25) errors.push({ code: 'STANCE_SPEED_DISAGREEMENT' });
  const status = errors.length ? 'fail' : missing.length ? 'unverified' : 'pass';
  const durationSeconds = sequence.durations.reduce((sum, ms) => sum + ms, 0) / 1000;
  const speed = status === 'pass' ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null;
  return { kind: 'ai-fighter-gait-review', version: 1, motion: plan.motion, facing: plan.facing, status, sequenceSha256: sequence.sha256,
    durationSeconds, geometry: plan.geometry, phases: plan.phases, errors, missing, warnings: geometry.warnings,
    frames: geometry.frames, visual: current?.visual ?? null, stances, stanceReports,
    ...(projectedGround ? { geometryEngine: 'ai-fighter-projected-ground-v1', scalarGeometry: geometry,
      projectedGround: { ...projectedGround, declaration: current.projectedGround } } : {}),
    speedPixelsPerSecond: speed === null ? null : round(speed), stridePixels: speed === null ? null : round(speed * durationSeconds),
    measurementScope: 'Conditional on reviewer-declared same-foot identity and stance ROIs; not calibrated automatic pose recognition.' };
}

export function requireReview(review, sequence, motion) {
  if (review?.kind !== 'ai-fighter-gait-review' || review.version !== 1 || review.motion !== motion || review.status !== 'pass' ||
      review.errors?.length !== 0 || review.missing?.length !== 0) throw Error('GAIT_REVIEW_REQUIRED: ' + motion);
  if (review.sequenceSha256 !== sequenceHash(sequence)) throw Error('GAIT_REVIEW_STALE: ' + motion);
  if (!review.geometry || sequence.frames.some(f => f.width !== review.geometry.width || f.height !== review.geometry.height) ||
    !positive(review.geometry.groundY) || review.geometry.groundY > review.geometry.height ||
    !['identity', 'anatomy', 'alternation', 'loop'].every(key => review.visual?.[key] === 'pass') ||
    !['near', 'far'].every(foot => review.stances?.some(s => s.foot === foot)) ||
    review.stanceReports?.length !== review.stances?.length || !review.stanceReports.every((r, i) => r.stride_verified &&
      contactEvidenceMatches(r, review.stances[i], sequence, review.facing))) throw Error('GAIT_REVIEW_INCOMPLETE: ' + motion);
  if (!positive(review.stridePixels)) throw Error('GAIT_STRIDE_UNVERIFIED: ' + motion);
  if (review.geometryEngine !== undefined || review.projectedGround !== undefined) {
    const current = { ...sequence, sha256: sequenceHash(sequence) };
    const checked = combineReview(current, review, { sequenceSha256: current.sha256,
      visual: review.visual, stances: review.stances, projectedGround: review.projectedGround?.declaration }, review.stanceReports);
    if (review.geometryEngine !== 'ai-fighter-projected-ground-v1' || checked.status !== 'pass' ||
        checked.stridePixels !== review.stridePixels || checked.speedPixelsPerSecond !== review.speedPixelsPerSecond ||
        JSON.stringify(checked.projectedGround?.baselines) !== JSON.stringify(review.projectedGround?.baselines))
      throw Error('GAIT_PROJECTED_GROUND_UNVERIFIED: ' + motion);
  }
  return review;
}

// The hosted generation's walk/run evidence (reviewPolicy `engine-loop`, 2026-10-28). A loop a video model filmed rolls its feet and
// draws toes as bumps, so the same-foot stance measurement above rarely isolates one foot without luck in the pixels. This record
// instead binds, to the final game-pack frames: the engine's own checks on the cut it took (sprite-gen video-loop and
// video-cycle-align recorded no retake reason, and the alignment named a different own foot at its two strikes), a vision judge's
// verdicts on what a picture shows (identity, anatomy, the loop's seam), and the stride the generator measured on the feet.
// Alternation is the engine's, not the judge's: legs of one colour seen from the side look alike to a vision model, which called a
// walk the engine read as alternating (no same-foot cut, feet named at both strikes) the same leg twice (2026-10-28).
// It is never a same-foot stance claim; packs that take it say so in their report.
export const LOOP_VISUAL = ['identity', 'anatomy', 'loop'];
// The judge's `loop` alone does not refuse a cut whose seam the engine measured inside its own gate (2026-10-30, the first free fighter's
// test: three walk takes repeating every 23 frames, beat jolt 0, seam 1.41/0.98/1.05 of a step, all refused for "a jump from the last frame
// to the first"; the judge sees still frames, where a fast stride's seam reads as a jump like any other step). Identity and anatomy the
// engine cannot see: those still refuse. The creator sees the loop in the preview and may ask for it again.
export const ENGINE_SEAM_MAX = 2;   // sprite-gen video/loop.py SEAM_RATIO_MAX: the loop seam over the cycle's mean step
// Feet not named only for a low margin on a side view (2026-11-01): the shade cue swings once a cycle (sprite-gen align.py checks its
// rhythm first), so the strikes are the two legs, only too alike at the strike frames to say which is which; nothing downstream uses
// which. A same-leg cut swings twice a cycle and fails the rhythm. The generator takes such a cut on the same rule (host/generation-stages
// `lowMarginFeet`; pinned equal by a test).
export const ENGINE_CUE_RHYTHM = 0.25;   // sprite-gen video/align.py CUE_RHYTHM
export const lowMarginFeet = foot => foot?.feet == null && foot?.cue === 'shade' && typeof foot.why === 'string' &&
  foot.why.startsWith('low-margin') && Number.isFinite(foot.rhythm) && foot.rhythm >= ENGINE_CUE_RHYTHM;
const namedFeet = feet => Array.isArray(feet) && feet.length === 2 && new Set(feet).size === 2 && feet.every(f => ['left', 'right'].includes(f));
export const seamMeasured = seam => typeof seam === 'number' && Number.isFinite(seam) && seam <= ENGINE_SEAM_MAX;
/** The verdicts a cut is taken on: identity and anatomy from the judge, the seam from the judge or, when it refused, the engine. */
export const visualTaken = (visual, seam) => ['identity', 'anatomy'].every(key => visual?.[key] === 'pass') &&
  (visual?.loop === 'pass' || seamMeasured(seam));
const retakeReasons = record => record ? (Array.isArray(record.reasons) ? record.reasons : record.reason ? [record.reason] : ['unnamed']) : [];

/** The loop review of `sequence` (the game-pack animation) from its strip's metadata, the judge's verdicts and the measured stride. */
export function loopReview({ motion, sequence, strip, visual, judge, stridePixels }) {
  const errors = [];
  if (!['walk', 'run'].includes(motion)) throw Error('Loop reviews cover walk and run');
  // A gait keeps the frames it was filmed in, inside the contract's range (gait-frames-1), as fighter:pack takes it: the standard 16 and
  // 12 alone refused every cut the hosted worker aligned at its own length, after its clips and judge were paid for (2026-10-30).
  const { frames: standard, minFrames = standard, maxFrames = standard } = spec.motions[motion];
  if (sequence.frames.length < minFrames || sequence.frames.length > maxFrames)
    errors.push({ code: 'FRAME_COUNT', actual: sequence.frames.length, min: minFrames, max: maxFrames });
  if (new Set(sequence.frames.map(f => digest(f.data))).size !== sequence.frames.length) errors.push({ code: 'DUPLICATE_FRAME' });
  const retake = [...retakeReasons(strip?.retake), ...retakeReasons(strip?.cycle_align?.retake)];
  if (retake.length) errors.push({ code: 'ENGINE_RETAKE', reasons: retake });
  const foot = strip?.cycle_align?.foot, feet = foot?.feet ?? null;
  const feetBy = namedFeet(feet) ? 'named' : lowMarginFeet(foot) ? 'low-margin' : null;
  if (!feetBy) errors.push({ code: 'ENGINE_FEET_UNNAMED', feet });
  const seam = strip?.cycle_align?.seam_ratio ?? null;
  for (const item of LOOP_VISUAL)
    if (visual?.[item] !== 'pass' && !(item === 'loop' && seamMeasured(seam))) errors.push({ code: 'VISUAL_' + item.toUpperCase(), verdict: visual?.[item] ?? null });
  if (typeof visual?.notes !== 'string' || !visual.notes.trim()) errors.push({ code: 'VISUAL_NOTES' });
  if (typeof judge !== 'string' || !judge.trim()) errors.push({ code: 'JUDGE_UNNAMED' });
  if (motion === 'walk' && !positive(stridePixels)) errors.push({ code: 'STRIDE_UNMEASURED' });
  return { kind: 'ai-fighter-loop-review', version: 1, motion, status: errors.length ? 'fail' : 'pass', sequenceSha256: sequenceHash(sequence),
    durationSeconds: sequence.durations.reduce((sum, ms) => sum + ms, 0) / 1000, errors,
    engine: { kind: strip?.kind ?? null, cutFrames: strip?.cycle_align?.from ?? null, seam,
      beatJolt: strip?.cycle_align?.beat?.jolt ?? null, retake, strikes: strip?.cycle_align?.strikes ?? null, feet,
      feetMargin: foot?.margin ?? null, ...(feetBy === 'low-margin' ? { feetBy, feetRhythm: foot.rhythm } : {}) },
    visual: visual ? Object.fromEntries([...LOOP_VISUAL, 'notes'].map(key => [key, visual[key] ?? null])) : null, judge: judge ?? null,
    ...(visual && visual.loop !== 'pass' && seamMeasured(seam) ? { loopBy: 'engine-seam' } : {}),
    stridePixels: motion === 'walk' && positive(stridePixels) ? round(stridePixels) : null,
    scope: 'Engine loop checks and foot naming, a vision judge and a measured stride; no same-foot stance measurement (hosted generation).' +
      (feetBy === 'low-margin' ? ' Feet alternate by the rhythm of the shade cue; which foot is which is not named (low margin).' : '') };
}

export function requireLoopReview(review, sequence, motion) {
  if (review?.kind !== 'ai-fighter-loop-review' || review.version !== 1 || review.motion !== motion || review.status !== 'pass' ||
      review.errors?.length !== 0) throw Error('LOOP_REVIEW_REQUIRED: ' + motion);
  if (review.sequenceSha256 !== sequenceHash(sequence)) throw Error('LOOP_REVIEW_STALE: ' + motion);
  if (!visualTaken(review.visual, review.engine?.seam) || !review.visual?.notes?.trim() || !review.judge?.trim() ||
      !Array.isArray(review.engine?.retake) || review.engine.retake.length ||
      !(new Set(review.engine.feet ?? []).size === 2 || (review.engine.feetBy === 'low-margin' && review.engine.feet === null &&
        Number.isFinite(review.engine.feetRhythm) && review.engine.feetRhythm >= ENGINE_CUE_RHYTHM)) ||
      (motion === 'walk' && !positive(review.stridePixels)))
    throw Error('LOOP_REVIEW_INCOMPLETE: ' + motion);
  return review;
}

// A state name's words: `koLie`, `fall-down`, `run_fast` -> ko lie, fall down, run fast (`cooldown` stays one word).
const words = name => String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
// A cycle is packed at one scale (its state's median), so its frames do not pulse; any other clip frame by frame.
const CYCLE_WORDS = new Set(['walk', 'walking', 'run', 'running', 'jog', 'jogging', 'sprint', 'sprinting']);
// States whose head turns past 45 degrees (a fall, a knock-down, lying): scale-check searches them to 90.
const WIDE_WORDS = new Set(['fall', 'falling', 'fallen', 'ko', 'knock', 'knocked', 'knockdown', 'lie', 'lying', 'down', 'flip', 'flipping']);
const SCALE_RANGE = [0.5, 2]; // the corrections game-pack accepts

/** 'state' (one median for the cycle) or 'frame' for a common-request asset; `scaleCheck.per[assetId]` overrides. */
export function scalePer(asset, config) {
  const chosen = config.scaleCheck?.per?.[asset.id];
  if (chosen !== undefined) return chosen;
  return words(asset.source.state).some(word => CYCLE_WORDS.has(word)) ? 'state' : 'frame';
}

/** The config's own mistakes, found before any measurement: a fix names an asset (a cycle by its id; any other clip by its
 * id, for every frame, or `id/index` for one) with a correction game-pack accepts; `per` and `wideStates` are well formed. */
export function scaleCheckConfigErrors(config) {
  const sc = config.scaleCheck ?? {}, ids = new Map(config.assets.map(asset => [asset.id, asset])), errors = [];
  if (typeof sc !== 'object' || Array.isArray(sc)) return ['scaleCheck must be an object, or false'];
  // game-pack sizes the corrections by the reference's own display, so the reference frame must be packed too
  const same = (a, b) => path.normalize(a.file ?? '') === path.normalize(b.file ?? '') && a.state === b.state;
  if (!config.assets.some(asset => same(asset.source, config.reference ?? {})))
    errors.push('the reference (its file and state) must also be one of the assets: the corrections are sized by its display');
  if (sc.wideStates !== undefined && (!Array.isArray(sc.wideStates) || !sc.wideStates.every(state => typeof state === 'string')))
    errors.push('scaleCheck.wideStates must be a list of state names');
  if (sc.per !== undefined && (typeof sc.per !== 'object' || Array.isArray(sc.per))) errors.push('scaleCheck.per must be an object');
  else for (const [id, per] of Object.entries(sc.per ?? {}))
    if (!ids.has(id) || !['state', 'frame'].includes(per)) errors.push(`scaleCheck.per.${id} must name an asset and be "state" or "frame"`);
  if (sc.fix !== undefined && (typeof sc.fix !== 'object' || Array.isArray(sc.fix))) return [...errors, 'scaleCheck.fix must be an object'];
  for (const [key, value] of Object.entries(sc.fix ?? {})) {
    const id = ids.has(key) ? key : key.match(/^(.*)\/(\d+)$/)?.[1], asset = ids.get(id);
    if (!asset) { errors.push(`scaleCheck.fix.${key} names no asset of this request`); continue; }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < SCALE_RANGE[0] || value > SCALE_RANGE[1])
      errors.push(`scaleCheck.fix.${key} must be a number from ${SCALE_RANGE[0]} to ${SCALE_RANGE[1]}`);
    if (key !== id && scalePer(asset, config) === 'state') errors.push(`scaleCheck.fix.${key}: ${id} is packed at one scale; fix it by its id`);
  }
  return errors;
}

/** One scale-check run per source file, measuring only the states this config takes from that file, against the neutral
 * reference: `{ file, report, board, args }`. Reports and boards sit beside `out` (game.scale-check[-N].json and .png). */
export function scaleCheckRuns(config, base, out) {
  const groups = new Map();
  for (const asset of config.assets) {
    const file = path.resolve(base, asset.source.file);
    if (!groups.has(file)) groups.set(file, []);
    if (!groups.get(file).includes(asset.source.state)) groups.get(file).push(asset.source.state);
  }
  const stem = path.resolve(out).replace(/\.json$/, ''), many = groups.size > 1, extra = config.scaleCheck?.wideStates ?? [];
  return [...groups].map(([file, states], index) => {
    const report = `${stem}.scale-check${many ? '-' + (index + 1) : ''}.json`, board = report.replace(/\.json$/, '.png');
    const wide = states.filter(state => extra.includes(state) || words(state).some(word => WIDE_WORDS.has(word)));
    return { file, report, board, args: ['scale-check', '--reference', path.resolve(base, config.reference.file),
      ...(config.reference.state ? ['--reference-state', config.reference.state] : []), '--reference-frame', String(config.reference.frame ?? 0),
      '--asset', file, ...states.flatMap(state => ['--state', state]), ...wide.flatMap(state => ['--wide-state', state]),
      '--out', report, '--board', board] };
  });
}

/**
 * Each asset's game-pack `scale_check`, from the reports of `runs` (read by run, so two files sharing a state name never
 * share a measurement) with the config's fixes in the engine's `state/index` keys; the frames nobody has settled
 * (`assetId` for a cycle, `assetId/index` otherwise); and fixes naming a frame the asset does not have.
 */
export function scaleCheckEntries(config, base, runs, reports, outDir) {
  const fix = config.scaleCheck?.fix ?? {}, entries = {}, unsettled = [], errors = [];
  for (const asset of config.assets) {
    const at = runs.findIndex(run => run.file === path.resolve(base, asset.source.file)), state = asset.source.state;
    const record = reports[at]?.assets?.find(r => r.identity?.state === state);
    if (!record) { errors.push(`${asset.id}: the scale-check report has no ${state}`); continue; }
    const per = scalePer(asset, config), own = {};
    if (per === 'state') {
      if (asset.id in fix) own[state] = fix[asset.id];
      else if (record.state_correction === null) unsettled.push(asset.id);
    } else {
      for (const key of Object.keys(fix).filter(key => key.startsWith(asset.id + '/')))
        if (Number(key.slice(asset.id.length + 1)) >= record.frames.length) errors.push(`scaleCheck.fix.${key}: ${asset.id} has ${record.frames.length} frames`);
      record.frames.forEach((frame, index) => {
        const value = fix[`${asset.id}/${index}`] ?? fix[asset.id];
        if (value !== undefined) own[`${state}/${index}`] = value;
        else if (frame.how === 'check') unsettled.push(`${asset.id}/${index}`);
      });
    }
    entries[asset.id] = { report: path.relative(outDir, runs[at].report), per, ...(Object.keys(own).length ? { fix: own } : {}) };
  }
  return { entries, unsettled, errors };
}

// Assets already share a calibrated coordinate space. Measure neutral reference height once;
// do not reinterpret a crouch, fall or extended attack's bounding box as standing body height.
// With `scaleChecks` (scaleCheckEntries' entries, by asset id) every frame is also drawn at the reference figure's size.
export async function commonGameRequest(config, base, { scaleChecks } = {}) {
  if (!Array.isArray(config.assets) || !config.assets.length || new Set(config.assets.map(a => a.id)).size !== config.assets.length) throw Error('Unique nonempty assets required');
  const reference = await loadSequence(config.reference, base);
  const frame = reference.frames[config.reference.frame ?? 0], bounds = frame && alphaBounds(frame);
  if (!bounds) throw Error('Empty neutral reference');
  const bodyHeight = bounds.bottom - bounds.top, assets = [];
  for (const asset of config.assets) {
    const sequence = await loadSequence(asset.source, base);
    if (sequence.frames.some(f => f.width !== frame.width || f.height !== frame.height)) throw Error('Coordinate space mismatch: ' + asset.id);
    if (!asset.source.state) throw Error('Common request expects a sprite-gen manifest state');
    const entry = { id: asset.id, source: asset.source.file, state: asset.source.state, source_body_height: bodyHeight,
      display: { body_height: spec.input.bodyHeight }, resample: config.resample ?? 'lanczos' };
    if (scaleChecks) entry.scale_check = scaleChecks[asset.id];
    assets.push(entry);
  }
  return { request: { version: 1, assets }, referenceBodyHeight: bodyHeight, referenceSequenceSha256: reference.sha256,
    note: scaleChecks ? 'One measured neutral reference scale, and every frame brought to the reference figure size by scale-check (head-measured). Shared canvas is checked; anatomy still needs visual review.'
      : 'One measured neutral reference scale. Shared canvas is checked; anatomical scale still needs visual review.' };
}
