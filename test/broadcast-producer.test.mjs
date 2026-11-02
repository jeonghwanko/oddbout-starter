import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBroadcastProducer, createProducerMcp, createProducerModel, PRODUCER_TOOLS } from '../broadcast/producer.mjs';
import { parseProducerArgs, runBroadcastProducer } from '../scripts/broadcast-producer.mjs';

const broadcastId='11111111-1111-4111-8111-111111111111';
const otherId='22222222-2222-4222-8222-222222222222';
const model='operator-selected-model';
const fighters=['kuma','yume','bravow','beotim'];
const hostDecision=()=>({action:'host_cup',fighterIds:[...fighters],reason:'The approved reservation covers this exhibition.',episode:'NIGHTCROWN: First Human Spotlight'});
const waitDecision=()=>({action:'wait',fighterIds:null,reason:'Wait for a meaningful server-state change.',episode:null});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});

/** Only the external MCP/Responses HTTP boundaries are simulated. Production SDK,
 * response parsing, scope/budget checks, decisions and persistence orchestration execute. */
async function fixture(t,{decision=hostDecision(),maxModelCalls=24}={}) {
  const endsAt=new Date(Date.now()+3_600_000).toISOString();
  const report={broadcast:{id:broadcastId,status:'running',channelId:'channel',hostId:'current-pc',endsAt,
    reservedCredits:100,allocatedCredits:0,spentCredits:0},approval:{fighterIds:[...fighters],allowedTools:['host_cup'],priceVersion:'prices-v1',
    channelId:'channel',hostId:'current-pc',endsAt,maxCredits:100},jobs:[]};
  const catalog={version:'prices-v1',fighters:[...fighters,'quickcat'],tools:{host_cup:{credits:25}},hosts:[{id:'current-pc'}]};
  const wallet={balanceCredits:100,reservedCredits:100,availableCredits:0};
  const tools=[];const modelRequests=[];const checkpoints=[];const wire=[];
  let modelFailure=false;let mutationMode='normal';let readFailures=0;
  const mcp=await createProducerMcp({url:'https://mcp.example.test/mcp',token:'test-mcp-secret-never-persisted',fetchImpl:async(url,init)=>{
    wire.push({url:String(url),method:init?.method,authorization:new Headers(init?.headers).get('authorization')});
    if(init?.method==='GET')return new Response(null,{status:405});
    const request=JSON.parse(init.body);
    if(!Object.hasOwn(request,'id'))return new Response(null,{status:202});
    if(request.method==='initialize')return json({jsonrpc:'2.0',id:request.id,result:{protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'test-boundary',version:'1'}}});
    if(request.method!=='tools/call')throw new Error('unexpected MCP method');
    const {name,arguments:args}=request.params;tools.push({name,args:structuredClone(args)});
    if(name==='get_broadcast_report'&&readFailures-->0)throw new Error('private test-mcp-secret-never-persisted diagnostic');
    let data;
    if(name==='get_broadcast_report'||name==='get_broadcast')data=structuredClone(report);
    else if(name==='get_broadcast_prices')data=structuredClone(catalog);
    else if(name==='get_credit_balance')data=structuredClone(wallet);
    else if(name==='get_broadcast_job')data=structuredClone(report.jobs.find(job=>job.id===args.jobId));
    else if(name==='host_cup'){
      if(mutationMode==='lost-before-commit')throw new Error('connection lost');
      data={id:'33333333-3333-4333-8333-333333333333',broadcastId:args.broadcastId,requestKey:args.requestKey,fighterIds:[...args.fighterIds],status:'queued'};
      report.jobs.push(structuredClone(data));report.broadcast.allocatedCredits+=25;
      if(mutationMode==='lost-after-commit')throw new Error('connection lost after commit');
    } else throw new Error('unexpected tool');
    const body=name==='get_broadcast_prices'?{ok:true,catalog:data}:{ok:true,data};
    return json({jsonrpc:'2.0',id:request.id,result:{structuredContent:body,content:[{type:'text',text:JSON.stringify(body)}]}});
  }});
  t.after(()=>mcp.close());
  const modelCall=createProducerModel({model,apiKey:'test-openai-secret-never-persisted',fetchImpl:async(url,init)=>{
    modelRequests.push({url,request:JSON.parse(init.body)});
    if(modelFailure)throw new Error('private test-openai-secret-never-persisted diagnostic');
    return json({id:'resp_test',model,status:'completed',usage:{input_tokens:123,output_tokens:45,total_tokens:168},
      output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(decision)}]}]});
  }});
  const options={broadcastId,model,mcp,modelCall,maxModelCalls,checkpoint:async state=>checkpoints.push(structuredClone(state))};
  return {report,catalog,wallet,tools,modelRequests,checkpoints,wire,mcp,options,
    set modelFailure(value){modelFailure=value;},set mutationMode(value){mutationMode=value;},set readFailures(value){readFailures=value;},
    create:(extra={})=>createBroadcastProducer({...options,...extra})};
}

