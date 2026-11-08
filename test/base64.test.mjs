import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { decodeBase64, encodeBase64 } from '../api/base64.mjs';
import { base64, unbase64 } from '../api/creator-source-crypto.mjs';

// The codecs the server used before Buffer: the reference every case below is held to.
const legacyDecode = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const legacyEncode = bytes => btoa(Array.from(new Uint8Array(bytes), b => String.fromCharCode(b)).join(''));
const outcome = (decode, text) => {
  try {
    return Array.from(decode(text));
  } catch {
    return 'rejected';
  }
};

test('encoding matches btoa for every length and for ArrayBuffer, offset views and empty input', () => {
  for (let length = 0; length <= 70; length++) {
    const bytes = new Uint8Array(randomBytes(length));
    assert.equal(encodeBase64(bytes), legacyEncode(bytes), `length ${length}`);
    assert.equal(encodeBase64(bytes.buffer), legacyEncode(bytes), `ArrayBuffer ${length}`);
  }
  const whole = new Uint8Array(randomBytes(40)),
    view = whole.subarray(7, 29);
  assert.equal(encodeBase64(view), legacyEncode(view));
  assert.equal(base64(view), legacyEncode(view));
  // Element values, as `new Uint8Array(typedArray)` gave: 300 wraps to 44, and a Uint16Array is not read as raw bytes.
  for (const other of [new Uint16Array([1, 2, 300]), new Int8Array([-1, 5]), Buffer.from([7, 8, 9])]) assert.equal(encodeBase64(other), legacyEncode(other));
});

test('decoding accepts and rejects exactly what atob does, including tails, padding, whitespace and base64url', () => {
  const fixed = [
    '',
    'A',
    'AA',
    'AAA',
    'AAAA',
    'AA=',
    'AA==',
    'AAA=',
    'AAA==',
    'AAAA=',
    'AAAA==',
    'A===',
    'AB==',
    'AB=A',
    '=AAA',
    'QQ',
    'QR',
    'QR==',
    'QUJD',
    'QUJD\n',
    ' QU JD ',
    'QU\tJD',
    'QUJD\v',
    'Q-_D',
    'QUJ!',
    'QUJD====',
    '====',
    'QUJDRA',
    'QUJDRA=',
    'QUJDRA==',
  ];
  for (const text of fixed) assert.deepEqual(outcome(decodeBase64, text), outcome(legacyDecode, text), JSON.stringify(text));
  // Seeded noise over the alphabet, padding, whitespace and the characters Buffer would otherwise accept.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=  \n-_!';
  let seed = 7;
  const next = n => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  for (let i = 0; i < 4000; i++) {
    const text = Array.from({ length: next(14) }, () => alphabet[next(alphabet.length)]).join('');
    assert.deepEqual(outcome(decodeBase64, text), outcome(legacyDecode, text), JSON.stringify(text));
  }
  for (let length = 0; length <= 70; length++) {
    const bytes = new Uint8Array(randomBytes(length)),
      text = legacyEncode(bytes);
    assert.deepEqual(decodeBase64(text), bytes);
    assert.deepEqual(decodeBase64(text.replace(/=+$/, '')), bytes);
  }
});

test("decoded bytes own their memory, never a view into Buffer's shared pool", () => {
  const bytes = decodeBase64('QUJD');
  assert.equal(Object.getPrototypeOf(bytes), Uint8Array.prototype);
  assert.equal(bytes.byteOffset, 0);
  assert.equal(bytes.buffer.byteLength, 3);
  assert.deepEqual(bytes.slice(0, 1), new Uint8Array([65]));
  const large = new Uint8Array(randomBytes(70000)),
    decoded = decodeBase64(legacyEncode(large));
  assert.equal(Object.getPrototypeOf(decoded), Uint8Array.prototype);
  assert.equal(decoded.byteOffset, 0);
  assert.equal(decoded.buffer.byteLength, large.length);
  assert.deepEqual(decoded, large);
});

test('the source envelope keeps its own grammar on top of the codec', () => {
  assert.deepEqual(unbase64('QUJD'), new Uint8Array([65, 66, 67]));
  assert.deepEqual(unbase64('QUI'), new Uint8Array([65, 66]));
  for (const text of ['QU JD', 'Q-_D', 'QUJD=', 'Q']) assert.throws(() => unbase64(text), /invalid-envelope/);
});
