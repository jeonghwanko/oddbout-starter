import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
    assert.deepEqual(own.health, { codex: true, grok: false, checkedAt: '2026-10-28T09:00:00.000Z' });
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
    assert.deepEqual([again.online, again.lastSeenAt, again.health], [false, null, { codex: false, grok: false, checkedAt: null }]);
    const joined = (await call('POST', 'generations/host/join', { code: (await call('POST', 'generations/host/join-codes', {}, theirs)).body.code }, null)).body;
    assert.equal(joined.host, applied.id);
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
