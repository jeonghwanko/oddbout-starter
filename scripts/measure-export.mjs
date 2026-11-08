#!/usr/bin/env node
// @ts-check
// Hosted generation measurement (docs/MEASUREMENT.md). Reads the JSON from scripts/measure-export.sql (db.json) and, optionally, the
// host ledger (`og report --json`) and the operator's cost table (scripts/cost-table.json), and writes kpis.json and clip-labels.jsonl.
// It never connects to anything and reads no requester text.
// node scripts/measure-export.mjs --db db.json [--ledger ledger.json] [--costs scripts/cost-table.json] --out-dir output/measure-YYYYMMDD
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** @type {Record<string, string>} */
const READY = { appearance_ready: 'appearance', motion_ready: 'motions' };
const ANSWERS = new Set(['appearance-answer', 'motion-answer', 'register', 'cancelled']);
const ENDED = new Set(['submitted', 'rejected', 'failed', 'needs_review', 'cancelled', 'expired']);
const LOOKS = ['look-a', 'look-b'];

/**
 * @typedef {{ id: string, status: string, createdAt: string, errorCode?: string | null, appearanceRevisions?: number | null,
 *   motionRevisions?: number | null, previewClips?: string[], hostChoice?: string, delegate?: boolean, chargedAt?: string | null,
 *   refunded?: boolean, startedAt?: string | null, ownerKey?: number | null, signupToRequestHours?: number | null,
 *   fighter?: { enteredAt?: string | null, duels7d?: number, cupBouts?: number | null } | null }} Job
 *   hostChoice … fighter: 첫 선수 무료 (2026-10-30); absent from older exports. ownerKey: the account, a rank stable in one export only.
 * @typedef {{ currency?: string, perRun?: Record<string, number | null>, perMinute?: Record<string, number | null>,
 *   monthly?: Record<string, number> }} Costs  scripts/cost-table.json: the operator's estimate per og command
 * @typedef {{ jobId: string, id: number, at: string, kind: string, data: any }} JobEvent  data: the event's JSON, by kind
 * @typedef {{ jobId: string, scope?: string, status?: string | null, createdAt: string, usage?: { input_tokens?: unknown } | null,
 *   checks?: Record<string, unknown> }} Review
 * @typedef {{ kind: string, version: number, exportedAt: string, since: string, jobs: Job[], events: JobEvent[], reviews: Review[] }} Db  The JSON of measure-export.sql.
 * @typedef {{ jobs?: { job: string, providers?: Record<string, { runs?: number }> }[] }} Ledger  `og report --json`
 * @typedef {{ job: Job, events: JobEvent[], stageMs: Record<string, number[]>, claims: Record<string, number>, waitsMs: number[],
 *   calls: Record<string, number[]>, kit: string | null, engine: string | null, stageReviews: { stage: string, code: string }[],
 *   stageRetries: { stage: string, code: string }[], operatorRetries: number, operatorWaitsMs: number[], cancelledAfterReview: boolean,
 *   workerPicks: number, gaits: any[], firstAppearance?: JobEvent | null, reachedAppearance?: boolean, reachedMotions?: boolean,
 *   firstMotionDecision?: JobEvent | null, register?: JobEvent | null, created?: JobEvent | null, delegated?: boolean | null }} Timeline
 *   gaits: the `gait` events' data. The fields from firstAppearance on are set once the events are read.
 * @typedef {Record<string, number>} Counts
 * @typedef {{ branches: number, outcomes: Counts, codes: Counts, passedTake: Counts, fromWalk: number, cuts: number, refusedBy: Counts,
 *   judgeFailed: Counts, filmedFrames: Counts, deliveredFrames: Counts, jolts: number[] }} GaitRow
 * @typedef {{ status: string | null, defect: number, clear: number, unverified: number, anyDefect: boolean }} LabelReview
 * @typedef {{ job: string, kit: string | null, engine: string | null, scope: string, version: number, label: 'accepted' | 'rejected' | 'not-chosen',
 *   review: LabelReview | null }} Label
 */

