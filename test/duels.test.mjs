import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,sha256} from '../api/handler.mjs';
import {migratedDatabase} from './helpers/fighter-database.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with {type:'json'};

/** Two duel-approved, entered fighters in a migrated PGlite, and a db adapter shaped like the Supabase client. */
async function duelFixture() {
  // The shared platform stand-in, so a migration needing a new auth column (client_name) is added once, and its safeupdate replay.
  const sql=await migratedDatabase();
  const ids=[]; const manifestText=JSON.stringify(example),hash=await sha256(new TextEncoder().encode(manifestText));
  for(const name of ['A','B']) {
    const owner=crypto.randomUUID(),sub=crypto.randomUUID(),id=crypto.randomUUID();ids.push(id);
    await sql.query('insert into auth.users values($1)',[owner]);await sql.query('insert into af_creators(owner_id) values($1)',[owner]);
    await sql.query(`insert into af_submissions(id,owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes,status)
      values($1,$2,$3,$4,$5,$6,1,'registered')`,[sub,owner,crypto.randomUUID(),manifestText,example,hash]);
    await sql.query(`insert into af_fighters(id,submission_id,owner_id,manifest_sha,profile,review_state,runtime_approved,runtime_scope,runtime_manifest_sha,review_evidence,duel_approved,duel_manifest_sha,entered_at)
      values($1,$2,$3,$4,$5,'approved',true,'arena-player-v1',$4,$6,true,$4,now())`,[id,sub,owner,hash,name==='A'?{name,names:{ko:'에이'}}:{name},{authorization:'test',validation:'test',duelValidation:'test'}]);
  }
  const functions={af_reserve_duel:['p_key','p_a','p_b','p_engine'],af_complete_duel:['p_id','p_engine','p_result'],af_fail_duel:['p_id','p_engine','p_code'],af_duel_rankings:[]};
  const db={rpc:async(name,args)=>{try {
    const values=functions[name].map(k=>args[k]);
    const q=name==='af_duel_rankings'?'select * from af_duel_rankings()':`select to_jsonb(public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')})) as value`;
    const r=await sql.query(q,values);return {data:name==='af_duel_rankings'?r.rows:r.rows[0].value};
  }catch(error){return {error};}},from:table=>{
    assert.ok(['af_fighters','af_submissions','af_duels'].includes(table));const filters=[],values=[];
    const q={select:()=>q,eq:(k,v)=>{assert.match(k,/^\w+$/);values.push(v);filters.push(`${k}=$${values.length}`);return q;},
      not:(k)=>{assert.equal(k,'completed_at');filters.push('completed_at is not null');return q;},
      in:(k,v)=>{assert.match(k,/^\w+$/);values.push(v);filters.push(`${k}=any($${values.length})`);return q;},
      then:(resolve,reject)=>sql.query(`select * from ${table} where ${filters.join(' and ')}`,values).then(r=>({data:r.rows}),error=>({error})).then(resolve,reject),
      maybeSingle:async()=>({data:(await sql.query(`select * from ${table} where ${filters.join(' and ')}`,values)).rows[0]??null})};return q;
  }};
  return {sql,db,ids};
}

