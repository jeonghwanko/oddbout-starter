import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { paidFixture,taskInput,OWNER,OTHER,ORIGIN } from './helpers/paid-operations.mjs';
import { createPaidOperations } from '../api/commerce/paid-operations.mjs';
import { createPaymentRecovery } from '../api/commerce/payment-recovery.mjs';
import { validateOrderBinding } from '../api/commerce/paypal.mjs';

const due=(f,id)=>f.db.query("update commerce.operation_recovery set next_at=clock_timestamp()-interval '1 second' where operation_id=$1",[id]);
const count=async(f,table)=>Number((await f.db.query(`select count(*) n from commerce.${table}`)).rows[0].n);

test('background recovery survives a dead caller and provider create response loss without a replacement order',async t=>{
  const f=await paidFixture(t),operation=await f.service.prepare(OWNER,taskInput());
  await f.service.approve(OWNER,operation.id);f.loseCreate();
  const initial=await f.service.checkout(OWNER,operation.id);
  assert.equal(initial.operation.recovery.state,'pending');assert.equal(initial.operation.payment.providerOrderId,null);assert.equal(f.orders.size,1);
  await due(f,operation.id);
  const restarted=createPaymentRecovery({store:f.store,commerce:f.commerce});
  await restarted.runOne();
  const linked=await f.service.get(OWNER,operation.id);assert.equal(linked.payment.providerOrderId,'ORDER1');assert.equal(f.orders.size,1);
  f.orders.get('ORDER1').status='APPROVED';await due(f,operation.id);
  await Promise.all([restarted.runOne(),createPaymentRecovery({store:f.store,commerce:f.commerce}).runOne()]);
  assert.equal((await f.service.get(OWNER,operation.id)).state,'ready');assert.equal((await f.store.wallet(OWNER)).balanceCredits,1000);
  assert.equal(f.calls.filter(x=>x.path.endsWith('/capture')).length,1);
  assert.equal(await count(f,'jobs'),0); // funding never auto-executes without the separate resume
});

test('lease expiry allows recovery after a server crash and rejects stale completion from the old server',async t=>{
  const f=await paidFixture(t),operation=await f.service.prepare(OWNER,taskInput());await f.fund(operation.id);
  const first=await f.store.recovery(OWNER,'claim',{operationId:operation.id});
  assert.equal(await f.service.recovery.runOne(OWNER,operation.id),false);
  await f.db.query("update commerce.operation_recovery set lease_until=clock_timestamp()-interval '1 second' where operation_id=$1",[operation.id]);
  const second=await f.store.recovery(OWNER,'claim',{operationId:operation.id});assert.notEqual(second.leaseId,first.leaseId);
  const stale=await f.store.recovery(OWNER,'finish',{operationId:operation.id,leaseId:first.leaseId,state:'needs_attention',code:'stale-report',delaySeconds:60});
  assert.equal(stale.stale,true);assert.equal((await f.store.recovery(OWNER,'status',{operationId:operation.id})).state,'leased');
  await f.commerce.capture(OWNER,operation.payment?.intentId??(await f.service.get(OWNER,operation.id)).payment.intentId);
  assert.equal((await f.store.recovery(OWNER,'status',{operationId:operation.id})).state,'succeeded');
  assert.equal((await f.store.recovery(OWNER,'finish',{operationId:operation.id,leaseId:second.leaseId,state:'pending',code:'late-error',delaySeconds:60})).stale,true);
});

