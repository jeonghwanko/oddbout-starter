import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertCommitted, checkRuntimeImports, runtimeFileList } from '../scripts/build-plugin-bundle.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
// Side-effect-free entry modules (CLI mains are guarded); importing them evaluates the whole shipped graph.
const entries = ['scripts/pack-fighter.mjs', 'scripts/gait.mjs', 'scripts/sprite-gen.mjs', 'scripts/run-creation-job.mjs',
  'scripts/dots-workspace.mjs', 'scripts/dots-start.mjs', 'scripts/dots-source.mjs',
  'scripts/creation-tool.mjs', 'scripts/check-connection.mjs', 'scripts/check-creation-delivery.mjs', 'scripts/connect-generation.mjs',
  'tools/ai-fighter/gait.mjs', 'server/ai-fighter-package.mjs', 'mcp/server.mjs'];
const shippedDocs = ['README.md', 'README.ko.md', 'docs/README.md', 'docs/START-HERE.md', 'docs/CLOUD-MCP.md',
  'docs/LOCAL-PLUGIN.md', 'docs/ODDBOUT-PLUGIN.md'];
let temporary;
before(async () => { temporary = await mkdtemp(path.join(tmpdir(), 'fighter-bundle-')); });
after(async () => { await rm(temporary, { recursive: true, force: true }); });

test('the runtime file list is closed over imports and keeps the Edge-only cloud MCP out', async () => {
  const files = await runtimeFileList();
  for (const required of ['tools/ai-fighter/projected-ground.mjs', 'tools/ai-fighter/gait.mjs', 'scripts/pack-fighter.mjs',
    'mcp/stdio.mjs', 'mcp/server.mjs', 'contracts/ai-fighter/v1/spec.json', 'server/ai-fighter-package.mjs',
    'scripts/check-cloud-discovery.mjs', 'plugins/ai-fighter/mcp.json', ...shippedDocs])
    assert.ok(files.includes(required), required);
  for (const serverOnly of ['mcp/cloud.mjs', 'mcp/cloud/common.mjs', 'mcp/cloud/hosted-tools.mjs', 'mcp/file-input-probe.mjs', 'mcp/creator-sources.mjs', 'api/handler.mjs', 'api/http.mjs'])
    assert.ok(!files.includes(serverOnly), `${serverOnly} stays out of the local kit`);
});

test('a runtime staged from the file list imports every entry module', { timeout: 60_000 }, async () => {
  const runtime = path.join(temporary, 'runtime');
  for (const file of await runtimeFileList()) {
    await mkdir(path.dirname(path.join(runtime, file)), { recursive: true });
    await cp(path.join(repository, file), path.join(runtime, file));
  }
  const pkg = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8'));
  await writeFile(path.join(runtime, 'package.json'), JSON.stringify({ type: 'module', dependencies: pkg.dependencies }));
  await checkRuntimeImports(runtime);
  // The kit installs its locked dependencies on the user's host; link this checkout's instead.
  await symlink(path.join(repository, 'node_modules'), path.join(runtime, 'node_modules'), 'junction');
  const smoke = path.join(runtime, 'smoke.mjs');
  await writeFile(smoke, entries.map(file => `await import(${JSON.stringify(pathToFileURL(path.join(runtime, file)).href)});`).join('\n'));
  const result = spawnSync(process.execPath, [smoke], { cwd: runtime, encoding: 'utf8', timeout: 45_000, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

test('a kit is built only from committed files', async () => {
  const repo = path.join(temporary, 'repo');
  await mkdir(path.join(repo, 'mcp'), { recursive: true });
  const git = (...args) => { const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 30_000 }); assert.equal(r.status, 0, r.stderr); };
  git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'test');
  await writeFile(path.join(repo, 'mcp', 'a.mjs'), 'export const a = 1;\n');
  git('add', '.'); git('commit', '-q', '-m', 'fixture');
  await assertCommitted(['mcp/a.mjs'], { sourceRoot: repo });
  await writeFile(path.join(repo, 'mcp', 'a.mjs'), 'export const a = 2;\n');
  await assert.rejects(assertCommitted(['mcp/a.mjs'], { sourceRoot: repo }), /Commit runtime changes before bundling:\n M mcp\/a\.mjs/);
  git('checkout', '-q', '--', 'mcp/a.mjs');
  await writeFile(path.join(repo, 'mcp', 'b.mjs'), 'export const b = 1;\n');
  await assert.rejects(assertCommitted(['mcp/b.mjs'], { sourceRoot: repo }), /\?\? mcp\/b\.mjs/);
});

test('a built runtime with a missing module or an undeclared package fails before zipping', async () => {
  const missing = path.join(temporary, 'missing');
  await mkdir(missing);
  await writeFile(path.join(missing, 'package.json'), JSON.stringify({ dependencies: {} }));
  await writeFile(path.join(missing, 'a.mjs'), "import { b } from './b.mjs';\nexport const a = b;\n");
  await assert.rejects(checkRuntimeImports(missing), /a\.mjs imports \.\/b\.mjs, which does not exist/);

  const undeclared = path.join(temporary, 'undeclared');
  await mkdir(undeclared);
  await writeFile(path.join(undeclared, 'package.json'), JSON.stringify({ dependencies: { zod: '1' } }));
  await writeFile(path.join(undeclared, 'a.mjs'), "import 'node:fs';\nimport { z } from 'zod';\nimport sharp from 'sharp';\nexport const a = [z, sharp];\n");
  await assert.rejects(checkRuntimeImports(undeclared), /does not depend on: sharp/);
});

test('the repository package version is the kit version', async () => {
  const pkg = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8'));
  const plugin = JSON.parse(await readFile(path.join(repository, 'plugins/ai-fighter/plugin.json'), 'utf8'));
  assert.equal(pkg.version, plugin.version, 'bump package.json together with plugins/ai-fighter/plugin.json');
  // The guide ships in the ZIP, so a stale version here is frozen into the release (0.6.5 shipped saying 0.6.4).
  const guide = await readFile(path.join(repository, 'docs/ODDBOUT-PLUGIN.md'), 'utf8');
  const named = [...guide.matchAll(/\*\*(\d+\.\d+\.\d+) 제작 키트\*\*|oddbout(?:-development)?-(\d+\.\d+\.\d+)/g)].map(m => m[1] ?? m[2]);
  assert.ok(named.length >= 4, 'docs/ODDBOUT-PLUGIN.md names the kit version and its build outputs');
  for (const version of named) assert.equal(version, plugin.version, 'bump docs/ODDBOUT-PLUGIN.md together with the kit version');
});
