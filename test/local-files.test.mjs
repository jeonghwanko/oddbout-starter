import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { absoluteParts, fileSha256, isProtected, pathWithoutLinks, relativeParts, renameRetrying }
  from '../plugins/ai-fighter/local-files.mjs';

const sha = data => createHash('sha256').update(data).digest('hex');
async function scratch(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'local-files-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
// A directory link: a junction on Windows, which needs no symlink privilege and which lstat reports as a link.
const linkDirectory = (target, link) => symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');

test('relativeParts splits a clean relative path and refuses empty, absolute, dot and forbidden-character paths', () => {
  assert.deepEqual(relativeParts('output/a-work/fighter.json', /[\\:]/), ['output', 'a-work', 'fighter.json']);
  assert.deepEqual(relativeParts('a.b/c d', /[\\:]/), ['a.b', 'c d']);
  for (const value of ['', '/abs', 'a//b', 'a/', './a', 'a/./b', '../a', 'a/..', 'a\\b', 'C:/a', 'c:a', undefined, null, 7, ['a']])
    assert.equal(relativeParts(value, /[\\:]/), null, String(value));
  // Each caller names its own characters: the same path passes one policy and fails another.
  assert.deepEqual(relativeParts('a?b', /[\\:]/), ['a?b']);
  assert.equal(relativeParts('a?b', /[\\:?=#]/), null);
  assert.equal(relativeParts('a\0b', /[\\:\0]/), null);
  assert.equal(relativeParts('a\nb', /[\\:\x00-\x1f]/), null);
});

test('absoluteParts gives the filesystem root and the components that rejoin to the same path', async t => {
  const root = await scratch(t), target = path.join(root, 'a', 'b');
  const { base, parts } = absoluteParts(target);
  assert.equal(base, path.parse(target).root);
  assert.deepEqual(parts.slice(-2), ['a', 'b']);
  assert.equal(path.join(base, ...parts), target);
});

test('isProtected refuses credential and session stores in any case, admitting only Codex code namespaces', () => {
  const split = value => value.split('/');
  for (const value of ['home/u/.codex', 'home/u/.CODEX/config.toml', 'home/u/.grok/x', 'h/.aws/credentials', 'h/.ssh/id',
    'h/x/sessions/a', 'h/.ai-fighter/client.json', 'h/auth.json', 'h/Pending-Login.json', 'h/.codex/worktrees/task'])
    assert.equal(isProtected(split(value)), true, value);
  assert.equal(isProtected(split('home/u/.codex/worktrees/task/repo')), false);
  assert.equal(isProtected(split('home/u/.Codex/worktrees/task/repo/file')), false);
  // A protected name inside a worktree is still protected, and the exception is for .codex alone.
  assert.equal(isProtected(split('home/u/.codex/worktrees/task/repo/auth.json')), true);
  assert.equal(isProtected(split('home/u/.grok/worktrees/task/repo')), true);
  // The plugin cache is admitted only when the caller asks (the launcher reading its own copy).
  const cache = split('home/u/.codex/plugins/cache/oddbout/0.6.10/runtime/x.mjs');
  assert.equal(isProtected(cache), true);
  assert.equal(isProtected(cache, { pluginCache: true }), false);
  assert.equal(isProtected(split('home/u/.codex/plugins/cache'), { pluginCache: true }), true);
  assert.equal(isProtected(split('home/u/.codex/sessions/x'), { pluginCache: true }), true);
  assert.equal(isProtected(split('home/u/project/output/a.json')), false);
});

test('pathWithoutLinks joins below a base, passes over missing components and returns null at a link', async t => {
  const root = await scratch(t);
  await mkdir(path.join(root, 'real', 'deep'), { recursive: true });
  assert.equal(await pathWithoutLinks(root, ['real', 'deep']), path.join(root, 'real', 'deep'));
  assert.equal(await pathWithoutLinks(root, ['real', 'missing', 'more']), path.join(root, 'real', 'missing', 'more'));
  await assert.rejects(pathWithoutLinks(root, ['real', 'missing'], { allowMissing: false }), { code: 'ENOENT' });
  await linkDirectory(path.join(root, 'real'), path.join(root, 'link'));
  assert.equal(await pathWithoutLinks(root, ['link']), null);
  assert.equal(await pathWithoutLinks(root, ['link', 'deep']), null);
  // Absolute paths walk from the filesystem root, so a link above the target is refused too.
  const { base, parts } = absoluteParts(path.join(root, 'link', 'deep'));
  assert.equal(await pathWithoutLinks(base, parts), null);
});

test('pathWithoutLinks lets a visitor create a missing component or refuse one, before the link check', async t => {
  const root = await scratch(t), seen = [];
  const made = await pathWithoutLinks(root, ['new', 'child'], { visit: async (target, info, index) => {
    seen.push([index, info === null]);
    if (!info && index === 0) { await mkdir(target); return lstat(target); }
    return info;
  } });
  assert.equal(made, path.join(root, 'new', 'child'));
  assert.deepEqual(seen, [[0, true], [1, true]]);
  assert.ok((await lstat(path.join(root, 'new'))).isDirectory());
  await writeFile(path.join(root, 'file'), 'x');
  await assert.rejects(pathWithoutLinks(root, ['file', 'child'], { visit: async (target, info, index) => {
    if (info && index === 0 && !info.isDirectory()) throw Error('not-a-directory');
    return info;
  } }), /not-a-directory/);
});

test('renameRetrying retries only Windows scanner holds, waiting longer each time, and gives up after six retries', async () => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    let calls = 0; const waits = [];
    await renameRetrying('from', 'to', { platform: 'win32', wait: async ms => waits.push(ms),
      move: async (from, to) => { assert.deepEqual([from, to], ['from', 'to']); if (++calls < 4) throw Object.assign(Error('held'), { code }); } });
    assert.equal(calls, 4); assert.deepEqual(waits, [25, 50, 75]);
  }
  let calls = 0; const waits = [];
  await assert.rejects(renameRetrying('from', 'to', { platform: 'win32', stepMs: 100, wait: async ms => waits.push(ms),
    move: async () => { calls++; throw Object.assign(Error('locked'), { code: 'EPERM' }); } }), /locked/);
  assert.equal(calls, 7); assert.deepEqual(waits, [100, 200, 300, 400, 500, 600]);
  for (const [platform, code] of [['linux', 'EPERM'], ['darwin', 'EBUSY'], ['win32', 'ENOSPC'], ['win32', 'ENOENT']]) {
    calls = 0;
    await assert.rejects(renameRetrying('from', 'to', { platform, wait: async () => assert.fail('no retry'),
      move: async () => { calls++; throw Object.assign(Error(code), { code }); } }), new RegExp(code));
    assert.equal(calls, 1, `${platform} ${code}`);
  }
});

test('renameRetrying stops without an error once another process has completed the same rename', async () => {
  const exists = async () => { throw Object.assign(Error('exists'), { code: 'ENOTEMPTY' }); };
  await assert.rejects(renameRetrying('from', 'to', { platform: 'linux', done: async () => false, move: exists }), /exists/);
  await renameRetrying('from', 'to', { platform: 'linux', done: async () => true, move: exists });
  // On Windows it is asked after each hold, before waiting.
  let asked = 0; const waits = [];
  await renameRetrying('from', 'to', { platform: 'win32', done: async () => ++asked === 3, wait: async ms => waits.push(ms),
    move: async () => { throw Object.assign(Error('held'), { code: 'EBUSY' }); } });
  assert.equal(asked, 3); assert.deepEqual(waits, [25, 50]);
});

test('renameRetrying replaces the target on disk', async t => {
  const root = await scratch(t), from = path.join(root, 'next.json'), to = path.join(root, 'current.json');
  await writeFile(to, 'old'); await writeFile(from, 'new');
  await renameRetrying(from, to);
  assert.equal(await readFile(to, 'utf8'), 'new');
  await assert.rejects(lstat(from), { code: 'ENOENT' });
});

test('fileSha256 streams a file by path or from an open handle, which it leaves open', async t => {
  const root = await scratch(t), file = path.join(root, 'data.bin');
  const data = Buffer.alloc(3 * 1024 * 1024 + 17, 7); data.write('head', 0); data.write('tail', data.length - 4);
  await writeFile(file, data);
  assert.equal(await fileSha256(file), sha(data));
  const handle = await open(file, 'r');
  try {
    assert.equal(await fileSha256(handle), sha(data));
    assert.equal((await handle.stat()).size, data.length, 'the handle is still open');
  } finally { await handle.close(); }
  await writeFile(file, '');
  assert.equal(await fileSha256(file), sha(''));
  await assert.rejects(fileSha256(path.join(root, 'missing')), { code: 'ENOENT' });
});
