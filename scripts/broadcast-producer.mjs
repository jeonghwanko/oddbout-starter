#!/usr/bin/env node
// @ts-check
import { readFile, stat, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBroadcastProducer, createProducerMcp, createProducerModel } from '../broadcast/producer.mjs';

/** @param {string[]} argv */
export function parseProducerArgs(argv) {
  let broadcastId='';let statePath;let once=false;
  const seen=new Set();
  for(let n=0;n<argv.length;n++) {
    const key=argv[n];
    if(seen.has(key)) throw new Error('producer_invalid_arguments');seen.add(key);
    if(key==='--once'){once=true;continue;}
    if(!['--broadcast','--state'].includes(key))throw new Error('producer_invalid_arguments');
    const value=argv[++n];
    if(!value||value.startsWith('--')||/[\u0000-\u001f\u007f]/.test(value))throw new Error('producer_invalid_arguments');
    if(key==='--broadcast')broadcastId=value.toLowerCase();else statePath=value;
  }
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(broadcastId))throw new Error('producer_invalid_arguments');
  return {broadcastId,statePath:statePath??`.oddbout-broadcast/producer-${broadcastId}.json`,once};
}

/** @param {string} path @returns {Promise<import('../broadcast/producer.mjs').ProducerState|null>} */
async function loadState(path) {
  try {
    const info=await stat(path);if(!info.isFile()||info.size>2*1024*1024)throw new Error();
    return JSON.parse(await readFile(path,'utf8'));
  } catch(/** @type {any} */ error){if(error?.code==='ENOENT')return null;throw new Error('producer_invalid_state');}
}
/** @param {string} path @param {import('../broadcast/producer.mjs').ProducerState} state */
async function saveState(path,state) {
  const temporary=`${path}.${process.pid}.tmp`;
  const file=await open(temporary,'wx',0o600);
  try{await file.writeFile(JSON.stringify(state));await file.sync();}finally{await file.close();}
  await rename(temporary,path);
}

/** Explicit model/key and account-bound MCP access only; invoking this optional command
 * does not create a topup, approve/increase a budget, start a session, or start live output.
 * @param {string[]} argv
 * @param {{env?:Record<string,string|undefined>,onResult?:(result:any)=>void}} [options] */
export async function runBroadcastProducer(argv,{env=process.env,onResult=()=>{}}={}) {
  /** @type {import('../broadcast/producer.mjs').ProducerMcp|undefined} */let mcp;
  /** @type {import('node:fs/promises').FileHandle|undefined} */let lock;
  let lockPath;
  const controller=new AbortController();const stop=()=>controller.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try {
    const args=parseProducerArgs(argv);
    const model=env.ODDBOUT_BROADCAST_MODEL,apiKey=env.OPENAI_API_KEY,url=env.ODDBOUT_BROADCAST_MCP_URL,token=env.ODDBOUT_BROADCAST_MCP_TOKEN;
    if(!model||!apiKey||!url||!token)return {status:'unconfigured',reason:'producer_explicit_model_and_credentials_required'};
    const maxModelCalls=env.ODDBOUT_BROADCAST_MAX_MODEL_CALLS===undefined?24:Number(env.ODDBOUT_BROADCAST_MAX_MODEL_CALLS);
    const maxOutputTokens=env.ODDBOUT_BROADCAST_MAX_OUTPUT_TOKENS===undefined?600:Number(env.ODDBOUT_BROADCAST_MAX_OUTPUT_TOKENS);
    if(!Number.isSafeInteger(maxModelCalls)||maxModelCalls<1||maxModelCalls>100)return {status:'unconfigured',reason:'producer_invalid_call_limit'};
    const modelCall=createProducerModel({model,apiKey,maxOutputTokens});
    const path=resolve(args.statePath);await mkdir(dirname(path),{recursive:true,mode:0o700});lockPath=`${path}.lock`;
    try{lock=await open(lockPath,'wx',0o600);}catch{return {status:'unconfigured',reason:'producer_state_locked'};}
    await lock.writeFile(JSON.stringify({broadcastId:args.broadcastId,pid:process.pid,startedAt:new Date().toISOString()}));
    const state=await loadState(path);
    if(state&&(state.broadcastId!==args.broadcastId||state.model!==model||state.maxModelCalls!==maxModelCalls))return {status:'unconfigured',reason:'producer_state_scope_mismatch'};
    mcp=await createProducerMcp({url,token});
    const producer=createBroadcastProducer({broadcastId:args.broadcastId,model,mcp,modelCall,maxModelCalls,state,checkpoint:value=>saveState(path,value)});
    let last='';
    return args.once?await producer.step({signal:controller.signal}):await producer.run({signal:controller.signal,onResult:result=>{
      const key=JSON.stringify(result);if(key!==last){last=key;onResult(result);}
    }});
  } catch{return {status:'unconfigured',reason:'producer_configuration_or_connection_failed'};}
  finally {
    controller.abort();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
    await mcp?.close?.().catch(()=>{});
    if(lock){await lock.close().catch(()=>{});if(lockPath)await rm(lockPath,{force:true}).catch(()=>{});}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const report=await runBroadcastProducer(process.argv.slice(2),{onResult:result=>console.log(JSON.stringify(result))});
  console.log(JSON.stringify(report));process.exitCode=['queued','settled','waiting','stopped'].includes(report.status)?0:1;
}
