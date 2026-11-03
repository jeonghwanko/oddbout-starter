// @ts-check
import { readFile, stat, open, rename } from 'node:fs/promises';

/** Read a producer checkpoint written by saveJsonState; a missing file is null.
 * @param {string} path @returns {Promise<any>} */
export async function loadJsonState(path) {
  try {
    const info=await stat(path);if(!info.isFile()||info.size>2*1024*1024)throw new Error();
    return JSON.parse(await readFile(path,'utf8'));
  } catch(/** @type {any} */ error){if(error?.code==='ENOENT')return null;throw new Error('producer_invalid_state');}
}
/** Replace a checkpoint atomically, readable by its owner only.
 * @param {string} path @param {unknown} state */
export async function saveJsonState(path,state) {
  const temporary=`${path}.${process.pid}.tmp`;
  const file=await open(temporary,'wx',0o600);
  try{await file.writeFile(JSON.stringify(state));await file.sync();}finally{await file.close();}
  await rename(temporary,path);
}
