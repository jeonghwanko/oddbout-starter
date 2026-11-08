// @ts-check
import { z } from 'zod';
import { Problem, sha256 } from '../api/http.mjs';
// Observed from the authorized native fileParams call on 2026-10-26 (LIBRARY_FILE_HOSTS: never arbitrary Azure tenants or inferred names).
import { LIBRARY_FILE_HOSTS as OBSERVED_PROBE_HOSTS } from './cloud/common.mjs';
/**
 * @typedef {import('./cloud/common.mjs').Identity} Identity
 * @typedef {import('./cloud/common.mjs').Register} Register
 */

export const FILE_PROBE_LIMIT = 4 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

// Safe diagnostics only: signed paths, query strings and credentials never leave the server.
/** @param {string} value */
function rejectedOrigin(value) {
  try {
    const url = new URL(value);
    return {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      hasUserInfo: Boolean(url.username || url.password),
      hasFragment: Boolean(url.hash),
    };
  } catch {
    return { malformed: true };
  }
}

// This is a header check, not an image decoder or a visual review.
/** @param {Uint8Array} bytes */
export function pngHeader(bytes) {
  if (bytes.length < 33 || PNG_SIGNATURE.some((value, i) => bytes[i] !== value)) throw new Problem(415, 'png-required');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || new TextDecoder().decode(bytes.subarray(12, 16)) !== 'IHDR') throw new Problem(415, 'png-ihdr-required');
  const width = view.getUint32(16),
    height = view.getUint32(20);
  if (!width || !height || width > 16384 || height > 16384) throw new Problem(415, 'png-dimensions-out-of-range');
  return { width, height, check: 'png-signature-and-ihdr', decoded: false };
}

/**
 * `identity` is null only on a signed-out call, which register refuses for this account tool: it casts it.
 * @param {{ register: Register, fileSchema: typeof import('./cloud/common.mjs').FILE, identity: Identity | null,
 *   downloadFile: typeof import('./cloud/common.mjs').downloadHostFile, fetcher: typeof fetch }} options
 */
export function registerFileInputProbe({ register, fileSchema, identity, downloadFile, fetcher }) {
  register(
    'verify_creator_file_input',
    '제작 파일 전달 확인',
    'Verify delivery of one user-selected existing PNG through the official host file input. Downloads at most 4 MiB into server memory, measures actual bytes and SHA-256, and compares them to the supplied original identity. Requires the user’s request to send this file to ODDBOUT. Does not persist, generate, register or publish a character. Never invent file IDs or URLs; use an actual host file attachment. A successful receipt verifies this server input only, not Library-to-VM recovery.',
    { file: fileSchema, expectedBytes: z.number().int().min(33).max(FILE_PROBE_LIMIT), expectedSha256: z.string().regex(/^[a-f0-9]{64}$/) },
    async ({ file, expectedBytes, expectedSha256 }) => {
      const receiptId = crypto.randomUUID(),
        receivedAt = new Date().toISOString();
      let bytes;
      try {
        bytes = await downloadFile(file, FILE_PROBE_LIMIT, fetcher, OBSERVED_PROBE_HOSTS);
      } catch (error) {
        return {
          ok: false,
          stage: 'file-input-download',
          receiptId,
          receivedAt,
          code: error instanceof Problem ? error.message : 'file-download-unavailable',
          ...(error instanceof Problem && error.message === 'unsupported-file-origin' ? { rejectedOrigin: rejectedOrigin(file.download_url) } : {}),
        };
      }
      const actualSha256 = await sha256(bytes);
      const receipt = {
        receiptId,
        receivedAt,
        accountId: /** @type {Identity} */ (identity).owner,
        inputCapability: 'openai/fileParams',
        bytes: bytes.length,
        sha256: actualSha256,
        matchesExpectedBytes: bytes.length === expectedBytes,
        matchesExpectedSha256: actualSha256 === expectedSha256,
        persisted: false,
        registered: false,
        libraryToVmVerified: false,
      };
      let png;
      try {
        png = pngHeader(bytes);
      } catch (/** @type {any} */ error) {
        return { ok: false, stage: 'file-input-format', code: error.message, ...receipt };
      }
      const matches = receipt.matchesExpectedBytes && receipt.matchesExpectedSha256;
      return {
        ok: matches,
        stage: matches ? 'file-input-verified' : 'file-input-identity-mismatch',
        ...(!matches ? { code: 'file-identity-mismatch' } : {}),
        ...receipt,
        mimeType: 'image/png',
        png,
      };
    },
    { files: ['file'], openWorld: true, diagnostic: true },
  );
}
