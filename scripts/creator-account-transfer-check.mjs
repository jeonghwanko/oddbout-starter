// @ts-check
import { isDeepStrictEqual } from 'node:util';

/** @param {any} expected @param {{snapshot: any, fingerprint: string}} current */
export function checkedTransferQuery(expected, current) {
  if (!isDeepStrictEqual(expected, current.snapshot)) throw Error('Plan is stale. Generate and review a new plan.');
  if (!/^[a-f0-9]{64}$/.test(current.fingerprint)) throw Error('Invalid snapshot fingerprint');
  for (const id of [expected.source, expected.target]) {
    if (typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) throw Error('Invalid account UUID');
  }
  // apply_creator_transfer locks and rechecks this exact snapshot before writing.
  // A concurrent change produces no result, or the existing stale-plan exception.
  return `with current_plan as materialized (select af_private.creator_transfer_snapshot('${expected.source}','${expected.target}') as snapshot)
    select af_private.apply_creator_transfer(snapshot) as result from current_plan
    where encode(sha256(convert_to(snapshot::text,'UTF8')),'hex')='${current.fingerprint}'`;
}
