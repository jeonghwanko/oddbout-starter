import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../api/handler.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { profileFixture } from './helpers/profile-api-fixture.mjs';

test('five new-fighter attempts a day remain bounded; unlimited revisions reuse validated assets and preserve identity, history and admissions', async () => {
  const f = await profileFixture();
  try {
    // Use four failed first attempts and register on the fifth, just like the reported account.
    for (let i = 0; i < 4; i++) {
      const s = await f.create(JSON.stringify(example));
      await f.sql.query("update af_submissions set status='rejected' where id=$1", [s.id]);
    }
    const first = await f.register(),
      id = first.fighter_id;
    // Entered (출전, 2026-10-30): the edits below keep the art, and so his entry and the admission the roster reports.
    await f.sql.query('select public.af_enter_fighter($1,$2,$3,$4)', [
      f.owner,
      id,
      first.manifest_sha,
      ['idle', 'walk', 'run', 'fightIdle', 'combo', 'slam', 'dash', 'block', 'hit', 'groggy', 'fall'],
    ]);
    const original = (await f.sql.query('select * from af_fighters where id=$1', [id])).rows[0];
    await f.sql.query('update af_settings set max_reserved_bytes=$1', [f.bytes * 5]);
    let current = first;
    for (let i = 0; i < 7; i++) {
      const key = crypto.randomUUID(),
        profile = { name: `Edited fighter ${i}`, description: `Introduction ${i}` },
        expected = current.manifest_sha;
      const response = await f.request(id, expected, profile, key);
      assert.equal(response.status, 200, await response.clone().text());
      const saved = await response.json();
      assert.equal(saved.stage, 'registered');
      assert.equal(saved.fighterId, id);
      assert.equal(saved.runtimeApproved, true);
      const row = (await f.sql.query('select * from af_submissions where id=$1', [saved.submissionId])).rows[0];
      assert.equal(row.asset_source_submission, first.id);
      assert.deepEqual(row.manifest.assets, example.assets);
      assert.deepEqual(row.manifest.clips, example.clips);
      assert.equal(row.manifest_sha, await sha256(new TextEncoder().encode(row.manifest_text)));
      assert.equal((await (await f.request(id, expected, profile, key)).json()).submissionId, row.id);
      assert.equal((await f.request(id, expected, { name: 'Conflicting retry' }, key)).status, 409);
      current = row;
    }
    const after = (await f.sql.query('select * from af_fighters where id=$1', [id])).rows[0];
    assert.equal(after.created_at.getTime(), original.created_at.getTime());
    assert.equal(after.runtime_manifest_sha, current.manifest_sha);
    assert.equal(after.duel_manifest_sha, current.manifest_sha);
    assert.deepEqual((await f.sql.query('select manifest from af_submissions where id=$1', [first.id])).rows[0].manifest, example);
    assert.equal((await f.sql.query('select count(*)::int as n from storage.objects')).rows[0].n, example.assets.length);
    const roster = await (await f.handle(new Request(`http://localhost/ai-fighter/roster/${id}`))).json();
    assert.equal(roster.manifestSha256, current.manifest_sha);
    assert.equal(roster.duelApproved, true);
    assert.ok(f.signedPaths.every(path => path.startsWith(`${f.owner}/${first.id}/`)));
    assert.equal(f.uploads.length, 0);
    // Full art/combat revisions still go through uploads, and still reserve actual new bytes.
    await assert.rejects(f.create(JSON.stringify({ ...example, profile: { ...example.profile, name: 'Art revision' } }), id), /storage-budget-full/);
    await f.sql.query('update af_settings set max_reserved_bytes=$1', [f.bytes * 6]);
    const update = await f.register(JSON.stringify({ ...example, profile: { ...example.profile, name: 'Art revision' } }), id);
    assert.equal(update.fighter_id, id);
    assert.equal(update.status, 'registered');
    const next = await (await f.request(id, update.manifest_sha, { name: 'After art update' })).json();
    assert.equal(
      (await f.sql.query('select asset_source_submission from af_submissions where id=$1', [next.submissionId])).rows[0].asset_source_submission,
      update.id,
    );
    // An account with five failed first attempts in a day cannot start a sixth that day.
    const other = crypto.randomUUID();
    await f.sql.query('insert into auth.users(id) values($1)', [other]);
    await f.sql.query('update af_settings set max_reserved_bytes=100000000');
    const attempt = () =>
      f.rpc('af_create_submission', {
        p_owner: other,
        p_key: crypto.randomUUID(),
        p_text: JSON.stringify(example),
        p_sha: first.manifest_sha,
        p_bytes: f.bytes,
      });
    for (let i = 0; i < 5; i++) {
      const s = await attempt();
      assert.ok(s.data);
      await f.sql.query("update af_submissions set status='rejected' where id=$1", [s.data.id]);
    }
    assert.equal((await attempt()).error.message, 'submission-quota');
    // The bound is per day, not for the account's life: once those attempts are a day old it may try again.
    await f.sql.query("update af_submissions set created_at=now()-interval '25 hours' where owner_id=$1", [other]);
    assert.ok((await attempt()).data);
  } finally {
    await f.sql.close();
  }
});

