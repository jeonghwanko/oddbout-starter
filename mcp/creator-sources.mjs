// @ts-check
import { z } from 'zod';
import { Problem, sha256 } from '../api/http.mjs';
import { pngHeader } from './file-input-probe.mjs';
import { SOURCE_BUCKET, SOURCE_LIMIT, importVmPublicKey, sealVmGrant } from '../api/creator-source-crypto.mjs';
import { LIBRARY_FILE_HOSTS as HOSTS, UUID_ARG } from './cloud/common.mjs';
/**
 * @typedef {import('./cloud/common.mjs').Identity} Identity
 * @typedef {import('./cloud/common.mjs').HostFile} HostFile
 * @typedef {import('./cloud/common.mjs').Register} Register
 * @typedef {typeof import('./cloud/common.mjs').downloadHostFile} DownloadFile
 */
/**
 * A row of af_creator_sources.
 * @typedef {{ id: string, owner_id: string, sha256: string, bytes: number, width: number, height: number, status: 'pending' | 'ready' }} SourceRow
 */
// The ids are common.mjs's UUID_ARG (MCP 최적화 2026-11-05): zod's uuid() wrote its long pattern four times into /mcp's list. The same
// 8-4-4-4-12 hex shape the API's own check takes (api/bytes.mjs UUID); the database and sealVmGrant check them again.

/** @param {SourceRow} row */
const receipt = row => ({ sourceId: row.id, accountId: row.owner_id, bytes: row.bytes, sha256: row.sha256,
  width: row.width, height: row.height, status: row.status, persisted: row.status === 'ready', decoded: false, vmReceived: false });
/** @param {{ message?: string } | null | undefined} error */
function database(error) {
  if (!error) return;
  for (const code of ['source-idempotency-conflict','source-quota','account-disabled','rate-limit'])
    if (error.message?.includes(code)) throw new Problem(['source-quota','rate-limit'].includes(code) ? 429 : code === 'account-disabled' ? 403 : 409, code);
  throw new Problem(503, 'source-database-unavailable');
}
/**
 * `owner` is undefined only on a signed-out call, which register refuses for these account tools.
 * @param {{ db: any, owner: string | undefined, downloadFile: DownloadFile, fetcher?: typeof fetch }} options
 */
