// @ts-check
// Test-operator setup before a prompt reaches the agent. No setup controls are exposed as MCP tools.
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stamp } from './seal.mjs';
import { createDummyPackage, createDummyProfileSet, readPackageFiles, readProfileSetFiles } from './sprites.mjs';
import { createDummyStore } from './store.mjs';

export const FIXTURE_NAMES = ['empty', 'registered', 'quota'];

/** @param {string} [fixture] */
export async function prepareDummyFixture(fixture = 'empty') {
  if (!FIXTURE_NAMES.includes(fixture)) throw new Error('unknown-dummy-fixture');
  const store = createDummyStore();
  const work = await mkdtemp(path.join(tmpdir(), 'oddbout-dummy-fixture-'));
  try {
    const made = await createDummyPackage(path.join(work, 'hosted'), {
      name: 'DUMMY Hosted Bot',
      localId: 'dummy-hosted-bot',
      prompt: 'teal geometric hosted placeholder',
    });
    const pack = await readPackageFiles(made.dir);
    const profile = await createDummyProfileSet(path.join(work, 'hosted-profile'));
    if (!profile.ok || !('folder' in profile)) throw new Error('dummy-fixture-profile-set');
    store.setPlaceholder(pack, await readProfileSetFiles(profile.folder));
    const count = fixture === 'quota' ? 3 : fixture === 'registered' ? 1 : 0;
    for (let index = 0; index < count; index++) {
      const data = JSON.parse(pack.text);
      data.localId = `dummy-fixture-${index + 1}`;
      data.profile.name = index === 0 ? 'DUMMY 야근왕 박과장' : `DUMMY 준비 선수 ${index + 1}`;
      data.profile.language = 'ko';
      const prepared = store.createSubmission({ text: JSON.stringify(data), idempotencyKey: randomUUID() }).body;
      if (!prepared.ok) throw new Error(`dummy-fixture-prepare:${prepared.code}`);
      for (const asset of prepared.missingAssets) {
        const bytes = pack.files.get(asset.id);
        if (!bytes) throw new Error('dummy-fixture-asset-missing');
        const uploaded = store.putAsset(prepared.submissionId, asset.id, bytes);
        if (!uploaded.body.ok) throw new Error(`dummy-fixture-upload:${uploaded.body.code}`);
      }
      store.submit(prepared.submissionId);
      const registered = store.getSubmission(prepared.submissionId).body;
      if (registered.stage !== 'registered') throw new Error('dummy-fixture-registration');
    }
    const initial = store.listFighters().body;
    const setup = stamp({
      phase: 'setup',
      fixture,
      account: initial.account,
      fighters: initial.fighters.map((/** @type {any} */ fighter) => ({
        id: fighter.id,
        name: fighter.name,
        manifestSha256: fighter.manifestSha256,
      })),
      note: 'Prepared before the user prompt. These registrations are fixture setup, not agent actions.',
    });
    return { store, setup };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
