import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createPaidOperationMcp,createPaidOperationClient } from '../mcp/paid-operations.mjs';
import { paidFixture,taskInput,proof,OWNER,OTHER,ORIGIN } from './helpers/paid-operations.mjs';
import { createConcierge } from '../broadcast/concierge.mjs';

test('shipped stdio entry starts with a public origin and no user or merchant secret',async t=>{
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../scripts/paid-operation-mcp.mjs',import.meta.url))],
    env:{ODDBOUT_COMMERCE_ORIGIN:ORIGIN},stderr:'pipe'});
  const client=new Client({name:'clean-client',version:'1'});t.after(()=>client.close());
  await client.connect(transport);const tools=await client.listTools();
  assert.deepEqual(tools.tools.map(tool=>tool.name).sort(),['connect_paid_operations','get_paid_operation','get_paid_operation_catalog','list_my_operations','prepare_paid_operation','resume_paid_operation'].sort());
});

test('VM disconnect → phone approval/payment without return → new PC MCP recovers one original job/result',async t=>{
  const f=await paidFixture(t),vm=await f.connect('VM');
  const input=taskInput(),operation=await vm.prepare(input);
  assert.equal(operation.state,'awaiting_approval');assert.equal(operation.input.maxCredits,25);
  assert.equal((await vm.prepare(input)).id,operation.id);
  await assert.rejects(vm.prepare({...input,channelId:'different'}),/idempotency-conflict/);
  assert.equal((await vm.resume(operation.id)).state,'awaiting_approval');
  // The VM client is abandoned. The phone approves execution, then pays at the provider.
  const funded=await f.fund(operation.id);f.loseCapture();
  await f.event('CHECKOUT.ORDER.APPROVED',{id:funded.operation.payment.providerOrderId});
  await f.event('CHECKOUT.ORDER.APPROVED',{id:funded.operation.payment.providerOrderId});
  assert.equal((await f.service.get(OWNER,operation.id)).state,'ready');
  const pc=await f.connect('PC'),server=createPaidOperationMcp(pc),[left,right]=InMemoryTransport.createLinkedPair();
  await server.connect(left);const client=new Client({name:'fresh-pc',version:'1'});await client.connect(right);
  t.after(()=>client.close());t.after(()=>server.close());
  const result=await client.callTool({name:'list_my_operations',arguments:{}});
  const found=JSON.parse(result.content[0].text).data[0];assert.equal(found.id,operation.id);
  const response=await client.callTool({name:'resume_paid_operation',arguments:{operationId:found.id}});
  const resumed=JSON.parse(response.content[0].text).data;assert.equal(resumed.state,'queued');
  // Lost enqueue reply / simultaneous retries all return this same job.
  const repeats=await Promise.all([pc.resume(found.id),pc.resume(found.id),pc.resume(found.id)]);
  for(const repeat of repeats)assert.equal(repeat.jobId,resumed.jobId);
  const job=await f.store.claimJob('test-worker',{hostId:'svl-mac-01'});
  assert.equal((await pc.resume(found.id)).state,'running');
  const completion={jobId:job.id,leaseToken:job.leaseToken,outcome:'succeeded',result:proof(job)};
  await f.store.completeJob('test-worker',completion);await f.store.completeJob('test-worker',completion);
  assert.equal((await f.commerce.report(OWNER,resumed.broadcastId)).broadcast.status,'completed');
  const recovered=await (await f.connect('PC after restart')).resume(found.id);
  assert.equal(recovered.state,'completed');assert.equal(recovered.job.result.winnerId,job.fighterIds[0]);
  assert.equal(recovered.jobId,job.id);assert.equal(recovered.payment.captureId,'CAPTUREORDER1');
  assert.equal((await f.commerce.report(OWNER,recovered.broadcastId)).broadcast.status,'completed');
  assert.equal((await f.store.wallet(OWNER)).balanceCredits,975);assert.equal((await f.store.wallet(OWNER)).reservedCredits,0);
  const counts=(await f.db.query("select (select count(*)::int from commerce.topups) topups,(select count(*)::int from commerce.jobs) jobs,(select count(*)::int from commerce.ledger where kind='topup') credits,(select count(*)::int from commerce.ledger where kind='spend') spends")).rows[0];
  assert.deepEqual(counts,{topups:1,jobs:1,credits:1,spends:1});
  assert.equal(f.calls.filter(call=>call.path.endsWith('/capture')).length,1);
});

