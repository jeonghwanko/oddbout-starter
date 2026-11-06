import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudHandler as cloudHandler, CLOUD_ISSUER, CLOUD_RESOURCE, DIRECTORY_RESOURCE, PUBLIC_TOOLS } from '../mcp/cloud.mjs';
import { ALIASES, MERGED_TOOLS, aliasCall, memberOf, renameDeep, renameTools, toolRef } from '../mcp/cloud/merged-tools.mjs';
import { frontNext } from '../mcp/cloud/common.mjs';

// MCP 통합 (1단계 2026-11-05, 2단계 2026-11-06): tools of one kind are one tool with a selector in the full edition; their own names still answer.
const owner = crypto.randomUUID();
const claims = () => ({ sub: owner, client_id: crypto.randomUUID(), session_id: crypto.randomUUID(), iss: CLOUD_ISSUER, aud: CLOUD_RESOURCE,
  role: 'af_mcp', af_mcp: 'registration-v1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 600, email: 'test@example.com' });
const dbFor = () => ({ auth: { getClaims: async () => ({ data: { claims: claims() } }) }, rpc: async () => ({ data: 'usable' }) });
const signedOutDb = { auth: { getClaims: async () => ({ data: null }) }, rpc: async () => ({ data: false }) };
const toolJson = result => result.structuredContent ?? JSON.parse(result.content[0].text);
/** An arena that echoes what it was asked, with the owner it was asked for; a cup answers with a text that names read_bout. */
const echoArena = calls => ({ url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async (url, init = {}) => {
  calls.push({ url, owner: init.headers?.['x-arena-owner'] });
  if (url.includes('/cup?id=')) return Response.json({ ok: true, url, next: 'read_bout replays one of its bouts' });
  return Response.json({ ok: true, url });
} });
const post = (handle, url, method, params = {}, auth = true) => handle(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json',
  accept: 'application/json, text/event-stream', ...(auth ? { authorization: 'Bearer signed-connector-token-for-test' } : {}) },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }));
const listFull = async () => (await (await post(cloudHandler({ db: dbFor(), arena: echoArena([]), hosted: {}, log: () => {} }), CLOUD_RESOURCE, 'tools/list')).json()).result.tools;

test('each merged tool lists its selector, needs one sign-in, and is as consequential as its most consequential member', async () => {
  const tools = await listFull();
  for (const merged of MERGED_TOOLS) {
    const tool = tools.find(t => t.name === merged.name), key = merged.key ?? 'view';
    assert.ok(tool, merged.name);
    assert.deepEqual(tool.inputSchema.properties[key].enum, Object.keys(merged.views), merged.name);
    // A selector with a default may be left out (the call is then that member's, as before); one without must be given.
    assert.equal((tool.inputSchema.required ?? []).includes(key), merged.defaultView === undefined, merged.name);
    assert.equal(tool.securitySchemes[0].type === 'noauth', PUBLIC_TOOLS.has(merged.name), merged.name);
    for (const [view, member] of Object.entries(merged.views)) {
      assert.match(tool.description, new RegExp(`${key}=${view}\\b`), `${merged.name} ${view}`);
      // Members leave the list: only a merged tool that keeps a member's name lists it (MCP 통합 2단계 B, 2026-11-06).
      if (member !== merged.name) assert.equal(tools.some(t => t.name === member), false, member);
    }
  }
  const hints = name => { const a = tools.find(t => t.name === name).annotations; return [a.readOnlyHint, a.destructiveHint, a.idempotentHint, a.openWorldHint]; };
  // Reads stay reads; a write is destructive if any member is, retry-safe only if all are, open-world if any is.
  assert.deepEqual(hints('get_my_fighters'), [true, false, true, false]);
  assert.deepEqual(hints('check_creator_file'), [true, false, true, true]);
  assert.deepEqual(hints('upload_fighter_asset'), [false, false, true, true]);
  assert.deepEqual(hints('prepare_fighter_registration'), [false, false, true, true]);
  assert.deepEqual(hints('submit_fighter_registration'), [false, true, true, true]);
  assert.deepEqual(hints('update_fighter'), [false, true, true, true]);
  assert.deepEqual(hints('enter_fighter'), [false, true, true, true]);
  assert.deepEqual(hints('write_story'), [false, true, false, true]);
  assert.deepEqual(hints('manage_career'), [false, false, false, true]);
  assert.deepEqual(hints('request_hosted_fighter'), [false, true, false, true]);
  // ChatGPT's file metadata follows the members that take files.
  assert.deepEqual(tools.find(t => t.name === 'upload_fighter_asset')._meta['openai/fileParams'], ['file']);
  assert.deepEqual(tools.find(t => t.name === 'request_hosted_fighter')._meta['openai/fileParams'], ['picture', 'secondPicture']);
  // An argument two members take in different shapes is either shape here (enter_cup's UUID, set_career_auto's slug).
  assert.equal(tools.find(t => t.name === 'manage_career').inputSchema.properties.fighterId.anyOf.length, 2);
});

