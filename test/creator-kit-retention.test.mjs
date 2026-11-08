import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { git, restoreCreatorKitReleases, assertCreatorKitsUnchanged } from '../scripts/hosting-lib.mjs';

test('a later whole-site deployment retains immutable kit bytes and rejects accidental edits or removals', async t => {
  const parent = await realpath(tmpdir()),
    root = await mkdtemp(path.join(parent, 'kit-retention-test-'));
  t.after(async () => {
    const target = await realpath(root);
    assert.equal(path.dirname(target), parent);
    assert.ok(path.basename(target).startsWith('kit-retention-test-'));
    await rm(target, { recursive: true, force: true });
  });
  git(root, 'init');
  git(root, 'config', 'user.name', 'Release fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'core.autocrlf', 'false');
  await mkdir(path.join(root, 'creator-kit', 'version'), { recursive: true });
  const file = path.join(root, 'creator-kit', 'version', 'kit.zip');
  const original = Buffer.from([0, 1, 10, 13, 127, 255]);
  await writeFile(file, original);
  await writeFile(path.join(root, 'index.html'), 'old site');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'fixture');
  // A --no-checkout clone has no populated index or files; emulate the relevant paths.
  git(root, 'read-tree', '--empty');
  await unlink(file);
  await writeFile(path.join(root, 'index.html'), 'new site');
  assert.equal(restoreCreatorKitReleases(root), 1);
  assert.deepEqual(await readFile(file), original);
  git(root, 'add', '-A');
  assertCreatorKitsUnchanged(root);
  assert.equal(git(root, 'diff', '--cached', '--name-only', 'HEAD'), 'index.html');
  await writeFile(file, 'changed');
  git(root, 'add', '-A');
  assert.throws(() => assertCreatorKitsUnchanged(root), /must preserve/);
  restoreCreatorKitReleases(root);
  await unlink(file);
  git(root, 'add', '-A');
  assert.throws(() => assertCreatorKitsUnchanged(root), /must preserve/);
});
