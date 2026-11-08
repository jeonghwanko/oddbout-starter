import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fsp, { access, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { withFileLock } from '../mcp/file-lock.mjs';

let temporary;
before(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'fighter-lock-'));
});
after(async () => {
  await rm(temporary, { recursive: true, force: true });
});
const exists = file =>
  access(file).then(
    () => true,
    () => false,
  );
const backdate = (file, ms) => {
  const then = new Date(Date.now() - ms);
  return utimes(file, then, then);
};

test('parallel callers in one process run one at a time instead of failing', async () => {
  const file = path.join(temporary, 'queue.lock'),
    order = [];
  let inside = 0,
    most = 0;
  await Promise.all(
    [1, 2, 3].map(n =>
      withFileLock(file, async () => {
        most = Math.max(most, ++inside);
        order.push(n);
        await delay(20);
        inside--;
      }),
    ),
  );
  assert.equal(most, 1);
  assert.deepEqual(order, [1, 2, 3]);
  assert.equal(await exists(file), false, 'released after the last holder');
});

test('a fresh lock held by another process times out with the caller busy code', async () => {
  const file = path.join(temporary, 'held.lock');
  await writeFile(file, JSON.stringify({ pid: 1, token: 'other' }));
  await assert.rejects(
    withFileLock(file, async () => {}, { busy: 'session-busy', waitMs: 200 }),
    /^Error: session-busy$/,
  );
  assert.equal(JSON.parse(await readFile(file, 'utf8')).token, 'other', 'a live lock is left alone');
});

test('a lock left by a killed process is reclaimed once stale', async () => {
  const file = path.join(temporary, 'stale.lock');
  await writeFile(file, JSON.stringify({ pid: 1, token: 'dead' }));
  await backdate(file, 5000);
  assert.equal(await withFileLock(file, async () => 'ran', { staleMs: 1000, waitMs: 500 }), 'ran');
  assert.equal(await exists(file), false);
});

test('a stale reclaimer marker does not block reclamation forever', async () => {
  const file = path.join(temporary, 'reaper.lock');
  await writeFile(file, '{}');
  await writeFile(`${file}.reap`, '1');
  await backdate(file, 5000);
  await backdate(`${file}.reap`, 5000);
  assert.equal(await withFileLock(file, async () => 'ran', { staleMs: 1000, waitMs: 2000 }), 'ran');
});

test('the holder keeps its lock fresh while it works, so a long task is not reclaimed', async () => {
  const file = path.join(temporary, 'beat.lock');
  let other;
  await withFileLock(
    file,
    async () => {
      await delay(400);
      assert.ok(Date.now() - (await stat(file)).mtimeMs < 300, 'heartbeat refreshed the mtime');
      other = await withFileLock(`${file}`, async () => {}, { staleMs: 300, waitMs: 0 }).then(
        () => 'acquired',
        error => error.message,
      );
    },
    { staleMs: 300 },
  );
  assert.equal(other, 'lock-busy', 'not reclaimed and not re-entrant');
});

test("a lock that cannot be deleted on release keeps the finished task's result and is reclaimed once stale", async () => {
  const file = path.join(temporary, 'scanned.lock'),
    original = fsp.rm;
  // What a Windows scanner holding the file causes: the delete fails with EPERM.
  fsp.rm = async (target, options) => {
    if (target === file) throw Object.assign(new Error(`EPERM: operation not permitted, unlink '${file}'`), { code: 'EPERM' });
    return original(target, options);
  };
  syncBuiltinESMExports();
  try {
    assert.equal(await withFileLock(file, async () => 'done'), 'done');
  } finally {
    fsp.rm = original;
    syncBuiltinESMExports();
  }
  assert.equal(await exists(file), true, 'left behind');
  await backdate(file, 5000);
  assert.equal(await withFileLock(file, async () => 'next', { staleMs: 1000, waitMs: 500 }), 'next');
});

test('release never deletes a lock that now belongs to another holder', async () => {
  const file = path.join(temporary, 'taken.lock');
  await withFileLock(file, async () => {
    await writeFile(file, JSON.stringify({ pid: 2, token: 'next' }));
  });
  assert.equal(JSON.parse(await readFile(file, 'utf8')).token, 'next');
});
