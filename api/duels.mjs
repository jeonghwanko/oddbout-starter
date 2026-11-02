// @ts-check
import { Problem, UUID, jsonResponse, logFailure, readBody, rpcProblem, sha256 } from './http.mjs';
import { parseFighterJson, validateFighter } from '../contracts/ai-fighter/validate.mjs';
import { CLIENT_LIMITS } from './client-limit.mjs';
const CORS = {methods:'GET, POST, OPTIONS',headers:'Content-Type'};
/** @type {(body: any, status?: number) => Response} */
const reply = (body,status=200) => jsonResponse(body,status,CORS);
/**
 * An af_duels row, as the table or a duel function returns it. `result` is the engine's record of the bout, null until it completes.
 * @typedef {{ id: string, a: string, b: string, hash_a: string, hash_b: string, seed: number, engine: string, created_at: string,
 *   completed_at: string | null, result: unknown }} DuelRow
 */
/** @type {(row: DuelRow) => object} */
const present = row => ({id:row.id,a:row.a,b:row.b,hashes:[row.hash_a,row.hash_b],seed:row.seed,engine:row.engine,
  createdAt:row.created_at,completedAt:row.completed_at,result:row.result});
const DUEL_STATUS = Object.freeze({'idempotency-conflict':409,'duel-not-approved':409,'duels-paused':503,'duel-budget':429,
  'invalid-duel':422,'not-found':404,'engine-mismatch':409,'result-conflict':409,'duels-failing':503,'invalid-result':503});
/** @param {{ message: string } | null} error  A database call's error, if any. */
function check(error) { if (error) throw rpcProblem(error,DUEL_STATUS,{unavailable:'duel-service-unavailable'}); }
const ENGINE_NAME = /^[a-z0-9][a-z0-9.-]{0,63}$/;
/**
 * Guest-triggered, server-computed matches. No client result or seed is accepted. All DB access stays service-only.
 * `engines` (2026-10-26): earlier engines kept by name beside the current one (`engines/<name>.mjs`, written by the game's Edge deploy).
 * A page names the engine it replays with (`POST duels?engine=<name>`), so a page still on the previous engine plays that engine and the
 * site and this function need no shared release moment. A name not kept, or none, plays the current engine.
 * `release` (2026-10-26): the deployed release's name (`release.mjs`, written by the game's Edge deploy), told by `GET rankings` so the deploy
 * sees its own upload answer — a change to this handler alone moves no engine name.
 */
/**
 * @param {{ db: any, simulateDuel: any, engineVersion: any, engines?: any, release?: any, limiter?: import('./http.mjs').Limiter | null }} options
 * @returns {import('./http.mjs').Route}
 */
