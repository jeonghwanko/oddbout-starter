// Opt-in real PostgreSQL: set ODDBOUT_TEST_PG_BIN to its bin directory, then node --test this file.
// Starts an isolated temporary cluster on loopback. Never connects to a configured/project database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { supabasePlatform, migrationNames, applyMigration } from '../helpers/fighter-database.mjs';

const bin = process.env.ODDBOUT_TEST_PG_BIN;
function command(name, args, options = {}) {
  const child = spawn(path.join(bin, name + (process.platform === 'win32' ? '.exe' : '')), args, { windowsHide: true, stdio: 'pipe', ...options });
  let out = '',
    err = '';
  child.stdout.on('data', b => {
    out += b;
  });
  child.stderr.on('data', b => {
    err += b;
  });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve({ code, out, err }));
  });
  child.stdin.on('error', () => {});
  return { child, done };
}
async function success(task) {
  const result = await task.done;
  assert.equal(result.code, 0, result.err.slice(-6000));
  return result.out.trim();
}

test('automatic registration and operator recovery use the same lock order as owner cancellation', { skip: !bin, timeout: 90_000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'oddbout-lock-')),
    data = path.join(root, 'data');
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const sql = (text, hold = false) => {
    const task = command(
      'psql',
      ['-X', '-qAt', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
      {
        env: { ...process.env, PGCONNECT_TIMEOUT: '3', PGSSLMODE: 'disable', PGOPTIONS: '-c statement_timeout=15000 -c deadlock_timeout=100 -c lc_messages=C' },
      },
    );
    if (hold) task.child.stdin.write(text);
    else task.child.stdin.end(text);
    return task;
  };
  const waitFor = async (query, waiting) => {
    let ended;
    waiting?.done.then(result => {
      ended = result;
    });
    for (let i = 0; i < 80; i++) {
      if (ended) assert.fail('query ended before its expected lock wait: ' + ended.err);
      if ((await success(sql(query))) === 't') return;
      await delay(50);
    }
    throw Error('test synchronization timed out');
  };
  let server;
  try {
    await success(command('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8']));
    server = command('postgres', ['-D', data, '-h', '127.0.0.1', '-p', String(port)]);
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if ((await command('pg_isready', ['-h', '127.0.0.1', '-p', String(port)]).done).code === 0) {
        ready = true;
        break;
      }
      await delay(50);
    }
    assert.ok(ready, 'isolated PostgreSQL starts');
    // Verify the endpoint belongs to this cluster before any schema write, even if the port was taken in between.
    assert.equal(path.resolve(await success(sql('show data_directory;'))), path.resolve(data));
    const statements = [],
      collect = {
        exec: async text => {
          statements.push(text);
        },
      };
    await supabasePlatform(collect);
    for (const name of await migrationNames()) await applyMigration(collect, name);
    await success(sql(statements.join('\n')));
    // Pause the real function after its job update, before registration admission. No production function is replaced.
    await success(
      sql(`create function public.test_pause_motion_ready() returns trigger language plpgsql as $$
      begin if new.status='motion_ready' then perform pg_advisory_xact_lock(826114); end if; return new; end $$;
      create trigger test_pause_motion_ready after update on public.af_generation_jobs
        for each row execute function public.test_pause_motion_ready();`),
    );
    for (const mode of ['finish', 'retry'])
      await t.test(mode, async () => {
        const owner = crypto.randomUUID(),
          job = crypto.randomUUID(),
          lease = crypto.randomUUID();
        await success(
          sql(`insert into auth.users(id) values('${owner}'); insert into public.af_creators(owner_id) values('${owner}');
        insert into public.af_admins(owner_id) values('${owner}');
        insert into public.af_generation_jobs(id,owner_id,idempotency_key,description,language,status,brief,choice,lease_token)
        values('${job}','${owner}','${job}','Test boxer','en','${mode === 'finish' ? 'motions' : 'needs_review'}',
          '{"profile":{"name":"Fixture","description":"Test boxer"}}','a','${lease}');
        insert into public.af_generation_events(job_id,kind,data) values('${job}','finished','{"registrationBlocked":true}');`),
        );
        const gate = sql("set application_name='test-gate'; begin; select pg_advisory_xact_lock(826114);\n", true);
        try {
          await waitFor(
            "select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='test-gate' and l.locktype='advisory' and l.granted);",
          );
          const action =
            mode === 'finish'
              ? `select to_jsonb(public.af_generation_finish('${job}','${lease}','ok','{"preview":[{"clip":"idle","name":"motion-idle-0"}]}'))->>'status';`
              : `select public.af_admin_generation_retry('${owner}','${job}')->>'status';`;
          const registration = sql("set application_name='test-register'; " + action);
          await waitFor("select exists(select 1 from pg_stat_activity where application_name='test-register' and wait_event='advisory');", registration);
          const cancel = sql(`set application_name='test-cancel'; select public.af_generation_cancel('${owner}','${job}');`);
          await waitFor("select exists(select 1 from pg_stat_activity where application_name='test-cancel' and wait_event_type='Lock');", cancel);
          gate.child.stdin.end('commit;\n');
          await success(gate);
          const [a, b] = await Promise.all([registration.done, cancel.done]);
          assert.doesNotMatch(a.err + b.err, /deadlock detected/, `${mode}: ${a.err} ${b.err}`);
          assert.equal(a.code, 0, a.err);
          assert.equal(a.out.trim(), 'submitting');
          assert.match(b.err, /generation-state/); // Registration won the race; cancellation reports that state.
        } finally {
          if (!gate.child.stdin.writableEnded) gate.child.stdin.end('rollback;\n');
          await gate.done;
        }
      });
    await success(
      sql(`update public.af_generation_settings set enabled=true where singleton;
      update public.af_generation_hosts set worker_seen_at=now(),worker_health='{"ok":true,"codex":true,"grok":true}' where official;`),
    );
    for (const order of ['create-first', 'retry-first', 'two-retries'])
      await t.test(order, async () => {
        const owner = crypto.randomUUID(),
          old = crypto.randomUUID(),
          other = crypto.randomUUID(),
          key = crypto.randomUUID();
        await success(
          sql(`insert into auth.users(id) values('${owner}'); insert into public.af_creators(owner_id) values('${owner}');
        insert into public.af_admins(owner_id) values('${owner}');
        insert into public.af_generation_jobs(id,owner_id,idempotency_key,description,language,status,brief,choice,error_code)
          values('${old}','${owner}','${old}','Old boxer','en','needs_review','{}','a','side-provider-refused'),
            ('${other}','${owner}','${other}','Other boxer','en','needs_review','{}','b','side-provider-refused');`),
        );
        const create = `select (public.af_generation_create('${owner}','${key}','New adult boxer','en','{}',false)).id;`;
        const retry = id => `select public.af_admin_generation_retry('${owner}','${id}');`;
        const firstAction = order === 'create-first' ? create : retry(old);
        const secondAction = order === 'create-first' ? retry(old) : order === 'retry-first' ? create : retry(other);
        const first = sql(`set application_name='test-capacity-first'; begin; ${firstAction}\n`, true);
        try {
          await waitFor("select exists(select 1 from pg_stat_activity where application_name='test-capacity-first' and state='idle in transaction');", first);
          const second = sql(`set application_name='test-capacity-second'; ${secondAction}`);
          await waitFor("select exists(select 1 from pg_stat_activity where application_name='test-capacity-second' and wait_event_type='Lock');", second);
          first.child.stdin.end('commit;\n');
          await success(first);
          const result = await second.done;
          assert.notEqual(result.code, 0);
          assert.match(result.err, order === 'retry-first' ? /generation-quota/ : /review-conflict/);
          assert.doesNotMatch(result.err, /deadlock detected/);
          assert.equal(
            await success(
              sql(`select count(*) from public.af_generation_jobs where owner_id='${owner}'
          and status not in ('submitted','rejected','failed','cancelled','expired','needs_review');`),
            ),
            '1',
          );
          assert.equal(await success(sql(`select choice from public.af_generation_jobs where id='${other}';`)), 'b');
        } finally {
          if (!first.child.stdin.writableEnded) first.child.stdin.end('rollback;\n');
          await first.done;
        }
      });
  } finally {
    if (server) {
      await success(command('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']));
      await server.done;
    }
    // Check the resolved deletion target before removing this test's own cluster.
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.match(path.basename(root), /^oddbout-lock-/);
    await rm(root, { recursive: true, force: true });
  }
});
