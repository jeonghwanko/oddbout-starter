import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, readBody, sha256 } from '../api/handler.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };

test('public spec announces open registration while anonymous writes fail', async () => {
  const handle = createHandler({ db: {} });
  const spec = await (await handle(new Request('https://test/ai-fighter/spec'))).json();
  assert.equal(spec.data.registration.available, true);
  assert.equal(spec.data.registration.mode, 'open');
  assert.equal(spec.data.registration.approvalRequired, false);
  // A validated fighter waits for his owner's entry (출전, 2026-10-30); the site turns its entry screen on from this.
  assert.equal(spec.data.registration.publication, 'owner-entry-after-file-validation');
  assert.equal(spec.data.registration.fighterEntry, 'v1');
  const result = await handle(new Request('https://test/ai-fighter/submissions', { method: 'POST', body: '{}' }));
  assert.equal(result.status, 401);
});
test('creator JWT cannot enter the worker approval path', async () => {
  const handle = createHandler({ db: {} });
  const response = await handle(
    new Request('https://test/ai-fighter/worker/finish', { method: 'POST', headers: { authorization: 'Bearer not-a-worker-token-long-enough' }, body: '{}' }),
  );
  assert.equal(response.status, 403);
});
test('body limit is enforced even with a missing or lying Content-Length', async () => {
  await assert.rejects(readBody(new Request('https://test', { method: 'POST', body: '123456' }), 5), /body-limit/);
  await assert.rejects(readBody(new Request('https://test', { method: 'POST', headers: { 'content-length': '1' }, body: '123456' }), 5), /body-limit/);
});
test('server validates JSON before writing a submission', async () => {
  const owner = crypto.randomUUID(),
    calls = [];
  const handle = createHandler({
    db: {
      auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
      rpc: async (name, args) => {
        calls.push(name);
        return { data: name === 'af_authorize' ? true : { id: crypto.randomUUID(), manifest_sha: args.p_sha, status: 'uploading' } };
      },
    },
  });
  const send = text =>
    handle(
      new Request('https://test/ai-fighter/submissions', {
        method: 'POST',
        headers: { authorization: 'Bearer signed-user-token-for-test', 'idempotency-key': crypto.randomUUID() },
        body: text,
      }),
    );
  assert.equal((await send('{"schemaVersion":1,"schemaVersion":2}')).status, 422);
  assert.deepEqual(calls, ['af_authorize']);
  assert.equal((await send(JSON.stringify(example))).status, 200);
  assert.deepEqual(calls, ['af_authorize', 'af_authorize', 'af_create_submission']);
  assert.equal((await sha256(new TextEncoder().encode('abc'))).length, 64);
});
test("?fighter= targets the caller's fighter for an in-place update; a malformed ID writes nothing", async () => {
  const owner = crypto.randomUUID(),
    fighter = crypto.randomUUID(),
    calls = [];
  const handle = createHandler({
    db: {
      auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
      rpc: async (name, args) => {
        calls.push([name, args]);
        return name === 'af_authorize'
          ? { data: true }
          : args.p_fighter === fighter
            ? { data: { id: crypto.randomUUID(), manifest_sha: args.p_sha, status: 'uploading' } }
            : { error: { message: 'fighter-not-found' } };
      },
    },
  });
  const send = query =>
    handle(
      new Request(`https://test/ai-fighter/submissions${query}`, {
        method: 'POST',
        headers: { authorization: 'Bearer signed-user-token-for-test', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify(example),
      }),
    );
  assert.equal((await send(`?fighter=${fighter}`)).status, 200);
  assert.equal(calls.find(([name]) => name === 'af_create_submission')[1].p_fighter, fighter);
  assert.equal((await send(`?fighter=${crypto.randomUUID()}`)).status, 404);
  calls.length = 0;
  assert.equal((await send('?fighter=not-a-uuid')).status, 422);
  assert.ok(!calls.some(([name]) => name === 'af_create_submission'));
});
test('the registration API returns the database fighter limit as a conflict', async () => {
  const handle = createHandler({
    db: {
      auth: { getUser: async () => ({ data: { user: { id: crypto.randomUUID() } } }) },
      rpc: async name => (name === 'af_authorize' ? { data: true } : { error: { message: 'fighter-quota' } }),
    },
  });
  const response = await handle(
    new Request('https://test/ai-fighter/submissions', {
      method: 'POST',
      headers: { authorization: 'Bearer signed-user-token-for-test', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(example),
    }),
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'fighter-quota');
});

test('text that Postgres jsonb cannot store is rejected with 422 before any write', async () => {
  const owner = crypto.randomUUID(),
    calls = [];
  const handle = createHandler({
    db: {
      auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
      rpc: async name => {
        calls.push(name);
        return { data: true };
      },
    },
  });
  for (const escape of ['\\u0000', '\\ud800']) {
    const text = JSON.stringify(example).replace(`"${example.profile.name}"`, `"Sparring${escape}Bot"`);
    const response = await handle(
      new Request('https://test/ai-fighter/submissions', {
        method: 'POST',
        headers: { authorization: 'Bearer signed-user-token-for-test', 'idempotency-key': crypto.randomUUID() },
        body: text,
      }),
    );
    assert.equal(response.status, 422);
    assert.deepEqual(
      (await response.json()).errors.map(e => [e.code, e.path]),
      [['UNSUPPORTED_TEXT', '/profile/name']],
    );
  }
  assert.ok(!calls.includes('af_create_submission'));
});
test('rejected and expired submissions are final: nothing is pending', async () => {
  const owner = crypto.randomUUID(),
    id = crypto.randomUUID();
  let row;
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: row }) };
  const handle = createHandler({
    db: { auth: { getUser: async () => ({ data: { user: { id: owner } } }) }, rpc: async () => ({ data: true }), from: () => query },
  });
  const read = async () =>
    (await handle(new Request(`https://test/ai-fighter/submissions/${id}`, { headers: { authorization: 'Bearer signed-user-token-for-test' } }))).json();
  row = { id, owner_id: owner, status: 'rejected', manifest_sha: 'a'.repeat(64), validation: { code: 'worker-attempt-limit' } };
  assert.deepEqual((await read()).pending, []);
  row = { id, owner_id: owner, status: 'uploading', manifest_sha: 'a'.repeat(64), expires_at: new Date(Date.now() - 1000).toISOString() };
  const expired = await read();
  assert.deepEqual([expired.stage, expired.code, expired.pending], ['uploading', 'upload-expired', []]);
  row.expires_at = new Date(Date.now() + 60000).toISOString();
  const open = await read();
  assert.equal(open.code, undefined);
  assert.deepEqual(open.pending, ['server-validation', 'registration']);
  assert.deepEqual(open.pendingStages, ['asset-upload', 'server-validation', 'registration']);
  assert.deepEqual(open.missingAssets, []);
  assert.equal(open.assetUploadState, 'unconfirmed');
  assert.ok(!open.pending.includes('idle'));
});
test('a verifiable JWT is checked locally; the Auth server is not called', async () => {
  const owner = crypto.randomUUID(),
    calls = [];
  const auth = {
    getClaims: async token => {
      calls.push('getClaims');
      return token === 'signed-user-token-for-test' ? { data: { claims: { sub: owner, is_anonymous: false } } } : { data: null, error: new Error('invalid') };
    },
    getUser: async () => {
      calls.push('getUser');
      return { data: { user: { id: owner } } };
    },
  };
  const handle = createHandler({
    db: {
      auth,
      rpc: async name => {
        calls.push(name);
        return { data: name === 'af_authorize' ? true : null };
      },
      from: () => {
        const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null }) };
        return q;
      },
    },
  });
  const read = token => handle(new Request(`https://test/ai-fighter/fighters/${crypto.randomUUID()}`, { headers: { authorization: `Bearer ${token}` } }));
  assert.equal((await read('signed-user-token-for-test')).status, 404);
  assert.deepEqual(calls, ['getClaims', 'af_authorize']);
  assert.equal((await read('forged-token-long-enough-1')).status, 401);
  const anonymous = { getClaims: async () => ({ data: { claims: { sub: owner, is_anonymous: true } } }) };
  assert.equal(
    (
      await createHandler({ db: { auth: anonymous } })(
        new Request('https://test/ai-fighter/submissions', {
          method: 'POST',
          headers: { authorization: 'Bearer signed-user-token-for-test' },
          body: '{}',
        }),
      )
    ).status,
    401,
  );
});
test('the creator page may call every submission route from a browser, including its errors', async () => {
  const handle = createHandler({ db: {} });
  for (const path of [
    'submissions',
    `submissions/${crypto.randomUUID()}`,
    `submissions/${crypto.randomUUID()}/submit`,
    `submissions/${crypto.randomUUID()}/assets/idle`,
  ]) {
    const preflight = await handle(new Request(`https://test/ai-fighter/${path}`, { method: 'OPTIONS' }));
    assert.equal(preflight.status, 200);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
    assert.match(preflight.headers.get('access-control-allow-methods'), /PUT/);
    assert.match(preflight.headers.get('access-control-allow-headers'), /Idempotency-Key/);
  }
  // A browser must be able to read the refusal, or the page cannot say why.
  const refused = await handle(new Request('https://test/ai-fighter/submissions', { method: 'POST', body: '{}' }));
  assert.equal(refused.status, 401);
  assert.equal(refused.headers.get('access-control-allow-origin'), '*');
  assert.equal((await handle(new Request('https://test/ai-fighter/worker/claim', { method: 'OPTIONS' }))).headers.get('access-control-allow-origin'), null);
});
test('a worker hands back an infrastructure failure under its lease; the code is validated first', async () => {
  const calls = [];
  const workers = { select: () => workers, eq: () => workers, gt: () => workers, maybeSingle: async () => ({ data: { token_hash: 'h' } }) };
  const handle = createHandler({
    db: {
      from: () => workers,
      rpc: async (name, args) => {
        calls.push([name, args]);
        return { data: { id: args.p_id, status: 'queued' } };
      },
    },
  });
  const release = body =>
    handle(
      new Request('https://test/ai-fighter/worker/release', {
        method: 'POST',
        headers: { authorization: `Bearer afw_${'a'.repeat(64)}` },
        body: JSON.stringify(body),
      }),
    );
  const ids = { submissionId: crypto.randomUUID(), leaseToken: crypto.randomUUID() };
  assert.equal((await release({ ...ids, code: 'Not A Code' })).status, 400);
  assert.equal(calls.length, 0);
  const response = await release({ ...ids, code: 'download-failed' });
  assert.deepEqual([response.status, (await response.json()).stage], [200, 'requeued']);
  assert.deepEqual(calls, [['af_release', { p_id: ids.submissionId, p_lease: ids.leaseToken, p_code: 'download-failed' }]]);
});
