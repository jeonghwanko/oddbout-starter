import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { enforceSafeupdate, readNodeTree } from './helpers/fighter-database.mjs';

async function database() {
  const db = new PGlite();
  await db.exec(`create table t(id int primary key, singleton boolean not null default true, x int not null default 0);
    create table s(id int primary key); insert into t(id) values (1); insert into s values (1);
    create table audit(id int); create table touched(id int);
    create function bump() returns void language plpgsql as $$ begin update t set x = x + 1; end $$;
    create function bump_one() returns void language plpgsql as $$ begin update t set x = x + 1 where singleton; end $$;
    create function bump_all() returns void language plpgsql as $$ begin update t set x = x + 1 where true; end $$;
    create function purge() returns void language sql as $$ delete from audit $$;
    create function cte_purge() returns void language plpgsql as $$ begin with gone as (delete from audit returning id)
      update t set x = 0 where id in (select id from gone); end $$;
    create function joined() returns void language plpgsql as $$ begin update t set x = 5 from s; end $$;
    create function on_touch() returns trigger language plpgsql as $$ begin delete from audit; return new; end $$;
    create trigger touch after insert on touched for each row execute function on_touch();
    create function maybe(b boolean) returns void language plpgsql as $$ begin if b then update t set x = 100; end if; end $$;`);
  return enforceSafeupdate(db);
}

test('an UPDATE or DELETE with an empty WHERE in a function or trigger fails the call', async () => {
  // Each refusal fails every later call on its database, so each case gets its own.
  for (const [run, expected] of [
    [db => db.query('select bump()'), /UPDATE requires a WHERE clause \(safeupdate\)[\s\S]*PL\/pgSQL function bump\(\)/],
    [db => db.query('select purge()'), /DELETE requires a WHERE clause/],
    [db => db.query('select cte_purge()'), /DELETE requires a WHERE clause[\s\S]*with gone as/],
    [db => db.query('insert into touched values (1)'), /DELETE requires a WHERE clause[\s\S]*on_touch\(\)/],
    [db => db.query('select joined()'), /UPDATE requires a WHERE clause/],
    [db => db.exec(`do $$ begin update t set x = 6; end $$`), /UPDATE requires a WHERE clause/],
    [db => db.transaction(tx => tx.query('select bump()')), /UPDATE requires a WHERE clause[\s\S]*bump\(\)/],
  ])
    await assert.rejects(run(await database()), expected);
});

test('a refusal fails every later call, where a retry would otherwise pass on the cached plan', async () => {
  const db = await database();
  await assert.rejects(db.query('select bump()'), /UPDATE requires a WHERE clause/);
  await assert.rejects(db.query('select bump()'), /UPDATE requires a WHERE clause[\s\S]*bump\(\)/);
  await assert.rejects(db.query('select 1'), /UPDATE requires a WHERE clause/);
  await assert.rejects(
    db.transaction(tx => tx.query('select 1')),
    /UPDATE requires a WHERE clause/,
  );
});

test('a function that ran before enforcement, as during migrations, is still read', async () => {
  const db = new PGlite();
  await db.exec(`create table t(id int, x int default 0); insert into t values (1);
    create function bump() returns void language plpgsql as $$ begin update t set x = x + 1; end $$;`);
  await db.query('select bump()');
  await enforceSafeupdate(db);
  await assert.rejects(db.query('select bump()'), /UPDATE requires a WHERE clause/);
});

test('only the branches a call runs are read; the static migration rule covers the rest', async () => {
  const db = await database();
  await db.query('select maybe(false)');
  await assert.rejects(db.query('select maybe(true)'), /UPDATE requires a WHERE clause[\s\S]*maybe\(boolean\)/);
});

test("a test's own top-level SQL plays the operator and is not held to it, as in production", async () => {
  const db = await database();
  await db.exec('update t set x = 5');
  await db.query('delete from audit');
  assert.equal((await db.query('select x from t')).rows[0].x, 5);
});

test('any WHERE passes, as in safeupdate: a key, a boolean column, a join or a constant true', async () => {
  const db = await database();
  for (const sql of [
    'select bump_one()',
    'select bump_all()',
    'update t set x = 2 where id = $1',
    'update t set x = 3 from s where s.id = t.id',
    'delete from audit where id = 1',
    'select * from t',
    'insert into audit values (1)',
  ])
    await db.query(sql, sql.includes('$1') ? [1] : []);
  assert.equal((await db.query('select x from t')).rows[0].x, 3);
});

test('caller notice handlers still receive ordinary notices', async () => {
  const db = await database(),
    seen = [];
  await db.exec(`do $$ begin raise notice 'hello'; end $$`, { onNotice: notice => seen.push(notice.message) });
  assert.deepEqual(seen, ['hello']);
});

test('node text reads escapes, empty values and nested lists', () => {
  const tree = readNodeTree('{QUERY :commandType 2 :name a\\ b\\(c :cteList <> :jointree {FROMEXPR :fromlist ({RANGETBLREF :rtindex 1}) :quals <>}}');
  assert.equal(tree.name[0], 'a b(c');
  assert.equal(tree.cteList[0], '<>');
  assert.equal(tree.jointree[0].fromlist[0][0].rtindex[0], '1');
  assert.equal(tree.jointree[0].quals[0], '<>');
  assert.throws(() => readNodeTree('{QUERY :commandType 2'), /unterminated|malformed/);
});
