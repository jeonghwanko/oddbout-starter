// @ts-check
// oddbout-host's downloads (2026-11-07): each one exactly the bytes pins.json names — its size and SHA-256 checked before anything reads
// it — and unpacked without a shell: ZIPs here (the kit, ffmpeg), the standalone Python's .tar.gz with the OS's own tar (Windows 10 1803+
// and macOS ship bsdtar, Linux GNU tar). Only Node built-ins: the npm package carries this file alone.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';

/** @typedef {{ url: string, sha256: string, bytes: number }} Pin */

/** The pins' key for this PC: `<platform>-<arch>`. @param {NodeJS.Platform} [platform] @param {string} [arch] */
export const platformKey = (platform = process.platform, arch = process.arch) => `${platform}-${arch}`;

/** @param {string} file @returns {Promise<string>} */
export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

/** A pin as pins.json must write it: an https URL, a size, a SHA-256. @param {any} pin @returns {pin is Pin & Record<string, any>} A whole pin; other fields (version, files, exe) stay unchecked. */
export const isPin = pin => Boolean(pin) && typeof pin.url === 'string' && /^https:\/\/[^\s]+$/.test(pin.url)
  && typeof pin.sha256 === 'string' && /^[a-f0-9]{64}$/.test(pin.sha256) && Number.isSafeInteger(pin.bytes) && pin.bytes > 0;

/**
 * The pinned file in `dir` (named by its SHA-256): kept from an earlier run when its bytes still match, else fetched again. Throws
 * `download-failed` (the network; tried three times), `download-size` or `pin-mismatch` (other bytes than pins.json names: never used).
 * @param {Pin} pin @param {string} dir
 * @param {{ fetcher?: typeof fetch, onProgress?: (received: number, total: number) => void, idleMs?: number }} [options]
 * @returns {Promise<string>}
 */
export async function download(pin, dir, { fetcher = fetch, onProgress, idleMs = 60_000 } = {}) {
  if (!isPin(pin)) throw Object.assign(new Error('pin-invalid'), { code: 'pin-invalid' });
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, pin.sha256), part = `${file}.part`;
  if (existsSync(file) && (await stat(file)).size === pin.bytes && await sha256File(file) === pin.sha256) return file;
  /** @type {any} */ let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    await rm(part, { force: true });
    const hash = createHash('sha256'), stop = new AbortController();
    /** @type {NodeJS.Timeout | undefined} */ let idle;
    const awake = () => { clearTimeout(idle); idle = setTimeout(() => stop.abort(new Error('download-idle')), idleMs); };
    let received = 0;
    try {
      awake();
      const response = await fetcher(pin.url, { redirect: 'follow', signal: stop.signal, headers: { 'user-agent': 'oddbout-host' } });
      if (!response.ok || !response.body) throw new Error(`download-http-${response.status}`);
      const handle = await open(part, 'w');
      try {
        for await (const chunk of /** @type {AsyncIterable<Uint8Array>} */ (/** @type {unknown} */ (response.body))) {
          awake();
          received += chunk.length;
          if (received > pin.bytes) throw Object.assign(new Error('download-size'), { code: 'download-size' });
          hash.update(chunk);
          await handle.write(chunk);
          onProgress?.(received, pin.bytes);
        }
      } finally { await handle.close(); }
      clearTimeout(idle);
      if (received !== pin.bytes) throw Object.assign(new Error('download-size'), { code: 'download-size' });
      if (hash.digest('hex') !== pin.sha256) {
        await rm(part, { force: true });
        throw Object.assign(new Error('pin-mismatch'), { code: 'pin-mismatch', url: pin.url });
      }
      await rename(part, file);
      return file;
    } catch (/** @type {any} */ error) {
      clearTimeout(idle);
      await rm(part, { force: true });
      if (error?.code === 'pin-mismatch') throw error;
      last = error;
    }
  }
  throw Object.assign(new Error('download-failed'), { code: 'download-failed', url: pin.url, cause: last });
}

/**
 * @typedef {{ name: string, method: number, crc: number, compressedSize: number, size: number, offset: number, mode: number, directory: boolean }} ZipEntry
 */
const zipError = (/** @type {string} */ why) => Object.assign(new Error(`zip-invalid: ${why}`), { code: 'zip-invalid' });
/**
 * A ZIP's entries from its central directory. Refused: ZIP64, encryption, a method other than stored or deflated, a symbolic link, and any
 * name that could land outside the folder it is unpacked in (absolute, a drive, `..`, a backslash).
 * @param {Buffer} zip @returns {ZipEntry[]}
 */
