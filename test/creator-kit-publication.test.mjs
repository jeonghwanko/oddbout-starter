import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPublicationTarget, auditAdditiveTree, gitBlobSha } from '../scripts/publish-creator-kit.mjs';

test('workflow migration preserves publication target checks', () => {
  const current = { cname: 'oddbout.com', source: { branch: 'codex/creator-pages', path: '/' }, build_type: 'workflow' };
  assert.doesNotThrow(() => assertPublicationTarget(current));
  assert.doesNotThrow(() => assertPublicationTarget({ ...current, build_type: 'legacy' }));
  for (const changed of [
    { cname: 'another.example' },
    { source: { branch: 'main', path: '/' } },
    { source: { branch: 'codex/creator-pages', path: '/docs' } },
    { source: undefined },
    { build_type: 'unknown' },
  ])
    assert.throws(() => assertPublicationTarget({ ...current, ...changed }), /pages-target-changed/);
});

const before = [
  { path: 'index.html', mode: '100644', type: 'blob', sha: 'homepage' },
  { path: 'deployment.json', mode: '100644', type: 'blob', sha: 'deployment' },
  { path: 'assets', mode: '040000', type: 'tree', sha: 'assets-tree' },
  { path: 'assets/game.js', mode: '100644', type: 'blob', sha: 'game' },
  { path: 'creator-kit', mode: '040000', type: 'tree', sha: 'old-releases-tree' },
  { path: 'creator-kit/previous.zip', mode: '100644', type: 'blob', sha: 'old-release' },
];
const files = ['release.json', 'fetch-creator-kit.py', 'oddbout-0.4.0.zip'].map(name => ({ path: `creator-kit/new/${name}`, gitSha: name }));
const after = [
  ...before.map(item => (item.path === 'creator-kit' ? { ...item, sha: 'new-releases-tree' } : item)),
  { path: 'creator-kit/new', mode: '040000', type: 'tree', sha: 'new-tree' },
  ...files.map(file => ({ path: file.path, type: 'blob', mode: '100644', sha: file.gitSha })),
];

test('additive release preserves site and older releases and can recognize an identical completed publication', () => {
  assert.deepEqual(auditAdditiveTree(before, after, files), {
    preservedExistingFiles: 4,
    addedFiles: files.map(file => file.path),
    modifiedOrDeletedExistingFiles: 0,
  });
  assert.equal(auditAdditiveTree(after, after, files).addedFiles.length, 0);
  assert.equal(gitBlobSha(Buffer.from('')), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
});

test('changed or deleted existing pages, assets, modes and old releases stop publication', () => {
  for (const target of ['index.html', 'assets', 'assets/game.js', 'deployment.json', 'creator-kit/previous.zip']) {
    assert.throws(
      () =>
        auditAdditiveTree(
          before,
          after.filter(entry => entry.path !== target),
          files,
        ),
      /existing-site-entry-changed/,
    );
    assert.throws(
      () =>
        auditAdditiveTree(
          before,
          after.map(entry => (entry.path === target ? { ...entry, sha: 'changed' } : entry)),
          files,
        ),
      /existing-site-entry-changed/,
    );
  }
  assert.throws(() =>
    auditAdditiveTree(
      before,
      after.map(entry => (entry.path === 'index.html' ? { ...entry, mode: '100755' } : entry)),
      files,
    ),
  );
});

test('unexpected files, nonregular release objects, wrong hashes and duplicate tree entries stop publication', () => {
  assert.throws(() => auditAdditiveTree(before, [...after, { path: 'unexpected.txt', mode: '100644', type: 'blob', sha: 'x' }], files));
  assert.throws(() => auditAdditiveTree(before, [...after, after[0]], files), /duplicate-git-tree-path/);
  for (const change of [{ sha: 'wrong' }, { mode: '120000' }, { type: 'commit' }])
    assert.throws(() =>
      auditAdditiveTree(
        before,
        after.map(entry => (entry.path === files[0].path ? { ...entry, ...change } : entry)),
        files,
      ),
    );
});
