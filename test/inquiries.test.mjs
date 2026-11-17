import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHandler } from '../api/handler.mjs';
import { migratedDatabase } from './helpers/fighter-database.mjs';

test('website inquiries accept guest text once and only administrators can list it', async () => {
  const sql = await migratedDatabase();
  try {
    const admin = crypto.randomUUID(), visitor = crypto.randomUUID(), id = crypto.randomUUID();
    await sql.query('insert into auth.users(id) values ($1), ($2)', [admin, visitor]);
    await sql.query('insert into af_admins(owner_id) values ($1)', [admin]);
    for (const role of ['anon', 'authenticated']) {
      await sql.exec(`set role ${role}`);
      await assert.rejects(sql.query('select * from public.af_inquiries'), /permission denied/);
      await assert.rejects(sql.query("insert into public.af_inquiries(id,title,message) values (gen_random_uuid(),'a','b')"), /permission denied/);
      await sql.exec('reset role');
    }
    await sql.exec('set role service_role');
    const handle = createHandler({
      limiter: { enabled: true, allow: async request => !request.headers.has('fixture-limit') },
      db: {
        auth: { getUser: async token => ({ data: { user: token === admin || token === visitor ? { id: token } : null } }) },
        async rpc(name, args) {
          const statements = {
            af_rate_hit: ['select public.af_rate_hit($1,$2,$3,$4) as result', [args.p_bucket, args.p_key, args.p_limit, args.p_window_seconds]],
            af_admin_account: ['select public.af_admin_account($1) as result', [args.p_actor]],
          };
          assert.ok(statements[name], name);
          const [statement, values] = statements[name];
          return { data: (await sql.query(statement, values)).rows[0].result };
        },
        from(table) {
          assert.equal(table, 'af_inquiries');
          const query = {
            async upsert(row) {
              await sql.query('insert into public.af_inquiries(id,title,message) values ($1,$2,$3) on conflict(id) do nothing', [row.id, row.title, row.message]);
              return {};
            },
            select() { return query; },
            order() { return query; },
            async range(start, end) {
              return { data: (await sql.query('select id,title,message,created_at from public.af_inquiries order by created_at desc,id desc limit $1 offset $2', [end - start + 1, start])).rows };
            },
          };
          return query;
        },
      },
    });
    const call = (path, init) => handle(new Request(`https://test/ai-fighter/${path}`, init));
    const headers = token => ({ authorization: `Bearer ${token}` });
    const post = (body, headers) => call('inquiries', { method: 'POST', body: JSON.stringify(body), headers });
    const inquiry = { id, title: '   도움  ', message: '  첫 줄\n<script>둘째 줄</script>  ' };
    assert.equal((await call('inquiries', { method: 'OPTIONS' })).headers.get('access-control-allow-headers'), 'Content-Type');
    assert.equal((await call('inquiries')).status, 405);
    assert.equal((await post({ ...inquiry, message: '  ' })).status, 400);
    assert.equal((await post({ ...inquiry, message: 'a'.repeat(4001) })).status, 400);
    assert.equal((await post(inquiry, { 'fixture-limit': '1' })).status, 429);
    assert.equal((await post(inquiry)).status, 201);
    assert.equal((await post(inquiry)).status, 201);
    assert.equal((await call('admin/inquiries')).status, 401);
    assert.equal((await call('admin/inquiries', { headers: headers(visitor) })).status, 403);
    assert.equal((await call('admin/inquiries?page=-1', { headers: headers(admin) })).status, 400);
    const response = await call('admin/inquiries', { headers: headers(admin) });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { inquiries, hasMore } = await response.json();
    assert.deepEqual(inquiries.map(({ id, title, message }) => ({ id, title, message })),
      [{ id, title: '도움', message: '첫 줄\n<script>둘째 줄</script>' }]);
    assert.equal(hasMore, false);
  } finally {
    await sql.close();
  }
});
