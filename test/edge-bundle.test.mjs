import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { edgeFiles, importSpecifiers } from '../scripts/edge-bundle.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
let temporary;
before(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'fighter-edge-'));
});
after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

test('the Edge bundle holds every module the entry imports and nothing Node-only', async () => {
  const files = await edgeFiles();
  for (const required of [
    'api/handler.mjs',
    'api/http.mjs',
    'api/duels.mjs',
    'api/fighter-statistics.mjs',
    'api/account.mjs',
    'api/creator-link.mjs',
    'contracts/ai-fighter/validate.mjs',
    'contracts/ai-fighter/v1/spec.json',
    'contracts/ai-fighter/v1/fighter.schema.json',
    'supabase/functions/ai-fighter/duel-engine.mjs',
    'supabase/functions/ai-fighter/duel-engines.mjs',
    'supabase/functions/ai-fighter/release.mjs',
  ])
    assert.ok(files.includes(required), required);
  assert.ok(
    files.every(file => !/^(server|mcp|scripts|worker)\//.test(file)),
    JSON.stringify(files),
  );
  for (const file of files) await access(path.join(repository, file));
  const config = JSON.parse(await readFile(path.join(repository, 'supabase/functions/ai-fighter/deno.json'), 'utf8'));
  // Deno supplies this builtin; it is explicitly mapped for the native base64 codec (api/base64.mjs).
  assert.equal(config.imports['node:buffer'], 'node:buffer');
});
test("every Edge function's import map provides what its bundle imports, not only ai-fighter's", async () => {
  // ai-fighter-mcp lacked node:buffer for api/base64.mjs until #114 (2026-10-29): only the game's MCP deploy plan walked its bundle.
  // A function without an import map may not import a bare specifier at all.
  const functions = (await readdir(path.join(repository, 'supabase/functions'), { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
  assert.ok(
    ['ai-fighter', 'ai-fighter-mcp'].every(name => functions.includes(name)),
    JSON.stringify(functions),
  );
  for (const name of functions) {
    const base = `supabase/functions/${name}`;
    if (
      await access(path.join(repository, base, 'deno.json')).then(
        () => true,
        () => false,
      )
    ) {
      for (const file of await edgeFiles({ entry: `${base}/index.ts`, importMap: `${base}/deno.json`, lock: `${base}/deno.lock` }))
        await access(path.join(repository, file));
    } else {
      const bare = importSpecifiers(await readFile(path.join(repository, base, 'index.ts'), 'utf8')).filter(specifier => !specifier.startsWith('.'));
      assert.deepEqual(bare, [], name);
    }
  }
});
test('an import the Edge runtime cannot resolve fails before deploy', async () => {
  await mkdir(path.join(temporary, 'fn'));
  await writeFile(path.join(temporary, 'fn', 'deno.json'), JSON.stringify({ imports: { ajv: 'npm:ajv@6.15.0' } }));
  await writeFile(path.join(temporary, 'fn', 'index.ts'), "import { decode } from './decode.mjs';\n");
  await writeFile(path.join(temporary, 'fn', 'decode.mjs'), "import sharp from 'sharp';\nexport const decode = sharp;\n");
  await assert.rejects(edgeFiles({ root: temporary, entry: 'fn/index.ts', importMap: 'fn/deno.json', lock: 'fn/deno.lock' }), /sharp/);
});
test('edge-bundle.mjs stands alone: the game deploy stages only this file of scripts/', async () => {
  // crashbang-heroes tools/deploy/ai-fighter-edge.mjs copies api/, contracts/, the function folder and this one script.
  const { importSpecifiers } = await import('../scripts/edge-bundle.mjs');
  const source = await (await import('node:fs/promises')).readFile(path.join(repository, 'scripts/edge-bundle.mjs'), 'utf8');
  assert.deepEqual(
    importSpecifiers(source).filter(specifier => !specifier.startsWith('node:')),
    [],
  );
});

test('the CLI cannot emit a deployable payload with the starter null engine', async () => {
  const script = path.join(repository, 'scripts/edge-bundle.mjs');
  const blocked = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(blocked.status, 1);
  assert.equal(blocked.stdout, '');
  assert.match(blocked.stderr, /npm run fighter:edge -- plan/);
  const listing = spawnSync(process.execPath, [script, '--list'], { encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr);
  assert.deepEqual(JSON.parse(listing.stdout), await edgeFiles());
});
