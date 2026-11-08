import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fingerprint } from '../mcp/creation-store.mjs';

test('a reused hash never hides a rewrite, even one that keeps the size and restores the mtime', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'fighter-hash-')));
  try {
    const file = path.join(root, 'evidence.txt');
    await writeFile(file, 'aaaa');
    const first = await fingerprint(root, 'evidence.txt');
    assert.deepEqual(await fingerprint(root, 'evidence.txt'), first, 'unchanged file, same answer');
    const before = await stat(file);
    await delay(20);
    await writeFile(file, 'bbbb'); // same size
    await utimes(file, before.atime, before.mtime); // and the old mtime put back
    const second = await fingerprint(root, 'evidence.txt');
    assert.notEqual(second.sha256, first.sha256);
    assert.equal(second.bytes, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
