import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkCreationDelivery } from '../scripts/check-creation-delivery.mjs';

// Synthetic records only. No provider, uploader, account or image is contacted.
const record = () => ({
  version: 1,
  conversationId: 'chat-a',
  environment: 'test-host',
  generation: { status: 'ready', route: 'native-image', evidence: 'Synthetic current account/tool check' },
  delivery: {
    status: 'ready',
    route: 'inline',
    conversationId: 'chat-a',
    fullBody: true,
    faceCrop: true,
    evidence: 'Synthetic current host inline and same-source crop support',
  },
  previousGeneration: { status: 'none', evidence: 'Synthetic empty execution history' },
});
const check = (r, phase = 'preflight') => checkCreationDelivery(r, { phase, conversationId: 'chat-a' });

test('generation readiness does not replace a working delivery helper', () => {
  const r = record();
  assert.equal(check(r).ready, true);
  r.delivery.status = 'unavailable';
  r.delivery.evidence = 'Library prepare_uploads is not available';
  assert.equal(check(r).ready, false);
  assert.deepEqual(check(r).blockers, ['delivery:unavailable']);
  r.delivery.status = 'denied';
  assert.deepEqual(check(r).blockers, ['delivery:denied']);
  r.delivery.status = 'unknown';
  assert.equal(check(r).ready, false);
});

test('scope, evidence and both appearance views are required', () => {
  const r = record();
  r.delivery.conversationId = 'child-chat';
  assert.ok(check(r).blockers.includes('delivery-other-conversation'));
  r.conversationId = 'old-chat';
  assert.ok(check(r).blockers.includes('record-other-conversation'));
  r.delivery.faceCrop = false;
  assert.ok(check(r).blockers.includes('appearance-delivery-incomplete'));
  r.generation.evidence = ' ';
  assert.ok(check(r).blockers.includes('generation:missing-evidence'));
  assert.equal(check(null).ready, false);
});

test('recover completed images and inspect pending/unknown runs before any new generation', () => {
  const r = record();
  r.previousGeneration.status = 'completed';
  assert.ok(check(r).blockers.includes('recover-existing-before-generation'));
  r.newGenerationRequest = 'User explicitly requests a new appearance version';
  assert.equal(check(r).ready, true);
  for (const status of ['pending', 'unknown']) {
    r.previousGeneration.status = status;
    assert.ok(check(r).blockers.includes('inspect-existing-generation'));
  }
  r.previousGeneration.status = 'not-started';
  assert.equal(check(r).ready, true);
  delete r.previousGeneration;
  assert.equal(check(r).ready, false);
});

test('capacity failure stays blocked even when delivery works', () => {
  const r = record();
  r.generation = { status: 'unavailable', route: 'codex gpt-6-astra', evidence: 'Selected model is at capacity' };
  assert.deepEqual(check(r).blockers, ['generation:unavailable']);
});

function completed() {
  const r = record();
  const preview = () => ({ status: 'displayed', conversationId: 'chat-a', version: 'v1', evidence: 'Synthetic inline image result' });
  r.result = {
    version: 'v1',
    generation: 'completed',
    generationEvidence: {
      status: 'completed',
      tool: 'synthetic-image-tool',
      invocationRef: 'test-trace#call-1',
      completionRef: 'test-trace#result-1',
      outputRef: '/test/image.png',
      environment: 'test-host',
      version: 'v1',
    },
    localSave: { status: 'saved', path: '/test/image.png' },
    librarySave: { status: 'unavailable', fileId: null },
    attachment: { status: 'not-used' },
    previews: { fullBody: preview(), faceCrop: preview() },
    review: 'passed',
    selection: null,
  };
  return r;
}

test('login, requested worker model and a tool listing cannot stand in for completed image evidence', () => {
  for (const evidence of [
    'Logged in with ChatGPT; --model gpt-6-astra; image_gen available',
    { status: 'completed', model: 'gpt-6-astra', auth_source: 'chatgpt', tools: ['image_gen'] },
  ]) {
    const r = completed();
    r.result.generationEvidence = evidence;
    assert.ok(check(r, 'review').blockers.includes('generation:missing-call-evidence'));
    assert.equal(check(r, 'review').canRequestFeedback, false);
  }
});

