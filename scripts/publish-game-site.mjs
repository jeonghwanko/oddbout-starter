// @ts-check
// Publishes a built game site to its Cloudflare Pages project `oddbout-<game>` (docs/CREATOR-HOSTING.md#game-sites). The game repository's
// `npm run publish:game` runs it after its own guards:
//   node scripts/publish-game-site.mjs <forge|pudding|bounce> <built-directory> [--dry-run] [--preview]
// Environment: CLOUDFLARE_ACCOUNT_ID, ODDBOUT_GAME_ORIGIN (https://<game>.oddbout.com) and, to upload, CLOUDFLARE_API_TOKEN (the shell's,
// or this checkout's ignored .env like the ODDBOUT site's publisher). `--dry-run` checks the files and prints the plan; nothing is uploaded.
import assert from 'node:assert/strict';
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deployPagesDirectory, validateCloudflareFiles } from './cloudflare-publication.mjs';
import { checkGameOrigin, gamePublicationTarget, gameSiteFiles, parsePublishGameSiteArgs, verifyGameArtifact } from './game-site.mjs';
import { verifyServedFiles, waitForJson } from './hosting-lib.mjs';
import { cloudflareFetch, loadPublicationEnvironment } from './site-publication.mjs';

const { game, output, dryRun, preview } = parsePublishGameSiteArgs(process.argv.slice(2));
await loadPublicationEnvironment();
const target = gamePublicationTarget(process.env, { game, preview });
const release = await verifyGameArtifact(output, { game, origin: target.origin });
// No `_headers`, `_redirects`, `_routes.json`, `_worker.js` or `functions`: a game site is static files only.
const uploadFiles = await validateCloudflareFiles(output);
const plan = {
  game,
  project: target.project,
  branch: target.branch,
  environment: preview ? 'preview' : 'production',
  origin: target.origin,
  sourceCommit: release.sourceCommit,
  hostingCommit: release.hostingCommit,
  buildId: release.buildId,
  uploadFiles,
  bytes: release.bytes,
};
if (dryRun) {
  console.log(JSON.stringify({ status: 'verified-only', ...plan }));
  process.exit(0);
}
if (!target.token) throw new Error('CLOUDFLARE_API_TOKEN is not set: nothing was uploaded. Set a token with Pages edit access and publish again.');

const parent = await realpath(tmpdir());
const temporary = await mkdtemp(join(parent, 'oddbout-game-site-'));
try {
  // Upload a private copy, checked again, so the caller's folder cannot change between the check and the upload.
  const site = join(temporary, 'site');
  await cp(output, site, { recursive: true, errorOnExist: true, force: false });
  assert.deepEqual(await verifyGameArtifact(site, { game, origin: target.origin }), release, 'The game site changed while preparing the upload');
  await validateCloudflareFiles(site);
  const base = await deployPagesDirectory({
    site,
    project: target.project,
    branch: target.branch,
    commit: release.sourceCommit,
    account: target.account,
    preview,
    cwd: temporary,
  });
  await waitForJson(
    new URL('deployment.json', base),
    body => body.buildId === release.buildId && body.sourceCommit === release.sourceCommit && body.game === game,
  );
  await verifyServedFiles(site, await gameSiteFiles(site), { siteUrl: base, request: cloudflareFetch() });
  console.log(JSON.stringify({ status: 'cloudflare-verified', url: base, ...plan }));
  if (!preview) {
    const domain = await checkGameOrigin(target.origin, release);
    console.log(JSON.stringify({ status: domain.status === 'live' ? 'live' : 'published-domain-unverified', origin: target.origin, message: domain.message }));
  }
} finally {
  const real = await realpath(temporary);
  // biome-ignore lint/correctness/noUnsafeFinally: a temporary folder outside its parent is never removed, whatever the publish did
  if (dirname(real) !== parent || !real.startsWith(join(parent, 'oddbout-game-site-'))) throw new Error('Unsafe temporary directory');
  await rm(real, { recursive: true, force: true });
}
