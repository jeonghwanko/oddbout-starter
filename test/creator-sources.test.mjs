import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { sha256 } from '../api/http.mjs';
import { SOURCE_BUCKET, STORAGE_ORIGIN, openVmGrant, sealVmGrant } from '../api/creator-source-crypto.mjs';
import { creatorSourceService } from '../mcp/creator-sources.mjs';
import { createVmRequest, receiveVmSource } from '../scripts/dots-source.mjs';
import { migratedDatabase } from './helpers/fighter-database.mjs';

const png = () =>
  sharp({ create: { width: 3, height: 2, channels: 4, background: '#123456' } })
    .png()
    .toBuffer();
async function workspace(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'oddbout-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function transfer(t) {
  const root = await workspace(t),
    request = await createVmRequest(root),
    bytes = await png();
  const ownerId = crypto.randomUUID(),
    sourceId = crypto.randomUUID();
  const grant = {
    ownerId,
    sourceId,
    sha256: await sha256(bytes),
    bytes: bytes.length,
    width: 3,
    height: 2,
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    url: `${STORAGE_ORIGIN}/storage/v1/object/sign/${SOURCE_BUCKET}/${ownerId}/${sourceId}.png?token=secret-grant`,
  };
  const envelope = await sealVmGrant(request, grant);
  const record = JSON.parse(await readFile(path.join(root, `.oddbout-private/transfers/${request.requestId}/key.json`), 'utf8'));
  return { root, request, record, bytes, grant, envelope };
}

test('private envelope opens only on the requested VM; modified, expired and off-origin grants fail', async t => {
  const f = await transfer(t);
  assert.equal((await openVmGrant(f.record, f.envelope)).url, f.grant.url);
  assert.doesNotMatch(JSON.stringify(f.envelope), /secret-grant|https:|privateKey/);
  assert.deepEqual(await createVmRequest(f.root, f.request.requestId), f.request);
  await assert.rejects(openVmGrant({ ...f.record, requestId: crypto.randomUUID() }, f.envelope), /invalid-or-expired/);
  await assert.rejects(openVmGrant(f.record, { ...f.envelope, ciphertext: 'AAAA' }), /invalid-or-expired/);
  await assert.rejects(openVmGrant(f.record, f.envelope, Date.now() + 600000), /invalid-or-expired/);
  for (const change of [{ url: 'https://evil.example/source.png' }, { width: 0 }, { ownerId: crypto.randomUUID() }]) {
    await assert.rejects(openVmGrant(f.record, await sealVmGrant(f.request, { ...f.grant, ...change })), /invalid-or-expired/);
  }
});

test('VM receives unchanged bytes, decodes once per receipt and reuses the existing original without another download', async t => {
  const f = await transfer(t);
  let calls = 0;
  const fetcher = async (url, opts) => {
    calls++;
    assert.equal(url, f.grant.url);
    assert.equal(opts.redirect, 'error');
    return new Response(f.bytes);
  };
  const first = await receiveVmSource(f.root, f.envelope, { fetcher });
  assert.equal(first.vmReceived, true);
  assert.equal(first.decode.status, 'verified');
  assert.equal(first.generationVerified, false);
  assert.equal(first.conversationDisplayed, false);
  assert.deepEqual(await readFile(path.join(f.root, first.file.path)), f.bytes);
  assert.equal((await receiveVmSource(f.root, f.envelope, { fetcher })).reused, true);
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(first), /secret-grant|encryptedKey|privateKey/);
  await writeFile(path.join(f.root, first.file.path), Buffer.alloc(f.bytes.length));
  await assert.rejects(receiveVmSource(f.root, f.envelope, { fetcher }), /source-identity-mismatch/);
  assert.equal(calls, 1);
});

test('wrong bytes and malformed PNG are rejected before admitting an original', async t => {
  const f = await transfer(t);
  await assert.rejects(receiveVmSource(f.root, f.envelope, { fetcher: async () => new Response('wrong') }), /source-identity-mismatch/);
  const malformed = Buffer.alloc(64),
    grant = { ...f.grant, bytes: malformed.length, sha256: await sha256(malformed) };
  await assert.rejects(receiveVmSource(f.root, await sealVmGrant(f.request, grant), { fetcher: async () => new Response(malformed) }), /source-decode-failed/);
});

