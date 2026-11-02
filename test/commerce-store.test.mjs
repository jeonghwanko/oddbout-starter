import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commerceDatabase } from './helpers/commerce-database.mjs';

const fighters = ['alpha','beta','gamma','delta'];
const future = () => new Date(Date.now() + 3_600_000).toISOString();
const approval = (extra = {}) => ({ requestKey:'approval',channelId:'channel',hostId:'current-pc',endsAt:future(),
  maxCredits:100,allowedTools:['host_cup'],fighterIds:fighters,priceVersion:'sandbox-v1',...extra });
const cup = (broadcastId, extra = {}) => ({ requestKey:'cup',broadcastId,fighterIds:fighters,priceCredits:25,priceVersion:'sandbox-v1',...extra });
const result = { winnerId:'alpha', bouts:[
  {leftId:'alpha',rightId:'beta',winnerId:'alpha',digest:'observed-one'},
  {leftId:'gamma',rightId:'delta',winnerId:'gamma',digest:'observed-two'},
  {leftId:'alpha',rightId:'gamma',winnerId:'alpha',digest:'observed-three'},
] };
const evidence=job=>({protocolVersion:1,jobId:job.id,leaseToken:job.leaseToken,seed:job.seed,winnerId:result.winnerId,
  bouts:result.bouts.map((bout,index)=>({...bout,seed:(job.seed+index)>>>0,winner:bout.winnerId===bout.leftId?0:1,
    how:'decision',ms:100,hp:[1,0],contacts:[0,0],digest:'1234abcd'}))});
async function funded(store, owner='owner', credits=200) {
  const t = await store.createTopup(owner,{requestKey:'topup',amountCents:500,credits,currency:'USD'});
  await store.attachOrder(owner,t.id,`order-${owner}`);
  await store.creditCapture(owner,t.id,{providerOrderId:`order-${owner}`,captureId:`capture-${owner}`,amountCents:500,currency:'USD',status:'COMPLETED'});
  return t;
}
async function session(store, extra={}) {
  await funded(store);
  const a = await store.approveBudget('owner',approval(extra));
  return store.startBroadcast('owner',{requestKey:'start',approvalId:a.id});
}
const rejects = (promise, code) => assert.rejects(promise, error => error.message===code);

test('provider capture transaction credits exactly once across retries and rejects changed/cross-owner evidence', async t => {
  const {db,store}=await commerceDatabase(); t.after(()=>db.close());
  const input={requestKey:'purchase',amountCents:500,credits:200,currency:'USD'};
  const topup=await store.createTopup('owner',input);
  assert.equal((await store.createTopup('owner',input)).id,topup.id);
  assert.match(topup.id,/^[a-f0-9-]{36}$/);
  await rejects(store.createTopup('owner',{...input,credits:201}),'idempotency-conflict');
  await rejects(store.findTopup('other',topup.id),'not-found');
  await store.attachOrder('owner',topup.id,'ORDER-1');
  assert.equal((await store.lookupOrder('ORDER-1')).owner,'owner');
  await rejects(store.attachOrder('owner',topup.id,'ORDER-2'),'order-conflict');
  const evidence={providerOrderId:'ORDER-1',captureId:'CAPTURE-1',amountCents:500,currency:'USD',status:'COMPLETED'};
  for (const bad of [{amountCents:501},{currency:'EUR'},{status:'APPROVED'},{providerOrderId:'ORDER-2'}])
    await rejects(store.creditCapture('owner',topup.id,{...evidence,...bad}),'capture-mismatch');
  assert.equal((await store.wallet('owner')).balanceCredits,0);
  const captures=await Promise.all(Array.from({length:8},()=>store.creditCapture('owner',topup.id,evidence)));
  assert.ok(captures.every(x=>x.captureId==='CAPTURE-1'));
  assert.equal((await store.wallet('owner')).balanceCredits,200);
  assert.equal((await db.query("select count(*)::int as n from commerce.ledger where kind='topup'")).rows[0].n,1);
  const second=await store.createTopup('other',{...input,requestKey:'other'});
  await store.attachOrder('other',second.id,'ORDER-OTHER');
  await rejects(store.creditCapture('other',second.id,{...evidence,providerOrderId:'ORDER-OTHER'}),'unique-conflict');
  assert.equal((await store.wallet('other')).balanceCredits,0);
});