/** The worker's folder name for a job (generation-prompts.mjs `ogJobId`): the ledger is kept by it. @type {(job: Pick<Job, 'id' | 'createdAt'>) => string} */
export const ogJobId = job => `${new Date(job.createdAt).toISOString().slice(0, 10).replaceAll('-', '')}-gen-${job.id.replaceAll('-', '')}`;
/** @type {(a: string, b: string) => number} */
const ms = (a, b) => Date.parse(b) - Date.parse(a);
/** @type {(n: number, d: number) => number | null} */
const rate = (n, d) => (d ? n / d : null);
/** @param {number[]} values */
function spread(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b),
    at = /** @type {(p: number) => number} */ (p => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]);
  return sorted.length ? { n: sorted.length, p50: at(0.5), p95: at(0.95), mean: sorted.reduce((s, v) => s + v, 0) / sorted.length } : { n: 0 };
}
/** @type {(map: Counts, key: string, by?: number) => Counts} */
const count = (map, key, by = 1) => {
  map[key] = (map[key] ?? 0) + by;
  return map;
};
/** @type {(list: number[]) => ReturnType<typeof spread>} */
const minutes = list => spread(list.map(v => v / 60000));

/** One job's events in order, read once: what the user answered, how long each stage and each wait took, which release made it. @param {Job} job @param {JobEvent[]} events */
export function timeline(job, events) {
  const own = events.filter(e => e.jobId === job.id).sort((a, b) => (a.id ?? 0) - (b.id ?? 0) || a.at.localeCompare(b.at));
  /** @type {Timeline} */
  const t = {
    job,
    events: own,
    stageMs: {},
    claims: {},
    waitsMs: [],
    calls: {},
    kit: null,
    engine: null,
    stageReviews: [],
    stageRetries: [],
    operatorRetries: 0,
    operatorWaitsMs: [],
    cancelledAfterReview: false,
    workerPicks: 0,
    gaits: [],
  };
  let claimed = null,
    ready = null,
    reviewed = null;
  for (const e of own) {
    const data = e.data ?? {};
    if (e.kind === 'versions') {
      t.kit = data.kit ?? t.kit;
      t.engine = data.engine ?? t.engine;
    }
    if (e.kind === 'claimed') {
      claimed = e;
      count(t.claims, data.status ?? 'unknown');
    }
    if (e.kind === 'finished') {
      const stage = claimed?.data?.status ?? 'unknown';
      if (claimed) (t.stageMs[stage] ??= []).push(ms(claimed.at, e.at));
      claimed = null;
      // A stage that stopped for an operator, or will run again: the job may still end well, so the end state alone hides these.
      if (data.outcome === 'review') {
        t.stageReviews.push({ stage, code: data.code ?? 'none' });
        reviewed = e;
      }
      if (data.outcome === 'retry') t.stageRetries.push({ stage, code: data.code ?? 'none' });
      if (['a', 'b'].includes(data.choice)) t.workerPicks += 1; // 맡기기: the look the worker's judge chose
      for (const [tool, v] of Object.entries(data.calls ?? {}))
        if (Array.isArray(v)) t.calls[tool] = (t.calls[tool] ?? [0, 0, 0]).map((x, i) => x + (v[i] ?? 0));
      if (READY[data.status]) ready = e;
    }
    if (ANSWERS.has(e.kind) && ready) {
      t.waitsMs.push(ms(ready.at, e.at));
      ready = null;
    }
    if (e.kind === 'operator' && data.action === 'retry') {
      t.operatorRetries += 1;
      if (reviewed) {
        t.operatorWaitsMs.push(ms(reviewed.at, e.at));
        reviewed = null;
      }
    }
    if (e.kind === 'cancelled' && reviewed) {
      t.cancelledAfterReview = true;
      reviewed = null;
    }
    if (e.kind === 'gait' && ['walk', 'run'].includes(data.gait)) t.gaits.push(data); // how a walk or run ended, every cut tried
  }
  /** @type {(kind: string) => JobEvent | undefined} */
  const first = kind => own.find(e => e.kind === kind);
  t.firstAppearance = first('appearance-answer') ?? null;
  const firstMotionReady = own.find(e => e.kind === 'finished' && e.data?.status === 'motion_ready');
  t.reachedAppearance = own.some(e => e.kind === 'finished' && e.data?.status === 'appearance_ready');
  t.reachedMotions = Boolean(firstMotionReady);
  t.firstMotionDecision = firstMotionReady ? (own.find(e => e.id > firstMotionReady.id && ['motion-answer', 'register'].includes(e.kind)) ?? null) : null;
  t.register = first('register') ?? null;
  t.created = first('created') ?? null;
  t.delegated = t.created ? t.created.data?.delegate === true : null; // unknown for jobs created before the request said
  return t;
}

