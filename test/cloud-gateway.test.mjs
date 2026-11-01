import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {cloudGateway,PUBLIC_RESOURCE,PUBLIC_SIGN_IN_RESOURCE,PUBLIC_DIRECTORY_RESOURCE,LEGACY_PUBLIC_RESOURCE,DOMAIN_CHALLENGE,BRANDED_DOMAIN_CHALLENGE} from '../worker/cloud-gateway.mjs';
import {createCloudHandler} from '../mcp/cloud.mjs';
async function serverFor(fetcher,run) {
  const server=createServer(async(req,res)=>{if(!await cloudGateway(req,res,fetcher)){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await run('http://127.0.0.1:'+server.address().port)}finally{await new Promise(resolve=>server.close(resolve));}
}
test('public gateway forwards only the fixed MCP endpoint and bounded protocol headers, without cookies or wake credentials',async()=>{
  const calls=[];
  await serverFor(async(url,options)=>{calls.push({url,options});return new Response('{"ok":true}',{headers:{'content-type':'application/json','set-cookie':'must-not-forward'}})},async base=>{
    const response=await fetch(base+'/mcp',{method:'POST',headers:{authorization:'Bearer oauth-token',cookie:'private=secret','x-ai-fighter-time':'123','x-oddbout-public-resource':'https://evil.test','content-type':'application/json'},body:'{"jsonrpc":"2.0"}'});
    assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);
    assert.equal(calls.length,1);assert.equal(calls[0].url,'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter-mcp');
    assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers.get('cookie'),null);
    assert.equal(calls[0].options.headers.get('x-ai-fighter-time'),null);
    assert.equal(calls[0].options.headers.get('authorization'),'Bearer oauth-token');
    assert.equal(calls[0].options.headers.get('x-oddbout-public-resource'),LEGACY_PUBLIC_RESOURCE);
    assert.equal((await fetch(base+'/mcp?url=https://evil.test')).status,404);
    assert.equal(calls.length,1);
    await new Promise((resolve,reject)=>{
      const req=request(base+'/mcp',{method:'POST',headers:{host:'mcp.oddbout.com'}},res=>{res.resume();res.on('end',resolve)});
      req.on('error',reject);req.end('{}');
    });
    assert.equal(calls[1].options.headers.get('x-oddbout-public-resource'),PUBLIC_RESOURCE);
    assert.equal(await (await fetch(base+'/.well-known/openai-apps-challenge')).text(),DOMAIN_CHALLENGE);
    const brandedProof=await new Promise((resolve,reject)=>{
      const req=request(base+'/.well-known/openai-apps-challenge',{headers:{host:'mcp.oddbout.com'}},res=>{let body='';res.on('data',part=>body+=part);res.on('end',()=>resolve(body))});
      req.on('error',reject);req.end();
    });
    assert.equal(brandedProof,BRANDED_DOMAIN_CHALLENGE);
    assert.equal(calls.length,2);
  });
});
test('mcp.oddbout.com/signin is the sign-in-first address, its metadata also at the host root (RFC 9728, 2026-11-01)',async()=>{
  const calls=[];
  await serverFor(async(url,options)=>{calls.push({url,options});return new Response(options.method==='HEAD'?null:'{}',{status:401,headers:{'content-type':'application/json','www-authenticate':'Bearer x','retry-after':'30'}})},async base=>{
    const at=(path,method='GET',host='mcp.oddbout.com')=>new Promise((resolve,reject)=>{
      const req=request(base+path,{method,headers:{host}},res=>{res.resume();res.on('end',()=>resolve(res))});
      req.on('error',reject);req.end();
    });
    const metadata='/signin/.well-known/oauth-protected-resource';
    for (const [path,method,upstream] of [['/signin','POST','/signin'],['/signin','HEAD','/signin'],[metadata,'GET',metadata],['/.well-known/oauth-protected-resource/signin','GET',metadata]]) {
      const response=await at(path,method);
      assert.equal(response.statusCode,401,path);assert.equal(response.headers['www-authenticate'],'Bearer x');assert.equal(response.headers['retry-after'],'30');
      assert.equal(calls.at(-1).url,'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter-mcp'+upstream);assert.equal(calls.at(-1).options.method,method);
      assert.equal(calls.at(-1).options.headers.get('x-oddbout-public-resource'),PUBLIC_SIGN_IN_RESOURCE);
    }
    // Only at our own host: the legacy Render host has no sign-in-first address, and no other path is forwarded.
    assert.equal((await at('/signin','POST','ai-fighter-validator.onrender.com')).statusCode,404);
    assert.equal((await at('/.well-known/oauth-protected-resource/signin','GET','ai-fighter-validator.onrender.com')).statusCode,404);
    assert.equal((await at('/signin/elsewhere','POST')).statusCode,404);
    assert.equal(calls.length,4);
  });
});
// The gateway and the function each name the address: run one into the other, so the two copies cannot drift apart unnoticed.
test('through the gateway the function names mcp.oddbout.com/signin at both metadata addresses and in its sign-in challenge',async()=>{
  const handle=createCloudHandler({db:{}}), agents=[];
  await serverFor(async(url,options)=>{agents.push(options.headers.get('user-agent'));return handle(new Request(url,options));},async base=>{
    const at=(path,method='GET',host='mcp.oddbout.com',body)=>new Promise((resolve,reject)=>{
      const req=request(base+path,{method,headers:{host,'user-agent':'Cursor/1.0.0','content-type':'application/json',accept:'application/json, text/event-stream'}},
        res=>{let text='';res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}))});
      req.on('error',reject);req.end(body);
    });
    for (const path of ['/.well-known/oauth-protected-resource/signin','/signin/.well-known/oauth-protected-resource']) {
      const metadata=await at(path);
      assert.equal(metadata.status,200,path);assert.equal(JSON.parse(metadata.text).resource,PUBLIC_SIGN_IN_RESOURCE,path);
    }
    const challenge=`Bearer resource_metadata="${PUBLIC_SIGN_IN_RESOURCE}/.well-known/oauth-protected-resource", scope="openid email profile"`;
    for (const host of ['mcp.oddbout.com','MCP.oddbout.com:443']) {
      const denied=await at('/signin','POST',host,JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}}));
      assert.equal(denied.status,401,host);assert.equal(denied.headers['www-authenticate'],challenge,host);
    }
    // The client's user-agent reaches the function's logs, not the gateway's own.
    assert.deepEqual([...new Set(agents)],['Cursor/1.0.0']);
  });
});
test('mcp.oddbout.com/claude is the Claude directory edition, its metadata also at the host root, only at our host (2026-11-01)',async()=>{
  const calls=[];
  await serverFor(async(url,options)=>{calls.push({url,options});return new Response('{}',{headers:{'content-type':'application/json'}})},async base=>{
    const at=(path,method='GET',host='mcp.oddbout.com')=>new Promise((resolve,reject)=>{
      const req=request(base+path,{method,headers:{host}},res=>{res.resume();res.on('end',()=>resolve(res))});
      req.on('error',reject);req.end();
    });
    const metadata='/claude/.well-known/oauth-protected-resource';
    for (const [path,method,upstream] of [['/claude','POST','/claude'],['/claude','OPTIONS','/claude'],[metadata,'GET',metadata],['/.well-known/oauth-protected-resource/claude','GET',metadata]]) {
      assert.equal((await at(path,method)).statusCode,200,path);
      assert.equal(calls.at(-1).url,'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter-mcp'+upstream);assert.equal(calls.at(-1).options.method,method);
      assert.equal(calls.at(-1).options.headers.get('x-oddbout-public-resource'),PUBLIC_DIRECTORY_RESOURCE);
    }
    assert.equal((await at('/claude','POST','ai-fighter-validator.onrender.com')).statusCode,404);
    assert.equal((await at('/.well-known/oauth-protected-resource/claude','GET','ai-fighter-validator.onrender.com')).statusCode,404);
    assert.equal((await at('/claude/elsewhere','POST')).statusCode,404);
    assert.equal(calls.length,4);
  });
});
test('through the gateway the directory edition names mcp.oddbout.com/claude at both metadata addresses and in its sign-in challenge',async()=>{
  const handle=createCloudHandler({db:{}});
  await serverFor(async(url,options)=>handle(new Request(url,options)),async base=>{
    const at=(path,method='GET',body)=>new Promise((resolve,reject)=>{
      const req=request(base+path,{method,headers:{host:'mcp.oddbout.com','content-type':'application/json',accept:'application/json, text/event-stream'}},
        res=>{let text='';res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}))});
      req.on('error',reject);req.end(body);
    });
    for (const path of ['/.well-known/oauth-protected-resource/claude','/claude/.well-known/oauth-protected-resource']) {
      const metadata=await at(path);
      assert.equal(metadata.status,200,path);assert.equal(JSON.parse(metadata.text).resource,PUBLIC_DIRECTORY_RESOURCE,path);
    }
    const denied=await at('/claude','POST',JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_profile',arguments:{}}}));
    assert.equal(denied.status,401);
    assert.equal(denied.headers['www-authenticate'],`Bearer resource_metadata="${PUBLIC_DIRECTORY_RESOURCE}/.well-known/oauth-protected-resource", scope="openid email profile"`);
  });
});
test('oversized requests and upstream failures do not leak OAuth tokens or return success',async()=>{
  let calls=0;
  await serverFor(async()=>{calls++;throw new Error('Bearer private-token')},async base=>{
    const oversized=await fetch(base+'/mcp',{method:'POST',body:'x'.repeat(65537)});
    assert.equal(oversized.status,413);assert.equal(calls,0);
    const failed=await fetch(base+'/mcp',{method:'POST',body:'{}'});
    assert.equal(failed.status,502);assert.ok(!(await failed.text()).includes('private-token'));
  });
});
async function streamingServer(fetcher,options,run) {
  const server=createServer(async(req,res)=>{if(!await cloudGateway(req,res,fetcher,options)){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await run('http://127.0.0.1:'+server.address().port)}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
const events=(count,gapMs,signal)=>new ReadableStream({async start(controller){
  for(let i=0;i<count;i++){await new Promise(r=>setTimeout(r,gapMs));if(signal?.aborted){controller.error(new Error('aborted'));return;}controller.enqueue(new TextEncoder().encode(`data: ${i}\n\n`));}
  controller.close();}});
test('a streamed MCP response may outlast the header timeout; only the wait for headers is bounded',async()=>{
  await streamingServer(async(url,options)=>new Response(events(4,60,options.signal),{headers:{'content-type':'text/event-stream'}}),{headerTimeoutMs:50,totalTimeoutMs:5000},async base=>{
    const response=await fetch(base+'/mcp',{method:'POST',body:'{}'});
    assert.equal(response.status,200);
    assert.equal((await response.text()).match(/data: /g).length,4,'all four events arrived although the stream took longer than the header timeout');
  });
  await streamingServer(async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')))),{headerTimeoutMs:50,totalTimeoutMs:5000},async base=>{
    assert.equal((await fetch(base+'/mcp',{method:'POST',body:'{}'})).status,502,'no headers in time');
  });
});
test('a client that goes away stops the upstream request',async()=>{
  let upstream;
  await streamingServer(async(url,options)=>{upstream=options.signal;return new Response(events(50,40,options.signal),{headers:{'content-type':'text/event-stream'}});},{headerTimeoutMs:1000,totalTimeoutMs:10000},async base=>{
    const client=new AbortController();
    const response=await fetch(base+'/mcp',{method:'POST',body:'{}',signal:client.signal});
    const reader=response.body.getReader(); await reader.read();
    client.abort();
    await new Promise(r=>setTimeout(r,200));
    assert.equal(upstream.aborted,true);
  });
});
