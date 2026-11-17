// @ts-check
// The canvases a bout video is allowed to be (2026-11-13). Even sizes, inside X's 1280×1024 video limit.
// 16:9 is the wide cut at 960×540 (2026-11-14 — 사용자: X용으로 더 작게; 1280×720 was ~8.4 MB for a 33 s bout, this ~2.9 MB);
// 1:1 matches fighter:social's 720 square (the same pixel count).

/** @type {Readonly<Record<'16:9' | '1:1', { width: number, height: number }>>} */
export const BOUT_CANVAS = Object.freeze({
  '16:9': Object.freeze({ width: 960, height: 540 }),
  '1:1': Object.freeze({ width: 720, height: 720 }),
});
