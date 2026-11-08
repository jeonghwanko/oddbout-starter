import { createHandler, sha256, VALIDATOR_VERSION } from '../../api/handler.mjs';
import example from '../../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { migratedDatabase } from './fighter-database.mjs';

export async function profileFixture() {
  const sql = await migratedDatabase(),
    owner = crypto.randomUUID(),
    signedPaths = [],
    uploads = [];
  await sql.query('insert into auth.users(id) values($1)', [owner]);
  const value = result => result.rows[0].value;
  const rpc = async (name, args) => {
    if (!/^af_[a-z_]+$/.test(name) || Object.keys(args).some(key => !/^p_[a-z_]+$/.test(key))) throw Error('invalid-test-rpc');
    try {
      return {
        data: value(
          await sql.query(
            `select to_jsonb(public.${name}(${Object.keys(args)
              .map((key, i) => `${key} => $${i + 1}`)
              .join(',')})) as value`,
            Object.values(args),
          ),
        ),
      };
    } catch (error) {
      return { error: { message: error.message } };
    }
  };
  const query = table => {
    if (!['af_submissions', 'af_fighters', 'af_roster_entries', 'af_fighter_notes', 'af_fighter_canon', 'af_worlds'].includes(table))
      throw Error('unsupported-test-table');
    const filters = [],
      values = [];
    let order = '',
      limit = '';
    const run = async () => {
      const { rows } = await sql.query(
        `select to_jsonb(t) as value from public.${table} t${filters.length ? ' where ' + filters.join(' and ') : ''}${order}${limit}`,
        values,
      );
      return rows.map(row => row.value);
    };
    const q = {
      select: () => q,
      eq: (key, val) => {
        if (!/^[a-z_]+$/.test(key)) throw Error('invalid-test-column');
        values.push(val);
        filters.push(`${key}=$${values.length}`);
        return q;
      },
      is: (key, val) => {
        if (!/^[a-z_]+$/.test(key) || val !== null) throw Error('invalid-test-column');
        filters.push(`${key} is null`);
        return q;
      },
      not: (key, operator, val) => {
        if (!/^[a-z_]+$/.test(key) || operator !== 'is' || val !== null) throw Error('invalid-test-column');
        filters.push(`${key} is not null`);
        return q;
      },
      order: (key, options) => {
        if (!/^[a-z_]+$/.test(key)) throw Error('invalid-test-column');
        order = ` order by ${key}${options?.ascending === false ? ' desc' : ' asc'}`;
        return q;
      },
      limit: n => {
        if (!Number.isInteger(n)) throw Error('invalid-test-limit');
        limit = ` limit ${n}`;
        return q;
      },
      maybeSingle: async () => ({ data: (await run())[0] ?? null }),
      then: (resolve, reject) =>
        run()
          .then(data => ({ data }))
          .then(resolve, reject),
    };
    return q;
  };
  const db = {
    rpc,
    from: query,
    auth: { getUser: async token => ({ data: { user: token === 'local-profile-test-token' ? { id: owner } : null } }) },
    storage: {
      from: () => ({
        upload: (...args) => {
          uploads.push(args);
          throw Error('unexpected-upload');
        },
        createSignedUrls: async paths => {
          signedPaths.push(...paths);
          return { data: paths.map(path => ({ path, signedUrl: `http://127.0.0.1:5197/storage/v1/object/sign/ai-fighter-beta/${path}?token=local` })) };
        },
      }),
    },
  };
  const handle = createHandler({ db });
  const bytes = example.assets.reduce((sum, a) => sum + a.bytes, 0);
  const create = async (text, fighter = null, key = crypto.randomUUID()) => {
    const result = await rpc('af_create_submission', {
      p_owner: owner,
      p_key: key,
      p_text: text,
      p_sha: await sha256(new TextEncoder().encode(text)),
      p_bytes: bytes,
      p_fighter: fighter,
    });
    if (result.error) throw Error(result.error.message);
    return result.data;
  };
  // `as`: another account's fighter (a test of two owners names its own user).
  const createFor = async (user, text) => {
    const result = await rpc('af_create_submission', {
      p_owner: user,
      p_key: crypto.randomUUID(),
      p_text: text,
      p_sha: await sha256(new TextEncoder().encode(text)),
      p_bytes: bytes,
      p_fighter: null,
    });
    if (result.error) throw Error(result.error.message);
    return result.data;
  };
  const register = async (text = JSON.stringify(example), fighter = null, as = owner) => {
    const row = as === owner ? await create(text, fighter) : await createFor(as, text);
    for (const a of example.assets)
      await sql.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${as}/${row.id}/${a.id}.webp`, { size: a.bytes }]);
    await sql.query('select public.af_submit($1,$2)', [as, row.id]);
    const claim = value(await sql.query('select to_jsonb(public.af_claim($1)) as value', [row.id]));
    return value(
      await sql.query('select to_jsonb(public.af_finish($1,$2,$3,true,$4)) as value', [
        row.id,
        claim.lease_token,
        row.manifest_sha,
        { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: [] },
      ]),
    );
  };
  const request = (fighter, hash, profile, key = crypto.randomUUID(), token = 'local-profile-test-token') =>
    handle(
      new Request(`http://localhost/ai-fighter/fighters/${fighter}/profile`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ expectedManifestSha256: hash, profile }),
      }),
    );
  return { sql, owner, rpc, db, handle, create, register, request, signedPaths, uploads, bytes };
}
