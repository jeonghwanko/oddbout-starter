import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase } from './helpers/fighter-database.mjs';
import { createHandler } from '../api/handler.mjs';

test('admin-only post-publication moderation, stale actions, audit, and retired invitations', async () => {
  const sql = await migratedDatabase();
  try {
    const admin = crypto.randomUUID(), first = crypto.randomUUID(), second = crypto.randomUUID(), third = crypto.randomUUID();
    for (const [index,id] of [admin,first,second,third].entries()) await sql.query('insert into auth.users(id,email) values($1,$2)', [id,`person${index}@example.com`]);
    await sql.query('insert into af_admins(owner_id) values($1)', [admin]);
    for (const id of [first,second,third]) await sql.query('insert into af_access_requests(owner_id,note) values($1,$2)', [id,'[Founding League]\nOriginal fighter']);
    // Neither a browser role nor a forged p_actor can use the service-only tables and functions.
    await sql.exec('set role authenticated');
    await assert.rejects(sql.query('select * from af_admins'), /permission denied/);
    await assert.rejects(sql.query('select * from af_access_reviews'), /permission denied/);
    await assert.rejects(sql.query('select af_admin_requests($1)', [admin]), /permission denied/);
    await sql.exec('reset role; set role service_role');
    await assert.rejects(sql.query('select encrypted_password from auth.users'), /permission denied/);
    const calls = [];
    const methods = {
      af_admin_account: ['p_actor'], af_admin_requests: ['p_actor','p_status','p_search','p_page'],
      af_admin_review: ['p_actor','p_owner','p_version','p_decision','p_reason'],
      af_admin_fighters:['p_actor','p_status','p_search','p_page'],af_moderate_fighter:['p_actor','p_fighter','p_version','p_action','p_reason'],
      af_promote_fighter:['p_actor','p_fighter','p_version','p_official','p_reason'],
    };
    const tokens = { 'fixture-admin-token': admin, 'fixture-person-token': first };
    const handle = createHandler({ db: {
      auth: { getUser: async token => tokens[token] ? {data:{user:{id:tokens[token],user_metadata:{admin:true}}}} : {error:{message:'invalid'}} },
      rpc: async (name,args) => {
        calls.push({name,args}); const keys=methods[name];
        if (!keys) return {error:{message:'unexpected'}};
        try { return {data:(await sql.query(`select ${name}(${keys.map((_,i)=>`$${i+1}`).join(',')}) as result`,keys.map(key=>args[key]))).rows[0].result}; }
        catch (error) { return {error:{message:error.message}}; }
      },
    }});
    const call = (path, token = 'fixture-admin-token', body) => handle(new Request(`https://test/ai-fighter/admin/${path}`, {
      ...(body === undefined ? {} : {method:'POST',body:JSON.stringify(body)}),
      headers: token ? {authorization:`Bearer ${token}`} : {},
    }));
    assert.equal((await call('access-requests',null)).status,401);
    const denied = await call(`access-requests?actor=${admin}`,'fixture-person-token');
    assert.equal(denied.status,403); assert.equal((await denied.text()).includes('@example.com'),false);
    assert.equal((await call('me')).status,200);
    const listing = await call('access-requests');
    assert.equal(listing.headers.get('cache-control'),'no-store');
    const list = await listing.json(); assert.equal(list.total,3); assert.equal(list.counts.pending,3);
    assert.equal(list.applications.find(row=>row.ownerId===first).email,'person1@example.com');
    assert.equal((await (await call('access-requests?search=person2')).json()).total,1);
    assert.equal((await call('access-requests?status=garbage')).status,400);
    assert.equal((await call('access-requests?page=-1')).status,400);
    assert.equal((await call('fighters','fixture-person-token')).status,403);
    assert.equal((await call('fighters?status=pending')).status,400);
    assert.equal((await call('fighters?page=-1')).status,400);
    const old=list.applications[0];
    assert.equal((await call('access-requests/'+old.ownerId+'/review',undefined,{decision:'approved',version:old.updatedAt,reason:''})).status,410);
    const sub=crypto.randomUUID(),fighter=crypto.randomUUID(),hash='a'.repeat(64);
    await sql.query('select af_authorize($1)',[first]);
    await sql.query("insert into af_submissions(id,owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes,status,validation) values($1,$2,$3,'{}','{}',$4,1,'registered',$5)",[sub,first,crypto.randomUUID(),hash,{stage:'bytes-hashes-and-full-decode'}]);
    await sql.query("insert into af_fighters(id,submission_id,owner_id,manifest_sha,profile,review_state,runtime_approved,runtime_scope,runtime_manifest_sha,duel_approved,duel_manifest_sha,review_evidence) values($1,$2,$3,$4,$5,'approved',true,'arena-player-v1',$4,true,$4,$6)",[fighter,sub,first,hash,{name:'Fixture fighter',description:'Unit test fixture'},{authorization:'test',validation:'test',duelValidation:'test'}]);
    const fighters=await(await call('fighters')).json();assert.equal(fighters.total,1);assert.equal(fighters.fighters[0].state,'active');
    const route='fighters/'+fighter+'/moderation',remove={action:'remove',version:0,reason:'Test rule'};
    assert.equal((await call(route,'fixture-person-token',remove)).status,403);
    assert.equal((await call(route,undefined,{...remove,actor:admin})).status,400);
    assert.equal((await call(route,undefined,{...remove,reason:' '})).status,400);
    assert.equal((await call(route,undefined,remove)).status,200);
    let row=(await sql.query('select * from af_fighters where id=$1',[fighter])).rows[0];
    assert.equal(row.runtime_approved,false);assert.equal(row.duel_approved,false);assert.equal(row.review_state,'rejected');
    assert.equal((await call(route,undefined,remove)).status,409);
    assert.equal((await(await call('fighters')).json()).total,0);assert.equal((await(await call('fighters?status=removed')).json()).total,1);
    assert.equal((await call(route,undefined,{action:'restore',version:1,reason:'Test resolved'})).status,200);
    row=(await sql.query('select * from af_fighters where id=$1',[fighter])).rows[0];assert.equal(row.runtime_approved,true);assert.equal(row.duel_approved,true);
    assert.equal((await sql.query('select count(*)::int as n from af_moderation_events')).rows[0].n,2);
    // 정식 선수로 올리기 (2026-11-05): the promotion route, its body checked; promoted, he is not restored.
    const promotion='fighters/'+fighter+'/promotion',promote={version:2,official:'velora',reason:'Promoted'};
    assert.equal((await call(promotion,'fixture-person-token',promote)).status,403);
    assert.equal((await call(promotion,undefined,{...promote,official:'Velora'})).status,400);
    assert.equal((await call(promotion,undefined,{...promote,extra:1})).status,400);
    const promoted=await call(promotion,undefined,promote);assert.equal(promoted.status,200);
    assert.equal((await promoted.json()).promotion.promotedTo,'velora');
    assert.equal((await call(promotion,undefined,{...promote,version:3})).status,409);
    assert.equal((await call(route,undefined,{action:'restore',version:3,reason:'Back'})).status,409);
    assert.equal((await sql.query("select count(*)::int as n from af_moderation_events where action='promote'")).rows[0].n,1);
    await sql.exec('reset role; set role authenticated');
    await assert.rejects(sql.query('select * from af_moderation_events'),/permission denied/);
    await assert.rejects(sql.query('select af_moderate_fighter($1,$2,2,$3,$4)',[admin,fighter,'remove','forged']),/permission denied/);
  } finally { await sql.close(); }
});
