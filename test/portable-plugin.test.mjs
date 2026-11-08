import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { commitRuntime } from '../plugins/ai-fighter/launcher.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = data => createHash('sha256').update(data).digest('hex');
async function fixture(t) {
  const scratch = path.join(root, 'output', `portable-test-${randomUUID()}`);
  const plugin = path.join(scratch, 'plugin');
  await mkdir(path.join(plugin, 'runtime'), { recursive: true });
  t.after(() => rm(scratch, { recursive: true, force: true }));
  for (const file of ['launcher.mjs', 'local-files.mjs']) await cp(path.join(root, 'plugins', 'ai-fighter', file), path.join(plugin, file));
  const data = 'export const fixture = true;\n';
  await writeFile(path.join(plugin, 'runtime', 'entry.mjs'), data);
  const manifest = { platform: process.platform, arch: process.arch, files: { 'entry.mjs': sha(data) } };
  const save = () => writeFile(path.join(plugin, 'runtime-manifest.json'), JSON.stringify(manifest));
  await save();
  const { initialize } = await import(pathToFileURL(path.join(plugin, 'launcher.mjs')).href);
  return { scratch, plugin, initialize, manifest, save, base: path.join(scratch, 'user-data'), data };
}

test('portable startup copies verified bundled bytes and preserves the user workspace across versions', async t => {
  const f = await fixture(t);
  const first = await f.initialize({ base: f.base });
  assert.equal(await readFile(path.join(first.runtime, 'entry.mjs'), 'utf8'), f.data);
  assert.equal(first.root, path.join(f.base, 'workspace'));
  await writeFile(path.join(first.root, 'my-project.txt'), 'keep');
  await writeFile(path.join(first.runtime, 'local-setup.txt'), 'keep venv');
  assert.deepEqual(await f.initialize({ base: f.base }), first);
  assert.equal(await readFile(path.join(first.runtime, 'local-setup.txt'), 'utf8'), 'keep venv');
  f.manifest.version = 'next';
  await f.save();
  const second = await f.initialize({ base: f.base });
  assert.notEqual(first.runtime, second.runtime);
  assert.equal(second.root, first.root);
  assert.equal(await readFile(path.join(second.root, 'my-project.txt'), 'utf8'), 'keep');
});

test('portable startup rejects corrupt files, unsupported platforms and paths outside the bundle', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.plugin, 'runtime', 'entry.mjs'), 'modified');
  await assert.rejects(f.initialize({ base: f.base }), /integrity check failed/);
  f.manifest.platform = 'unsupported';
  await f.save();
  await assert.rejects(f.initialize({ base: f.base }), /bundle requires/);
  f.manifest.platform = process.platform;
  f.manifest.files = { '../outside': sha('ignored') };
  await f.save();
  await assert.rejects(f.initialize({ base: f.base }), /Invalid bundled path/);
  await assert.rejects(f.initialize({ base: 'relative' }), /absolute directory/);
});

test('source distribution extracts on the host without native dependencies or a desktop platform requirement', async t => {
  const f = await fixture(t);
  f.manifest.distribution = 'source';
  f.manifest.platform = 'any';
  f.manifest.arch = 'any';
  await f.save();
  const result = await f.initialize({ base: f.base });
  assert.equal(result.distribution, 'source');
  assert.equal(result.registration, 'oddbout-cloud');
  assert.equal(await readFile(path.join(result.runtime, 'entry.mjs'), 'utf8'), f.data);
  await assert.rejects(readFile(path.join(result.runtime, 'node_modules', 'package.json')), { code: 'ENOENT' });
});

test('launcher reads its own normal Codex plugin cache but refuses cache writes and credential locations', async t => {
  const f = await fixture(t),
    cached = path.join(f.scratch, '.codex/plugins/cache/oddbout/0.5.5');
  await cp(f.plugin, cached, { recursive: true });
  const launcher = await import(pathToFileURL(path.join(cached, 'launcher.mjs')).href);
  const installed = await launcher.initialize({ base: f.base });
  assert.equal(await readFile(path.join(installed.runtime, 'entry.mjs'), 'utf8'), f.data);
  await assert.rejects(launcher.initialize({ base: cached }), /Protected location/);
  await assert.rejects(launcher.initialize({ base: path.join(f.scratch, '.codex/sessions') }), /Protected location/);
  await assert.rejects(launcher.initialize({ base: f.base, workspace: path.join(f.scratch, '.grok') }), /Protected location/);
  const worktree = path.join(f.scratch, '.codex/worktrees/task/repo');
  assert.equal((await launcher.initialize({ base: f.base, workspace: worktree })).root, worktree);
});

test('Windows scanner locks retry only the atomic install rename; permanent and unrelated failures propagate', async t => {
  const f = await fixture(t),
    marker = path.join(f.scratch, 'absent-marker');
  let calls = 0;
  const delays = [];
  await commitRuntime('pending', 'target', marker, {
    platform: 'win32',
    wait: async ms => delays.push(ms),
    move: async (source, target) => {
      assert.deepEqual([source, target], ['pending', 'target']);
      if (++calls < 3) throw Object.assign(Error('busy'), { code: 'EPERM' });
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [100, 200]);
  calls = 0;
  await assert.rejects(
    commitRuntime('pending', 'target', marker, {
      platform: 'win32',
      wait: async () => {},
      move: async () => {
        calls++;
        throw Object.assign(Error('locked'), { code: 'EPERM' });
      },
    }),
    /locked/,
  );
  assert.equal(calls, 7);
  calls = 0;
  await assert.rejects(
    commitRuntime('pending', 'target', marker, {
      platform: 'win32',
      wait: async () => assert.fail('no retry'),
      move: async () => {
        calls++;
        throw Object.assign(Error('disk'), { code: 'ENOSPC' });
      },
    }),
    /disk/,
  );
  assert.equal(calls, 1);
});