// Real SQL for ownership/reservation, with only the hosted Storage service replaced by in-memory bytes.
function client(sql, objects, state) {
  const storage = {
    from: name => {
      assert.equal(name, SOURCE_BUCKET);
      return {
        download: async key => (objects.has(key) ? { data: new Blob([objects.get(key)]) } : { error: { statusCode: '404' } }),
        upload: async (key, bytes, opts) => {
          assert.equal(opts.upsert, false);
          state.uploads++;
          if (objects.has(key)) return { error: { statusCode: '409' } };
          objects.set(key, bytes);
          if (state.loseUpload) {
            state.loseUpload = false;
            return { error: { statusCode: '503' } };
          }
          return { data: {} };
        },
        createSignedUrl: async key => ({ data: { signedUrl: `${STORAGE_ORIGIN}/storage/v1/object/sign/${SOURCE_BUCKET}/${key}?token=secret-grant` } }),
      };
    },
  };
  return {
    storage,
    rpc: async (name, p) => {
      try {
        const query =
          name === 'af_authorize'
            ? ['select public.af_authorize($1) as allowed', [p.p_owner]]
            : ['select public.af_reserve_creator_source($1,$2,$3,$4,$5,$6) as item', [p.p_owner, p.p_key, p.p_sha, p.p_bytes, p.p_width, p.p_height]];
        const result = await sql.query(...query);
        return { data: name === 'af_authorize' ? result.rows[0].allowed : result.rows[0].item };
      } catch (error) {
        return { error };
      }
    },
    from: name => {
      assert.equal(name, 'af_creator_sources');
      let values = [],
        where = [],
        update;
      const builder = {
        select: () => builder,
        eq: (column, value) => {
          assert.ok(['owner_id', 'id', 'idempotency_key', 'sha256'].includes(column));
          values.push(value);
          where.push(`${column}=$${values.length}`);
          return builder;
        },
        update: value => {
          update = value;
          return builder;
        },
        maybeSingle: async () => ({ data: (await sql.query(`select * from public.af_creator_sources where ${where.join(' and ')}`, values)).rows[0] ?? null }),
        single: async () => {
          assert.equal(update.status, 'ready');
          return {
            data: (await sql.query(`update public.af_creator_sources set status='ready', verified_at=now() where ${where.join(' and ')} returning *`, values))
              .rows[0],
          };
        },
      };
      return builder;
    },
  };
}
test('private source storage enforces SQL permissions, immutable retries, owner isolation and recovery after an unknown upload', async t => {
  const sql = await migratedDatabase();
  t.after(() => sql.close());
  const owner = crypto.randomUUID(),
    other = crypto.randomUUID();
  await sql.query('insert into auth.users(id) values ($1),($2)', [owner, other]);
  const objects = new Map(),
    state = { uploads: 0, downloads: 0, loseUpload: true },
    bytes = await png();
  const db = client(sql, objects, state);
  const service = id =>
    creatorSourceService({
      db,
      owner: id,
      downloadFile: async () => {
        state.downloads++;
        return bytes;
      },
    });
  const args = { file: {}, expectedBytes: bytes.length, expectedSha256: await sha256(bytes), idempotencyKey: crypto.randomUUID() };
  await assert.rejects(service(owner).save(args), /source-upload-outcome-unknown/);
  const receipt = await service(owner).save(args);
  assert.equal(receipt.persisted, true);
  assert.equal(receipt.vmReceived, false);
  assert.equal(state.uploads, 1);
  assert.equal(state.downloads, 1);
  assert.deepEqual(await service(owner).save(args), receipt);
  await assert.rejects(service(owner).save({ ...args, expectedSha256: 'f'.repeat(64) }), /source-idempotency-conflict/);
  await assert.rejects(service(other).get(receipt.sourceId), /source-not-found/);
  const f = await transfer(t);
  await assert.rejects(service(other).grant(receipt.sourceId, f.request), /source-not-found/);
  const response = await service(owner).grant(receipt.sourceId, f.request);
  assert.doesNotMatch(JSON.stringify(response), /secret-grant|https:/);
  assert.equal((await openVmGrant(f.record, response.envelope)).ownerId, owner);
  const bucket = (await sql.query('select public from storage.buckets where id=$1', [SOURCE_BUCKET])).rows[0];
  assert.equal(bucket.public, false);
  await sql.exec('set role authenticated');
  await assert.rejects(sql.query('select * from public.af_creator_sources'), /permission denied/);
  await assert.rejects(
    sql.query('select public.af_reserve_creator_source($1,$2,$3,64,1,1)', [other, crypto.randomUUID(), 'a'.repeat(64)]),
    /permission denied/,
  );
  await sql.exec('reset role');
  await sql.query('update public.af_creators set enabled=false where owner_id=$1', [owner]);
  await assert.rejects(service(owner).get(receipt.sourceId), /account-disabled/);
});