test('transient failures back off, pending captures never credit early, and permanent mismatch requires review',async t=>{
  const f=await paidFixture(t),operation=await f.service.prepare(OWNER,taskInput());await f.fund(operation.id);
  f.failProvider(503);await f.service.reconcile(OWNER,operation.id);
  assert.equal((await f.service.get(OWNER,operation.id)).recovery.state,'pending');
  const before=f.calls.length;await f.service.resume(OWNER,operation.id);assert.equal(f.calls.length,before);
  await due(f,operation.id);f.pendingCapture();await f.service.recovery.runOne();
  assert.equal((await f.store.wallet(OWNER)).balanceCredits,0);assert.equal((await f.service.get(OWNER,operation.id)).recovery.lastCode,'paypal_capture_pending');
  f.orders.get('ORDER1').purchase_units[0].payments.captures[0].status='COMPLETED';await due(f,operation.id);await f.service.recovery.runOne();
  assert.equal((await f.store.wallet(OWNER)).balanceCredits,1000);
  // A different account's canonical order has an amount mismatch: no payment or execution can proceed.
  const other=await f.service.prepare(OTHER,taskInput());await f.service.approve(OTHER,other.id);await f.service.checkout(OTHER,other.id);
  const order=f.orders.get('ORDER2');order.status='APPROVED';order.purchase_units[0].amount.value='0.01';
  await f.service.reconcile(OTHER,other.id);assert.equal((await f.service.get(OTHER,other.id)).state,'payment_review');
  const metrics=await f.store.recovery(null,'metrics');assert.equal(Number(metrics.attention),1);assert.equal(await count(f,'jobs'),0);
});

test('reapproval preserves original funded task, immutable inputs and one purchase; agents cannot renew',async t=>{
  const f=await paidFixture(t),input=taskInput(),operation=await f.service.prepare(OWNER,input);await f.fund(operation.id);await f.service.reconcile(OWNER,operation.id);
  const original=await f.service.get(OWNER,operation.id);
  await f.db.query("update commerce.operations set effective_ends_at=clock_timestamp()-interval '1 second' where id=$1",[operation.id]);
  assert.equal((await f.service.resume(OWNER,operation.id)).state,'expired');
  assert.equal((await f.service.prepare(OWNER,input)).id,operation.id); // recovery before new time validation
  const endsAt=new Date(Date.now()+7200000).toISOString();
  const renewed=await f.phone(`operations/${operation.id}/renew`,{endsAt,confirmed:true});assert.equal(renewed.status,200);
  assert.equal(renewed.data.id,original.id);assert.equal(renewed.data.payment.captureId,original.payment.captureId);
  assert.deepEqual(renewed.data.input,original.input);assert.notEqual(renewed.data.approvalId,original.approvalId);
  assert.equal((await f.service.renew(OWNER,operation.id,endsAt)).approvalId,renewed.data.approvalId);
  assert.equal((await f.phone(`operations/${operation.id}/renew`,{endsAt,confirmed:true},OTHER)).status,404);
  const result=await f.service.resume(OWNER,operation.id);assert.equal(result.state,'queued');assert.equal(f.orders.size,1);
  await assert.rejects(f.service.renew(OWNER,operation.id,new Date(Date.now()+8000000).toISOString()),/operation-not-renewable/);
});

test('all tasks remain discoverable through stable owner-scoped pages, search and filters',async t=>{
  const f=await paidFixture(t);
  for(let i=0;i<63;i++)await f.service.prepare(OWNER,taskInput({channelId:`Task ${String(i).padStart(2,'0')}`}));
  await f.service.prepare(OTHER,taskInput({channelId:'Private task'}));
  const seen=new Set();let cursor;
  do {
    const page=await f.service.page(OWNER,{limit:17,...(cursor?{cursor}: {})});
    for(const item of page.items){assert.equal(item.owner,OWNER);assert.ok(!seen.has(item.id));seen.add(item.id);}
    cursor=page.nextCursor;
  }while(cursor);
  assert.equal(seen.size,63);
  assert.equal((await f.service.page(OWNER,{query:'Task 01'})).items.length,1);
  assert.equal((await f.service.page(OWNER,{filter:'completed'})).items.length,0);
  await assert.rejects(f.service.page(OWNER,{cursor:'invalid'}),/invalid-cursor/);
  await assert.rejects(f.service.page(OWNER,{limit:51}),/invalid-input/);
});

