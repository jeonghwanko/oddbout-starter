import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const directory = new URL('../supabase/migrations/', import.meta.url);
const migrations = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
// The PayPal Sandbox ledger (supabase/sandbox/) goes only to its own test project, never production, but its API role loads safeupdate too.
const sandbox = new URL('../supabase/sandbox/', import.meta.url);
const sandboxFiles = (await readdir(sandbox)).filter(name => name.endsWith('.sql')).sort();
// Applied before this rule (2026-10-27). They stay as written; production already ran them.
// 20261028180000 broke the rule and ran in production the same day; 20261028181000 restates its three functions whole.
const STRING_PATCHED = [
  '20261024022222_ai_fighter_profile_edits.sql',
  '20261024104406_ai_fighter_owner_deletion.sql',
  '20261028180000_oddbout_account_fighter_limit.sql',
];

test('a migration restates a changed function instead of string-patching its live definition', async () => {
  // replace() over pg_get_functiondef hides the resulting body: reading it needs every earlier migration replayed
  // (a review misread af_create_submission's budget this way). Write the whole `create or replace function`.
  const offenders = [];
  for (const name of migrations.filter(name => !STRING_PATCHED.includes(name)))
    if (/pg_get_functiondef/i.test(await readFile(new URL(name, directory), 'utf8'))) offenders.push(name);
  assert.deepEqual(offenders, []);
});

test('a function names the rows it updates or deletes (the API role preloads safeupdate)', async () => {
  // Production's authenticator role loads safeupdate: an UPDATE or DELETE without WHERE fails, but only when the API calls it — a
  // migration runs as postgres, so it never shows (the generation heartbeat, 2026-10-27). The test database replays safeupdate on
  // the function statements tests run (helpers/fighter-database.mjs); this check also covers branches and functions no test reaches.
  // Each function's last definition across the migrations is the live one.
  const latest = new Map();
  for (const [name, url] of [...migrations.map(name => [name, new URL(name, directory)]), ...sandboxFiles.map(name => [name, new URL(name, sandbox)])]) {
    const sql = (await readFile(url, 'utf8')).replace(/--[^\n]*/g, '');
    for (const match of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-z_."]+)\s*\([\s\S]*?\$\$([\s\S]*?)\$\$/gi))
      latest.set(match[1].replaceAll('"', ''), { name, body: match[2] });
  }
  const offenders = [];
  for (const [fn, { name, body }] of latest)
    for (const statement of body.match(/\b(?:update\s+(?:only\s+)?[a-z_."]+(?:\s+as\s+[a-z_]+)?\s+set|delete\s+from)\b[\s\S]*?(?:;|$)/gi) ?? [])
      if (!/\bwhere\b/i.test(statement)) offenders.push(`${fn} (${name}): ${statement.replace(/\s+/g, ' ').slice(0, 80)}`);
  assert.deepEqual(offenders, []);
});

test('every migration has its own version', () => {
  // `supabase db push` and `db reset` key the history on this version; 20261021090000 was once used twice.
  const versions = migrations.map(name => name.slice(0, 14));
  assert.deepEqual([...new Set(versions.filter((version, index) => versions.indexOf(version) !== index))], []);
  assert.ok(
    migrations.every(name => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)),
    'name: <14-digit version>_<snake_case>.sql',
  );
});

test('every table turns on row level security, and every function is closed to clients unless a grant names them', async () => {
  // PostgREST serves the public schema to anon and authenticated: a table without row level security, or a function left with
  // Postgres's default PUBLIC execute (and Supabase's default grants), is open to anyone holding the site's key. Secrets such as the host
  // pairing's (2026-11-05) are kept in tables only the API's service role reads. A function the site calls itself (the world reads) says
  // so with a grant to that role.
  const sql = (await Promise.all(migrations.map(name => readFile(new URL(name, directory), 'utf8')))).join('\n').replace(/--[^\n]*/g, '');
  const tables = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi)].map(match => match[1]);
  const open = tables.filter(
    table => !new RegExp(String.raw`alter\s+table\s+(?:if\s+exists\s+)?public\.${table}\s+enable\s+row\s+level\s+security`, 'i').test(sql),
  );
  assert.deepEqual(open, []);
  /** @type {(verb: string) => Map<string, Set<string>>} the roles each function is revoked from or granted to */
  const roles = verb => {
    const out = new Map();
    for (const [, names, who] of sql.matchAll(
      new RegExp(String.raw`${verb}\s+(?:all|execute)[^;]*?\bon\s+function\b([^;]*?)\b${verb === 'grant' ? 'to' : 'from'}\b([^;]*);`, 'gi'),
    ))
      for (const [, fn] of names.matchAll(/public\.([a-z0-9_]+)\s*\(/gi))
        for (const role of who.split(',').map(role => role.trim().toLowerCase())) out.set(fn, (out.get(fn) ?? new Set()).add(role));
    return out;
  };
  const revoked = roles('revoke'),
    granted = roles('grant');
  const functions = new Set([...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(/gi)].map(match => match[1]));
  const loose = [...functions].filter(
    fn => !revoked.get(fn)?.has('public') || ['anon', 'authenticated'].some(role => !revoked.get(fn)?.has(role) && !granted.get(fn)?.has(role)),
  );
  assert.deepEqual(loose, []);
});
