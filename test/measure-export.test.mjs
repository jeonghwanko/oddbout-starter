import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clipLabels, kpis, ogJobId, report, screening, timeline } from '../scripts/measure-export.mjs';

const script = fileURLToPath(new URL('../scripts/measure-export.mjs', import.meta.url));
const A = '11111111-1111-4111-8111-111111111111',
  B = '22222222-2222-4222-8222-222222222222',
  C = '33333333-3333-4333-8333-333333333333';
const KIT = 'k'.repeat(40);
let id = 0;
const at = minute => new Date(Date.UTC(2026, 9, 29, 1, minute)).toISOString();
const ev = (jobId, minute, kind, data = {}) => ({ jobId, id: ++id, at: at(minute), kind, data });

// A: one look revision, then look b; walk sent back once; registered. B: failed in motions. C: cancelled while its looks waited.
const db = {
  kind: 'oddbout-measure-db',
  version: 1,
  exportedAt: at(59),
  since: at(0),
  jobs: [
    {
      id: A,
      status: 'submitted',
      createdAt: at(0),
      appearanceRevisions: 1,
      motionRevisions: 1,
      choice: 'b',
      errorCode: null,
      previewClips: ['idle', 'walk', 'run'],
    },
    {
      id: B,
      status: 'needs_review',
      createdAt: at(1),
      appearanceRevisions: 0,
      motionRevisions: 0,
      choice: 'a',
      errorCode: 'motions-walk-outcome-unknown',
      previewClips: [],
    },
    { id: C, status: 'cancelled', createdAt: at(2), appearanceRevisions: 0, motionRevisions: 0, choice: null, errorCode: null, previewClips: [] },
  ],
  events: [
    ev(A, 0, 'created'),
    ev(A, 0, 'claimed', { status: 'appearance' }),
    ev(A, 0, 'versions', { kit: KIT, engine: 'e'.repeat(40) }),
    ev(A, 2, 'finished', { outcome: 'ok', status: 'appearance_ready', calls: { 'sprite gen': [2, 0, 60] } }),
    ev(A, 5, 'appearance-answer', { choice: null, revise: true }),
    ev(A, 5, 'claimed', { status: 'appearance' }),
    ev(A, 7, 'finished', { outcome: 'ok', status: 'appearance_ready', calls: { 'sprite gen': [2, 1, 70] } }),
    ev(A, 9, 'appearance-answer', { choice: 'b', revise: false }),
    ev(A, 9, 'claimed', { status: 'motions' }),
    ev(A, 29, 'finished', { outcome: 'ok', status: 'motion_ready', calls: { 'sprite video-set': [2, 0, 600] } }),
    ev(A, 31, 'motion-answer', { clip: 'walk' }),
    ev(A, 31, 'claimed', { status: 'motions' }),
    ev(A, 41, 'finished', { outcome: 'ok', status: 'motion_ready' }),
    ev(A, 44, 'register'),
    ev(B, 1, 'created'),
    ev(B, 1, 'claimed', { status: 'appearance' }),
    ev(B, 3, 'finished', { outcome: 'ok', status: 'appearance_ready' }),
    ev(B, 4, 'appearance-answer', { choice: 'a', revise: false }),
    ev(B, 4, 'claimed', { status: 'motions' }),
    ev(B, 20, 'finished', { outcome: 'review', status: 'needs_review', code: 'motions-walk-outcome-unknown' }),
    ev(C, 2, 'created'),
    ev(C, 2, 'claimed', { status: 'appearance' }),
    ev(C, 4, 'finished', { outcome: 'ok', status: 'appearance_ready' }),
    ev(C, 30, 'cancelled'),
  ],
  reviews: [
    { jobId: A, scope: 'look-a', stage: 'pose', createdAt: at(2), status: 'completed', checks: { 'f000.anatomy': 'defect', 'f000.identity': 'clear' } },
    { jobId: A, scope: 'walk', stage: 'sequence', createdAt: at(29), status: 'completed', checks: { 'sequence.limb_tracking': 'defect' } },
    { jobId: A, scope: 'walk', stage: 'sequence', createdAt: at(41), status: 'completed', checks: { 'sequence.limb_tracking': 'clear' } },
    { jobId: A, scope: 'run', stage: 'sequence', createdAt: at(29), status: 'completed', checks: { 'sequence.limb_tracking': 'defect' } },
    { jobId: B, scope: 'design', stage: 'input', createdAt: at(1), status: 'unverified', checks: {} },
  ],
};
const ledger = { jobs: [{ job: ogJobId({ id: A, createdAt: at(0) }), providers: { codex: { runs: 5 }, grok: { runs: 4 } } }] };

