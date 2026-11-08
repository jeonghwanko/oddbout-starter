import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, sha256 } from '../api/handler.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };

test('only scoped, reviewed immutable packages are delivered to the browser; no owner or worker fields leak', async () => {
  const text = JSON.stringify(example),
    sha = await sha256(new TextEncoder().encode(text));
  const approved = {
    id: crypto.randomUUID(),
    submission_id: crypto.randomUUID(),
    manifest_sha: sha,
    runtime_manifest_sha: sha,
    runtime_approved: true,
    runtime_scope: 'arena-player-v1',
    review_state: 'approved',
    listed: true,
    profile: example.profile,
    entered_at: '2026-10-30T00:00:00Z',
  };
  const pending = { ...approved, id: crypto.randomUUID(), runtime_approved: false };
  const changed = { ...approved, id: crypto.randomUUID(), runtime_manifest_sha: 'f'.repeat(64) };
  // An unlisted fighter is out of the list but still served at his own address.
  const unlisted = { ...approved, id: crypto.randomUUID(), listed: false };
  // One in production (출전 전, 2026-10-30) likewise: his owner's previews and practice read his address; nobody else finds him.
  const inProduction = { ...approved, id: crypto.randomUUID(), entered_at: null };
  const row = { id: approved.submission_id, owner_id: crypto.randomUUID(), status: 'registered', manifest_sha: sha, manifest_text: text, manifest: example };
  let signCalls = 0;
  const reads = [];
  const query = source => {
    let selected = source;
    const q = {
      select: () => q,
      order: () => q,
      limit: n => {
        selected = selected.slice(0, n);
        return q;
      },
      in: (key, values) => {
        selected = selected.filter(row => values.includes(row[key]));
        return q;
      },
      eq: (key, value) => {
        selected = selected.filter(row => row[key] === value);
        return q;
      },
      not: (key, operator, value) => {
        assert.deepEqual([operator, value], ['is', null]);
        selected = selected.filter(row => row[key] != null);
        return q;
      },
      maybeSingle: async () => ({ data: selected[0] ?? null }),
      then: done => Promise.resolve({ data: selected }).then(done),
    };
    return q;
  };
  // af_roster_entries is af_fighters with each fighter's maker joined (made_with), read in one query.
  const handle = createHandler({
    db: {
      from: table =>
        (reads.push(table), query)(
          table === 'af_roster_entries' ? [{ ...approved, made_with: 'ChatGPT' }, pending, changed, { ...unlisted, made_with: null }, inProduction] : [row],
        ),
      storage: {
        from: () => ({
          createSignedUrls: async keys => {
            signCalls++;
            return {
              data: keys.map(key => ({
                path: key,
                error: null,
                signedUrl: `https://example.supabase.co/storage/v1/object/sign/ai-fighter-beta/${key}?token=temporary`,
              })),
            };
          },
        }),
      },
    },
  });
  const get = id => handle(new Request(`https://test/ai-fighter/roster${id ? '/' + id : ''}`));
  const list = await get();
  assert.equal(list.headers.get('access-control-allow-origin'), '*');
  const entries = (await list.json()).fighters;
  // One query per page: the maker comes joined (af_roster_entries), not from a second read (2026-10-29).
  assert.deepEqual(reads.splice(0), ['af_roster_entries']);
  assert.deepEqual(
    entries.map(f => f.id),
    [approved.id],
  );
  assert.equal('submission_id' in entries[0], false);
  assert.equal(entries[0].madeWith, 'ChatGPT'); // The agent that made him (af_fighter_agents).
  assert.equal((await get(pending.id)).status, 404);
  assert.equal((await get(changed.id)).status, 404);
  reads.splice(0);
  const pkg = await (await get(approved.id)).json();
  assert.deepEqual(reads.splice(0), ['af_roster_entries', 'af_submissions']); // The fighter with his maker, then his package.
  assert.equal(pkg.manifestText, text);
  assert.equal(pkg.runtimeApproved, true);
  assert.equal(pkg.files.length, example.assets.length);
  assert.equal(pkg.madeWith, 'ChatGPT');
  assert.equal(signCalls, 1); // One Storage round trip signs every asset.
  assert.equal((await (await get(unlisted.id)).json()).manifestText, text);
  const own = await (await get(inProduction.id)).json();
  assert.equal(own.manifestText, text);
  assert.equal(own.entered, false);
  // He may not meet other people: his duels are refused (af_duel_admitted), so the API says so too.
  inProduction.duel_approved = true;
  inProduction.duel_manifest_sha = sha;
  assert.equal((await (await get(inProduction.id)).json()).duelApproved, false);
  assert.equal(pkg.entered, true);
  assert.equal(entries[0].entered, true);
  assert.deepEqual(
    pkg.files.map(f => f.id),
    example.assets.map(a => a.id),
  );
  assert.equal('owner_id' in pkg, false);
  assert.equal('lease_token' in pkg, false);
  assert.equal(pkg.duelApproved, false);
  approved.duel_approved = true;
  approved.duel_manifest_sha = 'f'.repeat(64);
  assert.equal((await (await get(approved.id)).json()).duelApproved, false);
  approved.duel_manifest_sha = sha;
  assert.equal((await (await get(approved.id)).json()).duelApproved, true);
  assert.equal((await (await get()).json()).fighters[0].duelApproved, true);
  approved.duel_approved = false;
  assert.equal((await (await get(approved.id)).json()).duelApproved, false);
});
