import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import invalid from '../contracts/ai-fighter/v1/invalid-examples.json' with { type: 'json' };
import { schema, spec } from '../contracts/ai-fighter/v1/contract-source.mjs';
import { parseFighterJson, validateFighter, toSidePreviewPack } from '../contracts/ai-fighter/validate.mjs';
import { validateFighterPackage } from '../server/ai-fighter-package.mjs';
import { createExample } from '../scripts/create-example.mjs';
const clone = () => structuredClone(example);
const hasCode = (result, code) => {
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(e => e.code === code),
    JSON.stringify(result),
  );
};
let temporary, directory, manifest;
before(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'fighter-test-'));
  directory = path.join(temporary, 'package');
  await cp(new URL('../examples/sparring-bot/', import.meta.url), directory, { recursive: true });
  manifest = path.join(directory, 'fighter.json');
});
after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

test('published schema, spec and fixture match their source', async () => {
  for (const [name, value] of [
    ['fighter.schema.json', schema],
    ['spec.json', spec],
    ['example.fighter.json', example],
  ])
    assert.deepEqual(JSON.parse(await readFile(new URL(`../contracts/ai-fighter/v1/${name}`, import.meta.url))), value);
  assert.deepEqual(JSON.parse(await readFile(manifest)), example);
});
test('a valid manifest is immutable and never approved', () => {
  const input = clone(),
    before = JSON.stringify(input),
    result = validateFighter(input);
  assert.equal(result.ok, true);
  assert.equal(before, JSON.stringify(input));
  assert.ok(result.pending.includes('server-registration'));
  assert.equal(toSidePreviewPack(input).adopted.runtimeApproved, false);
});
for (const failure of invalid)
  test(failure.description, () => {
    const input = clone(),
      leaf = failure.path.slice(0, -1).reduce((node, key) => node[key], input);
    leaf[failure.path.at(-1)] = failure.value;
    hasCode(validateFighter(input), failure.expectedCode);
  });