test('metadata edits enforce ownership, immutable art, schema, concurrency, moderation, rate limits, pause, RLS and CORS', async () => {
  const f = await profileFixture();
  try {
    const first = await f.register(),
      id = first.fighter_id,
      key = crypto.randomUUID();
    const send = profile => f.request(id, first.manifest_sha, profile);
    for (const profile of [
      { name: '' },
      { name: 'x'.repeat(41) },
      { description: ' ' },
      { name: 'bad\0text' },
      { portrait: example.profile.portrait },
      { combat: {} },
      {},
    ])
      assert.equal((await send(profile)).status, 422);
    assert.equal((await f.request(id, first.manifest_sha, { name: 'Other' }, key, 'foreign-test-token')).status, 401);
    assert.equal((await f.request(crypto.randomUUID(), first.manifest_sha, { name: 'Foreign' })).status, 404);
    const response = await send({ name: 'Local edit' });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal((await send({ name: 'Stale edit' })).status, 409);
    const pending = await f.create(JSON.stringify({ ...example, profile: { ...example.profile, name: 'Pending' } }), id);
    assert.equal((await f.request(id, saved.manifestSha256, { name: 'During upload' })).status, 409);
    await f.sql.query("update af_submissions set status='rejected' where id=$1", [pending.id]);
    await assert.rejects(f.sql.query('update af_submissions set asset_source_submission=null where id=$1', [saved.submissionId]), /immutable-submission/);
    const changed = JSON.stringify({
      ...example,
      profile: { ...example.profile, name: 'Bypass' },
      combat: { ...example.combat, stats: { power: 1, toughness: 1, speed: 1 } },
    });
    assert.equal(
      (
        await f.rpc('af_update_fighter_profile', {
          p_owner: f.owner,
          p_key: crypto.randomUUID(),
          p_fighter: id,
          p_base: saved.submissionId,
          p_text: changed,
          p_sha: 'a'.repeat(64),
        })
      ).error.message,
      'profile-only-required',
    );
    await f.sql.query('update af_settings set paused=true');
    assert.equal((await f.request(id, saved.manifestSha256, { name: 'Paused' })).status, 409);
    await f.sql.query('update af_settings set paused=false');
    await f.sql.query(
      "update af_fighters set review_state='rejected',runtime_approved=false,runtime_scope=null,runtime_manifest_sha=null,duel_approved=false,duel_manifest_sha=null where id=$1",
      [id],
    );
    assert.equal((await (await f.request(id, saved.manifestSha256, { name: 'Removed' })).json()).code, 'fighter-removed');
    for (const role of ['anon', 'authenticated']) {
      await f.sql.exec(`set role ${role}`);
      await assert.rejects(
        f.sql.query('select public.af_update_fighter_profile($1,$2,$3,$4,$5,$6)', [f.owner, key, id, first.id, JSON.stringify(example), first.manifest_sha]),
        /permission denied/,
      );
      await f.sql.exec('reset role');
    }
    const preflight = await f.handle(new Request(`http://localhost/ai-fighter/fighters/${id}/profile`, { method: 'OPTIONS' }));
    assert.equal(preflight.status, 200);
    assert.match(preflight.headers.get('access-control-allow-methods'), /PATCH/);
    assert.match(preflight.headers.get('access-control-allow-headers'), /Idempotency-Key/);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(f.uploads.length, 0);
    await f.sql.query('update af_creators set request_count=120,request_window=now() where owner_id=$1', [f.owner]);
    assert.equal((await f.request(id, saved.manifestSha256, { name: 'Rate limited' })).status, 429);
    await f.sql.query('update af_creators set enabled=false,request_count=0 where owner_id=$1', [f.owner]);
    assert.equal((await f.request(id, saved.manifestSha256, { name: 'Disabled' })).status, 403);
  } finally {
    await f.sql.close();
  }
});

