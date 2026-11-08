import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileLimits } from '../contracts/ai-fighter/profile-limits.mjs';
import { validateFighter } from '../contracts/ai-fighter/validate.mjs';
import { changeSchema } from '../mcp/creation-store.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };

const profileEvent = profile => changeSchema.safeParse({ type: 'profile', feedback: 'test', description: 'D', ...profile }).success;
const packageAccepts = profile => validateFighter({ ...structuredClone(example), profile: { ...example.profile, ...profile } }).ok;

test('a session accepts exactly the profile text the package contract accepts', () => {
  for (const [field, limit] of [
    ['name', profileLimits.name],
    ['description', profileLimits.description],
  ]) {
    const longest = 'x'.repeat(limit),
      over = 'x'.repeat(limit + 1);
    assert.deepEqual([profileEvent({ name: 'N', [field]: longest }), packageAccepts({ [field]: longest })], [true, true], `${field} at ${limit}`);
    assert.deepEqual([profileEvent({ name: 'N', [field]: over }), packageAccepts({ [field]: over })], [false, false], `${field} over ${limit}`);
  }
  assert.deepEqual(
    [profileLimits.name, profileLimits.description, profileLimits.concept, profileLimits.moveName, profileLimits.moveDescription],
    [40, 600, 800, 24, 160],
    'contract v1 values; change this only together with contracts/ai-fighter/v1',
  );
});
