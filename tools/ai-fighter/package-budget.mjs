// Measure actual encoded assets, including empty sheet cells and padding. Estimates only choose the next trial.
/** @param {{ id: string, bytes: number, width: number, height: number }[]} assets
 * @param {{ assetBytes: number, packageAssetBytes: number, imagePixels: number, packagePixels: number }} limits */
export function packageBudget(assets, limits) {
  const files = assets.map(asset => ({ ...asset, pixels: asset.width * asset.height }));
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const pixels = files.reduce((sum, file) => sum + file.pixels, 0);
  const pressure = Math.max(bytes / limits.packageAssetBytes, pixels / limits.packagePixels,
    ...files.flatMap(file => [file.bytes / limits.assetBytes, file.pixels / limits.imagePixels]));
  return { fits: pressure <= 1, bytes, pixels, pressure, limits, assets: files };
}

/** A bounded decreasing search; even the minimum scale must pass the unchanged actual validators.
 * @param {number} scale @param {number} pressure @param {number} minimum */
export function nextPackageScale(scale, pressure, minimum) {
  if (pressure <= 1 || scale <= minimum) return null;
  return Math.max(minimum, Math.floor(scale * Math.min(.9, .95 / Math.sqrt(pressure)) * 1e8) / 1e8);
}
