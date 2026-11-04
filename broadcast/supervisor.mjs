// @ts-check
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createBroadcastProducer, createProducerMcp } from './producer.mjs';
import { loadJsonState, saveJsonState } from './producer-state.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE = /^producer-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;
const REASONS = new Set(['producer_scope_mismatch', 'producer_mcp_connection_failed', 'producer_state_scope_mismatch', 'producer_invalid_state']);
const RETRYABLE = new Set(['producer_model_outcome_unverified','producer_invalid_decision']);

/** @typedef {import('./producer.mjs').ProducerState} ProducerState */
/** @typedef {{status:string,reason:string|null,at:string}} SupervisedResult */
/** @typedef {{schemaVersion:1,owner:string,broadcastId:string,producer:ProducerState|null,result:SupervisedResult|null}} SupervisedRecord */

/** Runs the AI producer for every started Sandbox session inside the demo server, so a person who
 * approved a budget needs no CLI or operator-provisioned credential. Each producer gets a fresh
 * in-process grant scoped to its own session and speaks MCP to this server's own handler. The
 * checkpoint persists per session: after a restart the same producer resumes, and a finished one
 * is never started again, so a restart cannot buy another round of model calls.
 * @param {{grants:{issue:(owner:string,broadcastId:string,expiresAt:number)=>{token:string,revoke:()=>void}},
 *   service:{report:(owner:string,id:string)=>Promise<any>},mcpUrl:string,mcpFetch:typeof fetch,
 *   model:string,modelCall:import('./producer.mjs').ModelCall,stateDir:string,maxModelCalls?:number,maxActive?:number,
 *   dailyModelCalls?:number,pollMs?:number,now?:()=>number,connect?:typeof createProducerMcp}} options */
