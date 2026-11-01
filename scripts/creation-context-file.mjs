// @ts-check
// Explicit public game-context handoff only. This never substitutes other network requests.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import source from '../deploy/creation-context-source.json' with { type: 'json' };

const maxContextBytes = 128 * 1024, maxReceiptBytes = 4 * 1024, maxAgeMs = 15 * 60 * 1000;

/** @param {string} file @param {number} limit */
async function boundedFile(file, limit) {
  try {
    if (!(await lstat(file)).isFile()) throw Error('creation-context-file-regular-required');
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw Error('creation-context-file-regular-required');
      if (info.size > limit) throw Error('creation-context-file-too-large');
      // Bounded even if a writer grows the file after stat. Never read arbitrary-sized input.
      const bytes = Buffer.alloc(limit + 1); let size = 0;
      while (size < bytes.length) {
        const { bytesRead } = await handle.read(bytes, size, bytes.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > limit) throw Error('creation-context-file-too-large');
      return bytes.subarray(0, size);
    } finally { await handle.close(); }
  } catch (/** @type {any} */ error) {
    // File paths and contents must never appear in CLI/MCP errors.
    if (/^creation-context-file-/.test(error.message)) throw error;
    throw Error('creation-context-file-unreadable');
  }
}

/**
 * The receipt is local integrity metadata, not a signature or independent proof of freshness.
 * Its retrieval time must come from the trusted fetch that supplied the original public bytes.
 * @param {string} contextFile @param {string} contextReceipt
 */
async function checkedBytes(contextFile, contextReceipt) {
  const receiptBytes = await boundedFile(contextReceipt, maxReceiptBytes);
  let receipt;
  try { receipt = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(receiptBytes)); }
  catch { throw Error('creation-context-receipt-invalid'); }
  if (receipt?.schemaVersion !== 1 || receipt.sourceUrl !== source.url ||
      !/^[a-f0-9]{40}$/.test(receipt.gitBlobSha1 ?? '') || !/^[a-f0-9]{64}$/.test(receipt.sha256 ?? '') ||
      typeof receipt.retrievedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.retrievedAt))
    throw Error('creation-context-receipt-invalid');
  const fetchedAt = Date.parse(receipt.retrievedAt);
  if (!Number.isFinite(fetchedAt) || new Date(fetchedAt).toISOString() !== receipt.retrievedAt)
    throw Error('creation-context-receipt-invalid');
  const bytes = await boundedFile(contextFile, maxContextBytes);
  const age = Date.now() - fetchedAt;
  if (age < 0 || age > maxAgeMs) throw Error('creation-context-receipt-expired');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const gitBlobSha1 = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (sha256 !== receipt.sha256 || gitBlobSha1 !== receipt.gitBlobSha1) throw Error('creation-context-file-integrity');
  // Validate decoding here too, including invocations that do not make a context request.
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw Error('creation-context-file-utf8'); }
  return bytes;
}

/**
 * No cache/fallback: validate once for the invocation and reread/recheck every actual context request.
 * Schema and workflow checks remain in fetchCreationContext, exactly as with network transport.
 * @param {string} contextFile @param {string} contextReceipt @returns {Promise<typeof fetch>}
 */
export async function fileContextRequest(contextFile, contextReceipt) {
  await checkedBytes(contextFile, contextReceipt);
  return async input => {
    if (input !== source.url) throw Error('creation-context-file-source');
    return new Response(new Uint8Array(await checkedBytes(contextFile, contextReceipt)), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  };
}

/** @param {string[]} argv */
export function parseContextFileArgs(argv) {
  /** @type {Record<string, string>} */
  const files = {};
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--context-file' || key === '--context-receipt') {
      const value = argv[++i];
      if (files[key] !== undefined || !value || value.startsWith('--')) throw Error('creation-context-file-arguments');
      files[key] = value;
    } else {
      if (key.startsWith('--')) throw Error('creation-context-file-arguments');
      args.push(key);
    }
  }
  const contextFile = files['--context-file'], contextReceipt = files['--context-receipt'];
  if (Boolean(contextFile) !== Boolean(contextReceipt)) throw Error('creation-context-file-arguments');
  return { args, contextFile, contextReceipt };
}
