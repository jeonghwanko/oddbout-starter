import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reviewOnServer } from './generation-stages.mjs';
import { createApi } from './generation-worker.mjs';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

test('the host sends only bounded evidence via its worker identity, with no OpenAI setting', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'server-review-'));
  let calls = 0;
  try {
    const file = path.join(dir, 'frame.png');
    await writeFile(file, 'fixture pixels');
    const job = { id: 'job-id', leaseToken: 'lease', decisionsReview: { mode: 'shadow' } };
    const api = createApi({
      base: 'https://oddbout.example/api',
      key: 'worker-test-credential',
      fetcher: async (url, init) => {
        calls++;
        assert.equal(url, 'https://oddbout.example/api/generation-worker/jobs/job-id/decisions');
        assert.equal(init.headers.authorization, 'Bearer worker-test-credential');
        assert.equal(init.headers['x-generation-lease'], 'lease');
        assert.equal(init.redirect, 'error');
        const body = JSON.parse(init.body);
        assert.deepEqual(Object.keys(body), ['stage', 'scope', 'images']);
        assert.ok(!init.body.includes(dir));
        assert.match(body.images[0].sha256, /^[a-f0-9]{64}$/);
        return Response.json({ ok: true, review: { status: 'completed', advisory: true, visualApproval: false } });
      },
    });
    const args = { api, job, dir, stage: 'pose', scope: 'look-a', images: [{ file, role: 'candidate', durationMs: 100 }] };
    assert.equal((await reviewOnServer(args)).status, 'completed');
    assert.equal((await reviewOnServer(args)).status, 'completed');
    assert.equal(calls, 1);
    assert.equal(await reviewOnServer({ ...args, job: { ...job, decisionsReview: { mode: 'off' } } }), null);
    const record = await readFile(path.join(dir, 'decisions', (await readdir(path.join(dir, 'decisions')))[0]), 'utf8');
    assert.ok(!record.includes('credential') && !record.includes('data:image'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a lost server reply cannot cause a second dispatch or a generation failure', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'review-timeout-'));
  let calls = 0;
  try {
    const file = path.join(dir, 'frame.png');
    await writeFile(file, 'pixels');
    const args = {
      api: {
        decisions: async () => {
          calls++;
          throw Error('timeout');
        },
      },
      job: { decisionsReview: { mode: 'shadow' } },
      dir,
      stage: 'pose',
      scope: 'look-a',
      images: [{ file, role: 'candidate', durationMs: 100 }],
    };
    assert.equal((await reviewOnServer(args)).status, 'unverified');
    assert.equal((await reviewOnServer(args)).status, 'request_started');
    assert.equal(calls, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const python = path.join(import.meta.dirname, '..', 'vendor/sprite-gen/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
test('review evidence extracts the exact final pack pixels and unequal timings', { skip: !existsSync(python) }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'review-pixels-'));
  try {
    const sharp = (await import('sharp')).default;
    const pixels = Buffer.alloc(16 * 4 * 4);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 16; x++) {
        const p = (y * 16 + x) * 4;
        pixels[p] = x * 15;
        pixels[p + 1] = y * 40;
        pixels[p + 3] = 255;
      }
    await sharp(pixels, { raw: { width: 16, height: 4, channels: 4 } })
      .png()
      .toFile(path.join(dir, 'sheet.png'));
    const durations = Array.from({ length: 16 }, (_, i) => 60 + i),
      names = durations.map((_, i) => `f${i}`);
    await writeFile(
      path.join(dir, 'game-pack.json'),
      JSON.stringify({
        textures: [{ image: 'sheet.png', frames: Object.fromEntries(names.map((k, i) => [k, { frame: { x: i, y: 0, w: 1, h: 4 } }])) }],
        animations: { idle: { frames: ['f0'], durations_ms: [100] }, walk: { frames: names, durations_ms: durations } },
      }),
    );
    await promisify(execFile)(python, [
      '-I',
      path.join(import.meta.dirname, 'motions.py'),
      'decision-frames',
      path.join(dir, 'game-pack.json'),
      'walk',
      path.join(dir, 'evidence'),
    ]);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'evidence', 'durations.json'), 'utf8')), durations);
    for (let i = 0; i < 16; i++) {
      const got = await sharp(path.join(dir, 'evidence', `frame-${i}.png`))
        .raw()
        .toBuffer();
      const expected = Buffer.concat(Array.from({ length: 4 }, (_, y) => pixels.subarray((y * 16 + i) * 4, (y * 16 + i + 1) * 4)));
      assert.deepEqual(got, expected);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
