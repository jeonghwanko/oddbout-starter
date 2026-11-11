// @ts-check
// `npm run test:fast` runs every suite except the slow ones; `npm run test:heavy` runs only those; `npm test` runs all.
// Heavy: image packing (sharp encodes), real proxy/timeout paths, and the Python motion engines (need `npm run sprite:setup`).
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const HEAVY = ['pack', 'runtime-fetch', 'contact-evidence', 'gait-engine', 'gpt-motion', 'decisions-review', 'social-export'].map(
  name => `test/${name}.test.mjs`,
);
const root = fileURLToPath(new URL('../', import.meta.url));

const mode = process.argv[2];
if (!['fast', 'heavy'].includes(mode)) {
  console.error('Usage: node scripts/test-suite.mjs fast|heavy');
  process.exit(2);
}
// host/ keeps the generation host's tests beside its files (they travel with them to the generation PC).
const all = (
  await Promise.all(
    ['test', 'host'].map(async dir =>
      (await readdir(new URL(`../${dir}/`, import.meta.url))).filter(name => name.endsWith('.test.mjs')).map(name => `${dir}/${name}`),
    ),
  )
)
  .flat()
  .sort();
const missing = HEAVY.filter(file => !all.includes(file));
if (missing.length) {
  console.error(`Heavy suites not found (update scripts/test-suite.mjs): ${missing.join(', ')}`);
  process.exit(2);
}
const files = mode === 'heavy' ? HEAVY : all.filter(file => !HEAVY.includes(file));
const child = spawn(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
child.on('close', code => {
  process.exitCode = code ?? 1;
});
