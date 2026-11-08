import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import sharp from 'sharp';
import { walkPlan, loadSequence, requireReview } from '../tools/ai-fighter/gait.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const python = path.join(root, 'vendor/sprite-gen/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const installed = await access(python).then(
  () => true,
  () => false,
);
const run = (command, args) =>
  spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120_000, env: { ...process.env, PYTHONUTF8: '1' } });

function drawPreview(html, change = '') {
  const calls = [],
    elements = new Map();
  const context = new Proxy(
    {},
    {
      get:
        (_, name) =>
        (...args) =>
          calls.push([name, ...args]),
      set: () => true,
    },
  );
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { value: '1', checked: id === 'overlay', getContext: () => context });
      return elements.get(id);
    },
  };
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  runInNewContext(script + `;${change};index=1;playing=false;draw(0);`, {
    document,
    Image: class {
      decode() {
        return Promise.resolve();
      }
    },
    requestAnimationFrame: () => {},
  });
  return calls;
}

test('explicit foot evidence: real inspector positive and adversarial geometry cases', { skip: !installed }, () => {
  const result = run(python, ['test/contact_evidence_cases.py']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const version of [1, 2])
  test(`gait/pack gate requires matching fresh foot evidence v${version}; loop failure remains failure`, { skip: !installed }, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'contact-evidence-'));
    try {
      const generated = run(python, ['test/contact_evidence_cases.py', '--fixture-dir', dir, String(version)]);
      assert.equal(generated.status, 0, generated.stderr);
      const tiles = [];
      for (let i = 0; i < 16; i++) tiles.push({ input: path.join(dir, `${i}.png`), left: i * 128, top: 0 });
      await sharp({ create: { width: 128 * 16, height: 96, channels: 4, background: '#0000' } })
        .composite(tiles)
        .png()
        .toFile(path.join(dir, 'atlas.png'));
      await writeFile(
        path.join(dir, 'manifest.json'),
        JSON.stringify({
          sprite_sheet_alpha: 'atlas.png',
          frame_layout: { rows: { walk: tiles.map(t => ({ x: t.left, y: 0, w: 128, h: 96 })) } },
          animation: { rows: { walk: { durations_ms: Array(16).fill(100) } } },
        }),
      );
      const plan = walkPlan();
      plan.source = { file: 'manifest.json', state: 'walk' };
      plan.geometry = { width: 128, height: 96, groundY: 84, groundTolerance: 2 };
      await writeFile(path.join(dir, 'plan.json'), JSON.stringify(plan));
      const seq = await loadSequence(plan.source, dir);
      const a = {
        sequenceSha256: seq.sha256,
        visual: { identity: 'pass', anatomy: 'pass', alternation: 'pass', loop: 'pass' },
        stances: [
          { foot: 'near', start: 1, end: 3, box: [38, 54, 46, 31], footEvidence: 'near.json' },
          { foot: 'far', start: 9, end: 11, box: [38, 54, 46, 31], footEvidence: 'far.json' },
        ],
      };
      const execute = async () => {
        await writeFile(path.join(dir, 'annotations.json'), JSON.stringify(a));
        return run(process.execPath, ['scripts/gait.mjs', 'review', path.join(dir, 'plan.json'), path.join(dir, 'review'), path.join(dir, 'annotations.json')]);
      };
      let result = await execute();
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const review = JSON.parse(await readFile(path.join(dir, 'review/review.json'), 'utf8'));
      assert.equal(review.status, 'pass');
      assert.equal(review.stridePixels, 128);
      assert.ok(review.stanceReports.every(r => r.stride_verified && !r.upstream_report.stride_verified));
      assert.ok(review.stanceReports.every(r => r.measurement_engine === `ai-fighter-foot-evidence-v${version}`));
      const mismatched = structuredClone(review);
      mismatched.stanceReports[0].foot_evidence.declaration.version = 3 - version;
      assert.throws(() => requireReview(mismatched, seq, 'walk'), /INCOMPLETE/);
      assert.equal(requireReview(review, seq, 'walk'), review);
      const html = await readFile(path.join(dir, 'review/preview.html'), 'utf8');
      const calls = drawPreview(html);
      assert.ok(calls.some(c => c[0] === 'fillText' && c[1] === 'declared near'));
      assert.ok(calls.some(c => c[0] === 'fillText' && c[1] === 'declared far'));
      assert.equal(calls.filter(c => c[0] === 'arc').length, 2);
      // A failed declaration must not break the inspection screen itself.
      for (const frames of ['[null]', '{}'])
        assert.doesNotThrow(() => drawPreview(html, `D.report.stanceReports[0].foot_evidence.declaration.frames=${frames}`));
      const malformed = structuredClone(review);
      delete malformed.stanceReports[0].foot_evidence;
      assert.throws(() => requireReview(malformed, seq, 'walk'), /INCOMPLETE/);
      const wrongFoot = structuredClone(review);
      wrongFoot.stanceReports[0].foot_evidence.stance.foot = 'far';
      assert.throws(() => requireReview(wrongFoot, seq, 'walk'), /INCOMPLETE/);
      a.visual.loop = 'fail';
      result = await execute();
      assert.equal(result.status, 2, result.stderr);
      assert.equal(JSON.parse(await readFile(path.join(dir, 'review/review.json'), 'utf8')).status, 'fail');
      a.visual.loop = 'pass';
      const evidence = JSON.parse(await readFile(path.join(dir, 'near.json'), 'utf8'));
      evidence.sequence.durationsSeconds[0] = 0.2;
      await writeFile(path.join(dir, 'near.json'), JSON.stringify(evidence));
      result = await execute();
      assert.equal(result.status, 2, result.stderr);
      const failed = JSON.parse(await readFile(path.join(dir, 'review/review.json'), 'utf8'));
      assert.equal(failed.stridePixels, null);
      assert.throws(() => requireReview(failed, seq, 'walk'), /REQUIRED/);
    } finally {
      assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
      await rm(dir, { recursive: true, force: true });
    }
  });
