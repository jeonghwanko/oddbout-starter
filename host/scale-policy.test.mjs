import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

// The scale-fit policy for frames scale-check could not read (motions.py scale_priors, scale_policy — 2026-11-01).
const python = path.join(import.meta.dirname, '..', 'vendor/sprite-gen/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const SCRIPT = `
import json, sys
sys.path.insert(0, sys.argv[1])
import motions as m
records, calls = json.loads(sys.argv[2]), json.loads(sys.argv[3])
priors = m.scale_priors(records)
clips = m._clips()
out = {"rows": priors[0], "every": priors[1]}
for name, per_state in calls:
    corrections, fix, guessed = m.scale_policy(records[name], per_state, clips.get(name, {}).get("steps"), priors)
    out[name] = {"corrections": corrections, "fix": fix, "guessed": guessed}
print(json.dumps(out))
`;
/** A scale-check record of `n` frames: `sizes[i]` measured (correction 1/size), null left for an eye check. */
const record = sizes => ({
  state_correction: null,
  frames: sizes.map((size, i) => ({
    frame: `-/${i}`,
    how: size === null ? 'check' : 'head',
    correction: size === null ? null : Math.round(10000 / size) / 10000,
  })),
});
async function policy(records, calls) {
  const { stdout } = await promisify(execFile)(python, ['-I', '-c', SCRIPT, import.meta.dirname, JSON.stringify(records), JSON.stringify(calls)]);
  return JSON.parse(stdout);
}

test("an unreadable clip takes its GPT row's measured size, not 1", { skip: !existsSync(python) }, async () => {
  // hit's steps: guard (stance-a), recoil, stagger x5 (hurt-a), guard; groggy's: dizzyA, dizzyB (hurt-a) — all unreadable, like 빨간 파도's
  const records = {
    hit: record([1.2, null, 1.25, 1.25, 1.25, 1.25, 1.25, 1.2]),
    groggy: record([null, null]),
    victory: record([null, null]),
    fightIdle: record([1.2, 1.2]),
  };
  const got = await policy(records, [
    ['groggy', false],
    ['hit', false],
    ['victory', false],
  ]);
  assert.equal(got.rows['hurt-a'], 0.8);
  assert.deepEqual(got.groggy.corrections, [0.8, 0.8]);
  assert.deepEqual(got.groggy.fix, { '-/0': 0.8, '-/1': 0.8 });
  // the hurt row's recoil, not hit's whole-clip median (which counts the stance row's guard)
  assert.equal(got.hit.corrections[1], 0.8);
  // the show row measured nothing: every measured action frame's median
  assert.ok(!('show-a' in got.rows));
  assert.deepEqual(got.victory.corrections, [got.every, got.every]);
  assert.ok(Math.abs(got.every - 0.8) < 0.01);
});

test('a row needs two measured frames; a clip with nothing measured anywhere stays at 1', { skip: !existsSync(python) }, async () => {
  // fall-getup: koRise (ko-a) and guard (stance-a); fall's eight frames are all ko-a cells
  const lone = await policy({ 'fall-getup': record([1.3, 1.2]), fall: record(Array(8).fill(null)) }, [['fall', false]]);
  assert.ok(!('ko-a' in lone.rows));
  assert.deepEqual(lone.fall.corrections, Array(8).fill(lone.every));
  const none = await policy({ groggy: record([null, null]) }, [['groggy', false]]);
  assert.equal(none.every, null);
  assert.deepEqual(none.groggy.corrections, [1, 1]);
});

test("a gait is filmed, not drawn in a GPT row: it never takes the rows' size", { skip: !existsSync(python) }, async () => {
  const got = await policy({ walk: record(Array(4).fill(null)), combo: record(Array(23).fill(1.2)) }, [['walk', true]]);
  assert.ok(Math.abs(got.every - 0.8333) < 1e-3);
  assert.deepEqual(got.walk.corrections, [1, 1, 1, 1]);
});