/** A fighter that met people in its first week after entering: a duel, or any cup bout. @param {Timeline} t */
const played = t => (t.job.fighter?.duels7d ?? 0) > 0 || (t.job.fighter?.cupBouts ?? 0) > 0;

/**
 * One job's estimated cost from its stages' og runs (`finished.calls`) and the cost table. A command the table does not price
 * (null or missing) adds nothing and is named in `unpriced`.
 * @param {Timeline} t @param {Costs} costs
 */
export function jobCost(t, costs) {
  let total = 0;
  const unpriced = new Set();
  for (const [tool, [runs, , seconds]] of Object.entries(t.calls)) {
    const run = costs.perRun?.[tool],
      minute = costs.perMinute?.[tool];
    if (typeof run !== 'number' && typeof minute !== 'number') {
      if (runs) unpriced.add(tool);
      continue;
    }
    total += (typeof run === 'number' ? run * runs : 0) + (typeof minute === 'number' ? (minute * seconds) / 60 : 0);
  }
  return { total, unpriced };
}

/**
 * The first free fighter (첫 선수 무료, 2026-10-30): did a new account's free fighter turn into play, how long its request waited,
 * what it cost on our subscriptions. The funnel counts accounts (`ownerKey`) with an ODDBOUT job; a step counts for an account when any of
 * its ODDBOUT jobs reached it. Jobs on his own PC or another host are not ours to pay. Older exports lack the fields and count nothing here.
 * @param {Timeline[]} timelines @param {Costs | null} costs @param {number | null} days  the export's window, null: no subscription share
 */
function freeFighter(timelines, costs, days) {
  const ours = timelines.filter(t => (t.job.hostChoice ?? 'oddbout') === 'oddbout'),
    started = ours.filter(t => t.job.startedAt);
  /** @type {Map<number, Timeline[]>} */
  const byAccount = new Map();
  for (const t of ours) {
    const key = t.job.ownerKey;
    if (typeof key === 'number') byAccount.set(key, [...(byAccount.get(key) ?? []), t]);
  }
  const accounts = [...byAccount.values()];
  /** @type {(reached: (t: Timeline) => unknown) => number} */
  const reaching = reached => accounts.filter(jobs => jobs.some(reached)).length;
  /** @type {(t: Timeline) => boolean} */
  const entered = t => Boolean(t.job.fighter?.enteredAt);
  /** @type {(t: Timeline) => boolean} */
  const playedAfterEntering = t => entered(t) && played(t);
  /** @type {(jobs: Timeline[]) => Timeline} */
  const firstJob = jobs => jobs.reduce((a, b) => (Date.parse(b.job.createdAt) < Date.parse(a.job.createdAt) ? b : a));
  const registered = ours.filter(t => t.register || t.job.fighter);
  const enteredAccounts = reaching(entered),
    playedAccounts = reaching(playedAfterEntering);
  let cost = null;
  if (costs) {
    const each = ours.map(t => ({ t, ...jobCost(t, costs) })),
      total = each.reduce((sum, c) => sum + c.total, 0);
    const monthly = Object.values(costs.monthly ?? {}).reduce((sum, v) => sum + (Number(v) || 0), 0);
    const unpriced = [...new Set(each.flatMap(c => [...c.unpriced]))].sort(),
      complete = unpriced.length === 0;
    // A total that leaves a command that ran unpriced reads low and looks final: with one unpriced, every sum is null.
    cost = {
      currency: costs.currency ?? null,
      complete,
      total: complete ? total : null,
      perJob: complete ? spread(each.filter(c => c.t.job.chargedAt).map(c => c.total)) : null,
      perRegistered: complete ? rate(total, registered.length) : null,
      perEntered: complete ? rate(total, ours.filter(entered).length) : null,
      wasted: complete
        ? each.filter(c => c.t.job.chargedAt && !c.t.job.refunded && ['cancelled', 'expired'].includes(c.t.job.status)).reduce((sum, c) => sum + c.total, 0)
        : null,
      subscriptionPerStarted: monthly && days !== null ? rate((monthly * days) / 30, started.length) : null,
      unpriced,
    };
  }
  return {
    freeFunnel: {
      requested: accounts.length,
      charged: reaching(t => t.job.chargedAt),
      motionReady: reaching(t => t.reachedMotions),
      registered: reaching(t => t.register || t.job.fighter),
      entered: enteredAccounts,
      played7d: playedAccounts,
    },
    participationRate: { rate: rate(playedAccounts, enteredAccounts), of: enteredAccounts },
    queueWaitHours: spread(started.map(t => ms(t.job.createdAt, /** @type {string} */ (t.job.startedAt)) / 3_600_000)),
    signupToRequestHours: spread(
      accounts.flatMap(jobs => {
        const hours = firstJob(jobs).job.signupToRequestHours;
        return typeof hours === 'number' ? [hours] : [];
      }),
    ),
    cost,
  };
}

