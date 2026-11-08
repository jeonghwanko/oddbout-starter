// @ts-check
// Outside programs sprite-gen calls but does not ship, found the way sprite-gen finds them (PATH, then RIFE's own rules).
// ffmpeg/ffprobe: video-frames, video-set. img2webp with -exact (libwebp >= 1.5): every walk/run WebP. RIFE: loop jump
// repair only; without it loops are cut as filmed with a warning. Nothing here runs sudo or a paid API.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, chmod, constants, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runtimeFetch } from '../api/runtime-fetch.mjs';

// Official libwebp release binaries (storage.googleapis.com/downloads.webmproject.org/releases/webp), SHA-256 measured
// on the downloaded archives 2026-10-26. Statically linked; only bin/img2webp and README.md are kept.
/** @type {{ version: string, license: string, url: (name: string) => string, archives: Record<string, [string, string]> }} */
export const LIBWEBP = {
  version: '1.6.0',
  license: 'BSD-3-Clause (https://chromium.googlesource.com/webm/libwebp/+/refs/heads/main/COPYING)',
  url: name => `https://storage.googleapis.com/downloads.webmproject.org/releases/webp/${name}`,
  archives: {
    'linux-x64': ['libwebp-1.6.0-linux-x86-64.tar.gz', '1c5ffab71efecefa0e3c23516c3a3a1dccb45cc310ae1095c6f14ae268e38067'],
    'linux-arm64': ['libwebp-1.6.0-linux-aarch64.tar.gz', '69f5eebe203e0f3942fe37986209a1725741be19c152950a4283b376c95ec798'],
    'darwin-arm64': ['libwebp-1.6.0-mac-arm64.tar.gz', 'bc6bf84cc70f3f8574fba797d1e4a7dea4feebe9fa4be919f202413ea2b3b8f2'],
    'darwin-x64': ['libwebp-1.6.0-mac-x86-64.tar.gz', 'f112dd83b420ab2a4b27d46610d9827ddf4200216023281de378647ecca31c2a'],
    'win32-x64': ['libwebp-1.6.0-windows-x64.zip', '48886f506b21f62e4661f0f4cbfca19800897c385128e8902542d29a950c93f1'],
  },
};
export const REQUIRED_TOOLS = ['ffmpeg', 'ffprobe', 'img2webp'];
/**
 * One tool's readiness: `install` says who installs it how, for every status but ok.
 * @typedef {{ actor: string, command: string, sudo?: boolean, note?: string }} Install
 * RIFE's resident binary (`serve`, a working RIFE only): ok | missing (sprite:setup installs it) | off | not-offered | broken.
 * @typedef {{ status: string, path?: string, reason?: string, effectWhenMissing?: string, install?: Install }} Serve
 * @typedef {{ status: string, required: boolean, path?: string, version?: string | null, reason?: string, effectWhenMissing?: string, install?: Install,
 *   serve?: Serve }} Tool
 * @typedef {{ spriteRoot?: string, python?: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, arch?: NodeJS.Architecture,
 *   probe?: typeof runProbe, find?: typeof which, rife?: boolean }} ToolOptions  spriteRoot is required unless env is given.
 */
const SETUP = 'npm run sprite:setup';
/** @type {Record<string, string>} */
const FFMPEG_INSTALL = { linux: 'sudo apt install ffmpeg', darwin: 'brew install ffmpeg', win32: 'winget install --id Gyan.FFmpeg -e' };
const VULKAN_INSTALL = 'sudo apt install libvulkan1 mesa-vulkan-drivers';

/** The kit venv's script folder. sprite-gen runs with it first on PATH, so a kit-installed img2webp is found there. @param {string} spriteRoot */
export const toolBin = spriteRoot => path.join(spriteRoot, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin');

/** env with the kit venv's script folder first on PATH. Windows keeps one PATH key whatever its case ("Path"). @param {string} spriteRoot @param {NodeJS.ProcessEnv} [env] */
export function toolEnv(spriteRoot, env = process.env) {
  const key = Object.keys(env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH';
  return { ...env, [key]: [toolBin(spriteRoot), env[key]].filter(Boolean).join(path.delimiter) };
}

/** shutil.which on the given env's PATH (with PATHEXT on Windows). @param {string} name @param {NodeJS.ProcessEnv} [env] @param {NodeJS.Platform} [platform] */
export async function which(name, env = process.env, platform = process.platform) {
  const pathValue = env[/** @type {string} */ (Object.keys(env).find(key => key.toUpperCase() === 'PATH'))] ?? ''; // without a PATH key this reads env.undefined
  const extensions = platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  for (const dir of pathValue.split(path.delimiter).filter(Boolean))
    for (const extension of extensions) {
      const file = path.join(dir, name + extension);
      if (
        await access(file, platform === 'win32' ? constants.F_OK : constants.X_OK).then(
          () => true,
          () => false,
        )
      )
        return file;
    }
  return null;
}

/**
 * Runs a program without a shell; resolves { code, output } (stdout+stderr) and never throws.
 * @param {string} command @param {string[]} args @param {{ env?: NodeJS.ProcessEnv, timeout?: number }} [options] @returns {Promise<{ code: number, output: string }>}
 */
export function runProbe(command, args, { env = process.env, timeout = 30000 } = {}) {
  return new Promise(resolve =>
    execFile(command, args, { env, timeout, windowsHide: true, maxBuffer: 4 << 20 }, (error, stdout, stderr) =>
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, output: `${stdout ?? ''}${stderr ?? ''}` }),
    ),
  );
}

