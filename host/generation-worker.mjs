#!/usr/bin/env node
// 호스팅 생성 워커 (P1, 2026-10-27). Runs as the generation service user (`og worker run`, a systemd user service from `og worker install`),
// or on a community host's PC as his own account (2026-10-28, `npm run host:start`); the API tells it only the jobs meant for that host.
// It reaches the API outward only: a heartbeat with the subscriptions' health every minute, a claim of one stage of one job at a time,
// lease renewals while the stage runs, artifacts and the package through the worker routes, the stage's outcome. Stages:
// generation-stages.mjs. Config: `<root>/worker.env` (ODDBOUT_GENERATION_API, ODDBOUT_GENERATION_WORKER_KEY, optional
// ODDBOUT_GENERATION_KEEP_DAYS), written by `og worker key`. Once a day it runs `og prune`: a finished job's request text and pictures go.
import { execFile, spawn } from 'node:child_process';
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ASKS, FRONT_JUDGE_SCHEMA, GROK_LIMITED, MODELS, briefCommand, createStages, frontJobId, frontJudgePrompt, frontVerdict, ogJobId }
  from './generation-stages.mjs';
import { codexTokensSince, codexUsage } from './codex-usage.mjs';

// <root>/bin holds this file in both installs (/srv/oddbout-gen on ODDBOUT's PC, a host's own folder in user mode).
const ROOT = process.env.OG_ROOT || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const TIMING = Object.freeze({ heartbeatMs: 60_000, healthMs: 3_600_000, idleMs: 15_000, renewMs: 60_000, errorMs: 60_000, pruneMs: 86_400_000,
  askedRecheckMs: 900_000 });
/**
 * How long one stage may run (2026-10-29): past it the stage's runs are stopped (SIGTERM, which og passes on to its command, so sprite-gen
 * writes its reports) and the job goes to an operator as `<stage>-stage-timeout`, never back to the queue, since a stopped run may already
 * have sent a paid request.
 * A motions stage usually takes 15-30 minutes; og stops any single run at 90 (RUN_TIMEOUT).
 */
export const STAGE_LIMIT_MS = Object.freeze({ queued: 20 * 60_000, appearance: 45 * 60_000, motions: 150 * 60_000, submitting: 30 * 60_000 });
export const stageLimitMs = status => STAGE_LIMIT_MS[status] ?? 150 * 60_000;
/** Days a closed job's folder stays (worker.env ODDBOUT_GENERATION_KEEP_DAYS, 1-90): the requester's words and pictures are his. */
export const keepDays = value => { const days = Number(value ?? 7); return Number.isInteger(days) && days >= 1 && days <= 90 ? days : 7; };

/** `KEY=value` lines (no quoting, no expansion). */
export function parseEnv(text) {
  return Object.fromEntries(text.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'))
    .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]).filter(([key]) => /^[A-Z_][A-Z0-9_]*$/.test(key)));
}

/** `og health` lines → { ok, codex, grok, at }. */
export function parseHealth(output, at = new Date().toISOString()) {
  const ok = p => new RegExp(`^og: ${p} ok\\b`, 'm').test(output);
  return { ok: ok('codex') && ok('grok'), codex: ok('codex'), grok: ok('grok'), at };
}

/**
 * This PC's worker jobs not marked closed: folder → job id. A job the requester cancelled, or that expired, while it waited for him
 * never comes back to the worker, so it would stay "open" (and block og setup) until the 14-day prune; the worker asks the API.
 */
