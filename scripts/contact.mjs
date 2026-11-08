// @ts-check
import { spawn } from 'node:child_process';
import path from 'node:path';
import { kitRoot, spritePython } from './sprite-gen.mjs';

const child = spawn(spritePython, [path.join(kitRoot, 'tools/ai-fighter/contact_evidence.py'), ...process.argv.slice(2)], {
  cwd: process.env.INIT_CWD || process.cwd(),
  stdio: 'inherit',
  windowsHide: true,
  timeout: 10 * 60_000,
  env: { ...process.env, PYTHONUTF8: '1' },
});
child.on('error', error => {
  console.error(/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT' ? 'Run npm run sprite:setup first.' : error.message);
  process.exitCode = 1;
});
child.on('close', (code, signal) => {
  if (signal) console.error(`contact evidence stopped after 10 minutes (${signal}).`);
  process.exitCode = code ?? 1;
});