const platformKey = (platform = process.platform, arch = process.arch) => `${platform}-${arch}`;
/** @param {string} command @param {NodeJS.Platform} platform */
const userInstall = (command, platform) => ({
  actor: 'user',
  command,
  sudo: platform === 'linux' && command.startsWith('sudo '),
  note: 'The kit never runs this itself: the person preparing the workspace runs it, then npm run sprite:status.',
});

/** img2webp install advice: the kit's pinned download where one exists, else libwebp >= 1.5 from the system. */
export function img2webpInstall(platform = process.platform, arch = process.arch) {
  if (LIBWEBP.archives[platformKey(platform, arch)])
    return { actor: 'agent', command: SETUP, note: `Downloads libwebp ${LIBWEBP.version} (SHA-256 pinned) into vendor/sprite-gen/.venv; no sudo.` };
  return userInstall(platform === 'darwin' ? 'brew install webp' : 'install libwebp >= 1.5 (img2webp with -exact) on PATH', platform);
}

// sprite_gen.api.rife_status: the engine's own locate-and-check, as a status that never installs (vendor/sprite-gen/docs/api.md).
// A RIFE that works also gets `serve`: the resident binary (rife.serve_executable) the engine runs instead of calling the binary
// once per frame. `missing` only where `rife install` would put one beside this binary: the ncnn backend, a release pinned for
// this platform and machine (Windows and Linux x86-64, rife_install.SERVE_ZIP_SHA256), and this RIFE the one it installed.
const RIFE_PROBE = `
import json, os, platform
from pathlib import Path
from sprite_gen.api import rife_status
found = rife_status()
if found.get("status") == "ok":
    def serve_status():
        from sprite_gen.video import rife, rife_install
        if rife.backend() != "ncnn":
            return {"status": "not-offered", "reason": "RIFE runs on PyTorch here (SPRITE_GEN_RIFE_BACKEND=torch), not the binary"}
        binary = Path(found["path"])
        serve = rife.serve_executable(binary)
        if serve:
            return {"status": "ok", "path": str(serve)}
        if os.environ.get("SPRITE_GEN_RIFE_SERVE") is not None:
            return {"status": "off", "reason": "SPRITE_GEN_RIFE_SERVE is set empty: the binary runs once per frame"}
        name = rife.platform_release()
        machines = rife_install.ZIP_MACHINES.get(name)
        if not rife_install.SERVE_ZIP_SHA256.get(name) or (machines and platform.machine().lower() not in machines):
            return {"status": "not-offered", "reason": f"no resident binary is released for {name or 'this platform'} {platform.machine()}"}
        if binary != rife.installed_binary().resolve():
            return {"status": "not-offered", "reason": f"rife install puts it beside {rife.installed_binary()}, not beside this RIFE"}
        return {"status": "missing"}
    try:
        found["serve"] = serve_status()
    except Exception as error:
        found["serve"] = {"status": "broken", "reason": str(error)}
print(json.dumps(found))
`;

/**
 * RIFE as the engine resolves it (SPRITE_GEN_RIFE, PATH, user data dir), with sprite-gen's own check frame.
 * @param {{ python?: string, env: NodeJS.ProcessEnv, platform?: NodeJS.Platform, probe?: typeof runProbe }} options @returns {Promise<Tool>}
 */
