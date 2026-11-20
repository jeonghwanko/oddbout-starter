// @ts-check
// Builds one game site (docs/CREATOR-HOSTING.md#game-sites). The game repository's `npm run publish:game` runs it without Cloudflare
// credentials: node scripts/build-game-site.mjs <kaito_web> <forge|pudding|bounce> <empty-output-directory>
import { buildGameSite, parseBuildGameSiteArgs } from './game-site.mjs';

const { source, game, output } = parseBuildGameSiteArgs(process.argv.slice(2));
const release = await buildGameSite({ source, game, output });
console.log(JSON.stringify({ output, ...release, checks: 'game-site-artifact-passed' }));
