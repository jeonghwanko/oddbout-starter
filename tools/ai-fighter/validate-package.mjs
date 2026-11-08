import { validateFighterPackage } from '../../server/ai-fighter-package.mjs';

const args = process.argv.slice(2),
  metadataOnly = args.includes('--metadata-only');
const paths = args.filter(arg => arg !== '--metadata-only');
if (paths.length !== 1 || args.some(arg => arg.startsWith('--') && arg !== '--metadata-only')) {
  console.error('Usage: npm run validate -- <package/fighter.json> [--metadata-only]');
  process.exitCode = 2;
} else {
  const result = await validateFighterPackage(paths[0], { metadataOnly });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