export async function inspectRife({ python, env, platform = process.platform, probe = runProbe }) {
  const install = {
    actor: 'agent',
    command: SETUP,
    note: 'Runs sprite-gen rife install (rife-ncnn-vulkan 20221029, SHA-256 pinned, about 430 MB download, user data directory, no sudo).',
  };
  const optional = { required: false, effectWhenMissing: 'walk/run loops are cut as filmed, with a warning; generation still works' };
  if (
    !python ||
    !(await access(python).then(
      () => true,
      () => false,
    ))
  )
    return { status: 'missing', ...optional, reason: 'sprite-gen-not-installed', install };
  const result = await probe(python, ['-c', RIFE_PROBE], { env: { ...env, PYTHONUTF8: '1' }, timeout: 120000 });
  let found;
  try {
    found = JSON.parse(/** @type {string} */ (result.output.trim().split('\n').at(-1)));
  } catch {
    found = { status: 'broken', reason: result.output.trim().slice(-300) || 'rife probe failed' };
  } // split gives at least one line
  if (found.status === 'ok') {
    // Without the resident binary RIFE works, only slower: no warning, but sprite:setup installs it where it can.
    if (found.serve?.status === 'missing')
      found.serve = {
        ...found.serve,
        effectWhenMissing: 'the loop alignment starts RIFE once per frame, about half as fast; the frames are the same',
        install: {
          actor: 'agent',
          command: SETUP,
          note: 'Runs sprite-gen rife install: keeps this RIFE and puts the resident binary (rife-serve-20221029-1, SHA-256 pinned, about 2-3 MB) beside it after its check frame.',
        },
      };
    return { ...found, ...optional };
  }
  if (found.status === 'missing') return { ...found, ...optional, install };
  // Files present but the check frame failed: usually no Vulkan. Reinstalling does not help.
  return {
    ...found,
    ...optional,
    install:
      platform === 'linux' ? userInstall(VULKAN_INSTALL, platform) : { actor: 'user', command: 'update the GPU driver (Vulkan), then npm run sprite:status' },
  };
}

/** ffmpeg, ffprobe, img2webp and RIFE, each { status: ok|missing|broken, ... install }. @param {ToolOptions} [options] */
export async function inspectTools({
  spriteRoot,
  python,
  env = toolEnv(/** @type {string} */ (spriteRoot)),
  platform = process.platform,
  arch = process.arch,
  probe = runProbe,
  find = which,
  rife = true,
} = {}) {
  /** @type {Record<string, Tool>} */
  const tools = {};
  for (const name of ['ffmpeg', 'ffprobe']) {
    const found = await find(name, env, platform);
    const install = userInstall(FFMPEG_INSTALL[platform] ?? 'install ffmpeg (with ffprobe) on PATH', platform);
    if (!found) {
      tools[name] = { status: 'missing', required: true, install };
      continue;
    }
    const result = await probe(found, ['-version'], { env });
    tools[name] =
      result.code === 0
        ? { status: 'ok', required: true, path: found, version: result.output.match(/version (\S+)/)?.[1] ?? null }
        : { status: 'broken', required: true, path: found, reason: result.output.trim().slice(0, 300) || `exit ${result.code}`, install };
  }
  const img2webp = await find('img2webp', env, platform);
  if (!img2webp) tools.img2webp = { status: 'missing', required: true, install: img2webpInstall(platform, arch) };
  else {
    const version = await probe(img2webp, ['-version'], { env }),
      help = await probe(img2webp, ['-h'], { env });
    const exact = help.output.includes('-exact');
    tools.img2webp = {
      status: exact ? 'ok' : 'broken',
      required: true,
      path: img2webp,
      version: version.output.match(/version:?\s*(\d+\.\d+\.\d+)/i)?.[1] ?? null,
      ...(exact
        ? {}
        : { reason: 'no -exact option (libwebp < 1.5; Ubuntu 24.04 apt ships 1.3.x); video-loop refuses it', install: img2webpInstall(platform, arch) }),
    };
  }
  tools.rife = rife ? await inspectRife({ python, env, platform, probe }) : { status: 'not-checked', required: false };
  return tools;
}

/** Readiness item: required tools decide the status; RIFE only warns. @template {Record<string, Tool>} T @param {T} tools */
export function toolsItem(tools) {
  const missing = REQUIRED_TOOLS.filter(name => tools[name]?.status !== 'ok');
  const installs = missing.map(name => ({ tool: name, ...tools[name].install }));
  const nextCommands = [...new Set(installs.filter(i => i.actor === 'agent').map(i => i.command))];
  const userCommands = [...new Set(installs.filter(i => i.actor === 'user').map(i => i.command))];
  const warnings = ['ok', 'not-checked'].includes(tools.rife?.status)
    ? []
    : [{ tool: 'rife', status: tools.rife.status, message: tools.rife.effectWhenMissing, ...tools.rife.install }];
  return {
    status: missing.length ? 'action-required' : 'ready',
    missing,
    ...tools,
    warnings,
    nextCommands,
    ...(userCommands.length
      ? {
          nextAction: {
            actor: 'user',
            code: 'install-system-tools',
            commands: userCommands,
            message: `${missing.join(', ')} 가 없거나 쓸 수 없다. 작업 공간을 준비하는 사람이 위 명령을 실행한 뒤 npm run sprite:status 로 다시 확인한다. 키트는 sudo 를 실행하지 않는다.`,
          },
        }
      : {}),
  };
}

