// @ts-check
import { validateFighterPackage } from '../server/ai-fighter-package.mjs';
import { annotatePackageValidation } from '../tools/ai-fighter/landmark-file.mjs';

// Spawned by the bounded local MCP worker. Results go only to the parent over IPC.
try {
  const manifest = process.argv[2];
  const verdict = await validateFighterPackage(manifest);
  /** @type {NonNullable<typeof process.send>} */ (process.send)(await annotatePackageValidation(verdict, manifest));
} catch {
  /** @type {NonNullable<typeof process.send>} */ (process.send)({ ok: false, stage: 'worker', errors: [{ code: 'VALIDATION_FAILED', path: '' }] });
} finally {
  process.disconnect();
}
