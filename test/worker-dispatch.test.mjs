import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('dispatch wakes only pending work, retries expired leases, and hides its credentials from clients', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create table public.af_submissions(status text, lease_until timestamptz);
      create schema vault;
      create table vault.decrypted_secrets(name text, decrypted_secret text);
      create schema net;
      create table net.calls(id bigserial, url text, headers jsonb, timeout_ms integer);
      create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer)
      returns bigint language sql as $$
        insert into net.calls(url,headers,timeout_ms) values(url,headers,timeout_milliseconds) returning id
      $$;
      create schema cron;
      create function cron.schedule(text,text,text) returns bigint language sql as $$ select 1::bigint $$;
      create schema extensions;
      -- pgcrypto is supplied by hosted Postgres; this stub tests dispatch wiring.
      create function extensions.hmac(text,text,text) returns bytea language sql as $$ select decode(repeat('b',64),'hex') $$;
      insert into vault.decrypted_secrets values
        ('ai_fighter_worker_url','https://example.onrender.com/wake'),
        ('ai_fighter_wake_token',repeat('a',64));
    `);
    const migration = await readFile(new URL('../supabase/migrations/20261021090001_ai_fighter_worker_dispatch.sql', import.meta.url), 'utf8');
    await db.exec(migration.replace(/^create extension .*;$/gm, ''));
    await db.exec(await readFile(new URL('../supabase/migrations/20261021092000_ai_fighter_signed_dispatch.sql', import.meta.url), 'utf8'));
    const count = async () => (await db.query('select count(*)::int as n from net.calls')).rows[0].n;
    await db.exec('select af_private.wake_worker()');
    assert.equal(await count(), 0, 'idle database sends no keep-alive');
    await db.exec("insert into public.af_submissions values('uploading',null); update public.af_submissions set status='queued'");
    assert.equal(await count(), 1, 'submit trigger wakes the worker');
    const dispatched = (await db.query('select headers from net.calls limit 1')).rows[0].headers;
    assert.equal(dispatched.Authorization, `Bearer ${'b'.repeat(64)}`);
    assert.match(dispatched['X-AI-Fighter-Time'], /^\d{10}$/);
    assert.ok(!JSON.stringify(dispatched).includes('a'.repeat(64)), 'durable key never enters the request queue');
    await db.exec("update public.af_submissions set status='validating',lease_until=now()+interval '5 minutes'; select af_private.wake_worker()");
    assert.equal(await count(), 1, 'active leases do not wake it');
    await db.exec("update public.af_submissions set lease_until=now()-interval '1 second'; select af_private.wake_worker()");
    assert.equal(await count(), 2, 'expired leases retry');
    await db.exec(
      "update vault.decrypted_secrets set decrypted_secret='https://untrusted.example/wake' where name='ai_fighter_worker_url'; select af_private.wake_worker()",
    );
    assert.equal(await count(), 2, 'invalid destination fails closed');
    const permissions = (
      await db.query(`select has_schema_privilege('authenticated','af_private','usage') as schema_access,
      has_function_privilege('anon','af_private.wake_worker()','execute') as execute_access`)
    ).rows[0];
    assert.deepEqual(permissions, { schema_access: false, execute_access: false });
  } finally {
    await db.close();
  }
});
