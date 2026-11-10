// @ts-check
// Sample prompts and the tool sequence each one should produce. Recognition is a scripted rule, not a live model.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** @typedef {{ tool: string, selector?: string }} ExpectedStep */
/** @typedef {{ id: string, title: string, forbid: string[], expect: ExpectedStep[] | null }} Scenario */
/** @typedef {{ id: string, scenario: string | null, prompt: string, pattern: RegExp | null }} Fixture */

/** @type {Scenario[]} */
export const SCENARIOS = [
  {
    id: 'hosted-new',
    title: 'New fighter from a prompt (hosted)',
    forbid: ['enter_fighter', 'revise_motion', 'prepare_fighter_registration'],
    expect: [
      { tool: 'get_profile' },
      { tool: 'get_my_fighters', selector: 'readiness' },
      { tool: 'get_fighter_spec', selector: 'overview' },
      { tool: 'request_hosted_fighter', selector: 'request' },
      { tool: 'request_hosted_fighter', selector: 'choose_look' },
      { tool: 'get_hosted_fighter', selector: 'until-registered' },
    ],
  },
  {
    id: 'workspace-new',
    title: 'New fighter from a prompt (workspace connector)',
    forbid: ['request_hosted_fighter', 'enter_fighter'],
    expect: [
      { tool: 'get_profile' },
      { tool: 'get_my_fighters', selector: 'readiness' },
      { tool: 'get_fighter_spec', selector: 'overview' },
      { tool: 'local', selector: 'placeholder-sprites' },
      { tool: 'local', selector: 'validate' },
      { tool: 'prepare_fighter_registration', selector: 'package' },
      { tool: 'upload_fighter_asset', selector: 'package' },
      { tool: 'submit_fighter_registration', selector: 'package' },
      { tool: 'get_my_fighters', selector: 'submission' },
      { tool: 'prepare_fighter_registration', selector: 'profile_set' },
      { tool: 'upload_fighter_asset', selector: 'profile_set:front' },
      { tool: 'upload_fighter_asset', selector: 'profile_set:expressions' },
      { tool: 'submit_fighter_registration', selector: 'profile_set' },
      { tool: 'get_my_fighters', selector: 'fighter' },
    ],
  },
  {
    id: 'cli-register',
    title: 'New fighter via fighter:register --dummy',
    forbid: ['request_hosted_fighter', 'enter_fighter'],
    expect: [
      { tool: 'get_profile' },
      { tool: 'get_my_fighters', selector: 'readiness' },
      { tool: 'local', selector: 'placeholder-sprites' },
      { tool: 'local', selector: 'validate' },
      { tool: 'fighter:register', selector: 'submit' },
      { tool: 'get_my_fighters', selector: 'submission' },
      { tool: 'fighter:register', selector: 'retry' },
    ],
  },
  {
    id: 'revise',
    title: 'Revision of a registered fighter with --fighter',
    forbid: ['request_hosted_fighter', 'revise_motion', 'enter_fighter'],
    expect: [
      { tool: 'get_profile' },
      { tool: 'get_my_fighters', selector: 'list' },
      { tool: 'local', selector: 'placeholder-sprites' },
      { tool: 'local', selector: 'validate' },
      { tool: 'fighter:register', selector: 'revise' },
      { tool: 'get_my_fighters', selector: 'submission' },
    ],
  },
  {
    id: 'style-only',
    title: 'Style-only edit',
    forbid: ['prepare_fighter_registration', 'request_hosted_fighter'],
    expect: [
      { tool: 'get_profile' },
      { tool: 'get_my_fighters', selector: 'list' },
      { tool: 'browse_oddbout', selector: 'style_guide' },
      { tool: 'update_fighter', selector: 'style' },
    ],
  },
  {
    id: 'quota',
    title: 'Quota exceeded',
    forbid: ['prepare_fighter_registration', 'request_hosted_fighter'],
    expect: [{ tool: 'get_profile' }, { tool: 'get_my_fighters', selector: 'list' }],
  },
  {
    id: 'missing-asset',
    title: 'Asset missing 409, then the missingAssets upload',
    forbid: ['request_hosted_fighter'],
    expect: [
      { tool: 'prepare_fighter_registration', selector: 'package' },
      { tool: 'upload_fighter_asset', selector: 'package' },
      { tool: 'submit_fighter_registration', selector: 'package' },
      { tool: 'get_my_fighters', selector: 'submission' },
    ],
  },
  {
    id: 'rejected',
    title: 'Rejected by dummy review',
    forbid: ['request_hosted_fighter', 'enter_fighter'],
    expect: [
      { tool: 'prepare_fighter_registration', selector: 'package' },
      { tool: 'upload_fighter_asset', selector: 'package' },
      { tool: 'submit_fighter_registration', selector: 'package' },
      { tool: 'get_my_fighters', selector: 'submission' },
    ],
  },
  {
    id: 'legacy-motion',
    title: 'Legacy hosted job at motion_ready',
    forbid: ['prepare_fighter_registration', 'enter_fighter'],
    expect: [
      { tool: 'get_hosted_fighter', selector: 'job' },
      { tool: 'request_hosted_fighter', selector: 'revise_motion' },
      { tool: 'submit_fighter_registration', selector: 'hosted' },
      { tool: 'get_hosted_fighter', selector: 'job' },
    ],
  },
  { id: 'guard', title: 'Sealed packages cannot reach a live client', forbid: [], expect: null },
];

