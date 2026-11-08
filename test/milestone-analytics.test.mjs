import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { milestoneModule } from '../scripts/site-milestones.mjs';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createRegistrationAnalytics, validClient } from '../api/registration-analytics.mjs';

test('each actual bout starts and finishes once; unloaded/aborted bouts cannot complete', () => {
  const events = [];
  const context = {
    window: { dispatchEvent: e => events.push(e.detail), addEventListener() {} },
    CustomEvent: class {
      constructor(type, fields) {
        this.type = type;
        Object.assign(this, fields);
      }
    },
  };
  runInNewContext(milestoneModule.replace('export {milestone, creationStart, bindIdentity};', 'this.emit=milestone; this.copy=creationStart;'), context);
  const first = {},
    second = {};
  context.emit('match_complete', first);
  assert.equal(events.length, 0);
  context.emit('game_start', first, { mode: 'play' });
  context.emit('game_start', first);
  context.emit('match_complete', first, { result: 'ko' });
  context.emit('match_complete', first);
  context.emit('game_start', second);
  context.emit('match_complete', second, { result: 'forfeit' });
  context.copy();
  assert.deepEqual(
    events.map(e => e.name),
    ['game_start', 'match_complete', 'game_start', 'match_complete', 'creation_start'],
  );
});

function database() {
  let claimed = false;
  const operations = [];
  const db = {
    from(table) {
      const op = { table };
      operations.push(op);
      const query = {
        update(data) {
          op.update = data;
          return query;
        },
        upsert(data) {
          op.upsert = data;
          return Promise.resolve({ error: null });
        },
        delete() {
          op.delete = true;
          return query;
        },
        eq(key, value) {
          op[key] = value;
          return query;
        },
        select() {
          return query;
        },
        maybeSingle() {
          const data = claimed
            ? null
            : { submission_id: 'internal-submission', client_id: '12345.67890', session_id: '12345', created_at: new Date().toISOString() };
          claimed = true;
          return Promise.resolve({ data, error: null });
        },
        then(resolve) {
          resolve({ error: null });
        },
      };
      return query;
    },
  };
  return { db, operations };
}

test('registration is emitted only for registered receipts and one atomic outbox claim', async () => {
  const { db, operations } = database(),
    sent = [];
  const analytics = createRegistrationAnalytics({
    db,
    measurementId: 'G-ABC123DEF4',
    apiSecret: 'test-secret',
    send: async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return new Response(null, { status: 204 });
    },
  });
  await analytics.registered({ id: 'internal-submission', status: 'queued' });
  assert.equal(operations.length, 0);
  await Promise.all([
    analytics.registered({ id: 'internal-submission', status: 'registered' }),
    analytics.registered({ id: 'internal-submission', status: 'registered' }),
  ]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.events[0].name, 'character_registered');
  assert.equal(sent[0].body.client_id, '12345.67890');
  assert.equal(sent[0].body.consent.ad_personalization, 'DENIED');
  assert.ok(!JSON.stringify(sent[0].body).includes('internal-submission'));
  assert.equal(operations.at(-1).update.status, 'sent');
});

test('uncertain delivery is recorded as unknown and cannot be blindly retried', async () => {
  const { db, operations } = database();
  let attempts = 0;
  const analytics = createRegistrationAnalytics({
    db,
    measurementId: 'G-ABC123DEF4',
    apiSecret: 'test-secret',
    send: async () => {
      attempts++;
      throw new Error('network');
    },
  });
  await analytics.registered({ id: 'one', status: 'registered' });
  await analytics.registered({ id: 'one', status: 'registered' });
  assert.equal(attempts, 1);
  assert.equal(operations.find(op => op.update?.status === 'unknown')?.submission_id, 'one');
});

test('context accepts only actual tag ID formats and supports disabling the link', async () => {
  const { db, operations } = database();
  const analytics = createRegistrationAnalytics({ db });
  assert.equal(validClient('private@email.example'), false);
  const request = body => new Request('https://api.example/analytics/context', { method: 'POST', body: JSON.stringify(body) });
  await assert.rejects(
    analytics.context(request({ enabled: true, clientId: '1.2', sessionId: '123', email: 'private' }), 'owner'),
    /invalid-analytics-context/,
  );
  const response = await analytics.context(request({ enabled: true, clientId: '1.2', sessionId: '123' }), 'verified-owner');
  assert.equal(response.status, 200);
  assert.equal(operations[0].upsert.owner_id, 'verified-owner');
  await analytics.context(request({ enabled: false }), 'verified-owner');
  assert.equal(operations[1].delete, true);
  assert.equal(operations[2].update.status, 'cancelled');
});

test('database queues only a new registration with unexpired context, restricts clients and schedules retention', async () => {
  const sql = new PGlite();
  try {
    await sql.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create table auth.users(id uuid primary key);
   create table public.af_submissions(id uuid primary key);
   create table public.af_fighters(submission_id uuid primary key, owner_id uuid not null);
   grant usage on schema public,auth to service_role;
   grant insert on public.af_fighters to service_role;
   create schema cron; create table cron.jobs(name text,schedule text,command text);
   create function cron.schedule(text,text,text) returns bigint language sql as $$
    insert into cron.jobs values($1,$2,$3) returning 1::bigint $$;`);
    await sql.exec(await readFile(new URL('../supabase/migrations/20261022090007_oddbout_registration_analytics.sql', import.meta.url), 'utf8'));
    const owner = crypto.randomUUID(),
      missing = crypto.randomUUID(),
      fresh = crypto.randomUUID(),
      old = crypto.randomUUID(),
      absent = crypto.randomUUID();
    await sql.query('insert into auth.users values($1),($2)', [owner, missing]);
    await sql.query('insert into af_submissions values($1),($2),($3)', [fresh, old, absent]);
    await sql.exec('set role service_role');
    await sql.query("insert into af_analytics_context(owner_id,client_id,session_id) values($1,'123.456','1729600000')", [owner]);
    assert.equal((await sql.query('select count(*)::int n from af_analytics_outbox')).rows[0].n, 0, 'context does not imply successful registration');
    await sql.query('insert into af_fighters values($1,$2)', [fresh, owner]);
    await sql.query('insert into af_fighters values($1,$2) on conflict do nothing', [fresh, owner]);
    assert.equal((await sql.query('select count(*)::int n from af_analytics_outbox')).rows[0].n, 1, 'one registration queues once');
    await sql.query("update af_analytics_context set updated_at=now()-interval '31 days' where owner_id=$1", [owner]);
    await sql.query('insert into af_fighters values($1,$2),($3,$4)', [old, owner, absent, missing]);
    assert.equal((await sql.query('select count(*)::int n from af_analytics_outbox')).rows[0].n, 1, 'expired or missing context cannot queue');
    await sql.exec('reset role');
    const job = (await sql.query("select * from cron.jobs where name='af-analytics-retention'")).rows[0];
    assert.equal(job.schedule, '17 * * * *');
    assert.match(job.command, /29 days/);
    await sql.exec(job.command);
    assert.equal((await sql.query('select count(*)::int n from af_analytics_context')).rows[0].n, 0);
    const permissions = (
      await sql.query(
        "select has_table_privilege('authenticated','af_analytics_context','select') as can_read,has_table_privilege('anon','af_analytics_outbox','insert') as can_forge",
      )
    ).rows[0];
    assert.deepEqual(permissions, { can_read: false, can_forge: false });
  } finally {
    await sql.close();
  }
});
