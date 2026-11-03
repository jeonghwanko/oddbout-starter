import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {COMMERCE_CATALOG} from '../api/commerce/catalog.mjs';
import {createCommerceHandler} from '../api/commerce/handler.mjs';
import {createCommerceService} from '../api/commerce/service.mjs';
import {createPayPalSandbox} from '../api/commerce/paypal.mjs';
import {paidFixture,OWNER,OTHER,ORIGIN} from './helpers/paid-operations.mjs';

async function fixture(t) {
  const f=await paidFixture(t);
  const authenticate=async request=>request.headers.get('authorization')?.match(/^Bearer fixture-(.+)$/)?.[1]??null;
  const human=createCommerceHandler({service:f.commerce,publicOrigin:ORIGIN,authenticate});
  const agent=createCommerceHandler({service:f.commerce,publicOrigin:ORIGIN,authenticate,agent:true});
  const request=async(path,{body,owner=OWNER,origin=ORIGIN,asAgent=false}={})=>{
    const response=await (asAgent?agent:human)(new Request(`${ORIGIN}/commerce/${path}`,{
      method:body===undefined?'GET':'POST',headers:{...(owner?{authorization:`Bearer fixture-${owner}`} : {}),
        ...(origin?{origin}:{}),...(body===undefined?{}:{'content-type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})}));
    return {status:response.status,...await response.json()};
  };
  return {...f,request};
}

test('Showrunner merchandising preserves unit prices and ignores client price, credit and package-name spoofing',async t=>{
  const f=await fixture(t),catalog=(await f.request('catalog')).catalog;
  assert.equal(catalog.service.name,'ODDBOUT Showrunner');assert.equal(catalog.service.creditName,'Studio Credits');
  assert.equal(catalog.version,'sandbox-2026-11-02-v1');assert.equal(catalog.tools.host_cup.credits,25);
  assert.deepEqual(catalog.products.filter(item=>!item.operatorOnly).map(({id,name,amountCents,credits,maxCups,icon})=>({id,name,amountCents,credits,maxCups,icon})),[
    {id:'sandbox-1000',name:'Starter',amountCents:1000,credits:1000,maxCups:40,icon:'bell'},
    {id:'studio-series-5000',name:'Series',amountCents:5000,credits:5000,maxCups:200,icon:'bracket'},
  ]);
  const legacy=catalog.products.find(item=>item.id==='sandbox-50000');
  assert.equal(legacy.operatorOnly,true);assert.equal(legacy.amountCents,50000);assert.equal(legacy.credits,50000);
  assert.equal((await f.request('checkout',{body:{requestKey:randomUUID(),productId:'fake',credits:1000000,amountCents:1}})).code,'unknown-product');
  assert.equal(f.orders.size,0);
  const requestKey=randomUUID(),body={requestKey,productId:'studio-series-5000',credits:1,amountCents:1,name:'Spoofed',description:'Spoofed'};
  const first=await f.request('checkout',{body});assert.equal(first.status,200);
  const unit=f.orders.get('ORDER1').purchase_units[0];
  assert.equal(unit.amount.value,'50.00');assert.equal(unit.description,'ODDBOUT Showrunner Series - 5,000 Studio Credits');
  const intent=await f.store.findTopup(OWNER,first.data.intentId);
  assert.deepEqual(intent.input,{requestKey,amountCents:5000,credits:5000,currency:'USD'});
  assert.deepEqual((await f.request('checkout',{body})).data,first.data);
  assert.deepEqual((await f.request(`topups/${intent.id}/checkout`,{body:{confirmed:true,amountCents:1,productId:'fake'}})).data,first.data);
  assert.equal(f.calls.filter(call=>call.path==='/v2/checkout/orders').length,1);
  assert.equal((await f.store.listTopups(OWNER)).length,1);
});

test('purchase listing is owner-only, redacted and explicitly limited to the newest fifty purchases',async t=>{
  const f=await fixture(t),ids=[];
  for(let index=0;index<51;index++) ids.push((await f.store.createTopup(OWNER,{requestKey:randomUUID(),amountCents:1000,credits:1000,currency:'USD'})).id);
  await f.commerce.checkout(OTHER,{requestKey:randomUUID(),productId:'studio-series-5000'});
  const recent=await f.request('purchases');
  assert.equal(recent.status,200);assert.equal(recent.data.limit,50);assert.equal(recent.data.items.length,50);
  assert.equal(recent.data.items[0].id,ids.at(-1));assert.ok(!recent.data.items.some(item=>item.id===ids[0]));
  assert.equal(recent.data.items[0].productName,'Starter');assert.equal(recent.data.items[0].productId,'sandbox-1000');
  assert.deepEqual(Object.keys(recent.data.items[0]).sort(),['id','productId','productName','credits','amountCents','currency','createdAt','creditedAt','status','canCheckout'].sort());
  assert.ok(!JSON.stringify(recent).includes('requestKey'));assert.ok(!JSON.stringify(recent).includes('providerOrderId'));
  const other=await f.request('purchases',{owner:OTHER});assert.equal(other.data.items.length,1);
  assert.equal(other.data.items[0].productName,'Series');assert.ok(!ids.includes(other.data.items[0].id));
  assert.equal((await f.request('purchases',{owner:null})).status,401);
  assert.equal((await f.request('purchases',{asAgent:true})).status,404);
  assert.equal((await f.request(`topups/${ids[0]}/checkout`,{body:{confirmed:true},owner:OTHER})).status,404);
  assert.equal((await f.request(`topups/${ids[0]}/checkout`,{body:{confirmed:false}})).status,403);
  assert.equal((await f.request(`topups/${ids[0]}/checkout`,{body:{confirmed:true},origin:null})).status,403);
  assert.equal((await f.request(`topups/${ids[0]}/checkout`,{body:{confirmed:true},asAgent:true})).status,403);
  assert.equal((await f.request(`topups/${randomUUID()}/checkout`,{body:{confirmed:true}})).status,404);
});

test('recovering a lost create uses the original intent/request and never replaces an old unknown outcome',async t=>{
  const f=await fixture(t),requestKey=randomUUID();f.loseCreate();
  await assert.rejects(f.commerce.checkout(OWNER,{requestKey,productId:'sandbox-1000'}));
  const [intent]=await f.store.listTopups(OWNER);assert.equal(intent.providerOrderId,null);assert.equal(f.orders.size,1);
  assert.equal((await f.commerce.purchases(OWNER)).items[0].canCheckout,true);
  const recovered=await f.commerce.recoverCheckout(OWNER,intent.id);
  assert.equal(recovered.intentId,intent.id);assert.equal(f.orders.size,1);
  assert.equal((await f.store.findTopup(OWNER,intent.id)).providerOrderId,'ORDER1');
  const requests=f.calls.filter(call=>call.path==='/v2/checkout/orders');
  assert.equal(requests.length,2);assert.ok(requests.every(call=>call.requestId===`o-${intent.id}`));
  const old=await f.store.createTopup(OWNER,{requestKey:randomUUID(),amountCents:1000,credits:1000,currency:'USD'});
  await f.db.query("update commerce.topups set created_at=clock_timestamp()-interval '6 minutes' where id=$1",[old.id]);
  const blocked=await f.request(`topups/${old.id}/checkout`,{body:{confirmed:true}});
  assert.equal(blocked.status,409);assert.equal(blocked.code,'checkout-needs-reconciliation');
  assert.equal(f.orders.size,1);assert.equal(f.calls.filter(call=>call.path==='/v2/checkout/orders').length,2);
  assert.equal((await f.commerce.purchases(OWNER)).items.find(item=>item.id===old.id).canCheckout,false);
});

test('legacy purchases recover their exact existing order, retain their original input, and credit once',async t=>{
  const f=await fixture(t),requestKey=randomUUID();
  const checkout=await f.commerce.checkout(OWNER,{requestKey,productId:'sandbox-50000'});
  const original=await f.store.findTopup(OWNER,checkout.intentId);
  await f.db.query("update commerce.topups set created_at=clock_timestamp()-interval '1 day' where id=$1",[original.id]);
  assert.deepEqual(await f.commerce.recoverCheckout(OWNER,original.id),checkout);
  assert.deepEqual(await f.commerce.checkout(OWNER,{requestKey,productId:'sandbox-50000'}),checkout);
  assert.equal(f.orders.size,1);assert.equal(f.orders.get('ORDER1').purchase_units[0].amount.value,'500.00');
  f.orders.get('ORDER1').status='APPROVED';
  await f.commerce.capture(OWNER,original.id);await f.commerce.capture(OWNER,original.id);
  assert.deepEqual(await f.commerce.recoverCheckout(OWNER,original.id),{intentId:original.id,status:'credited'});
  const purchase=(await f.commerce.purchases(OWNER)).items[0];
  assert.equal(purchase.status,'credited');assert.ok(purchase.creditedAt);assert.equal(purchase.canCheckout,false);
  assert.equal(purchase.productName,'Legacy endurance');assert.equal((await f.store.wallet(OWNER)).balanceCredits,50000);
  assert.deepEqual((await f.store.findTopup(OWNER,original.id)).input,original.input);
  assert.equal(f.calls.filter(call=>call.path.endsWith('/capture')).length,1);
});

test('PayPal receives server-controlled Showrunner branding and package description alongside immutable amount/reference',async t=>{
  const f=await paidFixture(t),calls=[];
  const paypal=createPayPalSandbox({clientId:'fixture-client',clientSecret:'fixture-secret',merchantId:'MERCHANT',fetch:async(url,init)=>{
    const body=init.body==='grant_type=client_credentials'?null:JSON.parse(init.body);calls.push({url,body});
    return new Response(JSON.stringify(body?{id:'BRANDORDER',links:[{rel:'payer-action',href:'https://www.sandbox.paypal.com/checkoutnow?token=BRANDORDER'}]}
      :{access_token:'fixture-token',token_type:'Bearer',expires_in:3600}));
  }});
  const service=createCommerceService({store:f.store,paypal,merchantId:'MERCHANT',publicOrigin:ORIGIN,hosts:[]});
  const result=await service.checkout(OWNER,{requestKey:randomUUID(),productId:'sandbox-1000',brandName:'Spoofed'});
  const payload=calls.find(call=>call.body).body;
  assert.equal(payload.payment_source.paypal.experience_context.brand_name,COMMERCE_CATALOG.service.name);
  assert.equal(payload.purchase_units[0].description,'ODDBOUT Showrunner Starter - 1,000 Studio Credits');
  assert.equal(payload.purchase_units[0].reference_id,result.intentId);
  assert.deepEqual(payload.purchase_units[0].amount,{currency_code:'USD',value:'10.00'});
});