test('actual model decision selects only approved source fighters, spends from session envelope and persists key before MCP mutation',async t=>{
  const f=await fixture(t);const producer=f.create();
  const first=await producer.step();assert.equal(first.status,'queued');
  assert.match(first.requestKey,/^[a-f0-9-]{36}$/);assert.equal(first.episode,'NIGHTCROWN: First Human Spotlight');
  const host=f.tools.find(tool=>tool.name==='host_cup');
  assert.deepEqual(Object.keys(host.args).sort(),['broadcastId','fighterIds','requestKey']);
  assert.equal(host.args.broadcastId,broadcastId);assert.deepEqual(host.args.fighterIds,fighters);
  const persisted=f.checkpoints.find(state=>state.pending?.status==='prepared');assert.equal(persisted.pending.requestKey,host.args.requestKey);
  assert.equal(persisted.decisions[0].fictionalEpisode,first.episode);
  assert.equal(persisted.decisions[0].modelObservation.requestedModel,model);
  const request=f.modelRequests[0].request;assert.equal(request.model,model);assert.equal(request.store,false);assert.equal(request.max_output_tokens,600);
  const context=JSON.parse(request.input[1].content);assert.deepEqual(context.eligibleFighterIds,fighters);
  assert.equal(context.wallet.availableCredits,0);assert.equal(context.unallocatedCredits,100);
  assert.equal(context.hostReadiness,'unverified');assert.equal(context.liveSeconds,null);
  assert.ok(request.input[0].content.includes('NIGHTCROWN'));assert.equal(f.wire[0].authorization,'Bearer test-mcp-secret-never-persisted');
  assert.equal((await producer.step()).status,'waiting');assert.equal(f.modelRequests.length,1);
  assert.equal(f.tools.filter(tool=>tool.name==='host_cup').length,1);
});

test('current job must become terminal before another paid decision; settled results remain factual',async t=>{
  const f=await fixture(t);const producer=f.create();await producer.step();
  assert.equal((await producer.step()).status,'waiting');
  f.report.jobs[0].status='succeeded';f.report.jobs[0].result={winnerId:'kuma'};
  f.report.broadcast.allocatedCredits=0;f.report.broadcast.reservedCredits=75;f.report.broadcast.spentCredits=25;
  const settled=await producer.step();assert.equal(settled.status,'settled');assert.equal(settled.outcome,'succeeded');
  assert.equal(f.modelRequests.length,1);
  assert.equal((await producer.step()).status,'queued');assert.equal(f.modelRequests.length,2);
  const keys=f.tools.filter(tool=>tool.name==='host_cup').map(tool=>tool.args.requestKey);assert.notEqual(keys[0],keys[1]);
});

test('lost mutation response recovers original request from report; no new key, paid decision or mutation retry',async t=>{
  const f=await fixture(t);f.mutationMode='lost-after-commit';const producer=f.create();
  const unknown=await producer.step();assert.equal(unknown.status,'unknown');
  const state=f.checkpoints.at(-1);assert.equal(state.pending.status,'unknown');assert.equal(state.pending.requestKey,unknown.requestKey);
  const restored=f.create({state});const waiting=await restored.step();assert.equal(waiting.status,'waiting');
  assert.equal(f.modelRequests.length,1);assert.equal(f.tools.filter(tool=>tool.name==='host_cup').length,1);
  assert.equal(f.checkpoints.at(-1).pending.requestKey,unknown.requestKey);
});

