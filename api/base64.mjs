// @ts-check
// Native base64 for Deno and Node. bytes.mjs and http.mjs stay free of Node imports; Buffer enters here only.
import { Buffer } from 'node:buffer';

/**
 * The padded text btoa gives, without a binary JS string or a callback per byte. Anything but a Uint8Array goes through
 * `new Uint8Array(bytes)` as before: an ArrayBuffer is read as bytes, another typed array as its element values.
 * @param {ArrayBuffer | ArrayLike<number>} bytes
 */
export function encodeBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('base64');
}

/**
 * atob's grammar (WHATWG forgiving-base64): Buffer alone also takes base64url, stray characters and a bad tail.
 * Returns a Uint8Array that owns its whole ArrayBuffer, like the old atob path: a small result Buffer carves from its
 * shared pool is copied out; a large one is wrapped without a copy.
 * @param {string} text
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function decodeBase64(text) {
  let data = text.replace(/[\t\n\f\r ]+/g, '');
  if (data.length % 4 === 0) data = data.replace(/={1,2}$/, '');
  if (data.length % 4 === 1 || !/^[A-Za-z0-9+/]*$/.test(data)) throw new SyntaxError('invalid-base64');
  const decoded = Buffer.from(data, 'base64');
  return decoded.byteOffset === 0 && decoded.buffer.byteLength === decoded.byteLength
    ? new Uint8Array(/** @type {ArrayBuffer} */ (decoded.buffer))
    : new Uint8Array(decoded);
}
