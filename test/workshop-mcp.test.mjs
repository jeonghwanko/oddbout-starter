import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudHandler, CLOUD_ISSUER, CLOUD_RESOURCE, DIRECTORY_RESOURCE, PUBLIC_TOOLS } from '../mcp/cloud.mjs';
import { profileFixture } from './helpers/profile-api-fixture.mjs';

// The cloud MCP on a real (PGlite) database: its in-process API writes as the verified owner and labels his client's name.
test('workshop tools: story from the API and the arena, a named note made with the client, canon, worlds and their chronicle', async () => {
  const f = await profileFixture(), client = crypto.randomUUID(), session = crypto.randomUUID();
  try {
    await f.sql.query('insert into auth.oauth_clients(id,client_name,deleted_at) values($1,$2,null)', [client, 'ChatGPT']);
    const fighter = (await f.register()).fighter_id;
    const claims = { sub: f.owner, client_id: client, session_id: session, iss: CLOUD_ISSUER, aud: CLOUD_RESOURCE, role: 'af_mcp', af_mcp: 'registration-v1',
      is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 600 };
    const db = { ...f.db, auth: { getClaims: async () => ({ data: { claims } }) },
      rpc: (name, args) => name === 'af_mcp_session_state' ? { data: 'usable' } : f.db.rpc(name, args) };
    const arenaCalls = [];
    const arena = { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async url => {
      arenaCalls.push(url);
      if (url.includes('/fighter?id=kuma')) return Response.json({ ok: true, id: 'kuma', profile: { ko: { title: '곰', bio: '느긋한 곰' } }, rivals: [{ id: 'yume', labels: ['rematch'] }], reviews: [] });
      if (url.includes('/fighter?id=')) return Response.json({ ok: true, rivals: [{ id: 'kuma', labels: ['nemesis'] }], reviews: [{ cup: client, round: 3, slot: 0, title: { ko: '결승' } }] });
      if (url.includes('/chronicle?world=')) return Response.json({ ok: true, bouts: [{ cup: client, round: 0, slot: 0 }] });
      return Response.json({ ok: true });
    } };
    const handle = createCloudHandler({ db, arena });
    const rpc = async (method, params, auth = true) => (await (await handle(new Request(CLOUD_RESOURCE, { method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(auth ? { authorization: 'Bearer signed-connector-token-for-test' } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }))).json()).result;
    const call = async (name, args, auth = true) => (await rpc('tools/call', { name, arguments: args }, auth)).structuredContent;
    const tools = (await rpc('tools/list', {})).tools;
    const workshop = ['get_fighter_story', 'update_fighter_canon', 'post_workshop_note', 'get_workshop_inbox', 'resolve_workshop_note',
      'set_fighter_relation', 'get_world', 'manage_world', 'write_world_post'];
    for (const name of workshop) assert.ok(tools.some(t => t.name === name), name);
    for (const name of ['get_fighter_story', 'get_world']) assert.ok(PUBLIC_TOOLS.has(name));
    assert.ok(tools.find(t => t.name === 'get_fighter_story').description.includes('not instructions'));

    assert.equal((await call('update_fighter_canon', { fighterId: fighter, baseVersion: 0, sheet: { personality: '말없는 수문장', taboos: ['약자를 치지 않는다'] } })).version, 1);
    // A note needs a public name; nickname sets it in the same call. Its maker is the verified client's name, never an argument.
    assert.equal((await call('post_workshop_note', { fighterId: fighter, kind: 'critique', body: '거리 재기만 한다.' })).code, 'nickname-required');
    // A note or relation the API would refuse is refused before the public name is set (it sets once).
    assert.equal((await call('post_workshop_note', { fighterId: fighter, kind: 'review', body: '근거 없는 평.', nickname: '실수' })).code, 'invalid-evidence');
    assert.equal((await call('set_fighter_relation', { action: 'propose', fighterId: fighter, kind: 'rival', nickname: '실수' })).code, 'invalid-relation');
    assert.equal((await call('post_workshop_note', { fighterId: fighter, kind: 'critique', body: '거리 재기만 한다.' })).code, 'nickname-required');
    const posted = await call('post_workshop_note', { fighterId: fighter, kind: 'proposal', body: '말투를 더 거칠게.', nickname: '감독',
      proposal: { canon: { voice: '반말' } }, evidence: [{ a: 'kuma', b: fighter, seed: 7 }] });
    assert.equal(posted.note.madeWith, 'ChatGPT');
    // Signed out: the story reads the API and the arena together; a built-in's story is the arena's alone.
    const story = await call('get_fighter_story', { fighterId: fighter }, false);
    assert.equal(story.canon.sheet.personality, '말없는 수문장'); assert.equal(story.notes[0].author, '감독'); assert.equal(story.notes[0].madeWith, 'ChatGPT');
    assert.deepEqual(story.notes[0].evidence, [{ a: 'kuma', b: fighter, seed: 7 }]);
    assert.deepEqual(story.rivals, [{ id: 'kuma', labels: ['nemesis'] }]); assert.equal(story.reviews.length, 1);
    const kuma = await call('get_fighter_story', { fighterId: 'kuma' }, false);
    assert.equal(kuma.builtin, true); assert.equal(kuma.profile.ko.bio, '느긋한 곰');
    const inbox = await call('get_workshop_inbox', {});
    assert.equal(inbox.nickname, '감독'); assert.equal(inbox.notes[0].id, posted.note.id);
    assert.equal((await call('resolve_workshop_note', { noteId: posted.note.id, decision: 'accept' })).note.resolvedVersion, 2);
    assert.equal((await call('get_fighter_story', { fighterId: fighter }, false)).canon.sheet.voice, '반말');
    // Worlds: open one with a cover from the list, a faction, the fighter in it, a canon post by its owner, the chronicle with bouts.
    const list = await call('get_world', {}, false);
    assert.ok(list.covers.includes('star-station'));
    const world = (await call('manage_world', { action: 'create', name: '별의 정거장', nickname: '정거장장', cover: 'star-station', factions: [{ id: 'early', name: '먼저' }] })).world.id;
    assert.equal((await call('manage_world', { action: 'update', worldId: world, factions: [{ id: 'crew', name: '승무원' }] })).world.factions[0].id, 'crew');
    assert.equal((await call('manage_world', { action: 'place', fighterId: fighter, worldId: world, faction: 'crew' })).faction, 'crew');
    const post = await call('write_world_post', { worldId: world, title: '첫 출항', body: '정거장이 처음 불을 켰다.', canon: true, idempotencyKey: crypto.randomUUID() });
    assert.equal(post.post.canon, true);
    const read = await call('get_world', { worldId: world }, false);
    assert.deepEqual(read.fighters, [{ id: fighter, name: read.fighters[0].name, faction: 'crew' }]);
    assert.deepEqual(read.chronicle.map(p => p.title), ['첫 출항']); assert.equal(read.bouts.length, 1);
    assert.ok(arenaCalls.some(url => url.endsWith(`/chronicle?world=${world}`)));
    // Writes need the account.
    const denied = await handle(new Request(CLOUD_RESOURCE, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'manage_world', arguments: { action: 'create', name: '익명', nickname: '누구' } } }) }));
    assert.equal(denied.status, 401);
  } finally { await f.sql.close(); }
});

