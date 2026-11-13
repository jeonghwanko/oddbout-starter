// The progressive contact sheet (motions.py progress-sheet): key frames of finished previews, placeholders for the rest.
// Pillow and a WebP encoder are the sprite-gen venv's; a bare runner without them skips the test.
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeImage } from '../api/image-probe.mjs';

const script = path.join(import.meta.dirname, 'motions.py');
const pillow = spawnSync('python3', ['-c', 'import io\nfrom PIL import Image\nImage.new("RGB",(1,1)).save(io.BytesIO(),"WEBP")']);

test('progress-sheet samples finished clips and leaves the others as placeholders', { skip: pillow.status !== 0 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sheet-'));
  try {
    const make = spawnSync(
      'python3',
      [
        '-c',
        `
from PIL import Image
walk = [Image.new("RGBA", (40, 80), (20, 40, 200, 255)), Image.new("RGBA", (40, 80), (200, 40, 20, 255))]
walk[0].save(${JSON.stringify(path.join(dir, 'walk.webp'))}, save_all=True, append_images=walk[1:], duration=[100, 140], loop=0, format="WEBP")
Image.new("RGBA", (30, 70), (10, 180, 40, 255)).save(${JSON.stringify(path.join(dir, 'idle.webp'))}, format="WEBP")
`,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(make.status, 0, make.stderr);
    const manifest = path.join(dir, 'manifest.json');
    await writeFile(
      manifest,
      JSON.stringify({
        clips: [
          { clip: 'walk', file: path.join(dir, 'walk.webp'), state: 'checking' },
          { clip: 'idle', file: path.join(dir, 'idle.webp') },
          { clip: 'run', file: path.join(dir, 'missing.webp') },
          { clip: 'nope', file: path.join(dir, 'idle.webp') },
        ],
      }),
    );
    const out = path.join(dir, 'sheet.webp');
    const run = spawnSync('python3', [script, 'progress-sheet', manifest, out], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(await readFile(path.join(dir, 'sheet.json'), 'utf8'));
    assert.deepEqual(
      report.clips.map(clip => clip.clip),
      ['idle', 'walk', 'run', 'fightIdle', 'combo', 'slam', 'dash', 'block', 'hit', 'groggy', 'fall'],
    );
    assert.deepEqual(
      report.clips.find(clip => clip.clip === 'walk'),
      { clip: 'walk', status: 'checking', frames: 2, durationMs: 240 },
    );
    assert.deepEqual(
      report.clips.find(clip => clip.clip === 'idle'),
      { clip: 'idle', status: 'ready', frames: 1 },
    );
    assert.equal(report.clips.find(clip => clip.clip === 'run').status, 'pending');
    assert.equal(report.clips.find(clip => clip.clip === 'fall').status, 'pending');
    const image = probeImage(await readFile(out));
    assert.equal(image?.type, 'image/webp');
    // 11 rows, three key-frame boxes. A still this small is what the connector inlines.
    assert.equal(image.width, 104 + 4 + 3 * (72 + 4));
    assert.equal(image.height, 11 * (72 + 20));
    assert.ok((await readFile(out)).length < 200_000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
