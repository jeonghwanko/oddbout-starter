// @ts-check
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { buildCloudPluginSite } from './build-cloud-plugin-site.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
/** @param {string} output */
export async function buildCloudConnect(output) {
  /** @type {(source: string, target: string) => Promise<void>} */
  const copyText = async (source, target) => writeFile(target, (await readFile(source, 'utf8')).replaceAll('\r\n', '\n'));
  await mkdir(join(output, 'cloud-connect'), { recursive: true });
  let html = (await readFile(join(root, 'web/cloud-connect/connect.html'), 'utf8')).replaceAll('\r\n', '\n');
  for (const name of ['connect.css', 'connect.mjs']) {
    const text = (await readFile(join(root, 'web/cloud-connect', name), 'utf8')).replaceAll('\r\n', '\n');
    await writeFile(join(output, 'cloud-connect', name), text);
    const revision = createHash('sha256').update(text).digest('hex').slice(0, 12);
    html = html.replaceAll(`/cloud-connect/${name}`, `/cloud-connect/${name}?v=${revision}`);
  }
  await writeFile(join(output, 'connect.html'), html);
  await copyText(join(root, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'), join(output, 'cloud-connect/supabase.js'));
  await buildCloudPluginSite(output);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/build-cloud-connect.mjs <site-directory>');
  await buildCloudConnect(resolve(process.argv[2]));
}
