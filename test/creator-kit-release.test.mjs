import assert from 'node:assert/strict';
import test from 'node:test';
import { includeVendorFile } from '../scripts/build-plugin-bundle.mjs';
import { releaseMetadata } from '../scripts/prepare-creator-release.mjs';

test('source bundle omits only upstream documentation media, preserving execution, workflow and license files', () => {
  assert.equal(includeVendorFile('docs/assets/village-scene.gif'), false);
  assert.equal(includeVendorFile('docs/assets/subdirectory/example.png'), false);
  for (const name of [
    'LICENSE',
    'NOTICE',
    'SKILL.md',
    'README.md',
    'pyproject.toml',
    'docs/pose-motion.md',
    'docs/assets-guide.md',
    'sprite_gen/serve/curator/assets/image.png',
    'sprite_gen/audio/tts.mjs',
  ])
    assert.equal(includeVendorFile(name), true, name);
});

test('release identity binds the helper and archive, with no mutable latest URL or maintainer paths', () => {
  const archive = { name: 'oddbout', version: '0.4.0', bytes: 1234, sha256: 'a'.repeat(64), runtimeManifestSha256: 'b'.repeat(64) };
  const first = releaseMetadata(archive, Buffer.from('helper-v1'));
  assert.deepEqual(releaseMetadata(archive, Buffer.from('helper-v1')), first);
  assert.notEqual(releaseMetadata(archive, Buffer.from('helper-v2')).relative, first.relative);
  assert.notEqual(releaseMetadata({ ...archive, sha256: 'c'.repeat(64) }, Buffer.from('helper-v1')).relative, first.relative);
  assert.match(first.manifestUrl, /^https:\/\/oddbout\.com\/creator-kit\/0\.4\.0\/[a-f0-9]{64}\/release\.json$/);
  assert.equal(first.manifest.artifact.bytes, 1234);
  assert.equal(first.manifest.bootstrap.bytes, 9);
  assert.deepEqual(JSON.parse(first.manifestBytes), first.manifest);
  assert.throws(() => releaseMetadata({ ...archive, version: '../private' }, Buffer.from('x')));
  assert.throws(() => releaseMetadata({ ...archive, bytes: 20_000_001 }, Buffer.from('x')));
});
