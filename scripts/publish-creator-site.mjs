// @ts-check
import { cp, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { hosting, git, verifyArtifact, verifyLiveSite, waitForJson, restoreCreatorKitReleases, assertCreatorKitsUnchanged } from './hosting-lib.mjs';

const [output, option, ...extra] = process.argv.slice(2);
if (!output || extra.length || (option && option !== '--dry-run')) {
  throw new Error('Usage: node scripts/publish-creator-site.mjs <built-directory> [--dry-run]');
}
const source = resolve(output);
const release = await verifyArtifact(source);
if ((await readdir(source)).includes('creator-kit')) throw Error('Publish immutable creator-kit files separately with publish-creator-kit.mjs');
if (option === '--dry-run') {
  console.log(JSON.stringify({ status: 'verified-only', branch: hosting.branch, ...release }));
} else {
  const parent = await realpath(tmpdir());
  const temporary = await mkdtemp(join(parent, 'ai-fighter-pages-'));
  const checkout = join(temporary, 'repository');
  const previousSsh = process.env.GIT_SSH_COMMAND;
  try {
    if (process.env.AI_FIGHTER_PAGES_DEPLOY_KEY) {
      const keyFile = join(temporary, 'deploy-key');
      const hostsFile = join(temporary, 'known_hosts');
      const response = await fetch('https://api.github.com/meta', { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error('Cannot retrieve GitHub SSH host keys');
      const keys = (await response.json()).ssh_keys;
      if (!Array.isArray(keys) || !keys.some(key => key.startsWith('ssh-ed25519 '))) throw new Error('Missing GitHub SSH host keys');
      await writeFile(keyFile, process.env.AI_FIGHTER_PAGES_DEPLOY_KEY + '\n', { mode: 0o600 });
      await writeFile(hostsFile, keys.map(key => `github.com ${key}\n`).join(''));
      /** @type {(path: string) => string} */
      const quote = path => "'" + path.replaceAll('\\', '/').replaceAll("'", "'\\''") + "'";
      process.env.GIT_SSH_COMMAND = `ssh -i ${quote(keyFile)} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${quote(hostsFile)}`;
      delete process.env.AI_FIGHTER_PAGES_DEPLOY_KEY;
    }
    // No checkout means old tracked assets are absent. add -A removes stale assets
    // from the new commit without deleting anything in an existing user checkout.
    git(
      parent,
      'clone',
      '--depth=1',
      '--single-branch',
      '--no-checkout',
      '--branch',
      hosting.branch,
      'git@github.com:jeonghwanko/oddbout-starter.git',
      checkout,
    );
    // A targeted page update may have been built and compared against one deployed game.
    // The normal non-force push guards later races; also refuse a change made before this clone.
    const expectedHead = process.env.ODDBOUT_EXPECTED_PAGES_HEAD;
    if (expectedHead && git(checkout, 'rev-parse', 'HEAD') !== expectedHead)
      throw new Error('Published site changed since comparison; rebuild against the new deployment.');
    for (const entry of await readdir(source)) await cp(join(source, entry), join(checkout, entry), { recursive: true, errorOnExist: true, force: false });
    // The caller's build directory may change while cloning or copying.
    // Recheck the exact bytes that will be committed, before staging or pushing.
    assert.deepEqual(await verifyArtifact(checkout, { gitCheckout: true }), release, 'Artifact metadata changed while preparing the publication');
    git(checkout, 'config', 'user.name', 'AI Fighter deploy');
    git(checkout, 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
    git(checkout, 'config', 'core.autocrlf', 'false');
    // Existing kit bytes are not part of the newly built game's fingerprint.
    // Materialize their original Git objects before add -A could remove them.
    restoreCreatorKitReleases(checkout);
    git(checkout, 'add', '-A');
    assertCreatorKitsUnchanged(checkout);
    git(checkout, 'commit', '-m', `Deploy AI Fighter ${release.sourceCommit.slice(0, 12)}`);
    // No force: concurrent deploys must fail instead of replacing newer work.
    git(checkout, 'push', 'origin', `HEAD:refs/heads/${hosting.branch}`);
    console.log(JSON.stringify({ status: 'pushed', commit: git(checkout, 'rev-parse', 'HEAD') }));
    const marker = new URL('deployment.json', hosting.siteUrl);
    marker.searchParams.set('build', release.buildId);
    await waitForJson(marker, body => body.buildId === release.buildId && body.digest === release.digest);
    await verifyLiveSite(checkout);
    console.log(JSON.stringify({ status: 'live', siteUrl: hosting.siteUrl, buildId: release.buildId }));
  } finally {
    if (previousSsh === undefined) delete process.env.GIT_SSH_COMMAND;
    else process.env.GIT_SSH_COMMAND = previousSsh;
    const target = await realpath(temporary);
    // biome-ignore lint/correctness/noUnsafeFinally: a temporary folder outside its parent is never removed, whatever the publish did
    if (dirname(target) !== parent || !target.startsWith(join(parent, 'ai-fighter-pages-'))) throw new Error('Unsafe temporary directory');
    await rm(target, { recursive: true, force: true });
  }
}
