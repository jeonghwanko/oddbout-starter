import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createBroadcastDemo} from '../../scripts/broadcast-demo.mjs';

test('signed-out PayPal return resumes the same top-up through Google sign-in',{timeout:45000},async t=>{
  const {server}=createBroadcastDemo({ODDBOUT_BROADCAST_PORT:'5198'});
  await new Promise(r=>server.listen(5198,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());
  const origin='http://127.0.0.1:5198',intent='58204a3d-d3e2-4fa5-99a3-f69c35334ba2';
  for(const providerFallback of [false,true]){
    const context=await browser.newContext();t.after(()=>context.close());const captures=[],errors=[];
    await context.route('**/broadcast/config',r=>r.fulfill({json:{authConfigured:true,commerceEnabled:true,supabaseUrl:'https://fixture.example',publishableKey:'fixture'}}));
    await context.route('**/broadcast/supabase.js',r=>r.fulfill({contentType:'text/javascript',body:`globalThis.supabase={createClient(){return{auth:{onAuthStateChange(){},async getSession(){return{data:{session:sessionStorage.getItem('fixture-auth')?{user:{id:'11111111-1111-4111-8111-111111111111'},access_token:'fixture'}:null}}},async signInWithOAuth(input){sessionStorage.setItem('fixture-redirect',input.options.redirectTo);sessionStorage.setItem('fixture-auth','1');location.assign(${providerFallback?'location.origin+"/broadcast/"':'input.options.redirectTo'});return{}}}}}};`}));
    await context.route('**/campaigns/**',r=>r.fulfill({json:{ok:true,data:r.request().url().endsWith('/catalog')?{products:[]}:{items:[],nextCursor:null}}}));
    await context.route('**/commerce/**',r=>{
      const path=new URL(r.request().url()).pathname;
      if(path.endsWith('/capture'))captures.push(path);
      return r.fulfill({json:path==='/commerce/catalog'?{catalog:{products:[],paypalConfigured:true}}:{ok:true,data:path==='/commerce/wallet'?{availableCredits:1000}:{status:'credited',credits:1000}}});
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/broadcast/?intent='+intent+'&token=provider-order&PayerID=provider-payer');
    await page.getByRole('button',{name:'Sign in with Google',exact:true}).click();
    await page.getByText('1,000 DON added. Your balance is ready.',{exact:true}).waitFor();
    assert.deepEqual(captures,['/commerce/topups/'+intent+'/capture']);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('fixture-redirect')),origin+'/broadcast/?intent='+intent);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('oddbout-topup-return')),null);
    assert.deepEqual(errors,[]);
  }
});
