#!/usr/bin/env node
// @ts-check
// pins.json checked (oddbout-host, 2026-11-07). `pinProblems` is what runner.test.mjs asks of every pull request: whole pins for every
// platform the runner serves, the CLIs' lockfiles and og.mjs agreeing on one version each, the kit's site equal to the kit's. `--publish`
// (npm's prepublishOnly in host/, never in CI) asks more, from the checkout and the network: the kit carries the engine the official host
// runs (og.mjs KIT_REF's vendor/sprite-gen), and every pinned URL still serves the pinned bytes. Not shipped in the package.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODEX_VERSION, GROK_VERSION, KIT_REF } from './og.mjs';
import { download, isPin } from './pinned.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The platforms npx oddbout-host installs on. */
export const PLATFORMS = Object.freeze(['win32-x64', 'win32-arm64', 'darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64']);

/** @param {any} pins @param {{ here?: string }} [options] @returns {string[]} */
export function pinProblems(pins, { here = HERE } = {}) {
  const problems = [];
  const kit = pins?.kit ?? {};
  if (!isPin(kit) || !/^\d+\.\d+\.\d+$/.test(kit.version) || !kit.url.endsWith(`/oddbout-${kit.version}.zip`) || kit.runtime !== 'runtime/'
    || !/^[a-f0-9]{64}$/.test(kit.runtimeManifestSha256 ?? '') || !/^[a-f0-9]{40}$/.test(kit.spriteGenCommit ?? '')) problems.push('kit: a whole creator-kit release pin');
  for (const [name, version] of /** @type {const} */ ([['grok', GROK_VERSION], ['codex', CODEX_VERSION]])) {
    const cli = pins?.cli?.[name];
    if (cli?.version !== version) problems.push(`cli.${name}: ${cli?.version} but og.mjs pins ${version}`);
    try {
      const manifest = JSON.parse(readFileSync(path.join(here, cli.lock, 'package.json'), 'utf8'));
      const lock = JSON.parse(readFileSync(path.join(here, cli.lock, 'lock.json'), 'utf8'));
      const top = lock.packages?.[`node_modules/${cli.package}`];
      if (manifest.dependencies?.[cli.package] !== cli.version || lock.packages?.['']?.dependencies?.[cli.package] !== cli.version)
        problems.push(`cli.${name}: ${cli.lock} does not ask for exactly ${cli.version}`);
      if (top?.version !== cli.version || top?.integrity !== cli.integrity) problems.push(`cli.${name}: ${cli.lock}/lock.json resolves another ${cli.package}`);
      for (const [at, entry] of Object.entries(lock.packages ?? {}))
        if (at && (!/^https:\/\/registry\.npmjs\.org\//.test(entry.resolved ?? '') || !/^sha512-/.test(entry.integrity ?? ''))) problems.push(`cli.${name}: ${at} not pinned to the registry`);
    } catch (/** @type {any} */ error) { problems.push(`cli.${name}: ${error.message}`); }
  }
  for (const key of PLATFORMS) {
    const python = pins?.python?.builds?.[key];
    if (!isPin(python) || !/^python\/[A-Za-z0-9/._-]+$/.test(python.exe ?? '') || !python.url.includes(`cpython-${pins.python.version}%2B${pins.python.release}-`))
      problems.push(`python.${key}: a whole pin of ${pins?.python?.version}+${pins?.python?.release}`);
    const ffmpeg = pins?.ffmpeg?.builds?.[key] ?? pins?.ffmpeg?.builds?.[pins?.ffmpeg?.fallback?.[key]];
    const exe = key.startsWith('win32') ? '.exe' : '';
    const files = (Array.isArray(ffmpeg) ? ffmpeg : []).flatMap(/** @param {any} pin */ pin => isPin(pin) && pin.files ? Object.keys(pin.files) : ['invalid']);
    if (files.sort().join(' ') !== `ffmpeg${exe} ffprobe${exe}`) problems.push(`ffmpeg.${key}: ffmpeg and ffprobe, each pinned`);
  }
  return problems;
}

/** The engine (vendor/sprite-gen gitlink) at `ref` in the checkout above host/. @param {string} ref */
export function engineAt(ref) {
  const r = spawnSync('git', ['-C', path.dirname(HERE), 'rev-parse', `${ref}:vendor/sprite-gen`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pins = JSON.parse(readFileSync(path.join(HERE, 'pins.json'), 'utf8'));
  const problems = pinProblems(pins);
  if (process.argv.includes('--publish')) {
    // The kit's engine is the official host's (og.mjs KIT_REF): a Grok picture job needs that engine's matte (sprite-gen-agent#55).
    const engine = engineAt(KIT_REF);
    if (engine !== pins.kit.spriteGenCommit) problems.push(`kit ${pins.kit.version} carries sprite-gen ${pins.kit.spriteGenCommit.slice(0, 7)}; og.mjs KIT_REF ${KIT_REF.slice(0, 7)} runs ${engine.slice(0, 7) || '?'} — release the kit from KIT_REF and pin it`);
    const release = await fetch(pins.kit.url.replace(/oddbout-[^/]+\.zip$/, 'release.json')).then(r => r.json()).catch(() => null);
    if (release?.artifact?.sha256 !== pins.kit.sha256 || release?.artifact?.bytes !== pins.kit.bytes || release?.runtimeManifestSha256 !== pins.kit.runtimeManifestSha256)
      problems.push(`kit: ${pins.kit.version}'s release.json does not name the pinned ZIP`);
    // Every pinned file still served as pinned (downloaded once into a scratch folder; slow: about 1 GB).
    if (process.argv.includes('--download')) {
      const scratch = path.join(HERE, '.pins-check');
      for (const pin of [pins.kit, ...Object.values(pins.python.builds), ...Object.values(pins.ffmpeg.builds).flat()])
        await download(/** @type {any} */ (pin), scratch).catch(/** @param {any} error */ error => problems.push(`${pin.url}: ${error.code ?? error.message}`));
    }
  }
  for (const line of problems) console.error(`pins: ${line}`);
  process.exitCode = problems.length ? 1 : 0;
}
