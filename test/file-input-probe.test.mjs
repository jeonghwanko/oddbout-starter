import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudHandler, allowedFileUrl, CLOUD_ISSUER, CLOUD_RESOURCE } from '../mcp/cloud.mjs';
import { FILE_PROBE_LIMIT } from '../mcp/file-input-probe.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const owner = '11111111-1111-4111-8111-111111111111';
const claims = { iss: CLOUD_ISSUER, aud: CLOUD_RESOURCE, role: 'af_mcp', sub: owner,
  client_id: '00000000-0000-4000-8000-000000000001', session_id: '00000000-0000-4000-8000-000000000002',
  is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 3600, af_mcp: 'registration-v1' };
const file = { file_id: 'file_test-existing', download_url: 'https://files.oaiusercontent.com/test.png?sig=do-not-echo' };
const args = { file, expectedBytes: png.length, expectedSha256: digest(png) };

function runtime({ tokenClaims = claims, active = true, fetcher = async () => new Response(png) } = {}) {
  const calls = [];
  const db = { auth: { getClaims: async () => ({ data: { claims: tokenClaims }, error: null }) },
    rpc: async name => { assert.equal(name, 'af_mcp_session_state'); return { data: active ? 'usable' : 'ended', error: null }; },
    from: () => { throw new Error('Probe must not access registration or persistence tables'); },
    storage: new Proxy({}, { get: () => { throw new Error('Probe must not persist file bytes'); } }) };
  const handler = createCloudHandler({ db, fetcher: async (url, options) => { calls.push({ url, options }); return fetcher(url, options); } });
  const request = async (method, params, authenticated = true) => {
    const response = await handler(new Request(CLOUD_RESOURCE, { method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
        ...(authenticated ? { authorization: 'Bearer test-not-a-real-access-token' } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }) }));
    return { status: response.status, body: await response.json() };
  };
  return { calls, request, call: (arguments_ = args, authenticated = true) => request('tools/call', {
    name: 'verify_creator_file_input', arguments: arguments_ }, authenticated) };
}

test('wire descriptor exposes the complete official file-input schema and keeps existing tools', async () => {
  const { body, status } = await runtime().request('tools/list');
  assert.equal(status, 200);
  const tools = body.result.tools, tool = tools.find(t => t.name === 'verify_creator_file_input');
  assert.equal(tools.length, 20);
  for (const name of ['get_profile', 'open_creator_homepage', 'prepare_fighter_registration', 'upload_fighter_asset', 'submit_fighter_registration', 'prepare_profile_set', 'upload_profile_set_asset'])
    assert.ok(tools.some(t => t.name === name));
  assert.deepEqual(tool._meta['openai/fileParams'], ['file']);
  assert.deepEqual(Object.keys(tool.inputSchema.properties.file.properties).sort(), ['download_url','file_id','file_name','mime_type']);
  assert.deepEqual(tool.inputSchema.properties.file.required.sort(), ['download_url','file_id']);
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.securitySchemes[0].type, 'oauth2');
});

test('authenticated tool hashes actual receiver bytes without persisting or exposing the URL', async () => {
  const r = runtime(), result = await r.call(), receipt = result.body.result.structuredContent;
  assert.equal(result.status, 200);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.bytes, png.length);
  assert.equal(receipt.sha256, digest(png));
  assert.deepEqual(receipt.png, { width: 1, height: 1, check: 'png-signature-and-ihdr', decoded: false });
  assert.equal(receipt.accountId, owner);
  assert.equal(receipt.persisted, false);
  assert.equal(receipt.registered, false);
  assert.equal(receipt.libraryToVmVerified, false);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].options.redirect, 'error');
  assert.equal(r.calls[0].options.credentials, 'omit');
  assert.ok(!JSON.stringify(result.body).includes('do-not-echo'));
});

test('missing, wrong-audience and revoked authentication cannot trigger a file fetch', async () => {
  for (const config of [{ authenticated: false }, { tokenClaims: { ...claims, aud: 'other-service' } }, { active: false }]) {
    const r = runtime(config), result = await r.call(args, config.authenticated ?? true);
    assert.equal(result.status, 401);
    assert.equal(r.calls.length, 0);
  }
});

