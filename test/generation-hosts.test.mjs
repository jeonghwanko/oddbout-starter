import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HOST_PLATFORMS, HOST_SETUP_STAGES } from '../api/generations.mjs';
import { PAIRING_PLATFORMS } from '../api/host-pairing.mjs';
import { generation } from './helpers/generation-database.mjs';

// 커뮤니티 호스트 (2026-10-28): a creator applies to host, the operator approves him, his own worker key takes the requests that name him
// (or any host) after ODDBOUT's own worker wrote the brief; the job stays with him to the end.
test('a host applies, is approved, gets a key and takes the requests meant for him after the official brief', async () => {
  const { sql, owner, other, call, work, healthy } = await generation();
  const theirs = 'other-token-0123456789';
  try {
    await healthy();
    // His requests to another person's host have their looks painted and are cancelled: each keeps a free fighter used (2026-10-30).
    await sql.query('update public.af_creators set hosted_credits = 3 where owner_id = $1', [owner]);
    assert.equal((await call('GET', 'generations/capabilities', undefined, null)).body.capabilities.hosts, 0);
    // Applying: terms first; not approved, so no key yet.
    assert.equal((await call('POST', 'generations/host', { name: '고양이 공방', billing: 'api-key' }, theirs)).body.code, 'host-terms-required');
    const applied = (await call('POST', 'generations/host', { name: '고양이 공방', billing: 'api-key', termsAccepted: true }, theirs)).body.host;
    assert.equal(applied.approved, false);
    assert.deepEqual((await call('GET', 'generations/hosts', undefined, null)).body.hosts.map(h => h.name), ['ODDBOUT']);
    // Not approved yet: a key all the same, for his own requests on his own PC (내 선수는 내 PC로, 2026-10-28).
    const issued = (await call('POST', 'generations/host/keys', {}, theirs)).body;
    assert.match(issued.key, /^afw_[a-f0-9]{64}$/); assert.equal(issued.host, applied.id);
    const host = (method, path, body, headers) => call(method, `generation-worker/${path}`, body, issued.key, headers);
    assert.equal((await host('POST', 'heartbeat', { health: { ok: true, codex: true, grok: true } })).body.capabilities.hosts, 0);
    assert.deepEqual((await call('GET', 'generations/hosts', undefined, null)).body.hosts.map(h => h.name), ['ODDBOUT']);
    assert.equal((await call('GET', 'generations/host', undefined, theirs)).body.host.online, true);
    const ask = body => call('POST', 'generations', { description: '빨간 글러브를 낀 고양이 복서', language: 'ko', ...body }, undefined, { 'idempotency-key': crypto.randomUUID() });
    assert.equal((await ask({ host: applied.id, hostConsent: true })).body.code, 'invalid-host');
    // His own request names himself, with no consent to give: the brief is ODDBOUT's, the rest his PC's.
    assert.equal((await ask({ host: 'mine' })).body.code, 'host-not-found'); // the requester has no host of his own
    const self = (await call('POST', 'generations', { description: '파란 망토를 두른 고양이 검객', language: 'ko', host: 'mine' }, theirs,
      { 'idempotency-key': crypto.randomUUID() })).body.job;
    assert.deepEqual([self.host.choice, self.host.requested.name], ['host', '고양이 공방']);
    const finishOk = (via, c, result) => via('POST', 'finish', { jobId: c.id, leaseToken: c.leaseToken, outcome: 'ok', result });
    let mineHeld = (await work('POST', 'claim', {})).body.job;
    assert.equal(mineHeld.id, self.id); await finishOk(work, mineHeld, { brief: { profile: { name: '파란 칼날' } } });
    assert.equal((await work('POST', 'claim', {})).body.stage, 'idle');
    mineHeld = (await host('POST', 'claim', {})).body.job;
    assert.deepEqual([mineHeld.id, mineHeld.status], [self.id, 'appearance']);
    await call('DELETE', `generations/${self.id}`, undefined, theirs);
    await sql.query('update public.af_generation_jobs set created_at = now() - interval \'2 days\' where id = $1', [self.id]);
    // Approved: other people's requests too.
    await sql.query('update public.af_generation_hosts set approved = true where id = $1', [applied.id]);
    assert.equal((await host('POST', 'heartbeat', { health: { ok: true, codex: true, grok: true } })).body.capabilities.hosts, 1);
    const listed = (await call('GET', 'generations/hosts', undefined, null)).body.hosts;
    assert.deepEqual(listed.map(h => [h.name, h.official, h.online]), [['ODDBOUT', true, true], ['고양이 공방', false, true]]);
    const mine = (await call('GET', 'generations/host', undefined, theirs)).body.host;
    assert.equal(mine.online, true); assert.equal(mine.keys.length, 1); assert.equal(mine.billing, 'api-key');

    // A request that names him: consent first. The brief is ODDBOUT's; the looks on are his, and the job stays his.
    assert.equal((await ask({ host: applied.id })).body.code, 'host-consent-required');
    assert.equal((await ask({ host: 'somebody' })).body.code, 'invalid-host');
    const named = (await ask({ host: applied.id, hostConsent: true })).body.job;
    assert.deepEqual([named.host.choice, named.host.requested.name, named.host.assigned], ['host', '고양이 공방', null]);
    const finish = (via, c, result) => via('POST', 'finish', { jobId: c.id, leaseToken: c.leaseToken, outcome: 'ok', result });
    assert.equal((await host('POST', 'claim', {})).body.stage, 'idle');
    let held = (await work('POST', 'claim', {})).body.job;
    assert.equal(held.status, 'queued');
    await finish(work, held, { brief: { profile: { name: '빨간 주먹' } } });
    assert.equal((await work('POST', 'claim', {})).body.stage, 'idle');
    held = (await host('POST', 'claim', {})).body.job;
    assert.equal(held.status, 'appearance');
    assert.equal((await call('GET', `generations/${named.id}`)).body.job.host.assigned.name, '고양이 공방');
    await finish(host, held, { candidates: ['look-a-0', 'look-b-0'] });
    await call('POST', `generations/${named.id}/appearance`, { choose: 'a' });
    assert.equal((await work('POST', 'claim', {})).body.stage, 'idle');
    assert.equal((await host('POST', 'claim', {})).body.job.status, 'motions');
    await call('DELETE', `generations/${named.id}`);

    // Any host: the official worker leaves it to an online host; with none on, it takes it itself.
    const open = (await ask({ host: 'any', hostConsent: true })).body.job;
    held = (await work('POST', 'claim', {})).body.job; await finish(work, held, { brief: { profile: {} } });
    assert.equal((await work('POST', 'claim', {})).body.stage, 'idle');
    assert.equal((await host('POST', 'claim', {})).body.job.id, open.id);
    await call('DELETE', `generations/${open.id}`);
    const fallback = (await ask({ host: 'any', hostConsent: true })).body.job;
    held = (await work('POST', 'claim', {})).body.job; await finish(work, held, { brief: { profile: {} } });
    await sql.query("update public.af_generation_hosts set worker_seen_at = now() - interval '10 minutes' where id = $1", [applied.id]);
    held = (await work('POST', 'claim', {})).body.job;
    assert.equal(held.id, fallback.id);
    assert.equal((await call('GET', `generations/${fallback.id}`)).body.job.host.assigned.official, true);
    await call('DELETE', `generations/${fallback.id}`);

    // His switches: a limit of none refuses requests that name him; a paused host is not listed and cannot be named.
    await sql.query("update public.af_generation_jobs set created_at = now() - interval '2 days' where owner_id = $1", [owner]);
    await host('POST', 'heartbeat', { health: { ok: true } });
    assert.equal((await call('PATCH', 'generations/host', { dailyLimit: 0 }, theirs)).body.host.dailyLimit, 0);
    assert.equal((await ask({ host: applied.id, hostConsent: true })).body.code, 'host-capacity');
    await call('PATCH', 'generations/host', { dailyLimit: 5, enabled: false }, theirs);
    assert.deepEqual((await call('GET', 'generations/hosts', undefined, null)).body.hosts.map(h => h.name), ['ODDBOUT']);
    assert.equal((await ask({ host: applied.id, hostConsent: true })).body.code, 'host-offline');
    // Nobody else's host to change; his keys switched off at once.
    assert.equal((await call('PATCH', 'generations/host', { enabled: true })).body.code, 'not-found');
    assert.equal((await call('DELETE', 'generations/host/keys', undefined, theirs)).body.revoked, 1);
    assert.equal((await host('POST', 'heartbeat', { health: { ok: true } })).status, 403);
    assert.ok(other);
  } finally { await sql.close(); }
});

