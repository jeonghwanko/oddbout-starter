// @ts-check
// Offline record checker. It does not call a model, generation provider, CLI or network.
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';

/** @type {Record<string, string>} */
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (!['--cases', '--responses', '--out'].includes(key) || !process.argv[i + 1]) {
    throw new Error('Usage: node scripts/evaluate-creation-dialogue.mjs --responses <json> [--cases <json>] [--out <json>]');
  }
  if (options[key]) throw new Error(`Duplicate option ${key}`);
  options[key] = process.argv[i + 1];
}
if (!options['--responses']) throw new Error('--responses is required');
const casePath = path.resolve(options['--cases'] ?? 'test/fixtures/creation-dialogue/cases.json');
const responsePath = path.resolve(options['--responses']);
const caseBytes = fs.readFileSync(casePath);
const responseBytes = fs.readFileSync(responsePath);
// JSON.parse reads a Buffer as its text.
const fixture = JSON.parse(/** @type {any} */ (caseBytes));
const sample = JSON.parse(/** @type {any} */ (responseBytes));
for (const input of [fixture, sample]) {
  if (input.version !== 1 || input.mode !== 'dialogue-simulation-only' || input.actualGenerationAllowed !== false) {
    throw new Error('Only version 1, explicitly generation-disabled simulation records are accepted');
  }
}
if (!Array.isArray(fixture.cases) || !Array.isArray(sample.responses)) throw new Error('Missing records');
const known = new Set();
for (const test of fixture.cases) {
  if (!/^U\d{2}-[a-z]$/.test(test.id) || known.has(test.id)) throw new Error(`Invalid or duplicate case ${test.id}`);
  if (!test.expected || !Number.isInteger(test.expected.questionCount)) throw new Error(`Missing oracle ${test.id}`);
  known.add(test.id);
}
const responses = new Map();
for (const response of sample.responses) {
  if (!known.has(response.id) || responses.has(response.id)) throw new Error(`Unknown or duplicate response ${response.id}`);
  responses.set(response.id, response);
}
const results = /** @type {any[]} */ (fixture.cases).map(test => {
  const response = responses.get(test.id);
  const errors = [];
  if (!response) return { id: test.id, pass: false, errors: ['Response missing'] };
  if (typeof response.reply !== 'string' || !response.reply.trim()) errors.push('Reply missing');
  if (!Array.isArray(response.executedTools) || response.executedTools.length) errors.push('Simulation must have no executed tools');
  if (!Array.isArray(response.questions)) errors.push('Questions must be explicit');
  const actual = { ...response.decision, questionCount: response.questions?.length };
  for (const [key, expected] of Object.entries(test.expected)) {
    if (!isDeepStrictEqual(actual[key], expected)) errors.push(`${key}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual[key])}`);
  }
  // Undeclared actions must not be smuggled in as extra fields.
  for (const key of Object.keys(actual)) {
    if (!(key in test.expected)) errors.push(`Unexpected decision field: ${key}`);
  }
  return { id: test.id, pass: errors.length === 0, errors };
});
const scenarios = [...new Set(/** @type {any[]} */ (fixture.cases).map(test => test.scenario))].sort();
const expectedIds = Array.from({ length: 16 }, (_, i) => `U${String(i + 1).padStart(2, '0')}`);
if (!isDeepStrictEqual(scenarios, expectedIds)) throw new Error('All sixteen scenario families must be present');
const report = {
  evaluation: 'offline-record-contract-check',
  revision: sample.revision,
  limitation: 'This checks authored simulation records and structured decisions, not semantic truth, a live agent, media quality or user satisfaction.',
  actualGenerationAllowed: false,
  hashes: { cases: createHash('sha256').update(caseBytes).digest('hex'), responses: createHash('sha256').update(responseBytes).digest('hex') },
  families: scenarios.length,
  branches: results.length,
  passed: results.filter(x => x.pass).length,
  failed: results.filter(x => !x.pass).length,
  recordedExecutedTools: /** @type {any[]} */ (sample.responses).reduce((n, x) => n + (x.executedTools?.length ?? 0), 0),
  results,
};
if (options['--out']) fs.writeFileSync(path.resolve(options['--out']), JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    evaluation: report.evaluation,
    revision: report.revision,
    families: report.families,
    branches: report.branches,
    passed: report.passed,
    failed: report.failed,
    failedIds: results.filter(x => !x.pass).map(x => x.id),
    recordedExecutedTools: report.recordedExecutedTools,
  }),
);
process.exitCode = report.failed ? 1 : 0;