test('actual file identity is reported on a size/hash mismatch rather than echoing expected values', async () => {
  const result = await runtime().call({ ...args, expectedBytes: png.length + 1, expectedSha256: '0'.repeat(64) });
  const receipt = result.body.result.structuredContent;
  assert.equal(receipt.ok, false);
  assert.equal(result.body.result.isError, false);
  assert.equal(receipt.sha256, digest(png));
  assert.equal(receipt.matchesExpectedBytes, false);
  assert.equal(receipt.matchesExpectedSha256, false);
});

test('URL origin restrictions reject non-host inputs before network access', async () => {
  for (const url of ['http://files.oaiusercontent.com/x', 'https://127.0.0.1/x', 'https://files.oaiusercontent.com.evil.test/x',
    'https://user:password@files.oaiusercontent.com/x', 'https://files.oaiusercontent.com:444/x', 'https://files.oaiusercontent.com/x#fragment']) {
    const r = runtime(), result = await r.call({ ...args, file: { ...file, download_url: url } });
    assert.equal(result.body.result.structuredContent.code, 'unsupported-file-origin');
    assert.equal(result.body.result.structuredContent.ok, false);
    assert.equal(result.body.result.isError, false);
    assert.equal(r.calls.length, 0);
  }
});

test('declared and streamed oversized responses are bounded', async () => {
  for (const fetcher of [async () => new Response('small', { headers: { 'content-length': String(FILE_PROBE_LIMIT + 1) } }),
    async () => new Response(new Uint8Array(FILE_PROBE_LIMIT + 1))]) {
    const result = await runtime({ fetcher }).call();
    assert.equal(result.body.result.structuredContent.code, 'body-limit');
  }
});

test('probe accepts only exact observed Azure hosts without changing registration defaults', async () => {
  for (const host of ['oaisdmntprnznorth.blob.core.windows.net', 'oaisdmntprwestus.blob.core.windows.net']) {
    const url = `https://${host}/existing.png?sig=do-not-echo`;
    assert.equal(allowedFileUrl(url), false);
    const r = runtime(), result = await r.call({ ...args, file: { ...file, download_url: url } });
    assert.equal(result.body.result.structuredContent.ok, true);
    assert.equal(r.calls.length, 1);
  }
  for (const rejected of ['https://another-tenant.blob.core.windows.net/x',
    'https://oaisdmntprnznorth.blob.core.windows.net.evil.test/x',
    'http://oaisdmntprnznorth.blob.core.windows.net/x',
    'https://oaisdmntprnznorth.blob.core.windows.net:444/x',
    'https://user:secret@oaisdmntprnznorth.blob.core.windows.net/x']) {
    const blocked = runtime(), denied = await blocked.call({ ...args, file: { ...file, download_url: rejected } });
    assert.equal(denied.body.result.structuredContent.code, 'unsupported-file-origin');
    assert.equal(blocked.calls.length, 0);
  }
});

test('rejected origin diagnostics disclose only host properties, never signed paths or credentials', async () => {
  const r = runtime(), result = await r.call({ ...args, file: { ...file,
    download_url: 'https://secretuser:secretpass@example.test:444/private-path?sig=private-signature#private-fragment' } });
  assert.deepEqual(result.body.result.structuredContent.rejectedOrigin,
    { protocol: 'https:', hostname: 'example.test', port: '444', hasUserInfo: true, hasFragment: true });
  assert.equal(r.calls.length, 0);
  for (const secret of ['secretuser', 'secretpass', 'private-path', 'private-signature', 'private-fragment'])
    assert.ok(!JSON.stringify(result.body).includes(secret));
});

test('a MIME label cannot substitute for a PNG header', async () => {
  const result = await runtime({ fetcher: async () => new Response('not an image') }).call({ ...args, file: { ...file, mime_type: 'image/png' } });
  assert.equal(result.body.result.structuredContent.code, 'png-required');
});

test('upstream denial, redirect and thrown network errors do not expose secrets or report success', async () => {
  for (const fetcher of [async () => new Response('no', { status: 403 }),
    async () => Response.redirect('https://127.0.0.1/private'),
    async () => { throw new Error(file.download_url); }]) {
    const result = await runtime({ fetcher }).call();
    assert.equal(result.body.result.structuredContent.ok, false);
    assert.equal(result.body.result.structuredContent.code, 'file-download-unavailable');
    assert.ok(!JSON.stringify(result).includes('do-not-echo'));
  }
});