test('unknown mutation absent from server remains unresolved across restart and never auto-resubmits',async t=>{
  const f=await fixture(t);f.mutationMode='lost-before-commit';const producer=f.create();
  const first=await producer.step();assert.equal(first.status,'unknown');
  const restored=f.create({state:f.checkpoints.at(-1)});
  for(let n=0;n<3;n++)assert.equal((await restored.step()).reason,'producer_mutation_reconciliation_required');
  assert.equal(f.modelRequests.length,1);assert.equal(f.tools.filter(tool=>tool.name==='host_cup').length,1);
  assert.equal(f.checkpoints.at(-1).pending.requestKey,first.requestKey);
});

test('budget, approved fighter availability, configured host, expiry and unknown jobs gate paid model calls',async t=>{
  for(const configure of [
    f=>{f.report.broadcast.reservedCredits=24;},
    f=>{f.report.approval.fighterIds=fighters.slice(0,3);},
    f=>{f.catalog.hosts[0].available=false;},
    f=>{f.wallet.spendingBlocked=true;},
    f=>{f.report.broadcast.endsAt=new Date(Date.now()-1000).toISOString();},
    f=>{f.report.jobs.push({id:otherId,broadcastId,status:'unknown'});},
    f=>{f.report.jobs.push({id:otherId,broadcastId,status:'running'});},
  ]){
    const f=await fixture(t);configure(f);const result=await f.create().step();assert.notEqual(result.status,'queued');
    assert.equal(f.modelRequests.length,0);assert.equal(f.tools.some(tool=>tool.name==='host_cup'),false);
  }
});

test('model cannot widen broadcast/fighter/price scope or invoke payment, approval or arbitrary tools',async t=>{
  for(const decision of [
    {...hostDecision(),broadcastId:otherId},
    {...hostDecision(),fighterIds:['Velora','Nera','Rubia','Morne']},
    {...hostDecision(),action:'create_topup_checkout'},
    {...hostDecision(),fighterIds:['kuma','kuma','bravow','beotim']},
    {...hostDecision(),episode:null},
  ]){
    const f=await fixture(t,{decision});assert.ok(['stopped','unknown'].includes((await f.create().step()).status));
    assert.equal(f.tools.some(tool=>tool.name==='host_cup'),false);
  }
  const f=await fixture(t);f.report.broadcast.id=otherId;
  assert.equal((await f.create().step()).reason,'producer_scope_mismatch');assert.equal(f.modelRequests.length,0);
  const prices=await fixture(t);prices.catalog.version='changed';
  assert.equal((await prices.create().step()).reason,'producer_catalog_scope_changed');assert.equal(prices.modelRequests.length,0);
  for(const name of ['create_topup_checkout','start_broadcast','stop_broadcast','approve_budget','shell'])await assert.rejects(f.mcp.callTool(name,{}),/producer_tool_not_allowed/);
  assert.deepEqual(PRODUCER_TOOLS,['get_credit_balance','get_broadcast_prices','get_broadcast','get_broadcast_job','get_broadcast_report','host_cup']);
});

test('wait decisions are event-driven and persisted model call limits bound paid usage',async t=>{
  const f=await fixture(t,{decision:waitDecision(),maxModelCalls:1});const producer=f.create();
  assert.equal((await producer.step()).status,'waiting');assert.equal(f.modelRequests.length,1);
  assert.equal((await producer.step()).reason,'producer_state_unchanged');assert.equal(f.modelRequests.length,1);
  f.wallet.balanceCredits++;f.wallet.availableCredits++;
  assert.equal((await producer.step()).reason,'producer_model_call_limit');assert.equal(f.modelRequests.length,1);
  assert.throws(()=>f.create({state:f.checkpoints.at(-1),model:'another-model'}),/producer_state_scope_mismatch/);
  assert.throws(()=>f.create({state:f.checkpoints.at(-1),broadcastId:otherId}),/producer_state_scope_mismatch/);
});

test('model failure and pre-response crash halt without retries or secret diagnostics; model-pending recovery is free',async t=>{
  const f=await fixture(t);f.modelFailure=true;const producer=f.create();
  const first=await producer.step();assert.equal(first.reason,'producer_model_outcome_unverified');
  assert.equal((await producer.step()).status,'stopped');assert.equal(f.modelRequests.length,1);
  assert.equal(f.tools.some(tool=>tool.name==='host_cup'),false);
  const journal=JSON.stringify(f.checkpoints);assert.equal(journal.includes('test-openai-secret'),false);assert.equal(journal.includes('test-mcp-secret'),false);
  const crashed=f.checkpoints.find(state=>state.phase==='model-pending'&&!state.halted);
  assert.equal((await f.create({state:crashed}).step()).reason,'producer_model_reconciliation_required');assert.equal(f.modelRequests.length,1);
});

