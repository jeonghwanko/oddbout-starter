// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHandler } from '../api/handler.mjs';
import { sha256 } from '../api/http.mjs';
import { finishBoutVideo, presentBoutVideo, requestBoutVideo } from '../api/bout-video.mjs';
import { acceptPlayed, composeBoutFile, filmBout, recordingCut, trimSeconds } from '../scripts/bout-video-render.mjs';
import { runBoutVideoOnce, runBoutVideoWorker } from '../scripts/bout-video.mjs';
import { CLOUD_ISSUER, CLOUD_RESOURCE, createCloudHandler as cloudHandler } from '../mcp/cloud.mjs';

const A = 'f600611b-ae49-4c9c-ae81-8a9b4a1cb9d9';
const B = 'b3dfcb95-0cb5-440c-8047-e17f7f54a4e0';
const DIGEST = '0123abcd';

/** A bout-video table and a private bucket, enough for the store. */
function memory() {
  /** @type {any[]} */
  const rows = [];
  /** @type {Map<string, Uint8Array>} */
  const objects = new Map();
  const from = table => {
    if (table !== 'af_bout_videos') throw new Error(table);
    /** @type {[string, any][]} */
    const filters = [];
    /** @type {any} */
    let patch = null;
    /** @type {any} */
    let inserted = null;
    let counting = false;
    const matching = () => rows.filter(row => filters.every(([key, value]) => (Array.isArray(value) ? value.includes(row[key]) : row[key] === value)));
    const api = {
      select(_columns, options) {
        counting = options?.head === true;
        return api;
      },
      insert(row) {
        inserted = { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() };
        return api;
      },
      update(value) {
        patch = value;
        return api;
      },
      eq(key, value) {
        filters.push([key, value]);
        return api;
      },
      in(key, value) {
        filters.push([key, value]);
        return api;
      },
      async maybeSingle() {
        if (patch) {
          const hit = matching()[0];
          if (!hit) return { data: null, error: null };
          Object.assign(hit, patch);
          return { data: { ...hit }, error: null };
        }
        const hit = matching()[0] ?? null;
        return { data: hit ? { ...hit } : null, error: null };
      },
      async single() {
        if (rows.some(row => row.cache_key === inserted.cache_key)) return { data: null, error: { code: '23505' } };
        rows.push(inserted);
        return { data: { ...inserted }, error: null };
      },
      then(resolve, reject) {
        return Promise.resolve({ count: matching().length, data: counting ? null : matching(), error: null }).then(resolve, reject);
      },
    };
    return api;
  };
  return {
    rows,
    objects,
    from,
    storage: {
      from: () => ({
        createSignedUrl: async key => ({ data: { signedUrl: `https://storage.test/${key}` }, error: null }),
        createSignedUploadUrl: async key => ({ data: { signedUrl: `https://upload.test/${key}`, token: 't', path: key }, error: null }),
        download: async key => (objects.has(key) ? { data: objects.get(key), error: null } : { data: null, error: { message: 'missing' } }),
      }),
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

/** @param {ReturnType<typeof memory>} db */
function sample(db, owner = crypto.randomUUID()) {
  return requestBoutVideo(db, {
    owner,
    a: A,
    b: B,
    seed: 7,
    rules: 42,
    digest: DIGEST,
    trim: 'full',
    aspect: '16:9',
    page: `https://oddbout.com/fighter.html?play=1&fighter=${A}&opponent=${B}&bout=7`,
    caption: '칩대장 대 만년주석.',
    intent: 'https://x.com/intent/post?text=x',
    reply: 'https://oddbout.com/fighter.html?play=1',
    record: { winner: 0, how: 'ko', ms: 43500, digest: DIGEST, hp: [0.2, 0] },
    fighters: [{ name: '칩대장' }, { name: '만년주석' }],
  });
}

test('one pair and seed is one job, a third in-flight request waits, and a ready job is a download', async () => {
  const db = memory();
  const owner = crypto.randomUUID();
  const first = await sample(db, owner);
  const again = await sample(db, owner);
  assert.equal(first.id, again.id);
  assert.equal(first.status, 'queued');
  assert.equal(db.rows.length, 1);
  const other = { ...(await sample(db, owner)), seed: 8 };
  await requestBoutVideo(db, {
    ...other,
    seed: 8,
    owner,
    a: A,
    b: B,
    rules: 42,
    digest: 'abcdef01',
    trim: 'full',
    aspect: '16:9',
    page: 'https://oddbout.com/fighter.html?play=1',
    caption: null,
    intent: null,
    reply: null,
    record: { digest: 'abcdef01' },
    fighters: [],
  });
  const busy = await requestBoutVideo(db, {
    ...other,
    seed: 9,
    owner,
    digest: '00abcdef',
    record: { digest: '00abcdef' },
    page: 'https://oddbout.com/fighter.html?play=1',
  });
  assert.equal(busy.code, 'bout-video-busy');
  const shown = await presentBoutVideo(db, first);
  assert.equal(shown.postsToX, false);
  assert.equal(shown.digest, DIGEST);
  assert.equal(shown.video, undefined);
  assert.match(shown.next, /does not post/);
});

test('the worker route claims nothing for a valid token and refuses everyone else', async () => {
  const token = `afw_${'ab'.repeat(32)}`;
  const store = memory();
  const handle = createHandler({
    db: {
      from(table) {
        if (table === 'af_workers') {
          const api = {
            select: () => api,
            eq: () => api,
            gt: () => api,
            maybeSingle: async () => ({ data: { token_hash: 'x', host_id: null }, error: null }),
          };
          return api;
        }
        return store.from(table);
      },
      rpc: async name => (name === 'af_bout_video_claim' ? { data: null, error: null } : { data: true, error: null }),
      storage: store.storage,
    },
  });
  const denied = await handle(new Request('https://test/ai-fighter/worker/bout-video/claim', { method: 'POST', body: '{}' }));
  assert.equal(denied.status, 401);
  const idle = await (
    await handle(
      new Request('https://test/ai-fighter/worker/bout-video/claim', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: '{}',
      }),
    )
  ).json();
  assert.deepEqual(idle, { ok: true, stage: 'idle' });
  assert.equal(token.length, 4 + 64);
});

test('a film is refused when the page is the club or the digest is not the bout, and the worker records that refusal', async () => {
  assert.equal(acceptPlayed({ digest: DIGEST }, DIGEST).digest, DIGEST);
  assert.throws(() => acceptPlayed({ missing: true }, DIGEST), /playback-unavailable/);
  assert.throws(() => acceptPlayed({ digest: 'ffffffff' }, DIGEST), /digest-mismatch/);
  const club = 'https://oddbout.com/fighter.html?club=1&lang=ko';
  await assert.rejects(
    filmBout({
      url: club,
      expectedDigest: DIGEST,
      width: 1280,
      height: 720,
      timeoutMs: 1000,
      open: async () => ({ url: () => club, played: async () => ({ digest: DIGEST }), close: async () => {} }),
    }),
    /playback-unavailable/,
  );
  /** @type {any[]} */
  const sent = [];
  const outcome = await runBoutVideoOnce({
    send: async (route, body) => {
      sent.push([route, body]);
      if (route.endsWith('/claim'))
        return { stage: 'rendering', job: { id: 'job', leaseToken: 'lease', upload: { url: 'https://upload.test/job.mp4' }, page: club, digest: DIGEST } };
      return { ok: true };
    },
    render: async () => {
      throw Object.assign(new Error('playback-unavailable'), { code: 'playback-unavailable' });
    },
  });
  assert.equal(outcome, 'failed');
  assert.deepEqual(sent[1], ['worker/bout-video/fail', { id: 'job', leaseToken: 'lease', code: 'playback-unavailable' }]);
  assert.equal(trimSeconds({ ms: 43500, highlights: [{ ms: 10000 }] })?.start, 9);
});

test('a claimed render uploads one file and finishes with its hash', async () => {
  /** @type {any[]} */
  const sent = [];
  /** @type {Uint8Array | null} */
  let uploaded = null;
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const outcome = await runBoutVideoOnce({
    send: async (route, body) => {
      sent.push([route, body]);
      if (route.endsWith('/claim'))
        return {
          stage: 'rendering',
          job: { id: 'job', leaseToken: 'lease', width: 1280, height: 720, upload: { url: 'https://upload.test/job.mp4' } },
        };
      return { ok: true };
    },
    render: async () => ({ bytes, sha256: await sha256(bytes), width: 1280, height: 720, trimApplied: 'full' }),
    upload: async (_url, body) => {
      uploaded = body;
    },
  });
  assert.equal(outcome, 'ready');
  assert.deepEqual(uploaded, bytes);
  assert.equal(sent[1][0], 'worker/bout-video/finish');
  assert.equal(sent[1][1].sha256, await sha256(bytes));
  assert.equal(
    sent.some(call => String(call[0]).includes('x.com')),
    false,
  );
});

test('finish accepts an H.264 file of the canvas and rejects a different picture', async t => {
  if (
    spawnSync('ffmpeg', ['-hide_banner', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:d=0.5', '-frames:v', '1', '-f', 'null', '-'], { stdio: 'ignore' })
      .status !== 0
  ) {
    t.skip('ffmpeg has no lavfi');
    return;
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'bout-finish-'));
  try {
    const file = path.join(dir, 'bout.mp4');
    const encoded = spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=1280x720:d=1',
        '-c:v',
        'libx264',
        '-profile:v',
        'high',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        file,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(encoded.status, 0, encoded.stderr);
    const bytes = new Uint8Array(await readFile(file));
    const db = memory();
    const row = await sample(db);
    db.rows[0].status = 'rendering';
    db.rows[0].lease_token = 'lease';
    db.objects.set(`${row.id}.mp4`, bytes);
    const done = await finishBoutVideo(db, { id: row.id, leaseToken: 'lease', sha256: await sha256(bytes), width: 1280, height: 720, trimApplied: 'full' });
    assert.equal(done.status, 'ready');
    const shown = await presentBoutVideo(db, db.rows[0]);
    assert.equal(shown.video.url, `https://storage.test/${row.id}.mp4`);
    assert.equal(shown.video.width, 1280);
    assert.equal(shown.postsToX, false);
    db.rows[0].status = 'rendering';
    db.rows[0].lease_token = 'lease';
    await assert.rejects(finishBoutVideo(db, { id: row.id, leaseToken: 'lease', sha256: await sha256(bytes), width: 720, height: 720 }), /bout-video-size/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the composed file is an even H.264 picture with the intro and the end card', async t => {
  if (
    spawnSync('ffmpeg', ['-hide_banner', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:d=0.5', '-frames:v', '1', '-f', 'null', '-'], { stdio: 'ignore' })
      .status !== 0
  ) {
    t.skip('ffmpeg has no lavfi');
    return;
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'bout-compose-'));
  try {
    const raw = path.join(dir, 'raw.mp4');
    const out = path.join(dir, 'out.mp4');
    const encoded = spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=320x180:d=0.4',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        raw,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(encoded.status, 0, encoded.stderr);
    await composeBoutFile({ boutPath: raw, out, width: 320, height: 180, left: '칩대장', right: '만년주석', winner: '칩대장', trim: null });
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,pix_fmt:format=duration', '-of', 'json', out], {
      encoding: 'utf8',
    });
    const video = JSON.parse(probe.stdout).streams[0];
    assert.equal(video.codec_name, 'h264');
    assert.equal(video.pix_fmt, 'yuv420p');
    assert.equal(video.width % 2, 0);
    assert.equal(video.height % 2, 0);
    assert.ok(Number(JSON.parse(probe.stdout).format.duration) > 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('spar and render_bout_video return the playback page and a queued file, and do not post', async () => {
  const store = memory();
  const owner = crypto.randomUUID();
  const arena = {
    url: 'https://arena.test/oddbout-arena',
    key: 'k'.repeat(64),
    fetcher: async url => {
      if (String(url).includes('/bout?'))
        return Response.json({
          ok: true,
          a: A,
          b: B,
          seed: 7,
          rules: 42,
          page: null,
          fighters: [{ name: '칩대장' }, { name: '만년주석' }],
          record: { winner: 0, how: 'ko', ms: 43500, digest: DIGEST, hp: [0.2, 0] },
        });
      if (String(url).includes('/agent/spar'))
        return Response.json({
          ok: true,
          a: A,
          b: B,
          seed: 7,
          rules: 42,
          page: null,
          fighters: [{ name: '칩대장' }, { name: '만년주석' }],
          record: { winner: 0, how: 'ko', ms: 43500, digest: DIGEST },
        });
      return Response.json({ ok: true });
    },
  };
  const handle = cloudHandler({
    log: () => {},
    arena,
    db: {
      auth: {
        getClaims: async () => ({
          data: {
            claims: {
              sub: owner,
              client_id: crypto.randomUUID(),
              session_id: crypto.randomUUID(),
              iss: CLOUD_ISSUER,
              aud: CLOUD_RESOURCE,
              role: 'af_mcp',
              af_mcp: 'registration-v1',
              is_anonymous: false,
              exp: Math.floor(Date.now() / 1000) + 600,
              email: 'owner@example.com',
            },
          },
        }),
      },
      rpc: async () => ({ data: 'usable' }),
      from: store.from,
      storage: store.storage,
    },
  });
  const call = async (name, args) => {
    const response = await handle(
      new Request(CLOUD_RESOURCE, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer signed-connector-token-for-test' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      }),
    );
    const body = await response.json();
    return body.result.structuredContent ?? JSON.parse(body.result.content[0].text);
  };
  const spar = await call('spar', { fighterId: A, opponentId: B, seed: 7 });
  const page = new URL(spar.page);
  assert.equal(page.searchParams.get('play'), '1');
  assert.equal(page.searchParams.get('fighter'), A);
  assert.equal(page.searchParams.get('opponent'), B);
  assert.equal(page.searchParams.get('club'), null);
  assert.equal(spar.share.postsToX, false);
  const video = await call('render_bout_video', { a: A, b: B, seed: 7 });
  assert.equal(video.status, 'queued');
  assert.equal(video.digest, DIGEST);
  assert.equal(video.postsToX, false);
  assert.equal(video.video, undefined);
  assert.equal(video.record.how, 'ko');
});

test('the cut starts where the bout started in the recording, not at the loading screen', async () => {
  // Highlights are bout time; the recording began when the page opened, 3.2 s earlier.
  assert.deepEqual(recordingCut(3.2, { start: 9, end: 45 }), { start: 12.2, end: 48.2 });
  assert.deepEqual(recordingCut(3.2, null), { start: 3.2 });
  assert.deepEqual(recordingCut(Number.NaN, null), { start: 0 });
  // A record in seconds pads by the same second, not a thousand.
  assert.deepEqual(trimSeconds({ ms: 43.5, highlights: [12, 40] }), { start: 11, end: 45 });
  const page = 'https://oddbout.com/fighter.html?play=1&fighter=a&opponent=b&bout=7';
  /** @param {number | null} started */
  const open = started => async () => ({ url: () => page, started: async () => started, played: async () => DIGEST, close: async () => {} });
  const filmed = await filmBout({ url: page, expectedDigest: DIGEST, width: 1280, height: 720, timeoutMs: 1000, open: open(2.5) });
  assert.deepEqual(filmed, { played: { digest: DIGEST }, startOffset: 2.5 });
  // The hook never appeared (a pair the game refused): no film.
  await assert.rejects(filmBout({ url: page, expectedDigest: DIGEST, width: 1280, height: 720, timeoutMs: 1000, open: open(null) }), /playback-unavailable/);
});

test('the worker keeps claiming after a thrown request', async () => {
  /** @type {number[]} */
  const waits = [];
  /** @type {string[]} */
  const logs = [];
  let calls = 0;
  await runBoutVideoWorker({
    send: async () => {
      calls++;
      if (calls <= 2) throw Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' });
      return { ok: true, stage: 'idle' };
    },
    render: async () => {
      throw new Error('not called');
    },
    sleep: async ms => {
      waits.push(ms);
    },
    log: message => logs.push(message),
    stop: () => calls >= 3,
  });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [5000, 10000, 5000]);
  assert.match(logs[0], /ECONNRESET/);
});
