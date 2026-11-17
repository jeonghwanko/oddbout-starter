#!/usr/bin/env node
// @ts-check
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { copyTransferAssets } from './creator-account-transfer-assets.mjs';
import { checkedTransferQuery } from './creator-account-transfer-check.mjs';

// Operator CLI. Never edits auth identities or deletes users/files. Apply requires the reviewed snapshot saved by plan.
const [action, ...args] = process.argv.slice(2);
const project = process.env.SUPABASE_PROJECT_REF;
if (!project || !/^[a-z]{20}$/.test(project) || !['plan','apply'].includes(action ?? ''))
  throw Error('Set SUPABASE_PROJECT_REF. Usage: creator-account-transfer.mjs plan <source UUID> <target UUID> <private plan.json> | apply <private plan.json>');
const access = process.env.SUPABASE_ACCESS_TOKEN ?? (await readFile(join(homedir(),'.secret/supabase/access-token'),'utf8')).trim();
/** @param {string} path @param {RequestInit} [init] */
async function management(path,init={}) {
  const response=await fetch(`https://api.supabase.com/v1/projects/${project}/${path}`,{
    ...init,headers:{authorization:`Bearer ${access}`,'content-type':'application/json',...init.headers},signal:AbortSignal.timeout(120000),
  });
  if (!response.ok) throw Error(`Supabase management request failed (${response.status}); no response body or credentials logged.`);
  return response.json();
}
/** @param {string} query */
const sql=query=>management('database/query',{method:'POST',body:JSON.stringify({query})});
/** @param {unknown} value */
function uuid(value) {
  if(typeof value!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) throw Error('Invalid account UUID');
  return value;
}
/** @param {string} source @param {string} target */
const snapshot=async(source,target)=>(await sql(`select af_private.creator_transfer_snapshot('${uuid(source)}','${uuid(target)}') as snapshot`))[0].snapshot;
/** @param {any} plan */
const summary=plan=>({source:plan.source,target:plan.target,tokens:Number(plan.sourceTokens.balance)+Number(plan.targetTokens.balance),
  fighterLimit:plan.limit,objects:plan.objects.length,rows:Object.fromEntries(Object.entries(plan.rows).map(([name,rows])=>[name,/** @type {any[]} */(rows).length]))});
if(action==='plan') {
  const [source,target,file]=args;
  if(!file||args.length!==3) throw Error('plan requires source, target, private output file');
  const plan=await snapshot(uuid(source),uuid(target));
  await writeFile(file,JSON.stringify({version:1,project,snapshot:plan},null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'review-required',...summary(plan)}));
} else {
  if(args.length!==1||!args[0]) throw Error('apply requires the reviewed private plan file');
  const saved=JSON.parse(await readFile(args[0],'utf8'));
  if(saved.version!==1||saved.project!==project) throw Error('Wrong project or plan version');
  const plan=saved.snapshot;
  const current=(await sql(`with current_plan as materialized (select af_private.creator_transfer_snapshot('${uuid(plan.source)}','${uuid(plan.target)}') as snapshot)
    select snapshot, encode(sha256(convert_to(snapshot::text,'UTF8')),'hex') as fingerprint from current_plan`))[0];
  const applyQuery=checkedTransferQuery(plan,current);
  const keys=await management('api-keys'),service=keys.find(/** @param {any} k */k=>k.name==='service_role')?.api_key;
  if(typeof service!=='string') throw Error('Storage copy requires the project service role key');
  const headers={authorization:`Bearer ${service}`,apikey:service};
  /** @param {string} bucket @param {string} name */
  const objectUrl=(bucket,name)=>`https://${project}.supabase.co/storage/v1/object/${encodeURIComponent(bucket)}/${name.split('/').map(encodeURIComponent).join('/')}`;
  /** @param {string} bucket @param {string} name */
  async function bytes(bucket,name) {
    const response=await fetch(objectUrl(bucket,name),{headers,signal:AbortSignal.timeout(60000)});
    if(response.status===404) return null;
    if(response.status===400) {
      const body=await response.json().catch(()=>null);
      if(body?.statusCode==='404'||body?.error==='not_found') return null;
    }
    if(!response.ok) throw Error(`Storage read failed (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }
  const copied=await copyTransferAssets(plan,{read:bytes,copy:async(bucket,source,destination)=>{
      const response=await fetch(`https://${project}.supabase.co/storage/v1/object/copy`,{method:'POST',headers:{...headers,'content-type':'application/json'},
        body:JSON.stringify({bucketId:bucket,sourceKey:source,destinationKey:destination}),signal:AbortSignal.timeout(60000)});
      if(!response.ok) throw Error(`Asset copy failed (${response.status}); originals are untouched`);
  }});
  const result=await sql(applyQuery);
  if(result.length!==1) throw Error('Plan became stale. No account data was transferred; original files remain.');
  console.log(JSON.stringify({status:'assets-transferred',copied,...result[0].result,identityLink:'pending-user-oauth'}));
}
