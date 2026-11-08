import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generation, webp } from './helpers/generation-database.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { VALIDATOR_VERSION, createHandler, sha256 } from '../api/handler.mjs';
import { PROFILE_SET_VALIDATOR_VERSION, PROFILE_SET_VERSION, profileSetKey } from '../api/profile-sets.mjs';
import { addOperatorFront, operatorFrontForm } from '../api/admin-profile-front.mjs';

// 운영자의 정면 (2026-11-03 — 사용자: "운영자가 올릴 수 있게 해줘"): a whole set for a fighter with no approved one.

/** A database with an operator and a registered fighter, and the calls the tests make. */
async function registered() {
  const base = await generation(),
    { sql, db, owner } = base;
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
  const derived = {
    card: { sha256: 'c'.repeat(64), bytes: 3, width: 135, height: 600, face: { x: 18, y: 0, side: 98 } },
    face: { sha256: 'f'.repeat(64), bytes: 3, size: 192 },
  };
  /** The validator's pass over a submitted set, with the arena's sheet when it has one. */
  const validate = async (id, sheet = false) => {
    const lease = await call('af_profile_set_claim', [id]);
    for (const name of ['card', 'face', ...(sheet ? ['sheet'] : [])]) await bucket.upload(profileSetKey(owner, id, name), new Uint8Array(3));
    await call('af_profile_set_finish', [
      id,
      lease.lease_token,
      lease.manifest_sha,
      true,
      { validatorVersion: PROFILE_SET_VALIDATOR_VERSION, stage: 'profile-set-full-decode', errors: [] },
      { ...derived, ...(sheet ? { sheet: { sha256: 'd'.repeat(64), bytes: 3, width: 1152, height: 768, cell: 384 } } : {}) },
    ]);
  };
  /** A set file for these pictures, as the kit writes one. */
  const setFile = async (front, sheet) =>
    JSON.stringify({
      version: PROFILE_SET_VERSION,
      front: { path: 'front.webp', bytes: front.length, sha256: await sha256(front), width: 1024, height: 1536 },
      face: { x: 400, y: 30, side: 250 },
      ...(sheet ? { expressions: { path: 'expressions.webp', bytes: sheet.length, sha256: await sha256(sheet), width: 1536, height: 1024 } } : {}),
    });
  return { ...base, admin, call, fighter, bucket, validate, setFile };
}

