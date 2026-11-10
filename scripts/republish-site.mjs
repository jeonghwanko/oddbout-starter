// @ts-check
import { requestSitePublication } from './site-publication.mjs';
const [sha, option, ...extra] = process.argv.slice(2);
if (!sha || extra.length || (option && option !== '--preview')) throw Error('Usage: npm run site:republish -- <current-publication-sha> [--preview]');
await requestSitePublication(sha, { preview: option === '--preview' });
