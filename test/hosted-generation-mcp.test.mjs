import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudHandler, hostedNext, CLOUD_ISSUER, CLOUD_RESOURCE } from '../mcp/cloud.mjs';
import { PICTURE_PAGE, TICKET_UPLOAD_URL, pictureLinkShape } from '../mcp/cloud/hosted-tools.mjs';
import { CREATOR_PAGE, siteUrl } from '../mcp/cloud/common.mjs';
import { generation, png, webp } from './helpers/generation-database.mjs';

const HOSTED = ['request_hosted_fighter', 'get_hosted_fighter', 'choose_hosted_look', 'revise_hosted_motion', 'register_hosted_fighter', 'cancel_hosted_fighter',
  'list_generation_hosts', 'start_picture_upload', 'get_picture_upload', 'report_picture_link'];

// The cloud MCP over the hosted generation API on a real (PGlite) database: the agent carries the user's words and answers, the worker the rest.
async function connector(g, hosted, fetcher = async () => new Response(png(512, 512)), { budgetMs, clientId = crypto.randomUUID(), meta } = {}) {
  const claims = { sub: g.owner, client_id: clientId, session_id: crypto.randomUUID(), iss: CLOUD_ISSUER, aud: CLOUD_RESOURCE, role: 'af_mcp',
    af_mcp: 'registration-v1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 600 };
  const downloads = [];
  const db = { ...g.db, auth: { getClaims: async () => ({ data: { claims } }) },
    rpc: (name, args) => name === 'af_mcp_session_state' ? { data: 'usable' } : g.db.rpc(name, args) };
  const handle = createCloudHandler({ db, hosted, budgetMs, log: () => {}, fetcher: async (...args) => { downloads.push(args[0]); return fetcher(...args); } });
  let loseResponse = false, bytes = 0;
  const rpc = async (method, params) => {
    const response = await handle(new Request(CLOUD_RESOURCE, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer signed-connector-token-for-test' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: meta && method === 'tools/call' ? { ...params, _meta: meta } : params }) }));
    if (loseResponse) { loseResponse = false; await response.body?.cancel(); throw new Error('simulated lost response'); }
    const text = await response.text();
    bytes = Buffer.byteLength(text);
    return JSON.parse(text).result;
  };
  // A tool's JSON: a host other than ChatGPT gets it as the text only (MCP 최적화 2026-11-05).
  const toolJson = result => result.structuredContent ?? JSON.parse(result.content[0].text);
  return { downloads, loseNextResponse: () => { loseResponse = true; }, tools: async () => (await rpc('tools/list', {})).tools,
    call: async (name, args) => toolJson(await rpc('tools/call', { name, arguments: args })),
    raw: (name, args) => rpc('tools/call', { name, arguments: args }),
    text: async (name, args) => (await rpc('tools/call', { name, arguments: args })).content[0].text,
    // The last answer's HTTP body, in bytes.
    bytes: () => bytes };
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

// Grok 점검 (2026-11-03): an agent with no workspace read only the workspace route in the creation guide and the readiness check.
test('the creation guide and the readiness check name the hosted route where its tools are listed, and whether it takes requests now', async () => {
  const g = await generation();
  try {
    const without = await connector(g, null), withHosted = await connector(g, {});
    const guide = async c => (await c.call('get_fighter_spec', { section: 'creation' })).data;
    assert.equal((await guide(without)).hosted, undefined);
    const listed = await guide(withHosted);
    assert.deepEqual(Object.keys(listed).slice(0, 2), ['hosted', 'steps']); assert.match(listed.hosted, /request_hosted_fighter/);
    const ready = (c, purpose = 'generation') => c.call('check_creation_readiness', { purpose });
    const plain = await ready(without);
    assert.equal(plain.hosted, undefined); assert.doesNotMatch(plain.nextAction, /hosted/);
    // The service's own state (off until the switch and a healthy worker), never the account's checks; generation stays unverified.
    const off = await ready(withHosted);
    assert.deepEqual([off.hosted.tool, off.hosted.capabilities.hosted, off.hosted.capabilities.reason], ['request_hosted_fighter', false, 'disabled']);
    assert.match(off.hosted.note, /only on the user's request[\s\S]*tokens[\s\S]*service only/);
    assert.match(off.nextAction, /see hosted/); assert.equal(off.generation.status, 'unverified');
    await g.healthy();
    assert.equal((await ready(withHosted)).hosted.capabilities.hosted, true);
    // Registering a package: the block is there, the next step is the package's.
    const registering = await ready(withHosted, 'registration');
    assert.equal(registering.hosted.tool, 'request_hosted_fighter'); assert.doesNotMatch(registering.nextAction, /hosted/);
  } finally { await g.sql.close(); }
  // A service state that cannot be read is unknown, and the account still answers.
  const failed = await generation({ failing: ['af_generation_capabilities'] });
  try {
    const unknown = await (await connector(failed, {})).call('check_creation_readiness', { purpose: 'generation' });
    assert.deepEqual([unknown.ok, unknown.registration.status, unknown.hosted.capabilities], [true, 'ready', null]);
  } finally { await failed.sql.close(); }
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
    // The list holds each job in short (MCP 최적화 2026-11-05); its next says to read one by its id.
    assert.equal(listed.capabilities.hosted, true); assert.equal(listed.jobs[0].id, made.job.id); assert.equal(listed.jobs[0].next, undefined);
    assert.match(listed.next, /jobId/);
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
    // A second change while the first is made is refused with what to do (Grok 점검 2026-11-03: the bot got a bare code).
    const early = await call('revise_hosted_motion', { jobId, clip: 'run', note: '팔을 더 크게' });
    assert.equal(early.code, 'generation-state'); assert.match(early.next, /one at a time[\s\S]*motion_ready/);
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

test('a request with a picture checks the account once for its three signed-in routes (MCP 점검 2026-11-03: once per route)', async () => {
  const g = await generation();
  try {
    await g.healthy();
    const { call } = await connector(g, {}), rpc = g.db.rpc, calls = [];
    g.db.rpc = (name, args) => { calls.push(name); return rpc(name, args); };
    const ask = { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko', rightsConfirmed: true, idempotencyKey: crypto.randomUUID(),
      picture: { download_url: 'https://files.oaiusercontent.com/file-1', file_id: 'file-1' } };
    // The check, the upload and the request itself (capabilities is public).
    assert.equal((await call('request_hosted_fighter', ask)).job.status, 'queued');
    assert.deepEqual(calls.filter(name => name === 'af_authorize'), ['af_authorize']);
    // The next call is another request: it checks again.
    assert.equal((await call('get_hosted_fighter', { idempotencyKey: ask.idempotencyKey })).job.status, 'queued');
    assert.equal(calls.filter(name => name === 'af_authorize').length, 2);
  } finally { await g.sql.close(); }
});

test('a wait on a submitted fighter reads the job and its submission in one query a tick, and ends when the check does', async () => {
  const g = await generation();
  try {
    await g.healthy();
    // The connector takes the database as it is now: record its reads from the start.
    const from = g.db.from, reads = [];
    g.db.from = table => { const query = from(table), select = query.select;
      query.select = columns => { reads.push([table, columns]); return select(columns); }; return query; };
    const { call } = await connector(g, { pollMs: 10 });
    const { job } = await call('request_hosted_fighter', { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko', idempotencyKey: crypto.randomUUID() });
    const submission = crypto.randomUUID();
    await g.sql.query(`insert into public.af_submissions(id,owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes,status)
      values($1,$2,gen_random_uuid(),'{}','{}'::jsonb,repeat('a',64),1,'validating')`, [submission, g.owner]);
    await g.sql.query("update public.af_generation_jobs set status = 'submitted', submission_id = $1 where id = $2", [submission, job.id]);
    reads.length = 0;
    await call('get_hosted_fighter', { jobId: job.id });
    const once = reads.splice(0);
    const tick = ([table, columns]) => table === 'af_generation_jobs' && columns === 'status,progress,submission:af_submissions!submission_id(status)';
    // The check ends once the wait has seen it running.
    const settle = async () => { while (!reads.some(tick)) await new Promise(done => setTimeout(done, 5));
      await g.sql.query("update public.af_submissions set status = 'rejected' where id = $1", [submission]); };
    const started = Date.now();
    const [waited] = await Promise.all([call('get_hosted_fighter', { jobId: job.id, waitSeconds: 5 }), settle()]);
    assert.ok(Date.now() - started < 3000, `${Date.now() - started} ms`);
    assert.equal(waited.job.status, 'submitted');
    // Every tick is one joined read; the submission is read on its own only by the job's final read, as without a wait.
    assert.ok(reads.filter(tick).length >= 2, `${reads.filter(tick).length} ticks`);
    const own = list => list.filter(([table]) => table === 'af_submissions').length;
    assert.equal(own(reads), own(once));
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
    // The wait ends inside the call's budget, its last seconds left to the job's read (MCP 점검 2026-11-03): 25 s asked, 4.5 s allowed.
    const bounded = await connector(g, { pollMs: 10 }, undefined, { budgetMs: 4500 }), waitStarted = Date.now();
    assert.equal((await bounded.call('get_hosted_fighter', { jobId, waitSeconds: 25 })).job.status, 'queued');
    assert.ok(Date.now() - waitStarted < 3000, `${Date.now() - waitStarted} ms`);

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
    const { call, text, downloads } = await connector(g, { pollMs: 10 });
    // An agent's own picture (Grok 점검 2026-11-03; what Grok passes is not observed yet). The wrong shape — an address alone, or a data:
    // address over the limit — fails the schema with the way in; a file of the shape from no taken host is named before any check (off
    // here, no rights confirmed) and fetches nothing.
    const ask = { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko', idempotencyKey: crypto.randomUUID() };
    for (const picture of ['https://images.grok.test/made.png', { download_url: 'https://images.grok.test/made.png' },
      { download_url: `data:image/png;base64,${'A'.repeat(9000)}`, file_id: 'made' }])
      assert.match(await text('request_hosted_fighter', { ...ask, picture }), /picture[\s\S]*only a file this host attaches[\s\S]*start_picture_upload/);
    const checks = [], rpc = g.db.rpc;
    g.db.rpc = (name, args) => { checks.push(name); return rpc(name, args); };
    const refused = await call('request_hosted_fighter', { ...ask, picture: { download_url: 'https://files.oaiusercontent.com/file-1', file_id: 'file-1' },
      secondPicture: { download_url: 'https://images.grok.test/made.png', file_id: 'made' } });
    assert.deepEqual([refused.code, refused.fields], ['unsupported-file-origin', ['secondPicture']]);
    assert.match(refused.next, /^secondPicture takes only a file this host attaches[\s\S]*start_picture_upload/);
    assert.deepEqual([checks.filter(name => name.startsWith('af_generation_')), downloads.length], [[], 0]);
    g.db.rpc = rpc;
    // Off, no ticket: the request's checks come first, as no picture is kept for a request that cannot be made (3차 리뷰 2026-11-01).
    assert.equal((await call('start_picture_upload', {})).code, 'generation-unavailable');
    assert.equal((await g.sql.query('select count(*)::int as n from public.af_generation_upload_tickets')).rows[0].n, 0);
    await g.healthy();
    // A chat with no terminal gets the link only: nothing in it uploads.
    const linkOnly = await call('start_picture_upload', {});
    assert.equal(linkOnly.page, `${PICTURE_PAGE}${linkOnly.ticket.id}`);
    assert.match(linkOnly.next, /made in this chat/);
    assert.deepEqual([linkOnly.command, linkOnly.ticket.secret], [undefined, undefined]);
    const started = await call('start_picture_upload', { terminal: true });
    assert.equal(started.ok, true, JSON.stringify(started));
    const ticket = started.ticket.id;
    assert.equal(started.ticket.secret, undefined);
    const [, secret] = /x-oddbout-upload-ticket: (afu_[a-f0-9]{64})/.exec(started.command) ?? [];
    assert.ok(secret, started.command);
    assert.ok(started.command.endsWith(` ${TICKET_UPLOAD_URL}`) && started.command.includes('"@<file>"'), started.command);
    // A terminal runs the command; the user adds the other on the site.
    assert.equal((await g.call('POST', 'generations/ticket-uploads', png(512, 512), null, { 'x-oddbout-upload-ticket': secret })).status, 200);
    assert.equal((await g.call('POST', `generations/uploads?ticket=${ticket}`, webp(400, 600))).status, 200);
    // A conversation that lost its ticket finds it again, without the addresses; an empty one says to give the link again.
    const listed = await call('get_picture_upload', {});
    assert.deepEqual(listed.tickets.map(t => t.id), [ticket, linkOnly.ticket.id]);
    assert.ok(listed.next.includes('Reuse an open one'), listed.next);
    assert.ok((await call('get_picture_upload', { ticketId: linkOnly.ticket.id })).next.startsWith('Nothing in yet'));
    const read = await call('get_picture_upload', { ticketId: ticket });
    assert.deepEqual([read.ticket.open, read.ticket.closed, read.ticket.uploads.length], [false, 'full', 2]);
    assert.ok(read.next.startsWith('Show him the pictures'), read.next);
    assert.ok(read.ticket.uploads.every(u => u.usable && typeof u.url === 'string'), JSON.stringify(read.ticket.uploads));
    const ids = read.ticket.uploads.map(u => u.id);
    const attached = { download_url: 'https://files.oaiusercontent.com/file-1', file_id: 'file-1' };
    // Two in all with attached files, refused before any attached one is downloaded; the rights confirmed as for any picture.
    assert.equal((await call('request_hosted_fighter', { ...ask, picture: attached, pictureUploads: ids, rightsConfirmed: true,
      idempotencyKey: crypto.randomUUID() })).code, 'invalid-refs');
    assert.equal((await call('request_hosted_fighter', { ...ask, pictureUploads: ids, idempotencyKey: crypto.randomUUID() })).code, 'rights-required');
    // An attached picture with another account's id: refused before the attachment moves. One id named twice (no room for an attachment
    // beside it) is refused by the request.
    const others = (await g.call('POST', 'generations/uploads', png(512, 512), 'other-token-0123456789')).body.upload.id;
    const uploadsBefore = (await g.sql.query('select count(*)::int as n from public.af_generation_uploads')).rows[0].n;
    for (const pictureUploads of [[others], [ids[0], ids[0]]]) {
      const extra = pictureUploads.length > 1 ? {} : { picture: attached };
      assert.equal((await call('request_hosted_fighter', { ...ask, ...extra, pictureUploads, rightsConfirmed: true, idempotencyKey: crypto.randomUUID() })).code,
        'invalid-refs', JSON.stringify(pictureUploads));
    }
    assert.equal(downloads.length, 0);
    assert.equal((await g.sql.query('select count(*)::int as n from public.af_generation_uploads')).rows[0].n, uploadsBefore);
    const made = await call('request_hosted_fighter', { ...ask, pictureUploads: ids, rightsConfirmed: true, idempotencyKey: crypto.randomUUID() });
    assert.equal(made.job.status, 'queued', JSON.stringify(made));
    assert.equal(downloads.length, 0);
    assert.equal((await g.work('POST', 'claim', {})).body.job.refs.length, 2);
    assert.deepEqual((await call('get_picture_upload', { ticketId: ticket })).ticket.uploads.map(u => [u.used, u.usable]), [[true, false], [true, false]]);
  } finally { await g.sql.close(); }
});

test('a picture address an agent reports is noted by its kind (and an http host) only, never fetched', async t => {
  assert.deepEqual(pictureLinkShape('https://images.example.test/u/1234/gen/abc.JPG?sig=secret#x'), { kind: 'url', protocol: 'https:',
    hostname: 'images.example.test', port: '', hasUserInfo: false, hasQuery: true, hasFragment: true, pathSegments: 4, extension: 'jpg', length: 59 });
  assert.deepEqual(pictureLinkShape('data:image/png;base64,iVBORw0KGgo=', 20480), { kind: 'data-url', mediaType: 'image/png', length: 20480 });
  // Only a picture's media type is named: any word/word parses as one (3차 리뷰 2026-11-01).
  assert.equal(pictureLinkShape('data:kim.minsu-010-1234-5678+password-hunter2/x;base64,AAAA').mediaType, null);
  assert.equal(pictureLinkShape('data:text/plain,hello').mediaType, 'other');
  // Any script's letters and digits are masked; another scheme names only itself (a file id is no host); a blob names its origin.
  assert.deepEqual(pictureLinkShape('홍길동 010-1234-5678'), { kind: 'not-a-url', length: 17, shape: 'aaa 999-9999-9999' });
  assert.deepEqual(pictureLinkShape('file-service://file-AbC123xyz'), { kind: 'other-scheme', scheme: 'file-service:', length: 29 });
  assert.deepEqual(pictureLinkShape('attachment://홍길동_여권.png'), { kind: 'other-scheme', scheme: 'attachment:', length: 23 });
  // Any word before a colon parses as a scheme: only a file scheme is named (2차 리뷰 2026-11-01).
  for (const text of ['password:hunter2', 'JohnSmith1984:my cat', 'sk-proj-abc123:xyz'])
    assert.deepEqual(pictureLinkShape(text), { kind: 'other-scheme', scheme: 'other', length: text.length });
  assert.deepEqual(pictureLinkShape('blob:https://grok.example.test/9f8e-11'), { kind: 'blob-url', origin: 'https://grok.example.test', length: 38 });
  const g = await generation();
  try {
    const logged = t.mock.method(console, 'log', () => {});
    const { call, raw, downloads } = await connector(g, {});
    const noted = await call('report_picture_link', { url: 'https://images.example.test/u/1234/gen/abc.png?sig=secret', madeBy: 'grok' });
    assert.deepEqual([noted.ok, noted.fetched, noted.kept, noted.observed.hostname], [true, false, false, 'images.example.test']);
    assert.equal(downloads.length, 0);
    const line = logged.mock.calls.map(c => String(c.arguments[0])).find(text => text.includes('picture-link-probe'));
    assert.ok(line && line.includes('"madeBy":"grok"') && !line.includes('secret') && !line.includes('1234'), line);
    // The maker is one of a few words, never free text.
    const probes = () => logged.mock.calls.filter(c => String(c.arguments[0]).includes('picture-link-probe')).length, seen = probes();
    assert.equal((await raw('report_picture_link', { url: 'https://images.example.test/a.png', madeBy: 'Kim Minsu' })).isError, true);
    assert.equal(probes(), seen);
  } finally { await g.sql.close(); }
});

// siteUrl (2026-11-03): the user's page for what the agent started — the request's, the fighter's all-motions page once registered.
test('hosted results carry siteUrl: the request\'s page, his fighter\'s motions page once registered; the agent that asked is shown', async () => {
  const g = await generation(), clientId = crypto.randomUUID();
  try {
    await g.healthy();
    await g.sql.query('insert into auth.oauth_clients(id,client_name,deleted_at) values($1,$2,null)', [clientId, 'Grok']);
    const { call } = await connector(g, { pollMs: 10 }, undefined, { clientId });
    const made = await call('request_hosted_fighter', { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko', idempotencyKey: crypto.randomUUID() });
    const jobId = made.job.id;
    assert.equal(made.siteUrl, `${CREATOR_PAGE}#job=${jobId}`); assert.equal(made.siteUrl, `https://oddbout.com/creator.html#job=${jobId}`);
    assert.match(made.next, /give him siteUrl to watch progress, pick a look, review the motions and enter the fighter/);
    assert.equal(made.job.agent, 'Grok');
    const read = await call('get_hosted_fighter', { jobId });
    assert.equal(read.siteUrl, made.siteUrl); assert.equal(read.job.agent, 'Grok');
    // Each of the recent jobs of a list has its own.
    const listed = await call('get_hosted_fighter', {});
    assert.deepEqual(listed.jobs.map(job => job.siteUrl), [made.siteUrl]);
    assert.equal(listed.siteUrl, undefined);
    // A registered fighter: the all-motions page (registering does not enter him), whose text names it instead of repeating the sentence.
    const submission = crypto.randomUUID(), fighter = crypto.randomUUID();
    await g.sql.query(`insert into public.af_submissions(id,owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes,status,fighter_id)
      values($1,$2,gen_random_uuid(),'{}','{}'::jsonb,repeat('a',64),1,'registered',$3)`, [submission, g.owner, fighter]);
    await g.sql.query("update public.af_generation_jobs set status = 'submitted', submission_id = $1 where id = $2", [submission, jobId]);
    const registered = await call('get_hosted_fighter', { jobId });
    assert.equal(registered.siteUrl, `${CREATOR_PAGE}#fighter=${fighter}&view=motions`);
    assert.match(registered.next, /Registered: fighter .* \(give him siteUrl\)/); assert.ok(!registered.next.includes('pick a look'));
    assert.equal((await call('get_hosted_fighter', {})).jobs[0].siteUrl, registered.siteUrl);
    // A registered submission with no fighter id points at the request; a job that is over says nothing of the site.
    await g.sql.query("update public.af_submissions set fighter_id = null where id = $1", [submission]);
    assert.equal((await call('get_hosted_fighter', { jobId })).siteUrl, `${CREATOR_PAGE}#job=${jobId}`);
    await g.sql.query("update public.af_generation_jobs set status = 'failed', submission_id = null where id = $1", [jobId]);
    const failed = await call('get_hosted_fighter', { jobId });
    assert.ok(!failed.next.includes('siteUrl')); assert.equal(failed.siteUrl, `${CREATOR_PAGE}#job=${jobId}`);
  } finally { await g.sql.close(); }
});

test('a host that reads the structured result gets a short text that keeps siteUrl whole', async () => {
  const g = await generation();
  try {
    await g.healthy();
    const { call, text } = await connector(g, { pollMs: 10 }, undefined, { meta: { 'openai/locale': 'en' } });
    const made = await call('request_hosted_fighter', { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko', idempotencyKey: crypto.randomUUID() });
    assert.equal(made.siteUrl, `${CREATOR_PAGE}#job=${made.job.id}`);
    // Enough to pass the compact limit: the text names fields, and the link is not cut.
    await g.sql.query("update public.af_generation_jobs set description = repeat('가', 590) where id = $1", [made.job.id]);
    const short = await text('get_hosted_fighter', { jobId: made.job.id });
    assert.match(short, /^Full result in structuredContent/);
    assert.ok(short.includes(`siteUrl="${made.siteUrl}"`), short);
  } finally { await g.sql.close(); }
});

test('siteUrl names a fighter before a request before a submission, and nothing with nothing to name', () => {
  const id = crypto.randomUUID(), other = crypto.randomUUID();
  assert.equal(siteUrl({ fighterId: id, jobId: other, submissionId: other }), `${CREATOR_PAGE}#fighter=${id}&view=motions`);
  assert.equal(siteUrl({ fighterId: null, jobId: id, submissionId: other }), `${CREATOR_PAGE}#job=${id}`);
  assert.equal(siteUrl({ submissionId: id }), `${CREATOR_PAGE}#submission=${id}`);
  assert.equal(siteUrl({}), null);
  assert.ok(PICTURE_PAGE.startsWith(`${CREATOR_PAGE}#view=upload&ticket=`));
});

// Grok 점검 (2026-11-03): Cursor's Grok Bot chat shows a job's pictures only as files the bot downloads and attaches; next says so wherever
// there are pictures to show, and asks for the a/b choice while choice is empty.
test('next says to attach the downloaded pictures wherever there are pictures to show', () => {
  const job = { id: 'x', candidates: [], host: { choice: 'oddbout' }, revisionsLeft: { appearance: 2, motions: 3 }, preview: [] };
  for (const status of ['appearance_ready', 'motions', 'motion_ready', 'needs_review'])
    assert.match(hostedNext({ ...job, status }), /download each file \(the url lasts ten minutes\) and attach it/, status);
  assert.match(hostedNext({ ...job, status: 'appearance_ready' }), /Show the user both looks[\s\S]*ask which one[\s\S]*choose_hosted_look/);
  assert.doesNotMatch(hostedNext({ ...job, status: 'queued' }), /attach/);
});

// Grok 점검 (2026-11-03): the user watching asked for 25-second reads; a wait returns as soon as a picture, the progress or the state
// changes, and a lease renewal (the worker's progress call with nothing in it) does not end it.
test('a wait on a working job returns when a picture or the progress changes, not on a lease renewal', async () => {
  const g = await generation();
  try {
    await g.healthy();
    const { call } = await connector(g, { pollMs: 10 });
    const { job } = await call('request_hosted_fighter', { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko', idempotencyKey: crypto.randomUUID() });
    let held = (await g.work('POST', 'claim', {})).body.job;
    const finish = (h, result) => g.work('POST', 'finish', { jobId: h.id, leaseToken: h.leaseToken, outcome: 'ok', result });
    await finish(held, { brief: { profile: { name: '빨간 주먹' } } });
    held = (await g.work('POST', 'claim', {})).body.job;
    for (const name of ['look-a-0', 'look-b-0'])
      await g.work('PUT', `jobs/${held.id}/artifacts/${name}`, webp(400, 600), { 'x-generation-lease': held.leaseToken, 'content-type': 'image/webp' });
    await finish(held, { candidates: ['look-a-0', 'look-b-0'] });
    await call('choose_hosted_look', { jobId: job.id, choose: 'a' });
    held = (await g.work('POST', 'claim', {})).body.job;
    const progress = body => g.work('POST', 'progress', { jobId: held.id, leaseToken: held.leaseToken, ...body });
    const timed = async (send, waitSeconds = 5) => {
      const started = Date.now();
      const [read] = await Promise.all([call('get_hosted_fighter', { jobId: job.id, waitSeconds }),
        new Promise(done => setTimeout(done, 150)).then(send)]);
      return { read, ms: Date.now() - started };
    };
    // A draft is a picture event: the wait ends with it, and the read shows it.
    await g.work('PUT', `jobs/${held.id}/artifacts/draft-walk-0`, webp(400, 600), { 'x-generation-lease': held.leaseToken, 'content-type': 'image/webp' });
    const drafted = await timed(() => progress({ event: { kind: 'drafts', seq: 1, clips: [{ clip: 'walk', name: 'draft-walk-0' }] } }));
    assert.ok(drafted.ms < 3000, `${drafted.ms} ms`);
    // In short while it only asks to be watched (MCP 최적화 2026-11-05): what changed, the new picture and the pictures there are by name.
    assert.deepEqual([drafted.read.watch, drafted.read.changed, drafted.read.pictures.drafts, drafted.read.picture.clip], [true, ['pictures'], ['walk'], 'walk']);
    assert.match(drafted.read.picture.url, /draft-walk-0\.webp/);
    assert.match(drafted.read.next, /waitSeconds 25/);
    // So is a step of the progress.
    const stepped = await timed(() => progress({ progress: 25 }));
    assert.ok(stepped.ms < 3000, `${stepped.ms} ms`); assert.equal(stepped.read.job.progress, 25); assert.deepEqual(stepped.read.changed, ['progress']);
    // A lease renewal changes nothing the user sees: the wait runs its time.
    const renewed = await timed(() => progress({}), 1);
    assert.ok(renewed.ms >= 900, `${renewed.ms} ms`); assert.equal(renewed.read.job.progress, 25); assert.deepEqual(renewed.read.changed, []);
  } finally { await g.sql.close(); }
});

// 감시 응답 줄이기 (MCP 최적화 2026-11-05): a chat that watched read the whole job — every picture's signed URL and the long next — at each
// 25-second wait. A job in its motions, with Storage-length signed URLs, two looks, the side view, his faces and nine drafts.
async function motionsJob(g, options = {}) {
  await g.healthy();
  const storage = g.db.storage.from;
  g.db.storage.from = bucket => ({ ...storage(bucket), createSignedUrls: async paths => ({ data: paths.map(path => ({ path,
    signedUrl: `https://storage.test/storage/v1/object/sign/${bucket}/${path}?token=${'t'.repeat(300)}` })) }) });
  const c = await connector(g, { pollMs: 10 }, undefined, options);
  const jobId = (await c.call('request_hosted_fighter', { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko', idempotencyKey: crypto.randomUUID() })).job.id;
  let held = (await g.work('POST', 'claim', {})).body.job;
  const finish = result => g.work('POST', 'finish', { jobId, leaseToken: held.leaseToken, outcome: 'ok', result });
  const artifact = name => g.work('PUT', `jobs/${jobId}/artifacts/${name}`, webp(400, 600), { 'x-generation-lease': held.leaseToken, 'content-type': 'image/webp' });
  const progress = body => g.work('POST', 'progress', { jobId, leaseToken: held.leaseToken, ...body });
  await finish({ brief: { profile: { name: '빨간 주먹' } } });
  held = (await g.work('POST', 'claim', {})).body.job;
  for (const name of ['look-a-0', 'look-b-0']) await artifact(name);
  await finish({ candidates: ['look-a-0', 'look-b-0'] });
  await c.call('choose_hosted_look', { jobId, choose: 'a' });
  held = (await g.work('POST', 'claim', {})).body.job;
  for (const kind of ['side', 'expressions']) { await artifact(`${kind}-0-a`); await progress({ event: { kind, outcome: 'chosen', artifact: `${kind}-0-a` } }); }
  const clips = ['walk', 'run', 'fightIdle', 'combo', 'slam', 'dash', 'block', 'hit', 'groggy', 'fall'];
  let seq = 0;
  const drafts = async count => {
    const list = clips.slice(0, count).map(clip => ({ clip, name: `draft-${clip.toLowerCase()}-0` }));
    for (const { name } of list) await artifact(name);
    return progress({ progress: 40 + count, event: { kind: 'drafts', seq: ++seq, clips: list } });
  };
  await drafts(9);
  // A watch that the worker's `send` ends (or its time, with none).
  const watch = (send, waitSeconds = 5) => Promise.all([c.call('get_hosted_fighter', { jobId, waitSeconds }),
    send ? new Promise(done => setTimeout(done, 150)).then(send) : null]).then(([read]) => read);
  return { ...c, jobId, drafts, watch, finish };
}

test('a watch on a job that only asks to be watched answers in short; without a wait, at a decision and at the end it stays whole', async () => {
  const g = await generation();
  try {
    const { call, bytes, jobId, drafts, watch, finish } = await motionsJob(g);
    // Without waitSeconds: the whole job, as before.
    const full = await call('get_hosted_fighter', { jobId }), fullBytes = bytes();
    assert.deepEqual([full.job.status, full.job.drafts.length, full.job.candidates.length], ['motions', 9, 2]);
    assert.ok(full.job.side.url && full.job.expressions.url); assert.match(full.next, /eleven motions[\s\S]*waitSeconds 25/);
    // A wait the tenth draft ends: the job's state, what changed, that draft's URL only, and the pictures by name.
    const watched = await watch(() => drafts(10)), watchedBytes = bytes();
    assert.deepEqual(Object.keys(watched).sort(), ['changed', 'job', 'next', 'ok', 'picture', 'pictures', 'siteUrl', 'watch']);
    assert.deepEqual(watched.job, { id: jobId, status: 'motions', progress: 50 });
    assert.deepEqual(watched.changed, ['progress', 'pictures']);
    assert.deepEqual([watched.picture.kind, watched.picture.clip], ['draft', 'fall']); assert.match(watched.picture.url, /draft-fall-0\.webp\?token=/);
    assert.deepEqual(watched.pictures, { drafts: ['walk', 'run', 'fightIdle', 'combo', 'slam', 'dash', 'block', 'hit', 'groggy', 'fall'], side: true, expressions: true });
    assert.equal(watched.siteUrl, full.siteUrl);
    assert.ok(!watched.next.includes('\n')); assert.match(watched.next, /show him picture[\s\S]*waitSeconds 25[\s\S]*Without waitSeconds it returns the whole job/);
    // One signed URL instead of every picture's: a small answer, whatever the job holds.
    assert.equal((JSON.stringify(watched).match(/token=/g) ?? []).length, 1);
    assert.ok(watchedBytes < 2048 && watchedBytes * 4 < fullBytes, `watch ${watchedBytes} bytes, full ${fullBytes}`);
    // A wait that saw nothing change says so, with no picture.
    const quiet = await watch(null, 1);
    assert.deepEqual([quiet.watch, quiet.changed, quiet.picture], [true, [], undefined]);
    // A decision point (the motions ready for his answer) is the whole job and its next, waited for or not.
    await finish({ preview: ['idle', 'walk', 'run'].map(clip => ({ clip, name: `motion-${clip}-0` })) });
    const ready = await watch(null, 1);
    assert.equal(ready.watch, undefined); assert.equal(ready.job.status, 'motion_ready'); assert.equal(ready.job.preview.length, 3);
    assert.match(ready.next, /register_hosted_fighter/);
    // So is the end.
    await g.sql.query("update public.af_generation_jobs set status = 'failed', error_code = 'stage-attempts' where id = $1", [jobId]);
    const failed = await watch(null, 1);
    assert.equal(failed.watch, undefined); assert.match(failed.next, /failed \(stage-attempts\)/);
  } finally { await g.sql.close(); }
});

test('ChatGPT\'s watch is the same short answer, in its structured result beside the text', async () => {
  const g = await generation();
  try {
    const { raw, jobId, drafts } = await motionsJob(g, { meta: { 'openai/locale': 'ko' } });
    const [read] = await Promise.all([raw('get_hosted_fighter', { jobId, waitSeconds: 5 }), new Promise(done => setTimeout(done, 150)).then(() => drafts(10))]);
    assert.equal(read.structuredContent.watch, true); assert.equal(read.structuredContent.picture.clip, 'fall');
    assert.ok(read.content[0].text === JSON.stringify(read.structuredContent) || read.content[0].text.startsWith('Full result in structuredContent'));
  } finally { await g.sql.close(); }
});

test('the recent list holds each request in short and says to read one by its id; the balance and the service stay', async () => {
  const g = await generation();
  try {
    const { call, jobId } = await motionsJob(g);
    for (let i = 0; i < 4; i++) await g.sql.query(`insert into public.af_generation_jobs(owner_id, idempotency_key, description, language, status, created_at)
      values ($1, $2, 'An older cat boxer', 'en', 'cancelled', now() - interval '1 day')`, [g.owner, crypto.randomUUID()]);
    const listed = await call('get_hosted_fighter', {}), whole = await call('get_hosted_fighter', { jobId });
    assert.equal(listed.jobs.length, 5); assert.equal(listed.jobs[0].id, jobId);
    for (const job of listed.jobs) assert.deepEqual(Object.keys(job), ['id', 'status', 'progress', 'error', 'description', 'name', 'createdAt', 'updatedAt',
      'tokens', 'submission', 'agent', 'siteUrl']);
    assert.deepEqual(listed.jobs[0], { id: jobId, status: 'motions', progress: whole.job.progress, error: null, description: whole.job.description,
      name: '빨간 주먹', createdAt: whole.job.createdAt, updatedAt: whole.job.updatedAt, tokens: whole.job.tokens, submission: null, agent: null,
      siteUrl: whole.siteUrl });
    assert.ok(!JSON.stringify(listed).includes('token='), 'no signed URL in the list');
    assert.deepEqual([listed.used, listed.tokens.balance, listed.capabilities.hosted], [false, 500000, true]);
    assert.match(listed.next, /read one by its jobId/);
  } finally { await g.sql.close(); }
});