export function createProducerSupervisor({ grants, service, mcpUrl, mcpFetch, model, modelCall, stateDir,
  maxModelCalls = 24, maxActive = 3, dailyModelCalls = 200, pollMs = 5000, now = Date.now, connect = createProducerMcp }) {
  for (const [value, min, max] of [[maxModelCalls, 1, 100], [maxActive, 1, 20], [dailyModelCalls, 1, 10_000], [pollMs, 1, 60_000]])
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('producer_supervisor_invalid_configuration');
  /** @type {Map<string,{owner:string,controller:AbortController,done:Promise<void>}>} */ const active = new Map();
  /** @type {Map<string,string>} */ const waiting = new Map();
  /** @type {Map<string,SupervisedRecord>} */ const records = new Map();
  /** @type {Set<string>} */ const limited = new Set();
  /** @type {Set<string>} */ const retrying = new Set();
  let day = '', used = 0, closed = false;
  const pathOf = (/** @type {string} */ id) => join(stateDir, `producer-${id}.json`);
  const stamp = () => new Date(now()).toISOString();
  /** @param {SupervisedRecord} record */
  async function save(record) { records.set(record.broadcastId, record); await saveJsonState(pathOf(record.broadcastId), record); }

  /** The daily cap is checked before any request leaves the process. A refused call still halts its
   * producer as unverified (the producer cannot tell the difference); the record names the real reason.
   * @type {import('./producer.mjs').ModelCall} */
  const countedModelCall = (context, options) => {
    const today = stamp().slice(0, 10);
    if (today !== day) { day = today; used = 0; }
    if (used >= dailyModelCalls) { limited.add(context.broadcastId); return Promise.reject(new Error('producer_daily_model_limit')); }
    used++;
    return modelCall(context, options);
  };

  /** @param {string} owner @param {string} broadcastId */
  function launch(owner, broadcastId) {
    const controller = new AbortController();
    const done = (async () => {
      /** @type {{token:string,revoke:()=>void}|undefined} */ let credential;
      /** @type {import('./producer.mjs').ProducerMcp|undefined} */ let mcp;
      /** @type {SupervisedRecord} */ let record = { schemaVersion: 1, owner, broadcastId, producer: null, result: null };
      try {
        const stored = /** @type {SupervisedRecord|null} */ (await loadJsonState(pathOf(broadcastId)));
        if (stored && (stored.schemaVersion !== 1 || stored.owner !== owner || stored.broadcastId !== broadcastId)) throw new Error('producer_state_scope_mismatch');
        if (stored?.result) { records.set(broadcastId, stored); return; }
        if (stored) record = stored;
        await save(record);
        const report = await service.report(owner, broadcastId);
        const endsAt = Date.parse(report?.broadcast?.endsAt);
        if (report?.broadcast?.id !== broadcastId || !Number.isFinite(endsAt)) throw new Error('producer_scope_mismatch');
        credential = grants.issue(owner, broadcastId, endsAt);
        mcp = await connect({ url: mcpUrl, token: credential.token, fetchImpl: mcpFetch });
        const producer = createBroadcastProducer({ broadcastId, model, mcp, modelCall: countedModelCall, maxModelCalls, state: record.producer, now,
          checkpoint: async state => { record.producer = state; await save(record); } });
        const outcome = await producer.run({ signal: controller.signal, pollMs });
        // Shutdown is not an outcome: the next process resumes from the checkpoint.
        if (controller.signal.aborted) return;
        record.result = { status: outcome.status, reason: limited.has(broadcastId) ? 'producer_daily_model_limit' : outcome.reason ?? null, at: stamp() };
        await save(record);
      } catch (/** @type {any} */ error) {
        if (controller.signal.aborted) return;
        record.result = { status: 'stopped', reason: REASONS.has(error?.message) ? error.message : 'producer_supervisor_failed', at: stamp() };
        await save(record).catch(() => { records.set(broadcastId, record); });
      } finally {
        credential?.revoke();
        await mcp?.close?.().catch(() => {});
        active.delete(broadcastId);
        next();
      }
    })();
    active.set(broadcastId, { owner, controller, done });
  }
  /** One running producer per account, and at most maxActive overall; the rest wait in arrival order. */
  function next() {
    for (const [broadcastId, owner] of waiting) {
      if (closed || active.size >= maxActive) return;
      if ([...active.values()].some(entry => entry.owner === owner)) continue;
      waiting.delete(broadcastId);
      launch(owner, broadcastId);
    }
  }

  /** Idempotent: the same started session is supervised once. Never throws into the start request.
   * @param {string} owner @param {string} broadcastId */
  function ensure(owner, broadcastId) {
    owner = String(owner).toLowerCase(); broadcastId = String(broadcastId).toLowerCase();
    if (closed || !UUID.test(owner) || !UUID.test(broadcastId) || active.has(broadcastId) || waiting.has(broadcastId)) return;
    if (records.get(broadcastId)?.result) return;
    waiting.set(broadcastId, owner);
    next();
  }

  return {
    ensure,
    /** Explicit owner action only: retry a model decision, never an uncertain cup mutation.
     * Call counters and past decisions remain intact. @param {string} owner @param {string} broadcastId */
    async retry(owner,broadcastId){
      const record=records.get(broadcastId);
      if(record?.owner!==owner||closed)throw new Error('producer-retry-unavailable');
      if(active.has(broadcastId)||waiting.has(broadcastId)||retrying.has(broadcastId))return;
      if(!record.producer||record.producer.pending||!RETRYABLE.has(record.result?.reason??'')||record.producer.modelCalls>=maxModelCalls)
        throw new Error('producer-retry-unavailable');
      retrying.add(broadcastId);
      try{
        record.producer.retries??=[];record.producer.retries.push({at:stamp(),reason:record.result?.reason??'unknown'});
        delete record.producer.halted;record.producer.phase='ready';record.result=null;
        await save(record);ensure(owner,broadcastId);
      }finally{retrying.delete(broadcastId);}
    },
    /** Resume every session whose producer had not finished when the last process stopped. */
    async resume() {
      await mkdir(stateDir, { recursive: true, mode: 0o700 });
      let resumed = 0;
      for (const name of (await readdir(stateDir)).sort()) {
        const id = FILE.exec(name)?.[1];
        if (!id) continue;
        const record = /** @type {SupervisedRecord|null} */ (await loadJsonState(join(stateDir, name)).catch(() => null));
        if (!record || record.broadcastId !== id || !UUID.test(record.owner ?? '')) continue;
        records.set(id, record);
        if (!record.result) { ensure(record.owner, id); resumed++; }
      }
      return resumed;
    },
    /** Owner-scoped summary for the console. Model text is returned as data for the page to show as text.
     * @param {string} owner @param {string} broadcastId */
    status(owner, broadcastId) {
      owner = String(owner).toLowerCase(); broadcastId = String(broadcastId).toLowerCase();
      const record = records.get(broadcastId), holder = active.get(broadcastId)?.owner ?? waiting.get(broadcastId) ?? record?.owner;
      if (holder !== owner) return { state: 'none' };
      const state = active.has(broadcastId) ? 'running' : waiting.has(broadcastId) ? 'waiting' : record?.result ? 'finished' : 'none';
      const producer = record?.producer;
      return { state, model, result: record?.result ?? null, modelCalls: producer?.modelCalls ?? 0, maxModelCalls,
        canRetry:state==='finished'&&Boolean(producer&&!producer.pending&&producer.modelCalls<maxModelCalls&&RETRYABLE.has(record?.result?.reason??'')),
        decisions: (producer?.decisions ?? []).slice(-5).map(item => ({ sequence: item.sequence, at: item.at, action: item.decision?.action,
          fighterIds: item.decision?.fighterIds ?? null, reason: item.decision?.reason, episode: item.decision?.episode ?? null,
          outcome: item.outcome ?? null, answeredModel: item.modelObservation?.answeredModel ?? null })) };
    },
    /** Stop every loop without recording an outcome; checkpoints stay for the next process. */
    async close() {
      closed = true;
      const running = [...active.values()];
      for (const entry of running) entry.controller.abort();
      await Promise.all(running.map(entry => entry.done));
    },
  };
}
