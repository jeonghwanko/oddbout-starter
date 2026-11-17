import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMigration, nextVersion } from '../scripts/new-migration.mjs';

const script = fileURLToPath(new URL('../scripts/new-migration.mjs', import.meta.url));
/** @param {string} iso */
const at = iso => new Date(iso);

test('a new version is the clock’s UTC second', () => {
  assert.equal(nextVersion(at('2026-11-15T03:04:05.678Z'), ['20261114010000_bout_videos.sql']), '20261115030405');
  assert.equal(nextVersion(at('2026-11-15T12:34:56.999+09:00'), []), '20261115033456');
});

test('a new version sorts after every existing migration, even one ahead of the clock', () => {
  assert.equal(nextVersion(at('2026-11-15T03:04:05Z'), ['20261115030405_same_second.sql']), '20261115030406');
  // The clock's milliseconds do not put it past a migration of the same second.
  assert.equal(nextVersion(at('2026-11-15T03:04:05.678Z'), ['20261115030405_same_second.sql']), '20261115030406');
  assert.equal(nextVersion(at('2026-11-15T03:04:05Z'), ['20261115030405_a.sql', '20261116010101_ahead.sql', '20261101000000_old.sql']), '20261116010102');
  // One second past 23:59:59 is a round …0000, so one more.
  assert.equal(nextVersion(at('2026-11-15T03:04:05Z'), ['20261231235959_new_year.sql']), '20270101000001');
  // Only `<version>_<name>.sql` is a migration: not a file without a version, nor a folder, note or backup that has one.
  assert.equal(
    nextVersion(at('2026-11-15T03:04:05Z'), [
      '.DS_Store',
      'README.md',
      '2026_notes.sql',
      '20991231235959_folder',
      '20991231235959_notes.md',
      '20991231235959_x.sql~',
    ]),
    '20261115030405',
  );
});

test('a new version never ends in 0000', () => {
  assert.equal(nextVersion(at('2026-11-15T12:00:00.000Z'), []), '20261115120001');
  assert.equal(nextVersion(at('2026-11-15T12:00:00.999Z'), []), '20261115120001');
  assert.equal(nextVersion(at('2026-11-15T11:59:59Z'), ['20261115115959_x.sql']), '20261115120001');
});

test('an existing version that is not a UTC time, or a clock with no time, is refused', () => {
  assert.throws(() => nextVersion(at('2026-11-15T03:04:05Z'), ['20261115036000_minute_sixty.sql']), /not a UTC time/);
  assert.throws(() => nextVersion(new Date(Number.NaN), []), /no valid time/);
});

test('createMigration writes an empty file after the others, and a second run in the same second takes the next version', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'oddbout-migrations-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, '20261114010000_bout_videos.sql'), 'select 1;\n');
  const now = at('2026-11-15T03:04:05Z');
  const first = await createMigration('hosted_lock', { directory, now });
  assert.equal(first, path.join(directory, '20261115030405_hosted_lock.sql'));
  assert.equal(await readFile(first, 'utf8'), '');
  // The same second again goes one second later instead of reusing (or overwriting) the version.
  const second = await createMigration('hosted_lock', { directory, now });
  assert.equal(path.basename(second), '20261115030406_hosted_lock.sql');
  assert.equal(await readFile(path.join(directory, '20261114010000_bout_videos.sql'), 'utf8'), 'select 1;\n');
  for (const name of ['', 'Hosted_Lock', 'hosted-lock', 'hosted lock', '../escape', 'x.sql'])
    await assert.rejects(createMigration(name, { directory, now }), /snake_case/, JSON.stringify(name));
  assert.deepEqual((await readdir(directory)).sort(), ['20261114010000_bout_videos.sql', '20261115030405_hosted_lock.sql', '20261115030406_hosted_lock.sql']);
});

test('npm run db:new prints the new path and refuses a bad name or missing argument', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'oddbout-migrations-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const printed = execFileSync(process.execPath, [script, '--', 'a_new_table', '--dir', directory], { encoding: 'utf8', stdio: 'pipe' }).trim();
  assert.match(path.basename(printed), /^\d{14}_a_new_table\.sql$/);
  assert.doesNotMatch(path.basename(printed), /^\d{10}0000_/);
  assert.deepEqual(await readdir(directory), [path.basename(printed)]);
  const bad = spawnSync(process.execPath, [script, 'A-Table', '--dir', directory], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /snake_case/);
  const usage = spawnSync(process.execPath, [script, '--dir', directory], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /npm run db:new -- <snake_case_name>/);
  assert.equal((await readdir(directory)).length, 1);
});
