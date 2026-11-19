// @ts-check
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, readdir, realpath, rm, lstat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { git, hosting, verifyArtifact, verifyLiveSite, waitForJson } from './hosting-lib.mjs';
import { cloudflareFetch } from './site-publication.mjs';
import { chatGptEmbedBuild } from './chatgpt-embed-site.mjs';

/**
 * `_headers` is accepted only when it is byte for byte the route rules this repository generates for the ChatGPT game entry
 * (`chatGptEmbedBuild` — the build writes them, `publishedFiles` requires them). Any other rule still needs a code change and review.
 * @param {string} root @param {{ headers?: string }} [reviewed]
 */
export async function validateCloudflareFiles(root, { headers } = {}) {
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
  const names = await readdir(root);
  for (const name of ['_worker.js', 'functions', '_redirects', '_routes.json']) {
    if (names.includes(name)) throw Error(`Cloudflare control file requires explicit review: ${name}`);
  }
  if (names.includes('_headers')) {
    const shipped = await readFile(join(root, '_headers'), 'utf8');
    if (!headers || shipped.trim() !== headers.trim()) throw Error('Cloudflare control file requires explicit review: _headers');
  }
  return files;
}

// Only deploy the checked-in public GET handler. The sealed site archive cannot supply executable routing controls.
/** @param {string} temporary @param {string} site @param {string} project */
async function stagePublicApi(temporary, site, project) {
  const sources = ['functions/api/[[path]].js', 'worker/public-api.mjs', 'api/bytes.mjs'];
  for (const source of sources) {
    const target = join(temporary, source);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(new URL('../' + source, import.meta.url), target);
  }
  await writeFile(join(site, '_routes.json'), JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }));
  const config = join(temporary, 'wrangler.jsonc');
  await writeFile(
    config,
    JSON.stringify({
      name: project,
      pages_build_output_dir: './site',
      compatibility_date: '2026-11-04',
      compatibility_flags: ['enable_request_signal'],
    }),
  );
}

/**
 * A new deployment's first Pages Function reads can be slow (a cold start past the timeout) or briefly answer 502–504. Those are asked
 * again; a response that is not the Pages Function's JSON is refused at once.
 * @param {string} base @param {typeof fetch} [request]
 * @param {{ attempts?: number, timeoutMs?: number, wait?: (ms: number) => Promise<unknown> }} [options]
 */
export async function verifyPagesPublicApi(
  base,
  request = fetch,
  { attempts = 4, timeoutMs = 30_000, wait = ms => new Promise(done => setTimeout(done, ms)) } = {},
) {
  const paths = ['/api/ai-fighter/roster', '/api/ai-fighter/rankings', '/api/oddbout-arena/rankings?scope=registered'];
  /** @param {string} path */
  const read = async path => {
    for (let attempt = 1; ; attempt += 1) {
      let response;
      try {
        response = await request(new URL(path, base), { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        if (attempt >= attempts) throw Error('Cloudflare Pages public API did not answer: ' + path, { cause: error });
        await wait(5_000 * attempt);
        continue;
      }
      if (response.status >= 502 && response.status <= 504 && attempt < attempts) {
        await response.body?.cancel();
        await wait(5_000 * attempt);
        continue;
      }
      return response;
    }
  };
  await Promise.all(
    paths.map(async path => {
      const response = await read(path);
      if (
        !response.ok ||
        response.headers.get('x-oddbout-api-runtime') !== 'pages-function' ||
        !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')
      ) {
        await response.body?.cancel();
        throw Error('Cloudflare Pages public API did not serve JSON: ' + path);
      }
      if ((await response.json()).ok !== true) throw Error('Cloudflare Pages public API did not succeed: ' + path);
    }),
  );
}

/**
 * The deployment Wrangler reported (its `WRANGLER_OUTPUT_FILE_PATH` lines) for the requested project, commit and environment, as the
 * deployment's own `https://<id>.<project>.pages.dev/` address.
 * @param {string} text @param {{ project: string, commit: string, preview: boolean }} expected
 */
export function pagesDeployment(text, { project, commit, preview }) {
  const entries = text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
  const deployed = entries.findLast(entry => entry.type === 'pages-deploy-detailed');
  if (
    !deployed ||
    deployed.pages_project !== project ||
    deployed.deployment_trigger?.metadata?.commit_hash !== commit ||
    deployed.environment !== (preview ? 'preview' : 'production')
  ) {
    throw Error('Cloudflare deployment metadata does not match the requested project, commit or environment');
  }
  const url = new URL(deployed.url);
  if (url.protocol !== 'https:' || !url.hostname.endsWith(`.${project}.pages.dev`)) throw Error('Unexpected Cloudflare deployment origin');
  return url.origin + '/';
}

/**
 * Uploads a checked folder with the repository's pinned Wrangler (`pages deploy`) and returns the deployment's address. `cwd` is a
 * temporary folder of the caller's: Wrangler reads a `wrangler.jsonc` there (the ODDBOUT site's Pages Function) and writes its report.
 * @param {{ site: string, project: string, branch: string, commit: string, account: string, preview: boolean, cwd: string }} options
 */
export async function deployPagesDirectory({ site, project, branch, commit, account, preview, cwd }) {
  const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  const output = join(cwd, 'wrangler-output.jsonl');
  const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: account, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_OUTPUT_FILE_PATH: output };
  execFileSync(
    process.execPath,
    [wrangler, 'pages', 'deploy', site, '--project-name', project, '--branch', branch, '--commit-hash', commit, '--commit-dirty=false'],
    { cwd, env, stdio: 'inherit' },
  );
  return pagesDeployment(await readFile(output, 'utf8'), { project, commit, preview });
}

/** @param {string} sha @param {ReturnType<typeof import('./site-publication.mjs').publicationConfig>} config @param {{preview?:boolean}} options */
export async function publishCloudflare(sha, config, { preview = false } = {}) {
  const parent = await realpath(tmpdir()),
    temporary = await mkdtemp(join(parent, 'oddbout-cloudflare-'));
  const checkout = join(temporary, 'repository'),
    site = join(temporary, 'site'),
    archive = join(temporary, 'site.tar');
  // Relative names from the temporary directory: GNU tar (Git Bash puts it first on Windows) reads `C:` in an absolute path as a
  // remote host and stops after the branch commit, while Windows' bsdtar accepts either.
  const extract = () => execFileSync('tar', ['-xf', 'site.tar', '-C', 'site'], { cwd: temporary });
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
    extract();
    const release = await verifyArtifact(site);
    if (git(checkout, 'ls-tree', 'HEAD', '--', 'creator-kit')) {
      git(checkout, '-c', 'core.autocrlf=false', 'archive', `--output=${archive}`, 'HEAD', '--', 'creator-kit');
      extract();
    }
    await validateCloudflareFiles(site, { headers: chatGptEmbedBuild(hosting.chatgptEmbed).headers });
    await stagePublicApi(temporary, site, config.project);
    const current = git(checkout, 'ls-remote', 'origin', `refs/heads/${hosting.branch}`).split(/\s/)[0];
    if (current !== sha) throw Error('Publication branch changed before Cloudflare upload');
    const branch = preview ? 'hosting-migration' : config.branch;
    const base = await deployPagesDirectory({ site, project: config.project, branch, commit: sha, account: config.account, preview, cwd: temporary });
    await waitForJson(new URL('deployment.json', base), body => body.buildId === release.buildId && body.digest === release.digest);
    await verifyPagesPublicApi(base);
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