// 내 PC 붙이기 (2026-10-28): the site gives a signed-in host a join code; his PC trades it once, within thirty minutes, for a worker key.
test('a join code becomes a worker key once, on a PC with no account session; a third key retires the oldest', async () => {
  const { sql, call, healthy } = await generation();
  const theirs = 'other-token-0123456789';
  try {
    await healthy();
    assert.equal((await call('POST', 'generations/host/join-codes', {}, theirs)).body.code, 'host-not-found');
    const applied = (await call('POST', 'generations/host', { name: '고양이 공방', billing: 'subscription', termsAccepted: true }, theirs)).body.host;
    const made = (await call('POST', 'generations/host/join-codes', {}, theirs)).body;
    assert.match(made.code, /^ohj_[a-f0-9]{40}$/); assert.equal(made.host, applied.id);
    assert.ok(Date.parse(made.expiresAt) - Date.now() > 29 * 60_000);
    const join = code => call('POST', 'generations/host/join', { code }, null);
    assert.equal((await join('ohj_nothex')).body.code, 'invalid-join-code');
    assert.equal((await join(`ohj_${'0'.repeat(40)}`)).status, 410);
    const joined = (await join(made.code)).body;
    assert.match(joined.key, /^afw_[a-f0-9]{64}$/);
    assert.deepEqual([joined.host, joined.name, joined.approved], [applied.id, '고양이 공방', false]);
    assert.equal((await join(made.code)).body.code, 'join-code-invalid'); // once
    const worker = key => call('POST', 'generation-worker/heartbeat', { health: { ok: true } }, key);
    assert.equal((await worker(joined.key)).status, 200);
    // Two more PCs: the first key is retired, two stay live.
    const second = (await join((await call('POST', 'generations/host/join-codes', {}, theirs)).body.code)).body.key;
    const third = (await join((await call('POST', 'generations/host/join-codes', {}, theirs)).body.code)).body.key;
    assert.equal((await worker(joined.key)).status, 403);
    assert.deepEqual([(await worker(second)).status, (await worker(third)).status], [200, 200]);
    // A code past thirty minutes is refused.
    const late = (await call('POST', 'generations/host/join-codes', {}, theirs)).body.code;
    await sql.query("update public.af_generation_host_joins set expires_at = now() - interval '1 second' where used_at is null");
    assert.equal((await join(late)).body.code, 'join-code-invalid');
  } finally { await sql.close(); }
});

// 2026-11-07: a claim may carry the heartbeat (one request a turn instead of two). It is recorded before the claim reads the host's health.
test('a claim carrying the heartbeat records it first and says so; a bare claim records none', async () => {
  const { sql, call, healthy } = await generation();
  const theirs = 'other-token-0123456789';
  try {
    await healthy();
    await call('POST', 'generations/host', { name: '고양이 공방', billing: 'subscription', termsAccepted: true }, theirs);
    const key = (await call('POST', 'generations/host/keys', {}, theirs)).body.key;
    const claim = body => call('POST', 'generation-worker/claim', body, key);
    const seen = async () => (await sql.query('select worker_seen_at, worker_health from public.af_generation_hosts where not official')).rows[0];
    const bare = (await claim({})).body;
    assert.deepEqual([bare.ok, bare.stage, bare.beat], [true, 'idle', undefined]);
    assert.equal((await seen()).worker_seen_at, null);
    assert.equal((await call('GET', 'generations/host', undefined, theirs)).body.host.online, false);
    const carried = (await claim({ health: { ok: true, codex: false, grok: true }, usage: { usedPercent: 42.5, windowMinutes: 300 } })).body;
    assert.deepEqual([carried.ok, carried.stage, carried.beat], [true, 'idle', true]);
    // The subscription's reading rides along as on the heartbeat route; one that does not parse is left out, never the claim.
    assert.deepEqual((await sql.query('select usage from public.af_generation_hosts where not official')).rows[0].usage, { usedPercent: 42.5, windowMinutes: 300 });
    assert.equal((await claim({ health: { ok: true, codex: false, grok: true }, usage: { usedPercent: 'lots' } })).body.beat, true);
    const row = await seen();
    assert.ok(row.worker_seen_at);
    assert.deepEqual([row.worker_health.ok, row.worker_health.grok], [true, true]);
    assert.equal((await call('GET', 'generations/host', undefined, theirs)).body.host.online, true);
    // Checked as the heartbeat route checks it; nothing else rides along. The heartbeat route says claims take one.
    assert.equal((await claim({ health: 'ok' })).body.code, 'invalid-health');
    assert.equal((await claim({ health: { ok: true }, lease: 1 })).body.code, 'invalid-body');
    assert.equal((await call('POST', 'generation-worker/heartbeat', { health: { ok: true } }, key)).body.claimBeats, true);
  } finally { await sql.close(); }
});

// The carried health is recorded before the claim reads it: the official host's brief needs codex.
test('a claim carrying the health it reports is judged on that health, not the one recorded before', async () => {
  const { sql, call, work, healthy } = await generation();
  try {
    await healthy(); // recorded: codex ok
    const job = (await call('POST', 'generations', { description: '빨간 글러브를 낀 고양이 복서', language: 'ko' }, undefined,
      { 'idempotency-key': crypto.randomUUID() })).body.job;
    const down = (await work('POST', 'claim', { health: { ok: true, codex: false, grok: true } })).body;
    assert.deepEqual([down.stage, down.beat, down.job], ['idle', true, undefined]);
    const up = (await work('POST', 'claim', { health: { ok: true, codex: true, grok: true } })).body;
    assert.deepEqual([up.beat, up.job?.id, up.job?.status], [true, job.id, 'queued']);
  } finally { await sql.close(); }
});