test('server matches: immutable result, atomic pair records, retries, budgets, admission and denied direct writes',async()=>{
  const {sql,db,ids}=await duelFixture();
  try {
    let calls=0;
    const result={winner:0,how:'ko',ms:1000,hp:[0.5,0],contacts:[3,1],digest:'1234abcd'};
    const handle=createHandler({db,engineVersion:'test-v1',simulateDuel:(a,ma,b,mb,seed)=>{
      calls++;assert.equal(a,ids[0]);assert.equal(b,ids[1]);assert.deepEqual(ma,example);assert.deepEqual(mb,example);
      assert.ok(seed>=0&&seed<=0xffffffff);return result;
    }});
    const body={a:ids[0],b:ids[1],idempotencyKey:crypto.randomUUID()};
    const post=(b=body)=>handle(new Request('https://test/ai-fighter/duels',{method:'POST',body:JSON.stringify(b)}));
    for(const extra of [{winner:1},{seed:42},{result},{manifest:{}}]) assert.equal((await post({...body,...extra})).status,422);
    assert.equal((await post({...body,manifest:example})).status,413);
    assert.equal((await post({...body,b:body.a})).status,422);
    const attempts=await Promise.all(Array.from({length:4},()=>post()));
    for(const r of attempts) assert.equal(r.status,200);
    const matches=await Promise.all(attempts.map(x=>x.json()));const match=matches[0].match;
    assert.ok(matches.every(x=>x.match.id===match.id));assert.equal('request_key' in match,false);
    assert.equal((await sql.query('select count(*)::int as n from af_duels')).rows[0].n,1);
    const rank=await (await handle(new Request('https://test/ai-fighter/rankings'))).json();
    assert.deepEqual(rank.rankings.map(x=>[x.name,Number(x.won),Number(x.lost),Number(x.points)]),[['A',1,0,3],['B',0,1,0]]);
    assert.deepEqual(rank.rankings.map(x=>x.names??null),[{ko:'에이'},null]);
    const callsBefore=calls;assert.equal((await post()).status,200);assert.equal(calls,callsBefore);
    assert.equal((await post({...body,a:body.b,b:body.a})).status,409);
    const read=await (await handle(new Request(`https://test/ai-fighter/duels/${match.id}`))).json();assert.equal(read.match.id,match.id);
    await assert.rejects(sql.query('select af_complete_duel($1,$2,$3)',[match.id,'test-v1',{...result,winner:1}]),/result-conflict/);
    await sql.query('update af_fighters set duel_approved=false,duel_manifest_sha=null where id=$1',[body.b]);
    assert.equal((await post({...body,idempotencyKey:crypto.randomUUID()})).status,409);
    await sql.query('update af_fighters set duel_approved=true,duel_manifest_sha=manifest_sha where id=$1',[body.b]);
    for(let i=1;i<20;i++) assert.equal((await post({...body,idempotencyKey:crypto.randomUUID()})).status,200);
    assert.equal((await post({...body,idempotencyKey:crypto.randomUUID()})).status,429);
    assert.equal((await post()).status,200); // Retries do not consume a budget slot.
    for(const role of ['anon','authenticated']) {
      await sql.exec(`set role ${role}`);
      await assert.rejects(sql.query('select af_reserve_duel($1,$2,$3,$4)',[crypto.randomUUID(),...ids,'test-v1']),/permission denied/);
      await assert.rejects(sql.query('select af_complete_duel($1,$2,$3)',[match.id,'test-v1',result]),/permission denied/);
      await assert.rejects(sql.query('update af_duels set result=$1',[result]),/permission denied/);
      await assert.rejects(sql.query('select * from af_duels'),/permission denied/);
      await sql.exec('reset role');
    }
    assert.equal((await createHandler({db})(new Request('https://test/ai-fighter/duels',{method:'POST',body:JSON.stringify(body)}))).status,503);
  } finally {await sql.close();}
});

test('a failed run leaves the match budget, retries can finish it, and repeated failures stop new runs',async()=>{
  const {sql,db,ids}=await duelFixture();
  try {
    const result={winner:1,how:'decision',ms:90000,hp:[0.2,0.4],contacts:[2,5],digest:'abcd1234'};
    let broken=true;
    const handle=createHandler({db,engineVersion:'test-v1',simulateDuel:()=>{ if(broken) throw new Error('engine crashed'); return result; }});
    const post=key=>handle(new Request('https://test/ai-fighter/duels',{method:'POST',body:JSON.stringify({a:ids[0],b:ids[1],idempotencyKey:key})}));
    const first=crypto.randomUUID();
    const failed=await post(first);
    assert.equal(failed.status,503); assert.equal((await failed.json()).code,'duel-engine-failed');
    const row=(await sql.query('select failed_at is not null as failed,failures,failure,result from af_duels where request_key=$1',[first])).rows[0];
    assert.deepEqual(row,{failed:true,failures:1,failure:'engine-error',result:null});
    // Failed runs do not spend the pair budget of 20: 19 more failures still leave room for real matches.
    for(let i=0;i<18;i++) assert.equal((await post(crypto.randomUUID())).status,503);
    broken=false;
    const retried=await post(first);
    assert.equal(retried.status,200);
    assert.deepEqual((await sql.query('select failed_at,failure from af_duels where request_key=$1',[first])).rows[0],{failed_at:null,failure:null});
    for(let i=0;i<19;i++) assert.equal((await post(crypto.randomUUID())).status,200);
    assert.equal((await post(crypto.randomUUID())).status,429);
    // The brake: 20 failed runs in a day stop new runs and retries of unfinished ones.
    await sql.query("update af_duels set failed_at=now(),failures=20,failure='engine-error' where request_key=(select request_key from af_duels where result is null limit 1)");
    const braked=await post(crypto.randomUUID());
    assert.equal(braked.status,503); assert.equal((await braked.json()).code,'duels-failing');
    assert.equal((await post(first)).status,200); // A finished match is still returned.
  } finally {await sql.close();}
});

