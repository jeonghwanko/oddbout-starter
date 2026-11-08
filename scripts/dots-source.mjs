// @ts-check
import { link, lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { UUID, readBody, sha256 } from '../api/bytes.mjs';
import { base64, importVmPublicKey, openVmGrant, SOURCE_LIMIT } from '../api/creator-source-crypto.mjs';
import { runtimeFetch } from '../api/runtime-fetch.mjs';
import { safePath, readRecord } from './dots-safety.mjs';

/** @param {string} workspace @param {string} [requestId] */
export async function createVmRequest(workspace, requestId = crypto.randomUUID()) {
  workspace = await safePath(workspace);
  if (!UUID.test(requestId)) throw Error('invalid-request-id');
  const dir = await safePath(`.oddbout-private/transfers/${requestId}`, { root: workspace });
  const keyPath = path.join(dir, 'key.json');
  let record;
  try {
    record = await readRecord(keyPath);
  } catch (/** @type {any} */ e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (!record) {
    const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, [
      'encrypt',
      'decrypt',
    ]);
    const publicBytes = await crypto.subtle.exportKey('spki', pair.publicKey);
    record = {
      version: 1,
      requestId,
      createdAt: new Date().toISOString(),
      publicKey: base64(publicBytes),
      keySha256: await sha256(publicBytes),
      privateKey: base64(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    };
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(keyPath, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
  }
  const request = { version: 1, requestId, publicKey: record.publicKey };
  const key = await importVmPublicKey(request);
  if (record.version !== 1 || record.requestId !== requestId || key.sha256 !== record.keySha256) throw Error('invalid-transfer-key');
  if (process.platform !== 'win32' && (await lstat(keyPath)).mode & 0o077) throw Error('transfer-key-permissions');
  return request;
}
/** @param {string} workspace @param {any} envelope read from disk: openVmGrant checks it @param {{ fetcher?: typeof runtimeFetch, now?: number }} [options] */
export async function receiveVmSource(workspace, envelope, { fetcher = runtimeFetch, now = Date.now() } = {}) {
  workspace = await safePath(workspace);
  if (!UUID.test(envelope?.requestId ?? '')) throw Error('invalid-request-id');
  const keyPath = await safePath(`.oddbout-private/transfers/${envelope.requestId}/key.json`, { root: workspace });
  if (process.platform !== 'win32' && (await lstat(keyPath)).mode & 0o077) throw Error('transfer-key-permissions');
  const record = await readRecord(keyPath),
    grant = await openVmGrant(record, envelope, now);
  const relative = `input/sources/${grant.sourceId}/${grant.sha256}.png`,
    target = await safePath(relative, { root: workspace });
  let bytes,
    reused = false;
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.size !== grant.bytes) throw Error('existing-source-changed');
    bytes = new Uint8Array(await readFile(target));
    reused = true;
  } catch (/** @type {any} */ e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (!bytes) {
    let response;
    try {
      response = await fetcher(grant.url, { method: 'GET', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30000) });
    } catch {
      throw Error('source-download-unavailable');
    }
    if (!response.ok) throw Error(response.status === 400 || response.status === 403 ? 'source-grant-expired-or-denied' : 'source-download-unavailable');
    bytes = await readBody(response, SOURCE_LIMIT);
  }
  if (bytes.length !== grant.bytes || (await sha256(bytes)) !== grant.sha256) throw Error('source-identity-mismatch');
  // Header checks on the server never substitute for a full VM decode.
  let decoded;
  try {
    decoded = await sharp(bytes, { limitInputPixels: 33554432, failOn: 'warning' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch {
    throw Error('source-decode-failed');
  }
  if (decoded.info.width !== grant.width || decoded.info.height !== grant.height) throw Error('source-dimensions-mismatch');
  if (!reused) {
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const pending = `${target}.${crypto.randomUUID()}.pending`;
    await writeFile(pending, bytes, { flag: 'wx', mode: 0o600 });
    // Atomic, no-clobber admission. A failed write/link leaves its own pending file for recovery.
    try {
      await link(pending, target);
    } catch (/** @type {any} */ e) {
      if (e.code !== 'EEXIST') throw e;
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== grant.bytes || (await sha256(await readFile(target))) !== grant.sha256)
        throw Error('existing-source-changed');
      reused = true;
    }
    await unlink(pending);
  }
  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date(now).toISOString(),
    requestId: envelope.requestId,
    accountId: grant.ownerId,
    sourceId: grant.sourceId,
    file: { path: relative, bytes: bytes.length, sha256: grant.sha256 },
    decode: { status: 'verified', width: decoded.info.width, height: decoded.info.height },
    vmReceived: true,
    reused,
    generationVerified: false,
    conversationDisplayed: false,
  };
  const out = await safePath(`output/source-delivery/${envelope.requestId}-${crypto.randomUUID()}.json`, { root: workspace });
  await mkdir(path.dirname(out), { recursive: true, mode: 0o700 });
  await writeFile(out, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { ok: true, ...receipt };
}
/** @param {string[]} argv */
export async function main(argv) {
  const [mode, workspace, value] = argv;
  if (!['request', 'receive'].includes(mode) || !workspace || argv.length > 3 || (mode === 'receive' && !value))
    throw Error('usage: dots-source request <workspace> [request-id] | receive <workspace> <envelope.json>');
  const result =
    mode === 'request'
      ? await createVmRequest(workspace, value)
      : await receiveVmSource(workspace, await readRecord(await safePath(value, { root: await safePath(workspace) })));
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await main(process.argv.slice(2));
  } catch (/** @type {any} */ e) {
    console.error(JSON.stringify({ ok: false, code: /^[a-z][a-z-]+$/.test(e.message) ? e.message : 'source-transfer-failed' }));
    process.exitCode = 1;
  }
}