// His own PC pays for his own fighters, so they need no tokens (보유 토큰, 2026-10-31); one request at a time still.
test('fighters made on his own PC need no tokens: at zero ODDBOUT refuses, his PC does not; one open request at a time', async () => {
  const { sql, call, healthy } = await generation();
  const theirs = 'other-token-0123456789';
  try {
    await healthy();
    await call('POST', 'generations/host', { name: '고양이 공방', billing: 'subscription', termsAccepted: true }, theirs);
    const key = (await call('POST', 'generations/host/keys', {}, theirs)).body.key;
    await call('POST', 'generation-worker/heartbeat', { health: { ok: true } }, key);
    const ask = body => call('POST', 'generations', { description: '빨간 글러브를 낀 고양이 복서', language: 'ko', ...body }, theirs, { 'idempotency-key': crypto.randomUUID() });
    const free = (await ask({})).body.job;
    await sql.query("update public.af_generation_jobs set status = 'submitted' where id = $1", [free.id]); // made
    await sql.query('update public.af_creators set token_grant = 0 where owner_id = (select owner_id from public.af_generation_jobs where id = $1)', [free.id]);
    assert.equal((await ask({})).body.code, 'generation-quota'); // no tokens left for ODDBOUT's making
    const mine = (await ask({ host: 'mine' })).body.job;
    assert.equal(mine.host.choice, 'host');
    assert.equal((await ask({ host: 'mine' })).body.code, 'generation-quota'); // one at a time
    await sql.query("update public.af_generation_jobs set status = 'submitted' where id = $1", [mine.id]);
    assert.equal((await call('GET', 'generations', undefined, theirs)).body.used, true); // no tokens left
    await sql.query('update public.af_creators set token_grant = 500000 where owner_id = (select owner_id from public.af_generation_jobs where id = $1)', [free.id]);
    const after = (await call('GET', 'generations', undefined, theirs)).body;
    assert.equal(after.used, false); assert.equal(after.tokens.spent, 0); // his own PC's fighter takes no tokens
  } finally { await sql.close(); }
});

// A job cancelled or expired while it waited for its requester never comes back to the worker; the worker asks, and closes its folder.
test('the worker learns which of its own jobs ended, and finds the folders it has not closed', async () => {
  const { sql, call, work, healthy } = await generation();
  const theirs = 'other-token-0123456789';
  try {
    await healthy();
    await call('POST', 'generations/host', { name: '고양이 공방', billing: 'subscription', termsAccepted: true }, theirs);
    const key = (await call('POST', 'generations/host/keys', {}, theirs)).body.key;
    const host = (path, body) => call('POST', `generation-worker/${path}`, body, key);
    await host('heartbeat', { health: { ok: true } });
    const mine = (await call('POST', 'generations', { description: '파란 망토를 두른 고양이 검객', language: 'ko', host: 'mine' }, theirs,
      { 'idempotency-key': crypto.randomUUID() })).body.job;
    let held = (await work('POST', 'claim', {})).body.job;
    await work('POST', 'finish', { jobId: held.id, leaseToken: held.leaseToken, outcome: 'ok', result: { brief: { profile: {} } } });
    held = (await host('claim', {})).body.job;
    await host('finish', { jobId: held.id, leaseToken: held.leaseToken, outcome: 'ok', result: { candidates: ['look-a-0', 'look-b-0'] } });
    assert.deepEqual((await host('ended', { jobs: [mine.id] })).body.ended, []); // waiting for him: not over
    // The official host wrote its brief; another host took it, so the brief's folder on the office PC is done with.
    assert.deepEqual((await work('POST', 'ended', { jobs: [mine.id] })).body.ended, [mine.id]);
    await call('DELETE', `generations/${mine.id}`, undefined, theirs);
    assert.deepEqual((await host('ended', { jobs: [mine.id] })).body.ended, [mine.id]);
    assert.equal((await host('ended', { jobs: Array(51).fill(mine.id) })).status, 422);
    // A job still with the official host (its brief not written) is not over for it; a community host never hears of another's job.
    const queued = (await call('POST', 'generations', { description: '빨간 글러브를 낀 고양이 복서', language: 'ko' }, undefined, { 'idempotency-key': crypto.randomUUID() })).body.job;
    assert.deepEqual((await work('POST', 'ended', { jobs: [queued.id] })).body.ended, []);
    assert.deepEqual((await host('ended', { jobs: [queued.id] })).body.ended, []);

    const { unclosedJobs } = await import('../host/generation-worker.mjs');
    const output = await mkdtemp(path.join(os.tmpdir(), 'gen-out-'));
    try {
      const open = `20261028-gen-${mine.id.replaceAll('-', '')}`, closed = `20261027-gen-${'b'.repeat(32)}`;
      for (const name of [open, closed, '20261026-red-cat']) await mkdir(path.join(output, name));
      await writeFile(path.join(output, closed, '.closed'), '');
      assert.deepEqual([...(await unclosedJobs(output)).entries()], [[open, mine.id]]);
    } finally { await rm(output, { recursive: true, force: true }); }
  } finally { await sql.close(); }
});

