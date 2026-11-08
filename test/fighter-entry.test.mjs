import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileFixture } from './helpers/profile-api-fixture.mjs';
import { ENTRY_CLIPS, entryRequest } from '../api/fighter-entry.mjs';

test('an entry names the watched package and every required motion once', () => {
  const sha = 'a'.repeat(64);
  assert.deepEqual(entryRequest({ expectedManifestSha256: sha, reviewedClips: [...ENTRY_CLIPS].reverse() }), { sha, clips: [...ENTRY_CLIPS] });
  assert.equal(ENTRY_CLIPS.length, 11);
  for (const body of [
    null,
    [],
    {},
    { expectedManifestSha256: sha },
    { expectedManifestSha256: 'x', reviewedClips: ENTRY_CLIPS },
    { expectedManifestSha256: sha, reviewedClips: ENTRY_CLIPS.slice(1) },
    { expectedManifestSha256: sha, reviewedClips: [...ENTRY_CLIPS.slice(1), 'idle', 'idle'] },
    { expectedManifestSha256: sha, reviewedClips: [...ENTRY_CLIPS.slice(1), 'skill'] },
    { expectedManifestSha256: sha, reviewedClips: ENTRY_CLIPS, extra: 1 },
  ])
    assert.throws(() => entryRequest(body), /invalid-entry/);
});

test('his owner enters a fighter in production and withdraws him; the roster lists him only while entered (출전, 2026-10-30)', async () => {
  const f = await profileFixture();
  try {
    const first = await f.register(),
      id = first.fighter_id;
    const call = (method, body, token = 'local-profile-test-token') =>
      f.handle(
        new Request(`http://localhost/ai-fighter/fighters/${id}/entry`, {
          method,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
    const listed = async () => (await (await f.handle(new Request('http://localhost/ai-fighter/roster'))).json()).fighters.some(row => row.id === id);
    const own = async () => await (await f.handle(new Request(`http://localhost/ai-fighter/roster/${id}`))).json();
    assert.equal(await listed(), false);
    assert.equal((await own()).entered, false); // His owner's previews and practice still read him.
    const preflight = await call('OPTIONS');
    assert.equal(preflight.status, 200);
    assert.match(preflight.headers.get('access-control-allow-methods'), /DELETE/);
    assert.equal((await call('POST', { expectedManifestSha256: first.manifest_sha, reviewedClips: ENTRY_CLIPS }, 'someone-else')).status, 401);
    const partial = await call('POST', { expectedManifestSha256: first.manifest_sha, reviewedClips: ENTRY_CLIPS.slice(2) });
    assert.equal(partial.status, 422);
    assert.equal((await partial.json()).code, 'invalid-entry');
    const stale = await call('POST', { expectedManifestSha256: 'f'.repeat(64), reviewedClips: ENTRY_CLIPS });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, 'fighter-changed');
    const entered = await call('POST', { expectedManifestSha256: first.manifest_sha, reviewedClips: ENTRY_CLIPS });
    assert.equal(entered.status, 200);
    const answer = await entered.json();
    assert.equal(answer.stage, 'entered');
    assert.equal(answer.fighterId, id);
    assert.equal(await listed(), true);
    assert.equal((await own()).entered, true);
    const detail = await (
      await f.handle(new Request(`http://localhost/ai-fighter/fighters/${id}`, { headers: { authorization: 'Bearer local-profile-test-token' } }))
    ).json();
    assert.ok(detail.fighter.entered_at);
    const withdrawn = await call('DELETE');
    assert.equal(withdrawn.status, 200);
    assert.equal((await withdrawn.json()).stage, 'in-production');
    assert.equal(await listed(), false);
  } finally {
    await f.sql.close();
  }
});
