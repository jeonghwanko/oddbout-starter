import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createCloudHandler as cloudHandler, scopedDatabase, authenticateCloud, GROK_RECONNECT_PAGE, SIGN_IN_PROBLEMS, allowedFileUrl, downloadHostFile, compactText, timedFetch, CLOUD_RESOURCE, CLOUD_ISSUER, PUBLIC_RESOURCE, LEGACY_PUBLIC_RESOURCE, SIGN_IN_RESOURCE, PUBLIC_SIGN_IN_RESOURCE, DIRECTORY_RESOURCE, PUBLIC_DIRECTORY_RESOURCE, DIRECTORY_DOCUMENTATION } from '../mcp/cloud.mjs';
import { DIRECTORY_INSTRUCTIONS, DIRECTORY_TITLES } from '../mcp/cloud/directory-edition.mjs';
import { ALIASES, MERGED_TOOLS } from '../mcp/cloud/merged-tools.mjs';
import { frontNext } from '../mcp/cloud/common.mjs';
import { createHash } from 'node:crypto';
import { verifiedUserId } from '../api/http.mjs';
import { safeClientRedirect, authorizationId } from '../web/cloud-connect/connect.mjs';
import { migratedDatabase } from './helpers/fighter-database.mjs';
import { profileFixture } from './helpers/profile-api-fixture.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
const owner = crypto.randomUUID(), session = crypto.randomUUID(), client = crypto.randomUUID();
const token = 'signed-connector-token-for-test';
const claims = () => ({ sub: owner, client_id: client, session_id: session, iss: CLOUD_ISSUER, aud: CLOUD_RESOURCE,
  role: 'af_mcp', af_mcp: 'registration-v1', is_anonymous: false, exp: Math.floor(Date.now()/1000)+600, email: 'test@example.com' });
// af_mcp_session_state's answer for a live (true) or ended (false) connection, or the answer itself.
const dbFor = (c=claims(), active=true) => ({ auth: { getClaims: async () => ({ data: { claims:c } }) },
  rpc: async () => ({data:active===true?'usable':active===false?'ended':active}) });
