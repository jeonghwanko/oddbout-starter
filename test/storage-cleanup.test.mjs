import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, sha256 } from '../api/handler.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { profileFixture } from './helpers/profile-api-fixture.mjs';

// 저장 용량 정리 (2026-11-02): the budget counts the folders it keeps; the operator removes only folders nothing uses, oldest first.
test('the operator removes unused package folders, never one in use, and the upload budget stops counting them', async () => {
  const f = await profileFixture();
  try {
    const admin = crypto.randomUUID(), other = crypto.randomUUID(), late = crypto.randomUUID(), newcomer = crypto.randomUUID();
    await f.sql.query('insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6),($7,$8)',
      [admin, 'operator@example.com', other, 'other@example.com', late, 'late@example.com', newcomer, 'new@example.com']);
    await f.sql.query('insert into af_admins(owner_id) values($1)', [admin]);
    await f.sql.query('update af_settings set max_reserved_bytes=400000000');
    const text = name => JSON.stringify({ ...example, profile: { ...example.profile, name } });
    const createFor = async (user, body) => {
      const result = await f.rpc('af_create_submission', { p_owner: user, p_key: crypto.randomUUID(), p_text: body,
        p_sha: await sha256(new TextEncoder().encode(body)), p_bytes: f.bytes, p_fighter: null });
      if (result.error) throw Error(result.error.message); return result.data;
    };
    const objects = async (owner, id) => { for (const a of example.assets) await f.sql.query('insert into storage.objects values($1,$2,$3)',
      ['ai-fighter-beta', `${owner}/${id}/${a.id}.webp`, { size: a.bytes }]); };
    const kept = async (owner, id) => (await f.sql.query('select count(*)::int as n from storage.objects where name like $1', [`${owner}/${id}/%`])).rows[0].n;
    const dated = (id, day) => f.sql.query('update af_submissions set created_at=$2 where id=$1', [id, `2026-10-0${day}T00:00:00Z`]);

    // His first package, a profile edit that reuses its folder, then a new package: the first folder is unused once the edit is not current.
    const first = await f.register(), fighter = first.fighter_id;
    const edit = await (await f.request(fighter, first.manifest_sha, { name: 'Edited' })).json();
    assert.equal(edit.stage, 'registered');
    const editRow = (await f.sql.query('select asset_source_submission from af_submissions where id=$1', [edit.submissionId])).rows[0];
    assert.equal(editRow.asset_source_submission, first.id);
    const report = async () => (await f.sql.query('select public.af_admin_storage($1) as value', [admin])).rows[0].value;
    assert.equal((await report()).unusedCount, 0, 'the current edit still reads the first folder');
    const art = await f.register(text('Art revision'), fighter);
    // Another creator's rejected package, an upload that expired two hours ago and one that expired just now.
    const rejected = await createFor(other, text('Rejected')); await objects(other, rejected.id);
    await f.sql.query("update af_submissions set status='rejected',validation='{\"code\":\"duplicate-motions\"}' where id=$1", [rejected.id]);
    const expired = await createFor(late, text('Expired')); await objects(late, expired.id);
    await f.sql.query("update af_submissions set expires_at=now()-interval '2 hours' where id=$1", [expired.id]);
    await Promise.all([dated(first.id, 1), dated(rejected.id, 2), dated(expired.id, 3)]);
    const fresh = await createFor(newcomer, text('Fresh'));
    await f.sql.query("update af_submissions set expires_at=now()-interval '5 minutes' where id=$1", [fresh.id]);

    const before = await report();
    assert.deepEqual(before.unused.map(u => [u.submissionId, u.reason]), [[first.id, 'replaced'], [rejected.id, 'rejected'], [expired.id, 'upload-expired']]);
    assert.equal(before.unused[0].email, null); assert.equal(before.unused[1].email, 'other@example.com');
    assert.equal(before.unused[0].fighterId, fighter); assert.equal(before.unused[0].files, example.assets.length);
    assert.equal(before.usedBytes, f.bytes * 5, 'first, art, rejected, expired and fresh hold folders; the edit has none');
    assert.equal(before.unusedBytes, f.bytes * 3);

    // A full budget refuses the next creator until folders go.
    await f.sql.query('update af_settings set max_reserved_bytes=$1', [before.usedBytes]);
    await assert.rejects(createFor(admin, text('Blocked')), /storage-budget-full/);

    const removed = [];
    let failing = null;
    const tokens = { 'fixture-admin-token': admin, 'fixture-other-token': other };
    const handle = createHandler({ db: { ...f.db, auth: { getUser: async token => tokens[token] ? { data: { user: { id: tokens[token] } } } : { error: { message: 'invalid' } } },
      storage: { from: () => ({ remove: async keys => {
        if (keys.some(key => key.includes(failing))) return { data: null, error: { message: 'storage down' } };
        removed.push(...keys);
        await f.sql.query('delete from storage.objects where name = any($1)', [keys]);
        return { data: keys.map(name => ({ name })), error: null };
      } }) } } });
    const call = (path, body, token = 'fixture-admin-token') => handle(new Request(`https://test/ai-fighter/admin/${path}`, {
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), headers: { authorization: `Bearer ${token}` } }));
    assert.equal((await call('storage', undefined, 'fixture-other-token')).status, 403);
    assert.equal((await call('storage/removals', { submissionIds: [first.id] }, 'fixture-other-token')).status, 403);
    for (const body of [{}, { submissionIds: [] }, { submissionIds: ['nope'] }, { submissionIds: [first.id, first.id.toUpperCase()] },
      { submissionIds: Array.from({ length: 51 }, () => crypto.randomUUID()) }, { submissionIds: [first.id], extra: 1 }])
      assert.equal((await call('storage/removals', body)).status, 400, JSON.stringify(body).slice(0, 80));
    const listed = await (await call('storage')).json();
    assert.equal(listed.ok, true); assert.deepEqual(listed.unused.map(u => u.submissionId), before.unused.map(u => u.submissionId));

    // The named folders that are unused lose their files; the current package, the edit's source and a fresh expiry are skipped.
    failing = expired.id;
    const answer = await (await call('storage/removals', { submissionIds: [first.id, rejected.id, art.id, edit.submissionId, fresh.id, expired.id] })).json();
    assert.equal(answer.ok, true);
    assert.equal(answer.removed, 2); assert.equal(answer.freedBytes, f.bytes * 2);
    assert.deepEqual(answer.skipped.sort(), [art.id, edit.submissionId, fresh.id].sort());
    assert.deepEqual(answer.failed, [expired.id]);
    assert.equal(answer.usedBytes, before.usedBytes - f.bytes * 2);
    assert.equal(await kept(f.owner, first.id), 0); assert.equal(await kept(other, rejected.id), 0);
    assert.equal(await kept(f.owner, art.id), example.assets.length); assert.equal(await kept(late, expired.id), example.assets.length);
    assert.ok(removed.every(key => key.startsWith(`${f.owner}/${first.id}/`) || key.startsWith(`${other}/${rejected.id}/`)));
    // The failed folder still counts and is still listed; the next creator fits in what was freed.
    assert.deepEqual((await report()).unused.map(u => u.submissionId), [expired.id]);
    assert.equal((await createFor(admin, text('Fits now'))).status, 'uploading');
    const audit = (await f.sql.query('select submission_id,actor,reason,asset_bytes from af_asset_removals order by removed_at,submission_id')).rows;
    assert.deepEqual(audit.map(r => [r.submission_id, r.actor, r.reason, Number(r.asset_bytes)]).sort(),
      [[first.id, admin, 'replaced', f.bytes], [rejected.id, admin, 'rejected', f.bytes]].sort());
    // A retry removes and records nothing twice.
    failing = null;
    const again = await (await call('storage/removals', { submissionIds: [first.id, expired.id] })).json();
    assert.equal(again.removed, 1); assert.deepEqual(again.skipped, [first.id]); assert.equal(await kept(late, expired.id), 0);
    assert.equal((await f.sql.query('select count(*)::int as n from af_asset_removals')).rows[0].n, 3);
    // His current package still reads: the roster signs the art revision's own folder.
    const roster = await (await f.handle(new Request(`http://localhost/ai-fighter/roster/${fighter}`))).json();
    assert.equal(roster.manifestSha256, art.manifest_sha);

    // Neither a browser role nor a forged actor reaches the service-only functions and table.
    await assert.rejects(f.sql.query('select public.af_admin_storage($1)', [other]), /admin-required/);
    await f.sql.exec('set role authenticated');
    for (const statement of ['select public.af_admin_storage(gen_random_uuid())', 'select public.af_kept_package_bytes()', 'select * from af_asset_removals'])
      await assert.rejects(f.sql.query(statement), /permission denied/);
    await f.sql.exec('reset role');
  } finally { await f.sql.close(); }
});
