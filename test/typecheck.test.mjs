import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Keep the strict-check coverage contract aligned with tsconfig.json, including broadcast runtimes.
const CHECKED = ['api', 'broadcast', 'worker', 'mcp', 'scripts'];

test('every module tsc covers opts into type checking', async () => {
  assert.deepEqual(JSON.parse(await readFile(new URL('../tsconfig.json', import.meta.url), 'utf8')).include, CHECKED.map(dir => `${dir}/**/*.mjs`));
  const unchecked = [];
  for (const dir of CHECKED)
    for (const name of (await readdir(new URL(`../${dir}/`, import.meta.url), { recursive: true })).filter(name => name.endsWith('.mjs')))
      if (!/^(?:#![^\n]*\n)?\/\/ @ts-check\r?\n/.test(await readFile(new URL(`../${dir}/${name}`, import.meta.url), 'utf8'))) unchecked.push(`${dir}/${name}`);
  assert.deepEqual(unchecked, []);
});

test('the game repository\'s byte copies are type-checked without a marker (tsconfig.vendored.json: checkJs)', async () => {
  // contracts/ and server/ are pinned byte copies (contracts/ai-fighter/SOURCE.json), so they cannot start with `// @ts-check`. A second config
  // turns checkJs on for them instead; the game repository checks the same files under its own tsconfig.server.json, where the types are written.
  const config = JSON.parse(await readFile(new URL('../tsconfig.vendored.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.include, ['contracts/**/*.mjs', 'server/**/*.mjs']);
  assert.equal(config.compilerOptions.checkJs, true);
  assert.equal(config.extends, './tsconfig.json');
});

test('Deno checks api/ at the same strictness as tsc, in every Edge function', async () => {
  // Deno honours // @ts-check too: `deno check supabase/functions/<name>/index.ts` reads these files with that function's
  // deno.json. Only ai-fighter's was aligned at first; ai-fighter-mcp checked them under Deno's default until 2026-10-29.
  const read = async file => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8')).compilerOptions;
  assert.equal((await read('tsconfig.json')).strict, true);
  const functions = (await readdir(new URL('../supabase/functions/', import.meta.url), { withFileTypes: true })).filter(entry => entry.isDirectory());
  for (const { name } of functions) {
    const file = `supabase/functions/${name}/deno.json`;
    if (await readFile(new URL(`../${file}`, import.meta.url)).then(() => true, () => false)) assert.deepEqual(await read(file), { strict: true }, file);
  }
});

test('tsc finds no type errors in api/, broadcast/, worker/, mcp/, scripts/, contracts/ and server/ under strict (npm run typecheck)', () => {
  for (const config of ['tsconfig.json', 'tsconfig.vendored.json']) {
    const run = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', config], { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 0, config + '\n' + run.stdout + run.stderr);
  }
});