const request = (method,params={}, auth=false) => new Request(CLOUD_RESOURCE,{ method:'POST', headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...(auth?{authorization:`Bearer ${token}`}:{})}, body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}) });
const call = async (handle,name,args={}) => (await (await handle(request('tools/call',{name,arguments:args},true))).json()).result;
// A tool's JSON (MCP 최적화 2026-11-05): ChatGPT's calls and get_profile carry it as structuredContent, other hosts' only as the whole text.
const toolJson = result => result.structuredContent ?? JSON.parse(result.content[0].text);
// Each request's own log line goes nowhere here; a test that reads it passes its own log.
const createCloudHandler = options => cloudHandler({ log: () => {}, ...options });
test('MCP discovery, file schemas, profile identity and HTTP auth challenge interoperate', async () => {
  const handle=createCloudHandler({db:dbFor()});
  const init=await (await handle(request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}}))).json();
  assert.equal(init.result.serverInfo.name,'oddbout-cloud');
  const list=await (await handle(request('tools/list'))).json();
  // MCP 통합 1단계 (2026-11-05): 21 until the creator-file reads became check_creator_file's views; 2단계 (2026-11-06): 20 until the
  // profile-set and creator-source writes became kinds of the registration tools, and the account reads views of get_my_fighters; 2단계 B
  // (2026-11-06): 15 until the five reviewed account reads left the list for those views.
  assert.equal(list.result.tools.length,10);
  for(const name of ['prepare_fighter_registration','upload_fighter_asset','check_creator_file']) {
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
  assert.equal(toolJson(contract.result).data.registration.available,true);
  assert.equal(toolJson(contract.result).data.registration.requiresPc,false);
  assert.equal(toolJson(contract.result).data.registration.assetUpload,'openai-fileParams');
  assert.equal(toolJson(contract.result).data.registration.approvalRequired,false);
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
    rpc:async(name,args)=>{seen.push([name,args]);return rpc?rpc():{data:args.p_issued_at!==undefined?state:active?'usable':'ended'}}});
  const req=new Request(SIGN_IN_RESOURCE,{headers:{authorization:`Bearer ${token}`}});
  const expired=now-6*hour;
  assert.equal((await authenticateCloud(dbAt(expired),req)).identity.owner,owner);
  assert.deepEqual(seen,[{allowExpired:true},['af_mcp_session_state',{p_owner:owner,p_session:session,p_client:client,p_edition:'full',p_issued_at:expired-hour,p_expires_at:expired}]]);
  seen.length=0;
  assert.equal((await authenticateCloud(dbAt(now+hour),req)).identity.owner,owner);
  assert.deepEqual(seen,[{allowExpired:true},['af_mcp_session_state',{p_owner:owner,p_session:session,p_client:client,p_edition:'full'}]]);
  // The edition the call came to goes with it (2026-11-01): the database binds the session to its first.
  seen.length=0;
  assert.equal((await authenticateCloud(dbAt(now+hour),req,Date.now,'directory')).identity.owner,owner);
  assert.equal(seen[1][1].p_edition,'directory');
  // Other clients keep the plain expiry; a client that refreshed holds a newer token; a revoked or signed-out connection ends every token;
  // a session bound to the other edition is refused there.
  for(const [state,problem] of [['strict','token-expired'],['refreshed','token-superseded'],['ended','connection-ended'],[null,'connection-ended'],
    ['other-edition','other-address'],['lapsed','sign-in-lapsed']])
    assert.deepEqual(await authenticateCloud(dbAt(expired,{state}),req),{identity:null,problem},state);
  // Without an issue time to compare, the database is not asked.
  seen.length=0;
  assert.deepEqual(await authenticateCloud(dbAt(expired,{iat:null}),req),{identity:null,problem:'token-expired'});
  assert.deepEqual(seen,[{allowExpired:true}]);
  // How long is the database's: 7 days after the session's last use (2026-11-02), so a token a month past its expiry still works for a
  // bot in use, and the same token of a session idle for 7 days is lapsed.
  const month=now-30*24*hour;
  seen.length=0;
  assert.equal((await authenticateCloud(dbAt(month),req)).identity.owner,owner);
  assert.deepEqual(seen[1][1],{p_owner:owner,p_session:session,p_client:client,p_edition:'full',p_issued_at:month-hour,p_expires_at:month});
  assert.deepEqual(await authenticateCloud(dbAt(month,{state:'lapsed'}),req),{identity:null,problem:'sign-in-lapsed'});

  const post=db=>createCloudHandler({db})(new Request(SIGN_IN_RESOURCE,{method:'POST',headers:{'content-type':'application/json',
    accept:'application/json, text/event-stream',authorization:`Bearer ${token}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})}));
  assert.equal((await post(dbAt(expired))).status,200);
  // The challenge keeps its earlier start and adds the reason after it.
  const metadata=`Bearer resource_metadata="${SIGN_IN_RESOURCE}/.well-known/oauth-protected-resource", scope="openid email profile"`;
  for(const [db,problem] of [[dbAt(now-8*24*hour,{state:'lapsed'}),'sign-in-lapsed'],[dbAt(expired,{state:'strict'}),'token-expired'],[dbAt(expired,{state:'refreshed'}),'token-superseded'],
    [dbAt(now+hour,{active:false}),'connection-ended'],[dbAt(expired,{state:'other-edition'}),'other-address'],[{auth:{getClaims:async()=>({data:null,error:{name:'AuthInvalidJwtError',status:400}})}},'invalid-token'],
    [{auth:{getClaims:async()=>{throw new TypeError('Invalid UTF-8 sequence')}}},'invalid-token']]){
    const refused=await post(db);
    assert.equal(refused.status,401,problem);
    // A lapsed sign-in also names the page its user reconnects from.
    const page=problem==='sign-in-lapsed'?GROK_RECONNECT_PAGE:null;
    assert.equal(refused.headers.get('www-authenticate'),
      `${metadata}, error="invalid_token", error_description="${SIGN_IN_PROBLEMS[problem]}"${page?`, error_uri="${page}"`:''}`);
    assert.deepEqual(await refused.json(),{error:'invalid_token',code:problem,error_description:SIGN_IN_PROBLEMS[problem],...(page?{reconnect_url:page}:{})});
  }
  assert.ok(SIGN_IN_PROBLEMS['sign-in-lapsed'].endsWith(GROK_RECONNECT_PAGE));
  assert.match(SIGN_IN_PROBLEMS['token-expired'],/ODDBOUT reconnected in the connector settings/);
  // A quoted-string's characters, without the commas and semicolons a naive challenge parser splits on.
  for(const text of Object.values(SIGN_IN_PROBLEMS)) assert.match(text,/^[\x20\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/);
  const probe=await createCloudHandler({db:dbAt(now-8*24*hour,{state:'strict'})})(new Request(SIGN_IN_RESOURCE,{headers:{authorization:`Bearer ${token}`}}));
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
  const db={...dbFor(),rpc:async name=>({data:name==='af_account'?{invited:true,accessMode:'open',canSubmit:true}:name==='af_mcp_session_state'?'usable':true})};
  const ready=toolJson(await call(createCloudHandler({db}),'check_creation_readiness',{purpose:'registration'}));
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
  assert.equal(toolJson(await call(handle,'upload_fighter_asset',args)).code,'not-found'); assert.equal(downloads,0);
  assert.ok(filters.some(([k,v])=>k==='owner_id'&&v===owner));
  data=row; const bad=await call(handle,'upload_fighter_asset',args);
  assert.equal(toolJson(bad).code,'asset-hash-or-size');assert.ok(!JSON.stringify(bad).includes('secret'));
});
test('manifest registration binds owner/idempotency and does not report queued as registered',async()=>{
  const rpcCalls=[],id=crypto.randomUUID(),key=crypto.randomUUID();
  const query={select(){return this},eq(){return this},async single(){return{data:{manifest:example}}},async maybeSingle(){return{data:{id,status:'queued',manifest_sha:'a'.repeat(64)}}}};
  const db={...dbFor(),from:()=>query,rpc:async(name,args)=>{rpcCalls.push([name,args]);return{data:name==='af_create_submission'?{id,status:'uploading',manifest_sha:args.p_sha}:name==='af_mcp_session_state'?'usable':true}}};
  const handle=createCloudHandler({db,fetcher:async()=>new Response(JSON.stringify(example))});
  const prepared=await call(handle,'prepare_fighter_registration',{manifest:{download_url:'https://files.oaiusercontent.com/f.json',file_id:'file_json'},idempotencyKey:key});
  assert.equal(toolJson(prepared).stage,'uploading');assert.equal(toolJson(prepared).assets.length,example.assets.length);
  assert.equal(rpcCalls.find(([n])=>n==='af_create_submission')[1].p_owner,owner);assert.equal(rpcCalls.find(([n])=>n==='af_create_submission')[1].p_key,key);
  const status=await call(handle,'get_fighter_submission',{submissionId:id});
  assert.equal(toolJson(status).stage,'queued');assert.equal(toolJson(status).fighterId,null);
});
// siteUrl (2026-11-03): where the user follows a submission on the site; registering does not enter a fighter, so a registered one points at
// his all-motions page (where his owner watches the motions and enters him).
test('registration results carry siteUrl: the submission\'s page, then his fighter\'s motions page once registered', async () => {
  const id = crypto.randomUUID(), fighter = crypto.randomUUID(), key = crypto.randomUUID();
  let row = { id, status: 'queued', manifest_sha: 'a'.repeat(64), fighter_id: null };
  // The submission's table answers the submission, the fighters' the fighter (what the lookup and the submission's admission read).
  const query = table => ({ select(){return this}, eq(){return this}, async single(){return{data:{manifest:example}}},
    async maybeSingle(){return{data:table === 'af_fighters' ? { id: fighter, submission_id: id, profile: {}, status: 'production' } : row}} });
  const db = { ...dbFor(), from: query, rpc: async (name, args) => ({ data: name === 'af_create_submission' ? { id, status: 'uploading', manifest_sha: args.p_sha }
    : name === 'af_submit' ? row : name === 'af_mcp_session_state' ? 'usable' : true }) };
  const handle = createCloudHandler({ db, fetcher: async () => new Response(JSON.stringify(example)) });
  const page = `https://oddbout.com/creator.html#submission=${id}`, motions = `https://oddbout.com/creator.html#fighter=${fighter}&view=motions`;
  const prepared = toolJson(await call(handle, 'prepare_fighter_registration', { manifest: { download_url: 'https://files.oaiusercontent.com/f.json', file_id: 'file_json' }, idempotencyKey: key }));
  assert.equal(prepared.siteUrl, page); assert.match(prepared.next, /give him siteUrl to see its progress or why it was refused/);
  assert.equal(toolJson(await call(handle, 'submit_fighter_registration', { submissionId: id })).siteUrl, page);
  assert.equal(toolJson(await call(handle, 'get_fighter_submission', { submissionId: id })).siteUrl, page);
  row = { ...row, status: 'registered', fighter_id: fighter };
  const registered = toolJson(await call(handle, 'get_fighter_submission', { submissionId: id }));
  assert.deepEqual([registered.stage, registered.siteUrl], ['registered', motions]);
  assert.equal(toolJson(await call(handle, 'submit_fighter_registration', { submissionId: id })).siteUrl, motions);
  // The fighter's own lookup, and nowhere for a failed call.
  const found = toolJson(await call(handle, 'get_registered_fighter', { fighterId: fighter }));
  assert.equal(found.siteUrl, motions);
  const refused = createCloudHandler({ db: { ...db, from: table => ({ ...query(table), async maybeSingle() { return { data: null }; } }) } });
  const missing = toolJson(await call(refused, 'get_fighter_submission', { submissionId: id }));
  assert.equal(missing.ok, false); assert.equal(missing.siteUrl, undefined);
});
test('registration update forwards only a valid optional fighter ID and preserves API refusals', async () => {
  const calls = [], id = crypto.randomUUID(), fighter = crypto.randomUUID(), key = crypto.randomUUID(), updateKey = crypto.randomUUID();
  let refusal = null, downloads = 0;
  const query = { select(){return this}, eq(){return this}, async single(){return {data:{manifest:example}}} };
  const db = {...dbFor(), from:()=>query, rpc:async(name,args)=>{
    if (name === 'af_create_submission') { calls.push(args); return refusal ? {error:{message:refusal}} : {data:{id,status:'uploading',manifest_sha:args.p_sha}}; }
    return {data:name === 'af_mcp_session_state' ? 'usable' : true};
  }};
  const handle = createCloudHandler({db,fetcher:async()=>{downloads++;return new Response(JSON.stringify(example))}});
  const args = {manifest:{download_url:'https://files.oaiusercontent.com/f.json',file_id:'file_json'},idempotencyKey:key};
  const tools = (await (await handle(request('tools/list'))).json()).result.tools;
  const schema = tools.find(t=>t.name==='prepare_fighter_registration').inputSchema;
  assert.ok(schema.properties.fighterId); assert.ok(!(schema.required ?? []).includes('fighterId'));
  assert.equal(toolJson(await call(handle,'prepare_fighter_registration',args)).stage,'uploading');
  assert.equal(calls.at(-1).p_fighter,null);
  const update = {...args,idempotencyKey:updateKey,fighterId:fighter};
  assert.equal(toolJson(await call(handle,'prepare_fighter_registration',update)).stage,'uploading');
  assert.equal(calls.at(-1).p_fighter,fighter); assert.equal(calls.at(-1).p_owner,owner); assert.equal(calls.at(-1).p_key,updateKey);
  assert.equal(toolJson(await call(handle,'prepare_fighter_registration',update)).stage,'uploading');
  assert.equal(calls.at(-1).p_key,updateKey); assert.equal(calls.at(-1).p_sha,calls.at(-2).p_sha);
  const before = [downloads,calls.length];
  assert.equal((await call(handle,'prepare_fighter_registration',{...args,fighterId:'not-a-uuid'})).isError,true);
  assert.deepEqual([downloads,calls.length],before);
  for (const code of ['fighter-not-found','idempotency-conflict']) {
    refusal = code;
    assert.equal(toolJson(await call(handle,'prepare_fighter_registration',update)).code,code);
  }
});
test('creator homepage is an authenticated fixed navigation URL without account handoff', async () => {
  let unexpected = 0;
  const db = {...dbFor(),from:()=>{unexpected++;throw Error('unexpected database call')}};
  const handle = createCloudHandler({db,fetcher:async()=>{unexpected++;throw Error('unexpected fetch')}});
  // A view of get_my_fighters since MCP 통합 2단계 B (2026-11-06); its own name still answers.
  const tools = (await (await handle(request('tools/list'))).json()).result.tools, tool = tools.find(t=>t.name==='get_my_fighters');
  assert.equal(tools.some(t=>t.name==='open_creator_homepage'),false);
  assert.equal(tool.securitySchemes[0].type,'oauth2');
  assert.equal(tool.annotations.readOnlyHint,true); assert.equal(tool.annotations.idempotentHint,true);
  assert.equal((await handle(request('tools/call',{name:'open_creator_homepage',arguments:{}}))).status,401);
  for (const [name,args] of [['open_creator_homepage',{}],['get_my_fighters',{view:'homepage'}]]) {
    const result = toolJson(await call(handle,name,args));
    assert.equal(result.url,'https://oddbout.com/creator.html',name);
    assert.match(result.signIn,/normally.*same account as get_profile/,name);
  }
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
    // The edition (2026-11-01): a session's first signed-in call binds it to that edition and the other edition refuses its tokens; the
    // connection's own answer comes first, and a call that is refused binds nothing.
    const edition=(e,iat=null,s=session)=>db.query('select public.af_mcp_session_state($1,$2,$3,$4,$5) value',[owner,s,client,e,iat]).then(r=>r.rows[0].value);
    const other=crypto.randomUUID(), bound=()=>db.query('select session_id,edition from public.af_mcp_session_editions order by edition').then(r=>r.rows);
    assert.equal(await edition('directory',issued),'refreshed');assert.equal(await edition('full',null,other),'ended');assert.deepEqual(await bound(),[]);
    assert.equal(await edition('directory'),'usable');assert.equal(await edition('directory',issued+3600),'usable');
    assert.equal(await edition('full'),'other-edition');assert.equal(await edition('full',issued+3600),'other-edition');
    await db.query('insert into auth.sessions(id,user_id,oauth_client_id,scopes) values($1,$2,$3,$4)',[other,owner,client,'openid email profile']);
    assert.equal(await edition('full',null,other),'usable');assert.equal(await edition('directory',null,other),'other-edition');
    assert.deepEqual(await bound(),[{session_id:session,edition:'directory'},{session_id:other,edition:'full'}]);
    await assert.rejects(edition('admin'),/invalid-edition/);await assert.rejects(edition(null),/invalid-edition/);
    // The last use (2026-11-02): an expired token the grace takes works until 7 days after its session's last use, the later of the
    // token's expiry and the last call let through. The last use is written at most once an hour, and only by a call let through.
    const at=(e,iat,exp)=>db.query('select public.af_mcp_session_state($1,$2,$3,$4,$5,$6) value',[owner,session,client,e,iat,exp]).then(r=>r.rows[0].value);
    const idle=()=>db.query('select extract(epoch from now()-last_used_at)::int age from public.af_mcp_session_editions where session_id=$1',[session]).then(r=>r.rows[0].age);
    const lastUsed=ago=>db.query('update public.af_mcp_session_editions set last_used_at=now()-$1::interval where session_id=$2',[ago,session]);
    const day=86400, nowS=Math.floor(Date.now()/1000), live=issued+3600;
    await lastUsed('8 days');
    assert.equal(await at('directory',live,nowS-8*day),'lapsed');assert.ok(await idle()>=8*day-5,'a lapsed call writes nothing');
    assert.equal(await at('directory',live,nowS-6*day),'usable');assert.ok(await idle()<5,'within 7 days of its expiry, and now used');
    assert.equal(await at('directory',live,nowS-30*day),'usable');
    await lastUsed('6 days 23 hours');assert.equal(await at('directory',live,nowS-30*day),'usable');
    await lastUsed('7 days 1 minute');assert.equal(await at('directory',live,nowS-30*day),'lapsed');
    // The MCP before this sends no expiry: nothing lapses here then.
    assert.equal(await at('directory',live,null),'usable');
    await lastUsed('30 minutes');assert.equal(await at('directory',null,null),'usable');assert.ok(await idle()>=30*60-5,'once an hour');
    await lastUsed('2 hours');assert.equal(await at('directory',null,null),'usable');assert.ok(await idle()<5);
    await lastUsed('2 hours');assert.equal(await at('full',null,null),'other-edition');assert.ok(await idle()>=2*3600-5,'a refused call writes nothing');
    // The connection's own answer comes before the lapse.
    await lastUsed('8 days');assert.equal(await at('directory',issued,nowS-30*day),'refreshed');
    await db.exec("update auth.sessions set scopes='openid'");assert.equal(await active(),false);assert.equal(await state(issued+3600),'ended');
    await db.exec("update auth.sessions set scopes='openid email profile';update auth.oauth_consents set revoked_at=now()");assert.equal(await active(),false);
    assert.equal(await state(issued+3600),'ended');
    await db.exec('set role authenticated');await assert.rejects(active(),/permission denied/);await assert.rejects(state(),/permission denied/);
    await assert.rejects(edition('full'),/permission denied/);await assert.rejects(bound(),/permission denied/);
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
    calls.push([name,args]); return {data:name==='af_mcp_session_state'?'usable':{ok:true,stage:'confirmation-required'}};
  }};
  const handle=createCloudHandler({db});
  const list=(await (await handle(request('tools/list'))).json()).result.tools;
  const tool=list.find(t=>t.name==='delete_fighter');
  assert.equal(tool.annotations.destructiveHint,true);
  assert.ok(tool.inputSchema.required.includes('confirm'));
  assert.ok(!Object.keys(tool.inputSchema.properties).some(k=>/owner|email|session|client/.test(k)));
  const p=toolJson(await call(handle,'prepare_fighter_deletion',{fighterId:fighter}));
  assert.deepEqual(p.account,{id:owner,email:'test@example.com'});
  const args={fighterId:fighter,confirmationToken:confirmation,confirmName:'Exact name'};
  assert.equal((await call(handle,'delete_fighter',{...args,confirm:false})).isError,true);
  assert.equal(calls.filter(([n])=>n==='af_delete_owned_fighter').length,0);
  await call(handle,'delete_fighter',{...args,confirm:true});
  assert.deepEqual(calls.find(([n])=>n==='af_delete_owned_fighter')[1],{
    p_owner:owner,p_session:session,p_client:client,p_fighter:fighter,p_token:confirmation,p_confirm_name:'Exact name'});
  db.rpc=async name=>name==='af_mcp_session_state'?{data:'usable'}:{error:{message:'private database details'}};
  const failed=await call(handle,'delete_fighter',{...args,confirm:true});
  assert.equal(toolJson(failed).code,'database-unavailable');
  assert.ok(!JSON.stringify(failed).includes('private database'));
});

