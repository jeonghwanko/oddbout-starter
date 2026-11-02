import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { migratedDatabase } from './helpers/fighter-database.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { createHandler, sha256, VALIDATOR_VERSION } from '../api/handler.mjs';
import { createAdminHandler } from '../api/admin.mjs';
import { PROFILE_SET_EXPRESSIONS, PROFILE_SET_SPEC, PROFILE_SET_VALIDATOR_VERSION, PROFILE_SET_VERSION, parseProfileSet, profileSetKey, rosterProfileSet }
  from '../api/profile-sets.mjs';
import { checkExpressionSheet, checkProfileSet } from '../worker/profile-set-check.mjs';

const set = (front = {}, face = {}) => ({ version: PROFILE_SET_VERSION,
  front: { path: 'front.webp', bytes: 1000, sha256: 'a'.repeat(64), width: 1024, height: 1536, ...front }, face: { x: 402, y: 108, side: 220, ...face } });

test('the set file names one WebP front painting within the size limits and a face square inside it', () => {
  assert.equal(parseProfileSet(JSON.stringify(set())).ok, true);
  const codes = value => { const result = parseProfileSet(typeof value === 'string' ? value : JSON.stringify(value)); return result.ok ? [] : result.errors.map(e => e.code); };
  assert.deepEqual(codes('{'), ['INVALID_JSON']);
  assert.deepEqual(codes({ ...set(), extra: 1 }), ['PROFILE_SET_KEYS']);
  assert.deepEqual(codes({ ...set(), version: 'v0' }), ['PROFILE_SET_VERSION']);
  assert.deepEqual(codes(set({ path: '../front.webp' })), ['FRONT_PATH']);
  assert.deepEqual(codes(set({ bytes: 4000001 })), ['FRONT_BYTES']);
  assert.deepEqual(codes(set({ width: 900, height: 900 })), ['FRONT_DIMENSIONS', 'FRONT_ORIENTATION']);
  assert.deepEqual(codes(set({ width: 2049 })), ['FRONT_DIMENSIONS', 'FRONT_ORIENTATION']);
  // A landscape painting cannot stand in a card (리뷰 P2-5).
  assert.deepEqual(codes(set({ width: 1536, height: 1024 }, { x: 0, y: 0 })), ['FRONT_ORIENTATION']);
  assert.deepEqual(codes(set({ width: 1024, height: 1024 })), ['FRONT_ORIENTATION']);
  assert.deepEqual(codes(set({ width: 511 }, { x: 0 })), ['FRONT_DIMENSIONS']);
  assert.deepEqual(codes(set({}, { x: 900, side: 200 })), ['FACE_OUTSIDE']);
  assert.deepEqual(codes(set({}, { side: 8 })), ['FACE_OUTSIDE']);
  // The spec carries the house colouring and its anchor (사용자 2026-10-31: 담백한 채색).
  assert.match(PROFILE_SET_SPEC.style.colouring, /flat clean cel colours with\none soft shadow tone/);
  assert.equal(PROFILE_SET_SPEC.style.anchor.url, 'https://oddbout.com/art/oddbout/style-anchor-front.webp');
});

const sheetFile = (more = {}) => ({ path: 'expressions.webp', bytes: 2000, sha256: 'e'.repeat(64), width: 1536, height: 1024, ...more });
test('the set file may name an expression sheet (2026-11-03): 1536 × 1024 WebP in the arena\'s cell order, its KO face last', () => {
  const codes = value => { const result = parseProfileSet(JSON.stringify(value)); return result.ok ? [] : result.errors.map(e => e.code); };
  assert.deepEqual(codes({ ...set(), expressions: sheetFile() }), []);
  assert.deepEqual(codes({ ...set(), expressions: sheetFile({ width: 1024 }) }), ['EXPRESSIONS_DIMENSIONS']);
  assert.deepEqual(codes({ ...set(), expressions: sheetFile({ path: 'front.webp' }) }), ['EXPRESSIONS_PATH']);
  assert.deepEqual(codes({ ...set(), expressions: sheetFile({ bytes: 4000001 }) }), ['EXPRESSIONS_BYTES']);
  assert.deepEqual(codes({ ...set(), expressions: sheetFile({ sha256: 'x' }) }), ['EXPRESSIONS_SHA256']);
  assert.deepEqual(codes({ ...set(), expressions: { ...sheetFile(), extra: 1 } }), ['EXPRESSIONS_KEYS']);
  assert.deepEqual(codes({ ...set(), expressions: null }), ['EXPRESSIONS_KEYS']);
  // The game's ARENA_FACE_EXPRESSIONS order (kaito_web/src/assets/ArenaFaceArtCatalog.ts): the KO card shows the sixth cell.
  assert.deepEqual(PROFILE_SET_EXPRESSIONS, ['default', 'hit', 'smug', 'danger', 'sideeye', 'ko']);
  assert.match(PROFILE_SET_SPEC.expressions.prompt, /6\. Knocked out: dizzy spiral eyes/);
  assert.match(PROFILE_SET_SPEC.expressions.prompt, /FIRST image is this fighter's approved front painting/);
  assert.match(PROFILE_SET_SPEC.build, /npm run fighter:profile-set/);
});

/**
 * An expression sheet (1536 × 1024 unless given): a bust in each cell, `empty` cells left clear, or on an opaque `background` (with one clear
 * pixel, so it keeps its alpha channel).
 */
async function sheetPicture({ empty = [], background = false, width = 1536, height = 1024 } = {}) {
  const rgba = Buffer.alloc(width * height * 4);
  if (background) { rgba.fill(255); rgba.set([0, 0, 0, 0], 0); }
  for (let cell = 0; cell < 6; cell++) {
    if (empty.includes(cell)) continue;
    const left = (cell % 3) * (width / 3), top = Math.floor(cell / 3) * (height / 2), margin = Math.floor(height / 12);
    for (let y = top + margin; y < top + height / 2; y++) for (let x = left + margin; x < left + width / 4; x++) rgba.set([90, 120, 200, 255], (y * width + x) * 4);
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toBuffer();
}

test('the validator decodes the sheet and makes the arena\'s 1152 × 768 copy; no alpha, a wrong size, no clear pixels or an empty cell fail', async () => {
  const good = await checkExpressionSheet(await sheetPicture());
  assert.equal(good.ok, true, JSON.stringify(good.errors));
  assert.deepEqual(good.derived, { width: 1152, height: 768, cell: 384 });
  const meta = await sharp(good.sheet).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height, meta.hasAlpha], ['webp', 1152, 768, true]);
  const codes = async bytes => { const result = await checkExpressionSheet(bytes); return result.ok ? [] : result.errors.map(e => e.code); };
  assert.deepEqual(await codes(await sharp({ create: { width: 1536, height: 1024, channels: 3, background: '#ffffff' } }).webp().toBuffer()), ['EXPRESSIONS_ENCODING']);
  assert.deepEqual(await codes(await sheetPicture({ width: 1152, height: 768 })), ['EXPRESSIONS_DIMENSIONS']);
  assert.deepEqual(await codes(await sheetPicture({ background: true })), ['EXPRESSIONS_BACKGROUND']);
  assert.deepEqual(await codes(await sheetPicture({ empty: [5] })), ['EXPRESSIONS_EMPTY_CELL'], 'a sheet without its KO face');
  assert.deepEqual(await codes(Buffer.from('not an image at all')), ['EXPRESSIONS_ENCODING']);
});