// 사라진 호스트 (2026-11-05): only the host that took a job claims it again, so a job whose host never came back stayed in a working state for
// good, holding its creator's request and free fighter (a registration under way cannot even be cancelled). A day after its last report,
// every claim ends it: the stage it took and never finished goes to an operator (whether a paid run went out is only on that PC), a stage it
// never took fails. Neither moves to another host, and the official host's jobs wait for it.
test('a job whose community host is gone a day goes to an operator if its stage ran there, fails if not, and never moves', async () => {
  const { sql, owner, call, work, healthy } = await generation();
  const theirs = 'other-token-0123456789';
  try {
    await healthy();
    await sql.query('update public.af_creators set hosted_credits = 5 where owner_id = $1', [owner]);
    const applied = (await call('POST', 'generations/host', { name: '고양이 공방', billing: 'subscription', termsAccepted: true }, theirs)).body.host;
    await sql.query('update public.af_generation_hosts set approved = true where id = $1', [applied.id]);
    const key = (await call('POST', 'generations/host/keys', {}, theirs)).body.key;
    const host = (path, body) => call('POST', `generation-worker/${path}`, body, key);
    const official = (path, body) => work('POST', path, body);
    const beat = () => host('heartbeat', { health: { ok: true, codex: true, grok: true } });
    const finish = (send, c, outcome, result) => send('finish', { jobId: c.id, leaseToken: c.leaseToken, outcome, result });
    const ask = body => call('POST', 'generations', { description: '빨간 글러브를 낀 고양이 복서', language: 'ko', ...body }, undefined,
      { 'idempotency-key': crypto.randomUUID() });
    const read = async id => (await call('GET', `generations/${id}`)).body.job;
    const gone = since => sql.query(`update public.af_generation_hosts set worker_seen_at = now() - interval '${since}' where id = $1`, [applied.id]);
    const lapse = id => sql.query("update public.af_generation_jobs set lease_expires_at = now() - interval '1 minute' where id = $1", [id]);
    await beat();

    // The host takes the looks of a request that named it, and its PC goes away under the lease.
    const named = (await ask({ host: applied.id, hostConsent: true })).body.job;
    let held = (await official('claim', {})).body.job; await finish(official, held, 'ok', { brief: { profile: {} } });
    held = (await host('claim', {})).body.job;
    assert.deepEqual([held.id, held.status], [named.id, 'appearance']);
    await lapse(named.id);
    // Off for a night: its job waits for it.
    await gone('2 hours');
    assert.equal((await official('claim', {})).body.stage, 'idle');
    assert.deepEqual([(await read(named.id)).status, (await read(named.id)).host.assigned.name], ['appearance', '고양이 공방']);
    // Gone a day: the stage it took may have sent a paid run, so an operator looks before anything runs again; the job stays its host's.
    await gone('25 hours');
    assert.equal((await official('claim', {})).body.stage, 'idle');
    let job = await read(named.id);
    assert.deepEqual([job.status, job.error, job.host.assigned.name], ['needs_review', 'appearance-host-lost', '고양이 공방']);
    const [lost] = (await sql.query("select data from public.af_generation_events where job_id = $1 and kind = 'host-lost'", [named.id])).rows;
    assert.deepEqual([lost.data.status, lost.data.to, lost.data.host], ['appearance', 'needs_review', applied.id]);
    // Back again, the host has nothing to claim; the creator cancels and has his free fighter back.
    await beat();
    assert.equal((await host('claim', {})).body.stage, 'idle');
    assert.equal((await call('DELETE', `generations/${named.id}`)).body.job.status, 'cancelled');
    assert.equal((await sql.query('select public.af_generation_spends(j) as spends from public.af_generation_jobs j where id = $1', [named.id])).rows[0].spends, false);

    // An open request: the host paints the looks and goes away before the motions the creator then chose. It never took them, so the
    // job fails; it does not go to another host (the looks are on that PC). Its free fighter comes back, and the host, back, closes it.
    const open = (await ask({ host: 'any', hostConsent: true })).body.job;
    held = (await official('claim', {})).body.job; await finish(official, held, 'ok', { brief: { profile: {} } });
    held = (await host('claim', {})).body.job;
    assert.equal(held.id, open.id); await finish(host, held, 'ok', { candidates: ['look-a-0', 'look-b-0'] });
    await gone('25 hours');
    assert.equal((await call('POST', `generations/${open.id}/appearance`, { choose: 'a' })).body.job.status, 'motions');
    assert.equal((await official('claim', {})).body.stage, 'idle');
    job = await read(open.id);
    assert.deepEqual([job.status, job.error, job.host.assigned.name], ['failed', 'host-lost', '고양이 공방']);
    assert.equal((await sql.query('select public.af_generation_spends(j) as spends from public.af_generation_jobs j where id = $1', [open.id])).rows[0].spends, false);
    await beat();
    assert.deepEqual((await host('ended', { jobs: [open.id] })).body.ended, [open.id]);

    // Registrations under way (no creator's cancel reaches them): one the host held goes to an operator, one it never took fails. A job
    // that used its three leases still fails as before. The official host's job waits for it, however long it has been away. Any host's
    // claim runs the rule: here a second PC's, the creator's own (an official claim would take the official host's job back).
    const officialHost = (await sql.query('select id from public.af_generation_hosts where official')).rows[0].id;
    const insert = async (status, hostId, leases, leased) => (await sql.query(`insert into public.af_generation_jobs(owner_id, idempotency_key,
        description, language, status, brief, choice, profile, assigned_host, host_choice, requested_host, host_consent, stage_leases, lease_token,
        lease_expires_at, started_at)
      values ($1, gen_random_uuid(), '빨간 글러브를 낀 고양이 복서', 'ko', $2, '{}', 'a', $3, $4, 'host', $4, true, $5,
        case when $6 then gen_random_uuid() end, case when $6 then now() - interval '1 minute' end, now()) returning id`,
      [owner, status, status === 'submitting' ? '{}' : null, hostId, leases, leased])).rows[0].id;
    const heldRegistration = await insert('submitting', applied.id, 1, true);
    assert.equal((await call('DELETE', `generations/${heldRegistration}`)).body.code, 'generation-state');
    const untaken = await insert('submitting', applied.id, 0, false), spent = await insert('motions', applied.id, 3, true);
    await sql.query("update public.af_generation_jobs set host_choice = 'oddbout', requested_host = null, host_consent = false where id = $1",
      [await insert('motions', officialHost, 1, true)]);
    await sql.query("update public.af_generation_hosts set worker_seen_at = now() - interval '25 hours'");
    await call('POST', 'generations/host', { name: '내 작업실', billing: 'subscription', termsAccepted: true });
    const second = (await call('POST', 'generations/host/keys', {})).body.key;
    assert.equal((await call('POST', 'generation-worker/claim', {}, second)).body.stage, 'idle');
    const rows = Object.fromEntries((await sql.query("select id, status, error_code from public.af_generation_jobs where status not in ('cancelled', 'failed') or id = any($1)",
      [[untaken, spent]])).rows.map(row => [row.id, [row.status, row.error_code]]));
    assert.deepEqual(rows[heldRegistration], ['needs_review', 'submitting-host-lost']);
    assert.deepEqual(rows[untaken], ['failed', 'host-lost']);
    assert.deepEqual(rows[spent], ['failed', 'stage-attempts']);
    assert.deepEqual(Object.values(rows).filter(([status]) => status === 'motions'), [['motions', null]]);
    // Waiting for an operator, the registration can be cancelled now.
    assert.equal((await call('DELETE', `generations/${heldRegistration}`)).body.job.status, 'cancelled');
  } finally { await sql.close(); }
});

// 운영자 화면 (2026-10-28): the hosts (approve, withdraw) and the requests a stage left for the operator (run it again, or cancel).
test('the admin approves and withdraws hosts, and runs a stopped stage again or cancels the request', async () => {
  const { sql, owner, call, work, healthy } = await generation();
  const theirs = 'other-token-0123456789';
  try {
    await healthy();
    assert.equal((await call('GET', 'admin/generation-hosts')).status, 403); // not an admin yet
    await sql.query('insert into public.af_admins(owner_id) values($1)', [owner]);
    const applied = (await call('POST', 'generations/host', { name: '고양이 공방', billing: 'subscription', termsAccepted: true }, theirs)).body.host;
    let hosts = (await call('GET', 'admin/generation-hosts')).body.hosts;
    assert.deepEqual(hosts.map(h => [h.name, h.official, h.approved]), [['ODDBOUT', true, true], ['고양이 공방', false, false]]);
    assert.equal((await call('POST', `admin/generation-hosts/${applied.id}/approval`, { approved: 'yes' })).status, 400);
    assert.equal((await call('POST', `admin/generation-hosts/${applied.id}/approval`, { approved: true })).body.host.approved, true);
    assert.equal((await call('POST', `admin/generation-hosts/${hosts[0].id}/approval`, { approved: false })).status, 404); // the official host stays
    hosts = (await call('GET', 'admin/generation-hosts')).body.hosts;
    assert.equal(hosts[1].approved, true);
    assert.equal((await call('POST', `admin/generation-hosts/${applied.id}/approval`, { approved: false })).body.host.approved, false);

    // A request whose looks the worker left for the operator: listed, run again from the looks, then cancelled.
    const job = (await call('POST', 'generations', { description: '빨간 글러브를 낀 고양이 복서', language: 'ko' }, undefined, { 'idempotency-key': crypto.randomUUID() })).body.job;
    const finish = (c, outcome, result) => work('POST', 'finish', { jobId: c.id, leaseToken: c.leaseToken, outcome, result });
    let held = (await work('POST', 'claim', {})).body.job; await finish(held, 'ok', { brief: { profile: {} } });
    held = (await work('POST', 'claim', {})).body.job; assert.equal(held.status, 'appearance');
    await finish(held, 'review', { code: 'look-unclear' });
    const waiting = (await call('GET', 'admin/generations?status=needs_review')).body.jobs;
    assert.deepEqual(waiting.map(j => [j.id, j.status, j.errorCode, j.official]), [[job.id, 'needs_review', 'look-unclear', true]]);
    assert.equal((await call('GET', 'admin/generations?status=everything')).status, 400);
    // 상세 (2026-11-01): the whole request, its hosts by name and its latest events, newest first; the brief stays out.
    const detail = (await call('GET', `admin/generations/${job.id}`)).body.job;
    assert.deepEqual([detail.id, detail.status, detail.errorCode, detail.description, detail.official], [job.id, 'needs_review', 'look-unclear', '빨간 글러브를 낀 고양이 복서', true]);
    assert.equal('brief' in detail, false); assert.deepEqual(detail.candidates, []); assert.deepEqual(detail.refs, []);
    assert.equal(detail.events[0].kind, 'finished'); assert.equal(detail.events.at(-1).kind, 'created');
    assert.equal((await call('GET', 'admin/generations/not-a-uuid')).status, 400);
    assert.equal((await call('GET', `admin/generations/${crypto.randomUUID()}`)).status, 404);
    assert.equal((await call('GET', `admin/generations/${job.id}`, undefined, theirs)).status, 403);
    assert.equal((await call('POST', `admin/generations/${job.id}/retry`, {})).body.job.status, 'appearance');
    assert.equal((await call('POST', `admin/generations/${job.id}/retry`, {})).status, 409); // not waiting any more
    assert.equal((await work('POST', 'claim', {})).body.job.status, 'appearance'); // the worker takes it again
    assert.equal((await call('GET', 'admin/generations?status=open')).body.jobs.length, 1);
    assert.equal((await call('POST', `admin/generations/${job.id}/cancel`, {})).body.job.status, 'cancelled');
    assert.equal((await call('POST', `admin/generations/${job.id}/cancel`, {})).status, 409);
    assert.deepEqual((await call('GET', `admin/generations/${job.id}`)).body.job.events.slice(0, 2).map(e => [e.kind, e.data.action]), [['operator', 'cancel'], ['claimed', undefined]]);
    assert.equal((await call('GET', `generations/${job.id}`)).body.job.status, 'cancelled');
    assert.equal((await call('GET', 'admin/generation-hosts', undefined, theirs)).status, 403);
  } finally { await sql.close(); }
});

