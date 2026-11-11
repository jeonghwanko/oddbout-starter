import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFlowEval } from '../tools/flow/eval.mjs';

test('the dummy flow eval scores policy, labels, idempotency and checkpoints', async () => {
  const score = await runFlowEval();
  assert.equal(score.schema, 'oddbout.flow-eval/1');
  assert.equal(score.failed, 0, JSON.stringify(score.checks.filter(check => !check.ok)));
  assert.equal(score.ok, true);
  assert.equal(score.passed, score.checks.length);
  for (const kind of ['policy', 'prompt-recognition', 'forbidden-tool', 'idempotency', 'labels', 'checkpoint']) {
    assert.ok(
      score.checks.some(check => check.kind === kind && check.ok),
      kind,
    );
  }
});
