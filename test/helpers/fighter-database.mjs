import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const migrationDir = new URL('../../supabase/migrations/', import.meta.url);
// Hosted pg_net/Vault dispatch runs only on hosted Supabase and is unavailable in PGlite.
export const migrationNames = async () => (await readdir(migrationDir)).filter(name => name.endsWith('.sql') && !name.includes('dispatch')).sort();
export const applyMigration = async (db, name) => db.exec(await readFile(new URL(name, migrationDir), 'utf8'));
// A stand-in for the hosted Supabase platform, shared so a migration that starts relying on another
// platform role or function is added here once instead of drifting in each test's own copy.
export async function supabasePlatform(db = new PGlite()) {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;
    create schema auth; create table auth.users(id uuid primary key,email text,encrypted_password text,banned_until timestamptz,deleted_at timestamptz);
    create table auth.oauth_clients(id uuid primary key, deleted_at timestamptz, client_name text, redirect_uris text);
    create table auth.sessions(id uuid primary key,user_id uuid,oauth_client_id uuid,not_after timestamptz,scopes text,refreshed_at timestamp);
    create table auth.oauth_consents(user_id uuid,client_id uuid,revoked_at timestamptz,scopes text);
    create function auth.uid() returns uuid language sql as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    grant usage on schema auth to authenticated,service_role;
    create function auth.jwt() returns jsonb language sql as 'select coalesce(nullif(current_setting(''request.jwt.claims'',true),''''),''{}'')::jsonb';
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
    grant usage on schema storage to service_role; grant select on storage.objects to service_role;
    create schema cron; create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';`);
  return db;
}
export async function migratedDatabase() {
  const db = await supabasePlatform();
  for (const name of await migrationNames()) await applyMigration(db, name);
  return enforceSafeupdate(db);
}

/** Postgres's node text (nodeToString) as nested objects: `{TYPE :field value…}` → { type, field: [values] }, `(…)` → array. */
export function readNodeTree(text) {
  let at = 0;
  const skip = () => {
    while (/\s/.test(text[at] ?? '')) at++;
  };
  const word = () => {
    let w = '';
    while (at < text.length && !/[\s{}()]/.test(text[at])) {
      if (text[at] === '\\') at++;
      w += text[at++] ?? '';
    }
    return w;
  };
  function item() {
    skip();
    if (text[at] === '(') {
      const list = [];
      for (at++, skip(); text[at] !== ')'; skip()) {
        if (at >= text.length) throw Error('unterminated node list');
        list.push(item());
      }
      at++;
      return list;
    }
    if (text[at] !== '{') return word();
    at++;
    skip();
    const node = { type: word() };
    let field = null;
    for (skip(); text[at] !== '}'; skip()) {
      if (at >= text.length || (text[at] !== ':' && !field)) throw Error('malformed node text');
      if (text[at] === ':') node[(field = word().slice(1))] = [];
      else node[field].push(item());
    }
    at++;
    return node;
  }
  return item();
}
/** safeupdate's rule: an UPDATE or DELETE, at the top or in a WITH, whose WHERE is empty (`where true` still counts as one). */
export function emptyWhere(query) {
  const ctes = Array.isArray(query.cteList?.[0]) ? query.cteList[0].map(cte => cte?.ctequery?.[0]) : [];
  return [query, ...ctes]
    .filter(q => q?.type === 'QUERY' && ['2', '4'].includes(q.commandType?.[0]) && q.jointree?.[0]?.quals?.[0] === '<>')
    .map(q => (q.commandType[0] === '2' ? 'UPDATE' : 'DELETE'));
}
/**
 * Production's API role preloads safeupdate (2026-10-27 heartbeat); PGlite cannot load the extension. Postgres prints the parse
 * tree of each statement it analyzes, and a statement run inside a function or trigger that safeupdate would refuse fails the
 * call here. The API reaches this database only through functions; a test's own top-level SQL plays the operator, as postgres,
 * whom production does not hold to safeupdate either.
 * Postgres analyzes a function's statement once, when that branch first runs, and caches it. `discard plans` makes the
 * functions migrations already ran be read again, and the first refusal fails every later call: unlike safeupdate the
 * statement has already run, and a retry would otherwise pass on the cached plan. Branches no test runs are left to
 * migration-rules.test.mjs.
 */
export async function enforceSafeupdate(db) {
  await db.exec('set debug_print_parse = on; set debug_pretty_print = off; set client_min_messages = log; discard plans');
  let refusal = null;
  const guard = target => {
    for (const [method, optionsAt] of [
      ['query', 2],
      ['exec', 1],
    ]) {
      const run = target[method].bind(target);
      target[method] = async (...args) => {
        if (refusal) throw new Error(refusal);
        const refused = [],
          options = args[optionsAt] ?? {};
        args[optionsAt] = {
          ...options,
          onNotice: notice => {
            if (notice.message !== 'parse tree:') return options.onNotice?.(notice);
            if (notice.where && notice.detail)
              for (const command of emptyWhere(readNodeTree(notice.detail)))
                refused.push(`${command} requires a WHERE clause (safeupdate)\n  ${notice.where.replaceAll('\n', '\n  ')}`);
          },
        };
        const result = await run(...args);
        if (refused.length) throw new Error((refusal = refused.join('\n')));
        return result;
      };
    }
    return target;
  };
  const transaction = db.transaction.bind(db);
  db.transaction = callback => transaction(tx => callback(guard(tx)));
  return guard(db);
}
