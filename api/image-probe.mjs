// @ts-check
// A picture's kind and dimensions from its header bytes (PNG, JPEG, WebP), without decoding it. No Node-only imports: Deno and Node.
// Null when the bytes are not one of the three kinds or their header does not read.

/** @typedef {(b: Uint8Array, i: number) => number} Read */
/** @type {Read} */
const u16be = (b, i) => (b[i] << 8) | b[i + 1];
/** @type {Read} */
const u32be = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
/** @type {Read} */
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
/** @type {Read} */
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
/** @type {(b: Uint8Array, i: number, n: number) => string} */
const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));

/** @param {Uint8Array} b */
function png(b) {
  if (b.length < 24 || b[0] !== 0x89 || ascii(b, 1, 3) !== 'PNG' || ascii(b, 12, 4) !== 'IHDR') return null;
  return { type: 'image/png', ext: 'png', width: u32be(b, 16), height: u32be(b, 20) };
}

/** @param {Uint8Array} b */
function jpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  // Walk the segments to the first start-of-frame marker (SOF0-15 except DHT, JPG and DAC).
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { type: 'image/jpeg', ext: 'jpg', width: u16be(b, i + 7), height: u16be(b, i + 5) };
    i += 2 + length;
  }
  return null;
}

/** @param {Uint8Array} b */
function webp(b) {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(b, 12, 4),
    out = (/** @type {number} */ width, /** @type {number} */ height) => ({ type: 'image/webp', ext: 'webp', width, height });
  if (chunk === 'VP8X') return out(u24le(b, 24) + 1, u24le(b, 27) + 1);
  if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return out(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  if (chunk === 'VP8L' && b[20] === 0x2f) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return out((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  return null;
}

/**
 * `{ type, ext, width, height }` for a PNG, JPEG or WebP, else null.
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {{ type: string, ext: string, width: number, height: number } | null}
 */
export function probeImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return png(b) ?? jpeg(b) ?? webp(b);
}
