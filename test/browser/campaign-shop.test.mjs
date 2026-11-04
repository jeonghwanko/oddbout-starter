import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createBroadcastDemo} from '../../scripts/broadcast-demo.mjs';
import {createCampaignService} from '../../api/commerce/campaigns.mjs';
import {createCampaignMedia,inspectCampaignMp4} from '../../api/commerce/campaign-media.mjs';
import {createCampaignHandler} from '../../api/commerce/campaign-handler.mjs';
import {createCommerceHandler} from '../../api/commerce/handler.mjs';
import {createCampaignExecution} from '../../api/commerce/campaign-execution.mjs';
import {createPayoutService} from '../../api/commerce/payouts.mjs';
import {COMMERCE_CATALOG} from '../../api/commerce/catalog.mjs';
import {paidFixture,OWNER,OTHER} from '../helpers/paid-operations.mjs';

const ORIGIN='http://127.0.0.1:5197';
for(const sourceKind of ['upload','youtube','twitch'])test(`broadcast purchase, recover, publish and scheduled playback: ${sourceKind}`,{timeout:90000},async t=>{
  const f=await paidFixture(t);await f.db.exec(await readFile(new URL('../../supabase/sandbox/20261103154930_commerce_campaigns.sql',import.meta.url),'utf8'));
  await f.db.exec(await readFile(new URL('../../supabase/sandbox/20261103170232_commerce_campaign_links.sql',import.meta.url),'utf8'));
  await f.db.exec(await readFile(new URL('../../supabase/sandbox/20261103180002_commerce_campaign_schedule.sql',import.meta.url),'utf8'));
  await f.db.exec(await readFile(new URL('../../supabase/sandbox/20261103185105_commerce_campaign_execution.sql',import.meta.url),'utf8'));
  await f.db.exec(await readFile(new URL('../../supabase/sandbox/20261103193040_commerce_campaign_recovery.sql',import.meta.url),'utf8'));
  const topup=await f.store.createTopup(OWNER,{requestKey:randomUUID(),amountCents:1000,credits:1000,currency:'USD'});
  await f.store.attachOrder(OWNER,topup.id,'EXISTING');await f.store.creditCapture(OWNER,topup.id,{providerOrderId:'EXISTING',captureId:'CREDIT',amountCents:1000,currency:'USD',status:'COMPLETED'});
  const rpc=async(name,args)=>{try{return{data:await f.db.transaction(async tx=>{await tx.exec('set local role service_role');
    if(name==='commerce_campaign_link')return(await tx.query('select public.commerce_campaign_link($1,$2,$3,$4::jsonb) value',[args.p_owner,args.p_order_id,args.p_request_key,JSON.stringify(args.p_input)])).rows[0].value;
    if(name==='commerce_campaign_planning')return(await tx.query('select public.commerce_campaign_planning($1,$2,$3::jsonb) value',[args.p_owner,args.p_command,JSON.stringify(args.p_input)])).rows[0].value;
    return(await tx.query('select public.commerce_campaign($1,$2,$3::jsonb) value',[args.p_owner,args.p_command,JSON.stringify(args.p_input)])).rows[0].value;}),error:null};}catch(error){return{data:null,error};}};
  const files=new Map(),storage={createSignedUploadUrl:async path=>({data:{path,token:'fixture-upload',signedUrl:'https://storage.fixture/'+path}}),
    info:async path=>files.has(path)?{data:{metadata:{size:files.get(path).length}}}:{error:'missing'},
    createSignedUrl:async path=>({data:{signedUrl:'https://storage.fixture/'+path}})};
  const media=createCampaignMedia({db:{storage:{from:()=>storage}},modelCall:async()=>({output:[{type:'message',content:[{type:'output_text',text:'This is a paid sponsor break. Watch this clip from oddbout.com and follow the sponsor link to learn more.'}]}],observation:{}}),
    fetchImpl:async url=>String(url).includes('spotlight.html')?new Response('spotlight-player.mjs'):new Response(files.get(new URL(url).pathname.slice(1)))});
  const payouts=createPayoutService({store:f.store,feeCents:1,receivers:Object.fromEntries(COMMERCE_CATALOG.fighters.map(id=>[id,id+'@personal.example.com'])),paypal:{createPayout:async()=>({payoutBatchId:'BROWSER_PAYOUT'}),getPayout:async()=>({status:'SUCCESS'})}});
  const execution=createCampaignExecution({store:f.store,hostId:'svl-mac-01',payouts,supervisor:{ensure(){},status:()=>({state:'running'})},reconciler:{run:async(owner,ids)=>({checkedAt:new Date().toISOString(),source:'paypal-mcp',rows:ids.map(intentId=>({intentId,result:'matched'}))})}});
  await f.store.claimJob('svl-mac-01:browser',{hostId:'svl-mac-01',leaseSeconds:90});
  const service=createCampaignService({db:{rpc},...media,...(sourceKind==='upload'?{execution}:{})});
  const authenticate=async req=>req.headers.get('authorization')?.replace('Bearer fixture-','')??null;
  const campaign=createCampaignHandler({service,authenticate,publicOrigin:ORIGIN,upload:async(owner,id,input)=>media.upload(id,input)});
  const commerce=createCommerceHandler({service:f.commerce,authenticate,publicOrigin:ORIGIN});
  const{server}=createBroadcastDemo({ODDBOUT_BROADCAST_PORT:'5197',SUPABASE_URL:'https://storage.fixture'});await new Promise(r=>server.listen(5197,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1280,height:900}}),errors=[];
  await context.route('**/broadcast/config',r=>r.fulfill({json:{authConfigured:true,campaigns:true,commerceEnabled:true,supabaseUrl:'https://fixture.example',publishableKey:'fixture'}}));
  await context.route('**/broadcast/supabase.js',r=>r.fulfill({contentType:'text/javascript',body:`let owner='${OWNER}',changed;const value=()=>({access_token:'fixture-'+owner,user:{id:owner,email:'owner@example.test'}});globalThis.testAccount=id=>{owner=id;changed('SIGNED_IN',value())};globalThis.supabase={createClient(){return{auth:{onAuthStateChange(fn){changed=fn},async getSession(){return{data:{session:value()}}},async signOut(){changed('SIGNED_OUT',null);return{}}},storage:{from(){return{async uploadToSignedUrl(path,token,file){const r=await fetch('/fixture/upload?path='+encodeURIComponent(path),{method:'PUT',body:file});return r.ok?{}:{error:new Error('upload failed')}}}}}}}};`}));
  await context.route('**/fixture/upload?*',async r=>{files.set(new URL(r.request().url()).searchParams.get('path'),r.request().postDataBuffer());await r.fulfill({status:200,body:'{}'});});
  await context.route('https://storage.fixture/**',r=>r.fulfill({contentType:'video/mp4',body:files.get(new URL(r.request().url()).pathname.slice(1))}));
  // Exercise our iframe lifecycle independently of third-party availability or playback.
  for(const pattern of ['https://www.youtube-nocookie.com/**','https://clips.twitch.tv/**','https://player.twitch.tv/**','https://oddbout-broadcast-arena.onrender.com/**'])await context.route(pattern,r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Player fixture</title><p>Embedded player fixture</p>'}));
  let losePurchase=true,loseLink=true,loseSchedule=true;
  for(const[pattern,handler]of[[ORIGIN+'/campaigns/**',campaign],[ORIGIN+'/commerce/**',commerce]])await context.route(pattern,async r=>{
    const req=r.request(),res=await handler(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}: {})}));
    if(losePurchase&&req.method()==='POST'&&new URL(req.url()).pathname==='/campaigns/orders'){losePurchase=false;await r.abort('failed');return;}
    if(loseLink&&req.method()==='POST'&&new URL(req.url()).pathname.endsWith('/link')){loseLink=false;await r.abort('failed');return;}
    if(loseSchedule&&req.method()==='POST'&&new URL(req.url()).pathname.endsWith('/schedule')){loseSchedule=false;await r.abort('failed');return;}
    await r.fulfill({status:res.status,contentType:'application/json',body:await res.text()});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(ORIGIN+'/broadcast/');await page.locator('#signout').waitFor();
  assert.equal(await page.locator('[data-campaign-product-id]').count(),3);
  assert.doesNotMatch(await page.locator('body').innerText(),/Run the ring|Set up your show|Session name|Credit limit|Broadcast host/);
  await page.waitForFunction(()=>document.getElementById('wallet-available').textContent==='1,000');
  assert.ok((await page.locator('#wallet').boundingBox()).y<(await page.locator('#spotlight').boundingBox()).y);
  await page.locator('#add-credits').click();await page.locator('#credit-packs').waitFor();
  await page.locator('#add-credits').click();assert.equal(await page.locator('#credit-options').isVisible(),false);
  const buyThree=page.locator('[data-campaign-product-id="spotlight-3h"]').getByRole('button');
  assert.match(await buyThree.getAttribute('aria-label'),/900/);
  await buyThree.click();await page.getByText(/purchase result is not confirmed/i).waitFor();
  assert.equal(await page.locator('[data-buy-product-id="spotlight-hour"]').isDisabled(),true);
  assert.equal(await buyThree.innerText(),'BUY');
  await buyThree.click();await page.locator('#media-file').waitFor();
  const[order]=(await service.list(OWNER)).items;assert.equal(order.priceCredits,900);assert.equal((await f.store.wallet(OWNER)).balanceCredits,100);
  assert.equal((await service.list(OWNER)).items.length,1);const lineup=order.fighterIds;
  const videoPath=fileURLToPath(new URL('../fixtures/campaign-sponsor.mp4',import.meta.url));
  assert.equal(inspectCampaignMp4(await readFile(videoPath)).durationSeconds,3);
  await page.locator('#destination-url').fill('https://oddbout.com/');
  if(sourceKind==='upload'){
    await page.locator('#media-file').setInputFiles(videoPath);await page.locator('#media-upload').click();
  }else{
    await page.locator('#choose-link').click();await page.locator('#media-link').fill('https://example.test/not-video');
    assert.equal(await page.locator('#preview-link').isDisabled(),true);
    const link=sourceKind==='youtube'?'https://youtu.be/M7lc1UVf-VE':'https://clips.twitch.tv/IncredulousAbstemiousFennelImGlitch';
    await page.locator('#media-link').fill(link);assert.equal(await page.locator('#save-link').isDisabled(),true);
    await page.locator('#preview-link').click();await page.locator('#external-preview iframe').waitFor();
    await page.locator('#save-link').click();await page.getByText('The save result is unknown. Retry the same link and destination.').waitFor();
    await page.locator('#save-link').click();
  }
  await page.locator('#save-schedule').waitFor();
  assert.equal(await page.locator('#publish-broadcast').isVisible(),false);
  await page.locator('#save-schedule').click();await page.getByText('Save not confirmed. Retry the same date; your ticket is unchanged.').waitFor();
  await page.locator('#save-schedule').click();await page.locator('#open-host').waitFor();
  assert.equal((await service.get(OWNER,order.id)).startedAt,null);
  await page.locator('#calendar-agenda').getByRole('link',{name:'On-Air Agent →'}).waitFor();
  await page.locator('#open-host').click();await page.locator('#publish-consent').waitFor();
  assert.equal(await page.locator('#host-heading').isVisible(),true);
  if(sourceKind==='upload'){
    await page.waitForFunction(()=>document.getElementById('media-preview').readyState>=1,{},{timeout:10000});
    assert.equal(await page.locator('#media-preview').evaluate(e=>e.duration),3);
    await page.screenshot({path:fileURLToPath(new URL('../../output/showrunner-tests/host-ready-desktop.png',import.meta.url)),fullPage:true});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:fileURLToPath(new URL('../../output/showrunner-tests/host-ready-mobile.png',import.meta.url)),fullPage:true});await page.setViewportSize({width:1280,height:900});
  }
  await page.locator('#publish-consent').check();await page.locator('#publish-broadcast').click();
  await page.locator('#host-watch').waitFor();
  if(sourceKind==='upload'){
    const [viewer]=await Promise.all([context.waitForEvent('page'),page.locator('#host-watch').click()]);
    await viewer.locator('#sponsor').waitFor();assert.match(await viewer.locator('#status').innerText(),/Sponsor break/);await viewer.close();
  }
  assert.equal((await service.get(OWNER,order.id)).status,'started');
  if(sourceKind==='upload'){
    const started=await service.get(OWNER,order.id);
    await f.commerce.cup(OWNER,{requestKey:randomUUID(),broadcastId:started.broadcastId,fighterIds:started.fighterIds});
    const job=await f.store.claimJob('svl-mac-01:browser',{hostId:'svl-mac-01',leaseSeconds:90});
    const result={protocolVersion:1,jobId:job.id,leaseToken:job.leaseToken,seed:job.seed,winnerId:job.fighterIds[0],bouts:[[0,1],[2,3],[0,2]].map(([a,b],i)=>({leftId:job.fighterIds[a],rightId:job.fighterIds[b],winnerId:job.fighterIds[a],winner:0,seed:(job.seed+i)>>>0,how:'decision',ms:100,hp:[1,0],contacts:[0,0],digest:'1234abcd'}))};
    await f.store.completeJob('svl-mac-01:browser',{jobId:job.id,leaseToken:job.leaseToken,outcome:'succeeded',result});
    await page.locator('#execution-refresh').click();await page.locator('#execution-results').getByText('1 completed cup',{exact:true}).waitFor();
    await page.locator('#execution-stop').click();await page.locator('#execution-end').click();await page.locator('#execution-state').getByText('Finished',{exact:true}).waitFor();
    await page.locator('#execution-reconcile').click();await page.locator('#execution-consent').waitFor();
    assert.equal(await page.locator('#execution-pay').isDisabled(),true);await page.locator('#execution-consent').check();await page.locator('#execution-pay').click();
    await page.locator('#execution-fees').getByText('$0.04 paid',{exact:true}).waitFor();
    await page.screenshot({path:fileURLToPath(new URL('../../output/showrunner-tests/integrated-host-desktop.png',import.meta.url)),fullPage:true});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:fileURLToPath(new URL('../../output/showrunner-tests/integrated-host-mobile.png',import.meta.url)),fullPage:true});await page.setViewportSize({width:1280,height:900});
  }
  assert.ok(Date.parse((await service.get(OWNER,order.id)).startedAt)<Date.parse((await service.get(OWNER,order.id)).scheduledAt));
  if(sourceKind!=='upload'){
    const started=await service.get(OWNER,order.id),watch=await context.newPage();watch.on('pageerror',e=>errors.push(e.message));
    await watch.clock.install();await watch.goto(ORIGIN+'/broadcast/watch/?show='+started.watchToken);
    await watch.locator('#external-video iframe').waitFor();
    const embed=new URL(await watch.locator('#external-video iframe').getAttribute('src'));
    assert.equal(embed.hostname,sourceKind==='youtube'?'www.youtube-nocookie.com':'clips.twitch.tv');
    if(sourceKind==='twitch')assert.equal(embed.searchParams.get('parent'),'127.0.0.1');
    assert.equal(await watch.locator('#lineup img').count(),4);
    await watch.clock.fastForward(301000);await watch.locator('#arena').waitFor();
    assert.equal(await watch.locator('#external-video iframe').count(),0);
    assert.equal(await watch.locator('#open-player').isVisible(),false);
    await watch.clock.fastForward(21000);await watch.locator('#open-player').waitFor();
    assert.equal(await watch.locator('#open-player').getAttribute('href'),await watch.locator('#arena').getAttribute('src'));
    await watch.clock.fastForward(1500000);await watch.locator('#external-video iframe').waitFor();
    assert.equal(await watch.locator('#arena').getAttribute('src'),null);
    assert.equal(await watch.locator('#open-player').isVisible(),false);
    if(sourceKind==='twitch'){
      await watch.setViewportSize({width:390,height:844});await watch.getByRole('link',{name:'Open on Twitch to play'}).waitFor();
      assert.equal(await watch.locator('#external-video iframe').getAttribute('src'),null);
      assert.equal(await watch.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    }
    await watch.close();
  }
  await page.goto(ORIGIN+'/broadcast/');await page.locator('#broadcast-list').getByText(sourceKind==='upload'?'Finished':'Started',{exact:true}).waitFor();
  assert.equal(await page.locator('#wallet #broadcast-list article').count(),1);
  assert.equal(await page.locator('#wallet #broadcast-list .fighter-lineup img').count(),4);
  assert.doesNotMatch(await page.locator('body').innerText(),/Studio Credits/);
  assert.deepEqual((await service.get(OWNER,order.id)).fighterIds,lineup);assert.equal((await f.store.wallet(OWNER)).balanceCredits,100);
  await mkdir(new URL('../../output/showrunner-tests/',import.meta.url),{recursive:true});
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:fileURLToPath(new URL(`../../output/showrunner-tests/campaign-${sourceKind}-desktop.png`,import.meta.url)),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:fileURLToPath(new URL(`../../output/showrunner-tests/campaign-${sourceKind}-mobile.png`,import.meta.url)),fullPage:true});
  await page.evaluate(id=>globalThis.testAccount(id),OTHER);await page.waitForFunction(()=>document.getElementById('wallet-available').textContent==='0');
  assert.equal(await page.locator('#broadcast-list').getByText('Started',{exact:true}).count(),0);assert.deepEqual(errors,[]);
});