/**
 * A transparent painting (1024×1536 unless given): a body and a head, optionally on a background (with one clear pixel, so it keeps its
 * alpha channel), or one wide shape (`wide`).
 */
async function painting({ background = false, wide = false, width = 1024, height = 1536 } = {}) {
  const rgba = Buffer.alloc(width * height * 4);
  const paint = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) rgba.set([200, 120, 90, 255], (y * width + x) * 4); };
  if (background) { paint(0, 0, width - 1, height - 1); rgba.set([0, 0, 0, 0], (700 * width + 900) * 4); }
  if (wide) paint(10, 300, 1009, 1249); else if (width === 1024) { paint(412, 110, 612, 310); paint(362, 300, 662, 1450); } else paint(400, 100, 1100, 1000);
  return sharp(rgba, { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toBuffer();
}

test('the validator decodes the painting and makes a 600-px card and a 192-px face; a background or a misplaced face fails', async () => {
  const good = await checkProfileSet(await painting(), set());
  assert.equal(good.ok, true, JSON.stringify(good.errors));
  const card = await sharp(good.card).metadata(), face = await sharp(good.face).metadata();
  assert.deepEqual([card.format, card.height, card.width, card.hasAlpha], ['webp', 600, good.derived.card.width, true]);
  assert.deepEqual([face.width, face.height], [192, 192]);
  // The figure (301 × 1341) scaled to 600 high; the face square follows it into the card's pixels.
  assert.equal(good.derived.card.width, Math.round(301 * 600 / 1341));
  assert.deepEqual(good.derived.card.face, { x: Math.round(40 * 600 / 1341), y: 0, side: Math.round(220 * 600 / 1341) });
  const codes = async (bytes, value) => { const result = await checkProfileSet(bytes, value); return result.ok ? [] : result.errors.map(e => e.code); };
  assert.deepEqual(await codes(await painting({ background: true }), set()), ['FRONT_BACKGROUND']);
  const opaque = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#c87850' } }).webp().toBuffer();
  assert.deepEqual(await codes(opaque, set()), ['FRONT_ENCODING'], 'no alpha channel');
  assert.deepEqual(await codes(await painting(), set({}, { x: 100 })), ['FACE_OUTSIDE_FIGURE']);
  assert.deepEqual(await codes(await painting(), set({}, { side: 100 })), ['FACE_SIZE']);
  assert.deepEqual(await codes(await painting(), set({}, { y: 700 })), ['FACE_POSITION']);
  assert.deepEqual(await codes(await painting(), set({ width: 1000 })), ['FRONT_DIMENSIONS']);
  // Wider than tall: the card would be wider than its slot (리뷰 P2-5).
  assert.deepEqual(await codes(await painting({ wide: true }), set({}, { x: 400, y: 300, side: 150 })), ['FIGURE_WIDTH']);
  assert.deepEqual(await codes(await painting({ width: 1536, height: 1024 }), set({ width: 1536, height: 1024 }, { x: 600, y: 100, side: 200 })), ['FRONT_ORIENTATION']);
  assert.deepEqual(await codes(Buffer.from('not an image at all'), set()), ['FRONT_ENCODING']);
});

test('Postgres: upload → validation → review → approval names the set on the roster; a new approval supersedes; the entry gate', async () => {
  const db = await migratedDatabase();
  try {
    const owner = crypto.randomUUID(), admin = crypto.randomUUID(), other = crypto.randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6)', [owner, 'o@example.com', admin, 'a@example.com', other, 'x@example.com']);
    await db.query('insert into public.af_creators(owner_id) values($1),($2)', [owner, other]);
    await db.query('insert into af_admins(owner_id) values($1)', [admin]);
    const value = result => result.rows[0].value;
    // A registered fighter, the way the package route makes one.
    const text = JSON.stringify(example), sha = await sha256(new TextEncoder().encode(text)), bytes = example.assets.reduce((sum, a) => sum + a.bytes, 0);
    const submission = value(await db.query('select to_jsonb(public.af_create_submission($1,$2,$3,$4,$5)) as value', [owner, crypto.randomUUID(), text, sha, bytes]));
    for (const a of example.assets) await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${submission.id}/${a.id}.webp`, { size: a.bytes }]);
    await db.query('select public.af_submit($1,$2)', [owner, submission.id]);
    const leased = value(await db.query('select to_jsonb(public.af_claim($1)) as value', [submission.id]));
    const fighter = value(await db.query('select to_jsonb(public.af_finish($1,$2,$3,true,$4)) as value',
      [submission.id, leased.lease_token, sha, { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: [] }])).fighter_id;

    const create = async (key = crypto.randomUUID(), who = owner, file = set()) => {
      const body = JSON.stringify(file);
      return value(await db.query('select to_jsonb(public.af_profile_set_create($1,$2,$3,$4,$5,$6)) as value',
        [who, fighter, key, body, await sha256(new TextEncoder().encode(body)), file.front.bytes]));
    };
    await assert.rejects(create(crypto.randomUUID(), other), /fighter-not-found/);
    const key = crypto.randomUUID(), first = await create(key);
    assert.equal(first.status, 'uploading');
    assert.equal((await create(key)).id, first.id); // The same key and bytes answer the same set.
    await assert.rejects(create(key, owner, set({ bytes: 1001 })), /idempotency-conflict/);
    await assert.rejects(create(), /open-profile-set-exists/);
    await assert.rejects(db.query('select public.af_profile_set_submit($1,$2)', [owner, first.id]), /assets-incomplete/);
    await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', profileSetKey(owner, first.id, 'front'), { size: 1000 }]);
    assert.equal(value(await db.query('select to_jsonb(public.af_profile_set_submit($1,$2)) as value', [owner, first.id])).status, 'queued');

    const claim = async id => value(await db.query('select to_jsonb(public.af_profile_set_claim($1)) as value', [id]));
    const derived = { card: { sha256: 'c'.repeat(64), bytes: 300, width: 135, height: 600, face: { x: 18, y: 0, side: 98 } },
      face: { sha256: 'f'.repeat(64), bytes: 200, size: 192 } };
    const finish = (row, passed = true, more = {}) => db.query('select to_jsonb(public.af_profile_set_finish($1,$2,$3,$4,$5,$6)) as value',
      [row.id, row.lease_token, row.manifest_sha, passed, { validatorVersion: PROFILE_SET_VALIDATOR_VERSION, stage: 'profile-set-full-decode', errors: [], ...more },
        passed ? derived : null]).then(value);
    const store = async row => {
      await db.query('insert into storage.objects values($1,$2,$3),($1,$4,$5)', ['ai-fighter-beta', profileSetKey(owner, row.id, 'card'), { size: 300 },
        profileSetKey(owner, row.id, 'face'), { size: 200 }]);
    };
    const validating = await claim(first.id);
    assert.equal(validating.status, 'validating');
    await assert.rejects(finish({ ...validating, lease_token: crypto.randomUUID() }), /stale-validation/);
    await assert.rejects(finish(validating), /validation-incomplete/, 'the derived files must be stored');
    await store(validating);
    await assert.rejects(finish(validating, true, { validatorVersion: 'v0' }), /validator-version/);
    assert.equal((await finish(validating)).status, 'review');
    assert.equal((await finish(validating)).status, 'review', 'a repeated finish answers the same');

    const roster = async () => (await db.query('select profile_set from public.af_roster_entries where id=$1', [fighter])).rows[0].profile_set;
    assert.equal(await roster(), null, 'review is not on the roster');
    const approve = id => db.query('select public.af_admin_profile_set_approve($1,$2) as value', [admin, id]).then(value);
    await assert.rejects(db.query('select public.af_admin_profile_set_approve($1,$2)', [owner, first.id]), /admin-required/);
    const list = (await db.query('select public.af_admin_profile_sets($1,$2) as value', [admin, 'review'])).rows[0].value;
    assert.deepEqual(list.map(item => [item.id, item.name, item.email]), [[first.id, example.profile.name, 'o@example.com']]);
    assert.equal(list[0].previewKey, `${owner}/${submission.id}/${example.clips.idle.assetId}.webp`);
    assert.equal((await approve(first.id)).status, 'approved');
    assert.deepEqual(await roster(), { id: first.id, derived });
    assert.equal((await approve(first.id)).status, 'approved', 'approving the current set again answers the same');

    const second = await create();
    await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', profileSetKey(owner, second.id, 'front'), { size: 1000 }]);
    await db.query('select public.af_profile_set_submit($1,$2)', [owner, second.id]);
    const secondLease = await claim(second.id);
    await store(secondLease);
    await finish(secondLease);
    await approve(second.id);
    const statuses = (await db.query('select id, status from public.af_profile_sets order by created_at')).rows.map(row => row.status);
    assert.deepEqual(statuses, ['superseded', 'approved']);
    assert.equal((await roster()).id, second.id);
    const rejected = (await db.query('select public.af_admin_profile_set_reject($1,$2,$3) as value', [admin, second.id, ' 화풍이 다르다 '])).rows[0].value;
    assert.deepEqual([rejected.status, rejected.previous], ['rejected', 'approved']);
    assert.equal(await roster(), null, 'rejecting the current set takes it off the roster');
    assert.equal((await db.query('select reason from public.af_profile_sets where id=$1', [second.id])).rows[0].reason, '화풍이 다르다');
    await assert.rejects(db.query('select public.af_admin_profile_set_reject($1,$2,$3)', [admin, first.id, 'x'.repeat(301)]), /invalid-review/);

    // A failed check is a verdict: rejected with the validator's errors.
    const third = await create();
    await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', profileSetKey(owner, third.id, 'front'), { size: 1000 }]);
    await db.query('select public.af_profile_set_submit($1,$2)', [owner, third.id]);
    assert.equal((await finish(await claim(third.id), false, { stage: 'profile-set-check', errors: [{ code: 'FRONT_BACKGROUND', path: '/front' }] })).status, 'rejected');

    // The entry gate is off by default; on, a fighter registered after the switch enters only with a validated set.
    const enter = () => db.query('select public.af_enter_fighter($1,$2,$3,$4) as value', [owner, fighter, sha, ['idle']]);
    await db.exec("update public.af_settings set profile_set_required_after = now() - interval '1 day'");
    await db.exec("update public.af_profile_sets set status = 'rejected' where status <> 'rejected'");
    await assert.rejects(enter(), /profile-set-required/);
    await db.query("update public.af_profile_sets set status = 'review' where id = $1", [third.id]);
    assert.equal(value(await enter()).stage, 'entered');

    // Owners read only their own sets.
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${other}';`);
    assert.equal((await db.query('select id from public.af_profile_sets')).rows.length, 0);
    await assert.rejects(db.query('select public.af_profile_set_claim(null)'), /permission denied/);
    await db.exec('reset role');
  } finally { await db.close(); }
});

