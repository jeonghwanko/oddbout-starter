// @ts-check

/** Only errors observed before arena dispatch may safely release an allocation.
 * Unknown browser/transport outcomes are deliberately not this class. */
export class ConfirmedRenderFailure extends Error {
  /** @param {string} code */
  constructor(code) { super(code); this.name = 'ConfirmedRenderFailure'; }
}
/** The worker API answered with a refusal (4xx with its own JSON code), or no connection was ever made: the command
 * did not take effect. Any other failure may have, and stays uncertain. */
export class WorkerRefusal extends Error {
  /** @param {string} code @param {number} status */
  constructor(code, status) { super(code); this.name = 'WorkerRefusal'; this.status = status; }
}
/** The lease the worker API grants on claim and renew (broadcast/worker-api.mjs). */
export const WORKER_LEASE_SECONDS = 60;
class RendererCleanupError extends Error {
  /** @param {any} observedResult */
  constructor(observedResult) { super('runner_renderer_cleanup_unknown'); this.observedResult = observedResult; }
}

/** @param {unknown} value @param {boolean} [arena] */
function checkedUrl(value, arena = false) {
  try {
    const url = new URL(String(value));
    if (url.username || url.password || url.hash || !['https:', 'http:'].includes(url.protocol)
      || (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      || (arena && url.pathname !== '/broadcast.html') || (!arena && url.search)) throw new Error();
    return url.href.replace(/\/$/, '');
  } catch { throw new Error(arena ? 'runner_invalid_arena_url' : 'runner_invalid_api_origin'); }
}

/** @param {number} milliseconds @param {AbortSignal} [signal] */
function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('runner_aborted')); return; }
    const done = () => { signal?.removeEventListener('abort', aborted); resolve(undefined); };
    const timer = setTimeout(done, milliseconds);
    const aborted = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); reject(new Error('runner_aborted')); };
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

/** @param {Promise<any>} operation @param {number} milliseconds @param {AbortSignal} [signal] */
function bounded(operation, milliseconds, signal) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
  /** @type {(()=>void)|undefined} */ let abort;
  return Promise.race([operation, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('runner_timeout')), milliseconds);
    abort = () => reject(new Error('runner_aborted'));
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  })]).finally(() => { clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); });
}

/** @typedef {{id:string,broadcastId:string,hostId:string,workerId:string,channelId:string,endsAt:string,seed:number,fighterIds:string[],leaseToken:number}} CupJob */
/** @typedef {{runCup:(job:CupJob,options:{signal:AbortSignal})=>Promise<any>,close:()=>Promise<void>}} CupRenderer */
/** @typedef {(command:string,input:any,options?:{signal?:AbortSignal})=>Promise<any>} WorkerTransport */
/** @typedef {{schemaVersion:1,job?:CupJob,workerId?:string,status:string,completion?:any}} RunnerCheckpoint */

/** No automatic HTTP retry: a lost response is an uncertain persisted operation.
 * @param {{apiOrigin:string,workerToken:string,requestTimeoutMs?:number,fetchImpl?:typeof fetch}} options
 * @returns {WorkerTransport} */
