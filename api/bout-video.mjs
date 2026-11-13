// @ts-check
// A seeded bout rendered to one X-ready MP4 (2026-11-13). The cloud tool asks for the arena's record, then
// stores a job here. A separate process on a machine with a browser (scripts/bout-video.mjs) claims the job,
// films the playback page and uploads the file. The edge function does not run a browser: a bout is longer
// than its call budget, and the free validator must stay free for packages. The same cache key (pair, seed,
// rules, digest, trim, aspect, renderer version) is one video. This module does not call X.
import { Problem, sha256, unavailable } from './http.mjs';
import { BOUT_CANVAS } from './bout-video-canvas.mjs';

export { BOUT_CANVAS } from './bout-video-canvas.mjs';

export const BOUT_VIDEO_BUCKET = 'af-bout-videos';
export const BOUT_VIDEO_TABLE = 'af_bout_videos';
/** Bumped when the composed file changes, so an old object is not served as the new cut. */
export const BOUT_VIDEO_VERSION = 1;
const IN_FLIGHT = 2;
const COOLDOWN_MS = 30_000;
export const BOUT_VIDEO_LEASE_S = 900;
const SIGNED_S = 600;
const MAX_BYTES = 40 * 1024 * 1024;
const MAX_SECONDS = 180;

/** @param {string} text */
async function digestKey(text) {
  return sha256(new TextEncoder().encode(text));
}

/**
 * @param {{ a: string, b: string, seed: number, rules: number, digest: string, stamina: string | null, trim: string, aspect: string }} parts
 */
export async function boutVideoCacheKey(parts) {
  return digestKey(
    JSON.stringify({
      v: BOUT_VIDEO_VERSION,
      a: parts.a,
      b: parts.b,
      seed: parts.seed,
      rules: parts.rules,
      digest: parts.digest,
      stamina: parts.stamina,
      trim: parts.trim,
      aspect: parts.aspect,
    }),
  );
}

/** @param {any} error */
function check(error) {
  if (error) throw unavailable('database-unavailable', error);
}

/** @param {any} db @param {string} key */
async function findKey(db, key) {
  const { data, error } = await db.from(BOUT_VIDEO_TABLE).select('*').eq('cache_key', key).maybeSingle();
  check(error);
  return data;
}

/** @param {any} db @param {string} id */
export async function readBoutVideo(db, id) {
  const { data, error } = await db.from(BOUT_VIDEO_TABLE).select('*').eq('id', id).maybeSingle();
  check(error);
  return data;
}