test('Postgres (2026-11-03): a set with an expression sheet needs its upload, a 0.2.0 verdict and the stored arena sheet; the roster and cleanup carry it', async () => {
  const db = await migratedDatabase();
  try {
    const owner = crypto.randomUUID(), admin = crypto.randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [owner, 'o@example.com', admin, 'a@example.com']);
    await db.query('insert into public.af_creators(owner_id) values($1)', [owner]);
    await db.query('insert into af_admins(owner_id) values($1)', [admin]);
    const value = result => result.rows[0].value;
    const text = JSON.stringify(example), sha = await sha256(new TextEncoder().encode(text)), bytes = example.assets.reduce((sum, a) => sum + a.bytes, 0);
    const submission = value(await db.query('select to_jsonb(public.af_create_submission($1,$2,$3,$4,$5)) as value', [owner, crypto.randomUUID(), text, sha, bytes]));
    for (const a of example.assets) await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${submission.id}/${a.id}.webp`, { size: a.bytes }]);
    await db.query('select public.af_submit($1,$2)', [owner, submission.id]);
    const leased = value(await db.query('select to_jsonb(public.af_claim($1)) as value', [submission.id]));
    const fighter = value(await db.query('select to_jsonb(public.af_finish($1,$2,$3,true,$4)) as value',
      [submission.id, leased.lease_token, sha, { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: [] }])).fighter_id;
    const object = (id, name, size) => db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', profileSetKey(owner, id, name), { size }]);
    const created = async (file, sheetHash) => {
      const body = JSON.stringify(file);
      const row = value(await db.query('select to_jsonb(public.af_profile_set_create($1,$2,$3,$4,$5,$6)) as value',
        [owner, fighter, crypto.randomUUID(), body, await sha256(new TextEncoder().encode(body)), file.front.bytes]));
      return { row, derived: { card: { sha256: 'c'.repeat(64), bytes: 300, width: 135, height: 600, face: { x: 18, y: 0, side: 98 } },
        face: { sha256: 'f'.repeat(64), bytes: 200, size: 192 }, ...(sheetHash ? { sheet: { sha256: sheetHash, bytes: 500, width: 1152, height: 768, cell: 384 } } : {}) } };
    };
    const claim = async id => value(await db.query('select to_jsonb(public.af_profile_set_claim($1)) as value', [id]));
    const finish = (row, derived, version = PROFILE_SET_VALIDATOR_VERSION) => db.query('select to_jsonb(public.af_profile_set_finish($1,$2,$3,true,$4,$5)) as value',
      [row.id, row.lease_token, row.manifest_sha, { validatorVersion: version, stage: 'profile-set-full-decode', errors: [] }, derived]).then(value);

    const { row: first, derived } = await created({ ...set(), expressions: sheetFile() }, 'd'.repeat(64));
    await object(first.id, 'front', 1000);
    await assert.rejects(db.query('select public.af_profile_set_submit($1,$2)', [owner, first.id]), /assets-incomplete/, 'the sheet must be uploaded too');
    await object(first.id, 'expressions', 2000);
    assert.equal(value(await db.query('select to_jsonb(public.af_profile_set_submit($1,$2)) as value', [owner, first.id])).status, 'queued');
    const lease = await claim(first.id);
    await object(first.id, 'card', 300); await object(first.id, 'face', 200);
    await assert.rejects(finish(lease, derived, 'oddbout-profile-set-validator-0.1.0'), /validator-version/, 'a validator from before the sheet cannot pass it');
    await assert.rejects(finish(lease, { card: derived.card, face: derived.face }), /validation-incomplete/, 'the arena sheet is required');
    await assert.rejects(finish(lease, derived), /validation-incomplete/, 'the arena sheet must be stored');
    await assert.rejects(finish(lease, { ...derived, sheet: { ...derived.sheet, width: 1536 } }), /validation-incomplete/);
    const finishWith = (row, derivedFiles, more) => db.query('select to_jsonb(public.af_profile_set_finish($1,$2,$3,true,$4,$5)) as value',
      [row.id, row.lease_token, row.manifest_sha, { validatorVersion: PROFILE_SET_VALIDATOR_VERSION, stage: 'profile-set-full-decode', errors: [], ...more },
        derivedFiles]).then(value);
    await assert.rejects(finishWith(lease, { card: derived.card, face: derived.face }, { sheetErrors: [] }), /validation-incomplete/);
    await object(first.id, 'sheet', 500);
    assert.equal((await finish(lease, derived)).status, 'review');
    await db.query('select public.af_admin_profile_set_approve($1,$2)', [admin, first.id]);
    assert.deepEqual((await db.query('select profile_set from public.af_roster_entries where id=$1', [fighter])).rows[0].profile_set, { id: first.id, derived });

    // A sheet the validator left out (its reasons in sheetErrors): the set passes without it, the front's files as always.
    const { row: dropped } = await created({ ...set(), expressions: sheetFile() }, null);
    await object(dropped.id, 'front', 1000); await object(dropped.id, 'expressions', 2000);
    await db.query('select public.af_profile_set_submit($1,$2)', [owner, dropped.id]);
    const droppedLease = await claim(dropped.id);
    await object(dropped.id, 'card', 300); await object(dropped.id, 'face', 200);
    const passed = await finishWith(droppedLease, { card: derived.card, face: derived.face }, { sheetErrors: [{ code: 'EXPRESSIONS_EMPTY_CELL', path: '/expressions' }] });
    assert.deepEqual([passed.status, 'sheet' in passed.derived], ['review', false]);
    await db.query("update public.af_profile_sets set status = 'rejected' where id = $1", [dropped.id]);

    // A set without a sheet still passes from a 0.1.0 validator (deployed before this one), never with a sheet it was not sent.
    const { row: second, derived: plain } = await created(set(), null);
    await object(second.id, 'front', 1000);
    await db.query('select public.af_profile_set_submit($1,$2)', [owner, second.id]);
    const secondLease = await claim(second.id);
    await object(second.id, 'card', 300); await object(second.id, 'face', 200); await object(second.id, 'sheet', 500);
    await assert.rejects(finish(secondLease, { ...plain, sheet: derived.sheet }), /validation-incomplete/);
    assert.equal((await finish(secondLease, plain, 'oddbout-profile-set-validator-0.1.0')).status, 'review');
    await db.query('select public.af_admin_profile_set_approve($1,$2)', [admin, second.id]);
    // The superseded set's sheet leaves the public bucket with it; the card and face the new set shares stay.
    assert.deepEqual(value(await db.query('select public.af_profile_set_stale_public($1) as value', [fighter])), [{ id: first.id, shas: ['d'.repeat(64)] }]);
  } finally { await db.close(); }
});

test('the roster names an approved set by this project\'s public bucket only', () => {
  const db = { storage: { from: bucket => ({ getPublicUrl: path => ({ data: { publicUrl: `https://ref.supabase.co/storage/v1/object/public/${bucket}/${path}` } }) }) } };
  const fighter = crypto.randomUUID(), id = crypto.randomUUID();
  const derived = { card: { sha256: 'c'.repeat(64), bytes: 300, width: 135, height: 600, face: { x: 18, y: 0, side: 98 } }, face: { sha256: 'f'.repeat(64), bytes: 200, size: 192 } };
  assert.deepEqual(rosterProfileSet(db, { id: fighter, profile_set: { id, derived } }), { profileSet: { id,
    card: { url: `https://ref.supabase.co/storage/v1/object/public/af-profile-sets/${fighter}/${'c'.repeat(64)}.webp`, width: 135, height: 600, face: { x: 18, y: 0, side: 98 } },
    face: { url: `https://ref.supabase.co/storage/v1/object/public/af-profile-sets/${fighter}/${'f'.repeat(64)}.webp`, size: 192 } } });
  assert.deepEqual(rosterProfileSet(db, { id: fighter, profile_set: null }), {});
  assert.deepEqual(rosterProfileSet(db, { id: fighter, profile_set: { id, derived: { ...derived, card: { ...derived.card, sha256: '../x' } } } }), {});
  assert.deepEqual(rosterProfileSet({}, { id: fighter, profile_set: { id, derived } }), {});
  // A card wider than its slot is not named (리뷰 P2-5).
  assert.deepEqual(rosterProfileSet(db, { id: fighter, profile_set: { id, derived: { ...derived, card: { ...derived.card, width: 601 } } } }), {});
  // His expression sheet (2026-11-03) as the arena reads it; a sheet that does not read leaves his card and face.
  const sheet = { sha256: 'd'.repeat(64), bytes: 500, width: 1152, height: 768, cell: 384 };
  assert.deepEqual(rosterProfileSet(db, { id: fighter, profile_set: { id, derived: { ...derived, sheet } } }).profileSet?.expressions,
    { url: `https://ref.supabase.co/storage/v1/object/public/af-profile-sets/${fighter}/${'d'.repeat(64)}.webp`, width: 1152, height: 768, cell: 384 });
  for (const bad of [{ ...sheet, cell: 512 }, { ...sheet, width: 1536 }, { ...sheet, sha256: '../x' }, 'sheet']) {
    const named = rosterProfileSet(db, { id: fighter, profile_set: { id, derived: { ...derived, sheet: bad } } });
    assert.equal(named.profileSet?.card.width, 135); assert.equal('expressions' in (named.profileSet ?? {}), false);
  }
});

