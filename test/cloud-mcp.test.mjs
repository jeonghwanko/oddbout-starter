import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudHandler, authenticateCloud, EXPIRED_TOKEN_GRACE_MS, SIGN_IN_PROBLEMS, allowedFileUrl, downloadHostFile, compactText, CLOUD_RESOURCE, CLOUD_ISSUER, PUBLIC_RESOURCE, LEGACY_PUBLIC_RESOURCE, SIGN_IN_RESOURCE, PUBLIC_SIGN_IN_RESOURCE, DIRECTORY_RESOURCE, PUBLIC_DIRECTORY_RESOURCE, DIRECTORY_DOCUMENTATION } from '../mcp/cloud.mjs';
import { DIRECTORY_INSTRUCTIONS, DIRECTORY_TITLES } from '../mcp/cloud/directory-edition.mjs';
import { verifiedUserId } from '../api/http.mjs';
import { safeClientRedirect, authorizationId } from '../web/cloud-connect/connect.mjs';
import { migratedDatabase } from './helpers/fighter-database.mjs';
import { profileFixture } from './helpers/profile-api-fixture.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
const owner = crypto.randomUUID(), session = crypto.randomUUID(), client = crypto.randomUUID();
const token = 'signed-connector-token-for-test';
const claims = () => ({ sub: owner, client_id: client, session_id: session, iss: CLOUD_ISSUER, aud: CLOUD_RESOURCE,
  role: 'af_mcp', af_mcp: 'registration-v1', is_anonymous: false, exp: Math.floor(Date.now()/1000)+600, email: 'test@example.com' });