test('the full list names no merged-away tool, except what a selector line says it was', async () => {
  const tools = await listFull();
  const text = JSON.stringify(tools).replace(/\(was [a-z_]+\)/g, '');
  const initialize = await (await post(cloudHandler({ db: dbFor(), arena: echoArena([]), hosted: {}, log: () => {} }), CLOUD_RESOURCE, 'initialize',
    { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })).json();
  for (const name of ALIASES.keys()) {
    assert.doesNotMatch(text, new RegExp(`\\b${name}\\b`), `${name} in the list`);
    assert.doesNotMatch(initialize.result.instructions, new RegExp(`\\b${name}\\b`), `${name} in the instructions`);
  }
  assert.match(text, /browse_oddbout\(view=bout\)/);
});

// 2단계 B (2026-11-06): the creation guide still named the profile-set and submission tools by their old names, which no list carries now.
test('a tool that was not merged, and the front guidance, name no tool the list no longer carries', async () => {
  const handle = cloudHandler({ db: dbFor(), arena: echoArena([]), hosted: {}, log: () => {} });
  const unlisted = text => [...ALIASES.keys()].filter(name => text.split(/[^a-z_]+/).includes(name));
  const creation = await (await post(handle, CLOUD_RESOURCE, 'tools/call', { name: 'get_fighter_spec', arguments: { section: 'creation' } }, false)).text();
  assert.deepEqual(unlisted(creation), []);
  assert.match(creation, /get_my_fighters\(view=submission\)/);
  for (const front of [{ required: true, ok: false }, { required: true, ok: false, profileSetId: 'p', status: 'uploading' },
    { required: true, ok: false, profileSetId: 'p', status: 'checking', frontCheck: 'stalled' }, { required: true, ok: false, profileSetId: 'p', status: 'checking' }]) {
    const next = frontNext(front);
    assert.deepEqual(unlisted(next), [], next);
    // The directory edition lists the members under their own names.
    assert.equal(frontNext(front, { directory: true }).includes('get_my_fighters'), false);
  }
});

