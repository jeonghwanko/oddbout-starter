import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, sha256, VALIDATOR_VERSION } from '../api/handler.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { migratedDatabase } from './helpers/fighter-database.mjs';

// 운영자 선수 수정 (2026-11-02): the operator's routes against the migrated database, the owner's own path beside them.
async function fixture() {
  const sql = await migratedDatabase(), owner = crypto.randomUUID(), admin = crypto.randomUUID(), stranger = crypto.randomUUID();
  for (const user of [owner, admin, stranger]) await sql.query('insert into auth.users(id) values($1)', [user]);
  await sql.query('insert into af_admins(owner_id) values($1)', [admin]);
  const value = result => result.rows[0].value;
  const rpc = async (name, args) => {
    if (!/^af_[a-z_]+$/.test(name) || Object.keys(args).some(key => !/^p_[a-z_]+$/.test(key))) throw Error('invalid-test-rpc');
    try { return { data: value(await sql.query(`select to_jsonb(public.${name}(${Object.keys(args).map((key, i) => `${key} => $${i+1}`).join(',')})) as value`, Object.values(args))) }; }
    catch (error) { return { error: { message: error.message } }; }
  };
  const from = table => {
    if (!['af_submissions', 'af_fighters', 'af_admin_fighter_edits'].includes(table)) throw Error('unsupported-test-table');
    const filters = [], values = []; let order = '', limit = '';
    const column = key => { if (!/^[a-z_]+$/.test(key)) throw Error('invalid-test-column'); return key; };
    const run = async () => (await sql.query(`select to_jsonb(t) as value from public.${table} t${filters.length ? ' where ' + filters.join(' and ') : ''}${order}${limit}`, values)).rows.map(row => row.value);
    const q = { select: () => q, eq: (key, val) => { values.push(val); filters.push(`${column(key)}=$${values.length}`); return q; },
      not: (key, operator, val) => { if (operator !== 'is' || val !== null) throw Error('invalid-test-filter'); filters.push(`${column(key)} is not null`); return q; },
      order: (key, options) => { order = ` order by ${column(key)}${options?.ascending === false ? ' desc' : ''}`; return q; },
      limit: n => { limit = ` limit ${Number(n)}`; return q; },
      maybeSingle: async () => ({ data: (await run())[0] ?? null }), then: (resolve, reject) => run().then(data => ({ data })).then(resolve, reject) };
    return q;
  };
  const tokens = { 'owner-test-token-0001': owner, 'admin-test-token-0001': admin, 'stranger-test-token-1': stranger };
  // Storage as the asset route uses it: an upload is an object row (af_submit counts them).
  const storage = { from: () => ({
    upload: async (path, bytes) => { await sql.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', path, { size: bytes.length }]); return {}; },
    download: async () => ({ error: { message: 'none' } }), createSignedUrls: async paths => ({ data: paths.map(path => ({ path, signedUrl: `http://local/${path}` })) }) }) };
  const db = { rpc, from, storage, auth: { getUser: async token => ({ data: { user: tokens[token] ? { id: tokens[token] } : null } }) } };
  const handle = createHandler({ db });
  const call = (route, { token = 'admin-test-token-0001', method = 'GET', body, headers = {} } = {}) =>
    handle(new Request(`http://localhost/ai-fighter/${route}`, { method, body, headers: { authorization: `Bearer ${token}`, ...headers } }));
  // A package the contract accepts whose asset bytes exist here (the example's own files are not in the repository).
  const pack = description => {
    const files = new Map(), manifest = structuredClone(example);
    manifest.profile.description = description;
    return { manifest, files, ready: (async () => {
      for (const asset of manifest.assets) {
        const bytes = new Uint8Array(asset.bytes); bytes.set(new TextEncoder().encode('RIFF'), 0); bytes.set(new TextEncoder().encode('WEBP'), 8);
        bytes.set(new TextEncoder().encode(description.slice(0, 16)), 16);
        asset.sha256 = await sha256(bytes); files.set(asset.id, bytes);
      }
    })() };
  };
  const finish = async id => {
    const claim = value(await sql.query('select to_jsonb(public.af_claim($1)) as value', [id]));
    return value(await sql.query('select to_jsonb(public.af_finish($1,$2,$3,true,$4)) as value',
      [id, claim.lease_token, claim.manifest_sha, { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: [] }]));
  };
  // His own first registration, entered.
  const first = pack('The owner\'s fighter'); await first.ready;
  const text = JSON.stringify(first.manifest), bytes = first.manifest.assets.reduce((sum, a) => sum + a.bytes, 0);
  const created = value(await sql.query('select to_jsonb(public.af_create_submission($1,$2,$3,$4,$5)) as value', [owner, crypto.randomUUID(), text, await sha256(new TextEncoder().encode(text)), bytes]));
  for (const a of first.manifest.assets) await sql.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${created.id}/${a.id}.webp`, { size: a.bytes }]);
  await sql.query('select public.af_submit($1,$2)', [owner, created.id]);
  const fighter = (await finish(created.id)).fighter_id;
  await sql.query('update public.af_fighters set entered_at=now() where id=$1', [fighter]);
  const row = async () => (await sql.query('select * from public.af_fighters where id=$1', [fighter])).rows[0];
  return { sql, owner, admin, fighter, call, pack, finish, row };
}

test('an operator replaces someone\'s package through the owner\'s checks, keeps his entry and leaves an audit row', async () => {
  const { sql, owner, admin, fighter, call, pack, finish, row } = await fixture();
  try {
    // Only an operator: the owner and a stranger are refused, before anything else is read.
    for (const token of ['owner-test-token-0001', 'stranger-test-token-1'])
      assert.equal((await (await call(`admin/fighters/${fighter}`, { token })).json()).code, 'admin-required');
    const detail = await (await call(`admin/fighters/${fighter}`)).json();
    assert.equal(detail.fighter.ownerId, owner); assert.ok(detail.fighter.enteredAt); assert.deepEqual(detail.edits, []);
    const next = pack('Redrawn by the operator'); await next.ready;
    const text = JSON.stringify(next.manifest), key = crypto.randomUUID();
    const create = (reason = '다운 모션 교체') => call(`admin/fighters/${fighter}/submissions`, { method: 'POST', body: text,
      headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-admin-reason': encodeURIComponent(reason) } });
    assert.equal((await (await create(' ')).json()).code, 'invalid-reason');
    const made = await (await create()).json();
    assert.equal(made.stage, 'uploading'); assert.equal(made.keepEntry, true);
    assert.equal((await (await create()).json()).submissionId, made.submissionId, 'a retry answers the same submission');
    assert.equal((await (await call(`admin/submissions/${made.submissionId}/submit`, { method: 'POST' })).json()).code, 'assets-incomplete');
    for (const [id, bytes] of next.files) {
      const put = await call(`admin/submissions/${made.submissionId}/assets/${id}`, { method: 'PUT', body: bytes, headers: { 'content-type': 'image/webp' } });
      assert.equal(put.status, 200, id);
    }
    // The objects are the owner's, where his own package's are.
    assert.equal((await sql.query('select count(*)::int as n from storage.objects where name like $1', [`${owner}/${made.submissionId}/%`])).rows[0].n, next.files.size);
    assert.equal((await (await call(`admin/submissions/${made.submissionId}/submit`, { method: 'POST' })).json()).stage, 'queued');
    assert.equal((await finish(made.submissionId)).status, 'registered');
    const after = await row();
    assert.equal(after.manifest_sha, made.manifestSha256); assert.ok(after.entered_at, 'the operator\'s package keeps the entry');
    assert.equal(after.review_evidence.adminEntryKept.submission, made.submissionId);
    const audit = (await sql.query('select * from public.af_admin_fighter_edits')).rows;
    assert.deepEqual(audit.map(r => [r.actor, r.owner_id, r.kind, r.reason, r.kept_entry]), [[admin, owner, 'package', '다운 모션 교체', true]]);
    assert.equal((await (await call(`admin/submissions/${made.submissionId}`)).json()).stage, 'registered');
    // The same content again is unchanged; the owner's own submissions stay out of the operator's routes.
    const again = await call(`admin/fighters/${fighter}/submissions`, { method: 'POST', body: text,
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), 'x-admin-reason': 'x' } });
    assert.equal((await again.json()).code, 'fighter-unchanged');
    const own = (await sql.query('select id from public.af_submissions s where not exists(select 1 from af_admin_fighter_edits e where e.submission_id=s.id) limit 1')).rows[0].id;
    assert.equal((await call(`admin/submissions/${own}`)).status, 404);
    assert.equal((await (await call(`admin/fighters/${fighter}`)).json()).edits[0].status, 'registered');
    // The owner's own new package still returns him to production (he enters after watching it).
    const mine = pack('The owner again'); await mine.ready;
    const mineText = JSON.stringify(mine.manifest);
    const s = (await sql.query('select to_jsonb(public.af_create_submission($1,$2,$3,$4,$5,$6)) as value', [owner, crypto.randomUUID(), mineText,
      await sha256(new TextEncoder().encode(mineText)), mine.manifest.assets.reduce((sum, a) => sum + a.bytes, 0), fighter])).rows[0].value;
    for (const a of mine.manifest.assets) await sql.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${s.id}/${a.id}.webp`, { size: a.bytes }]);
    await sql.query('select public.af_submit($1,$2)', [owner, s.id]);
    await finish(s.id);
    assert.equal((await row()).entered_at, null);
    // An operator's package for a fighter not entered keeps him out.
    const third = pack('Operator, not entered'); await third.ready;
    const thirdMade = await (await call(`admin/fighters/${fighter}/submissions`, { method: 'POST', body: JSON.stringify(third.manifest),
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), 'x-admin-reason': 'fix' } })).json();
    assert.equal(thirdMade.keepEntry, false);
    // The owner reads his own submissions and fighter (RLS): the operator's id and reason are not there, only in the private audit.
    await sql.exec(`set role authenticated; set request.jwt.claim.sub='${owner}';`);
    const seen = (await sql.query('select to_jsonb(s) as value from af_submissions s where id=$1', [made.submissionId])).rows[0].value;
    assert.equal(seen.keep_entry, true); assert.equal(JSON.stringify(seen).includes(admin), false);
    assert.equal(JSON.stringify((await sql.query('select review_evidence from af_fighters where id=$1', [fighter])).rows[0]).includes(admin), false);
    await assert.rejects(sql.query('select * from af_admin_fighter_edits'), /permission denied/);
    await sql.exec('reset role');
  } finally { await sql.close(); }
});