test('owned list excludes deleted rows and owned lookup returns only a deletion receipt',async()=>{
  const filters=[],fighter=crypto.randomUUID(),deletedAt=new Date().toISOString();
  const query={select(){return this},eq(k,v){filters.push([k,v]);return this},is(k,v){filters.push([k,v]);return this},order(){return this},
    async limit(){return{data:[]}},async maybeSingle(){return{data:{id:fighter,deleted_at:deletedAt,profile:{name:'Deleted'}}}}};
  const db={...dbFor(),from:()=>query};
  const handle=createCloudHandler({db});
  assert.deepEqual(toolJson(await call(handle,'list_my_fighters')).fighters,[]);
  assert.ok(filters.some(([k,v])=>k==='deleted_at'&&v===null));
  assert.ok(filters.some(([k,v])=>k==='owner_id'&&v===owner));
  assert.deepEqual(toolJson(await call(handle,'get_registered_fighter',{fighterId:fighter})),
    {ok:true,stage:'deleted',fighterId:fighter,deletedAt});
});

test('agent tools list only with the arena key; reads are public, spars and cups carry the verified owner and the key', async () => {
  const calls = [], key = 'k'.repeat(64);
  const arena = { url: 'https://arena.test/oddbout-arena', key, pollMs: 1, pollTries: 2, fetcher: async (url, init = {}) => {
    calls.push({ url, method: init.method, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
    if (url.endsWith('/fighters')) return Response.json({ ok: true, rules: 39, fighters: [{ id: 'kuma', name: 'KUMA' }] });
    if (url.includes('/agent/') && init.body) return Response.json({ ok: true, echo: JSON.parse(init.body) });
    return Response.json({ ok: true, url });
  } };
  const names = async handle => (await (await handle(request('tools/list'))).json()).result.tools.map(t => t.name);
  assert.equal((await names(createCloudHandler({ db: dbFor() }))).includes('spar'), false);
  assert.equal((await names(createCloudHandler({ db: dbFor(), arena: { url: arena.url, key: null } }))).includes('spar'), false);
  const listed = await names(createCloudHandler({ db: dbFor(), arena }));
  for (const tool of ['browse_oddbout', 'spar', 'manage_career', 'update_fighter'])
    assert.ok(listed.includes(tool), tool);
  // The career writes are manage_career's actions and the edits update_fighter's kinds (MCP 통합 2단계, 2026-11-06); their names still answer.
  for (const tool of ['enter_cup', 'choose_career_prep', 'set_career_auto', 'update_fighter_style', 'update_fighter_profile']) assert.equal(listed.includes(tool), false, tool);
  // The public reads are browse_oddbout's views (MCP 통합 1단계, 2026-11-05); their own names are no longer listed but still answer (below).
  for (const tool of ['get_style_guide', 'list_fighters', 'get_rankings', 'get_fighter_record', 'get_cup', 'read_bout']) assert.equal(listed.includes(tool), false, tool);
  const browse = (await (await createCloudHandler({ db: dbFor(), arena })(request('tools/list'))).json()).result.tools.find(t => t.name === 'browse_oddbout');
  assert.deepEqual(browse.inputSchema.properties.view.enum, ['fighters', 'rankings', 'record', 'cup', 'bout', 'story', 'world', 'style_guide']);
  assert.deepEqual([browse.annotations.readOnlyHint, browse.securitySchemes], [true, [{ type: 'noauth' }]]);
  // Public reads need no connected account and send no key.
  const signedOut = createCloudHandler({ db: { auth: { getClaims: async () => ({ data: null }) }, rpc: async () => ({ data: false }) }, arena });
  const guide = toolJson((await (await signedOut(request('tools/call', { name: 'get_style_guide', arguments: {} }))).json()).result);
  assert.equal(guide.ok, true); assert.deepEqual(guide.contract.temper, ['guard', 'retreat', 'measure', 'patience']);
  const bout = toolJson((await (await signedOut(request('tools/call', { name: 'read_bout', arguments: { a: 'kuma', b: 'yume', seed: 7 } }))).json()).result);
  assert.equal(bout.url, 'https://arena.test/oddbout-arena/bout?a=kuma&b=yume&seed=7');
  // A read goes on the arena's agent budget: signed out, every signed-out agent's together (`public`).
  assert.equal(calls.at(-1).headers['x-arena-agent'], key); assert.equal(calls.at(-1).headers['x-arena-owner'], 'public');
  assert.equal((await (await signedOut(request('tools/call', { name: 'spar', arguments: { fighterId: 'kuma', opponentId: 'yume' } }))).status), 401);
  // Agent calls: the owner is the verified one, never an argument.
  const handle = createCloudHandler({ db: dbFor(), arena });
  const spar = toolJson(await call(handle, 'spar', { fighterId: 'kuma', opponentId: 'yume', seed: 3 }));
  assert.deepEqual(spar.echo, { owner, a: 'kuma', b: 'yume', seed: 3 }); assert.equal(calls.at(-1).headers['x-arena-agent'], key);
  await call(handle, 'read_bout', { a: 'kuma', b: 'yume', seed: 7 }); assert.equal(calls.at(-1).headers['x-arena-owner'], owner);
  const fighter = crypto.randomUUID();
  // The cup's idempotency key goes to the arena lowercase (its UUID check is), as the agent's own (2026-11-03); a call without one is refused.
  const cupKey = crypto.randomUUID();
  const entered = toolJson(await call(handle, 'enter_cup', { fighterId: fighter, idempotencyKey: cupKey.toUpperCase() }));
  assert.deepEqual(entered.echo, { owner, fighter, idempotencyKey: cupKey }); assert.equal(entered.state, 'open'); assert.equal(entered.next, 'browse_oddbout(view=cup)');
  const unkeyed = calls.length;
  assert.equal((await call(handle, 'enter_cup', { fighterId: fighter })).isError, true); assert.equal(calls.length, unkeyed, 'no cup without a key');
  assert.equal(toolJson(await call(handle, 'read_bout', { cupId: fighter })).code, 'invalid-bout');
  // 파이트머니 2판: a career cup and its prep for the verified owner.
  const careerKey = crypto.randomUUID();
  await call(handle, 'enter_cup', { fighterId: fighter, idempotencyKey: careerKey, career: true });
  assert.deepEqual(calls.filter(c => c.url.endsWith('/agent/cup')).at(-1).body, { owner, fighter, idempotencyKey: careerKey, career: true });
  await call(handle, 'get_career', { fighterId: 'kuma' });
  assert.equal(calls.at(-1).url, 'https://arena.test/oddbout-arena/agent/career?fighter=kuma'); assert.equal(calls.at(-1).headers['x-arena-owner'], owner);
  const chose = toolJson(await call(handle, 'choose_career_prep', { cupId: fighter, kind: 'upgrade', card: 'heavy' }));
  assert.deepEqual(chose.echo, { owner, ticket: fighter, choice: { kind: 'upgrade', card: 'heavy' } });
  assert.equal(toolJson(await call(handle, 'choose_career_prep', { cupId: fighter, kind: 'story' })).code, 'invalid-choice');
  const auto = toolJson(await call(handle, 'set_career_auto', { fighterId: 'kuma', on: true }));
  assert.deepEqual(auto.echo, { owner, fighter: 'kuma', on: true });
  const failing = createCloudHandler({ db: dbFor(), arena: { ...arena, fetcher: async () => { throw new Error('down'); } } });
  assert.equal(toolJson(await call(failing, 'get_rankings', {})).code, 'arena-unavailable');
});

test('a style edit goes through the profile edit on the owner\'s current package', async () => {
  const fighter = crypto.randomUUID(), filters = [];
  const query = { select() { return this; }, eq(k, v) { filters.push([k, v]); return this; }, is(k, v) { filters.push([k, v]); return this; },
    async maybeSingle() { return { data: { manifest_sha: 'c'.repeat(64) } }; } };
  const arena = { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async () => Response.json({ ok: true }) };
  const handle = createCloudHandler({ db: { ...dbFor(), from: () => query }, arena });
  const tool = (await (await handle(request('tools/list'))).json()).result.tools.find(t => t.name === 'update_fighter');
  assert.equal(tool.annotations.destructiveHint, true); assert.deepEqual(tool.inputSchema.properties.kind.enum, ['profile', 'style']);
  const result = toolJson(await call(handle, 'update_fighter_style', { fighterId: fighter, style: { distance: 2 }, idempotencyKey: crypto.randomUUID() }));
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
  // No tool keeps zod's own uuid() (the creator-source tools did until 2026-11-05).
  assert.equal(text.includes('"format":"uuid"'), false);
  // manage_career takes enter_cup's UUID or set_career_auto's slug (MCP 통합 2단계): the UUID form keeps its short pattern.
  const fighterId = listed.result.tools.find(t => t.name === 'manage_career').inputSchema.properties.fighterId;
  const uuid = (fighterId.anyOf ?? [fighterId]).find(form => form.pattern?.includes('{8}'));
  assert.ok(uuid.pattern.length < 80, uuid.pattern);
  const entered = toolJson(await call(handle, 'enter_cup', { fighterId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }));
  assert.equal(entered.cup.state, 'done'); assert.equal(polls, 3);
  const record = toolJson(await call(handle, 'get_fighter_record', { fighterId: 'kuma' }));
  assert.deepEqual(record.recent, [{ cup: ticket, round: 0, slot: 0 }]);
  assert.equal((await call(handle, 'get_cup', { cupId: 'not-a-uuid' })).isError, true);
});

test('a profile edit goes through the same edit on the owner\'s current package, only the fields given', async () => {
  const fighter = crypto.randomUUID(), filters = [];
  const query = { select() { return this; }, eq(k, v) { filters.push([k, v]); return this; }, is(k, v) { filters.push([k, v]); return this; },
    async maybeSingle() { return { data: { manifest_sha: 'c'.repeat(64) } }; } };
  const handle = createCloudHandler({ db: { ...dbFor(), from: () => query }, arena: { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async () => Response.json({ ok: true }) } });
  const tool = (await (await handle(request('tools/list'))).json()).result.tools.find(t => t.name === 'update_fighter');
  assert.equal(tool.annotations.destructiveHint, true); assert.deepEqual(Object.keys(tool.inputSchema.properties.profile.properties).sort(),
    ['concept', 'description', 'language', 'lines', 'moves', 'name', 'names']);
  assert.equal(toolJson(await call(handle, 'update_fighter_profile', { fighterId: fighter, profile: {}, idempotencyKey: crypto.randomUUID() })).code, 'invalid-profile');
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
      rpc: (name, args) => name === 'af_mcp_session_state' ? { data: 'usable' } : f.db.rpc(name, args) };
    const handle = createCloudHandler({ db, arena: { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async () => Response.json({ ok: true }) } });
    for (const [tool, change, other] of [['update_fighter_style', { style: { distance: 2 } }, { style: { distance: 4 } }],
      ['update_fighter_profile', { profile: { name: 'Retried fighter' } }, { profile: { name: 'Another name' } }]]) {
      const args = { fighterId: fighter, ...change, idempotencyKey: crypto.randomUUID() };
      const first = toolJson(await call(handle, tool, args));
      assert.equal(first.ok, true, JSON.stringify(first));
      const retried = toolJson(await call(handle, tool, args));
      assert.equal(retried.ok, true, JSON.stringify(retried));
      assert.equal(retried.submissionId, first.submissionId); assert.equal(retried.manifestSha256, first.manifestSha256);
      // The same key for a different change is still refused.
      assert.equal(toolJson(await call(handle, tool, { ...args, ...other })).code, 'idempotency-conflict');
    }
    assert.equal((await f.sql.query('select count(*)::int as n from public.af_submissions where fighter_id = $1', [fighter])).rows[0].n, 3);
  } finally { await f.sql.close(); }
});