test('read retry policy is bounded and never retries an uncertain mutation',async t=>{
  const f=await fixture(t);f.readFailures=3;
  const result=await f.create().step();assert.equal(result.reason,'producer_mcp_read_failed');
  assert.equal(f.tools.filter(tool=>tool.name==='get_broadcast_report').length,2);assert.equal(f.modelRequests.length,0);
});

test('a model response crossing the approval deadline cannot enqueue a cup',async t=>{
  const f=await fixture(t);let clock=Date.now();const actual=f.options.modelCall;
  const producer=f.create({now:()=>clock,modelCall:async(context,options)=>{
    const proposal=await actual(context,options);clock=Date.parse(f.report.broadcast.endsAt)+1;return proposal;
  }});
  assert.equal((await producer.step()).reason,'producer_session_expired_after_model');
  assert.equal(f.modelRequests.length,1);assert.equal(f.tools.some(tool=>tool.name==='host_cup'),false);
});

test('structured Responses adapter rejects model substitution, refusal/incomplete and malformed schema without fallback',async()=>{
  assert.throws(()=>createProducerModel({model:'',apiKey:'test-key'}),/producer_model_configuration_required/);
  for(const body of [
    {status:'incomplete',model,output:[]},
    {status:'completed',model:'different-model',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(hostDecision())}]}]},
    {status:'completed',model,output:[{type:'message',content:[{type:'refusal',refusal:'No'}]}]},
  ]){
    let calls=0;const adapter=createProducerModel({model,apiKey:'test-key',fetchImpl:async()=>{calls++;return json(body);}});
    await assert.rejects(adapter({}),/producer_model_outcome_unverified/);assert.equal(calls,1);
  }
});

test('CLI requires explicit model and credentials; arguments cannot pass secrets or widen tool scope',async()=>{
  const args=parseProducerArgs(['--broadcast',broadcastId,'--state','producer.json','--once']);assert.equal(args.once,true);assert.equal(args.statePath,'producer.json');
  for(const argv of [[],['--broadcast','invalid'],['--broadcast',broadcastId,'--api-key','secret'],['--broadcast',broadcastId,'--once','--once']])assert.throws(()=>parseProducerArgs(argv),/producer_invalid_arguments/);
  const result=await runBroadcastProducer(['--broadcast',broadcastId,'--once'],{env:{}});
  assert.equal(result.reason,'producer_explicit_model_and_credentials_required');
});

test('producer model transport refuses pre-aborted dispatch and independently bounds ignored fetch/body aborts',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  const stopped=createProducerModel({model,apiKey:'test-key',fetchImpl:async()=>{calls++;return json({model,status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(waitDecision())}]}]});}});
  await assert.rejects(stopped({},{signal:controller.signal}),/producer_model_outcome_unverified/);assert.equal(calls,0);
  for(const fetchImpl of [async()=>new Promise(()=>{}),async()=>new Response(new ReadableStream())]){
    const adapter=createProducerModel({model,apiKey:'test-key',timeoutMs:10,fetchImpl});
    const result=await Promise.race([adapter({}).then(()=>'accepted',()=> 'bounded'),new Promise(resolve=>setTimeout(()=>resolve('hung'),80))]);
    assert.equal(result,'bounded');
  }
});

test('approval deadline interrupts a model boundary that never settles without creating paid work',async t=>{
  const f=await fixture(t);const endsAt=new Date(Date.now()+40).toISOString();f.report.broadcast.endsAt=endsAt;f.report.approval.endsAt=endsAt;
  const producer=f.create({modelCall:async()=>new Promise(()=>{})});
  const result=await Promise.race([producer.step(),new Promise(resolve=>setTimeout(()=>resolve({status:'hung'}),150))]);
  assert.notEqual(result.status,'hung');assert.equal(f.tools.some(tool=>tool.name==='host_cup'),false);
});
