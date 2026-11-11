// @ts-check
// The expression sheet's six faces as short reaction loops, moved and never redrawn: each face's preset is a camera move (shake, bounce,
// push-in, a dizzy sway) over its painted cell. Nothing here generates; a Grok clip of a face is a separate, requested generation.
import { PROFILE_SET_EXPRESSIONS } from '../../api/profile-set-contract.mjs';

/** @typedef {{ dx: number, dy: number, scale: number, rotate: number, flash: number }} Pose  dx, dy in canvas widths; flash 0–1 white */

export const EXPRESSIONS = PROFILE_SET_EXPRESSIONS;

/** Each face's loop: its length and its move. `t` runs from 0 to 1 over the loop and ends where it began. */
export const PRESETS = /** @type {const} */ ({
  default: { ms: 2000, label: 'breathe' },
  hit: { ms: 1200, label: 'shake + flash' },
  smug: { ms: 1600, label: 'bounce' },
  danger: { ms: 1600, label: 'tremble' },
  sideeye: { ms: 2400, label: 'slow push-in' },
  ko: { ms: 2000, label: 'dizzy sway' },
});

const TAU = Math.PI * 2;

/**
 * A face's pose at `t` (0–1) of its loop. Every move returns to its start at t = 1, so the loop has no seam.
 * @param {string} face @param {number} t @returns {Pose}
 */
export function presetPose(face, t) {
  const still = { dx: 0, dy: 0, scale: 1, rotate: 0, flash: 0 };
  switch (face) {
    case 'default':
      return { ...still, scale: 1 + 0.02 * Math.sin(TAU * t), dy: -0.006 * Math.sin(TAU * t) };
    case 'hit': {
      // A hard knock in the first third, then settling; a white flash on the impact.
      const decay = t < 0.35 ? 1 - t / 0.35 : 0;
      return { ...still, dx: 0.035 * decay * Math.sin(TAU * 9 * t), rotate: -4 * decay * Math.sin(TAU * 6 * t), flash: t < 0.06 ? 0.55 * (1 - t / 0.06) : 0 };
    }
    case 'smug': {
      const hop = Math.abs(Math.sin(TAU * t));
      return { ...still, dy: -0.04 * hop, scale: 1 + 0.015 * hop, rotate: 3 * Math.sin(TAU * t) };
    }
    case 'danger':
      return { ...still, dx: 0.006 * Math.sin(TAU * 14 * t), dy: 0.004 * Math.sin(TAU * 10 * t + 1), scale: 1 - 0.01 * Math.sin(TAU * t) };
    case 'sideeye': {
      // Ease in to a close-up and hold, then ease back out: the meme's slow turn of the camera.
      const push = 0.5 - 0.5 * Math.cos(TAU * t);
      return { ...still, scale: 1 + 0.22 * push, dx: -0.04 * push, dy: 0.02 * push };
    }
    case 'ko':
      return { ...still, rotate: 9 * Math.sin(TAU * t), dx: 0.02 * Math.sin(TAU * t), dy: 0.01 * Math.sin(TAU * 2 * t) };
    default:
      return still;
  }
}
