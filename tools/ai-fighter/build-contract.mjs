import { readFile, writeFile } from 'node:fs/promises';
import { schema, spec } from '../../contracts/ai-fighter/v1/contract-source.mjs';

const check = process.argv.includes('--check');
for (const [file, value] of [
  ['fighter.schema.json', schema],
  ['spec.json', spec],
]) {
  const target = new URL(`../../contracts/ai-fighter/v1/${file}`, import.meta.url);
  const text = JSON.stringify(value, null, 2) + '\n';
  if (check) {
    if ((await readFile(target, 'utf8')).replace(/\r\n/g, '\n') !== text) throw new Error(`${file} is stale; run npm run spec:build`);
  } else await writeFile(target, text);
}
console.log(check ? 'AI Fighter contract artifacts are current.' : 'AI Fighter contract artifacts written.');