test('private tables and invoker RPC deny anonymous/authenticated access; ledger is append-only', async t => {
  const {db,store}=await commerceDatabase(); t.after(()=>db.close());
  await funded(store);
  for (const role of ['anon','authenticated']) {
    await assert.rejects(db.transaction(async tx=>{
      await tx.exec(`set local role ${role}`);
      await tx.query("select public.commerce_command('owner','wallet','{}')");
    }),/permission denied/);
    await assert.rejects(db.transaction(async tx=>{
      await tx.exec(`set local role ${role}`);
      await tx.query('select * from commerce.wallets');
    }),/permission denied/);
  }
  await assert.rejects(db.query("update commerce.ledger set balance_delta=1 where owner='owner'"),/commerce:append-only/);
  await assert.rejects(db.query("delete from commerce.ledger where owner='owner'"),/commerce:append-only/);
});

test('budget is owner/channel/host/end/price bound, reserved once and cannot overspend', async t => {
  const {db,store}=await commerceDatabase(); t.after(()=>db.close());
  await funded(store);
  const input=approval();
  const a=await store.approveBudget('owner',input);
  await rejects(store.approveBudget('owner',{...input,hostId:'office-stable'}),'idempotency-conflict');
  await rejects(store.approveBudget('owner',approval({requestKey:'long',endsAt:new Date(Date.now()+25*3_600_000).toISOString()})),'invalid-input');
  await rejects(store.approveBudget('owner',approval({requestKey:'bad',hostId:'../host'})),'invalid-input');
  await rejects(store.startBroadcast('other',{requestKey:'start',approvalId:a.id}),'not-found');
  const start={requestKey:'start',approvalId:a.id};
  const starts=await Promise.all(Array.from({length:5},()=>store.startBroadcast('owner',start)));
  assert.equal(new Set(starts.map(x=>x.id)).size,1);
  const b=starts[0]; assert.equal(b.status,'queued'); assert.equal(b.hostId,'current-pc');
  assert.deepEqual(await store.wallet('owner'),{owner:'owner',balanceCredits:200,reservedCredits:100,availableCredits:100,spendingBlocked:false,blockReason:null});
  await rejects(store.startBroadcast('owner',{...start,requestKey:'another'}),'approval-used');
  const tooMuch=await store.approveBudget('owner',approval({requestKey:'too-much',channelId:'another',maxCredits:101}));
  await rejects(store.startBroadcast('owner',{requestKey:'another',approvalId:tooMuch.id}),'insufficient-credits');
  const busy=await store.approveBudget('owner',approval({requestKey:'busy'}));
  await rejects(store.startBroadcast('owner',{requestKey:'busy',approvalId:busy.id}),'channel-busy');
  await rejects(store.enqueueCup('other',cup(b.id)),'not-found');
  await rejects(store.enqueueCup('owner',cup(b.id,{fighterIds:['alpha','alpha','gamma','delta']})),'invalid-input');
  await rejects(store.enqueueCup('owner',cup(b.id,{fighterIds:['alpha','beta','gamma','outsider']})),'invalid-input');
  await rejects(store.enqueueCup('owner',cup(b.id,{priceVersion:'changed'})),'price-version-conflict');
  const allocations=await Promise.allSettled(Array.from({length:5},(_,n)=>store.enqueueCup('owner',cup(b.id,{requestKey:`cup-${n}`}))));
  assert.equal(allocations.filter(x=>x.status==='fulfilled').length,4);
  assert.equal(allocations.filter(x=>x.status==='rejected'&&x.reason.message==='insufficient-credits').length,1);
  assert.equal((await store.wallet('owner')).reservedCredits,100);
  const job=await store.enqueueCup('owner',cup(b.id,{requestKey:'cup-0'}));
  assert.equal(job.hostId,'current-pc');
  await rejects(store.enqueueCup('owner',cup(b.id,{requestKey:'cup-0',priceCredits:24})),'idempotency-conflict');
  assert.equal((await store.listJobs('owner',b.id)).length,4);
});

