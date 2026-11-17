// @ts-check
import { createHash } from 'node:crypto';

/**
 * Copy without overwriting, and verify both byte streams before the database transaction may run.
 * @param {{source:string,target:string,objects:{bucket:string,name:string}[]}} plan
 * @param {{read:(bucket:string,name:string)=>Promise<Buffer|null>,copy:(bucket:string,source:string,target:string)=>Promise<void>}} storage
 */
export async function copyTransferAssets(plan, storage) {
  let copied = 0;
  for (const object of plan.objects) {
    if (typeof object.name !== 'string' || !object.name.startsWith(plan.source + '/') || typeof object.bucket !== 'string')
      throw Error('Invalid object in plan');
    const destination = plan.target + object.name.slice(plan.source.length);
    const original = await storage.read(object.bucket, object.name);
    if (!original) throw Error('Original asset is missing');
    let target = await storage.read(object.bucket, destination);
    if (!target) {
      await storage.copy(object.bucket, object.name, destination);
      copied++;
      target = await storage.read(object.bucket, destination);
    }
    if (!target || createHash('sha256').update(original).digest('hex') !== createHash('sha256').update(target).digest('hex'))
      throw Error('Asset bytes differ; refusing ownership transfer. Neither object was overwritten.');
  }
  return copied;
}
