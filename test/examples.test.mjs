// examples/overtime-king is a real registered package kept as a reading example (examples/sparring-bot is the geometric fixture).
// It must keep passing the contract, and the numbers its README quotes must stay the contract's and the manifest's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = new URL('../examples/overtime-king/', import.meta.url);
const read = async name => readFile(new URL(name, dir), 'utf8');
const grouped = value => value.toLocaleString('en-US');

test('examples/overtime-king: the package passes the full validation, files included', () => {
  const done = spawnSync(process.execPath, ['tools/ai-fighter/validate-package.mjs', 'examples/overtime-king/fighter.json'], { cwd: root, encoding: 'utf8' });
  const result = JSON.parse(done.stdout);
  assert.deepEqual([done.status, result.ok, result.stage, result.errors, result.missingAssets], [0, true, 'bytes-hashes-and-full-decode', [], []]);
});

test("examples/overtime-king: the README's limits are the contract's and its frame counts the manifest's", async () => {
  const [readme, manifest, spec] = await Promise.all([
    read('README.md'),
    read('fighter.json').then(JSON.parse),
    readFile(new URL('../contracts/ai-fighter/v1/spec.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);
  const { limits, motions, gaitFrames, input } = spec;
  for (const key of ['imagePixels', 'assetBytes', 'packageAssetBytes', 'packagePixels', 'jsonBytes', 'clipDurationMs'])
    assert.ok(readme.includes(grouped(limits[key])), `${key} ${limits[key]}`);
  assert.ok(readme.includes(`${limits.imageDimension} pixels on its longest side`));
  assert.ok(readme.includes(`${limits.assetCount} sheets`));
  assert.ok(readme.includes(`| \`walk\` | One walk cycle, feet taking turns | ${gaitFrames.walk.min}–${gaitFrames.walk.max} frames`));
  assert.ok(readme.includes(`| \`run\` | One run cycle | ${gaitFrames.run.min}–${gaitFrames.run.max} frames`));
  assert.ok(readme.includes(`a standing body ${input.bodyHeight} pixels tall`));
  assert.equal(manifest.appearance.bodyHeight, input.bodyHeight);
  // Every required clip has a row, and the row ends with the example's own frame count.
  for (const clip of Object.keys(motions)) {
    const row = readme.split('\n').find(line => line.startsWith(`| \`${clip}\` |`));
    assert.ok(row, `a row for ${clip}`);
    assert.match(/** @type {string} */ (row).split('|').at(-2) ?? '', new RegExp(`^ ${manifest.clips[clip].frames.length}\\b`), clip);
  }
  assert.ok(readme.includes(`and ${manifest.assets.length} sprite sheets`));
  assert.deepEqual(
    Object.keys(manifest.clips)
      .filter(clip => !(clip in motions))
      .sort(),
    ['entrance', 'skill', 'victory'],
  );
});

test('examples/overtime-king: the artwork carries its own licence, credited to ODDBOUT', async () => {
  const licence = await read('LICENSE.md');
  assert.match(licence, /creativecommons\.org\/licenses\/by\/4\.0\//);
  assert.match(licence, /by ODDBOUT \(https:\/\/oddbout\.com\), CC BY 4\.0/);
  assert.match(await read('README.md'), /\[LICENSE\.md\]\(LICENSE\.md\)/);
});