const dbFor = (c=claims(), active=true) => ({ auth: { getClaims: async () => ({ data: { claims:c } }) }, rpc: async () => ({data:active}) });
const request = (method,params={}, auth=false) => new Request(CLOUD_RESOURCE,{ method:'POST', headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...(auth?{authorization:`Bearer ${token}`}:{})}, body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}) });
const call = async (handle,name,args={}) => (await (await handle(request('tools/call',{name,arguments:args},true))).json()).result;
test('MCP discovery, file schemas, profile identity and HTTP auth challenge interoperate', async () => {
  const handle=createCloudHandler({db:dbFor()});
  const init=await (await handle(request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}}))).json();
  assert.equal(init.result.serverInfo.name,'oddbout-cloud');
  const list=await (await handle(request('tools/list'))).json();
  assert.equal(list.result.tools.length,20);
  for(const name of ['prepare_fighter_registration','upload_fighter_asset','store_creator_source','prepare_profile_set','upload_profile_set_asset']) {
    const t=list.result.tools.find(t=>t.name===name), f=t.inputSchema.properties[t._meta['openai/fileParams'][0]];
    assert.deepEqual(new Set(f.required),new Set(['download_url','file_id']));
    assert.deepEqual(Object.keys(f.properties).sort(),['download_url','file_id','file_name','mime_type']);
    assert.equal(t.securitySchemes[0].type,'oauth2');
  }
  const p=list.result.tools.find(t=>t.name==='get_profile');
  assert.equal(p.outputSchema.additionalProperties,false); assert.equal(p._meta['openai/profile'],true);
  assert.deepEqual((await call(handle,'get_profile')).structuredContent,{id:owner,email:'test@example.com',nickname:'ODDBOUT'});
  const denied=await handle(request('tools/call',{name:'get_profile',arguments:{}}));
  assert.equal(denied.status,401); assert.match(denied.headers.get('www-authenticate'),/resource_metadata/);
  const metadata=await (await handle(new Request(`${CLOUD_RESOURCE}/.well-known/oauth-protected-resource`))).json();
  assert.equal(metadata.resource,CLOUD_RESOURCE);
  const publicMetadata=await (await handle(new Request(`${CLOUD_RESOURCE}/.well-known/oauth-protected-resource`,{headers:{'x-oddbout-public-resource':PUBLIC_RESOURCE}}))).json();
  assert.equal(publicMetadata.resource,PUBLIC_RESOURCE);
  assert.equal(list.result.tools.find(t=>t.name==='submit_fighter_registration').annotations.destructiveHint,true);
  // Persisting a private confirmation is a write, but it does not publish or
  // contact an open-ended recipient. File imports and public roster changes do.
  const preparation=list.result.tools.find(t=>t.name==='prepare_fighter_deletion').annotations;
  assert.equal(preparation.readOnlyHint,false);
  assert.equal(preparation.openWorldHint,false);
  assert.equal(preparation.destructiveHint,false);
  for(const name of ['prepare_fighter_registration','upload_fighter_asset','submit_fighter_registration','delete_fighter'])
    assert.equal(list.result.tools.find(t=>t.name===name).annotations.openWorldHint,true,name);
  const gateway=await handle(new Request('http://edge-runtime/ai-fighter-mcp/.well-known/oauth-protected-resource'));
  assert.equal(gateway.status,200);
  const contract=await (await handle(request('tools/call',{name:'get_fighter_spec',arguments:{section:'overview'}}))).json();
  assert.equal(contract.result.structuredContent.data.registration.available,true);
  assert.equal(contract.result.structuredContent.data.registration.requiresPc,false);
  assert.equal(contract.result.structuredContent.data.registration.assetUpload,'openai-fileParams');
  assert.equal(contract.result.structuredContent.data.registration.approvalRequired,false);
});
test('normal user tokens, wrong audiences, expiry, future tokens, missing grants and spoofed identities are rejected',async()=>{
  const req=new Request(CLOUD_RESOURCE,{headers:{authorization:`Bearer ${token}`}});
  const refused=async(db,problem)=>assert.deepEqual(await authenticateCloud(db,req),{identity:null,problem});
  assert.equal((await authenticateCloud(dbFor(),req)).identity.owner,owner);
  assert.equal((await authenticateCloud(dbFor({...claims(),aud:[CLOUD_RESOURCE,LEGACY_PUBLIC_RESOURCE]}),req)).identity.owner,owner);
  assert.equal((await authenticateCloud(dbFor({...claims(),aud:[CLOUD_RESOURCE,LEGACY_PUBLIC_RESOURCE,PUBLIC_RESOURCE]}),req)).identity.owner,owner);
  for(const aud of [[CLOUD_RESOURCE,'https://evil.test'],[CLOUD_RESOURCE,CLOUD_RESOURCE],[],['authenticated'],[CLOUD_RESOURCE,PUBLIC_RESOURCE,'authenticated']])
    await refused(dbFor({...claims(),aud}),'invalid-token');
  for(const delta of [{aud:'authenticated'},{role:'authenticated'},{iss:'https://evil.test'},{exp:null},{nbf:Date.now()/1000+100},{client_id:null},{session_id:null},{is_anonymous:true},{af_mcp:'admin'},{sub:'other'}])
    await refused(dbFor({...claims(),...delta}),'invalid-token');
  await refused(dbFor({...claims(),exp:0}),'token-expired');
  await refused(dbFor(claims(),false),'connection-ended');
  await refused({auth:{getClaims:async()=>({data:null,error:{name:'AuthInvalidJwtError',status:400}})}},'invalid-token');
  assert.deepEqual(await authenticateCloud(dbFor(),new Request(CLOUD_RESOURCE)),{identity:null,problem:'authentication-required'});
  assert.equal(await verifiedUserId(dbFor(),req),null);
  const encoded=`a.${Buffer.from(JSON.stringify(claims())).toString('base64url')}.c`;
  assert.equal(await verifiedUserId({auth:{getUser:async()=>({data:{user:{id:owner}}})}},new Request(CLOUD_RESOURCE,{headers:{authorization:`Bearer ${encoded}`}})),null);
});
// Cursor's Grok Bot (2026-10-31) sent its first sign-in's token for hours after it expired, never refreshing, and told its user ODDBOUT's
// login provider was down. Such a token now keeps working for a while if its connection is live and was never refreshed after it; past
// that, and when the check itself fails, the answer says why.
test('an expired connector token works while it is its live session\'s newest, then is refused with its reason; a failed check is a 503',async()=>{
  const hour=3600, now=Math.floor(Date.now()/1000), seen=[];
  const dbAt=(exp,{state='usable',active=true,iat=exp-hour,rpc=null}={})=>({
    auth:{getClaims:async(_,options)=>{seen.push(options);return{data:{claims:{...claims(),iat,exp}}}}},
    rpc:async(name,args)=>{seen.push([name,args]);return rpc?rpc():{data:name==='af_mcp_expired_token_state'?state:active}}});
  const req=new Request(SIGN_IN_RESOURCE,{headers:{authorization:`Bearer ${token}`}});
  const expired=now-6*hour;
  assert.equal((await authenticateCloud(dbAt(expired),req)).identity.owner,owner);
  assert.deepEqual(seen,[{allowExpired:true},['af_mcp_expired_token_state',{p_owner:owner,p_session:session,p_client:client,p_issued_at:expired-hour}]]);
  seen.length=0;
  assert.equal((await authenticateCloud(dbAt(now+hour),req)).identity.owner,owner);
  assert.deepEqual(seen,[{allowExpired:true},['af_mcp_session_active',{p_owner:owner,p_session:session,p_client:client}]]);
  // Other clients keep the plain expiry; a client that refreshed holds a newer token; a revoked or signed-out connection ends every token.
  for(const [state,problem] of [['strict','token-expired'],['refreshed','token-superseded'],['ended','connection-ended'],[null,'connection-ended']])
    assert.deepEqual(await authenticateCloud(dbAt(expired,{state}),req),{identity:null,problem},state);
  // Past the grace, or without an issue time to compare, the database is not asked.
  for(const db of [dbAt(now-EXPIRED_TOKEN_GRACE_MS/1000),dbAt(expired,{iat:null})]){
    seen.length=0;
    assert.deepEqual(await authenticateCloud(db,req),{identity:null,problem:'token-expired'});
    assert.deepEqual(seen,[{allowExpired:true}]);
  }
  assert.equal((await authenticateCloud(dbAt(now-EXPIRED_TOKEN_GRACE_MS/1000+60),req)).identity.owner,owner);

  const post=db=>createCloudHandler({db})(new Request(SIGN_IN_RESOURCE,{method:'POST',headers:{'content-type':'application/json',
    accept:'application/json, text/event-stream',authorization:`Bearer ${token}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})}));
  assert.equal((await post(dbAt(expired))).status,200);
  // The challenge keeps its earlier start and adds the reason after it.
  const metadata=`Bearer resource_metadata="${SIGN_IN_RESOURCE}/.well-known/oauth-protected-resource", scope="openid email profile"`;
  for(const [db,problem] of [[dbAt(now-8*24*hour),'token-expired'],[dbAt(expired,{state:'strict'}),'token-expired'],[dbAt(expired,{state:'refreshed'}),'token-superseded'],
    [dbAt(now+hour,{active:false}),'connection-ended'],[{auth:{getClaims:async()=>({data:null,error:{name:'AuthInvalidJwtError',status:400}})}},'invalid-token'],
    [{auth:{getClaims:async()=>{throw new TypeError('Invalid UTF-8 sequence')}}},'invalid-token']]){
    const refused=await post(db);
    assert.equal(refused.status,401,problem);
    assert.equal(refused.headers.get('www-authenticate'),`${metadata}, error="invalid_token", error_description="${SIGN_IN_PROBLEMS[problem]}"`);
    assert.deepEqual(await refused.json(),{error:'invalid_token',code:problem,error_description:SIGN_IN_PROBLEMS[problem]});
  }
  assert.match(SIGN_IN_PROBLEMS['token-expired'],/ODDBOUT reconnected in the connector settings/);
  // A quoted-string's characters, without the commas and semicolons a naive challenge parser splits on.
  for(const text of Object.values(SIGN_IN_PROBLEMS)) assert.match(text,/^[\x20\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/);
  const probe=await createCloudHandler({db:dbAt(now-8*24*hour)})(new Request(SIGN_IN_RESOURCE,{headers:{authorization:`Bearer ${token}`}}));
  assert.equal(probe.status,401); assert.equal(probe.headers.get('www-authenticate'),
    `${metadata}, error="invalid_token", error_description="${SIGN_IN_PROBLEMS['token-expired']}"`);
  // The database, the network or the Auth server failing is not a refused sign-in: the client is told to retry, not to sign in again.
  for(const db of [dbAt(now+hour,{rpc:async()=>({data:null,error:{message:'timeout'}})}),dbAt(expired,{rpc:async()=>{throw Error('network')}}),
    ...[{name:'AuthRetryableFetchError',status:0},{name:'AuthUnknownError'},{name:'AuthApiError',status:500},{name:'AuthApiError',status:429}]
      .map(error=>({auth:{getClaims:async()=>({data:null,error})}}))]){
    const unavailable=await post(db);
    assert.equal(unavailable.status,503); assert.equal(unavailable.headers.get('retry-after'),'30');
    assert.equal(unavailable.headers.get('www-authenticate'),null);
    assert.deepEqual(await unavailable.json(),{error:'temporarily_unavailable',code:'sign-in-check-unavailable',
      error_description:SIGN_IN_PROBLEMS['sign-in-check-unavailable']});
  }
});
// The real auth-js, not a stand-in: an expired token is taken on its verified signature alone, and a malformed one is a bad token (401), not
// a server fault (503) — auth-js throws for some of them instead of returning an error.
test('with the real auth-js an expired token passes only with a valid signature, and malformed tokens are refused, not retried',async()=>{
  const { createClient } = await import('@supabase/supabase-js');
  const { privateKey, publicKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  let jwks = () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } });
  const fetcher = async url => String(url).endsWith('/.well-known/jwks.json') ? jwks()
    : new Response('{"code":"bad_jwt","msg":"token is expired"}', { status: 403, headers: { 'content-type': 'application/json' } });
  const b64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
  const sign = async (header, payload) => { const input = `${b64(header)}.${b64(payload)}`;
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(input));
    return `${input}.${Buffer.from(signature).toString('base64url')}`; };
  const now = Math.floor(Date.now() / 1000), header = { alg: 'ES256', kid: 'k1', typ: 'JWT' }, payload = { ...claims(), iat: now - 7200, exp: now - 3600 };
  const check = async jwt => { const client = createClient('https://auth.test', 'service-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
    const result = await authenticateCloud({ auth: client.auth, rpc: async () => ({ data: 'usable', error: null }) },
      new Request(SIGN_IN_RESOURCE, { headers: { authorization: `Bearer ${jwt}` } }));
    return result.problem ?? result.identity.owner; };
  const valid = await sign(header, payload);
  assert.equal(await check(valid), owner);
  assert.equal(await check(`${valid.slice(0, -6)}${valid.slice(-6) === 'AAAAAA' ? 'BBBBBB' : 'AAAAAA'}`), 'invalid-token');
  assert.equal(await check(await sign({ ...header, kid: 'unknown' }, payload)), 'invalid-token'); // falls back to Auth, which refuses it
  for (const alg of ['RS256', 'PS256']) assert.equal(await check(await sign({ ...header, alg }, payload)), 'invalid-token', alg);
  assert.equal(await check('aaaaaaaa.bbbbbbbb.cccccccc'), 'invalid-token');
  // A key auth-js has not cached yet (its JWKS cache outlives a client) is fetched: a rate limit or a gateway error is a retry.
  const uncached = await sign({ ...header, kid: 'k2' }, payload);
  jwks = () => new Response('{"code":"over_request_rate_limit"}', { status: 429, headers: { 'content-type': 'application/json' } });
  assert.equal(await check(uncached), 'sign-in-check-unavailable');
  jwks = () => new Response('upstream', { status: 502 });
  assert.equal(await check(uncached), 'sign-in-check-unavailable');
});
test('cloud readiness never turns account access into generation, display or package approval',async()=>{
  const db={...dbFor(),rpc:async name=>({data:name==='af_account'?{invited:true,accessMode:'open',canSubmit:true}:true})};
  const ready=(await call(createCloudHandler({db}),'check_creation_readiness',{purpose:'registration'})).structuredContent;
  assert.equal(ready.registration.status,'ready');assert.equal(ready.registration.requiresPc,false);
  for(const key of ['generation','delivery','package'])assert.equal(ready[key].status,'unverified');
  assert.deepEqual(ready.nextCommands,[]);
});
test('files cannot fetch arbitrary URLs, follow redirects or exceed manifest byte budget',async()=>{
  for(const url of ['http://files.oaiusercontent.com/a','https://127.0.0.1/x','https://files.oaiusercontent.com.evil.test/x','https://user@files.oaiusercontent.com/x','https://files.oaiusercontent.com:444/x']) assert.equal(allowedFileUrl(url),false);
  let options; const file={download_url:'https://files.oaiusercontent.com/a',file_id:'file_test'};
  await assert.rejects(downloadHostFile(file,3,async(url,opts)=>{options=opts;return new Response('1234')}),/body-limit/);
  assert.equal(options.redirect,'error'); assert.equal(options.credentials,'omit');
});
test('foreign submissions and mismatched bytes do not upload; errors never echo signed download URLs',async()=>{
  const filters=[], row={status:'uploading',expires_at:new Date(Date.now()+60000).toISOString(),manifest:{assets:[{id:'idle',bytes:3,sha256:'0'.repeat(64)}]}};
  let data=null, downloads=0;
  const query={select(){return this},eq(k,v){filters.push([k,v]);return this},async maybeSingle(){return{data}}};
  const db={...dbFor(),from:()=>query};
  const handle=createCloudHandler({db,fetcher:async()=>{downloads++;return new Response('abc')}});
  const args={submissionId:crypto.randomUUID(),assetId:'idle',file:{download_url:'https://files.oaiusercontent.com/a?secret=xyz',file_id:'file_a'}};
  assert.equal((await call(handle,'upload_fighter_asset',args)).structuredContent.code,'not-found'); assert.equal(downloads,0);
  assert.ok(filters.some(([k,v])=>k==='owner_id'&&v===owner));
  data=row; const bad=await call(handle,'upload_fighter_asset',args);
  assert.equal(bad.structuredContent.code,'asset-hash-or-size');assert.ok(!JSON.stringify(bad).includes('secret'));
});
test('manifest registration binds owner/idempotency and does not report queued as registered',async()=>{
  const rpcCalls=[],id=crypto.randomUUID(),key=crypto.randomUUID();
  const query={select(){return this},eq(){return this},async single(){return{data:{manifest:example}}},async maybeSingle(){return{data:{id,status:'queued',manifest_sha:'a'.repeat(64)}}}};
  const db={...dbFor(),from:()=>query,rpc:async(name,args)=>{rpcCalls.push([name,args]);return{data:name==='af_create_submission'?{id,status:'uploading',manifest_sha:args.p_sha}:true}}};
  const handle=createCloudHandler({db,fetcher:async()=>new Response(JSON.stringify(example))});
  const prepared=await call(handle,'prepare_fighter_registration',{manifest:{download_url:'https://files.oaiusercontent.com/f.json',file_id:'file_json'},idempotencyKey:key});
  assert.equal(prepared.structuredContent.stage,'uploading');assert.equal(prepared.structuredContent.assets.length,example.assets.length);
  assert.equal(rpcCalls.find(([n])=>n==='af_create_submission')[1].p_owner,owner);assert.equal(rpcCalls.find(([n])=>n==='af_create_submission')[1].p_key,key);
  const status=await call(handle,'get_fighter_submission',{submissionId:id});
  assert.equal(status.structuredContent.stage,'queued');assert.equal(status.structuredContent.fighterId,null);
});
test('registration update forwards only a valid optional fighter ID and preserves API refusals', async () => {
  const calls = [], id = crypto.randomUUID(), fighter = crypto.randomUUID(), key = crypto.randomUUID(), updateKey = crypto.randomUUID();
  let refusal = null, downloads = 0;
  const query = { select(){return this}, eq(){return this}, async single(){return {data:{manifest:example}}} };
  const db = {...dbFor(), from:()=>query, rpc:async(name,args)=>{
    if (name === 'af_create_submission') { calls.push(args); return refusal ? {error:{message:refusal}} : {data:{id,status:'uploading',manifest_sha:args.p_sha}}; }
    return {data:true};
  }};
  const handle = createCloudHandler({db,fetcher:async()=>{downloads++;return new Response(JSON.stringify(example))}});
  const args = {manifest:{download_url:'https://files.oaiusercontent.com/f.json',file_id:'file_json'},idempotencyKey:key};
  const tools = (await (await handle(request('tools/list'))).json()).result.tools;
  const schema = tools.find(t=>t.name==='prepare_fighter_registration').inputSchema;
  assert.ok(schema.properties.fighterId); assert.ok(!schema.required.includes('fighterId'));
  assert.equal((await call(handle,'prepare_fighter_registration',args)).structuredContent.stage,'uploading');
  assert.equal(calls.at(-1).p_fighter,null);
  const update = {...args,idempotencyKey:updateKey,fighterId:fighter};
  assert.equal((await call(handle,'prepare_fighter_registration',update)).structuredContent.stage,'uploading');
  assert.equal(calls.at(-1).p_fighter,fighter); assert.equal(calls.at(-1).p_owner,owner); assert.equal(calls.at(-1).p_key,updateKey);
  assert.equal((await call(handle,'prepare_fighter_registration',update)).structuredContent.stage,'uploading');
  assert.equal(calls.at(-1).p_key,updateKey); assert.equal(calls.at(-1).p_sha,calls.at(-2).p_sha);
  const before = [downloads,calls.length];
  assert.equal((await call(handle,'prepare_fighter_registration',{...args,fighterId:'not-a-uuid'})).isError,true);
  assert.deepEqual([downloads,calls.length],before);
  for (const code of ['fighter-not-found','idempotency-conflict']) {
    refusal = code;
    assert.equal((await call(handle,'prepare_fighter_registration',update)).structuredContent.code,code);
  }
});
test('creator homepage is an authenticated fixed navigation URL without account handoff', async () => {
  let unexpected = 0;
  const db = {...dbFor(),from:()=>{unexpected++;throw Error('unexpected database call')}};
  const handle = createCloudHandler({db,fetcher:async()=>{unexpected++;throw Error('unexpected fetch')}});
  const tool = (await (await handle(request('tools/list'))).json()).result.tools.find(t=>t.name==='open_creator_homepage');
  assert.deepEqual(Object.keys(tool.inputSchema.properties),[]);
  assert.equal(tool.securitySchemes[0].type,'oauth2');
  assert.equal(tool.annotations.readOnlyHint,true); assert.equal(tool.annotations.idempotentHint,true);
  assert.equal((await handle(request('tools/call',{name:'open_creator_homepage',arguments:{}}))).status,401);
  const result = (await call(handle,'open_creator_homepage')).structuredContent;
  assert.equal(result.url,'https://oddbout.com/creator.html');
  assert.match(result.signIn,/normally.*same account as get_profile/);
  assert.equal(unexpected,0);
});
test('native OAuth hook isolates connector tokens and live-session checks enforce owner/client/scope/revocation',async()=>{
  const db=await migratedDatabase();
  try{
    const plain={claims:{sub:owner,role:'authenticated',aud:'authenticated'},authentication_method:'oauth'};
    const hook=e=>db.query('select public.af_mcp_access_token_hook($1) value',[e]).then(r=>r.rows[0].value.claims);
    assert.deepEqual(await hook(plain),plain.claims);
    assert.equal((await hook({...plain,claims:{...plain.claims,client_id:client}})).role,'af_mcp');
    assert.deepEqual((await hook({...plain,claims:{...plain.claims,client_id:client}})).aud,[CLOUD_RESOURCE,LEGACY_PUBLIC_RESOURCE,PUBLIC_RESOURCE]);
    await db.query('insert into auth.oauth_clients(id) values($1)',[client]);
    await db.query('insert into auth.sessions(id,user_id,oauth_client_id,scopes) values($1,$2,$3,$4)',[session,owner,client,'openid email profile']);
    await db.query('insert into auth.oauth_consents(user_id,client_id,scopes) values($1,$2,$3)',[owner,client,'openid email profile']);
    const active=(o=owner)=>db.query('select public.af_mcp_session_active($1,$2,$3) value',[o,session,client]).then(r=>r.rows[0].value);
    assert.equal(await active(),true);assert.equal(await active(crypto.randomUUID()),false);
    // The grace is Cursor's web agents' alone: a cursor.com MCP callback, any other redirect URI a loopback one. Cursor's real
    // registration (production, 2026-10-31) is the first of these.
    const issued=1793413272, cursor='https://www.cursor.com/agents/mcp/oauth/callback,http://localhost:8787/callback';
    const state=(iat=issued,o=owner)=>db.query('select public.af_mcp_expired_token_state($1,$2,$3,$4) value',[o,session,client,iat]).then(r=>r.rows[0].value);
    const redirects=uris=>db.query('update auth.oauth_clients set redirect_uris=$1',[uris]);
    assert.equal(await state(),'strict');
    for(const uris of ['https://chatgpt.com/connector_platform_oauth_redirect','http://127.0.0.1:3118/callback',
      `${cursor},https://evil.test/callback`,'https://www.cursor.com.evil.test/bot/mcp/oauth/callback',
      `${cursor},http://localhost.evil.test/callback`,`${cursor},http://localhost:8787@evil.test/callback`,`${cursor},https://localhost/callback`])
      {await redirects(uris);assert.equal(await state(),'strict',uris);}
    for(const uris of ['https://www.cursor.com/bot/mcp/oauth/callback','https://www.cursor.com/agents/mcp/oauth/callback, http://[::1]:9/cb,http://127.0.0.1/x'])
      {await redirects(uris);assert.equal(await state(),'usable',uris);}
    await redirects(cursor);assert.equal(await state(),'usable');assert.equal(await state(issued,crypto.randomUUID()),'ended');
    // A banned or deleted user's connection is over too.
    await db.query('insert into auth.users(id,banned_until) values($1,$2)',[owner,new Date(Date.now()+3600e3)]);assert.equal(await state(),'ended');
    await db.exec('update auth.users set banned_until=now()-interval \'1 hour\'');assert.equal(await state(),'usable');
    await db.exec('update auth.users set deleted_at=now()');assert.equal(await state(),'ended');
    await db.exec('update auth.users set deleted_at=null');
    // An expired token is usable only while no refresh came after it. Auth records refreshed_at (UTC, no time zone) just after it signs.
    const refreshedAt=at=>db.query("update auth.sessions set refreshed_at=to_timestamp($1::double precision) at time zone 'UTC'",[at]);
    await refreshedAt(issued+2);assert.equal(await state(),'usable');
    await refreshedAt(issued+5);assert.equal(await state(),'refreshed');
    await refreshedAt(issued+3600);assert.equal(await state(),'refreshed');assert.equal(await state(issued+3600),'usable');
    await db.exec("set timezone='Asia/Seoul'");assert.equal(await state(),'refreshed');assert.equal(await state(issued+3600),'usable');
    await db.exec("update auth.sessions set scopes='openid'");assert.equal(await active(),false);assert.equal(await state(issued+3600),'ended');
    await db.exec("update auth.sessions set scopes='openid email profile';update auth.oauth_consents set revoked_at=now()");assert.equal(await active(),false);
    assert.equal(await state(issued+3600),'ended');
    await db.exec('set role authenticated');await assert.rejects(active(),/permission denied/);await assert.rejects(state(),/permission denied/);
  }finally{await db.close()}
});
test('consent never redirects to a supplied third-party origin and preserves only a valid authorization ID',()=>{
  assert.equal(safeClientRedirect('https://chatgpt.com/connector_platform/oauth/callback?code=a'),true);
  for(const url of ['javascript:alert(1)','https://chatgpt.com.evil.test','https://user@chatgpt.com/x','http://chatgpt.com'])assert.equal(safeClientRedirect(url),false);
  assert.equal(authorizationId('?authorization_id='+client,null),client);assert.equal(authorizationId('?authorization_id=bad',client),null);
});

test('deletion tools require explicit confirmation and bind every call to verified owner, session and client',async()=>{
  const calls=[],fighter=crypto.randomUUID(),confirmation=crypto.randomUUID();
  const db={...dbFor(),rpc:async(name,args)=>{
    calls.push([name,args]); return {data:name==='af_mcp_session_active'?true:{ok:true,stage:'confirmation-required'}};
  }};
  const handle=createCloudHandler({db});
  const list=(await (await handle(request('tools/list'))).json()).result.tools;
  const tool=list.find(t=>t.name==='delete_fighter');
  assert.equal(tool.annotations.destructiveHint,true);
  assert.ok(tool.inputSchema.required.includes('confirm'));
  assert.ok(!Object.keys(tool.inputSchema.properties).some(k=>/owner|email|session|client/.test(k)));
  const p=(await call(handle,'prepare_fighter_deletion',{fighterId:fighter})).structuredContent;
  assert.deepEqual(p.account,{id:owner,email:'test@example.com'});
  const args={fighterId:fighter,confirmationToken:confirmation,confirmName:'Exact name'};
  assert.equal((await call(handle,'delete_fighter',{...args,confirm:false})).isError,true);
  assert.equal(calls.filter(([n])=>n==='af_delete_owned_fighter').length,0);
  await call(handle,'delete_fighter',{...args,confirm:true});
  assert.deepEqual(calls.find(([n])=>n==='af_delete_owned_fighter')[1],{
    p_owner:owner,p_session:session,p_client:client,p_fighter:fighter,p_token:confirmation,p_confirm_name:'Exact name'});
  db.rpc=async name=>name==='af_mcp_session_active'?{data:true}:{error:{message:'private database details'}};
  const failed=await call(handle,'delete_fighter',{...args,confirm:true});
  assert.equal(failed.structuredContent.code,'database-unavailable');
  assert.ok(!JSON.stringify(failed).includes('private database'));
});

test('owned list excludes deleted rows and owned lookup returns only a deletion receipt',async()=>{
  const filters=[],fighter=crypto.randomUUID(),deletedAt=new Date().toISOString();
  const query={select(){return this},eq(k,v){filters.push([k,v]);return this},is(k,v){filters.push([k,v]);return this},order(){return this},
    async limit(){return{data:[]}},async maybeSingle(){return{data:{id:fighter,deleted_at:deletedAt,profile:{name:'Deleted'}}}}};
  const db={...dbFor(),from:()=>query};
  const handle=createCloudHandler({db});
  assert.deepEqual((await call(handle,'list_my_fighters')).structuredContent.fighters,[]);
  assert.ok(filters.some(([k,v])=>k==='deleted_at'&&v===null));
  assert.ok(filters.some(([k,v])=>k==='owner_id'&&v===owner));
  assert.deepEqual((await call(handle,'get_registered_fighter',{fighterId:fighter})).structuredContent,
    {ok:true,stage:'deleted',fighterId:fighter,deletedAt});
});

test('agent tools list only with the arena key; reads are public, spars and cups carry the verified owner and the key', async () => {
  const calls = [], key = 'k'.repeat(64);
  const arena = { url: 'https://arena.test/oddbout-arena', key, pollMs: 1, pollTries: 2, fetcher: async (url, init = {}) => {
    calls.push({ url, method: init.method, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
    if (url.endsWith('/fighters')) return Response.json({ ok: true, rules: 39, fighters: [{ id: 'kuma', name: 'KUMA' }] });
    if (url.includes('/agent/')) return Response.json({ ok: true, echo: JSON.parse(init.body) });
    return Response.json({ ok: true, url });
  } };
  const names = async handle => (await (await handle(request('tools/list'))).json()).result.tools.map(t => t.name);
  assert.equal((await names(createCloudHandler({ db: dbFor() }))).includes('spar'), false);
  assert.equal((await names(createCloudHandler({ db: dbFor(), arena: { url: arena.url, key: null } }))).includes('spar'), false);
  const listed = await names(createCloudHandler({ db: dbFor(), arena }));
  for (const tool of ['get_style_guide', 'list_fighters', 'get_rankings', 'get_fighter_record', 'get_cup', 'read_bout', 'spar', 'enter_cup', 'update_fighter_style', 'update_fighter_profile'])
    assert.ok(listed.includes(tool), tool);
  // Public reads need no connected account and send no key.
  const signedOut = createCloudHandler({ db: { auth: { getClaims: async () => ({ data: null }) }, rpc: async () => ({ data: false }) }, arena });
  const guide = (await (await signedOut(request('tools/call', { name: 'get_style_guide', arguments: {} }))).json()).result.structuredContent;
  assert.equal(guide.ok, true); assert.deepEqual(guide.contract.temper, ['guard', 'retreat', 'measure', 'patience']);
  const bout = (await (await signedOut(request('tools/call', { name: 'read_bout', arguments: { a: 'kuma', b: 'yume', seed: 7 } }))).json()).result.structuredContent;
  assert.equal(bout.url, 'https://arena.test/oddbout-arena/bout?a=kuma&b=yume&seed=7');
  // A read goes on the arena's agent budget: signed out, every signed-out agent's together (`public`).
  assert.equal(calls.at(-1).headers['x-arena-agent'], key); assert.equal(calls.at(-1).headers['x-arena-owner'], 'public');
  assert.equal((await (await signedOut(request('tools/call', { name: 'spar', arguments: { fighterId: 'kuma', opponentId: 'yume' } }))).status), 401);
  // Agent calls: the owner is the verified one, never an argument.
  const handle = createCloudHandler({ db: dbFor(), arena });
  const spar = (await call(handle, 'spar', { fighterId: 'kuma', opponentId: 'yume', seed: 3 })).structuredContent;
  assert.deepEqual(spar.echo, { owner, a: 'kuma', b: 'yume', seed: 3 }); assert.equal(calls.at(-1).headers['x-arena-agent'], key);
  await call(handle, 'read_bout', { a: 'kuma', b: 'yume', seed: 7 }); assert.equal(calls.at(-1).headers['x-arena-owner'], owner);
  const fighter = crypto.randomUUID();
  const entered = (await call(handle, 'enter_cup', { fighterId: fighter })).structuredContent;
  assert.deepEqual(entered.echo, { owner, fighter }); assert.equal(entered.state, 'open'); assert.equal(entered.next, 'get_cup');
  assert.equal((await call(handle, 'read_bout', { cupId: fighter })).structuredContent.code, 'invalid-bout');
  const failing = createCloudHandler({ db: dbFor(), arena: { ...arena, fetcher: async () => { throw new Error('down'); } } });
  assert.equal((await call(failing, 'get_rankings', {})).structuredContent.code, 'arena-unavailable');
});

test('a style edit goes through the profile edit on the owner\'s current package', async () => {
  const fighter = crypto.randomUUID(), filters = [];
  const query = { select() { return this; }, eq(k, v) { filters.push([k, v]); return this; }, is(k, v) { filters.push([k, v]); return this; },
    async maybeSingle() { return { data: { manifest_sha: 'c'.repeat(64) } }; } };
  const arena = { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async () => Response.json({ ok: true }) };
  const handle = createCloudHandler({ db: { ...dbFor(), from: () => query }, arena });
  const tool = (await (await handle(request('tools/list'))).json()).result.tools.find(t => t.name === 'update_fighter_style');
  assert.equal(tool.annotations.destructiveHint, true);
  const result = (await call(handle, 'update_fighter_style', { fighterId: fighter, style: { distance: 2 }, idempotencyKey: crypto.randomUUID() })).structuredContent;
  // The in-process API asks the database next; this stub has none, so it stops there — after reading only the owner's own fighter.
  assert.equal(result.ok, false);
  assert.ok(filters.some(([k, v]) => k === 'owner_id' && v === owner)); assert.ok(filters.some(([k, v]) => k === 'id' && v === fighter));
});

test('MCP 점검: short UUID schemas without $schema; a cup entry waits for the finished cup; a record drops package pins', async () => {
  const ticket = crypto.randomUUID(); let polls = 0;
  const arena = { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), pollMs: 1, pollTries: 5, fetcher: async url => {
    if (url.endsWith('/agent/cup')) return Response.json({ ok: true, ticket, seed: 1, rules: 39, bracket: [] });
    if (url.includes('/cup?id=')) return Response.json({ ok: true, cup: { id: ticket, state: ++polls < 3 ? 'open' : 'done', bouts: [] } });
    if (url.includes('/fighter?id=')) return Response.json({ ok: true, id: 'kuma', won: 1, lost: 0, recent: [{ cup: ticket, round: 0, slot: 0, registered: { x: 'a'.repeat(64) } }] });
    return Response.json({ ok: true });
  } };
  const handle = createCloudHandler({ db: dbFor(), arena });
  const listed = await (await handle(request('tools/list'))).json(), text = JSON.stringify(listed);
  assert.equal(text.includes('json-schema.org'), false);
  const uuid = listed.result.tools.find(t => t.name === 'enter_cup').inputSchema.properties.fighterId;
  assert.ok(uuid.pattern.length < 80, uuid.pattern);
  const entered = (await call(handle, 'enter_cup', { fighterId: crypto.randomUUID() })).structuredContent;
  assert.equal(entered.cup.state, 'done'); assert.equal(polls, 3);
  const record = (await call(handle, 'get_fighter_record', { fighterId: 'kuma' })).structuredContent;
  assert.deepEqual(record.recent, [{ cup: ticket, round: 0, slot: 0 }]);
  assert.equal((await call(handle, 'get_cup', { cupId: 'not-a-uuid' })).isError, true);
});

test('a profile edit goes through the same edit on the owner\'s current package, only the fields given', async () => {
  const fighter = crypto.randomUUID(), filters = [];
  const query = { select() { return this; }, eq(k, v) { filters.push([k, v]); return this; }, is(k, v) { filters.push([k, v]); return this; },
    async maybeSingle() { return { data: { manifest_sha: 'c'.repeat(64) } }; } };
  const handle = createCloudHandler({ db: { ...dbFor(), from: () => query }, arena: { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async () => Response.json({ ok: true }) } });
  const tool = (await (await handle(request('tools/list'))).json()).result.tools.find(t => t.name === 'update_fighter_profile');
  assert.equal(tool.annotations.destructiveHint, true); assert.deepEqual(Object.keys(tool.inputSchema.properties.profile.properties).sort(),
    ['concept', 'description', 'language', 'lines', 'moves', 'name', 'names']);
  assert.equal((await call(handle, 'update_fighter_profile', { fighterId: fighter, profile: {}, idempotencyKey: crypto.randomUUID() })).structuredContent.code, 'invalid-profile');
  assert.equal((await call(handle, 'update_fighter_profile', { fighterId: fighter, profile: { portrait: 'x' }, idempotencyKey: crypto.randomUUID() })).isError, true);
  await call(handle, 'update_fighter_profile', { fighterId: fighter, profile: { lines: { win: 'Again!' } }, idempotencyKey: crypto.randomUUID() });
  assert.ok(filters.some(([k, v]) => k === 'owner_id' && v === owner)); assert.ok(filters.some(([k, v]) => k === 'id' && v === fighter));
});

test('an edit retried with its key after a lost response returns that edit, not a conflict (MCP 점검 2026-10-29)', async () => {
  // The first call moved the fighter to a new package: the retry must rebuild on the package the first call edited, not the new one.
  const f = await profileFixture();
  try {
    const fighter = (await f.register()).fighter_id;
    const db = { ...f.db, auth: { getClaims: async () => ({ data: { claims: { ...claims(), sub: f.owner } } }) },
      rpc: (name, args) => name === 'af_mcp_session_active' ? { data: true } : f.db.rpc(name, args) };
    const handle = createCloudHandler({ db, arena: { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async () => Response.json({ ok: true }) } });
    for (const [tool, change, other] of [['update_fighter_style', { style: { distance: 2 } }, { style: { distance: 4 } }],
      ['update_fighter_profile', { profile: { name: 'Retried fighter' } }, { profile: { name: 'Another name' } }]]) {
      const args = { fighterId: fighter, ...change, idempotencyKey: crypto.randomUUID() };
      const first = (await call(handle, tool, args)).structuredContent;
      assert.equal(first.ok, true, JSON.stringify(first));
      const retried = (await call(handle, tool, args)).structuredContent;
      assert.equal(retried.ok, true, JSON.stringify(retried));
      assert.equal(retried.submissionId, first.submissionId); assert.equal(retried.manifestSha256, first.manifestSha256);
      // The same key for a different change is still refused.
      assert.equal((await call(handle, tool, { ...args, ...other })).structuredContent.code, 'idempotency-conflict');
    }
    assert.equal((await f.sql.query('select count(*)::int as n from public.af_submissions where fighter_id = $1', [fighter])).rows[0].n, 3);
  } finally { await f.sql.close(); }
});

test('every write tool says whether a retry is safe; the ones that make something new on each call say no (MCP 점검 2026-10-29)', async () => {
  const arena = { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async () => Response.json({ ok: true }) };
  const tools = (await (await createCloudHandler({ db: dbFor(), arena, hosted: {} })(request('tools/list'))).json()).result.tools;
  const writes = Object.fromEntries(tools.filter(t => !t.annotations.readOnlyHint).map(t => [t.name, t.annotations.idempotentHint]));
  assert.deepEqual(writes, {
    prepare_fighter_deletion: true, delete_fighter: true, prepare_fighter_registration: true, upload_fighter_asset: true, submit_fighter_registration: true,
    prepare_profile_set: true, upload_profile_set_asset: true, submit_profile_set: true,
    enter_cup: false, update_fighter_profile: true, update_fighter_style: true, enter_fighter: true, withdraw_fighter: true,
    update_fighter_canon: true, post_workshop_note: false, resolve_workshop_note: true, set_fighter_relation: true, manage_world: false, write_world_post: true,
    request_hosted_fighter: false, choose_hosted_look: false, revise_hosted_motion: false, register_hosted_fighter: true, cancel_hosted_fighter: true,
    store_creator_source: true, prepare_creator_source_download: true,
  });
  for (const tool of tools.filter(t => t.annotations.readOnlyHint)) assert.equal(tool.annotations.idempotentHint, true, tool.name);
});

test('a large result\'s short text survives a field with no JSON form', () => {
  const text = compactText({ ok: true, rules: undefined, fighters: Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, name: `Fighter ${i}` })) });
  assert.match(text, /^Full result in structuredContent \(\d+ characters\): ok=true, rules=undefined, fighters\[40\]$/);
});

