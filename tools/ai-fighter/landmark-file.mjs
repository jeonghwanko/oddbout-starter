// @ts-check
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import spec from '../../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { parseFighterJson } from '../../contracts/ai-fighter/validate.mjs';
import { annotateValidation } from './landmark-lint.mjs';

/** Read warning inputs inside the same worker and limits as package validation. @param {string} manifest */
export async function readWarningData(manifest) {
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

/** Optional warnings never reread rejected packages or change the required verdict.
 * @param {any} verdict @param {string} manifest
 */
export async function annotatePackageValidation(verdict, manifest) {
  const data = verdict?.ok ? await readWarningData(manifest).catch(() => null) : null;
  return annotateValidation(verdict, data);
}
