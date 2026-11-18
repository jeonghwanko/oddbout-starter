import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformMilestones } from '../scripts/site-milestones.mjs';
import { runInNewContext } from 'node:vm';

const id = '/game/src/render/scenes/ArenaDuelScene.ts';
const finishId = '/game/src/render/scenes/arena/ArenaDuelFinishController.ts';
const decided = 'const decided = duel.session.snapshot.result !== null;';
const finish = 'finishBout(result: CityFightBoutResult): void {';

test('pudding retries count actual starts, duplicate finishes do not count, and cancelled shares do not succeed', async () => {
  const source = `
let phase = 'title', runs = 0, stage = 0, runStage = 0;
const tf = {}, st = { runT: 12 }, wasBest = false;
const showPhase = value => { phase = value; };
function startRun() {
  if (phase === 'play') return;
  showPhase('play');
}
function endRun() {
  const dist = 100;
  showPhase('over');
  runs++;
}
function burstTransform() { tf.burst = true; stage += 1; runStage = stage; }
async function nativeShare() {
  const file = null, withFile = {}, GAME_TITLE = 'Pudding', text = '', SHARE_URL = '/pudding';
      await nav.share(file && nav.canShare?.(withFile) ? withFile : { title: GAME_TITLE, text, url: SHARE_URL });
}
async function copyShare() { const text = '', SHARE_URL = '/pudding'; await navigator.clipboard.writeText(\`\${text} \${SHARE_URL}\`); }
this.actions = { startRun, endRun, burstTransform, nativeShare, copyShare };
`;
  const events = [],
    context = {
      puddingMilestone: (name, parameters) => events.push({ name, ...parameters }),
      nav: { share: async () => {} },
      navigator: { clipboard: { writeText: async () => {} } },
    };
  const transformed = transformMilestones(source, '/game/src/dev/pudding-escape.ts');
  runInNewContext(transformed.replace(/^import[^\n]+\n/, ''), context);
  const { startRun, endRun, burstTransform, nativeShare, copyShare } = context.actions;
  endRun();
  startRun();
  startRun();
  burstTransform();
  endRun();
  endRun();
  startRun();
  await nativeShare();
  await copyShare();
  context.nav.share = async () => {
    throw new Error('cancelled');
  };
  await assert.rejects(nativeShare(), /cancelled/);
  assert.deepEqual(
    events.map(e => e.name),
    ['pudding_run_start', 'pudding_transform', 'pudding_run_end', 'pudding_run_start', 'pudding_share', 'pudding_share'],
  );
  assert.equal(events[0].mode, 'first');
  assert.equal(events[3].mode, 'retry');
  assert.equal(events[2].distance_m, 100);
  assert.equal(events[2].duration_seconds, 12);
  assert.equal(events[4].method, 'native');
  assert.equal(events[5].method, 'clipboard');
  assert.throws(() => transformMilestones('', '/game/src/dev/pudding-escape.ts'), /Review ODDBOUT milestone hook/);
});

for (const step of [
  'if (decided) duel.session.settle(); else duel.session.step();',
  'if (decided) duel.session.settle(); else { duel.session.step(); this.titleWatch?.observe(duel.session.snapshot); }',
]) {
  test(`bout start hook precedes the simulation step: ${step}`, () => {
    const source = `${decided}\n${step}\n}`;
    const transformed = transformMilestones(source, id);
    assert.ok(transformed.includes(step), 'preserve stepping and title observation');
    assert.equal(transformed.split('milestone("game_start"').length, 2);
    assert.ok(transformed.indexOf('if (!decided) milestone("game_start"') < transformed.indexOf(step));
    assert.equal(transformed.split('milestone("match_complete"').length, 1);
  });
}

test("the bout's end hook is in the duel's finish controller, on the same session", () => {
  const transformed = transformMilestones(`${finish}\n  this.deps.playback?.ended(result);\n}`, finishId);
  assert.equal(transformed.split('milestone("match_complete", this.deps.duel?.session').length, 2);
  assert.ok(transformed.indexOf('milestone("match_complete"') < transformed.indexOf('this.deps.playback'));
});

test('missing or duplicate bout anchors still require review', () => {
  assert.throws(() => transformMilestones('class X {}', id), /Review ODDBOUT milestone hook/);
  assert.throws(() => transformMilestones(`${decided}\n${decided}`, id), /Review ODDBOUT milestone hook/);
  assert.throws(() => transformMilestones('class X {}', finishId), /Review ODDBOUT milestone hook/);
  assert.throws(() => transformMilestones(`${finish}\n${finish}`, finishId), /Review ODDBOUT milestone hook/);
});

test('the extracted result controller and scene share the same bout identity', () => {
  const scene = `${decided}\nreadonly finish = new ArenaDuelFinishController(this.depsOfFinish());`;
  const transformed = transformMilestones(scene, id);
  assert.equal(transformed.split('milestone("game_start"').length, 2);
  assert.ok(!transformed.includes('milestone("match_complete"'));
  const controllerId = '/game/src/render/scenes/arena/ArenaDuelFinishController.ts';
  const anchor = 'finishBout(result: CityFightBoutResult): void {';
  const controller = transformMilestones(`${anchor}\nthis.deps.playback?.ended(result);\n}`, controllerId);
  assert.ok(controller.includes('milestone("match_complete", this.deps.duel?.session, { result: result.how });'));
  assert.ok(controller.indexOf('milestone("match_complete"') < controller.indexOf('this.deps.playback?.ended(result)'));
  assert.throws(() => transformMilestones('', controllerId), /Review ODDBOUT milestone hook/);
  assert.throws(() => transformMilestones(`${anchor}\n${anchor}`, controllerId), /Review ODDBOUT milestone hook/);
  assert.ok(transformMilestones(decided, id).includes('milestone("game_start"'));
});
