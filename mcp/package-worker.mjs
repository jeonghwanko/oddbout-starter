// @ts-check
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { parseFighterJson } from '../contracts/ai-fighter/validate.mjs';
import { validateFighterPackage } from '../server/ai-fighter-package.mjs';
import { annotateValidation } from '../tools/ai-fighter/landmark-lint.mjs';

/** Read warning inputs inside the same worker and limits as package validation. @param {string} manifest */
async function warningData(manifest) {
  if (!(await lstat(manifest)).isFile()) return null;
  const handle = await open(manifest, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > spec.limits.jsonBytes) return null;
    const bytes = Buffer.alloc(spec.limits.jsonBytes + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await handle.read(bytes, size, bytes.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > spec.limits.jsonBytes) return null;
    const parsed = parseFighterJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
    return parsed.ok ? parsed.data : null;
  } finally {
    await handle.close();
  }
}

// Spawned by the bounded local MCP worker. Results go only to the parent over IPC.
try {
  const manifest = process.argv[2];
  const verdict = await validateFighterPackage(manifest);
  // A failed validation needs no warning input; preserve its original error even if a later read fails.
  const data = verdict.ok ? await warningData(manifest).catch(() => null) : null;
  /** @type {NonNullable<typeof process.send>} */ (process.send)(annotateValidation(verdict, data));
} catch {
  /** @type {NonNullable<typeof process.send>} */ (process.send)({ ok: false, stage: 'worker', errors: [{ code: 'VALIDATION_FAILED', path: '' }] });
} finally {
  process.disconnect();
}