export function createWorkerTransport({ apiOrigin, workerToken, requestTimeoutMs = 10_000, fetchImpl = fetch }) {
  const base = checkedUrl(apiOrigin);
  if (typeof workerToken !== 'string' || workerToken.length < 16 || /[\r\n]/.test(workerToken)) throw new Error('runner_worker_token_required');
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 60_000) throw new Error('runner_invalid_timeout');
  return async (command, input, { signal } = {}) => {
    if (!['claim', 'renew', 'complete', 'status'].includes(command)) throw new Error('runner_invalid_command');
    if (signal?.aborted) throw new Error('runner_worker_request_failed');
    const controller = new AbortController();
    const requestSignal = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
    /** @type {ReadableStreamDefaultReader<Uint8Array>|undefined} */ let reader;
    try {
      return await bounded((async () => {
      const response = await fetchImpl(`${base}/commerce-worker/${command}`, {
        method: 'POST', headers: { authorization: `Bearer ${workerToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(input), signal: requestSignal, redirect: 'error',
      });
      if (!response.body) throw new Error();
      reader = response.body.getReader();
      const chunks = []; let size = 0;
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength; if (size > 1024 * 1024) throw new Error();
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (response.status >= 400 && response.status < 500 && body?.ok === false && typeof body.code === 'string' && /^[a-z0-9_-]{1,64}$/.test(body.code))
        throw new WorkerRefusal(body.code, response.status);
      if (!response.ok || !body || body.ok !== true || !Object.hasOwn(body, 'data')) throw new Error();
      return body.data;
      })(), requestTimeoutMs, requestSignal);
    } catch (/** @type {any} */ error) {
      if (error instanceof WorkerRefusal) throw error;
      if (error?.cause?.code === 'ECONNREFUSED') throw new WorkerRefusal('runner_api_unreachable', 0);
      throw new Error('runner_worker_request_failed');
    }
    finally { controller.abort(); if (reader) void reader.cancel().catch(() => {}); }
  };
}

/** A dedicated visible Chromium on the selected machine, never a user's existing browser.
 * Launch/navigation failures are known not to have dispatched a cup. Once evaluate starts,
 * its failure is uncertain and the caller retains the original job for reconciliation.
 * @param {{arenaUrl:string,playwright?:any,platform?:string,env?:Record<string,string|undefined>}} options
 * @returns {CupRenderer} */
export function createPlaywrightRenderer({ arenaUrl, playwright, platform = process.platform, env = process.env }) {
  const arena = checkedUrl(arenaUrl, true);
  const browserChannel = env.ODDBOUT_BROADCAST_BROWSER_CHANNEL;
  if (browserChannel && !['chrome', 'msedge'].includes(browserChannel)) throw new Error('runner_invalid_browser_channel');
  /** @type {any} */ let browser;
  /** @type {Promise<void>|undefined} */ let closing;
  let closed = false;
  let started = false;
  const close = async () => {
    closed = true;
    if (browser) {
      closing ??= bounded(Promise.resolve().then(() => browser.close()), 5000)
        .catch(() => { throw new Error('runner_renderer_cleanup_unknown'); });
      await closing;
    }
  };
  return {
    close,
    async runCup(job, { signal }) {
      if (started || closed || signal.aborted) throw new ConfirmedRenderFailure('runner_renderer_not_available');
      started = true;
      if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) throw new ConfirmedRenderFailure('runner_graphical_session_required');
      let dispatched = false;
      /** @type {any} */ let observedResult;
      const aborted = () => { void close().catch(() => {}); };
      signal.addEventListener('abort', aborted, { once: true });
      try {
        const runtime = playwright ?? await import('playwright');
        if (signal.aborted || closed) throw new Error();
        browser = await runtime.chromium.launch({ headless: false, ...(browserChannel ? { channel: browserChannel } : {}) });
        if (signal.aborted || closed) { await close(); throw new Error(); }
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(arena, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        if (page.url() !== arena) throw new Error();
        await page.waitForFunction(() => /** @type {any} */ (window).oddboutBroadcast?.protocolVersion === 1 && typeof /** @type {any} */ (window).oddboutBroadcast?.runCup === 'function', undefined, { timeout: 30_000 });
        if (signal.aborted || closed || page.url() !== arena) throw new Error();
        const observedStart = new Date().toISOString();
        dispatched = true;
        const resultPromise = page.evaluate(async (/** @type {any} */ input) => /** @type {any} */ (window).oddboutBroadcast.runCup(input),
          { jobId: job.id, leaseToken: job.leaseToken, seed: job.seed, fighterIds: job.fighterIds });
        // The game creates its AudioContext on a real canvas gesture. Wait for the
        // first bout's ready signal, then click inside its iframe (the parent is not enough).
        // A missed gesture does not turn an already-completed paid cup into a retry.
        const audioGesture = (async () => {
          await page.waitForFunction(() => document.getElementById('broadcast-status')?.textContent?.includes(' VS '), undefined, { timeout: 45_000 });
          await page.frameLocator('iframe[title="ODDBOUT exhibition battle"]').locator('canvas').click({ position: { x: 20, y: 20 }, timeout: 10_000 });
          return true;
        })().catch(() => false);
        const result = await resultPromise;
        const audioGestureDispatched = await audioGesture;
        if (page.url() !== arena) throw new Error();
        const observedUrl = new URL(arena); observedUrl.search = '';
        observedResult = { ...result, rendererObservation: { renderer: 'playwright-visible-chromium', browserChannel: browserChannel ?? 'bundled-chromium', arenaUrl: observedUrl.href,
          audioGestureDispatched, observedDispatchAt: observedStart, observedResultAt: new Date().toISOString() } };
        return observedResult;
      } catch (/** @type {any} */ error) {
        // Nothing reached the arena before dispatch, aborted or not. After it, only the page's own verdict that the cup
        // did not complete (BroadcastCup's broadcast_execution_failed) is certain; a closed browser or a lost reply is not.
        if (!dispatched) throw new ConfirmedRenderFailure('runner_renderer_setup_failed');
        if (!signal.aborted && /\bbroadcast_execution_failed\b/.test(String(error?.message))) throw new ConfirmedRenderFailure('runner_page_reported_failure');
        throw new Error('runner_render_outcome_unknown');
      } finally {
        signal.removeEventListener('abort', aborted);
        // biome-ignore lint/correctness/noUnsafeFinally: a renderer that would not close must surface over the outcome above
        try { await close(); } catch { throw new RendererCleanupError(observedResult); }
      }
    },
  };
}

/** @param {any} value @param {string} hostId @param {string} workerId @returns {CupJob} */
function checkedJob(value, hostId, workerId) {
  if (!value || typeof value !== 'object' || value.hostId !== hostId || typeof value.id !== 'string' || !value.id
    || typeof value.broadcastId !== 'string' || !value.broadcastId || typeof value.channelId !== 'string' || !value.channelId
    || value.workerId !== `${hostId}:${workerId}`
    || !Number.isSafeInteger(value.leaseToken) || value.leaseToken < 1 || !Number.isSafeInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff
    || !Array.isArray(value.fighterIds) || value.fighterIds.length !== 4 || new Set(value.fighterIds).size !== 4
    || value.fighterIds.some((/** @type {any} */ id) => typeof id !== 'string' || !id || id.length > 128)
    || typeof value.endsAt !== 'string' || !Number.isFinite(Date.parse(value.endsAt))) throw new Error('runner_invalid_claim');
  return structuredClone(value);
}

/** Validate the observed three-bout bracket before asking the server to charge it.
 * @param {any} value @param {Pick<CupJob,'id'|'leaseToken'|'seed'|'fighterIds'>} job */
export function validateCupResult(value, job) {
  if (value?.protocolVersion !== 1 || value.jobId !== job.id || value.leaseToken !== job.leaseToken || value.seed !== job.seed
    || !Array.isArray(value.bouts) || value.bouts.length !== 3) throw new Error('runner_invalid_render_result');
  const pair = (/** @type {any} */ values) => Array.isArray(values) && values.length === 2 && values.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0);
  for (let n = 0; n < 3; n++) {
    const bout = value.bouts[n];
    const left = n < 2 ? job.fighterIds[n * 2] : value.bouts[0].winnerId;
    const right = n < 2 ? job.fighterIds[n * 2 + 1] : value.bouts[1].winnerId;
    if (!bout || bout.leftId !== left || bout.rightId !== right || ![left, right].includes(bout.winnerId)
      || bout.seed !== ((job.seed + n) >>> 0) || (bout.winner !== 0 && bout.winner !== 1) || bout.winnerId !== (bout.winner === 0 ? left : right)
      || !['ko','decision'].includes(bout.how) || typeof bout.ms !== 'number' || !Number.isFinite(bout.ms) || bout.ms < 0
      || !pair(bout.hp) || bout.hp.some((/** @type {number} */ hp) => hp > 1) || !pair(bout.contacts) || !bout.contacts.every(Number.isSafeInteger)
      || typeof bout.digest !== 'string' || !/^[0-9a-f]{8}$/i.test(bout.digest)) throw new Error('runner_invalid_render_result');
  }
  if (value.winnerId !== value.bouts[2].winnerId) throw new Error('runner_invalid_render_result');
  return structuredClone(value);
}

/**
 * The default mode only renders. OBS status is a read-only observation, never evidence of
 * a target Twitch channel or successful live minutes. Live start stays blocked until that
 * identity and the dedicated scene have a verifiable host/server contract.
 * @param {{hostId:string,apiOrigin:string,workerToken:string,workerId:string,arenaUrl:string,
 * obs:import('./obs.mjs').ObsClient,live?:boolean,renderer?:CupRenderer,playwright?:any,
 * transport?:WorkerTransport,heartbeatMs?:number,requestTimeoutMs?:number,retryMs?:number,
 * pending?:RunnerCheckpoint|null,checkpoint?:(record:RunnerCheckpoint|null)=>Promise<void>}} options
 */
export function createBroadcastRunner(options) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(options.hostId) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(options.workerId)) throw new Error('runner_invalid_identity');
  checkedUrl(options.arenaUrl, true);
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < 1 || heartbeatMs > 30_000) throw new Error('runner_invalid_heartbeat');
  const transport = options.transport ?? createWorkerTransport(options);
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 60_000) throw new Error('runner_invalid_timeout');
  const retryMs = options.retryMs ?? 2000;
  if (!Number.isSafeInteger(retryMs) || retryMs < 1 || retryMs > 10_000) throw new Error('runner_invalid_retry');
  /** @param {string} command @param {any} input @param {AbortSignal} [signal] */
  const request = (command, input, signal) => signal?.aborted ? Promise.reject(new Error('runner_aborted')) : bounded(transport(command, input, { signal }), requestTimeoutMs, signal);
  /** @type {RunnerCheckpoint|null} */ let pending = options.pending ?? null;
  let busy = false;
  /** @param {RunnerCheckpoint|null} record */
  async function save(record) { if (options.checkpoint) await options.checkpoint(record); pending = record; }
  /** The ledger accepts an identical completion again, so a lost reply is retried a few times before it counts as unknown.
   * @param {any} completion @returns {Promise<string|null>} why it is still unsettled, or null */
  async function complete(completion) {
    for (let attempt = 1; ; attempt++) {
      try {
        const completed = await request('complete', completion);
        return completed && completed.id === completion.jobId && completed.status === completion.outcome ? null : 'runner_completion_outcome_unknown';
      } catch (error) {
        if (error instanceof WorkerRefusal) return 'runner_completion_rejected';
        if (attempt >= 3) return 'runner_completion_outcome_unknown';
        try { await delay(retryMs); } catch { return 'runner_completion_outcome_unknown'; }
      }
    }
  }
  /** A checkpoint left by a lost reply or a crash: ask the server what it holds under the checkpoint's worker ID (a new
   * process has its own) before any new work. Returns null once nothing is left to settle.
   * @param {RunnerCheckpoint} record @param {AbortSignal} [signal] */
  async function reconcile(record, signal) {
    const prefix = `${options.hostId}:`;
    const workerId = record.job ? record.job.workerId.slice(prefix.length) : record.workerId;
    /** @param {string} reason @param {string} [jobId] */
    const blocked = (reason, jobId = record.job?.id) => ({ status: 'unknown', ...(jobId ? { jobId } : {}), reason });
    if (typeof workerId !== 'string' || !workerId || (record.job && !record.job.workerId.startsWith(prefix))) return blocked('runner_reconciliation_required');
    let jobs;
    try { jobs = await request('status', { workerId, ...(record.job ? { jobId: record.job.id } : {}) }, signal); }
    catch { return blocked('runner_reconciliation_required'); }
    if (!Array.isArray(jobs) || (record.job && jobs.length !== 1)
      || jobs.some(job => !job || typeof job.id !== 'string' || !Number.isSafeInteger(job.leaseToken) || (record.job && job.id !== record.job.id))) return blocked('runner_reconciliation_required');
    for (const job of jobs) {
      if (['succeeded', 'failed'].includes(job.status)) continue;
      const kept = record.completion?.outcome !== 'unknown' ? record.completion : undefined;
      if (job.status === 'unknown') {
        // Lost lease or frozen wallet: only a kept terminal completion may still land; otherwise an operator decides.
        if (!kept || await complete(kept)) return blocked('runner_operator_release_required', job.id);
        continue;
      }
      // A lost claim reply means this worker never rendered the job; after a crash mid-cup nobody knows what was shown.
      const completion = kept ?? { workerId, jobId: job.id, leaseToken: job.leaseToken,
        ...(record.job ? { outcome: 'unknown', result: { reason: 'runner_restarted_mid_cup' } } : { outcome: 'failed', result: { reason: 'runner_claim_reply_lost' } }) };
      const unsettled = await complete(completion);
      if (unsettled || completion.outcome === 'unknown') return blocked(unsettled ?? 'runner_operator_release_required', job.id);
    }
    try { await save(null); } catch { return blocked('runner_checkpoint_failed'); }
    return null;
  }

  /** @param {{signal?:AbortSignal}} [runOptions] */
  async function runOnce({ signal } = {}) {
    if (busy) throw new Error('runner_already_running');
    if (signal?.aborted) return { status: 'idle', reason: 'runner_stopped' };
    if (options.live) return { status: 'unconfigured', reason: 'runner_live_channel_unverified' };
    if (pending) {
      busy = true;
      try { const blocked = await reconcile(pending, signal); if (blocked) return blocked; }
      finally { busy = false; }
    }
    busy = true;
    /** @type {CupJob|undefined} */ let job;
    /** @type {CupRenderer|undefined} */ let renderer;
    let rendererClosed = false;
    /** @type {any} */ let initialObs;
    let reason = '';
    const execution = new AbortController();
    const heartbeat = new AbortController();
    /** @type {Promise<void>|undefined} */ let heartbeatTask;
    /** @type {ReturnType<typeof setTimeout>|undefined} */ let endTimer;
    const abort = () => { reason ||= 'runner_stopped'; execution.abort(); };
    signal?.addEventListener('abort', abort, { once: true });
    /** @param {string} code */
    const loseLease = code => { reason ||= code; execution.abort(); void renderer?.close().catch(() => {}); };
    try {
      try {
        initialObs = await bounded(options.obs.request('GetStreamStatus'), 10_000, execution.signal);
        if (typeof initialObs.outputActive !== 'boolean' || typeof initialObs.outputReconnecting !== 'boolean' || initialObs.outputReconnecting) throw new Error();
        initialObs = { outputActive: initialObs.outputActive, outputReconnecting: initialObs.outputReconnecting };
      } catch { return { status: 'unconfigured', reason: 'runner_obs_unavailable' }; }
      if (execution.signal.aborted) return { status: 'idle', reason: 'runner_stopped' };
      // Persist even the claim attempt: its response may be lost before we learn the job ID.
      pending = { schemaVersion: 1, workerId: options.workerId, status: 'claim-pending' };
      try { await save(pending); }
      catch { return { status: 'unknown', reason: 'runner_checkpoint_failed' }; }
      let claim;
      const claimSentAt = Date.now();
      try { claim = await request('claim', { workerId: options.workerId }, execution.signal); }
      catch (error) {
        if (!(error instanceof WorkerRefusal)) return { status: 'unknown', reason: 'runner_claim_outcome_unknown' };
        try { await save(null); } catch { return { status: 'unknown', reason: 'runner_checkpoint_failed' }; }
        return { status: [401, 403].includes(error.status) ? 'unconfigured' : 'idle', reason: error.message };
      }
      if (claim === null) {
        try { await save(null); } catch { return { status: 'unknown', reason: 'runner_checkpoint_failed' }; }
        return { status: 'idle' };
      }
      try { job = checkedJob(claim, options.hostId, options.workerId); }
      catch { return { status: 'unknown', reason: 'runner_invalid_claim' }; }
      // Keep an in-memory block even when the durable checkpoint itself fails.
      pending = { schemaVersion: 1, job, status: 'claimed' };
      try { await save(pending); }
      catch { return { status: 'unknown', jobId: job.id, reason: 'runner_checkpoint_failed' }; }
      renderer = options.renderer ?? createPlaywrightRenderer({ arenaUrl: options.arenaUrl, playwright: options.playwright });
      const activeJob = job;
      const remaining = Date.parse(job.endsAt) - Date.now();
      if (remaining <= 0) loseLease('runner_approval_expired');
      else endTimer = setTimeout(() => loseLease('runner_approval_expired'), Math.min(remaining, 2_147_483_647));
      // The lease runs WORKER_LEASE_SECONDS from the server's grant, which came after we sent the request that got it.
      let leaseSentAt = claimSentAt;
      heartbeatTask = (async () => {
        while (!heartbeat.signal.aborted && !execution.signal.aborted) {
          try { await delay(heartbeatMs, heartbeat.signal); } catch { break; }
          if (heartbeat.signal.aborted || execution.signal.aborted) break;
          const sentAt = Date.now();
          let renewed;
          try {
            renewed = await request('renew', { workerId: options.workerId, jobId: activeJob.id, leaseToken: activeJob.leaseToken },
              AbortSignal.any([heartbeat.signal, execution.signal]));
          } catch (error) {
            if (heartbeat.signal.aborted || execution.signal.aborted) break;
            // A lost reply leaves the last grant running: give up on a refusal, or once the next beat could land too late.
            if (error instanceof WorkerRefusal || Date.now() + heartbeatMs + requestTimeoutMs >= leaseSentAt + WORKER_LEASE_SECONDS * 1000) {
              loseLease('runner_lease_lost'); break;
            }
            continue;
          }
          if (!renewed || renewed.id !== activeJob.id || renewed.leaseToken !== activeJob.leaseToken
            || renewed.hostId !== activeJob.hostId || renewed.workerId !== activeJob.workerId || renewed.broadcastId !== activeJob.broadcastId
            || renewed.seed !== activeJob.seed || JSON.stringify(renewed.fighterIds) !== JSON.stringify(activeJob.fighterIds)) {
            loseLease('runner_lease_lost'); break;
          }
          leaseSentAt = sentAt;
        }
      })();

      /** @type {'succeeded'|'failed'|'unknown'} */ let outcome = 'unknown';
      /** @type {any} */ let result;
      /** @type {()=>void} */ let onAbort = () => {};
      /** @type {Promise<any>|undefined} */ let cup;
      try {
        if (execution.signal.aborted) throw new Error();
        const aborted = new Promise((_, reject) => {
          onAbort = () => reject(new Error('runner_execution_aborted'));
          execution.signal.addEventListener('abort', onAbort, { once: true });
        });
        cup = renderer.runCup(structuredClone(job), { signal: execution.signal });
        result = validateCupResult(await Promise.race([cup, aborted]), job);
        if (execution.signal.aborted) throw new Error();
        outcome = 'succeeded';
        result = { ...result, runnerObservation: { hostId: options.hostId, jobId: job.id, leaseToken: job.leaseToken,
          mode: 'render-only', observedResultAt: new Date().toISOString(), obs: initialObs,
          broadcast: { verified: false, liveSeconds: null } } };
      } catch (/** @type {any} */ error) {
        /** @type {any} */ let observedResult;
        // An abort wins the race above; give the renderer a moment to say whether anything reached the arena.
        let verdict = error;
        if (cup && execution.signal.aborted && !(error instanceof ConfirmedRenderFailure))
          verdict = await bounded(cup.then(() => error, (/** @type {any} */ settled) => settled), 10_000).catch(() => error);
        if (verdict instanceof RendererCleanupError) {
          reason = 'runner_renderer_cleanup_unknown';
          try { observedResult = validateCupResult(verdict.observedResult, job); } catch { /* No invented evidence. */ }
        }
        // Never dispatched (aborted first) or confirmed by the renderer: no cup was shown in full, so nothing is charged.
        if (!cup || verdict instanceof ConfirmedRenderFailure) { outcome = 'failed'; reason ||= cup ? verdict.message : 'runner_not_dispatched'; }
        else { outcome = 'unknown'; reason ||= 'runner_render_outcome_unknown'; }
        result = { reason, ...(observedResult ? { observedResult } : {}), runnerObservation: { mode: 'render-only', broadcast: { verified: false, liveSeconds: null } } };
      } finally {
        execution.signal.removeEventListener('abort', onAbort);
        heartbeat.abort();
        await heartbeatTask;
        clearTimeout(endTimer);
        try { await bounded(renderer.close(), 5000); rendererClosed = true; }
        catch {
          const observedResult = result?.observedResult ?? (outcome === 'succeeded' ? result : null);
          outcome = 'unknown'; reason = 'runner_renderer_cleanup_unknown';
          result = { reason, ...(observedResult ? { observedResult } : {}), runnerObservation: { mode: 'render-only', broadcast: { verified: false, liveSeconds: null } } };
        }
      }
      const completion = { workerId: options.workerId, jobId: job.id, leaseToken: job.leaseToken, outcome, result };
      pending = { schemaVersion: 1, job, status: outcome, completion };
      try { await save(pending); }
      catch { return { status: 'unknown', jobId: job.id, reason: 'runner_checkpoint_failed' }; }
      const unsettled = await complete(completion);
      if (unsettled) return { status: 'unknown', jobId: job.id, reason: unsettled };
      if (outcome !== 'unknown') {
        try { await save(null); } catch { return { status: 'unknown', jobId: job.id, reason: 'runner_checkpoint_failed' }; }
      }
      return { status: outcome === 'succeeded' ? 'completed' : outcome, jobId: job.id, ...(reason ? { reason } : {}),
        observation: { mode: 'render-only', broadcastVerified: false, liveSeconds: null } };
    } finally {
      heartbeat.abort(); clearTimeout(endTimer); signal?.removeEventListener('abort', abort);
      if (!rendererClosed) await bounded(renderer?.close() ?? Promise.resolve(), 5000).catch(() => {});
      busy = false;
    }
  }
  /** @param {{signal:AbortSignal,pollMs?:number,onResult?:(result:any)=>void}} runOptions */
  async function run({ signal, pollMs = 5000, onResult = () => {} }) {
    if (!Number.isSafeInteger(pollMs) || pollMs < 1 || pollMs > 60_000) throw new Error('runner_invalid_poll');
    while (!signal.aborted) {
      const result = await runOnce({ signal }); onResult(result);
      // A lost claim or completion reply is settled by the next runOnce from the checkpoint; anything else needs a person.
      if (['unknown', 'unconfigured', 'failed'].includes(result.status)
        && !(result.status === 'unknown' && ['runner_claim_outcome_unknown', 'runner_completion_outcome_unknown'].includes(/** @type {any} */ (result).reason))) return result;
      try { await delay(pollMs, signal); } catch { break; }
    }
    return { status: 'stopped' };
  }
  return { runOnce, run };
}
