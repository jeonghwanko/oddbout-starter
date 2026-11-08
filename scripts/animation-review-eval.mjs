// @ts-check
// Local, generation-free utilities. No credential lookup, network, or paid calls.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, evaluate, swappedPair } from './animation-review-eval-lib.mjs';
import { questions } from '../api/decisions-review.mjs';

/** @param {string} filename @param {number} [limit] */
async function readBounded(filename, limit = 64 * 1024 * 1024) {
  if ((await stat(filename)).size > limit) throw Error('Input exceeds size limit');
  const raw = await readFile(filename);
  if (raw.length > limit) throw Error('Input exceeds size limit');
  return raw;
}
/** @type {(value: unknown) => string} */
const json = value => JSON.stringify(value, null, 2) + '\n';
/** @type {(filename: string, bytes: string | Uint8Array) => Promise<void>} */
const save = (filename, bytes) => writeFile(filename, bytes, { flag: 'wx', mode: 0o600 });

/** @param {string} directory */
async function demo(directory) {
  // Tiny colored squares exercise plumbing, NOT animation quality or real labels.
  const { default: sharp } = await import('sharp');
  const cases = [],
    calls = [];
  const labelNames = questions('sequence').map(q => q.name);
  for (const [family, split] of ['calibration', 'held-out'].entries()) {
    const images = [];
    for (let n = 0; n < 17; n++) {
      const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: (n * 13 + family * 7) % 256, g: 50, b: 100, alpha: 1 } } })
        .png()
        .toBuffer();
      images.push({
        role: n === 0 ? 'reference' : 'candidate',
        sha256: digest(png),
        dataUrl: `data:image/png;base64,${png.toString('base64')}`,
        ...(n ? { durationMs: 90 + n } : {}),
      });
    }
    const request = { stage: 'sequence', scope: 'walk', images },
      raw = Buffer.from(json(request));
    const pair = await swappedPair(raw, 4, 9);
    await save(path.join(directory, `${split}.request.json`), raw);
    await save(path.join(directory, `${split}.swapped.request.json`), pair.variantBytes);
    await save(path.join(directory, `${split}.pair.json`), json(pair.provenance));
    for (const [variant, evidence] of [pair.provenance.originalEvidence, pair.provenance.variantEvidence].entries()) {
      const labels = Object.fromEntries(labelNames.map(n => [n, n === 'contact' ? 'unverified' : variant && n === 'continuity' ? 'defect' : 'clear']));
      cases.push({ id: `synthetic-${split}-${variant}`, sourceGroup: pair.provenance.sourceGroup, split, evidence, labels });
      const checks = Object.fromEntries(
        labelNames.map(n => {
          const choice = n === 'contact' ? 'unverified' : 'clear';
          const score = variant && family === 0 && n === 'continuity' ? 0.7 : 0.9;
          return [
            n,
            {
              status: score >= 0.8 ? choice : 'unverified',
              choice,
              confidence: 0.95,
              probabilities: Object.fromEntries(['clear', 'defect', 'unverified'].map(v => [v, v === choice ? score : (1 - score) / 2])),
            },
          ];
        }),
      );
      calls.push({
        caseId: `synthetic-${split}-${variant}`,
        status: 'response_received',
        httpStatus: 200,
        report: {
          status: 'completed',
          stage: evidence.stage,
          scope: evidence.scope,
          checks,
          binding: {
            images: evidence.images,
            model: 'gpt-6-luna',
            rubric: 'hosted-sprite-v1',
            threshold: 0.8,
            requestSha256: digest(`synthetic-request-${split}-${variant}`),
          },
        },
      });
    }
  }
  const manifest = { version: 1, provenance: { method: 'synthetic-demo', reviewer: 'mechanics-only', recordedAt: '2026-01-01T00:00:00.000Z' }, cases };
  const results = { calls };
  await save(path.join(directory, 'labels.json'), json(manifest));
  await save(path.join(directory, 'results.json'), json(results));
  await save(path.join(directory, 'evaluation.json'), json(evaluate(manifest, results, { cutoff: 0.8 })));
}

/** @param {string[]} args */
export async function main(args) {
  const [command, ...rest] = args;
  if (command === 'evaluate' && [3, 4, 5].includes(rest.length)) {
    const [labelsFile, resultsFile, output, cutoffText, planFile] = rest;
    if (cutoffText !== undefined && !/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(cutoffText)) throw Error('Cutoff must be a decimal in [0, 1]');
    const labels = await readBounded(labelsFile),
      results = await readBounded(resultsFile);
    const planBytes = planFile === undefined ? null : await readBounded(planFile);
    // JSON.parse reads a Buffer as its text.
    const report = /** @type {ReturnType<typeof evaluate> & { inputFiles?: Record<string, string> }} */ (
      evaluate(JSON.parse(/** @type {any} */ (labels)), JSON.parse(/** @type {any} */ (results)), {
        cutoff: cutoffText === undefined ? null : Number(cutoffText),
        plan: planBytes === null ? null : JSON.parse(/** @type {any} */ (planBytes)),
      })
    );
    report.inputFiles = { labelsSha256: digest(labels), resultsSha256: digest(results) };
    if (planBytes) report.inputFiles.planFileSha256 = digest(planBytes);
    await save(output, json(report));
    console.log(
      `Saved offline evaluation: ${report.cohorts.length} cohort(s), ${report.unboundCalls} unbound call(s).${report.mechanicsOnly ? ' SYNTHETIC: mechanics only.' : ''}`,
    );
  } else if (command === 'swap' && rest.length === 4) {
    const [input, a, b, output] = rest;
    if (![a, b].every(n => /^(?:0|[1-9]\d*)$/.test(n))) throw Error('Frame indices must be zero-based integers');
    const raw = await readBounded(input, 8 * 1024 * 1024),
      pair = await swappedPair(raw, Number(a), Number(b));
    await mkdir(output); // Exclusive folder creation: never overwrite prior evidence.
    await save(path.join(output, 'original.request.json'), raw);
    await save(path.join(output, 'swapped.request.json'), pair.variantBytes);
    await save(path.join(output, 'pair.json'), json(pair.provenance));
    console.log('Saved original bytes, swapped request and provenance. Independent human labels still required.');
  } else if (command === 'demo' && rest.length === 1) {
    await mkdir(rest[0]);
    await demo(rest[0]);
    console.log('Saved SYNTHETIC mechanics-only demo. No model was called; no animation quality was measured.');
  } else
    throw Error(
      'Usage: animation-review-eval.mjs evaluate <labels.json> <results.json> <new-output.json> [frozen-cutoff] [frozen-plan.json] | swap <request.json> <frame-a> <frame-b> <new-directory> | demo <new-directory>',
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    // JSON/parser/provider input may contain arbitrary text. Do not echo it on error.
    console.error(error instanceof SyntaxError ? 'Invalid JSON input' : error.code ? `Local file operation failed (${error.code})` : error.message);
    process.exitCode = 1;
  });
}
