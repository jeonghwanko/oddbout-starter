import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { walkPlan, loadSequence, alphaBounds } from '../tools/ai-fighter/gait.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const python = path.join(root, 'vendor/sprite-gen/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const installed = await access(python).then(
  () => true,
  () => false,
);

test('official game-pack preserves vertical travel of full-canvas external frames', { skip: !installed }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gait-flight-'));
  try {
    const originals = [];
    for (const [i, bottom] of [70, 60, 70].entries()) {
      const data = Buffer.alloc(64 * 80 * 4);
      for (let y = bottom - 40; y < bottom; y++)
        for (let x = 25; x < 39; x++) {
          const at = (y * 64 + x) * 4;
          data[at] = 100 + i;
          data[at + 3] = 255;
        }
      originals.push(data);
      await sharp(data, { raw: { width: 64, height: 80, channels: 4 } })
        .png()
        .toFile(path.join(dir, `${i}.png`));
    }
    await writeFile(
      path.join(dir, 'run.asset.json'),
      JSON.stringify({ kind: 'sprite-gen-asset', version: 1, anchor: [32, 70], frames: [0, 1, 2].map(i => ({ file: `${i}.png`, duration: 0.1 })) }),
    );
    await writeFile(
      path.join(dir, 'game.json'),
      JSON.stringify({ version: 1, assets: [{ id: 'run', source: 'run.asset.json', display: { height: 80 }, resample: 'nearest' }] }),
    );
    const packed = spawnSync(python, ['-m', 'sprite_gen.cli', 'game-pack', '--request', path.join(dir, 'game.json'), '--out-dir', path.join(dir, 'pack')], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120_000,
      env: { ...process.env, PYTHONUTF8: '1' },
    });
    assert.equal(packed.status, 0, packed.stdout + packed.stderr);
    const result = await loadSequence({ file: 'pack/game-pack.json', animation: 'run' }, dir);
    assert.deepEqual(
      result.frames.map(f => alphaBounds(f).bottom),
      [70, 60, 70],
    );
    assert.deepEqual(result.durations, [100, 100, 100]);
    result.frames.forEach((f, i) => {
      assert.deepEqual(f.data, originals[i]);
    });
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
});
test('real bundled inspect-motion verifies both known fixture tracks and rejects a vertical jump', { skip: !installed }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gait-engine-'));
  try {
    // Deliberately simple measurement fixture. It is not character artwork or a publishable fighter.
    const tiles = [],
      rects = [];
    for (let i = 0; i < 16; i++) {
      const data = Buffer.alloc(64 * 80 * 4);
      const box = (x, y, w, h, red) => {
        for (let yy = y; yy < y + h; yy++)
          for (let xx = x; xx < x + w; xx++) {
            const at = (yy * 64 + xx) * 4;
            data[at] = red;
            data[at + 1] = i + 50;
            data[at + 3] = 255;
          }
      };
      box(30, 10, 5, 40, 80);
      box(i < 8 ? 48 - 4 * i : 16 + 4 * (i - 8), i < 8 ? 66 : 52, 8, 4, 200);
      box(i < 8 ? 16 + 4 * i : 48 - 4 * (i - 8), i < 8 ? 52 : 66, 8, 4, 100);
      tiles.push({
        input: await sharp(data, { raw: { width: 64, height: 80, channels: 4 } })
          .png()
          .toBuffer(),
        left: i * 64,
        top: 0,
      });
      rects.push({ x: i * 64, y: 0, w: 64, h: 80 });
    }
    await sharp({ create: { width: 1024, height: 80, channels: 4, background: '#0000' } })
      .composite(tiles)
      .png()
      .toFile(path.join(dir, 'fixture.png'));
    await writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        sprite_sheet_alpha: 'fixture.png',
        frame_layout: { rows: { walk: rects } },
        animation: { rows: { walk: { durations_ms: Array(16).fill(100) } } },
      }),
    );
    const plan = walkPlan();
    plan.source = { file: 'manifest.json', state: 'walk' };
    plan.geometry = { width: 64, height: 80, groundY: 70, groundTolerance: 2 };
    await writeFile(path.join(dir, 'plan.json'), JSON.stringify(plan));
    const seq = await loadSequence(plan.source, dir),
      annotation = {
        sequenceSha256: seq.sha256,
        visual: { identity: 'pass', anatomy: 'pass', alternation: 'pass', loop: 'pass', notes: 'Known-coordinate measurement fixture only.' },
        stances: [
          { foot: 'near', start: 1, end: 3, box: [30, 64, 24, 6] },
          { foot: 'far', start: 9, end: 11, box: [30, 64, 24, 6] },
        ],
      };
    await writeFile(path.join(dir, 'annotations.json'), JSON.stringify(annotation));
    const run = spawnSync(
      process.execPath,
      ['scripts/gait.mjs', 'review', path.join(dir, 'plan.json'), path.join(dir, 'review'), path.join(dir, 'annotations.json')],
      { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120_000 },
    );
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const report = JSON.parse(await readFile(path.join(dir, 'review/review.json'), 'utf8'));
    assert.equal(report.status, 'pass');
    assert.equal(report.stridePixels, 64);
    assert.ok(report.stanceReports.every(r => r.stride_verified));
    // Raise a planted foot in one snapshot and re-run the actual inspector, not a mocked verdict.
    const one = path.join(dir, 'review/measurement/2.png');
    const { data, info } = await sharp(one).raw().toBuffer({ resolveWithObject: true });
    for (let y = 66; y < 70; y++)
      for (let x = 40; x < 48; x++) {
        const from = (y * 64 + x) * 4,
          to = ((y - 2) * 64 + x) * 4;
        data.copy(data, to, from, from + 4);
        data.fill(0, from, from + 4);
      }
    await sharp(data, { raw: info })
      .png()
      .toFile(one + '.new.png');
    const descriptor = JSON.parse(await readFile(path.join(dir, 'review/measurement/sequence.json'), 'utf8'));
    descriptor.frames[2].file = '2.png.new.png';
    await writeFile(path.join(dir, 'review/measurement/jump.json'), JSON.stringify(descriptor));
    const inspect = spawnSync(
      python,
      [
        '-m',
        'sprite_gen.cli',
        'inspect-motion',
        '--source',
        path.join(dir, 'review/measurement/jump.json'),
        '--contacts',
        '1:3',
        '--foot-box',
        '30,62,24,8',
        '--facing',
        'right',
        '--out',
        path.join(dir, 'jump.json'),
      ],
      { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120_000, env: { ...process.env, PYTHONUTF8: '1' } },
    );
    assert.equal(inspect.status, 0, inspect.stdout + inspect.stderr);
    const failed = JSON.parse(await readFile(path.join(dir, 'jump.json'), 'utf8'));
    assert.equal(failed.stride_verified, false);
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
});