test('the worker folder of a job is its UTC date and its id without dashes', () => {
  // 08:30 the next morning in Korea is still 2026-10-29 in UTC: the folder follows UTC, never a local day.
  for (const createdAt of ['2026-10-29T23:30:00Z', '2026-10-30T08:30:00+09:00'])
    assert.equal(ogJobId({ id: A, createdAt }), `20261029-gen-${A.replaceAll('-', '')}`, createdAt);
});

test('the numbers read what users answered, how long stages and waits took, and what it ran', () => {
  const k = kpis(
    db.jobs.map(job => timeline(job, db.events)),
    { reviews: db.reviews, ledger },
  );
  assert.equal(k.jobs, 3);
  assert.deepEqual(k.appearanceFirstChoice, { rate: 0.5, of: 2 }); // A revised first, B chose
  assert.deepEqual(k.motionFirstAccept, { rate: 0, of: 1 }); // A sent walk back before registering; B never reached its motions
  assert.deepEqual(k.clipRevisions, { walk: { n: 1, perJobAtMotions: 1 } });
  assert.equal(k.revisionsPerRegistered.mean, 2);
  assert.deepEqual(k.failureCodes, { 'motions-walk-outcome-unknown': 1 });
  assert.deepEqual(k.abandonRate, { rate: 1 / 3, of: 3 });
  assert.deepEqual([k.stageMinutes.appearance.n, k.stageMinutes.motions.n, k.stageMinutes.motions.p95], [4, 3, 20]);
  assert.deepEqual(k.claimsPerStage.motions.mean, 1.5);
  assert.equal(k.userWaitMinutes.n, 6); // A: its looks twice and its motions twice, B: its looks, C: until it cancelled
  assert.equal(k.minutesToRegister.p50, 44);
  assert.deepEqual(k.calls, { 'sprite gen': { runs: 4, failed: 1, seconds: 130 }, 'sprite video-set': { runs: 2, failed: 0, seconds: 600 } });
  assert.deepEqual(k.providerRunsPerRegistered.codex, { n: 1, p50: 5, p95: 5, mean: 5 });
  assert.deepEqual(k.decisions.byScope, { 'look-a': 1, walk: 2, run: 1, design: 1 });
});

