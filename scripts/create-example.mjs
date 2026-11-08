// @ts-check
// Original geometric test art. This fixture tests the format, not animation quality.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };

/**
 * @typedef {{ id: string, path: string, mediaType: string, sha256: string, bytes: number, width: number, height: number }} Asset
 * @typedef {{ frame: number, durationMs: number }} Step
 * @typedef {{ assetId: string, frameWidth: number, frameHeight: number, columns: number, rows: number, frames: number[],
 *   origins: { originX: number, originY: number, groundContacts: { x: number, y: number, rx: number, ry: number }[] }[], loop: boolean,
 *   durationMs?: number, stridePixels?: number, sequence?: Step[], hitSequenceIndices?: number[], landmarks?: Record<string, unknown> }} Clip
 */

/** @param {string} destination @param {string} [variant] */
export async function createExample(destination, variant = 'sparring') {
  if (!['sparring', 'challenger'].includes(variant)) throw new Error('Unknown fixture variant');
  const challenger = variant === 'challenger';
  await mkdir(destination, { recursive: false }); // Never overwrite somebody's fighter.
  await mkdir(path.join(destination, 'assets'));
  const fighter = {
    schemaVersion: 1,
    specVersion: spec.specVersion,
    localId: challenger ? 'challenger-bot' : 'sparring-bot',
    profile: {
      name: challenger ? 'Challenger Bot' : 'Sparring Bot',
      description: 'Original geometric format fixture. Not approved game art.',
      language: 'en',
      concept: 'A training robot built from simple shapes. It exists to test the format, not to tell a story.',
      moves: {
        combo: { name: 'Test Jabs', description: 'The standard combo under a fixture name.' },
        slam: { name: 'Test Slam', description: 'The standard slam under a fixture name.' },
        dash: { name: 'Test Dash', description: 'The standard dash under a fixture name.' },
        block: { name: 'Test Guard', description: 'The standard block under a fixture name.' },
      },
      portrait: { assetId: 'idle', crop: { x: 32, y: 0, width: 192, height: 256 } },
      preview: { assetId: 'idle', crop: { x: 0, y: 0, width: 256, height: 512 } },
    },
    combat: { kitId: 'standard-duel', stats: { power: 3, toughness: 3, speed: 3 } },
    appearance: { projection: 'orthographic', elevationDegrees: 16, sourceFacing: 'right', leftFacing: 'mirror', bodyHeight: 400, bodyScale: 1 },
    assets: /** @type {Asset[]} */ ([]),
    clips: /** @type {Record<string, Clip>} */ ({}),
  };
  /** @type {Record<string, number>} */
  const counts = { idle: 1, walk: 16, run: 12, fightIdle: 4, combo: 9, slam: 4, dash: 4, block: 4, hit: 6, groggy: 4, fall: 5 };
  for (const [name, motion] of Object.entries(spec.motions)) {
    const count = counts[name],
      id = name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
    const columns = Math.min(4, count),
      rows = Math.ceil(count / columns),
      width = columns * 256,
      height = rows * 512;
    const layers = [];
    for (let frame = 0; frame < count; frame++) {
      const swing = Math.round(Math.sin((frame / count) * Math.PI * 2) * 14);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="512" viewBox="0 0 256 512">
        <g fill="${challenger ? '#e49b48' : '#32b8ac'}" stroke="#102c44" stroke-width="8" stroke-linejoin="round">
          <path d="M106 300 L${98 + swing} 436 L${122 + swing} 436 L132 300Z"/>
          <path d="M136 300 L${148 - swing} 436 L${172 - swing} 436 L156 300Z"/>
          <rect x="84" y="156" width="84" height="164" rx="24"/>
          <path d="M160 180 L${200 + swing} 216 L196 244 L148 214Z"/>
          <rect x="84" y="40" width="104" height="116" rx="36"/>
        </g><rect x="148" y="78" width="28" height="20" rx="4" fill="#fff4bd"/>
      </svg>`;
      layers.push({ input: Buffer.from(svg), left: (frame % columns) * 256, top: Math.floor(frame / columns) * 512 });
    }
    const buffer = await sharp({ create: { width, height, channels: 4, background: '#00000000' } })
      .composite(layers)
      .webp({ lossless: true })
      .toBuffer();
    const assetPath = `assets/${id}.webp`;
    await writeFile(path.join(destination, assetPath), buffer, { flag: 'wx' });
    fighter.assets.push({
      id,
      path: assetPath,
      mediaType: 'image/webp',
      sha256: createHash('sha256').update(buffer).digest('hex'),
      bytes: buffer.length,
      width,
      height,
    });
    /** @type {Clip} */
    const clip = {
      assetId: id,
      frameWidth: 256,
      frameHeight: 512,
      columns,
      rows,
      frames: Array.from({ length: count }, (_, i) => i),
      origins: Array.from({ length: count }, () => ({
        originX: 128,
        originY: 440,
        groundContacts: [
          { x: 110, y: 440, rx: 12, ry: 5 },
          { x: 160, y: 440, rx: 12, ry: 5 },
        ],
      })),
      loop: motion.loop,
    };
    if (motion.kind === 'gait') {
      clip.durationMs = 90;
      if (name === 'walk') clip.stridePixels = 90;
    } else {
      clip.sequence = clip.frames.map(frame => ({ frame, durationMs: 90 }));
      clip.hitSequenceIndices = { combo: [1, 4, 8], slam: [2], dash: [2], block: [1], hit: [1], fall: [2] }[name] ?? [];
    }
    if (name === 'combo') clip.landmarks = { spinStart: 3 };
    if (name === 'hit') clip.landmarks = { recoil: 1, stagger: [2, 3], recover: [4, 5] };
    if (name === 'dash') clip.landmarks = { windup: { clip: 'fightIdle', frame: 0 }, recover: { clip: 'fightIdle', frame: 1 } };
    if (name === 'fall') {
      /** @type {Step} */ (/** @type {Step[]} */ (clip.sequence).at(-1)).frame = 3; // set above
      clip.landmarks = {
        lieSequenceIndex: 3,
        getUp: [
          { clip: 'hit', frame: 4, durationMs: 90 },
          { clip: 'fightIdle', frame: 0, durationMs: 90 },
        ],
      };
    }
    fighter.clips[name] = clip;
  }
  await writeFile(path.join(destination, 'fighter.json'), JSON.stringify(fighter, null, 2) + '\n', { flag: 'wx' });
  return fighter;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await mkdir('output', { recursive: true });
  const destination = path.resolve(process.argv[2] ?? 'output/sparring-bot');
  try {
    await createExample(destination, process.argv[3] ?? 'sparring');
    console.log(`Created test fixture: ${destination}`);
  } catch (/** @type {any} */ error) {
    console.error(error.code === 'EEXIST' ? 'Target exists. Choose a NEW output directory.' : error.message);
    process.exitCode = 1;
  }
}