test('host-specific claim and fenced completion reject stale workers; verified bracket spends once', async t => {
  const {db,store}=await commerceDatabase(); t.after(()=>db.close());
  const b=await session(store);
  const queued=await store.enqueueCup('owner',cup(b.id));
  assert.equal(await store.claimJob('wrong',{hostId:'office-stable'}),null);
  const claims=await Promise.all(['worker-a','worker-b'].map(worker=>store.claimJob(worker,{hostId:'current-pc'})));
  assert.equal(claims.filter(Boolean).length,1);
  const first=claims.find(Boolean);
  await rejects(store.completeJob('intruder',{jobId:first.id,leaseToken:first.leaseToken,outcome:'failed'}),'stale-lease');
  assert.equal(first.id,queued.id); assert.equal(first.seed,queued.seed); assert.equal(first.leaseToken,1);
  await rejects(store.renewJob(first.workerId,{jobId:first.id,leaseToken:0}),'stale-lease');
  await store.renewJob(first.workerId,{jobId:first.id,leaseToken:first.leaseToken});
  const proof=evidence(first);
  const completion={jobId:first.id,leaseToken:first.leaseToken,outcome:'succeeded',result:proof};
  await rejects(store.completeJob(first.workerId,{...completion,result:{...proof,winnerId:'delta'}}),'invalid-result');
  await rejects(store.completeJob(first.workerId,{...completion,result:{...proof,bouts:proof.bouts.slice(0,2)}}),'invalid-result');
  const done=await store.completeJob(first.workerId,completion);
  assert.equal(done.status,'succeeded');
  assert.equal((await store.completeJob(first.workerId,completion)).id,done.id);
  await rejects(store.completeJob(first.workerId,{...completion,result:{...proof,note:'changed'}}),'completion-conflict');
  assert.deepEqual(await store.wallet('owner'),{owner:'owner',balanceCredits:175,reservedCredits:75,availableCredits:100,spendingBlocked:false,blockReason:null});
  const rows=(await db.query("select * from commerce.ledger where kind='spend'")).rows;
  assert.equal(rows.length,1); assert.equal(Number(rows[0].balance_delta),-25);
});

test('billing requires durable result proof bound to persisted job fence and seed, not a bracket alone',async t=>{
  const {db,store}=await commerceDatabase();t.after(()=>db.close());const b=await session(store);
  await store.enqueueCup('owner',cup(b.id));const claim=await store.claimJob('worker',{hostId:'current-pc'});
  await rejects(store.completeJob('worker',{jobId:claim.id,leaseToken:claim.leaseToken,outcome:'succeeded',result}),'invalid-result');
  const proof=evidence(claim);
  for(const mutate of [p=>{p.protocolVersion=null;},p=>{p.jobId='00000000-0000-4000-8000-000000000000';},
    p=>{p.leaseToken++;},p=>{p.seed++;},p=>{p.bouts[0].seed=null;},p=>{p.bouts[0].winner=1;},
    p=>{p.bouts[0].digest=null;},p=>{p.bouts[0].digest=12345678;},p=>{p.bouts[0].ms=null;},
    p=>{p.bouts[0].ms=-1;},p=>{p.bouts[0].hp=[null,0];},p=>{p.bouts[0].hp=[2,0];},
    p=>{p.bouts[0].contacts=[0.5,0];},p=>{p.bouts[0].contacts=[-1,0];},p=>{p.winnerId=null;}]){
    const invalid=structuredClone(proof);mutate(invalid);
    await rejects(store.completeJob('worker',{jobId:claim.id,leaseToken:claim.leaseToken,outcome:'succeeded',result:invalid}),'invalid-result');
  }
  assert.equal((await store.wallet('owner')).balanceCredits,200);
  assert.equal((await store.getJob('owner',claim.id)).status,'running');
  await store.completeJob('worker',{jobId:claim.id,leaseToken:claim.leaseToken,outcome:'succeeded',result:proof});
  assert.equal((await store.wallet('owner')).balanceCredits,175);
});

