import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { createServer } from '../mcp/server.mjs';
import { makePackageValidator, resolveManifest } from '../mcp/package-access.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));

// The workspace server in process, as creation:tool runs it.
async function connectInProcess({ root: packageRoot = root } = {}) {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createServer({ root: packageRoot }).connect(serverSide);
  const client = new Client({ name: 'authoring-integration-test', version: '1.0.0' });
  await client.connect(clientSide); return client;
}
test('initialize, tools/list and tools/call cover authoring end to end', async () => {
  const client = await connectInProcess();
  try {
    const catalog = await client.listTools();
    assert.deepEqual(catalog.tools.map(t => t.name).sort(), ['get_fighter_spec', 'review_creation_progress', 'validate_fighter_manifest', 'validate_fighter_package',
      'list_creation_sessions', 'create_creation_session', 'get_creation_session', 'update_creation_session',
      'prepare_creation_job', 'get_creation_job', 'cancel_creation_job', 'resolve_creation_job', 'check_creation_readiness',
      'inspect_fighter_packaging', 'pack_fighter_package',
      'get_creation_environment', 'update_creation_environment', 'prepare_generation_login'].sort());
    assert.ok(catalog.tools.every(t => t.outputSchema));
    assert.ok(catalog.tools.filter(t => t.name.startsWith('validate_')).every(t => t.annotations.readOnlyHint));
    for (const section of ['overview', 'creation', 'schema', 'example', 'guide']) {
      const result = await client.callTool({ name: 'get_fighter_spec', arguments: { section } });
      assert.equal(result.structuredContent.ok, true);
      if (section === 'overview') assert.equal(result.structuredContent.data.registration.available, false);
      if (section === 'creation') {
        assert.equal(result.structuredContent.stage, 'creation-kit');
        assert.equal(result.structuredContent.data.registrationMode, 'cloud');
        assert.equal(result.structuredContent.data.tool.repositoryRoot, root);
        assert.equal(result.structuredContent.data.tool.sourceRoot, path.join(root, 'vendor', 'sprite-gen'));
        assert.equal(result.structuredContent.data.tool.setupCommand, 'npm run sprite:setup');
        assert.equal(result.structuredContent.data.tool.packCommand, 'npm run fighter:pack -- <plan.json>');
        assert.match(result.structuredContent.data.guide, /초대나 사전 승인은 없다/);
        assert.match(result.structuredContent.data.guide, /형식 테스트 전용/);
      }
    }
    const valid = await client.callTool({ name: 'validate_fighter_manifest', arguments: { manifestJson: JSON.stringify(example) } });
    assert.equal(valid.structuredContent.ok, true);
    assert.ok(valid.structuredContent.pending.includes('bytes-hashes-and-full-decode'));
    const malformed = await client.callTool({ name: 'validate_fighter_manifest', arguments: { manifestJson: '{"x":1,"x":2}' } });
    assert.equal(malformed.isError, true); assert.equal(malformed.structuredContent.errors[0].code, 'DUPLICATE_MEMBER');
    const full = await client.callTool({ name: 'validate_fighter_package', arguments: { manifestPath: 'examples/sparring-bot/fighter.json' } });
    assert.equal(full.structuredContent.ok, true, JSON.stringify(full));
    assert.ok(full.structuredContent.pending.includes('server-registration'));
    const escape = await client.callTool({ name: 'validate_fighter_package', arguments: { manifestPath: '../private/fighter.json' } });
    assert.equal(escape.isError, true); assert.equal(escape.structuredContent.errors[0].code, 'PATH_NOT_ALLOWED');
    const badInput = await client.callTool({ name: 'get_fighter_spec', arguments: { section: 'secrets' } });
    assert.equal(badInput.isError, true);
    const oversizedKey = JSON.stringify(example).replace('{', `{"${'x'.repeat(20000)}":1,`);
    const bounded = await client.callTool({ name: 'validate_fighter_manifest', arguments: { manifestJson: oversizedKey } });
    assert.equal(bounded.isError, true); assert.ok(JSON.stringify(bounded).length < 5000);
  } finally { await client.close(); }
});
test('no configured root means no filesystem tool', async () => {
  const client = await connectInProcess({ root: null });
  try {
    assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), ['check_creation_readiness',
      'get_fighter_spec', 'review_creation_progress', 'validate_fighter_manifest']);
  }
  finally { await client.close(); }
});
test('local paths reject traversal, Windows devices, URLs and absolute paths', async () => {
  for (const relative of ['../x/fighter.json', '/tmp/fighter.json', 'C:/secret/fighter.json', 'file:///a/fighter.json', 'assets\\fighter.json', 'x//fighter.json', 'x/./fighter.json', 'x/fighter.json:stream'])
    assert.equal(await resolveManifest(root, relative), null);
});
test('one decoder runs at a time, two calls wait, more are refused; the deadline is enforced', async () => {
  const validate = makePackageValidator(root);
  const results = await Promise.all(Array.from({ length: 4 }, () => validate('examples/sparring-bot/fighter.json')));
  assert.deepEqual(results.map(r => r.ok ? 'ok' : r.errors[0].code), ['ok', 'ok', 'ok', 'VALIDATOR_BUSY']);
  const short = makePackageValidator(root, { timeoutMs: 1 });
  assert.equal((await short('examples/sparring-bot/fighter.json')).errors[0].code, 'VALIDATION_TIMEOUT');
});
test('the file tools share one serial decoder; a changed asset is reported, never accepted', async () => {
  const client = await connectInProcess();
  try {
    // One running and two waiting validations fill the shared queue, so a fourth is refused.
    const validating = Array.from({ length: 3 }, () => client.callTool({ name: 'validate_fighter_package', arguments: { manifestPath: 'examples/sparring-bot/fighter.json' } }));
    const busy = await client.callTool({ name: 'validate_fighter_package', arguments: { manifestPath: 'examples/sparring-bot/fighter.json' } });
    assert.equal(busy.isError, true);
    assert.equal(busy.structuredContent.errors[0].code, 'VALIDATOR_BUSY');
    assert.ok((await Promise.all(validating)).every(result => result.structuredContent.ok));
  } finally { await client.close(); }
  const temporary = await mkdtemp(path.join(tmpdir(), 'fighter-validate-'));
  const second = await connectInProcess({ root: await realpath(temporary) });
  try {
    await cp(new URL('../examples/sparring-bot/', import.meta.url), path.join(temporary, 'broken'), { recursive: true });
    const changed = structuredClone(example); changed.assets[0].sha256 = '0'.repeat(64);
    await writeFile(path.join(temporary, 'broken', 'fighter.json'), JSON.stringify(changed));
    const invalid = await second.callTool({ name: 'validate_fighter_package', arguments: { manifestPath: 'broken/fighter.json' } });
    assert.equal(invalid.isError, true);
    assert.ok(invalid.structuredContent.errors.some(e => e.code === 'ASSET_HASH'));
  } finally { await second.close(); await rm(temporary, { recursive: true, force: true }); }
});
test('one motion of the schema or example is a small read', async () => {
  const client = await connectInProcess({});
  try {
    const size = async args => JSON.stringify((await client.callTool({ name: 'get_fighter_spec', arguments: args })).content).length;
    for (const section of ['schema', 'example']) {
      const full = await size({ section }), one = await size({ section, motion: 'walk' });
      assert.ok(one * 3 < full, `${section}: ${one} of ${full}`);
    }
    const walk = (await client.callTool({ name: 'get_fighter_spec', arguments: { section: 'example', motion: 'walk' } })).structuredContent.data;
    assert.equal(walk.clip.frames.length, 16); assert.equal(walk.asset.id, walk.clip.assetId);
    assert.equal((await client.callTool({ name: 'get_fighter_spec', arguments: { section: 'schema', motion: 'hp' } })).isError, true);
    // An optional clip has its schema (the skill's kind and marks) but no fixture example.
    const skill = (await client.callTool({ name: 'get_fighter_spec', arguments: { section: 'schema', motion: 'skill' } })).structuredContent.data;
    assert.deepEqual(skill.clip.properties.skill.required, ['kind']);
    const victory = (await client.callTool({ name: 'get_fighter_spec', arguments: { section: 'example', motion: 'victory' } })).structuredContent;
    assert.equal(victory.ok, true); assert.equal(victory.data.clip, null);
  } finally { await client.close(); }
});
