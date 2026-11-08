import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/handler.mjs';
const rows = Array.from({ length: 25 }, (_, i) => ({
  id: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'),
  created_at: new Date(Date.UTC(2026, 9, i + 1)).toISOString(),
  manifest_sha: 'a'.repeat(64),
  runtime_manifest_sha: 'a'.repeat(64),
  runtime_approved: true,
  runtime_scope: 'arena-player-v1',
  review_state: 'approved',
  listed: true,
  profile: { name: 'Fighter ' + i },
  entered_at: '2026-10-30T00:00:00Z',
}));
function handler(source) {
  return createHandler({
    db: {
      from() {
        let data = [...source],
          order = [];
        const q = {
          select: () => q,
          eq: (key, value) => {
            data = data.filter(row => row[key] === value);
            return q;
          },
          not: (key, operator, value) => {
            assert.deepEqual([operator, value], ['is', null]);
            data = data.filter(row => row[key] != null);
            return q;
          },
          order: (key, { ascending = true } = {}) => {
            order.push([key, ascending]);
            return q;
          },
          or: filter => {
            const match = /^created_at\.lt\.(.+),and\(created_at\.eq\.\1,id\.gt\.([a-f0-9-]+)\)$/.exec(filter);
            assert.ok(match, 'cursor must use the ordered timestamp/ID pair');
            const [, time, id] = match;
            data = data.filter(row => row.created_at < time || (row.created_at === time && row.id > id));
            return q;
          },
          limit: n => {
            data.sort((a, b) => {
              for (const [key, asc] of order) {
                const cmp = a[key].localeCompare(b[key]);
                if (cmp) return asc ? cmp : -cmp;
              }
              return 0;
            });
            data = data.slice(0, n);
            return q;
          },
          then: done => Promise.resolve({ data }).then(done),
        };
        return q;
      },
    },
  });
}
const request = cursor => new Request('https://test/ai-fighter/roster' + (cursor === undefined ? '' : '?after=' + encodeURIComponent(cursor)));
test('public roster returns newest first, paginates beyond 20, and omits private fields', async () => {
  const handle = handler(rows),
    first = await (await handle(request())).json();
  const second = await (await handle(request(first.nextCursor))).json();
  assert.equal(first.hasMore, true);
  assert.equal(first.fighters.length, 20);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, null);
  assert.equal(second.fighters.length, 5);
  assert.equal(first.fighters[0].name, 'Fighter 24');
  assert.equal(new Set([...first.fighters, ...second.fighters].map(row => row.id)).size, 25);
  assert.deepEqual(Object.keys(first.fighters[0]).sort(), ['duelApproved', 'entered', 'id', 'manifestSha256', 'name', 'runtimeScope'].sort());
});
test('new registrations and removals between requests do not skip unseen fighters', async () => {
  const source = [...rows],
    handle = handler(source),
    first = await (await handle(request())).json();
  source.pop();
  source.push({ ...rows[24], id: '11111111-1111-4111-8111-111111111111', created_at: '2026-11-01T00:00:00.000Z' });
  source.splice(
    source.findIndex(row => row.id === rows[5].id),
    1,
  );
  const second = await (await handle(request(first.nextCursor))).json();
  assert.deepEqual(
    second.fighters.map(row => row.id),
    rows
      .slice(0, 5)
      .reverse()
      .map(row => row.id),
  );
});
test('equal timestamps use ID as a stable tie breaker', async () => {
  const source = rows.map(row => ({ ...row, created_at: rows[0].created_at })),
    handle = handler(source);
  const first = await (await handle(request())).json(),
    second = await (await handle(request(first.nextCursor))).json();
  assert.deepEqual(
    [...first.fighters, ...second.fighters].map(row => row.id),
    source.map(row => row.id),
  );
});
test('invalid cursors cannot inject PostgREST filters', async () => {
  const handle = handler(rows);
  for (const cursor of [
    '',
    'garbage',
    rows[0].created_at + '|' + rows[0].id + ',review_state.eq.removed',
    '2026-99-99T00:00:00Z|' + rows[0].id,
    rows[0].created_at + '|' + rows[0].id + '|extra',
  ]) {
    assert.equal((await handle(request(cursor))).status, 400);
  }
});
test('removed, pending, unlisted, in-production and hash-mismatched packages are excluded without losing the next page', async () => {
  const source = rows.map((row, i) => (i >= 5 ? { ...row, runtime_manifest_sha: 'b'.repeat(64) } : row));
  source.push(
    { ...rows[0], review_state: 'removed' },
    { ...rows[1], runtime_approved: false },
    { ...rows[2], listed: false },
    { ...rows[3], entered_at: null },
  );
  const handle = handler(source),
    first = await (await handle(request())).json();
  assert.equal(first.fighters.length, 0);
  assert.equal(first.hasMore, true);
  const second = await (await handle(request(first.nextCursor))).json();
  assert.deepEqual(
    second.fighters.map(row => row.id),
    rows
      .slice(0, 5)
      .reverse()
      .map(row => row.id),
  );
});