test('an operator edits someone\'s profile and style; the database refuses everyone else', async () => {
  const { sql, owner, admin, fighter, call, row } = await fixture();
  try {
    const { manifest_sha } = await row(), key = crypto.randomUUID();
    const patch = (body, reason = '소개 문구 수정', token) => call(`admin/fighters/${fighter}/profile`, { method: 'PATCH', token,
      body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-admin-reason': encodeURIComponent(reason) } });
    const edit = { expectedManifestSha256: manifest_sha, profile: { description: '운영자가 고친 소개' } };
    assert.equal((await patch(edit, '소개', 'owner-test-token-0001')).status, 403);
    const malformed = await call(`admin/fighters/${fighter}/profile`, { method: 'PATCH', body: JSON.stringify(edit),
      headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-admin-reason': '%E0%A4%A' } });
    assert.equal((await malformed.json()).code, 'invalid-reason', 'a reason that is not percent-encoded UTF-8');
    const done = await (await patch(edit)).json();
    assert.equal(done.stage, 'registered');
    const after = await row();
    assert.equal(after.profile.description, '운영자가 고친 소개'); assert.ok(after.entered_at);
    assert.equal((await (await patch(edit)).json()).submissionId, done.submissionId, 'a retry answers the same edit');
    const audit = (await sql.query('select actor,owner_id,kind,kept_entry from public.af_admin_fighter_edits')).rows;
    assert.deepEqual(audit, [{ actor: admin, owner_id: owner, kind: 'profile', kept_entry: true }]);
    assert.equal((await (await call(`admin/fighters/${fighter}`)).json()).edits[0].reason, '소개 문구 수정');
    // The fighting style the same way, from the package the profile edit left; the detail shows it.
    const style = { mix: { slam: 2, combo: 1, fast: 0 }, distance: 2, temper: { guard: 4 } };
    const styled = await call(`admin/fighters/${fighter}/profile`, { method: 'PATCH', body: JSON.stringify({ expectedManifestSha256: done.manifestSha256, style }),
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), 'x-admin-reason': 'style' } });
    assert.equal(styled.status, 200, await styled.clone().text());
    const shown = await (await call(`admin/fighters/${fighter}`)).json();
    assert.deepEqual(shown.fighter.combat.style, style); assert.ok(shown.fighter.enteredAt);
    assert.deepEqual(shown.edits.map(e => e.kind), ['profile', 'profile']);
    // A browser role reaches neither the functions nor the audit; a forged actor is not an operator.
    await assert.rejects(sql.query('select af_admin_submit($1,$2)', [owner, done.submissionId]), /admin-required|not-found/);
    await sql.exec('set role authenticated');
    await assert.rejects(sql.query('select * from af_admin_fighter_edits'), /permission denied/);
    await assert.rejects(sql.query('select af_admin_submit($1,$2)', [admin, done.submissionId]), /permission denied/);
    await sql.exec('reset role');
  } finally { await sql.close(); }
});

test('a key the owner already used is his: the operator cannot take over his submission', async () => {
  const { sql, owner, fighter, call, pack } = await fixture();
  try {
    const next = pack('Same key, same text'); await next.ready;
    const text = JSON.stringify(next.manifest), key = crypto.randomUUID();
    const mine = (await sql.query('select to_jsonb(public.af_create_submission($1,$2,$3,$4,$5,$6)) as value', [owner, key, text,
      await sha256(new TextEncoder().encode(text)), next.manifest.assets.reduce((sum, a) => sum + a.bytes, 0), fighter])).rows[0].value;
    const taken = await call(`admin/fighters/${fighter}/submissions`, { method: 'POST', body: text,
      headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-admin-reason': 'x' } });
    assert.equal((await taken.json()).code, 'idempotency-conflict');
    assert.equal((await sql.query('select keep_entry from af_submissions where id=$1', [mine.id])).rows[0].keep_entry, false);
    assert.equal((await sql.query('select count(*)::int as n from af_admin_fighter_edits')).rows[0].n, 0);
  } finally { await sql.close(); }
});