test('stops for an operator count even when the job ends well, with the operator retries and their waits', () => {
  // As the hosted jobs of 2026-10-28 went: D (delegated) stops twice at its walk and run gates, an operator retries it each time, and it
  // registers; E (delegated) stops at its run gate and is cancelled; F predates the `delegate` field and once meets a codex question.
  const D = '44444444-4444-4444-8444-444444444444',
    E = '55555555-5555-4555-8555-555555555555',
    F = '66666666-6666-4666-8666-666666666666';
  const jobs = [
    { id: D, status: 'submitted', createdAt: at(0), appearanceRevisions: 0, motionRevisions: 0, previewClips: ['walk'] },
    { id: E, status: 'cancelled', createdAt: at(0), appearanceRevisions: 0, motionRevisions: 0, errorCode: 'run-not-clean', previewClips: [] },
    { id: F, status: 'submitted', createdAt: at(0), appearanceRevisions: 0, motionRevisions: 0, previewClips: ['walk'] },
  ];
  const events = [
    ev(D, 0, 'created', { delegate: true }),
    ev(D, 0, 'claimed', { status: 'appearance' }),
    ev(D, 1, 'finished', { outcome: 'ok', status: 'motions', choice: 'b' }),
    ev(D, 1, 'claimed', { status: 'motions' }),
    ev(D, 10, 'finished', { outcome: 'review', status: 'needs_review', code: 'walk-not-clean' }),
    ev(D, 20, 'operator', { action: 'retry', to: 'motions' }),
    ev(D, 20, 'claimed', { status: 'motions' }),
    ev(D, 30, 'finished', { outcome: 'review', status: 'needs_review', code: 'run-not-clean' }),
    ev(D, 35, 'operator', { action: 'retry', to: 'motions' }),
    ev(D, 35, 'claimed', { status: 'motions' }),
    ev(D, 40, 'finished', { outcome: 'ok', status: 'motion_ready' }),
    ev(D, 42, 'register'),
    ev(E, 0, 'created', { delegate: true }),
    ev(E, 0, 'claimed', { status: 'motions' }),
    ev(E, 15, 'finished', { outcome: 'review', status: 'needs_review', code: 'run-not-clean' }),
    ev(E, 25, 'cancelled'),
    ev(F, 0, 'claimed', { status: 'motions' }),
    ev(F, 3, 'finished', { outcome: 'retry', status: 'motions', code: 'provider-asks' }),
    ev(F, 20, 'claimed', { status: 'motions' }),
    ev(F, 30, 'finished', { outcome: 'ok', status: 'motion_ready' }),
    ev(F, 31, 'register'),
  ];
  const k = kpis(jobs.map(job => timeline(job, events)));
  assert.deepEqual(k.failureOrReviewRate, { rate: 0, of: 3 }, 'the end state alone shows none of it');
  assert.deepEqual([k.stageReviews.total, k.stageReviews.jobs, k.stageReviews.jobRate], [3, 2, 2 / 3]);
  assert.deepEqual(k.stageReviews.byCode, { 'walk-not-clean': 1, 'run-not-clean': 2 });
  assert.deepEqual(k.stageReviews.byStage, { motions: 3 });
  assert.deepEqual(k.stageRetries, { total: 1, byCode: { 'provider-asks': 1 } });
  assert.equal(k.operatorRetries, 2);
  assert.deepEqual([k.operatorWaitMinutes.n, k.operatorWaitMinutes.mean], [2, 7.5]); // 10 and 5 minutes
  assert.deepEqual(k.cancelledAfterReview, { n: 1, of: 2 });
  assert.deepEqual(k.delegated, { rate: 1, of: 2, workerPicks: 1 }); // F is unknown, not counted either way
});

test('the gait events say how each walk and run ended and why each cut was refused', () => {
  const G = '77777777-7777-4777-8777-777777777777';
  const jobs = [{ id: G, status: 'submitted', createdAt: at(0), appearanceRevisions: 0, motionRevisions: 0, previewClips: ['walk', 'run'] }];
  const events = [
    ev(G, 0, 'claimed', { status: 'motions' }),
    ev(G, 5, 'gait', { gait: 'walk', outcome: 'ok', take: 0, tried: [{ take: 0, cut: 'loop', passed: true, from: 24, frames: 24, jolt: 0, rife: 0 }] }),
    ev(G, 9, 'gait', {
      gait: 'run',
      outcome: 'review',
      code: 'run-not-clean',
      tried: [
        { take: 0, cut: 'loop', reasons: ['frames-26'], from: 26, frames: 26, jolt: 0, rife: 0 },
        { take: 0, cut: 'cut-auto', judge: ['anatomy'], from: 13, frames: 13, jolt: 0, rife: 0 },
        { take: 1, cut: 'cut-auto', reasons: ['feet-unnamed'], from: 14, frames: 14, jolt: 0, rife: 0 },
      ],
    }),
    ev(G, 10, 'gait', { gait: 'run', outcome: 'ok', take: null, note: 'run-from-walk', tried: [] }),
    ev(G, 10, 'finished', { outcome: 'ok', status: 'motion_ready' }),
  ];
  const { gaits } = kpis(jobs.map(job => timeline(job, events)));
  assert.deepEqual(gaits.walk.passedTake, { 0: 1 });
  assert.deepEqual([gaits.run.branches, gaits.run.outcomes, gaits.run.codes, gaits.run.fromWalk], [2, { review: 1, ok: 1 }, { 'run-not-clean': 1 }, 1]);
  assert.deepEqual(gaits.run.refusedBy, { 'frames-out-of-range': 1, 'feet-unnamed': 1 });
  assert.deepEqual([gaits.run.judgeFailed, gaits.run.filmedFrames], [{ anatomy: 1 }, { 26: 1, 13: 1, 14: 1 }]);
});

