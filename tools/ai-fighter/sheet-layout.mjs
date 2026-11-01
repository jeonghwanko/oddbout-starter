// Exact grid limits; encoded file size cannot make an oversized sheet fit a GPU texture.
/** @param {number} frames @param {number} width @param {number} height
 * @param {{ dimension: number, grid: number, frame: number, margin: number, minScale: number }} limits */
export function sheetLayout(frames, width, height, limits) {
  let best = null;
  for (let columns = 1; columns <= Math.min(frames, limits.grid); columns++) {
    const rows = Math.ceil(frames / columns);
    if (rows > limits.grid) continue;
    const cellWidth = Math.min(limits.frame, Math.floor(limits.dimension / columns));
    const cellHeight = Math.min(limits.frame, Math.floor(limits.dimension / rows));
    // Keep the packer's fixed transparent margin plus two pixels for integer resampling/crop rounding.
    const scale = Math.min(1, (cellWidth - 2 * limits.margin - 2) / Math.max(1, width - 2 * limits.margin),
      (cellHeight - 2 * limits.margin - 2) / Math.max(1, height - 2 * limits.margin));
    if (!best || scale > best.scale || scale === best.scale && columns > best.columns)
      best = { columns, rows, cellWidth, cellHeight, scale };
  }
  const columns = Math.min(limits.grid, frames, Math.floor(limits.dimension / width));
  const rows = columns > 0 ? Math.ceil(frames / columns) : 0;
  const fits = columns > 0 && width <= limits.frame && height <= limits.frame && rows <= limits.grid && rows * height <= limits.dimension;
  return { fits, columns, rows, frameWidth: width, frameHeight: height, frames,
    repair: best && best.scale >= limits.minScale ? best : null };
}
