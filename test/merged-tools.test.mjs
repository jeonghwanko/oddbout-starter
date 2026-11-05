import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudHandler as cloudHandler, CLOUD_ISSUER, CLOUD_RESOURCE, DIRECTORY_RESOURCE, PUBLIC_TOOLS } from '../mcp/cloud.mjs';
import { ALIASES, MERGED_TOOLS, aliasCall, memberOf, renameTools, toolRef } from '../mcp/cloud/merged-tools.mjs';

// MCP 통합 1단계 (2026-11-05): read tools of one kind are one tool with a view in the full edition; their own names still answer.
const owner = crypto.randomUUID();
const claims = () => ({ sub: owner, client_id: crypto.randomUUID(), session_id: crypto.randomUUID(), iss: CLOUD_ISSUER, aud: CLOUD_RESOURCE,
  role: 'af_mcp', af_mcp: 'registration-v1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 600, email: 'test@example.com' });
const dbFor = () => ({ auth: { getClaims: async () => ({ data: { claims: claims() } }) }, rpc: async () => ({ data: 'usable' }) });
const signedOutDb = { auth: { getClaims: async () => ({ data: null }) }, rpc: async () => ({ data: false }) };
const toolJson = result => result.structuredContent ?? JSON.parse(result.content[0].text);
/** An arena that echoes what it was asked, with the owner it was asked for. */
const echoArena = calls => ({ url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async (url, init = {}) => {
  calls.push({ url, owner: init.headers?.['x-arena-owner'] });
  return Response.json({ ok: true, url });
} });
const post = (handle, url, method, params = {}, auth = true) => handle(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json',
  accept: 'application/json, text/event-stream', ...(auth ? { authorization: 'Bearer signed-connector-token-for-test' } : {}) },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }));

test('a merged tool lists only reads of one sign-in, and its members\' names are no longer listed', async () => {
  const handle = cloudHandler({ db: dbFor(), arena: echoArena([]), hosted: {}, log: () => {} });
  const tools = (await (await post(handle, CLOUD_RESOURCE, 'tools/list')).json()).result.tools;
  for (const merged of MERGED_TOOLS) {
    const tool = tools.find(t => t.name === merged.name);
    assert.ok(tool, merged.name);
    assert.deepEqual(tool.inputSchema.properties.view.enum, Object.keys(merged.views), merged.name);
    assert.equal(tool.annotations.readOnlyHint, true, merged.name); assert.equal(tool.annotations.destructiveHint, false, merged.name);
    // A public merged tool is public everywhere its sign-in is decided: the list, and the request path (PUBLIC_TOOLS).
    assert.equal(tool.securitySchemes[0].type === 'noauth', PUBLIC_TOOLS.has(merged.name), merged.name);
    for (const [view, member] of Object.entries(merged.views)) {
      if (member !== merged.name) assert.ok(!tools.some(t => t.name === member), member);
      assert.match(tool.description, new RegExp(`view=${view}\\b`), `${merged.name} ${view}`);
    }
  }
  // Texts name the merged tool and view, never a member that is not listed, except where a view says what it was.
  const text = JSON.stringify(tools).replace(/\(was [a-z_]+\)/g, '');
  const initialize = await (await post(handle, CLOUD_RESOURCE, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })).json();
  for (const member of ALIASES.keys()) {
    assert.equal(new RegExp(`\\b${member}\\b`).test(text), false, `${member} in the list`);
    assert.equal(new RegExp(`\\b${member}\\b`).test(initialize.result.instructions), false, `${member} in the instructions`);
  }
  assert.match(text, /browse_oddbout\(view=bout\)/);
});

