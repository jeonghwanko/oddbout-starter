// @ts-check
// The canvases a bout video is allowed to be (2026-11-13). Even sizes, inside X's 1280×1024 video limit.
// 16:9 is the wide cut; 1:1 matches fighter:social's 720 square.

/** @type {Readonly<Record<'16:9' | '1:1', { width: number, height: number }>>} */
export const BOUT_CANVAS = Object.freeze({
  '16:9': Object.freeze({ width: 1280, height: 720 }),
  '1:1': Object.freeze({ width: 720, height: 720 }),
});
