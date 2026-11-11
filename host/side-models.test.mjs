// The side-models tier (host/side_models.py, 2026-11-07 prototype): its rule on recorded signals, the model name the judge key would carry,
// and its pixel-judge answer in the shape the worker checks. No onnxruntime and no weights are needed: the rule and the module's top use the
// standard library only, and the models' answer is stood in for where the pixel judge is run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { checkedPixels } from './generation-prompts.mjs';

const script = path.join(import.meta.dirname, 'side_models.py');
/** The first Python 3.9+ on PATH that runs `check`, or undefined. @param {string} check */
const findPython = check => ['python3', 'python'].find(cmd => spawnSync(cmd, ['-c', `import sys; assert sys.version_info >= (3, 9); ${check}`]).status === 0);
const plainPython = findPython('pass');
// The pixel judge (host/motions.py) needs Pillow and NumPy; a bare runner may not have them.
const pillowPython = findPython('import PIL, numpy');
/** @param {string | undefined} python @param {string[]} args */
const run = (python, ...args) => {
  if (!python) throw Error('no python');
  const done = spawnSync(python, ['-I', ...args], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  if (done.status !== 0) throw Error(done.stderr);
  return done.stdout;
};

// Signals as the models measured them on real side takes (docs/research/SIDE-MODELS-2026-11-07.md), and on cases built from them.
const tags = (profile, fromSide, atViewer = 0.1, behind = 0) => ({
  profile,
  from_side: fromSide,
  looking_at_viewer: atViewer,
  from_behind: behind,
  facing_viewer: 0,
});
const CASES = [
  ['a profile facing right (5cf1 take)', { tags: tags(0.29, 0.42), head: 0.88, face: 0.78, dx: 0.198 }, 'pass'],
  ['a face turned left (the raccoon codex failed)', { tags: tags(0.12, 0.43), head: 0.89, face: 0.72, dx: -0.268 }, 'fail'],
  ["a front (its face on the head's centre, looking at the viewer)", { tags: tags(0.0001, 0.0002, 0.86), head: 0.9, face: 0.85, dx: 0.024 }, 'fail'],
  ['the back', { tags: tags(0, 0.2, 0, 0.8), head: 0.9, face: 0.0, dx: null }, 'fail'],
  ['turned right but the tagger hardly sees a side view (the boxer take)', { tags: tags(0.16, 0.12, 0.02), head: 0.9, face: 0.77, dx: 0.092 }, 'unknown'],
  ['no head found (the potato mascot)', { tags: tags(0.14, 0.2, 0.02), head: 0, face: 0, dx: null }, 'unknown'],
  ['a face found below the confident score', { tags: tags(0.3, 0.6), head: 0.9, face: 0.4, dx: -0.25 }, 'unknown'],
  ['a face barely off the centre with side tags (neither front nor turned)', { tags: tags(0.2, 0.5), head: 0.9, face: 0.8, dx: 0.055 }, 'unknown'],
  ['a centred face the tagger calls a side view: the signals disagree', { tags: tags(0.4, 0.5, 0.7), head: 0.9, face: 0.8, dx: 0.01 }, 'unknown'],
];

test(
  'side models, the rule: pass only for a face turned right that the tagger sees from the side; fail for left, front or back; else unknown',
  { skip: !plainPython },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'side-models-'));
    for (const [what, signals, expected] of CASES) {
      const file = path.join(dir, 'signals.json');
      await writeFile(file, JSON.stringify(signals));
      const said = JSON.parse(run(plainPython, script, 'decide', file));
      assert.equal(said.side, expected, what);
      assert.ok(said.why.length >= 3 && said.why.every(/** @param {unknown} w */ w => typeof w === 'string'), what);
    }
  },
);

