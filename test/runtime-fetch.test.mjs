import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const modules = Object.fromEntries(['api/client.mjs', 'api/runtime-fetch.mjs', 'mcp/connection-readiness.mjs', 'mcp/creation-context.mjs', 'scripts/sprite-tools.mjs']
  .map(file => [file, new URL(`../${file}`, import.meta.url).href]));
const imports = `import { apiRequest, createRemoteClient } from ${JSON.stringify(modules['api/client.mjs'])};
import { runtimeFetch } from ${JSON.stringify(modules['api/runtime-fetch.mjs'])};
import { probePublic } from ${JSON.stringify(modules['mcp/connection-readiness.mjs'])};
import { fetchCreationContext } from ${JSON.stringify(modules['mcp/creation-context.mjs'])};`;

// Each child gets a loopback-only test proxy configuration. No real service or user session is used.
async function child(code, env = {}) {
  const childEnv = { ...process.env };
  // Empty lowercase variables mask uppercase fixtures on POSIX; remove both casings first.
  for (const key of Object.keys(childEnv)) if (/^(?:https?|no)_proxy$/i.test(key)) delete childEnv[key];
  Object.assign(childEnv, { NODE_USE_ENV_PROXY: '0' }, env);
  const { stdout, stderr } = await exec(process.execPath, ['--input-type=module', '-e', imports + code], {
    env: childEnv, timeout: 40000, windowsHide: true,
  });
  return { value: JSON.parse(stdout.trim()), stderr };
}

async function server(t, handler) {
  const instance = createServer(handler), sockets = new Set();
  instance.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => instance.close(resolve)); });
  return { instance, url: `http://127.0.0.1:${instance.address().port}` };
}

test('public probes and API bodies use the inherited proxy without destination DNS', async t => {
  const requests = [], tunnels = [];
  const target = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    requests.push({ path: request.url, method: request.method, authorization: request.headers.authorization,
      body: Buffer.concat(chunks).toString() });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, data: { registration: { deviceLogin: 'v1' } } }));
  });
  const proxy = await server(t);
  proxy.instance.on('connect', (request, socket, head) => {
    tunnels.push(request.url); socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    target.emit('connection', socket); if (head.length) socket.unshift(head);
  });
  const { value } = await child(`
    const probe = await probePublic('http://unresolvable.invalid/spec', { spec: true });
    const result = await apiRequest('http://unresolvable.invalid', 'fixture-token', 'upload', {
      method: 'PUT', body: Buffer.from('fixture-bytes'), timeoutMs: 3000 });
    console.log(JSON.stringify({ probe, result }));`, { HTTP_PROXY: proxy.url });
  assert.equal(value.probe.deviceLogin, 'available'); assert.equal(value.result.ok, true);
  assert.ok(tunnels.length > 0); assert.ok(tunnels.every(host => host === 'unresolvable.invalid:80'));
  assert.deepEqual(requests[1], { path: '/functions/v1/ai-fighter/upload', method: 'PUT',
    authorization: 'Bearer fixture-token', body: 'fixture-bytes' });
});