test("Postgres: an operator's front is a new set under the owner with its sheet; it waits for review; a retry answers the same set", async () => {
  const { sql, db, owner, objects, admin, call, fighter, validate, setFile } = await registered();
  try {
    const front = webp(1024, 1536),
      sheet = webp(1536, 1024),
      text = await setFile(front, sheet),
      key = crypto.randomUUID();
    const add = (more = {}) => addOperatorFront(db, { actor: admin, fighterId: fighter, key, reason: '정면 추가', text, front, expressions: sheet, ...more });
    const sets = async () => (await sql.query('select count(*)::int as n from public.af_profile_sets where fighter_id = $1', [fighter])).rows[0].n;
    // Refused before anything is made: pictures that are not the set file's, a sheet it names left out, an unknown fighter, a reason the
    // audit cannot keep, a set file the server does not read.
    const other = webp(1024, 1536);
    other[40] = 9;
    await assert.rejects(add({ front: other }), /asset-hash-or-size/);
    await assert.rejects(add({ expressions: null }), /assets-mismatch/);
    await assert.rejects(add({ text: await setFile(front, null) }), /assets-mismatch/);
    await assert.rejects(add({ front: webp(1536, 1024), text: await setFile(webp(1536, 1024), sheet) }), /webp-required/);
    const landscape = JSON.stringify({ ...JSON.parse(text), front: { ...JSON.parse(text).front, width: 1536, height: 1024 } });
    await assert.rejects(add({ text: landscape }), error => error.message === 'invalid-profile-set' && error.errors.some(e => e.code === 'FRONT_ORIENTATION'));
    await assert.rejects(add({ fighterId: crypto.randomUUID() }), /fighter-not-found/);
    await assert.rejects(add({ reason: ' ' }), /invalid-reason/);
    assert.equal(await sets(), 0);

    const made = await add();
    assert.equal(made.stage, 'queued');
    const row = (await sql.query('select * from public.af_profile_sets where id = $1', [made.profileSetId])).rows[0];
    assert.deepEqual([row.owner_id, row.fighter_id, row.based_on, row.manifest_text], [owner, fighter, null, text]);
    assert.deepEqual(objects.get(`ai-fighter-beta/${profileSetKey(owner, made.profileSetId, 'front')}`)?.bytes, front);
    assert.deepEqual(objects.get(`ai-fighter-beta/${profileSetKey(owner, made.profileSetId, 'expressions')}`)?.bytes, sheet);
    // The operator's id and reason are in the events only; the fighter has no current set until the operator approves this one.
    const events = async () => (await sql.query("select actor, data from public.af_profile_set_events where kind = 'admin-front'")).rows;
    assert.deepEqual(await events(), [{ actor: admin, data: { reason: '정면 추가' } }]);
    assert.equal((await sql.query('select profile_set_id from public.af_fighters where id = $1', [fighter])).rows[0].profile_set_id, null);
    // The same key again answers the same set, once; another set file under it is a conflict.
    assert.equal((await add()).profileSetId, made.profileSetId);
    assert.equal((await events()).length, 1);
    const sheet2 = webp(1536, 1024);
    sheet2[41] = 3;
    await assert.rejects(add({ text: await setFile(front, sheet2), expressions: sheet2 }), /idempotency-conflict/);
    // Validated and approved, it is his current set; the same key still answers it, and a new front for him is refused (a sheet goes
    // through profile-expressions, and only his owner replaces his front).
    await validate(made.profileSetId, true);
    await call('af_admin_profile_set_approve', [admin, made.profileSetId]);
    assert.equal((await sql.query('select profile_set_id from public.af_fighters where id = $1', [fighter])).rows[0].profile_set_id, made.profileSetId);
    assert.equal((await add()).stage, 'approved');
    await assert.rejects(add({ key: crypto.randomUUID() }), /approved-profile-set-exists/);
  } finally {
    await sql.close();
  }
});

test("Postgres: an operator's front is not approved over a set the owner had approved meanwhile; his keys stay his; a failed upload never holds his", async () => {
  const { sql, db, owner, admin, call, fighter, bucket, validate, setFile } = await registered();
  try {
    const front = webp(1024, 1536),
      text = await setFile(front, null);
    const made = await addOperatorFront(db, { actor: admin, fighterId: fighter, key: crypto.randomUUID(), reason: '정면', text, front, expressions: null });
    await validate(made.profileSetId);
    // The owner's own set, approved meanwhile: the operator's front is refused, and his stays.
    const own = webp(1024, 1536);
    own[40] = 7;
    const ownText = await setFile(own, null),
      ownKey = crypto.randomUUID();
    const set = await call('af_profile_set_create', [owner, fighter, ownKey, ownText, await sha256(new TextEncoder().encode(ownText)), own.length]);
    await bucket.upload(profileSetKey(owner, set.id, 'front'), own);
    await call('af_profile_set_submit', [owner, set.id]);
    await validate(set.id);
    await call('af_admin_profile_set_approve', [admin, set.id]);
    await assert.rejects(call('af_admin_profile_set_approve', [admin, made.profileSetId]), /review-conflict/);
    assert.equal((await sql.query('select profile_set_id from public.af_fighters where id = $1', [fighter])).rows[0].profile_set_id, set.id);
    // A key the owner used is his: the operator's call under it is a conflict, never his set.
    await assert.rejects(
      addOperatorFront(db, { actor: admin, fighterId: fighter, key: ownKey, reason: '정면', text: ownText, front: own, expressions: null }),
      /idempotency-conflict/,
    );
    // A store that fails after the set was made closes it: his own upload is not held. (He has no current set again after a rejection.)
    await call('af_admin_profile_set_reject', [admin, set.id, '다시']);
    const failing = {
      ...db,
      storage: {
        from: name => ({
          ...db.storage.from(name),
          upload: async () => ({ error: { message: 'storage down' } }),
          download: async () => ({ data: null, error: { message: 'missing' } }),
        }),
      },
    };
    await assert.rejects(
      addOperatorFront(failing, { actor: admin, fighterId: fighter, key: crypto.randomUUID(), reason: '정면', text, front, expressions: null }),
      /storage-unavailable/,
    );
    const open = (
      await sql.query("select count(*)::int as n from public.af_profile_sets where fighter_id = $1 and status = 'uploading' and expires_at > now()", [fighter])
    ).rows[0].n;
    assert.equal(open, 0);
    const mine = webp(1024, 1536);
    mine[42] = 5;
    const mineText = await setFile(mine, null);
    assert.equal(
      (await call('af_profile_set_create', [owner, fighter, crypto.randomUUID(), mineText, await sha256(new TextEncoder().encode(mineText)), mine.length]))
        .status,
      'uploading',
    );
  } finally {
    await sql.close();
  }
});