test('every write tool says whether a retry is safe; the ones that make something new on each call say no (MCP 점검 2026-10-29)', async () => {
  const arena = { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async () => Response.json({ ok: true }) };
  const tools = (await (await createCloudHandler({ db: dbFor(), arena, hosted: {} })(request('tools/list'))).json()).result.tools;
  const writes = Object.fromEntries(tools.filter(t => !t.annotations.readOnlyHint).map(t => [t.name, t.annotations.idempotentHint]));
  // A merged write (MCP 통합 2단계, 2026-11-06) is retry-safe only if every member is: write_story has post_workshop_note and manage_world,
  // manage_career choose_career_prep, request_hosted_fighter its own request, the revisions and the picture ticket, which make something new each call.
  assert.deepEqual(writes, {
    prepare_fighter_deletion: true, delete_fighter: true, prepare_fighter_registration: true, upload_fighter_asset: true, submit_fighter_registration: true,
    update_fighter: true, enter_fighter: true, write_story: false, manage_career: false, request_hosted_fighter: false, cancel_hosted_fighter: true,
  });
  for (const tool of tools.filter(t => t.annotations.readOnlyHint)) assert.equal(tool.annotations.idempotentHint, true, tool.name);
  // The look and motion revisions advance/replace working artwork and can consume non-refundable generation tokens (public plugin scan,
  // 2026-11-05). Since 2단계 (2026-11-06) they are request_hosted_fighter's steps: the merged tool carries that consequential-action signal,
  // and is open-world because the request itself is.
  const hosted = tools.find(t => t.name === 'request_hosted_fighter');
  assert.deepEqual([hosted.annotations.destructiveHint, hosted.annotations.openWorldHint], [true, true]);
});

test('each edition\'s tools/list stays within its byte budget', async () => {
  // Every conversation pays for the list (MCP 점검 2026-11-03: about 14k tokens for the full one). Measured that day at 57,512, 43,038 and
  // 30,892 bytes; each ceiling sits just above. The descriptions carry product rules, so do not shorten them in bulk to fit: raise a ceiling
  // on purpose, in the change that needs it, and say why. Raised the same day by 500 for both full lists: enter_cup's idempotency key and its
  // retry rule (+269 bytes) on lists already at 57,913 and 43,374. Raised again the same day by 1,500 for both full lists: the career tools
  // (파이트머니 2판 — enter_cup's career, get_career, choose_career_prep, set_career_auto: about +1,400 bytes), and the directory's by 1,500 for the same.
  const arena = { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async () => Response.json({ ok: true }) };
  const bytes = async (options, url) => {
    const response = await createCloudHandler({ db: dbFor(), ...options })(new Request(url, { method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) }));
    return new TextEncoder().encode(await response.text()).length;
  };
  for (const [edition, options, url, ceiling] of [['full, arena and hosted', { arena, hosted: {} }, CLOUD_RESOURCE, 60_000],
    ['full without hosted', { arena }, CLOUD_RESOURCE, 45_500], ['directory', { arena, hosted: {} }, DIRECTORY_RESOURCE, 33_000]]) {
    const size = await bytes(options, url);
    assert.ok(size <= ceiling, `${edition}: tools/list is ${size} bytes, over its ${ceiling}`);
  }
});