/** @type {Fixture[]} */
export const FIXTURES = [
  {
    id: 'hosted-ko',
    scenario: 'hosted-new',
    prompt: 'ODDBOUT가 만들어 줘. 빨간 글러브를 낀 고양이 복서, 귀가 크다.',
    pattern: /ODDBOUT가 만들어 줘/,
  },
  {
    id: 'workspace-en',
    scenario: 'workspace-new',
    prompt: 'I am in the workspace. Make a teal drill bot from this prompt and register the package with the connector.',
    pattern: /in the workspace/,
  },
  {
    id: 'cli-en',
    scenario: 'cli-register',
    prompt: 'This host cannot attach files. Register the package with fighter:register.',
    pattern: /cannot attach files/,
  },
  {
    id: 'revise-en',
    scenario: 'revise',
    prompt: 'Revise my registered fighter. Change the walk and keep the same fighter id.',
    pattern: /same fighter id/,
  },
  {
    id: 'style-en',
    scenario: 'style-only',
    prompt: 'Change only the fighting style. No new art. Super dash and more patience.',
    pattern: /fighting style/,
  },
  {
    id: 'quota-en',
    scenario: 'quota',
    prompt: 'Make me another new fighter. I am already at my limit.',
    pattern: /at my limit/,
  },
  {
    id: 'missing-en',
    scenario: 'missing-asset',
    prompt: 'The server returned assets-incomplete. pending lists server-validation. Finish the registration.',
    pattern: /assets-incomplete/,
  },
  {
    id: 'rejected-en',
    scenario: 'rejected',
    prompt: 'Register this package. If review rejects it, stop and tell me why. Do not generate again.',
    pattern: /review rejects/,
  },
  {
    id: 'legacy-en',
    scenario: 'legacy-motion',
    prompt: 'This hosted job is still at motion_ready. Change only the walk, then register it.',
    pattern: /motion_ready/,
  },
  { id: 'chatter', scenario: null, prompt: 'What is the weather like today?', pattern: null },
];

const LOCAL_TOOLS = new Set(['local', 'fighter:register']);

/** @returns {{ ok: boolean, problems: string[] }} */
export function checkFixtures() {
  /** @type {string[]} */
  const problems = [];
  for (const fixture of FIXTURES) {
    const hits = FIXTURES.filter(item => item.pattern?.test(fixture.prompt));
    if (fixture.scenario === null) {
      if (hits.length) problems.push(`${fixture.id} matched ${hits.map(item => item.id).join(', ')}`);
      continue;
    }
    if (hits.length !== 1 || hits[0].id !== fixture.id) problems.push(`${fixture.id} recognised as ${hits.map(item => item.id).join(', ') || 'nothing'}`);
    const scenario = SCENARIOS.find(item => item.id === fixture.scenario);
    if (!scenario?.expect) {
      problems.push(`${fixture.id} has no sequence`);
      continue;
    }
    for (const forbidden of scenario.forbid) {
      if (scenario.expect.some(step => step.tool === forbidden || step.selector === forbidden)) problems.push(`${scenario.id} sequence contains ${forbidden}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * The sequences only name tools and rules the skill and AGENTS.md already state.
 * @param {string} root
 */
export async function checkDocs(root) {
  const agents = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
  const skill = await readFile(path.join(root, 'plugins/ai-fighter/skills/create-fighter/SKILL.md'), 'utf8');
  const together = `${agents}\n${skill}`;
  /** @type {string[]} */
  const problems = [];
  for (const phrase of ['pendingStages', 'missingAssets', 'motion_ready', 'update_fighter', 'npm run flow:test', 'docs/FLOW-TEST.md', 'fighter:register']) {
    if (!agents.includes(phrase)) problems.push(`AGENTS.md missing ${phrase}`);
  }
  for (const phrase of ['request_hosted_fighter', 'fighterId', 'pendingStages', 'update_fighter']) {
    if (!skill.includes(phrase)) problems.push(`SKILL.md missing ${phrase}`);
  }
  const names = new Set(SCENARIOS.flatMap(scenario => [...(scenario.expect ?? []), ...scenario.forbid.map(tool => ({ tool }))]).map(step => step.tool));
  for (const name of names) if (!LOCAL_TOOLS.has(name) && !together.includes(name)) problems.push(`docs do not name ${name}`);
  return { ok: problems.length === 0, problems };
}