export function createDuelHandler({db,simulateDuel,engineVersion,engines=null,release=null,limiter=null}) {
  const kept=new Map(Object.entries(engines??{}).filter(([name,run])=>ENGINE_NAME.test(name) && typeof run==='function' && name!==engineVersion));
  /** @type {(request: Request) => [string | null, unknown]} The engine's name and its run function, which the caller checks. */
  const pick=request=>{ const wanted=new URL(request.url).searchParams.get('engine');
    return wanted && kept.has(wanted) ? [wanted,kept.get(wanted)] : [engineVersion,simulateDuel]; };
  /** @type {(name: string, args: Record<string, unknown>) => Promise<any>} */
  const rpc = async (name,args) => { const {data,error}=await db.rpc(name,args); check(error); return data; };
  /** @param {string} id @param {string} hash */
  async function manifest(id,hash) {
    const {data:f,error:e}=await db.from('af_fighters').select('submission_id').eq('id',id).maybeSingle(); check(e);
    if (!f) throw new Problem(404,'not-found');
    const {data:s,error}=await db.from('af_submissions').select('manifest_text,manifest_sha').eq('id',f.submission_id).eq('status','registered').maybeSingle(); check(error);
    if (!s || s.manifest_sha!==hash || await sha256(new TextEncoder().encode(s.manifest_text))!==hash) throw new Problem(409,'package-mismatch');
    const parsed=parseFighterJson(s.manifest_text);
    if (!parsed.ok || !validateFighter(parsed.data).ok) throw new Problem(409,'package-invalid');
    return parsed.data;
  }
  /** The ranking rows with each fighter's per-language names (contract profile.names) where he has them. */
  async function rankings() {
    // One query: the ranking carries each fighter's per-language names (2026-10-29), shown only when he has them.
    /** @type {{ id: string, names: Record<string, string> | null }[]} Each fighter's ranking row; its other fields pass through. */
    const rows=await rpc('af_duel_rankings',{});
    return rows.map(({names,...row})=>names?{...row,names}:row);
  }
  return async (request,parts) => {
    try {
      if (request.method==='OPTIONS') return reply({ok:true});
      if (request.method==='GET' && parts.join('/')==='rankings') return reply({ok:true,rankings:await rankings(),engine:engineVersion,engines:[engineVersion,...kept.keys()].filter(Boolean),release});
      if (request.method==='GET' && parts.length===2 && parts[0]==='duels' && UUID.test(parts[1])) {
        const {data,error}=await db.from('af_duels').select('*').eq('id',parts[1]).not('completed_at','is',null).maybeSingle(); check(error);
        if (!data) throw new Problem(404,'not-found'); return reply({ok:true,match:present(data)});
      }
      if (request.method!=='POST' || parts.join('/')!=='duels') throw new Problem(404,'not-found');
      const [engine,run]=pick(request);
      if (typeof run!=='function' || !engine) throw new Problem(503,'duel-engine-unavailable');
      let body; try { body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBody(request,2048))); }
      catch(e) { if(e instanceof Problem) throw e; throw new Problem(422,'invalid-duel'); }
      if (!body || Object.keys(body).sort().join(',')!=='a,b,idempotencyKey' || ![body.a,body.b,body.idempotencyKey].every(x=>typeof x==='string' && UUID.test(x)) || body.a===body.b)
        throw new Problem(422,'invalid-duel');
      // Guests need no account, so one caller is braked by a keyed hash of their address (api/client-limit.mjs).
      const {bucket,limit,windowSeconds}=CLIENT_LIMITS.duel;
      if (limiter && !await limiter.allow(request,bucket,limit,windowSeconds)) throw new Problem(429,'rate-limit');
      const row=await rpc('af_reserve_duel',{p_key:body.idempotencyKey,p_a:body.a,p_b:body.b,p_engine:engine});
      if (row.result) return reply({ok:true,match:present(row)});
      if(row.engine!==engine) throw new Problem(409,'engine-mismatch');
      // A run that cannot finish is recorded as failed: it leaves the match budget and counts toward the failure brake.
      /** @type {(code: string) => Promise<void>} */
      const fail = code => db.rpc('af_fail_duel',{p_id:row.id,p_engine:engine,p_code:code}).then(()=>{},()=>{});
      let result;
      try {
        const [ma,mb]=await Promise.all([manifest(row.a,row.hash_a),manifest(row.b,row.hash_b)]);
        result=await run(row.a,ma,row.b,mb,row.seed);
      } catch(e) {
        await fail(e instanceof Problem ? e.message : 'engine-error');
        throw e instanceof Problem ? e : Object.assign(new Problem(503,'duel-engine-failed'),{cause:e});
      }
      let completed;
      try { completed=await rpc('af_complete_duel',{p_id:row.id,p_engine:engine,p_result:result}); }
      catch(e) { if (e instanceof Problem && ['invalid-result','duel-not-approved'].includes(e.message)) await fail(e.message); throw e; }
      return reply({ok:true,match:present(completed)});
    } catch(e) { logFailure('duels',request,e); return reply({ok:false,code:e instanceof Problem ? e.message:'duel-service-unavailable'},e instanceof Problem ? e.status:503); }
  };
}