/** @param {ToolOptions & { inspect?: typeof inspectTools }} [options] */
export async function checkTools({ inspect = inspectTools, ...options } = {}) {
  return toolsItem(await inspect(options));
}

/** @type {(data: Uint8Array) => string} */
const sha256 = data => createHash('sha256').update(data).digest('hex');
const EXTRACT = `
import sys, tarfile, zipfile, shutil
archive, member, dest = sys.argv[1:4]
if archive.endswith(".zip"):
    with zipfile.ZipFile(archive) as z, z.open(member) as src, open(dest, "wb") as out: shutil.copyfileobj(src, out)
else:
    with tarfile.open(archive) as t:
        src = t.extractfile(member)
        if src is None: sys.exit("not a file: " + member)
        with src, open(dest, "wb") as out: shutil.copyfileobj(src, out)
`;

/**
 * Put the pinned libwebp img2webp into the kit venv's script folder. The hash is checked before anything is unpacked;
 * files are written beside their final names and renamed in, so an interrupted install leaves nothing half-written.
 * @param {{ spriteRoot: string, python: string, platform?: NodeJS.Platform, arch?: NodeJS.Architecture, archivePath?: string,
 *   download?: typeof runtimeFetch, log?: (message: string) => void }} [options]
 */
export async function installImg2webp(
  {
    spriteRoot,
    python,
    platform = process.platform,
    arch = process.arch,
    archivePath,
    download = runtimeFetch,
    log = console.error,
  } = /** @type {{ spriteRoot: string, python: string }} */ ({}),
) {
  const entry = LIBWEBP.archives[platformKey(platform, arch)];
  if (!entry) throw Error(`No pinned libwebp build for ${platformKey(platform, arch)}: ${img2webpInstall(platform, arch).command}`);
  const [name, expected] = entry,
    top = name.replace(/\.(tar\.gz|zip)$/, '');
  const bin = toolBin(spriteRoot);
  await mkdir(bin, { recursive: true });
  const work = await mkdtemp(path.join(path.dirname(bin), '.img2webp-'));
  try {
    const archive = path.join(work, name);
    if (archivePath) await writeFile(archive, await readFile(archivePath));
    else {
      log(`img2webp: downloading ${LIBWEBP.url(name)}`);
      let response;
      try {
        response = await download(LIBWEBP.url(name));
      } catch (/** @type {any} */ error) {
        const reason = ['network-connect-forbidden', 'network-timeout', 'network-dns-failed', 'api-unreachable'].includes(error.code)
          ? error.code
          : 'api-unreachable';
        throw Error(`img2webp: network ${reason} host=storage.googleapis.com`);
      }
      if (!response.ok) throw Error(`img2webp: download failed (HTTP ${response.status}) ${LIBWEBP.url(name)}`);
      await writeFile(archive, Buffer.from(await response.arrayBuffer()));
    }
    const actual = sha256(await readFile(archive));
    if (actual !== expected) throw Error(`img2webp: ${name} has SHA-256 ${actual}, expected ${expected}; nothing was installed`);
    const exe = platform === 'win32' ? 'img2webp.exe' : 'img2webp';
    for (const [member, file] of [
      [`${top}/bin/${exe}`, exe],
      [`${top}/README.md`, 'libwebp-README.md'],
    ]) {
      const staged = path.join(work, file);
      const result = await runProbe(python, ['-c', EXTRACT, archive, member, staged], { timeout: 60000 });
      if (result.code) throw Error(`img2webp: could not unpack ${member}: ${result.output.trim().slice(0, 300)}`);
      await rename(staged, path.join(bin, file));
    }
    if (platform !== 'win32') await chmod(path.join(bin, exe), 0o755);
    await writeFile(
      path.join(bin, 'libwebp-install.json'),
      JSON.stringify({ version: LIBWEBP.version, archive: name, sha256: expected, license: LIBWEBP.license }, null, 2) + '\n',
    );
    return path.join(bin, exe);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
