import { test } from 'node:test';
import assert from 'node:assert/strict';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { profileFixture } from './helpers/profile-api-fixture.mjs';

// 정식 선수로 올리기 (2026-11-05, 20261105200000): a registered fighter promoted to an official package leaves the roster and every write,
// keeps his story, relations and world place under the official id, and is neither restored nor deleted.
test('a promoted fighter: off the roster and writes, his story, relations and world place kept, never restored or deleted', async () => {
  const f = await profileFixture(),
    other = crypto.randomUUID(),
    admin = crypto.randomUUID();
  try {
    for (const id of [other, admin]) await f.sql.query('insert into auth.users(id) values($1)', [id]);
    await f.sql.query('insert into af_admins(owner_id) values($1)', [admin]);
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
      return { status: response.status, body: await response.json() };
    };
    const them = 'other-account-test-token';
    const mine = (await f.register()).fighter_id,
      theirs = (await f.register(JSON.stringify(example), null, other)).fighter_id;
    // A relation both owners accepted, and a place in an operator world (placed by the service, as NIGHTCROWN's cast).
    await call('PUT', 'me/name', { nickname: '사부' });
    await call('PUT', 'me/name', { nickname: '제자' }, them);
    const relation = (await call('POST', 'relations', { fighter: mine, other: theirs, kind: 'rival' })).body.relation;
    assert.equal((await call('POST', `relations/${relation.id}/answer`, { accept: true }, them)).body.relation.state, 'accepted');
    await f.sql.query(
      "insert into af_worlds(id, name, description, tagline, place, cover_path, published) values('stage', '무대', '설명', '한 줄', '곳', '/art/worlds/stage/cover.webp', true)",
    );
    await f.sql.query("insert into af_world_fighters(fighter_id, world_id, name, portrait_path) values($1, 'stage', '등록판', null)", [mine]);
    assert.equal((await call('GET', 'worlds', undefined, null)).body.worlds.find(w => w.id === 'stage').fighters, 1);

    const version = (await f.sql.query('select moderation_version from af_fighters where id=$1', [mine])).rows[0].moderation_version;
    const promote = (v = version) => f.sql.query("select af_promote_fighter($1, $2, $3, 'velora', '정식 선수로 올림') as result", [admin, mine, v]);
    await assert.rejects(f.sql.query("select af_promote_fighter($1, $2, $3, 'velora', 'x')", [f.owner, mine, version]), /admin-required/);
    await assert.rejects(f.sql.query("select af_promote_fighter($1, $2, $3, 'Not An Id', 'x')", [admin, mine, version]), /invalid-review/);
    const promoted = (await promote()).rows[0].result;
    assert.deepEqual({ ...promoted, version: undefined }, { fighterId: mine, state: 'promoted', promotedTo: 'velora', version: undefined });
    const row = (await f.sql.query('select * from af_fighters where id=$1', [mine])).rows[0];
    assert.equal(row.review_state, 'rejected');
    assert.equal(row.runtime_approved, false);
    assert.equal(row.duel_approved, false);
    assert.equal(row.promoted_to, 'velora');
    // His slot is released as a deletion releases it (사용자: 선수 칸을 돌려준다).
    assert.equal(row.account_slot, null);
    assert.notEqual(row.deleted_at, null);
    assert.equal(row.entered_at, null);
    assert.equal((await f.sql.query("select count(*)::int as n from af_moderation_events where fighter_id=$1 and action='promote'", [mine])).rows[0].n, 1);
    await assert.rejects(promote(version + 1), /review-conflict/);

    // Read: story (with the official id), the other side's relation, the world's cast and count.
    const story = await call('GET', `story/${mine}`, undefined, null);
    assert.equal(story.status, 200);
    assert.equal(story.body.promotedTo, 'velora');
    assert.equal(story.body.relations.length, 1);
    const seen = (await call('GET', `story/${theirs}`, undefined, null)).body.relations[0];
    assert.equal(seen.other, mine);
    assert.equal(seen.otherPromotedTo, 'velora');
    const world = await call('GET', 'worlds/stage', undefined, null);
    assert.deepEqual(
      world.body.fighters.map(c => [c.id, c.promotedTo]),
      [[mine, 'velora']],
    );
    const listed = (await call('GET', 'worlds', undefined, null)).body.worlds.find(w => w.id === 'stage');
    assert.equal(listed.fighters, 1);
    assert.equal(listed.promotedCounted, true);

    // Off the roster list; his address serves his package read-only (old shared bouts), saying whom he became.
    assert.equal(
      (await call('GET', 'roster', undefined, null)).body.fighters.some(entry => entry.id === mine),
      false,
    );
    const own = await call('GET', `roster/${mine}`, undefined, null);
    assert.equal(own.status, 200);
    assert.equal(own.body.runtimeApproved, false);
    assert.equal(own.body.duelApproved, false);
    assert.equal(own.body.promotedTo, 'velora');
    assert.equal(typeof own.body.manifestText, 'string');
    assert.ok(own.body.files.length > 0);

    // Writes still refused: a note about him, a relation to him, placing him.
    assert.equal((await call('POST', 'notes', { fighter: mine, kind: 'critique', body: '한 마디.' }, them)).body.code, 'fighter-not-found');
    assert.equal((await call('POST', 'relations', { fighter: theirs, other: mine, kind: 'comrade' }, them)).body.code, 'fighter-not-found');
    // (his service-placed row is locked; af_fighter_public, unchanged, would refuse him anywhere else)
    await assert.rejects(f.sql.query("select af_world_place($1, $2, 'stage', null)", [f.owner, mine]), /world-locked|fighter-not-found/);
    assert.equal((await f.sql.query('select af_fighter_public($1) as v', [mine])).rows[0].v, false);
    // Never restored (he would stand twice) nor deleted (his story is the official one's now).
    await assert.rejects(f.sql.query("select af_moderate_fighter($1, $2, $3, 'restore', 'x')", [admin, mine, version + 1]), /fighter-promoted/);
    await assert.rejects(f.sql.query("select af_moderate_fighter($1, $2, $3, 'remove', 'x')", [admin, mine, version + 1]), /review-conflict/);
    await assert.rejects(f.sql.query('update af_fighters set deleted_at=now(), account_slot=null where id=$1', [mine]), /fighter-promoted/);
    await assert.rejects(f.sql.query('update af_fighters set promoted_to=null where id=$1', [mine]), /fighter-promoted/);
    await assert.rejects(f.sql.query("update af_fighters set promoted_to='x' where id=$1", [theirs]), /af_fighters_promoted_retired/);
    // No edit of his public story (사용자: 정사 쓰기도 막는다): canon by his owner (409), a proposal accepted into canon, his profile or style.
    const canon = await call('PUT', `fighters/${mine}/canon`, { base: 0, sheet: { personality: '새 정사' } });
    assert.equal(canon.status, 409);
    assert.equal(canon.body.code, 'fighter-promoted');
    await assert.rejects(
      f.sql.query("insert into af_fighter_canon(fighter_id, version, sheet, author_id) values($1, 9, '{}', $2)", [mine, f.owner]),
      /fighter-promoted/,
    );
    await assert.rejects(f.sql.query('update af_fighters set profile = profile || \'{"name":"x"}\' where id=$1', [mine]), /fighter-promoted/);
    const edit = await f.request(mine, row.manifest_sha, { ...example.profile, description: '고친 소개' });
    assert.notEqual(edit.status, 200);
    // His released slot counts no more: with room for one fighter, his owner registers another.
    await f.sql.query('insert into af_creators(owner_id) values($1) on conflict (owner_id) do nothing', [f.owner]);
    await f.sql.query('update af_creators set fighter_limit = 1 where owner_id=$1', [f.owner]);
    const again = await f.register();
    assert.equal(typeof again.fighter_id, 'string');
    assert.equal((await f.sql.query('select account_slot from af_fighters where id=$1', [again.fighter_id])).rows[0].account_slot, 1);
  } finally {
    await f.sql.close();
  }
});
