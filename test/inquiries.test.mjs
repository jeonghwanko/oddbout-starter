import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHandler } from '../api/handler.mjs';
import { migratedDatabase } from './helpers/fighter-database.mjs';

test('website inquiries accept guest text once and only administrators can list it', async () => {
  const sql = await migratedDatabase();
  try {
    const admin = crypto.randomUUID(),
      visitor = crypto.randomUUID(),
      id = crypto.randomUUID();
    await sql.query('insert into auth.users(id) values ($1), ($2)', [admin, visitor]);
    await sql.query('insert into af_admins(owner_id) values ($1)', [admin]);
    for (const role of ['anon', 'authenticated']) {
      await sql.exec(`set role ${role}`);
      await assert.rejects(sql.query('select * from public.af_inquiries'), /permission denied/);
      await assert.rejects(sql.query("insert into public.af_inquiries(id,title,message) values (gen_random_uuid(),'a','b')"), /permission denied/);
      await assert.rejects(sql.query("update public.af_inquiries set status='done' where id=gen_random_uuid()"), /permission denied/);
      await assert.rejects(sql.query('delete from public.af_inquiries where id=gen_random_uuid()'), /permission denied/);
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
          let update, deleting = false, counting = false, searchPattern = null;
          const filters = {};
          const query = {
            async upsert(row) {
              await sql.query('insert into public.af_inquiries(id,title,message) values ($1,$2,$3) on conflict(id) do nothing', [
                row.id,
                row.title,
                row.message,
              ]);
              return {};
            },
            select(_columns, options) {
              counting = options?.head === true;
              return query;
            },
            update(row) { update = row; return query; },
            delete() { deleting = true; return query; },
            eq(key, value) { filters[key] = value; return query; },
            or(filter) {
              const terms = /^title\.imatch\.("(?:\\.|[^"\\])*"),message\.imatch\.("(?:\\.|[^"\\])*")$/s.exec(filter);
              assert.ok(terms, 'search must remain two quoted literal filters');
              assert.equal(terms[1], terms[2]);
              searchPattern = JSON.parse(terms[1]);
              return query;
            },
            async maybeSingle() {
              return { data: (await sql.query('update public.af_inquiries set status=$1 where id=$2 and status=$3 returning id',
                [update.status, filters.id, filters.status])).rows[0] ?? null };
            },
            async then(resolve, reject) {
              try {
                if (counting) {
                  const result = await sql.query('select count(*)::int as count from public.af_inquiries where status=$1', [filters.status]);
                  resolve({ count: result.rows[0].count });
                } else {
                  assert.equal(deleting, true);
                  await sql.query('delete from public.af_inquiries where id=$1', [filters.id]);
                  resolve({});
                }
              } catch (error) { reject(error); }
            },
            order() {
              return query;
            },
            async range(start, end) {
              return {
                data: (
                  await sql.query('select id,title,message,created_at,status from public.af_inquiries where ($3::text is null or status=$3) and ($4::text is null or title ~* $4 or message ~* $4) order by created_at desc,id desc limit $1 offset $2', [
                    end - start + 1,
                    start,
                    filters.status ?? null,
                    searchPattern,
                  ])
                ).rows,
              };
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
    assert.deepEqual(
      inquiries.map(({ id, title, message }) => ({ id, title, message })),
      [{ id, title: '도움', message: '첫 줄\n<script>둘째 줄</script>' }],
    );
    assert.equal(hasMore, false);
    assert.equal(inquiries[0].status, 'unread');
    assert.equal((await call('admin/inquiries/count')).status, 401);
    assert.equal((await call('admin/inquiries/count', { headers: headers(visitor) })).status, 403);
    const unread = async () => (await (await call('admin/inquiries/count', { headers: headers(admin) })).json()).unreadCount;
    assert.equal(await unread(), 1);
    assert.equal((await call('admin/inquiries?status=invalid', { headers: headers(admin) })).status, 400);
    const filtered = async (status, page = 0, q = '') => (await (await call(`admin/inquiries?${new URLSearchParams({ status, page: String(page), q })}`, { headers: headers(admin) })).json());
    assert.equal((await filtered('all', 0, '도움')).inquiries[0].id, id);
    assert.equal((await filtered('unread', 0, '둘째 줄')).inquiries[0].id, id);
    assert.equal((await filtered('read', 0, '둘째 줄')).inquiries.length, 0);
    assert.equal((await filtered('all', 0, 'missing text')).inquiries.length, 0);
    assert.equal((await filtered('all', 0, '   ')).inquiries.length, 1);
    assert.equal((await call(`admin/inquiries?q=${'a'.repeat(121)}`, { headers: headers(admin) })).status, 400);
    assert.equal((await call('admin/inquiries?q=%00', { headers: headers(admin) })).status, 400);
    assert.equal((await filtered('unread')).inquiries.length, 1);
    assert.equal((await filtered('read')).inquiries.length, 0);
    assert.equal((await filtered('done')).inquiries.length, 0);
    const setStatus = (token, status, previous) => call(`admin/inquiries/${id}/status`, {
      method: 'POST', headers: headers(token), body: JSON.stringify({ status, previous }),
    });
    assert.equal((await setStatus(visitor, 'done', 'unread')).status, 403);
    assert.equal((await setStatus(admin, 'unknown', 'unread')).status, 400);
    assert.equal((await setStatus(admin, 'read', 'unread')).status, 200);
    assert.equal(await unread(), 0);
    assert.equal((await filtered('unread')).inquiries.length, 0);
    assert.equal((await filtered('read')).inquiries[0].id, id);
    assert.equal((await filtered('read', 0, '도움')).inquiries[0].id, id);
    assert.equal((await filtered('unread', 0, '도움')).inquiries.length, 0);
    assert.equal((await setStatus(admin, 'done', 'unread')).status, 409);
    assert.equal((await setStatus(admin, 'done', 'read')).status, 200);
    assert.equal((await filtered('done')).inquiries[0].id, id);
    assert.equal((await setStatus(admin, 'unread', 'done')).status, 200);
    // Count the whole inbox, including rows beyond the first page.
    for (let index = 0; index < 21; index++) await sql.query("insert into public.af_inquiries(id,title,message) values (gen_random_uuid(),'fixture','body')");
    assert.equal(await unread(), 22);
    assert.equal((await filtered('unread')).hasMore, true);
    assert.equal((await filtered('unread', 1)).inquiries.length, 2);
    assert.equal((await filtered('unread', 0, 'FIXTURE')).hasMore, true);
    assert.equal((await filtered('unread', 1, 'body')).inquiries.length, 1);
    await sql.query("delete from public.af_inquiries where title='fixture'");
    const punctuationId = crypto.randomUUID(), punctuation = 'Case [a-z].*(x),"%_\\ marker';
    await sql.query('insert into public.af_inquiries(id,title,message,status) values ($1,$2,$3,$4)', [punctuationId, punctuation, 'literal search fixture', 'done']);
    for (const term of ['case', '[a-z]', '.*', '(x),"', '%_', '\\']) {
      assert.deepEqual((await filtered('done', 0, term)).inquiries.map(row => row.id), [punctuationId]);
    }
    assert.equal((await filtered('unread', 0, '%_')).inquiries.length, 0);
    assert.equal((await filtered('all', 0, 'missing"),status.eq.unread')).inquiries.length, 0);
    await sql.query('delete from public.af_inquiries where id=$1', [punctuationId]);
    const remove = token => call(`admin/inquiries/${id}/delete`, { method: 'POST', headers: headers(token) });
    assert.equal((await remove(visitor)).status, 403);
    assert.equal((await remove(admin)).status, 200);
    assert.equal(await unread(), 0);
    assert.equal((await remove(admin)).status, 200);
    assert.deepEqual((await (await call('admin/inquiries', { headers: headers(admin) })).json()).inquiries, []);
  } finally {
    await sql.close();
  }
});