test('the owner routes: a bad set file is 422 before the database; the spec names the profile set', async () => {
  const rpcs = [];
  const handle = createHandler({ db: { auth: { getClaims: async () => ({ data: { claims: { sub: crypto.randomUUID(), is_anonymous: false, role: 'authenticated' } }, error: null }) },
    rpc: async (name, args) => { rpcs.push(name); return { data: name === 'af_authorize' ? true : null, error: null }; } } });
  const post = body => handle(new Request(`https://test/ai-fighter/fighters/${crypto.randomUUID()}/profile-sets`, { method: 'POST',
    headers: { authorization: 'Bearer signed-user-token-for-test', 'idempotency-key': crypto.randomUUID(), 'content-type': 'application/json' }, body }));
  const bad = await post(JSON.stringify(set({ width: 100 })));
  assert.equal(bad.status, 422); assert.equal((await bad.json()).code, 'invalid-profile-set');
  assert.deepEqual(rpcs, ['af_authorize']);
  assert.equal((await handle(new Request(`https://test/ai-fighter/fighters/${crypto.randomUUID()}/profile-sets`, { method: 'OPTIONS' }))).headers.get('access-control-allow-methods'), 'GET, POST, PUT, OPTIONS');
  const spec = await (await handle(new Request('https://test/ai-fighter/spec'))).json();
  assert.equal(spec.data.registration.profileSet, 'v1'); assert.equal(spec.data.profileSet.version, PROFILE_SET_VERSION);
});

