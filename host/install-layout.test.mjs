import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HOST_FILES, installFiles } from '../scripts/host.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// A host runs host/'s files from one flat bin folder. On 2026-10-29 a worker that imported ../mcp/ restarted in a loop on
// office-stable: node --check and the tests in the checkout had both passed.
test('the modules a host installs load from the flat bin folder they run in', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-layout-'));
  await installFiles(root, here);
  const bin = path.join(root, 'bin');
  assert.deepEqual((await readdir(bin)).sort(), [...HOST_FILES].sort());
  // The style anchor is a picture: installed byte for byte (a text install would strip a \r before a \n in it).
  assert.deepEqual(await readFile(path.join(bin, 'style-anchor-front.webp')), await readFile(path.join(here, 'style-anchor-front.webp')));
  // generation-worker.mjs starts the worker when loaded; it imports nothing of its own but generation-stages.mjs and the usage meter.
  assert.deepEqual(localImports(await readFile(path.join(bin, 'generation-worker.mjs'), 'utf8')), ['./generation-stages.mjs', './codex-usage.mjs']);
  for (const name of HOST_FILES.filter(name => name.endsWith('.mjs') && name !== 'generation-worker.mjs')) {
    await import(pathToFileURL(path.join(bin, name)).href);
  }
});

// og.mjs (a host's og on Windows and macOS, 2026-11-05) runs from the same flat folder: it may import only what a host installs. The
// worker never imports it (ODDBOUT's own PC runs bash og and has no og.mjs); og.mjs hands itself to the worker instead.
test('og.mjs loads from the flat bin folder beside the files a host installs, and the worker does not need it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-layout-og-'));
  await installFiles(root, here);
  const bin = path.join(root, 'bin');
  await copyFile(path.join(here, 'og.mjs'), path.join(bin, 'og.mjs'));
  for (const name of localImports(await readFile(path.join(bin, 'og.mjs'), 'utf8'))) assert.ok(HOST_FILES.includes(name.slice(2)), `og.mjs imports ${name}`);
  const og = await import(pathToFileURL(path.join(bin, 'og.mjs')).href);
  assert.equal(typeof og.createOg, 'function');
  // The test above pins the worker's static imports; nor may it load og.mjs later.
  assert.doesNotMatch(await readFile(path.join(bin, 'generation-worker.mjs'), 'utf8'), /import\(\s*['"`][^'"`]*og\.mjs/);
});

test('og self-update carries every file a host installs', async () => {
  const og = await readFile(path.join(here, 'og'), 'utf8');
  const lists = {
    pack: og.match(/tar -C "\$here" -c ([^|]+)\|/)[1],
    unpack: og.match(/tar -x -C "\$tmp" ([^\n]+)/)[1],
    install: og.match(/install -m 640 ([^\n]+) "\$HERE\/"/)[1].replaceAll('"$tmp/', '').replaceAll('"', ''),
  };
  for (const [step, list] of Object.entries(lists)) {
    const names = list.trim().split(/\s+/);
    for (const name of HOST_FILES.filter(name => name !== 'og')) assert.ok(names.includes(name), `og self-update ${step} misses ${name}`);
  }
});

function localImports(source) {
  return [...source.matchAll(/^import [^;]*? from '(\.[^']+)';/gm)].map(match => match[1]);
}