test('per-language names are edited like the rest of the profile, shown on the roster, and null removes them', async () => {
  const f = await profileFixture();
  try {
    const first = await f.register(),
      id = first.fighter_id;
    // The roster lists entered fighters (출전, 2026-10-30); an edit keeps the art, and so the entry.
    await f.sql.query('select public.af_enter_fighter($1,$2,$3,$4)', [
      f.owner,
      id,
      first.manifest_sha,
      ['idle', 'walk', 'run', 'fightIdle', 'combo', 'slam', 'dash', 'block', 'hit', 'groggy', 'fall'],
    ]);
    const names = { ko: '레드글러브 냥', en: 'Redglove Nyang' };
    const set = await f.request(id, first.manifest_sha, { names }, crypto.randomUUID());
    assert.equal(set.status, 200, await set.clone().text());
    const saved = await set.json();
    const listed = (await (await f.handle(new Request('http://localhost/ai-fighter/roster'))).json()).fighters.find(row => row.id === id);
    assert.deepEqual(listed.names, names);
    assert.equal(listed.name, example.profile.name);
    assert.equal((await f.request(id, saved.manifestSha256, { names: {} }, crypto.randomUUID())).status, 422);
    assert.equal((await f.request(id, saved.manifestSha256, { names: { ja: '名前' } }, crypto.randomUUID())).status, 422);
    const cleared = await f.request(id, saved.manifestSha256, { names: null }, crypto.randomUUID());
    assert.equal(cleared.status, 200, await cleared.clone().text());
    const row = (await f.sql.query('select manifest from af_submissions where id=$1', [(await cleared.json()).submissionId])).rows[0];
    assert.equal('names' in row.manifest.profile, false);
    const relisted = (await (await f.handle(new Request('http://localhost/ai-fighter/roster'))).json()).fighters.find(r => r.id === id);
    assert.equal('names' in relisted, false);
  } finally {
    await f.sql.close();
  }
});

test('bout lines are edited like the rest of the profile and null removes them', async () => {
  const f = await profileFixture();
  try {
    const first = await f.register(),
      id = first.fighter_id;
    const lines = { challenge: '한 판 붙자!', win: '역시 내가 이겼군.' };
    const set = await f.request(id, first.manifest_sha, { lines }, crypto.randomUUID());
    assert.equal(set.status, 200, await set.clone().text());
    const saved = await set.json();
    const row = sql => f.sql.query('select manifest from af_submissions where id=$1', [sql]).then(r => r.rows[0].manifest);
    const edited = await row(saved.submissionId);
    assert.deepEqual(edited.profile.lines, lines);
    assert.deepEqual({ ...edited, profile: { ...edited.profile, lines: undefined } }, { ...example, profile: { ...example.profile, lines: undefined } });
    assert.deepEqual((await f.sql.query('select profile from af_fighters where id=$1', [id])).rows[0].profile.lines, lines);
    for (const invalid of [{}, { taunt: 'x' }, { lose: 'x'.repeat(41) }, { win: ' ' }])
      assert.equal((await f.request(id, saved.manifestSha256, { lines: invalid }, crypto.randomUUID())).status, 422, JSON.stringify(invalid));
    const cleared = await f.request(id, saved.manifestSha256, { lines: null }, crypto.randomUUID());
    assert.equal(cleared.status, 200, await cleared.clone().text());
    assert.equal('lines' in (await row((await cleared.json()).submissionId)).profile, false);
    assert.equal('lines' in (await f.sql.query('select profile from af_fighters where id=$1', [id])).rows[0].profile, false);
  } finally {
    await f.sql.close();
  }
});

