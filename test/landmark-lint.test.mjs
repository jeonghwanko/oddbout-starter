import { test } from 'node:test';
import assert from 'node:assert/strict';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { validateFighter } from '../contracts/ai-fighter/validate.mjs';
import { annotateValidation, lintBorrowedLandmarks } from '../tools/ai-fighter/landmark-lint.mjs';

test('borrowed landmarks warn and name the source clip; a clip using its own frames does not', () => {
  const data = {
    assets: [{ id: 'idle', sha256: 'ab'.repeat(32) }],
    clips: {
      fightIdle: { assetId: 'idle' },
      dash: {
        landmarks: {
          windup: { clip: 'fightIdle', frame: 0 },
          recover: { clip: 'dash', frame: 1 },
        },
      },
      fall: {
        landmarks: {
          lieSequenceIndex: 3,
          getUp: [
            { clip: 'fall', frame: 2, durationMs: 90 },
            { clip: 'hit', frame: 1, durationMs: 90 },
          ],
        },
      },
    },
  };
  const warnings = lintBorrowedLandmarks(data);
  assert.deepEqual(
    warnings.map(warning => [warning.path, warning.actual.clip, warning.actual.frame]),
    [
      ['/clips/dash/landmarks/windup', 'fightIdle', 0],
      ['/clips/fall/landmarks/getUp/1', 'hit', 1],
    ],
  );
  assert.equal(warnings[0].code, 'BORROWED_LANDMARK');
  assert.equal(warnings[0].severity, 'warning');
  assert.equal(warnings[0].actual.sourceAssetId, 'idle');
  assert.equal(warnings[0].actual.sourceSha256, 'ab'.repeat(32));
  assert.match(warnings[0].message, /Prefer a frame of dash itself/);
  assert.equal(warnings[1].actual.sourceSha256, undefined);
});

test('the contract example still validates, and the warning does not clear ok', () => {
  const result = validateFighter(example);
  assert.equal(result.ok, true);
  const annotated = annotateValidation(result, example);
  assert.equal(annotated.ok, true);
  assert.deepEqual(annotated.pendingStages, result.pending);
  assert.deepEqual(annotated.missingAssets, []);
  assert.ok(annotated.warnings.some(warning => warning.code === 'BORROWED_LANDMARK' && warning.actual.clip !== 'dash'));
  assert.ok(annotated.pending.includes('server-registration'));
  assert.ok(!annotated.pending.some(stage => annotated.warnings.some(warning => warning.actual.clip === stage)));
});