/**
 * The numbers of docs/MEASUREMENT.md over a set of jobs. Each rate names its denominator; with no jobs behind it a rate is null.
 * @param {Timeline[]} timelines @param {{ reviews?: Review[], ledger?: Ledger | null, costs?: Costs | null, days?: number | null }} [options]
 */
export function kpis(timelines, { reviews = [], ledger = null, costs = null, days = null } = {}) {
  const ids = new Set(timelines.map(t => t.job.id)),
    jobs = timelines.map(t => t.job);
  const answeredLook = timelines.filter(t => t.firstAppearance),
    decidedMotion = timelines.filter(t => t.firstMotionDecision);
  const reachedMotions = timelines.filter(t => t.reachedMotions).length,
    registered = timelines.filter(t => t.register);
  const reachedReady = timelines.filter(t => t.reachedAppearance || t.reachedMotions);
  /** @type {Counts} */
  const clipRevisions = {};
  for (const t of timelines) for (const e of t.events) if (e.kind === 'motion-answer') count(clipRevisions, e.data?.clip ?? 'unknown');
  const stageMs = /** @type {Record<string, number[]>} */ ({}),
    claims = /** @type {Record<string, number[]>} */ ({}),
    calls = /** @type {Record<string, number[]>} */ ({});
  for (const t of timelines) {
    for (const [stage, list] of Object.entries(t.stageMs)) (stageMs[stage] ??= []).push(...list);
    for (const [stage, n] of Object.entries(t.claims)) (claims[stage] ??= []).push(n);
    for (const [tool, v] of Object.entries(t.calls)) calls[tool] = (calls[tool] ?? [0, 0, 0]).map((x, i) => x + v[i]);
  }
  const statuses = {},
    errors = {};
  for (const j of jobs) {
    count(statuses, j.status);
    if (['failed', 'needs_review'].includes(j.status)) count(errors, j.errorCode ?? 'none');
  }
  const ledgerOf = new Map((ledger?.jobs ?? []).map(j => [j.job, j]));
  /** @type {Record<string, number[]>} */
  const runsPerRegistered = {};
  for (const t of registered) {
    for (const [provider, v] of Object.entries(ledgerOf.get(ogJobId(t.job))?.providers ?? {})) (runsPerRegistered[provider] ??= []).push(v.runs ?? 0);
  }
  const reviewCodes = {},
    reviewStages = {},
    retryCodes = {};
  for (const t of timelines) {
    for (const r of t.stageReviews) {
      count(reviewCodes, r.code);
      count(reviewStages, r.stage);
    }
    for (const r of t.stageRetries) count(retryCodes, r.code);
  }
  const reviewedJobs = timelines.filter(t => t.stageReviews.length),
    known = timelines.filter(t => t.delegated !== null);
  // Walk and run (the `gait` events): how each branch ended, the take that passed, why each cut was refused, the frames filmed and delivered.
  /** @type {Record<string, GaitRow>} */
  const gaits = {};
  for (const t of timelines)
    for (const g of t.gaits) {
      const row = (gaits[g.gait] ??= {
        branches: 0,
        outcomes: {},
        codes: {},
        passedTake: {},
        fromWalk: 0,
        cuts: 0,
        refusedBy: {},
        judgeFailed: {},
        filmedFrames: {},
        deliveredFrames: {},
        jolts: [],
      });
      row.branches += 1;
      count(row.outcomes, g.outcome ?? 'unknown');
      if (g.code) count(row.codes, g.code);
      if (g.note === 'run-from-walk') row.fromWalk += 1;
      else if (g.outcome === 'ok') count(row.passedTake, String(g.take ?? 'unknown'));
      for (const c of g.tried ?? []) {
        row.cuts += 1;
        for (const r of c.reasons ?? []) count(row.refusedBy, r.replace(/^frames-\d+$/, 'frames-out-of-range'));
        for (const k of c.judge ?? []) count(row.judgeFailed, k);
        if (Number.isInteger(c.from)) count(row.filmedFrames, String(c.from));
        if (Number.isInteger(c.frames)) count(row.deliveredFrames, String(c.frames));
        if (typeof c.jolt === 'number') row.jolts.push(c.jolt);
      }
    }
  const ownReviews = reviews.filter(r => ids.has(r.jobId)),
    reviewStatus = {},
    reviewScopes = {};
  for (const r of ownReviews) {
    count(reviewStatus, r.status ?? 'unknown');
    count(reviewScopes, r.scope ?? 'unknown');
  }
  return {
    jobs: jobs.length,
    appearanceFirstChoice: {
      rate: rate(answeredLook.filter(t => !(/** @type {JobEvent} */ (t.firstAppearance).data?.revise)).length, answeredLook.length),
      of: answeredLook.length,
    },
    motionFirstAccept: {
      rate: rate(decidedMotion.filter(t => /** @type {JobEvent} */ (t.firstMotionDecision).kind === 'register').length, decidedMotion.length),
      of: decidedMotion.length,
    },
    clipRevisions: Object.fromEntries(Object.entries(clipRevisions).map(([clip, n]) => [clip, { n, perJobAtMotions: rate(n, reachedMotions) }])),
    revisionsPerRegistered: spread(registered.map(t => (t.job.appearanceRevisions ?? 0) + (t.job.motionRevisions ?? 0))),
    endStates: statuses,
    failureCodes: errors,
    failureOrReviewRate: { rate: rate(jobs.filter(j => ['failed', 'needs_review'].includes(j.status)).length, jobs.length), of: jobs.length },
    stageReviews: {
      total: reviewedJobs.reduce((s, t) => s + t.stageReviews.length, 0),
      jobs: reviewedJobs.length,
      jobRate: rate(reviewedJobs.length, jobs.length),
      byCode: reviewCodes,
      byStage: reviewStages,
      perJob: spread(reviewedJobs.map(t => t.stageReviews.length)),
    },
    stageRetries: { total: timelines.reduce((s, t) => s + t.stageRetries.length, 0), byCode: retryCodes },
    operatorRetries: timelines.reduce((s, t) => s + t.operatorRetries, 0),
    operatorWaitMinutes: minutes(timelines.flatMap(t => t.operatorWaitsMs)),
    cancelledAfterReview: { n: timelines.filter(t => t.cancelledAfterReview).length, of: reviewedJobs.length },
    delegated: {
      rate: rate(known.filter(t => t.delegated).length, known.length),
      of: known.length,
      workerPicks: timelines.reduce((s, t) => s + t.workerPicks, 0),
    },
    gaits: Object.fromEntries(Object.entries(gaits).map(([gait, { jolts, ...row }]) => [gait, { ...row, jolt: spread(jolts) }])),
    abandonRate: { rate: rate(reachedReady.filter(t => ['cancelled', 'expired'].includes(t.job.status)).length, reachedReady.length), of: reachedReady.length },
    stageMinutes: Object.fromEntries(Object.entries(stageMs).map(([stage, list]) => [stage, minutes(list)])),
    claimsPerStage: Object.fromEntries(Object.entries(claims).map(([stage, list]) => [stage, spread(list)])),
    userWaitMinutes: minutes(timelines.flatMap(t => t.waitsMs)),
    minutesToRegister: minutes(registered.filter(t => t.created).map(t => ms(/** @type {JobEvent} */ (t.created).at, /** @type {JobEvent} */ (t.register).at))),
    calls: Object.fromEntries(Object.entries(calls).map(([tool, [runs, failed, seconds]]) => [tool, { runs, failed, seconds }])),
    providerRunsPerRegistered: ledger ? Object.fromEntries(Object.entries(runsPerRegistered).map(([p, list]) => [p, spread(list)])) : null,
    decisions: {
      reviews: ownReviews.length,
      byStatus: reviewStatus,
      byScope: reviewScopes,
      inputTokens: ownReviews.reduce((s, r) => s + (Number(r.usage?.input_tokens) || 0), 0),
    },
    ...freeFighter(timelines, costs, days),
  };
}

