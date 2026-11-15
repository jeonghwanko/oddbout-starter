#!/usr/bin/env node
// @ts-check
// `npm run db:new -- <snake_case_name>` creates an empty supabase/migrations/<UTC YYYYMMDDHHMMSS>_<name>.sql and prints its path.
// Versions used to be picked by hand as round times (…100000, …120000), and production keeps one migration history with the arena
// relay's migrations: a round time was already taken there (#407, #445) or here (358546cc). The version is the current UTC second, moved
// past every migration in the folder and off a round …0000. This checkout cannot read versions used elsewhere (docs/CREATOR-HOSTING.md).
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MIGRATIONS = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const USAGE = 'npm run db:new -- <snake_case_name> [--dir <folder>]';
// A migration, as test/migration-rules.test.mjs counts them: a .sql file. A folder or a note with a version prefix is not one.
const VERSIONED = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_.*\.sql$/;

/** @param {Date} date @returns {string} its UTC second as YYYYMMDDHHMMSS */
export const versionOf = date => date.toISOString().replace(/\D/g, '').slice(0, 14);

/**
 * The version for a new migration: the clock's UTC second, or one second after the newest existing version if that is later,
 * and one second more if it would end in 0000. Names that are not `<version>_<name>.sql` are ignored.
 * @param {Date} now
 * @param {Iterable<string>} existing file names in the migrations folder
 */
export function nextVersion(now, existing) {
  let at = Math.floor(now.getTime() / 1000) * 1000;
  if (!Number.isFinite(at)) throw new Error('The clock gave no valid time');
  for (const name of existing) {
    const match = VERSIONED.exec(name);
    if (!match) continue;
    const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
    const time = Date.UTC(year, month - 1, day, hour, minute, second);
    if (versionOf(new Date(time)) !== name.slice(0, 14)) throw new Error(`${name}: its version is not a UTC time`);
    if (time >= at) at = time + 1000;
  }
  if (versionOf(new Date(at)).endsWith('0000')) at += 1000;
  return versionOf(new Date(at));
}

/**
 * Creates the empty migration file and returns its path. Never overwrites a file. Two runs at once can read the folder before either
 * writes and take the same version under different names: "every migration has its own version" (test/migration-rules.test.mjs) refuses that.
 * @param {string} name snake_case
 * @param {{ directory?: string, now?: Date }} [options]
 */
export async function createMigration(name, { directory = MIGRATIONS, now = new Date() } = {}) {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`The name must be snake_case ([a-z0-9_]+), not ${JSON.stringify(name)}`);
  const file = path.join(directory, `${nextVersion(now, await readdir(directory))}_${name}.sql`);
  await writeFile(file, '', { flag: 'wx' });
  return file;
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  const at = args.indexOf('--dir');
  const directory = at === -1 ? undefined : args.splice(at, 2)[1];
  if (args.length !== 1 || (at !== -1 && !directory)) {
    console.error(`Usage: ${USAGE}`);
    process.exit(2);
  }
  try {
    const file = await createMigration(args[0], directory ? { directory: path.resolve(directory) } : {});
    const relative = path.relative(process.cwd(), file);
    console.log(relative.startsWith('..') || path.isAbsolute(relative) ? file : relative);
    console.error('Start it with a comment that says what it changes and why, as the other migrations do.');
  } catch (/** @type {any} */ error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
