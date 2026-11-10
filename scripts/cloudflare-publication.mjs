// @ts-check
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { git, hosting, verifyArtifact, verifyLiveSite, waitForJson } from './hosting-lib.mjs';
import { cloudflareFetch } from './site-publication.mjs';

/** @param {string} root */
export async function validateCloudflareFiles(root) {
  let files = 0;
  /** @param {string} dir */
  async function walk(dir) {
    for (const name of await readdir(dir)) {
      const path = join(dir, name),
        entry = await lstat(path);
      if (entry.isSymbolicLink()) throw Error('Cloudflare publication rejects symlinks');
      if (entry.isDirectory()) await walk(path);
      else if (!entry.isFile() || entry.size > 25 * 1024 * 1024) throw Error('Cloudflare asset exceeds 25 MiB or is not a regular file');
      else files++;
    }
  }
  await walk(root);
  if (files > 20_000) throw Error('Cloudflare publication exceeds 20000 files');
  // Do not accidentally execute a Worker or apply unreviewed routing configuration.
  for (const name of ['_worker.js', 'functions', '_redirects', '_headers', '_routes.json']) {
    if ((await readdir(root)).includes(name)) throw Error(`Cloudflare control file requires explicit review: ${name}`);
  }
  return files;
}

/** @param {string} sha @param {ReturnType<typeof import('./site-publication.mjs').publicationConfig>} config @param {{preview?:boolean}} options */
export async function publishCloudflare(sha, config, { preview = false } = {}) {
  const parent = await realpath(tmpdir()),
    temporary = await mkdtemp(join(parent, 'oddbout-cloudflare-'));
  const checkout = join(temporary, 'repository'),
    site = join(temporary, 'site'),
    archive = join(temporary, 'site.tar');
  const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  const output = join(temporary, 'wrangler-output.jsonl');
  const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: config.account, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_OUTPUT_FILE_PATH: output };
  try {
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
    if (git(checkout, 'rev-parse', 'HEAD') !== sha) throw Error('Publication branch changed; refusing stale deployment');
    if (
      git(checkout, 'ls-tree', '-r', 'HEAD')
        .split('\n')
        .some(line => !/^100644 blob /.test(line))
    )
      throw Error('Publication contains non-regular Git objects');
    await mkdir(site);
    git(checkout, '-c', 'core.autocrlf=false', 'archive', `--output=${archive}`, 'HEAD', '--', '.', ':!creator-kit');
    execFileSync('tar', ['-xf', archive, '-C', site]);
    const release = await verifyArtifact(site);
    if (git(checkout, 'ls-tree', 'HEAD', '--', 'creator-kit')) {
      git(checkout, '-c', 'core.autocrlf=false', 'archive', `--output=${archive}`, 'HEAD', '--', 'creator-kit');
      execFileSync('tar', ['-xf', archive, '-C', site]);
    }
    await validateCloudflareFiles(site);
    const current = git(checkout, 'ls-remote', 'origin', `refs/heads/${hosting.branch}`).split(/\s/)[0];
    if (current !== sha) throw Error('Publication branch changed before Cloudflare upload');
    const branch = preview ? 'hosting-migration' : config.branch;
    execFileSync(
      process.execPath,
      [wrangler, 'pages', 'deploy', site, '--project-name', config.project, '--branch', branch, '--commit-hash', sha, '--commit-dirty=false'],
      { cwd: temporary, env, stdio: 'inherit' },
    );
    const entries = (await readFile(output, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    const deployed = entries.findLast(entry => entry.type === 'pages-deploy-detailed');
    if (
      !deployed ||
      deployed.pages_project !== config.project ||
      deployed.deployment_trigger?.metadata?.commit_hash !== sha ||
      deployed.environment !== (preview ? 'preview' : 'production')
    ) {
      throw Error('Cloudflare deployment metadata does not match the requested project, commit or environment');
    }
    const url = new URL(deployed.url);
    if (url.protocol !== 'https:' || !url.hostname.endsWith(`.${config.project}.pages.dev`)) throw Error('Unexpected Cloudflare deployment origin');
    const base = url.origin + '/';
    await waitForJson(new URL('deployment.json', base), body => body.buildId === release.buildId && body.digest === release.digest);
    await verifyLiveSite(site, { siteUrl: base, request: cloudflareFetch() });
    // Immutable kits are not in the game's fingerprint or module graph; compare their bytes too.
    const kitFiles = git(checkout, 'ls-tree', '-r', '--name-only', 'HEAD', '--', 'creator-kit').split('\n').filter(Boolean);
    for (const file of kitFiles) {
      const response = await fetch(new URL(file, base), { redirect: 'error', signal: AbortSignal.timeout(30_000) });
      const expected = await readFile(join(site, file));
      if (
        !response.ok ||
        createHash('sha256')
          .update(Buffer.from(await response.arrayBuffer()))
          .digest('hex') !== createHash('sha256').update(expected).digest('hex')
      )
        throw Error(`Cloudflare kit verification failed: ${file}`);
    }
    console.log(JSON.stringify({ status: 'cloudflare-verified', url: base, preview, commit: sha, buildId: release.buildId }));
    if (!preview) {
      await waitForJson(new URL('deployment.json', hosting.siteUrl), body => body.buildId === release.buildId && body.digest === release.digest);
      await verifyLiveSite(site, { request: cloudflareFetch() });
    }
    return { url: base, preview };
  } finally {
    const target = await realpath(temporary);
    // biome-ignore lint/correctness/noUnsafeFinally: refuse cleanup outside the verified temporary parent even when publication failed
    if (dirname(target) !== parent || !target.startsWith(join(parent, 'oddbout-cloudflare-'))) throw Error('Unsafe publication temporary directory');
    await rm(target, { recursive: true, force: true });
  }
}