test('HTTPS proxy denial remains a network blocker through probes, API and real auth SDK refresh', async t => {
  const tunnels = [], proxy = await server(t);
  proxy.instance.on('connect', (request, socket) => {
    tunnels.push(request.url); socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
  const { value, stderr } = await child(`
    import { mkdtemp, writeFile, rm } from 'node:fs/promises';
    import os from 'node:os'; import path from 'node:path';
    const url = 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co';
    const probe = await probePublic(url + '/spec');
    let requestError, refreshError;
    try { await apiRequest(url, 'fixture-token', 'me', { timeoutMs: 3000 }); } catch (error) { requestError = error.message; }
    const dir = await mkdtemp(path.join(os.tmpdir(), 'fighter-proxy-test-'));
    try {
      const file = path.join(dir, 'session.json');
      await writeFile(file, JSON.stringify({ url, publishableKey: 'fixture-public-key', refreshToken: 'fixture-refresh',
        accessToken: 'e30.' + Buffer.from(JSON.stringify({ sub: 'fixture-user', exp: 1 })).toString('base64url') + '.fixture' }));
      const client = await createRemoteClient(file);
      try { await client.request('me'); } catch (error) { refreshError = error.message; }
    } finally { await rm(dir, { recursive: true, force: true }); }
    console.log(JSON.stringify({ probe, requestError, refreshError }));`, { HTTPS_PROXY: proxy.url });
  assert.equal(value.probe.reason, 'network-connect-forbidden');
  assert.equal(value.requestError, 'network-connect-forbidden');
  assert.equal(value.refreshError, 'network-connect-forbidden');
  assert.ok(tunnels.length >= 3); assert.ok(tunnels.every(host => host === 'aaaaaaaaaaaaaaaaaaaa.supabase.co:443'));
  assert.doesNotMatch(stderr, /fixture-token|fixture-refresh|fixture-public-key/);
});

test('creation context uses the inherited HTTPS proxy and preserves a sanitized denial', async t => {
  const tunnels = [], proxy = await server(t);
  proxy.instance.on('connect', (request, socket) => {
    tunnels.push(request.url); socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
  const { value, stderr } = await child(`
    try { await fetchCreationContext(); }
    catch (error) { console.log(JSON.stringify({ code: error.code, message: error.message })); }`,
  { HTTPS_PROXY: proxy.url });
  assert.deepEqual(value, { code: 'network-connect-forbidden', message: 'network-connect-forbidden' });
  assert.ok(tunnels.length > 0); assert.ok(tunnels.every(host => host === 'raw.githubusercontent.com:443'));
  assert.doesNotMatch(stderr, /fixture-secret|fixture-user/);
});

test('the host NO_PROXY rule and a host without proxies both preserve local access', async t => {
  const direct = await server(t, (_request, response) => response.end('local-fixture'));
  const proxy = await server(t); let tunneled = false;
  proxy.instance.on('connect', (_request, socket) => { tunneled = true; socket.destroy(); });
  const code = `console.log(JSON.stringify(await (await runtimeFetch(${JSON.stringify(direct.url)})).text()));`;
  assert.equal((await child(code, { HTTP_PROXY: proxy.url, NO_PROXY: '127.0.0.1' })).value, 'local-fixture');
  assert.equal((await child(code)).value, 'local-fixture'); assert.equal(tunneled, false);
});

test('an invalid proxy fails safely without falling back to a direct request', async t => {
  let requests = 0;
  const direct = await server(t, (_request, response) => { requests++; response.end('unexpected'); });
  const { value, stderr } = await child(`
    try { await runtimeFetch(${JSON.stringify(direct.url)}); }
    catch (error) { console.log(JSON.stringify({ code: error.code, message: error.message })); }`,
  { HTTP_PROXY: 'invalid://fixture-user:fixture-secret@127.0.0.1' });
  assert.deepEqual(value, { code: 'api-unreachable', message: 'api-unreachable' });
  assert.equal(requests, 0); assert.doesNotMatch(stderr, /fixture-secret|fixture-user/);
});

test('pinned WebP download uses the inherited proxy and reports a sanitized denial', async t => {
  const tunnels = [], proxy = await server(t);
  proxy.instance.on('connect', (request, socket) => {
    tunnels.push(request.url); socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
  const { value, stderr } = await child(`
    import { installImg2webp } from ${JSON.stringify(modules['scripts/sprite-tools.mjs'])};
    import { mkdtemp, rm } from 'node:fs/promises';
    import os from 'node:os'; import path from 'node:path';
    const dir = await mkdtemp(path.join(os.tmpdir(), 'webp-proxy-'));
    try { await installImg2webp({ spriteRoot: dir, python: 'unused', platform: 'linux', arch: 'x64', log: () => {} }); }
    catch (error) { console.log(JSON.stringify({ message: error.message })); }
    finally { await rm(dir, { recursive: true, force: true }); }
  `, { HTTPS_PROXY: proxy.url });
  assert.equal(value.message, 'img2webp: network network-connect-forbidden host=storage.googleapis.com');
  assert.ok(tunnels.length > 0); assert.ok(tunnels.every(host => host === 'storage.googleapis.com:443'));
  assert.doesNotMatch(stderr, /fixture-secret|fixture-user/);
});
