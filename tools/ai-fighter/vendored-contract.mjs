// The contract validator and package checker are byte copies of the game repository's files.
// contracts/ai-fighter/SOURCE.json pins their hashes, so a local edit or a missed re-copy is visible.
//   --check            local files match the pins (npm test runs this)
//   --compare <dir>    the game's kaito_web/ folder holds the same bytes (run after the game changes the contract)
//   --pin              record the current local hashes after copying new files from the game
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const sourceFile = path.join(repository, 'contracts/ai-fighter/SOURCE.json');
const hash = async file =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');

export async function readSource() {
  return JSON.parse(await readFile(sourceFile, 'utf8'));
}

/** Files whose bytes differ from the pins (or from the game folder when given). */
export async function contractDrift({ gameRoot } = {}) {
  const source = await readSource(),
    drift = [];
  for (const [local, entry] of Object.entries(source.files)) {
    const actual = await hash(path.join(repository, local));
    const expected = gameRoot ? await hash(path.join(gameRoot, entry.upstream)).catch(() => 'missing') : entry.sha256;
    if (actual !== expected) drift.push({ file: local, upstream: entry.upstream, expected, actual });
  }
  return drift;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [mode, gameRoot] = process.argv.slice(2);
  if (mode === '--pin') {
    const source = await readSource();
    for (const [local, entry] of Object.entries(source.files)) entry.sha256 = await hash(path.join(repository, local));
    await writeFile(sourceFile, JSON.stringify(source, null, 2) + '\n');
    console.log('Pinned vendored contract hashes. Record the game commit in verifiedAgainst.');
  } else if (mode === '--check' || (mode === '--compare' && gameRoot)) {
    const drift = await contractDrift(mode === '--compare' ? { gameRoot: path.resolve(gameRoot) } : {});
    console.log(JSON.stringify({ ok: drift.length === 0, mode, drift }, null, 2));
    process.exitCode = drift.length ? 1 : 0;
  } else {
    console.error('Usage: npm run contract:vendored -- --check | --compare <game kaito_web folder> | --pin');
    process.exitCode = 2;
  }
}
