// @ts-check
// Deterministic placeholder art. It is a labelled geometric fixture, not a model generation.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { buildProfileSet } from '../../scripts/profile-set.mjs';
import { createExample } from '../../scripts/create-example.mjs';
import { DUMMY_MODE, DUMMY_SEAL, DUMMY_SIDECAR } from './seal.mjs';

const FRONT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="960">
  <rect x="190" y="70" width="100" height="110" rx="30" fill="#32b8ac"/>
  <rect x="175" y="190" width="130" height="280" rx="20" fill="#186f74"/>
  <rect x="200" y="480" width="28" height="360" fill="#32b8ac"/>
  <rect x="252" y="480" width="28" height="360" fill="#32b8ac"/>
</svg>`;

const SHEET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024">
  ${[
    [256, 256],
    [768, 256],
    [1280, 256],
    [256, 768],
    [768, 768],
    [1280, 768],
  ]
    .map(([x, y], index) => `<circle cx="${x}" cy="${y}" r="160" fill="${index === 5 ? '#8d3b3b' : '#32b8ac'}"/>`)
    .join('')}
</svg>`;

/** @param {string} prompt */
function description(prompt) {
  const head = `${DUMMY_SEAL}. Not for production. Deterministic placeholder sprites, not a generated fighter. `;
  return head + prompt.slice(0, 600 - head.length);
}

/**
 * @param {string} dir  Must not exist yet.
 * @param {{ variant?: string, name: string, localId: string, prompt: string }} options
 */
export async function createDummyPackage(dir, { variant = 'sparring', name, localId, prompt }) {
  if (!name.startsWith('DUMMY ') || name.length > 40) throw new Error('dummy-name');
  if (!localId.startsWith('dummy-')) throw new Error('dummy-local-id');
  await createExample(dir, variant);
  const manifestPath = path.join(dir, 'fighter.json');
  const data = JSON.parse(await readFile(manifestPath, 'utf8'));
  data.localId = localId;
  data.profile.name = name;
  data.profile.language = 'en';
  data.profile.description = description(prompt);
  data.profile.concept = `DUMMY placeholder for a flow test. ${prompt}`.slice(0, 800);
  const text = JSON.stringify(data, null, 2) + '\n';
  await writeFile(manifestPath, text);
  await writeFile(
    path.join(dir, DUMMY_SIDECAR),
    JSON.stringify(
      { seal: DUMMY_SEAL, mode: DUMMY_MODE, notForProduction: true, note: 'Refused by fighter:register unless --dummy is a loopback ODDBOUT-DUMMY server.' },
      null,
      2,
    ) + '\n',
  );
  return { dir, manifestPath, text, data };
}

/** @param {string} dir */
export async function readPackageFiles(dir) {
  const text = await readFile(path.join(dir, 'fighter.json'), 'utf8');
  const data = JSON.parse(text);
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  for (const asset of data.assets) files.set(asset.id, await readFile(path.join(dir, asset.path)));
  return { text, data, files };
}

/** A front and expression sheet that go through the real profile-set builder. @param {string} dir */
export async function createDummyProfileSet(dir) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'front.png'), await sharp(Buffer.from(FRONT_SVG)).png().toBuffer());
  await writeFile(path.join(dir, 'expressions.png'), await sharp(Buffer.from(SHEET_SVG)).png().toBuffer());
  return buildProfileSet({ front: path.join(dir, 'front.png'), expressions: path.join(dir, 'expressions.png'), out: path.join(dir, 'set') });
}

/** Read the measured profile manifest and its actual encoded files. @param {string} dir */
export async function readProfileSetFiles(dir) {
  const text = await readFile(path.join(dir, 'profile-set.json'), 'utf8');
  const data = JSON.parse(text);
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  for (const id of ['front', 'expressions']) {
    if (data[id]) files.set(id, await readFile(path.join(dir, data[id].path)));
  }
  return { text, data, files };
}