test('a page plays the engine it names when the server keeps it; any other name plays the current engine',async()=>{
  const {sql,db,ids}=await duelFixture();
  try {
    const result=engine=>({winner:0,how:'ko',ms:1000,hp:[0.5,0],contacts:[3,1],digest:engine==='test-v1'?'11111111':'00000000'});
    const ran=[];
    const engines={'test-v0':()=>{ran.push('test-v0');return result('test-v0');},'bad name!':()=>result('x'),'test-v2':'not a function'};
    const handle=createHandler({db,engineVersion:'test-v1',simulateDuel:()=>{ran.push('test-v1');return result('test-v1');},engines,release:'rel-0123456789ab'});
    const post=query=>handle(new Request(`https://test/ai-fighter/duels${query}`,{method:'POST',body:JSON.stringify({a:ids[0],b:ids[1],idempotencyKey:crypto.randomUUID()})}));
    const engineOf=async response=>{assert.equal(response.status,200);return (await response.json()).match.engine;};
    assert.equal(await engineOf(await post('?engine=test-v0')),'test-v0');
    for(const query of ['','?engine=test-v1','?engine=test-v9','?engine=bad%20name!','?engine=test-v2']) assert.equal(await engineOf(await post(query)),'test-v1');
    assert.deepEqual(ran,['test-v0','test-v1','test-v1','test-v1','test-v1','test-v1']);
    const rank=await (await handle(new Request('https://test/ai-fighter/rankings'))).json();
    assert.equal(rank.engine,'test-v1'); assert.deepEqual(rank.engines,['test-v1','test-v0']); assert.equal(rank.release,'rel-0123456789ab');
    // A retry under another engine's name returns the stored match on its own engine (the page lets go of the key).
    const key=crypto.randomUUID(),body=JSON.stringify({a:ids[0],b:ids[1],idempotencyKey:key});
    await handle(new Request('https://test/ai-fighter/duels?engine=test-v0',{method:'POST',body}));
    assert.equal(await engineOf(await handle(new Request('https://test/ai-fighter/duels',{method:'POST',body}))),'test-v0');
  } finally {await sql.close();}
});

test('an abandoned reservation stops holding the duel budget; a recent unfinished one still counts',async t=>{
  // The pair budget counts today's matches (UTC); a six-minute-old reservation is still today only after 00:06.
  const now=new Date();
  if(now.getUTCHours()===0 && now.getUTCMinutes()<6) return t.skip('within six minutes of UTC midnight');
  const {sql,ids}=await duelFixture();
  try {
    const reserve=()=>sql.query('select (af_reserve_duel($1,$2,$3,$4)).id',[crypto.randomUUID(),ids[0],ids[1],'test-v1']);
    // Twenty reservations whose Edge run was killed before it completed or failed.
    for(let i=0;i<20;i++) await reserve();
    await assert.rejects(reserve(),/duel-budget/,'in flight within five minutes: the pair budget is held');
    await sql.query("update af_duels set created_at=now()-interval '6 minutes'");
    await reserve(); // Abandoned after five minutes: no longer in flight.
    assert.equal((await sql.query('select count(*)::int as n from af_duels where result is null and failed_at is null')).rows[0].n,21,
      'abandoned rows are kept for their key retries, only uncounted');
  } finally {await sql.close();}
});