test('a signed-out read is marked as one, so the arena also counts it on every signed-out agent\'s pool (2026-10-30)', async () => {
  // The host's anonymous user id is the caller's to choose: a fresh one per call had a fresh budget each. The arena now counts a read
  // marked signed out on that id and on the shared signed-out pool too.
  const calls = [], arena = { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async (url, init = {}) => {
    calls.push(init.headers ?? {}); return Response.json({ ok: true });
  } };
  const signedOut = createCloudHandler({ db: { auth: { getClaims: async () => ({ data: null }) }, rpc: async () => ({ data: false }) }, arena });
  const ask = (handle, meta, auth = false) => handle(new Request(CLOUD_RESOURCE, { method: 'POST', headers: { 'content-type': 'application/json',
    accept: 'application/json, text/event-stream', ...(auth ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_bout', arguments: { a: 'kuma', b: 'yume', seed: 1 }, ...(meta ? { _meta: meta } : {}) } }) }));
  await ask(signedOut, { 'openai/subject': 'user-123' });
  assert.match(calls[0]['x-arena-owner'], /^[0-9a-f]{8}-[0-9a-f]{4}-4/); assert.equal(calls[0]['x-arena-signed-out'], '1');
  await ask(signedOut);
  assert.equal(calls[1]['x-arena-owner'], 'public'); assert.equal(calls[1]['x-arena-signed-out'], undefined);
  await ask(createCloudHandler({ db: dbFor(), arena }), { 'openai/subject': 'user-123' }, true);
  assert.equal(calls[2]['x-arena-owner'], owner); assert.equal(calls[2]['x-arena-signed-out'], undefined);
});

test('ChatGPT\'s calls get a short text for a large result (it reads the structured one) and its anonymous user as the read budget', async () => {
  const calls = [], arena = { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async (url, init = {}) => {
    if (url.includes('rankings')) return Response.json({ ok: true, scope: 'registered', minBouts: 5, rankings: [] });
    calls.push(init.headers ?? {}); return Response.json({ ok: true, rules: 39, fighters: Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, name: `Fighter ${i}` })) });
  } };
  const handle = createCloudHandler({ db: dbFor(), arena });
  const ask = meta => handle(new Request(CLOUD_RESOURCE, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_bout', arguments: { a: 'kuma', b: 'yume', seed: 1 }, ...(meta ? { _meta: meta } : {}) } }) }))
    .then(r => r.json()).then(j => j.result);
  const plain = await ask(), chat = await ask({ 'openai/locale': 'ko', 'openai/subject': 'user-123' }), other = await ask({ 'openai/subject': 'user-456' });
  assert.equal(plain.content[0].text, JSON.stringify(plain.structuredContent));
  assert.match(chat.content[0].text, /^Full result in structuredContent \(\d+ characters\): ok=true, rules=39, fighters\[40\]$/);
  assert.deepEqual(chat.structuredContent, plain.structuredContent);
  assert.equal(calls[0]['x-arena-owner'], 'public');
  assert.match(calls[1]['x-arena-owner'], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(calls[1]['x-arena-owner'], calls[2]['x-arena-owner']);
  // A small result stays whole.
  const guide = await handle(new Request(CLOUD_RESOURCE, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_rankings', arguments: { scope: 'registered' }, _meta: { 'openai/locale': 'ko' } } }) })).then(r => r.json());
  assert.equal(guide.result.content[0].text, JSON.stringify(guide.result.structuredContent));
});

test('a cup entry stops waiting at its deadline and hands over to get_cup', async () => {
  const ticket = crypto.randomUUID();
  const arena = { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), pollMs: 20, pollTries: 1000, cupWaitMs: 150, fetcher: async url => {
    if (url.endsWith('/agent/cup')) return Response.json({ ok: true, ticket, seed: 1, rules: 39, bracket: [] });
    if (url.includes('/cup?id=')) return Response.json({ ok: true, cup: { id: ticket, state: 'open', bouts: [] } });
    return Response.json({ ok: true });
  } };
  const handle = createCloudHandler({ db: dbFor(), arena }), started = Date.now();
  const entered = (await call(handle, 'enter_cup', { fighterId: crypto.randomUUID() })).structuredContent;
  assert.deepEqual([entered.state, entered.next], ['open', 'get_cup']);
  assert.ok(Date.now() - started < 1000, `waited ${Date.now() - started} ms`);
});

test('browser calls are taken from the agents that connect (ChatGPT, Grok, Grok Bot, Claude) and refused from other sites', async () => {
  // 2026-10-27: Grok's custom connectors and Cursor's Grok Bot connect too (web/cloud-connect agentOf); 2026-10-28 Claude's connectors.
  const handle = createCloudHandler({ db: dbFor() });
  const preflight = origin => handle(new Request(CLOUD_RESOURCE, { method: 'OPTIONS', headers: { origin } }));
  for (const origin of ['https://chatgpt.com', 'https://grok.com', 'https://www.grok.com', 'https://www.cursor.com', 'https://claude.ai', 'https://claude.com']) {
    const response = await preflight(origin);
    assert.equal(response.status, 204, origin); assert.equal(response.headers.get('access-control-allow-origin'), origin);
  }
  for (const origin of ['https://evil.example', 'https://grok.com.evil.example', 'http://grok.com', 'https://claude.ai.evil.example']) assert.equal((await preflight(origin)).status, 403, origin);
});

// Grok's custom connector (2026-10-28) has no sign-in option: it signs in only when the server asks at its first request. At mcp.oddbout.com
// the public tools answer signed out, so Grok connected without an account. The same server at `<function>/signin` asks every request.
test('the sign-in-first address asks every request for a sign-in; mcp.oddbout.com still answers its public tools signed out', async () => {
  const handle = createCloudHandler({ db: dbFor() });
  const post = (url, method, auth = false, headers = {}) => handle(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json',
    accept: 'application/json, text/event-stream', ...(auth ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: method === 'initialize'
      ? { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'grok', version: '1' } } : {} }) }));
  const metadataUrl = `${SIGN_IN_RESOURCE}/.well-known/oauth-protected-resource`;
  for (const method of ['initialize', 'tools/list']) {
    const denied = await post(SIGN_IN_RESOURCE, method);
    assert.equal(denied.status, 401, method);
    assert.equal(denied.headers.get('www-authenticate'), `Bearer resource_metadata="${metadataUrl}", scope="openid email profile"`);
  }
  const probe = await handle(new Request(SIGN_IN_RESOURCE, { headers: { accept: 'text/event-stream' } }));
  assert.equal(probe.status, 401); assert.match(probe.headers.get('www-authenticate'), /signin\/\.well-known/);
  // Gemini CLI probes with HEAD before it connects (2026-10-29): there too, a sign-in is asked; the public address keeps its 405.
  const head = await handle(new Request(SIGN_IN_RESOURCE, { method: 'HEAD' }));
  assert.equal(head.status, 401); assert.equal(head.headers.get('www-authenticate'), `Bearer resource_metadata="${metadataUrl}", scope="openid email profile"`);
  assert.equal((await handle(new Request(CLOUD_RESOURCE, { method: 'HEAD' }))).status, 405);
  const metadata = await (await handle(new Request(metadataUrl))).json();
  assert.equal(metadata.resource, SIGN_IN_RESOURCE); assert.deepEqual(metadata.authorization_servers, [CLOUD_ISSUER]);
  // Signed in, the same server and tools.
  assert.equal((await (await post(SIGN_IN_RESOURCE, 'initialize', true)).json()).result.serverInfo.name, 'oddbout-cloud');
  assert.ok((await (await post(SIGN_IN_RESOURCE, 'tools/list', true)).json()).result.tools.some(tool => tool.name === 'get_profile'));
  // A revoked connection is asked again.
  assert.equal((await createCloudHandler({ db: dbFor(claims(), false) })(new Request(SIGN_IN_RESOURCE, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) }))).status, 401);
  // Through mcp.oddbout.com/signin (2026-11-01) the same address names itself, so a client that reads the metadata at that host's root finds it.
  // Another named resource does not move it, and naming the sign-in resource does not turn the public address into a sign-in-first one.
  const own = await post(SIGN_IN_RESOURCE, 'initialize', false, { 'x-oddbout-public-resource': PUBLIC_SIGN_IN_RESOURCE });
  assert.equal(own.status, 401);
  assert.equal(own.headers.get('www-authenticate'), `Bearer resource_metadata="${PUBLIC_SIGN_IN_RESOURCE}/.well-known/oauth-protected-resource", scope="openid email profile"`);
  const metadataAs = async resource => (await (await handle(new Request(metadataUrl, { headers: { 'x-oddbout-public-resource': resource } }))).json()).resource;
  assert.equal(await metadataAs(PUBLIC_SIGN_IN_RESOURCE), PUBLIC_SIGN_IN_RESOURCE);
  assert.equal(await metadataAs(PUBLIC_RESOURCE), SIGN_IN_RESOURCE);
  // mcp.oddbout.com (and the function's own address) keep answering their public tools signed out.
  for (const headers of [{ 'x-oddbout-public-resource': PUBLIC_RESOURCE }, {}, { 'x-oddbout-public-resource': PUBLIC_SIGN_IN_RESOURCE }]) {
    assert.equal((await post(CLOUD_RESOURCE, 'initialize', false, headers)).status, 200);
    assert.equal((await post(CLOUD_RESOURCE, 'tools/list', false, headers)).status, 200);
  }
  assert.equal((await handle(new Request(`${SIGN_IN_RESOURCE}/elsewhere`, { method: 'POST' }))).status, 404);
});

