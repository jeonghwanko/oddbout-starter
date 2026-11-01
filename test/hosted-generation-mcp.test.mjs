import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudHandler, hostedNext, CLOUD_ISSUER, CLOUD_RESOURCE } from '../mcp/cloud.mjs';
import { PICTURE_PAGE, TICKET_UPLOAD_URL, pictureLinkShape } from '../mcp/cloud/hosted-tools.mjs';
import { generation, png, webp } from './helpers/generation-database.mjs';

const HOSTED = ['request_hosted_fighter', 'get_hosted_fighter', 'choose_hosted_look', 'revise_hosted_motion', 'register_hosted_fighter', 'cancel_hosted_fighter',
  'list_generation_hosts', 'start_picture_upload', 'get_picture_upload', 'report_picture_link'];

// The cloud MCP over the hosted generation API on a real (PGlite) database: the agent carries the user's words and answers, the worker the rest.
async function connector(g, hosted, fetcher = async () => new Response(png(512, 512))) {
  const claims = { sub: g.owner, client_id: crypto.randomUUID(), session_id: crypto.randomUUID(), iss: CLOUD_ISSUER, aud: CLOUD_RESOURCE, role: 'af_mcp',
    af_mcp: 'registration-v1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 600 };
  const downloads = [];
  const db = { ...g.db, auth: { getClaims: async () => ({ data: { claims } }) },
    rpc: (name, args) => name === 'af_mcp_session_active' ? { data: true } : g.db.rpc(name, args) };
  const handle = createCloudHandler({ db, hosted, fetcher: async (...args) => { downloads.push(args[0]); return fetcher(...args); } });
  let loseResponse = false;
  const rpc = async (method, params) => {
    const response = await handle(new Request(CLOUD_RESOURCE, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer signed-connector-token-for-test' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }));
    if (loseResponse) { loseResponse = false; await response.body?.cancel(); throw new Error('simulated lost response'); }
    return (await response.json()).result;
  };
  return { downloads, loseNextResponse: () => { loseResponse = true; }, tools: async () => (await rpc('tools/list', {})).tools,
    call: async (name, args) => (await rpc('tools/call', { name, arguments: args })).structuredContent };
}

test('hosted generation tools list only when configured', async () => {
  const g = await generation();
  try {
    const off = (await (await connector(g, null)).tools()).map(t => t.name);
    for (const name of HOSTED) assert.ok(!off.includes(name), name);
    const on = await (await connector(g, {})).tools();
    for (const name of HOSTED) assert.ok(on.some(t => t.name === name), name);
    assert.deepEqual(on.find(t => t.name === 'request_hosted_fighter')._meta['openai/fileParams'], ['picture', 'secondPicture']);
    assert.equal(on.find(t => t.name === 'register_hosted_fighter').annotations.destructiveHint, true);
    assert.equal(on.find(t => t.name === 'get_hosted_fighter').annotations.readOnlyHint, true);
    for (const name of ['request_hosted_fighter', 'choose_hosted_look', 'revise_hosted_motion'])
      assert.equal(on.find(t => t.name === name).annotations.idempotentHint, false, name);
  } finally { await g.sql.close(); }
});

test('an agent asks ODDBOUT for a fighter, passes the picks and registers it in a handful of calls', async () => {
  const g = await generation();
  try {
    const { call, downloads } = await connector(g, { pollMs: 10 });
    const picture = { download_url: 'https://files.oaiusercontent.com/file-1', file_id: 'file-1' };
    const ask = { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko', idempotencyKey: crypto.randomUUID() };
    // Off: refused before any picture is kept.
    assert.deepEqual(await call('request_hosted_fighter', { ...ask, picture, rightsConfirmed: true }), { ok: false, code: 'generation-unavailable', reason: 'disabled' });
    assert.equal(downloads.length, 0);
    await g.healthy();
    assert.equal((await call('request_hosted_fighter', { ...ask, picture })).code, 'rights-required');
    const made = await call('request_hosted_fighter', { ...ask, picture, rightsConfirmed: true });
    assert.equal(made.job.status, 'queued'); assert.match(made.next, /get_hosted_fighter/);
    // The same key is the same job, and its picture is not uploaded again.
    assert.equal((await call('request_hosted_fighter', { ...ask, picture, rightsConfirmed: true })).job.id, made.job.id);
    assert.equal(downloads.length, 1);
    assert.equal((await g.sql.query('select count(*)::int as n from public.af_generation_uploads')).rows[0].n, 1);
    const jobId = made.job.id;
    const listed = await call('get_hosted_fighter', {});
    assert.equal(listed.capabilities.hosted, true); assert.equal(listed.jobs[0].next, made.next);
    // 보유 토큰 (2026-10-31): an open request does not use his tokens up; the balance does, and nothing was spent yet.
    assert.equal(listed.used, false); assert.deepEqual(listed.tokens, { granted: 500000, spent: 0, balance: 500000 });

    const claim = async status => { const held = (await g.work('POST', 'claim', {})).body.job; assert.equal(held.status, status); return held; };
    const finish = (held, result) => g.work('POST', 'finish', { jobId: held.id, leaseToken: held.leaseToken, outcome: 'ok', result });
    let held = await claim('queued');
    assert.equal(held.refs.length, 1);
    const draft = { name: '빨간 주먹', names: { ko: '빨간 주먹', en: 'Red Fist' }, description: '귀가 큰 고양이 복서.', concept: '성급하다',
      lines: { challenge: '덤벼!', win: '한 판 더!', lose: '다음엔…' }, stats: { power: 4, toughness: 3, speed: 2 } };
    await finish(held, { brief: { profile: draft } });
    held = await claim('appearance');
    for (const name of ['look-a-0', 'look-b-0'])
      await g.work('PUT', `jobs/${held.id}/artifacts/${name}`, webp(400, 600), { 'x-generation-lease': held.leaseToken, 'content-type': 'image/webp' });
    // waitSeconds holds the call while the worker paints; it returns the looks as soon as they are ready.
    const [waited] = await Promise.all([call('get_hosted_fighter', { jobId, waitSeconds: 5 }),
      new Promise(done => setTimeout(done, 50)).then(() => finish(held, { candidates: ['look-a-0', 'look-b-0'] }))]);
    assert.equal(waited.job.status, 'appearance_ready');
    assert.deepEqual(waited.job.candidates.map(c => c.key), ['a', 'b']); assert.match(waited.job.candidates[0].url, /look-a-0\.webp/);
    assert.match(waited.next, /choose_hosted_look/);
    assert.equal((await call('choose_hosted_look', { jobId, choose: 'a', revise: '귀를 줄여줘' })).code, 'invalid-answer');
    assert.equal((await call('choose_hosted_look', { jobId, choose: 'b' })).job.status, 'motions');

    held = await claim('motions');
    const preview = ['idle', 'walk', 'run'].map(clip => ({ clip, name: `motion-${clip}-0` }));
    await finish(held, { preview });
    const ready = await call('get_hosted_fighter', { jobId });
    assert.equal(ready.job.status, 'motion_ready'); assert.match(ready.next, /register_hosted_fighter/);
    assert.equal((await call('revise_hosted_motion', { jobId, clip: 'walk', note: '덜 통통 튀게' })).job.revisionsLeft.motions, 2);
    held = await claim('motions'); assert.deepEqual(held.motionNote, { clip: 'walk', note: '덜 통통 튀게' });
    await finish(held, { preview });

    // Registered with the worker's draft; the user's one change merges into its bout lines. The concept stays the brief's.
    const registered = await call('register_hosted_fighter', { jobId, profile: { lines: { win: '또 와!' } } });
    assert.equal(registered.job.status, 'submitting');
    held = await claim('submitting');
    assert.deepEqual(held.profile, { name: '빨간 주먹', names: { ko: '빨간 주먹', en: 'Red Fist' }, description: '귀가 큰 고양이 복서.',
      lines: { challenge: '덤벼!', win: '또 와!', lose: '다음엔…' }, stats: { power: 4, toughness: 3, speed: 2 } });
    assert.equal((await call('cancel_hosted_fighter', { jobId })).code, 'generation-state');
  } finally { await g.sql.close(); }
});

test('a lost request response resumes on a fresh connector with the same job and fresh previews, even while new requests are disabled', async () => {
  const g = await generation();
  try {
    await g.healthy();
    // Model Storage issuing a different short-lived URL on each read; this does not test actual host display.
    const storageFrom = g.db.storage.from;
    let signing = 0;
    g.db.storage.from = bucket => ({ ...storageFrom(bucket), createSignedUrls: async (paths, seconds) => {
      assert.equal(seconds, 600);
      const version = ++signing;
      return { data: paths.map(path => ({ path, signedUrl: `https://storage.test/${bucket}/${path}?token=fixture-${version}` })) };
    } });
    const original = await connector(g, {});
    const ask = { description: '큰 귀와 빨간 글러브를 가진 고양이 복서', language: 'ko', idempotencyKey: crypto.randomUUID(),
      picture: { download_url: 'https://files.oaiusercontent.com/fixture-reference', file_id: 'fixture-reference' }, rightsConfirmed: true };
    original.loseNextResponse();
    await assert.rejects(original.call('request_hosted_fighter', ask), /simulated lost response/);
    // A new handler and OAuth session retain no in-process state from the lost call.
    const resumed = await connector(g, { pollMs: 10 });
    assert.equal((await resumed.call('get_profile', {})).id, g.owner);
    const listed = await resumed.call('get_hosted_fighter', {});
    assert.equal(listed.jobs.length, 1);
    const jobId = listed.jobs[0].id;
    const replay = await resumed.call('request_hosted_fighter', ask);
    assert.equal(replay.job.id, jobId);
    assert.equal((await resumed.call('get_hosted_fighter', { idempotencyKey: ask.idempotencyKey })).job.id, jobId);
    const waiting = await resumed.call('get_hosted_fighter', { jobId, waitSeconds: 1 });
    assert.equal(waiting.job.status, 'queued'); assert.match(waiting.next, /get_hosted_fighter/);

    let held = (await g.work('POST', 'claim', {})).body.job;
    const finish = (job, result) => g.work('POST', 'finish', { jobId: job.id, leaseToken: job.leaseToken, outcome: 'ok', result });
    await finish(held, { brief: { profile: { name: 'Fixture Boxer' } } });
    held = (await g.work('POST', 'claim', {})).body.job;
    for (const name of ['look-a-0', 'look-b-0'])
      await g.work('PUT', `jobs/${held.id}/artifacts/${name}`, webp(400, 600), { 'x-generation-lease': held.leaseToken, 'content-type': 'image/webp' });
    await finish(held, { candidates: ['look-a-0', 'look-b-0'] });
    const before = await resumed.call('get_hosted_fighter', { jobId });
    assert.equal(before.job.status, 'appearance_ready');
    await g.sql.query('update public.af_generation_settings set enabled = false');
    const reconnected = await connector(g, {});
    const after = await reconnected.call('request_hosted_fighter', ask);
    assert.equal(after.job.id, jobId); assert.equal(after.job.status, 'appearance_ready');
    assert.equal(after.job.updatedAt, before.job.updatedAt); assert.equal(after.next, before.next);
    const refreshed = await reconnected.call('get_hosted_fighter', { jobId });
    assert.equal((await reconnected.call('get_hosted_fighter', { idempotencyKey: ask.idempotencyKey })).job.id, jobId);
    assert.equal(refreshed.job.updatedAt, before.job.updatedAt);
    assert.notEqual(refreshed.job.candidates[0].url, before.job.candidates[0].url);
    assert.equal(new URL(refreshed.job.candidates[0].url).pathname, new URL(before.job.candidates[0].url).pathname);
    assert.deepEqual(refreshed.job.revisionsLeft, before.job.revisionsLeft);
    assert.equal(refreshed.job.choice, null); assert.match(refreshed.next, /choose_hosted_look/);
    assert.equal(original.downloads.length, 1); assert.equal(resumed.downloads.length, 0); assert.equal(reconnected.downloads.length, 0);
    for (const table of ['af_generation_jobs', 'af_generation_uploads'])
      assert.equal((await g.sql.query(`select count(*)::int as n from public.${table}`)).rows[0].n, 1);
    // Recovery cannot create a request under a switched account, even with the service open.
    await g.healthy();
    const other = await connector({ ...g, owner: g.other }, {});
    assert.equal((await other.call('get_profile', {})).id, g.other);
    assert.deepEqual((await other.call('get_hosted_fighter', {})).jobs, []);
    assert.equal((await other.call('get_hosted_fighter', { jobId })).code, 'not-found');
    assert.equal((await other.call('get_hosted_fighter', { idempotencyKey: ask.idempotencyKey })).code, 'not-found');
    assert.equal(other.downloads.length, 0);
    for (const table of ['af_generation_jobs', 'af_generation_uploads'])
      assert.equal((await g.sql.query(`select count(*)::int as n from public.${table}`)).rows[0].n, 1);
  } finally { await g.sql.close(); }
});

test('key recovery finds an older job beyond the recent five without changing any job or upload', async () => {
  const g = await generation();
  try {
    await g.healthy();
    const key = crypto.randomUUID(), jobId = crypto.randomUUID();
    await g.sql.query(`insert into public.af_generation_jobs(id, owner_id, idempotency_key, description, language, status, created_at)
      values ($1, $2, $3, 'An older cat boxer to recover', 'en', 'cancelled', now() - interval '1 day')`, [jobId, g.owner, key]);
    for (let i = 0; i < 5; i++) await g.sql.query(`insert into public.af_generation_jobs(owner_id, idempotency_key, description, language, status)
      values ($1, $2, 'A newer unrelated cat boxer', 'en', 'cancelled')`, [g.owner, crypto.randomUUID()]);
    const client = await connector(g, {});
    const before = await g.sql.query('select * from public.af_generation_jobs order by id');
    const recent = await client.call('get_hosted_fighter', {});
    assert.equal(recent.jobs.length, 5); assert.ok(recent.jobs.every(j => j.id !== jobId));
    const recovered = await client.call('get_hosted_fighter', { idempotencyKey: key.toUpperCase() });
    assert.equal(recovered.job.id, jobId); assert.equal(recovered.job.status, 'cancelled');
    assert.equal((await client.call('get_hosted_fighter', { idempotencyKey: crypto.randomUUID() })).code, 'not-found');
    assert.equal((await client.call('get_hosted_fighter', { jobId, idempotencyKey: key })).code, 'invalid-selector');
    assert.deepEqual((await g.sql.query('select * from public.af_generation_jobs order by id')).rows, before.rows);
    assert.equal((await g.sql.query('select count(*)::int as n from public.af_generation_uploads')).rows[0].n, 0);
    assert.equal(client.downloads.length, 0);
  } finally { await g.sql.close(); }
});

test('a recovery lookup while the original reference download is pending never dispatches a second request', async () => {
  const g = await generation();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let pending;
  try {
    await g.healthy();
    let started;
    const downloading = new Promise(resolve => { started = resolve; });
    const original = await connector(g, {}, async () => { started(); await gate; return new Response(png(512, 512)); });
    const ask = { description: 'A cat boxer with red gloves and big ears', language: 'en', idempotencyKey: crypto.randomUUID(),
      picture: { download_url: 'https://files.oaiusercontent.com/pending-reference', file_id: 'pending-reference' }, rightsConfirmed: true };
    pending = original.call('request_hosted_fighter', ask);
    await Promise.race([downloading, pending.then(() => assert.fail('the original call should wait for its reference download'))]);
    const recovered = await connector(g, {});
    assert.equal((await recovered.call('get_hosted_fighter', { idempotencyKey: ask.idempotencyKey })).code, 'not-found');
    assert.equal((await g.sql.query('select count(*)::int as n from public.af_generation_jobs')).rows[0].n, 0);
    assert.equal((await g.sql.query('select count(*)::int as n from public.af_generation_uploads')).rows[0].n, 0);
    release();
    const saved = await pending;
    assert.equal((await recovered.call('get_hosted_fighter', { idempotencyKey: ask.idempotencyKey })).job.id, saved.job.id);
    assert.equal(original.downloads.length, 1); assert.equal(recovered.downloads.length, 0);
    for (const table of ['af_generation_jobs', 'af_generation_uploads'])
      assert.equal((await g.sql.query(`select count(*)::int as n from public.${table}`)).rows[0].n, 1);
  } finally { release(); await pending; await g.sql.close(); }
});

test('key lookup database errors stay errors and never fall back to listing or creating work', async () => {
  const g = await generation();
  try {
    await g.healthy();
    const from = g.db.from;
    g.db.from = table => {
      const query = from(table);
      if (table === 'af_generation_jobs') query.maybeSingle = async () => ({ error: { message: 'fixture lookup unavailable' } });
      return query;
    };
    const client = await connector(g, {});
    assert.deepEqual(await client.call('get_hosted_fighter', { idempotencyKey: crypto.randomUUID() }), { ok: false, code: 'database-unavailable' });
    assert.equal(client.downloads.length, 0);
    for (const table of ['af_generation_jobs', 'af_generation_uploads'])
      assert.equal((await g.sql.query(`select count(*)::int as n from public.${table}`)).rows[0].n, 0);
  } finally { await g.sql.close(); }
});

test('맡기기: the request leaves the look to ODDBOUT, and next says so at every step', async () => {
  const g = await generation();
  try {
    await g.healthy();
    const { call } = await connector(g, {});
    const made = await call('request_hosted_fighter', { description: '모자를 쓴 너구리 레슬러, 꼬리가 굵다', language: 'ko', delegate: true, idempotencyKey: crypto.randomUUID() });
    assert.equal(made.job.delegate, true); assert.match(made.next, /picking one itself/);
    assert.match(hostedNext({ ...made.job, status: 'motions' }), /the look it picked/);
    assert.match(hostedNext({ ...made.job, status: 'motion_ready', choice: 'b' }), /the look ODDBOUT picked \(candidate b\)/);
    // A run made from the walk: the agent tells the user and how to film a real one (2026-10-29).
    assert.match(hostedNext({ ...made.job, status: 'motion_ready', choice: 'b', preview: [{ clip: 'run', url: null, note: 'run-from-walk' }] }),
      /^The run preview is the walk played faster.*revise_hosted_motion with clip run.*Show the user/);
    assert.doesNotMatch(hostedNext({ ...made.job, status: 'motion_ready', choice: 'b' }), /walk played faster/);
    assert.match(hostedNext({ ...made.job, status: 'appearance_ready' }), /^ODDBOUT could not pick a look by itself\. Show the user both looks/);
  } finally { await g.sql.close(); }
});

test('커뮤니티 호스트: the hosts are listed to anyone, and a request names one only with the user\'s consent', async () => {
  const g = await generation();
  try {
    await g.healthy();
    const { call } = await connector(g, {});
    const hosts = await call('list_generation_hosts', {});
    assert.deepEqual(hosts.hosts.map(h => [h.name, h.official, h.online]), [['ODDBOUT', true, true]]);
    const ask = extra => call('request_hosted_fighter', { description: '모자를 쓴 너구리 레슬러, 꼬리가 굵다', language: 'ko', idempotencyKey: crypto.randomUUID(), ...extra });
    assert.equal((await ask({ host: 'any' })).code, 'host-consent-required');
    const made = await ask({ host: 'any', hostConsent: true });
    assert.equal(made.job.host.choice, 'any');
    assert.match(hostedNext({ ...made.job, status: 'appearance' }), /^Waiting for a host to take it/);
    assert.match(hostedNext({ ...made.job, status: 'appearance', host: { choice: 'host', requested: { name: '고양이 공방' }, assigned: null } }), /the host 고양이 공방/);
  } finally { await g.sql.close(); }
});

test('a request the database would refuse is refused before any of the user\'s pictures is downloaded or kept (MCP 점검 2026-10-29)', async () => {
  // Each kept picture spends one of the day's twelve uploads and stays in storage; a refused request kept two.
  const g = await generation();
  try {
    await g.healthy();
    const { call, downloads } = await connector(g, {});
    const pictures = { picture: { download_url: 'https://files.oaiusercontent.com/file-1', file_id: 'file-1' },
      secondPicture: { download_url: 'https://files.oaiusercontent.com/file-2', file_id: 'file-2' }, rightsConfirmed: true };
    const ask = extra => call('request_hosted_fighter', { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko', idempotencyKey: crypto.randomUUID(), ...pictures, ...extra });
    const kept = async () => (await g.sql.query('select count(*)::int as n from public.af_generation_uploads')).rows[0].n;
    assert.equal((await ask({ host: 'any' })).code, 'host-consent-required');
    assert.equal((await ask({ description: '짧은\u0000설명이에요요요' })).code, 'invalid-description');
    assert.equal(downloads.length, 0); assert.equal(await kept(), 0);
    const made = await ask({});
    assert.equal(made.job.status, 'queued'); assert.equal(downloads.length, 2); assert.equal(await kept(), 2);
    // One request at a time: the second is refused before its pictures move.
    assert.equal((await ask({})).code, 'generation-quota');
    assert.equal(downloads.length, 2); assert.equal(await kept(), 2);
  } finally { await g.sql.close(); }
});

test('a database failure reading the service switch is reported as one, not as the service being off', async () => {
  const g = await generation();
  try {
    await g.healthy();
    const rpc = g.db.rpc;
    g.db.rpc = (name, args) => name === 'af_generation_capabilities' ? { error: { message: 'fixture outage' } } : rpc(name, args);
    const { call, downloads } = await connector(g, {});
    const result = await call('request_hosted_fighter', { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko', idempotencyKey: crypto.randomUUID(),
      picture: { download_url: 'https://files.oaiusercontent.com/file-1', file_id: 'file-1' }, rightsConfirmed: true });
    assert.equal(result.ok, false); assert.equal(result.code, 'database-unavailable');
    assert.equal(downloads.length, 0);
  } finally { await g.sql.close(); }
});

test('next names what the user is asked or how long ODDBOUT works', () => {
  assert.match(hostedNext({ status: 'motions' }), /15 to 30 minutes/);
  assert.match(hostedNext({ status: 'motions' }), /job\.drafts as soon as it is made/);
  assert.match(hostedNext({ status: 'submitted', submission: { stage: 'registered', fighterId: 'f-1' } }), /Registered: fighter f-1/);
  assert.match(hostedNext({ status: 'submitted', submission: { stage: 'validating' } }), /waitSeconds/);
  assert.match(hostedNext({ status: 'rejected', error: 'real-person' }), /declined this request \(real-person\)/);
  // 사용량으로 시작 (2026-10-31): the reason a request waits — the subscription (until its reset), a pause, or other requests ahead
  // (minutes); first in line it is simply being made.
  const line = { status: 'appearance', host: { choice: 'oddbout' }, queue: { position: 2, reason: 'usage', resetsAt: '2026-11-01T00:00:00+00:00', dailyLimit: 10, startedToday: 10 } };
  assert.match(hostedNext(line), /capacity is used up for now: this request is number 2 in line and starts by itself after 2026-11-01T00:00:00\+00:00/);
  assert.match(hostedNext({ ...line, queue: { ...line.queue, reason: 'paused' } }), /making is paused/);
  assert.match(hostedNext({ ...line, queue: { ...line.queue, reason: 'turn', position: 3 } }), /number 3 in line: ODDBOUT makes one stage at a time/);
  assert.match(hostedNext({ ...line, queue: { ...line.queue, reason: 'turn', position: 1 } }), /painting two front-view looks/);
});

test('a picture chosen from the ChatGPT Library reaches the request; other Azure tenants and the registration tools still refuse it (2026-10-30)', async () => {
  // The Library hands a file from an Azure blob origin (docs/research/FILE-INPUT-PROOF.md): only its two observed hosts are taken.
  const g = await generation();
  try {
    await g.healthy();
    const { call, downloads } = await connector(g, {});
    const ask = picture => call('request_hosted_fighter', { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko', idempotencyKey: crypto.randomUUID(),
      picture, rightsConfirmed: true });
    assert.equal((await ask({ download_url: 'https://someone.blob.core.windows.net/files/x.png?sig=s', file_id: 'file-x' })).code, 'unsupported-file-origin');
    assert.equal(downloads.length, 0);
    const library = 'https://oaisdmntprnznorth.blob.core.windows.net/files/library.png?sig=s';
    const made = await ask({ download_url: library, file_id: 'file-library' });
    assert.equal(made.job.status, 'queued', JSON.stringify(made)); assert.deepEqual(downloads, [library]);
    assert.equal((await g.sql.query('select count(*)::int as n from public.af_generation_uploads where job_id is not null')).rows[0].n, 1);
    // Registration keeps its narrow origins (the proof's boundary): a fighter.json from the Library is refused before any download.
    const registration = await call('prepare_fighter_registration', { manifest: { download_url: library, file_id: 'file-manifest' }, idempotencyKey: crypto.randomUUID() });
    assert.equal(registration.code, 'unsupported-file-origin'); assert.equal(downloads.length, 1);
  } finally { await g.sql.close(); }
});

// 그림 올리기 표 (2026-11-01): Grok, Claude and the terminal agents attach no file ChatGPT's way; their pictures go in through a ticket.
test('an agent without file attachments sends the user\'s pictures through a ticket and names them in the request', async () => {
  const g = await generation();
  try {
    const { call, downloads } = await connector(g, { pollMs: 10 });
    await g.healthy();
    const started = await call('start_picture_upload', {});
    assert.equal(started.ok, true, JSON.stringify(started));
    const ticket = started.ticket.id;
    assert.equal(started.page, `${PICTURE_PAGE}${ticket}`);
    assert.equal(started.ticket.secret, undefined);
    const [, secret] = /x-oddbout-upload-ticket: (afu_[a-f0-9]{64})/.exec(started.command) ?? [];
    assert.ok(secret, started.command);
    assert.ok(started.command.endsWith(` ${TICKET_UPLOAD_URL}`) && started.command.includes('"@<file>"'), started.command);
    // A terminal runs the command; the user adds the other on the site.
    assert.equal((await g.call('POST', 'generations/ticket-uploads', png(512, 512), null, { 'x-oddbout-upload-ticket': secret })).status, 200);
    assert.equal((await g.call('POST', `generations/uploads?ticket=${ticket}`, webp(400, 600))).status, 200);
    const read = await call('get_picture_upload', { ticketId: ticket });
    assert.deepEqual([read.ticket.open, read.ticket.uploads.length], [false, 2]);
    const ids = read.ticket.uploads.map(u => u.id), ask = { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko' };
    // Two in all with attached files, refused before any attached one is downloaded; the rights confirmed as for any picture.
    const attached = { download_url: 'https://files.oaiusercontent.com/file-1', file_id: 'file-1' };
    assert.equal((await call('request_hosted_fighter', { ...ask, picture: attached, pictureUploads: ids, rightsConfirmed: true,
      idempotencyKey: crypto.randomUUID() })).code, 'invalid-refs');
    assert.equal((await call('request_hosted_fighter', { ...ask, pictureUploads: ids, idempotencyKey: crypto.randomUUID() })).code, 'rights-required');
    const made = await call('request_hosted_fighter', { ...ask, pictureUploads: ids, rightsConfirmed: true, idempotencyKey: crypto.randomUUID() });
    assert.equal(made.job.status, 'queued', JSON.stringify(made));
    assert.equal(downloads.length, 0);
    assert.equal((await g.work('POST', 'claim', {})).body.job.refs.length, 2);
    assert.deepEqual((await call('get_picture_upload', { ticketId: ticket })).ticket.uploads.map(u => u.used), [true, true]);
  } finally { await g.sql.close(); }
});

test('a picture address an agent reports is noted by its kind and host only, never fetched', async t => {
  assert.deepEqual(pictureLinkShape('https://images.example.test/u/1234/gen/abc.JPG?sig=secret#x'), { kind: 'url', protocol: 'https:',
    hostname: 'images.example.test', port: '', hasUserInfo: false, hasQuery: true, hasFragment: true, pathSegments: 4, extension: 'jpg' });
  assert.deepEqual(pictureLinkShape('data:image/png;base64,iVBORw0KGgo='), { kind: 'data-url', mediaType: 'image/png', length: 34 });
  assert.deepEqual(pictureLinkShape('file-Ab3_9'), { kind: 'not-a-url', length: 10, shape: 'aaaa-aa9_9' });
  const g = await generation();
  try {
    const logged = t.mock.method(console, 'log', () => {});
    const { call, downloads } = await connector(g, {});
    const noted = await call('report_picture_link', { url: 'https://images.example.test/u/1234/gen/abc.png?sig=secret', madeBy: 'Grok Imagine' });
    assert.deepEqual([noted.ok, noted.fetched, noted.kept, noted.observed.hostname], [true, false, false, 'images.example.test']);
    assert.equal(downloads.length, 0);
    const line = logged.mock.calls.map(c => String(c.arguments[0])).find(text => text.includes('picture-link-probe'));
    assert.ok(line && line.includes('"madeBy":"Grok Imagine"') && !line.includes('secret') && !line.includes('1234'), line);
  } finally { await g.sql.close(); }
});