test('expired running jobs quarantine without replay, block their host slot and leave other hosts available',async t=>{
  const {db,store}=await commerceDatabase();t.after(()=>db.close());
  const b=await session(store);
  const first=await store.enqueueCup('owner',cup(b.id));
  await store.enqueueCup('owner',cup(b.id,{requestKey:'later-same-session'}));
  const claim=await store.claimJob('original',{hostId:'current-pc'});assert.equal(claim.id,first.id);
  const a=await store.approveBudget('owner',approval({requestKey:'unrelated',channelId:'unrelated',maxCredits:50,hostId:'office-stable'}));
  const unrelated=await store.startBroadcast('owner',{requestKey:'unrelated',approvalId:a.id});
  const other=await store.enqueueCup('owner',cup(unrelated.id,{requestKey:'unrelated'}));
  await db.query("update commerce.jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1",[claim.id]);
  assert.equal(await store.claimJob('other-worker',{hostId:'current-pc'}),null);
  const next=await store.claimJob('office-worker',{hostId:'office-stable'});assert.equal(next.id,other.id);assert.notEqual(next.id,claim.id);
  assert.equal(await store.claimJob('third-worker',{hostId:'current-pc'}),null);
  const quarantined=await store.getJob('owner',claim.id);assert.equal(quarantined.status,'unknown');assert.equal(quarantined.leaseToken,claim.leaseToken);
  assert.equal(quarantined.result.reason,'lease-expired-outcome-unknown');
  await rejects(store.completeJob('original',{jobId:claim.id,leaseToken:claim.leaseToken,outcome:'succeeded',result}),'stale-lease');
  const stopped=await store.stopBroadcast('owner',b.id);assert.equal(stopped.reservedCredits,25);assert.equal(stopped.status,'stopping');
  assert.equal((await store.wallet('owner')).balanceCredits,200);assert.equal((await store.wallet('owner')).reservedCredits,75);
});

test('reports quarantine expired running jobs in already stopped and ended sessions while retaining their funds',async t=>{
  const {db,store}=await commerceDatabase();t.after(()=>db.close());
  const stopped=await session(store);await store.enqueueCup('owner',cup(stopped.id));
  const first=await store.claimJob('first',{hostId:'current-pc'});await store.stopBroadcast('owner',stopped.id);
  await db.query("update commerce.jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1",[first.id]);
  let report=await store.report('owner',stopped.id);assert.equal(report.jobs[0].status,'unknown');assert.equal(report.remainingReservedCredits,25);
  const a=await store.approveBudget('owner',approval({requestKey:'ended',channelId:'ended',hostId:'office-stable'}));
  const ended=await store.startBroadcast('owner',{requestKey:'ended',approvalId:a.id});
  await store.enqueueCup('owner',cup(ended.id,{requestKey:'ended'}));const second=await store.claimJob('second',{hostId:'office-stable'});
  await db.query("update commerce.jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1",[second.id]);
  await db.query("update commerce.broadcasts set ends_at=clock_timestamp()-interval '1 second' where id=$1",[ended.id]);
  report=await store.report('owner',ended.id);assert.equal(report.jobs[0].status,'unknown');assert.equal(report.broadcast.status,'stopping');
  assert.equal(report.remainingReservedCredits,25);
  await store.stopBroadcast('owner',ended.id);assert.equal((await store.wallet('owner')).reservedCredits,50);assert.equal((await store.wallet('owner')).balanceCredits,200);
});

test('operator channel labels are owner scoped while each physical host has one running slot across accounts and sessions',async t=>{
  const {db,store}=await commerceDatabase();t.after(()=>db.close());
  await funded(store,'owner');await funded(store,'other');
  const jobs=[];
  for(const owner of ['owner','other']){
    const approved=await store.approveBudget(owner,approval({channelId:'same-unverified-label'}));
    const b=await store.startBroadcast(owner,{requestKey:'start',approvalId:approved.id});
    jobs.push(await store.enqueueCup(owner,cup(b.id)));
    assert.equal((await store.report(owner,b.id)).channelIdentity,'operator-label-unverified');
  }
  const first=await store.claimJob('worker-a',{hostId:'current-pc'});
  assert.ok(jobs.some(job=>job.id===first.id));
  const waiting=jobs.find(job=>job.id!==first.id);
  await assert.rejects(db.query("update commerce.jobs set status='running' where id=$1",[waiting.id]),/commerce_one_unresolved_host/);
  assert.equal(await store.claimJob('worker-b',{hostId:'current-pc'}),null);
  await store.completeJob('worker-a',{jobId:first.id,leaseToken:first.leaseToken,outcome:'failed'});
  const second=await store.claimJob('worker-b',{hostId:'current-pc'});
  assert.notEqual(second.id,first.id);assert.ok(jobs.some(job=>job.id===second.id));
});

