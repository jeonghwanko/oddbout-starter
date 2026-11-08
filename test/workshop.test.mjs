import { test } from 'node:test';
import assert from 'node:assert/strict';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { profileFixture } from './helpers/profile-api-fixture.mjs';
import { text } from '../api/canon.mjs';

// Two accounts on one database: the fixture's owner and another, each with a bearer token.
async function workshop() {
  const f = await profileFixture(),
    other = crypto.randomUUID();
  await f.sql.query('insert into auth.users(id) values($1)', [other]);
  const users = { 'local-profile-test-token': f.owner, 'other-account-test-token': other };
  f.db.auth.getUser = async token => ({ data: { user: users[token] ? { id: users[token] } : null } });
  const call = async (method, path, body, token = 'local-profile-test-token') => {
    const response = await f.handle(
      new Request(`http://localhost/ai-fighter/${path}`, {
        method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const mine = (await f.register()).fighter_id,
    theirs = (await f.register(JSON.stringify(example), null, other)).fighter_id;
  return { f, other, call, mine, theirs, them: 'other-account-test-token' };
}

test('the canon sheet: the owner writes versions over the one he read; anyone reads the current one, a version and the list', async () => {
  const { f, call, mine, them } = await workshop();
  try {
    const sheet = { personality: '겁이 많지만 지는 건 더 싫다', voice: '짧게 끊어 말한다', taboos: ['등 뒤에서 치지 않는다'] };
    const first = await call('PUT', `fighters/${mine}/canon`, { base: 0, sheet });
    assert.equal(first.status, 200);
    assert.equal(first.body.version, 1);
    assert.deepEqual(first.body.sheet, sheet);
    assert.equal((await call('PUT', `fighters/${mine}/canon`, { base: 0, sheet })).body.code, 'canon-changed');
    assert.equal((await call('PUT', `fighters/${mine}/canon`, { base: 1, sheet: { mood: 'x' } })).status, 422);
    assert.equal((await call('PUT', `fighters/${mine}/canon`, { base: 1, sheet: { voice: 'a\nb' } })).status, 422);
    assert.equal((await call('PUT', `fighters/${mine}/canon`, { base: 1, sheet: { taboos: [] } })).status, 422);
    assert.equal((await call('PUT', `fighters/${mine}/canon`, { base: 1, sheet }, them)).body.code, 'fighter-not-found');
    assert.equal((await call('PUT', `fighters/${mine}/canon`, { base: 1, sheet: { ...sheet, motive: '사라진 형을 찾는다' } })).body.version, 2);
    const story = await call('GET', `story/${mine}`, undefined, null);
    assert.equal(story.status, 200);
    assert.equal(story.body.canon.version, 2);
    assert.equal(story.body.canon.sheet.motive, '사라진 형을 찾는다');
    assert.deepEqual(
      story.body.versions.map(v => v.version),
      [2, 1],
    );
    assert.equal(story.headers.get('access-control-allow-origin'), '*');
    assert.equal((await call('GET', `story/${mine}?version=1`, undefined, null)).body.canon.sheet.motive, undefined);
    assert.equal((await call('GET', `story/${crypto.randomUUID()}`, undefined, null)).status, 404);
    assert.equal((await call('GET', `story/${mine}`, undefined, null)).body.canon.author, null);
  } finally {
    await f.sql.close();
  }
});

test('workshop notes: a named author critiques, proposes and reviews; the owner accepts a proposal into a new canon version and style', async () => {
  const { f, call, mine, theirs, them } = await workshop();
  try {
    await call('PUT', `fighters/${mine}/canon`, { base: 0, sheet: { personality: '조용한 검객', voice: '존댓말' } });
    const critique = {
      fighter: mine,
      kind: 'critique',
      body: '결승에서 늘 같은 거리에서만 싸운다.',
      evidence: [{ cup: crypto.randomUUID(), round: 3, slot: 0 }],
    };
    assert.equal((await call('POST', 'notes', critique, them)).body.code, 'nickname-required');
    assert.equal((await call('PUT', 'me/name', { nickname: ' 그림자 ' }, them)).body.nickname, '그림자');
    assert.equal((await call('PUT', 'me/name', { nickname: 'x' })).status, 422);
    assert.equal((await call('PUT', 'me/name', { nickname: '그림자' })).body.code, 'nickname-taken');
    assert.equal((await call('POST', 'notes', critique, them)).status, 200);
    // Evidence: a cup bout in its round's slots, or a pairing and seed; a review needs one.
    for (const evidence of [[{ cup: crypto.randomUUID(), round: 3, slot: 1 }], [{ a: 'kuma', b: 'kuma', seed: 1 }], [{ a: 'kuma', b: mine, seed: -1 }]])
      assert.equal((await call('POST', 'notes', { ...critique, evidence }, them)).body.code, 'invalid-evidence');
    assert.equal((await call('POST', 'notes', { fighter: mine, kind: 'review', body: '좋은 경기였다.' }, them)).body.code, 'invalid-evidence');
    assert.equal(
      (await call('POST', 'notes', { fighter: mine, kind: 'review', body: '역전이 멋졌다.', evidence: [{ a: 'kuma', b: mine, seed: 7 }] }, them)).status,
      200,
    );
    // A style the package cannot take is refused when proposed (fast is at most slam + combo).
    assert.equal(
      (await call('POST', 'notes', { fighter: mine, kind: 'proposal', body: '빠르게', proposal: { style: { mix: { slam: 0, combo: 0, fast: 1 } } } }, them))
        .body.code,
      'invalid-proposal',
    );
    assert.equal(
      (await call('POST', 'notes', { fighter: mine, kind: 'critique', body: '제안', proposal: { remake: '다시' } }, them)).body.code,
      'invalid-proposal',
    );
    const style = { mix: { slam: 2, combo: 1, fast: 0 }, distance: 2 };
    const posted = await call(
      'POST',
      'notes',
      {
        fighter: mine,
        kind: 'proposal',
        body: '말투를 거칠게, 거리를 붙여 보자.',
        proposal: { canon: { voice: '반말, 짧게', motive: '스승의 검을 되찾는다' }, style },
      },
      them,
    );
    assert.equal(posted.status, 200);
    assert.equal(posted.body.note.baseVersion, 1);
    const inbox = await call('GET', 'me/workshop');
    assert.deepEqual(inbox.body.notes.map(n => n.kind).sort(), ['critique', 'proposal', 'review']);
    assert.equal(inbox.body.notes.find(n => n.kind === 'proposal').author, '그림자');
    // Only the owner answers; the author may not accept his own proposal on another's fighter.
    assert.equal((await call('POST', `notes/${posted.body.note.id}/resolve`, { decision: 'accept' }, them)).status, 404);
    const accepted = await call('POST', `notes/${posted.body.note.id}/resolve`, { decision: 'accept' });
    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.body.note, { id: posted.body.note.id, state: 'accepted', resolvedVersion: 2 });
    const story = (await call('GET', `story/${mine}`, undefined, null)).body;
    assert.deepEqual(story.canon.sheet, { personality: '조용한 검객', voice: '반말, 짧게', motive: '스승의 검을 되찾는다' });
    assert.equal(story.canon.noteId, posted.body.note.id);
    assert.equal(story.canon.author, '그림자');
    const combat = (
      await f.sql.query("select s.manifest->'combat' as combat from af_fighters f join af_submissions s on s.id=f.submission_id where f.id=$1", [mine])
    ).rows[0].combat;
    assert.deepEqual(combat.style, style);
    assert.equal((await call('POST', `notes/${posted.body.note.id}/resolve`, { decision: 'accept' })).body.code, 'note-closed');
    assert.equal((await call('POST', `notes/${story.notes.find(n => n.kind === 'critique').id}/resolve`, { decision: 'accept' })).body.code, 'not-a-proposal');
    // A declined proposal changes nothing; an author withdraws only his own open note.
    const remake = await call(
      'POST',
      'notes',
      { fighter: mine, kind: 'proposal', body: '등장 클립을 새로', proposal: { remake: '등장 때 모자를 벗는 동작' } },
      them,
    );
    assert.equal((await call('DELETE', `notes/${remake.body.note.id}`)).status, 404);
    assert.equal((await call('POST', `notes/${remake.body.note.id}/resolve`, { decision: 'decline' })).body.note.state, 'declined');
    assert.equal((await call('GET', `story/${mine}`, undefined, null)).body.canon.version, 2);
    const open = await call('POST', 'notes', { fighter: mine, kind: 'critique', body: '취소할 글' }, them);
    assert.equal((await call('DELETE', `notes/${open.body.note.id}`, undefined, them)).body.note.state, 'withdrawn');
    // Ten notes in ten minutes per author.
    await call('PUT', 'me/name', { nickname: 'owner' });
    let last;
    for (let i = 0; i < 11; i += 1) last = await call('POST', 'notes', { fighter: theirs, kind: 'critique', body: `글 ${i}` });
    assert.equal(last.status, 429);
    const paged = await call('GET', `story/${theirs}`, undefined, null);
    assert.equal(paged.body.notes.length, 10);
    assert.equal(paged.body.hasMore, false);
  } finally {
    await f.sql.close();
  }
});

test('declared relations: a pending proposal to another owner, his answer, the kind as each side sees it, one per pair', async () => {
  const { f, call, mine, theirs, them } = await workshop();
  try {
    assert.equal((await call('POST', 'relations', { fighter: mine, other: theirs, kind: 'mentor' })).body.code, 'nickname-required');
    await call('PUT', 'me/name', { nickname: '사부' });
    await call('PUT', 'me/name', { nickname: '제자' }, them);
    const proposed = await call('POST', 'relations', { fighter: mine, other: theirs, kind: 'mentor' });
    assert.equal(proposed.body.relation.state, 'pending');
    assert.equal((await call('POST', 'relations', { fighter: theirs, other: mine, kind: 'rival' }, them)).body.code, 'relation-exists');
    assert.equal((await call('GET', `story/${mine}`, undefined, null)).body.relations.length, 0);
    const waiting = (await call('GET', 'me/workshop', undefined, them)).body.relations;
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0].incoming, true);
    assert.equal((await call('POST', `relations/${proposed.body.relation.id}/answer`, { accept: true })).status, 404);
    assert.equal((await call('POST', `relations/${proposed.body.relation.id}/answer`, { accept: true }, them)).body.relation.state, 'accepted');
    assert.equal((await call('GET', `story/${mine}`, undefined, null)).body.relations[0].kind, 'mentor');
    const seen = (await call('GET', `story/${theirs}`, undefined, null)).body.relations[0];
    assert.equal(seen.kind, 'student');
    assert.equal(seen.other, mine);
    assert.equal(seen.otherName, example.profile.name);
    assert.equal((await call('DELETE', `relations/${proposed.body.relation.id}`, undefined, them)).status, 200);
    assert.equal((await call('GET', `story/${mine}`, undefined, null)).body.relations.length, 0);
    assert.equal((await call('POST', 'relations', { fighter: mine, other: mine, kind: 'rival' })).body.code, 'invalid-relation');
  } finally {
    await f.sql.close();
  }
});

test("open worlds: two per account, factions, placing fighters, the owner's canon and the chronicle", async () => {
  const { f, call, mine, theirs, them } = await workshop();
  try {
    const created = await call('POST', 'worlds', { name: '네온 항구', tagline: '밤에만 열리는 무대', nickname: '항구지기', cover: 'deep-sea' });
    assert.equal(created.status, 200);
    assert.match(created.body.world.id, /^w-[a-f0-9]{10}$/);
    assert.equal(created.body.world.cover, '/art/worlds/open/deep-sea.webp');
    const world = created.body.world.id;
    assert.equal((await call('POST', 'worlds', { name: '나쁜 표지', nickname: '항구지기', cover: 'kkumssi' })).body.code, 'invalid-cover');
    assert.equal((await call('POST', 'worlds', { name: '둘째', nickname: '항구지기' })).status, 200);
    assert.equal((await call('POST', 'worlds', { name: '셋째', nickname: '항구지기' })).body.code, 'world-quota');
    const list = (await call('GET', 'worlds', undefined, null)).body;
    assert.ok(list.worlds.some(w => w.id === world && w.owner === '항구지기' && !w.operator));
    assert.ok(list.worlds.some(w => w.id === 'kkumssi' && w.operator));
    assert.equal(list.covers.length, 8);
    // NIGHTCROWN (2026-11-02) is the second operator world; its cast is placed only where the four fighters exist (not in this database).
    assert.ok(list.worlds.some(w => w.id === 'nightcrown' && w.operator && w.fighters === 0));
    // Factions; a fighter in a faction; another owner's fighter placed by him; the world's owner takes one out.
    assert.equal(
      (
        await call('PATCH', `worlds/${world}`, {
          factions: [
            { id: 'dock', name: '부두파' },
            { id: 'light', name: '등대회' },
          ],
        })
      ).body.world.factions.length,
      2,
    );
    assert.equal((await call('PATCH', `worlds/${world}`, { factions: [{ id: 'x', name: '남의 것' }] }, them)).body.code, 'not-found');
    assert.equal((await call('PUT', `fighters/${mine}/world`, { world, faction: 'nope' })).body.code, 'faction-not-found');
    assert.equal((await call('PUT', `fighters/${mine}/world`, { world, faction: 'dock' })).body.faction, 'dock');
    assert.equal((await call('PUT', `fighters/${theirs}/world`, { world }, them)).body.world, world);
    assert.equal((await call('PUT', `fighters/${theirs}/world`, { world })).body.code, 'fighter-not-found');
    assert.equal((await call('PUT', `fighters/${mine}/world`, { world: 'kkumssi' })).body.code, 'world-not-found');
    let read = (await call('GET', `worlds/${world}`, undefined, null)).body;
    assert.deepEqual(
      read.fighters.map(c => [c.id, c.faction]),
      [
        [mine, 'dock'],
        [theirs, null],
      ],
    );
    await call('PATCH', `worlds/${world}`, { factions: [{ id: 'light', name: '등대회' }] });
    assert.equal((await call('GET', `worlds/${world}`, undefined, null)).body.fighters[0].faction, null);
    assert.equal((await call('PATCH', `worlds/${world}`, { remove: theirs })).status, 200);
    assert.deepEqual(
      (await call('GET', `worlds/${world}`, undefined, null)).body.fighters.map(c => c.id),
      [mine],
    );
    // Posts through the API run as their author: a stranger joins with a nickname; only the owner raises canon.
    const story = { id: crypto.randomUUID(), title: '항구의 첫 밤', body: '등대가 꺼진 밤, 첫 경기가 열렸다.' };
    assert.equal((await call('POST', `worlds/${world}/posts`, story, them)).body.code, 'world-membership-required');
    const fan = await call('POST', `worlds/${world}/posts`, { ...story, nickname: '구경꾼' }, them);
    assert.equal(fan.status, 200);
    assert.equal(fan.body.post.author, '구경꾼');
    assert.equal(fan.body.post.canon, false);
    assert.equal((await call('POST', `worlds/${world}/posts`, { ...story, id: crypto.randomUUID(), canon: true }, them)).body.code, 'not-world-owner');
    assert.equal((await call('PATCH', `worlds/${world}`, { canon: { post: story.id, on: true } }, them)).body.code, 'not-found');
    assert.equal((await call('PATCH', `worlds/${world}`, { canon: { post: story.id, on: true } })).status, 200);
    const own = await call('POST', `worlds/${world}/posts`, { id: crypto.randomUUID(), title: '정사 둘째 장', body: '부두파가 등대를 차지했다.', canon: true });
    assert.equal(own.body.post.canon, true);
    read = (await call('GET', `worlds/${world}`, undefined, null)).body;
    assert.deepEqual(
      read.chronicle.map(p => p.title),
      ['항구의 첫 밤', '정사 둘째 장'],
    );
    assert.equal(read.owner, '항구지기');
    // The operator hides a world: it is gone from the list and its page.
    await f.sql.query('update af_worlds set hidden=true where id=$1', [world]);
    assert.equal((await call('GET', `worlds/${world}`, undefined, null)).status, 404);
    assert.ok(!(await call('GET', 'worlds', undefined, null)).body.worlds.some(w => w.id === world));
    // The lounge reads the same rule (RLS): a hidden world, its cast and its chronicle are gone for every reader (a signed-in one here: the
    // test platform gives anon no auth schema).
    await f.sql.exec('set role authenticated');
    assert.equal((await f.sql.query('select count(*)::int as n from af_worlds where id=$1', [world])).rows[0].n, 0);
    assert.equal((await f.sql.query('select count(*)::int as n from af_world_fighters where world_id=$1', [world])).rows[0].n, 0);
    assert.equal((await f.sql.query('select public.af_world_overview($1) as v', [world])).rows[0].v, null);
    await f.sql.exec('reset role');
  } finally {
    await f.sql.close();
  }
});

test('보강: accepts merge over the sheet as it is; a style follows the answer; any open note can be dismissed; the owner reads his own canon', async () => {
  const { f, call, mine, them } = await workshop();
  try {
    await call('PUT', 'me/name', { nickname: '손님' }, them);
    await call('PUT', `fighters/${mine}/canon`, { base: 0, sheet: { personality: '조용하다\n그러나 끈질기다' } });
    const propose = canon => call('POST', 'notes', { fighter: mine, kind: 'proposal', body: '이렇게 바꿔 보자.', proposal: { canon } }, them);
    const voice = (await propose({ voice: '반말' })).body.note.id,
      motive = (await propose({ motive: '잃어버린 검' })).body.note.id;
    // Two accepts at once: each merges over the other's version, neither is lost.
    const both = await Promise.all([voice, motive].map(note => call('POST', `notes/${note}/resolve`, { decision: 'accept' })));
    assert.deepEqual(
      both.map(r => r.status),
      [200, 200],
    );
    assert.deepEqual((await call('GET', `story/${mine}`, undefined, null)).body.canon.sheet, {
      personality: '조용하다\n그러나 끈질기다',
      voice: '반말',
      motive: '잃어버린 검',
    });
    // A proposal that would leave no field is refused.
    await call('PUT', `fighters/${mine}/canon`, { base: 3, sheet: { voice: '반말' } });
    const empty = (await propose({ voice: null })).body.note.id;
    assert.equal((await call('POST', `notes/${empty}/resolve`, { decision: 'accept' })).body.code, 'canon-empty');
    // A note withdrawn while the owner accepts: the style is applied only after the answer, so a closed note leaves the fighter as he was.
    const style = { mix: { slam: 2, combo: 1, fast: 0 }, distance: 2 };
    const styled = (await call('POST', 'notes', { fighter: mine, kind: 'proposal', body: '붙어서 싸워라.', proposal: { style } }, them)).body.note.id;
    const [answer] = await Promise.all([call('POST', `notes/${styled}/resolve`, { decision: 'accept' }), call('DELETE', `notes/${styled}`, undefined, them)]);
    const combat = async () =>
      (await f.sql.query("select s.manifest->'combat' as c from af_fighters f join af_submissions s on s.id=f.submission_id where f.id=$1", [mine])).rows[0].c;
    if (answer.status !== 200) {
      assert.equal(answer.body.code, 'note-closed');
      assert.equal((await combat()).style, undefined);
    } else assert.deepEqual((await combat()).style, style);
    // A critique is dismissed by declining it; the inbox carries the owner's canon and each relation's other side.
    const critique = (await call('POST', 'notes', { fighter: mine, kind: 'critique', body: '늘 같은 거리.' }, them)).body.note.id;
    assert.equal((await call('POST', `notes/${critique}/resolve`, { decision: 'accept' })).body.code, 'not-a-proposal');
    assert.equal((await call('POST', `notes/${critique}/resolve`, { decision: 'decline' })).body.note.state, 'declined');
    const inbox = (await call('GET', 'me/workshop')).body;
    assert.ok(!inbox.notes.some(n => n.id === critique));
    assert.equal(inbox.canon[mine].version, 4);
    // The owner reads his canon while his fighter is off the public stage; the public does not.
    await f.sql.query(
      "update af_fighters set review_state='rejected', runtime_approved=false, runtime_scope=null, runtime_manifest_sha=null, duel_approved=false, duel_manifest_sha=null where id=$1",
      [mine],
    );
    assert.equal((await call('GET', 'me/workshop')).body.canon[mine].sheet.voice, '반말');
    assert.equal((await call('GET', `story/${mine}`, undefined, null)).status, 404);
  } finally {
    await f.sql.close();
  }
});

test('보강: relations and worlds take only fighters on the public stage; the cast shows current names; a post id sent again is the same post', async () => {
  const { f, call, mine, theirs, them } = await workshop();
  try {
    await call('PUT', 'me/name', { nickname: '사부' });
    await call('PUT', 'me/name', { nickname: '제자' }, them);
    const mentor = await call('POST', 'relations', { fighter: mine, other: theirs, kind: 'mentor' });
    const waiting = (await call('GET', 'me/workshop', undefined, them)).body.relations[0];
    assert.equal(waiting.kind, 'mentor');
    assert.equal(waiting.otherKind, 'student');
    await call('DELETE', `relations/${mentor.body.relation.id}`);
    const world = (await call('POST', 'worlds', { name: '항구', nickname: '항구지기' })).body.world.id;
    assert.equal((await call('PUT', `fighters/${mine}/world`, { world })).status, 200);
    assert.equal((await call('PUT', `fighters/${theirs}/world`, { world }, them)).status, 200);
    await f.sql.query("update af_fighters set profile = jsonb_set(profile, '{name}', '\"새 이름\"') where id=$1", [theirs]);
    // Removed by moderation: out of the cast the public sees, and neither placed nor related again.
    await f.sql.query(
      "update af_fighters set review_state='rejected', runtime_approved=false, runtime_scope=null, runtime_manifest_sha=null, duel_approved=false, duel_manifest_sha=null where id=$1",
      [mine],
    );
    const read = (await call('GET', `worlds/${world}`, undefined, null)).body;
    assert.deepEqual(
      read.fighters.map(c => [c.id, c.name]),
      [[theirs, '새 이름']],
    );
    assert.equal((await call('GET', 'worlds', undefined, null)).body.worlds.find(w => w.id === world).fighters, 1);
    assert.equal((await call('PUT', `fighters/${mine}/world`, { world })).body.code, 'fighter-not-found');
    assert.equal((await call('POST', 'relations', { fighter: mine, other: theirs, kind: 'rival' })).body.code, 'fighter-not-found');
    // Who placed a fighter is not a column the public reads.
    await f.sql.exec('set role authenticated');
    await assert.rejects(f.sql.query('select placed_by from af_world_fighters'));
    assert.ok((await f.sql.query('select fighter_id, name, faction from af_world_fighters')).rows.length >= 1);
    await f.sql.exec('reset role');
    // A post sent again with its id comes back as it is; another author's id is refused.
    const post = { id: crypto.randomUUID(), title: '첫 밤', body: '등대가 꺼졌다.' };
    const first = await call('POST', `worlds/${world}/posts`, post);
    assert.deepEqual((await call('POST', `worlds/${world}/posts`, post)).body.post, first.body.post);
    assert.equal((await call('POST', `worlds/${world}/posts`, { ...post, nickname: '구경꾼' }, them)).body.code, 'post-exists');
    // The operator's worlds lead the list; a cursor is a time as the story gives it; evidence ids are kept lower case.
    assert.equal((await call('GET', 'worlds', undefined, null)).body.worlds[0].operator, true);
    assert.equal((await call('GET', `story/${theirs}?before=1`, undefined, null)).body.code, 'invalid-cursor');
    const upper = theirs.toUpperCase();
    const noted = await call('POST', 'notes', { fighter: theirs, kind: 'review', body: '좋은 경기.', evidence: [{ a: 'kuma', b: upper, seed: 3 }] });
    assert.equal(noted.status, 200);
    assert.equal((await call('GET', `story/${theirs}`, undefined, null)).body.notes[0].evidence[0].b, theirs);
  } finally {
    await f.sql.close();
  }
});

test('a world edit with a malformed canon or removal changes nothing (API 점검 2026-10-29)', async () => {
  const { f, call } = await workshop();
  try {
    const world = (await call('POST', 'worlds', { name: '네온 항구', nickname: '항구지기' })).body.world.id;
    for (const extra of [{ canon: { post: 'not-an-id', on: true } }, { canon: { post: crypto.randomUUID() } }, { canon: 'x' }, { remove: 'not-an-id' }]) {
      const refused = await call('PATCH', `worlds/${world}`, { name: '바뀐 이름', ...extra });
      assert.ok(refused.status >= 400 && refused.status < 500, JSON.stringify(refused.body));
      assert.equal((await call('GET', `worlds/${world}`, undefined, null)).body.world.name, '네온 항구', JSON.stringify(extra));
    }
    assert.equal((await call('PATCH', `worlds/${world}`, { name: '바뀐 이름' })).body.world.name, '바뀐 이름');
  } finally {
    await f.sql.close();
  }
});

test('Windows line endings are line breaks in a multi-line field, and still refused in a one-line field (API 점검 2026-10-29)', () => {
  assert.equal(text('첫 줄\r\n둘째 줄\r셋째 줄', 100, '/body', { lines: true }), '첫 줄\n둘째 줄\n셋째 줄');
  assert.throws(() => text('첫 줄\r\n둘째 줄', 100, '/name'), /invalid-text/);
  assert.throws(() => text('제어\u0007문자', 100, '/body', { lines: true }), /invalid-text/);
});