/** @param {any} db @param {string} owner */
async function inFlight(db, owner) {
  const { count, error } = await db
    .from(BOUT_VIDEO_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('requested_by', owner)
    .in('status', ['queued', 'rendering']);
  check(error);
  return count ?? 0;
}

/**
 * The job for this bout, creating it when it is new. A ready or in-flight job is returned as it is.
 * A failure older than the cooldown is queued again. The caller's own in-flight jobs are capped.
 * @param {any} db
 * @param {{ owner: string, a: string, b: string, seed: number, rules: number, digest: string, stamina?: readonly [number, number] | null,
 *   trim: 'full' | 'highlights', aspect: '16:9' | '1:1', page: string, caption: string | null, intent: string | null, reply: string | null,
 *   record: object, fighters: object }} bout
 */
export async function requestBoutVideo(db, bout) {
  const stamina = bout.stamina ? `${bout.stamina[0]}-${bout.stamina[1]}` : null;
  const cacheKey = await boutVideoCacheKey({
    a: bout.a,
    b: bout.b,
    seed: bout.seed,
    rules: bout.rules,
    digest: bout.digest,
    stamina,
    trim: bout.trim,
    aspect: bout.aspect,
  });
  const existing = await findKey(db, cacheKey);
  if (existing) {
    if (existing.status !== 'failed') return existing;
    if (existing.failed_at && Date.now() - Date.parse(existing.failed_at) < COOLDOWN_MS) return existing;
    if ((await inFlight(db, bout.owner)) >= IN_FLIGHT) return { ok: false, code: 'bout-video-busy' };
    const { data, error } = await db
      .from(BOUT_VIDEO_TABLE)
      .update({ status: 'queued', error_code: null, lease_token: null, lease_until: null, failed_at: null })
      .eq('id', existing.id)
      .eq('status', 'failed')
      .select('*')
      .maybeSingle();
    check(error);
    return data ?? (await findKey(db, cacheKey));
  }
  if ((await inFlight(db, bout.owner)) >= IN_FLIGHT) return { ok: false, code: 'bout-video-busy' };
  const row = {
    cache_key: cacheKey,
    requested_by: bout.owner,
    a: bout.a,
    b: bout.b,
    seed: bout.seed,
    rules: bout.rules,
    digest: bout.digest,
    stamina,
    trim: bout.trim,
    aspect: bout.aspect,
    status: 'queued',
    page: bout.page,
    caption: bout.caption,
    intent: bout.intent,
    reply: bout.reply,
    record: bout.record,
    fighters: bout.fighters,
    object_path: null,
  };
  const { data, error } = await db.from(BOUT_VIDEO_TABLE).insert(row).select('*').single();
  if (error?.code === '23505') {
    const raced = await findKey(db, cacheKey);
    if (!raced) throw unavailable('database-unavailable', error);
    return raced;
  }
  check(error);
  return data;
}

/**
 * What an assistant is given. A ready job includes a short-lived download URL. No X credential is involved.
 * @param {any} db @param {any} row
 */
export async function presentBoutVideo(db, row) {
  if (row?.ok === false) return row;
  /** @type {Record<string, unknown> | null} */
  let video = null;
  if (row.status === 'ready' && typeof row.object_path === 'string') {
    const { data, error } = await db.storage.from(BOUT_VIDEO_BUCKET).createSignedUrl(row.object_path, SIGNED_S);
    if (error || typeof data?.signedUrl !== 'string') throw unavailable('storage-unavailable', error);
    video = {
      url: data.signedUrl,
      bytes: row.bytes,
      seconds: row.seconds,
      width: row.width,
      height: row.height,
      sha256: row.sha256,
      expiresIn: SIGNED_S,
    };
  }
  const record = row.record && typeof row.record === 'object' ? row.record : {};
  return {
    ok: true,
    status: row.status,
    postsToX: false,
    page: row.page,
    caption: row.caption,
    intent: row.intent,
    reply: row.reply,
    digest: row.digest,
    a: row.a,
    b: row.b,
    seed: Number(row.seed),
    rules: row.rules,
    trim: row.trim_applied ?? row.trim,
    aspect: row.aspect,
    record: { winner: record.winner, how: record.how, ms: record.ms, hp: record.hp, digest: row.digest },
    ...(row.status === 'failed' && row.error_code ? { code: row.error_code } : {}),
    ...(video ? { video } : {}),
    next:
      row.status === 'ready'
        ? "Download video.url and post it with the user's own X connection. Put reply in the first reply, not the main post. This tool does not post or sign in to X."
        : row.status === 'failed'
          ? 'The render failed. Call render_bout_video again with the same arguments after the playback page can play this pair.'
          : "The video is rendering. Call render_bout_video again with the same arguments. digest is the spar record's digest. This tool does not post or sign in to X.",
  };
}

/** The next job for the renderer, or null. The lease is the claim's. @param {any} db @param {string} lease */
export async function claimBoutVideo(db, lease) {
  const { data, error } = await db.rpc('af_bout_video_claim', { p_lease: lease, p_seconds: BOUT_VIDEO_LEASE_S });
  check(error);
  if (!data) return null;
  const path = `${data.id}.mp4`;
  const { data: upload, error: uploadError } = await db.storage.from(BOUT_VIDEO_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (uploadError || !upload?.signedUrl) throw unavailable('storage-unavailable', uploadError);
  const canvas = BOUT_CANVAS[/** @type {'16:9' | '1:1'} */ (data.aspect)] ?? BOUT_CANVAS['16:9'];
  return {
    id: data.id,
    leaseToken: lease,
    page: data.page,
    digest: data.digest,
    trim: data.trim,
    aspect: data.aspect,
    width: canvas.width,
    height: canvas.height,
    record: data.record,
    fighters: data.fighters,
    upload: { url: upload.signedUrl, token: upload.token ?? null, path },
  };
}

/** @param {Uint8Array} bytes @param {number[]} needle */
function includesBytes(bytes, needle) {
  const limit = Math.min(bytes.length, 2_000_000);
  outer: for (let i = 0; i + needle.length <= limit; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * Duration of an H.264 MP4, from its `mvhd` box. Throws when the file is not one.
 * Faststart puts `avc1` near the front; a scan of the first 2 MB is enough for a file this encoder writes.
 * @param {Uint8Array} bytes
 */
function inspectBoutMp4(bytes) {
  if (bytes.length < 32) throw new Problem(422, 'bout-video-codec');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  /** @param {number} at @param {number} n */
  const ascii = (at, n) => String.fromCharCode(...bytes.subarray(at, at + n));
  if (!includesBytes(bytes, [0x61, 0x76, 0x63, 0x31]) && !includesBytes(bytes, [0x61, 0x76, 0x63, 0x33])) throw new Problem(422, 'bout-video-codec');
  let duration = 0,
    ftyp = false;
  /** @param {number} start @param {number} end @param {number} depth */
  const boxes = (start, end, depth) => {
    let offset = start;
    while (offset + 8 <= end) {
      let size = view.getUint32(offset),
        header = 8;
      const type = ascii(offset + 4, 4);
      if (size === 1) {
        if (offset + 16 > end) break;
        size = Number(view.getBigUint64(offset + 8));
        header = 16;
      }
      if (size === 0) size = end - offset;
      if (size < header || offset + size > end) break;
      const payload = offset + header;
      if (depth === 0 && type === 'ftyp') ftyp = true;
      if (type === 'mvhd' && payload < end) {
        const version = bytes[payload];
        const scaleAt = payload + (version === 1 ? 20 : 12);
        const lengthAt = payload + (version === 1 ? 24 : 16);
        if ((version === 0 || version === 1) && lengthAt + (version === 1 ? 8 : 4) <= offset + size) {
          const scale = view.getUint32(scaleAt);
          const ticks = version === 1 ? Number(view.getBigUint64(lengthAt)) : view.getUint32(lengthAt);
          if (scale) duration = ticks / scale;
        }
      }
      if (type === 'moov' || type === 'trak' || type === 'mdia') boxes(payload, offset + size, depth + 1);
      offset += size;
    }
  };
  boxes(0, bytes.length, 0);
  if (!ftyp || !(duration > 0)) throw new Problem(422, 'bout-video-codec');
  return duration;
}

/**
 * The uploaded object becomes the job's file when it is an H.264 MP4 of the expected canvas and digest.
 * @param {any} db @param {{ id?: string, leaseToken?: string, sha256?: string, width?: number, height?: number, trimApplied?: string }} body
 */
export async function finishBoutVideo(db, body) {
  if (typeof body.id !== 'string' || typeof body.leaseToken !== 'string') throw new Problem(400, 'invalid-bout-video');
  if (typeof body.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.sha256)) throw new Problem(400, 'invalid-bout-video');
  const row = await readBoutVideo(db, body.id);
  if (row?.status !== 'rendering' || row.lease_token !== body.leaseToken) throw new Problem(409, 'bout-video-lease');
  const canvas = BOUT_CANVAS[/** @type {'16:9' | '1:1'} */ (row.aspect)];
  if (!canvas || body.width !== canvas.width || body.height !== canvas.height) throw new Problem(422, 'bout-video-size');
  const path = `${row.id}.mp4`;
  const { data, error } = await db.storage.from(BOUT_VIDEO_BUCKET).download(path);
  if (error || !data) throw new Problem(422, 'bout-video-missing');
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new Problem(422, 'bout-video-too-large');
  const hashed = await sha256(bytes);
  if (hashed !== body.sha256) throw new Problem(422, 'bout-video-hash');
  const duration = inspectBoutMp4(bytes);
  if (duration > MAX_SECONDS) throw new Problem(422, 'bout-video-too-long');
  const trimApplied = body.trimApplied === 'full' || body.trimApplied === 'highlights' ? body.trimApplied : row.trim;
  const { data: saved, error: saveError } = await db
    .from(BOUT_VIDEO_TABLE)
    .update({
      status: 'ready',
      object_path: path,
      bytes: bytes.byteLength,
      seconds: Math.round(duration * 10) / 10,
      width: canvas.width,
      height: canvas.height,
      sha256: hashed,
      trim_applied: trimApplied,
      lease_token: null,
      lease_until: null,
      ready_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('lease_token', body.leaseToken)
    .eq('status', 'rendering')
    .select('*')
    .maybeSingle();
  check(saveError);
  if (!saved) throw new Problem(409, 'bout-video-lease');
  return { ok: true, status: 'ready', id: saved.id };
}

/** @param {any} db @param {{ id?: string, leaseToken?: string, code?: string }} body */
export async function failBoutVideo(db, body) {
  if (typeof body.id !== 'string' || typeof body.leaseToken !== 'string') throw new Problem(400, 'invalid-bout-video');
  if (typeof body.code !== 'string' || !/^[a-z0-9-]{1,64}$/.test(body.code)) throw new Problem(400, 'invalid-bout-video');
  const { data, error } = await db
    .from(BOUT_VIDEO_TABLE)
    .update({ status: 'failed', error_code: body.code, lease_token: null, lease_until: null, failed_at: new Date().toISOString() })
    .eq('id', body.id)
    .eq('lease_token', body.leaseToken)
    .eq('status', 'rendering')
    .select('id')
    .maybeSingle();
  check(error);
  if (!data) throw new Problem(409, 'bout-video-lease');
  return { ok: true, status: 'failed', code: body.code };
}

/**
 * The validator's worker token, on `worker/bout-video/*` only. Claim, finish and fail.
 * @param {any} db @param {string | undefined} action @param {any} body
 */
export async function handleBoutVideoWorker(db, action, body) {
  if (action === 'claim') {
    const lease = crypto.randomUUID();
    const job = await claimBoutVideo(db, lease);
    return job ? { ok: true, stage: 'rendering', job } : { ok: true, stage: 'idle' };
  }
  if (action === 'finish') return finishBoutVideo(db, body ?? {});
  if (action === 'fail') return failBoutVideo(db, body ?? {});
  throw new Problem(404, 'route-not-found');
}
