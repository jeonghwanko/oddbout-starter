import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformMilestones } from '../scripts/site-milestones.mjs';

const id = '/game/src/render/scenes/ArenaDuelScene.ts';
const finishId = '/game/src/render/scenes/arena/ArenaDuelFinishController.ts';
const decided = 'const decided = duel.session.snapshot.result !== null;';
const finish = 'finishBout(result: CityFightBoutResult): void {';

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