test("the operator's form: the set file byte for byte and its pictures, each part once, nothing else", async () => {
  const front = webp(1024, 1536),
    sheet = webp(1536, 1024),
    text = '{"version":"oddbout-profile-set-v1","é":1}';
  const request = parts => {
    const form = new FormData();
    for (const [name, value] of parts) form.append(name, new Blob([value]), `${name}.bin`);
    return new Request('https://example.test/admin', { method: 'POST', body: form });
  };
  const read = await operatorFrontForm(
    request([
      ['profile-set', new TextEncoder().encode(text)],
      ['front', front],
      ['expressions', sheet],
    ]),
  );
  assert.deepEqual([read.text, read.front, read.expressions], [text, front, sheet]);
  assert.equal(
    (
      await operatorFrontForm(
        request([
          ['profile-set', new TextEncoder().encode(text)],
          ['front', front],
        ]),
      )
    ).expressions,
    null,
  );
  for (const parts of [
    [['front', front]],
    [
      ['profile-set', new Uint8Array([1])],
      ['front', front],
      ['other', front],
    ],
    [
      ['profile-set', new Uint8Array([1])],
      ['front', front],
      ['front', front],
    ],
  ])
    await assert.rejects(operatorFrontForm(request(parts)), /invalid-body/);
  await assert.rejects(
    operatorFrontForm(
      request([
        ['profile-set', new Uint8Array([0xff])],
        ['front', front],
      ]),
    ),
    /invalid-utf8/,
  );
  await assert.rejects(
    operatorFrontForm(new Request('https://example.test/admin', { method: 'POST', body: front, headers: { 'content-type': 'image/webp' } })),
    /multipart-required/,
  );
});

test("the route: an operator's form for a fighter makes his set under the owner; a creator, a missing reason or a JSON body is refused", async () => {
  const { sql, db, other, fighter, setFile } = await registered();
  try {
    await sql.query('insert into af_admins(owner_id) values($1)', [other]);
    const handle = createHandler({ db }),
      front = webp(1024, 1536),
      sheet = webp(1536, 1024),
      text = await setFile(front, sheet),
      key = crypto.randomUUID();
    const send = async (token, headers = {}, body = null) => {
      const form = new FormData();
      form.append('profile-set', new Blob([text]), 'profile-set.json');
      form.append('front', new Blob([front]), 'front.webp');
      form.append('expressions', new Blob([sheet]), 'expressions.webp');
      const response = await handle(
        new Request(`http://localhost/ai-fighter/admin/fighters/${fighter}/profile-sets`, {
          method: 'POST',
          body: body ?? form,
          headers: { authorization: `Bearer ${token}`, 'idempotency-key': key, 'x-admin-reason': encodeURIComponent('정면 추가'), ...headers },
        }),
      );
      return { status: response.status, body: await response.json() };
    };
    assert.deepEqual([(await send('owner-token-0123456789')).status, (await send('owner-token-0123456789')).body.code], [403, 'admin-required']);
    assert.equal((await send('other-token-0123456789', { 'x-admin-reason': '' })).body.code, 'invalid-reason');
    assert.equal((await send('other-token-0123456789', { 'content-type': 'application/json' }, text)).body.code, 'multipart-required');
    const made = await send('other-token-0123456789');
    assert.deepEqual([made.status, made.body.ok, made.body.profileSet.stage, made.body.profileSet.fighterId], [200, true, 'queued', fighter]);
  } finally {
    await sql.close();
  }
});
