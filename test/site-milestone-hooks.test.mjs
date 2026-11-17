import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformMilestones } from '../scripts/site-milestones.mjs';

const id = '/game/src/render/scenes/ArenaDuelScene.ts';
const decided = 'const decided = duel.session.snapshot.result !== null;';
const finish = 'private finish(result: CityFightBoutResult): void {';

for (const step of [
  'if (decided) duel.session.settle(); else duel.session.step();',
  'if (decided) duel.session.settle(); else { duel.session.step(); this.titleWatch?.observe(duel.session.snapshot); }',
]) {
  test(`bout start hook precedes the simulation step: ${step}`, () => {
    const source = `${decided}\n${step}\n${finish}\n}`;
    const transformed = transformMilestones(source, id);
    assert.ok(transformed.includes(step), 'preserve stepping and title observation');
    assert.equal(transformed.split('milestone("game_start"').length, 2);
    assert.ok(transformed.indexOf('if (!decided) milestone("game_start"') < transformed.indexOf(step));
    assert.equal(transformed.split('milestone("match_complete"').length, 2);
  });
}

test('missing or duplicate bout start anchors still require review', () => {
  assert.throws(() => transformMilestones(finish, id), /Review ODDBOUT milestone hook/);
  assert.throws(() => transformMilestones(`${decided}\n${decided}\n${finish}`, id), /Review ODDBOUT milestone hook/);
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
  assert.throws(() => transformMilestones(decided, id), /Review ODDBOUT milestone hook/);
});
