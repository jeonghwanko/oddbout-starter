// @ts-check
import { validateFighterPackage } from '../server/ai-fighter-package.mjs';
// Spawned by the bounded local MCP worker. Results go only to the parent over IPC.
try {
  /** @type {NonNullable<typeof process.send>} */ (process.send)(await validateFighterPackage(process.argv[2]));
} catch {
  /** @type {NonNullable<typeof process.send>} */ (process.send)({ ok: false, stage: 'worker', errors: [{ code: 'VALIDATION_FAILED', path: '' }] });
} finally {
  process.disconnect();
}
