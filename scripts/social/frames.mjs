// @ts-check
// Where and when a finished package's frames go in a social clip. Pure arithmetic over fighter.json, no pixels: every clip of one export
// shares one stage (one scale, one ground line, one spot), placed by each frame's own origin, so cutting from the combo to the slam does
// not jump. A sheet packed at a lower density (`pixelScale`) keeps its game size, as the arena draws it.

/** @typedef {{ frame: number, durationMs: number }} Step */
/** @typedef {{ originX: number, originY: number }} Origin */
/** @typedef {{ assetId: string, frameWidth: number, frameHeight: number, columns: number, frames: number[], origins: Origin[], loop?: boolean,
 *   durationMs?: number, sequence?: Step[], pixelScale?: number }} Clip */
/** @typedef {{ scale: number, groundY: number, centreX: number }} Stage */

/** The clips the showcase plays, in order, when the package has them. The optional ones are the fighter's own. */
export const SHOWCASE = ['fightIdle', 'combo', 'slam', 'skill', 'victory'];
/** The clips worth posting on their own; idle is a single still and fall-getup is a fall's auxiliary art. */
export const POSTABLE = ['fightIdle', 'walk', 'run', 'combo', 'slam', 'dash', 'block', 'hit', 'groggy', 'fall', 'skill', 'entrance', 'victory'];

/** A clip's playback: its sequence, or each frame for durationMs. @param {Clip} clip @returns {Step[]} */
export function clipSteps(clip) {
  if (clip.sequence?.length) return clip.sequence.map(({ frame, durationMs }) => ({ frame, durationMs }));
  const each = clip.durationMs ?? 100;
  return clip.frames.map(frame => ({ frame, durationMs: each }));
}

/** A frame's cell on its sheet (cells run left to right, then down). @param {Clip} clip @param {number} frame */
export function cellRect(clip, frame) {
  return {
    left: (frame % clip.columns) * clip.frameWidth,
    top: Math.floor(frame / clip.columns) * clip.frameHeight,
    width: clip.frameWidth,
    height: clip.frameHeight,
  };
}

/** Game units per sheet pixel. @param {Clip} clip */
const unit = clip => 1 / (clip.pixelScale ?? 1);

/** @typedef {{ left: number, top: number, right: number, bottom: number }} Ink  a cell's drawn pixels, in the cell (right/bottom exclusive) */
/** @typedef {{ left: number, right: number, up: number, down: number }} Extent  how far a frame reaches from its origin, in game units */

/**
 * How far a frame reaches from its origin, in game units: its drawn pixels when `ink` is known, else its whole cell.
 * @param {Clip} clip @param {number} frame @param {Ink | null} [ink] @returns {Extent}
 */
export function frameExtent(clip, frame, ink = null) {
  const origin = clip.origins[frame] ?? clip.origins[0];
  const box = ink ?? { left: 0, top: 0, right: clip.frameWidth, bottom: clip.frameHeight };
  const u = unit(clip);
  return {
    left: Math.max(0, origin.originX - box.left) * u,
    right: Math.max(0, box.right - origin.originX) * u,
    up: Math.max(0, origin.originY - box.top) * u,
    down: Math.max(0, box.bottom - origin.originY) * u,
  };
}

/**
 * One stage on a `width` × `height` canvas for frames reaching `extents` from their origins: the scale that fits them all inside `fill` of
 * the canvas, the ground line, and the x the origin stands on, so the union of their reach is centred.
 * @param {Extent[]} extents @param {number} width @param {number} height @param {{ fill?: number, ground?: number }} [options]
 * @returns {Stage}
 */
export function stageFor(extents, width, height, { fill = 0.86, ground = 0.88 } = {}) {
  let left = 0,
    right = 0,
    up = 0,
    down = 0;
  for (const reach of extents) {
    left = Math.max(left, reach.left);
    right = Math.max(right, reach.right);
    up = Math.max(up, reach.up);
    down = Math.max(down, reach.down);
  }
  const groundY = height * ground;
  const scale = Math.min((width * fill) / Math.max(1, left + right), (groundY - height * (1 - fill)) / Math.max(1, up), (height - groundY) / Math.max(1, down));
  return { scale, groundY, centreX: width / 2 + ((left - right) * scale) / 2 };
}

/**
 * Where a frame's cell goes on the stage: its size and top-left corner, its origin on the stage's ground at the stage's x.
 * @param {Clip} clip @param {number} frame @param {Stage} stage
 */
export function placeFrame(clip, frame, stage) {
  const origin = clip.origins[frame] ?? clip.origins[0];
  const s = stage.scale * unit(clip);
  return {
    width: Math.max(1, Math.round(clip.frameWidth * s)),
    height: Math.max(1, Math.round(clip.frameHeight * s)),
    left: Math.round(stage.centreX - origin.originX * s),
    top: Math.round(stage.groundY - origin.originY * s),
  };
}

/** How many times a clip of `totalMs` plays so a post lasts about `minMs` (a loop repeats; a one-shot plays at least twice). @param {number} totalMs @param {boolean} loop */
export function repeatsFor(totalMs, loop, minMs = 3000, maxMs = 6000) {
  if (totalMs <= 0) return 1;
  const times = Math.max(loop ? 1 : 2, Math.ceil(minMs / totalMs));
  return Math.max(1, Math.min(times, Math.floor(maxMs / totalMs) || 1));
}

/**
 * Constant-rate playback of `steps` repeated `repeats` times: the step index shown in each of the output's frames at `fps`. Each frame
 * shows the step playing at its midpoint, so no step is skipped while it lasts at least half a frame.
 * @param {Step[]} steps @param {number} fps @param {number} [repeats] @returns {number[]}
 */
export function resample(steps, fps, repeats = 1) {
  const total = steps.reduce((sum, step) => sum + step.durationMs, 0) * repeats;
  const count = Math.max(1, Math.round((total / 1000) * fps));
  const ends = [];
  let at = 0;
  for (let r = 0; r < repeats; r++)
    for (const step of steps) {
      at += step.durationMs;
      ends.push(at);
    }
  /** @type {number[]} */
  const shown = [];
  let index = 0;
  for (let i = 0; i < count; i++) {
    const t = ((i + 0.5) * 1000) / fps;
    while (index < ends.length - 1 && ends[index] <= t) index++;
    shown.push(index % steps.length);
  }
  return shown;
}
