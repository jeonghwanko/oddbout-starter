#!/usr/bin/env node
// 호스팅 생성 워커 (P1, 2026-10-27). Runs as the generation service user (`og worker run`, a systemd user service from `og worker install`),
// or on a community host's PC as his own account (2026-10-28, `npm run host:start`); the API tells it only the jobs meant for that host.
// It reaches the API outward only: a heartbeat with the subscriptions' health every minute, a claim of one stage of one job at a time,
// lease renewals while the stage runs, artifacts and the package through the worker routes, the stage's outcome. Stages:
// generation-stages.mjs. Config: `<root>/worker.env` (ODDBOUT_GENERATION_API, ODDBOUT_GENERATION_WORKER_KEY, optional
// ODDBOUT_GENERATION_KEEP_DAYS), written by `og worker key`. Once a day it runs `og prune`: a finished job's request text and pictures go.
import { execFile, spawn } from 'node:child_process';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ASKS, GROK_LIMITED, MODELS, createStages, ogJobId } from './generation-stages.mjs';
import { codexTokensSince, codexUsage } from './codex-usage.mjs';

// <root>/bin holds this file in both installs (/srv/oddbout-gen on ODDBOUT's PC, a host's own folder in user mode).
const ROOT = process.env.OG_ROOT || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const TIMING = Object.freeze({ heartbeatMs: 60_000, healthMs: 3_600_000, idleMs: 15_000, renewMs: 60_000, errorMs: 60_000, pruneMs: 86_400_000,
  askedRecheckMs: 900_000 });
/**
 * How long one stage may run (2026-10-29): past it the stage's runs are stopped (SIGTERM, so sprite-gen writes its reports) and the job
 * goes to an operator as `<stage>-stage-timeout`, never back to the queue, since a stopped run may already have sent a paid request.
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
 * One child process in its own process group; its output appended to the job's log. Resolves its exit code (signals count as 128 + n).
 * Stopping it signals the whole group: og's bash waits for its command before its own trap runs, so only the group stops the work.
 */
function run(command, args, { cwd, log, stdin, signal }) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve(128 + 15);   // stopped before it began: nothing started
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    const write = chunk => { appendFile(log, chunk).catch(() => {}); };
    child.stdout.on('data', write); child.stderr.on('data', write);
    child.stdin.end(stdin ?? '');
    const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } };
    signal?.addEventListener('abort', stop, { once: true });
    child.on('close', (code, sig) => { signal?.removeEventListener('abort', stop); resolve(code ?? 128 + (sig === 'SIGKILL' ? 9 : 15)); });
    child.on('error', () => resolve(127));
  });
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
    const stages = createStages({
      og: (args, { stdin } = {}) => unlessStopped(controller.signal, () => {
        const started = Date.now();
        return run(og, ['run', ogId, '--', ...args], { cwd: kit, log, stdin, signal: controller.signal })
          .then(code => { tally.add(args, code, Date.now() - started); return { code }; });
      }),
      api, signal: controller.signal, lowMarginFeetTaken,
      fetchBytes: async url => { const r = await fetch(url, { signal: AbortSignal.timeout(60_000) }); if (!r.ok) throw new Error(`download ${r.status}`); return new Uint8Array(await r.arrayBuffer()); },
      motionsPy: args => unlessStopped(controller.signal, () => run(python, ['-I', path.join(ROOT, 'bin', 'motions.py'), ...args], { cwd: kit, log, signal: controller.signal })
        .then(code => ({ code }))),
      // Method 5: at 6 libwebp's slowest alpha search took 3–7 s per transparent look instead of 0.1–0.2 s, for 1 % fewer bytes.
      toWebp: async (from, to) => {
        const code = await run(python, ['-I', '-c', 'import sys\nfrom PIL import Image\nim = Image.open(sys.argv[1]); im.thumbnail((1024, 1024)); im.save(sys.argv[2], "WEBP", quality=90, method=5)', from, to], { cwd: kit, log });
        if (code !== 0) throw Object.assign(new Error('webp-failed'), { code: 'webp-failed' });
      },
      // Review evidence over the server's limits (2 MiB, 2048 px): lossless WebP, at most 2048 px, nearest so pixel art stays sharp.
      fitImage: async (from, to) => {
        const code = await run(python, ['-I', '-c', 'import sys\nfrom PIL import Image\nim = Image.open(sys.argv[1]); im.thumbnail((2048, 2048), Image.NEAREST); im.save(sys.argv[2], "WEBP", lossless=True, method=6)', from, to], { cwd: kit, log });
        if (code !== 0) throw Object.assign(new Error('evidence-fit-failed'), { code: 'evidence-fit-failed' });
      },
    });
    let outcome;
    try {
      const stage = stages[job.status];
      outcome = stage ? await stage(job, dir) : { outcome: 'failed', result: { code: `no-stage-${job.status}` } };
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
    // codex cannot run here now (exit 75: signed out, usage used up): claim nothing until a health check passes again, soon.
    const down = healthAfter(health, outcome.result?.code), provider = limitedProvider(outcome.result?.code);
    if (down !== health) {
      health = down;
      const wait = cooldowns.limit(provider);
      checkedAt = Date.now() - TIMING.healthMs + wait;
      await say(`${provider} cannot run now: no claims until health passes (checked again in ${Math.round(wait / 60_000)} minutes)`);
    } else if (outcome.outcome === 'ok') cooldowns.worked(STAGE_PROVIDERS[job.status] ?? []);
    // The stage's codex tokens beside its calls (2026-10-31): the server's daily budget and the creator's balance count them. A finish
    // refused (or lost) keeps none, so they go on their own route.
    const tokens = await spent();
    const reply = await api.finish(job, outcome.outcome, { ...outcome.result, ...(tally.size ? { calls: tally.value() } : {}), ...(tokens ? { tokens } : {}) })
      .catch(error => ({ ok: false, code: error?.message ?? 'finish-failed' }));
    await say(`job ${job.id} ${job.status} → ${outcome.outcome}${outcome.result?.code ? ` (${outcome.result.code})` : ''} ${reply.ok ? reply.status : `finish refused ${reply.code}`}`);
    if (!reply.ok) await reportStageTokens(api, job, tokens, say);
    if (['rejected', 'failed'].includes(outcome.outcome) || reply.status === 'submitted') await writeFile(path.join(dir, '.closed'), '').catch(() => {});
  }

  await say('worker started');
  for (;;) {
    try {
      await keepAlive();
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