test('clip labels follow each clip version, and a review is matched to the version it saw', () => {
  const rows = clipLabels(
    db.jobs.map(job => timeline(job, db.events)),
    db.reviews,
  );
  const pick = (scope, version) => rows.find(r => r.scope === scope && r.version === version);
  assert.deepEqual(
    [pick('look-a', 0).label, pick('look-b', 0).label, pick('look-a', 1).label, pick('look-b', 1).label],
    ['rejected', 'rejected', 'not-chosen', 'accepted'],
  );
  assert.equal(pick('look-a', 0).review.anyDefect, true);
  assert.equal(pick('look-b', 1).review, null);
  assert.deepEqual([pick('walk', 0).label, pick('walk', 0).review.anyDefect], ['rejected', true]);
  assert.deepEqual([pick('walk', 1).label, pick('walk', 1).review.anyDefect], ['accepted', false]);
  assert.deepEqual([pick('run', 0).label, pick('run', 0).review.anyDefect, pick('idle', 0).label], ['accepted', true, 'accepted']);
  // B chose a look and never registered: its looks are labeled, its clips are not. C answered nothing.
  assert.deepEqual(
    rows.filter(r => r.job === B).map(r => [r.scope, r.label]),
    [
      ['look-a', 'accepted'],
      ['look-b', 'not-chosen'],
    ],
  );
  assert.ok(rows.every(r => r.job !== C));
  assert.equal(rows.find(r => r.job === A).kit, KIT);

  const s = screening(rows);
  // Scored: look-a v0 rejected (flagged), walk v0 rejected (flagged), walk v1 accepted (passed), run v0 accepted (flagged).
  assert.deepEqual([s.clips, s.rejectedFlagged, s.rejectedMissed, s.acceptedFlagged, s.acceptedPassed], [4, 2, 0, 1, 1]);
  assert.deepEqual([s.detectionRate, s.falseBlockRate], [1, 0.5]);
});

test('the report groups the numbers by kit release and refuses another file', () => {
  const r = report(db, ledger);
  assert.deepEqual(Object.keys(r.kpis.byKit).sort(), ['unknown', KIT].sort());
  assert.equal(r.kpis.byKit[KIT].jobs, 1);
  assert.equal(r.kpis.ended, 3);
  assert.throws(() => report({ jobs: [] }), /measure-export\.sql/);
});

