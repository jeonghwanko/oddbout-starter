import { readFile } from 'node:fs/promises';
import { parseFighterJson } from '../../contracts/ai-fighter/validate.mjs';
import { validateFighterPackage } from '../../server/ai-fighter-package.mjs';
import { annotateValidation } from './landmark-lint.mjs';

const args = process.argv.slice(2),
  metadataOnly = args.includes('--metadata-only');
const paths = args.filter(arg => arg !== '--metadata-only');
if (paths.length !== 1 || args.some(arg => arg.startsWith('--') && arg !== '--metadata-only')) {
  console.error('Usage: npm run validate -- <package/fighter.json> [--metadata-only]');
  process.exitCode = 2;
} else {
  const result = await validateFighterPackage(paths[0], { metadataOnly });
  let data = null;
  try {
    const parsed = parseFighterJson(await readFile(paths[0], 'utf8'));
    if (parsed.ok) data = parsed.data;
  } catch {
    data = null;
  }
  // `pending` remains later stage names. pendingStages copies them; missingAssets is empty (this command does not upload).
  const annotated = annotateValidation(result, data);
  console.log(JSON.stringify(annotated, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