test('image evidence needs invocation, completion and output references for this environment and version', () => {
  for (const key of ['tool', 'invocationRef', 'completionRef', 'outputRef']) {
    const r = completed();
    delete r.result.generationEvidence[key];
    assert.ok(check(r, 'review').blockers.includes('generation:missing-call-evidence'));
  }
  for (const status of ['queued', 'pending', 'unknown', 'failed']) {
    const r = completed();
    r.result.generationEvidence.status = status;
    assert.equal(check(r, 'review').canRequestFeedback, false);
  }
  for (const [key, value] of [
    ['environment', 'other-pc'],
    ['version', 'v0'],
  ]) {
    const r = completed();
    r.result.generationEvidence[key] = value;
    assert.ok(check(r, 'review').blockers.includes('generation:evidence-scope-mismatch'));
  }
});

test('record checks do not certify live capability or infer an image backend from the worker model', () => {
  const r = completed();
  r.generation.model = 'user-selected-worker';
  r.result.generationEvidence.imageBackend = 'unknown';
  for (const phase of ['preflight', 'review']) {
    const result = check(r, phase);
    assert.equal(result.evidenceScope, 'record-only');
    assert.match(result.limitation, /does not authenticate evidence references/);
    assert.equal(result.imageBackend, undefined);
    assert.equal(result.verified, undefined);
  }
  assert.equal(check(r).ready, true);
  assert.equal(check(r, 'review').canRequestFeedback, true);
});

test('local and Library saves, queued panels and text do not prove display', () => {
  for (const status of ['queued', 'text-only', 'unknown', 'failed']) {
    const r = completed();
    r.result.librarySave = { status: 'saved', fileId: 'test-id' };
    r.result.previews.fullBody.status = status;
    assert.equal(check(r, 'review').canRequestFeedback, false);
  }
  const r = completed();
  r.result.previews.faceCrop.conversationId = 'child-chat';
  assert.equal(check(r, 'review').canRequestFeedback, false);
  r.result.previews.faceCrop.conversationId = 'chat-a';
  r.result.previews.faceCrop.version = 'v0';
  assert.equal(check(r, 'review').canRequestFeedback, false);
});

test('actual previews allow feedback; current version selection and review separately gate advancement', () => {
  const r = completed();
  assert.equal(check(r, 'review').canRequestFeedback, true);
  assert.equal(check(r, 'review').canAdvanceAppearance, false);
  r.result.selection = { version: 'v1', feedback: 'Use this appearance' };
  assert.equal(check(r, 'review').canAdvanceAppearance, true);
  r.result.review = 'pending';
  assert.equal(check(r, 'review').canAdvanceAppearance, false);
  r.result.review = 'passed';
  r.result.selection.version = 'v0';
  assert.equal(check(r, 'review').canAdvanceAppearance, false);
});

test('CLI returns ready/blocked/invalid exit codes without generation or upload', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fighter-delivery-'));
  const file = path.join(dir, 'record.json');
  t.after(async () => {
    await unlink(file);
    await rmdir(dir);
  });
  const script = fileURLToPath(new URL('../scripts/check-creation-delivery.mjs', import.meta.url));
  const run = () => spawnSync(process.execPath, [script, 'preflight', file, 'chat-a'], { encoding: 'utf8', windowsHide: true });
  await writeFile(file, JSON.stringify(record()));
  let output = run();
  assert.equal(output.status, 0, output.stderr);
  assert.equal(JSON.parse(output.stdout).ready, true);
  const r = record();
  r.delivery.status = 'unavailable';
  await writeFile(file, JSON.stringify(r));
  output = run();
  assert.equal(output.status, 1);
  assert.equal(JSON.parse(output.stdout).ready, false);
  await writeFile(file, '{');
  assert.equal(run().status, 2);
});
