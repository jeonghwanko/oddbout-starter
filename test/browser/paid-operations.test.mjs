import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createBroadcastDemo } from '../../scripts/broadcast-demo.mjs';
import { paidFixture,taskInput,OWNER,OTHER,ORIGIN,proof } from '../helpers/paid-operations.mjs';
import { createPaidOperationClient } from '../../mcp/paid-operations.mjs';

test('phone consent/funding and a fresh PC browser recover server state without sharing browser storage', {timeout:60000},async t=>{
  const f=await paidFixture(t),vm=createPaidOperationClient({origin:ORIGIN,fetchImpl:f.fetchImpl}),pair=await vm.connect('VM agent');
  const {server}=createBroadcastDemo({ODDBOUT_BROADCAST_PORT:'5193'});
  await new Promise(resolve=>server.listen(5193,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({channel:process.env.ODDBOUT_TEST_BROWSER_CHANNEL??'chrome',headless:true});t.after(()=>browser.close());
  async function device(viewport){
    const context=await browser.newContext({viewport});
    await context.route('**/broadcast/config',route=>route.fulfill({json:{paidOperations:true,authConfigured:true,commerceEnabled:true,supabaseUrl:'https://fixture.example',publishableKey:'fixture-public'}}));
    await context.route('**/broadcast/supabase.js',route=>route.fulfill({contentType:'text/javascript',body:`
      let owner='${OWNER}',changed;globalThis.testAccount=id=>{owner=id;changed?.('SIGNED_IN',{access_token:'fixture-'+id,user:{id,email:id+'@example.test'}});};
      globalThis.supabase={createClient(){return{auth:{onAuthStateChange(fn){changed=fn},async getSession(){return{data:{session:{access_token:'fixture-'+owner,user:{id:owner,email:'owner@example.test'}}}}},async signOut(){changed('SIGNED_OUT',null);return{};}}}}};` }));
    await context.route('**/paid-operations/**',async route=>{
      const req=route.request();const response=await f.handler(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}: {})}));
      await route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'});
    });
    return context.newPage();
  }
  const phone=await device({width:390,height:844});
  await phone.goto(pair.verificationUrl);await phone.locator('#pair-approve').waitFor();
  assert.equal(await phone.locator('#pair-code').textContent(),pair.userCode);
  await phone.locator('#pair-approve').click();await phone.locator('#message').filter({hasText:'Connected VM agent'}).waitFor();
  assert.equal((await vm.connect('VM agent')).state,'connected');
  const operation=await vm.prepare(taskInput());
  await phone.goto(operation.approvalUrl);
  await phone.locator('#state').filter({hasText:'Review needed'}).waitFor();
  await mkdir(new URL('../../output/paid-recovery-tests/',import.meta.url),{recursive:true});
  await phone.screenshot({path:fileURLToPath(new URL('../../output/paid-recovery-tests/phone-review-fixture.png',import.meta.url)),fullPage:true});
  assert.equal(await phone.locator('#approve').isDisabled(),true);
  await phone.locator('#consent').check();await phone.locator('#approve').click();
  await phone.locator('#state').filter({hasText:'Funding needed'}).waitFor();
  await phone.locator('#checkout').click();await phone.locator('#paypal').waitFor();
  assert.match(await phone.locator('#paypal').getAttribute('href'),/^https:\/\/www\.sandbox\.paypal\.com\//);
  assert.match(await phone.locator('#summary').textContent(),/\$10\.00 Sandbox \/ 1000 credits/);
  assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  // PayPal network boundary completes, but the phone is closed before any callback/verify.
  f.orders.get('ORDER1').status='APPROVED';await phone.close();
  const pc=await device({width:1280,height:900});await pc.goto(ORIGIN+'/broadcast/tasks/');
  await pc.getByRole('button',{name:/Recover my cup/}).click();
  await pc.locator('#verify').click();await pc.locator('#state').filter({hasText:'Ready to resume'}).waitFor();
  await pc.locator('#resume').click();await pc.locator('#state').filter({hasText:'Queued',exact:true}).waitFor();
  const job=await f.store.claimJob('test-worker',{hostId:'svl-mac-01'});
  await f.store.completeJob('test-worker',{jobId:job.id,leaseToken:job.leaseToken,outcome:'succeeded',result:proof(job)});
  await pc.locator('#refresh').click();await pc.locator('#state').filter({hasText:'Completed',exact:true}).waitFor();
  assert.match(await pc.locator('#winner').textContent(),/kuma/);
  await pc.screenshot({path:fileURLToPath(new URL('../../output/paid-recovery-tests/pc-result-fixture.png',import.meta.url)),fullPage:true});
  await pc.evaluate(id=>globalThis.testAccount(id),OTHER);
  await pc.getByText('No saved tasks yet.').waitFor();
  assert.equal(await pc.locator('#detail').isVisible(),false);assert.equal(await pc.locator('#paypal').isVisible(),false);
});
