// @ts-check
import { requestSitePublication } from './site-publication.mjs';
const [sha, option, ...extra] = process.argv.slice(2);
if (!sha || extra.length || (option && !['--preview', '--preview-first'].includes(option)))
  throw Error('Usage: npm run site:republish -- <current-publication-sha> [--preview | --preview-first]');
await requestSitePublication(sha, { preview: option === '--preview', previewFirst: option === '--preview-first' });