/**
 * Clip-level labels from what users did (weak labels, docs/MEASUREMENT.md). A motion clip's version is the number of revisions asked of it
 * before; the version a revision names is `rejected`, the versions current at registration `accepted`. A look round both of whose looks
 * were sent back is `rejected`; the chosen look `accepted`, the other `not-chosen` (a preference, not a defect). Clips of a job that never
 * registered stay unlabeled. Each label carries the Decisions review of that clip version when there is one.
 * @param {Timeline[]} timelines @param {Review[]} [reviews]
 */
export function clipLabels(timelines, reviews = []) {
  /** @type {Label[]} */
  const rows = [];
  for (const t of timelines) {
    const versions = /** @type {Counts} */ ({}),
      mine = reviews.filter(r => r.jobId === t.job.id);
    let round = 0;
    /** @type {(scope: string, at: string) => number} */
    const versionAt = (scope, at) =>
      LOOKS.includes(scope)
        ? t.events.filter(e => e.kind === 'appearance-answer' && e.data?.revise && ms(e.at, at) > 0).length
        : t.events.filter(e => e.kind === 'motion-answer' && e.data?.clip === scope && ms(e.at, at) > 0).length;
    /** @type {(scope: string, version: number) => LabelReview | null} */
    const review = (scope, version) => {
      const r = mine.filter(x => x.scope === scope && versionAt(scope, x.createdAt) === version).at(-1);
      if (!r) return null;
      const statuses = Object.values(r.checks ?? {}),
        n = /** @type {(s: string) => number} */ (s => statuses.filter(v => v === s).length);
      return { status: r.status ?? null, defect: n('defect'), clear: n('clear'), unverified: n('unverified'), anyDefect: n('defect') > 0 };
    };
    /** @type {(scope: string, version: number, label: Label['label']) => number} */
    const row = (scope, version, label) => rows.push({ job: t.job.id, kit: t.kit, engine: t.engine, scope, version, label, review: review(scope, version) });
    for (const e of t.events) {
      if (e.kind === 'appearance-answer') {
        if (e.data?.revise) {
          for (const look of LOOKS) row(look, round, 'rejected');
          round += 1;
        } else if (['a', 'b'].includes(e.data?.choice))
          for (const look of LOOKS) row(look, round, look === `look-${e.data.choice}` ? 'accepted' : 'not-chosen');
      }
      if (e.kind === 'motion-answer' && e.data?.clip) {
        row(e.data.clip, versions[e.data.clip] ?? 0, 'rejected');
        count(versions, e.data.clip);
      }
      if (e.kind === 'register') for (const clip of t.job.previewClips ?? []) row(clip, versions[clip] ?? 0, 'accepted');
    }
  }
  return rows;
}

