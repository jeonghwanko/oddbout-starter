// @ts-check
// One profile-set check in its own process (worker/profile-sets.mjs forks it). argv: the job directory holding front.webp, set.json and,
// when the set names one, expressions.webp. It writes card.webp, face.webp (and sheet.webp) there on a pass and sends the verdict to its parent.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkExpressionSheet, checkProfileSet } from './profile-set-check.mjs';

const directory = process.argv[2];
try {
  const set = JSON.parse(await readFile(path.join(directory, 'set.json'), 'utf8'));
  const result = await checkProfileSet(await readFile(path.join(directory, 'front.webp')), set);
  const sheet = set.expressions ? await checkExpressionSheet(await readFile(path.join(directory, 'expressions.webp'))) : null;
  if (result.ok && (!sheet || sheet.ok)) {
    await writeFile(path.join(directory, 'card.webp'), result.card, { flag: 'wx', mode: 0o600 });
    await writeFile(path.join(directory, 'face.webp'), result.face, { flag: 'wx', mode: 0o600 });
    if (sheet?.ok) await writeFile(path.join(directory, 'sheet.webp'), sheet.sheet, { flag: 'wx', mode: 0o600 });
    process.send?.({ ok: true, errors: [], derived: { ...result.derived, ...(sheet?.ok ? { sheet: sheet.derived } : {}) } });
  } else process.send?.({ ok: false, errors: [...result.errors, ...(sheet?.errors ?? [])] });
} catch {
  // Reading its own job files failed, or the check threw: still this painting's verdict (worker/profile-sets.mjs records it).
  process.send?.({ ok: false, errors: [{ code: 'CHECK_FAILED', path: '' }] });
}