// Claude's directory (2026-11-01) takes no AI image generation and Claude has no OpenAI file host: the same server at `<function>/claude`
// lists only the tools a directory reviewer can run there.
test('the directory edition lists only its tools, in English, with every hint; the other addresses keep theirs', async () => {
  const arena = { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async () => Response.json({ ok: true, fighters: [] }) };
  const handle = createCloudHandler({ db: dbFor(), arena, hosted: {} });
  const post = (url, method, params = {}, auth = false, headers = {}) => handle(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json',
    accept: 'application/json, text/event-stream', ...(auth ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }));
  const toolsAt = async (url, headers) => (await (await post(url, 'tools/list', {}, false, headers)).json()).result.tools;
  const hello = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude', version: '1' } };
  const [tools, full] = [await toolsAt(DIRECTORY_RESOURCE), await toolsAt(CLOUD_RESOURCE)];
  assert.equal(tools.length, 27);
  assert.deepEqual(tools.map(t => t.name).sort(), [...DIRECTORY_TITLES.keys()].sort());
  const dropped = full.map(t => t.name).filter(name => !DIRECTORY_TITLES.has(name));
  for (const name of ['request_hosted_fighter', 'list_generation_hosts', 'prepare_fighter_registration', 'submit_profile_set', 'store_creator_source',
    'verify_creator_file_input', 'get_fighter_spec', 'check_creation_readiness']) assert.ok(dropped.includes(name), name);
  for (const tool of tools) {
    const same = full.find(t => t.name === tool.name);
    assert.equal(tool.title, DIRECTORY_TITLES.get(tool.name)); assert.match(tool.title, /^[\x20-\x7e]+$/, tool.name);
    for (const hint of ['readOnlyHint', 'destructiveHint', 'openWorldHint', 'idempotentHint']) assert.equal(typeof tool.annotations[hint], 'boolean', `${tool.name} ${hint}`);
    assert.deepEqual([tool.annotations, tool.inputSchema, tool.securitySchemes], [same.annotations, same.inputSchema, same.securitySchemes], tool.name);
    // No tool sends the agent to one this edition does not have.
    for (const name of dropped) assert.equal(JSON.stringify(tool).includes(name), false, `${tool.name} names ${name}`);
  }
  assert.match(tools.find(t => t.name === 'enter_fighter').description, /creator website \(open_creator_homepage\)/);
  assert.match(full.find(t => t.name === 'enter_fighter').description, /submit_profile_set/);
  assert.equal(full.find(t => t.name === 'get_profile').title, 'ODDBOUT 연결 계정');
  const instructions = async url => (await (await post(url, 'initialize', hello)).json()).result.instructions;
  assert.equal(await instructions(DIRECTORY_RESOURCE), DIRECTORY_INSTRUCTIONS);
  assert.match(await instructions(CLOUD_RESOURCE), /check_creation_readiness/);
  // Signed out like the public address: its public tools answer, an account tool asks for a sign-in at the edition's own metadata.
  assert.equal((await (await post(DIRECTORY_RESOURCE, 'tools/call', { name: 'get_style_guide', arguments: {} })).json()).result.structuredContent.ok, true);
  const signIn = (resource = DIRECTORY_RESOURCE) => `Bearer resource_metadata="${resource}/.well-known/oauth-protected-resource", scope="openid email profile"`;
  const denied = await post(DIRECTORY_RESOURCE, 'tools/call', { name: 'get_profile', arguments: {} });
  assert.equal(denied.status, 401); assert.equal(denied.headers.get('www-authenticate'), signIn());
  const own = await post(DIRECTORY_RESOURCE, 'tools/call', { name: 'get_profile', arguments: {} }, false, { 'x-oddbout-public-resource': PUBLIC_DIRECTORY_RESOURCE });
  assert.equal(own.headers.get('www-authenticate'), signIn(PUBLIC_DIRECTORY_RESOURCE));
  // Signed in, the account tools run; a tool the edition does not list is unknown to it, never run.
  assert.deepEqual((await (await post(DIRECTORY_RESOURCE, 'tools/call', { name: 'get_profile', arguments: {} }, true)).json()).result.structuredContent,
    { id: owner, email: 'test@example.com', nickname: 'ODDBOUT' });
  for (const name of ['request_hosted_fighter', 'prepare_fighter_registration', 'get_fighter_spec']) {
    const unknown = await (await post(DIRECTORY_RESOURCE, 'tools/call', { name, arguments: {} }, true)).json();
    assert.ok(unknown.error || unknown.result?.isError === true, `${name}: ${JSON.stringify(unknown)}`);
    assert.equal(unknown.result?.structuredContent, undefined, name);
  }
  // Its metadata names the address the gateway says it came through, and the Claude page; another named address does not move it.
  const metadataUrl = `${DIRECTORY_RESOURCE}/.well-known/oauth-protected-resource`;
  const metadataAs = async (url, resource) => (await handle(new Request(url, { headers: resource ? { 'x-oddbout-public-resource': resource } : {} }))).json();
  const listed = await metadataAs(metadataUrl, PUBLIC_DIRECTORY_RESOURCE);
  assert.deepEqual([listed.resource, listed.authorization_servers, listed.resource_documentation], [PUBLIC_DIRECTORY_RESOURCE, [CLOUD_ISSUER], DIRECTORY_DOCUMENTATION]);
  for (const resource of [undefined, PUBLIC_RESOURCE, PUBLIC_SIGN_IN_RESOURCE]) assert.equal((await metadataAs(metadataUrl, resource)).resource, DIRECTORY_RESOURCE);
  // Naming the directory address does not turn the public address into the directory edition.
  assert.equal((await metadataAs(`${CLOUD_RESOURCE}/.well-known/oauth-protected-resource`, PUBLIC_DIRECTORY_RESOURCE)).resource, CLOUD_RESOURCE);
  assert.equal((await toolsAt(CLOUD_RESOURCE, { 'x-oddbout-public-resource': PUBLIC_DIRECTORY_RESOURCE })).length, full.length);
  assert.equal((await handle(new Request(`${DIRECTORY_RESOURCE}/elsewhere`, { method: 'POST' }))).status, 404);
});