test(
  'side models, the model name: short enough for the judge record, and it changes with the weights, the packages and the rule',
  { skip: !plainPython },
  () => {
    const facts = JSON.parse(
      run(
        plainPython,
        '-c',
        [
          'import sys, json, copy',
          `sys.path.insert(0, ${JSON.stringify(import.meta.dirname)})`,
          'import side_models as s, hashlib, tempfile',
          'name = lambda w, p, r: s.SIDE_MODEL + "-" + hashlib.sha256(json.dumps([w, p, r], sort_keys=True).encode()).hexdigest()[:6]',
          'rule = dict(s.RULE, dx_turned=0.07)',
          'w = copy.deepcopy(list(s.WEIGHTS)); w[1]["revision"] = "0" * 40',
          'print(json.dumps({"name": s.MODEL_NAME, "same": name(s.WEIGHTS, s.PACKAGES, s.RULE), "rule": name(s.WEIGHTS, s.PACKAGES, rule),',
          '  "weights": name(tuple(w), s.PACKAGES, s.RULE), "packages": list(s.PACKAGES), "pins": [(e["revision"], list(e["files"].values()), e["license"]) for e in s.WEIGHTS],',
          '  "missing": s.verify(__import__("pathlib").Path(tempfile.mkdtemp()))}))',
        ].join('\n'),
      ),
    );
    assert.match(facts.name, /^side-models-v1-[0-9a-f]{6}$/);
    assert.equal(facts.same, facts.name, 'the name is the hash the module says it is');
    assert.notEqual(facts.rule, facts.name, 'a threshold changed: a new name');
    assert.notEqual(facts.weights, facts.name, 'a weight revision changed: a new name');
    // checkedPixels keeps 40 characters of a model; the pixel judge's name and a '+' go in front.
    assert.ok(`pixels-v2+${facts.name}`.length <= 40);
    assert.ok(
      facts.packages.every(/** @param {string} p */ p => /^[a-z]+==\d+(\.\d+)+$/.test(p)),
      'every package pinned to one version',
    );
    for (const [revision, digests, license] of facts.pins) {
      assert.match(revision, /^[0-9a-f]{40}$/);
      assert.ok(digests.every(/** @param {string} d */ d => /^[0-9a-f]{64}$/.test(d)));
      assert.ok(['MIT', 'Apache-2.0'].includes(license));
    }
    assert.equal(facts.missing.length, 6, 'with no weights every pinned file is reported missing');
  },
);

test(
  "side models, pixel-judge: the pixel judge's answer with `side` from the models, named after both, in the shape the worker checks",
  { skip: !pillowPython },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'side-models-pj-'));
    const figure = (width, colour) =>
      sharp({ create: { width: 300, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: { create: { width, height: 400, channels: 4, background: colour } }, left: 150 - width / 2, top: 50 }])
        .png();
    const front = path.join(dir, 'front.png'),
      take = path.join(dir, 'take.png');
    await figure(120, { r: 200, g: 90, b: 50, alpha: 1 }).toFile(front);
    await figure(80, { r: 200, g: 90, b: 50, alpha: 1 }).toFile(take);
    const answer = JSON.parse(
      run(
        pillowPython,
        '-c',
        [
          'import sys, json',
          `sys.path.insert(0, ${JSON.stringify(import.meta.dirname)})`,
          'import side_models as s',
          // The models stand in: their answer as side_answer gives it.
          's.side_answer = lambda f, t: {"kind": "side-models", "model": s.MODEL_NAME, "side": "pass", "notes": "side (side-models-v1): pass; stood in.", "measures": {"dx": 0.2}}',
          `print(json.dumps(s.pixel_judge("side", [${JSON.stringify(front)}, ${JSON.stringify(take)}])))`,
        ].join('\n'),
      ),
    );
    const checked = checkedPixels('side', answer);
    assert.ok(checked, 'the worker accepts the answer');
    assert.match(checked.model, /^pixels-v2\+side-models-v1-[0-9a-f]{6}$/);
    assert.equal(checked.checks.side, 'pass');
    assert.doesNotMatch(checked.notes, /side: not judged by pixels/, "the pixel judge's own side note gives way");
    assert.match(checked.notes, /side \(side-models-v1\): pass/);
    assert.deepEqual(answer.measures.sideModels, { dx: 0.2 });
  },
);