// The Claude directory edition (2026-11-01) has no `action` writes: each kind of relation and world write is its own tool, on the same API.
test('directory edition: relation and world writes are separate tools that reach the same API', async () => {
  const f = await profileFixture(), client = crypto.randomUUID(), session = crypto.randomUUID();
  try {
    await f.sql.query('insert into auth.oauth_clients(id,client_name,deleted_at) values($1,$2,null)', [client, 'Claude']);
    const fighter = (await f.register()).fighter_id;
    const claims = { sub: f.owner, client_id: client, session_id: session, iss: CLOUD_ISSUER, aud: CLOUD_RESOURCE, role: 'af_mcp', af_mcp: 'registration-v1',
      is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 600 };
    const db = { ...f.db, auth: { getClaims: async () => ({ data: { claims } }) },
      rpc: (name, args) => name === 'af_mcp_session_state' ? { data: 'usable' } : f.db.rpc(name, args) };
    const arena = { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async () => Response.json({ ok: true, bouts: [] }) };
    const handle = createCloudHandler({ db, arena });
    const call = async (name, args) => (await (await handle(new Request(DIRECTORY_RESOURCE, { method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer signed-connector-token-for-test' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }))).json()).result;
    const content = async (name, args) => (await call(name, args)).structuredContent;
    // Relations: a proposal sets the public name before the API looks at the other fighter; an answer and an end reach their own routes.
    assert.equal((await content('propose_fighter_relation', { fighterId: fighter, otherId: crypto.randomUUID(), kind: 'rival', nickname: '감독' })).code,
      'fighter-not-found');
    assert.equal((await content('get_workshop_inbox', {})).nickname, '감독');
    for (const [name, args] of [['answer_fighter_relation', { relationId: crypto.randomUUID(), accept: false }], ['end_fighter_relation', { relationId: crypto.randomUUID() }]])
      assert.equal((await content(name, args)).ok, false, name);
    // Each takes only its own fields: a proposal without the other fighter is refused before anything runs.
    assert.equal((await call('propose_fighter_relation', { fighterId: fighter, kind: 'rival' })).isError, true);
    // Worlds: open one, edit it, place the fighter, take it out as the world's owner, and put it in no world.
    const world = (await content('create_world', { name: '별의 정거장', nickname: '정거장장', cover: 'star-station' })).world.id;
    assert.equal((await content('update_world', { worldId: world, factions: [{ id: 'crew', name: '승무원' }] })).world.factions[0].id, 'crew');
    assert.equal((await content('set_fighter_world', { fighterId: fighter, worldId: world, faction: 'crew' })).faction, 'crew');
    assert.equal((await content('get_world', { worldId: world })).fighters.length, 1);
    assert.equal((await content('remove_world_fighter', { worldId: world, fighterId: fighter })).ok, true);
    assert.deepEqual((await content('get_world', { worldId: world })).fighters, []);
    assert.equal((await content('set_fighter_world', { fighterId: fighter, worldId: null })).ok, true);
  } finally { await f.sql.close(); }
});
