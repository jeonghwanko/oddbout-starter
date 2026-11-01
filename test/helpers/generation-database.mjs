// The hosted generation's database for tests, shared by the API test and the cloud MCP test.
import { createHandler, sha256 } from '../../api/handler.mjs';
import { migratedDatabase } from './fighter-database.mjs';

// Minimal headers the probe reads (the API never decodes a picture).
export const png = (w, h) => { const b = new Uint8Array(64); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]); b.set(new TextEncoder().encode('IHDR'), 12);
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b; };
export const webp = (w, h) => { const b = new Uint8Array(64); b.set(new TextEncoder().encode('RIFF'), 0); b.set(new TextEncoder().encode('WEBPVP8X'), 8);
  b.set([(w - 1) & 255, (w - 1) >> 8 & 255, (w - 1) >> 16, (h - 1) & 255, (h - 1) >> 8 & 255, (h - 1) >> 16], 24); return b; };

// One database, a creator with a token, another creator, the generation worker's key and a validation worker's key; Storage in memory.
// `failing`: functions whose calls fail, as on a database the API is ahead of (2026-10-31, 보유 토큰).
export async function generation({ decisionsReviewer = null, responsesReviewer = null, cascadeReviewer = null, failing = [], unanswered = [] } = {}) {
  const sql = await migratedDatabase(), owner = crypto.randomUUID(), other = crypto.randomUUID();
  for (const user of [owner, other]) {
    await sql.query('insert into auth.users(id) values($1)', [user]);
    await sql.query('insert into public.af_creators(owner_id) values($1) on conflict do nothing', [user]);
  }
  const workerToken = `afw_${'a'.repeat(64)}`, validatorToken = `afw_${'b'.repeat(64)}`;
  await sql.query("insert into public.af_workers(token_hash,label,scope) values($1,'gen','generation'),($2,'val','validation')",
    [await sha256(new TextEncoder().encode(workerToken)), await sha256(new TextEncoder().encode(validatorToken))]);
  const rpc = async (name, args) => {
    // As PostgREST answers: a refusal carries the database's code; `unanswered` runs the function and then loses the answer, as
    // supabase-js reports a failed fetch (no code).
    if (failing.includes(name)) return { error: { message: `function public.${name} does not exist`, code: '42883' } };
    try {
      const data = (await sql.query(`select to_jsonb(public.${name}(${Object.keys(args).map((key, i) => `${key} => $${i + 1}`).join(',')})) as value`, Object.values(args))).rows[0].value;
      return unanswered.includes(name) ? { error: { message: 'TypeError: fetch failed', code: '' } } : { data };
    } catch (error) { return { error: { message: error.message, code: error.code ?? 'P0001' } }; }
  };
  const from = table => {
    const filters = [], values = []; let order = '', limit = '', gt = [];
    /** @type {Record<string, unknown> | null} An update's columns (2026-10-31: the API writes a job's profile front and set). */
    let patch = null;
    const where = () => filters.length ? ' where ' + filters.join(' and ') : '';
    const run = async () => {
      if (!patch) return (await sql.query(`select to_jsonb(t) as value from public.${table} t${where()}${order}${limit}`, values)).rows.map(r => r.value);
      const keys = Object.keys(patch);
      await sql.query(`update public.${table} set ${keys.map((key, i) => `${key}=$${values.length + i + 1}`).join(',')}${where()}`, [...values, ...keys.map(key => patch[key])]);
      return [];
    };
    const q = { select: () => q, update: value => { patch = value; return q; }, eq: (key, val) => { values.push(val); filters.push(`${key}=$${values.length}`); return q; },
      gt: (key, val) => { values.push(val); filters.push(`${key}>$${values.length}`); return q; },
      in: (key, vals) => { values.push(vals); filters.push(`${key}=any($${values.length})`); return q; },
      order: (key, o) => { order = ` order by ${key}${o?.ascending === false ? ' desc' : ''}`; return q; }, limit: n => { limit = ` limit ${n}`; return q; },
      maybeSingle: async () => ({ data: (await run())[0] ?? null }), then: (ok, no) => run().then(data => ({ data })).then(ok, no) };
    return q;
  };
  const objects = new Map();
  const storage = { from: bucket => ({
    upload: async (path, bytes, options) => { const key = `${bucket}/${path}`; if (objects.has(key) && !options?.upsert) return { error: { message: 'exists' } };
      objects.set(key, { bytes, type: options?.contentType });
      // A profile set's front, as Storage records it (af_profile_set_submit checks the object's size there).
      if (path.includes('/profile-sets/')) await sql.query('insert into storage.objects values($1,$2,$3) on conflict do nothing', [bucket, path, { size: bytes.length }]);
      return { data: { path } }; },
    remove: async paths => { for (const p of paths) objects.delete(`${bucket}/${p}`); return {}; },
    download: async path => objects.has(`${bucket}/${path}`) ? { data: new Blob([objects.get(`${bucket}/${path}`).bytes]) } : { error: { message: 'missing' } },
    createSignedUrls: async paths => ({ data: paths.map(path => ({ path, signedUrl: `https://storage.test/${bucket}/${path}?token=t` })) }) }) };
  const users = { 'owner-token-0123456789': owner, 'other-token-0123456789': other };
  const db = { rpc, from, storage, auth: { getUser: async token => ({ data: { user: users[token] ? { id: users[token] } : null } }) } };
  const handle = createHandler({ db, decisionsReviewer, responsesReviewer, cascadeReviewer });
  const call = async (method, path, body, token = 'owner-token-0123456789', headers = {}) => {
    const raw = body instanceof Uint8Array || typeof body === 'string';
    const response = await handle(new Request(`http://localhost/ai-fighter/${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': raw ? (headers['content-type'] ?? 'application/octet-stream') : 'application/json', ...headers },
      ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }) }));
    return { status: response.status, body: await response.json() };
  };
  const work = (method, path, body, headers = {}) => call(method, `generation-worker/${path}`, body, workerToken, headers);
  const healthy = async () => { await sql.query('update public.af_generation_settings set enabled = true');
    return work('POST', 'heartbeat', { health: { ok: true, codex: true, grok: true } }); };
  return { sql, db, owner, other, call, work, healthy, objects, validatorToken };
}
