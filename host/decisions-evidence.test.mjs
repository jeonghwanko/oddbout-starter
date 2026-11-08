import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EVIDENCE_LIMIT, fitsAsIs, pngSize, reviewOnServer } from './generation-stages.mjs';

/** A PNG header (signature + IHDR) of the given size, padded to `bytes`. */
const png = (width, height, bytes = 64) => {
  const b = Buffer.alloc(Math.max(bytes, 33));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(b);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
};
const shadow = { id: 'job-id', leaseToken: 'lease', decisionsReview: { mode: 'shadow' } };

test('a PNG within the server limits goes as it is; anything else is fitted', () => {
  assert.deepEqual(pngSize(png(1254, 1254)), { width: 1254, height: 1254 });
  assert.equal(pngSize(Buffer.from('not an image')), null);
  assert.equal(fitsAsIs(png(1254, 1254)), true);
  assert.equal(fitsAsIs(png(4096, 1024)), false);
  assert.equal(fitsAsIs(png(512, 512, EVIDENCE_LIMIT.bytes + 1)), false);
  assert.equal(fitsAsIs(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), false); // a JPEG reference
});

test('evidence past the limits is fitted once and sent; without a fitter it is refused as before', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'review-fit-')),
    sent = [],
    fitted = [];
  try {
    const big = path.join(dir, 'ref.jpg'),
      look = path.join(dir, 'look.png');
    await writeFile(big, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(EVIDENCE_LIMIT.bytes)]));
    await writeFile(look, png(1254, 1254));
    const api = {
      decisions: async (_, body) => {
        sent.push(body);
        return { ok: true, review: { status: 'completed', advisory: true, visualApproval: false } };
      },
    };
    const fit = async (from, to) => {
      fitted.push(path.basename(from));
      await writeFile(to, Buffer.from('RIFF....WEBPVP8L small'));
    };
    const images = [
      { file: big, role: 'reference' },
      { file: look, role: 'candidate', durationMs: 100 },
    ];
    assert.equal((await reviewOnServer({ api, job: shadow, dir, stage: 'pose', scope: 'look-a', images, fit })).status, 'completed');
    assert.deepEqual(fitted, ['ref.jpg']);
    assert.match(sent[0].images[0].dataUrl, /^data:image\/webp;base64,/);
    assert.match(sent[0].images[1].dataUrl, /^data:image\/png;base64,/);
    // Without a fitter (a host that cannot run the converter) the review ends unverified, sending nothing.
    const plain = await reviewOnServer({ api, job: shadow, dir, stage: 'pose', scope: 'look-b', images });
    assert.equal(plain.status, 'unverified');
    assert.equal(sent.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the server review limit is named, not reported as an outage', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'review-limit-'));
  try {
    const file = path.join(dir, 'look.png');
    await writeFile(file, png(64, 64));
    const images = [{ file, role: 'candidate', durationMs: 100 }];
    const limited = await reviewOnServer({
      api: { decisions: async () => ({ ok: false, status: 429, code: 'review-limit' }) },
      job: shadow,
      dir,
      stage: 'pose',
      scope: 'look-a',
      images,
    });
    assert.deepEqual([limited.status, limited.errorCode], ['unverified', 'review-limit']);
    const down = await reviewOnServer({
      api: { decisions: async () => ({ ok: false, status: 503, code: 'review-store-unavailable' }) },
      job: shadow,
      dir,
      stage: 'pose',
      scope: 'look-b',
      images,
    });
    assert.equal(down.errorCode, 'server-review-unavailable');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