test('failed task closes automatically and legacy enqueue cannot create another job in its session',async t=>{
  const f=await paidFixture(t),client=await f.connect('VM'),operation=await client.prepare(taskInput());
  await f.fund(operation.id);const queued=await client.resume(operation.id);
  const job=await f.store.claimJob('worker',{hostId:'svl-mac-01'});
  await f.store.completeJob('worker',{jobId:job.id,leaseToken:job.leaseToken,outcome:'failed',result:{reason:'known-renderer-failure'}});
  assert.equal((await f.commerce.report(OWNER,queued.broadcastId)).broadcast.status,'completed');
  assert.equal((await f.store.wallet(OWNER)).reservedCredits,0);assert.equal((await f.store.wallet(OWNER)).balanceCredits,1000);
  assert.equal((await client.resume(operation.id)).state,'failed');
  await assert.rejects(f.commerce.cup(OWNER,{requestKey:randomUUID(),broadcastId:queued.broadcastId,fighterIds:operation.input.fighterIds}),/broadcast-stopped/);
});

test('concierge saves a recoverable task, repeats its original input/key, and finds it from a new conversation',async t=>{
  const f=await paidFixture(t);let current=0;
  const args={hostId:'svl-mac-01',channelId:'Phone payment',durationMinutes:60,fighterIds:taskInput().fighterIds};
  const names=['prepare_paid_operation','prepare_paid_operation','list_my_operations'];
  const agent=createConcierge({service:{...f.commerce,paidOperations:f.service},modelCall:async()=>{
    const step=current++,name=names[Math.floor(step/2)];
    return {observation:{},output:step%2===0?[{type:'function_call',call_id:String(step),name,arguments:JSON.stringify(name==='list_my_operations'?{}:args)}]
      :[{type:'message',content:[{type:'output_text',text:'Review the saved task.'}]}]};
  }});
  const first=await agent.turn(OWNER,{message:'Prepare one recoverable cup.'});
  const second=await agent.turn(OWNER,{conversationId:first.conversationId,message:'Show the same task again.'});
  const third=await agent.turn(OWNER,{message:'Find my saved task.'});
  assert.equal(first.actions[0].operationId,second.actions[0].operationId);assert.equal(first.actions[0].operationId,third.actions[0].operationId);
  assert.equal((await f.store.wallet(OWNER)).reservedCredits,0);assert.equal(f.orders.size,0);
});

test('MCP pairing returns a QR/code without secrets and concurrent connection requests share one grant',async t=>{
  const f=await paidFixture(t),client=createPaidOperationClient({origin:ORIGIN,fetchImpl:f.fetchImpl});
  const [a,b]=await Promise.all([client.connect('VM'),client.connect('VM')]);assert.deepEqual(a,b);
  assert.equal((await f.db.query('select count(*)::int n from commerce.operation_devices')).rows[0].n,1);
  const server=createPaidOperationMcp(client),[left,right]=InMemoryTransport.createLinkedPair();
  await server.connect(left);const mcp=new Client({name:'test',version:'1'});await mcp.connect(right);t.after(()=>mcp.close());t.after(()=>server.close());
  const result=await mcp.callTool({name:'connect_paid_operations',arguments:{label:'VM'}});
  assert.equal(result.content[1].type,'image');assert.equal(result.content[1].mimeType,'image/png');
  assert.ok(!JSON.stringify(result).includes('obt_'));
  const tools=await mcp.listTools();assert.ok(!tools.tools.some(tool=>/approve|checkout|payout/.test(tool.name)));
});

test('payment callback and webhook loss recover through same-order PC reconciliation; unknown jobs never restart',async t=>{
  const f=await paidFixture(t),vm=await f.connect('VM'),operation=await vm.prepare(taskInput());
  const payment=await f.fund(operation.id);
  // No webhook or return page. PC queries the existing approved order and captures it.
  const pc=await f.connect('PC');f.loseCapture();const queued=await pc.resume(operation.id);
  assert.equal(queued.payment.intentId,payment.checkout.intentId);assert.equal(queued.state,'queued');
  const job=await f.store.claimJob('worker',{hostId:'svl-mac-01'});
  await f.store.completeJob('worker',{jobId:job.id,leaseToken:job.leaseToken,outcome:'unknown',result:{reason:'connection-lost'}});
  for(let i=0;i<3;i++){
    const result=await pc.resume(operation.id);assert.equal(result.state,'needs_reconciliation');assert.equal(result.jobId,job.id);
  }
  assert.equal((await f.db.query('select count(*)::int n from commerce.jobs')).rows[0].n,1);
  assert.equal((await f.store.wallet(OWNER)).reservedCredits,25);
});

test('task creation and funding hold immutable prices; rollback cannot strand a reservation or duplicate queue entry',async t=>{
  const f=await paidFixture(t),client=await f.connect('VM');
  const operation=await client.prepare(taskInput({maxCredits:1,priceCredits:1,product:{amountCents:1},owner:OTHER}));
  assert.equal(operation.owner,OWNER);assert.equal(operation.input.maxCredits,25);assert.equal(operation.input.product.amountCents,1000);
  await f.fund(operation.id);await f.service.reconcile(OWNER,operation.id);
  await f.db.exec(`create function commerce.test_enqueue_fault() returns trigger language plpgsql as $$ begin raise exception 'commerce:test-enqueue-fault'; end; $$;
    create trigger test_enqueue_fault after insert on commerce.jobs for each row execute function commerce.test_enqueue_fault();`);
  await assert.rejects(client.resume(operation.id),/test-enqueue-fault/);
  assert.equal((await f.store.wallet(OWNER)).reservedCredits,0);
  assert.equal((await f.db.query('select count(*)::int n from commerce.broadcasts')).rows[0].n,0);
  await f.db.exec('drop trigger test_enqueue_fault on commerce.jobs');
  assert.equal((await client.resume(operation.id)).state,'queued');
});