test('the fighting style is edited without new art; null removes it, and nothing else of combat moves with it', async () => {
  const f = await profileFixture();
  try {
    const first = await f.register(),
      id = first.fighter_id;
    const patch = (hash, body) =>
      f.handle(
        new Request(`http://localhost/ai-fighter/fighters/${id}/profile`, {
          method: 'PATCH',
          headers: { authorization: 'Bearer local-profile-test-token', 'idempotency-key': crypto.randomUUID(), 'content-type': 'application/json' },
          body: JSON.stringify({ expectedManifestSha256: hash, ...body }),
        }),
      );
    const style = { mix: { slam: 2, combo: 1, fast: 0 }, distance: 2, temper: { guard: 4 } };
    const set = await patch(first.manifest_sha, { style });
    assert.equal(set.status, 200, await set.clone().text());
    const saved = await set.json(),
      manifestOf = async submission => (await f.sql.query('select manifest from af_submissions where id=$1', [submission])).rows[0].manifest;
    const styled = await manifestOf(saved.submissionId);
    assert.deepEqual(styled.combat, { ...example.combat, style });
    assert.deepEqual(styled.profile, example.profile);
    assert.deepEqual(styled.assets, example.assets);
    assert.equal(f.uploads.length, 0);
    // The owner's lookup (get_registered_fighter) shows the combat a style edit starts from.
    const owned = await (
      await f.handle(new Request(`http://localhost/ai-fighter/fighters/${id}`, { headers: { authorization: 'Bearer local-profile-test-token' } }))
    ).json();
    assert.deepEqual(owned.fighter.combat, { stats: example.combat.stats, style, skill: null });
    // The contract checks the style (fast is at most slam + combo); a body edits the profile, the style or both, never nothing.
    assert.equal((await patch(saved.manifestSha256, { style: { mix: { slam: 0, combo: 0, fast: 1 } } })).status, 422);
    assert.equal((await patch(saved.manifestSha256, { style: [] })).status, 422);
    assert.equal((await patch(saved.manifestSha256, {})).status, 422);
    const both = await patch(saved.manifestSha256, { profile: { name: 'Styled fighter' }, style: null });
    assert.equal(both.status, 200, await both.clone().text());
    const cleared = await both.json(),
      plain = await manifestOf(cleared.submissionId);
    assert.equal('style' in plain.combat, false);
    assert.equal(plain.profile.name, 'Styled fighter');
    // The database lets only the style of combat change: the stats cannot ride along with it.
    const stats = JSON.stringify({ ...example, combat: { ...example.combat, stats: { power: 5, toughness: 5, speed: 5 }, style } });
    assert.equal(
      (
        await f.rpc('af_update_fighter_profile', {
          p_owner: f.owner,
          p_key: crypto.randomUUID(),
          p_fighter: id,
          p_base: cleared.submissionId,
          p_text: stats,
          p_sha: 'a'.repeat(64),
        })
      ).error.message,
      'profile-only-required',
    );
  } finally {
    await f.sql.close();
  }
});

test("an edited fighter's older submission reads as superseded, not removed; an uppercase id retries the same edit (API 점검 2026-10-29)", async () => {
  const f = await profileFixture();
  try {
    const first = await f.register(),
      id = first.fighter_id,
      key = crypto.randomUUID();
    const edit = await f.request(id.toUpperCase(), first.manifest_sha, { name: 'Upper edit' }, key);
    assert.equal(edit.status, 200, await edit.clone().text());
    const saved = await edit.json();
    const retried = await f.request(id.toUpperCase(), first.manifest_sha, { name: 'Upper edit' }, key);
    assert.equal(retried.status, 200, await retried.clone().text());
    assert.equal((await retried.json()).submissionId, saved.submissionId);
    const read = async submission =>
      (
        await f.handle(new Request(`http://localhost/ai-fighter/submissions/${submission}`, { headers: { authorization: 'Bearer local-profile-test-token' } }))
      ).json();
    const old = await read(first.id);
    assert.deepEqual([old.stage, old.availability, old.currentSubmissionId, old.runtimeApproved], ['registered', 'superseded', saved.submissionId, false]);
    const current = await read(saved.submissionId);
    assert.deepEqual([current.availability, current.runtimeApproved, 'currentSubmissionId' in current], ['active', true, false]);
    // A removed fighter still reads as removed, on its current submission.
    await f.sql.query(
      `update af_fighters set review_state='rejected',runtime_approved=false,runtime_scope=null,runtime_manifest_sha=null,duel_approved=false,
      duel_manifest_sha=null,moderation_reason='test' where id=$1`,
      [id],
    );
    assert.deepEqual([(await read(saved.submissionId)).availability, (await read(saved.submissionId)).moderationReason], ['removed', 'test']);
  } finally {
    await f.sql.close();
  }
});
