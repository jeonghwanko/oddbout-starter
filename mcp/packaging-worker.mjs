// @ts-check
import { packFighter } from '../scripts/pack-fighter.mjs';
try {
  const result = await packFighter(process.argv[2], JSON.parse(process.argv[3]));
  if (process.send) process.send(result);
} catch {
  if (process.send) process.send({ ok: false, stage: 'packaging', code: 'packaging-failed' });
} finally { process.disconnect(); }