test('one request checks its account once for all its in-process routes; a failed check is asked again', async () => {
  const calls = [], answers = [{ error: { message: 'rate-limit' } }, { data: true }];
  const db = { rpc: async (name, args) => { calls.push([name, args]); await new Promise(done => setTimeout(done, 5)); return name === 'af_authorize' ? answers.shift() ?? { data: true } : { data: name }; } };
  const scoped = scopedDatabase(db, owner);
  assert.equal((await scoped.rpc('af_authorize', { p_owner: owner })).error.message, 'rate-limit');
  // Asked again after the refusal; then concurrent routes share the one check, and later ones reuse it.
  const answered = await Promise.all([scoped.rpc('af_authorize', { p_owner: owner }), scoped.rpc('af_authorize', { p_owner: owner })]);
  assert.deepEqual(answered, [{ data: true }, { data: true }]);
  assert.deepEqual(await scoped.rpc('af_authorize', { p_owner: owner }), { data: true });
  assert.equal(calls.filter(([name]) => name === 'af_authorize').length, 2);
  // Another owner's check and every other function still reach the database.
  const other = crypto.randomUUID();
  await scoped.rpc('af_authorize', { p_owner: other }); await scoped.rpc('af_create_submission', { p_owner: owner }); await scoped.rpc('af_create_submission', { p_owner: owner });
  assert.deepEqual(calls.slice(2).map(([name, args]) => [name, args.p_owner]), [['af_authorize', other], ['af_create_submission', owner], ['af_create_submission', owner]]);
  assert.equal((await scoped.auth.getClaims()).data.claims.sub, owner);
  // A thrown check is forgotten too.
  let tries = 0;
  const thrown = scopedDatabase({ rpc: async () => { tries++; throw Error('fetch failed'); } }, owner);
  await assert.rejects(thrown.rpc('af_authorize', { p_owner: owner }), /fetch failed/);
  await assert.rejects(thrown.rpc('af_authorize', { p_owner: owner }), /fetch failed/);
  assert.equal(tries, 2);
});

test('a large result\'s short text survives a field with no JSON form', () => {
  const text = compactText({ ok: true, rules: undefined, fighters: Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, name: `Fighter ${i}` })) });
  assert.match(text, /^Full result in structuredContent \(\d+ characters\): ok=true, rules=undefined, fighters\[40\]$/);
});

test('a large result\'s short text keeps siteUrl whole, and cuts other long values', () => {
  const siteUrl = `https://oddbout.com/creator.html#fighter=${crypto.randomUUID()}&view=motions`;
  const text = compactText({ ok: true, siteUrl, next: 'x'.repeat(100), jobs: Array.from({ length: 80 }, (_, i) => ({ id: `job-${i}` })) });
  assert.ok(text.includes(`siteUrl="${siteUrl}"`), text); assert.ok(text.includes(`next="${'x'.repeat(39)}`) && !text.includes('x'.repeat(41)), text);
  assert.equal(compactText({ ok: true, siteUrl }), JSON.stringify({ ok: true, siteUrl }));
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
  assert.equal(plain.structuredContent, undefined);
  assert.match(chat.content[0].text, /^Full result in structuredContent \(\d+ characters\): ok=true, rules=39, fighters\[40\]$/);
  assert.deepEqual(chat.structuredContent, JSON.parse(plain.content[0].text));
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
  const entered = toolJson(await call(handle, 'enter_cup', { fighterId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }));
  assert.deepEqual([entered.state, entered.next], ['open', 'browse_oddbout(view=cup)']);
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

// MCP 리뷰 2026-11-05: /signin is where the docs send Codex (docs/CLOUD-MCP.md), whose native file input reaches the upload tools through
// OpenAI's file hosts; a /signin without them (#328) broke that. It lists what /mcp lists, to the byte, and says the same. /mcp, which
// ChatGPT's app pins (1.0.3), keeps its list to the byte.
test('the sign-in-first address lists exactly what /mcp lists and says the same; /mcp keeps its list to the byte', async () => {
  const arena = { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async () => Response.json({ ok: true, fighters: [] }) };
  const db = { ...dbFor(), rpc: async name => ({ data: name === 'af_account' ? { invited: true, accessMode: 'open', canSubmit: true } : name === 'af_mcp_session_state' ? 'usable' : true }) };
  const hello = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex', version: '1' } };
  for (const [setup, options, count] of [['arena and hosted', { arena, hosted: {} }, 19], ['bare', {}, 10]]) {
    const handle = createCloudHandler({ db, ...options });
    const text = (url, method, params = {}) => handle(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json',
      accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }))
      .then(response => response.text());
    const [signIn, full] = [await text(SIGN_IN_RESOURCE, 'tools/list'), await text(CLOUD_RESOURCE, 'tools/list')];
    assert.equal(signIn, full, setup);
    const tools = JSON.parse(full).result.tools;
    assert.equal(tools.length, count, setup);
    // The upload tools with OpenAI's file metadata, and the top-level securitySchemes, at both.
    const upload = tools.find(t => t.name === 'prepare_fighter_registration');
    assert.deepEqual([upload._meta['openai/fileParams'], upload.securitySchemes], [['manifest'], [{ type: 'oauth2', scopes: ['openid', 'email', 'profile'] }]], setup);
    // /mcp's list, to the byte (sha256 of its tools). Changed on purpose twice since 219e35d1 (c537ac22…): the creator-source tools' ids
    // took the short UUID_ARG pattern (2026-11-05, −480 B; d807a064…), then read tools of one kind merged into views (MCP 통합 1단계,
    // 2026-11-05: 55 tools to 42, −3,004 B). Neither touched a tool ChatGPT's app review pins: those keep their bytes (below).
    // 2026-11-06: the hosted look/motion revisions declare destructiveHint and non-refundable token use (portal findings).
    // MCP 통합 2단계 A (2026-11-06): the writes and the reviewed registration tools merged too, 42 tools to 24 (ac6d43c8… before).
    // 2단계 B (2026-11-06, once ChatGPT's portal published all 24): the five reviewed reads left the list for get_my_fighters, 24 to 19
    // (ab96aea0… before).
    // 그림 제공자 (2026-11-06): request_hosted_fighter takes imageProvider, grok or gpt (a35f57da… before). Not a tool ChatGPT's app pins.
    if (count === 19) {
      const hash = list => createHash('sha256').update(JSON.stringify(list)).digest('hex');
      // Default A (2026-11-08): the hosted request now explains the ten-minute deadline and no motion-approval gate.
      const request = tools.find(t => t.name === 'request_hosted_fighter');
      assert.match(request.description, /default to A after ten minutes/);
      assert.match(request.description, /without motion approval/);
      assert.equal(hash(tools), '232be1eaec05ee27d1fb1026356362a0eedad2da6a871317229cb4448511f423');
      // Both addresses retain the same inventory when the comparison template metadata is omitted.
      const prior = structuredClone(tools), meta = prior.find(t => t.name === 'get_hosted_fighter')._meta;
      delete meta.ui; delete meta['openai/outputTemplate'];
      assert.equal(hash(prior), 'ab6185f75c809f8b78865663b5ea81f15b003eaff1b6422e7228fa8e8c15c281');
    }
    // ChatGPT's published app 1.0.3 (docs/records/CLOUD-PLUGIN-REVIEW.md): four of its twelve tools are listed with their reviewed bytes (nine
    // until 2단계 B, 16a9ae15…). prepare_fighter_registration, upload_fighter_asset and submit_fighter_registration took a `kind`, and a call
    // without it is the reviewed tool's call; the other five are get_my_fighters views, and their own names still answer (cloud/merged-tools.mjs).
    const reviewed = ['get_fighter_spec', 'get_profile', 'prepare_fighter_deletion', 'delete_fighter'];
    if (count === 19) assert.equal(createHash('sha256').update(JSON.stringify(reviewed.map(name => tools.find(t => t.name === name)))).digest('hex'),
      'ba4f9c2a8c946099ef0ad951cc7cd9a3772ad9031bde7bfbfd03d7c3aa206269');
    // The instructions, and what the creation guide and the readiness check answer, are the same at both.
    const [signInHello, fullHello] = [await text(SIGN_IN_RESOURCE, 'initialize', hello), await text(CLOUD_RESOURCE, 'initialize', hello)];
    assert.equal(signInHello, fullHello, setup); assert.match(JSON.parse(fullHello).result.instructions, /Use host file attachments/);
    for (const [name, args] of [['get_fighter_spec', { section: 'overview' }], ['get_fighter_spec', { section: 'creation' }], ['check_creation_readiness', { purpose: 'generation' }]]) {
      const answer = async url => text(url, 'tools/call', { name, arguments: args });
      assert.equal(await answer(SIGN_IN_RESOURCE), await answer(CLOUD_RESOURCE), `${setup}: ${name} ${JSON.stringify(args)}`);
    }
    const overview = toolJson(JSON.parse(await text(SIGN_IN_RESOURCE, 'tools/call', { name: 'get_fighter_spec', arguments: { section: 'overview' } })).result);
    assert.equal(overview.data.registration.assetUpload, 'openai-fileParams', setup);
  }
});

// Claude's directory (2026-11-01) takes no AI image generation and Claude has no OpenAI file host: the same server at `<function>/claude`
// lists only the tools a directory reviewer can run there.
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
/** A JSON-RPC answer to a tool this address does not list: the SDK's unknown-tool error, no result (MCP 리뷰 2026-11-05: `error || isError` let a run pass). */
const unknownTool = (answer, name) => assert.deepEqual([answer.result, answer.error?.code, /Tool (\S+) not found/.exec(answer.error?.message ?? '')?.[1]],
  [undefined, -32602, name], JSON.stringify(answer));