/**
 * Would a "no defect found" screen have agreed with the users? Only labeled clips whose review completed count. Weak labels: a user
 * sends a clip back for taste as well as for a defect, and accepts a clip with a small flaw; read it with docs/MEASUREMENT.md.
 * @param {Label[]} rows
 */
export function screening(rows) {
  const scored = rows.filter(r => ['accepted', 'rejected'].includes(r.label) && r.review?.status === 'completed');
  const m = { rejectedFlagged: 0, rejectedMissed: 0, acceptedFlagged: 0, acceptedPassed: 0 };
  for (const r of scored)
    m[
      /** @type {keyof typeof m} */ (`${r.label}${/** @type {LabelReview} */ (r.review).anyDefect ? 'Flagged' : r.label === 'rejected' ? 'Missed' : 'Passed'}`)
    ] += 1; // scored above
  return {
    clips: scored.length,
    ...m,
    detectionRate: rate(m.rejectedFlagged, m.rejectedFlagged + m.rejectedMissed),
    falseBlockRate: rate(m.acceptedFlagged, m.acceptedFlagged + m.acceptedPassed),
    labels: 'user decisions, clip level; not independent question labels',
  };
}

/** @param {Db} db @param {Ledger | null} [ledger] @param {Costs | null} [costs] */
export function report(db, ledger = null, costs = null) {
  if (db?.kind !== 'oddbout-measure-db' || db.version !== 1) throw new Error('measure-export: expected the JSON of scripts/measure-export.sql');
  const all = db.jobs.map(job => timeline(job, db.events));
  const labels = clipLabels(all, db.reviews);
  /** @type {Record<string, Timeline[]>} */
  const byKit = {};
  for (const t of all) (byKit[t.kit ?? 'unknown'] ??= []).push(t);
  const days = Number.isFinite(ms(db.since, db.exportedAt)) ? ms(db.since, db.exportedAt) / 86_400_000 : null;
  return {
    kpis: {
      kind: 'oddbout-measure',
      version: 1,
      exportedAt: db.exportedAt,
      since: db.since,
      ledger: Boolean(ledger),
      ended: all.filter(t => ENDED.has(t.job.status)).length,
      all: kpis(all, { reviews: db.reviews, ledger, costs, days }),
      screening: screening(labels),
      // days: null — the subscription share spreads the whole month over the whole export, not over one kit's jobs.
      byKit: Object.fromEntries(Object.entries(byKit).map(([kit, list]) => [kit, kpis(list, { reviews: db.reviews, ledger, costs, days: null })])),
    },
    labels,
  };
}