test('the command reads the SQL editor download and writes kpis.json and clip-labels.jsonl', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'measure-'));
  try {
    await writeFile(path.join(dir, 'db.json'), '﻿' + JSON.stringify([{ export: db }]));
    await writeFile(path.join(dir, 'ledger.json'), JSON.stringify(ledger));
    const out = execFileSync(
      process.execPath,
      [script, '--db', path.join(dir, 'db.json'), '--ledger', path.join(dir, 'ledger.json'), '--out-dir', path.join(dir, 'out')],
      { encoding: 'utf8' },
    );
    assert.match(out, /jobs 3 \(ended 3\)/);
    const k = JSON.parse(await readFile(path.join(dir, 'out', 'kpis.json'), 'utf8'));
    assert.equal(k.kind, 'oddbout-measure');
    const lines = (await readFile(path.join(dir, 'out', 'clip-labels.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    assert.ok(lines.length >= 7);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// 첫 선수 무료 (2026-10-30): per account, the funnel of its ODDBOUT requests, the fighters that met people in their first week, and the cost table.
const D = '44444444-4444-4444-8444-444444444444',
  E = '55555555-5555-4555-8555-555555555555',
  F = '66666666-6666-4666-8666-666666666666';
const freeDb = (jobs, events) => ({ kind: 'oddbout-measure-db', version: 1, exportedAt: at(59), since: at(0), jobs, events, reviews: [] });
const freeFunnelOf = (jobs, events) => kpis(jobs.map(job => timeline(job, events))).freeFunnel;

test('the first free fighter: funnel, a week of play after entering, the wait for a start and the cost on our subscriptions', () => {
  const free = freeDb(
    [
      // D (account 1): waited an hour for its start, registered, entered and fought a duel. E (account 2): painted then cancelled.
      // F (account 3): made on another host — not ours to pay, not in the funnel.
      {
        id: D,
        status: 'submitted',
        createdAt: at(0),
        hostChoice: 'oddbout',
        delegate: true,
        chargedAt: at(2),
        startedAt: new Date(Date.parse(at(0)) + 3_600_000).toISOString(),
        ownerKey: 1,
        signupToRequestHours: 0.5,
        fighter: { enteredAt: at(50), duels7d: 1, cupBouts: null },
      },
      {
        id: E,
        status: 'cancelled',
        createdAt: at(1),
        hostChoice: 'oddbout',
        chargedAt: at(3),
        refunded: false,
        startedAt: at(1),
        ownerKey: 2,
        signupToRequestHours: 2,
      },
      {
        id: F,
        status: 'submitted',
        createdAt: at(2),
        hostChoice: 'any',
        chargedAt: at(4),
        startedAt: at(2),
        ownerKey: 3,
        fighter: { enteredAt: at(40), duels7d: 0, cupBouts: 0 },
      },
    ],
    [
      ev(D, 0, 'created', { delegate: true }),
      ev(D, 0, 'claimed', { status: 'appearance' }),
      ev(D, 2, 'finished', { outcome: 'ok', status: 'motions', choice: 'a', calls: { 'sprite gen': [2, 0, 60], codex: [1, 0, 20] } }),
      ev(D, 2, 'claimed', { status: 'motions' }),
      ev(D, 20, 'finished', { outcome: 'ok', status: 'motion_ready', calls: { 'sprite video-set': [2, 0, 600], 'sprite extract': [4, 0, 30] } }),
      ev(D, 25, 'register'),
      ev(E, 1, 'claimed', { status: 'appearance' }),
      ev(E, 3, 'finished', { outcome: 'ok', status: 'appearance_ready', calls: { 'sprite gen': [2, 0, 60] } }),
      ev(E, 9, 'cancelled', { charged: true }),
      ev(F, 2, 'claimed', { status: 'appearance' }),
      ev(F, 4, 'finished', { outcome: 'ok', status: 'appearance_ready', calls: { 'sprite gen': [2, 0, 60] } }),
    ],
  );
  const costs = {
    currency: 'USD',
    perRun: { 'sprite gen': 0.1, 'sprite video-set': 0.5, 'sprite extract': 0, codex: null },
    monthly: { chatgpt: 200, grok: 30 },
  };
  const k = report(free, null, costs).kpis.all;
  assert.deepEqual(k.freeFunnel, { requested: 2, charged: 2, motionReady: 1, registered: 1, entered: 1, played7d: 1 });
  assert.deepEqual(k.participationRate, { rate: 1, of: 1 });
  assert.equal(k.queueWaitHours.n, 2);
  assert.equal(k.queueWaitHours.p95, 1);
  assert.equal(k.signupToRequestHours.p50, 0.5);
  // codex ran and is not priced yet: the totals read low, so they are null, not 0. Without a cost table the funnel stands and the cost is null.
  assert.equal(k.cost.complete, false);
  assert.deepEqual([k.cost.total, k.cost.perJob, k.cost.perRegistered, k.cost.perEntered, k.cost.wasted], [null, null, null, null, null]);
  assert.deepEqual(k.cost.unpriced, ['codex']);
  assert.equal(report(free).kpis.all.cost, null);
  // Older exports have no owner key and count nothing in the funnel.
  assert.deepEqual(report(db).kpis.all.freeFunnel, { requested: 0, charged: 0, motionReady: 0, registered: 0, entered: 0, played7d: 0 });
  assert.deepEqual(report(db).kpis.all.participationRate, { rate: null, of: 0 });
});

test('the first free fighter: a priced cost table gives the numbers, and the subscription share is for the whole export only', () => {
  const free = freeDb(
    [
      {
        id: D,
        status: 'submitted',
        createdAt: at(0),
        hostChoice: 'oddbout',
        chargedAt: at(2),
        startedAt: at(0),
        ownerKey: 1,
        fighter: { enteredAt: at(50), duels7d: 0, cupBouts: 0 },
      },
      { id: E, status: 'cancelled', createdAt: at(1), hostChoice: 'oddbout', chargedAt: at(3), refunded: false, startedAt: at(1), ownerKey: 2 },
    ],
    [
      ev(D, 0, 'versions', { kit: KIT }),
      ev(D, 0, 'claimed', { status: 'appearance' }),
      ev(D, 2, 'finished', { outcome: 'ok', status: 'motions', calls: { 'sprite gen': [2, 0, 60], codex: [1, 0, 20] } }),
      ev(D, 2, 'claimed', { status: 'motions' }),
      ev(D, 20, 'finished', { outcome: 'ok', status: 'motion_ready', calls: { 'sprite video-set': [2, 0, 600] } }),
      ev(D, 25, 'register'),
      ev(E, 1, 'claimed', { status: 'appearance' }),
      ev(E, 3, 'finished', { outcome: 'ok', status: 'appearance_ready', calls: { 'sprite gen': [2, 0, 60] } }),
      ev(E, 9, 'cancelled'),
    ],
  );
  const costs = { currency: 'USD', perRun: { 'sprite gen': 0.1, 'sprite video-set': 0.5, codex: 0.05 }, monthly: { chatgpt: 200 } };
  const r = report(free, null, costs).kpis,
    near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
  const c = r.all.cost;
  // D: 2 × 0.1 + 0.05 + 2 × 0.5 = 1.25; E: 2 × 0.1 (painted, then cancelled: wasted).
  assert.equal(c.complete, true);
  assert.deepEqual(c.unpriced, []);
  near(c.total, 1.45);
  near(c.wasted, 0.2);
  near(c.perRegistered, 1.45);
  near(c.perEntered, 1.45);
  assert.equal(c.perJob.n, 2);
  assert.ok(c.subscriptionPerStarted > 0);
  // The month's cost spread over one kit's jobs would overstate it: only the whole export has the share.
  assert.deepEqual(Object.keys(r.byKit).sort(), ['unknown', KIT].sort());
  for (const kit of Object.values(r.byKit)) assert.equal(kit.cost.subscriptionPerStarted, null);
  assert.equal(r.byKit[KIT].cost.complete, true);
});

test('the first free fighter counts accounts: a cancelled first job does not hide the second, and an own-PC first job is not his first ODDBOUT request', () => {
  const jobs = [
    // Account 1: its first request was cancelled, its second registered. Account 2: a first job on its own PC, then one to ODDBOUT.
    { id: D, status: 'cancelled', createdAt: at(0), hostChoice: 'oddbout', chargedAt: at(1), ownerKey: 1, signupToRequestHours: 1 },
    {
      id: E,
      status: 'submitted',
      createdAt: at(10),
      hostChoice: 'oddbout',
      ownerKey: 1,
      signupToRequestHours: 30,
      fighter: { enteredAt: at(50), duels7d: 0, cupBouts: 2 },
    },
    { id: F, status: 'submitted', createdAt: at(0), hostChoice: 'own', ownerKey: 2, signupToRequestHours: 3 },
    { id: A, status: 'needs_review', createdAt: at(10), hostChoice: 'oddbout', ownerKey: 2, signupToRequestHours: 4 },
  ];
  const events = [ev(D, 0, 'cancelled'), ev(E, 10, 'register'), ev(F, 0, 'register')];
  const f = kpis(jobs.map(job => timeline(job, events)));
  assert.deepEqual(f.freeFunnel, { requested: 2, charged: 1, motionReady: 0, registered: 1, entered: 1, played7d: 1 });
  assert.deepEqual(f.participationRate, { rate: 1, of: 1 });
  // Per account, the first ODDBOUT job: 1 for account 1 (not its second), 4 for account 2 (not its own-PC job).
  assert.deepEqual([f.signupToRequestHours.n, f.signupToRequestHours.mean], [2, 2.5]);
  assert.deepEqual(freeFunnelOf(jobs.slice(2, 3), events), { requested: 0, charged: 0, motionReady: 0, registered: 0, entered: 0, played7d: 0 });
});