test('the directory edition lists only its tools, in English, with every hint; the other addresses keep theirs', async () => {
  const arena = { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async () => Response.json({ ok: true, fighters: [] }) };
  const handle = createCloudHandler({ db: dbFor(), arena, hosted: {} });
  const post = (url, method, params = {}, auth = false, headers = {}) => handle(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json',
    accept: 'application/json, text/event-stream', ...(auth ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }));
  const toolsAt = async (url, headers) => (await (await post(url, 'tools/list', {}, false, headers)).json()).result.tools;
  const hello = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude', version: '1' } };
  const [tools, full] = [await toolsAt(DIRECTORY_RESOURCE), await toolsAt(CLOUD_RESOURCE)];
  // /mcp keeps all its tools: ChatGPT's submitted plugin is pinned to its list. Here set_fighter_relation and manage_world split by kind of write.
  const split = ['propose_fighter_relation', 'answer_fighter_relation', 'end_fighter_relation', 'create_world', 'update_world', 'remove_world_fighter',
    'set_fighter_world'];
  assert.deepEqual([tools.length, full.length], [35, 19]);
  assert.deepEqual(tools.map(t => t.name).sort(), [...DIRECTORY_TITLES.keys()].sort());
  // What this edition does not have: the full edition's tools, and the reads it merged into views (MCP 통합 1단계, 2026-11-05), by their own names.
  const dropped = [...full.map(t => t.name), ...ALIASES.keys()].filter(name => !DIRECTORY_TITLES.has(name));
  for (const name of ['request_hosted_fighter', 'list_generation_hosts', 'prepare_fighter_registration', 'submit_profile_set', 'store_creator_source',
    'verify_creator_file_input', 'get_fighter_spec', 'check_creation_readiness', 'set_fighter_relation', 'manage_world',
    // 그림 올리기 표 (2026-11-01): pictures for a hosted fighter, which the directory does not take.
    'start_picture_upload', 'get_picture_upload', 'report_picture_link']) assert.ok(dropped.includes(name), name);
  for (const tool of tools) {
    // A full tool by this name may be a merged tool that kept it (enter_fighter, 2단계): this tool is its default selector there.
    const kept = MERGED_TOOLS.find(merged => merged.name === tool.name);
    const same = full.find(t => t.name === tool.name), alias = ALIASES.get(tool.name)
      ?? (kept ? { tool: kept.name, key: kept.key ?? 'view', view: kept.defaultView } : undefined);
    assert.equal(same === undefined, split.includes(tool.name) || ALIASES.has(tool.name), tool.name);
    assert.equal(tool.title, DIRECTORY_TITLES.get(tool.name)); assert.match(tool.title, /^[\x20-\x7e]+$/, tool.name);
    // The listing is worldwide: no Korean anywhere in what Claude reads of a tool (ODDBOUT's own state names included).
    assert.doesNotMatch(JSON.stringify(tool), HANGUL, tool.name);
    for (const hint of ['readOnlyHint', 'destructiveHint', 'openWorldHint', 'idempotentHint']) assert.equal(typeof tool.annotations[hint], 'boolean', `${tool.name} ${hint}`);
    // OpenAI's tool metadata (securitySchemes, openai/*) is ChatGPT's app's, at /mcp only (2026-11-05).
    assert.deepEqual([tool._meta, tool.securitySchemes], [undefined, undefined], tool.name);
    // The title is repeated among the annotations here only; /mcp's annotations stay as they were.
    if (same && !kept) {
      assert.deepEqual([tool.annotations, tool.inputSchema], [{ title: tool.title, ...same.annotations }, same.inputSchema], tool.name);
      assert.equal(same.annotations.title, undefined, tool.name);
    } else if (alias) {
      // A tool the full edition merged is a selector there (its own name still answers there); here it keeps its name and arguments. The
      // merged tool is as consequential as this member: a read stays a read, a destructive member makes it destructive, a member that is
      // not retry-safe makes it not.
      const merged = full.find(t => t.name === alias.tool);
      assert.ok(merged.inputSchema.properties[alias.key].enum.includes(alias.view), tool.name);
      assert.equal(merged.annotations.readOnlyHint, tool.annotations.readOnlyHint, tool.name);
      if (tool.annotations.destructiveHint) assert.equal(merged.annotations.destructiveHint, true, tool.name);
      if (!tool.annotations.idempotentHint) assert.equal(merged.annotations.idempotentHint, false, tool.name);
      for (const key of Object.keys(tool.inputSchema.properties ?? {})) assert.ok(key in merged.inputSchema.properties, `${tool.name} ${key}`);
    } else {
      // A split write is public and may change the public name (nickname) or remove something; only opening a world makes a new one each time.
      assert.deepEqual(tool.annotations, { title: tool.title, readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: tool.name !== 'create_world' }, tool.name);
      assert.equal('action' in tool.inputSchema.properties, false, tool.name);
    }
    // No tool sends the agent to one this edition does not have.
    for (const name of dropped) assert.doesNotMatch(JSON.stringify(tool), new RegExp(`\\b${name}\\b`), `${tool.name} names ${name}`);
  }
  assert.match(tools.find(t => t.name === 'enter_fighter').description, /creator website \(open_creator_homepage\)/);
  // A fighter without its profile set is told where one comes from: this connector takes no files.
  assert.match(tools.find(t => t.name === 'enter_fighter').description, /made on the ODDBOUT website gets it at registration/);
  // The full edition names the profile-set submit by its merged form (2단계, 2026-11-06).
  assert.match(full.find(t => t.name === 'enter_fighter').description, /submit_fighter_registration\(kind=profile_set\)/);
  // What its tools answer of a fighter's front (frontNext, in get_registered_fighter and enter_fighter) names none of them either.
  for (const front of [{ required: true, ok: false }, { required: true, ok: false, profileSetId: 'p', status: 'uploading' },
    { required: true, ok: false, profileSetId: 'p', status: 'rejected', frontCheck: 'fail' }]) {
    const next = frontNext(front, { directory: true });
    for (const name of dropped) assert.equal(next.includes(name), false, `${name} in ${next}`);
    assert.doesNotMatch(next, HANGUL); assert.match(next, /cannot upload it: the user uploads it from the ODDBOUT app in ChatGPT|finish it where it was started/);
  }
  assert.equal(full.find(t => t.name === 'get_profile').title, 'ODDBOUT 연결 계정');
  const instructions = async url => (await (await post(url, 'initialize', hello)).json()).result.instructions;
  assert.equal(await instructions(DIRECTORY_RESOURCE), DIRECTORY_INSTRUCTIONS);
  // How to make a fighter, answered without a sign-in: the website's address is in the instructions.
  assert.match(DIRECTORY_INSTRUCTIONS, /https:\/\/oddbout\.com\/creator\.html/); assert.doesNotMatch(DIRECTORY_INSTRUCTIONS, HANGUL);
  assert.match(await instructions(CLOUD_RESOURCE), /get_my_fighters\(view=readiness\)/);
  // Signed out like the public address: its public tools answer, an account tool asks for a sign-in at the edition's own metadata.
  assert.equal(toolJson((await (await post(DIRECTORY_RESOURCE, 'tools/call', { name: 'get_style_guide', arguments: {} })).json()).result).ok, true);
  const signIn = (resource = DIRECTORY_RESOURCE) => `Bearer resource_metadata="${resource}/.well-known/oauth-protected-resource", scope="openid email profile"`;
  const denied = await post(DIRECTORY_RESOURCE, 'tools/call', { name: 'get_profile', arguments: {} });
  assert.equal(denied.status, 401); assert.equal(denied.headers.get('www-authenticate'), signIn());
  // A tool it does not list is unknown signed out too: no sign-in is started to reach a "not found".
  for (const name of ['request_hosted_fighter', 'prepare_fighter_registration']) {
    const missing = await post(DIRECTORY_RESOURCE, 'tools/call', { name, arguments: {} });
    assert.notEqual(missing.status, 401, name);
    unknownTool(await missing.json(), name);
  }
  // At /mcp the same signed-out call still asks for the sign-in.
  assert.equal((await post(CLOUD_RESOURCE, 'tools/call', { name: 'prepare_fighter_registration', arguments: {} })).status, 401);
  const own = await post(DIRECTORY_RESOURCE, 'tools/call', { name: 'get_profile', arguments: {} }, false, { 'x-oddbout-public-resource': PUBLIC_DIRECTORY_RESOURCE });
  assert.equal(own.headers.get('www-authenticate'), signIn(PUBLIC_DIRECTORY_RESOURCE));
  // Signed in, the account tools run; a tool the edition does not list is unknown to it, never run.
  assert.deepEqual((await (await post(DIRECTORY_RESOURCE, 'tools/call', { name: 'get_profile', arguments: {} }, true)).json()).result.structuredContent,
    { id: owner, email: 'test@example.com', nickname: 'ODDBOUT' });
  for (const name of ['request_hosted_fighter', 'prepare_fighter_registration', 'get_fighter_spec']) {
    unknownTool(await (await post(DIRECTORY_RESOURCE, 'tools/call', { name, arguments: {} }, true)).json(), name);
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
      rpc: (name, args) => name === 'af_mcp_session_state' ? { data: 'usable' } : f.db.rpc(name, args) };
    const arena = { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async () => Response.json({ ok: true, fighters: [] }) };
    const handle = createCloudHandler({ db, arena });
    const listed = async () => toolJson(await call(handle, 'list_fighters')).registered.some(row => row.id === fighter);
    const clips = ['idle', 'walk', 'run', 'fightIdle', 'combo', 'slam', 'dash', 'block', 'hit', 'groggy', 'fall'];
    assert.equal(await listed(), false);
    assert.equal(toolJson(await call(handle, 'list_my_fighters')).fighters[0].entered_at, null);
    assert.equal((await call(handle, 'enter_fighter', { fighterId: fighter, expectedManifestSha256: registered.manifest_sha, reviewedClips: clips.slice(1) })).isError, true);
    // The account first, as the site's route does (적대적 리뷰 2026-10-30).
    await f.sql.query('update public.af_creators set enabled=false where owner_id=$1', [f.owner]);
    const disabled = await call(handle, 'enter_fighter', { fighterId: fighter, expectedManifestSha256: registered.manifest_sha, reviewedClips: clips });
    assert.equal(toolJson(disabled).code, 'account-disabled');
    await f.sql.query('update public.af_creators set enabled=true where owner_id=$1', [f.owner]);
    const stale = await call(handle, 'enter_fighter', { fighterId: fighter, expectedManifestSha256: 'f'.repeat(64), reviewedClips: clips });
    assert.equal(toolJson(stale).code, 'fighter-changed');
    const entered = toolJson(await call(handle, 'enter_fighter', { fighterId: fighter, expectedManifestSha256: registered.manifest_sha, reviewedClips: clips }));
    assert.equal(entered.stage, 'entered', JSON.stringify(entered));
    assert.equal(await listed(), true);
    assert.equal(toolJson(await call(handle, 'withdraw_fighter', { fighterId: fighter })).stage, 'in-production');
    assert.equal(await listed(), false);
  } finally { await f.sql.close(); }
});