test('all eleven motions are required, and a gait frame count stays inside its range', () => {
  for (const name of Object.keys(spec.motions)) {
    const data = clone();
    delete data.clips[name];
    hasCode(validateFighter(data), 'SCHEMA_REQUIRED');
  }
  const data = clone();
  data.clips.walk.frames.splice(spec.gaitFrames.walk.min - 1);
  data.clips.walk.origins.splice(spec.gaitFrames.walk.min - 1);
  hasCode(validateFighter(data), 'SCHEMA_MINITEMS');
  // gait-frames-1: a walk or run at the count it was filmed in (fewer than the standard here) is taken.
  const own = clone();
  own.clips.run.frames.splice(spec.gaitFrames.run.min);
  own.clips.run.origins.splice(spec.gaitFrames.run.min);
  assert.equal(validateFighter(own).ok, true);
});
test('duplicate names, IDs, paths, and prototype-shaped fields cannot override state', () => {
  hasCode(parseFighterJson('{"a":1,"\\u0061":2}'), 'DUPLICATE_MEMBER');
  hasCode(parseFighterJson('{"a":[{"b":1,"b":2}]}'), 'DUPLICATE_MEMBER');
  for (const key of ['__proto__', 'constructor', 'approved', 'ownerId']) {
    const text = JSON.stringify(example).replace('{', `{${JSON.stringify(key)}:{"approved":true},`);
    hasCode(validateFighter(parseFighterJson(text).data), 'SCHEMA_ADDITIONALPROPERTIES');
  }
  let data = clone();
  data.assets[1].id = data.assets[0].id;
  hasCode(validateFighter(data), 'DUPLICATE_ASSET_ID');
  data = clone();
  data.assets[1].path = data.assets[0].path;
  hasCode(validateFighter(data), 'DUPLICATE_ASSET_PATH');
});
test('parser rejects excessive size, depth and invalid syntax; accepts legitimate nested objects', () => {
  hasCode(parseFighterJson(' '.repeat(spec.limits.jsonBytes + 1)), 'JSON_TOO_LARGE');
  hasCode(parseFighterJson('['.repeat(33) + '0' + ']'.repeat(33)), 'JSON_TOO_DEEP');
  hasCode(parseFighterJson('{'), 'INVALID_JSON');
  assert.equal(parseFighterJson('{"a":{"x":1},"b":{"x":2}}').ok, true);
});
test('aggregate budgets, crop bounds, timing and borrowed frames are checked', () => {
  let data = clone();
  data.assets.forEach(a => {
    a.bytes = spec.limits.assetBytes;
  });
  hasCode(validateFighter(data), 'PACKAGE_BYTE_LIMIT');
  data = clone();
  data.assets.forEach(a => {
    a.width = a.height = 4096;
  });
  hasCode(validateFighter(data), 'PACKAGE_PIXEL_LIMIT');
  data = clone();
  data.profile.portrait.crop.x = 4096;
  hasCode(validateFighter(data), 'CROP_OUT_OF_BOUNDS');
  data = clone();
  data.clips.combo.hitSequenceIndices.reverse();
  hasCode(validateFighter(data), 'CONTACT_ORDER');
  data = clone();
  data.clips.hit.landmarks.recover = [1, 2];
  hasCode(validateFighter(data), 'HIT_PHASE_ORDER');
  data = clone();
  data.clips.dash.landmarks.windup.frame = 63;
  hasCode(validateFighter(data), 'BORROWED_FRAME');
  data = clone();
  data.clips.fall.landmarks.getUp = Array.from({ length: 8 }, () => ({ clip: 'fall', frame: 0, durationMs: 2000 }));
  hasCode(validateFighter(data), 'GET_UP_DURATION_LIMIT');
});
test('texture keys distinguish shared clips, revised content and grid geometry', () => {
  const data = clone(),
    unused = data.clips.groggy.assetId;
  data.clips.groggy = structuredClone(data.clips.fightIdle);
  data.assets = data.assets.filter(a => a.id !== unused);
  const pack = toSidePreviewPack(data);
  assert.notEqual(pack.directions.side.groggy.key, pack.directions.side.fightIdle.key);
  const first = pack.directions.side.idle.key;
  data.assets[0].sha256 = '0'.repeat(64);
  assert.notEqual(first, toSidePreviewPack(data).directions.side.idle.key);
});
test('the original fixture fully decodes; a fresh fixture works without proprietary assets', async () => {
  assert.equal((await validateFighterPackage(manifest)).ok, true);
  const fresh = path.join(temporary, 'fresh');
  await createExample(fresh);
  assert.equal((await validateFighterPackage(path.join(fresh, 'fighter.json'))).ok, true);
  await assert.rejects(createExample(fresh), { code: 'EEXIST' });
});
test('metadata pass does not imply file existence or a valid UTF-8 manifest', async () => {
  const absent = path.join(temporary, 'fighter.json');
  await writeFile(absent, JSON.stringify(example));
  assert.equal((await validateFighterPackage(absent, { metadataOnly: true })).ok, true);
  hasCode(await validateFighterPackage(absent), 'ASSET_READ_OR_DECODE');
  await writeFile(absent, Buffer.from([0xff]));
  hasCode(await validateFighterPackage(absent), 'JSON_READ');
  await writeFile(absent, Buffer.alloc(spec.limits.jsonBytes + 1));
  hasCode(await validateFighterPackage(absent), 'JSON_FILE_LIMIT');
});
test('hash tampering, fake formats, truncation, empty or opaque art and blank crops fail', async () => {
  const asset = example.assets[0],
    location = path.join(directory, asset.path),
    original = await readFile(location);
  try {
    const changed = Buffer.from(original);
    changed[changed.length - 1] ^= 1;
    await writeFile(location, changed);
    hasCode(await validateFighterPackage(manifest), 'ASSET_HASH');
    const variants = [
      [await sharp(original).resize(1, 1).webp().toBuffer(), 'ASSET_DIMENSIONS'],
      [await sharp(original).png().toBuffer(), 'ASSET_ENCODING'],
      [original.subarray(0, 32), 'ASSET_READ_OR_DECODE'],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="512"/>'), 'ASSET_ENCODING'],
      [
        await sharp({ create: { width: asset.width, height: asset.height, channels: 4, background: '#00000000' } })
          .webp()
          .toBuffer(),
        'ASSET_ALPHA',
      ],
      [
        await sharp({ create: { width: asset.width, height: asset.height, channels: 3, background: '#ffffff' } })
          .webp()
          .toBuffer(),
        'ASSET_ENCODING',
      ],
    ];
    for (const [bytes, code] of variants) {
      const data = clone();
      data.assets[0].bytes = bytes.length;
      data.assets[0].sha256 = createHash('sha256').update(bytes).digest('hex');
      await writeFile(location, bytes);
      await writeFile(manifest, JSON.stringify(data));
      hasCode(await validateFighterPackage(manifest), code);
    }
    await writeFile(location, original);
    const data = clone();
    data.profile.portrait.crop = { x: 0, y: 0, width: 1, height: 1 };
    await writeFile(manifest, JSON.stringify(data));
    hasCode(await validateFighterPackage(manifest), 'EMPTY_PROFILE_CROP');
  } finally {
    await writeFile(location, original);
    await writeFile(manifest, JSON.stringify(example));
  }
});
test('a blank used frame fails even when the rest of the sheet contains art', async () => {
  const index = example.assets.findIndex(asset => asset.id === 'walk'),
    asset = example.assets[index];
  const location = path.join(directory, asset.path),
    original = await readFile(location),
    clip = example.clips.walk;
  try {
    const { data, info } = await sharp(original).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let y = 0; y < clip.frameHeight; y++) for (let x = 0; x < clip.frameWidth; x++) data[(y * info.width + x) * 4 + 3] = 0;
    const bytes = await sharp(data, { raw: info }).webp().toBuffer(),
      input = clone();
    input.assets[index].bytes = bytes.length;
    input.assets[index].sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(location, bytes);
    await writeFile(manifest, JSON.stringify(input));
    hasCode(await validateFighterPackage(manifest), 'EMPTY_FRAME');
  } finally {
    await writeFile(location, original);
    await writeFile(manifest, JSON.stringify(example));
  }
});
test('vendored contract files are the pinned byte copies of the game repository', async () => {
  const { contractDrift, readSource } = await import('../tools/ai-fighter/vendored-contract.mjs');
  assert.deepEqual(await contractDrift(), []);
  assert.match((await readSource()).verifiedAgainst.commit, /^[a-f0-9]{40}$/);
});
