// @ts-check
// Agent-requested local fixtures only. Building files never creates a submission or changes a fighter.
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateFighter } from '../../contracts/ai-fighter/validate.mjs';
import { validateFighterPackage } from '../../server/ai-fighter-package.mjs';
import { stamp } from './seal.mjs';
import { createDummyPackage } from './sprites.mjs';

/**
 * The root is a private, pre-created temporary directory owned by the connector,
 * never an agent argument. A fresh reservation contains a fixed, nonexistent
 * child because createDummyPackage refuses existing destination directories.
 * @param {ReturnType<typeof import('./store.mjs').createDummyStore>} store
 * @param {string} root
 * @param {{ fighterId?: string, name?: string, description?: string, language?: 'ko' | 'en', style?: Record<string, unknown> | null, moves?: Record<string, { name: string, description: string }> }} input
 */
export async function buildDummyPackage(store, root, input = {}) {
  const revision = input.fighterId !== undefined;
  const operation = revision ? 'revision' : 'new';
  const base = { phase: 'agent', operation, submissionCreated: false, fighterChanged: false };
  let target;
  if (revision) {
    // A missing revision target must not become a new fighter, or even create files.
    const found = store.fighter(input.fighterId ?? '');
    if (!found.body.ok || !found.body.fighter) {
      return stamp({
        ...base,
        ok: false,
        code: 'fighter-not-found',
        fighterId: input.fighterId,
        next: 'Stop and ask which existing fighter to revise. No package or substitute fighter was created.',
      });
    }
    target = found.body.fighter;
  }
  if (
    (input.name !== undefined && typeof input.name !== 'string') ||
    (input.description !== undefined && typeof input.description !== 'string') ||
    (input.language !== undefined && input.language !== 'ko' && input.language !== 'en')
  ) {
    return stamp({ ...base, ok: false, code: 'invalid-package-input', next: 'Correct the package metadata before building a dummy package.' });
  }
  const requestedName = input.name?.trim() || target?.name || 'Flow Fighter';
  const name = (requestedName.startsWith('DUMMY ') ? requestedName : `DUMMY ${requestedName}`).slice(0, 40);
  const prompt = input.description?.trim() || `${operation === 'revision' ? 'Revision' : 'New package'} for ${name}. Geometric flow-test placeholder.`;
  const fighterId = target?.id;
  const context = { ...base, ...(fighterId ? { fighterId } : {}) };
  /** @type {string | undefined} */
  let dir;
  try {
    const reservation = await mkdtemp(path.join(root, 'package-'));
    const packageDir = path.join(reservation, 'fighter');
    dir = packageDir;
    const made = await createDummyPackage(packageDir, { name, localId: `dummy-${randomUUID()}`, prompt });
    made.data.profile.language = input.language ?? 'en';
    if (input.moves) made.data.profile.moves = { ...made.data.profile.moves, ...input.moves };
    const style = input.style === undefined ? target?.style : input.style;
    if (style !== undefined && style !== null) made.data.combat.style = style;
    else delete made.data.combat.style;
    // Keep failed attempts faithful to their requested metadata as well: the
    // original valid fixture must not remain as a silently usable substitute.
    const text = JSON.stringify(made.data, null, 2) + '\n';
    await writeFile(made.manifestPath, text);
    const checked = validateFighter(made.data);
    if (!checked.ok) {
      const invalidStyle = checked.errors.some(error => error.path.startsWith('/combat/style'));
      return stamp({
        ...context,
        ok: false,
        code: invalidStyle ? 'invalid-style' : 'invalid-package',
        dir,
        errors: checked.errors.slice(0, 10),
        next: 'Correct the requested metadata or style. This attempt was not prepared or submitted.',
      });
    }
    const validation = await validateFighterPackage(made.manifestPath);
    if (!validation.ok) {
      return stamp({
        ...context,
        ok: false,
        code: 'invalid-package',
        dir,
        errors: validation.errors?.slice(0, 10) ?? [],
        next: 'Inspect this dummy package validation failure. No submission or fighter was changed.',
      });
    }
    const manifestBytes = await readFile(made.manifestPath);
    return stamp({
      ...context,
      ok: true,
      dir,
      manifestPath: made.manifestPath,
      manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
      assets: made.data.assets.map((/** @type {{ id: string, path: string, bytes: number, sha256: string }} */ asset) => ({
        ...asset,
        filePath: path.join(packageDir, asset.path),
      })),
      validation: { ok: validation.ok, stage: validation.stage, pending: 'pending' in validation ? validation.pending : [] },
      next: `Files only; no submission was created. Call prepare_fighter_registration kind package with manifestPath${fighterId ? ' and this fighterId' : ''}, then upload each missingAssets entry and submit.`,
    });
  } catch {
    return stamp({
      ...context,
      ok: false,
      code: 'dummy-package-build-failed',
      ...(dir ? { dir } : {}),
      next: 'Inspect the existing dummy attempt before retrying. No submission or fighter was changed.',
    });
  }
}