test('audit is append-only and owner-scoped; duplicate payments create one credit event and diagnostics redact credentials',async t=>{
  const f=await paidFixture(t),operation=await f.service.prepare(OWNER,taskInput());await f.fund(operation.id);await f.service.reconcile(OWNER,operation.id);
  await f.event('CHECKOUT.ORDER.APPROVED',{id:'ORDER1'});await f.event('CHECKOUT.ORDER.APPROVED',{id:'ORDER1'});
  const events=await f.service.events(OWNER,operation.id);
  assert.equal(events.filter(x=>x.kind==='payment_credited').length,1);
  assert.ok(events.some(x=>x.kind==='task_approved'));assert.ok(events.some(x=>x.kind==='funding_requested'));
  await assert.rejects(f.service.events(OTHER,operation.id),/not-found/);
  await assert.rejects(f.db.query('update commerce.operation_events set kind=$1 where operation_id=$2',['changed',operation.id]),/append-only/);
  for(const name of ['commerce_operation_recovery','commerce_operation_v1']){
    const p=(await f.db.query("select has_function_privilege('authenticated',$1,'EXECUTE') allowed",[`public.${name}(text,text,jsonb)`])).rows[0];assert.equal(p.allowed,false);
  }
  assert.equal((await f.store.recovery(null,'health')).schemaVersion,2);
  assert.ok(!JSON.stringify(await f.store.recovery(null,'metrics')).includes('secret'));
});

test('pairing abuse is bounded and authenticated consent routes reject forged Origin and device grants',async t=>{
  const f=await paidFixture(t);
  const connect=()=>f.handler(new Request(ORIGIN+'/paid-agent/connect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:'VM'})}),{clientAddress:'192.0.2.1'});
  for(let i=0;i<20;i++)assert.equal((await connect()).status,200);
  const limited=await connect();assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');assert.ok(limited.headers.get('x-request-id'));
  const task=await f.service.prepare(OWNER,taskInput());
  const response=await f.handler(new Request(`${ORIGIN}/paid-operations/operations/${task.id}/renew`,{method:'POST',headers:{origin:'https://attacker.example',authorization:`Bearer fixture-${OWNER}`,'content-type':'application/json'},body:JSON.stringify({confirmed:true,endsAt:new Date(Date.now()+7200000).toISOString()})}));
  assert.equal(response.status,403);
});

test('unknown create outside recovery window stays held until an operator binds the verified original order',async t=>{
  const f=await paidFixture(t),operation=await f.service.prepare(OWNER,taskInput());await f.service.approve(OWNER,operation.id);f.loseCreate();
  await f.service.checkout(OWNER,operation.id);
  const saved=await f.service.get(OWNER,operation.id),order=f.orders.get('ORDER1');
  await f.db.query("update commerce.topups set created_at=clock_timestamp()-interval '10 minutes' where id=$1",[saved.payment.intentId]);
  await due(f,operation.id);await f.service.recovery.runOne();
  assert.equal((await f.service.get(OWNER,operation.id)).recovery.lastCode,'checkout-needs-reconciliation');assert.equal(f.orders.size,1);
  const expected={orderId:order.id,referenceId:saved.payment.intentId,amountMinor:1000,currency:'USD',merchantId:'MERCHANT'};
  assert.throws(()=>validateOrderBinding(order,{...expected,merchantId:'OTHER'}),/mismatch/);
  validateOrderBinding(order,expected);
  await assert.rejects(f.store.recovery(null,'link_order',{operationId:operation.id,providerOrderId:order.id}),/operator-note-required/);
  await f.store.recovery(null,'link_order',{operationId:operation.id,providerOrderId:order.id,note:'Verified canonical order binding after response loss'});
  order.status='APPROVED';await f.service.recovery.runOne();
  assert.equal((await f.service.get(OWNER,operation.id)).state,'ready');assert.equal(f.orders.size,1);
  assert.ok((await f.service.events(OWNER,operation.id)).some(e=>e.kind==='payment_link_recovered'));
  await f.event('PAYMENT.CAPTURE.REVERSED',{id:'CAPTUREORDER1',supplementary_data:{related_ids:{order_id:'ORDER1'}}});
  assert.equal((await f.service.get(OWNER,operation.id)).state,'blocked');
  assert.ok((await f.service.events(OWNER,operation.id)).some(e=>e.kind==='payment_adjusted'));
});
