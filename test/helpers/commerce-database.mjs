import { readFile } from 'node:fs/promises';
import { supabasePlatform, enforceSafeupdate } from './fighter-database.mjs';
import { createCommerceStore } from '../../api/commerce/store.mjs';

// The Sandbox ledger lives outside supabase/migrations/ so production deploys and the drift watch never apply it.
export const COMMERCE_LEDGER_SQL = new URL('../../supabase/sandbox/20261102115107_commerce_broadcast_ledger.sql', import.meta.url);

/** Actual PostgreSQL function/transaction adapter; no accounting rules are mocked in JavaScript. */
export async function commerceDatabase() {
  const db = await supabasePlatform();
  await db.exec(await readFile(COMMERCE_LEDGER_SQL, 'utf8'));
  await enforceSafeupdate(db);
  const rpc = async (name, args) => {
    if (name !== 'commerce_command') throw new Error(`unexpected RPC ${name}`);
    try {
      const data = await db.transaction(async tx => {
        await tx.exec('set local role service_role');
        return (await tx.query('select public.commerce_command($1,$2,$3::jsonb) as value',
          [args.p_owner, args.p_command, JSON.stringify(args.p_input)])).rows[0].value;
      });
      return { data, error: null };
    } catch (error) { return { data: null, error }; }
  };
  return { db, rpc, store: createCommerceStore({ rpc }) };
}