// My agents (2026-10-28): the site shows his subscriptions as his worker last checked them, and he removes his host there. A request for him
// that is not over keeps the host (its files are on his PC); removed, the host is off every list, key and claim, and applying again brings
// the same host back, terms anew and not approved.
// 그림 제공자 (1.1, 2026-11-06): a SuperGrok-only PC draws Grok's pictures; GPT's need its codex too, and the brief the official host's codex.
test('a request names who draws its pictures: Grok by default, GPT only where the host draws them; a claim gives a host only what it draws', async () => {
  const { sql, call, work, healthy } = await generation();
  const theirs = 'other-token-0123456789';
  try {
    await healthy();
    await call('POST', 'generations/host', { name: '그록 PC', billing: 'subscription', termsAccepted: true }, theirs);
    const key = (await call('POST', 'generations/host/keys', {}, theirs)).body.key;
    const host = (path, body) => call('POST', `generation-worker/${path}`, body, key);
    const grokOnly = { ok: true, codex: false, grok: true, images: ['grok'], at: '2026-11-06T09:00:00.000Z' };
    const both = { ok: true, codex: true, grok: true, images: ['grok', 'gpt'], at: '2026-11-06T10:00:00.000Z' };
    // His SuperGrok-only PC (host/generation-worker.mjs parseHealth): on, and it says it draws Grok's pictures.
    await host('heartbeat', { health: grokOnly });
    const own = (await call('GET', 'generations/host', undefined, theirs)).body.host;
    assert.equal(own.online, true);
    assert.deepEqual(own.health, { codex: false, grok: true, images: ['grok'], checkedAt: grokOnly.at, setup: null, platform: null, runner: null });
    const words = { description: '프라이팬을 든 펭귄 셰프', language: 'ko', host: 'mine' };
    const ask = body => call('POST', 'generations', { ...words, ...body }, theirs, { 'idempotency-key': crypto.randomUUID() });
    // GPT pictures on a PC that does not draw them now: refused at the check and at the request, nothing made. A provider not offered: refused.
    assert.equal((await call('POST', 'generations/check', { ...words, imageProvider: 'gpt' }, theirs)).body.code, 'image-provider-unavailable');
    const refused = await ask({ imageProvider: 'gpt' });
    assert.deepEqual([refused.status, refused.body.code], [409, 'image-provider-unavailable']);
    assert.deepEqual([(await ask({ imageProvider: 'claude' })).status, (await ask({ imageProvider: 'claude' })).body.code], [422, 'invalid-image-provider']);
    assert.equal((await sql.query('select count(*)::int as n from public.af_generation_jobs')).rows[0].n, 0);
    // Named none: Grok's. The official brief first (its codex ok), then his PC takes it and is told whose pictures to draw.
    const grokJob = (await ask({})).body.job;
    assert.equal(grokJob.imageProvider, 'grok');
    const [created] = (await sql.query("select data from public.af_generation_events where job_id = $1 and kind = 'created'", [grokJob.id])).rows;
    assert.equal(created.data.images, 'grok');
    const brief = (await work('POST', 'claim', {})).body.job;
    assert.deepEqual([brief.id, brief.imageProvider], [grokJob.id, 'grok']);
    await work('POST', 'finish', { jobId: brief.id, leaseToken: brief.leaseToken, outcome: 'ok', result: { brief: { profile: {} } } });
    const looks = (await host('claim', {})).body.job;
    assert.deepEqual([looks.id, looks.status, looks.imageProvider], [grokJob.id, 'appearance', 'grok']);
    await sql.query("update public.af_generation_jobs set status = 'cancelled', lease_token = null where id = $1", [grokJob.id]);
    // With codex too his PC draws GPT's: asked for, it is made, and its job says so.
    await host('heartbeat', { health: both });
    const gptJob = (await ask({ imageProvider: 'gpt' })).body.job;
    assert.equal(gptJob.imageProvider, 'gpt');
    // The brief is codex's: the official host whose last health says codex is not ok takes none, then takes it once it is.
    await work('POST', 'heartbeat', { health: grokOnly });
    assert.equal((await work('POST', 'claim', {})).body.stage, 'idle');
    await work('POST', 'heartbeat', { health: both });
    const gptBrief = (await work('POST', 'claim', {})).body.job;
    assert.equal(gptBrief.id, gptJob.id);
    await work('POST', 'finish', { jobId: gptBrief.id, leaseToken: gptBrief.leaseToken, outcome: 'ok', result: { brief: { profile: {} } } });
    // His codex went down after the request: his PC is given no job whose pictures it no longer draws; it waits, and comes back with codex.
    await host('heartbeat', { health: grokOnly });
    assert.equal((await host('claim', {})).body.stage, 'idle');
    await host('heartbeat', { health: both });
    assert.deepEqual([(await host('claim', {})).body.job?.id, gptJob.imageProvider], [gptJob.id, 'gpt']);
    // A job made before the column (its default for old rows) reads as GPT's, and a worker that says nothing of `images` is not held back.
    const [{ fn }] = (await sql.query("select public.af_generation_host_images(h) as fn from public.af_generation_hosts h where h.official")).rows;
    assert.deepEqual(fn, ['grok', 'gpt']);
  } finally { await sql.close(); }
});

