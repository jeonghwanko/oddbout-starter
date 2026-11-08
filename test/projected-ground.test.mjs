import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sequenceHash, walkPlan, combineReview, requireReview } from '../tools/ai-fighter/gait.mjs';

function fixture() {
  const frames = [],
    observations = [];
  for (let i = 0; i < 16; i++) {
    const data = Buffer.alloc(64 * 80 * 4),
      near = i < 8 ? 70 : 45,
      far = i < 8 ? 50 : 60;
    for (const [left, bottom] of [
      [20, near],
      [42, far],
    ])
      for (let y = bottom - 8; y < bottom; y++)
        for (let x = left; x < left + 10; x++) {
          const at = (y * 64 + x) * 4;
          data[at] = 100 + i;
          data[at + 3] = 255;
        }
    frames.push({ width: 64, height: 80, data });
    observations.push({
      index: i,
      near: { status: i < 8 ? 'contact' : 'lifted', sole: [25, near - 1], notes: 'Visible near foot.' },
      far: { status: i < 8 ? 'lifted' : 'contact', sole: [47, far - 1], notes: 'Visible far foot.' },
    });
  }
  const seq = { frames, durations: Array(16).fill(100) };
  seq.sha256 = sequenceHash(seq);
  const plan = walkPlan();
  plan.geometry = { width: 64, height: 80, groundY: 70, groundTolerance: 2 };
  plan.phases.forEach((p, i) => {
    p.support = [i < 8 ? 'near' : 'far'];
  });
  const a = {
    sequenceSha256: seq.sha256,
    visual: { identity: 'pass', anatomy: 'pass', alternation: 'pass', loop: 'pass' },
    stances: [
      { foot: 'near', start: 1, end: 3, box: [18, 38, 15, 34] },
      { foot: 'far', start: 9, end: 11, box: [40, 38, 15, 25] },
    ],
    projectedGround: {
      kind: 'ai-fighter-projected-ground-evidence',
      version: 1,
      sequenceSha256: seq.sha256,
      reviewer: 'Synthetic regression fixture',
      notes: 'Two fixed projected floors.',
      frames: observations,
    },
  };
  const reports = [0, 1].map(() => ({ stride_verified: true, foot_velocity_px_per_second: -10 }));
  return { seq, plan, a, reports };
}
test('explicit per-foot contours resolve perspective without widening the tolerance or discarding scalar diagnostics', () => {
  const { seq, plan, a, reports } = fixture();
  const legacy = combineReview(seq, plan, { ...a, projectedGround: undefined }, reports);
  assert.equal(legacy.status, 'fail');
  const r = combineReview(seq, plan, a, reports);
  assert.equal(r.status, 'pass');
  assert.equal(r.geometry.groundTolerance, 2);
  assert.deepEqual(r.projectedGround.baselines, { near: 70, far: 60 });
  assert.ok(r.scalarGeometry.errors.some(e => e.code === 'GROUND_OFFSET'));
  assert.equal(requireReview(r, seq, 'walk'), r);
});
test('a stale declaration, interior point, hidden support or invented baseline cannot pass', () => {
  for (const mutate of [
    x => (x.a.projectedGround.sequenceSha256 = 'stale'),
    x => (x.a.projectedGround.frames[0].near.sole[1] -= 3),
    x => (x.a.projectedGround.frames[0].near = { status: 'unverified_hidden', notes: 'Occluded' }),
    x => (x.plan.geometry.groundY = 77),
    x => (x.a.projectedGround.frames[8].near.status = 'contact'),
  ]) {
    const x = fixture();
    mutate(x);
    assert.notEqual(combineReview(x.seq, x.plan, x.a, x.reports).status, 'pass');
  }
});
test('isolated stances, speed, visual review and unique frames remain mandatory', () => {
  for (const mutate of [
    x => (x.reports[0].stride_verified = false),
    x => (x.reports[0].foot_velocity_px_per_second = 10),
    x => (x.reports[0].foot_velocity_px_per_second = -30),
    x => (x.a.visual.anatomy = 'unverified'),
    x => (x.seq.frames[1] = x.seq.frames[0]),
  ]) {
    const x = fixture();
    mutate(x);
    assert.notEqual(combineReview(x.seq, x.plan, x.a, x.reports).status, 'pass');
  }
});
test('packaging remeasures contours and rejects tampered or stale evidence', () => {
  const x = fixture(),
    r = combineReview(x.seq, x.plan, x.a, x.reports);
  const fake = structuredClone(r);
  fake.projectedGround.declaration.frames[0].near.sole[1]--;
  assert.throws(() => requireReview(fake, x.seq, 'walk'), /PROJECTED_GROUND/);
  const baseline = structuredClone(r);
  baseline.projectedGround.baselines.far = 61;
  assert.throws(() => requireReview(baseline, x.seq, 'walk'), /PROJECTED_GROUND/);
  const stride = structuredClone(r);
  stride.stridePixels++;
  assert.throws(() => requireReview(stride, x.seq, 'walk'), /PROJECTED_GROUND/);
  const support = structuredClone(r);
  support.phases[0].support = ['far'];
  assert.throws(() => requireReview(support, x.seq, 'walk'), /PROJECTED_GROUND/);
  x.seq.durations[0] = 101;
  assert.throws(() => requireReview(r, x.seq, 'walk'), /STALE/);
});
