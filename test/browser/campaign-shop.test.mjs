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
import {paidFixture,OWNER,OTHER} from '../helpers/paid-operations.mjs';

const ORIGIN='http://127.0.0.1:5197';
test('fixed broadcast cards purchase once, recover media and publish without customer execution settings',{timeout:90000},async t=>{
  const f=await paidFixture(t);await f.db.exec(await readFile(new URL('../../supabase/sandbox/20261103154930_commerce_campaigns.sql',import.meta.url),'utf8'));
  const topup=await f.store.createTopup(OWNER,{requestKey:randomUUID(),amountCents:1000,credits:1000,currency:'USD'});
  await f.store.attachOrder(OWNER,topup.id,'EXISTING');await f.store.creditCapture(OWNER,topup.id,{providerOrderId:'EXISTING',captureId:'CREDIT',amountCents:1000,currency:'USD',status:'COMPLETED'});
  const rpc=async(name,args)=>{try{return{data:await f.db.transaction(async tx=>{await tx.exec('set local role service_role');return(await tx.query('select public.commerce_campaign($1,$2,$3::jsonb) value',[args.p_owner,args.p_command,JSON.stringify(args.p_input)])).rows[0].value;}),error:null};}catch(error){return{data:null,error};}};
  const files=new Map(),storage={createSignedUploadUrl:async path=>({data:{path,token:'fixture-upload',signedUrl:'https://storage.fixture/'+path}}),
    info:async path=>files.has(path)?{data:{metadata:{size:files.get(path).length}}}:{error:'missing'},
    createSignedUrl:async path=>({data:{signedUrl:'https://storage.fixture/'+path}})};
  const media=createCampaignMedia({db:{storage:{from:()=>storage}},modelCall:async()=>({output:[{type:'message',content:[{type:'output_text',text:'This is a paid sponsor break. Watch this clip from oddbout.com and follow the sponsor link to learn more.'}]}],observation:{}}),
    fetchImpl:async url=>String(url).includes('spotlight.html')?new Response('spotlight-player.mjs'):new Response(files.get(new URL(url).pathname.slice(1)))});
  const service=createCampaignService({db:{rpc},...media});
  const authenticate=async req=>req.headers.get('authorization')?.replace('Bearer fixture-','')??null;
  const campaign=createCampaignHandler({service,authenticate,publicOrigin:ORIGIN,upload:async(owner,id,input)=>media.upload(id,input)});
  const commerce=createCommerceHandler({service:f.commerce,authenticate,publicOrigin:ORIGIN});
  const{server}=createBroadcastDemo({ODDBOUT_BROADCAST_PORT:'5197'});await new Promise(r=>server.listen(5197,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1280,height:900}}),errors=[];
  await context.route('**/broadcast/config',r=>r.fulfill({json:{authConfigured:true,campaigns:true,commerceEnabled:true,supabaseUrl:'https://fixture.example',publishableKey:'fixture'}}));
  await context.route('**/broadcast/supabase.js',r=>r.fulfill({contentType:'text/javascript',body:`let owner='${OWNER}',changed;const value=()=>({access_token:'fixture-'+owner,user:{id:owner,email:'owner@example.test'}});globalThis.testAccount=id=>{owner=id;changed('SIGNED_IN',value())};globalThis.supabase={createClient(){return{auth:{onAuthStateChange(fn){changed=fn},async getSession(){return{data:{session:value()}}},async signOut(){changed('SIGNED_OUT',null);return{}}},storage:{from(){return{async uploadToSignedUrl(path,token,file){const r=await fetch('/fixture/upload?path='+encodeURIComponent(path),{method:'PUT',body:file});return r.ok?{}:{error:new Error('upload failed')}}}}}}}};`}));
  await context.route('**/fixture/upload?*',async r=>{files.set(new URL(r.request().url()).searchParams.get('path'),r.request().postDataBuffer());await r.fulfill({status:200,body:'{}'});});
  await context.route('https://storage.fixture/**',r=>r.fulfill({contentType:'video/mp4',body:files.get(new URL(r.request().url()).pathname.slice(1))}));
  let losePurchase=true;
  for(const[pattern,handler]of[['**/campaigns/**',campaign],['**/commerce/**',commerce]])await context.route(pattern,async r=>{
    const req=r.request(),res=await handler(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}: {})}));
    if(losePurchase&&req.method()==='POST'&&new URL(req.url()).pathname==='/campaigns/orders'){losePurchase=false;await r.abort('failed');return;}
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
  assert.match(await buyThree.innerText(),/Continue purchase/);
  await buyThree.click();await page.locator('#media-file').waitFor();
  const[order]=(await service.list(OWNER)).items;assert.equal(order.priceCredits,900);assert.equal((await f.store.wallet(OWNER)).balanceCredits,100);
  assert.equal((await service.list(OWNER)).items.length,1);const lineup=order.fighterIds;
  const videoPath=fileURLToPath(new URL('../fixtures/campaign-sponsor.mp4',import.meta.url));
  assert.equal(inspectCampaignMp4(await readFile(videoPath)).durationSeconds,3);
  await page.locator('#media-file').setInputFiles(videoPath);await page.locator('#destination-url').fill('https://oddbout.com/');
  await page.locator('#media-upload').click();await page.locator('#publish-consent').waitFor();
  await page.locator('#publish-consent').check();await page.locator('#publish-broadcast').click();
  await page.getByRole('link',{name:/Watch broadcast/i}).first().waitFor();
  assert.equal((await service.get(OWNER,order.id)).status,'started');
  await page.reload();await page.locator('#broadcast-list').getByText('Published',{exact:true}).waitFor();
  assert.deepEqual((await service.get(OWNER,order.id)).fighterIds,lineup);assert.equal((await f.store.wallet(OWNER)).balanceCredits,100);
  await mkdir(new URL('../../output/showrunner-tests/',import.meta.url),{recursive:true});
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:fileURLToPath(new URL('../../output/showrunner-tests/campaign-desktop.png',import.meta.url)),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:fileURLToPath(new URL('../../output/showrunner-tests/campaign-mobile.png',import.meta.url)),fullPage:true});
  await page.evaluate(id=>globalThis.testAccount(id),OTHER);await page.waitForFunction(()=>document.getElementById('wallet-available').textContent==='0');
  assert.equal(await page.locator('#broadcast-list').getByText('Published',{exact:true}).count(),0);assert.deepEqual(errors,[]);
});
