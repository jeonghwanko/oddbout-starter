// Explicit, pixel-bound evidence for separate near/far projected ground lines.
// This supplements geometry only; it never verifies foot identity or stride.
const feet = ['near', 'far'];
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const alpha = (frame, x, y) => (x < 0 || y < 0 || x >= frame.width || y >= frame.height ? 0 : frame.data[(y * frame.width + x) * 4 + 3]);

export function inspectProjectedGround(sequence, plan, evidence, stances) {
  const errors = [],
    missing = [],
    baselines = {},
    observations = [];
  if (
    evidence?.kind !== 'ai-fighter-projected-ground-evidence' ||
    evidence.version !== 1 ||
    evidence.sequenceSha256 !== sequence.sha256 ||
    !evidence.reviewer?.trim() ||
    !evidence.notes?.trim() ||
    evidence.frames?.length !== sequence.frames.length
  ) {
    return { status: 'unverified', errors, missing: ['Current-sequence projected-ground evidence'], baselines, observations };
  }
  const tolerance = plan.geometry.groundTolerance;
  for (const [i, frame] of sequence.frames.entries()) {
    const declared = evidence.frames[i],
      observed = { index: i };
    if (declared?.index !== i) {
      missing.push('Projected-ground frame ' + i);
      observations.push(observed);
      continue;
    }
    for (const foot of feet) {
      const entry = declared[foot];
      if (!entry?.notes?.trim()) missing.push(`Foot observation notes: ${i}/${foot}`);
      if (entry?.status === 'unverified_hidden') {
        observed[foot] = { status: 'unverified_hidden' };
        if (entry.sole !== undefined || plan.phases[i]?.support.includes(foot) || !plan.phases[i]?.support.length)
          missing.push(`Required foot is hidden: ${i}/${foot}`);
        continue;
      }
      const point = entry?.sole;
      if (
        !['contact', 'lifted'].includes(entry?.status) ||
        !Array.isArray(point) ||
        point.length !== 2 ||
        !point.every(Number.isInteger) ||
        point[0] < 1 ||
        point[0] >= frame.width - 1 ||
        point[1] < 1 ||
        point[1] >= frame.height - 1
      ) {
        missing.push(`Visible sole point: ${i}/${foot}`);
        continue;
      }
      const [x, y] = point;
      // A real lower alpha contour, with adjacent solid pixels, not an internal landmark.
      if (
        alpha(frame, x, y) < 32 ||
        alpha(frame, x, y + 1) >= 32 ||
        [alpha(frame, x - 1, y), alpha(frame, x + 1, y), alpha(frame, x, y - 1)].filter(a => a >= 32).length < 2
      )
        errors.push({ code: 'SOLE_NOT_LOWER_CONTOUR', frame: i, foot, point });
      observed[foot] = { status: entry.status, point, bottom: y + 1 };
    }
    observations.push(observed);
  }
  for (const foot of feet) {
    const intervals = stances.filter(s => s.foot === foot),
      samples = [];
    for (const stance of intervals) {
      if (
        !Number.isInteger(stance.start) ||
        !Number.isInteger(stance.end) ||
        stance.start < 0 ||
        stance.end < stance.start + 2 ||
        stance.end >= sequence.frames.length ||
        !Array.isArray(stance.box) ||
        stance.box.length !== 4
      )
        continue;
      const [x, y, w, h] = stance.box;
      for (let i = stance.start; i <= stance.end; i++) {
        const entry = observations[i]?.[foot],
          p = entry?.point;
        if (entry?.status !== 'contact' || !p || p[0] < x || p[0] >= x + w || p[1] < y || p[1] >= y + h) {
          missing.push(`Measured stance sole: ${i}/${foot}`);
          continue;
        }
        samples.push(entry.bottom);
      }
    }
    if (samples.length < 3) {
      missing.push('Measured baseline: ' + foot);
      continue;
    }
    baselines[foot] = median(samples);
    if (samples.some(y => Math.abs(y - baselines[foot]) > tolerance)) errors.push({ code: 'PROJECTED_STANCE_DRIFT', foot, samples, baseline: baselines[foot] });
  }
  if (feet.every(f => Number.isFinite(baselines[f])) && Math.abs(Math.max(...Object.values(baselines)) - plan.geometry.groundY) > tolerance)
    errors.push({ code: 'PROJECTED_ORIGIN_MISMATCH' });
  for (const observed of observations) {
    const support = plan.phases[observed.index]?.support ?? [],
      bottoms = [];
    for (const foot of feet) {
      const entry = observed[foot],
        baseline = baselines[foot];
      if (!Number.isFinite(entry?.bottom) || !Number.isFinite(baseline)) continue;
      bottoms.push(entry.bottom);
      const gap = baseline - entry.bottom;
      if (entry.status === 'contact' && (Math.abs(gap) > tolerance || !support.includes(foot)))
        errors.push({ code: 'PROJECTED_CONTACT_MISMATCH', frame: observed.index, foot, gap });
      if (entry.status === 'lifted' && (gap <= tolerance || support.includes(foot)))
        errors.push({ code: 'PROJECTED_LIFT_MISMATCH', frame: observed.index, foot, gap });
    }
    // Neither a hidden low foot nor an arbitrary upper-body landmark can explain the silhouette.
    let bottom = 0;
    const frame = sequence.frames[observed.index];
    for (let y = frame.height - 1; y >= 0 && !bottom; y--)
      for (let x = 0; x < frame.width; x++)
        if (alpha(frame, x, y) >= 32) {
          bottom = y + 1;
          break;
        }
    if (bottoms.length && Math.abs(Math.max(...bottoms) - bottom) > tolerance)
      errors.push({ code: 'PROJECTED_SILHOUETTE_UNEXPLAINED', frame: observed.index, bottom, soleBottoms: bottoms });
  }
  return {
    status: errors.length ? 'fail' : missing.length ? 'unverified' : 'pass',
    errors,
    missing,
    baselines,
    observations,
    scope: 'Reviewer-declared physical feet and visible sole contours; separate isolated-stance and visual gates remain required.',
  };
}
