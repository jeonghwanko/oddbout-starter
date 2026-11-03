import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createBroadcastDemo} from '../../scripts/broadcast-demo.mjs';
import {createCommerceHandler} from '../../api/commerce/handler.mjs';
import {createPaidOperationHandler} from '../../api/commerce/paid-handler.mjs';
import {createPaidOperations} from '../../api/commerce/paid-operations.mjs';
import {createPayoutService} from '../../api/commerce/payouts.mjs';
import {createConcierge} from '../../broadcast/concierge.mjs';
import {paidFixture,OWNER,OTHER,proof} from '../helpers/paid-operations.mjs';
const ORIGIN='http://127.0.0.1:5194';

test('ordinary concierge plan survives checkout closure and returns to the same producer, report and payouts', {timeout:90000}, async t=>{
  const f=await paidFixture(t),ensured=[];
  const paid=createPaidOperations({store:f.store,commerce:f.commerce,publicOrigin:ORIGIN,ensureProducer:(owner,id)=>ensured.push({owner,id})});
  const auth=async request=>request.headers.get('authorization')===`Bearer fixture-${OWNER}`?OWNER:request.headers.get('authorization')===`Bearer fixture-${OTHER}`?OTHER:null;
  const paidHandler=createPaidOperationHandler({service:paid,store:f.store,publicOrigin:ORIGIN,authenticate:auth});
  let quoted=false,finished=false;
  const concierge=createConcierge({service:{...f.commerce,paidOperations:paid},modelCall:async()=>({output:!quoted?(quoted=true,[{type:'function_call',name:'quote_broadcast',call_id:'quote1',arguments:JSON.stringify({hostId:'svl-mac-01',channelId:'Friday fight night',durationMinutes:60,maxCredits:50,fighterIds:['kuma','yume','bravow','beotim']})}]):[{type:'message',content:[{type:'output_text',text:'Review the broadcast budget below.'}]}]})});
  const payouts=createPayoutService({store:f.store,paypal:{createPayout(){throw Error('This test does not approve payouts');}},feeCents:2,
    receivers:Object.fromEntries(['kuma','yume','bravow','beotim'].map(id=>[id,`${id}@personal.example.com`]))});
  const commerceHandler=createCommerceHandler({publicOrigin:ORIGIN,authenticate:auth,service:{...f.commerce,payouts,
    concierge:(owner,input)=>concierge.turn(owner,input),producer:async()=>({state:finished?'finished':'running',model:'fixture',modelCalls:1,maxModelCalls:5,decisions:[]})}});
  const {server}=createBroadcastDemo({ODDBOUT_BROADCAST_PORT:'5194'});
  await new Promise(r=>server.listen(5194,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({channel:process.env.ODDBOUT_TEST_BROWSER_CHANNEL??'chrome',headless:true});t.after(()=>browser.close());
  const errors=[];
  async function device(viewport){
    const context=await browser.newContext({viewport});
    await context.route('**/broadcast/config',r=>r.fulfill({json:{paidOperations:true,autoProducer:true,concierge:true,payouts:{feeCents:2},authConfigured:true,commerceEnabled:true,supabaseUrl:'https://fixture.example',publishableKey:'fixture-public'}}));
    await context.route('**/broadcast/supabase.js',r=>r.fulfill({contentType:'text/javascript',body:`
      let owner='${OWNER}',changed;const value=()=>({access_token:'fixture-'+owner,user:{id:owner,email:'owner@example.test'}});
      globalThis.testAccount=id=>{owner=id;changed?.('SIGNED_IN',value());};
      globalThis.supabase={createClient(){return{auth:{onAuthStateChange(fn){changed=fn},async getSession(){return{data:{session:value()}}},async signOut(){changed('SIGNED_OUT',null);return{};}}}}};` }));
    for(const [pattern,handler] of [['**/paid-operations/**',paidHandler],['**/commerce/**',commerceHandler]])await context.route(pattern,async route=>{
      const request=route.request(),response=await handler(new Request(request.url(),{method:request.method(),headers:request.headers(),...(request.postData()?{body:request.postData()}: {})}));
      await route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'});
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return page;
  }
  const requester=await device({width:1280,height:900});await requester.goto(ORIGIN+'/broadcast/');
  await requester.locator('#concierge-input').fill('Plan two cups for Friday fight night.');await requester.locator('#concierge-send').click();
  await requester.locator('.chat-action').filter({hasText:'Friday fight night'}).waitFor();
  const saved=(await paid.page(OWNER,{kind:'broadcast'})).items;assert.equal(saved.length,1);const operation=saved[0];assert.equal(operation.state,'awaiting_approval');
  assert.equal(ensured.length,0);await requester.context().close();
  const phone=await device({width:390,height:844});await phone.goto(operation.approvalUrl);
  await phone.locator('#paid-approval').waitFor();assert.equal(await phone.locator('#paid-approve').isDisabled(),true);
  await phone.locator('#paid-consent').check();await phone.locator('#paid-approve').click();await phone.locator('#paid-checkout').waitFor();
  await phone.locator('#paid-checkout').click();await phone.locator('#paid-paypal-link').waitFor();
  assert.match(await phone.locator('#paid-paypal-link').getAttribute('href'),/^https:\/\/www\.sandbox\.paypal\.com\//);
  assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await phone.locator('#broadcast-form').isVisible(),false);
  await mkdir(new URL('../../output/paid-recovery-tests/',import.meta.url),{recursive:true});
  await phone.screenshot({path:fileURLToPath(new URL('../../output/paid-recovery-tests/studio-phone-fixture.png',import.meta.url)),fullPage:true});
  f.orders.get('ORDER1').status='APPROVED';await phone.context().close();
  await f.event('CHECKOUT.ORDER.APPROVED',{id:'ORDER1'});await paid.continueBroadcasts();
  const running=await paid.get(OWNER,operation.id);assert.ok(running.broadcastId);assert.ok(ensured.some(x=>x.owner===OWNER&&x.id===running.broadcastId));
  const pc=await device({width:1280,height:900});await pc.goto(ORIGIN+'/broadcast/');
  await pc.waitForFunction(id=>document.getElementById('broadcastId').value===id,running.broadcastId);
  await pc.locator('#producer-card').waitFor();assert.equal(await pc.locator('#broadcast-form').isVisible(),false);
  for(let i=0;i<2;i++){
    await f.commerce.cup(OWNER,{requestKey:randomUUID(),broadcastId:running.broadcastId,fighterIds:['kuma','yume','bravow','beotim']});
    const job=await f.store.claimJob('test-producer-worker',{hostId:'svl-mac-01'});
    await f.store.completeJob('test-producer-worker',{jobId:job.id,leaseToken:job.leaseToken,outcome:'succeeded',result:proof(job)});
  }
  await f.commerce.stop(OWNER,running.broadcastId);finished=true;
  await pc.locator('#refresh').click();await pc.waitForFunction(()=>document.getElementById('report').textContent.includes('completed'));
  assert.deepEqual(await pc.locator('#show-summary-metrics strong').allTextContents(),['2','50','0']);
  assert.match(await pc.locator('#show-summary-winners').textContent(),/Kuma/);
  await pc.locator('#payout-propose').click();await pc.locator('#payouts-list').getByText(/Proposed/i).first().waitFor();
  const proposals=await payouts.list(OWNER,running.broadcastId);assert.equal(proposals.length,1);assert.equal(proposals[0].totalCents,16);
  assert.equal((await paid.get(OWNER,operation.id)).broadcastId,running.broadcastId);
  assert.equal((await f.store.wallet(OWNER)).balanceCredits,950);assert.equal(f.orders.size,1);
  assert.equal((await f.db.query('select count(*)::int n from commerce.broadcasts')).rows[0].n,1);
  await pc.screenshot({path:fileURLToPath(new URL('../../output/paid-recovery-tests/studio-pc-fixture.png',import.meta.url)),fullPage:true});
  await pc.locator('#channelId').fill('Aftershow');await pc.locator('#maxCredits').fill('25');await pc.getByRole('button',{name:'Review budget',exact:true}).click();
  await pc.locator('#paid-review-title').filter({hasText:'Aftershow'}).waitFor();
  await pc.waitForFunction(()=>document.getElementById('broadcastId').value==='');
  assert.equal(await pc.locator('#producer-card').isVisible(),false);
  assert.equal(await pc.locator('#show-summary').isVisible(),false);
  assert.equal(await pc.locator('#payouts-list').isVisible(),false);
  await pc.evaluate(id=>globalThis.testAccount(id),OTHER);
  await pc.waitForFunction(()=>document.getElementById('broadcastId').value==='');
  assert.equal(await pc.locator('#paid-broadcast-review').isVisible(),false);assert.equal(await pc.locator('#producer-card').isVisible(),false);
  assert.deepEqual(errors,[]);
});