test('the operator\'s review list and approval: the shape admin.html reads, files copied to the public bucket before the roster names them', async () => {
  const actor = crypto.randomUUID(), owner = crypto.randomUUID(), fighter = crypto.randomUUID(), id = crypto.randomUUID();
  const card = Buffer.from('RIFF0000WEBPcard'), face = Buffer.from('RIFF0000WEBPface'), sheet = Buffer.from('RIFF0000WEBPsheet');
  const derived = { card: { sha256: await sha256(card), bytes: card.length, width: 135, height: 600, face: { x: 18, y: 0, side: 98 } },
    face: { sha256: await sha256(face), bytes: face.length, size: 192 }, sheet: { sha256: await sha256(sheet), bytes: sheet.length, width: 1152, height: 768, cell: 384 } };
  const objects = new Map([[`ai-fighter-beta/${profileSetKey(owner, id, 'card')}`, card], [`ai-fighter-beta/${profileSetKey(owner, id, 'face')}`, face],
    [`ai-fighter-beta/${profileSetKey(owner, id, 'sheet')}`, sheet]]);
  const calls = [], cleanupFailures = [], unpublished = [], cache = new Map();
  let status = 'review', removeFailures = 0;
  // What af_profile_set_stale_public lists: an older approved set's copy after an approval, this set's copies after its rejection.
  const old = { id: crypto.randomUUID(), sha: 'b'.repeat(64) };
  objects.set(`af-profile-sets/${fighter}/${old.sha}.webp`, Buffer.from('old'));
  const db = { auth: { getClaims: async () => ({ data: { claims: { sub: actor, is_anonymous: false, role: 'authenticated' } }, error: null }) },
    rpc: async (name, args) => {
      calls.push(name);
      if (name === 'af_admin_account') return { data: true, error: null };
      if (name === 'af_admin_profile_sets') return { data: [{ id, fighterId: fighter, ownerId: owner, name: 'Blue', email: 'o@example.com', status: 'review',
        manifest: set(), derived, previewKey: `${owner}/sub/idle.webp`, submittedAt: '2026-10-31T00:00:00Z', current: false, entered: true }], error: null };
      if (name === 'af_admin_profile_set') return { data: { id, fighterId: fighter, ownerId: owner, status, derived }, error: null };
      if (name === 'af_admin_profile_set_approve') { status = 'approved'; return { data: { id, fighterId: fighter, status, derived }, error: null }; }
      if (name === 'af_admin_profile_set_reject') { const previous = status; status = 'rejected'; return { data: { id, fighterId: fighter, status, previous, derived }, error: null }; }
      if (name === 'af_profile_set_stale_public') return { data: status === 'rejected' ? [{ id, shas: [derived.card.sha256, derived.face.sha256] }]
        : unpublished.includes(old.id) ? [] : [{ id: old.id, shas: [old.sha] }], error: null };
      if (name === 'af_profile_set_unpublished') { unpublished.push(...args.p_ids); return { data: args.p_ids.length, error: null }; }
      if (name === 'af_profile_set_cleanup_failed') { cleanupFailures.push(args); return { data: null, error: null }; }
      throw new Error(name);
    },
    storage: { from: bucket => ({
      createSignedUrls: async paths => ({ data: paths.map(path => ({ path, error: path.includes('idle') ? null : null, signedUrl: `https://ref.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=t` })) }),
      download: async path => { const bytes = objects.get(`${bucket}/${path}`); return bytes ? { data: new Blob([bytes]), error: null } : { data: null, error: { message: 'missing' } }; },
      upload: async (path, bytes, options) => { if (objects.has(`${bucket}/${path}`)) return { error: { message: 'exists' } };
        objects.set(`${bucket}/${path}`, Buffer.from(bytes)); cache.set(`${bucket}/${path}`, options.cacheControl); return { error: null }; },
      // Storage answers a failure as { error }, it does not throw (리뷰 P2-3).
      remove: async paths => { if (removeFailures > 0) { removeFailures--; return { data: null, error: { message: 'storage down' } }; }
        for (const path of paths) objects.delete(`${bucket}/${path}`); return { data: [], error: null }; } }) } };
  const handle = createAdminHandler({ db });
  const ask = (path, init = {}) => handle(new Request(`https://test/ai-fighter/${path}`, { ...init, headers: { authorization: 'Bearer signed-user-token-for-test', ...init.headers } }),
    path.split('?')[0].split('/'));
  const listed = await (await ask('admin/profile-sets')).json();
  assert.deepEqual(Object.keys(listed), ['ok', 'profileSets']);
  const item = listed.profileSets[0];
  assert.deepEqual({ ...item, front: { ...item.front, url: typeof item.front.url } }, { id, fighterId: fighter, fighterName: 'Blue', ownerEmail: 'o@example.com',
    status: 'review', submittedAt: '2026-10-31T00:00:00Z', front: { url: 'string', width: 1024, height: 1536 },
    card: { url: `https://ref.supabase.co/storage/v1/object/sign/ai-fighter-beta/${profileSetKey(owner, id, 'card')}?token=t`, width: 135, height: 600, face: { x: 18, y: 0, side: 98 } },
    face: { url: `https://ref.supabase.co/storage/v1/object/sign/ai-fighter-beta/${profileSetKey(owner, id, 'face')}?token=t`, size: 192 },
    expressions: { url: `https://ref.supabase.co/storage/v1/object/sign/ai-fighter-beta/${profileSetKey(owner, id, 'sheet')}?token=t`, width: 1152, height: 768, cell: 384 },
    previewUrl: `https://ref.supabase.co/storage/v1/object/sign/ai-fighter-beta/${owner}/sub/idle.webp?token=t`,
    reason: null, current: false, entered: true, validatedAt: null, reviewedAt: null });
  assert.equal((await ask('admin/profile-sets?status=open')).status, 400);
  const approved = await ask(`admin/profile-sets/${id}/approve`, { method: 'POST' });
  assert.deepEqual(await approved.json(), { ok: true, status: 'approved' });
  assert.ok(objects.has(`af-profile-sets/${fighter}/${derived.card.sha256}.webp`)); assert.ok(objects.has(`af-profile-sets/${fighter}/${derived.face.sha256}.webp`));
  assert.ok(objects.has(`af-profile-sets/${fighter}/${derived.sheet.sha256}.webp`), 'his expression sheet is published with them');
  // A day, not a year: a public copy leaves when its set does (리뷰 P2-3).
  assert.equal(cache.get(`af-profile-sets/${fighter}/${derived.card.sha256}.webp`), '86400');
  assert.ok(calls.indexOf('af_admin_profile_set_approve') > calls.indexOf('af_admin_profile_set'));
  // The set it replaced leaves the public bucket once the approval stands (리뷰 P2-2).
  assert.equal(objects.has(`af-profile-sets/${fighter}/${old.sha}.webp`), false); assert.deepEqual(unpublished, [old.id]);
  assert.ok(calls.indexOf('af_profile_set_stale_public') > calls.indexOf('af_admin_profile_set_approve'));
  assert.equal((await ask(`admin/profile-sets/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason: '' }) })).status, 400);
  const rejected = await ask(`admin/profile-sets/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason: '화풍이 다르다' }) });
  assert.deepEqual(await rejected.json(), { ok: true, status: 'rejected' });
  assert.equal(objects.has(`af-profile-sets/${fighter}/${derived.card.sha256}.webp`), false, 'a rejected current set leaves the public bucket');
  // A Storage error is retried once; a second one is recorded and the set stays listed for the next cleanup (리뷰 P2-3).
  status = 'approved'; removeFailures = 1; objects.set(`af-profile-sets/${fighter}/${derived.card.sha256}.webp`, card);
  await ask(`admin/profile-sets/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason: '다시' }) });
  assert.equal(objects.has(`af-profile-sets/${fighter}/${derived.card.sha256}.webp`), false); assert.deepEqual(cleanupFailures, []);
  status = 'approved'; removeFailures = 2; objects.set(`af-profile-sets/${fighter}/${derived.card.sha256}.webp`, card);
  const unpublishedBefore = unpublished.length;
  assert.deepEqual(await (await ask(`admin/profile-sets/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason: '또' }) })).json(), { ok: true, status: 'rejected' });
  assert.equal(objects.has(`af-profile-sets/${fighter}/${derived.card.sha256}.webp`), true);
  assert.equal(cleanupFailures.length, 1); assert.equal(cleanupFailures[0].p_error, 'storage down'); assert.equal(unpublished.length, unpublishedBefore);
  // A stored file that no longer matches the validator's hash is never published.
  status = 'review'; objects.set(`ai-fighter-beta/${profileSetKey(owner, id, 'card')}`, Buffer.from('RIFF0000WEBPchanged'));
  assert.equal((await ask(`admin/profile-sets/${id}/approve`, { method: 'POST' })).status, 409);
});