export async function unclosedJobs(output) {
  const found = new Map();
  for (const name of await readdir(output).catch(() => [])) {
    const hex = /^\d{8}-gen-([0-9a-f]{32})$/.exec(name)?.[1];
    if (hex && !existsSync(path.join(output, name, '.closed')))
      found.set(name, `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
  }
  return found;
}

const gitHead = dir => new Promise(resolve => execFile('git', ['-C', dir, 'rev-parse', 'HEAD'], { timeout: 10_000 },
  (error, out) => resolve(error ? null : String(out).trim().slice(0, 40))));
/**
 * What made a stage's work (measurement, 2026-10-29): the kit and engine commits and the models, sent as a `versions` event when the
 * stage starts, so each number in docs/MEASUREMENT.md can be read per release. A commit that cannot be read is null, never a failure.
 */
export async function versionsEvent(kit, head = gitHead) {
  const [kitRef, engine] = await Promise.all([head(kit), head(path.join(kit, 'vendor', 'sprite-gen'))]);
  return { kind: 'versions', kit: kitRef, engine, image: MODELS.image, text: MODELS.text };
}

/** `npm run sprite -- gen …` → `sprite gen`, `codex exec …` → `codex`: the command a stage ran through og, without its arguments. */
export const toolName = args => {
  if (args[0] !== 'npm') return String(args[0] ?? '').slice(0, 24);
  const words = args.slice(1).filter(a => !a.startsWith('-')), i = args.indexOf('--');
  return `${words[1] ?? ''}${i >= 0 && args[i + 1] ? ` ${args[i + 1]}` : ''}`.slice(0, 24);
};
export const CALL_TOOLS = 12;
/**
 * A stage's og runs by command as `{ tool: [runs, failed, seconds] }`, sent with its outcome as `calls`. The finished event that stores
 * them holds at most 2000 bytes and a finish that does not fit is refused, so at most CALL_TOOLS commands are named and the rest summed.
 */
export function createTally() {
  const by = new Map();
  return {
    add(args, code, ms) {
      const name = toolName(args), t = by.get(name) ?? [0, 0, 0];
      by.set(name, [t[0] + 1, t[1] + (code === 0 ? 0 : 1), t[2] + ms / 1000]);
    },
    get size() { return by.size; },
    value() {
      const sorted = [...by].sort((a, b) => b[1][0] - a[1][0]), kept = sorted.slice(0, CALL_TOOLS - 1), rest = sorted.slice(CALL_TOOLS - 1);
      if (rest.length === 1) kept.push(rest[0]);
      else if (rest.length) kept.push(['other', rest.reduce((sum, [, t]) => sum.map((v, i) => v + t[i]), [0, 0, 0])]);
      return Object.fromEntries(kept.map(([name, [runs, failed, seconds]]) => [name, [runs, failed, Math.round(seconds)]]));
    },
  };
}

/**
 * Generating runs on record (2026-11-02). Before og runs a command that makes a picture or a clip on a subscription, the job folder gets
 * `dispatches/<n>.json`; its `end` is written when og returns. A stage reclaimed after the worker died mid-run (killed, out of memory, a
 * power cut) looked only at its outputs, and a look or a row with no picture yet went out again: paid twice. A record with no end is a
 * run whose outcome nobody saw, so the stage goes to an operator without running (`<stage>-dispatch-unknown`); once the server has taken
 * that, the records are marked handed over and an operator's retry runs the stage. Text runs (codex exec: the brief, the judges) and
 * pixel tools are not recorded: run again, they make no picture.
 */
export const FREE_SPRITE_TOOLS = Object.freeze(['extract', 'prepare', 'scale-check', 'video-loop', 'video-cycle-align', 'game-pack']);
export const generates = args => args[0] === 'npm' && args[1] === 'run' && args[2] === 'sprite'
  && !FREE_SPRITE_TOOLS.includes(args[args.indexOf('--') + 1]);
export const DISPATCH_UNKNOWN = 'dispatch-unknown';
export function createDispatches(dir, now = () => new Date().toISOString()) {
  const folder = path.join(dir, 'dispatches');
  let n = 0;
  const read = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };
  return {
    /** The records whose run never ended on record: `{ name, tool }`. One that cannot be read counts (its run may have gone out). */
    async unended() {
      const open = [];
      for (const name of (await readdir(folder).catch(() => [])).filter(name => name.endsWith('.json')).sort()) {
        const record = await read(path.join(folder, name));
        if (!record || (record.end == null && record.handedOver == null))
          open.push({ name, tool: typeof record?.tool === 'string' ? record.tool : null });
      }
      return open;
    },
    /** Before a run: its record, or null for a command that makes no picture. A record that cannot be written refuses the run. */
    async begin(args) {
      if (!generates(args)) return null;
      await mkdir(folder, { recursive: true });
      const file = path.join(folder, `${Date.now()}-${process.pid}-${n++}.json`), record = { tool: toolName(args), startedAt: now() };
      await writeFile(file, JSON.stringify(record) + '\n', { flag: 'wx' });
      return { file, record };
    },
    /** After the run: its exit code. Not written (a full disk), the record stays open and the stage's next claim goes to an operator. */
    end: (started, code) => started ? writeFile(started.file, JSON.stringify({ ...started.record, end: { code, at: now() } }) + '\n').catch(() => {})
      : Promise.resolve(),
    /** Marks open records handed to an operator, after the server took the stage's review. */
    async handOver(open) {
      for (const { name } of open) {
        const file = path.join(folder, name);
        await writeFile(file, JSON.stringify({ ...(await read(file) ?? {}), handedOver: now() }) + '\n');
      }
    },
  };
}

export function createApi({ base, key, fetcher = fetch }) {
  const headers = extra => ({ authorization: `Bearer ${key}`, ...extra });
  const json = async response => { try { return { status: response.status, ...(await response.json()) }; } catch { return { status: response.status, ok: false, code: 'bad-reply' }; } };
  const post = (route, body) => fetcher(`${base}/generation-worker/${route}`, { method: 'POST', headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) }).then(json);
  const leased = (job, extra) => headers({ 'x-generation-lease': job.leaseToken, ...extra });
  return {
    // The subscription's rate-limit reading rides along (codex-usage.mjs, 2026-10-31), for the operator: it holds nothing back.
    heartbeat: (health, usage = null) => post('heartbeat', { health, ...(usage ? { usage } : {}) }),
    // The server's public contract: its features say what a package may carry (a gait at its own frame count: gait-frames-1).
    spec: () => fetcher(`${base}/spec`, { signal: AbortSignal.timeout(30_000) }).then(json),
    claim: () => post('claim', {}),
    ended: jobs => post('ended', { jobs }),
    progress: (job, progress, event) => post('progress', { jobId: job.id, leaseToken: job.leaseToken, progress, ...(event ? { event } : {}) }),
    finish: (job, outcome, result) => post('finish', { jobId: job.id, leaseToken: job.leaseToken, outcome, result }),
    // A stage's tokens without the lease (리뷰 2026-10-31): the lease it ran under names the run, so a second report is ignored.
    usage: (job, tokens) => post(`jobs/${job.id}/usage`, { leaseToken: job.leaseToken, stage: job.status, tokens }),
    decisions: (job, evidence) => fetcher(`${base}/generation-worker/jobs/${job.id}/decisions`, {
      method: 'POST', headers: leased(job, { 'content-type': 'application/json' }), body: JSON.stringify(evidence),
      signal: AbortSignal.timeout(140_000), redirect: 'error' }).then(json),
    async artifact(job, name, bytes) {
      const reply = await fetcher(`${base}/generation-worker/jobs/${job.id}/artifacts/${name}`, { method: 'PUT', headers: leased(job, { 'content-type': 'image/webp' }),
        body: bytes, signal: AbortSignal.timeout(120_000) }).then(json);
      if (!reply.ok) throw Object.assign(new Error(reply.code ?? 'artifact-refused'), { code: reply.code ?? 'artifact-refused' });
      return reply;
    },
    submission: (job, text) => fetcher(`${base}/generation-worker/jobs/${job.id}/submission`, { method: 'POST', headers: leased(job, { 'content-type': 'application/json' }),
      body: text, signal: AbortSignal.timeout(60_000) }).then(json),
    asset: (job, asset, bytes) => fetcher(`${base}/generation-worker/jobs/${job.id}/submission/assets/${asset}`, { method: 'PUT',
      headers: leased(job, { 'content-type': 'image/webp' }), body: bytes, signal: AbortSignal.timeout(120_000) }).then(json),
    submit: job => fetcher(`${base}/generation-worker/jobs/${job.id}/submission/submit`, { method: 'POST', headers: leased(job, { 'content-type': 'application/json' }),
      body: '{}', signal: AbortSignal.timeout(60_000) }).then(json),
    // 선수 프로필 세트 (2026-10-31): the chosen front (an artifact the job already holds) and its face square, before the package goes in.
    profileFront: (job, front) => fetcher(`${base}/generation-worker/jobs/${job.id}/profile-front`, { method: 'POST',
      headers: leased(job, { 'content-type': 'application/json' }), body: JSON.stringify(front), signal: AbortSignal.timeout(60_000) }).then(json),
    // 정면 판정 (2026-11-03): an owner's front painting to check, and the verdict under that check's lease. Only the official host gets one.
    frontClaim: () => post('profile-fronts/claim', {}),
    frontFinish: (set, verdict) => post('profile-fronts/finish', { profileSetId: set.id, leaseToken: set.leaseToken, verdict }),
  };
}

/**
 * A stage's tokens sent on their own route (리뷰 2026-10-31): after the job was cancelled under the stage (lease lost) or its finish was
 * refused, the tokens were spent all the same — the creator's balance and the day's budget count them. Never dropped silently: the reply,
 * or why there is none, goes to the worker's log.
 * @param {{ usage: (job: any, tokens: any) => Promise<any> }} api
 * @param {{ id: string, status: string }} job
 * @param {{ total: number } | null} tokens
 * @param {(line: string) => Promise<unknown>} say
 */
export async function reportStageTokens(api, job, tokens, say) {
  if (!tokens?.total) return null;
  const reply = await api.usage(job, tokens).catch(error => ({ ok: false, code: error?.message ?? 'usage-failed' }));
  await say(`job ${job.id} ${job.status} ${tokens.total} tokens ${reply.ok ? (reply.kept ? 'reported' : 'reported before') : `not reported (${reply.code ?? reply.status})`}`);
  return reply;
}

/**
 * A stage's next run once the stage was stopped (its time limit, or the job cancelled and its lease lost): refused before it starts
 * (2026-10-30). The abort stops only the run under way; the stage's code went on to its next command (the run's next take, the judge),
 * and a signal already aborted never fires again, so each of those ran, paid, to its end. The stage now ends with `stage-stopped`.
 */
export const STAGE_STOPPED = 'stage-stopped';
export const unlessStopped = (signal, start) => signal?.aborted
  ? Promise.reject(Object.assign(new Error(STAGE_STOPPED), { code: STAGE_STOPPED })) : start();
/** A stage past its time limit goes to an operator. The xAI requests the stopped stage named stay with it (2026-10-30 review): the
 * operator resumes them (video-resume) rather than films them again. */
export function timedOutOutcome(status, outcome) {
  const requestIds = outcome?.result?.requestIds;
  return { outcome: 'review', result: { code: `${status}-stage-timeout`, ...(Array.isArray(requestIds) && requestIds.length ? { requestIds } : {}) } };
}
/** A stage that found a generating run with no end on record (createDispatches) goes to an operator; the tools name what to look at. */
export const dispatchUnknownOutcome = (status, open) => ({ outcome: 'review',
  result: { code: `${status}-${DISPATCH_UNKNOWN}`, runs: open.slice(0, 8).map(record => record.tool ?? 'unreadable') } });
/** The provider a stage's outcome code says cannot run here now (the codex question, Grok's 429), if it does. */
export const limitedProvider = code => ({ [ASKS]: 'codex', [GROK_LIMITED]: 'grok' })[code];
/** The health after a stage's outcome: a provider that cannot run here now is marked down until a check passes. */
export function healthAfter(health, code) {
  const provider = limitedProvider(code);
  return provider ? { ...health, ok: false, [provider]: false } : health;
}
/**
 * What the health check cannot see (2026-10-30): it sends each provider one word, and a text answer says nothing of the image or video
 * allowance that ran out. A provider a real stage found limited stays down for a wait, whatever the check says: the first askedRecheckMs,
 * doubled each time it is found limited again (the stage ends first, or a requester picks this host and meets it), at most a health
 * period. A stage that made its work with the provider ends the streak. In memory only: a restarted worker asks the check again.
 */
export function createCooldowns(now = Date.now) {
  const by = new Map();
  return {
    /** Marks `provider` limited; returns how long it stays down (ms). */
    limit(provider) {
      const streak = (by.get(provider)?.streak ?? 0) + 1, wait = Math.min(TIMING.askedRecheckMs * 2 ** (streak - 1), TIMING.healthMs);
      by.set(provider, { until: now() + wait, streak });
      return wait;
    },
    worked(providers) { for (const provider of providers) { const held = by.get(provider); if (held) by.set(provider, { ...held, streak: 0 }); } },
    apply(health) {
      const down = p => health[p] && !(by.get(p)?.until > now()), codex = down('codex'), grok = down('grok');
      return codex === health.codex && grok === health.grok ? health : { ...health, ok: health.ok && codex && grok, codex, grok };
    },
  };
}
/** The providers a stage's work uses, for ending a limited streak when it made its work. */
const STAGE_PROVIDERS = Object.freeze({ appearance: ['codex'], motions: ['codex', 'grok'] });
/** An error's code as the finish route takes it: a string of at most 60 characters (a child process's or a reply's code may be a number). */
export const errorCode = (error, fallback = 'stage-error') => String(error?.code ?? fallback).slice(0, 60);

/**
 * How a stopped run ends (2026-11-02). og passes SIGTERM on to its command's own process group and waits for it (timeout's SIGKILL comes
 * 30 s later); a group still there after STOP_GRACE_MS gets SIGKILL. A run resolves when its output closes, or OUTPUT_DRAIN_MS after it
 * exited: a process that left the group and still holds the pipes held the stage, and the worker, until it ended.
 */
export const STOP_GRACE_MS = 90_000, OUTPUT_DRAIN_MS = 10_000;

/**
 * One child process in its own process group; its output appended to the job's log. Resolves its exit code (signals count as 128 + n).
 * Stopping it signals the whole group, and og passes the signal on to the command it runs (above).
 */
export function run(command, args, { cwd, log, stdin, signal, graceMs = STOP_GRACE_MS, drainMs = OUTPUT_DRAIN_MS }) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve(128 + 15);   // stopped before it began: nothing started
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    const write = chunk => { appendFile(log, chunk).catch(() => {}); };
    child.stdout.on('data', write); child.stderr.on('data', write);
    // A child that ends without reading its input closes the pipe: the write's EPIPE is not the run's outcome (its exit code is),
    // and with no listener it was an uncaught exception that ended the worker and every stage on it (CI, 2026-11-02).
    child.stdin.on('error', () => {});
    child.stdin.end(stdin ?? '');
    const group = sig => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch {} } };
    /** @type {NodeJS.Timeout | undefined} */ let kill;
    /** @type {NodeJS.Timeout | undefined} */ let drain;
    const stop = () => { group('SIGTERM'); kill = setTimeout(() => group('SIGKILL'), graceMs); };
    let ended = false;
    const end = code => {
      if (ended) return;
      ended = true; clearTimeout(kill); clearTimeout(drain); signal?.removeEventListener('abort', stop); resolve(code);
    };
    const codeOf = (code, sig) => code ?? 128 + (sig === 'SIGKILL' ? 9 : 15);
    signal?.addEventListener('abort', stop, { once: true });
    child.on('exit', (code, sig) => { drain = setTimeout(() => end(codeOf(code, sig)), drainMs); });
    child.on('close', (code, sig) => end(codeOf(code, sig)));
    child.on('error', () => end(127));
  });
}

/**
 * 정면 판정 (2026-11-03): one owner's front painting, checked by codex with every tool off, between the jobs' stages — never beside one, so
 * its tokens never count in a creator's stage. Its own og folder (open while it runs, so og setup waits), closed after. A run that fails
 * leaves the set to its lease (taken again later, five takes at most); only a verdict is sent.
 * @param {{ api: { frontClaim: () => Promise<any>, frontFinish: (set: any, verdict: any) => Promise<any> }, og: string, python: string, kit: string,
 *   say: (line: string) => Promise<unknown>, providerDown: (code: string) => Promise<boolean>, fetcher?: typeof fetch, runner?: typeof run,
 *   now?: () => Date }} deps
 */
export function createFrontCheck({ api, og, python, kit, say, providerDown, fetcher = fetch, runner = run, now = () => new Date() }) {
  /** @returns {Promise<boolean>} whether it took a set (then the next may be waiting too) */
  return async function checkFront() {
    const claimed = await api.frontClaim().catch(error => ({ ok: false, code: error.message }));
    if (!claimed.ok) { await say(`front claim failed ${claimed.code ?? claimed.status}`); return false; }
    const set = claimed.profileSet;
    if (!set) return false;
    const ogId = frontJobId(set, now()), dir = path.join(kit, 'output', ogId), log = path.join(dir, 'worker.log');
    await mkdir(dir, { recursive: true });
    await rm(path.join(dir, '.closed'), { force: true });
    await writeFile(path.join(dir, 'request.json'), JSON.stringify({ id: ogId, api: { profileSetId: set.id }, createdAt: now().toISOString() }, null, 2) + '\n');
    // The check's lease is fifteen minutes: past it the set is another take's.
    const signal = AbortSignal.timeout(14 * 60_000);
    try {
      const response = await fetcher(set.front.downloadUrl, { signal: AbortSignal.timeout(60_000), redirect: 'error' });
      const bytes = response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
      if (!bytes || bytes.length !== set.front.bytes) { await say(`front ${set.id} download ${response.status}`); return true; }
      const webp = path.join(dir, 'front.webp'), png = path.join(dir, 'front.png');
      await writeFile(webp, bytes);
      // codex takes the PNG the look judge takes; the painting's own pixels, alpha kept.
      if (await runner(python, ['-I', '-c', 'import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).save(sys.argv[2], "PNG")', webp, png], { cwd: kit, log, signal }) !== 0) {
        await say(`front ${set.id} unreadable`); return true;
      }
      const schema = path.join(dir, 'schema.json'), out = path.join(dir, 'verdict.json');
      await writeFile(schema, JSON.stringify(FRONT_JUDGE_SCHEMA));
      const code = await runner(og, ['run', ogId, '--', ...briefCommand({ schema, out, refs: [png] })], { cwd: kit, log, stdin: frontJudgePrompt(), signal });
      if (code === 75) { await providerDown(ASKS); return true; }
      const verdict = code === 0 ? frontVerdict(await readFile(out, 'utf8').then(JSON.parse, () => null)) : null;
      if (!verdict) { await say(`front ${set.id} no verdict (exit ${code})`); return true; }
      const reply = await api.frontFinish(set, verdict).catch(error => ({ ok: false, code: error.message }));
      await say(`front ${set.id} → ${reply.ok ? reply.frontCheck?.status ?? reply.stage : `finish refused ${reply.code ?? reply.status}`}`);
      return true;
    } finally { await writeFile(path.join(dir, '.closed'), '').catch(() => {}); }
  };
}

/** The worker's loop. `once`: one claim, for a manual run. */
export async function main({ once = false } = {}) {
  const env = parseEnv(await readFile(path.join(ROOT, 'worker.env'), 'utf8'));
  if (!/^https:\/\//.test(env.ODDBOUT_GENERATION_API ?? '') || !/^afw_[a-f0-9]{64}$/.test(env.ODDBOUT_GENERATION_WORKER_KEY ?? ''))
    throw new Error('worker.env needs ODDBOUT_GENERATION_API (https) and ODDBOUT_GENERATION_WORKER_KEY (afw_…)');
  const api = createApi({ base: env.ODDBOUT_GENERATION_API.replace(/\/$/, ''), key: env.ODDBOUT_GENERATION_WORKER_KEY });
  const og = path.join(ROOT, 'bin', 'og'), kit = path.join(ROOT, 'kit'), python = path.join(kit, 'vendor', 'sprite-gen', '.venv', 'bin', 'python');
  const workerLog = path.join(ROOT, 'worker.log');
  // The providers run with HOME=<root> (og), so codex keeps its sessions there.
  const sessions = path.join(process.env.CODEX_HOME || path.join(ROOT, '.codex'), 'sessions');
  const say = line => appendFile(workerLog, `${new Date().toISOString()} ${line}\n`).catch(() => {});

  let health = { ok: false, codex: false, grok: false, at: null }, checkedAt = 0, beatAt = 0, prunedAt = 0;
  const cooldowns = createCooldowns();
  const quiet = async (args, limitMs) => {
    let output = '';
    const child = spawn(og, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
    const limit = setTimeout(() => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }, limitMs);
    await new Promise(resolve => child.on('close', resolve)); clearTimeout(limit);
    return output;
  };
  async function keepAlive() {
    if (Date.now() - checkedAt >= TIMING.healthMs) {
      // A health check waits for a codex slot like any run; past ten minutes it counts as not healthy.
      health = cooldowns.apply(parseHealth(await quiet(['health'], 600_000))); checkedAt = Date.now();
      await say(`health codex=${health.codex} grok=${health.grok}`);
      // Jobs that ended while they waited for their requester (cancelled, expired): closed here, so og setup can update again.
      const unclosed = await unclosedJobs(path.join(kit, 'output'));
      if (unclosed.size) {
        const reply = await api.ended([...unclosed.values()].slice(0, 50)).catch(() => null), ended = new Set(reply?.ended ?? []);
        for (const [name, id] of unclosed) if (ended.has(id)) { await writeFile(path.join(kit, 'output', name, '.closed'), '').catch(() => {}); await say(`job ${id} ended — closed`); }
      }
    }
    if (Date.now() - prunedAt >= TIMING.pruneMs) {
      // Between jobs only (this loop runs no stage meanwhile); og prune keeps open jobs and recent closed ones.
      prunedAt = Date.now();
      await say(`prune ${(await quiet(['prune', String(keepDays(env.ODDBOUT_GENERATION_KEEP_DAYS))], 600_000)).trim().split('\n').at(-1) ?? ''}`);
    }
    if (Date.now() - beatAt >= TIMING.heartbeatMs) {
      const reply = await api.heartbeat(health, await codexUsage(sessions).catch(() => null)).catch(error => ({ ok: false, code: error.message }));
      if (reply.ok) beatAt = Date.now(); else await say(`heartbeat failed ${reply.code ?? reply.status}`);
    }
  }

  /** codex cannot run here now (exit 75: signed out, usage used up): claim nothing until a health check passes again, soon. */
  async function providerDown(code) {
    const down = healthAfter(health, code), provider = limitedProvider(code);
    if (down === health) return false;
    health = down;
    const wait = cooldowns.limit(provider);
    checkedAt = Date.now() - TIMING.healthMs + wait;
    await say(`${provider} cannot run now: no claims until health passes (checked again in ${Math.round(wait / 60_000)} minutes)`);
    return true;
  }

  const checkFront = createFrontCheck({ api, og, python, kit, say, providerDown });
  // The front queue is asked once a minute while it is empty (a claim every idle turn would double this PC's calls), at once after a take.
  let frontDue = 0;

  async function work(job) {
    const ogId = ogJobId(job), dir = path.join(kit, 'output', ogId), log = path.join(dir, 'worker.log');
    await mkdir(dir, { recursive: true });
    // og's job marker: `og run` refuses a folder without it. Who and what only; the description stays in the API.
    await writeFile(path.join(dir, 'request.json'), JSON.stringify({ id: ogId, api: { jobId: job.id, owner: job.owner }, createdAt: new Date().toISOString() }, null, 2) + '\n');
    await api.progress(job, undefined, await versionsEvent(kit)).catch(() => {});
    const controller = new AbortController(), tally = createTally(), since = Date.now();
    // The codex tokens of the sessions written since the stage began (codex-usage.mjs), or null: none, or unreadable (logged).
    const spent = async () => {
      try { const tokens = await codexTokensSince(sessions, since); return tokens.total ? tokens : null; }
      catch (error) { await say(`job ${job.id} ${job.status} tokens unread: ${error?.message ?? error}`); return null; }
    };
    let timedOut = false;
    const limit = setTimeout(() => { timedOut = true; controller.abort(); }, stageLimitMs(job.status));
    // The lease runs five minutes: renew it every minute; a job cancelled meanwhile (lease lost) stops the stage's child.
    const renew = setInterval(() => {
      api.progress(job, undefined).then(reply => { if (!reply.ok && reply.code === 'lease-lost') controller.abort(); }).catch(() => {});
    }, TIMING.renewMs);
    // The kit tree's loop review takes a low-margin cut (tools/ai-fighter/gait.mjs `lowMarginFeet`, 2026-11-01): read per job, as `og setup` moves it.
    const lowMarginFeetTaken = await readFile(path.join(kit, 'tools', 'ai-fighter', 'gait.mjs'), 'utf8')
      .then(text => text.includes('export const lowMarginFeet'), () => false);
    const dispatches = createDispatches(dir);
    const stages = createStages({
      og: (args, { stdin } = {}) => unlessStopped(controller.signal, async () => {
        const started = Date.now(), record = await dispatches.begin(args);
        const code = await run(og, ['run', ogId, '--', ...args], { cwd: kit, log, stdin, signal: controller.signal });
        await dispatches.end(record, code);
        tally.add(args, code, Date.now() - started);
        return { code };
      }),
      api, signal: controller.signal, lowMarginFeetTaken,
      fetchBytes: async url => { const r = await fetch(url, { signal: AbortSignal.timeout(60_000) }); if (!r.ok) throw new Error(`download ${r.status}`); return new Uint8Array(await r.arrayBuffer()); },
      motionsPy: args => unlessStopped(controller.signal, () => run(python, ['-I', path.join(ROOT, 'bin', 'motions.py'), ...args], { cwd: kit, log, signal: controller.signal })
        .then(code => ({ code }))),
      // Method 5: at 6 libwebp's slowest alpha search took 3–7 s per transparent look instead of 0.1–0.2 s, for 1 % fewer bytes. `size`: the
      // longest side kept (1024), or `<width>x<height>` exactly (the expression sheet, which its profile set takes at 1536 × 1024).
      toWebp: async (from, to, size = '1024') => {
        const code = await run(python, ['-I', '-c', 'import sys\nfrom PIL import Image\nim = Image.open(sys.argv[1]); a = sys.argv[3]\nif "x" in a: im = im.resize(tuple(int(n) for n in a.split("x")), Image.LANCZOS)\nelse: im.thumbnail((int(a), int(a)))\nim.save(sys.argv[2], "WEBP", quality=90, method=5)', from, to, String(size)], { cwd: kit, log });
        if (code !== 0) throw Object.assign(new Error('webp-failed'), { code: 'webp-failed' });
      },
      // Review evidence over the server's limits (2 MiB, 2048 px): lossless WebP, at most 2048 px, nearest so pixel art stays sharp.
      fitImage: async (from, to) => {
        const code = await run(python, ['-I', '-c', 'import sys\nfrom PIL import Image\nim = Image.open(sys.argv[1]); im.thumbnail((2048, 2048), Image.NEAREST); im.save(sys.argv[2], "WEBP", lossless=True, method=6)', from, to], { cwd: kit, log });
        if (code !== 0) throw Object.assign(new Error('evidence-fit-failed'), { code: 'evidence-fit-failed' });
      },
    });
    let outcome, unknown = [];
    try {
      unknown = await dispatches.unended();
      const stage = stages[job.status];
      outcome = unknown.length ? dispatchUnknownOutcome(job.status, unknown)
        : stage ? await stage(job, dir) : { outcome: 'failed', result: { code: `no-stage-${job.status}` } };
    } catch (error) {
      // A numeric code (a child process's) used to throw here, outside this catch: the finish never went and the job lost a lease.
      outcome = { outcome: 'retry', result: { code: errorCode(error) } };
      await appendFile(log, `stage error: ${error?.stack ?? error}\n`).catch(() => {});
    } finally { clearInterval(renew); clearTimeout(limit); }
    if (timedOut) {
      await say(`job ${job.id} ${job.status} stopped after ${Math.round(stageLimitMs(job.status) / 60_000)} minutes`);
      outcome = timedOutOutcome(job.status, outcome);
    } else if (controller.signal.aborted) {
      await say(`job ${job.id} ${job.status} stopped (lease lost)`);
      await reportStageTokens(api, job, await spent(), say);
      return;
    }
    if (!await providerDown(outcome.result?.code) && outcome.outcome === 'ok') cooldowns.worked(STAGE_PROVIDERS[job.status] ?? []);
    // The stage's codex tokens beside its calls (2026-10-31): the server's daily budget and the creator's balance count them. A finish
    // refused (or lost) keeps none, so they go on their own route.
    const tokens = await spent();
    const reply = await api.finish(job, outcome.outcome, { ...outcome.result, ...(tally.size ? { calls: tally.value() } : {}), ...(tokens ? { tokens } : {}) })
      .catch(error => ({ ok: false, code: error?.message ?? 'finish-failed' }));
    await say(`job ${job.id} ${job.status} → ${outcome.outcome}${outcome.result?.code ? ` (${outcome.result.code})` : ''} ${reply.ok ? reply.status : `finish refused ${reply.code}`}`);
    if (!reply.ok) await reportStageTokens(api, job, tokens, say);
    if (unknown.length && reply.ok)
      await dispatches.handOver(unknown).catch(error => say(`job ${job.id} dispatch records not handed over: ${error?.message ?? error}`));
    if (['rejected', 'failed'].includes(outcome.outcome) || reply.status === 'submitted') await writeFile(path.join(dir, '.closed'), '').catch(() => {});
  }

  await say('worker started');
  for (;;) {
    try {
      await keepAlive();
      if (health.codex && Date.now() >= frontDue)
        frontDue = await checkFront().catch(error => { say(`front check error ${error.message}`); return false; }) ? 0 : Date.now() + TIMING.heartbeatMs;
      const claimed = health.ok ? await api.claim() : { ok: true, stage: 'idle' };
      if (claimed.ok && claimed.job) await work(claimed.job);
      else {
        if (!claimed.ok) await say(`claim failed ${claimed.code ?? claimed.status}`);
        if (once) return;
        await new Promise(resolve => setTimeout(resolve, TIMING.idleMs));
      }
      if (once) return;
    } catch (error) {
      await say(`loop error ${error.message}`);
      if (once) throw error;
      await new Promise(resolve => setTimeout(resolve, TIMING.errorMs));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main({ once: process.argv.includes('--once') }).catch(error => { console.error(`generation-worker: ${error.message}`); process.exit(1); });
}
