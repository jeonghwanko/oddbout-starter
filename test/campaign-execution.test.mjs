import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {commerceDatabase} from './helpers/commerce-database.mjs';
import {createCampaignService} from '../api/commerce/campaigns.mjs';
import {createCampaignExecution} from '../api/commerce/campaign-execution.mjs';
import {createPayoutService} from '../api/commerce/payouts.mjs';
import {COMMERCE_CATALOG} from '../api/commerce/catalog.mjs';
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',HOST='svl-mac-01';
async function fixture(t){
  const f=await commerceDatabase();t.after(()=>f.db.close());
  for(const name of ['20261103154930_commerce_campaigns','20261103170232_commerce_campaign_links','20261103180002_commerce_campaign_schedule','20261103185105_commerce_campaign_execution','20261103193040_commerce_campaign_recovery'])await f.db.exec(await readFile(new URL('../supabase/sandbox/'+name+'.sql',import.meta.url),'utf8'));
  let sends=0,lose=false;const batches=new Map(),ensures=[];
  const payouts=createPayoutService({store:f.store,feeCents:1,receivers:Object.fromEntries(COMMERCE_CATALOG.fighters.map(id=>[id,id+'@personal.example.com'])),paypal:{
    async createPayout({senderBatchId}){if(!batches.has(senderBatchId)){sends++;batches.set(senderBatchId,'PAYOUT'+sends);}if(lose){lose=false;throw new Error('lost response');}return{payoutBatchId:batches.get(senderBatchId)};},
    async getPayout(){return{status:'SUCCESS'};}
  }});
  const reconciler={async run(owner,ids){return{checkedAt:new Date().toISOString(),source:'paypal-mcp',rows:ids.map(intentId=>({intentId,result:'matched'}))};}};
  const execution=createCampaignExecution({store:f.store,hostId:HOST,supervisor:{ensure:(...args)=>ensures.push(args),status:()=>({state:'running'})},payouts,reconciler});
  const service=createCampaignService({db:{rpc:f.rpc},execution,beforeStart:async()=>true,verifyMedia:async(owner,id,input)=>({...input,durationSeconds:3,bytes:1000,mimeType:'video/mp4',aiIntro:'Sponsor introduction.'}),signMedia:async()=>({videoUrl:'https://media.example/test.mp4'})});
  const fund=async(credits=1000)=>{const topup=await f.store.createTopup(OWNER,{requestKey:randomUUID(),amountCents:credits,credits,currency:'USD'});await f.store.attachOrder(OWNER,topup.id,'ORDER'+topup.id.slice(0,8));await f.store.creditCapture(OWNER,topup.id,{providerOrderId:'ORDER'+topup.id.slice(0,8),captureId:'CAPTURE'+topup.id.slice(0,8),amountCents:credits,currency:'USD',status:'COMPLETED'});return topup;};
  const ready=async()=>{const order=await service.purchase(OWNER,{requestKey:randomUUID(),productId:'spotlight-hour'});await service.saveMedia(OWNER,order.id,{requestKey:randomUUID(),videoPath:`campaigns/${order.id}/test.mp4`,targetUrl:'https://oddbout.com/'});return service.schedule(OWNER,order.id,{requestKey:randomUUID(),scheduledAt:new Date(Date.now()+60000).toISOString(),timezone:'Asia/Seoul',expectedRevision:0});};
  const start=order=>service.start(OWNER,order.id,{requestKey:randomUUID(),expectedRevision:order.scheduleRevision,expectedMediaId:order.mediaId});
  const enqueue=order=>f.store.enqueueCup(OWNER,{requestKey:randomUUID(),broadcastId:order.broadcastId,fighterIds:order.fighterIds,priceVersion:COMMERCE_CATALOG.version,priceCredits:25});
  const claim=()=>f.store.claimJob(HOST+':test',{hostId:HOST,leaseSeconds:90});
  const complete=async(job,outcome='succeeded')=>f.store.completeJob(HOST+':test',{jobId:job.id,leaseToken:job.leaseToken,outcome,result:outcome==='failed'?{reason:'test-failure'}:{protocolVersion:1,jobId:job.id,leaseToken:job.leaseToken,seed:job.seed,winnerId:job.fighterIds[0],bouts:[[0,1],[2,3],[0,2]].map(([a,b],i)=>({leftId:job.fighterIds[a],rightId:job.fighterIds[b],winnerId:job.fighterIds[a],winner:0,seed:(job.seed+i)>>>0,how:'decision',ms:100,hp:[1,0],contacts:[0,0],digest:'1234abcd'}))}});
  return{...f,service,execution,payouts,reconciler,ensures,fund,ready,start,enqueue,claim,complete,sends:()=>sends,lose:()=>{lose=true;}};
}
test('ticket → one prepaid session → verified job → funding reconciliation → one payout, including lost responses',async t=>{
  const f=await fixture(t);const funding=await f.fund(300),order=await f.ready();
  await assert.rejects(f.start(order),/campaign-host-offline/);await f.claim();
  const started=await f.start(order),again=await f.start(order);assert.equal(started.broadcastId,again.broadcastId);assert.equal(f.ensures.length,2);
  await f.execution.recover();assert.deepEqual(f.ensures[2],[OWNER,started.broadcastId]);
  assert.equal((await f.store.wallet(OWNER)).balanceCredits,0);assert.equal((await f.store.wallet(OWNER)).reservedCredits,0);
  await assert.rejects(f.execution.report(OTHER,order.id),/not-found/);
  await f.enqueue(started);const job=await f.claim();await f.complete(job);await f.complete(job);
  assert.equal((await f.store.wallet(OWNER)).balanceCredits,0);
  await assert.rejects(f.execution.reconcile(OWNER,order.id),/broadcast-not-finished/);
  await f.execution.stop(OWNER,order.id);
  await f.execution.recover();assert.equal(f.ensures.length,3);
  await assert.rejects(f.payouts.propose(OWNER,{broadcastId:started.broadcastId,requestKey:randomUUID()}),/campaign-settlement-required/);
  const settled=await f.execution.reconcile(OWNER,order.id);assert.equal(settled.settlement.status,'matched');assert.deepEqual(settled.funding.map(s=>[s.intentId,s.credits]),[[funding.id,300]]);
  const proposed=await f.execution.propose(OWNER,order.id,{requestKey:randomUUID()}),batch=proposed.payouts[0];assert.equal(batch.totalCents,4);
  f.lose();await assert.rejects(f.execution.pay(OWNER,order.id,{batchId:batch.id}),/lost response/);
  const paid=await f.execution.pay(OWNER,order.id,{batchId:batch.id});assert.equal(paid.payouts[0].status,'paid');assert.equal(f.sends(),1);
  await f.execution.pay(OWNER,order.id,{batchId:batch.id});assert.equal(f.sends(),1);
  const playback=await f.execution.playback(started.watchToken);assert.equal(playback.cups[0].id,job.id);
  const ledger=(await f.db.query("select kind,count(*)::int count from commerce.ledger group by kind order by kind")).rows;assert.deepEqual(ledger,[{kind:'reserve',count:1},{kind:'spend',count:1},{kind:'topup',count:1}]);
  assert.equal((await f.db.query('select count(*)::int count from commerce.ledger where broadcast_id=$1',[started.broadcastId])).rows[0].count,0);
  assert.equal((await f.db.query("select has_function_privilege('authenticated','public.commerce_campaign_execution(text,text,jsonb)','execute') allowed")).rows[0].allowed,false);
});
test('unknown execution retains its allowance and prevents payout; stopping never releases prepaid funds into the wallet',async t=>{
  const f=await fixture(t);await f.fund();const order=await f.ready();await f.claim();const started=await f.start(order);await f.enqueue(started);const job=await f.claim();
  await f.db.query("update commerce.jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1",[job.id]);
  const report=await f.execution.stop(OWNER,order.id);assert.equal(report.execution.broadcast.status,'stopping');assert.equal(report.execution.jobs[0].status,'unknown');
  assert.equal((await f.store.wallet(OWNER)).balanceCredits,700);assert.equal((await f.store.wallet(OWNER)).reservedCredits,0);
  await assert.rejects(f.execution.reconcile(OWNER,order.id),/broadcast-not-finished/);
  await f.store.releaseJob(job.id,'Confirmed failed test execution');assert.equal((await f.store.wallet(OWNER)).balanceCredits,700);
  await f.execution.reconcile(OWNER,order.id);await assert.rejects(f.execution.propose(OWNER,order.id,{requestKey:randomUUID()}),/nothing-to-pay/);
});
test('legacy metered sessions still charge once and FIFO funding spans the actual purchase sources',async t=>{
  const f=await fixture(t);const first=await f.fund(200),second=await f.fund(200);const order=await f.ready();await f.claim();const started=await f.start(order);
  const receipt=await f.execution.report(OWNER,order.id);assert.deepEqual(receipt.funding.map(s=>[s.intentId,s.credits]),[[first.id,200],[second.id,100]]);
  await f.execution.stop(OWNER,order.id);
  const approval=await f.store.approveBudget(OWNER,{requestKey:randomUUID(),hostId:HOST,channelId:'Legacy',endsAt:new Date(Date.now()+3600000).toISOString(),maxCredits:25,allowedTools:['host_cup'],fighterIds:order.fighterIds,priceVersion:COMMERCE_CATALOG.version});
  const legacy=await f.store.startBroadcast(OWNER,{requestKey:randomUUID(),approvalId:approval.id});
  assert.equal((await f.store.wallet(OWNER)).reservedCredits,25);
  await f.store.enqueueCup(OWNER,{requestKey:randomUUID(),broadcastId:legacy.id,fighterIds:order.fighterIds,priceVersion:COMMERCE_CATALOG.version,priceCredits:25});
  const job=await f.claim();await f.complete(job);await f.complete(job);await f.store.stopBroadcast(OWNER,legacy.id);
  const wallet=await f.store.wallet(OWNER);assert.equal(wallet.balanceCredits,75);assert.equal(wallet.reservedCredits,0);
  assert.equal((await f.execution.report(OWNER,order.id)).order.broadcastId,started.broadcastId);
});
test('expiry releases only the internal allowance; mismatches and refunds keep payouts blocked',async t=>{
  const f=await fixture(t),fund=await f.fund();const order=await f.ready();await f.claim();const started=await f.start(order);
  await f.enqueue(started);await f.complete(await f.claim());
  await f.db.query("update commerce.broadcasts set ends_at=clock_timestamp()-interval '1 second' where id=$1",[started.broadcastId]);
  const expired=await f.execution.report(OWNER,order.id);assert.equal(expired.execution.broadcast.status,'completed');assert.equal((await f.store.wallet(OWNER)).balanceCredits,700);assert.equal((await f.store.wallet(OWNER)).reservedCredits,0);
  const original=f.reconciler.run;f.reconciler.run=async(owner,ids)=>({checkedAt:new Date().toISOString(),source:'paypal-mcp',rows:ids.map(intentId=>({intentId,result:'mismatched'}))});
  assert.equal((await f.execution.reconcile(OWNER,order.id)).settlement.status,'needs_attention');
  await assert.rejects(f.execution.propose(OWNER,order.id,{requestKey:randomUUID()}),/campaign-settlement-required/);
  f.reconciler.run=original;await f.execution.reconcile(OWNER,order.id);const proposed=await f.execution.propose(OWNER,order.id,{requestKey:randomUUID()}),batch=proposed.payouts[0];
  await f.store.recordPaymentAdjustment({eventId:randomUUID(),eventType:'PAYMENT.CAPTURE.REFUNDED',captureId:'CAPTURE'+fund.id.slice(0,8)});
  await assert.rejects(f.execution.pay(OWNER,order.id,{batchId:batch.id}),/wallet-frozen/);assert.equal(f.sends(),0);
});