test('his host shows his subscriptions, and he removes it once no request for him is open; applying again brings it back', async () => {
  const { sql, call, healthy } = await generation();
  const theirs = 'other-token-0123456789';
  try {
    await healthy();
    assert.equal((await call('DELETE', 'generations/host', undefined, theirs)).body.code, 'host-not-found');
    const applied = (await call('POST', 'generations/host', { name: '고양이 공방', billing: 'subscription', termsAccepted: true }, theirs)).body.host;
    const key = (await call('POST', 'generations/host/keys', {}, theirs)).body.key;
    const beat = health => call('POST', 'generation-worker/heartbeat', { health }, key);
    await beat({ ok: false, codex: true, grok: false, at: '2026-10-28T09:00:00.000Z' });
    const own = (await call('GET', 'generations/host', undefined, theirs)).body.host;
    // `images` null: this worker says none (before 2026-11-06).
    assert.deepEqual(own.health, { codex: true, grok: false, images: null, checkedAt: '2026-10-28T09:00:00.000Z', setup: null, platform: null, runner: null });
    assert.equal(own.online, false); // a subscription not answering keeps the PC off
    await beat({ ok: true, codex: true, grok: true, at: '2026-10-28T10:00:00.000Z' });
    assert.equal((await call('GET', 'generations/host', undefined, theirs)).body.host.online, true);
    // A request on his PC, not over: he cannot remove the host its files are on.
    const ask = () => call('POST', 'generations', { description: '파란 망토를 두른 고양이 검객', language: 'ko', host: 'mine' }, theirs,
      { 'idempotency-key': crypto.randomUUID() });
    const job = (await ask()).body.job;
    const busy = await call('DELETE', 'generations/host', undefined, theirs);
    assert.deepEqual([busy.status, busy.body.code], [409, 'host-busy']);
    await sql.query("update public.af_generation_jobs set status = 'cancelled' where id = $1", [job.id]);
    const code = (await call('POST', 'generations/host/join-codes', {}, theirs)).body.code;
    const removed = await call('DELETE', 'generations/host', undefined, theirs);
    assert.deepEqual([removed.status, removed.body.removed, removed.body.revoked], [200, true, 1]);
    // Gone: no host of his, no key, no code, no switch, no request to it; his worker is refused; the operator's list leaves it out.
    assert.equal((await call('GET', 'generations/host', undefined, theirs)).body.host, null);
    assert.equal((await beat({ ok: true, codex: true, grok: true })).status, 403);
    assert.equal((await call('POST', 'generations/host/join', { code }, null)).body.code, 'join-code-invalid');
    assert.equal((await call('POST', 'generations/host/keys', {}, theirs)).body.code, 'host-not-found');
    assert.equal((await call('POST', 'generations/host/join-codes', {}, theirs)).body.code, 'host-not-found');
    assert.equal((await call('PATCH', 'generations/host', { enabled: true }, theirs)).status, 404);
    assert.equal((await ask()).body.code, 'host-not-found');
    assert.equal((await call('DELETE', 'generations/host', undefined, theirs)).body.code, 'host-not-found');
    const [row] = (await sql.query('select removed_at is not null as removed, enabled, approved from public.af_generation_hosts where id = $1', [applied.id])).rows;
    assert.deepEqual(row, { removed: true, enabled: false, approved: false });
    assert.deepEqual((await call('GET', 'generations/hosts', undefined, null)).body.hosts.map(h => h.name), ['ODDBOUT']);
    // Applying again: the same host, switched on, not approved, nothing of the old worker's report; a new PC joins it.
    const back = (await call('POST', 'generations/host', { name: '고양이 공방 2', billing: 'subscription', termsAccepted: true }, theirs)).body.host;
    assert.deepEqual([back.id, back.enabled, back.approved, back.name], [applied.id, true, false, '고양이 공방 2']);
    const again = (await call('GET', 'generations/host', undefined, theirs)).body.host;
    assert.deepEqual([again.online, again.lastSeenAt, again.health], [false, null, { codex: false, grok: false, images: null, checkedAt: null, setup: null, platform: null, runner: null }]);
    const joined = (await call('POST', 'generations/host/join', { code: (await call('POST', 'generations/host/join-codes', {}, theirs)).body.code }, null)).body;
    assert.equal(joined.host, applied.id);
  } finally { await sql.close(); }
});

// 내 PC 카드 (계획 1.5, 2026-11-07): while it installs, the PC runner's heartbeats say its step, its OS and its version beside logins not
// ready yet (host/runner.mjs heartbeater), and his host passes them on — the card says "설치 3/6단계" and "Windows", not "Grok 로그인 필요".
test('his host passes on what his PC runner says, its install step, OS and version, and null for anything else', async () => {
  const { sql, call, healthy } = await generation();
  const theirs = 'other-token-0123456789';
  try {
    await healthy();
    await call('POST', 'generations/host', { name: '고양이 공방', billing: 'subscription', termsAccepted: true }, theirs);
    const key = (await call('POST', 'generations/host/keys', {}, theirs)).body.key;
    const beat = health => call('POST', 'generation-worker/heartbeat', { health }, key);
    const own = async () => (await call('GET', 'generations/host', undefined, theirs)).body.host;
    const at = '2026-11-07T09:00:00.000Z', installing = { ok: false, codex: false, grok: false, images: [], at, platform: 'windows', runner: '0.1.1' };
    await beat({ ...installing, setup: 'sprite' });
    let host = await own();
    assert.equal(host.online, false);
    assert.deepEqual(host.health, { codex: false, grok: false, images: [], checkedAt: at, setup: 'sprite', platform: 'windows', runner: '0.1.1' });
    // Each step, and each failed as the runner says it (`${name}-failed`).
    for (const step of HOST_SETUP_STAGES) for (const setup of [step, `${step}-failed`]) {
      await beat({ ...installing, setup });
      assert.equal((await own()).health.setup, setup);
    }
    // Not the runner's words: that one null, the rest kept.
    for (const [said, read] of [
      [{ setup: 'banana', platform: 'macos', runner: 'x'.repeat(33) }, { setup: null, platform: 'macos', runner: null }],
      [{ setup: 'failed', platform: 'win32', runner: '' }, { setup: null, platform: null, runner: null }],
      [{ setup: 'kit-failed-failed', platform: 'Windows', runner: 11 }, { setup: null, platform: null, runner: null }],
      [{ setup: 3, platform: null, runner: 'x'.repeat(32) }, { setup: null, platform: null, runner: 'x'.repeat(32) }],
    ]) {
      await beat({ ok: false, codex: false, grok: false, at, ...said });
      const { setup, platform, runner } = (await own()).health;
      assert.deepEqual({ setup, platform, runner }, read);
    }
    // Its worker running: ready and on (the worker's aboutHealth keeps the runner's words beside its logins).
    await beat({ ok: true, codex: false, grok: true, images: ['grok'], at, setup: 'ready', platform: 'linux', runner: '0.1.1' });
    host = await own();
    assert.equal(host.online, true);
    assert.deepEqual([host.health.setup, host.health.platform, host.health.runner], ['ready', 'linux', '0.1.1']);
    // The OSes are the pairing's (a PC pairs saying its OS the same way).
    assert.deepEqual(HOST_PLATFORMS, PAIRING_PLATFORMS);
  } finally { await sql.close(); }
});

