import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };

test('the validation CLI preserves the size rejection without an unbounded warning read', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fighter-validation-cli-'));
  try {
    const manifest = path.join(directory, 'fighter.json');
    await writeFile(manifest, ' '.repeat(spec.limits.jsonBytes + 1));
    const preload = `import fs from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      const original = fs.readFile;
      fs.readFile = (...args) => {
        if (String(args[0]).endsWith('fighter.json')) {
          process.stderr.write('unbounded-manifest-read');
          throw new Error('unbounded-manifest-read');
        }
        return original(...args);
      };
      syncBuiltinESMExports();`;
    const script = fileURLToPath(new URL('../tools/ai-fighter/validate-package.mjs', import.meta.url));
    const run = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, script, manifest], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.equal(JSON.parse(run.stdout).errors[0].code, 'JSON_FILE_LIMIT');
    assert.doesNotMatch(run.stderr, /unbounded-manifest-read/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the validation CLI still reports optional landmark warnings on a valid package', () => {
  const script = fileURLToPath(new URL('../tools/ai-fighter/validate-package.mjs', import.meta.url));
  const manifest = fileURLToPath(new URL('../examples/sparring-bot/fighter.json', import.meta.url));
  const run = spawnSync(process.execPath, [script, manifest], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some(warning => warning.code === 'BORROWED_LANDMARK'));
  assert.deepEqual(result.pendingStages, result.pending);
});
