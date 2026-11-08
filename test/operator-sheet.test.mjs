import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generation, webp } from './helpers/generation-database.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { VALIDATOR_VERSION, sha256 } from '../api/handler.mjs';
import { PROFILE_SET_VALIDATOR_VERSION, PROFILE_SET_VERSION, addOperatorSheet, profileSetKey } from '../api/profile-sets.mjs';

// 운영자의 표정 시트 (2026-11-03 — 사용자: "무투장 패배 표정 없는 캐릭터들은 image-gen으로 생성해서 추가하고").
test("Postgres: an operator's sheet is a new set under the owner from his approved front; it waits for review; a retry answers the same set", async () => {
  const { sql, db, owner, objects } = await generation();
  try {
    const admin = crypto.randomUUID();
    await sql.query('insert into auth.users(id) values($1)', [admin]);
    await sql.query('insert into af_admins(owner_id) values($1)', [admin]);
    const value = result => result.rows[0].value;
    const call = async (name, args) => value(await sql.query(`select to_jsonb(public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')})) as value`, args));
    // A registered fighter, as the package route makes one.
    const text = JSON.stringify(example),
      sha = await sha256(new TextEncoder().encode(text)),
      bytes = example.assets.reduce((sum, a) => sum + a.bytes, 0);
    const submission = await call('af_create_submission', [owner, crypto.randomUUID(), text, sha, bytes]);
    for (const a of example.assets)
      await sql.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${submission.id}/${a.id}.webp`, { size: a.bytes }]);
    await call('af_submit', [owner, submission.id]);
    const leased = await call('af_claim', [submission.id]);
    const fighter = (
      await call('af_finish', [
        submission.id,
        leased.lease_token,
        sha,
        true,
        { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: [] },
      ])
    ).fighter_id;
    // His approved set without a sheet: front and derived files in private storage.
    const bucket = db.storage.from('ai-fighter-beta'),
      front = webp(1024, 1536);
    const frontFile = { path: 'front.webp', bytes: front.length, sha256: await sha256(front), width: 1024, height: 1536 };
    const manifest = JSON.stringify({ version: PROFILE_SET_VERSION, front: frontFile, face: { x: 400, y: 30, side: 250 } });
    /** A set uploaded and submitted to the validator. */
    const submitted = async (file, text) => {
      const set = await call('af_profile_set_create', [
        owner,
        fighter,
        crypto.randomUUID(),
        text,
        await sha256(new TextEncoder().encode(text)),
        file.front.bytes,
      ]);
      await bucket.upload(profileSetKey(owner, set.id, 'front'), front);
      await call('af_profile_set_submit', [owner, set.id]);
      return set;
    };
    const first = await submitted({ front: frontFile }, manifest);
    const lease = await call('af_profile_set_claim', [first.id]);
    const derived = {
      card: { sha256: 'c'.repeat(64), bytes: 3, width: 135, height: 600, face: { x: 18, y: 0, side: 98 } },
      face: { sha256: 'f'.repeat(64), bytes: 3, size: 192 },
    };
    for (const name of ['card', 'face']) await bucket.upload(profileSetKey(owner, first.id, name), new Uint8Array(3));
    await call('af_profile_set_finish', [
      first.id,
      lease.lease_token,
      first.manifest_sha,
      true,
      { validatorVersion: PROFILE_SET_VALIDATOR_VERSION, stage: 'profile-set-full-decode', errors: [] },
      derived,
    ]);
    await call('af_admin_profile_set_approve', [admin, first.id]);

    const sheet = webp(1536, 1024),
      key = crypto.randomUUID();
    const add = (more = {}) =>
      addOperatorSheet(db, { actor: admin, setId: first.id, fighterId: fighter, key, reason: '표정 시트 추가', bytes: sheet, ...more });
    // Another fighter's set, or a reason the audit cannot keep: refused before anything is made.
    await assert.rejects(add({ fighterId: crypto.randomUUID() }), /fighter-mismatch/);
    await assert.rejects(add({ key: crypto.randomUUID(), reason: '' }), /invalid-reason/);
    const made = await add();
    assert.equal(made.stage, 'queued');
    const row = (await sql.query('select * from public.af_profile_sets where id = $1', [made.profileSetId])).rows[0];
    assert.deepEqual(
      [row.owner_id, row.fighter_id, row.based_on, row.manifest.face, row.manifest.front],
      [owner, fighter, first.id, { x: 400, y: 30, side: 250 }, frontFile],
    );
    assert.deepEqual(row.manifest.expressions, { path: 'expressions.webp', bytes: sheet.length, sha256: await sha256(sheet), width: 1536, height: 1024 });
    assert.deepEqual(objects.get(`ai-fighter-beta/${profileSetKey(owner, made.profileSetId, 'front')}`)?.bytes, front, 'his approved front, copied');
    assert.ok(objects.has(`ai-fighter-beta/${profileSetKey(owner, made.profileSetId, 'expressions')}`));
    // His current set stays until the new one is approved; the operator's id and reason are kept in the events.
    assert.equal((await sql.query('select profile_set_id from public.af_fighters where id = $1', [fighter])).rows[0].profile_set_id, first.id);
    const events = async () => (await sql.query("select actor, data from public.af_profile_set_events where kind = 'admin-expressions'")).rows;
    assert.deepEqual(await events(), [{ actor: admin, data: { reason: '표정 시트 추가', from: first.id } }]);
    // The same key again answers the same set, once; a different sheet under it is a conflict; after approval (which supersedes the set it
    // came from) the same key still answers it.
    assert.equal((await add()).profileSetId, made.profileSetId);
    assert.equal((await events()).length, 1);
    await assert.rejects(add({ bytes: webp(1536, 1024).map((b, i) => (i === 40 ? 9 : b)) }), /idempotency-conflict/);
    const sheetLease = await call('af_profile_set_claim', [made.profileSetId]);
    for (const name of ['card', 'face', 'sheet']) await bucket.upload(profileSetKey(owner, made.profileSetId, name), new Uint8Array(3));
    await call('af_profile_set_finish', [
      made.profileSetId,
      sheetLease.lease_token,
      row.manifest_sha,
      true,
      { validatorVersion: PROFILE_SET_VALIDATOR_VERSION, stage: 'profile-set-full-decode', errors: [] },
      { ...derived, sheet: { sha256: 'd'.repeat(64), bytes: 3, width: 1152, height: 768, cell: 384 } },
    ]);
    await call('af_admin_profile_set_approve', [admin, made.profileSetId]);
    assert.deepEqual([(await add()).profileSetId, (await add()).stage], [made.profileSetId, 'approved']);
    // Refused: a set that is no longer his current one, a picture that is not a WebP, a sheet of another size.
    await assert.rejects(add({ key: crypto.randomUUID() }), /review-conflict/);
    await assert.rejects(
      addOperatorSheet(db, { actor: admin, setId: made.profileSetId, fighterId: fighter, key: crypto.randomUUID(), reason: 'x', bytes: new Uint8Array(64) }),
      /webp-required/,
    );
    await assert.rejects(
      addOperatorSheet(db, { actor: admin, setId: made.profileSetId, fighterId: fighter, key: crypto.randomUUID(), reason: 'x', bytes: webp(1024, 1024) }),
      error => error.message === 'invalid-profile-set' && error.errors[0].code === 'EXPRESSIONS_DIMENSIONS',
    );
  } finally {
    await sql.close();
  }
});

test("Postgres: an operator's copy is not approved over a front the owner replaced meanwhile; a failed upload never holds the owner's own", async () => {
  const { sql, db, owner } = await generation();
  try {
    const admin = crypto.randomUUID();
    await sql.query('insert into auth.users(id) values($1)', [admin]);
    await sql.query('insert into af_admins(owner_id) values($1)', [admin]);
    const value = result => result.rows[0].value;
    const call = async (name, args) => value(await sql.query(`select to_jsonb(public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')})) as value`, args));
    const text = JSON.stringify(example),
      sha = await sha256(new TextEncoder().encode(text)),
      bytes = example.assets.reduce((sum, a) => sum + a.bytes, 0);
    const submission = await call('af_create_submission', [owner, crypto.randomUUID(), text, sha, bytes]);
    for (const a of example.assets)
      await sql.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${submission.id}/${a.id}.webp`, { size: a.bytes }]);
    await call('af_submit', [owner, submission.id]);
    const leased = await call('af_claim', [submission.id]);
    const fighter = (
      await call('af_finish', [
        submission.id,
        leased.lease_token,
        sha,
        true,
        { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: [] },
      ])
    ).fighter_id;
    const bucket = db.storage.from('ai-fighter-beta');
    /** An owner's set with this front, validated and approved. */
    const approvedSet = async front => {
      const file = { path: 'front.webp', bytes: front.length, sha256: await sha256(front), width: 1024, height: 1536 };
      const manifest = JSON.stringify({ version: PROFILE_SET_VERSION, front: file, face: { x: 400, y: 30, side: 250 } });
      const set = await call('af_profile_set_create', [
        owner,
        fighter,
        crypto.randomUUID(),
        manifest,
        await sha256(new TextEncoder().encode(manifest)),
        file.bytes,
      ]);
      await bucket.upload(profileSetKey(owner, set.id, 'front'), front);
      await call('af_profile_set_submit', [owner, set.id]);
      const lease = await call('af_profile_set_claim', [set.id]);
      for (const name of ['card', 'face']) await bucket.upload(profileSetKey(owner, set.id, name), new Uint8Array(3));
      await call('af_profile_set_finish', [
        set.id,
        lease.lease_token,
        set.manifest_sha,
        true,
        { validatorVersion: PROFILE_SET_VALIDATOR_VERSION, stage: 'profile-set-full-decode', errors: [] },
        {
          card: { sha256: 'c'.repeat(64), bytes: 3, width: 135, height: 600, face: { x: 18, y: 0, side: 98 } },
          face: { sha256: 'f'.repeat(64), bytes: 3, size: 192 },
        },
      ]);
      await call('af_admin_profile_set_approve', [admin, set.id]);
      return set;
    };
    const s1 = await approvedSet(webp(1024, 1536));
    const copy = await addOperatorSheet(db, {
      actor: admin,
      setId: s1.id,
      fighterId: fighter,
      key: crypto.randomUUID(),
      reason: '시트',
      bytes: webp(1536, 1024),
    });
    const lease = await call('af_profile_set_claim', [copy.profileSetId]);
    for (const name of ['card', 'face', 'sheet']) await bucket.upload(profileSetKey(owner, copy.profileSetId, name), new Uint8Array(3));
    await call('af_profile_set_finish', [
      copy.profileSetId,
      lease.lease_token,
      copy.manifestSha256,
      true,
      { validatorVersion: PROFILE_SET_VALIDATOR_VERSION, stage: 'profile-set-full-decode', errors: [] },
      {
        card: { sha256: 'c'.repeat(64), bytes: 3, width: 135, height: 600, face: { x: 18, y: 0, side: 98 } },
        face: { sha256: 'f'.repeat(64), bytes: 3, size: 192 },
        sheet: { sha256: 'd'.repeat(64), bytes: 3, width: 1152, height: 768, cell: 384 },
      },
    ]);
    // The owner approves a new front meanwhile: the copy of his old one is refused, and his new front stays.
    const front2 = webp(1024, 1536);
    front2[40] = 7;
    const s2 = await approvedSet(front2);
    await assert.rejects(call('af_admin_profile_set_approve', [admin, copy.profileSetId]), /review-conflict/);
    assert.equal((await sql.query('select profile_set_id from public.af_fighters where id = $1', [fighter])).rows[0].profile_set_id, s2.id);
    // A store that fails after the set was made closes it: his owner's own upload is not held.
    const failing = {
      ...db,
      storage: {
        from: name => ({
          ...db.storage.from(name),
          upload: async () => ({ error: { message: 'storage down' } }),
          download: async path => (path.includes('/expressions.webp') ? { data: null, error: { message: 'missing' } } : db.storage.from(name).download(path)),
        }),
      },
    };
    await assert.rejects(
      addOperatorSheet(failing, { actor: admin, setId: s2.id, fighterId: fighter, key: crypto.randomUUID(), reason: '시트', bytes: webp(1536, 1024) }),
      /storage-unavailable/,
    );
    const open = (
      await sql.query("select count(*)::int as n from public.af_profile_sets where fighter_id = $1 and status = 'uploading' and expires_at > now()", [fighter])
    ).rows[0].n;
    assert.equal(open, 0);
    const front3 = webp(1024, 1536);
    front3[41] = 8;
    const manifest = JSON.stringify({
      version: PROFILE_SET_VERSION,
      front: { path: 'front.webp', bytes: front3.length, sha256: await sha256(front3), width: 1024, height: 1536 },
      face: { x: 400, y: 30, side: 250 },
    });
    assert.equal(
      (await call('af_profile_set_create', [owner, fighter, crypto.randomUUID(), manifest, await sha256(new TextEncoder().encode(manifest)), front3.length]))
        .status,
      'uploading',
    );
  } finally {
    await sql.close();
  }
});
