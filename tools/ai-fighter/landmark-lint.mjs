// @ts-check
// Borrowed landmarks stay legal: dash windup/recover and fall get-up may name another clip's frame.
// Validation still passes when that frame index is in range, so editing the source clip changes this pose
// with no error. Warn, and name the source asset hash, so the edit is visible. Own-clip frames do not warn.

/**
 * @typedef {{ code: string, severity: 'warning', path: string, expected: string, actual: { clip: string, frame: number, sourceAssetId?: string, sourceSha256?: string }, message: string }} LandmarkWarning
 */

/**
 * Cross-clip landmark borrows in a parsed fighter. Empty when `data` has no clips.
 * Does not change `ok`. A warning is not a registration failure.
 * @param {any} data
 * @returns {LandmarkWarning[]}
 */
export function lintBorrowedLandmarks(data) {
  const clips = data?.clips;
  if (!clips || typeof clips !== 'object') return [];
  /** @type {Map<string, { sha256?: string }>} */
  const assets = new Map(Array.isArray(data.assets) ? data.assets.map((/** @type {any} */ asset) => [asset.id, asset]) : []);
  /** @type {LandmarkWarning[]} */
  const warnings = [];
  for (const [name, clip] of Object.entries(clips)) {
    const landmarks = /** @type {any} */ (clip)?.landmarks;
    if (!landmarks || typeof landmarks !== 'object') continue;
    /** @param {any} cell @param {string} path */
    const visit = (cell, path) => {
      if (!cell || typeof cell !== 'object' || Array.isArray(cell)) return;
      if (typeof cell.clip !== 'string' || cell.clip === name || !Number.isInteger(cell.frame)) return;
      const source = /** @type {any} */ (clips[cell.clip]);
      const sourceAssetId = typeof source?.assetId === 'string' ? source.assetId : undefined;
      const sourceSha256 = sourceAssetId ? assets.get(sourceAssetId)?.sha256 : undefined;
      warnings.push({
        code: 'BORROWED_LANDMARK',
        severity: 'warning',
        path,
        expected: `a frame of ${name} ({ "clip": "${name}", "frame": <n> }), so a later edit of ${cell.clip} cannot change this pose`,
        actual: {
          clip: cell.clip,
          frame: cell.frame,
          ...(sourceAssetId ? { sourceAssetId } : {}),
          ...(typeof sourceSha256 === 'string' ? { sourceSha256 } : {}),
        },
        message:
          `${name} ${path} borrows frame ${cell.frame} of ${cell.clip}. Changing ${cell.clip} changes this pose while the frame index stays in range, and validation still passes. ` +
          `Prefer a frame of ${name} itself. Record sourceSha256 if you keep the borrow, and re-check this warning after the source clip changes.`,
      });
    };
    for (const [key, value] of Object.entries(landmarks)) {
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index++) visit(value[index], `/clips/${name}/landmarks/${key}/${index}`);
      } else visit(value, `/clips/${name}/landmarks/${key}`);
    }
  }
  return warnings;
}

/**
 * Local validation's `pending` is a list of later stage names, not asset ids. Keep it, and add the split fields.
 * `missingAssets` is empty here: this check does not upload. Borrowed-landmark warnings do not clear `ok`.
 * @param {any} result
 * @param {any} [data]
 */
export function annotateValidation(result, data) {
  if (!result || typeof result !== 'object') return result;
  const pending = Array.isArray(result.pending) ? result.pending : undefined;
  // A schema rejection already names the problem. Warnings are for a package that otherwise passes, so a huge bad
  // manifest is not copied into the error (validate_fighter_manifest bounds its output).
  const warnings = data && result.ok ? lintBorrowedLandmarks(data) : [];
  const prior = Array.isArray(result.warnings) ? result.warnings : [];
  if (!pending && !warnings.length && !prior.length) return result;
  return {
    ...result,
    ...(pending ? { pendingStages: result.pendingStages ?? pending } : {}),
    ...(pending || warnings.length ? { missingAssets: Array.isArray(result.missingAssets) ? result.missingAssets : [] } : {}),
    ...(warnings.length || prior.length ? { warnings: [...prior, ...warnings] } : {}),
  };
}
