import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { makePackageValidator, resolveManifest } from '../mcp/package-access.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));

async function connect(withFiles) {
  const isolatedHome = await mkdtemp(path.join(tmpdir(), 'fighter-mcp-home-'));
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../mcp/stdio.mjs', import.meta.url))],
    env: { HOME: isolatedHome, USERPROFILE: isolatedHome, ...(withFiles ? { AI_FIGHTER_ROOT: root } : {}) }, stderr: 'pipe' });
  const client = new Client({ name: 'authoring-integration-test', version: '1.0.0' });
  await client.connect(transport);
  const close = client.close.bind(client);
  client.close = async () => { try { await close(); } finally { await rm(isolatedHome, { recursive: true, force: true }); } };
  return client;
}
test('real stdio initialize, tools/list and tools/call cover authoring end to end', async () => {
  const client = await connect(true);
  try {
    const catalog = await client.listTools();
    assert.deepEqual(catalog.tools.map(t => t.name).sort(), ['get_fighter_spec', 'review_creation_progress', 'validate_fighter_manifest', 'validate_fighter_package',
      'list_creation_sessions', 'create_creation_session', 'get_creation_session', 'update_creation_session',
      'prepare_creation_job', 'get_creation_job', 'cancel_creation_job', 'resolve_creation_job', 'check_creation_readiness', 'connect_oddbout',
      'inspect_fighter_packaging', 'pack_fighter_package',
      'submit_fighter_package', 'update_fighter_profile', 'open_creator_homepage', 'get_fighter_submission', 'get_registered_fighter',
      'get_creation_environment', 'update_creation_environment', 'prepare_generation_login'].sort());
    assert.ok(catalog.tools.every(t => t.outputSchema));
    assert.ok(catalog.tools.filter(t => t.name.startsWith('validate_')).every(t => t.annotations.readOnlyHint));
    for (const section of ['overview', 'creation', 'schema', 'example', 'guide']) {
      const result = await client.callTool({ name: 'get_fighter_spec', arguments: { section } });
      assert.equal(result.structuredContent.ok, true);
      if (section === 'overview') assert.equal(result.structuredContent.data.registration.available, false);
      if (section === 'creation') {
        assert.equal(result.structuredContent.stage, 'creation-kit');
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
  const client = await connect(false);
  try {
    assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), ['check_creation_readiness', 'connect_oddbout',
      'get_fighter_spec', 'get_fighter_submission', 'get_registered_fighter', 'open_creator_homepage',
      'review_creation_progress', 'update_fighter_profile', 'validate_fighter_manifest']);
    const result = await client.callTool({ name: 'get_registered_fighter', arguments: { fighterId: crypto.randomUUID() } });
    assert.equal(result.structuredContent.code, 'client-sign-in-required');
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

// In-process server with a stubbed beta API: the same tool code without spawning stdio.
async function connectInProcess({ root: packageRoot = root, remote }) {
  const [{ createServer }, { InMemoryTransport }] = await Promise.all([import('../mcp/server.mjs'), import('@modelcontextprotocol/sdk/inMemory.js')]);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createServer({ root: packageRoot, remote }).connect(serverSide);
  const client = new Client({ name: 'submission-test', version: '1.0.0' });
  await client.connect(clientSide); return client;
}
function recordingRemote(features = ['profile-extras-1', 'combat-stats-1']) {
  const requests = [], submissionId = crypto.randomUUID();
  return { requests, remote: { request: async (route, options = {}) => {
    requests.push({ route, method: options.method ?? 'GET', body: options.body });
    if (route === 'spec') return { ok: true, stage: 'public-contract', data: { features } };
    if (route === 'submissions' || route.startsWith('submissions?')) return { ok: true, stage: 'uploading', submissionId };
    if (route.endsWith('/submit')) return { ok: true, stage: 'queued', submissionId, pending: ['server-validation', 'registration'] };
    return { ok: true, stage: 'uploaded' };
  } } };
}
test('submit uploads exactly the validated manifest and asset bytes', async () => {
  const { requests, remote } = recordingRemote(), client = await connectInProcess({ remote });
  try {
    const result = await client.callTool({ name: 'submit_fighter_package', arguments: { manifestPath: 'examples/sparring-bot/fighter.json', idempotencyKey: crypto.randomUUID() } });
    assert.equal(result.structuredContent.stage, 'queued', JSON.stringify(result.structuredContent));
    const manifestText = await readFile(new URL('../examples/sparring-bot/fighter.json', import.meta.url), 'utf8');
    assert.equal(requests.find(r => r.route === 'submissions').body, manifestText);
    const uploads = requests.filter(r => r.method === 'PUT');
    assert.deepEqual(uploads.map(r => r.route.split('/').at(-1)), example.assets.map(a => a.id));
    for (const [index, upload] of uploads.entries())
      assert.equal(createHash('sha256').update(upload.body).digest('hex'), example.assets[index].sha256);
  } finally { await client.close(); }
});
test('a fighterId replaces that fighter in place; without one it is a first registration', async () => {
  const { requests, remote } = recordingRemote(), client = await connectInProcess({ remote }), fighterId = crypto.randomUUID();
  try {
    const result = await client.callTool({ name: 'submit_fighter_package', arguments: { manifestPath: 'examples/sparring-bot/fighter.json', idempotencyKey: crypto.randomUUID(), fighterId } });
    assert.equal(result.structuredContent.stage, 'queued', JSON.stringify(result.structuredContent));
    assert.ok(requests.some(r => r.method === 'POST' && r.route === `submissions?fighter=${fighterId}`));
  } finally { await client.close(); }
});
test('a package with concept, move names or grades is not uploaded to a server that predates them', async () => {
  const { requests, remote } = recordingRemote([]), client = await connectInProcess({ remote });
  try {
    const result = await client.callTool({ name: 'submit_fighter_package', arguments: { manifestPath: 'examples/sparring-bot/fighter.json', idempotencyKey: crypto.randomUUID() } });
    assert.equal(result.structuredContent.code, 'server-feature-missing', JSON.stringify(result.structuredContent));
    assert.deepEqual(requests.map(r => r.route), ['spec']);
  } finally { await client.close(); }
});
test('a package with bout lines, a fighting style or optional clips is uploaded only to a server that lists them', async () => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'fighter-style-')));
  try {
    await cp(new URL('../examples/sparring-bot/', import.meta.url), path.join(temporary, 'styled'), { recursive: true });
    // Metadata only: the entrance replays the guard sheet already in the package, so every asset stays the validated file.
    const styled = structuredClone(example);
    styled.profile.lines = { challenge: 'Ready.', win: 'Format kept.' };
    styled.combat.style = { mix: { slam: 2, combo: 2, fast: 1 }, distance: 2, temper: { patience: 4 } };
    styled.clips.entrance = { ...structuredClone(example.clips.fightIdle), loop: false };
    await writeFile(path.join(temporary, 'styled', 'fighter.json'), JSON.stringify(styled));
    const args = { manifestPath: 'styled/fighter.json', idempotencyKey: crypto.randomUUID() };
    const old = recordingRemote(['profile-extras-1', 'combat-stats-1']), before = await connectInProcess({ root: temporary, remote: old.remote });
    try {
      const refused = (await before.callTool({ name: 'submit_fighter_package', arguments: args })).structuredContent;
      assert.equal(refused.code, 'server-feature-missing', JSON.stringify(refused));
      assert.deepEqual(refused.errors, ['profile-lines-1', 'combat-style-1', 'extra-clips-1']);
      assert.deepEqual(old.requests.map(r => r.route), ['spec']);
    } finally { await before.close(); }
    const current = recordingRemote(['profile-extras-1', 'combat-stats-1', 'profile-lines-1', 'combat-style-1', 'extra-clips-1']);
    const after = await connectInProcess({ root: temporary, remote: current.remote });
    try {
      const queued = (await after.callTool({ name: 'submit_fighter_package', arguments: args })).structuredContent;
      assert.equal(queued.stage, 'queued', JSON.stringify(queued));
      assert.deepEqual(JSON.parse(current.requests.find(r => r.route === 'submissions').body), styled);
    } finally { await after.close(); }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
test('validate and submit share one serial decoder; a busy or invalid package is never uploaded', async () => {
  const { requests, remote } = recordingRemote(), client = await connectInProcess({ remote });
  try {
    // One running and two waiting validations fill the shared queue, so the submit is refused.
    const validating = Array.from({ length: 3 }, () => client.callTool({ name: 'validate_fighter_package', arguments: { manifestPath: 'examples/sparring-bot/fighter.json' } }));
    const busy = await client.callTool({ name: 'submit_fighter_package', arguments: { manifestPath: 'examples/sparring-bot/fighter.json', idempotencyKey: crypto.randomUUID() } });
    assert.equal(busy.structuredContent.code, 'local-validation-unavailable');
    assert.equal(busy.structuredContent.errors[0].code, 'VALIDATOR_BUSY');
    assert.ok((await Promise.all(validating)).every(result => result.structuredContent.ok));
    assert.equal(requests.length, 0);
  } finally { await client.close(); }
  const temporary = await mkdtemp(path.join(tmpdir(), 'fighter-submit-'));
  const second = await connectInProcess({ root: await realpath(temporary), remote });
  try {
    await cp(new URL('../examples/sparring-bot/', import.meta.url), path.join(temporary, 'broken'), { recursive: true });
    const changed = structuredClone(example); changed.assets[0].sha256 = '0'.repeat(64);
    await writeFile(path.join(temporary, 'broken', 'fighter.json'), JSON.stringify(changed));
    const invalid = await second.callTool({ name: 'submit_fighter_package', arguments: { manifestPath: 'broken/fighter.json', idempotencyKey: crypto.randomUUID() } });
    assert.equal(invalid.structuredContent.code, 'package-invalid');
    assert.ok(invalid.structuredContent.errors.some(e => e.code === 'ASSET_HASH'));
    assert.equal(requests.length, 0);
  } finally { await second.close(); await rm(temporary, { recursive: true, force: true }); }
});
test('an unreachable beta server leaves the offline contract readable', async () => {
  const client = await connectInProcess({ remote: { request: async () => { throw new Error('api-unreachable'); } } });
  try {
    const result = await client.callTool({ name: 'get_fighter_spec', arguments: { section: 'overview' } });
    assert.equal(result.structuredContent.ok, true);
    assert.equal(result.structuredContent.code, 'api-unreachable');
    assert.equal(result.structuredContent.data.registration.available, false);
  } finally { await client.close(); }
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

test('profile edits need no local files and issue one metadata PATCH with stable retry arguments', async () => {
  const calls=[],fighterId=crypto.randomUUID(),idempotencyKey=crypto.randomUUID();
  const remote={request:async(route,options={})=>{calls.push({route,...options});
    return route==='spec'?{data:{registration:{profileUpdate:'v1'}}}:{ok:true,stage:'registered',fighterId,manifestSha256:'b'.repeat(64)};}};
  const client=await connectInProcess({root:null,remote});
  const args={fighterId,idempotencyKey,expectedManifestSha256:'a'.repeat(64),profile:{name:'English name',concept:'Updated concept'}};
  try {
    for(let i=0;i<2;i++) assert.equal((await client.callTool({name:'update_fighter_profile',arguments:args})).structuredContent.stage,'registered');
    assert.deepEqual(calls.map(c=>c.route),['spec',`fighters/${fighterId}/profile`,'spec',`fighters/${fighterId}/profile`]);
    const writes=calls.filter(c=>c.method);
    assert.equal(writes.length,2);assert.ok(writes.every(c=>c.method==='PATCH'));
    assert.deepEqual(writes[0],writes[1]);assert.equal(writes[0].headers['idempotency-key'],idempotencyKey);
    assert.deepEqual(JSON.parse(writes[0].body),{expectedManifestSha256:args.expectedManifestSha256,profile:args.profile});
  } finally { await client.close(); }
  const old=await connectInProcess({root:null,remote:{request:async()=>({data:{registration:{}}})}});
  try { assert.equal((await old.callTool({name:'update_fighter_profile',arguments:args})).structuredContent.code,'server-feature-missing'); }
  finally { await old.close(); }
});

test('bout lines edits need profile-lines-1; null removes them and the schema bounds each line', async () => {
  const fighterId=crypto.randomUUID(), args=lines=>({fighterId,idempotencyKey:crypto.randomUUID(),expectedManifestSha256:'a'.repeat(64),profile:{lines}});
  const server=features=>{const calls=[];return {calls,remote:{request:async(route,options={})=>{calls.push({route,...options});
    return route==='spec'?{data:{registration:{profileUpdate:'v1'},features}}:{ok:true,stage:'registered',fighterId,manifestSha256:'b'.repeat(64)};}}};};
  const current=server(['profile-names-1','profile-lines-1']), client=await connectInProcess({root:null,remote:current.remote});
  try {
    for(const lines of [{challenge:'Ready.',lose:'Next time.'},null]) {
      assert.equal((await client.callTool({name:'update_fighter_profile',arguments:args(lines)})).structuredContent.stage,'registered');
      assert.deepEqual(JSON.parse(current.calls.at(-1).body).profile,{lines});
    }
    const writes=current.calls.filter(c=>c.method==='PATCH').length;
    for(const lines of [{},{taunt:'x'},{win:'x'.repeat(41)},{win:''}])
      assert.equal((await client.callTool({name:'update_fighter_profile',arguments:args(lines)})).isError,true,JSON.stringify(lines));
    assert.equal(current.calls.filter(c=>c.method==='PATCH').length,writes);
  } finally { await client.close(); }
  const old=server(['profile-names-1']), before=await connectInProcess({root:null,remote:old.remote});
  try {
    assert.equal((await before.callTool({name:'update_fighter_profile',arguments:args({win:'Done.'})})).structuredContent.code,'server-feature-missing');
    assert.equal((await before.callTool({name:'update_fighter_profile',arguments:{...args(null),profile:{name:'Still editable'}}})).structuredContent.stage,'registered');
    assert.deepEqual(old.calls.filter(c=>c.method).map(c=>JSON.parse(c.body).profile),[{name:'Still editable'}]);
  } finally { await before.close(); }
});