export function creatorSourceService({ db, owner, downloadFile, fetcher }) {
  const bucket = () => db.storage.from(SOURCE_BUCKET);
  /** @param {SourceRow} row */
  const pathOf = row => `${owner}/${row.id}.png`;
  /** @param {'id' | 'idempotency_key'} field @param {string} value */
  async function find(field, value) {
    const permission = await db.rpc('af_authorize', { p_owner: owner });
    database(permission.error);
    if (permission.data !== true) throw new Problem(403, 'account-disabled');
    const { data, error } = await db.from('af_creator_sources').select('*').eq('owner_id', owner).eq(field, value).maybeSingle();
    database(error); return data;
  }
  /** @param {SourceRow} row */
  async function stored(row) {
    const { data, error } = await bucket().download(pathOf(row));
    if (error) {
      if (['404','NoSuchKey','not_found'].includes(String(error.statusCode ?? error.code))) return null;
      throw new Problem(503, 'source-storage-unavailable');
    }
    if (!data || data.size !== row.bytes || data.size > SOURCE_LIMIT) throw new Problem(409, 'stored-source-identity-mismatch');
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (await sha256(bytes) !== row.sha256) throw new Problem(409, 'stored-source-identity-mismatch');
    return bytes;
  }
  /** @param {SourceRow} row */
  async function finish(row) {
    const { data, error } = await db.from('af_creator_sources').update({ status: 'ready', verified_at: new Date().toISOString() })
      .eq('id', row.id).eq('owner_id', owner).eq('sha256', row.sha256).select('*').single();
    database(error); if (!data) throw new Problem(503, 'source-finalization-unavailable');
    return { ok: true, ...receipt(data) };
  }
  return {
    /** @param {{ file: HostFile, expectedBytes: number, expectedSha256: string, idempotencyKey: string }} request */
    async save({ file, expectedBytes, expectedSha256, idempotencyKey }) {
      let row = await find('idempotency_key', idempotencyKey);
      if (row) {
        if (row.bytes !== expectedBytes || row.sha256 !== expectedSha256) throw new Problem(409, 'source-idempotency-conflict');
        if (await stored(row)) return finish(row); // Recover an upload whose completion response was lost.
        if (row.status === 'ready') throw new Problem(409, 'stored-source-missing');
      }
      const bytes = await downloadFile(file, SOURCE_LIMIT, fetcher, HOSTS);
      if (bytes.length !== expectedBytes || await sha256(bytes) !== expectedSha256) throw new Problem(409, 'source-identity-mismatch');
      const png = pngHeader(bytes);
      if (png.width > 8192 || png.height > 8192 || png.width * png.height > 33554432) throw new Problem(413, 'source-pixel-limit');
      const result = await db.rpc('af_reserve_creator_source', { p_owner: owner, p_key: idempotencyKey, p_sha: expectedSha256,
        p_bytes: expectedBytes, p_width: png.width, p_height: png.height });
      database(result.error); row = result.data;
      const { error } = await bucket().upload(pathOf(row), bytes, { contentType: 'image/png', upsert: false });
      // Immutable retry may see an existing object; only its measured bytes can resolve that outcome.
      if (error && !['409','Duplicate'].includes(String(error.statusCode ?? error.code))) throw new Problem(503, 'source-upload-outcome-unknown');
      if (!await stored(row)) throw new Problem(503, 'source-upload-outcome-unknown');
      return finish(row);
    },
    /** @param {string} sourceId */
    async get(sourceId) {
      const row = await find('id', sourceId);
      if (!row) throw new Problem(404, 'source-not-found');
      return { ok: true, ...receipt(row) };
    },
    /** @param {string} sourceId @param {{ version: 1, requestId: string, publicKey: string }} vmRequest */
    async grant(sourceId, vmRequest) {
      await importVmPublicKey(vmRequest); // Validate before creating a signed capability.
      const row = await find('id', sourceId);
      if (!row) throw new Problem(404, 'source-not-found');
      if (row.status !== 'ready') throw new Problem(409, 'source-not-ready');
      const { data, error } = await bucket().createSignedUrl(pathOf(row), 300);
      if (error || !data?.signedUrl) throw new Problem(503, 'source-storage-unavailable');
      const expiresAt = new Date(Date.now() + 300000).toISOString();
      return { ok: true, ...receipt(row), expiresAt,
        envelope: await sealVmGrant(vmRequest, { sourceId, ownerId: owner, bytes: row.bytes, sha256: row.sha256,
          width: row.width, height: row.height, expiresAt, url: data.signedUrl }) };
    },
  };
}
/** @param {{ register: Register, fileSchema: typeof import('./cloud/common.mjs').FILE, identity: Identity | null, db: any, downloadFile: DownloadFile, fetcher: typeof fetch }} options */
export function registerCreatorSources({ register, fileSchema, identity, db, downloadFile, fetcher }) {
  const service = creatorSourceService({ db, owner: identity?.owner, downloadFile, fetcher });
  register('store_creator_source', '제작 원본 비공개 보관',
    'Store an authorized original PNG privately for this account and VM creation. Use actual host file input and measured original size/hash. Reuse the same idempotency key for identical bytes, including an unknown result. No generation or publication.',
    { file: fileSchema, expectedBytes: z.number().int().min(33).max(SOURCE_LIMIT), expectedSha256: z.string().regex(/^[a-f0-9]{64}$/), idempotencyKey: UUID_ARG() },
    args => service.save(args), { write: true, idempotent: true, files: ['file'], openWorld: true });
  register('get_creator_source', '제작 원본 상태', 'Read this account’s private original receipt. Does not prove VM delivery or display.',
    { sourceId: UUID_ARG() }, ({ sourceId }) => service.get(sourceId));
  register('prepare_creator_source_download', 'VM 원본 전달 준비',
    'Authorize a five-minute download of your private original to the VM public request created in the user-selected workspace. Returns an encrypted grant, never a signed URL or login token. Pass its envelope as a file to dots:source receive on that same VM. Renew after expiry without regenerating or reuploading the source.',
    { sourceId: UUID_ARG(), vmRequest: z.object({ version: z.literal(1), requestId: UUID_ARG(), publicKey: z.string().max(2048) }).strict() },
    ({ sourceId, vmRequest }) => service.grant(sourceId, vmRequest), { write: true, idempotent: true });
}