test('Postgres (리뷰 P1-1·P2-2·P2-7): deletion and removal withdraw the sets; stale public copies are listed once; a deleted fighter\'s set rejects', async () => {
  const db = await migratedDatabase();
  try {
    const owner = crypto.randomUUID(), admin = crypto.randomUUID(), session = crypto.randomUUID(), client = crypto.randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [owner, 'o@example.com', admin, 'a@example.com']);
    await db.query('insert into auth.oauth_clients(id) values($1)', [client]);
    await db.query('insert into auth.sessions(id,user_id,oauth_client_id,scopes) values($1,$2,$3,$4)', [session, owner, client, 'openid email profile']);
    await db.query('insert into auth.oauth_consents(user_id,client_id,scopes) values($1,$2,$3)', [owner, client, 'openid email profile']);
    await db.query('insert into public.af_creators(owner_id) values($1)', [owner]);
    await db.query('insert into af_admins(owner_id) values($1)', [admin]);
    const value = result => result.rows[0].value;
    const text = JSON.stringify(example), sha = await sha256(new TextEncoder().encode(text)), bytes = example.assets.reduce((sum, a) => sum + a.bytes, 0);
    const register = async () => {
      const s = value(await db.query('select to_jsonb(public.af_create_submission($1,$2,$3,$4,$5)) as value', [owner, crypto.randomUUID(), text, sha, bytes]));
      for (const a of example.assets) await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${s.id}/${a.id}.webp`, { size: a.bytes }]);
      await db.query('select public.af_submit($1,$2)', [owner, s.id]);
      const lease = value(await db.query('select to_jsonb(public.af_claim($1)) as value', [s.id]));
      return value(await db.query('select to_jsonb(public.af_finish($1,$2,$3,true,$4)) as value',
        [s.id, lease.lease_token, sha, { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: [] }])).fighter_id;
    };
    const hex = c => c.repeat(64);
    /** A set of `fighter` taken through validation to review, with these derived hashes. */
    const reviewed = async (fighter, card, face) => {
      const body = JSON.stringify(set());
      const p = value(await db.query('select to_jsonb(public.af_profile_set_create($1,$2,$3,$4,$5,$6)) as value',
        [owner, fighter, crypto.randomUUID(), body, await sha256(new TextEncoder().encode(body)), 1000]));
      await db.query('insert into storage.objects values($1,$2,$3),($1,$4,$5),($1,$6,$7)', ['ai-fighter-beta', profileSetKey(owner, p.id, 'front'), { size: 1000 },
        profileSetKey(owner, p.id, 'card'), { size: 300 }, profileSetKey(owner, p.id, 'face'), { size: 200 }]);
      await db.query('select public.af_profile_set_submit($1,$2)', [owner, p.id]);
      const lease = value(await db.query('select to_jsonb(public.af_profile_set_claim($1)) as value', [p.id]));
      await db.query('select public.af_profile_set_finish($1,$2,$3,true,$4,$5)', [p.id, lease.lease_token, p.manifest_sha,
        { validatorVersion: PROFILE_SET_VALIDATOR_VERSION, stage: 'profile-set-full-decode', errors: [] },
        { card: { sha256: card, bytes: 300, width: 135, height: 600, face: { x: 18, y: 0, side: 98 } }, face: { sha256: face, bytes: 200, size: 192 } }]);
      return p.id;
    };
    const approve = id => db.query('select public.af_admin_profile_set_approve($1,$2) as value', [admin, id]).then(value);
    const stale = fighter => db.query('select public.af_profile_set_stale_public($1) as value', [fighter]).then(value);
    const status = id => db.query('select status from public.af_profile_sets where id=$1', [id]).then(r => r.rows[0].status);
    const current = fighter => db.query('select profile_set_id from public.af_fighters where id=$1', [fighter]).then(r => r.rows[0].profile_set_id);

    // A superseded set's copies are listed, except a file the new approval shares; once removed, never again.
    const a = await register(), first = await reviewed(a, hex('1'), hex('f'));
    await approve(first);
    assert.deepEqual(await stale(a), []);
    const second = await reviewed(a, hex('2'), hex('f'));
    await approve(second);
    assert.deepEqual(await stale(a), [{ id: first, shas: [hex('1')] }]);
    assert.equal(value(await db.query('select public.af_profile_set_unpublished($1,$2) as value', [a, [first]])), 1);
    assert.deepEqual(await stale(a), []);
    await db.query('select public.af_profile_set_cleanup_failed($1,$2,$3)', [a, [`${a}/${hex('1')}.webp`], 'storage down']);
    assert.deepEqual((await db.query("select kind from public.af_profile_set_events where fighter_id=$1 order by id", [a])).rows.map(r => r.kind),
      ['approve', 'approve', 'public-cleanup-failed']);

    // An operator's removal withdraws his sets and clears his current one; a restore does not bring them back.
    const version = (await db.query('select moderation_version from af_fighters where id=$1', [a])).rows[0].moderation_version;
    await db.query('select public.af_moderate_fighter($1,$2,$3,$4,$5)', [admin, a, version, 'remove', 'test removal']);
    assert.deepEqual([await status(second), await current(a)], ['withdrawn', null]);
    assert.equal((await stale(a)).length, 1);
    assert.deepEqual(new Set((await stale(a))[0].shas), new Set([hex('2'), hex('f')]));
    await db.query('select public.af_moderate_fighter($1,$2,$3,$4,$5)', [admin, a, version + 1, 'restore', 'test restore']);
    assert.deepEqual([await status(second), await current(a)], ['withdrawn', null]);
    await assert.rejects(approve(second), /review-conflict/);

    // A fighter deleted while his set was still approved (no withdrawal): rejecting it no longer touches his row (af_guard_deleted_fighter).
    const b = await register(), third = await reviewed(b, hex('3'), hex('e'));
    await approve(third);
    await db.query(`update public.af_fighters set deleted_at = now(), account_slot = null, review_state = 'rejected', runtime_approved = false,
      duel_approved = false, runtime_scope = null, runtime_manifest_sha = null, duel_manifest_sha = null where id = $1`, [b]);
    const rejected = (await db.query('select public.af_admin_profile_set_reject($1,$2,$3) as value', [admin, third, 'left with him'])).rows[0].value;
    assert.deepEqual([rejected.status, rejected.previous], ['rejected', 'approved']);
    assert.deepEqual((await stale(b))[0].id, third);

    // The owner's deletion withdraws his approved set and the one in review.
    const c = await register(), fourth = await reviewed(c, hex('4'), hex('d'));
    await approve(fourth);
    const fifth = await reviewed(c, hex('5'), hex('c'));
    const prepared = (await db.query('select af_prepare_fighter_deletion($1,$2,$3,$4) as value', [owner, c, session, client])).rows[0].value;
    await db.query('select af_delete_owned_fighter($1,$2,$3,$4,$5,$6)', [owner, c, session, client, prepared.confirmationToken, prepared.confirmName]);
    assert.deepEqual([await status(fourth), await status(fifth), await current(c)], ['withdrawn', 'withdrawn', null]);
    assert.equal((await stale(c))[0].id, fourth);
    await assert.rejects(db.query('select public.af_admin_profile_set_reject($1,$2,$3)', [admin, fifth, 'x']), /review-conflict/);
    await assert.rejects(approve(fifth), /review-conflict/);
  } finally { await db.close(); }
});

test('the owner reads a set still uploading without a front to sign; a file Storage cannot sign is null, not a failure (리뷰 P2-4)', async () => {
  const owner = crypto.randomUUID(), id = crypto.randomUUID(), fighter = crypto.randomUUID();
  const row = { id, fighter_id: fighter, owner_id: owner, status: 'uploading', manifest_text: '', manifest_sha: 'a'.repeat(64), manifest: set(), derived: null,
    validation: null, reason: null, lease_token: null, lease_until: null, expires_at: new Date(Date.now() + 3600000).toISOString(), created_at: '2026-10-31T00:00:00Z', approved_at: null };
  let signs = 0;
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: row, error: null }) };
  const handle = createHandler({ db: { auth: { getClaims: async () => ({ data: { claims: { sub: owner, is_anonymous: false, role: 'authenticated' } }, error: null }) },
    rpc: async () => ({ data: true, error: null }), from: () => query,
    storage: { from: () => ({ createSignedUrls: async paths => { signs++; return { data: paths.map(path => ({ path, error: 'Object not found', signedUrl: null })), error: null }; } }) } } });
  const get = () => handle(new Request(`https://test/ai-fighter/profile-sets/${id}`, { headers: { authorization: 'Bearer signed-user-token-for-test' } }));
  const uploading = await get();
  assert.equal(uploading.status, 200);
  const body = await uploading.json();
  assert.deepEqual([body.stage, body.urls, signs], ['uploading', {}, 0]);
  assert.deepEqual(body.assets, [{ id: 'front', bytes: 1000, sha256: 'a'.repeat(64) }]);
  row.status = 'queued';
  const queued = await get();
  assert.equal(queued.status, 200); assert.deepEqual((await queued.json()).urls, { front: null });
});
