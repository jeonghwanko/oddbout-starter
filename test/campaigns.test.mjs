import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createCampaignService,SPOTLIGHT_HOUR} from '../api/commerce/campaigns.mjs';
import {createCampaignHandler} from '../api/commerce/campaign-handler.mjs';
import {commerceDatabase} from './helpers/commerce-database.mjs';
import {OWNER,OTHER,ORIGIN} from './helpers/paid-operations.mjs';

const SQL=new URL('../supabase/sandbox/20261103154930_commerce_campaigns.sql',import.meta.url);
async function fixture(t,{credits=1000,ready=true,verified={}}={}){
  const f=await commerceDatabase();t.after(()=>f.db.close());await f.db.exec(await readFile(SQL,'utf8'));
  const rpc=async(name,args)=>{
    assert.equal(name,'commerce_campaign');
    try{return{data:await f.db.transaction(async tx=>{
      await tx.exec('set local role service_role');
      return(await tx.query('select public.commerce_campaign($1,$2,$3::jsonb) value',[args.p_owner,args.p_command,JSON.stringify(args.p_input)])).rows[0].value;
    }),error:null};}catch(error){return{data:null,error};}
  };
  let verifications=0,starts=0;
  const dependencies={db:{rpc},verifyMedia:async(owner,id,input)=>{
    verifications++;return{...input,durationSeconds:30,bytes:1000,mimeType:'video/mp4',aiIntro:'Meet our featured advertiser.',...verified};
  },beforeStart:async()=>{starts++;return ready;},signMedia:async(id,media)=>({videoUrl:`https://storage.example/${id}.mp4?signature=fixture`,expiresAt:new Date(Date.now()+3600000).toISOString()})};
  const service=createCampaignService(dependencies);
  const handler=createCampaignHandler({service,publicOrigin:ORIGIN,authenticate:async request=>request.headers.get('authorization')?.slice(7)??null,
    upload:async(owner,id,input)=>({uploadPath:`campaigns/${id}/test.mp4`})});
  const request=async(path,{body,owner=OWNER,origin=ORIGIN}={})=>{
    const response=await handler(new Request(`${ORIGIN}/campaigns/${path}`,{method:body===undefined?'GET':'POST',
      headers:{...(owner?{authorization:`Bearer ${owner}`} : {}),...(origin?{origin}:{}),...(body===undefined?{}:{'content-type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})}));return{status:response.status,...await response.json()};
  };
  if(credits){const topup=await f.store.createTopup(OWNER,{requestKey:randomUUID(),amountCents:1000,credits,currency:'USD'});
    await f.store.attachOrder(OWNER,topup.id,'FUNDORDER');await f.store.creditCapture(OWNER,topup.id,{providerOrderId:'FUNDORDER',captureId:'FUNDCAPTURE',amountCents:1000,currency:'USD',status:'COMPLETED'});}
  const purchase=()=>({requestKey:randomUUID(),productId:'spotlight-hour'});
  const media=id=>({requestKey:randomUUID(),videoPath:`campaigns/${id}/ad.mp4`,targetUrl:'https://advertiser.example/offer'});
  return{...f,rpc,service,dependencies,request,purchase,media,verifications:()=>verifications,starts:()=>starts};
}

test('campaign purchase debits flat300 once, persists the random SS lineup and rejects customer pricing/host/lineup fields',async t=>{
  const f=await fixture(t),input=f.purchase();
  const purchases=await Promise.all(Array.from({length:12},()=>f.service.purchase(OWNER,input))),order=purchases[0];
  assert.ok(purchases.every(item=>item.id===order.id&&JSON.stringify(item.fighterIds)===JSON.stringify(order.fighterIds)));
  assert.equal(order.status,'awaiting_media');assert.equal(order.priceCredits,300);assert.equal(order.durationSeconds,3600);
  assert.equal(order.watchToken,null);assert.equal(order.fighterIds.length,4);assert.equal(new Set(order.fighterIds).size,4);
  assert.ok(order.fighterIds.every(id=>SPOTLIGHT_HOUR.fighterPool.includes(id)));assert.equal(order.fighterTier,'SS');
  assert.equal((await f.store.wallet(OWNER)).balanceCredits,700);assert.equal((await f.store.wallet(OWNER)).reservedCredits,0);
  const counts=(await f.db.query("select (select count(*)::int from commerce.campaign_orders) orders,(select count(*)::int from commerce.ledger where kind='spend') spends,(select count(*)::int from commerce.jobs) jobs")).rows[0];
  assert.deepEqual(counts,{orders:1,spends:1,jobs:0});
  for(const spoof of [{priceCredits:1},{hostId:'hacked'},{fighterIds:['kuma']},{name:'customer name'},{budget:1}]){
    await assert.rejects(async()=>f.service.purchase(OWNER,{...input,...spoof}),/invalid-input/);
  }
  const tampered=await f.rpc('commerce_campaign',{p_owner:OWNER,p_command:'purchase',p_input:{...input,priceCredits:1}});
  assert.match(tampered.error.message,/invalid-input/);
  assert.equal((await f.store.wallet(OWNER)).balanceCredits,700);
});

test('racing distinct purchases cannot overspend; insufficient funds create no purchased order and same key retries after funding',async t=>{
  const f=await fixture(t,{credits:300});
  const results=await Promise.allSettled(Array.from({length:8},()=>f.service.purchase(OWNER,f.purchase())));
  assert.equal(results.filter(item=>item.status==='fulfilled').length,1);
  assert.ok(results.filter(item=>item.status==='rejected').every(item=>item.reason.status===402));
  assert.equal((await f.store.wallet(OWNER)).balanceCredits,0);
  assert.equal((await f.db.query('select count(*)::int n from commerce.campaign_orders')).rows[0].n,1);
  const pending=f.purchase(),failed=await f.request('orders',{body:{...pending,confirmed:true}});
  assert.equal(failed.status,402);assert.equal(failed.code,'insufficient-credits');
  const topup=await f.store.createTopup(OWNER,{requestKey:randomUUID(),amountCents:1000,credits:300,currency:'USD'});
  await f.store.attachOrder(OWNER,topup.id,'NEWFUNDS');await f.store.creditCapture(OWNER,topup.id,{providerOrderId:'NEWFUNDS',captureId:'NEWCAPTURE',amountCents:1000,currency:'USD',status:'COMPLETED'});
  const retried=await f.request('orders',{body:{...pending,confirmed:true}});assert.equal(retried.status,200);
  assert.equal((await f.service.purchase(OWNER,pending)).id,retried.data.id);
});

test('My broadcasts is private, paginated and owner-scoped; consent and upload boundaries cannot be bypassed',async t=>{
  const f=await fixture(t),first=await f.service.purchase(OWNER,f.purchase()),second=await f.service.purchase(OWNER,f.purchase());
  const page=await f.service.list(OWNER,{limit:1});assert.equal(page.items[0].id,second.id);assert.equal(page.hasMore,true);
  assert.equal((await f.service.list(OWNER,{limit:1,cursor:page.nextCursor})).items[0].id,first.id);
  assert.equal((await f.request('orders',{owner:OTHER})).data.items.length,0);
  assert.equal((await f.request(`orders/${first.id}`,{owner:OTHER})).status,404);
  assert.equal((await f.request(`orders/${first.id}/upload`,{owner:OTHER,body:{fileName:'ad.mp4'}})).status,404);
  assert.equal((await f.request('orders',{owner:null})).status,401);
  assert.equal((await f.request('orders',{body:f.purchase()})).status,403);
  assert.equal((await f.request('orders',{body:{...f.purchase(),confirmed:true},origin:null})).status,403);
  await assert.rejects(f.db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query('select public.commerce_campaign($1,$2,$3)',[OWNER,'list','{}']);}),/permission denied/);
});

test('actual verified media is required; repeated submit reuses saved AI intro without a second verification and Start stays explicit',async t=>{
  const f=await fixture(t),order=await f.service.purchase(OWNER,f.purchase()),media=f.media(order.id);
  await assert.rejects(f.service.start(OWNER,order.id,{requestKey:randomUUID()}),/campaign-media-required/);
  await assert.rejects(f.service.saveMedia(OWNER,order.id,{...media,aiIntro:'client invented intro'}),/invalid-input/);
  await assert.rejects(f.service.saveMedia(OTHER,order.id,media),/not-found/);
  await assert.rejects(f.service.saveMedia(OWNER,order.id,{...media,videoPath:`campaigns/${randomUUID()}/ad.mp4`}),/invalid-media-path/);
  const ready=await f.service.saveMedia(OWNER,order.id,media);assert.equal(ready.status,'ready');assert.equal(ready.startedAt,null);
  assert.equal(ready.media.aiIntro,'Meet our featured advertiser.');assert.equal(f.verifications(),1);
  assert.deepEqual(await f.service.saveMedia(OWNER,order.id,media),ready);assert.equal(f.verifications(),1);
  await assert.rejects(f.service.saveMedia(OWNER,order.id,{...media,targetUrl:'https://changed.example/'}),/idempotency-conflict/);
  assert.equal((await f.service.preview(OWNER,order.id)).videoUrl.includes('signature=fixture'),true);
  const startKey=randomUUID(),started=await f.service.start(OWNER,order.id,{requestKey:startKey});
  assert.equal(started.status,'started');assert.equal(started.playbackStatus,'unverified');assert.match(started.watchToken,/^[a-f0-9]{64}$/);
  assert.deepEqual(await f.service.start(OWNER,order.id,{requestKey:startKey}),started);assert.equal(f.starts(),1);
  assert.equal((await f.service.saveMedia(OWNER,order.id,media)).media.aiIntro,ready.media.aiIntro);assert.equal(f.verifications(),1);
  await assert.rejects(f.service.saveMedia(OWNER,order.id,{...media,requestKey:randomUUID()}),/campaign-already-started/);
  await f.db.query("update commerce.campaign_orders set started_at=clock_timestamp()-interval '2 hours' where id=$1",[order.id]);
  const afterElapsed=await f.service.get(OWNER,order.id);assert.equal(afterElapsed.status,'started');assert.equal(afterElapsed.playbackStatus,'unverified');
  assert.equal((await f.store.wallet(OWNER)).balanceCredits,700);
});

test('media signing/readiness failure cannot publish, and public capability manifests reveal no private account or storage path',async t=>{
  const f=await fixture(t,{ready:false}),order=await f.service.purchase(OWNER,f.purchase());
  const raw=(await f.db.query('select watch_token from commerce.campaign_orders where id=$1',[order.id])).rows[0];
  await assert.rejects(f.service.manifest(raw.watch_token),/not-found/);
  await f.service.saveMedia(OWNER,order.id,f.media(order.id));
  await assert.rejects(f.service.start(OWNER,order.id,{requestKey:randomUUID()}),/campaign-playback-unavailable/);
  assert.equal((await f.service.get(OWNER,order.id)).status,'ready');
  const configured=createCampaignService({...f.dependencies,beforeStart:async()=>true});
  const started=await configured.start(OWNER,order.id,{requestKey:randomUUID()}),manifest=await configured.manifest(started.watchToken);
  assert.equal(manifest.program.reduce((sum,slot)=>sum+slot.durationSeconds,0),3600);
  assert.equal(manifest.program.filter(slot=>slot.type==='advertisement').reduce((sum,slot)=>sum+slot.durationSeconds,0),600);
  assert.equal(manifest.program[2].startSeconds,1800);assert.ok(Number.isSafeInteger(manifest.programSeed));
  assert.ok(Number.isFinite(Date.parse(manifest.serverNow)));assert.equal(manifest.playbackStatus,'unverified');
  assert.equal(manifest.media.targetUrl,'https://advertiser.example/offer');
  assert.ok(!JSON.stringify(manifest).includes(OWNER));assert.ok(!JSON.stringify(manifest).includes('videoPath'));assert.ok(!JSON.stringify(manifest).includes('requestKey'));
  assert.equal((await f.request(`watch/${started.watchToken}`,{owner:null})).status,200);
  assert.equal((await f.request('watch/'+'a'.repeat(64),{owner:null})).status,404);
});

test('unverified media and oversized or non-MP4 results cannot move a paid order to ready',async t=>{
  const f=await fixture(t),order=await f.service.purchase(OWNER,f.purchase());
  const noMedia=createCampaignService({db:f.dependencies.db});
  await assert.rejects(noMedia.saveMedia(OWNER,order.id,f.media(order.id)),/campaign-media-verification-unavailable/);
  for(const changed of [{bytes:52428801},{mimeType:'video/webm'},{durationSeconds:301},{aiIntro:''}]){
    const invalid=createCampaignService({...f.dependencies,verifyMedia:async(owner,id,input)=>({...input,durationSeconds:30,bytes:100,mimeType:'video/mp4',aiIntro:'Intro',...changed})});
    await assert.rejects(invalid.saveMedia(OWNER,order.id,f.media(order.id)),/invalid-verified-media/);
  }
  assert.equal((await f.service.get(OWNER,order.id)).status,'awaiting_media');
});

test('one, two and three hour products keep immutable server prices, one lineup and ten ad minutes per hour',async t=>{
  const f=await fixture(t,{credits:2000}),catalog=(await f.request('catalog',{owner:null})).data;
  assert.equal(catalog.defaultProductId,'spotlight-hour');
  assert.deepEqual(catalog.products.map(item=>[item.id,item.priceCredits,item.durationSeconds,item.adSeconds]),[
    ['spotlight-hour',300,3600,600],['spotlight-2h',600,7200,1200],['spotlight-3h',900,10800,1800],
  ]);
  for(const product of catalog.products.slice(1)){
    const requestKey=randomUUID(),input={requestKey,productId:product.id};
    const order=await f.service.purchase(OWNER,input);
    assert.equal(order.priceCredits,product.priceCredits);assert.equal(order.durationSeconds,product.durationSeconds);
    assert.equal(order.fighterIds.length,4);assert.equal(order.adSlots.length,product.durationSeconds/1800);
    assert.deepEqual(order.adSlots.map(slot=>slot.startSeconds),Array.from({length:product.durationSeconds/1800},(_,index)=>index*1800));
    assert.equal((await f.service.purchase(OWNER,input)).id,order.id);
    await assert.rejects(f.service.purchase(OWNER,{...input,productId:'spotlight-hour'}),/idempotency-conflict/);
    await f.service.saveMedia(OWNER,order.id,f.media(order.id));
    const started=await f.service.start(OWNER,order.id,{requestKey:randomUUID()}),manifest=await f.service.manifest(started.watchToken);
    assert.deepEqual(manifest.fighterIds,order.fighterIds);
    assert.equal(manifest.program.reduce((sum,slot)=>sum+slot.durationSeconds,0),product.durationSeconds);
    assert.equal(manifest.program.filter(slot=>slot.type==='advertisement').reduce((sum,slot)=>sum+slot.durationSeconds,0),product.adSeconds);
  }
  assert.equal((await f.store.wallet(OWNER)).balanceCredits,500);
  const spends=(await f.db.query("select balance_delta from commerce.ledger where kind='spend' order by balance_delta")).rows.map(row=>Number(row.balance_delta));
  assert.deepEqual(spends,[-900,-600]);assert.equal((await f.store.wallet(OWNER)).reservedCredits,0);
});

test('media submit shares in-flight verification and endpoint mutation/upload caps return429',async t=>{
  const f=await fixture(t),order=await f.service.purchase(OWNER,f.purchase()),media=f.media(order.id);
  const saved=await Promise.all(Array.from({length:8},()=>f.service.saveMedia(OWNER,order.id,media)));
  assert.ok(saved.every(item=>item.id===order.id));assert.equal(f.verifications(),1);
  for(let index=0;index<2;index++)assert.equal((await f.request(`orders/${order.id}/media`,{body:{...media,confirmed:true}})).status,200);
  assert.equal((await f.request(`orders/${order.id}/media`,{body:{...media,confirmed:true}})).status,429);
  for(let index=0;index<5;index++)assert.equal((await f.request(`orders/${order.id}/upload`,{body:{fileName:'ad.mp4'}})).status,200);
  assert.equal((await f.request(`orders/${order.id}/upload`,{body:{fileName:'ad.mp4'}})).status,429);
});