test('stop releases queued/unallocated funds, retains active allocation and settles only confirmed outcomes', async t => {
  const {db,store}=await commerceDatabase(); t.after(()=>db.close());
  const b=await session(store);
  const active=await store.enqueueCup('owner',cup(b.id));
  const queued=await store.enqueueCup('owner',cup(b.id,{requestKey:'later'}));
  const claim=await store.claimJob('worker',{hostId:'current-pc'});
  assert.equal(claim.id,active.id);
  const stopping=await store.stopBroadcast('owner',b.id);
  assert.equal(stopping.status,'stopping'); assert.equal(stopping.reservedCredits,25);
  assert.equal((await store.getJob('owner',queued.id)).status,'failed');
  await rejects(store.enqueueCup('owner',cup(b.id,{requestKey:'after-stop'})),'broadcast-stopped');
  await rejects(store.renewJob('worker',{jobId:claim.id,leaseToken:claim.leaseToken}),'broadcast-stopped');
  await store.stopBroadcast('owner',b.id);
  assert.equal((await store.wallet('owner')).reservedCredits,25);
  await store.completeJob('worker',{jobId:claim.id,leaseToken:claim.leaseToken,outcome:'failed',result:{reason:'confirmed-runner-failure'}});
  assert.deepEqual(await store.wallet('owner'),{owner:'owner',balanceCredits:200,reservedCredits:0,availableCredits:200,spendingBlocked:false,blockReason:null});
  const report=await store.report('owner',b.id);
  assert.equal(report.broadcast.status,'completed'); assert.equal(report.confirmedSpentCredits,0);
  assert.deepEqual(report.approval.fighterIds,fighters);
  assert.deepEqual(report.approval.allowedTools,['host_cup']);
  assert.equal(report.approval.hostId,'current-pc');
  assert.equal(report.approval.priceVersion,'sandbox-v1');
  assert.equal(report.approval.maxCredits,100);
  assert.equal(Object.hasOwn(report.approval,'input'),false);
  assert.equal(report.broadcastObservation.liveSeconds,null);
  assert.equal(report.ledger.filter(x=>x.kind==='release').reduce((n,x)=>n-x.reservedDelta,0),100);
  assert.deepEqual(await store.report('owner',b.id),report);
  await rejects(store.report('other',b.id),'not-found');
});

test('confirmed failure reallocates within envelope; unknown outcomes and expired leases never refund or claim success', async t => {
  const {db,store}=await commerceDatabase(); t.after(()=>db.close());
  const b=await session(store);
  await store.enqueueCup('owner',cup(b.id,{priceCredits:100}));
  let claim=await store.claimJob('worker',{hostId:'current-pc'});
  await store.completeJob('worker',{jobId:claim.id,leaseToken:claim.leaseToken,outcome:'failed'});
  await store.enqueueCup('owner',cup(b.id,{requestKey:'retry-new-logical-cup',priceCredits:100}));
  claim=await store.claimJob('worker',{hostId:'current-pc'});
  await store.completeJob('worker',{jobId:claim.id,leaseToken:claim.leaseToken,outcome:'unknown',result:{reason:'browser-result-not-observed'}});
  assert.equal(await store.claimJob('another',{hostId:'current-pc'}),null);
  const stopped=await store.stopBroadcast('owner',b.id);
  assert.equal(stopped.reservedCredits,100); assert.equal(stopped.status,'stopping');
  await db.query("update commerce.jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1",[claim.id]);
  await rejects(store.completeJob('worker',{jobId:claim.id,leaseToken:claim.leaseToken,outcome:'failed'}),'stale-lease');
  assert.equal((await store.wallet('owner')).reservedCredits,100);
  assert.equal((await store.report('owner',b.id)).confirmedSpentCredits,0);
});

test('approval end boundary rejects new work and renewals; unstarted queued work can safely stop', async t => {
  const {db,store}=await commerceDatabase(); t.after(()=>db.close());
  const b=await session(store);
  await store.enqueueCup('owner',cup(b.id));
  const claim=await store.claimJob('worker',{hostId:'current-pc'});
  await db.query("update commerce.broadcasts set ends_at=clock_timestamp()-interval '1 second' where id=$1",[b.id]);
  await rejects(store.enqueueCup('owner',cup(b.id,{requestKey:'expired'})),'approval-expired');
  await rejects(store.renewJob('worker',{jobId:claim.id,leaseToken:claim.leaseToken}),'broadcast-stopped');
  await rejects(store.completeJob('worker',{jobId:claim.id,leaseToken:claim.leaseToken,outcome:'succeeded',result}),'approval-expired');
  assert.equal(await store.claimJob('other',{hostId:'current-pc'}),null);
  await store.stopBroadcast('owner',b.id);
  assert.equal((await store.wallet('owner')).reservedCredits,25);
  // The current fenced worker can still confirm failure; it cannot claim a late successful service.
  await store.completeJob('worker',{jobId:claim.id,leaseToken:claim.leaseToken,outcome:'failed'});
  assert.equal((await store.wallet('owner')).reservedCredits,0);
  assert.equal((await store.wallet('owner')).balanceCredits,200);
});

