import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { packagingInputs } from '../mcp/packaging-tools.mjs';
import { registerPackagingPreparation } from '../mcp/cloud/packaging-tools.mjs';
import { sheetLayout } from '../tools/ai-fighter/sheet-layout.mjs';
import { packageBudget, nextPackageScale } from '../tools/ai-fighter/package-budget.mjs';
import { createCloudHandler, CLOUD_RESOURCE } from '../mcp/cloud.mjs';

test('the reported Velora totals require package-wide reduction and the search respects its floor', () => {
  const limits = { assetBytes: 4_000_000, packageAssetBytes: 10_000_000, imagePixels: 16_777_216, packagePixels: 33_554_432 };
  const budget = packageBudget(Array.from({ length: 6 }, (_, index) => ({ id: `sheet-${index}`, bytes: 4_550_646 + (index === 5 ? 4 : 0),
    width: 2048, height: 4096 })), limits);
  // Separate package totals reported by Dots from this synthetic sheet layout.
  const pressure = Math.max(27_303_880 / limits.packageAssetBytes, 84_983_946 / limits.packagePixels);
  assert.equal(budget.fits, false);
  assert.ok(budget.assets.every(asset => asset.pixels === asset.width * asset.height));
  assert.ok(nextPackageScale(1, pressure, .25) < Math.sqrt(33_554_432 / 84_983_946));
  assert.equal(nextPackageScale(.26, 50, .25), .25);
  assert.equal(nextPackageScale(.25, 2, .25), null);
  assert.equal(nextPackageScale(.5, 1, .25), null);
});

test('the 57-frame blocker needs resolution fitting, not byte compression or a different grid', () => {
  const result = sheetLayout(57, 550, 699, { dimension: 4096, grid: 8, frame: 1024, margin: 8, minScale: .25 });
  assert.equal(result.fits, false);
  assert.deepEqual([result.repair.columns, result.repair.rows], [8, 8]);
  assert.ok(result.repair.scale > .7 && result.repair.scale < .74);
});

test('native cloud preparation is public, names actual workspace execution, and does not claim a package', async () => {
  const handler = createCloudHandler({ db: {} });
  const response = await handler(new Request(CLOUD_RESOURCE, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'prepare_fighter_packaging',
      arguments: { workspacePath: '/workspace', kitPath: '/kit', planPath: 'plan.json',
        outputPath: 'output/velora-work/artifacts/fit', fitSheets: true, outputScale: .9 } } }) }));
  assert.equal(response.status, 200);
  const result = (await response.json()).result.structuredContent;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.stage, 'workspace-execution-required');
  assert.equal(result.minimumKitVersion, result.runtime.version);
  assert.match(result.runtime.manifestSha256, /^[a-f0-9]{64}$/);
  assert.ok(result.runtime.manifestUrl.startsWith(`https://oddbout.com/creator-kit/${result.minimumKitVersion}/`));
  assert.deepEqual(result.operations.map(operation => operation.tool), ['inspect_fighter_packaging', 'pack_fighter_package']);
  assert.equal(result.runtimeDirectory, '/kit/runtime');
  assert.deepEqual(result.dependencyInstall, { command: 'npm', args: ['ci', '--ignore-scripts'], cwd: '/kit/runtime' });
  assert.equal(result.operations[1].execution.args[0], '/kit/runtime/scripts/creation-tool.mjs');
  assert.equal(result.operations[1].execution.argumentsFileContents.fitSheets, true);
  assert.equal(result.operations[1].execution.argumentsFileContents.outputScale, .9);
  assert.match(result.recovery.packageBudget, /actual encoded bytes/);
  assert.equal(result.fighterId, undefined);
});

test('cloud preparation refuses resolution fitting against an older deployed contract', async () => {
  let run;
  registerPackagingPreparation({ register: (_name, _title, _description, _schema, action) => { run = action; },
    invoke: async () => ({ ok: true, data: { features: [] } }) });
  const result = await run({ workspacePath: '/workspace', kitPath: '/kit', planPath: 'plan.json',
    outputPath: 'output/velora-work/artifacts/fit', fitSheets: true });
  assert.equal(result.code, 'server-feature-missing');
  assert.equal(result.operations, undefined);
});

test('workspace packaging confines nested files and output; selected versions cannot be overwritten', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'packaging-access-'));
  try {
    await mkdir(path.join(root, 'source'));
    await writeFile(path.join(root, 'source/image.webp'), 'fixture');
    const pack = { textures: [{ image: 'image.webp', frames: { frame: { frame: { w: 10, h: 10 } } } }],
      animations: { idle: { frames: ['frame'] } } };
    const plan = { gamePack: 'source/game-pack.json', out: 'output/fighter-work/artifacts/new', motions: { idle: { animation: 'idle' } } };
    await writeFile(path.join(root, 'source/game-pack.json'), JSON.stringify(pack));
    await writeFile(path.join(root, 'plan.json'), JSON.stringify(plan));
    assert.equal((await packagingInputs(root, { planPath: 'plan.json' })).inputPixels, 100);
    for (const outputPath of ['../outside', 'output/fighter-work/versions/skill/v1', 'output/fighter-work/artifacts/../versions/new'])
      await assert.rejects(packagingInputs(root, { planPath: 'plan.json', outputPath }));
    pack.textures[0].image = '../../outside.webp';
    await writeFile(path.join(root, 'source/game-pack.json'), JSON.stringify(pack));
    await assert.rejects(packagingInputs(root, { planPath: 'plan.json' }), /path-not-allowed/);
    pack.textures[0].image = 'image.webp';
    await writeFile(path.join(root, 'source/game-pack.json'), JSON.stringify(pack));
    await symlink(path.join(root, 'source'), path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    plan.gamePack = 'linked/game-pack.json';
    await writeFile(path.join(root, 'plan.json'), JSON.stringify(plan));
    await assert.rejects(packagingInputs(root, { planPath: 'plan.json' }), /path-not-allowed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