test('initialize answers each 2025 protocol version the server speaks, 2025-11-25 included', async () => {
  const handle = createCloudHandler({ db: dbFor() });
  for (const version of ['2025-03-26', '2025-06-18', '2025-11-25']) {
    const init = await (await handle(request('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'test', version: '1' } }))).json();
    assert.equal(init.result.protocolVersion, version);
  }
});

// MCP 점검 2026-11-03: one call has a budget from its request's arrival, ends when its client goes away, and leaves one log line.
const cupArena = (issueMs = 0) => {
  const seen = { polls: 0 };
  return { seen, arena: { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), pollMs: 20, pollTries: 1000, fetcher: async url => {
    if (url.endsWith('/agent/cup')) { await new Promise(done => setTimeout(done, issueMs)); return Response.json({ ok: true, ticket: crypto.randomUUID() }); }
    if (url.includes('/cup?id=')) { seen.polls++; return Response.json({ ok: true, cup: { state: 'open', bouts: [] } }); }
    return Response.json({ ok: true, fighters: [] });
  } } };
};
const toolCall = (name, args, { signal, headers = {} } = {}) => new Request(CLOUD_RESOURCE, { method: 'POST', signal, headers: { 'content-type': 'application/json',
  accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, ...headers },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });

test('enter_cup ends by the call budget counted from the request, its issue included, and says to read the cup', async t => {
  t.mock.method(console, 'log', () => {});
  const { arena, seen } = cupArena(150);
  const handle = createCloudHandler({ db: dbFor(), arena, budgetMs: 400 });
  const started = Date.now();
  const entered = toolJson(await call(handle, 'enter_cup', { fighterId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }));
  assert.equal(entered.state, 'open'); assert.equal(entered.next, 'browse_oddbout(view=cup)');
  // The wait once started after the issue: 150 ms of issue, then the whole CUP_WAIT_MS.
  assert.ok(Date.now() - started < 1500, `${Date.now() - started} ms`); assert.ok(seen.polls >= 1 && seen.polls < 20, `${seen.polls} polls`);
});

test('a client that goes away ends a waiting call at once', async t => {
  t.mock.method(console, 'log', () => {});
  const { arena, seen } = cupArena();
  const handle = createCloudHandler({ db: dbFor(), arena });
  const gone = new AbortController(), started = Date.now();
  setTimeout(() => gone.abort(), 100);
  const entered = toolJson((await (await handle(toolCall('enter_cup', { fighterId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }, { signal: gone.signal }))).json()).result);
  assert.equal(entered.state, 'open');
  assert.ok(Date.now() - started < 2000, `${Date.now() - started} ms`);
  const polls = seen.polls;
  await new Promise(done => setTimeout(done, 100));
  assert.equal(seen.polls, polls, 'no polling after the call ended');
});

test('every tool call leaves one log line: tool, client, protocol and request id, never its arguments, token or account', async t => {
  const logged = t.mock.method(console, 'log', () => {});
  const handle = createCloudHandler({ db: dbFor() });
  const id = crypto.randomUUID();
  await handle(toolCall('get_profile', {}, { headers: { 'mcp-protocol-version': '2025-11-25', 'x-request-id': id } }));
  // No version header (the SDK refuses a malformed one before any tool runs), and a request id that is not the gateway's.
  await handle(toolCall('get_profile', {}, { headers: { 'x-request-id': 'forged-id' } }));
  const lines = logged.mock.calls.map(entry => JSON.parse(entry.arguments[0]));
  assert.equal(lines.length, 2);
  assert.deepEqual({ ...lines[0], ms: 0 }, { stage: 'mcp-call', tool: 'get_profile', edition: 'full', client, protocol: '2025-11-25', requestId: id, ms: 0, ok: true });
  assert.equal(typeof lines[0].ms, 'number');
  assert.equal(lines[1].protocol, null); assert.match(lines[1].requestId, /^[0-9a-f-]{36}$/); assert.notEqual(lines[1].requestId, 'forged-id');
  const raw = logged.mock.calls.map(entry => entry.arguments[0]).join('\n');
  for (const secret of [token, 'test@example.com', owner, 'Bearer']) assert.ok(!raw.includes(secret), secret);
});

test('a server fault logs what failed behind its code; a refusal logs no detail; the caller gets only the code', async t => {
  const errors = t.mock.method(console, 'error', () => {}), logged = t.mock.method(console, 'log', () => {});
  const bug = createCloudHandler({ db: { ...dbFor(), from: () => { throw new TypeError('private row value'); } } });
  const result = await call(bug, 'list_my_fighters');
  assert.equal(toolJson(result).code, 'cloud-operation-unavailable'); assert.ok(!JSON.stringify(result).includes('private row'));
  const [line] = errors.mock.calls.map(entry => JSON.parse(entry.arguments[0]));
  assert.deepEqual([line.stage, line.tool, line.ok, line.code], ['mcp-call', 'list_my_fighters', false, 'cloud-operation-unavailable']);
  assert.deepEqual(line.error, { name: 'TypeError', message: 'private row value' }); assert.ok(line.stack.length >= 1);
  // A deletion the database could not run is its fault (503, logged with the database's error); before 2026-11-03 it was a silent 400.
  const db = { ...dbFor(), rpc: async name => name === 'af_mcp_session_state' ? { data: 'usable' } : { error: { message: 'private database details', code: '57014' } } };
  const args = { fighterId: crypto.randomUUID(), confirmationToken: crypto.randomUUID(), confirmName: 'Exact name', confirm: true };
  const failed = await call(createCloudHandler({ db }), 'delete_fighter', args);
  assert.equal(toolJson(failed).code, 'database-unavailable'); assert.ok(!JSON.stringify(failed).includes('private database'));
  const database = JSON.parse(errors.mock.calls.at(-1).arguments[0]);
  assert.deepEqual([database.tool, database.code, database.error], ['delete_fighter', 'database-unavailable', { message: 'private database details', code: '57014' }]);
  // The deletion's own refusal stays the caller's: an ordinary line without detail.
  const refusing = { ...dbFor(), rpc: async name => name === 'af_mcp_session_state' ? { data: 'usable' } : { error: { message: 'deletion-name-mismatch' } } };
  assert.equal(toolJson(await call(createCloudHandler({ db: refusing }), 'delete_fighter', args)).code, 'deletion-name-mismatch');
  const refusal = JSON.parse(logged.mock.calls.at(-1).arguments[0]);
  assert.deepEqual([refusal.tool, refusal.ok, refusal.code, refusal.error], ['delete_fighter', false, 'deletion-name-mismatch', undefined]);
  assert.equal(errors.mock.callCount(), 2);
});

test('the database fetch ends by its limit and keeps a caller\'s own signal; a failed download keeps no URL behind its code', async () => {
  /** @type {typeof fetch} */
  const hanging = (input, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  // Node does not keep a process alive for AbortSignal.timeout alone; a server always is.
  const alive = setInterval(() => {}, 1000), started = Date.now();
  try {
    await assert.rejects(timedFetch(50, hanging)('https://db.test/rest/v1/af_fighters'), { name: 'TimeoutError' });
    assert.ok(Date.now() - started < 1000);
    const caller = new AbortController(); setTimeout(() => caller.abort(), 20);
    await assert.rejects(timedFetch(5000, hanging)('https://db.test/rest/v1/af_fighters', { signal: caller.signal }), { name: 'AbortError' });
  } finally { clearInterval(alive); }
  const url = 'https://files.oaiusercontent.com/file-x?sig=private-signature';
  const failure = await downloadHostFile({ download_url: url, file_id: 'f' }, 10, async () => { throw new TypeError(`error sending request for url (${url})`); })
    .catch(error => error);
  assert.deepEqual([failure.status, failure.message, failure.cause], [503, 'file-download-unavailable', { name: 'TypeError' }]);
});

// SDK v2 (2026-11-03): the same server answers 2026-07-28 clients (server/discover, Mcp-Method and Mcp-Name headers) beside the 2025 ones.
test('a 2026-07-28 client discovers, lists and calls the same tools; the list keeps its published shape; the 2025 era still answers', async t => {
  const logged = t.mock.method(console, 'log', () => {});
  const handle = createCloudHandler({ db: dbFor() }), lists = [];
  const fetchVia = async (url, init) => {
    const response = await handle(new Request(url, init));
    if (new Headers(init?.headers).get('mcp-method') === 'tools/list') lists.push(await response.clone().json());
    return response;
  };
  for (const versionNegotiation of [{ mode: { pin: '2026-07-28' } }, { mode: 'auto' }]) {
    const client = new Client({ name: 'test-2026', version: '1' }, { versionNegotiation });
    await client.connect(new StreamableHTTPClientTransport(new URL(CLOUD_RESOURCE), { fetch: fetchVia,
      requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    try {
      assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');
      assert.equal((await client.listTools()).tools.length, 10);
      assert.deepEqual((await client.callTool({ name: 'get_profile', arguments: {} })).structuredContent, { id: owner, email: 'test@example.com', nickname: 'ODDBOUT' });
    } finally { await client.close(); }
  }
  // What hosts read of the list: securitySchemes beside the tool, no JSON Schema draft line, as for the 2025 era.
  const tools = lists[0].result.tools, profile = tools.find(tool => tool.name === 'get_profile');
  assert.deepEqual(profile.securitySchemes, [{ type: 'oauth2', scopes: ['openid', 'email', 'profile'] }]);
  assert.equal(JSON.stringify(lists[0]).includes('json-schema.org'), false);
  // A 2026 client may keep the list five minutes; a 2025 answer carries no cache fields.
  assert.deepEqual([lists[0].result.ttlMs, lists[0].result.cacheScope], [300_000, 'private']);
  const legacyList = await (await handle(new Request(CLOUD_RESOURCE, { method: 'POST', headers: { 'content-type': 'application/json',
    accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) }))).json();
  assert.equal(legacyList.result.tools.length, 10); assert.equal('ttlMs' in legacyList.result, false);
  // The call's log line names the era it spoke.
  const lines = logged.mock.calls.map(entry => JSON.parse(entry.arguments[0])).filter(line => line.tool === 'get_profile');
  assert.deepEqual(lines.map(line => line.protocol), ['2026-07-28', '2026-07-28']);
  // A 2026 call to an account tool without a sign-in is still the 401 that names the resource metadata.
  const signedOut = await handle(new Request(CLOUD_RESOURCE, { method: 'POST', headers: { 'content-type': 'application/json',
    accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': 'get_profile' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_profile', arguments: {},
      _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }) }));
  assert.equal(signedOut.status, 401); assert.match(signedOut.headers.get('www-authenticate'), /resource_metadata=/);
  // A client that never opted in speaks 2025-11-25 and gets the same tools.
  const legacy = new Client({ name: 'test-2025', version: '1' });
  await legacy.connect(new StreamableHTTPClientTransport(new URL(CLOUD_RESOURCE), { fetch: (url, init) => handle(new Request(url, init)) }));
  try {
    assert.equal(legacy.getNegotiatedProtocolVersion(), '2025-11-25');
    assert.equal((await legacy.listTools()).tools.length, 10);
  } finally { await legacy.close(); }
});

// MCP 최적화 2026-11-05: a host other than ChatGPT got every result twice, the whole JSON as its text and again as structuredContent.
test('a result goes once to a host that reads its text, as before to ChatGPT, and get_profile keeps its structured result for both', async () => {
  const arena = { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async () => Response.json({ ok: true, rules: 39,
    fighters: Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, name: `Fighter ${i}` })) }) };
  const handle = createCloudHandler({ db: dbFor(), arena }), chatgpt = { 'openai/locale': 'ko' }, bout = { a: 'kuma', b: 'yume', seed: 1 };
  const ask = (name, args, meta) => handle(new Request(CLOUD_RESOURCE, { method: 'POST', headers: { 'content-type': 'application/json',
    accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, ...(meta ? { _meta: meta } : {}) } }) }))
    .then(response => response.json()).then(answer => answer.result);
  const plain = await ask('read_bout', bout), chat = await ask('read_bout', bout, chatgpt);
  assert.equal(plain.structuredContent, undefined); assert.equal(plain.content.length, 1);
  const value = JSON.parse(plain.content[0].text);
  assert.equal(value.fighters.length, 40);
  assert.match(chat.content[0].text, /^Full result in structuredContent \(\d+ characters\): ok=true, rules=39, fighters\[40\]$/);
  assert.deepEqual(chat.structuredContent, value);
  // A refusal keeps isError; its JSON is the text alone, and ChatGPT's is whole beside its structured copy as before.
  const refused = await ask('read_bout', {}), chatRefused = await ask('read_bout', {}, chatgpt);
  assert.deepEqual([refused.isError, refused.structuredContent, JSON.parse(refused.content[0].text)], [true, undefined, { ok: false, code: 'invalid-bout' }]);
  assert.deepEqual([chatRefused.isError, chatRefused.structuredContent, chatRefused.content[0].text], [true, { ok: false, code: 'invalid-bout' },
    JSON.stringify({ ok: false, code: 'invalid-bout' })]);
  // get_profile has an outputSchema, which needs the structured result: every host gets it.
  for (const meta of [undefined, chatgpt]) {
    const profile = await ask('get_profile', {}, meta);
    assert.deepEqual(profile.structuredContent, { id: owner, email: 'test@example.com', nickname: 'ODDBOUT' });
    assert.deepEqual(JSON.parse(profile.content[0].text), profile.structuredContent);
  }
});