test('an old name answers as its selector with the same result, the member\'s sign-in and log name, and keeps the old names in its result', async () => {
  const calls = [], lines = [];
  const log = console.log;
  console.log = line => lines.push(JSON.parse(line));
  try {
    const signedOut = cloudHandler({ db: signedOutDb, arena: echoArena(calls), log: () => {} });
    const viaName = toolJson((await (await post(signedOut, CLOUD_RESOURCE, 'tools/call', { name: 'read_bout', arguments: { a: 'kuma', b: 'yume', seed: 7 } }, false)).json()).result);
    const viaView = toolJson((await (await post(signedOut, CLOUD_RESOURCE, 'tools/call', { name: 'browse_oddbout', arguments: { view: 'bout', a: 'kuma', b: 'yume', seed: 7 } }, false)).json()).result);
    assert.deepEqual(viaName, viaView); assert.equal(viaView.url, 'https://arena.test/oddbout-arena/bout?a=kuma&b=yume&seed=7');
    assert.deepEqual(calls.map(c => c.owner), ['public', 'public']);
    // A result's own texts: renamed for a call that used the new form, as they were for one that used an old name (a client that may know
    // only the old names is never sent to a new one).
    const cupId = crypto.randomUUID();
    const oldForm = toolJson((await (await post(signedOut, CLOUD_RESOURCE, 'tools/call', { name: 'get_cup', arguments: { cupId } }, false)).json()).result);
    const newForm = toolJson((await (await post(signedOut, CLOUD_RESOURCE, 'tools/call', { name: 'browse_oddbout', arguments: { view: 'cup', cupId } }, false)).json()).result);
    assert.equal(oldForm.next, 'read_bout replays one of its bouts'); assert.equal(newForm.next, 'browse_oddbout(view=bout) replays one of its bouts');
    // A signed-in bout counts on its owner, as read_bout always did (OWNER_BUDGET_TOOLS by the selected member).
    const signedIn = cloudHandler({ db: dbFor(), arena: echoArena(calls), log: () => {} });
    await post(signedIn, CLOUD_RESOURCE, 'tools/call', { name: 'browse_oddbout', arguments: { view: 'bout', a: 'kuma', b: 'yume', seed: 7 } });
    assert.equal(calls.at(-1).owner, owner);
    // Other views of a public tool need no sign-in; a signed-in member's selector still asks for one, by any name.
    assert.equal((await post(signedOut, CLOUD_RESOURCE, 'tools/call', { name: 'browse_oddbout', arguments: { view: 'style_guide' } }, false)).status, 200);
    assert.equal((await post(signedOut, CLOUD_RESOURCE, 'tools/call', { name: 'get_career', arguments: { fighterId: 'kuma' } }, false)).status, 401);
    assert.equal((await post(signedOut, CLOUD_RESOURCE, 'tools/call', { name: 'manage_career', arguments: { action: 'auto', fighterId: 'kuma', on: true } }, false)).status, 401);
    const logged = lines.filter(line => line.stage === 'mcp-call');
    assert.deepEqual(logged.slice(0, 2).map(line => [line.tool, line.via]), [['read_bout', 'browse_oddbout'], ['read_bout', 'browse_oddbout']]);
  } finally { console.log = log; }
});

test('each selected member checks its own arguments and says what it takes', async () => {
  const handle = cloudHandler({ db: dbFor(), arena: echoArena([]), log: () => {} });
  const missing = (await (await post(handle, CLOUD_RESOURCE, 'tools/call', { name: 'browse_oddbout', arguments: { view: 'record' } })).json()).result;
  assert.equal(missing.isError, true);
  assert.deepEqual(toolJson(missing), { ok: false, code: 'invalid-arguments', view: 'record', issues: [{ path: 'fighterId', message: toolJson(missing).issues[0].message }],
    next: 'view=record takes fighterId.' });
  // A slug is set_career_auto's fighter, not enter_cup's: the merged schema takes either, the member checks its own.
  const cup = toolJson((await (await post(handle, CLOUD_RESOURCE, 'tools/call', { name: 'manage_career', arguments: { action: 'enter', fighterId: 'kuma', idempotencyKey: crypto.randomUUID() } })).json()).result);
  assert.deepEqual([cup.code, cup.action, cup.issues[0].path], ['invalid-arguments', 'enter', 'fighterId']);
  // An argument another member takes is dropped, as a member always dropped unknown arguments.
  const record = toolJson((await (await post(handle, CLOUD_RESOURCE, 'tools/call', { name: 'browse_oddbout', arguments: { view: 'record', fighterId: 'kuma', worldId: 'w' } })).json()).result);
  assert.equal(record.ok, true);
  const unknown = await (await post(handle, CLOUD_RESOURCE, 'tools/call', { name: 'browse_oddbout', arguments: { view: 'nope' } })).json();
  assert.ok(unknown.error?.code === -32602 || unknown.result?.isError === true, JSON.stringify(unknown));
});

