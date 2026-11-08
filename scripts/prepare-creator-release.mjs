// @ts-check
// Prepare only public kit bytes. This does not publish, change policy, install or execute the kit.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { localPath } from '../mcp/creation-store.mjs';
import { bootstrapPython } from './bootstrap-python.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
/** @type {(bytes: string | Buffer) => string} */
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
/** @type {(value: unknown) => Buffer} */
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const kitOrigin = 'https://oddbout.com';

/**
 * @param {{ version: string, sha256: string, runtimeManifestSha256: string, name: string, bytes: number }} archive
 * @param {Buffer} bootstrap
 */
export function releaseMetadata(archive, bootstrap) {
  if (
    !/^\d+\.\d+\.\d+$/.test(archive.version) ||
    !/^[a-f0-9]{64}$/.test(archive.sha256) ||
    !/^[a-f0-9]{64}$/.test(archive.runtimeManifestSha256) ||
    archive.name !== 'oddbout' ||
    !Number.isSafeInteger(archive.bytes) ||
    archive.bytes <= 0 ||
    archive.bytes > 20_000_000
  )
    throw Error('Invalid verified archive metadata');
  const bootstrapSha = sha(bootstrap);
  // The helper is part of the immutable release identity too; changing it needs a new path.
  const id = sha(`${archive.sha256}\n${bootstrapSha}\n`);
  const relative = `creator-kit/${archive.version}/${id}/`;
  const base = `${kitOrigin}/${relative}`;
  const manifest = {
    schemaVersion: 1,
    name: 'oddbout',
    version: archive.version,
    artifact: { url: `${base}oddbout-${archive.version}.zip`, bytes: archive.bytes, sha256: archive.sha256 },
    bootstrap: { url: `${base}fetch-creator-kit.py`, bytes: bootstrap.length, sha256: bootstrapSha },
    runtimeManifestSha256: archive.runtimeManifestSha256,
  };
  return { relative, manifest, manifestBytes: json(manifest), manifestUrl: `${base}release.json` };
}

/** @param {string} bundleDirectory @param {string} destination */
export async function prepareCreatorRelease(bundleDirectory, destination) {
  if (!destination.startsWith('output/')) throw Error('release-output-must-be-under-output');
  const out = await localPath(root, destination);
  if (
    await lstat(out).then(
      () => true,
      e => {
        if (e.code !== 'ENOENT') throw e;
        return false;
      },
    )
  )
    throw Error('release-output-exists');
  const bundle = path.resolve(bundleDirectory);
  const report = JSON.parse(await readFile(path.join(bundle, 'build-report.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(report.version)) throw Error('invalid-bundle-version');
  // Derive the path, never follow an arbitrary path/URL supplied by the build report.
  const zip = path.join(bundle, `oddbout-${report.version}.zip`);
  if (!(await lstat(zip)).isFile()) throw Error('bundle-not-regular-file');
  const bytes = await readFile(zip);
  if (bytes.length > 20_000_000 || sha(bytes) !== report.sha256 || report.bytes !== bytes.length) throw Error('bundle-changed-or-oversized');
  await mkdir(out); // Exclusive output; preserve unsuccessful attempts for inspection.
  const candidate = path.join(out, 'verified-candidate.zip');
  await writeFile(candidate, bytes, { flag: 'wx' });
  const helper = path.join(root, 'scripts', 'fetch-creator-kit.py');
  const { stdout } = await execute(bootstrapPython(), [helper, 'inspect', candidate], { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
  const archive = JSON.parse(stdout);
  if (archive.sha256 !== report.sha256 || archive.version !== report.version) throw Error('verified-bundle-mismatch');
  const bootstrap = await readFile(helper);
  const { relative, manifest, manifestBytes, manifestUrl } = releaseMetadata(archive, bootstrap);
  const publicRoot = path.join(out, 'public'),
    release = path.join(publicRoot, relative);
  await mkdir(release, { recursive: true });
  await writeFile(path.join(release, `oddbout-${archive.version}.zip`), bytes, { flag: 'wx' });
  await writeFile(path.join(release, 'fetch-creator-kit.py'), bootstrap, { flag: 'wx' });
  await writeFile(path.join(release, 'release.json'), manifestBytes, { flag: 'wx' });
  const result = {
    schemaVersion: 1,
    status: 'prepared-not-published',
    publicRoot,
    relative,
    manifest: { url: manifestUrl, sha256: sha(manifestBytes), bytes: manifestBytes.length },
    artifact: archive,
    bootstrap: manifest.bootstrap,
    networkPlan: {
      scope: 'code-shell-download',
      destinations: [{ host: 'oddbout.com', port: 443, purpose: 'Download the reviewed ODDBOUT creator kit and bootstrap helper', stage: 'kit-download' }],
      approval: 'not-recorded',
      application: 'not-checked',
      reachability: 'not-checked',
      excludes: ['npm/Python dependency installation', 'generation login or requests', 'user asset delivery'],
    },
    verification: { archive: 'passed', extraction: 'not-run', runtime: 'not-run', liveUrl: 'not-tested', hostedDots: 'not-tested' },
    bootstrapTrust:
      'Before execution, verify the helper SHA-256 against this reviewed report. A checksum fetched only from the same remote source is not independent authorization.',
    executionTemplate: {
      command: 'python3',
      args: [
        '<verified-helper-path>',
        'download',
        '--manifest-url',
        manifestUrl,
        '--manifest-sha256',
        sha(manifestBytes),
        '--destination',
        '<new-absolute-validation-directory>',
      ],
    },
    publication:
      'Publish only public/ as an additive immutable path; preserve existing site and releases. Do not pass this directory to site:publish. Never claim URL availability from this preparation.',
  };
  await writeFile(path.join(out, 'release-report.json'), json(result), { flag: 'wx' });
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw Error('Usage: npm run kit:release -- <bundle-directory> <output/new-release>');
    console.log(JSON.stringify(await prepareCreatorRelease(process.argv[2], process.argv[3]), null, 2));
  } catch (/** @type {any} */ error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
