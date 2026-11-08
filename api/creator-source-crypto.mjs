// @ts-check
// Standard WebCrypto envelope; only the requesting VM can open the temporary grant.
import { decodeBase64, encodeBase64 } from './base64.mjs';
import { Problem, UUID, sha256 } from './bytes.mjs';

export const SOURCE_BUCKET = 'af-creator-sources';
export const SOURCE_LIMIT = 16 * 1024 * 1024;
export const STORAGE_ORIGIN = 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co';
export const base64 = encodeBase64;
/** @param {unknown} value @param {number} [maximum] */
export function unbase64(value, maximum = 32768) {
  if (typeof value !== 'string' || value.length > maximum || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Problem(400, 'invalid-envelope');
  try {
    return decodeBase64(value);
  } catch {
    throw new Problem(400, 'invalid-envelope');
  }
}
/** @param {any} request  A VM's grant request, checked here before any use. */
export async function importVmPublicKey(request) {
  if (request?.version !== 1 || !UUID.test(request.requestId ?? '')) throw new Problem(400, 'invalid-vm-request');
  try {
    const raw = unbase64(request.publicKey, 2048);
    const key = await crypto.subtle.importKey('spki', raw, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt']);
    if (/** @type {RsaHashedKeyAlgorithm} */ (key.algorithm).modulusLength !== 2048) throw Error('key-size');
    return { key, sha256: await sha256(raw) };
  } catch {
    throw new Problem(400, 'invalid-vm-public-key');
  }
}
/** @param {any} request @param {Record<string, unknown>} grant */
export async function sealVmGrant(request, grant) {
  const { key, sha256: keySha256 } = await importVmPublicKey(request);
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`oddbout-vm-source-v1:${request.requestId}:${keySha256}`);
  const payload = new TextEncoder().encode(JSON.stringify({ ...grant, requestId: request.requestId, keySha256 }));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad }, aes, payload);
  const encryptedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, await crypto.subtle.exportKey('raw', aes));
  return { version: 1, requestId: request.requestId, keySha256, encryptedKey: base64(encryptedKey), nonce: base64(nonce), ciphertext: base64(ciphertext) };
}
/** @param {any} record @param {any} envelope  Both read from disk or the wire and checked here. @param {number} [now] */
export async function openVmGrant(record, envelope, now = Date.now()) {
  try {
    if (envelope.version !== 1 || envelope.requestId !== record.requestId || envelope.keySha256 !== record.keySha256) throw Error('binding');
    const key = await crypto.subtle.importKey('pkcs8', unbase64(record.privateKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, key, unbase64(envelope.encryptedKey));
    const aes = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const aad = new TextEncoder().encode(`oddbout-vm-source-v1:${record.requestId}:${record.keySha256}`);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(envelope.nonce), additionalData: aad }, aes, unbase64(envelope.ciphertext));
    const grant = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
    if (
      grant.requestId !== record.requestId ||
      grant.keySha256 !== record.keySha256 ||
      !UUID.test(grant.sourceId ?? '') ||
      !UUID.test(grant.ownerId ?? '') ||
      !/^[a-f0-9]{64}$/.test(grant.sha256 ?? '') ||
      !Number.isSafeInteger(grant.bytes) ||
      grant.bytes < 33 ||
      grant.bytes > SOURCE_LIMIT ||
      !Number.isInteger(grant.width) ||
      !Number.isInteger(grant.height) ||
      grant.width < 1 ||
      grant.height < 1 ||
      grant.width > 8192 ||
      grant.height > 8192 ||
      grant.width * grant.height > 33554432 ||
      !Number.isFinite(Date.parse(grant.expiresAt)) ||
      Date.parse(grant.expiresAt) <= now ||
      Date.parse(grant.expiresAt) > now + 610000
    )
      throw Error('grant');
    const url = new URL(grant.url);
    if (
      url.origin !== STORAGE_ORIGIN ||
      url.username ||
      url.password ||
      url.hash ||
      url.pathname !== `/storage/v1/object/sign/${SOURCE_BUCKET}/${grant.ownerId}/${grant.sourceId}.png`
    )
      throw Error('origin');
    return grant;
  } catch {
    throw new Problem(400, 'invalid-or-expired-vm-grant');
  }
}
