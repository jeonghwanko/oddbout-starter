import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {createCommerceStore} from '../api/commerce/store.mjs';
import {createPaidOperations} from '../api/commerce/paid-operations.mjs';
import {createCommerceService} from '../api/commerce/service.mjs';
import {taskInput,OWNER,proof} from './helpers/paid-operations.mjs';

// Opt-in native PostgreSQL: isolated loopback cluster, separate backend for EVERY RPC.
// PGlite remains the portable suite; this verifies row locks against simultaneous real connections.
test('native PostgreSQL connections race payment claims, duplicate credits, resume and completion',
  {skip:!process.env.ODDBOUT_TEST_POSTGRES_BIN,timeout:120000},async t=>{
  const bin=process.env.ODDBOUT_TEST_POSTGRES_BIN;
  const run=(name,args,input='')=>new Promise((resolve,reject)=>{
    const child=spawn(join(bin,name+(process.platform==='win32'?'.exe':'')),args,{windowsHide:true,stdio:name==='pg_ctl'?'ignore':['pipe','pipe','pipe']});
    let out='',err='';child.stdout?.on('data',v=>{out+=v;});child.stderr?.on('data',v=>{err+=v;});
    child.on('error',reject);child.on('close',code=>code===0?resolve(out):reject(new Error(`${name} (${code}): ${err}`)));child.stdin?.end(input);
  });
  await mkdir(resolve('output/paid-recovery-tests'),{recursive:true});
  const directory=await mkdtemp(resolve('output/paid-recovery-tests/postgres-'));
  const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  await run('initdb',['-D',directory,'-U','postgres','-A','trust','--no-locale','--encoding=UTF8']);
  await run('pg_ctl',['-D',directory,'-l',join(directory,'server.log'),'-o',`-h 127.0.0.1 -p ${port} -F`,'-w','start']);
  t.after(()=>run('pg_ctl',['-D',directory,'-m','fast','-w','stop']));
  const sql=statement=>run('psql',['-X','-qAt','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],statement);
  await sql('create role anon; create role authenticated; create role service_role bypassrls;');
  for(const file of ['20261102115107_commerce_broadcast_ledger.sql','20261104090000_commerce_payouts.sql','20261103131740_commerce_paid_operations.sql','20261103134354_commerce_paid_operation_recovery.sql','20261103143448_commerce_broadcast_operations.sql'])
    await sql(await readFile(new URL('../supabase/sandbox/'+file,import.meta.url),'utf8'));
  const literal=value=>value===null?'null':"'"+String(value).replaceAll("'","''")+"'";
  const store=createCommerceStore({rpc:async(name,args)=>{
    assert.ok(['commerce_command','commerce_operation','commerce_operation_recovery'].includes(name));
    try{const result=(await sql(`set role service_role; select public.${name}(${literal(args.p_owner)},${literal(args.p_command)},${literal(JSON.stringify(args.p_input))}::jsonb);`)).trim();return{data:result?JSON.parse(result):null,error:null};}
    catch(error){return{data:null,error};}
  }});
  const commerce=createCommerceService({store,paypal:null,publicOrigin:'https://example.test',hosts:[{id:'svl-mac-01'}]});
  const service=createPaidOperations({store,commerce,publicOrigin:'https://example.test'});
  const operation=await service.prepare(OWNER,taskInput());await service.approve(OWNER,operation.id);
  const funded=await store.operation(OWNER,'fund',{operationId:operation.id});
  const claims=await Promise.all(Array.from({length:12},()=>store.recovery(OWNER,'claim',{operationId:operation.id})));
  assert.equal(claims.filter(Boolean).length,1);
  await store.attachOrder(OWNER,funded.topupId,'CONCURRENTORDER');
  await Promise.all(Array.from({length:12},()=>store.creditCapture(OWNER,funded.topupId,{providerOrderId:'CONCURRENTORDER',captureId:'CONCURRENTCAPTURE',amountCents:1000,currency:'USD',status:'COMPLETED'})));
  assert.equal(Number((await store.wallet(OWNER)).balanceCredits),1000);
  const resumed=await Promise.all(Array.from({length:16},()=>service.resume(OWNER,operation.id)));
  assert.equal(new Set(resumed.map(x=>x.jobId)).size,1);assert.equal((await sql('select count(*) from commerce.jobs;')).trim(),'1');
  assert.equal(Number((await store.wallet(OWNER)).reservedCredits),25);
  const job=await store.claimJob('race-worker',{hostId:'svl-mac-01'});
  await Promise.all(Array.from({length:12},()=>store.completeJob('race-worker',{jobId:job.id,leaseToken:job.leaseToken,outcome:'succeeded',result:proof(job)})));
  const final=await service.get(OWNER,operation.id),wallet=await store.wallet(OWNER);
  assert.equal(final.state,'completed');assert.equal(Number(wallet.balanceCredits),975);assert.equal(Number(wallet.reservedCredits),0);
  assert.equal((await store.report(OWNER,final.broadcastId)).broadcast.status,'completed');
  const broadcasts=createPaidOperations({store,commerce,publicOrigin:'https://example.test',ensureProducer:()=>{}});
  const show=await broadcasts.prepareBroadcast(OWNER,taskInput({maxCredits:50}));await broadcasts.approve(OWNER,show.id,true);
  const recovered=await Promise.all(Array.from({length:16},()=>broadcasts.resume(OWNER,show.id)));
  assert.equal(new Set(recovered.map(x=>x.broadcastId)).size,1);assert.ok(recovered.every(x=>x.jobId===null));
  assert.equal(Number((await store.wallet(OWNER)).reservedCredits),50);
  assert.equal((await sql('select count(*) from commerce.broadcasts;')).trim(),'2');
  await commerce.stop(OWNER,recovered[0].broadcastId);
  assert.equal(Number((await store.wallet(OWNER)).reservedCredits),0);
});
