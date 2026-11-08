import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectGrokAuthStorage } from '../scripts/dots-auth-storage.mjs';
import { nextAction } from '../scripts/dots-start.mjs';

async function fixture(t) {
  const home = await mkdtemp(path.join(tmpdir(), 'oddbout-auth-metadata-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}
test('missing official directory is checked without creating files or claiming a saved login', async t => {
  const home = await fixture(t),
    before = await readdir(home);
  const result = await inspectGrokAuthStorage({ env: {}, home });
  assert.equal(result.status, 'permission-available');
  assert.equal(result.reason, 'grok-auth-storage-creatable');
  assert.equal(result.loginSaveVerified, false);
  assert.deepEqual(await readdir(home), before);
});
test('read-only filesystem stops startup before offering another device login', async t => {
  const home = await fixture(t);
  const result = await inspectGrokAuthStorage(
    { env: {}, home },
    {
      checkAccess: async () => {
        throw Object.assign(Error('synthetic-secret'), { code: 'EROFS' });
      },
    },
  );
  assert.equal(result.reason, 'grok-auth-storage-not-writable');
  assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
  const action = nextAction({
    blockers: ['grok-generation-and-delivery-unverified'],
    auth: { status: 'sign-in-required', storage: result },
    recovery: { blockers: [], sessions: [] },
  });
  assert.equal(action.actor, 'environment-preparer');
  assert.equal(action.action, 'prepare-private-grok-auth-storage');
  assert.equal(action.command, undefined);
});
test('an explicit absolute official override is inspected without touching authentication', async t => {
  const home = await fixture(t),
    target = path.join(home, 'user-private');
  await mkdir(target, { mode: 0o700 });
  const auth = path.join(target, 'auth.json');
  await writeFile(auth, 'synthetic-secret');
  const result = await inspectGrokAuthStorage({ env: { GROK_HOME: target }, home });
  assert.equal(result.status, 'permission-available');
  assert.equal(JSON.stringify(result).includes(target), false);
  assert.equal(await readFile(auth, 'utf8'), 'synthetic-secret');
  assert.deepEqual(await readdir(target), ['auth.json']);
});
test('blank, relative and other protected credential-store overrides are refused', async t => {
  const home = await fixture(t);
  for (const value of ['', 'relative', path.join(home, '.codex'), path.join(home, '.ssh')]) {
    const result = await inspectGrokAuthStorage({ env: { GROK_HOME: value }, home });
    assert.equal(result.status, 'blocked');
  }
});
test('a file in place of the Grok directory is refused', async t => {
  const home = await fixture(t);
  await writeFile(path.join(home, '.grok'), 'synthetic-secret');
  assert.equal((await inspectGrokAuthStorage({ env: {}, home })).reason, 'grok-auth-storage-path-unsafe');
});
test('symlinked auth directories are not followed', { skip: process.platform === 'win32' }, async t => {
  const home = await fixture(t),
    target = path.join(home, 'private');
  await mkdir(target);
  await symlink(target, path.join(home, '.grok'));
  assert.equal((await inspectGrokAuthStorage({ env: {}, home })).reason, 'grok-auth-storage-path-unsafe');
});
test('unknown inspection errors do not produce a login command or leak their text', async t => {
  const home = await fixture(t);
  const storage = await inspectGrokAuthStorage(
    { env: {}, home },
    {
      metadata: async () => {
        throw Error('synthetic-secret');
      },
    },
  );
  const action = nextAction({ auth: { status: 'sign-in-required', storage } });
  assert.equal(storage.status, 'unknown');
  assert.equal(action.command, undefined);
  assert.equal(JSON.stringify({ storage, action }).includes('synthetic-secret'), false);
});
