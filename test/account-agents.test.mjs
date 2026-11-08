import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase } from './helpers/fighter-database.mjs';

// 내 에이전트 (2026-10-28): the site keeps a creator's agent cards with his own session (supabase-js on `af_account_agents`). He reads,
// adds and removes his own cards only; one card per agent; the agents are the page's (Gemini kept for later).
test('a creator reads, adds and removes only his own agent cards, one per agent', async () => {
  const db = await migratedDatabase(),
    owner = crypto.randomUUID(),
    other = crypto.randomUUID();
  const as = async user => db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${user}';`);
  try {
    await db.query('insert into auth.users(id) values($1),($2)', [owner, other]);
    await as(owner);
    await db.query("insert into public.af_account_agents(owner_id, agent) values($1, 'codex'), ($1, 'claude')", [owner]);
    await assert.rejects(db.query("insert into public.af_account_agents(owner_id, agent) values($1, 'codex')", [owner]), /duplicate key/);
    await assert.rejects(db.query("insert into public.af_account_agents(owner_id, agent) values($1, 'dots')", [owner]), /check constraint/);
    await assert.rejects(db.query("insert into public.af_account_agents(owner_id, agent) values($1, 'grok')", [other]), /row-level security/);
    await assert.rejects(db.query("insert into public.af_account_agents(owner_id, agent, created_at) values($1, 'grok', now())", [owner]), /permission denied/);
    await assert.rejects(db.query("update public.af_account_agents set agent = 'grok' where owner_id = $1", [owner]), /permission denied/);
    assert.deepEqual(
      (await db.query('select agent from public.af_account_agents order by agent')).rows.map(r => r.agent),
      ['claude', 'codex'],
    );
    await as(other);
    assert.equal((await db.query('select agent from public.af_account_agents')).rows.length, 0);
    assert.equal((await db.query('delete from public.af_account_agents where owner_id = $1', [owner])).affectedRows, 0);
    await as(owner);
    assert.equal((await db.query("delete from public.af_account_agents where owner_id = $1 and agent = 'claude'", [owner])).affectedRows, 1);
    assert.deepEqual(
      (await db.query('select agent from public.af_account_agents')).rows.map(r => r.agent),
      ['codex'],
    );
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select agent from public.af_account_agents'), /permission denied/);
    // His account gone, his cards go with it.
    await db.exec('reset role');
    await db.query('delete from auth.users where id = $1', [owner]);
    assert.equal((await db.query('select count(*)::int as n from public.af_account_agents')).rows[0].n, 0);
  } finally {
    await db.close();
  }
});
