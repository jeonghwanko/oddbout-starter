import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { kitRoot, spritePython, spriteRoot } from '../scripts/sprite-gen.mjs';
import { requireReview } from '../tools/ai-fighter/gait.mjs';

const installed = await access(spritePython).then(
  () => true,
  () => false,
);

test('kit wrapper prepares advisory Decisions evidence with the bundled engine and cannot approve gait', { skip: !installed }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fighter-decisions-'));
  t.after(async () => {
    assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  });
  const env = { ...process.env, PYTHONUTF8: '1' };
  delete env.OPENAI_API_KEY;
  delete env.INIT_CWD;
  const python = spawnSync(spritePython, ['-c', 'import sprite_gen.qa.decisions as d; print(d.__file__)'], {
    cwd: kitRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    env,
  });
  assert.equal(python.status, 0, python.stderr);
  assert.equal(path.resolve(python.stdout.trim()), path.join(spriteRoot, 'sprite_gen', 'qa', 'decisions.py'));
  // Deliberately geometric test input; these are not generated character assets.
  const image = path.join(dir, 'fixture.png');
  await sharp({ create: { width: 24, height: 24, channels: 4, background: '#956a42' } })
    .png()
    .toFile(image);
  const original = await readFile(image);
  const spec = path.join(dir, 'spec.json');
  await writeFile(
    spec,
    JSON.stringify({
      kind: 'sprite-gen-decision-spec',
      version: 1,
      stage: 'pose',
      intent: 'Synthetic fixture, software contract test only; contact is unverified.',
      references: [{ file: 'fixture.png', role: 'identity' }],
      frames: [{ id: 'test-pose', file: 'fixture.png', duration: 0.1 }],
    }),
  );
  const out = path.join(dir, 'review');
  const command = (...args) =>
    spawnSync(process.execPath, [path.join(kitRoot, 'scripts/sprite-gen.mjs'), ...args], {
      cwd: kitRoot,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
      env,
    });
  const prepared = command('review-decisions', '--spec', spec, '--out-dir', out);
  assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
  const report = JSON.parse(await readFile(path.join(out, 'decision-review.json'), 'utf8'));
  assert.equal(report.status, 'prepared');
  assert.equal(report.mode, 'advisory');
  assert.equal(report.visual_approval, false);
  assert.deepEqual(report.checks, {});
  assert.equal(report.binding.images[1].duration, 0.1);
  assert.deepEqual(await readFile(image), original);
  assert.equal(
    await access(path.join(dir, 'review.json')).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.throws(() => requireReview(report, { frames: [], durations: [] }, 'walk'), /GAIT_/);
  const unconfirmed = command('review-decisions', '--spec', spec, '--out-dir', out, '--execute');
  assert.notEqual(unconfirmed.status, 0);
  assert.match(unconfirmed.stdout + unconfirmed.stderr, /confirm-api-billing/);
  const dataset = path.join(dir, 'dataset.json');
  await writeFile(
    dataset,
    JSON.stringify({
      kind: 'sprite-gen-decision-eval',
      version: 1,
      cases: [
        {
          id: 'fixture',
          character: 'synthetic',
          split: 'test',
          labeler: 'test only',
          report: path.join(out, 'decision-review.json'),
          request_sha256: report.binding.request_sha256,
          expected: { 'f000.identity': 'clear' },
        },
      ],
    }),
  );
  const evaluated = command('evaluate-decisions', '--dataset', dataset, '--output', path.join(dir, 'evaluation.json'));
  assert.notEqual(evaluated.status, 0);
  assert.match(evaluated.stdout + evaluated.stderr, /never prepared requests/);
  assert.equal(
    await access(path.join(dir, 'evaluation.json')).then(
      () => true,
      () => false,
    ),
    false,
  );
});