test('an agent enters his fighter on the watched package and withdraws him; list_fighters shows him only while entered (출전, 2026-10-30)', async () => {
  const f = await profileFixture();
  try {
    const registered = await f.register(), fighter = registered.fighter_id;
    const db = { ...f.db, auth: { getClaims: async () => ({ data: { claims: { ...claims(), sub: f.owner } } }) },
      rpc: (name, args) => name === 'af_mcp_session_active' ? { data: true } : f.db.rpc(name, args) };
    const arena = { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async () => Response.json({ ok: true, fighters: [] }) };
    const handle = createCloudHandler({ db, arena });
    const listed = async () => (await call(handle, 'list_fighters')).structuredContent.registered.some(row => row.id === fighter);
    const clips = ['idle', 'walk', 'run', 'fightIdle', 'combo', 'slam', 'dash', 'block', 'hit', 'groggy', 'fall'];
    assert.equal(await listed(), false);
    assert.equal((await call(handle, 'list_my_fighters')).structuredContent.fighters[0].entered_at, null);
    assert.equal((await call(handle, 'enter_fighter', { fighterId: fighter, expectedManifestSha256: registered.manifest_sha, reviewedClips: clips.slice(1) })).isError, true);
    // The account first, as the site's route does (적대적 리뷰 2026-10-30).
    await f.sql.query('update public.af_creators set enabled=false where owner_id=$1', [f.owner]);
    const disabled = await call(handle, 'enter_fighter', { fighterId: fighter, expectedManifestSha256: registered.manifest_sha, reviewedClips: clips });
    assert.equal(disabled.structuredContent.code, 'account-disabled');
    await f.sql.query('update public.af_creators set enabled=true where owner_id=$1', [f.owner]);
    const stale = await call(handle, 'enter_fighter', { fighterId: fighter, expectedManifestSha256: 'f'.repeat(64), reviewedClips: clips });
    assert.equal(stale.structuredContent.code, 'fighter-changed');
    const entered = (await call(handle, 'enter_fighter', { fighterId: fighter, expectedManifestSha256: registered.manifest_sha, reviewedClips: clips })).structuredContent;
    assert.equal(entered.stage, 'entered', JSON.stringify(entered));
    assert.equal(await listed(), true);
    assert.equal((await call(handle, 'withdraw_fighter', { fighterId: fighter })).structuredContent.stage, 'in-production');
    assert.equal(await listed(), false);
  } finally { await f.sql.close(); }
});