test('distinct concurrent sessions compete for available credits and a stopped successful cup settles exactly once', async t => {
  const {db,store}=await commerceDatabase(); t.after(()=>db.close());
  await funded(store,'owner',150);
  const approvals=await Promise.all(['one','two'].map(key=>store.approveBudget('owner',approval({requestKey:key,channelId:key}))));
  const starts=await Promise.allSettled(approvals.map(a=>store.startBroadcast('owner',{requestKey:a.requestKey,approvalId:a.id})));
  assert.equal(starts.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(starts.filter(x=>x.status==='rejected'&&x.reason.message==='insufficient-credits').length,1);
  const b=starts.find(x=>x.status==='fulfilled').value;
  await store.enqueueCup('owner',cup(b.id));
  const job=await store.claimJob('worker',{hostId:'current-pc'});
  await store.stopBroadcast('owner',b.id);
  const complete={jobId:job.id,leaseToken:job.leaseToken,outcome:'succeeded',result:evidence(job)};
  await store.completeJob('worker',complete);
  await store.completeJob('worker',complete);
  await store.stopBroadcast('owner',b.id);
  assert.deepEqual(await store.wallet('owner'),{owner:'owner',balanceCredits:125,reservedCredits:0,availableCredits:125,spendingBlocked:false,blockReason:null});
  const totals=(await db.query("select sum(balance_delta)::text as balance,sum(reserved_delta)::text as reserved from commerce.ledger where owner='owner'")).rows[0];
  assert.deepEqual(totals,{balance:'125',reserved:'0'});
  const report=await store.report('owner',b.id);
  assert.equal(report.confirmedSpentCredits,25);
  assert.equal(report.broadcast.status,'completed');
  assert.equal(report.ledger.filter(x=>x.kind==='spend').length,1);
});

test('stopping an expired unstarted session refunds all reservations and never reports verified live time', async t => {
  const {db,store}=await commerceDatabase(); t.after(()=>db.close());
  const b=await session(store);
  await store.enqueueCup('owner',cup(b.id));
  await db.query("update commerce.broadcasts set ends_at=clock_timestamp()-interval '1 second' where id=$1",[b.id]);
  assert.equal(await store.claimJob('worker',{hostId:'current-pc'}),null);
  await store.stopBroadcast('owner',b.id);
  assert.deepEqual(await store.wallet('owner'),{owner:'owner',balanceCredits:200,reservedCredits:0,availableCredits:200,spendingBlocked:false,blockReason:null});
  const report=await store.report('owner',b.id);
  assert.equal(report.jobs[0].status,'failed');
  assert.deepEqual(report.broadcastObservation,{status:'unverified',liveSeconds:null});
  const totals=(await db.query("select sum(balance_delta)::text as balance,sum(reserved_delta)::text as reserved from commerce.ledger where owner='owner'")).rows[0];
  assert.deepEqual(totals,{balance:'200',reserved:'0'});
});

test('observing an expired session automatically releases queued and unused credits, persists a final honest report and is idempotent',async t=>{
  const {db,store}=await commerceDatabase();t.after(()=>db.close());
  const b=await session(store);await store.enqueueCup('owner',cup(b.id));
  await db.query("update commerce.broadcasts set ends_at=clock_timestamp()-interval '1 second' where id=$1",[b.id]);
  const report=await store.report('owner',b.id);
  assert.equal(report.broadcast.status,'completed');assert.equal(report.remainingReservedCredits,0);assert.equal(report.confirmedSpentCredits,0);
  assert.equal(report.jobs[0].status,'failed');assert.equal(report.jobs[0].result.reason,'approval-expired-before-execution');
  assert.deepEqual(report.broadcastObservation,{status:'unverified',liveSeconds:null});
  assert.deepEqual(await store.wallet('owner'),{owner:'owner',balanceCredits:200,reservedCredits:0,availableCredits:200,spendingBlocked:false,blockReason:null});
  assert.deepEqual(await store.report('owner',b.id),report);
  assert.equal(report.ledger.filter(x=>x.kind==='release').reduce((sum,x)=>sum-x.reservedDelta,0),100);
  assert.equal((await db.query("select count(*)::int as n from commerce.ledger where kind='release' and broadcast_id=$1",[b.id])).rows[0].n,1);
});

test('deadline expiry releases only queued/unallocated credits while unknown execution remains reserved without manual Stop',async t=>{
  const {db,store}=await commerceDatabase();t.after(()=>db.close());
  const b=await session(store);const active=await store.enqueueCup('owner',cup(b.id));
  await store.enqueueCup('owner',cup(b.id,{requestKey:'later'}));
  const claim=await store.claimJob('original',{hostId:'current-pc'});assert.equal(claim.id,active.id);
  await db.query("update commerce.broadcasts set ends_at=clock_timestamp()-interval '1 second' where id=$1",[b.id]);
  const report=await store.report('owner',b.id);
  assert.equal(report.broadcast.status,'stopping');assert.equal(report.remainingReservedCredits,25);
  assert.equal(report.jobs.find(x=>x.id===active.id).status,'unknown');
  assert.equal(report.jobs.filter(x=>x.status==='failed').length,1);
  assert.deepEqual(await store.wallet('owner'),{owner:'owner',balanceCredits:200,reservedCredits:25,availableCredits:175,spendingBlocked:false,blockReason:null});
  assert.equal(await store.claimJob('replacement',{hostId:'current-pc'}),null);
  await store.report('owner',b.id);await store.wallet('owner');
  assert.equal((await db.query("select sum(reserved_delta)::text as n from commerce.ledger where kind='release' and broadcast_id=$1",[b.id])).rows[0].n,'-75');
});

test('bounded expiry cleanup drains a queue beyond one batch without starving the final allocation or releasing unknown work',async t=>{
  const {db,store}=await commerceDatabase();t.after(()=>db.close());await funded(store,'owner',5000);
  const a=await store.approveBudget('owner',approval({maxCredits:5000}));
  const b=await store.startBroadcast('owner',{requestKey:'start',approvalId:a.id});
  for(let n=0;n<102;n++)await store.enqueueCup('owner',cup(b.id,{requestKey:`cup-${n}`}));
  const active=await store.claimJob('original',{hostId:'current-pc'});
  await db.query("update commerce.broadcasts set ends_at=clock_timestamp()-interval '1 second' where id=$1",[b.id]);
  const first=await store.report('owner',b.id);assert.equal(first.remainingReservedCredits,50);
  assert.equal(first.jobs.filter(job=>job.status==='queued').length,1);assert.equal(first.jobs.find(job=>job.id===active.id).status,'unknown');
  const after=await store.wallet('owner');assert.equal(after.reservedCredits,25);assert.equal(after.balanceCredits,5000);
  const final=await store.report('owner',b.id);assert.equal(final.jobs.filter(job=>job.status==='queued').length,0);assert.equal(final.remainingReservedCredits,25);
  assert.equal((await db.query("select sum(reserved_delta)::text as n from commerce.ledger where kind='release' and broadcast_id=$1",[b.id])).rows[0].n,'-4975');
});

test('failed business commands roll back expiry housekeeping atomically; a successful read then finalizes it exactly once',async t=>{
  const {db,store}=await commerceDatabase();t.after(()=>db.close());const b=await session(store);
  await store.enqueueCup('owner',cup(b.id));
  await db.query("update commerce.broadcasts set ends_at=clock_timestamp()-interval '1 second' where id=$1",[b.id]);
  await rejects(store.enqueueCup('owner',cup(b.id,{requestKey:'after-expiry'})),'approval-expired');
  assert.equal((await db.query('select reserved_credits::text as n from commerce.broadcasts where id=$1',[b.id])).rows[0].n,'100');
  assert.equal((await store.wallet('owner')).reservedCredits,0);
  assert.equal((await store.report('owner',b.id)).broadcast.status,'completed');
  assert.equal((await db.query("select count(*)::int as n from commerce.ledger where kind='release' and broadcast_id=$1",[b.id])).rows[0].n,1);
});

test('adjustment event identity cannot be reused to freeze another capture owner and its audit is append only',async t=>{
  const {db,store}=await commerceDatabase();t.after(()=>db.close());await funded(store,'owner');await funded(store,'other');
  const event={eventId:'REFUND-1',eventType:'PAYMENT.CAPTURE.REFUNDED',captureId:'capture-owner',providerOrderId:'order-owner'};
  const adjustments=await Promise.all([store.recordPaymentAdjustment(event),store.recordPaymentAdjustment(event)]);
  assert.equal(adjustments[0].topupId,adjustments[1].topupId);
  await rejects(store.recordPaymentAdjustment({...event,captureId:'capture-other',providerOrderId:'order-other'}),'idempotency-conflict');
  assert.equal((await store.wallet('owner')).spendingBlocked,true);assert.equal((await store.wallet('other')).spendingBlocked,false);
  await assert.rejects(db.query("update commerce.payment_adjustments set status='needs_reconciliation' where event_id='REFUND-1'"),/commerce:append-only/);
  await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query('select * from commerce.payment_adjustments');}),/permission denied/);
  assert.equal((await db.query('select count(*)::int as n from commerce.payment_adjustments')).rows[0].n,1);
});