test('a retried unfinished match is admitted again, and runs refused for their fighters never trip the day\'s brake (API 점검 2026-10-29)',async()=>{
  const {sql,db,ids}=await duelFixture();
  try {
    let runs=0;
    const handle=createHandler({db,engineVersion:'test-v1',simulateDuel:()=>{runs++;return {winner:0,how:'ko',ms:1000,hp:[0.5,0],contacts:[3,1],digest:'11111111'};}});
    const post=key=>handle(new Request('https://test/ai-fighter/duels',{method:'POST',body:JSON.stringify({a:ids[0],b:ids[1],idempotencyKey:key})}));
    // A match reserved, then its fighter edited before it ran (the owner controls that window).
    const key=crypto.randomUUID();
    await sql.query('select public.af_reserve_duel($1,$2,$3,$4)',[key,ids[0],ids[1],'test-v1']);
    const text=JSON.stringify({...example,profile:{...example.profile,name:'Edited'}}),hash=await sha256(new TextEncoder().encode(text)),sub=crypto.randomUUID();
    const owner=(await sql.query('select owner_id from af_fighters where id=$1',[ids[0]])).rows[0].owner_id;
    await sql.query(`insert into af_submissions(id,owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes,status) values($1,$2,$3,$4,$5,$6,1,'registered')`,
      [sub,owner,crypto.randomUUID(),text,JSON.parse(text),hash]);
    await sql.query('update af_fighters set submission_id=$2,manifest_sha=$3,runtime_manifest_sha=$3,duel_manifest_sha=$3 where id=$1',[ids[0],sub,hash]);
    for(let i=0;i<21;i++) {
      const retried=await post(key);
      assert.deepEqual([retried.status,(await retried.json()).code],[409,'duel-not-approved']);
    }
    assert.equal(runs,0);
    assert.deepEqual((await sql.query('select failures,failed_at from af_duels where request_key=$1',[key])).rows[0],{failures:0,failed_at:null});
    // A new match on the edited fighter still runs.
    assert.equal((await post(crypto.randomUUID())).status,200); assert.equal(runs,1);
    // Runs refused for their fighters are the fighters' own; only the engine's failures count toward the brake.
    await sql.query("update af_duels set failed_at=now(),failures=20,failure='package-mismatch' where request_key=$1",[key]);
    assert.equal((await post(crypto.randomUUID())).status,200);
    await sql.query("update af_duels set failure='engine-error' where request_key=$1",[key]);
    assert.equal((await (await post(crypto.randomUUID())).json()).code,'duels-failing');
  } finally {await sql.close();}
});

test('a fighter in production (not entered, 2026-10-30) neither meets other people in ranked duels nor holds a ranking place',async()=>{
  const {sql,db,ids}=await duelFixture();
  try {
    const result={winner:0,how:'ko',ms:1000,hp:[0.5,0],contacts:[3,1],digest:'1234abcd'};
    const handle=createHandler({db,engineVersion:'test-v1',simulateDuel:()=>result});
    const post=()=>handle(new Request('https://test/ai-fighter/duels',{method:'POST',body:JSON.stringify({a:ids[0],b:ids[1],idempotencyKey:crypto.randomUUID()})}));
    assert.equal((await post()).status,200);
    await sql.query('update af_fighters set entered_at=null where id=$1',[ids[1]]);
    const refused=await post();
    assert.equal(refused.status,409); assert.equal((await refused.json()).code,'duel-not-approved');
    // His record stays his; only the ranking leaves him out.
    const rank=await (await handle(new Request('https://test/ai-fighter/rankings'))).json();
    assert.deepEqual(rank.rankings.map(x=>x.name),['A']);
    assert.deepEqual((await sql.query('select appearances::int,rank from af_duel_statistics() where id=$1',[ids[1]])).rows[0],{appearances:1,rank:null});
  } finally {await sql.close();}
});