/** @param {string[]} argv */
async function main(argv) {
  /** @type {(name: string) => string | undefined} */
  const arg = name => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const dbFile = arg('--db'),
    ledgerFile = arg('--ledger'),
    costsFile = arg('--costs'),
    outDir = arg('--out-dir');
  if (!dbFile || !outDir) {
    console.error('usage: measure-export.mjs --db db.json [--ledger ledger.json] [--costs cost-table.json] --out-dir <dir>');
    return 2;
  }
  /** @type {(file: string) => Promise<any>} */
  const read = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, ''));
  let db = await read(dbFile);
  if (Array.isArray(db) && db[0]?.export) db = db[0].export; // the SQL editor's download: one row, one `export` column
  if (typeof db?.export === 'object') db = db.export;
  const { kpis: summary, labels } = report(db, ledgerFile ? await read(ledgerFile) : null, costsFile ? await read(costsFile) : null);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'kpis.json'), JSON.stringify(summary, null, 2) + '\n');
  await writeFile(path.join(outDir, 'clip-labels.jsonl'), labels.map(row => JSON.stringify(row)).join('\n') + (labels.length ? '\n' : ''));
  const a = summary.all,
    pct = /** @type {(v: number | null) => string} */ (v => (v === null ? '—' : `${Math.round(v * 100)}%`));
  console.log(
    `jobs ${a.jobs} (ended ${summary.ended})  look first choice ${pct(a.appearanceFirstChoice.rate)} of ${a.appearanceFirstChoice.of}  ` +
      `motions first accept ${pct(a.motionFirstAccept.rate)} of ${a.motionFirstAccept.of}  failed/review ${pct(a.failureOrReviewRate.rate)}  ` +
      `stage reviews ${a.stageReviews.total} in ${a.stageReviews.jobs} job(s)  operator retries ${a.operatorRetries}  ` +
      `labels ${labels.length}  screened clips ${summary.screening.clips}`,
  );
  const f = a.freeFunnel;
  console.log(
    `first free fighter: requested ${f.requested} → painted ${f.charged} → motions ${f.motionReady} → registered ${f.registered} → ` +
      `entered ${f.entered} → played in a week ${f.played7d}` +
      (a.cost
        ? `  cost per registered ${a.cost.perRegistered ?? '—'} ${a.cost.currency ?? ''}` +
          (a.cost.unpriced.length ? `  unpriced: ${a.cost.unpriced.join(', ')}` : '')
        : ''),
  );
  console.log(`wrote ${path.join(outDir, 'kpis.json')} and clip-labels.jsonl`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    code => {
      process.exitCode = code;
    },
    error => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
