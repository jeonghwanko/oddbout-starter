import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileFixture } from './helpers/profile-api-fixture.mjs';

test("a fighter's maker is the named OAuth client of his earliest recorded submission; only the owner's, only a live client", async () => {
  const f = await profileFixture();
  try {
    const first = await f.register(),
      id = first.fighter_id,
      chat = crypto.randomUUID(),
      other = crypto.randomUUID(),
      gone = crypto.randomUUID();
    await f.sql.query('insert into auth.oauth_clients(id,client_name,deleted_at) values($1,$2,null),($3,$4,null),($5,$6,now())', [
      chat,
      `  ${'ChatGPT'.padEnd(50, '!')}`,
      other,
      'Other agent',
      gone,
      'Gone agent',
    ]);
    const record = (owner, submission, client) => f.sql.query('select public.af_record_submission_agent($1,$2,$3)', [owner, submission, client]);
    const maker = async () => (await f.sql.query('select client_name from public.af_fighter_agents where fighter_id=$1', [id])).rows[0]?.client_name;
    await record(crypto.randomUUID(), first.id, chat);
    await record(f.owner, first.id, gone);
    assert.equal(await maker(), undefined);
    await record(f.owner, first.id, chat);
    await record(f.owner, first.id, other);
    assert.equal(await maker(), 'ChatGPT'.padEnd(40, '!'));
    // A later edit by another agent keeps the maker.
    const edit = await (await f.request(id, first.manifest_sha, { name: 'Edited by another' })).json();
    await record(f.owner, edit.submissionId, other);
    assert.equal(await maker(), 'ChatGPT'.padEnd(40, '!'));
    for (const role of ['anon', 'authenticated']) {
      await f.sql.exec(`set role ${role}`);
      await assert.rejects(f.sql.query('select * from public.af_fighter_agents'), /permission denied/);
      await assert.rejects(record(f.owner, first.id, chat), /permission denied/);
      await f.sql.exec('reset role');
    }
  } finally {
    await f.sql.close();
  }
});