test('a member\'s own name answers as its view, with the same result, the member\'s sign-in and the member\'s log name', async () => {
  const calls = [], lines = [];
  const log = console.log;
  console.log = line => lines.push(JSON.parse(line));
  try {
    const signedOut = cloudHandler({ db: signedOutDb, arena: echoArena(calls), log: () => {} });
    const viaName = toolJson((await (await post(signedOut, CLOUD_RESOURCE, 'tools/call', { name: 'read_bout', arguments: { a: 'kuma', b: 'yume', seed: 7 } }, false)).json()).result);
    const viaView = toolJson((await (await post(signedOut, CLOUD_RESOURCE, 'tools/call', { name: 'browse_oddbout', arguments: { view: 'bout', a: 'kuma', b: 'yume', seed: 7 } }, false)).json()).result);
    assert.deepEqual(viaName, viaView); assert.equal(viaView.url, 'https://arena.test/oddbout-arena/bout?a=kuma&b=yume&seed=7');
    assert.deepEqual(calls.map(c => c.owner), ['public', 'public']);
    // A signed-in bout counts on its owner, as read_bout always did (OWNER_BUDGET_TOOLS by the view's member).
    const signedIn = cloudHandler({ db: dbFor(), arena: echoArena(calls), log: () => {} });
    await post(signedIn, CLOUD_RESOURCE, 'tools/call', { name: 'browse_oddbout', arguments: { view: 'bout', a: 'kuma', b: 'yume', seed: 7 } });
    assert.equal(calls.at(-1).owner, owner);
    // Other views of a public tool need no sign-in; a signed-in member's view still asks for one.
    assert.equal((await post(signedOut, CLOUD_RESOURCE, 'tools/call', { name: 'browse_oddbout', arguments: { view: 'style_guide' } }, false)).status, 200);
    assert.equal((await post(signedOut, CLOUD_RESOURCE, 'tools/call', { name: 'get_career', arguments: { fighterId: 'kuma' } }, false)).status, 401);
    assert.equal((await post(signedOut, CLOUD_RESOURCE, 'tools/call', { name: 'get_my_fighter_updates', arguments: { view: 'inbox' } }, false)).status, 401);
    const logged = lines.filter(line => line.stage === 'mcp-call');
    assert.deepEqual(logged.slice(0, 2).map(line => [line.tool, line.via]), [['read_bout', 'browse_oddbout'], ['read_bout', 'browse_oddbout']]);
  } finally { console.log = log; }
});

test('each view checks its member\'s own arguments and says what it takes', async () => {
  const handle = cloudHandler({ db: dbFor(), arena: echoArena([]), log: () => {} });
  const missing = (await (await post(handle, CLOUD_RESOURCE, 'tools/call', { name: 'browse_oddbout', arguments: { view: 'record' } })).json()).result;
  assert.equal(missing.isError, true);
  assert.deepEqual(toolJson(missing), { ok: false, code: 'invalid-arguments', view: 'record', issues: [{ path: 'fighterId', message: toolJson(missing).issues[0].message }],
    next: 'view=record takes fighterId.' });
  // An argument another view takes is not this view's: it is dropped, as a member always dropped unknown arguments.
  const record = toolJson((await (await post(handle, CLOUD_RESOURCE, 'tools/call', { name: 'browse_oddbout', arguments: { view: 'record', fighterId: 'kuma', worldId: 'w' } })).json()).result);
  assert.equal(record.ok, true);
  // A view the tool does not have is the SDK's argument error.
  const unknown = await (await post(handle, CLOUD_RESOURCE, 'tools/call', { name: 'browse_oddbout', arguments: { view: 'nope' } })).json();
  assert.ok(unknown.error?.code === -32602 || unknown.result?.isError === true, JSON.stringify(unknown));
});

test('the directory edition keeps its own names: no merged tool, no alias', async () => {
  const handle = cloudHandler({ db: dbFor(), arena: echoArena([]), hosted: {}, log: () => {} });
  const tools = (await (await post(handle, DIRECTORY_RESOURCE, 'tools/list')).json()).result.tools;
  for (const merged of MERGED_TOOLS) assert.ok(!tools.some(t => t.name === merged.name), merged.name);
  assert.ok(tools.some(t => t.name === 'read_bout'));
  const answer = await (await post(handle, DIRECTORY_RESOURCE, 'tools/call', { name: 'browse_oddbout', arguments: { view: 'cup', cupId: crypto.randomUUID() } })).json();
  assert.equal(answer.error?.code, -32602);
});

test('aliasCall, memberOf, toolRef and renameTools', () => {
  assert.deepEqual(aliasCall({ method: 'tools/call', params: { name: 'get_cup', arguments: { cupId: 'c' } } }),
    { method: 'tools/call', params: { name: 'browse_oddbout', arguments: { cupId: 'c', view: 'cup' } } });
  // A call with no arguments object still becomes the view; anything else passes untouched.
  assert.deepEqual(aliasCall({ method: 'tools/call', params: { name: 'get_workshop_inbox' } }).params, { name: 'get_my_fighter_updates', arguments: { view: 'inbox' } });
  const listed = { method: 'tools/list', params: { name: 'get_cup' } };
  assert.equal(aliasCall(listed), listed);
  assert.equal(memberOf('browse_oddbout', { view: 'bout' }), 'read_bout');
  assert.equal(memberOf('get_hosted_fighter', {}), 'get_hosted_fighter');
  assert.equal(memberOf('browse_oddbout', { view: 'nope' }), 'browse_oddbout');
  assert.equal(memberOf('spar', { view: 'bout' }), 'spar');
  assert.equal(toolRef('get_hosted_fighter'), 'get_hosted_fighter');
  assert.equal(renameTools('read get_cup, then get_cups or my_get_cup; spar'), 'read browse_oddbout(view=cup), then get_cups or my_get_cup; spar');
});