test('every MCP request leaves one line: address, edition, method, tool, ChatGPT or not, status, bytes and time — never the token or the account', async () => {
  const lines = [], handle = cloudHandler({ db: dbFor(), log: line => lines.push(line) });
  const bytes = async response => Buffer.byteLength(await response.text());
  const post = (url, body, headers = {}) => handle(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json',
    accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }) }));
  const listed = await bytes(await handle(request('tools/list')));
  const profile = await (await post(DIRECTORY_RESOURCE, { method: 'tools/call', params: { name: 'get_profile', arguments: {}, _meta: { 'openai/locale': 'ko' } } },
    { authorization: `Bearer ${token}` })).text();
  // The answer is sent whole after it is counted.
  assert.equal(JSON.parse(profile).result.structuredContent.id, owner);
  const denied = await handle(request('tools/call', { name: 'get_profile', arguments: {} }));
  assert.equal(denied.status, 401);
  const deniedBytes = await bytes(denied), unreadable = await bytes(await handle(new Request(CLOUD_RESOURCE, { method: 'POST', body: 'not json' })));
  // MCP 리뷰 2026-11-05: /signin is the full edition too, so the line names the address; ChatGPT's refused sign-in is named ChatGPT's (the
  // body says so, not the sign-in); a refused browser origin is a POST at an MCP address too.
  const signIn = await post(SIGN_IN_RESOURCE, { method: 'tools/list', params: {} });
  assert.equal(signIn.status, 401);
  const signInBytes = await bytes(signIn);
  const chatDenied = await post(CLOUD_RESOURCE, { method: 'tools/call', params: { name: 'get_profile', arguments: {}, _meta: { 'openai/subject': 'user-1' } } });
  assert.equal(chatDenied.status, 401);
  const chatDeniedBytes = await bytes(chatDenied);
  const foreign = await post(CLOUD_RESOURCE, { method: 'tools/list', params: {} }, { origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  const foreignBytes = await bytes(foreign);
  // No MCP message, no line: the metadata, a probe, a preflight, a path that is no MCP address.
  for (const [url, init] of [[`${CLOUD_RESOURCE}/.well-known/oauth-protected-resource`, {}], [CLOUD_RESOURCE, { method: 'HEAD' }],
    [CLOUD_RESOURCE, { method: 'OPTIONS', headers: { origin: 'https://claude.ai' } }], [SIGN_IN_RESOURCE, { method: 'HEAD' }],
    [`${SIGN_IN_RESOURCE}/elsewhere`, { method: 'POST', body: '{}' }]]) await handle(new Request(url, init));
  const parsed = lines.map(line => JSON.parse(line));
  assert.deepEqual(parsed.map(({ ms, ...line }) => line), [
    { mcp: 1, route: 'mcp', edition: 'full', method: 'tools/list', tool: null, compact: false, status: 200, bytes: listed },
    { mcp: 1, route: 'claude', edition: 'directory', method: 'tools/call', tool: 'get_profile', compact: true, status: 200, bytes: Buffer.byteLength(profile) },
    { mcp: 1, route: 'mcp', edition: 'full', method: 'tools/call', tool: 'get_profile', compact: false, status: 401, bytes: deniedBytes },
    { mcp: 1, route: 'mcp', edition: 'full', method: null, tool: null, compact: false, status: 400, bytes: unreadable },
    { mcp: 1, route: 'signin', edition: 'full', method: 'tools/list', tool: null, compact: false, status: 401, bytes: signInBytes },
    { mcp: 1, route: 'mcp', edition: 'full', method: 'tools/call', tool: 'get_profile', compact: true, status: 401, bytes: chatDeniedBytes },
    { mcp: 1, route: 'mcp', edition: 'full', method: null, tool: null, compact: false, status: 403, bytes: foreignBytes }]);
  assert.ok(parsed.every(line => Number.isInteger(line.ms) && line.ms >= 0));
  for (const secret of [token, owner, client, 'test@example.com', 'Bearer', 'user-1']) assert.ok(!lines.join('\n').includes(secret), secret);
});

test('a cup entry reads the cup after 1, 1, 2, 3… poll intervals, not after every one (MCP 최적화 2026-11-05)', async t => {
  t.mock.method(console, 'log', () => {});
  const { arena, seen } = cupArena();
  // Each pause as the call sets it (MCP 리뷰 2026-11-05: a window of three to five reads let other schedules pass). An interval of 13 ms
  // tells them from the call's other timers.
  const timeout = globalThis.setTimeout, pauses = [];
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...rest) => { if (ms > 0 && ms % 13 === 0) pauses.push(ms); return timeout(callback, ms, ...rest); });
  const handle = createCloudHandler({ db: dbFor(), arena: { ...arena, pollMs: 13, pollTries: 6, cupWaitMs: 10_000 } });
  const entered = toolJson(await call(handle, 'enter_cup', { fighterId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }));
  assert.deepEqual([entered.state, entered.next], ['open', 'browse_oddbout(view=cup)']);
  // The pauses before its six reads: 1, 1, 2, 3, 4 and 5 intervals (a read every interval would pause one interval each time).
  assert.deepEqual(pauses, [13, 13, 26, 39, 52, 65]); assert.equal(seen.polls, 6);
});