test('verified refund before order linkage is durably retained and freezes the eventual exact capture atomically',async t=>{
  const {db,store}=await commerceDatabase();t.after(()=>db.close());
  const event={eventId:'EARLY-REFUND',eventType:'PAYMENT.CAPTURE.REFUNDED',captureId:'EARLY-CAPTURE',providerOrderId:'EARLY-ORDER'};
  const pending=await store.recordPaymentAdjustment(event);assert.equal(pending.status,'pending_link');
  assert.equal((await store.recordPaymentAdjustment(event)).status,'pending_link');
  const topup=await store.createTopup('early-owner',{requestKey:'early-topup',amountCents:500,credits:200,currency:'USD'});
  await store.attachOrder('early-owner',topup.id,'EARLY-ORDER');
  assert.equal((await store.wallet('early-owner')).spendingBlocked,false);
  await store.creditCapture('early-owner',topup.id,{providerOrderId:'EARLY-ORDER',captureId:'EARLY-CAPTURE',amountCents:500,currency:'USD',status:'COMPLETED'});
  const wallet=await store.wallet('early-owner');assert.equal(wallet.balanceCredits,200);assert.equal(wallet.spendingBlocked,true);
  assert.equal((await db.query('select count(*)::int as n from commerce.payment_adjustment_inbox')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int as n from commerce.payment_adjustments')).rows[0].n,1);
  await rejects(store.approveBudget('early-owner',approval()),'wallet-frozen');
});

test('pending adjustment with a conflicting order cannot assign or freeze the eventual capture owner',async t=>{
  const {db,store}=await commerceDatabase();t.after(()=>db.close());
  await store.recordPaymentAdjustment({eventId:'WRONG-ORDER-EARLY',eventType:'PAYMENT.CAPTURE.REVERSED',captureId:'CAPTURE-LATER',providerOrderId:'ORDER-OTHER'});
  const topup=await store.createTopup('actual-owner',{requestKey:'actual',amountCents:500,credits:200,currency:'USD'});
  await store.attachOrder('actual-owner',topup.id,'ACTUAL-ORDER');
  await store.creditCapture('actual-owner',topup.id,{providerOrderId:'ACTUAL-ORDER',captureId:'CAPTURE-LATER',amountCents:500,currency:'USD',status:'COMPLETED'});
  assert.equal((await store.wallet('actual-owner')).spendingBlocked,false);
  assert.equal((await db.query('select count(*)::int as n from commerce.payment_adjustments')).rows[0].n,0);
  for(const change of [{eventId:null},{eventId:123},{captureId:123},{providerOrderId:null}])await assert.rejects(store.recordPaymentAdjustment({eventId:'BAD-TYPE',eventType:'PAYMENT.CAPTURE.REVERSED',captureId:'CAPTURE-LATER',...change}));
  await assert.rejects(db.query("delete from commerce.payment_adjustment_inbox where event_id='WRONG-ORDER-EARLY'"),/commerce:append-only/);
  await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query('select * from commerce.payment_adjustment_inbox');}),/permission denied/);
});