// Removal, the other paths: an approved host loses approval and leaves the operator's list; a job he took (an open request) keeps him; his
// own request naming the removed host by id, a code redeemed after removal and a claim for the removed host are refused.
test('a removed host is refused everywhere: approval, the operator list, a job he took, a request by id, a join code, a claim', async () => {
  const { sql, owner, call, work, healthy } = await generation();
  const theirs = 'other-token-0123456789';
  try {
    await healthy();
    await sql.query('insert into public.af_admins(owner_id) values($1)', [owner]);
    const applied = (await call('POST', 'generations/host', { name: '고양이 공방', billing: 'subscription', termsAccepted: true }, theirs)).body.host;
    await sql.query('update public.af_generation_hosts set approved = true where id = $1', [applied.id]);
    const key = (await call('POST', 'generations/host/keys', {}, theirs)).body.key;
    const host = (method, path, body) => call(method, `generation-worker/${path}`, body, key);
    await host('POST', 'heartbeat', { health: { ok: true, codex: true, grok: true } });
    // Another creator's open request after the official brief: the approved host takes it, so it is his until it ends.
    const job = (await call('POST', 'generations', { description: '빨간 글러브를 낀 고양이 복서', language: 'ko', host: 'any', hostConsent: true },
      undefined, { 'idempotency-key': crypto.randomUUID() })).body.job;
    const brief = (await work('POST', 'claim', {})).body.job;
    await work('POST', 'finish', { jobId: brief.id, leaseToken: brief.leaseToken, outcome: 'ok', result: { brief: { profile: {} } } });
    assert.equal((await host('POST', 'claim', {})).body.job.id, job.id);
    assert.equal((await call('DELETE', 'generations/host', undefined, theirs)).body.code, 'host-busy');
    await sql.query("update public.af_generation_jobs set status = 'cancelled' where id = $1", [job.id]);
    // A code minted before removal, then the host marked removed without its codes deleted (a code redeemed during removal).
    const code = (await call('POST', 'generations/host/join-codes', {}, theirs)).body.code;
    assert.equal((await call('DELETE', 'generations/host', undefined, theirs)).status, 200);
    const [row] = (await sql.query('select approved, enabled from public.af_generation_hosts where id = $1', [applied.id])).rows;
    assert.deepEqual(row, { approved: false, enabled: false });
    assert.deepEqual((await call('GET', 'admin/generation-hosts')).body.hosts.map(h => h.name), ['ODDBOUT']);
    assert.equal((await call('POST', `admin/generation-hosts/${applied.id}/approval`, { approved: true })).status, 404);
    assert.equal((await call('POST', 'generations/host/join', { code }, null)).body.code, 'join-code-invalid'); // removal deleted it
    const late = `ohj_${'c'.repeat(40)}`;
    await sql.query("insert into public.af_generation_host_joins(code_hash, host_id, expires_at) values ($1, $2, now() + interval '30 minutes')",
      [await (await import('../api/handler.mjs')).sha256(new TextEncoder().encode(late)), applied.id]);
    assert.equal((await call('POST', 'generations/host/join', { code: late }, null)).body.code, 'join-code-invalid');
    assert.equal((await sql.query('select count(*)::int as n from public.af_workers where host_id = $1 and enabled', [applied.id])).rows[0].n, 0);
    assert.equal((await call('POST', 'generations', { description: '파란 망토를 두른 고양이 검객', language: 'ko', host: applied.id }, theirs,
      { 'idempotency-key': crypto.randomUUID() })).body.code, 'invalid-host');
    // Even switched on by hand, a removed host claims nothing.
    await sql.query('update public.af_generation_hosts set enabled = true where id = $1', [applied.id]);
    assert.equal((await sql.query('select (public.af_generation_claim_for($1)).id as id', [applied.id])).rows[0].id, null);
  } finally { await sql.close(); }
});

