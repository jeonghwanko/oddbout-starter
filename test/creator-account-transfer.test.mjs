import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase } from './helpers/fighter-database.mjs';
import { copyTransferAssets } from '../scripts/creator-account-transfer-assets.mjs';

test('copies keep originals, retry without overwriting, and reject same-sized different bytes',async()=>{
  const plan={source:'source',target:'target',objects:[{bucket:'private',name:'source/front.webp'}]};
  const files=new Map([['source/front.webp',Buffer.from('original')]]);
  let writes=0;
  const storage={read:async(_bucket,name)=>files.get(name)??null,copy:async(_bucket,source,target)=>{
    assert.equal(files.has(target),false); files.set(target,Buffer.from(files.get(source))); writes++;
  }};
  assert.equal(await copyTransferAssets(plan,storage),1);
  assert.equal(await copyTransferAssets(plan,storage),0);
  assert.equal(writes,1); assert.equal(files.get('source/front.webp').toString(),'original');
  files.set('target/front.webp',Buffer.from('modified'));
  await assert.rejects(copyTransferAssets(plan,storage),/Asset bytes differ/);
  assert.equal(writes,1);
  files.delete('source/front.webp');
  await assert.rejects(copyTransferAssets(plan,storage),/Original asset is missing/);
});

test('creator transfer preserves IDs, immutable bytes, balances and limits; fails closed and cannot run twice', async () => {
  const db = await migratedDatabase();
  const source = crypto.randomUUID(), target = crypto.randomUUID(), sub = crypto.randomUUID(), fighter = crypto.randomUUID();
  const sha = 'a'.repeat(64);
  const snapshot = async () => (await db.query('select af_private.creator_transfer_snapshot($1,$2) value',[source,target])).rows[0].value;
  const apply = plan => db.query('select af_private.apply_creator_transfer($1) value',[JSON.stringify(plan)]);
  try {
    await db.query('insert into auth.users(id) values($1),($2)',[source,target]);
    await db.query('insert into af_creators(owner_id,token_grant,fighter_limit) values($1,1000000,3),($2,500000,10)',[source,target]);
    await db.query("insert into af_submissions(id,owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes,status) values($1,$2,$1,'{}','{}',$3,1,'registered')",[sub,source,sha]);
    await db.query("insert into af_fighters(id,submission_id,owner_id,manifest_sha,profile) values($1,$2,$3,$4,'{}')",[fighter,sub,source,sha]);
    await db.query("insert into af_fighters(owner_id,profile,status) values($1,'{}','profile')",[target]);
    await db.query("insert into af_account_agents(owner_id,agent) values($1,'grok'),($2,'grok')",[source,target]);
    await assert.rejects(db.query('update af_submissions set owner_id=$1 where id=$2',[target,sub]),/immutable-submission/);
    const before = await snapshot();
    await db.query('update af_creators set token_grant=token_grant+1 where owner_id=$1',[target]);
    await assert.rejects(apply(before),/transfer-plan-stale/);
    await db.query('update af_creators set token_grant=token_grant-1 where owner_id=$1',[target]);
    await db.exec('create table public.transfer_unknown(owner uuid)');
    await db.query('insert into public.transfer_unknown values($1)',[source]);
    await assert.rejects(snapshot(),/unsupported-holdings/);
    await db.exec('drop table public.transfer_unknown');
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('ai-fighter-beta',$1,'{\"size\":12}')",[source+'/fixture.webp']);
    const plan = await snapshot();
    await assert.rejects(apply(plan),/assets-not-copied/);
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('ai-fighter-beta',$1,'{\"size\":12}')",[target+'/fixture.webp']);
    const result = (await apply(plan)).rows[0].value;
    assert.deepEqual(result.tokens,{granted:1500000,spent:0,balance:1500000});
    assert.equal(result.fighterLimit,10); assert.equal(result.fighters,2);
    assert.deepEqual((await db.query('select id,owner_id,manifest_text,manifest_sha from af_submissions where id=$1',[sub])).rows[0],
      {id:sub,owner_id:target,manifest_text:'{}',manifest_sha:sha});
    assert.equal((await db.query('select account_slot from af_fighters where id=$1',[fighter])).rows[0].account_slot,2);
    assert.equal((await db.query('select count(*)::int n from storage.objects')).rows[0].n,2);
    assert.equal((await db.query('select enabled from af_creators where owner_id=$1',[source])).rows[0].enabled,false);
    await assert.rejects(apply(plan),/account-already-transferred/);
    await assert.rejects(db.query('update af_submissions set manifest_sha=$1 where id=$2',['b'.repeat(64),sub]),/immutable-submission/);
    for (const role of ['anon','authenticated','service_role']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(snapshot(),/permission denied|operator-only/);
      await assert.rejects(apply(plan),/permission denied|operator-only/);
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});