export function readZip(zip) {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw zipError('no end record');
  const count = zip.readUInt16LE(end + 10), size = zip.readUInt32LE(end + 12), start = zip.readUInt32LE(end + 16);
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) throw zipError('zip64');
  /** @type {ZipEntry[]} */
  const entries = [];
  let at = start;
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw zipError('central directory');
    const madeBy = zip.readUInt16LE(at + 4), flags = zip.readUInt16LE(at + 8), method = zip.readUInt16LE(at + 10);
    const nameLength = zip.readUInt16LE(at + 28), extraLength = zip.readUInt16LE(at + 30), commentLength = zip.readUInt16LE(at + 32);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const external = zip.readUInt32LE(at + 38), unix = madeBy >> 8 === 3 ? external >>> 16 : 0;
    if (flags & 1) throw zipError(`encrypted ${name}`);
    if (method !== 0 && method !== 8) throw zipError(`method ${method} ${name}`);
    if ((unix & 0o170000) === 0o120000) throw zipError(`symbolic link ${name}`);
    if (!safeName(name)) throw zipError(`unsafe name ${JSON.stringify(name)}`);
    entries.push({ name, method, crc: zip.readUInt32LE(at + 16), compressedSize: zip.readUInt32LE(at + 20), size: zip.readUInt32LE(at + 24),
      offset: zip.readUInt32LE(at + 42), mode: unix & 0o777, directory: name.endsWith('/') });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
/** @param {string} name */
const safeName = name => name.length > 0 && !name.startsWith('/') && !name.includes('\\') && !name.includes('\0') && !/^[A-Za-z]:/.test(name)
  && name.replace(/\/$/, '').split('/').every(part => part !== '' && part !== '.' && part !== '..');

/** One entry's bytes, its CRC checked. @param {Buffer} zip @param {ZipEntry} entry @returns {Buffer} */
export function zipEntry(zip, entry) {
  if (zip.readUInt32LE(entry.offset) !== 0x04034b50) throw zipError(`local header ${entry.name}`);
  const data = entry.offset + 30 + zip.readUInt16LE(entry.offset + 26) + zip.readUInt16LE(entry.offset + 28);
  const raw = zip.subarray(data, data + entry.compressedSize);
  let bytes;
  try { bytes = entry.method === 0 ? Buffer.from(raw) : inflateRawSync(raw); } catch { throw zipError(`damaged ${entry.name}`); }
  if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) throw zipError(`damaged ${entry.name}`);
  return bytes;
}

/**
 * Unpacks the entries `place` names a path for (relative to `dest`; null skips the entry) and returns those paths. A file keeps its Unix
 * mode's execute bit (ffmpeg on macOS and Linux); `executable` adds it.
 * @param {string} file @param {string} dest @param {(name: string) => string | null} place @param {{ executable?: (name: string) => boolean }} [options]
 * @returns {Promise<string[]>}
 */
export async function unzip(file, dest, place, { executable = () => false } = {}) {
  const zip = await readFile(file), written = [];
  for (const entry of readZip(zip)) {
    if (entry.directory) continue;
    const relative = place(entry.name);
    if (relative === null) continue;
    if (!safeName(relative)) throw zipError(`unsafe target ${relative}`);
    const target = path.join(dest, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, zipEntry(zip, entry));
    if (process.platform !== 'win32' && (entry.mode & 0o111 || executable(relative))) await chmod(target, 0o755);
    written.push(relative);
  }
  return written;
}

/**
 * A pinned .tar.gz into `dest` with the system's tar (no shell). Windows' own bsdtar from System32: Git for Windows' GNU tar on PATH reads
 * `C:\…` as a remote host.
 * @param {string} file @param {string} dest @param {{ platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv }} [options] @returns {Promise<void>}
 */
export async function untar(file, dest, { platform = process.platform, env = process.env } = {}) {
  await mkdir(dest, { recursive: true });
  const tar = platform === 'win32' ? path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const code = await new Promise(resolve => {
    const child = spawn(tar, ['-xzf', file, '-C', dest], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', d => { stderr += d; });
    child.on('error', () => resolve(127));
    child.on('close', status => { if (status) process.stderr.write(stderr.slice(-2000)); resolve(status ?? 1); });
  });
  if (code !== 0) throw Object.assign(new Error(`untar-failed (exit ${code})`), { code: 'untar-failed' });
}