// 내 PC 연결, 코드 복사 없이 (2026-11-05): the PC starts a pairing with no account and opens the site; the owner presses Connect there; the
// PC's poll gets its worker key once (api/host-pairing.mjs).
test('a PC pairs without a copied code: the site shows its name and OS, Connect makes a host, the poll gets the key once', async () => {
  const { sql, call, healthy } = await generation();
  const theirs = 'other-token-0123456789';
  const { sha256 } = await import('../api/handler.mjs');
  try {
    await healthy();
    const started = await call('POST', 'generations/host/pairings', { name: ' DESKTOP-7Q2K ', platform: 'windows' }, null);
    assert.equal(started.status, 200);
    const { pairingCode, userCode, url, interval, expiresAt } = started.body;
    assert.match(pairingCode, /^ohp_[a-f0-9]{64}$/);
    assert.match(userCode, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    assert.equal(url, `https://oddbout.com/creator.html#pc=${userCode}`);
    assert.equal(interval, 5);
    assert.ok(Date.parse(expiresAt) - Date.now() > 9 * 60_000);
    // Only the secret's hash is kept.
    const [row] = (await sql.query('select * from public.af_generation_host_pairings')).rows;
    assert.equal(row.secret_hash, await sha256(new TextEncoder().encode(pairingCode)));
    assert.ok(!JSON.stringify(row).includes(pairingCode));
    const poll = () => call('POST', 'generations/host/pairings/token', { pairingCode }, null);
    const unpaced = () => sql.query("update public.af_generation_host_pairings set polled_at = now() - interval '10 seconds'");
    assert.equal((await poll()).body.status, 'pending');
    const fast = await poll();
    assert.deepEqual([fast.status, fast.body.code], [429, 'slow-down']);

    // The site shows the code's PC to a signed-in owner; dashes and case do not matter.
    assert.equal((await call('GET', `generations/host/pairings/${userCode}`, undefined, null)).status, 401);
    const shown = (await call('GET', `generations/host/pairings/${userCode.toLowerCase().replace('-', '')}`, undefined, theirs)).body.pairing;
    assert.deepEqual([shown.userCode, shown.name, shown.platform], [userCode, 'DESKTOP-7Q2K', 'windows']);
    // Connect: he had no host, so one is made with a default name, his subscription, the terms accepted; no key on the site.
    assert.equal((await call('POST', 'generations/host/pairings/approve', { userCode }, null)).status, 401);
    const approved = (await call('POST', 'generations/host/pairings/approve', { userCode }, theirs)).body;
    assert.deepEqual([approved.host.name, approved.host.approved, approved.pc.name, approved.pc.platform], ['My PC', false, 'DESKTOP-7Q2K', 'windows']);
    assert.equal(approved.key, undefined);
    const mine = (await call('GET', 'generations/host', undefined, theirs)).body.host;
    assert.deepEqual([mine.id, mine.name, mine.billing, mine.keys.length], [approved.host.id, 'My PC', 'subscription', 0]);
    // Approved once: neither the same nor another account can approve it again, and the site no longer shows it.
    assert.equal((await call('POST', 'generations/host/pairings/approve', { userCode })).body.code, 'pairing-not-found');
    assert.equal((await call('GET', `generations/host/pairings/${userCode}`, undefined, theirs)).status, 404);

    await unpaced();
    const granted = (await poll()).body;
    assert.equal(granted.status, 'approved');
    assert.match(granted.key, /^afw_[a-f0-9]{64}$/);
    assert.deepEqual([granted.host, granted.name, granted.approved], [approved.host.id, 'My PC', false]);
    // The key is the host's, made from the join code the approval kept (labelled with the PC's OS); the code is spent. The PC connects
    // before it installs, so its first heartbeat tells how setup goes.
    const beat = await call('POST', 'generation-worker/heartbeat', { health: { ok: false, setup: 'python', platform: 'windows', codex: false, grok: false } }, granted.key);
    assert.equal(beat.status, 200);
    const [key] = (await sql.query('select label from public.af_workers where host_id = $1 and enabled', [approved.host.id])).rows;
    assert.match(key.label, /^host-pair-windows-\d{4}-\d{2}-\d{2}$/);
    assert.equal((await sql.query('select count(*)::int as n from public.af_generation_host_joins where host_id = $1 and used_at is null', [approved.host.id])).rows[0].n, 0);
    assert.equal((await sql.query('select join_hash from public.af_generation_host_pairings')).rows[0].join_hash, null);
    await unpaced();
    const again = await poll();
    assert.deepEqual([again.status, again.body.code], [410, 'pairing-consumed']);
    assert.equal((await sql.query('select count(*)::int as n from public.af_workers where host_id = $1', [approved.host.id])).rows[0].n, 1);
  } finally { await sql.close(); }
});

test('Connect keeps his host and its name, brings a removed one back, five an hour; codes expire and the start is checked', async () => {
  const { sql, db, call, healthy } = await generation();
  const theirs = 'other-token-0123456789';
  const { createHandler } = await import('../api/handler.mjs');
  const handle = createHandler({ db });
  try {
    await healthy();
    const start = async (pc = { name: 'mac-studio', platform: 'macos' }) => (await call('POST', 'generations/host/pairings', pc, null)).body;
    const approve = code => call('POST', 'generations/host/pairings/approve', { userCode: code }, theirs);
    const poll = pairingCode => call('POST', 'generations/host/pairings/token', { pairingCode }, null);
    // His host keeps its name and billing.
    const applied = (await call('POST', 'generations/host', { name: '고양이 공방', billing: 'api-key', termsAccepted: true }, theirs)).body.host;
    const first = await start();
    assert.equal((await approve(first.userCode)).body.host.id, applied.id);
    assert.equal((await approve(first.userCode)).status, 404);
    assert.equal((await poll(first.pairingCode)).body.name, '고양이 공방');
    assert.equal((await call('GET', 'generations/host', undefined, theirs)).body.host.billing, 'api-key');
    // Removed, then Connected again: the same host comes back, not approved, with his name.
    assert.equal((await call('DELETE', 'generations/host', undefined, theirs)).status, 200);
    const second = await start({ name: 'ubuntu-box', platform: 'linux' });
    const back = (await approve(second.userCode)).body.host;
    assert.deepEqual([back.id, back.name, back.approved], [applied.id, '고양이 공방', false]);
    assert.equal((await sql.query('select removed_at from public.af_generation_hosts where id = $1', [applied.id])).rows[0].removed_at, null);
    // Removed between Connect and the poll: the PC gets no key.
    const third = await start();
    await approve(third.userCode);
    await call('DELETE', 'generations/host', undefined, theirs);
    assert.equal((await poll(third.pairingCode)).body.code, 'join-code-invalid');
    // Five Connects an hour per account: three made above, two more, then no sixth until an hour has passed.
    for (let i = 0; i < 2; i++) assert.equal((await approve((await start()).userCode)).status, 200);
    const sixth = await start();
    const refused = await approve(sixth.userCode);
    assert.deepEqual([refused.status, refused.body.code], [429, 'rate-limit']);
    await sql.query("update public.af_generation_host_pairings set approved_at = now() - interval '61 minutes' where approved_at is not null");
    assert.equal((await approve(sixth.userCode)).status, 200);
    // A disabled account cannot Connect.
    await sql.query('update public.af_creators set enabled = false where owner_id = (select owner_id from public.af_generation_hosts where id = $1)', [applied.id]);
    assert.equal((await approve((await start()).userCode)).body.code, 'account-disabled');
    await sql.query('update public.af_creators set enabled = true where not enabled');

    // A Connect in the code's last seconds still reaches the PC; past ten minutes the PC hears it expired and the site finds nothing.
    const late = await start();
    await sql.query("update public.af_generation_host_pairings set expires_at = now() + interval '2 seconds' where status = 'pending'");
    await approve(late.userCode);
    assert.equal((await sql.query("select count(*)::int as n from public.af_generation_host_pairings where status = 'approved' and expires_at < now() + interval '50 seconds'")).rows[0].n, 0);
    const gone = await start();
    await sql.query("update public.af_generation_host_pairings set expires_at = now() - interval '1 second' where status = 'pending'");
    const expired = await poll(gone.pairingCode);
    assert.deepEqual([expired.status, expired.body.code], [410, 'pairing-expired']);
    assert.equal((await call('GET', `generations/host/pairings/${gone.userCode}`, undefined, theirs)).status, 404);
    assert.equal((await approve(gone.userCode)).body.code, 'pairing-not-found');

    // What a PC may say, and the secret's form.
    for (const pc of [{ name: '', platform: 'windows' }, { name: 'x'.repeat(41), platform: 'windows' }, { name: 'a\nb', platform: 'linux' },
      { name: 'pc', platform: 'android' }, { name: 'pc' }])
      assert.equal((await call('POST', 'generations/host/pairings', pc, null)).body.code, 'invalid-pc', JSON.stringify(pc));
    assert.equal((await call('POST', 'generations/host/pairings', { name: 'pc', platform: 'linux', owner: 'me' }, null)).body.code, 'invalid-body');
    assert.equal((await poll('ohp_short')).status, 400);
    assert.equal((await poll(`ohp_${'0'.repeat(64)}`)).body.code, 'pairing-not-found');
    assert.equal((await call('GET', 'generations/host/pairings/AEIO-UAEI', undefined, theirs)).body.code, 'invalid-user-code');
    assert.equal((await call('GET', 'generations/host/pairings', undefined, null)).status, 405);
    // Only the site's two routes answer a browser; the PC's start and poll do not.
    const raw = (method, route) => handle(new Request(`http://localhost/ai-fighter/${route}`, { method }));
    assert.equal((await raw('OPTIONS', 'generations/host/pairings/approve')).headers.get('access-control-allow-origin'), '*');
    assert.equal((await raw('OPTIONS', 'generations/host/pairings/BCDF-GHJK')).headers.get('access-control-allow-origin'), '*');
    assert.equal((await raw('OPTIONS', 'generations/host/pairings')).headers.get('access-control-allow-origin'), null);
    assert.equal((await raw('OPTIONS', 'generations/host/pairings/token')).headers.get('access-control-allow-origin'), null);
  } finally { await sql.close(); }
});

test('Postgres brakes unauthenticated pairing starts, refuses a shared open code, and hides the table from clients', async () => {
  const { sql, owner } = await generation();
  try {
    const hash = n => n.toString(16).padStart(64, '0');
    const start = (n, code) => sql.query("select public.af_generation_host_pairing_start($1, $2, 'pc', 'linux', 600)", [hash(n), code]);
    await start(1, 'BCDFGHJK');
    await assert.rejects(start(2, 'BCDFGHJK'), /user-code-collision/);
    await sql.query(`insert into public.af_generation_host_pairings(secret_hash, user_code, pc_name, platform, status, owner_id, join_hash, expires_at)
      select lpad(to_hex(g), 64, '0'), 'ZZZZZZZZ', 'pc', 'linux', 'approved', $1, lpad(to_hex(g), 64, '0'), now() + interval '10 minutes'
      from generate_series(1000, 1118) g`, [owner]);
    await assert.rejects(start(3, 'CCCCCCCC'), /rate-limit/);
    await sql.query("update public.af_generation_host_pairings set created_at = now() - interval '1 hour' where created_at > now() - interval '1 hour'");
    await start(3, 'CCCCCCCC');
    await assert.rejects(sql.query("select public.af_generation_host_pairing_start($1, 'DDDDDDDD', 'pc', 'linux', 30)", [hash(4)]), /invalid-ttl/);
    await sql.query('set role anon');
    await assert.rejects(sql.query('select * from public.af_generation_host_pairings'), /permission denied/);
    await assert.rejects(sql.query('select public.af_generation_host_pairing_view($1)', ['BCDFGHJK']), /permission denied/);
    await sql.query('reset role');
  } finally { await sql.close(); }
});
