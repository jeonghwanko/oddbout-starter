// @ts-check
// Environment-neutral byte validation, shared by the server and the VM receiver.
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export class Problem extends Error {
  /** @param {number} status @param {string} code @param {any} [errors] */
  constructor(status, code, errors) {
    super(code);
    this.status = status;
    this.errors = errors;
  }
}
/** @type {(bytes: BufferSource) => Promise<string>} */
export const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
/**
 * Read at most maximum bytes even with no Content-Length or an inaccurate header.
 * @param {Request | Response} request
 * @param {number} maximum
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
export async function readBody(request, maximum) {
  if (Number(request.headers.get('content-length')) > maximum) throw new Problem(413, 'body-limit');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts = [];
  let count = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.length;
      if (count > maximum) {
        await reader.cancel();
        throw new Problem(413, 'body-limit');
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(count);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