test('device grants and browser consent enforce account ownership, scope, expiry and revocation',async t=>{
  const f=await paidFixture(t);
  const connect=await f.handler(new Request(ORIGIN+'/paid-agent/connect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:'VM'})}));
  const pair=(await connect.json()).data,params=new URLSearchParams(new URL(pair.verificationUrl).hash.slice(1));
  const callAgent=(path,body)=>f.handler(new Request(ORIGIN+'/paid-agent/'+path,{method:body===undefined?'GET':'POST',
    headers:{authorization:'Bearer '+pair.token,origin:ORIGIN,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  assert.equal((await callAgent('operations')).status,401);
  const consent={id:params.get('device'),userCode:pair.userCode,confirmed:true};
  assert.equal((await f.phone('devices/approve',{...consent,confirmed:false})).status,403);
  assert.equal((await f.phone('devices/approve',{...consent,userCode:'00000000'})).status,404);
  assert.equal((await f.phone('devices/approve',consent)).status,200);
  assert.equal((await f.phone('devices/approve',consent,OTHER)).status,404);
  const operation=(await (await callAgent('operations',taskInput())).json()).data;
  for(const action of ['approve','checkout','cancel'])assert.equal((await callAgent(`operations/${operation.id}/${action}`,{confirmed:true})).status,403);
  assert.equal((await callAgent('devices/approve',consent)).status,404);
  assert.equal((await f.phone(`operations/${operation.id}`,undefined,OTHER)).status,404);
  assert.deepEqual((await f.phone('operations',undefined,OTHER)).data,[]);
  assert.equal((await f.phone('devices/revoke',{id:consent.id,confirmed:true},OTHER)).status,404);
  assert.equal((await f.phone('devices/revoke',{id:consent.id,confirmed:true})).status,200);
  assert.equal((await callAgent('operations')).status,401);
  const serialized=JSON.stringify((await f.db.query('select * from commerce.operation_devices')).rows);
  assert.ok(!serialized.includes(pair.token));
  for(const role of ['anon','authenticated']) {
    const privileges=(await f.db.query(`select has_function_privilege($1,'public.commerce_operation(text,text,jsonb)','EXECUTE') op,
      has_function_privilege($1,'public.commerce_operation_device(text,text,jsonb)','EXECUTE') device,
      has_table_privilege($1,'commerce.operations','SELECT') rows`,[role])).rows[0];
    assert.deepEqual(privileges,{op:false,device:false,rows:false});
  }
  await f.db.query("update commerce.operation_devices set expires_at=clock_timestamp()-interval '1 second' where id=$1",[consent.id]);
  assert.equal((await callAgent('status')).status,401);
});

test('cancellation, expiration, payment reversals and bad provider evidence cannot launch new work',async t=>{
  const f=await paidFixture(t),client=await f.connect('VM');
  const cancelled=await client.prepare(taskInput());await f.fund(cancelled.id);
  await f.phone(`operations/${cancelled.id}/cancel`,{confirmed:true});
  assert.equal((await client.resume(cancelled.id)).state,'cancelled');
  assert.equal((await f.store.wallet(OWNER)).balanceCredits,1000); // approved purchase still belongs to the wallet
  const expired=await client.prepare(taskInput());await f.phone(`operations/${expired.id}/approve`,{confirmed:true});
  await f.db.query("update commerce.operations set input=jsonb_set(input,'{endsAt}',to_jsonb((clock_timestamp()-interval '1 second')::text)) where id=$1",[expired.id]);
  assert.equal((await client.resume(expired.id)).state,'expired');
  const blocked=await client.prepare(taskInput());await f.phone(`operations/${blocked.id}/approve`,{confirmed:true});
  await f.event('PAYMENT.CAPTURE.REVERSED',{id:'CAPTUREORDER1',supplementary_data:{related_ids:{order_id:'ORDER1'}}});
  assert.equal((await client.resume(blocked.id)).state,'blocked');
  assert.equal((await f.db.query('select count(*)::int n from commerce.jobs')).rows[0].n,0);
  await assert.rejects(f.commerce.webhook(new Headers(),JSON.stringify({event_type:'CHECKOUT.ORDER.APPROVED',resource:{id:'ORDER1'}})),/invalid-paypal-webhook/);
});