test('the directory edition keeps its own names: no merged tool, no alias', async () => {
  const handle = cloudHandler({ db: dbFor(), arena: echoArena([]), hosted: {}, log: () => {} });
  const tools = (await (await post(handle, DIRECTORY_RESOURCE, 'tools/list')).json()).result.tools;
  for (const merged of MERGED_TOOLS) if (!Object.values(merged.views).includes(merged.name)) assert.ok(!tools.some(t => t.name === merged.name), merged.name);
  assert.ok(tools.some(t => t.name === 'read_bout')); assert.ok(tools.some(t => t.name === 'update_fighter_profile'));
  const answer = await (await post(handle, DIRECTORY_RESOURCE, 'tools/call', { name: 'browse_oddbout', arguments: { view: 'cup', cupId: crypto.randomUUID() } })).json();
  assert.equal(answer.error?.code, -32602);
});

test('aliasCall, memberOf, toolRef, renameTools and renameDeep', () => {
  assert.deepEqual(aliasCall({ method: 'tools/call', params: { name: 'get_cup', arguments: { cupId: 'c' } } }),
    { method: 'tools/call', params: { name: 'browse_oddbout', arguments: { cupId: 'c', view: 'cup' } } });
  assert.deepEqual(aliasCall({ method: 'tools/call', params: { name: 'get_workshop_inbox' } }).params, { name: 'get_my_fighters', arguments: { view: 'inbox' } });
  assert.deepEqual(aliasCall({ method: 'tools/call', params: { name: 'set_career_auto', arguments: { fighterId: 'kuma', on: true } } }).params,
    { name: 'manage_career', arguments: { fighterId: 'kuma', on: true, action: 'auto' } });
  // A merged tool's earlier name keeps the caller's selector.
  assert.deepEqual(aliasCall({ method: 'tools/call', params: { name: 'get_my_fighter_updates', arguments: { view: 'career', fighterId: 'kuma' } } }).params,
    { name: 'get_my_fighters', arguments: { view: 'career', fighterId: 'kuma' } });
  // The reviewed account reads are views too since 2단계 B (2026-11-06); a merged tool that keeps a member's name is called as it is.
  assert.deepEqual(aliasCall({ method: 'tools/call', params: { name: 'get_registered_fighter', arguments: { fighterId: 'kuma' } } }).params,
    { name: 'get_my_fighters', arguments: { fighterId: 'kuma', view: 'fighter' } });
  const body = { method: 'tools/call', params: { name: 'upload_fighter_asset', arguments: {} } };
  assert.equal(aliasCall(body), body);
  const listed = { method: 'tools/list', params: { name: 'get_cup' } };
  assert.equal(aliasCall(listed), listed);
  assert.equal(memberOf('browse_oddbout', { view: 'bout' }), 'read_bout');
  assert.equal(memberOf('get_hosted_fighter', {}), 'get_hosted_fighter');
  assert.equal(memberOf('upload_fighter_asset', { kind: 'profile_set' }), 'upload_profile_set_asset');
  assert.equal(memberOf('enter_fighter', { action: 'withdraw' }), 'withdraw_fighter');
  assert.equal(memberOf('browse_oddbout', { view: 'nope' }), 'browse_oddbout');
  assert.equal(memberOf('spar', { view: 'bout' }), 'spar');
  assert.equal(toolRef('get_hosted_fighter'), 'get_hosted_fighter');
  assert.equal(toolRef('get_registered_fighter'), 'get_my_fighters(view=fighter)');
  assert.equal(toolRef('register_hosted_fighter'), 'submit_fighter_registration(kind=hosted)');
  assert.equal(toolRef('get_my_fighter_updates'), 'get_my_fighters');
  assert.equal(renameTools('read get_cup, then get_cups or my_get_cup; spar'), 'read browse_oddbout(view=cup), then get_cups or my_get_cup; spar');
  assert.deepEqual(renameDeep({ next: 'withdraw_fighter first', list: ['enter_cup'], n: 3, at: new Date(0) }),
    { next: 'enter_fighter(action=withdraw) first', list: ['manage_career(action=enter)'], n: 3, at: new Date(0) });
});
